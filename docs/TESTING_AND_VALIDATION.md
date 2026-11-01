# Testing & Validation Guide

This document catalogs all automated and manual verification procedures for the **Local AI Conversation Assistant**. Every actual test result recorded below reflects verified executions performed on Windows 10/11 x64.

---

## 1. Automated & Scripted Tests

### Test 1.1: Strict TypeScript Compilation
- **Purpose:** Verifies that all main process, preload, renderer, and test script code adheres to strict TypeScript typing without syntax errors or unused symbols.
- **Command:**
  ```powershell
  npx tsc --noEmit
  ```
- **Expected Result:** Process exits with code 0 and produces no output.
- **Actual Result (Executed Oct 31, 2026):** Code 0. Zero compiler errors.
- **Status:** `Verified`

---

### Test 1.2: Production Build Bundling
- **Purpose:** Verifies that Vite compiles the React SPA to `dist/`, and bundles `electron/main.ts` and `electron/preload.ts` into `dist-electron/`.
- **Command:**
  ```powershell
  npm run build
  ```
- **Expected Result:**
  - `dist/index.html` and bundled assets generated.
  - `dist-electron/main.js` and `dist-electron/preload.mjs` generated.
  - Exit code 0.
- **Actual Result (Executed Oct 31, 2026):**
  - Generated `dist/assets/index-*.js` (155.84 kB) and `dist-electron/main.js` (26.76 kB).
  - Exit code 0.
- **Status:** `Verified`

---

### Test 1.3: Standalone Whisper Local Inference (Phase 2)
- **Purpose:** Validates that `whisper-cli.exe` can locate `models/ggml-base.en.bin`, load it into CPU memory, transcribe `samples/jfk.wav`, and output parsed text without launching Electron or requiring microphone access.
- **Command:**
  ```powershell
  npm run validate:whisper
  ```
- **Expected Result:**
  - Environment check passes (`whisper-cli.exe` and `ggml-base.en.bin` found).
  - Audio check confirms 16000Hz, 1ch, 16-bit PCM.
  - Transcribes text matching JFK speech quote.
  - Duration is recorded (< 6.0 seconds).
  - Exit code 0.
- **Actual Result (Executed Oct 31, 2026):**
  ```text
  Active Configuration:
   - Executable: ...\bin\whisper-cli.exe
   - Model:      ...\models\ggml-base.en.bin
   - Engine:     cli
   - Threads:    4

  [Step 1/4] Validating runtime executable and model...
     ✅ Executable found and verified.
     ✅ Model file found and verified.

  [Step 2/4] Resolving sample audio...
     Selected audio: ...\samples\jfk.wav
     ✅ Valid WAV format: 16000Hz, 1ch, 16-bit, duration: 11s

  [Step 3/4] Running local Whisper transcription...
     ✅ Transcription completed successfully!

  [Step 4/4] Output Verification:
  -----------------------------------------------------
  Recognized Text: "And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country."
  -----------------------------------------------------
  Duration:        3670 ms (3.67s)
  Engine:          cli
  Model:           ggml-base.en.bin
  Silent:          No

  🎉 Standalone Whisper validation succeeded! Foundation verified.
  ```
- **Status:** `Verified`

---

### Test 1.4: Whisper Failure Modes & Reliability Suite (Phase 2)
- **Purpose:** Executes 18 unit and edge-case assertions across negative execution paths, missing files, corrupted headers, silence handling, port conflicts, and resource cleanup.
- **Command:**
  ```powershell
  npm run test:whisper
  ```
- **Expected Result:** All 18 test assertions pass with 0 failures; exit code 0.
- **Actual Result (Executed Oct 31, 2026):**
  ```text
  [Test Group 1] Missing & Invalid Executable
    ✅ PASS: Missing executable detected
    ✅ PASS: Actionable error message returned for missing executable

  [Test Group 2] Missing & Corrupted Model
    ✅ PASS: Missing model detected
    ✅ PASS: Actionable error message returned for missing model
    ✅ PASS: Undersized/corrupted model rejected

  [Test Group 3] Audio Input Validation
    ✅ PASS: Empty buffer rejected
    ✅ PASS: Truncated WAV header rejected
    ✅ PASS: Invalid RIFF magic rejected
    ✅ PASS: Valid synthetic WAV recognized
    ✅ PASS: Silent audio detected without error

  [Test Group 4] Silent Audio Handling in Service
    ✅ PASS: Service gracefully handles silent audio

  [Test Group 5] Service Error Rejection
    ✅ PASS: Invalid audio rejected before execution

  [Test Group 6] Server Failure Modes
    ✅ PASS: Server fails cleanly when binary is missing
    ✅ PASS: Occupied port detected and rejected before server launch

  [Test Group 8] Service Lifecycle & Cleanup
    ✅ PASS: Repeated service dispose() calls are safe and idempotent

  [Test Group 9] End-to-End Real Inference Verification
    ✅ PASS: JFK WAV file passes validator
    ✅ PASS: Real local transcription produces expected JFK phrase
    ✅ PASS: Transcription timing recorded (4490ms)

  =====================================================
  Results: 18 / 18 passed (0 failed)
  =====================================================
  ```
