/**
 * Speech-aware segmenter (energy based, pure & deterministic).
 *
 * Replaces the previous "cut every 3.000 s" behaviour. Fixed cuts have two failure modes that
 * Whisper is known to be sensitive to:
 *   1. Words are cut in half at chunk edges ("Lang" | "Chain"), so the decoder sees a fragment and guesses.
 *   2. Chunks that contain only breath, room noise, a mouse/keyboard click (e.g. the click on "Stop")
 *      or a trailing pause are sent to the decoder anyway. With nothing to transcribe, Whisper tends
 *      to emit plausible-sounding filler ("Thank you very much.", "bye bye bye ...").
 *
 * This segmenter instead emits one segment per utterance:
 *   - a segment starts when frame energy rises above an adaptive speech threshold (with a short pre-roll)
 *   - a segment ends after `hangoverMs` of continuous non-speech (trailing silence is trimmed to `trailingPadMs`)
 *   - very long utterances are split at the quietest point near the end of the buffer, never at an arbitrary sample
 *   - segments with less than `minSpeechMs` of speech-level energy (clicks, bumps, breaths) are discarded
 *
 * It does NOT recognise speech - it only finds energy. It is a gate and a boundary finder, not a VAD model.
 * All thresholds are options so they can be tuned against a real microphone (see TROUBLESHOOTING.md).
 */

export type SegmentReason = 'pause' | 'max-length' | 'stop'

export interface SpeechSegment {
  samples: Float32Array
  /** Total segment duration in seconds (including pre-roll and trailing pad). */
  durationSec: number
  /** Duration of frames classified as speech, in seconds. */
  speechSec: number
  /** Highest 20 ms frame RMS inside the segment. */
  peakFrameRms: number
  /** Noise-floor estimate at the time the segment was closed. */
  noiseFloor: number
  reason: SegmentReason
}

export interface SpeechSegmenterOptions {
  sampleRate?: number
  /** Analysis frame length in ms (default 20). */
  frameMs?: number
  /** Absolute minimum frame RMS to count as speech (default 0.010, about -40 dBFS). */
  minSpeechRms?: number
  /** Frame RMS must also exceed noiseFloor * this ratio (default 3.0, about +9.5 dB). */
  speechToNoiseRatio?: number
  /** Minimum total speech-level audio for a segment to be kept (default 200 ms). */
  minSpeechMs?: number
  /** Continuous non-speech that ends an utterance (default 700 ms). */
  hangoverMs?: number
  /** Audio kept before the first speech frame so soft onsets are not clipped (default 300 ms). */
  prerollMs?: number
  /** Non-speech kept after the last speech frame (default 250 ms). */
  trailingPadMs?: number
  /** After this length, a short pause is enough to close the segment (default 8 s). */
  softMaxSec?: number
  /** Pause length that counts once softMaxSec is exceeded (default 250 ms). */
  softPauseMs?: number
  /** Absolute upper bound on segment length (default 12 s; whisper's window is 30 s). */
  hardMaxSec?: number
}

type Required_<T> = { [K in keyof T]-?: T[K] }

interface Frame {
  samples: Float32Array
  rms: number
  speech: boolean
}

export class SpeechSegmenter {
  private readonly o: Required_<SpeechSegmenterOptions>
  private readonly frameSize: number
  private pending = new Float32Array(0)

  private noiseFloor = 0.002
  private active = false
  private frames: Frame[] = []
  private preroll: Frame[] = []
  private silenceRun = 0

  constructor(options: SpeechSegmenterOptions = {}) {
    this.o = {
      sampleRate: options.sampleRate ?? 16000,
      frameMs: options.frameMs ?? 20,
      minSpeechRms: options.minSpeechRms ?? 0.01,
      speechToNoiseRatio: options.speechToNoiseRatio ?? 3.0,
      minSpeechMs: options.minSpeechMs ?? 200,
      hangoverMs: options.hangoverMs ?? 700,
      prerollMs: options.prerollMs ?? 300,
      trailingPadMs: options.trailingPadMs ?? 250,
      softMaxSec: options.softMaxSec ?? 8,
      softPauseMs: options.softPauseMs ?? 250,
      hardMaxSec: options.hardMaxSec ?? 12,
    }
    this.frameSize = Math.round((this.o.sampleRate * this.o.frameMs) / 1000)
  }

  public getNoiseFloor(): number {
    return this.noiseFloor
  }

  public isInSpeech(): boolean {
    return this.active
  }

  /** Feeds 16 kHz mono samples; returns any segments that were completed by this input. */
  public push(samples: Float32Array): SpeechSegment[] {
    const out: SpeechSegment[] = []
    if (samples.length === 0) return out

    let data: Float32Array
    if (this.pending.length > 0) {
      data = new Float32Array(this.pending.length + samples.length)
      data.set(this.pending, 0)
      data.set(samples, this.pending.length)
    } else {
      data = samples
    }

    let offset = 0
    while (offset + this.frameSize <= data.length) {
      const frameSamples = data.slice(offset, offset + this.frameSize)
      offset += this.frameSize
      const seg = this.processFrame(frameSamples)
      if (seg) out.push(seg)
    }
    this.pending = data.slice(offset)
    return out
  }

