import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  GeminiRequest,
  GeminiRouteParams,
  ParsedRequest,
  ProxyMessage,
} from '../types/common.js'
import { randomUUID } from 'node:crypto'
import {
  collectUpstreamResult,
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
  extractGeminiInstructionText,
  extractGeminiMessages,
  latestUserText,
} from '../utils/message.js'
import {
  mapGeminiFinishReason,
  mapGeminiUsageMetadata,
  sendGeminiError,
} from '../utils/response.js'
import { readSseEvents, setupSse, writeSse } from '../utils/sse.js'

type GeminiRouteTarget
  = | {
    error: string
  }
  | {
    model: string
    stream: boolean
  }

function parseGeminiRouteTarget(
  modelAction: string | undefined,
): GeminiRouteTarget {
  if (!modelAction || typeof modelAction !== 'string') {
    return { error: 'model is required' } as const
  }

  if (modelAction.endsWith(':generateContent')) {
    return {
      model: modelAction.slice(0, -':generateContent'.length),
      stream: false,
    } as const
  }

  if (modelAction.endsWith(':streamGenerateContent')) {
    return {
      model: modelAction.slice(0, -':streamGenerateContent'.length),
      stream: true,
    } as const
  }

  return { error: 'unsupported Gemini method' } as const
}

function parseGeminiBody(
  model: string | undefined,
  body: unknown,
  headers: unknown,
  stream: boolean,
): ParsedRequest {
  if (!model || typeof model !== 'string') {
    return { error: 'model is required' }
  }

  const payload = (body ?? {}) as GeminiRequest
  const messages: ProxyMessage[] = []
  const systemText = extractGeminiInstructionText(payload.systemInstruction)
  if (systemText) {
    messages.push(createProxyMessage('user', systemText))
  }

  messages.push(...extractGeminiMessages(payload.contents))

  if (messages.length === 0) {
    return { error: 'contents must contain at least one text part' }
  }

  return {
    format: 'gemini',
    requestedModel: model,
    upstreamModel: resolveModel(model),
    stream,
    messages,
    inputText: latestUserText(messages),
    requestId: randomUUID(),
    headers: headers as Record<string, string>,
  }
}

async function streamGemini(
  reply: FastifyReply,
  parsed: Exclude<ParsedRequest, { error: string }>,
  response: Response,
) {
  setupSse(reply)
  let text = ''
  let finishReason = 'STOP'
  let usageMetadata = mapGeminiUsageMetadata()

  for await (const event of readSseEvents(
    response.body as ReadableStream<Uint8Array>,
  )) {
    if (event === 'done') {
      break
    }

    if (event.type === 'text-delta') {
      text += event.delta
      writeSse(reply, {
        candidates: [
          {
            index: 0,
            content: {
              role: 'model',
              parts: [{ text: event.delta }],
            },
          },
        ],
      })
      continue
    }

    if (event.type === 'finish') {
      finishReason = mapGeminiFinishReason(event.finishReason)
      usageMetadata = mapGeminiUsageMetadata(event.messageMetadata?.usage)
    }
  }

  writeSse(reply, {
    candidates: [
      {
        index: 0,
        content: {
          role: 'model',
          parts: [{ text }],
        },
        finishReason,
      },
    ],
    usageMetadata,
  })
  reply.raw.end()

  const upstreamResult = {
    text,
    finishReason,
    usageMetadata,
  }
  logResponseBefore(upstreamResult.text)
  logResponseAfter({
    candidates: [
      {
        index: 0,
        content: {
          role: 'model',
          parts: [{ text }],
        },
        finishReason,
      },
    ],
    usageMetadata,
  })
}

export async function handleGeminiGenerateContent(
  request: FastifyRequest<{ Params: GeminiRouteParams }>,
  reply: FastifyReply,
) {
  const target = parseGeminiRouteTarget(request.params.modelAction)
  if ('error' in target) {
    const errorResponse = {
      error: {
        code: 404,
        message: target.error,
        status: 'INVALID_ARGUMENT',
      },
    }
    logResponseAfter(errorResponse)
    return sendGeminiError(reply, target.error, 404)
  }

  const parsed = parseGeminiBody(target.model, request.body, request.headers, false)
  if ('error' in parsed) {
    const errorResponse = {
      error: {
        code: 400,
        message: parsed.error,
        status: 'INVALID_ARGUMENT',
      },
    }
    logResponseAfter(errorResponse)
    return sendGeminiError(reply, parsed.error)
  }

  try {
    const response = await postToProxy(parsed)
    const result = await collectUpstreamResult(response)
    const finalResponse = {
      candidates: [
        {
          index: 0,
          content: {
            role: 'model',
            parts: [
              {
                text: result.text,
              },
            ],
          },
          finishReason: mapGeminiFinishReason(result.finishReason),
        },
      ],
      usageMetadata: mapGeminiUsageMetadata(result.usage),
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
        code: 502,
        message,
        status: 'INTERNAL',
      },
    }
    logResponseAfter(errorResponse)
    return sendGeminiError(reply, message, 502)
  }
}

export async function handleGeminiStreamGenerateContent(
  request: FastifyRequest<{ Params: GeminiRouteParams }>,
  reply: FastifyReply,
) {
  const target = parseGeminiRouteTarget(request.params.modelAction)
  if ('error' in target) {
    const errorResponse = {
      error: {
        code: 404,
        message: target.error,
        status: 'INVALID_ARGUMENT',
      },
    }
    logResponseAfter(errorResponse)
    return sendGeminiError(reply, target.error, 404)
  }

  const parsed = parseGeminiBody(target.model, request.body, request.headers, true)
  if ('error' in parsed) {
    const errorResponse = {
      error: {
        code: 400,
        message: parsed.error,
        status: 'INVALID_ARGUMENT',
      },
    }
    logResponseAfter(errorResponse)
    return sendGeminiError(reply, parsed.error)
  }

  try {
    const response = await postToProxy(parsed)
    await streamGemini(reply, parsed, response)
    return reply
  }
  catch (error) {
    request.log.error(error)
    return sendGeminiError(
      reply,
      error instanceof Error ? error.message : 'proxy request failed',
      502,
    )
  }
}

export async function handleGemini(
  request: FastifyRequest<{ Params: GeminiRouteParams }>,
  reply: FastifyReply,
) {
  logRequestBefore(request.body)
  const target = parseGeminiRouteTarget(request.params.modelAction)
  if ('error' in target) {
    const errorResponse = {
      error: {
        code: 404,
        message: target.error,
        status: 'INVALID_ARGUMENT',
      },
    }
    logResponseAfter(errorResponse)
    return sendGeminiError(reply, target.error, 404)
  }

  if (target.stream) {
    return handleGeminiStreamGenerateContent(request, reply)
  }

  return handleGeminiGenerateContent(request, reply)
}
