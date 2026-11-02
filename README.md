# Local AI Conversation Assistant (Windows)

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-33-47848F.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.3-61DAFB.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6.0-646CFF.svg)](https://vitejs.dev/)
[![whisper.cpp](https://img.shields.io/badge/whisper.cpp-v1.9.2-green.svg)](https://github.com/ggml-org/whisper.cpp)
[![Ollama](https://img.shields.io/badge/Ollama-Qwen%202.5%3A3b-orange.svg)](https://ollama.com)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011%20x64-0078D6.svg)](https://microsoft.com)

A production-ready desktop conversational assistant built with **Electron**, **React**, **TypeScript**, and **Vite**, engineered for **100% local-first, zero-cloud AI processing on Windows**.

---

## 📌 Implementation Status

| Stage / Phase | Focus | Status | Evidence |
| :--- | :--- | :---: | :--- |
| **Phase 1** | Electron + React + TypeScript Desktop Scaffold | ✅ `Verified` | Desktop window initializes cleanly under `TEST_LAUNCH=1`. |
| **Phase 2** | Whisper.cpp Local Speech-to-Text Foundation | ✅ `Verified` | Offline JFK transcription in 3.67s; 18/18 edge-case tests pass. |
| **Phase 3** | Ollama Local LLM & Streaming Suggestions | ✅ `Verified` | Local Ollama streaming answers, cancel support; 36/36 tests pass. |
| **Phase 4** | Microphone Audio Capture & Live Transcription | ✅ `Verified (Automated)` | Resampling, WAV encoding, queueing, and Whisper IPC; 22/22 tests pass. |
| **Phase 5** | End-to-End Stabilization & Error Recovery | ✅ `Verified` | Dynamic status re-check, transcript review & edit, retry flow, 7 UI states; 42/42 tests pass. |
| **Phase 6** | Packaging, Hardening & Windows Release | ✅ `Verified` | Production NSIS setup & Portable binaries generated with zero Rollup warnings; 262/262 total tests pass. |

---

## 📦 Windows Release Deliverables (Phase 6)

The application is distributed as both a standard Windows NSIS installer and a single-file portable executable. Both formats package the complete Whisper.cpp speech recognition runtime and `ggml-base.en.bin` speech model out of the box:

| Artifact Name | Distribution Format | File Size | Description |
| :--- | :---: | :---: | :--- |
| **`Local AI Conversation Assistant-Setup-0.1.0.exe`** | NSIS Installer | `~210.7 MB` (220,979,052 bytes) | Standard Windows installer wizard. Supports custom install directory, Desktop shortcut, and Start Menu registration. |
| **`Local AI Conversation Assistant-Portable-0.1.0.exe`** | Portable Executable | `~202.1 MB` (211,914,944 bytes) | Zero-installation standalone executable. Ideal for USB drives or restricted enterprise workstations without administrator rights. |
| **`release/win-unpacked`** | Directory Target | `~348 MB` | Unpacked production binary directory for direct execution and verification. |

> **Architectural Separation:**
> - **Whisper STT (~162 MB uncompressed):** Pre-bundled in `extraResources` and automatically resolved from `process.resourcesPath/bin` and `process.resourcesPath/models`. Speech recognition works out of the box without any initial setup or download steps.
> - **Ollama LLM (~3.5 GB):** Kept as an external prerequisite. Bundling a 3.5GB LLM runtime and weights into an installer would cause massive downloads and update friction. The application automatically probes `http://127.0.0.1:11434` and provides actionable in-app guidance if Ollama is offline or the model is missing.

---

## 💻 End-User Setup Guide (Windows)

### Hardware & Software Prerequisites
- **Operating System:** Windows 10 or Windows 11 (64-bit x64)
- **Processor:** Modern multi-core CPU (Intel Core i5/i7/i9 8th gen+ or AMD Ryzen 3000+)
- **System Memory:** Minimum 8 GB RAM (16 GB recommended for concurrent Whisper + Ollama inference)
- **Disk Space:**
  - Application + Whisper STT: ~350 MB free disk space
  - Ollama runtime + `qwen2.5:3b` model: ~3.5 GB free disk space
- **Audio:** Built-in microphone, USB headset, or external microphone

### First-Time Setup Instructions

1. **Install and Start Ollama:**
   - Download Ollama for Windows from official site: [https://ollama.com/download/OllamaSetup.exe](https://ollama.com/download/OllamaSetup.exe)
   - Run `OllamaSetup.exe` to complete installation.
   - Open PowerShell or Windows Terminal and pull the recommended conversation model:
     ```powershell
     ollama pull qwen2.5:3b
     ```
   - Ensure Ollama is running (it displays an icon in the Windows notification area / system tray).

2. **Install / Run the Assistant:**
   - **Using Installer:** Run `Local AI Conversation Assistant-Setup-0.1.0.exe` and follow the setup wizard.
   - **Using Portable:** Double-click `Local AI Conversation Assistant-Portable-0.1.0.exe` to run immediately without installation.

3. **First-Run Experience:**
   - Upon opening, the application automatically verifies local hardware and services:
     - **Whisper Badge:** Shows `Whisper: Ready` immediately.
     - **Ollama Badge:** Shows `Ollama: Ready (qwen2.5:3b)` if Ollama is running.
   - **If Ollama is not running:** The app displays an amber/red warning card explaining that the local Ollama daemon is offline, with the exact command to pull the model and a one-click **"Re-check Ollama"** button.
   - Click **Start** to begin capturing microphone audio.
   - Speak naturally into your microphone. Transcribed text will appear in the **Conversation Transcript** panel.
   - Click **Stop** when finished speaking.
   - *(Optional)* Click **Edit** to correct any technical terms, proper nouns, or punctuation in the transcript, then click **Done**.
   - Click **Suggest Answer** to stream a contextually grounded response from local Ollama.

---

## 🛠 Developer Quickstart & Build Instructions

### 1. Repository Setup
```powershell
git clone https://github.com/AbhiJeetSoni22/Local-AI-Conversation-Assistant.git
cd Local-AI-Conversation-Assistant
npm install
```

### 2. Running in Development
```powershell
npm run dev
```

### 3. Packaging Release Binaries
```powershell
# Build both NSIS installer and Portable executable
npm run dist

# Build NSIS installer only
npm run dist:nsis

# Build Portable executable only
npm run dist:portable

# Build directory target only (win-unpacked)
npm run dist:dir
```

---

## 🧪 Comprehensive Verification Suite

The repository contains 8 automated verification scripts testing all layers of the application without external network calls:

```powershell
# 1. Typecheck TypeScript
npx tsc --noEmit

# 2. Whisper Speech Recognition Validation (JFK Sample)
npm run validate:whisper

# 3. Whisper Reliability & Negative Failure Modes (18 assertions)
npm run test:whisper

# 4. Ollama Runtime & Live Sample Stream Test
npm run validate:ollama

# 5. Ollama & Anti-Hallucination Prompt Suite (36 assertions)
npm run test:ollama

# 6. Audio Pipeline & Resampling Suite (22 assertions)
npm run test:audio

# 7. Transcription Accuracy & Vocabulary Priming Suite (46 assertions)
npm run test:accuracy

# 8. Complete Audio Regression Pipeline (98 assertions)
npm run test:pipeline

# 9. Phase 5 Stabilization & State Invariance (42 assertions)
npm run test:phase5
```
**Total Automated Test Count:** **262 tests passing, 0 failures.**

---

## 🔒 Security & Privacy Guarantees

- **100% Zero-Cloud Processing:** All speech recognition (Whisper.cpp) and LLM inference (Ollama) execute locally on your CPU/GPU. No audio, transcripts, or telemetry ever leave your machine.
- **Strict Electron Sandboxing:**
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - `sandbox: true`
  - Strict Content Security Policy (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`)
- **Process & Resource Isolation:**
  - Temporary audio WAV chunks are written exclusively to `os.tmpdir()` and automatically unlinked immediately after transcription.
  - All child processes (`whisper-cli.exe`) and HTTP streams are monitored and forcefully disposed on window close or application exit.
