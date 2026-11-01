# Local AI Conversation Assistant (Windows)

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-33-47848F.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.3-61DAFB.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6.0-646CFF.svg)](https://vitejs.dev/)
[![whisper.cpp](https://img.shields.io/badge/whisper.cpp-v1.9.2-green.svg)](https://github.com/ggml-org/whisper.cpp)
[![Ollama](https://img.shields.io/badge/Ollama-Qwen%202.5%3A3b-orange.svg)](https://ollama.com)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011%20x64-0078D6.svg)](https://microsoft.com)

A desktop conversational assistant built with **Electron**, **React**, **TypeScript**, and **Vite**, designed for **100% local-first, zero-cloud AI processing on Windows**.

---

## 📌 Implementation Status

| Stage / Phase | Focus | Status | Evidence |
| :--- | :--- | :---: | :--- |
| **Phase 1** | Electron + React + TypeScript Desktop Scaffold | ✅ `Verified` | Desktop window initializes cleanly under `TEST_LAUNCH=1`. |
| **Phase 2** | Whisper.cpp Local Speech-to-Text Foundation | ✅ `Verified` | Offline JFK transcription in 3.67s; 18/18 edge-case tests pass. |
| **Phase 3** | Ollama Local LLM & Streaming Suggestions | ✅ `Verified` | Local Ollama streaming answers, cancel support; 36/36 tests pass. |
| **Phase 4** | Microphone Audio Capture & Live Transcription | ✅ `Verified (Automated)` | Resampling, WAV encoding, queueing, and Whisper IPC; 22/22 tests pass. |
| **Phase 5** | Context Tuning & Pipeline Polish | ⏳ `Not Started` | Fine-tuning conversation context & suggestion quality. |
| **Phase 6** | Hardening, Air-Gapped Verification & Submission | ⏳ `Not Started` | Final submission deadline: November 4, 2026. |

> ℹ️ **Current Status Note:**
> - **Phases 1, 2, 3, and 4 are complete and automated-tested.**
> - Clicking **Start** initiates real microphone capture, audio downsampling to 16 kHz mono, client-side silence filtering, and sequential local Whisper.cpp transcription.
> - Clicking **Stop** halts capture, flushes any final audio buffer >= 0.5s, releases microphone hardware, and drains the transcription queue.
> - The live transcript can immediately feed into the **Suggest Answer** button to stream local answers from Ollama (`qwen2.5:3b`).

---

## 📖 Complete Documentation Index

All detailed architecture, setup, testing, and operational guides have been organized into the [`docs/`](./docs) directory:

| Document | Description |
| :--- | :--- |
| **[Project Overview](./docs/PROJECT_OVERVIEW.md)** | Purpose, internship requirements, technologies, core workflow, and scope boundaries. |
| **[Project Roadmap](./docs/PROJECT_ROADMAP.md)** | Phase-by-phase roadmap, milestones, acceptance criteria, and status tracking. |
| **[System Architecture](./docs/ARCHITECTURE.md)** | Main process, preload bridge, renderer, Whisper engine, Ollama service, and Mermaid architecture diagrams. |
| **[Application Flow](./docs/APPLICATION_FLOW.md)** | End-to-end data pipeline, state machine, and streaming Suggest Answer lifecycle. |
| **[Development Setup](./docs/DEVELOPMENT_SETUP.md)** | Clean Windows machine setup, manual whisper.cpp and Ollama download steps. |
| **[Testing & Validation](./docs/TESTING_AND_VALIDATION.md)** | Automated test suites (`validate:whisper`, `test:whisper`, `test:ollama`, `validate:ollama`). |
| **[Configuration Reference](./docs/CONFIGURATION.md)** | Directory conventions, Windows environment variables, and WAV/prompt parameters. |
| **[Troubleshooting Guide](./docs/TROUBLESHOOTING.md)** | Diagnosing missing binaries/models, Ollama daemon reachability, and orphaned processes. |
| **[Implementation Status](./docs/IMPLEMENTATION_STATUS.md)** | Feature-by-feature verification matrix, audit observations, and technical debt log. |
| **[Decisions & Constraints](./docs/DECISIONS_AND_CONSTRAINTS.md)** | Permanent engineering rules, technology rationales, and design trade-offs. |
| **[Changelog](./docs/CHANGELOG.md)** | Historical version and release log. |

---

## 🚀 Quickstart Guide

### 1. Prerequisites
- **OS:** Windows 10 or 11 (64-bit x64)
- **Node.js:** v20 or v22 LTS (tested on Node `v20.18.3` and `v22.23.2`)
- **npm:** v10+

### 2. Installation
```powershell
# Clone the repository
git clone https://github.com/AbhiJeetSoni22/Local-AI-Conversation-Assistant.git
cd Local-AI-Conversation-Assistant

# Install dependencies
npm install
```

### 3. Manual Whisper Runtime Setup (Phase 2 Requirement)
To protect privacy and avoid silent downloads, place the verified binary and model in their respective folders:
1. **Executables:** Download [`whisper-bin-x64.zip`](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.2) from whisper.cpp v1.9.2 releases and extract all files into `./bin/` (ensuring `bin/whisper-cli.exe` and required DLLs are present).
2. **Model:** Download [`ggml-base.en.bin`](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin) (~147.4 MB) from Hugging Face and place it into `./models/`.
3. **Sample Audio (Optional):** Download [`jfk.wav`](https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/samples/jfk.wav) into `./samples/`.

### 4. Manual Ollama Setup (Phase 3 Requirement)
1. **Install Ollama:** Download and install from [https://ollama.com/download/OllamaSetup.exe](https://ollama.com/download/OllamaSetup.exe).
2. **Pull Model:** Open PowerShell and run:
   ```powershell
   ollama pull qwen2.5:3b
   ```
3. **Verify:**
   ```powershell
   ollama list
   ```

---

## 🧪 Verification Commands

```powershell
# 1. Type check
npx tsc --noEmit

# 2. Run Whisper speech recognition validation & failure tests (18 assertions)
npm run validate:whisper
npm run test:whisper

# 3. Run Ollama unit & integration test suite (36 assertions)
npm run test:ollama

# 4. Probe live local Ollama runtime and run test stream
npm run validate:ollama

# 5. Run Audio Capture & Live Pipeline test suite (22 assertions)
npm run test:audio

# 6. Run Transcription Accuracy, Hallucination Suppression & Answer Relevance suite (44 assertions)
npm run test:accuracy

# 7. Compile production bundles
npm run build
```

---

## 💻 Running the Application

### In Development (with HMR):
```powershell
npm run dev
```

### In Production:
```powershell
npm run build
npx electron .
```

---

## 🔒 Security & Engineering Standards

- **Strict Isolation:** `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true` are permanently enabled.
- **100% Local-First:** Zero telemetry, zero cloud APIs, and zero network data transmission.
- **Anti-Hallucination Framing:** Transcripts are demarcated and prompts instruct the model to ground answers exclusively in the conversation.
- **Zero Orphan Processes:** Child processes and HTTP streams are explicitly tracked and terminated on application exit hooks (`before-quit`, `will-quit`, `exit`).
- **Git Hygiene:** Binary files (`.exe`, `.dll`), model files (`.bin`), and audio files (`.wav`) are strictly excluded in [`.gitignore`](./.gitignore).
