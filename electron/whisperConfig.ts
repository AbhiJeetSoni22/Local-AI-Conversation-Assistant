import fs from 'node:fs'
import path from 'node:path'
import { buildInitialPrompt } from './vocabularyConfig'

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
 * In packaged Electron apps, resources are resolved from process.resourcesPath.
 * In development, resources are resolved from the repository root.
 *
 * Paths can be overridden via environment variables:
 * - WHISPER_BIN_PATH / WHISPER_PATH: Path to whisper-cli.exe or whisper-server.exe
 * - WHISPER_MODEL_PATH: Path to the ggml model file (e.g. ggml-base.en.bin)
 * - WHISPER_ENGINE: 'cli' or 'server' (default: 'cli')
 * - WHISPER_PORT: Port for whisper-server (default: 8080)
 */
export function getWhisperConfig(overrides?: Partial<WhisperConfig>): WhisperConfig {
  const rootDir = getProjectRootDir()
  const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath

  // In packaged electron apps, extraResources land in process.resourcesPath.
  // In development and standalone script runners, they are in the project root directory.
  const candidateBinDirs = [
    resourcesPath ? path.join(resourcesPath, 'bin') : null,
    path.join(rootDir, 'bin'),
    path.join(process.cwd(), 'bin'),
  ].filter((d): d is string => Boolean(d && fs.existsSync(d)))

  const candidateModelDirs = [
    resourcesPath ? path.join(resourcesPath, 'models') : null,
    path.join(rootDir, 'models'),
    path.join(process.cwd(), 'models'),
  ].filter((d): d is string => Boolean(d && fs.existsSync(d)))

  // Resolve executable path
  let binPath = process.env.WHISPER_BIN_PATH || process.env.WHISPER_PATH || overrides?.binPath
  if (!binPath) {
    for (const dir of candidateBinDirs) {
      const cliCandidate = path.join(dir, 'whisper-cli.exe')
      if (fs.existsSync(cliCandidate)) {
        binPath = cliCandidate
        break
      }
      const srvCandidate = path.join(dir, 'whisper-server.exe')
      if (fs.existsSync(srvCandidate)) {
        binPath = srvCandidate
        break
      }
    }
    if (!binPath) {
      const primaryBinDir = candidateBinDirs[0] || (resourcesPath ? path.join(resourcesPath, 'bin') : path.join(rootDir, 'bin'))
      binPath = path.join(primaryBinDir, 'whisper-cli.exe')
    }
  }

  // Resolve model path
  let modelPath = process.env.WHISPER_MODEL_PATH || overrides?.modelPath
  if (!modelPath) {
    for (const dir of candidateModelDirs) {
      const defaultModelCandidate = path.join(dir, 'ggml-base.en.bin')
      if (fs.existsSync(defaultModelCandidate)) {
        modelPath = defaultModelCandidate
        break
      }
      try {
        const binFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.bin'))
        if (binFiles.length > 0) {
          modelPath = path.join(dir, binFiles[0])
          break
        }
      } catch {
        // ignore
      }
    }
    if (!modelPath) {
      const primaryModelDir = candidateModelDirs[0] || (resourcesPath ? path.join(resourcesPath, 'models') : path.join(rootDir, 'models'))
      modelPath = path.join(primaryModelDir, 'ggml-base.en.bin')
    }
  }

  // Determine engine: if binary filename contains 'server', default to server mode unless overridden
  let defaultEngine: 'cli' | 'server' = 'cli'
  if (path.basename(binPath).toLowerCase().includes('server')) {
    defaultEngine = 'server'
  }
  const engine = (process.env.WHISPER_ENGINE as 'cli' | 'server') || overrides?.engine || defaultEngine

  const serverHost = overrides?.serverHost || process.env.WHISPER_HOST || '127.0.0.1'
  const serverPort = overrides?.serverPort || (process.env.WHISPER_PORT ? parseInt(process.env.WHISPER_PORT, 10) : 8080)
  const threads = overrides?.threads || 4

  // Initial prompt policy: OFF by default. An explicit override / WHISPER_INITIAL_PROMPT wins;
  // the curated technical-vocabulary prompt is opt-in via WHISPER_USE_VOCAB_PROMPT=1 (see
  // vocabularyConfig.ts and `npm run diagnose:whisper` for how to measure whether it helps).
  let initialPrompt: string
  if (overrides?.initialPrompt !== undefined) {
    initialPrompt = overrides.initialPrompt
  } else if (process.env.WHISPER_INITIAL_PROMPT && process.env.WHISPER_INITIAL_PROMPT.trim()) {
    initialPrompt = process.env.WHISPER_INITIAL_PROMPT.trim()
  } else if (process.env.WHISPER_USE_VOCAB_PROMPT === '1' || process.env.WHISPER_USE_VOCAB_PROMPT === 'true') {
    initialPrompt = buildInitialPrompt()
  } else {
    initialPrompt = ''
  }

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
 * Builds the exact whisper-cli argument vector for one chunk. Pure and unit-tested.
 *
 * Baseline (verified against whisper.cpp examples/cli/cli.cpp): -m model, -f wav, -oj (JSON),
 * -of prefix, -t threads, -np (no prints) [+ --prompt when an initial prompt is configured].
 * Decoding flags (-sns, -nf, -nth, -mc, -et, -lpt ...) are deliberately NOT passed: a previous
 * iteration combined -sns with -nf and was reported to cause runaway repetition on weak audio, so
 * decoder defaults (temperature fallback ON, no-speech threshold 0.6, entropy threshold 2.4,
 * log-prob threshold -1.0) are left untouched until a controlled A/B shows a benefit.
 */
export function buildWhisperCliArgs(
  config: Pick<WhisperConfig, 'modelPath' | 'threads' | 'initialPrompt'>,
  audioFilePath: string,
  outputPrefix: string
): string[] {
  const args = [
    '-m', config.modelPath,
    '-f', audioFilePath,
    '-oj', // Output JSON
    '-of', outputPrefix,
    '-t', String(config.threads),
    '-np', // Do not print anything other than results
  ]
  if (config.initialPrompt && config.initialPrompt.trim()) {
    args.push('--prompt', config.initialPrompt.trim())
  }
  return args
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
