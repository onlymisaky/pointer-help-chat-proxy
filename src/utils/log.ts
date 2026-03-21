const RESET = '\x1B[0m'
const DIM = '\x1B[2m'
const BLUE = '\x1B[34m'
const CYAN = '\x1B[36m'
const GREEN = '\x1B[32m'
const MAGENTA = '\x1B[35m'

function formatTimestamp(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

function safeSerialize(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return JSON.stringify(
      {
        error: 'failed to serialize log payload',
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

function writeLog(color: string, label: string, value: unknown) {
  const timestamp = `${DIM}[${formatTimestamp()}]${RESET}`
  const title = `${color}${label}${RESET}`
  const body = indentBlock(safeSerialize(value))
  console.log(`${timestamp} ${title}\n${body}`)
}

export function logRequestBefore(value: unknown) {
  writeLog(BLUE, '↑请求 before', value)
}

export function logRequestAfter(value: unknown) {
  writeLog(CYAN, '↑请求 after', value)
}

export function logResponseBefore(value: unknown) {
  writeLog(MAGENTA, '↓响应 before', value)
}

export function logResponseAfter(value: unknown) {
  writeLog(GREEN, '↓响应 after', value)
}
