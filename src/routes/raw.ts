import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Buffer } from 'node:buffer'
import { browserBridgeService } from '../services/browser-bridge.js'
import { proxyRawRequest, sendRawProxyResponse } from '../services/raw-proxy.js'

function toRawBody(body: unknown) {
  if (body instanceof Uint8Array) {
    return Buffer.from(body)
  }

  if (typeof body === 'string') {
    return Buffer.from(body)
  }

  if (body == null) {
    return Buffer.alloc(0)
  }

  throw new Error('raw proxy route requires a raw request body')
}

async function handleRawProxy(request: FastifyRequest, reply: FastifyReply) {
  const body = toRawBody(request.body)

  request.log.info({
    route: 'raw-proxy',
    method: request.method,
    path: request.url,
    bytes: body.byteLength,
    bridge: browserBridgeService.isAvailable,
  })

  try {
    const response = await proxyRawRequest({
      method: 'POST',
      headers: request.headers,
      body,
    })

    request.log.info({
      route: 'raw-proxy',
      method: request.method,
      path: request.url,
      status: response.status,
    })
    return await sendRawProxyResponse(reply, response)
  }
  catch (error) {
    request.log.error(error)
    return reply.code(502).send({
      error: 'raw proxy request failed',
      message: error instanceof Error ? error.message : 'unknown error',
    })
  }
}

export async function registerRawProxyRoutes(app: FastifyInstance) {
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body)
  })

  app.post('/', handleRawProxy)
  app.post('/*', handleRawProxy)
}
