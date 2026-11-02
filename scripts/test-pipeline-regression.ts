/**
 * Transcription-pipeline regression suite (deterministic, no microphone, no Whisper model required).
 *
 * Covers, with synthetic audio and a fake whisper-cli executable:
 *   1. StreamingResampler: block-size invariance, exact length, pitch, alias rejection, no timeline drift
 *   2. WAV encoding: header, round trip, clipping, silence flag, validator compatibility
 *   3. SpeechSegmenter: silence/noise/click rejection, boundaries, pauses, long-utterance splitting
 *   4. ChunkPipeline: end-to-end resample->segment->WAV, fixed mode, final chunk exactly once, no overlap duplication
 *   5. TranscriptionQueue: sequential order, duplicate prevention, stale session, bounded backpressure, error recovery
 *   6. Transcript accumulation: identity-based dedupe, ordering, genuine repetition preserved
 *   7. Output cleaning: internal markers, genuine speech preserved, decoder-loop guard thresholds
 *   8. WhisperService via fake whisper-cli: arguments, raw vs cleaned, silence, failure/timeout/bad JSON recovery, logging policy
 *   9. Controlled-audio end-to-end: synthetic stream -> pipeline -> queue -> fake whisper -> accumulated transcript
 *
 * NOT covered here (needs real hardware/binaries): real microphone capture, real Whisper accuracy.
 *
 * Run: npm run test:pipeline
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StreamingResampler, resampleTo16k } from '../src/audio/resampler'
import { encodeWav16kMono } from '../src/audio/wavEncoder'
import { SpeechSegmenter } from '../src/audio/speechSegmenter'
import { ChunkPipeline, AudioChunkPayload } from '../src/audio/chunkPipeline'
import { TranscriptionQueue } from '../src/audio/transcriptionQueue'
import { SegmentGate, appendSegmentText } from '../src/audio/transcriptAccumulator'
import { validateWavBuffer } from '../electron/wavValidator'
import { filterWhisperMarkers, trimRepetitionLoops, cleanWhisperOutput } from '../electron/vocabularyConfig'
import { buildWhisperCliArgs } from '../electron/whisperConfig'
import { WhisperService } from '../electron/whisperService'

let run = 0
let passed = 0
let failed = 0
function assert(cond: boolean | undefined, name: string, detail?: string): void {
  run++
  if (cond) {
    passed++
    console.log(`  ✅ PASS: ${name}`)
  } else {
    failed++
    console.error(`  ❌ FAIL: ${name}`)
    if (detail) console.error(`     Detail: ${detail}`)
  }
}

// ----------------------------------------------------------------------------------------------
// Deterministic synthetic audio
// ----------------------------------------------------------------------------------------------
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function tone(freq: number, rate: number, sec: number, amp = 0.5): Float32Array {
  const n = Math.round(rate * sec)
  const o = new Float32Array(n)
  for (let i = 0; i < n; i++) o[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate)
  return o
}
function noise(rate: number, sec: number, rms: number, seed = 1): Float32Array {
  const r = rng(seed)
  const n = Math.round(rate * sec)
  const o = new Float32Array(n)
  const amp = rms * Math.sqrt(3) // uniform[-a,a] has RMS a/sqrt(3)
  for (let i = 0; i < n; i++) o[i] = (r() * 2 - 1) * amp
  return o
}
/** Voiced-speech stand-in: 130 Hz fundamental with harmonics, 4 Hz syllable envelope, scaled to target RMS. */
function speechLike(rate: number, sec: number, rms = 0.05, syllables = true): Float32Array {
  const n = Math.round(rate * sec)
  const o = new Float32Array(n)
  let sum = 0
  for (let i = 0; i < n; i++) {
    const t = i / rate
    let v = 0
    for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * 130 * h * t) / h
    const env = syllables ? 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t) : 1
    o[i] = v * env
    sum += o[i] * o[i]
  }
  const scale = rms / Math.sqrt(sum / n)
  for (let i = 0; i < n; i++) o[i] *= scale
  return o
}
function click(rate: number, ms = 10, amp = 0.8): Float32Array {
  const n = Math.round((rate * ms) / 1000)
  const o = new Float32Array(n)
  for (let i = 0; i < n; i++) o[i] = amp * (1 - i / n) * (i % 2 === 0 ? 1 : -1)
  return o
}
function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
function rmsOf(x: Float32Array): number {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, x.length))
}
function goertzelAmp2(x: Float32Array, freq: number, rate: number): number {
  const w = (2 * Math.PI * freq) / rate, c = 2 * Math.cos(w)
  let s0 = 0, s1 = 0, s2 = 0
  for (let i = 0; i < x.length; i++) { s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0 }
  return (4 * (s1 * s1 + s2 * s2 - c * s1 * s2)) / (x.length * x.length)
}
function peakFreq(x: Float32Array, rate: number, center: number): number {
  const w = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) w[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1)))
  let best = center, bp = -1
  for (let f = center - 5; f <= center + 5; f += 0.02) { const p = goertzelAmp2(w, f, rate); if (p > bp) { bp = p; best = f } }
  return best
}
function feedBlocks(fn: (b: Float32Array) => void, input: Float32Array, block = 128): void {
  for (let i = 0; i < input.length; i += block) fn(input.subarray(i, i + block))
}
function decodeWav(buf: Uint8Array): Float32Array {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const n = (buf.byteLength - 44) / 2
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(44 + i * 2, true) / 32768
  return out
}

