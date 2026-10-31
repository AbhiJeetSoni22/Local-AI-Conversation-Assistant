import {
  getOllamaConfig,
  checkOllamaHealth,
  OllamaConfig,
  OllamaReadiness,
} from './ollamaConfig'
import { buildAnswerPrompt } from './promptBuilder'

export interface GenerationResult {
  fullText: string
  durationMs: number
  model: string
  isCancelled?: boolean
}

export class OllamaService {
  private config: OllamaConfig
  private activeAbortController: AbortController | null = null
  private _isGenerating = false

  constructor(customConfig?: Partial<OllamaConfig>) {
    this.config = getOllamaConfig(customConfig)
    this.registerExitHandlers()
  }

  private registerExitHandlers(): void {
    const cleanup = () => {
      this.dispose()
    }
    process.once('exit', cleanup)
    process.once('SIGINT', cleanup)
    process.once('SIGTERM', cleanup)
  }

  public getConfig(): OllamaConfig {
    return { ...this.config }
  }

  public isGenerating(): boolean {
    return this._isGenerating
  }

  /**
   * Queries Ollama daemon health and model availability.
   */
  public async getReadiness(): Promise<OllamaReadiness> {
    return await checkOllamaHealth(this.config)
  }

  /**
   * Cancels any active generation request immediately.
   */
  public cancel(): void {
    if (this.activeAbortController) {
      try {
        this.activeAbortController.abort()
      } catch {
        // ignore
      }
      this.activeAbortController = null
    }
    this._isGenerating = false
  }

  /**
   * Generates a streaming response from the local Ollama instance
   * based on the provided conversation transcript.
   *
   * @param transcript Untrusted conversation text
   * @param onChunk Callback invoked progressively as tokens arrive
   */
  public async generateStreaming(
    transcript: string,
    onChunk: (chunk: string) => void
  ): Promise<GenerationResult> {
    if (this._isGenerating) {
      throw new Error('A generation request is already in progress. Please wait or cancel the current request.')
    }

    // 1. Build and validate prompt synchronously
    const prompt = buildAnswerPrompt(transcript)

    // Mark as generating immediately to lock out concurrent calls
    this._isGenerating = true
    const abortController = new AbortController()
    this.activeAbortController = abortController
    const startTime = Date.now()

    let timeout: NodeJS.Timeout | null = null
    let fullText = ''

    try {
      // 2. Check environment readiness before starting stream
      const readiness = await this.getReadiness()
      if (!readiness.ready) {
        throw new Error(readiness.error || 'Ollama is not ready for generation.')
      }

      // Safety timeout
      timeout = setTimeout(() => {
        abortController.abort(new Error(`Ollama generation timed out after ${this.config.timeoutMs}ms.`))
      }, this.config.timeoutMs)

      const payload = {
        model: this.config.model,
        messages: [
          { role: 'system', content: prompt.systemPrompt },
          { role: 'user', content: prompt.userPrompt },
        ],
        stream: true,
        options: {
          temperature: this.config.temperature,
        },
      }

      const response = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      })

      if (timeout) clearTimeout(timeout)

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(`Ollama API responded with HTTP ${response.status}: ${errorText}`)
      }

      if (!response.body) {
        throw new Error('Ollama response body is empty or null.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let streamBuffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        streamBuffer += decoder.decode(value, { stream: true })
        const lines = streamBuffer.split('\n')
        // Preserve incomplete tail for next iteration
        streamBuffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          try {
            const parsed = JSON.parse(trimmed) as {
              message?: { content?: string }
              response?: string
              done?: boolean
              error?: string
            }

            if (parsed.error) {
              throw new Error(`Ollama stream error: ${parsed.error}`)
            }

            const token = parsed.message?.content ?? parsed.response ?? ''
            if (token) {
              fullText += token
              onChunk(token)
            }
          } catch (err) {
            if (err instanceof Error && err.message.startsWith('Ollama stream error:')) {
              throw err
            }
            // Malformed chunk line: continue or throw
            throw new Error(`Malformed stream chunk received from Ollama: ${trimmed}`)
          }
        }
      }

      const durationMs = Date.now() - startTime

      if (!fullText.trim()) {
        throw new Error('Ollama generation finished but returned an empty response.')
      }

      return {
        fullText: fullText.trim(),
        durationMs,
        model: this.config.model,
        isCancelled: false,
      }
    } catch (err: unknown) {
      if (timeout) clearTimeout(timeout)
      const isAbort =
        (err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'))) ||
        abortController.signal.aborted

      if (isAbort) {
        return {
          fullText: fullText.trim(),
          durationMs: Date.now() - startTime,
          model: this.config.model,
          isCancelled: true,
        }
      }

      throw err
    } finally {
      if (timeout) clearTimeout(timeout)
      this._isGenerating = false
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null
      }
    }
  }

  public dispose(): void {
    this.cancel()
  }
}

export const ollamaService = new OllamaService()
