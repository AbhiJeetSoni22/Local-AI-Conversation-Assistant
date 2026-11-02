# Changelog: Local AI Conversation Assistant

All notable changes, architectural implementations, and verification milestones for this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Phase 5: End-to-End Stabilization] - 2026-11-02

### Added
- **Dynamic Service Readiness & Status Re-check (`src/App.tsx`, `src/index.css`)**:
  - Implemented `checkReadiness()` querying both `window.electronApi.getWhisperReadiness()` and `window.electronApi.getOllamaReadiness()` concurrently.
  - Added a dedicated "Re-check" telemetry action in the top header and action buttons inside both Whisper and Ollama warning notice boxes.
  - Clear previous error banners automatically when runtimes transition to `Ready`.
- **Transcript Review & In-Place Editing (`src/App.tsx`, `src/index.css`)**:
  - Added full transcript editing mode toggled via "Edit" / "Done" action button in the Conversation Transcript panel header.
  - Renders a styled, responsive dark textarea enabling users to inspect, correct, or refine transcribed text (e.g., phonetic misrecognitions like "link chain" -> "LangChain") prior to AI submission.
  - Edited text is passed directly into Ollama's `startAnswerGeneration` and prompt builder without aggressive auto-correction bias.
- **Ollama Error Recovery & Retry Flow (`src/App.tsx`, `src/index.css`)**:
  - Preserved conversation transcript across all Ollama generation failures, timeouts, and network interruptions.
  - Added dedicated error presentation card inside the AI Suggested Answer panel featuring a primary "Retry Answer" action button that re-submits the existing transcript without requiring re-recording.
  - Dismiss button allows clearing the error card without affecting transcript content.
- **Strict UI State Machine & Telemetry Cluster (`src/App.tsx`, `src/index.css`)**:
  - Re-mapped active session telemetry to 7 explicit, non-contradictory states: `Ready`, `Recording`, `Transcribing`, `Generating`, `Completed`, `Error`, and `Cancelled`.
  - Added customized visual badges, pulsing animations, and contextual action bar hints for each state.
  - Enforced mutual exclusion: `Start` is disabled when listening, transcribing, generating, or when Whisper is unavailable; `Suggest Answer` is disabled while recording, transcribing, generating, when transcript is empty, or when Ollama is unavailable.
- **Automated Phase 5 Test Suite (`scripts/test-phase5-stabilization.ts`)**:
  - Implemented 42 unit and integration tests across 5 test suites covering dynamic health checks, audio lifecycle/boundary handling, transcript editing invariance, failure recovery and retry, and state transition mutual exclusion.
  - Registered `"test:phase5"` command in `package.json`.

### Verified
- `npx tsc --noEmit`: 0 errors.
- `npm run test:phase5`: 42 / 42 passed.
- `npm run test:whisper`: 18 / 18 passed.
- `npm run test:audio`: 22 / 22 passed.
- `npm run test:ollama`: 36 / 36 passed.
- `npm run test:accuracy`: 46 / 46 passed.
- `npm run test:pipeline`: 98 / 98 passed.
- `npm run build`: built production bundles cleanly in 2.3s.

---

## [Phase 4: Transcription Pipeline Regression Fix] - 2026-11-02

> Status: automated and synthetic-audio verification complete. **Real-microphone and real-Whisper verification is pending** on the user's Windows machine (see `TESTING_AND_VALIDATION.md` section 3). The single root cause of the user's three reported transcripts is **not** conclusively proven; see `IMPLEMENTATION_STATUS.md` Observation 3.

