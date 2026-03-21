import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentFile = fileURLToPath(import.meta.url)
const currentDir = path.dirname(currentFile)
const projectRoot = path.resolve(currentDir, '..')
const sourceEnvPath = path.resolve(projectRoot, '.env')
const targetEnvPath = path.resolve(projectRoot, 'dist/.env')

if (fs.existsSync(sourceEnvPath)) {
  fs.copyFileSync(sourceEnvPath, targetEnvPath)
}
