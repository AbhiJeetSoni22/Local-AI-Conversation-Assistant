# Application Flow & State Machine

This document outlines the complete operational lifecycle of the **Local AI Conversation Assistant**, detailing the **implemented behavior (Phase 1 through Phase 4)** and the **intended prompt engineering and end-to-end polish (Phase 5)**.

---

## 1. End-to-End Pipeline & Phase Mapping

The diagram below illustrates the full lifecycle from launch to answer generation, indicating implementation status across phases:

```text
Application Launch
    ↓ [Phase 1, 2, 3 & 4: IMPLEMENTED]
Runtime & Model Readiness Check (Whisper + Ollama)
    ↓ [Phase 2 & 3: IMPLEMENTED]
User Clicks "Start"
    ↓ [Phase 4: IMPLEMENTED & TESTED]
Microphone Audio Capture (getUserMedia + AudioWorklet)
    ↓ [Phase 4: IMPLEMENTED & TESTED]
Audio Resampling (16 kHz, 16-bit Mono PCM)
    ↓ [Phase 4: IMPLEMENTED & TESTED]
Audio Chunking (3.0s window) & Client Silence Rejection (RMS < 0.005)
    ↓ [Phase 4: IMPLEMENTED & TESTED]
Sequential Transcription Queue & Backpressure Capping (Depth 3)
    ↓ [Phase 4: IMPLEMENTED & TESTED]
Typed IPC Transfer to Main Process (whisper:transcribe-chunk)
    ↓ [Phase 2 & 4: IMPLEMENTED & TESTED]
Local whisper.cpp Speech-to-Text Inference
    ↓ [Phase 4: IMPLEMENTED & TESTED]
Live Transcript Progressive Appending in Left Panel
    ↓ [Phase 4: IMPLEMENTED & TESTED]
User Clicks "Suggest Answer"
    ↓ [Phase 3: IMPLEMENTED & VERIFIED]
Prompt Construction with Strict Anti-Hallucination Framing
    ↓ [Phase 3: IMPLEMENTED & VERIFIED]
Local Ollama LLM Streaming (Qwen 2.5:3b)
    ↓ [Phase 3: IMPLEMENTED & VERIFIED]
Progressive Token Streaming in Right Panel (with Cancel Support)
    ↓ [Phase 3: IMPLEMENTED & VERIFIED]
Completed Suggested Answer & Metadata
```

---

## 2. Implemented State Model (Phase 1, 2, 3, & 4)

The application tracks four key state dimensions in `src/App.tsx`:

### 1. Application Execution State (`status` & `isTranscribing`)
Controls the primary UI controls and button accessibility:
- **`Idle`**: Initial state upon application launch.
  - Buttons: `Start` is enabled; `Stop` is disabled; `Suggest Answer` is disabled until transcript exists and Ollama is ready.
  - Panels: Live Transcript shows empty-state prompt with "Load Sample Meeting Transcript" utility; Suggested Answer shows empty-state prompt.
- **`Listening`**: Entered when user clicks `Start`.
  - Action: Microphone capture is active. Audio is sampled, resampled to 16 kHz mono, buffered into 3.0-second intervals, encoded into WAV, and queued for Whisper transcription.
  - Indicators: Shows emerald "Listening" status badge and animated audio equalizer wave. When Whisper is actively processing an audio chunk, a subtle "Transcribing audio..." spinner indicator activates.
  - Buttons: `Start` is disabled; `Stop` is enabled.
- **`Stopped`**: Entered when user clicks `Stop` or after generation finishes.
  - Action: Audio capture stops, remaining buffers >= 0.5s flush, media streams release, and in-flight queue items drain cleanly.
  - Buttons: `Start` is enabled; `Stop` is disabled.
- **`Generating`**: Entered when user clicks `Suggest Answer`.
  - Buttons: `Start`, `Stop`, and `Suggest Answer` are disabled; `Cancel Generation` button appears.
  - Panels: Suggested Answer displays purple streaming status badge, pulsing cursor, and progressively accumulating tokens.

