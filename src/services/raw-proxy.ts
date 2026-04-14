import type { FastifyReply, RawRequestDefaultExpression } from 'fastify'
import type { Buffer } from 'node:buffer'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { DEFAULT_UPSTREAM_URL } from '../utils/constants.js'
import { browserBridgeService } from './browser-bridge.js'

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function normalizeHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value.join(', ')
  }

  return value
}

export function filterProxyHeaders(
  headers: RawRequestDefaultExpression['headers'] | Headers,
) {
  const result: Record<string, string> = {}
  const entries = headers instanceof Headers
    ? headers.entries()
    : Object.entries(headers)

  for (const [key, rawValue] of entries) {
    const normalizedKey = key.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(normalizedKey)) {
      continue
    }

    const value = normalizeHeaderValue(rawValue)
    if (typeof value !== 'string' || value.length === 0) {
      continue
    }

    result[normalizedKey] = value
  }

  return result
}

export async function proxyRawRequest(payload: {
  method: 'POST'
  headers: RawRequestDefaultExpression['headers']
  body: Buffer
}) {
  const request = {
    requestId: randomUUID(),
    url: DEFAULT_UPSTREAM_URL,
    method: payload.method,
    headers: filterProxyHeaders(payload.headers),
    body: payload.body.toString('utf8'),
  }

  if (browserBridgeService.isAvailable) {
    try {
      return await browserBridgeService.request(request)
    }
    catch (error) {
      if (error instanceof Error && error.message !== 'browser bridge is not connected') {
        throw error
      }
    }
  }

  return fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  })
}

export async function sendRawProxyResponse(reply: FastifyReply, response: Response) {
  reply.code(response.status)

  for (const [key, value] of Object.entries(filterProxyHeaders(response.headers))) {
    reply.header(key, value)
  }

  if (!response.body) {
    return reply.send()
  }

  return reply.send(Readable.fromWeb(response.body as unknown as NodeReadableStream))
}
