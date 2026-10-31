# Development Setup Guide: Windows Environment

This guide provides step-by-step instructions for setting up, configuring, and verifying the **Local AI Conversation Assistant** development environment on a clean Windows machine.

---

## 1. System Requirements

- **Operating System:** Windows 10 or Windows 11 (64-bit x64 architecture).
- **Processor:** Modern x64 CPU supporting AVX2 / AVX instruction sets (e.g., Intel 4th Gen Core or AMD Zen and newer).
- **Node.js:** v20.x or v22.x LTS (Verified in development on `v22.23.2`).
- **npm:** v10.x or newer (bundled with Node.js).
- **Git:** Git for Windows (v2.40+).
- **Disk Space:** Minimum 1 GB free space (accommodates node_modules, binaries, and GGML models).

---

## 2. Initial Repository Setup

Clone the repository using PowerShell or Windows Terminal:

```powershell
# 1. Clone repository
git clone https://github.com/AbhiJeetSoni22/Local-AI-Conversation-Assistant.git
cd Local-AI-Conversation-Assistant

# 2. Install project dependencies
npm install
```

---

## 3. Manual Whisper.cpp Runtime & Model Setup (Phase 2 Requirement)

To preserve privacy and prevent unexpected network usage, **the application never silently downloads multi-hundred-megabyte binaries or models**. You must download and place them into their designated local directories.

```text
Local-AI-Conversation-Assistant/
├── bin/
│   ├── whisper-cli.exe          <-- Primary CLI inference executable
│   ├── whisper.dll              <-- Core Whisper runtime library
│   ├── ggml.dll                 <-- Core GGML tensor library
│   ├── ggml-base.dll            <-- GGML base backend
│   ├── ggml-cpu-alderlake.dll   <-- CPU instruction backends (AVX2/AVX)
│   ├── ggml-cpu-haswell.dll
│   ├── ggml-cpu-x64.dll
│   ├── SDL2.dll                 <-- Audio backend dependency
│   └── whisper-server.exe       <-- (Optional) HTTP inference daemon
├── models/
│   └── ggml-base.en.bin         <-- GGML quantized English base model (~147.4 MB)
└── samples/
    └── jfk.wav                  <-- 16 kHz 16-bit mono test audio (~352 KB)
```

*(Note: `bin/`, `models/`, and `samples/*.wav` are ignored by `.gitignore` and must not be committed to Git).*

### Step 3.1: Download whisper.cpp Executables
1. Navigate to the official [whisper.cpp v1.9.2 Releases Page](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.2).
2. Download the pre-compiled Windows archive: **`whisper-bin-x64.zip`**
3. Create a folder named `bin` in the root of the repository.
4. Extract all files from `whisper-bin-x64.zip` directly into the `bin` folder.
   - Specifically ensure `whisper-cli.exe` and its companion DLLs (`whisper.dll`, `ggml.dll`, `ggml-cpu-*.dll`, etc.) are placed inside `bin/`.

### Step 3.2: Download the Whisper Base Model
1. Download the verified GGML base model from Hugging Face:
   - **URL:** [https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin)
   - **Expected File Size:** Exactly `147,964,211` bytes (~147.4 MB).
2. Create a folder named `models` in the root of the repository.
3. Save the downloaded file as: `models/ggml-base.en.bin`.

### Step 3.3 (Optional): Download Validation Audio
To run the automated standalone transcription verification:
1. Download the public domain JFK sample WAV from GitHub:
   - **URL:** [https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/samples/jfk.wav](https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/samples/jfk.wav)
2. Create a folder named `samples` in the root of the repository.
3. Save the file as: `samples/jfk.wav`.

---

## 4. Verification Commands

Before launching the Electron desktop application, verify that your local environment is correctly configured:

### 1. Run Strict TypeScript Compilation Check
Ensures all types, modules, and interfaces compile cleanly with zero errors:
```powershell
npx tsc --noEmit
```
*Expected result:* Exits cleanly with no output.

### 2. Run Standalone Whisper Transcription
Runs an end-to-end local transcription test on `samples/jfk.wav` directly via `whisper-cli.exe`:
```powershell
npm run validate:whisper
```
*Expected result:*
```text
=====================================================
   Whisper.cpp Local Transcription Validation
=====================================================
...
[Step 3/4] Running local Whisper transcription...
   ✅ Transcription completed successfully!

Recognized Text: "And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country."
Duration:        ~3600 ms
Engine:          cli
Model:           ggml-base.en.bin
🎉 Standalone Whisper validation succeeded! Foundation verified.
```

### 3. Run Failure Modes & Edge-Cases Test Suite
Runs the 18 automated unit and edge-case tests:
```powershell
npm run test:whisper
```
*Expected result:* `Results: 18 / 18 passed (0 failed)`.

---

## 5. Running the Application

### Development Mode (with Hot Module Replacement):
Starts the Vite dev server and spawns the Electron desktop window:
```powershell
npm run dev
```

### Production Build & Launch:
Compiles TypeScript, packages the React bundle into `dist/`, bundles the Electron main script into `dist-electron/`, and launches the desktop executable:
```powershell
npm run build
npx electron .
```

---

## 6. What Setup Steps Belong to Later Phases?

To keep development focused, do **NOT** perform the following setup tasks yet:
- **Ollama Installation:** Scheduled for **Phase 3**. You do not need to install Ollama or pull LLM models during Phase 2.
- **Audio Capture Permissions / Virtual Audio Cables:** Scheduled for **Phase 4**.
- **Packaging / Installer Setup:** Scheduled for **Phase 6**.

