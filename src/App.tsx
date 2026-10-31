import { useState, useEffect } from 'react'
import type { WhisperReadiness, OllamaReadiness } from './types/electron'

type AppStatus = 'Idle' | 'Listening' | 'Stopped' | 'Generating'
type ComponentStatus = 'Checking' | 'Ready' | 'Unavailable'

const SAMPLE_TRANSCRIPT = `Speaker 1: Welcome everyone. We are discussing our system architecture for the local AI assistant.
Speaker 2: Yes, the primary goal is ensuring all audio transcription and LLM inference remain 100% on the local device without any cloud APIs.
Speaker 1: Exactly. Can someone explain why we chose whisper.cpp and Ollama rather than using hosted cloud endpoints?`

export default function App() {
  const [status, setStatus] = useState<AppStatus>('Idle')
  const [systemInfo, setSystemInfo] = useState<string>('Detecting environment...')

  // Whisper State
  const [whisperStatus, setWhisperStatus] = useState<ComponentStatus>('Checking')
  const [whisperInfo, setWhisperInfo] = useState<WhisperReadiness | null>(null)

  // Ollama State
  const [ollamaStatus, setOllamaStatus] = useState<ComponentStatus>('Checking')
  const [ollamaInfo, setOllamaInfo] = useState<OllamaReadiness | null>(null)

  // Conversation & Answer State
  const [transcript, setTranscript] = useState<string>('')
  const [suggestedAnswer, setSuggestedAnswer] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState<boolean>(false)
  const [streamMeta, setStreamMeta] = useState<{ durationMs?: number; model?: string; isCancelled?: boolean } | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (window.electronApi) {
      // 1. Fetch app status
      window.electronApi.getStatus()
        .then((info) => {
          setSystemInfo(`${info.platform} (v${info.version}) • Electron Main IPC Active`)
        })
        .catch(() => {
          setSystemInfo('Electron IPC available')
        })

      // 2. Fetch Whisper readiness
      window.electronApi.getWhisperReadiness()
        .then((readiness) => {
          setWhisperInfo(readiness)
          setWhisperStatus(readiness.status)
        })
        .catch((err) => {
          setWhisperStatus('Unavailable')
          setWhisperInfo({
            valid: false,
            status: 'Unavailable',
            executableFound: false,
            modelFound: false,
            executablePath: '',
            modelPath: '',
            engine: 'cli',
            error: err instanceof Error ? err.message : String(err),
          })
        })

      // 3. Fetch Ollama readiness
      window.electronApi.getOllamaReadiness()
        .then((readiness) => {
          setOllamaInfo(readiness)
          setOllamaStatus(readiness.status)
        })
        .catch((err) => {
          setOllamaStatus('Unavailable')
          setOllamaInfo({
            ready: false,
            status: 'Unavailable',
            serviceReachable: false,
            modelAvailable: false,
            baseUrl: 'http://127.0.0.1:11434',
            model: 'qwen2.5:3b',
            availableModels: [],
            error: err instanceof Error ? err.message : String(err),
          })
        })

      // 4. Register Ollama streaming listeners
      const unsubscribeChunk = window.electronApi.onOllamaChunk((data) => {
        setSuggestedAnswer((prev) => (prev ? prev + data.chunk : data.chunk))
      })

      const unsubscribeDone = window.electronApi.onOllamaDone((data) => {
        setIsGenerating(false)
        setStatus((prev) => (prev === 'Generating' ? 'Stopped' : prev))
        setStreamMeta({
          durationMs: data.durationMs,
          model: data.model,
          isCancelled: false,
        })
      })

      const unsubscribeCancelled = window.electronApi.onOllamaCancelled(() => {
        setIsGenerating(false)
        setStatus((prev) => (prev === 'Generating' ? 'Stopped' : prev))
        setStreamMeta((prev) => ({ ...prev, isCancelled: true }))
      })

      const unsubscribeError = window.electronApi.onOllamaError((data) => {
        setIsGenerating(false)
        setStatus((prev) => (prev === 'Generating' ? 'Stopped' : prev))
        setValidationError(`Generation error: ${data.error}`)
      })

      return () => {
        unsubscribeChunk()
        unsubscribeDone()
        unsubscribeCancelled()
        unsubscribeError()
      }
    } else {
      setSystemInfo('Web preview mode')
      setWhisperStatus('Unavailable')
      setOllamaStatus('Unavailable')
    }
  }, [])

  const handleStart = () => {
    // Scaffold UI state transition (Phase 4 will attach live microphone streaming)
    setStatus('Listening')
  }

  const handleStop = () => {
    // Scaffold UI state transition
    setStatus('Stopped')
  }

  const handleSuggestAnswer = async () => {
    setValidationError(null)

    // Validation 1: Transcript must exist
    if (!transcript.trim()) {
      setValidationError('Cannot suggest answer: Conversation transcript is empty. Load or record a transcript first.')
      return
    }

    // Validation 2: Ollama must be ready
    if (ollamaStatus !== 'Ready') {
      setValidationError(
        ollamaInfo?.error || 'Ollama runtime is not ready. Ensure Ollama is running and qwen2.5:3b is installed.'
      )
      return
    }

    if (isGenerating) return

    setIsGenerating(true)
    setStatus('Generating')
    setSuggestedAnswer('')
    setStreamMeta(null)

    try {
      if (window.electronApi) {
        const response = await window.electronApi.startAnswerGeneration(transcript)
        if (!response.success && response.error) {
          setValidationError(response.error)
          setIsGenerating(false)
          setStatus('Stopped')
        }
      }
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : String(err))
      setIsGenerating(false)
      setStatus('Stopped')
    }
  }

  const handleCancelAnswer = async () => {
    if (window.electronApi && isGenerating) {
      await window.electronApi.cancelAnswerGeneration()
      setIsGenerating(false)
      setStatus('Stopped')
      setStreamMeta((prev) => ({ ...prev, isCancelled: true }))
    }
  }

  const handleResetAnswer = () => {
    setSuggestedAnswer(null)
    setStreamMeta(null)
    setValidationError(null)
  }

  const handleLoadSampleTranscript = () => {
    setTranscript(SAMPLE_TRANSCRIPT)
    setValidationError(null)
  }

  const handleClearTranscript = () => {
    setTranscript('')
    setValidationError(null)
  }

  const getStatusBadgeClass = () => {
    switch (status) {
      case 'Generating':
        return 'status-badge status-generating'
      case 'Listening':
        return 'status-badge status-listening'
      case 'Stopped':
        return 'status-badge status-stopped'
      case 'Idle':
      default:
        return 'status-badge status-idle'
    }
  }

  const getComponentBadgeClass = (s: ComponentStatus) => {
    switch (s) {
      case 'Ready':
        return 'status-badge status-ready'
      case 'Unavailable':
        return 'status-badge status-unavailable'
      case 'Checking':
      default:
        return 'status-badge status-checking'
    }
  }

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="app-icon-badge">AI</div>
          <div>
            <h1 className="app-title">Local AI Conversation Assistant</h1>
            <p className="app-subtitle">Windows Desktop • Phase 3 Ollama LLM Integration</p>
          </div>
        </div>
        <div className="header-right" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Whisper Status */}
          <div
            className={getComponentBadgeClass(whisperStatus)}
            title={whisperInfo?.error || (whisperStatus === 'Ready' ? `Whisper ${whisperInfo?.engine.toUpperCase()} ready` : 'Checking Whisper...')}
          >
            <span className="status-dot"></span>
            <span className="status-label">Whisper: {whisperStatus}</span>
          </div>

          {/* Ollama Status */}
          <div
            className={getComponentBadgeClass(ollamaStatus)}
            title={ollamaInfo?.error || (ollamaStatus === 'Ready' ? `Ollama ready (${ollamaInfo?.model})` : 'Checking Ollama...')}
          >
            <span className="status-dot"></span>
            <span className="status-label">Ollama: {ollamaStatus}</span>
          </div>

          {/* App Execution State Indicator */}
          <div className={getStatusBadgeClass()}>
            <span className="status-dot"></span>
            <span className="status-label">{status}</span>
          </div>
        </div>
      </header>

      {/* Control Bar */}
      <section className="controls-bar" aria-label="Controls">
        <div className="controls-group">
          <button
            id="btn-start"
            className="btn btn-primary"
            onClick={handleStart}
            disabled={status === 'Listening' || isGenerating}
            title="Start listening (demonstrates scaffold state transition)"
          >
            Start
          </button>
          <button
            id="btn-stop"
            className="btn btn-secondary"
            onClick={handleStop}
            disabled={status === 'Idle' || status === 'Stopped' || isGenerating}
            title="Stop listening"
          >
            Stop
          </button>
          <button
            id="btn-suggest"
            className="btn btn-accent"
            onClick={handleSuggestAnswer}
            disabled={isGenerating || ollamaStatus !== 'Ready' || !transcript.trim()}
            title={
              ollamaStatus !== 'Ready'
                ? 'Ollama is unavailable. Install Ollama and pull qwen2.5:3b to enable.'
                : !transcript.trim()
                  ? 'Provide or load a transcript first to suggest an answer.'
                  : 'Generate streaming answer based on conversation transcript'
            }
          >
            {isGenerating ? 'Generating...' : 'Suggest Answer'}
          </button>
          {isGenerating && (
            <button
              id="btn-cancel"
              className="btn btn-danger"
              onClick={handleCancelAnswer}
              title="Cancel active Ollama generation"
            >
              Cancel Generation
            </button>
          )}
          {suggestedAnswer && !isGenerating && (
            <button
              id="btn-clear-answer"
              className="btn btn-ghost"
              onClick={handleResetAnswer}
              title="Clear generated answer"
            >
              Clear Answer
            </button>
          )}
        </div>
        <div className="controls-note">
          <span className="pill-phase">Phase 3</span>
          <span>Ollama local streaming active • Live microphone capture scheduled for Phase 4</span>
        </div>
      </section>

      {/* Inline Validation Banner if Error Present */}
      {validationError && (
        <div style={{ padding: '8px 24px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderBottom: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⚠️ {validationError}</span>
          <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => setValidationError(null)}>Dismiss</button>
        </div>
      )}

      {/* Main Panels Grid */}
      <main className="panels-grid">
        {/* Live Transcript Panel */}
        <section className="panel" aria-labelledby="transcript-heading">
          <div className="panel-header">
            <h2 id="transcript-heading" className="panel-title">
              Live Transcript
            </h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span className="panel-tag">
                {whisperStatus === 'Ready' ? 'whisper.cpp (Ready)' : 'whisper.cpp (Phase 2)'}
              </span>
              {transcript && (
                <button
                  className="btn btn-ghost"
                  style={{ padding: '2px 6px', fontSize: '11px' }}
                  onClick={handleClearTranscript}
                  title="Clear transcript text"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="panel-body">
            {/* Actionable Warning if Whisper is Unavailable */}
            {whisperStatus === 'Unavailable' && (
              <div className="whisper-warning-box">
                <div className="whisper-warning-title">
                  <span>⚠️</span>
                  <span>Whisper Runtime Unavailable</span>
                </div>
                <p className="whisper-warning-desc">
                  {whisperInfo?.error || 'Local whisper.cpp executable or model is missing.'}
                </p>
                <p className="whisper-warning-desc" style={{ marginTop: '6px' }}>
                  <strong>Setup:</strong> Place <code>whisper-cli.exe</code> in <code>bin/</code> and <code>ggml-base.en.bin</code> in <code>models/</code>.
                </p>
              </div>
            )}

            {/* Transcript Display or Sample Prompt */}
            {transcript ? (
              <div className="transcript-sample-card">
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#38bdf8', marginBottom: '8px', textTransform: 'uppercase' }}>
                  Conversation Context
                </div>
                <p className="transcript-sample-text">{transcript}</p>
              </div>
            ) : status === 'Listening' ? (
              <div className="scaffold-active-notice">
                <div className="notice-icon">🎙️</div>
                <p className="notice-title">Status: Listening (Scaffold State)</p>
                <p className="notice-desc">
                  Whisper speech engine is validated. Live microphone capture and chunking stream will be connected in Phase 4.
                </p>
                <div style={{ marginTop: '12px' }}>
                  <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={handleLoadSampleTranscript}>
                    Load Sample Meeting Transcript for Testing
                  </button>
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">📝</div>
                <p className="empty-state-text">
                  Microphone audio stream will feed transcript here in Phase 4.
                </p>
                <p className="empty-state-subtext" style={{ marginBottom: '14px' }}>
                  To test the Phase 3 Ollama "Suggest Answer" workflow immediately, load a sample conversation transcript below:
                </p>
                <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={handleLoadSampleTranscript}>
                  Load Sample Meeting Transcript
                </button>
              </div>
            )}
          </div>
        </section>

        {/* AI Suggested Answer Panel */}
        <section className="panel" aria-labelledby="answer-heading">
          <div className="panel-header">
            <h2 id="answer-heading" className="panel-title">
              AI Suggested Answer
            </h2>
            <span className="panel-tag">
              {ollamaStatus === 'Ready' ? `Ollama (${ollamaInfo?.model})` : 'Ollama LLM (Phase 3)'}
            </span>
          </div>
          <div className="panel-body">
            {/* Actionable Warning if Ollama is Unavailable */}
            {ollamaStatus === 'Unavailable' && (
              <div className="ollama-warning-box">
                <div className="ollama-warning-title">
                  <span>⚠️</span>
                  <span>Ollama Runtime Unavailable</span>
                </div>
                <p className="ollama-warning-desc">
                  {ollamaInfo?.error || 'Local Ollama service or target model is missing.'}
                </p>
                <div className="ollama-warning-desc" style={{ marginTop: '8px' }}>
                  <strong>Manual Setup:</strong>
                  <ol style={{ paddingLeft: '18px', marginTop: '4px', lineHeight: 1.4 }}>
                    <li>Ensure Ollama is running (<code>http://127.0.0.1:11434</code>).</li>
                    <li>Open terminal and run: <code>ollama pull qwen2.5:3b</code></li>
                  </ol>
                </div>
              </div>
            )}

            {suggestedAnswer !== null ? (
              <div className="answer-stream-container">
                <div className="answer-meta-bar">
                  <span>
                    {isGenerating ? (
                      <span style={{ color: '#c084fc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="status-dot" style={{ backgroundColor: '#a855f7' }}></span>
                        Streaming from {ollamaInfo?.model || 'qwen2.5:3b'}...
                      </span>
                    ) : streamMeta?.isCancelled ? (
                      <span style={{ color: '#fbbf24' }}>Generation Cancelled</span>
                    ) : (
                      <span style={{ color: '#34d399' }}>
                        Completed {streamMeta?.durationMs ? `(${(streamMeta.durationMs / 1000).toFixed(2)}s)` : ''} • Model: {streamMeta?.model || 'qwen2.5:3b'}
                      </span>
                    )}
                  </span>
                  {isGenerating && (
                    <button className="btn btn-danger" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={handleCancelAnswer}>
                      Cancel
                    </button>
                  )}
                </div>
                <div className="answer-stream-text">
                  {suggestedAnswer}
                  {isGenerating && <span className="streaming-cursor"></span>}
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">💡</div>
                <p className="empty-state-text">
                  The locally generated answer will stream here in real time.
                </p>
                <p className="empty-state-subtext">
                  Ensure a transcript is loaded, then click <strong>Suggest Answer</strong> to trigger local Ollama inference.
                </p>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* App Footer */}
      <footer className="app-footer">
        <div className="footer-item">
          <span className="footer-label">System:</span>
          <span>{systemInfo}</span>
        </div>
        <div className="footer-item">
          <span className="footer-label">Whisper:</span>
          <span>{whisperStatus === 'Ready' ? `Ready (${whisperInfo?.engine.toUpperCase()})` : whisperStatus}</span>
        </div>
        <div className="footer-item">
          <span className="footer-label">Ollama:</span>
          <span>{ollamaStatus === 'Ready' ? `Ready (${ollamaInfo?.model})` : ollamaStatus}</span>
        </div>
        <div className="footer-item">
          <span>Local-only architecture • Secure sandbox isolation</span>
        </div>
      </footer>
    </div>
  )
}
