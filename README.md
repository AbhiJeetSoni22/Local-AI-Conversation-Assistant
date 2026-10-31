# Local AI Conversation Assistant (Windows)

A desktop conversational assistant prototype built with **Electron**, **React**, **TypeScript**, and **Vite**, designed for local-first AI processing on Windows.

## Overview

The Local AI Conversation Assistant provides real-time meeting and conversation assistance with 100% local processing. In later phases, speech-to-text will be processed locally via `whisper.cpp`, and intelligent suggestions will be generated using a local `Ollama` LLM instance.

---

## Current Scope: Phase 1 Desktop Scaffold

This repository currently implements **Phase 1 only**:
- Desktop application scaffold using Electron + React + TypeScript + Vite.
- Secure Electron process separation (`contextIsolation: true`, `nodeIntegration: false`, typed `contextBridge`).
- Basic desktop UI layout featuring:
  - Header with app name and real-time UI status indicator (`Idle`, `Listening`, `Stopped`).
  - Action controls (`Start`, `Stop`, `Suggest Answer`).
  - Live Transcript panel with empty-state explaining future speech-to-text.
  - AI Suggested Answer panel with empty-state and temporary placeholder behavior.
- Clean UI state model enforcing valid button states (e.g., `Stop` disabled when `Idle`).

> **Important Boundary Notice**:
> Microphone capture, audio chunking, `whisper.cpp` speech recognition, `Ollama` LLM integration, and model downloads are **NOT** included in Phase 1. All UI interactions currently demonstrate scaffold state transitions only.

---

## Prerequisites

- **Node.js**: v20 or v22 LTS (tested on Node v22)
- **npm**: v10+
- **OS**: Windows 10/11 (Windows-first target)

---

## Installation

Clone the repository and install dependencies:

```bash
npm install
```

---

## Running in Development

To launch the desktop application in development mode with hot module replacement:

```bash
npm run dev
```

This starts the Vite development server and launches the Electron desktop window.

---

## Building for Production

To perform TypeScript verification and compile production bundles:

```bash
npm run build
```

This compiles:
- React renderer bundle to `dist/`
- Electron main and preload scripts to `dist-electron/`

---

## Architecture & Security Defaults

- **Process Isolation**: The renderer runs in a sandboxed context without direct Node.js access.
- **IPC Communication**: Uses typed `ipcMain.handle` / `contextBridge.exposeInMainWorld` patterns.
- **Future Integration Points**:
  - Electron main process will manage future background workers for `whisper.cpp` and local `Ollama` API requests.
