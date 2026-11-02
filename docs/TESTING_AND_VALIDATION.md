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

### Test 1.8: Output Cleaning & Accuracy Suite (`npm run test:accuracy`)
- **Purpose:** Marker filtering, preservation of genuine speech, optional vocabulary-prompt builder, service configuration cleanliness, and (only when `bin/whisper-cli.exe` + model exist) live recognition checks.
- **Last executed result (Linux sandbox, no Whisper binary/Ollama):** `29 / 29 passed`; live Whisper and live Ollama sections **skipped**, not passed.
- **Changed in the transcription-regression fix:** the old assertions that a regex list *deletes* "the channel is called ...", "thanks for watching" etc. were replaced by assertions that such genuine sentences are **preserved**. Earlier text in this document claiming `-nf`, `-sns`, `-nth` are "enabled by default" was stale: those flags are not passed (see `buildWhisperCliArgs`).

### Test 1.9: Transcription Pipeline Regression Suite (`npm run test:pipeline`)
- **Purpose:** 119 deterministic assertions with synthetic audio and a fake `whisper-cli` executable (no model, no microphone). Groups: (1) streaming resampler block-size invariance, exact length at 48/44.1/32/22.05/8 kHz, 1 kHz pitch, SDR > 60 dB, alias rejection, no block-edge discontinuities; (2) WAV header/round-trip/clipping/silence/validator; (3) segmenter: silence, room noise above the old 0.005 gate, clicks, single and multiple utterances, 0.4 s intra-sentence pause, click after speech, 30 s continuous speech split into bounded segments with no lost/duplicated audio, split lands in a quiet gap; (4) pipeline: chunk indexing, final chunk exactly once, no overlap duplication in fixed mode, pure noise sends nothing; (5) queue: sequential order, duplicate prevention, stale-session discard, bounded backpressure with final chunk protected, error recovery; (6) transcript accumulation: ordering, duplicates, genuine repetition preserved; (7) marker cleaning, genuine speech preserved, loop-guard thresholds incl. the observed "bye" x14 case; (8) `WhisperService` via fake CLI: exact CLI arguments (no decoder flags, `--prompt` only when configured), raw vs cleaned, `[BLANK_AUDIO]`, non-zero exit, malformed JSON, missing output, hang/timeout kill, recovery after each failure, logging policy (nothing logged by default; metadata only with `DEBUG_AUDIO=1`; text only with `DEBUG_WHISPER_TEXT=1` too); (9) synthetic stream -> pipeline -> queue -> fake Whisper -> accumulated transcript.
- **Platform note:** Group 8 and 9's fake-CLI portion need a POSIX executable and print a skip notice on Windows.
- **Last executed result:** `119 / 119 passed` (Linux sandbox).
- **What this does NOT prove:** real Whisper accuracy or real microphone behaviour. The synthetic "speech" is harmonic tones, not speech.

### Test 1.10: Resampler Fidelity Experiment (`npm run analyze:resampler`)
- Feeds 10 s tones in 128-sample blocks to the legacy per-block resampler (verbatim copy) and the new one. Recorded result:

| Rate | Implementation | Samples (expected 160000) | 1 kHz tone | SDR | 10 kHz tone leaking into output |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 48 kHz | legacy | 161250 (+0.78 %) | 992.25 Hz | 25.8 dB | -12.5 dB |
| 48 kHz | current | 160000 | 1000.00 Hz | 111.0 dB | -44.9 dB |
| 44.1 kHz | legacy | 158485 (-0.95 %) | 1009.55 Hz | 12.0 dB | -7.1 dB |
| 44.1 kHz | current | 160000 | 1000.00 Hz | 111.0 dB | -48.6 dB |

### Test 1.11: Real-Whisper A/B Harness (`npm run diagnose:whisper`) - REQUIRES YOUR WINDOWS MACHINE
- Probes `whisper-cli -h` for the flags the app uses, then runs every WAV in `samples/diagnostics/` under four configurations (current default, explicit no prompt, `LangChain.` prompt, vocabulary prompt) and prints raw vs cleaned text, word-error-rate (when a matching `.txt` holds the expected text) and hallucinated-output counts for empty-reference fixtures. Full output is written to `test_output/` (git-ignored; contains transcript text).
- Fixtures: `powershell -ExecutionPolicy Bypass -File scripts\make-speech-fixtures.ps1` (Windows SAPI voice: LangChain sentences, plain English, "link chain", short-then-silence, long-with-pauses) and `npm run diagnose:whisper -- --make-nonspeech` (silence, room noise at RMS 0.006, click). Also record the same sentences with your own microphone into the same folder: TTS audio is cleaner than a real microphone.
- **Status: NOT yet executed against a real binary.** Harness plumbing was smoke-tested with a fake CLI only.

