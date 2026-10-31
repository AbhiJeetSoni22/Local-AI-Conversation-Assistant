import { useState, useEffect } from 'react'
import type { WhisperReadiness } from './types/electron'

type AppStatus = 'Idle' | 'Listening' | 'Stopped'
type WhisperStatusType = 'Checking' | 'Ready' | 'Unavailable'

export default function App() {
  const [status, setStatus] = useState<AppStatus>('Idle')
  const [suggestedAnswer, setSuggestedAnswer] = useState<string | null>(null)
  const [systemInfo, setSystemInfo] = useState<string>('Detecting environment...')
  const [whisperStatus, setWhisperStatus] = useState<WhisperStatusType>('Checking')
  const [whisperInfo, setWhisperInfo] = useState<WhisperReadiness | null>(null)

  useEffect(() => {
    // Check minimal IPC contextBridge if available
    if (window.electronApi) {
      window.electronApi.getStatus()
        .then((info) => {
          setSystemInfo(`${info.platform} (v${info.version}) • Electron Main IPC Active`)
        })
        .catch(() => {
          setSystemInfo('Electron IPC available')
        })

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
    } else {
      setSystemInfo('Web preview mode')
      setWhisperStatus('Unavailable')
      setWhisperInfo({
        valid: false,
        status: 'Unavailable',
        executableFound: false,
        modelFound: false,
        executablePath: '',
        modelPath: '',
        engine: 'cli',
        error: 'Running in browser preview without Electron main process.',
      })
    }
  }, [])

  const handleStart = () => {
    // Scaffold UI state transition (Phase 1/2 only: no live microphone capture or streaming yet)
    setStatus('Listening')
  }

  const handleStop = () => {
    // Scaffold UI state transition
    setStatus('Stopped')
  }

  const handleSuggestAnswer = () => {
    // Scaffold UI demonstration (Phase 1/2 only: Ollama LLM integration scheduled for Phase 3)
    setSuggestedAnswer('AI answer generation will be added in Phase 3.')
  }

  const handleResetAnswer = () => {
    setSuggestedAnswer(null)
  }

  const getStatusBadgeClass = () => {
    switch (status) {
      case 'Listening':
        return 'status-badge status-listening'
      case 'Stopped':
        return 'status-badge status-stopped'
      case 'Idle':
      default:
        return 'status-badge status-idle'
    }
  }

  const getWhisperBadgeClass = () => {
    switch (whisperStatus) {
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
            <p className="app-subtitle">Windows Desktop • Phase 2 Whisper Foundation</p>
          </div>
        </div>
        <div className="header-right" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {/* Whisper Readiness Indicator */}
          <div
            className={getWhisperBadgeClass()}
            title={whisperInfo?.error || (whisperStatus === 'Ready' ? `Whisper ${whisperInfo?.engine.toUpperCase()} engine ready` : 'Checking Whisper status...')}
          >
            <span className="status-dot"></span>
            <span className="status-label">Whisper: {whisperStatus}</span>
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
            disabled={status === 'Listening'}
            title="Start listening (demonstrates UI state transition)"
          >
            Start
          </button>
          <button
            id="btn-stop"
            className="btn btn-secondary"
            onClick={handleStop}
            disabled={status === 'Idle' || status === 'Stopped'}
            title="Stop listening (disabled while Idle or Stopped)"
          >
            Stop
          </button>
          <button
            id="btn-suggest"
            className="btn btn-accent"
            onClick={handleSuggestAnswer}
            disabled={status === 'Idle'}
            title="Suggest Answer (disabled while Idle)"
          >
            Suggest Answer
          </button>
          {suggestedAnswer && (
            <button
              id="btn-clear-answer"
              className="btn btn-ghost"
              onClick={handleResetAnswer}
              title="Clear temporary placeholder"
            >
              Clear Answer
            </button>
          )}
        </div>
        <div className="controls-note">
          <span className="pill-phase">Phase 2</span>
          <span>Scaffold controls active • Whisper local foundation established • Mic streaming in Phase 4</span>
        </div>
      </section>

      {/* Main Panels Grid */}
      <main className="panels-grid">
        {/* Live Transcript Panel */}
        <section className="panel" aria-labelledby="transcript-heading">
          <div className="panel-header">
            <h2 id="transcript-heading" className="panel-title">
              Live Transcript
            </h2>
            <span className="panel-tag">
              {whisperStatus === 'Ready' ? 'whisper.cpp (Ready)' : 'whisper.cpp (Phase 2)'}
            </span>
          </div>
          <div className="panel-body">
            {/* Show Actionable Error Notice if Whisper is Unavailable */}
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
                  <strong>Manual Setup:</strong> Ensure <code>whisper-cli.exe</code> is placed in <code>bin/</code> and <code>ggml-base.en.bin</code> is in <code>models/</code>.
                </p>
              </div>
            )}

            {status === 'Listening' ? (
              <div className="scaffold-active-notice">
                <div className="notice-icon">🎙️</div>
                <p className="notice-title">Status: Listening (Scaffold State)</p>
                <p className="notice-desc">
                  {whisperStatus === 'Ready'
                    ? 'Whisper.cpp local engine is validated and ready. Live microphone audio capture and AudioWorklet streaming will be connected in Phase 4.'
                    : 'Microphone capture and streaming will be connected in Phase 4 once the runtime requirements above are fulfilled.'}
                </p>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">📝</div>
                <p className="empty-state-text">
                  {whisperStatus === 'Ready'
                    ? 'Whisper local foundation validated and ready (ggml-base.en).'
                    : 'Microphone transcription will stream here in Phase 4.'}
                </p>
                <p className="empty-state-subtext">
                  Live microphone audio recording and chunking will be implemented in Phase 4. Click <strong>Start</strong> to test the scaffold transition.
                </p>
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
            <span className="panel-tag">Ollama LLM (Phase 3)</span>
          </div>
          <div className="panel-body">
            {suggestedAnswer ? (
              <div className="answer-placeholder-card">
                <div className="placeholder-tag">Placeholder Demonstration</div>
                <p className="placeholder-text">{suggestedAnswer}</p>
                <p className="placeholder-detail">
                  Note: Local Ollama LLM integration will be implemented in Phase 3.
                </p>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">💡</div>
                <p className="empty-state-text">
                  The locally generated answer will appear here in Phase 3.
                </p>
                <p className="empty-state-subtext">
                  Once listening, click <strong>Suggest Answer</strong> to test the UI placeholder.
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
          <span>
            {whisperStatus === 'Ready'
              ? `Ready (${whisperInfo?.engine.toUpperCase()} • ${whisperInfo?.modelPath ? whisperInfo.modelPath.split(/[/\\]/).pop() : 'model'})`
              : whisperStatus}
          </span>
        </div>
        <div className="footer-item">
          <span>Local-only architecture • Secure sandbox context isolation</span>
        </div>
      </footer>
    </div>
  )
}
