# Configuration & Conventions Reference

This document catalogs all project configuration conventions, environment variables, build settings, and parameter rules used throughout the **Local AI Conversation Assistant**.

---

## 1. Directory Structure Conventions

The application relies on predictable, project-level relative path resolution in development and `process.resourcesPath` resolution in packaged distributions:

| Directory | Purpose | Git Status | Default Path Resolution |
| :--- | :--- | :---: | :--- |
| **`./bin`** | Local native executables (`whisper-cli.exe`, `whisper-server.exe`) and companion DLLs (`whisper.dll`, `ggml.dll`, `ggml-cpu-*.dll`, etc.). In packaged apps, bundled to `resources/bin`. | **Ignored** | `path.join(resourcesPath || rootDir, 'bin', 'whisper-cli.exe')` |
| **`./models`** | Local GGML quantized model weights (`ggml-base.en.bin`). In packaged apps, bundled to `resources/models`. | **Ignored** | `path.join(resourcesPath || rootDir, 'models', 'ggml-base.en.bin')` |
| **`./samples`** | Known test and validation audio files (`jfk.wav`). | **Ignored** (`*.wav`) | `path.join(rootDir, 'samples', 'jfk.wav')` |
| **`./build`** | Build resources, application icons (`icon.ico`, `icon.png`). | **Tracked** | `path.join(rootDir, 'build')` |
| **`./dist`** | Production build of React frontend SPA. | **Ignored** | `path.join(rootDir, 'dist')` |
| **`./dist-electron`**| Production bundles of Electron main and preload scripts. | **Ignored** | `path.join(rootDir, 'dist-electron')` |
| **`./release`** | Packaged Windows executables (`Setup.exe`, `Portable.exe`, `win-unpacked`). | **Ignored** | `path.join(rootDir, 'release')` |
| **`./electron`** | TypeScript source files for Electron main process. | **Tracked** | N/A |
| **`./src`** | React + TypeScript frontend source files. | **Tracked** | N/A |
| **`./scripts`** | Standalone Node/TypeScript validation and test scripts. | **Tracked** | N/A |
| **`./docs`** | Living architectural and operational documentation. | **Tracked** | N/A |

---

## 2. Environment Variables

The application can be configured at runtime via standard Windows environment variables. All variables are optional and provide sensible defaults:

### Whisper Configuration (Phase 2 & Phase 4)
| Variable | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| **`WHISPER_BIN_PATH`** *(or `WHISPER_PATH`)* | String | *(auto-resolved)* | Absolute or relative path to the Whisper executable. In packaged mode, resolves automatically from `process.resourcesPath/bin/whisper-cli.exe`. |
| **`WHISPER_MODEL_PATH`** | String | *(auto-resolved)* | Absolute or relative path to the GGML model file. In packaged mode, resolves automatically from `process.resourcesPath/models/ggml-base.en.bin`. |
| **`WHISPER_ENGINE`** | String | `cli` | Whisper engine mode: `'cli'` for atomic CLI invocation, or `'server'` for HTTP daemon mode. |
| **`WHISPER_HOST`** | String | `127.0.0.1` | Host interface for `whisper-server.exe`. |
| **`WHISPER_PORT`** | Number | `8080` | Port for `whisper-server.exe`. |
| **`WHISPER_INITIAL_PROMPT`** | String | *(unset / empty)* | Optional initial prompt string passed as `--prompt` to Whisper to condition vocabulary recognition. Defaults to empty for clean baseline decoding. Takes precedence over `WHISPER_USE_VOCAB_PROMPT`. |
| **`WHISPER_USE_VOCAB_PROMPT`** | String | *(unset)* | Set to `"1"` to opt in to the curated technical-vocabulary prompt (`buildInitialPrompt()`). In the UI, controlled via the "Tech Vocab" action toggle. |
| **`DEBUG_WHISPER_TEXT`** | String | *(unset)* | With `DEBUG_AUDIO=1`, additionally logs raw vs cleaned transcript text in the main process. Conversation content: leave unset normally for privacy. |
| **`DEBUG_AUDIO`** | String | *(unset)* | Set to `"1"` to log metadata only (effective Whisper arguments, durations, character counts, flags). In the renderer the equivalent switch is `localStorage.setItem('DEBUG_AUDIO','1')`. |

