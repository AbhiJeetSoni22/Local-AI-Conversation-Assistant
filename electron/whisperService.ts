import { spawn, ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  getWhisperConfig,
  validateWhisperEnvironment,
  WhisperConfig,
  WhisperEnvValidation,
} from './whisperConfig'
import { validateWavFile, validateWavBuffer } from './wavValidator'
import { filterWhisperMarkers } from './vocabularyConfig'

export { filterWhisperMarkers } from './vocabularyConfig'

export interface TranscriptionResult {
  text: string
  durationMs: number
  isSilent?: boolean
  modelUsed: string
  engine: 'cli' | 'server'
}

export interface WhisperReadiness extends WhisperEnvValidation {
  status: 'Ready' | 'Unavailable' | 'Checking'
}

export class WhisperService {
  private config: WhisperConfig
  private serverProcess: ChildProcess | null = null
  private activeCliProcess: ChildProcess | null = null
  private isServerReady = false

  constructor(customConfig?: Partial<WhisperConfig>) {
    this.config = getWhisperConfig(customConfig)
    this.registerExitHandlers()
  }

  /**
   * Registers process cleanup handlers to guarantee no child processes are orphaned.
   */
  private registerExitHandlers(): void {
    const cleanup = () => {
      this.dispose()
    }
    process.once('exit', cleanup)
    process.once('SIGINT', cleanup)
    process.once('SIGTERM', cleanup)
  }

  /**
   * Returns current configuration.
   */
  public getConfig(): WhisperConfig {
    return { ...this.config }
  }

  /**
   * Checks whether the runtime and model are ready.
   */
  public async getReadiness(): Promise<WhisperReadiness> {
    const env = validateWhisperEnvironment(this.config)
    if (!env.valid) {
      return {
        ...env,
        status: 'Unavailable',
      }
    }

    if (this.config.engine === 'server') {
      if (!this.serverProcess) {
        // In server mode, check if we can connect or need to spin it up
        const alive = await this.pingServer(this.config.serverHost, this.config.serverPort)
        if (alive) {
          this.isServerReady = true
          return { ...env, status: 'Ready' }
        }
      } else if (this.isServerReady) {
        return { ...env, status: 'Ready' }
      }
      return {
        ...env,
        status: this.isServerReady ? 'Ready' : 'Unavailable',
        error: this.isServerReady ? undefined : 'Whisper server is not running or not responding.',
      }
    }

    // CLI mode is ready as long as executable and model exist and are valid
    return {
      ...env,
      status: 'Ready',
    }
  }

  /**
   * Starts whisper-server if running in server mode.
   */
  public async startServer(timeoutMs = 15000): Promise<void> {
    if (this.serverProcess) {
      if (this.isServerReady) return
      this.stopServer()
    }

    const env = validateWhisperEnvironment(this.config)
    if (!env.valid) {
      throw new Error(`Cannot start Whisper server: ${env.error}`)
    }

    const portOccupied = await this.pingServer(this.config.serverHost, this.config.serverPort)
    if (portOccupied) {
      throw new Error(
        `Port ${this.config.serverPort} is already in use on ${this.config.serverHost}. Check for conflicting processes.`
      )
    }

    const args = [
      '-m', this.config.modelPath,
      '--host', this.config.serverHost,
      '--port', String(this.config.serverPort),
      '-t', String(this.config.threads),
    ]

    return new Promise((resolve, reject) => {
      let settled = false

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          this.stopServer()
          reject(new Error(`Whisper server startup timed out after ${timeoutMs}ms.`))
        }
      }, timeoutMs)

