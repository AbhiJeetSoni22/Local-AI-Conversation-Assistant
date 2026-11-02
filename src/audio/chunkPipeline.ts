/**
 * Capture-side audio pipeline (pure, no Web Audio dependency):
 *
 *   raw mono PCM blocks @ device rate
 *     -> StreamingResampler (-> 16 kHz)
 *     -> SpeechSegmenter ("speech" mode)  or  fixed-length chunker ("fixed" mode)
 *     -> 16-bit PCM WAV (44-byte header)
 *     -> AudioChunkPayload (sessionId + monotonically increasing chunkIndex)
 *
 * AudioRecorder owns the browser plumbing (getUserMedia, AudioContext, worklet) and delegates all
 * signal handling to this class, which is what the automated tests drive with synthetic audio.
 */

import { StreamingResampler } from './resampler'
import { SpeechSegmenter, SpeechSegmenterOptions, SpeechSegment } from './speechSegmenter'
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
  /** Diagnostic only (numbers, never audio/text): why/how this chunk was cut. */
  meta?: ChunkMeta
}

export interface ChunkMeta {
  mode: 'speech' | 'fixed'
  reason: string
  speechSec?: number
  peakFrameRms?: number
  noiseFloor?: number
}

export type SegmentationMode = 'speech' | 'fixed'

export interface ChunkPipelineOptions {
  sourceSampleRate: number
  sessionId: string
  mode?: SegmentationMode
  /** Fixed mode: chunk length in seconds (default 3.0). */
  chunkDurationSec?: number
  /** Fixed mode: minimum length of the final partial chunk (default 0.5 s). */
  minFinalChunkDurationSec?: number
  /** WAV-level silence flag threshold on whole-chunk RMS (default 0.005). */
  silenceThreshold?: number
  segmenter?: SpeechSegmenterOptions
}

const TARGET_RATE = 16000

export class ChunkPipeline {
  private readonly mode: SegmentationMode
  private readonly resampler: StreamingResampler
  private readonly segmenter: SpeechSegmenter
  private readonly sessionId: string
  private readonly silenceThreshold: number
  private readonly targetChunkSamples: number
  private readonly minFinalSamples: number

  private chunkIndex = 0
  private fixedBuffer = new Float32Array(0)
  private finished = false

  constructor(options: ChunkPipelineOptions) {
    this.mode = options.mode ?? 'speech'
    this.sessionId = options.sessionId
    this.silenceThreshold = options.silenceThreshold ?? 0.005
    this.resampler = new StreamingResampler(options.sourceSampleRate, TARGET_RATE)
    this.segmenter = new SpeechSegmenter({ ...options.segmenter, sampleRate: TARGET_RATE })
    this.targetChunkSamples = Math.round((options.chunkDurationSec ?? 3.0) * TARGET_RATE)
    this.minFinalSamples = Math.round((options.minFinalChunkDurationSec ?? 0.5) * TARGET_RATE)
  }

  public getMode(): SegmentationMode {
    return this.mode
  }

  public getChunkCount(): number {
    return this.chunkIndex
  }

  public getNoiseFloor(): number {
    return this.segmenter.getNoiseFloor()
  }

  /** Feed one block of raw mono samples at the device sample rate. Returns completed chunks. */
  public pushPcm(block: Float32Array): AudioChunkPayload[] {
    if (this.finished) return []
    return this.consume16k(this.resampler.process(block))
  }

  /**
   * Call exactly once at Stop. Drains the resampler tail and flushes the final partial chunk.
   * Calling it again returns [] so a duplicate Stop can never submit the final chunk twice.
   */
  public finish(): AudioChunkPayload[] {
    if (this.finished) return []
    this.finished = true
    const out = this.consume16k(this.resampler.flush())

    if (this.mode === 'speech') {
      const seg = this.segmenter.flush()
      if (seg) out.push(this.fromSegment(seg, true))
    } else if (this.fixedBuffer.length >= this.minFinalSamples) {
      out.push(this.fromFixed(this.fixedBuffer, true))
    }
    this.fixedBuffer = new Float32Array(0)
    return out
  }

  // ---------------------------------------------------------------------------------------------

  private consume16k(samples: Float32Array): AudioChunkPayload[] {
    const out: AudioChunkPayload[] = []
    if (samples.length === 0) return out

    if (this.mode === 'speech') {
      for (const seg of this.segmenter.push(samples)) out.push(this.fromSegment(seg, false))
      return out
    }

    const merged = new Float32Array(this.fixedBuffer.length + samples.length)
    merged.set(this.fixedBuffer, 0)
    merged.set(samples, this.fixedBuffer.length)
    let offset = 0
    while (merged.length - offset >= this.targetChunkSamples) {
      out.push(this.fromFixed(merged.slice(offset, offset + this.targetChunkSamples), false))
      offset += this.targetChunkSamples
    }
    this.fixedBuffer = merged.slice(offset)
    return out
  }

  private fromSegment(seg: SpeechSegment, isFinal: boolean): AudioChunkPayload {
    return this.encode(seg.samples, isFinal, {
      mode: 'speech',
      reason: seg.reason,
      speechSec: seg.speechSec,
      peakFrameRms: seg.peakFrameRms,
      noiseFloor: seg.noiseFloor,
    })
  }

  private fromFixed(samples: Float32Array, isFinal: boolean): AudioChunkPayload {
    return this.encode(samples, isFinal, { mode: 'fixed', reason: isFinal ? 'stop' : 'fixed-length' })
  }

  private encode(samples: Float32Array, isFinal: boolean, meta: ChunkMeta): AudioChunkPayload {
    const encoded = encodeWav16kMono(samples, TARGET_RATE, this.silenceThreshold)
    return {
      wavBuffer: encoded.wavBuffer,
      durationSec: encoded.durationSec,
      sampleCount: encoded.sampleCount,
      rms: encoded.rms,
      isSilent: encoded.isSilent,
      chunkIndex: this.chunkIndex++,
      sessionId: this.sessionId,
      isFinal,
      meta,
    }
  }
}
