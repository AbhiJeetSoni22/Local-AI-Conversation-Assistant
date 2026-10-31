# Changelog: Local AI Conversation Assistant

All notable changes, architectural implementations, and verification milestones for this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Phase 3: Ollama Local LLM Integration & Streaming Answers] - 2026-10-31

### Added
- **Ollama Configuration & Health Probing (`electron/ollamaConfig.ts`)**:
  - Implemented configurable host resolution (default `http://127.0.0.1:11434`, overridable via `OLLAMA_HOST` / `OLLAMA_BASE_URL`).
  - Implemented target model configuration (default `qwen2.5:3b`, overridable via `OLLAMA_MODEL`).
  - Added non-destructive two-step health check probing `/api/version` (3000ms timeout) and `/api/tags` (4000ms timeout) for exact or variant model matching (`qwen2.5:3b`).
- **Prompt Builder & Context Guard (`electron/promptBuilder.ts`)**:
  - Built pure function `buildAnswerPrompt(transcript)` with explicit anti-hallucination system prompt.
  - Added empty and whitespace-only transcript rejection.
  - Added 12,000 character length bounding, truncating earlier conversation while retaining recent conversation with context note.
  - Demarcated untrusted transcript within `--- BEGIN TRANSCRIPT ---` and `--- END TRANSCRIPT ---` boundaries.
- **Main Process Ollama Streaming Service (`electron/ollamaService.ts`)**:
  - Built `OllamaService` managing HTTP streaming to `POST /api/chat` with `{ stream: true }`.
  - Implemented streaming NDJSON parser reading chunks progressively and emitting tokens via `onChunk` callback.
  - Added concurrency guard locking generation immediately to reject simultaneous overlapping requests.
  - Added cancellation support using `AbortController` to terminate active HTTP streams mid-flight.
  - Added safety timeout (`timeoutMs`, default 60s) to abort hanging requests.
  - Registered shutdown cleanup hooks (`before-quit`, `will-quit`, `exit`, `SIGINT`, `SIGTERM`).
- **IPC Handlers & Preload Bridge (`electron/main.ts`, `electron/preload.ts`)**:
  - Added IPC channels: `ollama:get-readiness`, `ollama:start-generation`, `ollama:cancel-generation`.
  - Added streaming WebContents events: `ollama:stream-chunk`, `ollama:stream-done`, `ollama:stream-error`, `ollama:stream-cancelled`.
  - Exposed typed contextBridge methods and cleanup unsubscribe listeners in `electron/preload.ts`.
- **UI Streaming Answer & Cancellation (`src/App.tsx`, `src/index.css`)**:
  - Added header badge for Ollama status (`Checking`, `Ready`, `Unavailable`).
  - Added actionable warning card in "AI Suggested Answer" panel guiding users on installing Ollama and running `ollama pull qwen2.5:3b`.
  - Added live streaming response container with purple status badge, elapsed duration metadata, and animated pulsing cursor.
  - Added "Cancel Generation" button allowing users to cancel long inferences.
  - Added "Load Sample Meeting Transcript" utility in Live Transcript panel enabling immediate testing before Phase 4 microphone capture.
- **Deterministic Automated Test Suite (`scripts/test-ollama.ts`)**:
  - Built 36-point test suite using in-memory HTTP mock server testing config resolution, prompt bounding, mock health probing, streaming token accumulation, cancellation, concurrency locking, and malformed chunk errors.
  - Added `npm run test:ollama` script in `package.json`.
- **Standalone Live Ollama Probe (`scripts/validate-ollama.ts`)**:
  - Added CLI probe testing live daemon reachability, model existence, and running sample streaming inference to stdout.
  - Added `npm run validate:ollama` script in `package.json`.

---

## [Phase 2: Whisper.cpp Local Speech-to-Text Foundation] - 2026-10-31

