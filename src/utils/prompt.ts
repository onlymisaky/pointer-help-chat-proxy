import type {
  InjectSystemPromptType,
  ProxyMessage,
} from '../types/common.js'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createProxyMessage } from './message.js'

function shouldInjectPrompt(messages: ProxyMessage[], injectSystemPrompt?: InjectSystemPromptType) {
  if (injectSystemPrompt === 'force') {
    return true
  }
  if (injectSystemPrompt === 'fill') {
    return messages.every(message => message.role !== 'assistant' && message.role !== 'system')
  }
  return false
}

export function injectPrompt(messages: ProxyMessage[], injectSystemPrompt?: InjectSystemPromptType) {
  const nextMessages = [...messages]
  if (shouldInjectPrompt(messages, injectSystemPrompt)) {
    const prompt = fs.readFileSync(path.join(path.resolve(process.cwd()), './PROMPT_CN.txt'), 'utf-8')
    const systemMessage = createProxyMessage('system', prompt)
    nextMessages.unshift(systemMessage)
  }
  return nextMessages
}
