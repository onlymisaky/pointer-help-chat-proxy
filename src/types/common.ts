export type JsonRecord = Record<string, unknown>

/**
 * 是否强制注入系统提示词，以绕 cursor 对模型的默认限制
 * force: 始终强制注入在头部
 * fill: 如果 messages 中没有 assistant 或 system 消息，则注入系统提示词
 * false: 不注入系统提示词
 */
export type InjectSystemPromptType = 'force' | 'fill' | false | undefined

export type ParsedRequest
  = | {
    error: string
  }
  | {
    format: 'openai-chat' | 'openai-responses' | 'claude' | 'gemini'
    requestedModel: string
    upstreamModel: SupportedUpstreamModel
    stream: boolean
    messages: ProxyMessage[]
    inputText: string
    requestId: string
    headers: Record<string, string>
    injectSystemPrompt: InjectSystemPromptType
  }

export type SupportedUpstreamModel
  = | 'anthropic/claude-sonnet-4.6'
    | 'openai/gpt-5.1-codex-mini'
    | 'google/gemini-3-flash'

export interface ChatMessage {
  role?: string
  content?: unknown
  metadata?: {
    usage?: ThirdPartyUsage
  }
}

export interface OpenAIChatRequest {
  model?: string
  messages?: ChatMessage[]
  stream?: boolean
  injectSystemPrompt?: InjectSystemPromptType
}

export interface OpenAIResponseRequest {
  model?: string
  input?: unknown
  stream?: boolean
  injectSystemPrompt?: InjectSystemPromptType
}

export interface ClaudeRequest {
  model?: string
  messages?: ChatMessage[]
  system?: unknown
  stream?: boolean
  injectSystemPrompt?: InjectSystemPromptType
}

export interface GeminiTextPart {
  text?: string
}

export interface GeminiContent {
  role?: string
  parts?: GeminiTextPart[]
}

export interface GeminiRequest {
  contents?: GeminiContent[]
  systemInstruction?: unknown
  injectSystemPrompt?: InjectSystemPromptType
}

export interface GeminiRouteParams {
  modelAction: string
}

export interface ThirdPartyUsage {
  inputTokens?: number
  inputTokenDetails?: {
    noCacheTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  outputTokens?: number
  outputTokenDetails?: {
    textTokens?: number
    reasoningTokens?: number
  }
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
}

export interface ProxyMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  parts: Array<{
    type: 'text'
    text: string
  }>
  metadata?: {
    usage: ThirdPartyUsage
  }
}

export interface ProxyPayload {
  context: [
    {
      type: 'file'
      content: ''
      filePath: '/help'
    },
    {
      type: 'help_origin'
      content: 'true'
    },
  ]
  model: SupportedUpstreamModel
  id: string
  messages: ProxyMessage[]
  trigger: 'submit-message'
}

export type UpstreamEvent
  = | { type: 'start' }
    | { type: 'start-step' }
    | { type: 'text-start', id: string }
    | { type: 'text-delta', id: string, delta: string }
    | { type: 'text-end', id: string }
    | { type: 'finish-step' }
    | {
      type: 'finish'
      finishReason?: string
      messageMetadata?: { usage?: ThirdPartyUsage }
    }

export interface UpstreamResult {
  text: string
  finishReason: string
  usage?: ThirdPartyUsage
}

export interface BridgeClientHello {
  type: 'hello'
  token: string
}

export interface BridgeProxyRequest {
  type: 'proxy_request'
  requestId: string
  url: string
  method: 'POST'
  headers: Record<string, string>
  body: string
}

export interface BridgeProxyResponseHead {
  type: 'proxy_response_head'
  requestId: string
  status: number
  statusText: string
  url: string
  headers: Record<string, string>
}

export interface BridgeProxyResponseChunk {
  type: 'proxy_response_chunk'
  requestId: string
  chunk: string
  encoding: 'base64'
}

export interface BridgeProxyError {
  type: 'proxy_error'
  requestId: string
  message: string
  status?: number
  details?: string
}

export interface BridgeProxyComplete {
  type: 'proxy_complete'
  requestId: string
}

export type BridgeIncomingMessage
  = | BridgeClientHello
    | BridgeProxyResponseHead
    | BridgeProxyResponseChunk
    | BridgeProxyError
    | BridgeProxyComplete
