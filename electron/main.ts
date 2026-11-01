import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserWindow as BrowserWindowType } from 'electron'
import { whisperService } from './whisperService'
import { ollamaService } from './ollamaService'

const require = createRequire(import.meta.url)
const { app, BrowserWindow, ipcMain } = require('electron') as {
  app: typeof import('electron').app
  BrowserWindow: typeof BrowserWindowType
  ipcMain: typeof import('electron').ipcMain
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure:
// ├─┬ dist-electron
// │ ├── main.js
// │ └── preload.mjs
// ├─┬ dist
// │ └── index.html

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

let mainWindow: BrowserWindowType | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 720,
    minHeight: 520,
    title: 'Local AI Conversation Assistant',
    backgroundColor: '#0b0c0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      // Security enforcement:
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Disable default native menu for a modern app look
  mainWindow.setMenuBarVisibility(false)

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Minimal IPC handler: keep process management in Electron main process
ipcMain.handle('app:get-status', async () => {
  return {
    status: 'Scaffold active',
    platform: process.platform,
    version: app.getVersion(),
  }
})

// Phase 2 & 4 Whisper IPC handlers: typed readiness, validation, and chunk transcription
ipcMain.handle('whisper:get-readiness', async () => {
  return await whisperService.getReadiness()
})

ipcMain.handle('whisper:validate', async () => {
  return await whisperService.getReadiness()
})

ipcMain.handle('whisper:transcribe-chunk', async (_event, payload: {
  audioBuffer: Uint8Array | ArrayBuffer
  sessionId: string
  chunkIndex: number
  isFinal?: boolean
}) => {
  const { audioBuffer, sessionId, chunkIndex, isFinal } = payload || {}

  if (!audioBuffer) {
    return {
      text: '',
      durationMs: 0,
      isSilent: true,
      sessionId: sessionId || '',
      chunkIndex: chunkIndex ?? 0,
      isFinal: Boolean(isFinal),
      error: 'Audio buffer is missing or empty.',
    }
  }

  try {
    const buffer = Buffer.isBuffer(audioBuffer)
      ? audioBuffer
      : Buffer.from(audioBuffer as ArrayBuffer)

    const result = await whisperService.transcribe(buffer)
    return {
      text: result.text.trim(),
      durationMs: result.durationMs,
      isSilent: Boolean(result.isSilent),
      sessionId,
      chunkIndex,
      isFinal: Boolean(isFinal),
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      text: '',
      durationMs: 0,
      sessionId,
      chunkIndex,
      isFinal: Boolean(isFinal),
      error: message,
    }
  }
})

// Phase 3 Ollama IPC handlers: readiness, streaming generation, and cancellation
ipcMain.handle('ollama:get-readiness', async () => {
  return await ollamaService.getReadiness()
})

ipcMain.handle('ollama:start-generation', async (event, payload: { transcript: string }) => {
  const sender = event.sender
  const transcript = payload?.transcript || ''

  try {
    const result = await ollamaService.generateStreaming(transcript, (chunk) => {
      if (!sender.isDestroyed()) {
        sender.send('ollama:stream-chunk', { chunk })
      }
    })

    if (result.isCancelled) {
      if (!sender.isDestroyed()) {
        sender.send('ollama:stream-cancelled', {})
      }
      return { success: false, isCancelled: true }
    } else {
      if (!sender.isDestroyed()) {
        sender.send('ollama:stream-done', {
          fullText: result.fullText,
          durationMs: result.durationMs,
          model: result.model,
        })
      }
      return { success: true, isCancelled: false }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (!sender.isDestroyed()) {
      sender.send('ollama:stream-error', { error: message })
    }
    return { success: false, error: message }
  }
})

ipcMain.handle('ollama:cancel-generation', async () => {
  ollamaService.cancel()
  return { success: true }
})

app.whenReady().then(async () => {
  createWindow()

  if (process.env.TEST_LAUNCH === '1') {
    setTimeout(() => {
      console.log('TEST_LAUNCH_SUCCESS: Electron window initialized successfully')
      app.quit()
    }, 1500)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Ensure all child processes and active requests are cleaned up on shutdown
app.on('before-quit', () => {
  ollamaService.dispose()
  whisperService.dispose()
})

app.on('will-quit', () => {
  ollamaService.dispose()
  whisperService.dispose()
})

app.on('window-all-closed', () => {
  ollamaService.dispose()
  whisperService.dispose()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