async function main(): Promise<void> {
  console.log('=====================================================')
  console.log('Transcription Pipeline Regression Suite')
  console.log('=====================================================')

  // --------------------------------------------------------------------------------------------
  console.log('\n[Group 1/9] StreamingResampler')
  {
    const sig = concat(tone(440, 48000, 1.0, 0.4), noise(48000, 1.0, 0.05, 7))
    const oneShot = resampleTo16k(sig, 48000)
    for (const block of [1, 128, 997, 4096]) {
      const rs = new StreamingResampler(48000)
      const parts: Float32Array[] = []
      feedBlocks((b) => parts.push(rs.process(b)), sig, block)
      parts.push(rs.flush())
      const got = concat(...parts)
      let maxDiff = 0
      for (let i = 0; i < Math.min(got.length, oneShot.length); i++) maxDiff = Math.max(maxDiff, Math.abs(got[i] - oneShot[i]))
      assert(got.length === oneShot.length && maxDiff < 1e-6, `Output is independent of block size (${block}-sample blocks)`, `len ${got.length} vs ${oneShot.length}, maxDiff ${maxDiff}`)
    }

    for (const rate of [48000, 44100, 32000, 22050, 8000]) {
      const rs = new StreamingResampler(rate)
      let total = 0
      feedBlocks((b) => { total += rs.process(b).length }, new Float32Array(rate * 10), 128)
      total += rs.flush().length
      assert(total === 160000, `10 s @ ${rate} Hz yields exactly 160000 samples (no timeline drift)`, `got ${total}`)
    }

    for (const rate of [48000, 44100]) {
      const rs = new StreamingResampler(rate)
      const parts: Float32Array[] = []
      feedBlocks((b) => parts.push(rs.process(b)), tone(1000, rate, 5), 128)
      parts.push(rs.flush())
      const body = concat(...parts).subarray(800, 80000 - 800)
      const f = peakFreq(body, 16000, 1000)
      assert(Math.abs(f - 1000) < 0.1, `1 kHz tone stays at 1 kHz after ${rate}->16k in 128-sample blocks`, `measured ${f.toFixed(3)} Hz`)
      const amp = Math.sqrt(goertzelAmp2(body, f, 16000))
      const sinePow = (amp * amp) / 2
      const sdr = 10 * Math.log10(sinePow / Math.max(rmsOf(body) ** 2 - sinePow, 1e-12))
      assert(sdr > 60, `Signal-to-distortion > 60 dB at ${rate} Hz (legacy resampler measured 12-26 dB)`, `SDR ${sdr.toFixed(1)} dB`)
    }

    {
      const rs = new StreamingResampler(48000)
      const parts: Float32Array[] = []
      feedBlocks((b) => parts.push(rs.process(b)), tone(10000, 48000, 3), 128)
      parts.push(rs.flush())
      const out = concat(...parts)
      const leakDb = 20 * Math.log10(rmsOf(out.subarray(800, out.length - 800)) / (0.5 / Math.SQRT2))
      assert(leakDb < -35, `10 kHz (above 8 kHz Nyquist) is attenuated >35 dB, not aliased (legacy: -12.5 dB)`, `${leakDb.toFixed(1)} dB`)
      const rs2 = new StreamingResampler(48000)
      const parts2: Float32Array[] = []
      feedBlocks((b) => parts2.push(rs2.process(b)), tone(3000, 48000, 2), 128)
      parts2.push(rs2.flush())
      const pass = concat(...parts2)
      const gainDb = 20 * Math.log10(rmsOf(pass.subarray(800, pass.length - 800)) / (0.5 / Math.SQRT2))
      assert(Math.abs(gainDb) < 0.5, 'Passband (3 kHz) gain within 0.5 dB', `${gainDb.toFixed(2)} dB`)
    }

    {
      const rs = new StreamingResampler(48000)
      const parts: Float32Array[] = []
      feedBlocks((b) => parts.push(rs.process(b)), tone(200, 48000, 2, 0.5), 128)
      parts.push(rs.flush())
      const out = concat(...parts)
      let maxStep = 0
      for (let i = 801; i < out.length - 800; i++) maxStep = Math.max(maxStep, Math.abs(out[i] - out[i - 1]))
      assert(maxStep < 0.05, 'No discontinuities at block boundaries (max step within theoretical 0.039)', `max step ${maxStep.toFixed(4)}`)
    }
    let threw = false
    try { new StreamingResampler(0) } catch { threw = true }
    assert(threw, 'Invalid sample rate is rejected')
    assert(resampleTo16k(new Float32Array(0), 48000).length === 0, 'Empty input resamples to empty output')
  }

  // --------------------------------------------------------------------------------------------
  console.log('\n[Group 2/9] WAV encoding & validation')
  {
    const samples = speechLike(16000, 1, 0.1)
    const enc = encodeWav16kMono(samples, 16000, 0.005)
    const dv = new DataView(enc.wavBuffer.buffer, enc.wavBuffer.byteOffset, enc.wavBuffer.byteLength)
    const ascii = (o: number, n: number) => String.fromCharCode(...Array.from(enc.wavBuffer.subarray(o, o + n)))
    assert(ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE' && ascii(12, 4) === 'fmt ' && ascii(36, 4) === 'data', 'RIFF/WAVE/fmt/data markers present')
    assert(dv.getUint32(4, true) === enc.wavBuffer.length - 8, 'RIFF size field = file size - 8')
    assert(dv.getUint16(20, true) === 1 && dv.getUint16(22, true) === 1 && dv.getUint32(24, true) === 16000 && dv.getUint16(34, true) === 16, 'PCM, mono, 16000 Hz, 16-bit')
    assert(dv.getUint32(28, true) === 32000 && dv.getUint16(32, true) === 2, 'Byte rate 32000 and block align 2')
    assert(dv.getUint32(40, true) === 32000 && enc.wavBuffer.length === 32044, 'data size = 32000 bytes (1 s)')
    const back = decodeWav(enc.wavBuffer)
    let maxErr = 0
    for (let i = 0; i < back.length; i++) maxErr = Math.max(maxErr, Math.abs(back[i] - samples[i]))
    assert(maxErr <= 1 / 32767 + 1e-9, 'PCM round trip error <= 1 LSB', `${maxErr}`)
    const clipped = encodeWav16kMono(new Float32Array([1.5, -1.5, 0]), 16000)
    const cv = new DataView(clipped.wavBuffer.buffer, clipped.wavBuffer.byteOffset)
    assert(cv.getInt16(44, true) === 32767 && cv.getInt16(46, true) === -32768, 'Out-of-range samples clip to int16 limits')
    assert(encodeWav16kMono(noise(16000, 1, 0.002), 16000, 0.005).isSilent, 'Room-noise-level audio (RMS 0.002) is flagged silent')
    assert(!enc.isSilent, 'Speech-level audio is not flagged silent')
    const v = validateWavBuffer(Buffer.from(enc.wavBuffer))
    assert(v.valid && v.sampleRate === 16000 && v.channels === 1 && v.bitsPerSample === 16 && Math.abs((v.durationSec ?? 0) - 1) < 1e-6, 'Main-process validator accepts encoder output', JSON.stringify(v))
    assert(!validateWavBuffer(Buffer.from(enc.wavBuffer.subarray(0, 30))).valid, 'Validator rejects truncated header')
  }

  // --------------------------------------------------------------------------------------------
  console.log('\n[Group 3/9] SpeechSegmenter')
  {
    const R = 16000
    const collect = (sig: Float32Array, opts = {}) => {
      const seg = new SpeechSegmenter(opts)
      const out = []
      feedBlocks((b) => out.push(...seg.push(b)), sig, 160)
      const f = seg.flush()
      if (f) out.push(f)
      return out
    }
    assert(collect(new Float32Array(R * 10)).length === 0, 'Digital silence (10 s) produces no segments')
    assert(collect(noise(R, 10, 0.003)).length === 0, 'Room noise (RMS 0.003, 10 s) produces no segments')
    assert(collect(noise(R, 10, 0.006)).length === 0, 'Elevated room noise (RMS 0.006, above the legacy 0.005 gate) produces no segments')
    assert(collect(concat(noise(R, 2, 0.003, 2), click(R), noise(R, 2, 0.003, 3))).length === 0, 'A single click/bump is rejected (not speech)')

    const one = collect(concat(noise(R, 1, 0.003, 4), speechLike(R, 1.5), noise(R, 2, 0.003, 5)))
    assert(one.length === 1, 'One utterance among silence -> exactly one segment', `got ${one.length}`)
    if (one[0]) {
      assert(one[0].durationSec >= 1.5 && one[0].durationSec <= 1.5 + 0.3 + 0.25 + 0.06, `Segment = speech + <=300 ms pre-roll + <=250 ms trailing pad (${one[0].durationSec.toFixed(2)} s), silence trimmed`)
      assert(one[0].reason === 'pause', 'Segment closed by pause (hangover)')
      assert(rmsOf(one[0].samples.subarray(0, 800)) < 0.02, 'Pre-roll before onset is quiet (onset not clipped)')
    }

    const two = collect(concat(speechLike(R, 1.5), noise(R, 1.2, 0.003, 6), speechLike(R, 1.0), noise(R, 0.4, 0.003, 8)))
    assert(two.length === 2, 'Two utterances separated by a 1.2 s pause -> two segments', `got ${two.length}`)
    if (two[1]) assert(two[1].reason === 'stop', 'Utterance still open at Stop is flushed with reason "stop"')

    const joined = collect(concat(speechLike(R, 1.0), noise(R, 0.4, 0.003, 9), speechLike(R, 1.0), noise(R, 1.0, 0.003, 10)))
    assert(joined.length === 1, 'A 0.4 s pause inside a sentence does not split it (hangover 0.7 s)', `got ${joined.length}`)

    const withStopClick = collect(concat(speechLike(R, 1.5), noise(R, 1.0, 0.003, 11), click(R), noise(R, 0.3, 0.003, 12)))
    assert(withStopClick.length === 1, 'A click after the utterance (e.g. pressing Stop) does not create a second segment', `got ${withStopClick.length}`)

    const long = collect(speechLike(R, 30, 0.05, true))
    assert(long.length >= 3 && long.every((s) => s.durationSec <= 12.05), `30 s of continuous speech is split into bounded segments (${long.length} segments, max ${Math.max(...long.map((s) => s.durationSec)).toFixed(2)} s)`)
    const total = long.reduce((a, s) => a + s.samples.length, 0)
    assert(Math.abs(total / R - 30) < 0.1, `No audio lost or duplicated across forced splits (${(total / R).toFixed(3)} s of 30 s)`)

    const dip = concat(speechLike(R, 11.45, 0.05, false), new Float32Array(Math.round(R * 0.1)), speechLike(R, 2.5, 0.05, false))
    const split = collect(dip)
    assert(split.length >= 2 && split[0].durationSec > 11.35 && split[0].durationSec < 11.65, `Forced split lands in the quiet gap (first segment ${split[0]?.durationSec.toFixed(2)} s, gap at 11.45-11.55 s)`)
  }

  // --------------------------------------------------------------------------------------------
  console.log('\n[Group 4/9] ChunkPipeline (end-to-end signal path)')
  {
    const SR = 48000
    const stream = concat(
      noise(SR, 0.5, 0.003, 21), speechLike(SR, 1.5), noise(SR, 1.2, 0.003, 22),
      speechLike(SR, 1.0), noise(SR, 0.4, 0.003, 23)
    )
    const p = new ChunkPipeline({ sourceSampleRate: SR, sessionId: 'S1', mode: 'speech' })
    const chunks: AudioChunkPayload[] = []
    feedBlocks((b) => chunks.push(...p.pushPcm(b)), stream, 128)
    chunks.push(...p.finish())
    assert(chunks.length === 2, 'Speech mode: two utterances -> two chunks', `got ${chunks.length}`)
    assert(chunks.map((c) => c.chunkIndex).join() === '0,1' && chunks.every((c) => c.sessionId === 'S1'), 'Chunk indexes are monotonic from 0 and carry the session id')
    assert(!chunks[0].isFinal && chunks[1].isFinal, 'Only the last chunk is final')
    assert(chunks.every((c) => validateWavBuffer(Buffer.from(c.wavBuffer)).valid), 'Every emitted chunk is a valid 16 kHz mono WAV')
    assert(chunks.every((c) => !c.isSilent), 'Speech segments are not flagged silent')
    const sent = chunks.reduce((a, c) => a + c.durationSec, 0)
    // 2.5 s speech + at most (0.3 s pre-roll + 0.25 s trailing pad) per segment + one frame of slack each
    assert(sent <= 2.5 + 2 * (0.3 + 0.25) + 0.1 && sent < 4.6, `Non-speech is trimmed to the designed pads (sent ${sent.toFixed(2)} s of 4.60 s recorded)`)
    assert(p.finish().length === 0, 'Calling finish() twice cannot submit the final chunk twice')
    assert(p.pushPcm(new Float32Array(128)).length === 0, 'No chunks accepted after finish()')

    const none = new ChunkPipeline({ sourceSampleRate: SR, sessionId: 'S2', mode: 'speech' })
    const nothing: AudioChunkPayload[] = []
    feedBlocks((b) => nothing.push(...none.pushPcm(b)), noise(SR, 8, 0.004, 31), 128)
    nothing.push(...none.finish())
    assert(nothing.length === 0, 'Pure room noise for 8 s sends nothing to Whisper (previously: 2 chunks of noise)')

    // Fixed (legacy) mode
    const fx = new ChunkPipeline({ sourceSampleRate: SR, sessionId: 'S3', mode: 'fixed' })
    const fixedSig = speechLike(SR, 7.2, 0.05)
    const fchunks: AudioChunkPayload[] = []
    feedBlocks((b) => fchunks.push(...fx.pushPcm(b)), fixedSig, 128)
    fchunks.push(...fx.finish())
    assert(fchunks.length === 3, 'Fixed mode: 7.2 s -> 2 full chunks + 1 final partial', `got ${fchunks.length}`)
    assert(fchunks[0].sampleCount === 48000 && fchunks[1].sampleCount === 48000 && fchunks[2].sampleCount === 19200 && fchunks[2].isFinal, 'Fixed chunks are exactly 48000 samples; final partial is 19200 and flagged final')
    const joinedFixed = concat(...fchunks.map((c) => decodeWav(c.wavBuffer)))
    const ref = resampleTo16k(fixedSig, SR)
    let md = 0
    for (let i = 0; i < Math.min(joinedFixed.length, ref.length); i++) md = Math.max(md, Math.abs(joinedFixed[i] - ref[i]))
    assert(joinedFixed.length === ref.length && md < 2 / 32768, 'Fixed chunks are contiguous with no overlap and no duplicated or missing samples', `len ${joinedFixed.length} vs ${ref.length}, maxDiff ${md}`)
    const tiny = new ChunkPipeline({ sourceSampleRate: SR, sessionId: 'S4', mode: 'fixed' })
    const tchunks: AudioChunkPayload[] = []
    feedBlocks((b) => tchunks.push(...tiny.pushPcm(b)), speechLike(SR, 0.3, 0.05), 128)
    tchunks.push(...tiny.finish())
    assert(tchunks.length === 0, 'Fixed mode: final partial shorter than 0.5 s is discarded')
  }

  // --------------------------------------------------------------------------------------------
  console.log('\n[Group 5/9] TranscriptionQueue')
  {
    const mk = (i: number, session = 'A', extra: Partial<AudioChunkPayload> = {}): AudioChunkPayload => ({
      wavBuffer: new Uint8Array(48), durationSec: 1, sampleCount: 16000, rms: 0.05, isSilent: false, chunkIndex: i, sessionId: session, isFinal: false, ...extra,
    })
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    {
      const order: number[] = []; const out: number[] = []; let active = 0; let maxActive = 0
      const q = new TranscriptionQueue({
        maxQueueDepth: 5,
        transcribeChunk: async (c) => { active++; maxActive = Math.max(maxActive, active); await sleep(15 - c.chunkIndex * 2); order.push(c.chunkIndex); active--; return { text: `t${c.chunkIndex}`, durationMs: 1, sessionId: c.sessionId, chunkIndex: c.chunkIndex } },
        onSegment: (s) => out.push(s.chunkIndex),
      })
      q.setActiveSession('A')
      for (let i = 0; i < 5; i++) q.enqueue(mk(i))
      await q.drain(3000)
      assert(maxActive === 1, 'Never more than one transcription at a time')
      assert(out.join() === '0,1,2,3,4' && order.join() === '0,1,2,3,4', 'Results are emitted in chunk order even when later chunks are faster')
    }
    {
      let calls = 0; const out: number[] = []
      const q = new TranscriptionQueue({ transcribeChunk: async (c) => { calls++; await sleep(10); return { text: 'x', durationMs: 1, sessionId: c.sessionId, chunkIndex: c.chunkIndex } }, onSegment: (s) => out.push(s.chunkIndex) })
      q.setActiveSession('A')
      q.enqueue(mk(0)); q.enqueue(mk(0)); q.enqueue(mk(1)); q.enqueue(mk(1)); q.enqueue(mk(0))
      await q.drain(2000)
      assert(calls === 2 && out.join() === '0,1', 'Duplicate (session, chunk) submissions are transcribed once', `calls=${calls} out=${out}`)
    }
    {
      const out: string[] = []
      const q = new TranscriptionQueue({ transcribeChunk: async (c) => { await sleep(40); return { text: `from-${c.sessionId}`, durationMs: 1, sessionId: c.sessionId, chunkIndex: c.chunkIndex } }, onSegment: (s) => out.push(s.text) })
      q.setActiveSession('A')
      q.enqueue(mk(0, 'A')); q.enqueue(mk(1, 'A'))
      await sleep(5)
      q.setActiveSession('B')
      q.enqueue(mk(0, 'B'))
      q.enqueue(mk(2, 'A')) // late chunk from the dead session
      await q.drain(2000)
      assert(out.join() === 'from-B', 'Stale results and chunks from a previous session are discarded', out.join())
    }
    {
      let maxPending = 0; let dropped = 0
      const done: number[] = []
      const q = new TranscriptionQueue({
        maxQueueDepth: 3,
        transcribeChunk: async (c) => { await sleep(20); return { text: 'x', durationMs: 1, sessionId: c.sessionId, chunkIndex: c.chunkIndex } },
        onSegment: (s) => done.push(s.chunkIndex),
        onStatusChange: (s) => { maxPending = Math.max(maxPending, s.pendingCount) },
      })
      q.setActiveSession('A')
      for (let i = 0; i < 12; i++) q.enqueue(mk(i))
      q.enqueue(mk(12, 'A', { isFinal: true }))
      await q.drain(5000)
      dropped = q.getDroppedCount()
      assert(maxPending <= 3, `Queue stays bounded (max pending ${maxPending} <= 3)`)
      assert(dropped > 0, `Backpressure drops are counted (${dropped})`)
      assert(done[done.length - 1] === 12, 'The final chunk is never dropped by backpressure')
      assert(done.every((v, i) => i === 0 || v > done[i - 1]), 'Surviving chunks stay in chronological order', done.join())
    }
    {
      const out: number[] = []; const errs: string[] = []
      const q = new TranscriptionQueue({
        transcribeChunk: async (c) => { if (c.chunkIndex === 1) throw new Error('whisper exploded'); return { text: 'ok', durationMs: 1, sessionId: c.sessionId, chunkIndex: c.chunkIndex } },
        onSegment: (s) => out.push(s.chunkIndex), onError: (e) => errs.push(e.message),
      })
      q.setActiveSession('A')
      q.enqueue(mk(0)); q.enqueue(mk(1)); q.enqueue(mk(2))
      await q.drain(2000)
      assert(errs.length === 1 && out.join() === '0,2', 'A failed chunk is reported once and the queue continues with the next chunk', `errs=${errs} out=${out}`)
    }
    {
      let calls = 0
      const q = new TranscriptionQueue({ transcribeChunk: async (c) => { calls++; return { text: 'x', durationMs: 1, sessionId: c.sessionId, chunkIndex: c.chunkIndex } }, onSegment: () => {} })
      q.setActiveSession('A')
      q.enqueue(mk(0, 'A', { isSilent: true }))
      await q.drain(500)
      assert(calls === 0, 'Silent non-final chunks never reach Whisper')
    }
  }

  // --------------------------------------------------------------------------------------------
  console.log('\n[Group 6/9] Transcript accumulation')
  {
    const g = new SegmentGate()
    g.startSession('S1')
    assert(g.accept({ sessionId: 'S1', chunkIndex: 0 }) && g.accept({ sessionId: 'S1', chunkIndex: 1 }), 'Segments arriving in order are accepted')
    assert(!g.accept({ sessionId: 'S1', chunkIndex: 1 }), 'A repeated chunk is rejected')
    assert(!g.accept({ sessionId: 'S1', chunkIndex: 0 }), 'A late/out-of-order chunk is rejected')
    assert(!g.accept({ sessionId: 'OLD', chunkIndex: 9 }), 'A segment from another session is rejected')
    g.startSession('S2')
    assert(g.accept({ sessionId: 'S2', chunkIndex: 0 }), 'A new session restarts ordering at chunk 0')
    let t = ''
    for (const s of ['yes', 'yes', 'I agree.', 'I agree.']) t = appendSegmentText(t, s)
    assert(t === 'yes yes I agree. I agree.', 'Genuinely repeated speech is preserved (the old endsWith() check would have dropped it)', t)
    assert(appendSegmentText('a', '   ') === 'a' && appendSegmentText('', ' b ') === 'b', 'Whitespace-only segments are ignored; separators are single spaces')
  }

  // --------------------------------------------------------------------------------------------
  console.log('\n[Group 7/9] Output cleaning (markers, genuine speech, loop guard)')
  {
    const markers: Array<[string, string]> = [
      ['[BLANK_AUDIO]', ''], ['  [BLANK_AUDIO]  [BLANK_AUDIO] ', ''], ['[ Silence ]', ''], ['', ''], ['   ', ''], ['(whirring)', ''],
      ['I would like to know about LangChain. [BLANK_AUDIO]', 'I would like to know about LangChain.'],
      ['[MUSIC] Hello world (applause)', 'Hello world'], ['[inaudible] okay then', 'okay then'],
    ]
    for (const [i, o] of markers) assert(filterWhisperMarkers(i) === o, `Marker cleaning: ${JSON.stringify(i)} -> ${JSON.stringify(o)}`, filterWhisperMarkers(i))
    const speech = [
      'Is the customer happy?', 'The channel is called LangChain Academy and you can subscribe.', 'Thank you very much.',
      'I live in Paris (France) and I like it.', 'Can you explain what LangChain is?', 'What is a link chain used for?',
    ]
    for (const s of speech) assert(filterWhisperMarkers(s) === s && cleanWhisperOutput(s).text === s, `Genuine speech untouched: "${s}"`)
    for (const [s, label] of [['no no no no no', 'five repeats'], ['very very very very very very very', 'seven repeats'], ['one two three four five six seven eight nine ten', 'counting'], ['all right, all right, all right, all right', 'four phrase repeats']] as const) {
      assert(trimRepetitionLoops(s).text === s && !trimRepetitionLoops(s).trimmed, `Loop guard leaves ordinary emphasis alone (${label})`)
    }
    const loop = "I would love to know about Waterland. Thank you very much. We'll see you in a minute, bye bye bye bye bye bye bye bye bye bye bye bye bye bye it's hot!"
    const r = trimRepetitionLoops(loop)
    assert(r.trimmed && r.removedWords === 13 && r.text === "I would love to know about Waterland. Thank you very much. We'll see you in a minute, bye it's hot!", 'Observed Test-3 loop ("bye" x14) is trimmed to one occurrence; surrounding words are kept', r.text)
    assert(trimRepetitionLoops('all right all right all right all right all right all right').text === 'all right', 'A looping 2-word phrase (x6) is trimmed to one occurrence')
    const cleaned = cleanWhisperOutput(`[BLANK_AUDIO] ${loop}`)
    assert(cleaned.raw === `[BLANK_AUDIO] ${loop}` && cleaned.loopTrimmed && cleaned.markersRemoved && !cleaned.text.includes('[BLANK_AUDIO]'), 'Raw output is retained separately from the cleaned user-facing text')
  }

  // --------------------------------------------------------------------------------------------
  console.log('\n[Group 8/9] WhisperService with a fake whisper-cli')
  const isWindows = process.platform === 'win32'
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-whisper-'))
  const fakeBin = path.join(tmp, 'whisper-cli')
  const fakeModel = path.join(tmp, 'ggml-fake.bin')
  const argsFile = path.join(tmp, 'args.json')
  fs.writeFileSync(fakeModel, '')
  fs.truncateSync(fakeModel, 12 * 1024 * 1024)

  const speechWav = Buffer.from(encodeWav16kMono(speechLike(16000, 1.2, 0.08), 16000).wavBuffer)
  const silentWav = Buffer.from(encodeWav16kMono(new Float32Array(16000), 16000).wavBuffer)

  {
    // Input validation precedes environment validation: silence / bad audio need no binary at all.
    const noBin = new WhisperService({ binPath: path.join(tmp, 'missing.exe'), modelPath: path.join(tmp, 'missing.bin'), initialPrompt: '' })
    const sr = await noBin.transcribe(silentWav)
    assert(sr.isSilent && sr.text === '', 'Silent audio is short-circuited without needing the Whisper binary')
    let badErr = ''
    try { await noBin.transcribe(Buffer.from('not a wav file at all, definitely not a wav file at all!!')) } catch (e) { badErr = String(e) }
    assert(badErr.includes('Audio validation failed'), 'Invalid audio is rejected before any process is launched', badErr)
  }

  if (isWindows) {
    console.log('  ⚠️ Skipping fake-whisper-cli tests on Windows (needs a POSIX executable). They ran on Linux/macOS CI.')
  } else {
    fs.writeFileSync(
      fakeBin,
      `#!${process.execPath}
const fs = require('fs')
const a = process.argv.slice(2)
if (process.env.FAKE_WHISPER_ARGS_FILE) fs.writeFileSync(process.env.FAKE_WHISPER_ARGS_FILE, JSON.stringify(a))
const prefix = a[a.indexOf('-of') + 1]
const mode = process.env.FAKE_WHISPER_MODE || 'ok'
const out = (t) => fs.writeFileSync(prefix + '.json', JSON.stringify({ transcription: t.map((x) => ({ text: x })) }))
if (mode === 'ok') out([' I would like to know about LangChain.'])
else if (mode === 'two') out([' Can you explain', ' what LangChain is?'])
else if (mode === 'blank') out([' [BLANK_AUDIO]'])
else if (mode === 'loop') out([" I would love to know about Waterland. Thank you very much. We'll see you in a minute, bye bye bye bye bye bye bye bye bye bye bye bye bye bye it's hot!"])
else if (mode === 'fail') { process.stderr.write('model load failed'); process.exit(3) }
else if (mode === 'hang') { setTimeout(() => {}, 60000) }
else if (mode === 'badjson') fs.writeFileSync(prefix + '.json', '{ not json')
else if (mode === 'nojson') { /* exit 0 without output */ }
`
    )
    fs.chmodSync(fakeBin, 0o755)
    const svc = (extra: Record<string, unknown> = {}) => new WhisperService({ binPath: fakeBin, modelPath: fakeModel, engine: 'cli', threads: 4, initialPrompt: '', ...extra })
    process.env.FAKE_WHISPER_ARGS_FILE = argsFile

    process.env.FAKE_WHISPER_MODE = 'ok'
    const s1 = svc()
    const r1 = await s1.transcribe(speechWav)
    assert(r1.text === 'I would like to know about LangChain.' && r1.rawText === 'I would like to know about LangChain.' && !r1.isSilent && r1.engine === 'cli', 'CLI path returns parsed text', JSON.stringify(r1))
    const args1: string[] = JSON.parse(fs.readFileSync(argsFile, 'utf8'))
    const forbidden = ['-sns', '--suppress-nst', '-nf', '--no-fallback', '-nth', '--no-speech-thold', '--prompt', '-mc', '--max-context']
    assert(forbidden.every((f) => !args1.includes(f)), 'Default CLI arguments carry no decoder-altering flags and no prompt', args1.join(' '))
    assert(args1[0] === '-m' && args1[2] === '-f' && args1.includes('-oj') && args1.includes('-np') && args1[args1.indexOf('-t') + 1] === '4', 'Baseline arguments: -m -f -oj -of -t 4 -np', args1.join(' '))
    assert(JSON.stringify(args1) === JSON.stringify(buildWhisperCliArgs({ modelPath: fakeModel, threads: 4, initialPrompt: '' }, args1[3], args1[args1.indexOf('-of') + 1])), 'Executed arguments equal buildWhisperCliArgs() output')

    await svc({ initialPrompt: 'LangChain.' }).transcribe(speechWav)
    const args2: string[] = JSON.parse(fs.readFileSync(argsFile, 'utf8'))
    assert(args2[args2.indexOf('--prompt') + 1] === 'LangChain.' && args2.filter((a) => a === '--prompt').length === 1, '--prompt is passed exactly once, and only when configured')
    assert(!JSON.stringify(s1.describeEffectiveConfig()).includes('LangChain'), 'Effective-config diagnostics never include transcript text')

    process.env.FAKE_WHISPER_MODE = 'two'
    const r2 = await s1.transcribe(speechWav)
    assert(r2.text === 'Can you explain what LangChain is?', 'Multiple Whisper segments are joined in order', r2.text)

    process.env.FAKE_WHISPER_MODE = 'blank'
    const r3 = await s1.transcribe(speechWav)
    assert(r3.text === '' && r3.isSilent && r3.rawText === '[BLANK_AUDIO]', '[BLANK_AUDIO] never reaches the user-facing text, but is kept in rawText for diagnosis')

    process.env.FAKE_WHISPER_MODE = 'loop'
    const r4 = await s1.transcribe(speechWav)
    assert(r4.loopTrimmed === true && (r4.rawText ?? '').includes('bye bye bye bye bye bye bye bye bye bye bye bye bye bye') && !r4.text.includes('bye bye'), 'Decoder loop trimmed in text; full loop retained in rawText')

    process.env.FAKE_WHISPER_MODE = 'fail'
    let failMsg = ''
    try { await s1.transcribe(speechWav) } catch (e) { failMsg = String(e) }
    assert(failMsg.includes('exited with error code 3') && failMsg.includes('model load failed'), 'Non-zero exit rejects with the exit code and stderr', failMsg)
    process.env.FAKE_WHISPER_MODE = 'ok'
    assert((await s1.transcribe(speechWav)).text.length > 0, 'Service recovers and transcribes normally after a failure')

    process.env.FAKE_WHISPER_MODE = 'badjson'
    let badJson = ''
    try { await s1.transcribe(speechWav) } catch (e) { badJson = String(e) }
    assert(badJson.includes('Failed to parse Whisper JSON'), 'Malformed JSON output is reported, not swallowed', badJson)
    process.env.FAKE_WHISPER_MODE = 'nojson'
    let noJson = ''
    try { await s1.transcribe(speechWav) } catch (e) { noJson = String(e) }
    assert(noJson.includes('expected JSON output file was not created'), 'Missing output file is reported', noJson)

    process.env.FAKE_WHISPER_MODE = 'hang'
    const t0 = Date.now()
    let hangMsg = ''
    try { await s1.transcribe(speechWav, { timeoutMs: 600 }) } catch (e) { hangMsg = String(e) }
    assert(hangMsg.includes('timed out') && Date.now() - t0 < 3000, `A hung Whisper process is killed by the timeout (${Date.now() - t0} ms)`, hangMsg)
    process.env.FAKE_WHISPER_MODE = 'ok'
    assert((await s1.transcribe(speechWav)).text.length > 0, 'Service recovers after a timeout')

    // Logging policy: no conversation content in logs unless explicitly opted in
    const logs: string[] = []
    const origLog = console.log
    console.log = (...a: unknown[]) => { logs.push(a.join(' ')) }
    try {
      delete process.env.DEBUG_AUDIO; delete process.env.DEBUG_WHISPER_TEXT
      await s1.transcribe(speechWav)
      const defaultLogs = logs.splice(0)
      process.env.DEBUG_AUDIO = '1'
      await s1.transcribe(speechWav)
      const metaLogs = logs.splice(0)
      process.env.DEBUG_WHISPER_TEXT = '1'
      await s1.transcribe(speechWav)
      const textLogs = logs.splice(0)
      console.log = origLog
      assert(defaultLogs.length === 0, 'Default: nothing is logged during transcription', defaultLogs.join('|'))
      assert(metaLogs.length === 1 && !metaLogs[0].includes('LangChain') && /rawChars=\d+/.test(metaLogs[0]), 'DEBUG_AUDIO=1: numeric metadata only, no transcript text', metaLogs.join('|'))
      assert(textLogs.length === 1 && textLogs[0].includes('raw="') && textLogs[0].includes('cleaned="'), 'DEBUG_AUDIO=1 + DEBUG_WHISPER_TEXT=1: raw and cleaned text logged separately')
    } finally {
      console.log = origLog
      delete process.env.DEBUG_AUDIO; delete process.env.DEBUG_WHISPER_TEXT
    }

    // ------------------------------------------------------------------------------------------
    console.log('\n[Group 9/9] Controlled-audio end-to-end (synthetic stream -> pipeline -> queue -> fake Whisper)')
    {
      process.env.FAKE_WHISPER_MODE = 'ok'
      const SR = 48000
      const stream = concat(
        noise(SR, 0.6, 0.004, 41), speechLike(SR, 2.0), noise(SR, 1.5, 0.004, 42),
        speechLike(SR, 1.4), noise(SR, 1.5, 0.004, 43), click(SR), noise(SR, 0.5, 0.004, 44)
      )
      const pipeline = new ChunkPipeline({ sourceSampleRate: SR, sessionId: 'E2E', mode: 'speech' })
      let transcript = ''
      const gate = new SegmentGate(); gate.startSession('E2E')
      const q = new TranscriptionQueue({
        transcribeChunk: async (c) => {
          const r = await s1.transcribe(Buffer.from(c.audioBuffer))
          return { ...r, sessionId: c.sessionId, chunkIndex: c.chunkIndex }
        },
        onSegment: (s) => { if (gate.accept(s)) transcript = appendSegmentText(transcript, s.text) },
      })
      q.setActiveSession('E2E')
      let submitted = 0
      feedBlocks((b) => { for (const c of pipeline.pushPcm(b)) { submitted++; q.enqueue(c) } }, stream, 128)
      for (const c of pipeline.finish()) { submitted++; q.enqueue(c) }
      await q.drain(8000)
      assert(submitted === 2, `Two utterances -> two Whisper calls (noise and the trailing click are not sent): ${submitted}`)
      assert(transcript === 'I would like to know about LangChain. I would like to know about LangChain.', 'Transcript has exactly one entry per utterance, in order, no duplicates', transcript)

      // Non-speech only: Whisper must not be invoked at all
      const calls: number[] = []
      const p2 = new ChunkPipeline({ sourceSampleRate: SR, sessionId: 'E2E2', mode: 'speech' })
      feedBlocks((b) => { for (const c of p2.pushPcm(b)) calls.push(c.chunkIndex) }, concat(noise(SR, 5, 0.005, 51), click(SR), noise(SR, 3, 0.005, 52)), 128)
      for (const c of p2.finish()) calls.push(c.chunkIndex)
      assert(calls.length === 0, 'Silence + noise + a click: zero Whisper calls (no opportunity to hallucinate)')
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true })
  delete process.env.FAKE_WHISPER_MODE
  delete process.env.FAKE_WHISPER_ARGS_FILE

  console.log('\n=====================================================')
  console.log(`Results: ${passed} / ${run} passed (${failed} failed)`)
  console.log('=====================================================')
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('Unhandled test error:', err)
  process.exit(1)
})