### Ollama Configuration (Phase 3)
| Variable | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| **`OLLAMA_HOST`** *(or `OLLAMA_BASE_URL`)* | String | `http://127.0.0.1:11434` | Base URL of the local Ollama daemon service. |
| **`OLLAMA_MODEL`** | String | `qwen2.5:3b` | Target local LLM identifier. |
| **`OLLAMA_TIMEOUT_MS`** | Number | `60000` | Safety timeout in milliseconds for streaming inference requests. |

### System & Build Variables
| Variable | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| **`TEST_LAUNCH`** | String | *(unset)* | Set to `"1"` to trigger automated desktop window launch, verification, and clean shutdown after 1500 ms. |
| **`APP_ROOT`** | String | `process.cwd()` | Explicit project root directory override for bundled desktop distributions. |
| **`VITE_DEV_SERVER_URL`** | String | *(auto)* | Injected automatically by Vite during `npm run dev` to point Electron to the local development server. |

---

## 3. Packaging & Distribution Settings (`electron-builder.json`)

Phase 6 introduces `electron-builder.json` to manage Windows packaging:

```json
{
  "appId": "com.localai.conversationassistant",
  "productName": "Local AI Conversation Assistant",
  "copyright": "Copyright © 2026 Abhijeet Soni",
  "directories": {
    "output": "release",
    "buildResources": "build"
  },
  "files": [
    "dist/**/*",
    "dist-electron/**/*",
    "package.json"
  ],
  "extraResources": [
    {
      "from": "bin",
      "to": "bin",
      "filter": [
        "whisper-cli.exe",
        "whisper-server.exe",
        "*.dll"
      ]
    },
    {
      "from": "models",
      "to": "models",
      "filter": [
        "*.bin"
      ]
    }
  ],
  "win": {
    "target": [
      { "target": "nsis", "arch": ["x64"] },
      { "target": "portable", "arch": ["x64"] }
    ],
    "icon": "build/icon.ico"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "Local AI Conversation Assistant",
    "artifactName": "${productName}-Setup-${version}.${ext}"
  },
  "portable": {
    "artifactName": "${productName}-Portable-${version}.${ext}"
  },
  "asar": true
}
```

### Packaging Scripts in `package.json`
- `npm run dist`: Compiles TypeScript, builds Vite bundles, and packages both NSIS setup and Portable executables.
- `npm run dist:dir`: Fast unpack packaging to `release/win-unpacked` for local validation.
- `npm run dist:nsis`: Builds the standard NSIS installer only.
- `npm run dist:portable`: Builds the standalone portable executable only.
- `npm run icons`: Re-generates multi-resolution `build/icon.ico` and `build/icon.png` using PowerShell and .NET `System.Drawing`.

---

## 4. Audio Capture & Chunking Parameters (Phase 4 & 5)

| Parameter | Value | Component | Description |
| :--- | :---: | :--- | :--- |
| **Microphone Channel Count** | `1` (Mono) | `AudioRecorder` | Requests single-channel mono with echo cancellation, noise suppression, and auto gain control. |
| **Internal Target Sample Rate** | `16,000 Hz` | `resampler.ts` | All incoming hardware audio (44.1kHz, 48kHz, etc.) is resampled to 16kHz by one stateful windowed-sinc `StreamingResampler` per recording. |
| **Segmentation mode** | `speech` (default) | `AudioRecorder` option `segmentation` | `speech`: cuts utterances dynamically at natural pauses. |
| **Segmenter thresholds** | `minSpeechRms`: `0.012`; `minSpeechMs`: `260ms`; `hangoverMs`: `800ms`; `preRollMs`: `300ms`; `trailingPadMs`: `200ms` | `SpeechSegmenterOptions` | Suppresses trailing AGC noise and clicks while preserving deliberate speech pauses. |
| **Minimum Final Chunk Duration**| `0.5 seconds` | `AudioRecorder` | Exactly 8,000 samples @ 16kHz. On Stop, trailing partial audio shorter than 0.5s is discarded to prevent cut-off word artifacts. |
| **Silence Gating Threshold** | `0.005` RMS | `AudioRecorder` / `wavEncoder` | Buffers with RMS energy below 0.005 are flagged as silent and bypass `whisper-cli.exe` execution. |
| **Maximum Queue Backpressure** | `3 chunks` | `TranscriptionQueue` | Limits pending transcription backlog to 3 items. If CPU is under heavy load, drops excess unstarted chunks to prevent memory bloat. |