### 2. Whisper Readiness State (`whisperStatus`)
Tracks local speech engine health:
- **`Checking`**: While Electron main queries environment paths.
- **`Ready`**: Executable (`whisper-cli.exe` or `whisper-server.exe`) and model (`ggml-base.en.bin`) are verified.
- **`Unavailable`**: Executable or model is missing or invalid. Actionable warning card is rendered.

### 3. Ollama Readiness State (`ollamaStatus`)
Tracks local LLM daemon and model availability:
- **`Checking`**: While Electron main queries `http://127.0.0.1:11434/api/version` and `/api/tags`.
- **`Ready`**: Ollama daemon is reachable and target model (`qwen2.5:3b`) is verified.
- **`Unavailable`**: Ollama daemon is offline or model is not pulled. An actionable warning card guides the user to install Ollama and run `ollama pull qwen2.5:3b`.

```mermaid
stateDiagram-v2
    [*] --> Idle: App Boot
    state AppStatus {
        Idle --> Listening: User clicks "Start"
        Listening --> Stopped: User clicks "Stop"
        Stopped --> Listening: User clicks "Start"
        Stopped --> Generating: User clicks "Suggest Answer"
        Idle --> Generating: User clicks "Suggest Answer" (Transcript loaded)
        Generating --> Stopped: Generation Completes or User Cancels
    }

    state Runtimes {
        WhisperChecking --> WhisperReady: Executable & Model Validated
        WhisperChecking --> WhisperUnavailable: Binary/Model Missing
        OllamaChecking --> OllamaReady: Ollama Online & qwen2.5:3b Found
        OllamaChecking --> OllamaUnavailable: Daemon Offline or Model Missing
    }
```

---

## 3. Streaming Suggest Answer Flow (Phase 3 Implemented Pipeline)

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React UI (App.tsx)
    participant Preload as Preload Bridge
    participant Main as Electron Main
    participant Svc as OllamaService
    participant Daemon as Ollama HTTP (:11434)

    User->>UI: Clicks "Suggest Answer"
    UI->>UI: Validate transcript not empty & Ollama is Ready
    UI->>UI: setStatus('Generating'), setIsGenerating(true)
    UI->>Preload: startAnswerGeneration(transcript)
    Preload->>Main: ipcRenderer.invoke('ollama:start-generation')
    Main->>Svc: generateStreaming(transcript, onChunk)
    Svc->>Svc: buildAnswerPrompt(transcript)
    Svc->>Daemon: POST /api/chat { model: 'qwen2.5:3b', stream: true }

    loop NDJSON Token Streaming
        Daemon-->>Svc: {"message":{"content":"token"}, "done": false}
        Svc->>Main: onChunk(token)
        Main->>Preload: sender.send('ollama:stream-chunk', { chunk })
        Preload->>UI: onOllamaChunk subscriber
        UI->>UI: Append token to suggestedAnswer
    end

    alt User clicks Cancel
        User->>UI: Clicks "Cancel Generation"
        UI->>Preload: cancelAnswerGeneration()
        Preload->>Main: ipcRenderer.invoke('ollama:cancel-generation')
        Main->>Svc: cancel() [AbortController.abort()]
        Svc-->>Main: Returns isCancelled=true
        Main->>Preload: sender.send('ollama:stream-cancelled')
        Preload->>UI: onOllamaCancelled subscriber
        UI->>UI: setIsGenerating(false), show "Generation Cancelled"
    else Stream finishes normally
        Daemon-->>Svc: {"done": true}
        Svc-->>Main: Returns { fullText, durationMs, model }
        Main->>Preload: sender.send('ollama:stream-done', meta)
        Preload->>UI: onOllamaDone subscriber
        UI->>UI: setIsGenerating(false), show duration and model meta
    end