### Fixed
- **Resampler (`src/audio/resampler.ts`)**: replaced per-128-sample-block stateless resampling with a stateful windowed-sinc `StreamingResampler`. Measured before/after (10 s tones, 128-sample blocks): 48 kHz output 161250 -> 160000 samples, 1 kHz tone 992.25 -> 1000.00 Hz, SDR 25.8 -> 111 dB, 10 kHz alias leak -12.5 -> -44.9 dB; 44.1 kHz 158485 -> 160000 samples, 1009.55 -> 1000.00 Hz, SDR 12.0 -> 111 dB, leak -7.1 -> -48.6 dB.
- **Chunking (`src/audio/speechSegmenter.ts`, `chunkPipeline.ts`, `audioRecorder.ts`)**: blind 3.0 s cuts replaced by pause-aligned utterance segments with pre-roll/trailing pad, click/breath rejection and quiet-point splitting; non-speech is no longer sent to Whisper. Legacy behaviour available as `segmentation: 'fixed'`. Final chunk is emitted exactly once.
- **Transcript accumulation (`src/audio/transcriptAccumulator.ts`, `src/App.tsx`)**: identity-based guard (session + strictly increasing chunk index) replaces the `endsWith` text comparison that dropped genuinely repeated speech.
- **Queue (`src/audio/transcriptionQueue.ts`)**: duplicate `(session, chunk)` submissions ignored; dropped chunks counted.
- **Suggest Answer race (`src/App.tsx`)**: disabled while any chunk is transcribing or queued, so answers are not built from a truncated transcript.
- **Whisper output cleaning (`electron/vocabularyConfig.ts`)**: removed the regex deny-list that deleted genuine speech ("the channel is called ...", "thanks for watching", trailing "happy?"). Now strips only non-speech annotations and trims a decoder repetition loop (>= 8 identical words / >= 5 repeats of a 2-4 word phrase) to one occurrence. Raw and cleaned text are kept separate (`TranscriptionResult.rawText`).
- **Logging (`electron/main.ts`, `electron/whisperService.ts`, renderer)**: transcript text is no longer logged in non-production runs. `DEBUG_AUDIO=1` logs metadata only; text additionally requires `DEBUG_WHISPER_TEXT=1`.
- **`WhisperService.transcribe`**: input audio is validated (and silence short-circuited) before the Whisper environment check.
- **Ollama prompt (`electron/promptBuilder.ts`)**: removed the rule tailored to YouTube/subscription artefacts; new general imperfect-transcript policy (answer clear questions directly, disclose a corrected-term assumption briefly, one short clarification only if genuinely ambiguous, no echoing of garbled fragments). Not verified against a live model.

### Changed
- Whisper CLI arguments are produced by one tested function (`buildWhisperCliArgs`): `-m -f -oj -of -t -np` [+ `--prompt` only when configured]. No decoder flags. Flags confirmed to exist in current whisper.cpp source; the user's installed build is probed by `npm run diagnose:whisper`.
- The technical-vocabulary prompt remains OFF by default and is now an explicit opt-in (`WHISPER_USE_VOCAB_PROMPT=1`).

### Added
- `scripts/test-pipeline-regression.ts` (`npm run test:pipeline`, 119 assertions), `scripts/analyze-resampler.ts` (`npm run analyze:resampler`), `scripts/diagnose-whisper.ts` (`npm run diagnose:whisper`), `scripts/make-speech-fixtures.ps1`.
- Opt-in numeric capture diagnostics (AudioContext rate, DSP flags actually applied).

### Documentation corrections
- Removed stale claims that `-sns`/`-nf`/`-nth` are enabled by default, that Stop "drains" the queue, that the filter is "non-destructive" while it deleted phrases, and the inconsistent assertion counts (44/47 vs actual 28).

### Not changed
Electron security settings, preload/IPC contracts, microphone permission flow, Start/Stop lifecycle, UI design, local-only architecture, models.

---

## [Phase 4: Transcription Accuracy & Decoding Stabilization] - 2026-11-01

### Reverted & Stabilized
- **Reverted Problematic Decoding Flags (`-sns`, `-nf`, `-nth` in `electron/whisperService.ts`, `electron/whisperConfig.ts`)**:
  - Controlled A/B diagnosis proved that combining `-sns` (suppress non-speech tokens) and `-nf` (no fallback) caused catastrophic runaway repetition loops on silence or ambient room noise (`"All right, that's it, all right, all right..."`, `"bye bye bye bye bye..."`). Because `-sns` masked `[BLANK_AUDIO]` and `(whirring)` tokens, Whisper was forced to emit words, and `-nf` prevented temperature fallback from breaking greedy repetition loops.
  - Reverted CLI arguments to clean baseline: `-m <model> -f <wav> -oj -of <prefix> -t <threads> -np`.
  - Reverted `initialPrompt` default to empty (`''` / `process.env.WHISPER_INITIAL_PROMPT`).
  - Restored client-side RMS silence threshold in `src/audio/wavEncoder.ts` and `src/audio/audioRecorder.ts` to baseline `0.005`.
