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

### Issue 3.4: Live Transcript doesn't show text
- **Symptom:** "Listening" is shown but no transcript appears.
- **Root Cause:** The speech segmenter only emits an utterance after it hears >= 200 ms of speech-level energy (frame RMS above `max(0.010, 3 x noise floor)`) followed by 700 ms of quiet. Very quiet microphones or speech during continuous noise can stay under the threshold. Text also appears only after you pause (not every 3 s).
- **Solution:**
  1. Speak at conversational volume and pause ~1 s.
  2. Enable diagnostics (`localStorage.setItem('DEBUG_AUDIO','1')`, restart recording). Chunk lines show `peakFrameRms` and `noiseFloor`. If `peakFrameRms` of your speech is near 0.01, lower `minSpeechRms` (option `segmenter` in `App.tsx`) or raise the Windows microphone level.
  3. To compare with the old behaviour, pass `segmentation: 'fixed'` to `AudioRecorder`.

---

### Issue 3.5: Dropped chunks due to transcription backpressure
- **Symptom:** Fewer utterances in the transcript than you spoke; with `DEBUG_AUDIO` on, the queue's `getDroppedCount()` is > 0.
- **Root Cause:** Whisper took longer than the audio arrived and more than 3 chunks were pending; the oldest non-final chunk is dropped (the final chunk never is).
- **Solution:** Close CPU-heavy apps, set a suitable thread count (default 4), or use a smaller/faster model.

---

### Issue 3.6: Whisper outputs words you did not say, or repeats a phrase ("bye bye bye ...")
- **How to tell where it comes from:** Whisper only sees what the app sends. Each chunk is a separate `whisper-cli` process with no carried context, so a phrase repeated many times inside one result is generated by the decoder for that audio, not appended by the app. The app trims such a loop (>= 8 identical words or >= 5 repeats of a 2-4 word phrase) to one occurrence, but it does **not** guess other missing/invented words.
- **Check, in this order:**
  1. **Effective configuration.** Start with `DEBUG_AUDIO=1` (PowerShell: `$env:DEBUG_AUDIO="1"; npm run dev`). The main process prints `[Whisper config]` with the exact arguments. The expected arguments are `-m -f -oj -of -t 4 -np` and **no** `--prompt`, `-sns`, `-nf`, `-nth`. If you see more, check your environment variables: `echo $env:WHISPER_INITIAL_PROMPT`, `$env:WHISPER_USE_VOCAB_PROMPT`.
  2. **What was sent.** Chunk lines show duration, `speechSec`, `peakFrameRms`. A chunk that is mostly non-speech, or has very low `peakFrameRms`, points to the audio path.
  3. **Raw vs cleaned text for one chunk** (conversation content; opt-in): also set `DEBUG_WHISPER_TEXT=1`.
  4. **Reproduce without the microphone:** `npm run diagnose:whisper` compares prompt/no-prompt on the same files.
  5. **Microphone DSP.** The capture line prints whether the browser applied noise suppression / automatic gain control. Both can pump background noise up between words. Try disabling them (`audioConstraints` in `App.tsx`) and compare.
- **Do not** add phrase deny-lists: they delete genuine speech and hide the real fault.

---

### Issue 3.7: Enabling diagnostics safely
- Nothing is logged by default. Renderer: `localStorage.setItem('DEBUG_AUDIO','1')`. Main process: `DEBUG_AUDIO=1`. Transcript text in logs additionally requires `DEBUG_WHISPER_TEXT=1`. No audio samples are ever logged.

---


### Issue 3.8: Technical terms misrecognized (e.g., "NGINX" as "Yanks", "FastAPI" as "Fast API")
- **Root Cause:** Small speech recognition models like `ggml-base.en.bin` (142MB) lack specialized domain context for modern software proper nouns without prior decoder conditioning.
- **Solution:**
  1. Toggle the **Tech Vocab** button in the top action bar to `On`. This primes Whisper's internal dictionary with curated terms: React, FastAPI, PostgreSQL, Retrieval-Augmented Generation, LangChain, API endpoints, Postman, Docker, NGINX, Python, TypeScript.
  2. For custom words, set an environment variable before launching:
     ```powershell
     $env:WHISPER_EXTRA_VOCABULARY="Kubernetes, GraphQL, Redis"
     npm run dev
     ```
  3. Alternatively, use the **Edit** button on the Conversation Transcript panel to correct any misrecognized words before clicking "Suggest Answer".

### Issue 3.9: Unrelated trailing speech or outro phrases ("Bye bye", "All right...")
- **Root Cause:** When audio finishes with ambient room sound or a breath, and the user waits before clicking Stop, Whisper's temperature fallback (0.0 -> 1.0) on near-zero speech energy samples common YouTube outro boilerplate.
- **Solution:**
  1. `SpeechSegmenter` is tuned with `minSpeechRms: 0.012`, `minSpeechMs: 260ms`, and `hangoverMs: 800ms` to reject clicks and breaths.
  2. Speak clearly at normal volume into the microphone, pause briefly, and click Stop.
  3. Avoid moving the microphone or clicking loudly while recording is active.

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