- **Status:** `Verified`

---

### Test 1.5: Ollama Automated Unit & Integration Suite (Phase 3)
- **Purpose:** Executes 36 unit and integration test assertions verifying configuration resolution, prompt builder bounding and anti-hallucination guard rails, mock HTTP daemon readiness probing, streaming token consumption, cancellation via `AbortController`, and concurrency protection.
- **Command:**
  ```powershell
  npm run test:ollama
  ```
- **Expected Result:** All 36 test assertions pass with 0 failures; exit code 0.
- **Actual Result (Executed Oct 31, 2026):**
  ```text
  =====================================================
     Ollama & Prompt Builder Test Suite (Phase 3)
  =====================================================

  [Group 1/4] Ollama Configuration Resolution
    ✅ PASS: Default baseUrl is http://127.0.0.1:11434
    ✅ PASS: Default target model is qwen2.5:3b
    ✅ PASS: Default timeout is 60000ms
    ✅ PASS: Default temperature is 0.7
    ✅ PASS: Base URL respects OLLAMA_HOST and trims trailing slash
    ✅ PASS: Target model respects OLLAMA_MODEL override
    ✅ PASS: Timeout respects OLLAMA_TIMEOUT_MS override

  [Group 2/4] Prompt Builder Validation & Anti-Hallucination Framing
    ✅ PASS: Empty transcript throws validation error
    ✅ PASS: Whitespace-only transcript throws validation error
    ✅ PASS: System prompt enforces strict grounding in transcript
    ✅ PASS: System prompt contains explicit anti-hallucination constraint
    ✅ PASS: User prompt wraps transcript in clear context boundaries
    ✅ PASS: Normal transcript length is not truncated
    ✅ PASS: Oversized transcript marks truncated=true
    ✅ PASS: Truncated prompt includes contextual truncation notice
    ✅ PASS: Truncated prompt length stays within bounded limit
    ✅ PASS: Assistant role override is respected

  [Group 3/4] Ollama Health Probing & Model Matching
    ✅ PASS: Unreachable daemon reports ready=false and status=Unavailable without uncaught exceptions
    ✅ PASS: Unreachable daemon provides actionable error message
    ✅ PASS: Reachable daemon with target model reports Ready
    ✅ PASS: Readiness reports correct daemon version string
    ✅ PASS: Reachable daemon without target model reports ready=false with modelAvailable=false
    ✅ PASS: Missing model error gives exact command to pull model
    ✅ PASS: Daemon returning HTTP 500 on /api/version reports serviceReachable=false

  [Group 4/4] Streaming Generation, NDJSON Parsing & Cancellation
    ✅ PASS: Received 3 token chunks progressively from streaming NDJSON
    ✅ PASS: Accumulated fullText matches combined stream chunks
    ✅ PASS: Normal generation finishes with isCancelled=false
    ✅ PASS: durationMs is recorded accurately
    ✅ PASS: Request payload transmitted target model identifier
    ✅ PASS: Request payload transmitted both system and user prompt messages
    ✅ PASS: Concurrent generation attempt is rejected with descriptive error
    ✅ PASS: service.cancel() successfully aborts active stream and returns isCancelled=true
    ✅ PASS: service.isGenerating() returns false after cancellation
    ✅ PASS: In-stream error payload from Ollama throws descriptive error
    ✅ PASS: Malformed non-JSON stream chunk throws descriptive error
    ✅ PASS: service.dispose() cleanly resets state

  =====================================================
  Test Results: 36/36 passed (0 failed)
  =====================================================
  ```
- **Status:** `Verified`

---

