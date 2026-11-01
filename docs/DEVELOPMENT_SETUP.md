# Development Setup Guide: Windows Environment

This guide provides step-by-step instructions for setting up, configuring, and verifying the **Local AI Conversation Assistant** development environment on a clean Windows machine.

---

## 1. System Requirements

- **Operating System:** Windows 10 or Windows 11 (64-bit x64 architecture).
- **Processor:** Modern x64 CPU supporting AVX2 / AVX instruction sets (e.g., Intel 4th Gen Core or AMD Zen and newer).
- **Node.js:** v20.x or v22.x LTS (Verified in development on `v20.18.3` and `v22.23.2`).
- **npm:** v10.x or newer (bundled with Node.js).
- **Git:** Git for Windows (v2.40+).
- **Disk Space:** Minimum 4 GB free space (accommodates node_modules, whisper binaries, GGML base model ~148MB, and Ollama Qwen2.5:3b model ~1.9GB).

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

## 4. Manual Ollama Local LLM Setup (Phase 3 Requirement)

In Phase 3, the assistant runs inference locally using **Ollama** and the **`qwen2.5:3b`** model. To ensure complete user transparency, the application never automatically installs software or downloads models behind your back.

Follow these verified manual steps:

### Step 4.1: Install Ollama for Windows
1. Download the official Windows installer from: [https://ollama.com/download/OllamaSetup.exe](https://ollama.com/download/OllamaSetup.exe)
2. Run `OllamaSetup.exe` and complete installation.
3. Ollama will start automatically in your Windows system tray, listening on `http://127.0.0.1:11434`.

### Step 4.2: Verify Ollama CLI
Open PowerShell or Command Prompt and verify:
```powershell
ollama --version
```
*Expected output: `ollama version is 0.5.x` or newer.*

### Step 4.3: Pull the Target LLM Model
Download the planned `qwen2.5:3b` model (~1.9 GB):
```powershell
ollama pull qwen2.5:3b
```

### Step 4.4: Confirm Model Installation
Verify that `qwen2.5:3b` appears in your installed models list:
```powershell
ollama list
```
*Expected output includes: `qwen2.5:3b:latest`.*

### Step 4.5: Run Quick Manual CLI Inference Test
Verify that the model runs cleanly:
```powershell
ollama run qwen2.5:3b "Respond with: Local AI Assistant is ready."
```
*Type `/bye` to exit the interactive session.*

### Step 4.6: Verify Daemon Reachability
Ensure the Ollama HTTP API is responding locally:
```powershell
curl http://127.0.0.1:11434/api/version
```
*Expected JSON output:* `{"version":"0.x.x"}`

---

## 5. Microphone & Audio Setup (Phase 4 Requirement)

In Phase 4, the assistant captures real audio from your system's default recording device (microphone). Ensure your Windows operating system permits microphone access for desktop applications:

1. **Open Windows Settings:** Press `Win + I` and navigate to **Privacy & security > Microphone**.
2. **Enable Microphone Access:** Ensure **Microphone access** is toggled **On**.
3. **Allow Desktop Apps:** Ensure **Let desktop apps access your microphone** is toggled **On**.
4. **Default Recording Device:** Right-click the speaker icon in your Windows taskbar, open **Sound settings**, and ensure your active physical microphone (or headset) is selected as the default **Input** device and registers audio input when speaking.

---

## 6. Verification Commands

Run the full verification suite before starting the desktop application:

### 1. Run Strict TypeScript Compilation Check
Ensures all types, modules, and interfaces compile cleanly with zero errors:
```powershell
npx tsc --noEmit
```

### 2. Run Whisper Verification Suite (Phase 2)
```powershell
# Standalone local Whisper transcription test on samples/jfk.wav
npm run validate:whisper

# Comprehensive 18-assertion failure modes & edge-cases test suite
npm run test:whisper
```
*Expected result:* `Results: 18 / 18 passed (0 failed)`.

### 3. Run Ollama Verification Suite (Phase 3)
```powershell
# Deterministic 36-assertion unit & mock integration test suite
npm run test:ollama

# Standalone live Ollama runtime and streaming inference probe
npm run validate:ollama
```
*Expected result:* `Test Results: 36/36 passed (0 failed)`.

### 4. Run Audio Capture & Pipeline Suite (Phase 4)
```powershell
# Comprehensive 22-assertion audio DSP, WAV encoding, and queue test suite
npm run test:audio
```
*Expected result:* `Test Results: 22/22 passed (0 failed)`.

---

## 7. Running the Application

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

## 8. What Setup Steps Belong to Later Phases?

To maintain clear project discipline, do **NOT** implement the following yet:
- **Prompt Engineering & Context Truncation Tuning:** Scheduled for **Phase 5**.
- **Packaging / Installer Setup (`electron-builder`):** Scheduled for **Phase 6**.
