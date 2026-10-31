# Project Roadmap: Local AI Conversation Assistant

**Repository:** `AbhiJeetSoni22/Local-AI-Conversation-Assistant`  
**Current Milestone:** Phase 2 Complete  
**Final Submission Deadline:** November 4, 2026  
**Status Key:**  
- `Verified`: Code implemented, built, and validated against automated tests and criteria.  
- `Implemented — Not Verified`: Code exists but lacks complete verification.  
- `In Progress`: Currently undergoing development.  
- `Not Started`: Planned for a subsequent phase; no code written yet.  
- `Blocked`: Paused due to an external dependency or critical bug.  

---

```mermaid
flowchart TD
    P1["Phase 1: Desktop Scaffold<br/>[Status: Verified]"] --> P2["Phase 2: Whisper.cpp STT Foundation<br/>[Status: Verified]"]
    P2 --> P3["Phase 3: Ollama Local LLM Integration<br/>[Status: Not Started]"]
    P3 --> P4["Phase 4: Microphone Capture & AudioWorklet<br/>[Status: Not Started]"]
    P4 --> P5["Phase 5: End-to-End Pipeline & State Machine<br/>[Status: Not Started]"]
    P5 --> P6["Phase 6: Hardening, Reliability & Submission<br/>[Status: Not Started]"]

    classDef done fill:#064e3b,stroke:#059669,color:#ecfdf5;
    classDef pending fill:#1e293b,stroke:#475569,color:#94a3b8;
    class P1,P2 done;
    class P3,P4,P5,P6 pending;
```

---

## Phase 1 — Desktop Scaffold & Electron Security

- **Status:** `Verified`
- **Goal:** Establish a fast, secure, modern desktop foundation using Electron, React 18, TypeScript, and Vite.
- **Scope:**
  - Initialize Vite + Electron project with hot module replacement (HMR).
  - Enforce Electron process separation (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).
  - Implement two-panel layout: "Live Transcript" and "AI Suggested Answer".
  - Construct clean UI state machine for scaffold controls (`Start`, `Stop`, `Suggest Answer`).
- **Dependencies:** `electron`, `react`, `react-dom`, `vite`, `vite-plugin-electron`, `typescript`.
- **Primary Files:**
  - `electron/main.ts`
  - `electron/preload.ts`
  - `src/App.tsx`
  - `src/index.css`
  - `src/types/electron.d.ts`
  - `vite.config.ts`, `tsconfig.json`
- **Acceptance Criteria:**
  - Desktop window opens with native menu bar hidden.
  - Zero Node.js APIs exposed directly to renderer window.
  - IPC `app:get-status` returns platform and version cleanly.
  - Controls transition correctly between `Idle`, `Listening`, and `Stopped` without errors.
- **Validation Commands:**
  ```bash
  npm run build
  npm run dev
  ```
- **Prerequisite for Next Phase:** Electron window launches reliably and builds with 0 TypeScript errors.

---

## Phase 2 — Whisper.cpp Local Speech-to-Text Foundation

- **Status:** `Verified`
- **Goal:** Establish and validate local speech recognition using `whisper.cpp` without cloud dependencies or audio streaming.
- **Scope:**
  - Determine and verify official prebuilt Windows x64 binaries (`whisper-cli.exe`, `whisper-server.exe`) and English model (`ggml-base.en.bin`).
  - Create project-level path resolution and environment variable overrides (`electron/whisperConfig.ts`).
  - Build strict PCM WAV validator and RMS silence detector (`electron/wavValidator.ts`).
  - Implement typed main process service with child process lifecycle management (`electron/whisperService.ts`).
  - Build standalone CLI validation script (`scripts/validate-whisper.ts`).
  - Build comprehensive 18-point failure mode test suite (`scripts/test-whisper-failures.ts`).
  - Surface Whisper readiness (`Checking`, `Ready`, `Unavailable`) in UI without connecting fake audio.
  - Update `.gitignore` to keep binary, model, and audio files out of Git.
- **Dependencies:** Prebuilt `whisper.cpp v1.9.2`, model `ggml-base.en.bin`, devDependency `tsx`.
- **Primary Files:**
  - `electron/whisperConfig.ts`
  - `electron/wavValidator.ts`
  - `electron/whisperService.ts`
  - `electron/main.ts`, `electron/preload.ts`
  - `src/App.tsx`, `src/types/electron.d.ts`, `src/index.css`
  - `scripts/validate-whisper.ts`, `scripts/test-whisper-failures.ts`
  - `.gitignore`, `README.md`
- **Acceptance Criteria:**
  - Standalone script transcribes sample JFK WAV offline and outputs text in < 5 seconds.
  - All 18 negative and reliability tests pass (missing binary, missing model, corrupt WAV, silence, port conflicts, cleanup).
  - Child processes killed automatically on app exit (zero orphan processes).
  - UI shows `Ready` if files exist, or `Unavailable` with clear instructions if missing.
- **Validation Commands:**
  ```bash
  npx tsc --noEmit
  npm run build
  npm run validate:whisper
  npm run test:whisper
  ```
- **Prerequisite for Next Phase:** Offline transcription verified with exit code 0; 100% test pass rate.

---

## Phase 3 — Ollama Local LLM & Streaming Answer Generation

