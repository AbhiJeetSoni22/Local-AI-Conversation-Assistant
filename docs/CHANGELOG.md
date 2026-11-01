# Changelog: Local AI Conversation Assistant

All notable changes, architectural implementations, and verification milestones for this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Phase 4: Microphone Audio Capture & Live Transcription] - 2026-11-01

### Added
- **Audio Capture & AudioWorklet Engine (`src/audio/audioRecorder.ts`)**:
  - Implemented `AudioRecorder` using `navigator.mediaDevices.getUserMedia` with mono channel, echo cancellation, noise suppression, and auto gain control constraints.
  - Packaged inline `AudioWorkletNode` via dynamic Blob URL ensuring reliable loading across both Vite dev server and packaged `file://` protocols, with automatic fallback to `ScriptProcessorNode`.
  - Configured 3.0-second non-overlapping chunk window (`48,000` samples @ 16 kHz).
  - Added clean teardown flushing pending speech buffer >= 0.5s (`8,000` samples), stopping media tracks, and closing `AudioContext`.
  - Built comprehensive error classification for `NotAllowedError`, `NotFoundError`, and `NotReadableError` with user-friendly messages.
- **Audio Resampling & DSP (`src/audio/resampler.ts`)**:
  - Pure function `resampleTo16k()` with linear interpolation and anti-aliasing low-pass filtering from 48 kHz, 44.1 kHz, or arbitrary input sample rates to standard 16,000 Hz.
  - Multi-channel downmixing via `downmixToMono()`.
  - Root-Mean-Square (RMS) amplitude energy calculation via `calculateRms()`.
- **WAV Encoding & Silence Gating (`src/audio/wavEncoder.ts`)**:
  - Encodes 16 kHz Float32 PCM arrays into canonical 44-byte header 16-bit linear PCM (`pcm_s16le`) RIFF/WAVE buffers (`Uint8Array`).
  - Implemented client-side silence gate evaluating RMS energy against threshold `0.005`, discarding ambient room noise before IPC transit to prevent CPU saturation.
- **Sequential Transcription Queue & Backpressure (`src/audio/transcriptionQueue.ts`)**:
  - FIFO worker queue guaranteeing sequential Whisper execution (concurrency <= 1), preventing overlapping CLI process launches and out-of-order text.
  - Monotonic `sessionId` validation automatically invalidating and dropping stale chunks from previous recording sessions.
  - Backpressure capping (`maxQueueDepth = 3`) dropping older queued chunks if Whisper execution latency exceeds real-time audio window on slower CPUs.
  - Clean `drain()` method ensuring in-flight chunk completes when user clicks "Stop".
- **IPC Chunk Transcription Bridge (`electron/main.ts`, `electron/preload.ts`, `src/types/electron.d.ts`)**:
  - Registered IPC handler `whisper:transcribe-chunk` accepting raw WAV `Uint8Array`, converting to Node Buffer, validating via `validateWavBuffer`, and transcribing via `WhisperService.transcribe()`.
  - Exposed `transcribeAudioChunk` method on `window.electronApi` in preload bridge.
  - Defined typed `TranscriptionChunkResult` contract.
- **Interactive UI Integration (`src/App.tsx`, `src/index.css`)**:
  - Connected `Start` button to initialize `AudioRecorder` and `TranscriptionQueue`.
  - Connected `Stop` button to cleanly stop recording, flush final buffer, and drain pending queue.
  - Real-time appending of transcribed speech to Live Transcript panel with automatic scroll-to-bottom.
  - Added "Transcribing audio..." visual status spinner when Whisper is actively processing.
  - Added graceful unmount cleanup disposing active audio recorder and queue on window unload.
- **Automated Audio Test Suite (`scripts/test-phase4-audio.ts`)**:
  - Built 22-assertion unit and integration test suite covering resampler, downmixer, RMS energy, WAV header structure, main wavValidator compatibility, sequential queue concurrency, session invalidation, and backpressure.
  - Added `"test:audio": "tsx scripts/test-phase4-audio.ts"` script in `package.json`.

---

## [UI Polish: Premium Dark Desktop Redesign] - 2026-10-31

### Changed
- **Design System & Palette (`src/index.css`)**:
  - Replaced generic saturated navy-blue theme with an understated obsidian/deep charcoal surface hierarchy (`#0b0c0f`, `#101217`, `#13151b`, `#161922`, `#1a1e28`).
  - Implemented 1px hairline separation system with subtle transparency (`rgba(255,255,255,0.05)` - `0.08`) replacing heavy borders.
  - Refined typography hierarchy: softer primary text (`#f1f3f7`), muted secondary text (`#9aa2b1`), and structured conversational font metrics (`line-height: 1.65`–`1.7`).
- **Application Header Redesign (`src/App.tsx`, `src/index.css`)**:
  - Replaced generic "AI" gradient badge with an elegant geometric soundwave mark.
  - Consolidated scattered status pills into a quiet, unified Runtime Telemetry Cluster (`Whisper` and `Ollama` dot+status items) paired with an understated session pill.
- **Controls & Action Hierarchy (`src/App.tsx`)**:
  - Formed a clear primary-secondary hierarchy: solid blue `Start` recording action, distinctive muted-crimson `Stop` action, and refined dark-slate `Suggest Answer` action.
  - Moved panel-specific reset actions (`Clear Transcript`, `Copy Answer`, `Clear Answer`) into their respective panel headers as quiet ghost text actions.
  - Removed decorative developer pills (`Phase 3` note) from the main action bar for a clean, production-grade appearance.
- **Transcript & Answer Workspace (`src/App.tsx`)**:
  - Eliminated "card-in-a-card" nesting: transcripts and streaming answers now flow directly on the main panel canvas.
  - Formatted transcript lines with distinct speaker identification tags (`Speaker 1:`, `Speaker 2:`).
  - Streamlined empty states with refined monochrome SVG icons and understated guidance typography.
  - Styled "Load sample transcript" as a clean secondary dashed utility action rather than an oversized button.
  - Added one-click "Copy Answer" clipboard utility with visual confirmation checkmark.
- **Responsive Scaling & Motion Support**:
  - Added responsive media query (`@media (max-width: 760px)`) to gracefully stack workspace panels on narrow displays.
  - Added `@media (prefers-reduced-motion: reduce)` support and custom slim scrollbars.

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
