# Architecture Decisions & Engineering Constraints

This document records the architectural decisions, trade-offs, permanent engineering constraints, and unresolved design questions for the **Local AI Conversation Assistant**.

---

## 1. Architectural Decisions & Rationales

### Decision 1.1: Windows-First Target Platform
- **Decision:** Target Windows 10 and Windows 11 (64-bit x64) as the primary supported platform.
- **Rationale:** The target user base and internship specification evaluate Windows desktop environments. Targeting Windows directly allows tailoring process execution, path resolution (`.exe`), AVX instruction backends, and terminal hiding without cross-platform abstraction bloat.
- **Trade-off:** Linux and macOS-specific pathing or packaging are deferred.

---

### Decision 1.2: Electron 33 + React 18 + TypeScript + Vite 6
- **Decision:** Use Electron for the desktop wrapper, React for the UI view layer, TypeScript for strict typing, and Vite for development bundling.
- **Rationale:**
  - *Electron:* Provides mature Node.js process management, child process controls, native window customization, and hardware access.
  - *React 18:* Simplifies state-driven UI updates, panel layouts, and progressive streaming displays.
  - *TypeScript:* Guarantees strong interface contracts across the IPC boundary, catching mismatches at compile time (`tsc --noEmit`).
  - *Vite:* Delivers instantaneous HMR during development without the slow compilation overhead of legacy Webpack configs.

---

### Decision 1.3: whisper.cpp for Speech-to-Text
- **Decision:** Use `whisper.cpp` (GGML port of OpenAI Whisper) rather than Python-based Whisper, cloud APIs, or browser Web Speech API.
- **Rationale:**
  - *Zero Cloud Leakage:* Audio stays entirely on the local machine.
  - *Performance:* Written in high-performance C/C++, leveraging hardware SIMD instructions (AVX, AVX2, Alderlake/Haswell CPU optimizations) without requiring a Python environment or heavy PyTorch dependencies.
  - *Portability:* Distributed as standalone prebuilt Windows binaries (`whisper-cli.exe`) and standalone model files (`ggml-*.bin`).

---

### Decision 1.4: Base English Model (`ggml-base.en.bin`) for Phase 2
- **Decision:** Standardize on `ggml-base.en.bin` (~147.4 MB) as the default model.
- **Rationale:**
  - *Balance of Speed and Accuracy:* `base.en` delivers transcription in ~3.5 seconds on a quad-core CPU while maintaining high recognition accuracy on English conversation.
  - *Resource Consumption:* Consumes only ~150 MB RAM, leaving ample memory for the React UI and future Ollama LLM execution.
  - *Alternative Models Considered:*
    - `ggml-tiny.en.bin` (~75 MB): Faster, but significantly higher word error rate (WER).
    - `ggml-small.en.bin` (~488 MB): Higher accuracy, but inference latency (8–12s on CPU) is unsuitable for near-real-time conversation.

---

### Decision 1.5: Ollama for Local LLM Reasoning (Phase 3)
- **Decision:** Standardize on a local `Ollama` daemon serving `qwen2.5:3b`.
- **Rationale:**
  - *Standardized HTTP API:* Ollama provides a clean, well-tested REST API on localhost (`http://127.0.0.1:11434`) with native streaming JSON support.
  - *Separation of Concerns:* Isolates LLM memory and GPU/CPU resource management from the Electron main process.
  - *Qwen 2.5 Architecture:* Qwen 2.5 3B offers state-of-the-art conversational summarization, actionable meeting recommendations, and instruction following in a compact ~1.9 GB footprint.
  - *Safety & Anti-Hallucination:* The prompt builder enforces strict grounding in the transcript and acknowledgement of incomplete context.

---

## 2. Permanent Project Constraints

These rules are permanent project standards that apply to all future phases and pull requests:

### Constraint 2.1: Local-First & Zero Paid/Cloud APIs
- All speech recognition, text processing, and AI suggestion generation must execute on the user's physical machine.
- No third-party cloud APIs (OpenAI, Anthropic, Gemini, Google Cloud, AWS) or API keys are permitted.
- The application must function identically with network connectivity disabled.

### Constraint 2.2: Strict Electron Security Defaults
- `contextIsolation: true` must remain enabled on all `BrowserWindow` instances.
- `nodeIntegration: false` must remain enforced.
- `sandbox: true` must remain enabled.
- The renderer process must never directly invoke Node.js built-ins (`fs`, `child_process`, `os`, `net`).
- All communication across the boundary must pass through strictly typed `contextBridge` methods.

### Constraint 2.3: Process Lifecycle & Zero Orphan Processes
- Any native child process spawned by the application (`whisper-cli.exe`, `whisper-server.exe`) must be explicitly tracked by PID.
- Child processes must be terminated immediately upon application exit, window close, or crash signals (`SIGINT`, `SIGTERM`, `before-quit`, `will-quit`).
- The application must never leave background zombie processes running in Windows Task Manager.

### Constraint 2.4: No Silent Downloads
- The application must never silently initiate multi-megabyte binary or model downloads in the background without explicit user action.
- Missing files must be detected safely on startup and reported via clear, actionable UI messages directing the user to documentation.

### Constraint 2.5: Git Hygiene
- All downloaded binaries (`.exe`, `.dll`), model files (`.bin`, `.gguf`), test audio (`.wav`), and build artifacts (`dist/`, `dist-electron/`) must remain excluded in `.gitignore`.
- Only source code, configuration, scripts, and documentation may be committed to Git.

### Constraint 2.6: Scope Discipline
- Features outside the approved core workflow (such as complex model downloaders, custom settings screens, databases, audio visualizers, or installer packages) are strictly excluded to ensure on-time delivery.

---

## 3. Unresolved Decisions & Open Questions

The following architectural topics require explicit decision during Phase 3 and Phase 4:

| Topic | Options | Trade-Offs | Current Status |
| :--- | :--- | :--- | :---: |
| **Whisper Mode for Live Audio** | **Option A:** `whisper-cli` on 3s WAV chunks<br/>**Option B:** `whisper-server` HTTP daemon | Option A is atomic and uses no idle memory, but has ~600ms model-load latency per chunk. Option B is faster per chunk but holds 150MB RAM continuously. | `Needs Confirmation` in Phase 4 |
| **Qwen Model Size** | **Option A:** `qwen2.5:1.5b`<br/>**Option B:** `qwen2.5:3b` | Standardized on `qwen2.5:3b` as planned; 1.5B remains supported via `OLLAMA_MODEL` environment variable. | ✅ `Resolved (qwen2.5:3b)` |
| **Audio Chunk Overlap Strategy** | **Option A:** Fixed sliding window with text deduplication<br/>**Option B:** Energy-based Voice Activity Detection (VAD) split | Sliding windows are simple but duplicate boundary words; VAD requires careful threshold calibration in noisy rooms. | `Needs Confirmation` in Phase 4 |

