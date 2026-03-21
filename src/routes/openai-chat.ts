import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  OpenAIChatRequest,
  ParsedRequest,
  ProxyMessage,
} from '../types/common.js'
import { randomUUID } from 'node:crypto'
import { collectUpstreamResult, postToProxy, resolveModel } from '../services/chat-proxy.js'
import {
  logRequestBefore,
  logResponseAfter,
  logResponseBefore,
} from '../utils/log.js'
import {
  createProxyMessage,
  latestUserText,
  mapRole,
  normalizeMessageContent,
  normalizeProxyUsage,
} from '../utils/message.js'
import { mapUsage, sendOpenAIError, unixTimestamp } from '../utils/response.js'
import { readSseEvents, setupSse, writeSse } from '../utils/sse.js'

function parseOpenAIChatBody(body: unknown, headers: unknown): ParsedRequest {
  const payload = (body ?? {}) as OpenAIChatRequest

  if (!payload.model || typeof payload.model !== 'string') {
    return { error: 'model is required' }
  }

  if (!Array.isArray(payload.messages)) {
    return { error: 'messages must be an array' }
  }

  const messages = payload.messages
    .map((message) => {
      const text = normalizeMessageContent(message.content)
      if (!text) {
        return null
      }

      return createProxyMessage(
        mapRole(message.role),
        text,
        normalizeProxyUsage(message.metadata?.usage),
      )
    })
    .filter((message): message is ProxyMessage => message !== null)

  return {
    format: 'openai-chat',
    requestedModel: payload.model,
    upstreamModel: resolveModel(payload.model),
    stream: payload.stream === true,
    messages,
    inputText: latestUserText(messages),
    requestId: randomUUID(),
    headers: headers as Record<string, string>,
  }
}

async function streamOpenAIChat(
  reply: FastifyReply,
  parsed: Exclude<ParsedRequest, { error: string }>,
  response: Response,
) {
  setupSse(reply)
  const id = `chatcmpl_${randomUUID()}`
  const created = unixTimestamp()
  let roleSent = false
  let text = ''
  let finishReason = 'stop'
  let usage = mapUsage()

  for await (const event of readSseEvents(
    response.body as ReadableStream<Uint8Array>,
  )) {
    if (event === 'done') {
      break
    }

    if (event.type === 'text-start' && !roleSent) {
      roleSent = true
      writeSse(reply, {
        id,
        object: 'chat.completion.chunk',
        created,
        model: parsed.requestedModel,
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: '',
            },
            finish_reason: null,
          },
        ],
      })
      continue
    }

    if (event.type === 'text-delta') {
      text += event.delta
      writeSse(reply, {
        id,
        object: 'chat.completion.chunk',
        created,
        model: parsed.requestedModel,
        choices: [
          {
            index: 0,
            delta: {
              content: event.delta,
            },
            finish_reason: null,
          },
        ],
      })
      continue
    }

    if (event.type === 'finish') {
      finishReason = event.finishReason && event.finishReason !== 'unknown'
        ? event.finishReason
        : 'stop'
      usage = mapUsage(event.messageMetadata?.usage)
    }
  }

  writeSse(reply, {
    id,
    object: 'chat.completion.chunk',
    created,
    model: parsed.requestedModel,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: finishReason,
      },
    ],
  })
  reply.raw.write('data: [DONE]\n\n')
  reply.raw.end()

  const upstreamResult = {
    text,
    finishReason,
    usage: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      totalTokens: usage.total_tokens,
      cachedInputTokens: usage.cached_input_tokens,
      reasoningTokens: usage.reasoning_tokens,
    },
  }
  logResponseBefore(upstreamResult.text)
  logResponseAfter({
    id,
    object: 'chat.completion',
    created,
    model: parsed.requestedModel,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text,
        },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
    },
  })
}

export async function handleOpenAIChat(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  logRequestBefore(request.body)
  const parsed = parseOpenAIChatBody(request.body, request.headers)
  if ('error' in parsed) {
    const errorResponse = {
      error: {
        message: parsed.error,
        type: 'invalid_request_error',
        param: null,
        code: null,
      },
    }
    logResponseAfter(errorResponse)
    return sendOpenAIError(reply, parsed.error)
  }

  try {
    const response = await postToProxy(parsed)
    if (parsed.stream) {
      await streamOpenAIChat(reply, parsed, response)
      return reply
    }

    const result = await collectUpstreamResult(response)
    const usage = mapUsage(result.usage)
    const finalResponse = {
      id: `chatcmpl_${randomUUID()}`,
      object: 'chat.completion',
      created: unixTimestamp(),
      model: parsed.requestedModel,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: result.text,
          },
          finish_reason: result.finishReason,
        },
      ],
      usage: {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
      },
    }
    logResponseAfter(finalResponse)

    return finalResponse
  }
  catch (error) {
    request.log.error(error)
    const message
      = error instanceof Error ? error.message : 'proxy request failed'
    const errorResponse = {
      error: {
        message,
        type: 'invalid_request_error',
        param: null,
        code: null,
      },
    }
    logResponseAfter(errorResponse)
    return sendOpenAIError(reply, message, 502)
  }
}
