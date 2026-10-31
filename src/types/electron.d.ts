export interface AppStatus {
  status: string
  platform: string
  version: string
}

export interface WhisperReadiness {
  valid: boolean
  status: 'Ready' | 'Unavailable' | 'Checking'
  executableFound: boolean
  modelFound: boolean
  executablePath: string
  modelPath: string
  engine: 'cli' | 'server'
  error?: string
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

export interface ElectronApi {
  // App
  getStatus: () => Promise<AppStatus>
  platform: string

  // Whisper
  getWhisperReadiness: () => Promise<WhisperReadiness>
  validateWhisper: () => Promise<WhisperReadiness>

  // Ollama
  getOllamaReadiness: () => Promise<OllamaReadiness>
  startAnswerGeneration: (transcript: string) => Promise<{ success: boolean; isCancelled?: boolean; error?: string }>
  cancelAnswerGeneration: () => Promise<{ success: boolean }>

  // Ollama Streaming Listeners
  onOllamaChunk: (callback: (data: { chunk: string }) => void) => () => void
  onOllamaDone: (callback: (data: { fullText: string; durationMs: number; model: string }) => void) => () => void
  onOllamaError: (callback: (data: { error: string }) => void) => () => void
  onOllamaCancelled: (callback: () => void) => () => void
}

declare global {
  interface Window {
    electronApi?: ElectronApi
  }
}
