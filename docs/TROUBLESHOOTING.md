# Troubleshooting & Diagnostics Guide

This document catalogs common issues, root causes, diagnostic steps, and verified solutions for the **Local AI Conversation Assistant** on Windows.

---

## 1. Whisper Runtime & Model Issues

### Issue 1.1: UI displays `Whisper: Unavailable`
- **Symptom:** The header badge shows a red `Whisper: Unavailable` status and the Live Transcript panel displays a warning card.
- **Root Cause:** Either the Whisper executable (`whisper-cli.exe`) or the GGML model (`ggml-base.en.bin`) was not found at the expected default paths (`./bin` and `./models`), or paths specified in environment variables are incorrect.
- **Diagnostic Step:**
  Run the standalone validation script in PowerShell:
  ```powershell
  npm run validate:whisper
  ```
  The script will print the exact missing file and path.
- **Solution:**
  1. Ensure `bin/whisper-cli.exe` exists in the project root.
  2. Ensure `models/ggml-base.en.bin` exists in the project root.
  3. If stored elsewhere, set environment variables:
     ```powershell
     $env:WHISPER_BIN_PATH="C:\path\to\whisper-cli.exe"
     $env:WHISPER_MODEL_PATH="C:\path\to\ggml-base.en.bin"
     ```

---

### Issue 1.2: Error: `Model file at ... is unexpectedly small (X MB)`
- **Symptom:** Validation fails with `Model file at "models\ggml-base.en.bin" is unexpectedly small. It may be incomplete or corrupted.`
- **Root Cause:** The model download was interrupted or truncated. `ggml-base.en.bin` must be approximately `147.4 MB` (`147,964,211` bytes). Files under 10 MB fail safety checks.
- **Solution:**
  Re-download the complete model directly from Hugging Face:
  ```powershell
  curl.exe -L "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin" -o "models\ggml-base.en.bin"
  ```

---

### Issue 1.3: Windows Error: `The code execution cannot proceed because ...dll was not found`
- **Symptom:** Launching `whisper-cli.exe` triggers a Windows system dialog reporting missing DLLs such as `ggml.dll`, `whisper.dll`, `ggml-cpu-alderlake.dll`, or `SDL2.dll`.
- **Root Cause:** In `whisper.cpp v1.9.2`, the executables depend on companion DLLs extracted from the same release archive. Only copying `whisper-cli.exe` without its DLLs breaks execution.
- **Solution:**
  Extract **all** files from `whisper-bin-x64.zip` into the `bin/` folder. The folder must contain:
  - `whisper-cli.exe`
  - `whisper.dll`
  - `ggml.dll`
  - `ggml-base.dll`
  - `ggml-cpu-*.dll`
  - `SDL2.dll`

---

## 2. Ollama Local LLM Issues (Phase 3)

### Issue 2.1: UI displays `Ollama: Unavailable` (Service Unreachable)
- **Symptom:** Header badge shows `Ollama: Unavailable`, and "Suggest Answer" is disabled.
- **Root Cause:** The Ollama background service is not running on `http://127.0.0.1:11434`.
- **Diagnostic Step:**
  ```powershell
  npm run validate:ollama
  ```
