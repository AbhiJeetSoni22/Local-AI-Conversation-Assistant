# Configuration & Conventions Reference

This document catalogs all project configuration conventions, environment variables, build settings, and audio parameter rules used throughout the **Local AI Conversation Assistant**.

---

## 1. Directory Structure Conventions

The application relies on predictable, project-level relative path resolution. This eliminates the need for complex settings screens or hardcoded absolute paths:

| Directory | Purpose | Git Status | Default Path Resolution |
| :--- | :--- | :---: | :--- |
| **`./bin`** | Local native executables (`whisper-cli.exe`, `whisper-server.exe`) and companion DLLs (`whisper.dll`, `ggml.dll`, `ggml-cpu-*.dll`, etc.). | **Ignored** | `path.join(rootDir, 'bin', 'whisper-cli.exe')` |
| **`./models`** | Local GGML quantized model weights (`ggml-base.en.bin`). | **Ignored** | `path.join(rootDir, 'models', 'ggml-base.en.bin')` |
| **`./samples`** | Known test and validation audio files (`jfk.wav`). | **Ignored** (`*.wav`) | `path.join(rootDir, 'samples', 'jfk.wav')` |
| **`./dist`** | Production build of React frontend SPA. | **Ignored** | `path.join(rootDir, 'dist')` |
| **`./dist-electron`**| Production bundles of Electron main and preload scripts. | **Ignored** | `path.join(rootDir, 'dist-electron')` |
| **`./electron`** | TypeScript source files for Electron main process. | **Tracked** | N/A |
| **`./src`** | React + TypeScript frontend source files. | **Tracked** | N/A |
| **`./scripts`** | Standalone Node/TypeScript validation and test scripts. | **Tracked** | N/A |
| **`./docs`** | Living architectural and operational documentation. | **Tracked** | N/A |

---

## 2. Environment Variables

The application can be configured at runtime via standard Windows environment variables. All variables are optional and provide sensible defaults:

| Variable | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| **`WHISPER_BIN_PATH`** *(or `WHISPER_PATH`)* | String | `./bin/whisper-cli.exe` | Absolute or relative path to the Whisper executable. |
| **`WHISPER_MODEL_PATH`** | String | `./models/ggml-base.en.bin` | Absolute or relative path to the GGML model file. |
| **`WHISPER_ENGINE`** | String | `cli` | Whisper engine mode: `'cli'` for atomic CLI invocation, or `'server'` for HTTP daemon mode. |
| **`WHISPER_HOST`** | String | `127.0.0.1` | Host interface for `whisper-server.exe`. |
| **`WHISPER_PORT`** | Number | `8080` | Port for `whisper-server.exe`. |
| **`TEST_LAUNCH`** | String | *(unset)* | Set to `"1"` to trigger automated desktop window launch, verification, and clean shutdown after 1500 ms. |
| **`APP_ROOT`** | String | `process.cwd()` | Explicit project root directory override for bundled desktop distributions. |
| **`VITE_DEV_SERVER_URL`** | String | *(auto)* | Injected automatically by Vite during `npm run dev` to point Electron to the local development server. |

### Setting Environment Variables in Windows PowerShell:
```powershell
# Point to a custom model located elsewhere on disk:
$env:WHISPER_MODEL_PATH = "D:\AI_Models\ggml-base.en.bin"

# Switch engine to server mode:
$env:WHISPER_ENGINE = "server"
$env:WHISPER_PORT = "8089"

# Launch application with overrides:
npm run dev
```

---

## 3. Audio & WAV Validation Rules (`electron/wavValidator.ts`)

To ensure stability and protect whisper.cpp from corrupted or malicious inputs, all audio submitted to the transcription engine must satisfy these strict constraints:

| Parameter | Allowed Value | Validation Rule |
| :--- | :---: | :--- |
| **File Format** | RIFF / WAVE | Buffer must start with ASCII `'RIFF'` at offset 0 and `'WAVE'` at offset 8. |
| **Audio Format Code** | `1` (Linear PCM) | Compressed formats (ADPCM, IEEE float, μ-law, A-law) are strictly rejected. |
| **Channel Count** | 1 (Mono) or 2 (Stereo) | Whisper prefers single-channel mono. Stereo is accepted but mono is strongly recommended. |
| **Bit Depth** | `16-bit` | Only signed 16-bit little-endian PCM integers (`pcm_s16le`) are supported. |
| **Sample Rate** | `16,000 Hz` | Whisper natively operates at 16 kHz. Audio recorded at other rates must be resampled. |
| **Minimum Size** | $\ge$ 44 bytes | Files smaller than the minimal 44-byte WAV header are rejected immediately. |
| **Maximum Duration** | $\le$ 120 seconds | Chunks exceeding 120 seconds are rejected to prevent memory exhaustion and UI blocking. |
| **Silence RMS Threshold** | $0.005$ | Calculated across normalized frames $[-1.0, 1.0]$. Frames below $0.005$ are flagged `isSilent: true` and skip Whisper inference. |

---

## 4. Build & Tooling Configurations

### A. TypeScript (`tsconfig.json`)
Configured in strict mode to ensure zero type coercion or unintended `any` types:
- `target`: `ES2022`
- `module`: `ESNext`
- `moduleResolution`: `bundler`
- `strict`: `true`
- `noUnusedLocals`: `true`
- `noUnusedParameters`: `true`
- `noFallthroughCasesInSwitch`: `true`

### B. Vite (`vite.config.ts`)
Configured with `vite-plugin-electron/simple` for seamless HMR across both React and Electron:
- **Renderer Entry:** `src/main.tsx` (compiled with `@vitejs/plugin-react`).
- **Main Process Entry:** `electron/main.ts` (compiled to `dist-electron/main.js`).
- **Preload Script Entry:** `electron/preload.ts` (compiled to `dist-electron/preload.mjs`).

### C. Package Scripts (`package.json`)
```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "validate:whisper": "tsx scripts/validate-whisper.ts",
  "test:whisper": "tsx scripts/test-whisper-failures.ts"
}
```