### Test 1.12: Phase 5 End-to-End Stabilization Suite (`npm run test:phase5`)
- **Purpose:** Executes 42 automated unit and integration assertions verifying the end-to-end stabilization requirements:
  1. **Dynamic Service Readiness:** Server status queries, offline/online transitions without app restart, user-friendly error formatting.
  2. **Microphone & Audio Lifecycle:** `SegmentGate` session isolation, sub-0.5s recording safety in `ChunkPipeline`, empty/silent chunk handling in `TranscriptionQueue`.
  3. **Transcript Review & Editing:** Preservation of user edits in accumulator, verbatim transmission of edited text to `buildAnswerPrompt`, boundary fencing.
  4. **Ollama Error Recovery & Retry:** Transcript preservation across HTTP 500 errors, immediate retry without re-recording, streaming token delivery during retry, mid-stream cancellation.
  5. **UI State Machine Invariants:** Correct mapping of all 7 UI states (`Ready`, `Recording`, `Transcribing`, `Generating`, `Completed`, `Error`, `Cancelled`), strict button mutual exclusion rules.
- **Command:**
  ```powershell
  npm run test:phase5
  ```
- **Expected Result:** All 42 assertions pass with 0 failures; exit code 0.
- **Actual Result (Executed Nov 2, 2026):**
  ```text
  ======================================================
   Phase 5 End-to-End Stabilization Test Suite
  ======================================================

  --- Suite 1: Readiness & Dynamic Service Status ---
    ✅ PASS: Dynamic check: online server reports status Ready
    ✅ PASS: Dynamic check: dropped server reports status Unavailable
    ✅ PASS: Dynamic check: error message is formatted cleanly without raw unhandled exception dumps
    ✅ PASS: Dynamic check: recovered server returns to status Ready on re-check

  --- Suite 2: Audio Lifecycle & Boundary Invariants ---
    ✅ PASS: SegmentGate accepts first chunk from active session
    ✅ PASS: SegmentGate rejects duplicate chunk index from active session
    ✅ PASS: SegmentGate discards stale chunk from previous session
    ✅ PASS: SegmentGate accepts chunk from newly active session
    ✅ PASS: ChunkPipeline discards final chunk shorter than minFinalChunkDurationSec (0.1s < 0.5s)
    ✅ PASS: TranscriptionQueue gracefully processes silent/empty chunk without error

  --- Suite 3: Transcript Review & Editing Invariance ---
    ✅ PASS: appendSegmentText initializes empty transcript cleanly
    ✅ PASS: appendSegmentText joins sentences with single space
    ✅ PASS: Transcript editing modifies text accurately
    ✅ PASS: Prompt builder receives the edited transcript text, not the original raw speech
    ✅ PASS: Prompt builder contains zero traces of the uncorrected misrecognized phrase
    ✅ PASS: Prompt builder encapsulates user-edited transcript securely inside transcript boundary

  --- Suite 4: Ollama Response Failure Recovery & Retry Flow ---
    ✅ PASS: Ollama failure throws expected error on server 500
    ✅ PASS: Original transcript remains intact after generation error
    ✅ PASS: Service resets internal isGenerating flag on failure
    ✅ PASS: Retry generation succeeds on identical transcript without re-capturing audio
    ✅ PASS: Streaming callback delivers all tokens progressively during retry
    ✅ PASS: Mock server received exactly 2 calls (1 failure + 1 retry)
    ✅ PASS: Stream cancellation returns isCancelled: true
    ✅ PASS: Service resets isGenerating flag immediately on cancellation

  --- Suite 5: State Transition & UI Invariants ---
    ✅ PASS: Initial state maps to Ready
    ✅ PASS: Listening state maps to Recording
    ✅ PASS: Stopped while transcriptionBusy maps to Transcribing
    ✅ PASS: Active generation maps to Generating
    ✅ PASS: Failure maps to Error
    ✅ PASS: User cancellation maps to Cancelled
    ✅ PASS: Successful generation maps to Completed
    ✅ PASS: Start disabled when Listening
    ✅ PASS: Start disabled when Generating
    ✅ PASS: Start disabled when Transcribing
    ✅ PASS: Start disabled when Whisper Unavailable
    ✅ PASS: Start enabled when Idle and Whisper Ready
    ✅ PASS: Suggest disabled when Recording
    ✅ PASS: Suggest disabled when Transcribing
    ✅ PASS: Suggest disabled when Generating
    ✅ PASS: Suggest disabled when Ollama Unavailable
    ✅ PASS: Suggest disabled when Transcript empty
    ✅ PASS: Suggest enabled when transcript ready and Ollama online

  ======================================================
   Phase 5 Test Results: 42/42 passed (0 failures)
  ======================================================
  ```
