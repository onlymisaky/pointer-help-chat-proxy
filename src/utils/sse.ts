import type { FastifyReply } from 'fastify'
import type { UpstreamEvent } from '../types/common.js'

const SSE_LINE_BREAK_RE = /\r?\n/

export function setupSse(reply: FastifyReply) {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
  })
}

export function writeSse(reply: FastifyReply, data: unknown, event?: string) {
  if (event) {
    reply.raw.write(`event: ${event}\n`)
  }

  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
}

export function parseSseData(data: string): UpstreamEvent | 'done' | null {
  const trimmed = data.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed === '[DONE]') {
    return 'done'
  }

  try {
    const value = JSON.parse(trimmed) as UpstreamEvent | string
    if (value === '[DONE]') {
      return 'done'
    }

    return value as UpstreamEvent
  }
  catch {
    return null
  }
}

export async function* readSseEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<UpstreamEvent | 'done'> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })

    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const lines = frame.split(SSE_LINE_BREAK_RE)
      const dataLines = lines
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())

      if (dataLines.length === 0) {
        continue
      }

      const parsed = parseSseData(dataLines.join('\n'))
      if (parsed) {
        yield parsed
      }
    }

    if (done) {
      break
    }
  }

  if (buffer.trim()) {
    const lines = buffer.split(SSE_LINE_BREAK_RE)
    const dataLines = lines
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())

    const parsed = parseSseData(dataLines.join('\n'))
    if (parsed) {
      yield parsed
    }
  }
}
