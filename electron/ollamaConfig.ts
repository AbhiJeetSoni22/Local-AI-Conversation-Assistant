export interface OllamaConfig {
  baseUrl: string
  model: string
  timeoutMs: number
  temperature: number
}

export interface OllamaReadiness {
  ready: boolean
  status: 'Ready' | 'Unavailable' | 'Checking'
  serviceReachable: boolean
  modelAvailable: boolean
  baseUrl: string
  model: string
  version?: string
  availableModels: string[]
  error?: string
}

/**
 * Returns Ollama configuration with project-level defaults and environment variable overrides.
 *
 * Supported environment variables:
 * - OLLAMA_HOST / OLLAMA_BASE_URL: Base URL for Ollama daemon (default: http://127.0.0.1:11434)
 * - OLLAMA_MODEL: Target model identifier (default: qwen2.5:3b)
 * - OLLAMA_TIMEOUT_MS: Generation and probe timeout in ms (default: 60000)
 */
export function getOllamaConfig(overrides?: Partial<OllamaConfig>): OllamaConfig {
  const envHost = process.env.OLLAMA_HOST || process.env.OLLAMA_BASE_URL
  const baseUrl = (overrides?.baseUrl || envHost || 'http://127.0.0.1:11434').replace(/\/+$/, '')
  const model = overrides?.model || process.env.OLLAMA_MODEL || 'qwen2.5:3b'
  const timeoutMs = overrides?.timeoutMs || (process.env.OLLAMA_TIMEOUT_MS ? parseInt(process.env.OLLAMA_TIMEOUT_MS, 10) : 60000)
  const temperature = overrides?.temperature ?? 0.7

  return {
    baseUrl,
    model,
    timeoutMs,
    temperature,
  }
}

/**
 * Non-destructive probe verifying whether the Ollama daemon is reachable
 * and whether the target model is installed.
 */
export async function checkOllamaHealth(customConfig?: OllamaConfig): Promise<OllamaReadiness> {
  const config = customConfig || getOllamaConfig()

  const result: OllamaReadiness = {
    ready: false,
    status: 'Unavailable',
    serviceReachable: false,
    modelAvailable: false,
    baseUrl: config.baseUrl,
    model: config.model,
    availableModels: [],
  }

  // Probe 1: Check version / reachability
  const probeController = new AbortController()
  const probeTimer = setTimeout(() => probeController.abort(), 3000)

  let version: string | undefined
  try {
    const versionRes = await fetch(`${config.baseUrl}/api/version`, {
      method: 'GET',
      signal: probeController.signal,
    })

    if (!versionRes.ok) {
      result.error = `Ollama service responded with HTTP ${versionRes.status} on /api/version.`
      return result
    }

    const versionData = (await versionRes.json()) as { version?: string }
    version = versionData.version
    result.serviceReachable = true
    result.version = version
  } catch (err: unknown) {
    clearTimeout(probeTimer)
    const detail = err instanceof Error && err.name === 'AbortError'
      ? 'Connection timed out after 3000ms'
      : err instanceof Error
        ? err.message
        : String(err)
    result.error = `Ollama service unreachable at ${config.baseUrl} (${detail}). Ensure Ollama is installed and running.`
    return result
  } finally {
    clearTimeout(probeTimer)
  }

  // Probe 2: Check installed models via /api/tags
  const tagsController = new AbortController()
  const tagsTimer = setTimeout(() => tagsController.abort(), 4000)

  try {
    const tagsRes = await fetch(`${config.baseUrl}/api/tags`, {
      method: 'GET',
      signal: tagsController.signal,
    })

    if (!tagsRes.ok) {
      result.error = `Failed to list installed models: Ollama responded with HTTP ${tagsRes.status}.`
      return result
    }

    const tagsData = (await tagsRes.json()) as { models?: Array<{ name?: string }> }
    const modelNames = Array.isArray(tagsData.models)
      ? tagsData.models.map((m) => m.name || '').filter(Boolean)
      : []

    result.availableModels = modelNames

    // Target model matching (e.g. "qwen2.5:3b" or "qwen2.5:3b-instruct" or prefix match)
    const targetBase = config.model.toLowerCase()
    const targetPrefix = targetBase.split(':')[0]
    const matched = modelNames.some((m) => {
      const lower = m.toLowerCase()
      return lower === targetBase || lower === `${targetBase}-instruct` || (lower.startsWith(targetPrefix) && lower.includes('3b'))
    })

    if (matched) {
      result.modelAvailable = true
      result.ready = true
      result.status = 'Ready'
      result.error = undefined
    } else {
      result.modelAvailable = false
      result.error = `Model "${config.model}" is not installed in Ollama. Run: ollama pull ${config.model}`
    }

    return result
  } catch (err: unknown) {
    clearTimeout(tagsTimer)
    result.error = `Failed to query Ollama models: ${err instanceof Error ? err.message : String(err)}`
    return result
  } finally {
    clearTimeout(tagsTimer)
  }
}

