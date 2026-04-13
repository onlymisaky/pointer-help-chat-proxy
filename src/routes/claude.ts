import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  ClaudeRequest,
  ParsedRequest,
  ProxyMessage,
  ThirdPartyUsage,
} from '../types/common.js'
import { randomUUID } from 'node:crypto'
import {
  collectUpstreamResult,
  ensureSuccessfulUpstreamResponse,
  postToProxy,
  resolveModel,
} from '../services/chat-proxy.js'
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
import {
  createClaudeErrorPayload,
  mapFinishReason,
  sendClaudeError,
} from '../utils/response.js'
import { readSseEvents, setupSse, writeSse } from '../utils/sse.js'

function parseClaudeBody(body: unknown, headers: unknown): ParsedRequest {
  const payload = (body ?? {}) as ClaudeRequest

  if (!payload.model || typeof payload.model !== 'string') {
    return { error: 'model is required' }
  }

  if (!Array.isArray(payload.messages)) {
    return { error: 'messages must be an array' }
  }

  const messages: ProxyMessage[] = []
  const systemText = normalizeMessageContent(payload.system)

  if (systemText) {
    messages.push(createProxyMessage('system', systemText))
  }

  for (const message of payload.messages) {
    const text = normalizeMessageContent(message.content)
    if (!text) {
      continue
    }

    messages.push(
      createProxyMessage(
        mapRole(message.role),
        text,
        normalizeProxyUsage(message.metadata?.usage),
      ),
    )
  }

  return {
    format: 'claude',
    requestedModel: payload.model,
    upstreamModel: resolveModel(payload.model),
    stream: payload.stream === true,
    messages,
    inputText: latestUserText(messages),
    requestId: randomUUID(),
    headers: headers as Record<string, string>,
  }
}

async function streamClaude(
  reply: FastifyReply,
  parsed: Exclude<ParsedRequest, { error: string }>,
  response: Response,
) {
  setupSse(reply)
  const id = `msg_${randomUUID()}`
  let usage: ThirdPartyUsage | undefined
  let text = ''
  let finishReason = 'end_turn'
  let completed = false

  writeSse(
    reply,
    {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        model: parsed.requestedModel,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
        },
      },
    },
    'message_start',
  )

  try {
    const body = await ensureSuccessfulUpstreamResponse(response)

    for await (const event of readSseEvents(body)) {
      if (event === 'done') {
        break
      }

      if (event.type === 'text-start') {
        writeSse(
          reply,
          {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'text',
              text: '',
            },
          },
          'content_block_start',
        )
        continue
      }

      if (event.type === 'text-delta') {
        text += event.delta
        writeSse(
          reply,
          {
            type: 'content_block_delta',
            index: 0,
            delta: {
              type: 'text_delta',
              text: event.delta,
            },
          },
          'content_block_delta',
        )
        continue
      }

      if (event.type === 'text-end') {
        writeSse(reply, { type: 'content_block_stop', index: 0 }, 'content_block_stop')
        continue
      }

      if (event.type === 'finish') {
        usage = event.messageMetadata?.usage
        finishReason
          = mapFinishReason(event.finishReason) === 'stop'
            ? 'end_turn'
            : mapFinishReason(event.finishReason)
      }
    }

    writeSse(
      reply,
      {
        type: 'message_delta',
        delta: {
          stop_reason: finishReason,
          stop_sequence: null,
        },
        usage: {
          output_tokens: usage?.outputTokens ?? 0,
        },
      },
      'message_delta',
    )
    writeSse(reply, { type: 'message_stop' }, 'message_stop')
    completed = true
  }
  catch (error) {
    reply.log.error(error)
    const message = error instanceof Error ? error.message : 'proxy request failed'
    writeSse(reply, createClaudeErrorPayload(message), 'error')
  }

  reply.raw.end()

  if (!completed) {
    return
  }

  const upstreamResult = {
    text,
    finishReason,
    usage,
  }
  logResponseBefore(upstreamResult.text)
  logResponseAfter({
    id,
    type: 'message',
    role: 'assistant',
    model: parsed.requestedModel,
    content: [
      {
        type: 'text',
        text,
      },
    ],
    stop_reason: finishReason,
    stop_sequence: null,
    usage: {
      input_tokens: usage?.inputTokens ?? 0,
      output_tokens: usage?.outputTokens ?? 0,
    },
  })
}

export async function handleClaude(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  logRequestBefore(request.body)
  const parsed = parseClaudeBody(request.body, request.headers)
  if ('error' in parsed) {
    const errorResponse = {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: parsed.error,
      },
    }
    logResponseAfter(errorResponse)
    return sendClaudeError(reply, parsed.error)
  }

  try {
    const response = await postToProxy(parsed)
    if (parsed.stream) {
      await streamClaude(reply, parsed, response)
      return reply
    }

    const result = await collectUpstreamResult(response)
    const finalResponse = {
      id: `msg_${randomUUID()}`,
      type: 'message',
      role: 'assistant',
      model: parsed.requestedModel,
      content: [
        {
          type: 'text',
          text: result.text,
        },
      ],
      stop_reason:
        result.finishReason === 'stop' ? 'end_turn' : result.finishReason,
      stop_sequence: null,
      usage: {
        input_tokens: result.usage?.inputTokens ?? 0,
        output_tokens: result.usage?.outputTokens ?? 0,
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
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message,
      },
    }
    logResponseAfter(errorResponse)
    return sendClaudeError(reply, message, 502)
  }
}
