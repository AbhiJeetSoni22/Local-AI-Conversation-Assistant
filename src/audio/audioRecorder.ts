/**
 * Audio Recorder & Microphone Capture Manager (Phase 4)
 *
 * Captures microphone audio using the Web Audio API in the Electron renderer and hands raw PCM
 * blocks to ChunkPipeline, which resamples to 16 kHz mono (stateful StreamingResampler), cuts the
 * stream into utterance segments (SpeechSegmenter) or legacy fixed chunks, and encodes 16-bit PCM WAV.
 * This class only owns the browser plumbing: permission, AudioContext, worklet, Start/Stop lifecycle.
 */

import { ChunkPipeline, AudioChunkPayload, SegmentationMode } from './chunkPipeline'
import type { SpeechSegmenterOptions } from './speechSegmenter'
import { isAudioDebugEnabled } from './debug'

export type { AudioChunkPayload } from './chunkPipeline'

export interface AudioConstraintOptions {
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
}

export interface AudioRecorderOptions {
  /**
   * 'speech' (default): pause-aligned utterance segments with non-speech trimmed.
   * 'fixed': legacy behaviour - blind cuts every chunkDurationSec (kept for A/B comparison).
   */
  segmentation?: SegmentationMode
  /** Fixed mode only: chunk duration in seconds (default 3.0s = 48000 samples @ 16kHz) */
  chunkDurationSec?: number
  /** Fixed mode only: minimum duration in seconds required to flush a final chunk on stop (default: 0.5s) */
  minFinalChunkDurationSec?: number
  /** RMS amplitude threshold below which a whole chunk is flagged silent (default: 0.005) */
  silenceThreshold?: number
  /** Speech segmenter tuning (speech mode) */
  segmenter?: SpeechSegmenterOptions
  /** Browser DSP constraints for getUserMedia (default: all true, unchanged from Phase 4) */
  audioConstraints?: Partial<AudioConstraintOptions>
  /** Callback fired whenever a chunk is ready for transcription */
  onChunk: (chunk: AudioChunkPayload) => void
  /** Callback fired when an unexpected recording or hardware error occurs */
  onError: (error: Error) => void
}

export interface AudioCaptureDiagnostics {
  contextSampleRate: number
  trackSettings: {
    sampleRate?: number
    channelCount?: number
    echoCancellation?: boolean
    noiseSuppression?: boolean
    autoGainControl?: boolean
  }
}

export class AudioRecorder {
  private options: AudioRecorderOptions
  private mediaStream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private scriptNode: ScriptProcessorNode | null = null

  private isRecording = false
  private sessionId = ''
  private pipeline: ChunkPipeline | null = null
  private diagnostics: AudioCaptureDiagnostics | null = null

  constructor(options: AudioRecorderOptions) {
    this.options = options
  }

  /** Numeric capture facts (device rate, DSP flags actually applied). Available after start(). */
  public getDiagnostics(): AudioCaptureDiagnostics | null {
    return this.diagnostics
  }

  public getIsRecording(): boolean {
    return this.isRecording
  }

  public getSessionId(): string {
    return this.sessionId
  }