  /** Call at end of recording. Emits the in-progress utterance (if it contains enough speech). */
  public flush(): SpeechSegment | null {
    let seg: SpeechSegment | null = null
    if (this.active) {
      seg = this.closeSegment('stop')
    }
    this.pending = new Float32Array(0)
    this.preroll = []
    this.frames = []
    this.active = false
    this.silenceRun = 0
    return seg
  }

  public reset(): void {
    this.pending = new Float32Array(0)
    this.preroll = []
    this.frames = []
    this.active = false
    this.silenceRun = 0
    this.noiseFloor = 0.002
  }

  // ---------------------------------------------------------------------------------------------

  private processFrame(samples: Float32Array): SpeechSegment | null {
    let sum = 0
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
    const rms = Math.sqrt(sum / samples.length)

    const threshold = Math.max(this.o.minSpeechRms, this.noiseFloor * this.o.speechToNoiseRatio)
    const speech = rms > threshold
    const frame: Frame = { samples, rms, speech }

    if (!speech) this.updateNoiseFloor(rms)

    if (!this.active) {
      if (speech) {
        this.active = true
        this.frames = [...this.preroll, frame]
        this.preroll = []
        this.silenceRun = 0
      } else {
        this.preroll.push(frame)
        const maxPre = Math.ceil(this.o.prerollMs / this.o.frameMs)
        if (this.preroll.length > maxPre) this.preroll.shift()
      }
      return null
    }

    this.frames.push(frame)
    this.silenceRun = speech ? 0 : this.silenceRun + 1

    const silenceMs = this.silenceRun * this.o.frameMs
    const durationSec = (this.frames.length * this.o.frameMs) / 1000

    if (silenceMs >= this.o.hangoverMs) {
      return this.closeSegment('pause')
    }
    if (durationSec >= this.o.softMaxSec && silenceMs >= this.o.softPauseMs) {
      return this.closeSegment('pause')
    }
    if (durationSec >= this.o.hardMaxSec) {
      return this.splitAtQuietPoint()
    }
    return null
  }

  private updateNoiseFloor(rms: number): void {
    if (rms < this.noiseFloor) {
      this.noiseFloor = this.noiseFloor * 0.9 + rms * 0.1 // follow drops quickly
    } else {
      this.noiseFloor = this.noiseFloor * 0.995 + rms * 0.005 // rise slowly so speech tails don't raise it
    }
    if (this.noiseFloor < 1e-4) this.noiseFloor = 1e-4
  }

  /** Closes the active segment, trimming trailing silence down to the configured pad. */
  private closeSegment(reason: SegmentReason): SpeechSegment | null {
    const padFrames = Math.ceil(this.o.trailingPadMs / this.o.frameMs)
    let frames = this.frames
    // Count trailing non-speech frames and trim to padFrames.
    let trailing = 0
    for (let i = frames.length - 1; i >= 0 && !frames[i].speech; i--) trailing++
    if (trailing > padFrames) frames = frames.slice(0, frames.length - (trailing - padFrames))

    const seg = this.buildSegment(frames, reason)
    this.frames = []
    this.preroll = []
    this.active = false
    this.silenceRun = 0
    return seg
  }

  /**
   * Segment reached hardMaxSec without a long pause: split at the lowest-energy frame within the last
   * second so we cut in the quietest place available, and carry the remainder into a new segment.
   */
  private splitAtQuietPoint(): SpeechSegment | null {
    const searchFrames = Math.ceil(1000 / this.o.frameMs)
    const from = Math.max(1, this.frames.length - searchFrames)
    let minIdx = this.frames.length - 1
    let minRms = Infinity
    for (let i = from; i < this.frames.length; i++) {
      if (this.frames[i].rms <= minRms) {
        minRms = this.frames[i].rms
        minIdx = i
      }
    }
    const head = this.frames.slice(0, minIdx + 1)
    const tail = this.frames.slice(minIdx + 1)
    const seg = this.buildSegment(head, 'max-length')
    this.frames = tail
    this.silenceRun = 0
    for (let i = tail.length - 1; i >= 0 && !tail[i].speech; i--) this.silenceRun++
    return seg
  }

  private buildSegment(frames: Frame[], reason: SegmentReason): SpeechSegment | null {
    let speechFrames = 0
    let peak = 0
    for (const f of frames) {
      if (f.speech) speechFrames++
      if (f.rms > peak) peak = f.rms
    }
    const speechMs = speechFrames * this.o.frameMs
    if (speechMs < this.o.minSpeechMs) return null // click / bump / breath: not worth sending to Whisper

    const total = frames.length * this.frameSize
    const samples = new Float32Array(total)
    let o = 0
    for (const f of frames) {
      samples.set(f.samples, o)
      o += f.samples.length
    }
    return {
      samples,
      durationSec: total / this.o.sampleRate,
      speechSec: speechMs / 1000,
      peakFrameRms: peak,
      noiseFloor: this.noiseFloor,
      reason,
    }
  }
}
