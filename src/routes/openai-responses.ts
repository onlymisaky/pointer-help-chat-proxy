import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  OpenAIResponseRequest,
  ParsedRequest,
} from '../types/common.js'
import { randomUUID } from 'node:crypto'
import { collectUpstreamResult, postToProxy, resolveModel } from '../services/chat-proxy.js'
import {
  logRequestBefore,
  logResponseAfter,
  logResponseBefore,
} from '../utils/log.js'
import {
  extractResponseInputMessages,
  latestUserText,
} from '../utils/message.js'
import { mapUsage, sendOpenAIError, unixTimestamp } from '../utils/response.js'
import { readSseEvents, setupSse, writeSse } from '../utils/sse.js'

function parseOpenAIResponsesBody(
  body: unknown,
  headers: unknown,
): ParsedRequest {
  const payload = (body ?? {}) as OpenAIResponseRequest

  if (!payload.model || typeof payload.model !== 'string') {
    return { error: 'model is required' }
  }

  if (payload.input === undefined) {
    return { error: 'input is required' }
  }

  const messages = extractResponseInputMessages(payload.input)
  if (messages.length === 0) {
    return { error: 'input must contain at least one text message' }
  }

  return {
    format: 'openai-responses',
    requestedModel: payload.model,
    upstreamModel: resolveModel(payload.model),
    stream: payload.stream === true,
    messages,
    inputText: latestUserText(messages),
    requestId: randomUUID(),
    headers: headers as Record<string, string>,
  }
}

async function streamOpenAIResponses(
  reply: FastifyReply,
  parsed: Exclude<ParsedRequest, { error: string }>,
  response: Response,
) {
  setupSse(reply)
  const responseId = `resp_${randomUUID()}`
  const itemId = `msg_${randomUUID()}`
  let text = ''
  let finishReason = 'stop'
  let usage = mapUsage()

  writeSse(reply, {
    type: 'response.created',
    response: {
      id: responseId,
      object: 'response',
      created_at: unixTimestamp(),
      status: 'in_progress',
      model: parsed.requestedModel,
      output: [],
    },
  })

  for await (const event of readSseEvents(
    response.body as ReadableStream<Uint8Array>,
  )) {
    if (event === 'done') {
      break
    }

    if (event.type === 'text-delta') {
      text += event.delta
      writeSse(reply, {
        type: 'response.output_text.delta',
        item_id: itemId,
        output_index: 0,
        content_index: 0,
        delta: event.delta,
      })
      continue
    }

    if (event.type === 'finish') {
      finishReason
        = event.finishReason && event.finishReason !== 'unknown'
          ? event.finishReason
          : 'stop'
      usage = mapUsage(event.messageMetadata?.usage)
    }
  }

  writeSse(reply, {
    type: 'response.output_text.done',
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    text,
  })
  writeSse(reply, {
    type: 'response.completed',
    response: {
      id: responseId,
      object: 'response',
      created_at: unixTimestamp(),
      status: 'completed',
      model: parsed.requestedModel,
      output: [
        {
          id: itemId,
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text,
              annotations: [],
            },
          ],
        },
      ],
      finish_reason: finishReason,
    },
  })
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
    id: responseId,
    object: 'response',
    created_at: unixTimestamp(),
    status: 'completed',
    model: parsed.requestedModel,
    output: [
      {
        id: itemId,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text,
            annotations: [],
          },
        ],
      },
    ],
    finish_reason: finishReason,
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
    },
  })
}

export async function handleOpenAIResponses(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  logRequestBefore(request.body)
  const parsed = parseOpenAIResponsesBody(request.body, request.headers)
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
      await streamOpenAIResponses(reply, parsed, response)
      return reply
    }

    const result = await collectUpstreamResult(response)
    const usage = mapUsage(result.usage)
    const finalResponse = {
      id: `resp_${randomUUID()}`,
      object: 'response',
      created_at: unixTimestamp(),
      status: 'completed',
      error: null,
      incomplete_details: null,
      model: parsed.requestedModel,
      output: [
        {
          id: `msg_${randomUUID()}`,
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: result.text,
              annotations: [],
            },
          ],
        },
      ],
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
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
