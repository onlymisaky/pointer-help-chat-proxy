import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'dotenv'

type EnvMap = Record<string, string>
type HeaderMap = Record<string, string>

const currentFile = fileURLToPath(import.meta.url)
const currentDir = path.dirname(currentFile)
const moduleRoot = path.resolve(currentDir, '..')
const projectRoot = path.resolve(moduleRoot, '..')
const runtimeEnvPath = path.resolve(moduleRoot, '.env')
const rootEnvPath = path.resolve(projectRoot, '.env')

function readEnvFile(filePath: string): EnvMap {
  if (!fs.existsSync(filePath)) {
    return {}
  }

  return parse(fs.readFileSync(filePath, 'utf8'))
}

function resolveEnvMap() {
  if (path.basename(moduleRoot) === 'dist') {
    const runtimeEnv = readEnvFile(runtimeEnvPath)
    if (Object.keys(runtimeEnv).length > 0) {
      return runtimeEnv
    }
  }

  return readEnvFile(rootEnvPath)
}

function normalizeHeaders(value: unknown): HeaderMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, headerValue]) => headerValue != null)
      .map(([key, headerValue]) => [key, String(headerValue)]),
  )
}

function parseHeadersValue(value: string | undefined) {
  if (!value) {
    return {}
  }

  try {
    return normalizeHeaders(JSON.parse(value))
  }
  catch {
    return {}
  }
}

export function loadProxyHeaders() {
  const env = resolveEnvMap()
  return parseHeadersValue(env.headers ?? env.header)
}
