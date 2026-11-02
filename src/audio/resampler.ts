/**
 * Audio Resampling & Channel Downmixing Utilities (Phase 4)
 *
 * Converts arbitrary input audio (e.g. 48,000 Hz or 44,100 Hz, mono or stereo)
 * into 16,000 Hz 1-channel mono PCM Float32Array suitable for Whisper.cpp.
 * Live capture must use the stateful StreamingResampler; resampleTo16k() is for whole buffers.
 */

export interface ResampleOptions {
  sourceSampleRate: number
  targetSampleRate?: number // defaults to 16000
}

/**
 * Downmixes multi-channel Float32Array channel arrays into a single mono Float32Array.
 */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (!channels || channels.length === 0) {
    return new Float32Array(0)
  }

  if (channels.length === 1) {
    return channels[0]
  }

  const length = channels[0].length
  const mono = new Float32Array(length)
  const numChannels = channels.length

  for (let i = 0; i < length; i++) {
    let sum = 0
    for (let c = 0; c < numChannels; c++) {
      sum += channels[c][i] || 0
    }
    mono[i] = sum / numChannels
  }

  return mono
}

/**
 * Stateful streaming resampler (windowed-sinc FIR, Blackman window).
 *
 * Why this exists: audio arrives from the AudioWorklet in tiny 128-sample blocks. A stateless
 * per-block resampler restarts its fractional phase and filter at every block edge, which (a) rounds
 * the output length of every block (a ~0.8-1.0 % time-scale error at 48/44.1 kHz) and (b) clips the
 * filter at every edge, injecting a discontinuity every 128 input samples. This class instead keeps
 * the input history and the exact fractional output position across calls, so feeding a signal in
 * any block size yields the same samples as feeding it all at once.
 *
 * Output sample n is centred on input position n * srcRate / dstRate. Positions are computed with
 * integer arithmetic (no accumulating floating-point drift, even over hours of audio).
 * The low-pass cutoff sits just under the target Nyquist when downsampling, so energy above the
 * target band is attenuated instead of folded back into it (aliasing).
 */
export class StreamingResampler {
  private readonly src: number
  private readonly dst: number
  /** Half-width of the kernel in input samples. */
  private readonly halfWidth: number
  /** Normalised cutoff in cycles per input sample. */
  private readonly cutoff: number
  private history = new Float32Array(0)
  /** Global input index of history[0]. */
  private historyStart = 0
  private totalIn = 0
  private nextOut = 0
  private readonly kernelCache = new Map<number, Float32Array>()

  constructor(sourceSampleRate: number, targetSampleRate = 16000, kernelLobes = 8) {
    if (!(sourceSampleRate > 0) || !(targetSampleRate > 0)) {
      throw new Error(`Invalid sample rates: source=${sourceSampleRate}, target=${targetSampleRate}`)
    }
    this.src = Math.round(sourceSampleRate)
    this.dst = Math.round(targetSampleRate)
    const ratio = this.src / this.dst
    this.halfWidth = Math.max(kernelLobes, Math.ceil(kernelLobes * ratio))
    // 0.5 = source Nyquist; scale down by 1/ratio when decimating, with a 2% guard band.
    this.cutoff = 0.5 * Math.min(1, 1 / ratio) * 0.98
  }

  /** Number of output samples produced so far. */
  public getOutputCount(): number {
    return this.nextOut
  }

  /** Restores the initial (empty) state so the instance can be reused for a new recording. */
  public reset(): void {
    this.history = new Float32Array(0)
    this.historyStart = 0
    this.totalIn = 0
    this.nextOut = 0
  }

  /**
   * Consumes a block of mono input samples and returns every output sample that can be fully
   * computed (the kernel needs `halfWidth` samples of look-ahead; those outputs appear on later calls).
   */
  public process(input: Float32Array): Float32Array {
    if (input.length === 0) return new Float32Array(0)
    this.append(input)
    return this.produce(false)
  }

