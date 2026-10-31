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

export interface ElectronApi {
  getStatus: () => Promise<AppStatus>
  getWhisperReadiness: () => Promise<WhisperReadiness>
  validateWhisper: () => Promise<WhisperReadiness>
  platform: string
}

declare global {
  interface Window {
    electronApi?: ElectronApi
  }
}
