import type {
  ParsedRequest,
  ProxyPayload,
  SupportedUpstreamModel,
  UpstreamResult,
} from '../types/common.js'
import { logRequestAfter, logResponseBefore } from '../utils/log.js'
import { latestUserText } from '../utils/message.js'
import { injectPrompt } from '../utils/prompt.js'
import { mapFinishReason } from '../utils/response.js'
import { readSseEvents } from '../utils/sse.js'
import { browserBridgeService } from './browser-bridge.js'

const DEFAULT_CONTEXT: ProxyPayload['context'] = [
  {
    type: 'file',
    content: '',
    filePath: '/help',
  },
  {
    type: 'help_origin',
    content: 'true',
  },
]

const OPENAI_MODEL_RE = /openai|gpt|codex/
const CLAUDE_MODEL_RE = /anthropic|claude|opus/
const GEMINI_MODEL_RE = /google|gemini/
const DEFAULT_UPSTREAM_URL = 'https://cursor.com/api/chat'

function buildProxyHeaders() {
  return {
  }
}

export function resolveModel(model: unknown): SupportedUpstreamModel {
  if (typeof model !== 'string') {
    return 'openai/gpt-5.1-codex-mini'
  }

  const normalized = model.toLowerCase()
  if (OPENAI_MODEL_RE.test(normalized)) {
    return 'openai/gpt-5.1-codex-mini'
  }

  if (CLAUDE_MODEL_RE.test(normalized)) {
    return 'anthropic/claude-sonnet-4.6'
  }

  if (GEMINI_MODEL_RE.test(normalized)) {
    return 'google/gemini-3-flash'
  }

  return 'openai/gpt-5.1-codex-mini'
}

export function createProxyPayload(
  parsed: Exclude<ParsedRequest, { error: string }>,
): ProxyPayload {
  return {
    context: DEFAULT_CONTEXT,
    model: parsed.upstreamModel,
    id: parsed.requestId,
    messages: injectPrompt(parsed.messages),
    trigger: 'submit-message',
  }
}

export async function postToProxy(
  parsed: Exclude<ParsedRequest, { error: string }>,
) {
  const payload = createProxyPayload(parsed)
  const request = {
    requestId: parsed.requestId,
    url: DEFAULT_UPSTREAM_URL,
    method: 'POST' as const,
    headers: buildProxyHeaders(),
    body: JSON.stringify(payload),
  }

  logRequestAfter(latestUserText(payload.messages))
  const response = browserBridgeService.isAvailable
    ? await requestThroughBrowserBridge(request)
    : await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      })
  await ensureSuccessfulUpstreamResponse(response)
  return response
}

export async function collectUpstreamResult(response: Response) {
  let text = ''
  let usage: UpstreamResult['usage']
  let finishReason = 'stop'

  const body = await ensureSuccessfulUpstreamResponse(response)

  for await (const event of readSseEvents(body)) {
    if (event === 'done') {
      break
    }

    if (event.type === 'text-delta') {
      text += event.delta
      continue
    }

    if (event.type === 'finish') {
      finishReason = mapFinishReason(event.finishReason)
      usage = event.messageMetadata?.usage
    }
  }

  const result = {
    text,
    finishReason,
    usage,
  } satisfies UpstreamResult
  logResponseBefore(result.text)
  return result
}

export async function ensureSuccessfulUpstreamResponse(response: Response) {
  if (!response.ok) {
    const details = (await response.text()).trim()
    throw new Error(
      details
        ? `proxy request failed: ${details}`
        : `proxy request failed with status ${response.status}`,
    )
  }

  if (!response.body) {
    throw new Error('proxy response body is empty')
  }

  return response.body
}

async function requestThroughBrowserBridge(payload: {
  requestId: string
  url: string
  method: 'POST'
  headers: Record<string, string>
  body: string
}) {
  try {
    return await browserBridgeService.request(payload)
  }
  catch (error) {
    if (error instanceof Error && error.message === 'browser bridge is not connected') {
      return fetch(payload.url, {
        method: payload.method,
        headers: payload.headers,
        body: payload.body,
      })
    }

    throw error
  }
}
