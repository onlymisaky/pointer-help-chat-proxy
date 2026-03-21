import type {
  GeminiContent,
  JsonRecord,
  ProxyMessage,
  ThirdPartyUsage,
} from '../types/common.js'
import { randomUUID } from 'node:crypto'

export function normalizeContentPart(part: unknown): string {
  if (typeof part === 'string') {
    return part
  }

  if (!part || typeof part !== 'object') {
    return ''
  }

  const candidate = part as JsonRecord
  if (typeof candidate.text === 'string') {
    return candidate.text
  }

  if (typeof candidate.content === 'string') {
    return candidate.content
  }

  if (Array.isArray(candidate.content)) {
    return candidate.content.map(normalizeContentPart).filter(Boolean).join('\n')
  }

  return ''
}

export function normalizeMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content.map(normalizeContentPart).filter(Boolean).join('\n')
  }

  return normalizeContentPart(content)
}

export function normalizeProxyUsage(
  usage: unknown,
): ThirdPartyUsage | undefined {
  if (!usage || typeof usage !== 'object') {
    return undefined
  }

  return usage as ThirdPartyUsage
}

export function mapRole(role: string | undefined): 'user' | 'assistant' {
  return role === 'assistant' ? 'assistant' : 'user'
}

export function createProxyMessage(
  role: 'user' | 'assistant',
  text: string,
  usage?: ThirdPartyUsage,
): ProxyMessage {
  const message: ProxyMessage = {
    id: randomUUID(),
    role,
    parts: [
      {
        type: 'text',
        text,
      },
    ],
  }

  if (role === 'assistant' && usage) {
    message.metadata = {
      usage,
    }
  }

  return message
}

export function latestUserText(messages: ProxyMessage[]) {
  const match = [...messages]
    .reverse()
    .find(message => message.role === 'user')
  return match?.parts.map(part => part.text).join('\n') ?? ''
}

export function summarizeProxyMessagesText(messages: ProxyMessage[]) {
  return messages
    .map((message, index) => {
      const text = message.parts.map(part => part.text).join('\n').trim()
      if (!text) {
        return ''
      }

      return `[${index + 1}] ${message.role}\n${text}`
    })
    .filter(Boolean)
    .join('\n\n')
}

export function hasAssistantMessage(messages: ProxyMessage[]) {
  return messages.some(message => message.role === 'assistant')
}

export function extractResponseInputMessages(input: unknown): ProxyMessage[] {
  if (typeof input === 'string') {
    return [createProxyMessage('user', input)]
  }

  if (!Array.isArray(input)) {
    const text = normalizeMessageContent(input)
    return text ? [createProxyMessage('user', text)] : []
  }

  const messages: ProxyMessage[] = []
  for (const item of input) {
    if (typeof item === 'string') {
      messages.push(createProxyMessage('user', item))
      continue
    }

    if (!item || typeof item !== 'object') {
      continue
    }

    const candidate = item as JsonRecord
    const role = mapRole(
      typeof candidate.role === 'string' ? candidate.role : undefined,
    )
    const text = normalizeMessageContent(
      candidate.content ?? candidate.input_text ?? candidate.text,
    )
    if (!text) {
      continue
    }

    messages.push(createProxyMessage(role, text))
  }

  return messages
}

export function extractGeminiInstructionText(systemInstruction: unknown) {
  if (!systemInstruction || typeof systemInstruction !== 'object') {
    return normalizeMessageContent(systemInstruction)
  }

  const candidate = systemInstruction as JsonRecord
  return normalizeMessageContent(
    candidate.parts ?? candidate.content ?? candidate.text,
  )
}

export function extractGeminiMessages(contents: unknown): ProxyMessage[] {
  if (!Array.isArray(contents)) {
    return []
  }

  const messages: ProxyMessage[] = []
  for (const item of contents as GeminiContent[]) {
    const text = normalizeMessageContent(item?.parts)
    if (!text) {
      continue
    }

    const role
      = item?.role === 'model' || item?.role === 'assistant'
        ? 'assistant'
        : 'user'

    messages.push(createProxyMessage(role, text))
  }

  return messages
}
