import fs from 'node:fs'
import path from 'node:path'

export interface WhisperConfig {
  binPath: string
  modelPath: string
  engine: 'cli' | 'server'
  serverHost: string
  serverPort: number
  threads: number
  initialPrompt?: string
}

export interface WhisperEnvValidation {
  valid: boolean
  executableFound: boolean
  modelFound: boolean
  executablePath: string
  modelPath: string
  engine: 'cli' | 'server'
  error?: string
}

/**
 * Resolves the root directory of the application cleanly across
 * both development (process.cwd()) and built production modes.
 */
export function getProjectRootDir(): string {
  if (process.env.APP_ROOT) {
    return process.env.APP_ROOT
  }
  return process.cwd()
}

/**
 * Resolves Whisper configuration following standard project conventions.
 * Paths can be overridden via environment variables:
 * - WHISPER_BIN_PATH / WHISPER_PATH: Path to whisper-cli.exe or whisper-server.exe
 * - WHISPER_MODEL_PATH: Path to the ggml model file (e.g. ggml-base.en.bin)
 * - WHISPER_ENGINE: 'cli' or 'server' (default: 'cli')
 * - WHISPER_PORT: Port for whisper-server (default: 8080)
 */
export function getWhisperConfig(overrides?: Partial<WhisperConfig>): WhisperConfig {
  const rootDir = getProjectRootDir()

  const defaultCli = path.join(rootDir, 'bin', 'whisper-cli.exe')
  const defaultServer = path.join(rootDir, 'bin', 'whisper-server.exe')
  const defaultModel = path.join(rootDir, 'models', 'ggml-base.en.bin')

  // Resolve executable path
  let binPath = process.env.WHISPER_BIN_PATH || process.env.WHISPER_PATH || overrides?.binPath
  if (!binPath) {
    if (fs.existsSync(defaultCli)) {
      binPath = defaultCli
    } else if (fs.existsSync(defaultServer)) {
      binPath = defaultServer
    } else {
      binPath = defaultCli
    }
  }

  // Resolve model path
  const modelPath = process.env.WHISPER_MODEL_PATH || overrides?.modelPath || defaultModel

  // Determine engine: if binary filename contains 'server', default to server mode unless overridden
  let defaultEngine: 'cli' | 'server' = 'cli'
  if (path.basename(binPath).toLowerCase().includes('server')) {
    defaultEngine = 'server'
  }
  const engine = (process.env.WHISPER_ENGINE as 'cli' | 'server') || overrides?.engine || defaultEngine

  const serverHost = overrides?.serverHost || process.env.WHISPER_HOST || '127.0.0.1'
  const serverPort = overrides?.serverPort || (process.env.WHISPER_PORT ? parseInt(process.env.WHISPER_PORT, 10) : 8080)
  const threads = overrides?.threads || 4

  const initialPrompt = overrides?.initialPrompt !== undefined
    ? overrides.initialPrompt
    : (process.env.WHISPER_INITIAL_PROMPT || '')

  return {
    binPath: path.resolve(binPath),
    modelPath: path.resolve(modelPath),
    engine,
    serverHost,
    serverPort,
    threads,
    initialPrompt,
  }
}

/**
 * Validates the Whisper executable and model files without attempting inference.
 * Provides clear, actionable error messages if requirements are missing.
 */
export function validateWhisperEnvironment(customConfig?: WhisperConfig): WhisperEnvValidation {
  const config = customConfig || getWhisperConfig()

  let executableFound = false
  let modelFound = false
  const missingParts: string[] = []

  // Validate executable
  if (fs.existsSync(config.binPath)) {
    try {
      const stat = fs.statSync(config.binPath)
      if (stat.isFile() && stat.size > 0) {
        executableFound = true
      } else {
        missingParts.push(`Executable at "${config.binPath}" is empty or not a valid file.`)
      }
    } catch (err) {
      missingParts.push(`Cannot access executable at "${config.binPath}": ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    missingParts.push(
      `Whisper executable not found at "${config.binPath}". Please place whisper-cli.exe in the bin/ directory or set WHISPER_BIN_PATH.`
    )
  }

  // Validate model
  const MIN_MODEL_SIZE_BYTES = 10 * 1024 * 1024 // Models like ggml-base.en.bin are ~147MB; minimal sanity check > 10MB
  if (fs.existsSync(config.modelPath)) {
    try {
      const stat = fs.statSync(config.modelPath)
      if (stat.isFile()) {
        if (stat.size < MIN_MODEL_SIZE_BYTES) {
          missingParts.push(
            `Model file at "${config.modelPath}" is unexpectedly small (${(stat.size / 1024 / 1024).toFixed(1)} MB). It may be incomplete or corrupted.`
          )
        } else {
          modelFound = true
        }
      } else {
        missingParts.push(`Model path at "${config.modelPath}" is not a file.`)
      }
    } catch (err) {
      missingParts.push(`Cannot access model at "${config.modelPath}": ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    missingParts.push(
      `Whisper model not found at "${config.modelPath}". Please place ggml-base.en.bin in the models/ directory or set WHISPER_MODEL_PATH.`
    )
  }

  const valid = executableFound && modelFound
  const error = valid ? undefined : missingParts.join(' ')

  return {
    valid,
    executableFound,
    modelFound,
    executablePath: config.binPath,
    modelPath: config.modelPath,
    engine: config.engine,
    error,
  }
}

