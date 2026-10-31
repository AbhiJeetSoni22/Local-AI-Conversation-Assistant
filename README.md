# Local AI Conversation Assistant (Windows)

A desktop conversational assistant built with **Electron**, **React**, **TypeScript**, and **Vite**, designed for 100% local-first AI processing on Windows.

---

## Current Status: Phase 2 Whisper Foundation Active

This repository currently implements **Phase 1 (Scaffold)** and **Phase 2 (Whisper.cpp Local Speech-to-Text Foundation)**:

- ✅ **Desktop Scaffold**: Electron + React 18 + TypeScript + Vite.
- ✅ **Strict Process Isolation**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, typed preload IPC bridge.
- ✅ **Local Whisper.cpp Integration Foundation**:
  - Typed Whisper configuration and path resolution supporting project conventions and environment variables.
  - Strict WAV input validation (RIFF header, PCM format, 16 kHz sample rate, 16-bit depth, duration checks, silence handling).
  - Main process typed `WhisperService` with full lifecycle management (zero orphan child processes on shutdown).
  - Standalone validation script (`scripts/validate-whisper.ts`) verifying real local inference on sample audio without UI.
  - Comprehensive negative failure and reliability test suite (`scripts/test-whisper-failures.ts`).
  - UI readiness indicator (`Checking`, `Ready`, `Unavailable`) displaying clear actionable setup instructions if binary/model is missing.

> ⚠️ **Strict Boundary Notice**:
> - **Phase 3 (Ollama / Local LLM)**: NOT yet implemented.
> - **Phase 4 (Microphone Audio Capture, AudioWorklet, live streaming)**: NOT yet implemented.
> - The Start/Stop buttons remain temporary scaffold transitions until Phase 4 live audio capture is connected.

---

## Supported Windows Environment

- **Operating System**: Windows 10 / Windows 11 (64-bit x64 architecture)
- **Node.js**: v20 or v22 LTS (tested on Node v22.23.2)
- **npm**: v10+
- **Hardware**: CPU inference (AVX2 / Alderlake / Haswell instructions natively supported by whisper.cpp)

---

## Whisper.cpp Runtime & Model Requirements

To preserve local privacy and prevent unintended network transfers, **the application never silently downloads binaries or models**. You must manually place the verified executable and model files in their designated directories.

### 1. Verified Release & Files

| Component | Source / Release | Target Location |
| :--- | :--- | :--- |
| **Executables & DLLs** | `whisper.cpp` Release **v1.9.2** (`whisper-bin-x64.zip`)<br>[GitHub Official Release](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.2) | `./bin/` |
| **Model** | `ggml-base.en.bin` (~147.4 MB)<br>[Hugging Face Official Model](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin) | `./models/ggml-base.en.bin` |
| **Sample Audio** | `jfk.wav` (16kHz, 16-bit, Mono PCM, Public Domain)<br>[whisper.cpp sample repository](https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/samples/jfk.wav) | `./samples/jfk.wav` |

*(Note: `bin/`, `models/`, and `samples/*.wav` are ignored by `.gitignore` and are not committed to source control).*

---

## Manual Setup Instructions

Follow these exact steps to configure your local Whisper runtime:

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Download whisper.cpp Executables
1. Download `whisper-bin-x64.zip` from [whisper.cpp v1.9.2 Releases](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.2).
2. Extract all contents into the `./bin` directory of this repository:
   - Required: `bin/whisper-cli.exe`
   - Required DLLs: `bin/whisper.dll`, `bin/ggml.dll`, `bin/ggml-base.dll`, `bin/ggml-cpu-*.dll`, `bin/SDL2.dll`
   - Optional: `bin/whisper-server.exe`

### Step 3: Download the Whisper Model
1. Download `ggml-base.en.bin` directly from [Hugging Face](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin).
2. Place the downloaded file into the `./models` directory:
   - Target path: `models/ggml-base.en.bin`

### Step 4 (Optional): Provide Sample Audio for Validation
1. Download `jfk.wav` from [GitHub whisper.cpp samples](https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/samples/jfk.wav).
2. Save it to `samples/jfk.wav`.

---

## Path Configuration & Overrides

By default, the application resolves paths relative to the project root:
- Binary: `./bin/whisper-cli.exe` (or `whisper-server.exe`)
- Model: `./models/ggml-base.en.bin`

You can override these paths without modifying code by setting environment variables in Windows:
```powershell
$env:WHISPER_BIN_PATH="C:\custom\path\to\whisper-cli.exe"
$env:WHISPER_MODEL_PATH="C:\custom\path\to\ggml-base.en.bin"
$env:WHISPER_ENGINE="cli" # or "server"
```

---

## Verification & Standalone Validation

### 1. Run Standalone Whisper Validation
Tests your local whisper runtime, model, and runs a complete offline transcription against the sample audio file without launching Electron or requiring microphone access:

```bash
npm run validate:whisper
```

**Expected output:**
```
=====================================================
   Whisper.cpp Local Transcription Validation
=====================================================
...
[Step 3/4] Running local Whisper transcription...
   ✅ Transcription completed successfully!

Recognized Text: "And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country."
Duration:        3666 ms (3.67s)
Engine:          cli
Model:           ggml-base.en.bin
🎉 Standalone Whisper validation succeeded! Foundation verified.
```

### 2. Run Failure Modes & Edge-Cases Test Suite
Validates negative pathways, missing executables, undersized/corrupted models, invalid WAV headers, silence detection, port conflicts, and lifecycle cleanup:

```bash
npm run test:whisper
```

**Expected output:**
```
Results: 18 / 18 passed (0 failed)
```

---

## Running the Desktop Application

### In Development:
```bash
npm run dev
```

### Building & Running Production:
```bash
npm run build
npx electron .
```

---

## Troubleshooting Guide

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| **UI displays `Whisper: Unavailable`** | Executable or model file is missing at `./bin` or `./models`. | Check that `bin/whisper-cli.exe` and `models/ggml-base.en.bin` exist and are accessible. |
| **"Model file unexpectedly small"** | Download was interrupted or corrupted. | Re-download `ggml-base.en.bin` from Hugging Face (expected size is ~147.4 MB). |
| **"Invalid WAV header: expected RIFF"** | Audio file is not an uncompressed WAV. | Ensure audio is 16-bit PCM WAV (convert via Audacity or ffmpeg: `-ar 16000 -ac 1 -c:a pcm_s16le`). |
| **Port occupied error (server mode)** | Another process is using port 8080/8089. | Switch to CLI mode (`$env:WHISPER_ENGINE="cli"`) or change port with `$env:WHISPER_PORT="8095"`. |
| **Orphaned child processes** | Unexpected crash during development. | The app automatically kills child processes on exit. To verify in PowerShell: `Get-Process whisper*`. |

---

## Architecture & Security Enforcement

- **Sandbox & Isolation**:
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - `sandbox: true`
- **Zero Cloud Leakage**: All speech recognition is performed strictly on local hardware. No audio or text is sent to third-party APIs.
- **Child Process Lifecycle**: Electron main registers `before-quit` and `will-quit` hooks to terminate all spawned child processes.

---

## Next Steps: Phase 3

In **Phase 3**, local Ollama LLM integration will be added in Electron main to generate suggested answers based on transcribed context. Live microphone capture will follow in **Phase 4**.
