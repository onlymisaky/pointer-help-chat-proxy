import type { FastifyBaseLogger } from 'fastify'

type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'fatal'

interface LogBindings {
  reqId?: string
}

type LoggerPayload = Record<string, unknown>

const RESET = '\x1B[0m'
const DIM = '\x1B[2m'
const RED = '\x1B[31m'
const YELLOW = '\x1B[33m'
const GREEN = '\x1B[32m'
const BLUE = '\x1B[34m'
const MAGENTA = '\x1B[35m'

function formatTimestamp(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return JSON.stringify(
      {
        error: 'failed to serialize logger payload',
      },
      null,
      2,
    )
  }
}

function indentBlock(value: string) {
  return value
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n')
}

function formatMeta(bindings: LogBindings) {
  return bindings.reqId ? ` ${DIM}(reqId: ${bindings.reqId})${RESET}` : ''
}

function normalizeArgs(args: unknown[]) {
  let payload: LoggerPayload | undefined
  let message = ''

  for (const arg of args) {
    if (typeof arg === 'string') {
      message = arg
      continue
    }

    if (arg && typeof arg === 'object') {
      payload = arg as LoggerPayload
    }
  }

  return { payload, message }
}

function pickErrorPayload(payload: LoggerPayload | undefined) {
  if (!payload) {
    return undefined
  }

  const error = payload.err
  if (!error || typeof error !== 'object') {
    return payload
  }

  const err = error as Record<string, unknown>
  return {
    type: err.type,
    message: err.message,
    code: err.code,
    statusCode: err.statusCode,
    stack: err.stack,
  }
}

function pickRequestPayload(payload: LoggerPayload | undefined) {
  if (!payload?.req || typeof payload.req !== 'object') {
    return payload
  }

  const req = payload.req as Record<string, unknown>
  return {
    method: req.method,
    url: req.url,
    host: req.host,
    remoteAddress: req.remoteAddress,
    remotePort: req.remotePort,
  }
}

function pickResponsePayload(payload: LoggerPayload | undefined) {
  if (!payload) {
    return undefined
  }

  const res = payload.res && typeof payload.res === 'object'
    ? (payload.res as Record<string, unknown>)
    : undefined

  return {
    statusCode: res?.statusCode,
    responseTime: payload.responseTime,
  }
}

function writeLog(
  color: string,
  title: string,
  payload: unknown,
  bindings: LogBindings,
) {
  const timestamp = `${DIM}[${formatTimestamp()}]${RESET}`
  const header = `${color}${title}${RESET}${formatMeta(bindings)}`
  const body = payload === undefined ? '' : `\n${indentBlock(prettyJson(payload))}`
  console.log(`${timestamp} ${header}${body}`)
}

function emit(level: LogLevel, bindings: LogBindings, args: unknown[]) {
  const { payload, message } = normalizeArgs(args)

  if (message === 'incoming request') {
    writeLog(BLUE, '→ incoming request', pickRequestPayload(payload), bindings)
    return
  }

  if (message === 'request completed') {
    writeLog(GREEN, '← request completed', pickResponsePayload(payload), bindings)
    return
  }

  if (message) {
    const color
      = level === 'error' || level === 'fatal'
        ? RED
        : level === 'warn'
          ? YELLOW
          : level === 'debug' || level === 'trace'
            ? MAGENTA
            : BLUE

    writeLog(color, message, pickErrorPayload(payload), bindings)
    return
  }

  if (payload) {
    const color = level === 'error' || level === 'fatal' ? RED : BLUE
    writeLog(color, level, pickErrorPayload(payload), bindings)
  }
}

function createLogger(bindings: LogBindings = {}) {
  return {
    level: 'info',
    silent(..._args: unknown[]) {},
    child(childBindings: LogBindings = {}) {
      return createLogger({
        ...bindings,
        ...childBindings,
      })
    },
    info(...args: unknown[]) {
      emit('info', bindings, args)
    },
    warn(...args: unknown[]) {
      emit('warn', bindings, args)
    },
    error(...args: unknown[]) {
      emit('error', bindings, args)
    },
    debug(...args: unknown[]) {
      emit('debug', bindings, args)
    },
    trace(...args: unknown[]) {
      emit('trace', bindings, args)
    },
    fatal(...args: unknown[]) {
      emit('fatal', bindings, args)
    },
  }
}

export function createAppLogger() {
  return createLogger() as FastifyBaseLogger
}
