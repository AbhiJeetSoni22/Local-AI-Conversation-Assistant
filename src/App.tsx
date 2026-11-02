import { useState, useEffect, useRef } from 'react'
import type { WhisperReadiness, OllamaReadiness } from './types/electron'
import { AudioRecorder } from './audio/audioRecorder'
import { TranscriptionQueue } from './audio/transcriptionQueue'
import { SegmentGate, appendSegmentText } from './audio/transcriptAccumulator'
import { isAudioDebugEnabled } from './audio/debug'

type AppStatus = 'Idle' | 'Listening' | 'Stopped' | 'Generating'
type ComponentStatus = 'Checking' | 'Ready' | 'Unavailable'
type SessionDisplayState = 'Ready' | 'Recording' | 'Transcribing' | 'Generating' | 'Completed' | 'Error' | 'Cancelled'

const SAMPLE_TRANSCRIPT = `Speaker 1: Welcome everyone. We are discussing our system architecture for the local AI assistant.
Speaker 2: Yes, the primary goal is ensuring all audio transcription and LLM inference remain 100% on the local device without any cloud APIs.
Speaker 1: Exactly. Can someone explain why we chose whisper.cpp and Ollama rather than using hosted cloud endpoints?`

export default function App() {
  const [status, setStatus] = useState<AppStatus>('Idle')
  const [systemInfo, setSystemInfo] = useState<string>('Detecting environment...')
  const [isCheckingServices, setIsCheckingServices] = useState<boolean>(false)

  // Whisper State
  const [whisperStatus, setWhisperStatus] = useState<ComponentStatus>('Checking')
  const [whisperInfo, setWhisperInfo] = useState<WhisperReadiness | null>(null)

  // Ollama State
  const [ollamaStatus, setOllamaStatus] = useState<ComponentStatus>('Checking')
  const [ollamaInfo, setOllamaInfo] = useState<OllamaReadiness | null>(null)

  // Conversation & Answer State
  const [transcript, setTranscript] = useState<string>('')
  const [isEditingTranscript, setIsEditingTranscript] = useState<boolean>(false)
  const [suggestedAnswer, setSuggestedAnswer] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState<boolean>(false)
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false)
  // True while any chunk is being transcribed OR still waiting in the queue (e.g. the final chunk after Stop)
  const [transcriptionBusy, setTranscriptionBusy] = useState<boolean>(false)
  const [streamMeta, setStreamMeta] = useState<{ durationMs?: number; model?: string; isCancelled?: boolean } | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [copied, setCopied] = useState<boolean>(false)

  // Phase 4 Audio Recorder and Queue References
  const audioRecorderRef = useRef<AudioRecorder | null>(null)
  const transcriptionQueueRef = useRef<TranscriptionQueue | null>(null)
  const segmentGateRef = useRef<SegmentGate>(new SegmentGate())

  // Dynamic Service Readiness Checker
  const checkReadiness = async () => {
    if (!window.electronApi) {
      setSystemInfo('Web preview mode')
      setWhisperStatus('Unavailable')
      setOllamaStatus('Unavailable')
      return
    }

    setIsCheckingServices(true)
    try {
      const [whisperRes, ollamaRes] = await Promise.all([
        window.electronApi.getWhisperReadiness().catch((err) => ({
          valid: false,
          status: 'Unavailable' as const,
          executableFound: false,
          modelFound: false,
          executablePath: '',
          modelPath: '',
          engine: 'cli' as const,
          error: err instanceof Error ? err.message : String(err),
        })),
        window.electronApi.getOllamaReadiness().catch((err) => ({
          ready: false,
          status: 'Unavailable' as const,
          serviceReachable: false,
          modelAvailable: false,
          baseUrl: 'http://127.0.0.1:11434',
          model: 'qwen2.5:3b',
          availableModels: [] as string[],
          error: err instanceof Error ? err.message : String(err),
        })),
      ])

      setWhisperInfo(whisperRes)
      setWhisperStatus(whisperRes.status)
      setOllamaInfo(ollamaRes)
      setOllamaStatus(ollamaRes.status)

      // If services are ready, clear previous service-related errors
      if (whisperRes.status === 'Ready' && ollamaRes.status === 'Ready') {
        setValidationError((prev) => (prev && (prev.includes('Whisper') || prev.includes('Ollama')) ? null : prev))
      }
    } finally {
      setIsCheckingServices(false)
    }
  }

  useEffect(() => {
    // 1. Initialize Transcription Queue
    const queue = new TranscriptionQueue({
      transcribeChunk: async (chunk) => {
        if (!window.electronApi) {
          throw new Error('Electron API is unavailable in this environment.')
        }
        return await window.electronApi.transcribeAudioChunk(chunk)
      },
      onSegment: (segment) => {
        const clean = segment.text.trim()
        if (!clean || segment.isSilent) return
        // Identity-based guard: ignores duplicates, out-of-order results and other sessions' output.
        if (!segmentGateRef.current.accept(segment)) return
        if (isAudioDebugEnabled()) {
          // Metadata only. Transcript text is never written to the console.
          console.log(`[Transcript] segment accepted: session=${segment.sessionId} chunk=${segment.chunkIndex} chars=${clean.length}`)
        }
        setTranscript((prev) => appendSegmentText(prev, clean))
      },
      onStatusChange: (qStatus) => {
        setIsTranscribing(qStatus.isProcessing)
        setTranscriptionBusy(qStatus.isProcessing || qStatus.pendingCount > 0)
      },
      onError: (err) => {
        setValidationError(`Transcription error: ${err.message}`)
      },
    })
    transcriptionQueueRef.current = queue

    if (window.electronApi) {
      // 2. Fetch app status
      window.electronApi.getStatus()
        .then((info) => {
          setSystemInfo(`${info.platform} (v${info.version}) • Electron IPC Active`)
        })
        .catch(() => {
          setSystemInfo('Electron IPC available')
        })

      // 3. Initial Readiness Check
      checkReadiness()

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
        setGenerationError(data.error)
        setValidationError(`Generation error: ${data.error}`)
      })

      return () => {
        unsubscribeChunk()
        unsubscribeDone()
        unsubscribeCancelled()
        unsubscribeError()
        if (audioRecorderRef.current) {
          audioRecorderRef.current.stop().catch(() => {})
        }
        queue.clear()
      }
    } else {
      setSystemInfo('Web preview mode')
      setWhisperStatus('Unavailable')
      setOllamaStatus('Unavailable')
      return () => {
        if (audioRecorderRef.current) {
          audioRecorderRef.current.stop().catch(() => {})
        }
        queue.clear()
      }
    }
  }, [])

  const handleStart = async () => {
    setValidationError(null)
    setIsEditingTranscript(false)

    // Validation: Whisper must be ready
    if (whisperStatus !== 'Ready') {
      setValidationError(
        whisperInfo?.error || 'Whisper speech recognition is unavailable. Place whisper-cli.exe in bin/ and ggml-base.en.bin in models/.'
      )
      return
    }

    if (status === 'Listening' || isGenerating || transcriptionBusy) return

    try {
      // Defaults: pause-aligned utterance segmentation. Tuning/A-B options (see docs/TROUBLESHOOTING.md):
      //   segmentation: 'fixed'                       -> legacy blind cuts every chunkDurationSec
      //   segmenter: { minSpeechRms: 0.008, ... }     -> speech-energy thresholds
      //   audioConstraints: { noiseSuppression: false, autoGainControl: false }
      const recorder = new AudioRecorder({
        chunkDurationSec: 3.0, // used only when segmentation === 'fixed'
        minFinalChunkDurationSec: 0.5, // used only when segmentation === 'fixed'
        onChunk: (chunk) => {
          transcriptionQueueRef.current?.enqueue(chunk)
        },
        onError: (err) => {
          setValidationError(err.message)
          setStatus('Stopped')
        },
      })
      audioRecorderRef.current = recorder

      const sessionId = await recorder.start()
      segmentGateRef.current.startSession(sessionId)
      transcriptionQueueRef.current?.setActiveSession(sessionId)
      setStatus('Listening')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setValidationError(message)
      setStatus('Stopped')
    }
  }

  const handleStop = async () => {
    if (audioRecorderRef.current && audioRecorderRef.current.getIsRecording()) {
      try {
        await audioRecorderRef.current.stop()
      } catch (err: unknown) {
        console.error('Error stopping audio recorder:', err)
      }
    }
    setStatus('Stopped')
  }

  const handleSuggestAnswer = async () => {
    setValidationError(null)
    setGenerationError(null)
    setIsEditingTranscript(false)

    // Validation 1: Transcript must exist
    if (!transcript.trim()) {
      setValidationError('Cannot suggest answer: Conversation transcript is empty. Record speech or load a sample first.')
      return
    }

    // Validation 1b: the final chunk after Stop may still be transcribing; answering now would use a truncated transcript
    if (transcriptionBusy) {
      setValidationError('Transcription is still finishing the last audio. Please wait a moment, then try again.')
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
          setGenerationError(response.error)
          setValidationError(response.error)
          setIsGenerating(false)
          setStatus('Stopped')
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      setGenerationError(errMsg)
      setValidationError(errMsg)
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
    setGenerationError(null)
  }

  const handleLoadSampleTranscript = () => {
    setTranscript(SAMPLE_TRANSCRIPT)
    setValidationError(null)
    setIsEditingTranscript(false)
  }

  const handleClearTranscript = () => {
    setTranscript('')
    setIsEditingTranscript(false)
    setValidationError(null)
  }

  const handleCopyAnswer = () => {
    if (!suggestedAnswer) return
    navigator.clipboard.writeText(suggestedAnswer)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const renderFormattedTranscript = (text: string) => {
    const lines = text.split('\n')
    return lines.map((line, idx) => {
      const match = line.match(/^(Speaker\s*\d+|User|Assistant|Person\s*[A-Z]?):\s*(.*)$/i)
      if (match) {
        const speaker = match[1]
        const message = match[2]
        return (
          <div key={idx} className="transcript-line">
            <span className="transcript-speaker">{speaker}</span>
            <span className="transcript-speech">{message}</span>
          </div>
        )
      }
      return (
        <div key={idx} className="transcript-line raw">
          <span className="transcript-speech">{line}</span>
        </div>
      )
    })
  }

  const sessionState: SessionDisplayState = isGenerating
    ? 'Generating'
    : status === 'Listening'
      ? 'Recording'
      : transcriptionBusy
        ? 'Transcribing'
        : generationError || validationError
          ? 'Error'
          : streamMeta?.isCancelled
            ? 'Cancelled'
            : suggestedAnswer && !isGenerating
              ? 'Completed'
              : 'Ready'

  return (
    <div className="app-container">
      {/* Refined Top Header */}
      <header className="app-header">
        <div className="header-brand">
          <div className="app-mark" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20M17 5v14M7 9v6M22 10v4M2 10v4" />
            </svg>
          </div>
          <div className="brand-text">
            <h1 className="app-title">Local AI Assistant</h1>
            <p className="app-subtitle">Private • On-Device Intelligence</p>
          </div>
        </div>

        {/* Quiet Runtime & Session Telemetry Cluster */}
        <div className="header-meta">
          <div className="telemetry-bar">
            {/* Whisper Status Indicator */}
            <div
              className={`telemetry-item ${whisperStatus.toLowerCase()}`}
              title={whisperInfo?.error || (whisperStatus === 'Ready' ? `whisper.cpp ${whisperInfo?.engine.toUpperCase()} ready` : 'Whisper speech-to-text')}
            >
              <span className={`status-dot ${whisperStatus.toLowerCase()}`}></span>
              <span className="telemetry-name">Whisper</span>
              <span className="telemetry-val">
                {whisperStatus === 'Ready' ? 'Ready' : whisperStatus}
              </span>
            </div>

            <span className="telemetry-divider" aria-hidden="true"></span>

            {/* Ollama Status Indicator */}
            <div
              className={`telemetry-item ${ollamaStatus.toLowerCase()}`}
              title={ollamaInfo?.error || (ollamaStatus === 'Ready' ? `Ollama service active (${ollamaInfo?.model})` : 'Ollama local LLM')}
            >
              <span className={`status-dot ${ollamaStatus.toLowerCase()}`}></span>
              <span className="telemetry-name">Ollama</span>
              <span className="telemetry-val">
                {ollamaStatus === 'Ready' ? (ollamaInfo?.model || 'Ready') : ollamaStatus}
              </span>
            </div>

            <span className="telemetry-divider" aria-hidden="true"></span>

            {/* Dynamic Re-check Services Button */}
            <button
              id="btn-recheck-services"
              className="telemetry-recheck"
              onClick={() => checkReadiness()}
              disabled={isCheckingServices}
              title="Re-check local Whisper and Ollama service readiness"
              aria-label="Re-check services"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={isCheckingServices ? 'spin' : ''}
                aria-hidden="true"
              >
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              <span>{isCheckingServices ? 'Checking...' : 'Re-check'}</span>
            </button>
          </div>

          {/* Active Session Status Badge */}
          <div className={`session-badge ${sessionState.toLowerCase()}`}>
            <span className="session-dot"></span>
            <span className="session-label">{sessionState}</span>
          </div>
        </div>
      </header>

      {/* Main Action Bar */}
      <section className="action-bar" aria-label="Application Actions">
        <div className="action-group">
          {/* Start Action */}
          <button
            id="btn-start"
            className="btn btn-primary"
            onClick={handleStart}
            disabled={status === 'Listening' || isGenerating || transcriptionBusy || whisperStatus !== 'Ready'}
            title={
              whisperStatus !== 'Ready'
                ? 'Whisper STT is unavailable. Check telemetry or bin/ directory.'
                : status === 'Listening'
                  ? 'Recording is already in progress.'
                  : transcriptionBusy
                    ? 'Wait for previous transcription to finish.'
                    : 'Start capturing microphone audio and transcribing locally'
            }
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <span>Start</span>
          </button>

          {/* Stop Action */}
          <button
            id="btn-stop"
            className="btn btn-stop"
            onClick={handleStop}
            disabled={status !== 'Listening' || isGenerating}
            title="Stop recording and flush final audio chunk"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
            <span>Stop</span>
          </button>

          <span className="actions-separator" aria-hidden="true"></span>

          {/* Suggest Answer Action */}
          <button
            id="btn-suggest"
            className="btn btn-suggest"
            onClick={handleSuggestAnswer}
            disabled={isGenerating || status === 'Listening' || transcriptionBusy || ollamaStatus !== 'Ready' || !transcript.trim()}
            title={
              status === 'Listening'
                ? 'Stop recording before generating an answer.'
                : transcriptionBusy
                  ? 'Waiting for transcription of the last audio to finish.'
                  : ollamaStatus !== 'Ready'
                  ? 'Ollama is offline or model is missing.'
                  : !transcript.trim()
                    ? 'Record speech or load a transcript first.'
                    : 'Synthesize suggested answer locally from transcript'
            }
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z" />
            </svg>
            <span>{isGenerating ? 'Generating...' : 'Suggest Answer'}</span>
          </button>

          {/* Cancel Generation Button */}
          {isGenerating && (
            <button
              id="btn-cancel"
              className="btn btn-cancel"
              onClick={handleCancelAnswer}
              title="Cancel active Ollama inference"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              <span>Cancel</span>
            </button>
          )}
        </div>

        {/* Context Hint */}
        <div className="action-hint">
          {status === 'Listening' ? (
            <span className="hint-active">
              {isTranscribing ? 'Transcribing speech chunk...' : 'Listening... speak into microphone'}
            </span>
          ) : transcriptionBusy ? (
            <span className="hint-transcribing">Finishing transcription with whisper.cpp...</span>
          ) : isGenerating ? (
            <span className="hint-generating">Streaming answer locally via {ollamaInfo?.model || 'qwen2.5:3b'}</span>
          ) : sessionState === 'Error' ? (
            <span className="hint-error">Action interrupted. Review notice above or retry.</span>
          ) : sessionState === 'Completed' ? (
            <span className="hint-completed">Answer generated locally • Ready for follow-up</span>
          ) : (
            <span className="hint-idle">Zero cloud dependencies • 100% offline</span>
          )}
        </div>
      </section>

      {/* Dismissible Error / Notice Banner */}
      {validationError && (
        <div className="system-banner error" role="alert">
          <div className="banner-content">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{validationError}</span>
          </div>
          <button className="banner-dismiss" onClick={() => setValidationError(null)} aria-label="Dismiss notice">
            Dismiss
          </button>
        </div>
      )}

      {/* Main Dual-Panel Workspace */}
      <main className="workspace-grid">
        {/* Left Panel: Live Transcript */}
        <section className="workspace-panel" aria-labelledby="heading-transcript">
          <div className="panel-header">
            <div className="panel-header-title">
              <h2 id="heading-transcript" className="panel-title">Conversation Transcript</h2>
              <span className="panel-badge">
                {status === 'Listening'
                  ? (isTranscribing ? 'Transcribing...' : 'Live')
                  : transcriptionBusy
                    ? 'Finishing...'
                    : isEditingTranscript
                      ? 'Editing'
                      : 'whisper.cpp'}
              </span>
            </div>
            <div className="panel-header-actions">
              {transcript && status !== 'Listening' && !isGenerating && (
                <>
                  <button
                    id="btn-edit-transcript"
                    className="btn-text-ghost"
                    onClick={() => setIsEditingTranscript((prev) => !prev)}
                    title={isEditingTranscript ? 'Done editing' : 'Edit transcript text before sending to AI'}
                  >
                    {isEditingTranscript ? 'Done' : 'Edit'}
                  </button>
                  <button
                    id="btn-clear-transcript"
                    className="btn-text-ghost"
                    onClick={handleClearTranscript}
                    title="Clear conversation transcript"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="panel-body">
            {/* Whisper Warning Notice if Missing */}
            {whisperStatus === 'Unavailable' && (
              <div className="notice-box warning">
                <div className="notice-header">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>Whisper STT Unavailable</span>
                </div>
                <p className="notice-text">
                  {whisperInfo?.error || 'Local whisper.cpp executable or model is missing.'}
                </p>
                <div className="notice-code-block">
                  Place <code>whisper-cli.exe</code> in <code>bin/</code> and <code>ggml-base.en.bin</code> in <code>models/</code>
                </div>
                <button
                  type="button"
                  className="btn-notice-recheck"
                  onClick={() => checkReadiness()}
                  disabled={isCheckingServices}
                >
                  {isCheckingServices ? 'Checking Whisper...' : 'Re-check Whisper'}
                </button>
              </div>
            )}

            {/* Transcript Content Display or Editor */}
            {transcript ? (
              isEditingTranscript ? (
                <div className="transcript-edit-container">
                  <textarea
                    id="transcript-editor"
                    className="transcript-textarea"
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    placeholder="Edit conversation transcript here..."
                    aria-label="Edit conversation transcript"
                  />
                  <div className="transcript-edit-hints">
                    <span className="edit-hint-text">
                      Review or correct words (e.g. technical names). Edits will be sent to Ollama.
                    </span>
                    <button
                      type="button"
                      className="btn-utility-primary"
                      onClick={() => setIsEditingTranscript(false)}
                    >
                      Done Editing
                    </button>
                  </div>
                </div>
              ) : (
                <div className="transcript-canvas">
                  {renderFormattedTranscript(transcript)}
                  {status === 'Listening' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8', fontSize: '12px', marginTop: '8px' }}>
                      <span className="status-dot listening" style={{ width: 6, height: 6 }}></span>
                      <span>{isTranscribing ? 'Transcribing audio chunk...' : 'Listening for speech...'}</span>
                    </div>
                  )}
                  {transcriptionBusy && status !== 'Listening' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#38bdf8', fontSize: '12px', marginTop: '8px' }}>
                      <span className="status-dot checking" style={{ width: 6, height: 6 }}></span>
                      <span>Finishing final transcription...</span>
                    </div>
                  )}
                </div>
              )
            ) : status === 'Listening' ? (
              <div className="state-empty listening">
                <div className="empty-indicator pulse">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                </div>
                <h3 className="empty-title">Recording Active</h3>
                <p className="empty-desc">
                  {isTranscribing ? 'Processing audio chunk with whisper.cpp...' : 'Speak into your microphone. Transcribed speech will appear here.'}
                </p>
              </div>
            ) : (
              <div className="state-empty">
                <div className="empty-indicator">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <h3 className="empty-title">No Conversation Recorded</h3>
                <p className="empty-desc">
                  Click <strong>Start</strong> to begin live microphone transcription, or load a sample transcript to test answer generation immediately:
                </p>
                <div className="empty-action">
                  <button className="btn-utility" onClick={handleLoadSampleTranscript}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                    <span>Load sample meeting transcript</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right Panel: AI Suggested Answer */}
        <section className="workspace-panel" aria-labelledby="heading-answer">
          <div className="panel-header">
            <div className="panel-header-title">
              <h2 id="heading-answer" className="panel-title">AI Suggested Answer</h2>
              <span className="panel-badge">
                {ollamaStatus === 'Ready' ? (ollamaInfo?.model || 'qwen2.5:3b') : 'Ollama'}
              </span>
            </div>
            <div className="panel-header-actions">
              {generationError && !isGenerating && (
                <button
                  className="btn-text-ghost"
                  onClick={handleSuggestAnswer}
                  disabled={transcriptionBusy || ollamaStatus !== 'Ready' || !transcript.trim()}
                  title="Retry generating answer"
                >
                  Retry
                </button>
              )}
              {suggestedAnswer && !isGenerating && (
                <>
                  <button
                    className="btn-text-ghost"
                    onClick={handleCopyAnswer}
                    title="Copy generated answer to clipboard"
                  >
                    {copied ? (
                      <span className="text-success-inline">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Copied
                      </span>
                    ) : (
                      'Copy'
                    )}
                  </button>
                  <button
                    className="btn-text-ghost"
                    onClick={handleResetAnswer}
                    title="Clear current answer"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="panel-body">
            {/* Ollama Warning Notice if Missing */}
            {ollamaStatus === 'Unavailable' && (
              <div className="notice-box warning">
                <div className="notice-header">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>Ollama Service Unavailable</span>
                </div>
                <p className="notice-text">
                  {ollamaInfo?.error || 'Local Ollama runtime is not running or model is missing.'}
                </p>
                <div className="notice-code-block">
                  Run in terminal: <code>ollama pull qwen2.5:3b</code>
                </div>
                <button
                  type="button"
                  className="btn-notice-recheck"
                  onClick={() => checkReadiness()}
                  disabled={isCheckingServices}
                >
                  {isCheckingServices ? 'Checking Ollama...' : 'Re-check Ollama'}
                </button>
              </div>
            )}

            {/* Answer Display */}
            {generationError && !isGenerating ? (
              <div className="answer-error-card" role="alert">
                <div className="answer-error-header">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>Answer Generation Failed</span>
                </div>
                <p className="answer-error-message">{generationError}</p>
                <div className="answer-error-actions">
                  <button
                    id="btn-retry-answer"
                    className="btn btn-primary btn-retry"
                    onClick={handleSuggestAnswer}
                    disabled={isGenerating || status === 'Listening' || transcriptionBusy || ollamaStatus !== 'Ready' || !transcript.trim()}
                    title="Retry answer generation using the existing transcript"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    </svg>
                    <span>Retry Answer</span>
                  </button>
                  <button
                    className="btn-text-ghost"
                    onClick={() => setGenerationError(null)}
                    title="Dismiss error notice"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ) : suggestedAnswer !== null ? (
              <div className="answer-canvas">
                {/* Meta bar */}
                <div className="answer-status-bar">
                  {isGenerating ? (
                    <div className="answer-status-generating">
                      <span className="dot-pulse-purple"></span>
                      <span>Streaming response from {ollamaInfo?.model || 'qwen2.5:3b'}...</span>
                    </div>
                  ) : streamMeta?.isCancelled ? (
                    <div className="answer-status-cancelled">
                      <span>Generation cancelled by user</span>
                    </div>
                  ) : (
                    <div className="answer-status-complete">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>
                        Generated in {streamMeta?.durationMs ? `${(streamMeta.durationMs / 1000).toFixed(2)}s` : '0.0s'}
                        {streamMeta?.model ? ` • ${streamMeta.model}` : ''}
                      </span>
                    </div>
                  )}

                  {isGenerating && (
                    <button className="btn-cancel-mini" onClick={handleCancelAnswer}>
                      Cancel
                    </button>
                  )}
                </div>

                {/* Text Content */}
                <div className="answer-prose">
                  {suggestedAnswer}
                  {isGenerating && <span className="stream-caret" aria-hidden="true"></span>}
                </div>
              </div>
            ) : (
              <div className="state-empty">
                <div className="empty-indicator">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                </div>
                <h3 className="empty-title">Ready for Questions</h3>
                <p className="empty-desc">
                  When a conversation transcript is recorded or loaded, click <strong>Suggest Answer</strong> to synthesize talking points and answers with on-device AI.
                </p>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Unobtrusive Minimalist Footer */}
      <footer className="app-footer">
        <div className="footer-left">
          <span className="footer-pill">Local Engine</span>
          <span className="footer-text">{systemInfo}</span>
        </div>
        <div className="footer-right">
          <span>Private • Air-Gapped • Zero Cloud Telemetry</span>
        </div>
      </footer>
    </div>
  )
}
