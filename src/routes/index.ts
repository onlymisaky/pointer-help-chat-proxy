import type { FastifyInstance } from 'fastify'
import { handleClaude } from './claude.js'
import { handleGemini } from './gemini.js'
import { handleOpenAIChat } from './openai-chat.js'
import { handleOpenAIResponses } from './openai-responses.js'

export function registerProxyRoutes(app: FastifyInstance) {
  app.post('/v1/chat/completions', handleOpenAIChat)
  app.post('/v1/responses', handleOpenAIResponses)
  app.post('/v1/messages', handleClaude)
  app.post('/v1beta/models/:modelAction', handleGemini)
}
