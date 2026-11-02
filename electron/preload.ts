import { contextBridge, ipcRenderer } from 'electron'

// Minimal, typed API exposed to the renderer process via contextBridge.
// Security: contextIsolation is enabled and Node.js APIs are NOT exposed directly.
const electronApi = {
  // App
  getStatus: () => ipcRenderer.invoke('app:get-status'),
  platform: process.platform,

  // Whisper (Phase 2 & Phase 4)
  getWhisperReadiness: () => ipcRenderer.invoke('whisper:get-readiness'),
  validateWhisper: () => ipcRenderer.invoke('whisper:validate'),
  transcribeAudioChunk: (data: {
    audioBuffer: Uint8Array | ArrayBuffer
    sessionId: string
    chunkIndex: number
    isFinal?: boolean
    initialPrompt?: string
  }) => ipcRenderer.invoke('whisper:transcribe-chunk', data),
  getTechnicalPrompt: () => ipcRenderer.invoke('whisper:get-technical-prompt'),

  // Ollama (Phase 3)
  getOllamaReadiness: () => ipcRenderer.invoke('ollama:get-readiness'),
  startAnswerGeneration: (transcript: string) =>
    ipcRenderer.invoke('ollama:start-generation', { transcript }),
  cancelAnswerGeneration: () =>
    ipcRenderer.invoke('ollama:cancel-generation'),

  // Streaming Event Listeners (returns unsubscribe cleanup function)
  onOllamaChunk: (callback: (data: { chunk: string }) => void) => {
    const listener = (_event: unknown, data: { chunk: string }) => callback(data)
    ipcRenderer.on('ollama:stream-chunk', listener)
    return () => {
      ipcRenderer.removeListener('ollama:stream-chunk', listener)
    }
  },
  onOllamaDone: (callback: (data: { fullText: string; durationMs: number; model: string }) => void) => {
    const listener = (_event: unknown, data: { fullText: string; durationMs: number; model: string }) =>
      callback(data)
    ipcRenderer.on('ollama:stream-done', listener)
    return () => {
      ipcRenderer.removeListener('ollama:stream-done', listener)
    }
  },
  onOllamaError: (callback: (data: { error: string }) => void) => {
    const listener = (_event: unknown, data: { error: string }) => callback(data)
    ipcRenderer.on('ollama:stream-error', listener)
    return () => {
      ipcRenderer.removeListener('ollama:stream-error', listener)
    }
  },
  onOllamaCancelled: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('ollama:stream-cancelled', listener)
    return () => {
      ipcRenderer.removeListener('ollama:stream-cancelled', listener)
    }
  },
}

contextBridge.exposeInMainWorld('electronApi', electronApi)

export type ElectronApi = typeof electronApi
