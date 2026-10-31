# Changelog: Local AI Conversation Assistant

All notable changes, architectural implementations, and verification milestones for this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
