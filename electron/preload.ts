import { contextBridge, ipcRenderer } from 'electron'

// Minimal, typed API exposed to the renderer process via contextBridge.
// Security: contextIsolation is enabled and Node.js APIs are NOT exposed directly.
const electronApi = {
  getStatus: () => ipcRenderer.invoke('app:get-status'),
  getWhisperReadiness: () => ipcRenderer.invoke('whisper:get-readiness'),
  validateWhisper: () => ipcRenderer.invoke('whisper:validate'),
  platform: process.platform,
}

contextBridge.exposeInMainWorld('electronApi', electronApi)

export type ElectronApi = typeof electronApi