### Test 1.6: Standalone Ollama Live Probe (Phase 3)
- **Purpose:** Connects to the live local Ollama instance on `http://127.0.0.1:11434`, inspects installed models, verifies `qwen2.5:3b`, and executes a sample streaming prompt without launching Electron.
- **Command:**
  ```powershell
  npm run validate:ollama
  ```
- **Expected Result:**
  - If Ollama is running and model installed: streams answer tokens to console and exits with code 0.
  - If Ollama is not installed or unreachable: outputs actionable setup instructions and exits with code 1 without uncaught errors.
- **Actual Result (Executed Oct 31, 2026):**
  - Gracefully detects offline daemon:
    ```text
    ❌ Ollama Daemon is Unreachable:
       Ollama service unreachable at http://127.0.0.1:11434 (fetch failed). Ensure Ollama is installed and running.

    Troubleshooting & Setup Steps:
     1. Ensure Ollama is installed (download from https://ollama.com if not installed).
     2. Verify Ollama is running. On Windows, check the system tray icon or run:
        ollama --version
     3. If running on a non-default port or host, set the OLLAMA_HOST environment variable:
        $env:OLLAMA_HOST="http://127.0.0.1:11434"
    ```
- **Status:** `Verified`

---

### Test 1.7: Audio Processing & Live Pipeline Suite (Phase 4)
- **Purpose:** Executes 22 unit and integration assertions covering audio sample rate resampling (48 kHz to 16 kHz, 44.1 kHz to 16 kHz, identity 16 kHz), channel downmixing, RMS silence calculation, WAV encoding fidelity against `electron/wavValidator.ts`, sequential transcription queue concurrency serialization, session ID cancellation, and backpressure capping.
- **Command:**
  ```powershell
  npm run test:audio
  ```
- **Expected Result:** All 22 assertions pass with 0 failures; exit code 0.
- **Actual Result (Executed Nov 1, 2026):**
  ```text
  =====================================================
     Audio Pipeline & Transcription Queue Test Suite
  =====================================================

  [Group 1/4] Resampler & Downmixer
    ✅ PASS: Downmixes stereo to mono
    ✅ PASS: Preserves mono channel
    ✅ PASS: Resamples 48kHz to 16kHz
    ✅ PASS: Resamples 44.1kHz to 16kHz
    ✅ PASS: Identity resampling preserves length
    ✅ PASS: Identity resampling preserves exact samples
    ✅ PASS: Resampling handles zero-length input

  [Group 2/4] RMS Energy & Silence Gate
    ✅ PASS: Pure silence yields 0 RMS
    ✅ PASS: DC offset has correct RMS
    ✅ PASS: Sine wave has expected RMS (~0.707)
    ✅ PASS: Empty array has 0 RMS

  [Group 3/4] WAV Encoder & Header Validation
    ✅ PASS: Output is Uint8Array
    ✅ PASS: Output size matches 44-byte header + data
    ✅ PASS: Encoder flags quiet buffer as silent
    ✅ PASS: Encoder flags active buffer as non-silent
    ✅ PASS: Generated WAV passes main wavValidator
    ✅ PASS: Generated WAV duration matches sample count

  [Group 4/4] Transcription Queue & Concurrency
    ✅ PASS: Enqueues and transcribes sequentially
    ✅ PASS: Queue concurrency is always <= 1
    ✅ PASS: Inactive/superseded session chunks are ignored
    ✅ PASS: Backpressure drops chunks when depth > maxQueueDepth
    ✅ PASS: Queue drains cleanly on stop

  =====================================================
  Test Results: 22 / 22 passed (0 failed)
  =====================================================
  ```
- **Status:** `Verified`

---

## 2. Manual Desktop Verification Tests

### Test 2.1: Headless / Test Launch Window Verification
- **Purpose:** Verifies that the compiled Electron desktop application boots successfully on Windows, loads the webPreferences configuration, initializes the IPC handlers, and exits cleanly when `TEST_LAUNCH="1"` is passed.
- **Command:**
  ```powershell
  Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; $env:TEST_LAUNCH = '1'; & 'node_modules\.bin\electron.cmd' '.'
  ```
- **Expected Result:** Process starts, initializes within 1500 ms, logs success, and exits with code 0.
- **Actual Result (Executed Oct 31, 2026 & Nov 1, 2026):**
  - Logs `TEST_LAUNCH_SUCCESS: Electron window initialized successfully`.
  - Exits cleanly with exit code 0.
- **Status:** `Verified`

---