- **Solution:**
  1. Ensure Ollama is installed from [https://ollama.com](https://ollama.com).
  2. Launch Ollama from the Windows Start menu or check the system tray icon.
  3. Confirm the endpoint responds:
     ```powershell
     curl http://127.0.0.1:11434/api/version
     ```
  4. If Ollama runs on a non-standard port or machine:
     ```powershell
     $env:OLLAMA_HOST = "http://127.0.0.1:11434"
     ```

---

### Issue 2.2: Error: `Model "qwen2.5:3b" is not installed in Ollama`
- **Symptom:** Ollama is reachable, but `Ollama: Unavailable` displays: `Model "qwen2.5:3b" is not installed in Ollama. Run: ollama pull qwen2.5:3b`.
- **Root Cause:** The Ollama daemon is active, but the target model has not been downloaded yet.
- **Solution:**
  Open PowerShell or Command Prompt and run:
  ```powershell
  ollama pull qwen2.5:3b
  ```
  Once download completes, verify with `ollama list` and refresh the app or run `npm run validate:ollama`.

---

### Issue 2.3: `A generation request is already in progress`
- **Symptom:** The user clicks "Suggest Answer" twice quickly and receives this validation error.
- **Root Cause:** `OllamaService` enforces strict single-request concurrency to prevent multiple overlapping LLM inferences on the CPU.
- **Solution:**
  Wait for the current response to finish streaming, or click the **Cancel Generation** button.

---

## 3. Microphone & Live Audio Capture Issues (Phase 4)

### Issue 3.1: "Microphone access was denied: NotAllowedError"
- **Symptom:** Clicking "Start" produces an alert banner: `Microphone access was denied. Please allow microphone permissions in Windows Settings (Privacy & security > Microphone).`
- **Root Cause:** Either the user denied the permission prompt in Electron, or Windows OS privacy settings block desktop apps from accessing the microphone.
- **Solution:**
  1. Open Windows **Settings** (`Win + I`).
  2. Go to **Privacy & security > Microphone**.
  3. Ensure **Microphone access** is turned **On**.
  4. Ensure **Let desktop apps access your microphone** is turned **On**.
  5. Restart the application (`npm run dev`) and click "Start" again.

---

### Issue 3.2: "No microphone device detected: NotFoundError"
- **Symptom:** Clicking "Start" produces an alert: `No microphone device detected. Please connect a microphone and try again.`
- **Root Cause:** No active audio input device is detected by the operating system or browser environment.
- **Solution:**
  1. Check your physical microphone or headset connection (USB or 3.5mm jack).
  2. Open Windows **Sound Settings** and verify that an active input device is selected and responding to test speech.
  3. If using a Bluetooth headset, ensure it is connected and not exclusively locked in hands-free mode by another app.

---

### Issue 3.3: "Microphone is busy or unreadable: NotReadableError"
- **Symptom:** Clicking "Start" produces: `Microphone is currently unavailable or in use by another application.`
- **Root Cause:** Another Windows application (such as Microsoft Teams, Zoom, or Discord) has opened the microphone in exclusive mode.
- **Solution:**
  1. Close competing voice or video calling software.
  2. Go to Windows **Sound Control Panel > Recording > [Your Mic] > Properties > Advanced**, and uncheck **"Allow applications to take exclusive control of this device"**.

---

### Issue 3.4: Live Transcript doesn't show text when quiet
- **Symptom:** The user clicks "Start", the emerald "Listening" badge is visible, but no transcript is added.
- **Root Cause:** Silence detection gate (`calculateRms(samples) < 0.005`) deliberately filters out silent ambient background noise so `whisper.cpp` is not invoked unnecessarily.
- **Solution:**
  Speak clearly into your microphone at normal conversational volume. The "Transcribing audio..." indicator will appear within 3 seconds, followed by the transcribed phrase in the Live Transcript panel.

---

### Issue 3.5: "Dropped audio chunk due to transcription backpressure"
- **Symptom:** Console logs show `Dropped audio chunk due to transcription backpressure (queue depth: 3)`.
- **Root Cause:** On lower-power CPUs, `whisper.cpp` single-chunk transcription duration might exceed the audio chunk window (3.0 seconds). If Whisper takes > 3.0s per chunk, the queue limits backlog to 3 pending chunks to protect system memory and prevent UI lagging.
- **Solution:**
  1. Check CPU load in Windows Task Manager.
  2. Verify that `WHISPER_THREADS` is set to an appropriate number for your CPU core count (default is 4).
  3. Ensure other heavy CPU applications are closed.

---

## 4. Audio & WAV Validation Errors

### Issue 4.1: `Invalid WAV header: expected "RIFF", found ...`
- **Symptom:** `transcribe()` or `validateWavBuffer()` rejects audio with header error.
- **Root Cause:** The provided audio file is not an uncompressed RIFF/WAVE file (e.g., MP3, AAC, FLAC).
- **Solution:**
  Ensure the audio file is converted to standard WAV format. Using `ffmpeg`:
  ```powershell
  ffmpeg -i input.mp3 -ar 16000 -ac 1 -c:a pcm_s16le output.wav
  ```

---

### Issue 4.2: `Unsupported audio encoding: format code 3 (expected 1)`
- **Symptom:** The validator rejects the audio with format code 3.
- **Root Cause:** Format code `3` indicates 32-bit IEEE floating-point PCM. `whisper.cpp` requires 16-bit signed integer linear PCM (format code `1`).
- **Solution:**
  Ensure recording tools output 16-bit integer PCM (`pcm_s16le`).

---

## 5. Electron & Development Environment Issues

### Issue 5.1: `ELECTRON_RUN_AS_NODE` Environment Conflict
- **Symptom:** Running `electron .` or smoke launch produces:
  `TypeError: Cannot read properties of undefined (reading 'handle')` or runs as pure Node.
- **Root Cause:** When running from certain terminals or IDEs, the parent process injects `ELECTRON_RUN_AS_NODE=1`.
- **Solution:**
  Unset the variable in PowerShell before launching:
  ```powershell
  Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  & 'node_modules\.bin\electron.cmd' '.'
  ```

---

### Issue 5.2: Port 5173 In Use During Development
- **Symptom:** Vite outputs `Port 5173 is in use, trying another one...` and Electron loads a blank screen.
- **Root Cause:** A previous `npm run dev` session was terminated abruptly without killing the Vite background process.
- **Solution:**
  Terminate orphaned Node processes in PowerShell:
  ```powershell
  Get-Process node | Stop-Process -Force
  ```

---

## 6. Checking for Orphaned Processes

The application automatically hooks into `before-quit`, `will-quit`, and `exit` events to kill child processes. If an unexpected crash occurs during development, verify that no lingering processes remain:

```powershell
# Check for active whisper processes
Get-Process -Name "whisper-cli", "whisper-server" -ErrorAction SilentlyContinue

# Terminate if any are lingering
Stop-Process -Name "whisper-cli", "whisper-server" -Force -ErrorAction SilentlyContinue
```