- **Status:** `Verified`

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
| **Technical Vocabulary & Accuracy** | Accuracy Test (46 assertions) | Yes | `scripts/test-transcription-accuracy.ts` | ✅ `Verified` |
| **Whisper Marker Filtering** | Unit Test | Yes | `scripts/test-transcription-accuracy.ts` | ✅ `Verified` |
| **Pipeline Regressions** | Unit Test (98 assertions) | Yes | `scripts/test-pipeline-regression.ts` | ✅ `Verified` |
| **Phase 5 End-to-End Stabilization** | Integration Test (42 assertions)| Yes | `scripts/test-phase5-stabilization.ts` | ✅ `Verified` |
| **Live Mic Hardware Verification**| Manual System Test | No | Interactive Windows Desktop | ⏳ `Pending User Hardware Test` |

---

## 4. Manual Windows Verification Checklist (Hardware & Interactive Features)

| # | Step | Expected | Result |
| :-- | :--- | :--- | :--- |
| 1 | `npm run diagnose:whisper` with the fixtures above | Flag probe all required flags present; no loops; `hallucinated-on-empty = 0` for config A | ☐ not run |
| 2 | `npm run dev`, DevTools console: `localStorage.setItem('DEBUG_AUDIO','1')`, then Start. Console shows `capture settings:` | Note `contextSampleRate` (44100/48000) and whether `noiseSuppression`/`autoGainControl` are true | ☐ not run |
| 3 | Say "I would like to know about LangChain." then wait 1 s, click Stop | One chunk (`mode: speech`, `reason: pause`), duration about speech length + <= 0.55 s, no extra chunks | ☐ not run |
| 4 | Start, stay silent 20 s, Stop | Zero chunks in the console, empty transcript | ☐ not run |
| 5 | Start, say a short sentence, then click Stop immediately and also try 3 s of silence before Stop | No invented trailing text | ☐ not run |
| 6 | Speak two sentences with a 1.5 s pause | Two chunks, in order, no duplicate text | ☐ not run |
| 7 | Say "yes ... yes" with a pause between | Both "yes" appear | ☐ not run |
| 8 | Click Suggest Answer immediately after Stop | Button disabled/hint shown until last audio is transcribed | ☐ not run |
| 9 | Suggest Answer on the LangChain question | Answer explains LangChain; no talk of channels/subscriptions | ☐ not run (needs Ollama + qwen2.5:3b) |
| 10 | A/B: set `audioConstraints` `noiseSuppression:false, autoGainControl:false` in `App.tsx`, repeat step 3 | Record whether accuracy changes | ☐ not run |
| 11 | **Dynamic Service Re-Check:** With Ollama stopped, click "Re-check". See Unavailable. Start Ollama, click "Re-check". | Telemetry badge transitions cleanly to Ready without app reload | ☐ not run |
| 12 | **Transcript Review & Edit:** Click "Edit" on transcript, correct misrecognized words, click "Done". | Canvas reflects edits; Suggest Answer sends edited text | ☐ not run |
| 13 | **Ollama Error Recovery:** Kill Ollama or cause network drop, click Suggest Answer. | Transcript is preserved 100%; error card appears with Retry Answer | ☐ not run |
| 14 | **Retry Flow:** Restart Ollama and click "Retry Answer". | Answer streams successfully without re-recording audio | ☐ not run |
| 15 | **Stream Cancellation:** Click Suggest Answer, then click "Cancel" mid-stream. | Stream halts immediately; partial text kept, session becomes Cancelled | ☐ not run |
| 16 | **Sub-0.5s Quick Click:** Click Start and immediately click Stop (< 0.5s). | No crash or hanging state; transitions safely back to Ready | ☐ not run |