  /**
   * Requests microphone access and starts capturing audio.
   */
  public async start(): Promise<string> {
    if (this.isRecording) {
      throw new Error('Recording is already in progress.')
    }

    // 1. Request microphone permission
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: this.options.audioConstraints?.echoCancellation ?? true,
          noiseSuppression: this.options.audioConstraints?.noiseSuppression ?? true,
          autoGainControl: this.options.audioConstraints?.autoGainControl ?? true,
        },
        video: false,
      })
    } catch (err: unknown) {
      const error = this.formatMediaError(err)
      throw error
    }

    // Handle device disconnection mid-recording
    const audioTrack = this.mediaStream.getAudioTracks()[0]
    if (audioTrack) {
      audioTrack.onended = () => {
        if (this.isRecording) {
          this.options.onError(new Error('Microphone disconnected unexpectedly.'))
          this.stop().catch(() => {})
        }
      }
    }

    this.isRecording = true
    this.sessionId = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.pipeline = null

    // 2. Initialize AudioContext at native hardware sample rate
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.audioContext = new AudioContextClass()

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }

      const sourceSampleRate = this.audioContext.sampleRate
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream)

      // One stateful pipeline per recording: resampler phase/history must persist across blocks.
      this.pipeline = new ChunkPipeline({
        sourceSampleRate,
        sessionId: this.sessionId,
        mode: this.options.segmentation ?? 'speech',
        chunkDurationSec: this.options.chunkDurationSec,
        minFinalChunkDurationSec: this.options.minFinalChunkDurationSec,
        silenceThreshold: this.options.silenceThreshold,
        segmenter: this.options.segmenter,
      })

      const settings = audioTrack?.getSettings ? audioTrack.getSettings() : {}
      this.diagnostics = {
        contextSampleRate: sourceSampleRate,
        trackSettings: {
          sampleRate: settings.sampleRate,
          channelCount: settings.channelCount,
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGainControl,
        },
      }
      if (isAudioDebugEnabled()) {
        console.log('[AudioRecorder] capture settings:', JSON.stringify(this.diagnostics), `mode=${this.pipeline.getMode()}`)
      }

      // 3. Try AudioWorklet first; fallback to ScriptProcessorNode
      let workletAttached = false
      if (this.audioContext.audioWorklet) {
        try {
          const workletCode = `
            class PcmCaptureProcessor extends AudioWorkletProcessor {
              process(inputs) {
                const input = inputs[0];
                if (input && input[0] && input[0].length > 0) {
                  this.port.postMessage(input[0]);
                }
                return true;
              }
            }
            registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
          `
          const blob = new Blob([workletCode], { type: 'application/javascript' })
          const blobUrl = URL.createObjectURL(blob)
          await this.audioContext.audioWorklet.addModule(blobUrl)
          URL.revokeObjectURL(blobUrl)

          this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-capture-processor')
          this.workletNode.port.onmessage = (event) => {
            const rawPcm = event.data as Float32Array
            this.handlePcmInput(rawPcm)
          }

          this.sourceNode.connect(this.workletNode)
          // Silent gain termination to keep the graph active in Chromium
          const dummyGain = this.audioContext.createGain()
          dummyGain.gain.value = 0
          this.workletNode.connect(dummyGain)
          dummyGain.connect(this.audioContext.destination)
          workletAttached = true
        } catch {
          workletAttached = false
        }
      }

      if (!workletAttached) {
        // Fallback for environments where AudioWorklet is not supported
        this.scriptNode = this.audioContext.createScriptProcessor(4096, 1, 1)
        this.scriptNode.onaudioprocess = (event) => {
          const inputData = event.inputBuffer.getChannelData(0)
          this.handlePcmInput(inputData)
        }
        this.sourceNode.connect(this.scriptNode)
        this.scriptNode.connect(this.audioContext.destination)
      }
    } catch (err: unknown) {
      await this.cleanup()
      throw new Error(`Failed to initialize Web Audio pipeline: ${err instanceof Error ? err.message : String(err)}`)
    }

    return this.sessionId
  }

  /**
   * Receives incoming raw PCM from the worklet/script node and pushes it through the pipeline.
   * NOTE: the worklet reuses/transfers its buffer per message, so the block is copied before use.
   */
  private handlePcmInput(rawPcm: Float32Array): void {
    if (!this.isRecording || !this.pipeline) return
    for (const chunk of this.pipeline.pushPcm(new Float32Array(rawPcm))) {
      this.emit(chunk)
    }
  }

  private emit(chunk: AudioChunkPayload): void {
    if (isAudioDebugEnabled()) {
      console.log(
        `[AudioRecorder] chunk #${chunk.chunkIndex}: duration=${chunk.durationSec.toFixed(2)}s ` +
        `rms=${chunk.rms.toFixed(4)} silent=${chunk.isSilent} final=${chunk.isFinal} ` +
        `meta=${JSON.stringify(chunk.meta)}`
      )
    }
    this.options.onChunk(chunk)
  }

  /**
   * Stops recording, flushes the final partial chunk exactly once, and releases all resources.
   * Safe to call repeatedly (second call is a no-op), so Stop + device-unplug cannot double-submit.
   */
  public async stop(): Promise<void> {
    if (!this.isRecording) return

    this.isRecording = false

    const pipeline = this.pipeline
    this.pipeline = null
    if (pipeline) {
      for (const chunk of pipeline.finish()) this.emit(chunk)
    }

    await this.cleanup()
  }

  /**
   * Releases all audio tracks, nodes, and AudioContext resources.
   */
  private async cleanup(): Promise<void> {
    this.isRecording = false

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        try {
          track.stop()
        } catch {
          // ignore
        }
      }
      this.mediaStream = null
    }

    if (this.workletNode) {
      try {
        this.workletNode.disconnect()
      } catch {
        // ignore
      }
      this.workletNode = null
    }

    if (this.scriptNode) {
      try {
        this.scriptNode.disconnect()
        this.scriptNode.onaudioprocess = null
      } catch {
        // ignore
      }
      this.scriptNode = null
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect()
      } catch {
        // ignore
      }
      this.sourceNode = null
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        await this.audioContext.close()
      } catch {
        // ignore
      }
      this.audioContext = null
    }
  }

  /**
   * Formats DOMExceptions from getUserMedia into clear user-friendly errors.
   */
  private formatMediaError(err: unknown): Error {
    if (err instanceof DOMException || (err instanceof Error && 'name' in err)) {
      switch (err.name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
          return new Error('Microphone permission denied. Please allow microphone access in Windows Settings (Privacy & Security > Microphone).')
        case 'NotFoundError':
        case 'DevicesNotFoundError':
          return new Error('No microphone device found on your system. Please connect an audio input device.')
        case 'NotReadableError':
        case 'TrackStartError':
          return new Error('Microphone is currently in use or blocked by another application.')
        case 'OverconstrainedError':
          return new Error('Microphone does not satisfy requested audio constraints.')
        default:
          return new Error(`Microphone error: ${err.message || err.name}`)
      }
    }
    return err instanceof Error ? err : new Error(String(err))
  }
}
