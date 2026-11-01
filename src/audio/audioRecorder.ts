/**
 * Audio Recorder & Microphone Capture Manager (Phase 4)
 *
 * Captures microphone audio using Web Audio API in the Electron renderer,
 * resamples to 16,000 Hz mono PCM, buffers samples into bounded 3.0-second chunks,
 * detects silence, encodes compliant 16-bit PCM WAV chunks, and emits them for transcription.
 */

import { resampleTo16k } from './resampler'
import { encodeWav16kMono } from './wavEncoder'

export interface AudioChunkPayload {
  wavBuffer: Uint8Array
  durationSec: number
  sampleCount: number
  rms: number
  isSilent: boolean
  chunkIndex: number
  sessionId: string
  isFinal: boolean
}

export interface AudioRecorderOptions {
  /** Target chunk duration in seconds (default: 3.0s = 48000 samples @ 16kHz) */
  chunkDurationSec?: number
  /** Minimum duration in seconds required to flush a final chunk on stop (default: 0.5s) */
  minFinalChunkDurationSec?: number
  /** RMS amplitude threshold below which a chunk is flagged silent (default: 0.005) */
  silenceThreshold?: number
  /** Callback fired whenever a chunk is ready for transcription */
  onChunk: (chunk: AudioChunkPayload) => void
  /** Callback fired when an unexpected recording or hardware error occurs */
  onError: (error: Error) => void
}

export class AudioRecorder {
  private options: Required<AudioRecorderOptions>
  private mediaStream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private scriptNode: ScriptProcessorNode | null = null

  private isRecording = false
  private sessionId = ''
  private chunkIndex = 0
  private accumulator: number[] = []
  private targetChunkSamples: number
  private minFinalSamples: number

  constructor(options: AudioRecorderOptions) {
    this.options = {
      chunkDurationSec: options.chunkDurationSec ?? 3.0,
      minFinalChunkDurationSec: options.minFinalChunkDurationSec ?? 0.5,
      silenceThreshold: options.silenceThreshold ?? 0.005,
      onChunk: options.onChunk,
      onError: options.onError,
    }

    this.targetChunkSamples = Math.round(this.options.chunkDurationSec * 16000)
    this.minFinalSamples = Math.round(this.options.minFinalChunkDurationSec * 16000)
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
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
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
    this.chunkIndex = 0
    this.accumulator = []

    // 2. Initialize AudioContext at native hardware sample rate
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.audioContext = new AudioContextClass()

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }

      const sourceSampleRate = this.audioContext.sampleRate
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream)

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
            this.handlePcmInput(rawPcm, sourceSampleRate)
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
          this.handlePcmInput(inputData, sourceSampleRate)
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
   * Receives incoming raw PCM from worklet/node, downsamples to 16kHz,
   * buffers into 3.0s chunks, and emits chunk events.
   */
  private handlePcmInput(rawPcm: Float32Array, sourceSampleRate: number): void {
    if (!this.isRecording) return

    // Resample block to 16,000 Hz mono
    const resampled = resampleTo16k(rawPcm, sourceSampleRate, 16000)
    for (let i = 0; i < resampled.length; i++) {
      this.accumulator.push(resampled[i])
    }

    // Check if accumulator has reached chunk boundary
    while (this.accumulator.length >= this.targetChunkSamples) {
      const chunkSamples = new Float32Array(this.accumulator.splice(0, this.targetChunkSamples))
      this.emitChunk(chunkSamples, false)
    }
  }

  /**
   * Encodes and emits a chunk of 16kHz samples.
   */
  private emitChunk(samples: Float32Array, isFinal: boolean): void {
    const encoded = encodeWav16kMono(samples, 16000, this.options.silenceThreshold)

    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `[AudioRecorder] Emitting chunk #${this.chunkIndex}: ` +
        `duration=${encoded.durationSec.toFixed(2)}s, rms=${encoded.rms.toFixed(4)}, silent=${encoded.isSilent}, final=${isFinal}`
      )
    }

    this.options.onChunk({
      wavBuffer: encoded.wavBuffer,
      durationSec: encoded.durationSec,
      sampleCount: encoded.sampleCount,
      rms: encoded.rms,
      isSilent: encoded.isSilent,
      chunkIndex: this.chunkIndex++,
      sessionId: this.sessionId,
      isFinal,
    })
  }

  /**
   * Stops recording, flushes the final partial chunk (if >= 0.5s), and releases all resources.
   */
  public async stop(): Promise<void> {
    if (!this.isRecording) return

    this.isRecording = false

    // Flush final partial chunk if it meets minimum threshold
    if (this.accumulator.length >= this.minFinalSamples) {
      const finalSamples = new Float32Array(this.accumulator)
      this.accumulator = []
      this.emitChunk(finalSamples, true)
    } else {
      this.accumulator = []
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