- **Status:** `Not Started`
- **Goal:** Connect the desktop application to a local Ollama instance for fast, streaming AI conversational suggestions.
- **Scope:**
  - Define Ollama client configuration (default URL `http://127.0.0.1:11434`, model `qwen2.5:1.5b` or `qwen2.5:3b`).
  - Implement main process Ollama service with health check (`/api/tags` or `/api/version`).
  - Implement streaming response generation via Ollama's `/api/generate` or `/api/chat` endpoint.
  - Stream tokens from main process to renderer via typed IPC events (`ollama:token`, `ollama:done`, `ollama:error`).
  - Build standalone Ollama validation script (`scripts/validate-ollama.ts`).
  - Update "AI Suggested Answer" panel to display progressive streaming text with smooth rendering.
  - Add clear error handling when Ollama daemon is offline or model is not pulled.
- **Dependencies:** Local `Ollama` installed on Windows; `qwen2.5:1.5b` or `qwen2.5:3b` pulled locally.
- **Expected Files:**
  - `electron/ollamaConfig.ts`
  - `electron/ollamaService.ts`
  - `scripts/validate-ollama.ts`
  - `scripts/test-ollama-failures.ts`
  - Updates to `electron/main.ts`, `electron/preload.ts`, `src/App.tsx`, `src/types/electron.d.ts`
- **Acceptance Criteria:**
  - Health check correctly detects whether Ollama is running.
  - Suggest Answer button triggers streaming answer from Ollama using transcript context.
  - Renderer renders tokens progressively without freezing the UI.
  - UI displays actionable error message if Ollama is not running (`"Ollama is offline. Run 'ollama serve'"`).
- **Validation Commands:**
  ```bash
  npm run validate:ollama
  npm run test:ollama
  ```
- **Prerequisite for Next Phase:** Ollama streaming verified with mock transcript input.

---

## Phase 4 — Microphone Audio Capture & Audio Processing

- **Status:** `Not Started`
- **Goal:** Capture live microphone input in the renderer, resample to 16 kHz 16-bit PCM, and stream audio chunks to main process.
- **Scope:**
  - Request browser microphone permissions cleanly via `navigator.mediaDevices.getUserMedia`.
  - Implement `AudioWorklet` or Web Audio script processor to capture raw audio samples.
  - Downsample incoming audio (e.g. 44.1/48 kHz) to 16,000 Hz single-channel mono PCM.
  - Implement audio chunker (e.g., 3-to-5 second sliding audio windows or Voice Activity Detection / VAD).
  - Send audio chunk buffers across typed IPC to Electron main.
  - Electron main receives chunks, validates format with `wavValidator`, and feeds to `whisperService`.
  - Handle audio device disconnection, microphone denial, and background tab suspension.
- **Dependencies:** Web Audio API, `AudioWorkletNode`.
- **Expected Files:**
  - `src/audio/audioRecorder.ts`
  - `src/audio/pcmWorklet.ts` (or worklet processor)
  - `src/audio/wavEncoder.ts`
  - `electron/audioIpc.ts`
- **Acceptance Criteria:**
  - Clicking "Start" initiates microphone recording and updates badge to `Listening`.
  - Microphone audio is converted to valid 16 kHz 16-bit PCM buffers.
  - Chunks stream into Whisper service without UI lag or memory leaks.
  - Clicking "Stop" halts capture, flushes pending buffer, and transitions to `Stopped`.
- **Validation Commands:**
  ```bash
  npm run dev
  # Manual microphone test and chunk inspection
  ```
- **Prerequisite for Next Phase:** Live voice input produces transcribed text in terminal/console without crashes.

---

## Phase 5 — End-to-End Pipeline & Application State Handling

- **Status:** `Not Started`
- **Goal:** Unify microphone capture, live whisper transcription, transcript accumulation, and Ollama answer suggestion into a seamless reactive workflow.
- **Scope:**
  - Implement central conversation manager in main/renderer coordinating states:
    `Idle` ➔ `Listening` ➔ `Transcribing` ➔ `Stopped` ➔ `Generating` ➔ `Completed`.
  - Append live transcribed segments into a rolling transcript window with auto-scrolling.
  - Deduplicate overlapping phrases from sliding audio windows.
  - Inject accumulated conversation context into Ollama prompt template.
  - Implement full reset / "Clear Conversation" functionality.
  - Ensure backpressure: if Whisper is busy transcribing, queue or drop non-speech chunks rather than overloading memory.
- **Expected Files:**
  - `src/context/ConversationContext.tsx`
  - `src/hooks/useConversation.ts`
  - Updates to `src/App.tsx`, `electron/main.ts`
- **Acceptance Criteria:**
  - User speaks into microphone ➔ text appears in Live Transcript panel in near real-time.
  - User clicks "Suggest Answer" ➔ context-aware suggestion streams into the right panel.
  - Controls correctly enforce states (cannot suggest answer when transcript is empty; cannot start when already listening).
  - Rapid start/stop cycling does not corrupt state or leave orphan processes.
- **Prerequisite for Next Phase:** Full end-to-end user loop functioning without manual intervention.

---

## Phase 6 — Hardening, Reliability, Documentation & Submission

- **Status:** `Not Started`
- **Goal:** Perform full edge-case hardening, offline verification, documentation audit, and prepare submission materials for November 4, 2026 deadline.
- **Scope:**
  - Conduct full battery of offline tests (disconnect network, run full conversation loop).
  - Test recovery from daemon crashes (kill Ollama or Whisper mid-session; verify app recovers gracefully).
  - Profile memory and CPU usage over a 15-minute continuous session to guarantee no memory leaks.
  - Freeze documentation, review setup instructions on a clean VM/machine.
  - Prepare demonstration video/script and submission archive.
- **Expected Files:**
  - Finalized `README.md` and `docs/*`
  - Submission release bundle / report
- **Acceptance Criteria:**
  - 100% offline operation verified.
  - Zero unhandled promise rejections or runtime crashes under error conditions.
  - Full project documentation matches implementation exactly.
  - Project ready for formal evaluation.

