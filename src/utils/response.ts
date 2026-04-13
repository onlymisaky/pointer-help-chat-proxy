import type { FastifyReply } from 'fastify'
import type { ThirdPartyUsage } from '../types/common.js'

export function unixTimestamp() {
  return Math.floor(Date.now() / 1000)
}

export function mapFinishReason(reason: string | undefined) {
  return reason && reason !== 'unknown' ? reason : 'stop'
}

export function mapUsage(usage?: ThirdPartyUsage) {
  const inputTokens = usage?.inputTokens ?? 0
  const outputTokens = usage?.outputTokens ?? 0

  return {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: usage?.totalTokens ?? inputTokens + outputTokens,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens: usage?.cachedInputTokens ?? 0,
    reasoning_tokens:
      usage?.reasoningTokens ?? usage?.outputTokenDetails?.reasoningTokens ?? 0,
  }
}

export function mapGeminiFinishReason(reason: string | undefined) {
  switch (mapFinishReason(reason)) {
    case 'length':
      return 'MAX_TOKENS'
    case 'content_filter':
      return 'SAFETY'
    case 'tool_calls':
      return 'STOP'
    case 'stop':
    default:
      return 'STOP'
  }
}

export function mapGeminiUsageMetadata(usage?: ThirdPartyUsage) {
  const mapped = mapUsage(usage)

  return {
    promptTokenCount: mapped.input_tokens,
    candidatesTokenCount: mapped.output_tokens,
    totalTokenCount: mapped.total_tokens,
    cachedContentTokenCount: mapped.cached_input_tokens,
  }
}

export function sendOpenAIError(
  reply: FastifyReply,
  message: string,
  statusCode = 400,
) {
  return reply.code(statusCode).send(createOpenAIErrorPayload(message))
}

export function sendClaudeError(
  reply: FastifyReply,
  message: string,
  statusCode = 400,
) {
  return reply.code(statusCode).send(createClaudeErrorPayload(message))
}

export function sendGeminiError(
  reply: FastifyReply,
  message: string,
  statusCode = 400,
) {
  return reply.code(statusCode).send(createGeminiErrorPayload(message, statusCode))
}

export function createOpenAIErrorPayload(message: string) {
  return {
    error: {
      message,
      type: 'invalid_request_error',
      param: null,
      code: null,
    },
  }
}

export function createClaudeErrorPayload(message: string) {
  return {
    type: 'error',
    error: {
      type: 'invalid_request_error',
      message,
    },
  }
}

export function createGeminiErrorPayload(message: string, statusCode = 400) {
  return {
    error: {
      code: statusCode,
      message,
      status: statusCode >= 500 ? 'INTERNAL' : 'INVALID_ARGUMENT',
    },
  }
}
