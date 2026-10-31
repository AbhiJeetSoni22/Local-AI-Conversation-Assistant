import { useState, useEffect } from 'react'

type AppStatus = 'Idle' | 'Listening' | 'Stopped'

export default function App() {
  const [status, setStatus] = useState<AppStatus>('Idle')
  const [suggestedAnswer, setSuggestedAnswer] = useState<string | null>(null)
  const [systemInfo, setSystemInfo] = useState<string>('Detecting environment...')

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
    } else {
      setSystemInfo('Web preview mode')
    }
  }, [])

  const handleStart = () => {
    // Scaffold UI state transition (Phase 1 only: no microphone or whisper.cpp integration)
    setStatus('Listening')
  }

  const handleStop = () => {
    // Scaffold UI state transition
    setStatus('Stopped')
  }

  const handleSuggestAnswer = () => {
    // Scaffold UI demonstration (Phase 1 only: no Ollama or AI generation)
    setSuggestedAnswer('AI answer generation will be added in a later phase.')
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

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="app-icon-badge">AI</div>
          <div>
            <h1 className="app-title">Local AI Conversation Assistant</h1>
            <p className="app-subtitle">Windows Desktop Scaffold • Phase 1 Prototype</p>
          </div>
        </div>
        <div className="header-right">
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
          <span className="pill-phase">Phase 1</span>
          <span>Temporary scaffold state only • Audio capture & AI models not active</span>
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
            <span className="panel-tag">whisper.cpp (Phase 2)</span>
          </div>
          <div className="panel-body">
            {status === 'Listening' ? (
              <div className="scaffold-active-notice">
                <div className="notice-icon">🎙️</div>
                <p className="notice-title">Status: Listening (Scaffold State)</p>
                <p className="notice-desc">
                  Microphone audio capture and local whisper.cpp speech transcription will stream here in a later phase.
                </p>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">📝</div>
                <p className="empty-state-text">
                  Microphone transcription will appear here in a later phase.
                </p>
                <p className="empty-state-subtext">
                  Click <strong>Start</strong> to test the UI state transition.
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
                  Note: Local Ollama LLM integration will be implemented in subsequent phases.
                </p>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">💡</div>
                <p className="empty-state-text">
                  The locally generated answer will appear here in a later phase.
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
          <span>Local-only architecture • Secure sandbox context isolation</span>
        </div>
      </footer>
    </div>
  )
}