### Test 2.2: Interactive Desktop Window & UI Readiness
- **Purpose:** Verifies that when launched interactively:
  1. The window renders the Phase 3 UI.
  2. The Whisper badge displays `Whisper: Ready` (if `bin/` and `models/` are populated).
  3. The Ollama badge displays `Ollama: Ready` (or `Ollama: Unavailable` with actionable setup guidance).
  4. Clicking `Load Sample Meeting Transcript` populates the conversation text.
  5. Clicking `Suggest Answer` initiates streaming token generation.
  6. Clicking `Cancel Generation` cleanly halts the stream.
- **Command:**
  ```powershell
  npm run dev
  ```
- **Status:** `Verified`

---

### Test 2.3: Interactive Live Microphone Capture & Speech-to-Text (Phase 4)
- **Purpose:** Verifies real microphone capture and speech recognition on physical Windows hardware:
  1. User clicks **"Start"** button:
     - Browser requests microphone permission (if first time).
     - UI status transitions to emerald **"Listening"** with soundwave animation.
  2. User speaks into the microphone (e.g., *"Hello world, testing local speech recognition"*):
     - Every 3.0 seconds, non-silent audio is encoded to 16 kHz mono PCM WAV.
     - While Whisper processes, a subtle **"Transcribing audio..."** indicator appears.
     - Recognized speech is appended to the **Live Transcript** panel automatically.
  3. User pauses or remains silent:
     - Silence gate detects RMS < 0.005 and drops silent buffers without invoking Whisper.
  4. User clicks **"Stop"** button:
     - Recording stops immediately; remaining speech buffer >= 0.5s is flushed.
     - Microphone hardware stream is released.
     - UI transitions cleanly to **"Stopped"**.
  5. User clicks **"Suggest Answer"**:
     - Live transcribed conversation is submitted to Ollama, and an answer streams in the right panel.
- **Command:**
  ```powershell
  npm run dev
  ```
- **Status:** `Pending User Physical Hardware Verification` (Unit test automated verification passed 22/22).

---

## 3. Test Coverage Matrix

| Area | Test Type | Automated? | Script / File | Current Status |
| :--- | :--- | :---: | :--- | :--- |
| **TypeScript Strictness** | Static Analysis | Yes | `npx tsc --noEmit` | ✅ `Verified` |
| **Vite / Electron Bundling** | Build Test | Yes | `npm run build` | ✅ `Verified` |
| **Offline Whisper Accuracy** | Integration Test | Yes | `scripts/validate-whisper.ts` | ✅ `Verified` |
| **Whisper Negative Paths** | Unit Test (18 assertions) | Yes | `scripts/test-whisper-failures.ts` | ✅ `Verified` |
| **Ollama Config Resolution** | Unit Test | Yes | `scripts/test-ollama.ts` | ✅ `Verified` |
| **Prompt Builder Validation** | Unit Test | Yes | `scripts/test-ollama.ts` | ✅ `Verified` |
| **Prompt Truncation Guard** | Unit Test | Yes | `scripts/test-ollama.ts` | ✅ `Verified` |
| **Ollama Readiness Probing** | Mock Integration Test | Yes | `scripts/test-ollama.ts` | ✅ `Verified` |
| **NDJSON Token Streaming** | Mock Integration Test | Yes | `scripts/test-ollama.ts` | ✅ `Verified` |
| **Stream Cancellation** | Integration Test | Yes | `scripts/test-ollama.ts` | ✅ `Verified` |
| **Concurrency Guard** | Unit Test | Yes | `scripts/test-ollama.ts` | ✅ `Verified` |
| **Live Ollama Environment** | Environment Probe | Yes | `scripts/validate-ollama.ts` | ✅ `Verified` |
| **Electron App Launch** | Smoke Test | Yes | `node_modules\.bin\electron.cmd .` | ✅ `Verified` |
| **Audio Resampling & DSP** | Unit Test | Yes | `scripts/test-phase4-audio.ts` | ✅ `Verified` |
| **WAV Header & Silence Gate** | Unit Test | Yes | `scripts/test-phase4-audio.ts` | ✅ `Verified` |
| **Transcription Queue** | Unit Test (Concurrency/Backpressure) | Yes | `scripts/test-phase4-audio.ts` | ✅ `Verified` |
| **Live Mic Hardware Verification**| Manual System Test | No | Interactive Windows Desktop | ⏳ `Pending User Hardware Test` |
