import process from 'node:process'
import { pathToFileURL } from 'node:url'
import Fastify from 'fastify'
import { registerProxyRoutes } from './routes/index.js'
import { createAppLogger } from './utils/logger.js'

const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '0.0.0.0'

export function buildApp() {
  const app = Fastify({
    loggerInstance: createAppLogger(),
  })

  app.get('/health', async () => ({ ok: true }))
  registerProxyRoutes(app)

  return app
}

const start = async () => {
  const app = buildApp()

  try {
    await app.listen({ port: PORT, host: HOST })
  }
  catch (error) {
    app.log.error(error)
    process.exit(1)
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === entryUrl) {
  void start()
}