      try {
        const child = spawn(this.config.binPath, args, {
          cwd: path.dirname(this.config.binPath),
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })

        this.serverProcess = child

        child.on('error', (err) => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            this.serverProcess = null
            reject(new Error(`Failed to launch whisper-server executable: ${err.message}`))
          }
        })

        child.on('exit', (code, signal) => {
          this.isServerReady = false
          this.serverProcess = null
          if (!settled) {
            settled = true
            clearTimeout(timer)
            reject(new Error(`Whisper server exited unexpectedly with code ${code} / signal ${signal}`))
          }
        })

        // Poll readiness
        const pollInterval = setInterval(async () => {
          if (settled) {
            clearInterval(pollInterval)
            return
          }
          const ready = await this.pingServer(this.config.serverHost, this.config.serverPort)
          if (ready && !settled) {
            settled = true
            clearTimeout(timer)
            clearInterval(pollInterval)
            this.isServerReady = true
            resolve()
          }
        }, 500)
      } catch (err) {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(err)
        }
      }
    })
  }

  /**
   * Pings the HTTP server endpoint to check responsiveness.
   */
  private async pingServer(host: string, port: number): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 1000)
      const res = await fetch(`http://${host}:${port}/`, {
        method: 'GET',
        signal: controller.signal,
      })
      clearTimeout(timeout)
      return res.status >= 200 && res.status < 500
    } catch {
      return false
    }
  }

  /**
   * Transcribes a local WAV file or raw audio Buffer.
   */
  public async transcribe(
    audioInput: string | Buffer,
    options: { timeoutMs?: number } = {}
  ): Promise<TranscriptionResult> {
    const timeoutMs = options.timeoutMs ?? 30000

    // Step 1: Check environment readiness
    const env = validateWhisperEnvironment(this.config)
    if (!env.valid) {
      throw new Error(`Whisper cannot transcribe: ${env.error}`)
    }

    // Step 2: Validate input audio
    let audioFilePath: string
    let isTempFile = false

    if (typeof audioInput === 'string') {
      audioFilePath = audioInput
      const validation = validateWavFile(audioFilePath)
      if (!validation.valid) {
        throw new Error(`Audio validation failed: ${validation.error}`)
      }
      if (validation.isSilent) {
        return {
          text: '',
          durationMs: 0,
          isSilent: true,
          modelUsed: path.basename(this.config.modelPath),
          engine: this.config.engine,
        }
      }
    } else {
      const validation = validateWavBuffer(audioInput)
      if (!validation.valid) {
        throw new Error(`Audio validation failed: ${validation.error}`)
      }
      if (validation.isSilent) {
        return {
          text: '',
          durationMs: 0,
          isSilent: true,
          modelUsed: path.basename(this.config.modelPath),
          engine: this.config.engine,
        }
      }
      // Write buffer to temporary file for whisper.cpp consumption
      audioFilePath = path.join(os.tmpdir(), `whisper_in_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`)
      fs.writeFileSync(audioFilePath, audioInput)
      isTempFile = true
    }

    try {
      if (this.config.engine === 'server') {
        return await this.transcribeViaServer(audioFilePath, timeoutMs)
      } else {
        return await this.transcribeViaCli(audioFilePath, timeoutMs)
      }
    } finally {
      if (isTempFile && fs.existsSync(audioFilePath)) {
        try {
          fs.unlinkSync(audioFilePath)
        } catch {
          // Non-fatal cleanup
        }
      }
    }
  }

  /**
   * Transcribes via whisper-cli.exe invocation.
   */
  private async transcribeViaCli(
    audioFilePath: string,
    timeoutMs: number
  ): Promise<TranscriptionResult> {
    const startTime = Date.now()
    const tempOutputDir = os.tmpdir()
    const fileId = `whisper_out_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const outputPrefix = path.join(tempOutputDir, fileId)
    const expectedJsonFile = `${outputPrefix}.json`

    const args = [
      '-m', this.config.modelPath,
      '-f', audioFilePath,
      '-oj', // Output JSON
      '-of', outputPrefix,
      '-t', String(this.config.threads),
      '-np', // Do not print anything other than results
    ]

    if (this.config.initialPrompt && this.config.initialPrompt.trim()) {
      args.push('--prompt', this.config.initialPrompt.trim())
    }

    return new Promise((resolve, reject) => {
      let settled = false

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          if (this.activeCliProcess) {
            try {
              this.activeCliProcess.kill('SIGTERM')
            } catch {
              // ignore
            }
            this.activeCliProcess = null
          }
          this.cleanupFile(expectedJsonFile)
          reject(new Error(`Whisper transcription timed out after ${timeoutMs}ms.`))
        }
      }, timeoutMs)

      let stderrOutput = ''

      try {
        const child = spawn(this.config.binPath, args, {
          cwd: path.dirname(this.config.binPath),
          windowsHide: true,
        })
        this.activeCliProcess = child

        child.stderr?.on('data', (chunk) => {
          stderrOutput += chunk.toString()
        })

        child.on('error', (err) => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            this.activeCliProcess = null
            this.cleanupFile(expectedJsonFile)
            reject(new Error(`Failed to execute whisper-cli: ${err.message}`))
          }
        })

        child.on('exit', (code) => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            this.activeCliProcess = null
            const durationMs = Date.now() - startTime

            if (code !== 0) {
              this.cleanupFile(expectedJsonFile)
              return reject(
                new Error(`Whisper process exited with error code ${code}. Stderr: ${stderrOutput.trim()}`)
              )
            }

            try {
              if (!fs.existsSync(expectedJsonFile)) {
                return reject(new Error('Whisper completed but expected JSON output file was not created.'))
              }

              const rawJson = fs.readFileSync(expectedJsonFile, 'utf-8')
              this.cleanupFile(expectedJsonFile)

              const parsed = JSON.parse(rawJson)
              let rawText = ''

              if (Array.isArray(parsed.transcription)) {
                rawText = parsed.transcription
                  .map((t: { text?: string }) => (typeof t.text === 'string' ? t.text.trim() : ''))
                  .filter(Boolean)
                  .join(' ')
              } else if (typeof parsed.text === 'string') {
                rawText = parsed.text.trim()
              }

              const cleanedText = filterWhisperMarkers(rawText)

              if (process.env.DEBUG_AUDIO === '1' || process.env.NODE_ENV !== 'production') {
                console.log(
                  `[Whisper CLI] Transcribed in ${durationMs}ms: ` +
                  `raw="${rawText}" -> cleaned="${cleanedText}"`
                )
              }

              resolve({
                text: cleanedText,
                durationMs,
                isSilent: cleanedText.length === 0,
                modelUsed: path.basename(this.config.modelPath),
                engine: 'cli',
              })
            } catch (err) {
              this.cleanupFile(expectedJsonFile)
              reject(
                new Error(
                  `Failed to parse Whisper JSON output: ${err instanceof Error ? err.message : String(err)}`
                )
              )
            }
          }
        })
      } catch (err) {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          this.activeCliProcess = null
          this.cleanupFile(expectedJsonFile)
          reject(err)
        }
      }
    })
  }

  /**
   * Transcribes via whisper-server HTTP POST /inference.
   */
  private async transcribeViaServer(
    audioFilePath: string,
    timeoutMs: number
  ): Promise<TranscriptionResult> {
    const startTime = Date.now()
    const url = `http://${this.config.serverHost}:${this.config.serverPort}/inference`

    const fileBuffer = fs.readFileSync(audioFilePath)
    const formData = new FormData()
    formData.append('file', new Blob([fileBuffer], { type: 'audio/wav' }), 'audio.wav')
    formData.append('response_format', 'json')

    if (this.config.initialPrompt && this.config.initialPrompt.trim()) {
      formData.append('prompt', this.config.initialPrompt.trim())
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      clearTimeout(timer)

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '')
        throw new Error(`Whisper server responded with HTTP ${response.status}: ${errorBody}`)
      }

      const json = await response.json()
      const rawText = typeof json.text === 'string' ? json.text.trim() : ''
      const cleanedText = filterWhisperMarkers(rawText)

      if (process.env.DEBUG_AUDIO === '1' || process.env.NODE_ENV !== 'production') {
        console.log(
          `[Whisper Server] Transcribed in ${Date.now() - startTime}ms: ` +
          `raw="${rawText}" -> cleaned="${cleanedText}"`
        )
      }

      return {
        text: cleanedText,
        durationMs: Date.now() - startTime,
        isSilent: cleanedText.length === 0,
        modelUsed: path.basename(this.config.modelPath),
        engine: 'server',
      }
    } catch (err: unknown) {
      clearTimeout(timer)
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Whisper server request timed out after ${timeoutMs}ms.`)
      }
      throw err
    }
  }

  private cleanupFile(filePath: string): void {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath)
      } catch {
        // Non-fatal
      }
    }
  }

  /**
   * Gracefully stops any child server process started by this service.
   */
  public stopServer(): void {
    if (this.serverProcess) {
      try {
        this.serverProcess.kill('SIGTERM')
      } catch {
        // ignore
      }
      this.serverProcess = null
      this.isServerReady = false
    }
  }

  /**
   * Disposes all resources and terminates any child processes.
   */
  public dispose(): void {
    if (this.activeCliProcess) {
      try {
        this.activeCliProcess.kill('SIGTERM')
      } catch {
        // ignore
      }
      this.activeCliProcess = null
    }
    this.stopServer()
  }
}

// Export singleton instance for Electron main process
export const whisperService = new WhisperService()
