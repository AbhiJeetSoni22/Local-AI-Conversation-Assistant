/**
 * Controlled-audio experiment: measures the fidelity of the capture-path resampler.
 *
 * It feeds synthetic tones to the resampler in 128-sample blocks (the AudioWorklet render
 * quantum, i.e. exactly how audioRecorder.ts delivers audio) and reports:
 *   - output sample count vs. the mathematically expected count (timeline drift)
 *   - measured frequency of a 1 kHz tone (pitch/time-scale error)
 *   - signal-to-distortion ratio of the tone (block-boundary artifacts, aliasing)
 *   - how much a 10 kHz tone (above the 8 kHz target Nyquist) leaks into the output (alias rejection)
 *
 * "legacy" is a verbatim copy of the pre-fix resampleTo16k() applied per block (the old call pattern).
 * "current" is the streaming resampler used by the app now.
 *
 * Run: npx tsx scripts/analyze-resampler.ts
 */
import { StreamingResampler } from '../src/audio/resampler'

function legacyResampleBlock(input: Float32Array, src: number, dst = 16000): Float32Array {
  if (input.length === 0) return new Float32Array(0)
  if (src === dst) return new Float32Array(input)
  const ratio = src / dst
  const outputLength = Math.max(1, Math.round(input.length / ratio))
  const output = new Float32Array(outputLength)
  const filterWidth = Math.max(1, Math.floor(ratio))
  for (let i = 0; i < outputLength; i++) {
    const center = i * ratio
    if (ratio > 1.5) {
      const start = Math.max(0, Math.floor(center - filterWidth / 2))
      const end = Math.min(input.length - 1, Math.floor(center + filterWidth / 2))
      let sum = 0, count = 0
      for (let j = start; j <= end; j++) { sum += input[j]; count++ }
      output[i] = count > 0 ? sum / count : input[Math.min(Math.floor(center), input.length - 1)]
    } else {
      const f = Math.floor(center)
      const c = Math.min(f + 1, input.length - 1)
      const fr = center - f
      output[i] = input[f] * (1 - fr) + input[c] * fr
    }
  }
  return output
}

function tone(freq: number, rate: number, seconds: number, amp = 0.5): Float32Array {
  const n = Math.round(rate * seconds)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate)
  return out
}

function concat(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((a, p) => a + p.length, 0)
  const out = new Float32Array(total)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

/** Goertzel magnitude^2 for a single frequency (normalized by N^2/4 so a unit sine -> ~amp^2/ ... ). */
function goertzelPower(x: Float32Array, freq: number, rate: number): number {
  const w = (2 * Math.PI * freq) / rate
  const coeff = 2 * Math.cos(w)
  let s0 = 0, s1 = 0, s2 = 0
  for (let i = 0; i < x.length; i++) { s0 = x[i] + coeff * s1 - s2; s2 = s1; s1 = s0 }
  const p = s1 * s1 + s2 * s2 - coeff * s1 * s2
  return (4 * p) / (x.length * x.length) // = amplitude^2 of that sinusoid component
}

/** Find the peak frequency near `center` with 0.05 Hz resolution via Goertzel scan on a Hann-windowed signal. */
function measureFrequency(x: Float32Array, rate: number, center: number): number {
  const w = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) w[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1)))
  let best = center, bestP = -1
  for (let f = center - 40; f <= center + 40; f += 0.05) {
    const p = goertzelPower(w, f, rate)
    if (p > bestP) { bestP = p; best = f }
  }
  return best
}

function rmsOf(x: Float32Array): number {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i] * x[i]
  return Math.sqrt(s / x.length)
}

function runStream(kind: 'legacy' | 'current', input: Float32Array, srcRate: number): Float32Array {
  const parts: Float32Array[] = []
  const BLOCK = 128
  if (kind === 'legacy') {
    for (let i = 0; i < input.length; i += BLOCK) parts.push(legacyResampleBlock(input.subarray(i, i + BLOCK), srcRate))
  } else {
    const rs = new StreamingResampler(srcRate, 16000)
    for (let i = 0; i < input.length; i += BLOCK) parts.push(rs.process(input.subarray(i, i + BLOCK)))
    parts.push(rs.flush())
  }
  return concat(parts)
}

const SECONDS = 10
console.log('=== Resampler controlled-audio analysis (128-sample blocks, 10 s synthetic tones) ===\n')
console.log('rate     impl      samples(expected)   1kHz-measured   SDR(dB)   10kHz-leak(dB)')

for (const srcRate of [48000, 44100]) {
  const expected = 16000 * SECONDS
  for (const kind of ['legacy', 'current'] as const) {
    const t1k = runStream(kind, tone(1000, srcRate, SECONDS), srcRate)
    // skip 50 ms at each edge for filter start-up/tail when measuring spectral quality
    const trim = 800
    const body = t1k.subarray(trim, t1k.length - trim)
    const measured = measureFrequency(body, 16000, 1000)
    // Signal-to-distortion: power of the strongest sinusoid component vs everything else
    const fundAmp2 = goertzelPower(body, measured, 16000)
    const totalPow = rmsOf(body) ** 2
    const sinePow = fundAmp2 / 2
    const sdr = 10 * Math.log10(sinePow / Math.max(totalPow - sinePow, 1e-12))

    const t10k = runStream(kind, tone(10000, srcRate, SECONDS), srcRate)
    const leakRms = rmsOf(t10k.subarray(trim, t10k.length - trim))
    const leakDb = 20 * Math.log10(leakRms / (0.5 / Math.SQRT2))

    console.log(
      `${String(srcRate).padEnd(8)} ${kind.padEnd(9)} ${String(t1k.length).padStart(7)} (${expected})   ` +
      `${measured.toFixed(2).padStart(9)} Hz   ${sdr.toFixed(1).padStart(6)}    ${leakDb.toFixed(1).padStart(7)}`
    )
  }
}
console.log('\nInterpretation: a correct 10 s resample yields exactly 160000 samples, a 1000.00 Hz tone, high SDR,')
console.log('and a strongly negative 10 kHz leak (content above the 8 kHz target Nyquist must be removed, not aliased).')