### Added
- **Whisper Path & Environment Configuration (`electron/whisperConfig.ts`)**:
  - Implemented convention-based path resolution for `./bin` and `./models`.
  - Added environment variable override support (`WHISPER_BIN_PATH`, `WHISPER_MODEL_PATH`, `WHISPER_ENGINE`, `WHISPER_PORT`).
  - Added non-destructive environment validation with 10 MB sanity check on model files to reject partial or empty downloads.
- **Strict WAV Input & Silence Validator (`electron/wavValidator.ts`)**:
  - Added RIFF / WAVE header and chunk parsers.
  - Enforced 16-bit linear PCM format code `1`, 16,000 Hz sample rate check, and duration limits (default 120s max).
  - Built RMS energy calculator to flag silent audio buffers (`isSilent: true`) and bypass unnecessary model inference.
- **Main Process Whisper Service (`electron/whisperService.ts`)**:
  - Implemented typed `WhisperService` with full lifecycle management.
  - Implemented `whisper-cli.exe` execution with structured JSON output parsing (`-oj -of <prefix>`).
  - Implemented optional `whisper-server.exe` daemon mode with startup polling and multipart HTTP `/inference` requests.
  - Registered automated termination hooks on `before-quit`, `will-quit`, and `exit` events to guarantee zero orphaned processes.
- **Standalone Validation Script (`scripts/validate-whisper.ts`)**:
  - Added non-interactive CLI script verifying binary existence, model validity, and offline transcription of `samples/jfk.wav`.
  - Added `npm run validate:whisper` package script.
- **Comprehensive Failure Modes & Edge-Cases Test Suite (`scripts/test-whisper-failures.ts`)**:
  - Built 18-point automated test suite covering missing executables, missing models, undersized models, corrupt WAV headers, silence detection, server failures, port conflicts, and disposal idempotency.
  - Added `npm run test:whisper` package script.
- **UI Whisper Readiness Indicators (`src/App.tsx`, `src/index.css`)**:
  - Added dynamic header badge displaying `Whisper: Ready` or `Whisper: Unavailable`.
  - Added actionable warning card in Live Transcript panel directing users to setup guide when binaries/models are missing.
- **Tooling & Git Hygiene**:
  - Added `tsx` devDependency for direct execution of TypeScript scripts.
  - Updated `.gitignore` to strictly exclude `bin/`, `models/`, `samples/*.wav`, `*.bin`, and `*.exe`.

### Fixed
- **Strict Type Error in Test Suite**:
  - Fixed TypeScript compiler error in `scripts/test-whisper-failures.ts` where optional chaining expressions evaluated to `boolean | undefined`. Coerced conditions explicitly with `Boolean(...)` and updated `assert` parameter type to `boolean | undefined`.
- **Preload Script Bundling**:
  - Fixed ES module interop issue ensuring `preload.ts` compiles cleanly without mixing CommonJS and ESM scopes.

---

## [Phase 1: Desktop Application Scaffold] - 2026-10-31

### Added
- **Core Desktop Application Scaffold**:
  - Initialized Electron 33 + React 18 + TypeScript 5.7 + Vite 6 project structure.
  - Configured Vite development server with hot module replacement (`vite-plugin-electron/simple`).
  - Added strict TypeScript compilation (`tsconfig.json`).
- **Security Boundary Enforcement**:
  - Configured `BrowserWindow` with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
  - Implemented typed `contextBridge` in `electron/preload.ts` exposing `window.electronApi`.
- **Initial UI Layout**:
  - Built dark-themed desktop UI in `src/App.tsx` and `src/index.css`.
  - Added header with app title and status badge (`Idle`, `Listening`, `Stopped`).
  - Added action control bar with `Start`, `Stop`, and `Suggest Answer` buttons.
  - Created two-panel split grid: "Live Transcript" and "AI Suggested Answer" with empty-state placeholders.
  - Added footer displaying system architecture and sandbox status.
- **Scaffold State Machine**:
  - Enforced valid button transition states (`Start` disabled when listening, `Stop` disabled when idle).
- **Verification Scripts**:
  - Added `TEST_LAUNCH=1` headless verification hook in `electron/main.ts`.