```

---

## 4. Live Audio Capture & Speech-to-Text Pipeline (Phase 4 Implemented Flow)

The Phase 4 audio pipeline enables local, real-time microphone capture and progressive transcription:

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React UI (App.tsx)
    participant Rec as AudioRecorder (Renderer)
    participant Queue as TranscriptionQueue (Renderer)
    participant Preload as Preload Bridge
    participant Main as Electron Main Process
    participant Whisper as WhisperService (whisper-cli.exe)

    User->>UI: Clicks "Start"
    UI->>UI: setStatus('Listening'), clear previous errors
    UI->>Rec: start(onChunk)
    Rec->>Rec: navigator.mediaDevices.getUserMedia({ audio: true })
    Rec->>Rec: AudioContext + inline AudioWorklet (downmix & resample to 16 kHz)

    loop Continuous Audio Capture (Every 3.0 Seconds)
        Rec->>Rec: Accumulate 48,000 samples @ 16 kHz mono
        Rec->>Rec: encodeWav16kMono(samples)
        alt RMS < 0.005 (Silence Detected)
            Note over Rec: Discard silent chunk locally (Zero IPC / Zero CPU STT)
        else Speech Detected (RMS >= 0.005)
            Rec->>Queue: enqueue(wavBytes)
            alt Queue Depth > 3 (Backpressure)
                Note over Queue: Drop oldest pending chunk to prevent CPU overload
            end
            Queue->>UI: onStateChange(isTranscribing: true)
            Queue->>Preload: transcribeAudioChunk(wavBytes)
            Preload->>Main: ipcRenderer.invoke('whisper:transcribe-chunk', wavBytes)
            Main->>Main: validateWavBuffer(wavBuffer)
            Main->>Whisper: transcribe(wavBuffer)
            Whisper-->>Main: Returns { text, durationMs, isSilent: false }
            Main-->>Preload: Returns TranscriptionChunkResult
            Preload-->>Queue: Resolve chunk transcription
            alt Session ID matches active recording session
                Queue->>UI: onChunkTranscribed(text)
                Note over UI: Append text to Live Transcript with auto-scroll
            else Session ID is stale (user clicked Stop/Restart)
                Note over Queue: Discard text from superseded session
            end
            Queue->>UI: onStateChange(isTranscribing: queue.isProcessing())
        end
    end

    User->>UI: Clicks "Stop"
    UI->>Rec: stop()
    Rec->>Rec: Check pending buffer: if >= 0.5s (8,000 samples), flush as final chunk
    Rec->>Rec: Stop MediaStream tracks & close AudioContext
    UI->>Queue: drain() (finish any actively transcribing chunk)
    Queue-->>UI: Drain complete
    UI->>UI: setStatus('Stopped'), setIsTranscribing(false)
```

### Detailed Lifecycle Steps:
1. **Microphone Acquisition**: The renderer calls `navigator.mediaDevices.getUserMedia` with constraint flags: mono channel (`channelCount: 1`), browser acoustic echo cancellation (`echoCancellation: true`), background noise suppression (`noiseSuppression: true`), and automatic gain control (`autoGainControl: true`).
2. **AudioWorklet Processing**: Samples are captured on the high-priority Web Audio rendering thread via an inline `AudioWorkletNode`. If the hardware sample rate is not 16,000 Hz (typically 48,000 Hz or 44,100 Hz), the samples are resampled to exactly 16 kHz using linear interpolation.
3. **Window Buffering**: The recorder accumulates samples until a 3.0-second chunk window is reached (`48,000` samples at 16 kHz).
4. **Silence Gating**: Each chunk is evaluated for Root-Mean-Square (RMS) amplitude. Buffers with RMS < 0.005 (e.g. ambient background room silence) are immediately discarded without invoking IPC or launching `whisper-cli.exe`.
5. **WAV Serialization**: Samples are converted from IEEE Float32 to 16-bit signed integer linear PCM (`pcm_s16le`) and wrapped in a canonical 44-byte RIFF/WAVE header.
6. **Sequential Execution & Backpressure**: `TranscriptionQueue` ensures only one chunk is sent to Whisper at any given time. If transcription latency causes queue depth to exceed 3 pending chunks, older chunks are safely dropped to prevent latency drift and memory buildup.
7. **Clean Session Teardown**: Clicking "Stop" releases hardware mic tracks, closes the `AudioContext`, flushes any remaining speech buffer exceeding 0.5s (`8,000` samples), and drains active in-flight requests. Stale chunks from previous recording sessions are invalidated by a monotonically incremented `sessionId`.