  /** Emits the remaining outputs by treating the signal as zero beyond its end. Call once at end of stream. */
  public flush(): Float32Array {
    const out = this.produce(true)
    return out
  }

  private append(input: Float32Array): void {
    const merged = new Float32Array(this.history.length + input.length)
    merged.set(this.history, 0)
    merged.set(input, this.history.length)
    this.history = merged
    this.totalIn += input.length
  }

  private kernelFor(remainder: number): Float32Array {
    const cached = this.kernelCache.get(remainder)
    if (cached) return cached
    const frac = remainder / this.dst
    const L = this.halfWidth
    const taps = new Float32Array(2 * L)
    let sum = 0
    for (let k = -L + 1; k <= L; k++) {
      const d = k - frac // input-sample distance from the output centre
      const x = 2 * this.cutoff * d
      const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
      const u = d / L
      const window = Math.abs(u) >= 1 ? 0 : 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u)
      const w = 2 * this.cutoff * sinc * window
      taps[k + L - 1] = w
      sum += w
    }
    if (sum !== 0) for (let i = 0; i < taps.length; i++) taps[i] /= sum // unity DC gain
    this.kernelCache.set(remainder, taps)
    return taps
  }

  private produce(flushing: boolean): Float32Array {
    const L = this.halfWidth
    const out: number[] = []
    for (;;) {
      const num = this.nextOut * this.src
      const center = Math.floor(num / this.dst)
      const remainder = num - center * this.dst
      if (flushing) {
        // Stop once the output centre is at/after the end of the real signal.
        if (num >= this.totalIn * this.dst) break
      } else if (center + L > this.totalIn - 1) {
        break // not enough look-ahead yet
      }
      const taps = this.kernelFor(remainder)
      let acc = 0
      for (let k = -L + 1; k <= L; k++) {
        const idx = center + k
        if (idx < 0 || idx >= this.totalIn) continue // zero beyond the signal ends
        acc += this.history[idx - this.historyStart] * taps[k + L - 1]
      }
      out.push(acc)
      this.nextOut++
    }

    // Drop history that no later output can reference.
    const nextCenter = Math.floor((this.nextOut * this.src) / this.dst)
    const keepFrom = Math.max(this.historyStart, nextCenter - L + 1)
    if (keepFrom > this.historyStart) {
      this.history = this.history.slice(keepFrom - this.historyStart)
      this.historyStart = keepFrom
    }
    return Float32Array.from(out)
  }
}

/**
 * One-shot resample of a complete mono Float32Array from sourceSampleRate to targetSampleRate
 * (default 16000 Hz). Uses the same windowed-sinc algorithm as StreamingResampler, so
 * resampleTo16k(x) is identical to feeding x through a StreamingResampler in any block size.
 *
 * For live capture do NOT call this once per audio block - use a single StreamingResampler instance.
 */
export function resampleTo16k(
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate = 16000
): Float32Array {
  if (!input || input.length === 0) {
    return new Float32Array(0)
  }

  if (sourceSampleRate === targetSampleRate) {
    return new Float32Array(input)
  }

  if (sourceSampleRate <= 0 || targetSampleRate <= 0) {
    throw new Error(`Invalid sample rates: source=${sourceSampleRate}, target=${targetSampleRate}`)
  }

  const resampler = new StreamingResampler(sourceSampleRate, targetSampleRate)
  const head = resampler.process(input)
  const tail = resampler.flush()
  const out = new Float32Array(head.length + tail.length)
  out.set(head, 0)
  out.set(tail, head.length)
  return out
}

/**
 * Calculates the Root Mean Square (RMS) energy of a Float32Array audio buffer.
 */
export function calculateRms(samples: Float32Array): number {
  if (!samples || samples.length === 0) return 0

  let sumSquares = 0
  for (let i = 0; i < samples.length; i++) {
    sumSquares += samples[i] * samples[i]
  }

  return Math.sqrt(sumSquares / samples.length)
}

