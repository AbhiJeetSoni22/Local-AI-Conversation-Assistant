# Troubleshooting & Diagnostics Guide

This document catalogs common issues, root causes, diagnostic steps, and verified solutions for the **Local AI Conversation Assistant** on Windows.

---

## 1. Whisper Runtime & Model Issues

### Issue 1.1: UI displays `Whisper: Unavailable`
- **Symptom:** The header badge shows a red `Whisper: Unavailable` status and the Live Transcript panel displays a warning card.
- **Root Cause:** Either the Whisper executable (`whisper-cli.exe`) or the GGML model (`ggml-base.en.bin`) was not found at the expected default paths (`./bin` and `./models` in dev, or `resources/bin` and `resources/models` in packaged mode), or paths specified in environment variables are incorrect.
- **Diagnostic Step:**
  Run the standalone validation script in PowerShell:
  ```powershell
  npm run validate:whisper
  ```
  The script will print the exact missing file and path.
- **Solution:**
  1. In development: Ensure `bin/whisper-cli.exe` and `models/ggml-base.en.bin` exist in the project root.
  2. In packaged mode: The installer automatically includes both files in `<install_dir>\resources\bin` and `<install_dir>\resources\models`.
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
  Run the pull command in PowerShell:
  ```powershell
  ollama pull qwen2.5:3b
  ```
  Once complete, click the **"Re-check Ollama"** button in the app header or warning banner.

---

## 3. Audio Capture & Transcription Quality Issues (Phase 4 & 5)

### Issue 3.1: Microphone Access Denied or Fails to Start
- **Symptom:** Clicking **Start** throws `Microphone access denied` or nothing happens.
- **Root Cause:** Windows Privacy settings have disabled microphone access for desktop apps.
- **Solution:**
  1. Open Windows **Settings** -> **Privacy & Security** -> **Microphone**.
  2. Ensure **Microphone access** is turned **On**.
  3. Ensure **Let desktop apps access your microphone** is turned **On**.

---

### Issue 3.2: Words Misrecognized (e.g. "LangChain" -> "link chain" or "FastAPI" -> "Fast API")
- **Symptom:** Speech recognition output sounds phonetically similar but is spelled incorrectly.
- **Root Cause:** Standard Whisper base English model has general conversational weights and may bias toward everyday vocabulary over modern programming terminology.
- **Solution:**
  1. Toggle **Tech Vocab** ON in the top action bar to prime Whisper with common framework, library, and tool tokens.
  2. Click **Edit** in the Conversation Transcript header to correct any misrecognized words in-place before clicking **Suggest Answer**. The LLM prompt builder will receive your edited text cleanly.

---

## 4. Audio & WAV Validation Issues

### Issue 4.1: `Invalid sample rate: X Hz (expected 16000 Hz)`
- **Symptom:** Submitting a custom WAV file fails validation.
- **Root Cause:** Whisper GGML models are trained exclusively on 16,000 Hz mono PCM.
- **Solution:**
  Convert the audio using `ffmpeg`:
  ```powershell
  ffmpeg -i input.mp3 -ar 16000 -ac 1 -c:a pcm_s16le output.wav
  ```

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

## 6. Packaged Distribution & Windows Release Issues (Phase 6)

### Issue 6.1: Windows Defender SmartScreen "Windows protected your PC"
- **Symptom:** When running `Local AI Conversation Assistant-Setup-0.1.0.exe` or `Local AI Conversation Assistant-Portable-0.1.0.exe` for the first time, Windows displays a blue SmartScreen warning dialog stating "Unknown publisher".
- **Root Cause:** This is expected standard Windows behavior for open-source software built without an expensive commercial EV (Extended Validation) code signing certificate.
- **Solution:**
  1. Click **More info** on the SmartScreen dialog.
  2. Click the **Run anyway** button that appears.
  3. The installer or portable app will launch immediately.

---

### Issue 6.2: Antivirus or File Lock EPERM Error During `npm run dist`
- **Symptom:** Packaging fails with `EPERM: operation not permitted, rename 'release\win-unpacked.tmp' -> 'release\win-unpacked'`.
- **Root Cause:** A previously launched instance of `Local AI Conversation Assistant.exe` from `release\win-unpacked` is still running in the background, or Windows Defender has temporarily locked the output folder for scanning.
- **Solution:**
  1. Ensure no instances of the app are running:
     ```powershell
     Stop-Process -Name "Local AI Conversation Assistant*" -Force -ErrorAction SilentlyContinue
     ```
  2. If the problem persists, delete the temporary directory:
     ```powershell
     Remove-Item -Path "release\win-unpacked*" -Recurse -Force -ErrorAction SilentlyContinue
     npm run dist
     ```

---

### Issue 6.3: Portable Executable Takes 3-5 Seconds to Open
- **Symptom:** Launching the portable `.exe` has a short delay before the application window appears.
- **Root Cause:** The portable executable is a self-extracting 7-zip bundle containing Electron and the 148 MB Whisper model. On initial launch, it unpacks its contents to `%LOCALAPPDATA%\Temp` before launching.
- **Solution:**
  For the fastest startup time, use the **NSIS Setup Installer** (`Local AI Conversation Assistant-Setup-0.1.0.exe`), which installs uncompressed files directly to `%LOCALAPPDATA%\Programs\local-ai-conversation-assistant` for instantaneous launching.

---

## 7. Checking for Orphaned Processes

The application automatically hooks into `before-quit`, `will-quit`, and `exit` events to kill child processes. If an unexpected crash occurs during development, verify that no lingering processes remain:

```powershell
# Check for active whisper processes
Get-Process -Name "whisper-cli", "whisper-server" -ErrorAction SilentlyContinue

# Terminate if any are lingering
Stop-Process -Name "whisper-cli", "whisper-server" -Force -ErrorAction SilentlyContinue
```
