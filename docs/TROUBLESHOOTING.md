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

## 2. Audio & WAV Validation Errors

### Issue 2.1: `Invalid WAV header: expected "RIFF", found ...`
- **Symptom:** `transcribe()` or `validateWavBuffer()` rejects audio with header error.
- **Root Cause:** The provided audio file is not an uncompressed RIFF/WAVE file (e.g., it is an MP3, AAC, FLAC, or raw headerless PCM stream).
- **Solution:**
  Ensure the audio file is converted to standard WAV format. Using `ffmpeg`:
  ```powershell
  ffmpeg -i input.mp3 -ar 16000 -ac 1 -c:a pcm_s16le output.wav
  ```

---

### Issue 2.2: `Unsupported audio encoding: format code 3 (expected 1)`
- **Symptom:** The validator rejects the audio with format code 3.
- **Root Cause:** Format code `3` indicates 32-bit IEEE floating-point PCM. `whisper.cpp` requires 16-bit signed integer linear PCM (format code `1`).
- **Solution:**
  Ensure recording or export tools output 16-bit integer PCM (`pcm_s16le`).

---

### Issue 2.3: `WAV audio duration (X s) exceeds maximum allowed limit (120s)`
- **Symptom:** Long audio files are rejected before transcription.
- **Root Cause:** By default, `validateWavBuffer` enforces a 120-second safety limit to protect against memory spikes during real-time streaming chunks.
- **Solution:**
  For standalone testing of longer files, pass custom validator options:
  ```typescript
  validateWavFile(filePath, { maxDurationSec: 600 })
  ```

---

## 3. Server Mode & Port Conflicts

### Issue 3.1: `Port 8080 is already in use on 127.0.0.1`
- **Symptom:** `whisperService.startServer()` rejects startup immediately.
- **Root Cause:** Another application (e.g. an existing web server or previous zombie `whisper-server.exe`) is already bound to port 8080.
- **Solution:**
  1. Check for processes occupying the port:
     ```powershell
     netstat -ano | findstr :8080
     ```
  2. Or configure Whisper to use a different port:
     ```powershell
     $env:WHISPER_PORT="8089"
     ```
  3. Or switch to CLI engine mode (default, requires no ports):
     ```powershell
     $env:WHISPER_ENGINE="cli"
     ```

---

## 4. Electron & Development Build Issues

### Issue 4.1: `TypeError: Cannot read properties of undefined (reading 'exports') at cjsPreparseModuleExports`
- **Symptom:** Running `npm run dev` or `npx electron .` crashes on startup during Node ESM module evaluation.
- **Root Cause:** In Node.js / Electron, when `package.json` specifies `"type": "module"`, importing CommonJS modules via named imports (or running `--require` hooks against ESM files) can trigger Node's CJS lexer bug.
- **Solution:**
  Ensure Electron imports in `electron/main.ts` use the default package import:
  ```typescript
  import electron from 'electron'
  const { app, BrowserWindow, ipcMain } = electron
  ```
  And ensure `preload.ts` is bundled as an ES module or clean script without mixing `module.exports` and `import`.

---

### Issue 4.2: Port 5173 In Use During Development
- **Symptom:** Vite outputs `Port 5173 is in use, trying another one...` and Electron loads a blank screen.
- **Root Cause:** A previous `npm run dev` session was terminated abruptly without killing the Vite background process.
- **Solution:**
  Terminate orphaned Node processes in PowerShell:
  ```powershell
  Get-Process node | Stop-Process -Force
  ```

---

## 5. Checking for Orphaned Processes

The application automatically hooks into `before-quit`, `will-quit`, and `exit` events to kill child processes. If an unexpected crash occurs during development, verify that no lingering processes remain:

```powershell
# Check for active whisper processes
Get-Process -Name "whisper-cli", "whisper-server" -ErrorAction SilentlyContinue

# Terminate if any are lingering
Stop-Process -Name "whisper-cli", "whisper-server" -Force -ErrorAction SilentlyContinue
```

