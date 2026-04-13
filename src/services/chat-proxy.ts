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
    messages: injectPrompt(
      parsed.upstreamModel,
      parsed.messages,
      parsed.headers,
    ),
    trigger: 'submit-message',
  }
}

export async function postToProxy(
  parsed: Exclude<ParsedRequest, { error: string }>,
) {
  const payload = createProxyPayload(parsed)
  logRequestAfter(latestUserText(payload.messages))

  const response = await fetch(
    'https://cursor.com/api/chat',
    {
      method: 'POST',
      headers: buildProxyHeaders(),
      body: JSON.stringify(payload),
    },
  )

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

  return response
}

export async function collectUpstreamResult(response: Response) {
  let text = ''
  let usage: UpstreamResult['usage']
  let finishReason = 'stop'

  for await (const event of readSseEvents(
    response.body as ReadableStream<Uint8Array>,
  )) {
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