- **Preserved Speech-Aware Prompt & Relevance Improvements (`electron/promptBuilder.ts`, `electron/ollamaService.ts`)**:
  - Retained speech-aware system prompt instructions that infer speaker intent and allow domain knowledge for concepts like LangChain, avoiding the strict Phase 3 literal transcript grounding restriction.
- **Preserved Marker Cleaning (`electron/vocabularyConfig.ts`)**:
  - Retained non-destructive marker filtering (`filterWhisperMarkers`) to strip acoustic markers (`[BLANK_AUDIO]`, `[MUSIC]`, `(applause)`, `(whirring)`) without altering spoken words.
- **Preserved Dev Diagnostics**:
  - Retained raw vs cleaned text logging in development and debug modes (`DEBUG_AUDIO=1`).
- **Ollama Answer Relevance & Speech-Aware Grounding (`electron/promptBuilder.ts`, `electron/ollamaService.ts`)**:
  - Identified root cause of irrelevant LLM responses: previous prompt framing forbade external knowledge (`"Base your response EXCLUSIVELY on the provided conversation transcript. Do NOT cite external knowledge..."`), forcing Ollama to respond only to hallucinated transcript words rather than explaining LangChain.
  - Replaced prompt framing with speech-aware instructions: explicitly recognizes real-time speech-to-text input, infers speaker's true intent, applies domain knowledge to answer technical questions directly and concisely (2–4 sentences), and completely ignores stray speech artifacts or video outro chatter.
  - Passed prompt options through `OllamaService.generateStreaming(transcript, onChunk, options)`.
- **Deduplication & Developer Observability (`src/App.tsx`, `electron/main.ts`)**:
  - Prevented appending duplicate transcript chunks across consecutive segment updates.
  - Added developer diagnostics logging for audio chunks, RMS energy, and raw vs cleaned Whisper output.
- **Validation Suite (`scripts/test-transcription-accuracy.ts`, `scripts/test-ollama.ts`)**:
  - Expanded accuracy suite to 44 automated assertions: validates marker filtering, YouTube boilerplate removal, live audio recognition of "LangChain" in question phrasing, domain concept "vector database", non-technical control "link chain" (verified zero false positives), silence handling, and Ollama answer relevance on speech transcripts.
  - All 4 test suites passing: `test:accuracy` (44/44), `test:whisper` (18/18), `test:audio` (22/22), `test:ollama` (36/36).

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
- **Technical Vocabulary & Initial Prompt Context (`electron/vocabularyConfig.ts`, `electron/whisperConfig.ts`)**:
  - Implemented configurable initial prompt mechanism using whisper.cpp's `--prompt` CLI flag and multipart server option.
  - Provided default technical vocabulary (LangChain, LLM, RAG, Retrieval-Augmented Generation, Python, JavaScript, TypeScript, React, FastAPI, API, Ollama, Whisper, Machine Learning, Deep Learning, Neural Network, Embeddings, Vector Database, Transformer, NLP).
  - Added environment variable overrides: `WHISPER_INITIAL_PROMPT`, `WHISPER_EXTRA_VOCABULARY`, `WHISPER_DISABLE_PROMPT`.
  - Added non-speech token suppression (`-sns` / `WHISPER_SUPPRESS_NST`).
- **Internal Whisper Marker Filtering (`electron/vocabularyConfig.ts`, `electron/whisperService.ts`)**:
  - Added `filterWhisperMarkers()` regex engine stripping `[BLANK_AUDIO]`, `[MUSIC]`, `[SILENCE]`, `(applause)`, and other acoustic annotations from user-facing transcripts.
  - Blank-only chunks automatically resolve to `""` with `isSilent: true`, completely eliminating `[BLANK_AUDIO]` from the visible UI transcript.
- **Accuracy & Marker Regression Suite (`scripts/test-transcription-accuracy.ts`)**:
  - Built 47-assertion test suite validating marker filtering, prompt configuration, and comparative end-to-end Whisper transcription across 5 synthetic 16kHz speech fixtures.
  - Added `"test:accuracy": "tsx scripts/test-transcription-accuracy.ts"` script in `package.json`.

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
