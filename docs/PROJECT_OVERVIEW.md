# Project Overview: Local AI Conversation Assistant

**Repository:** `AbhiJeetSoni22/Local-AI-Conversation-Assistant`  
**Target Platform:** Windows 10 / 11 (64-bit x64)  
**Project Type:** Internship Prototype / Local-First Desktop Application  
**Target Completion Date:** November 4, 2026  
**Current Phase:** Phase 2 Complete (Whisper.cpp Foundation Verified)  
**Last Updated:** October 31, 2026  

---

## 1. Executive Summary & Purpose

The **Local AI Conversation Assistant** is a Windows desktop application designed to provide live, private, and zero-cost conversational assistance during meetings, interviews, and discussions. 

Unlike conventional AI assistants that stream raw audio to external cloud providers (such as OpenAI, Google, or Anthropic), this project operates on a **100% local-first and air-gapped architecture**:
- **Speech-to-Text (STT):** Processed entirely on the user's CPU/GPU via `whisper.cpp`.
- **Large Language Model (LLM):** Inferred locally via `Ollama` running lightweight open-weight models (e.g., `qwen2.5:1.5b` or `qwen2.5:3b`).
- **Data Privacy & Security:** Zero audio buffers, transcripts, or prompts ever leave the local machine. No API keys, cloud subscriptions, or external network connections are required.

---

## 2. Core User Workflow (Intended End-State)

When fully completed across all 6 phases, the user experience follows this linear, non-intrusive workflow:

```text
1. Launch Desktop App
   └─ System checks local Whisper and Ollama runtime readiness.
2. User Clicks "Start"
   └─ Microphone captures system/speech audio in real-time.
3. Live Audio Chunking & Transcription
   └─ Audio is buffered into clean chunks and transcribed locally by whisper.cpp.
   └─ Transcribed text streams live into the "Live Transcript" panel.
4. User Clicks "Stop"
   └─ Audio stream stops; any remaining buffer is flushed and transcribed.
5. User Clicks "Suggest Answer"
   └─ Context from the latest transcript is formatted and sent to local Ollama.
   └─ Ollama streams actionable answers, summaries, or talking points into the "AI Suggested Answer" panel.
```

---

## 3. Technology Stack & Responsibilities

| Layer / Technology | Component | Exact Role & Scope |
| :--- | :--- | :--- |
| **Desktop Shell** | Electron 33 | OS integration, window management, Node.js background services, child process execution, strict sandbox isolation. |
| **Frontend UI** | React 18 | Reactive user interface, button state transitions, real-time transcript display, streaming answer display. |
| **Build & Tooling** | Vite 6 + TypeScript 5.7 | Rapid HMR development, strict static type enforcement (`tsc --noEmit`), multi-target production bundling. |
| **IPC Bridge** | Electron `contextBridge` | Secure, typed, unidirectional and bidirectional IPC communication (`getStatus`, `getWhisperReadiness`). |
| **Speech-to-Text** | `whisper.cpp` (v1.9.2) | Fast C/C++ GGML-based Whisper inference using `ggml-base.en.bin` on Windows CPU. |
| **LLM Inference** | `Ollama` *(Phase 3)* | Local HTTP inference daemon serving quantized Qwen 2.5 models without cloud dependencies. |
| **Audio Capture** | Web Audio API / AudioWorklet *(Phase 4)* | Native browser audio stream capture, 16 kHz downsampling, 16-bit PCM WAV chunking. |

---

## 4. Requirement Boundaries & Explicit Non-Goals

To maintain high reliability, maintainability, and delivery before the November 4, 2026 deadline, strict project boundaries are enforced:

### ✅ In Scope (Core Goals)
- 100% offline and free local execution.
- Standard Windows desktop operation with native look and feel.
- Strict Electron security defaults (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).
- Clean separation between renderer and Node main process.
- Robust child process lifecycle management (zero orphan processes on app shutdown).
- Input validation (PCM WAV structure, sample rate, bit depth, silence detection).
- Graceful error states with actionable user setup instructions.

### ❌ Explicitly Out of Scope (Non-Goals)
- **Cloud AI Services:** No OpenAI, Azure, Gemini, AWS Transcribe, or paid API endpoints.
- **API Keys / Billing:** No user accounts, billing portals, or license key authentications.
- **Complex UI Bloat:** No external CSS framework dependencies, no complex settings dialogs, no model marketplace downloads inside the app.
- **Silent Network Downloads:** The application will never automatically download multi-hundred-megabyte binaries or models behind the user's back.
- **Persistent Databases:** No SQLite/PostgreSQL/cloud storage databases for conversation logging; conversational state remains transient in memory.
- **Auto-Updaters & Installers:** No MSIX/InnoSetup packaging during development; clean portable developer build.

---

## 5. Scope Distinction Matrix

To avoid ambiguity, the table below maps project elements to their exact project status:

| Element | Internship Requirement | Approved Plan | Implemented Today | Planned for Later | Known Limitation |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Electron + React Desktop Scaffold** | Yes | Yes | ✅ Phase 1 | — | Basic static UI layout only |
| **Electron Security Sandbox** | Yes | Yes | ✅ Phase 1 | — | Preload must remain minimal |
| **Local whisper.cpp STT Foundation** | Yes | Yes | ✅ Phase 2 | — | CPU inference only (AVX2) |
| **Standalone Whisper Validation Script** | Yes | Yes | ✅ Phase 2 | — | Requires sample WAV on disk |
| **WAV Parser & Silence Detection** | Yes | Yes | ✅ Phase 2 | — | Expects 16-bit PCM WAV |
| **Main Process Child Process Lifecycle** | Yes | Yes | ✅ Phase 2 | — | Windows task management |
| **UI Whisper Readiness Status Indicator** | Yes | Yes | ✅ Phase 2 | — | Displays `Ready` vs `Unavailable` |
| **Local Ollama LLM Service** | Yes | Yes | ⏳ Not Started | Phase 3 | Requires Ollama running locally |
| **Streaming AI Response Generation** | Yes | Yes | ⏳ Not Started | Phase 3 | Currently placeholder string |
| **Microphone Capture & AudioWorklet** | Yes | Yes | ⏳ Not Started | Phase 4 | Scaffold Start/Stop only |
| **Real-time Audio Chunking & Resampling** | Yes | Yes | ⏳ Not Started | Phase 4 | Not yet feeding live audio |
| **End-to-End State Machine Integration** | Yes | Yes | ⏳ Not Started | Phase 5 | UI buttons remain scaffold |
| **Packaging & Submission Verification** | Yes | Yes | ⏳ Not Started | Phase 6 | Raw dev/build commands only |

---

## 6. Related Documentation Links

- [Project Roadmap](./PROJECT_ROADMAP.md) — Phase-by-phase execution milestones and acceptance criteria.
- [Architecture](./ARCHITECTURE.md) — Detailed main, preload, and renderer architecture with Mermaid diagrams.
- [Application Flow](./APPLICATION_FLOW.md) — State machine transitions and end-to-end data pipeline.
- [Development Setup](./DEVELOPMENT_SETUP.md) — Clean Windows machine setup and manual download steps.
- [Testing & Validation](./TESTING_AND_VALIDATION.md) — Automated test scripts and manual verification procedures.
- [Decisions & Constraints](./DECISIONS_AND_CONSTRAINTS.md) — Permanent architectural rules and rationales.
- [Implementation Status](./IMPLEMENTATION_STATUS.md) — Living inventory of verified features and technical risks.
- [Changelog](./CHANGELOG.md) — Historical log of completed changes.

