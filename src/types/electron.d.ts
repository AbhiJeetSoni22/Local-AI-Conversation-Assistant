export interface AppStatus {
  status: string
  platform: string
  version: string
}

export interface ElectronApi {
  getStatus: () => Promise<AppStatus>
  platform: string
}

declare global {
  interface Window {
    electronApi?: ElectronApi
  }
}
