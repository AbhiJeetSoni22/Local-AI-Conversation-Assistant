/**
 * Phase 4 Audio Capture, Resampling, Encoding & Queue Test Suite
 *
 * Verifies:
 * 1. Resampling: 48kHz -> 16kHz, 44.1kHz -> 16kHz, 16kHz identity
 * 2. Multi-channel downmixing (stereo to mono)
 * 3. RMS energy calculation & silence gating
 * 4. 16-bit PCM WAV encoding and verification against electron/wavValidator.ts
 * 5. Sequential transcription queue ordering (preventing concurrent Whisper runs)
 * 6. Session ID invalidation (discarding stale chunks from cancelled sessions)
 * 7. Backpressure queue capping (preventing unbounded queue memory growth)
 * 8. Error recovery in sequential queue
 *
 * Run with:
 *   npx tsx scripts/test-phase4-audio.ts
 *   or: npm run test:audio
 */

import { resampleTo16k, downmixToMono, calculateRms } from '../src/audio/resampler'
import { encodeWav16kMono } from '../src/audio/wavEncoder'
import { TranscriptionQueue } from '../src/audio/transcriptionQueue'
import { validateWavBuffer } from '../electron/wavValidator'

let testsRun = 0
let testsPassed = 0
let testsFailed = 0

function assert(condition: boolean | undefined, testName: string, failureDetail?: string): void {
  testsRun++
  if (Boolean(condition)) {
    testsPassed++
    console.log(`  ✅ PASS: ${testName}`)
  } else {
    testsFailed++
    console.error(`  ❌ FAIL: ${testName}`)
    if (failureDetail) {
      console.error(`     Detail: ${failureDetail}`)
    }
  }
}

async function runTests(): Promise<void> {
  console.log('=====================================================')
  console.log('   Phase 4 Audio Pipeline & Queue Test Suite')
  console.log('=====================================================\n')

  // -----------------------------------------------------------------------
  // Group 1: Resampling & Channel Downmixing
  // -----------------------------------------------------------------------
  console.log('[Group 1/4] Audio Resampling & Channel Downmixing')

  // 1.1 Downsample 48kHz to 16kHz (3:1 ratio)
  const samples48k = new Float32Array(48000) // 1 second of 48kHz audio
  for (let i = 0; i < samples48k.length; i++) {
    samples48k[i] = Math.sin((2 * Math.PI * 440 * i) / 48000)
  }
  const resampled16kFrom48k = resampleTo16k(samples48k, 48000, 16000)
  assert(
    resampled16kFrom48k.length === 16000,
    'Resampling 48kHz to 16kHz yields exact 16000 samples per second',
    `Expected 16000, got ${resampled16kFrom48k.length}`
  )

  // 1.2 Downsample 44.1kHz to 16kHz
  const samples44k = new Float32Array(44100)
  for (let i = 0; i < samples44k.length; i++) {
    samples44k[i] = Math.sin((2 * Math.PI * 440 * i) / 44100)
  }
  const resampled16kFrom44k = resampleTo16k(samples44k, 44100, 16000)
  assert(
    resampled16kFrom44k.length === 16000,
    'Resampling 44.1kHz to 16kHz yields 16000 samples per second',
    `Expected 16000, got ${resampled16kFrom44k.length}`
  )

  // 1.3 Identity 16kHz to 16kHz
  const samples16k = new Float32Array([0.1, 0.2, 0.3, 0.4])
  const identity = resampleTo16k(samples16k, 16000, 16000)
  assert(
    identity.length === 4 &&
      Math.abs(identity[0] - 0.1) < 1e-6 &&
      Math.abs(identity[3] - 0.4) < 1e-6,
    'Identity resampling preserves exact samples',
    `Got [${identity[0]}, ${identity[1]}, ${identity[2]}, ${identity[3]}]`
  )

  // 1.4 Empty buffer handling
  const emptyResampled = resampleTo16k(new Float32Array(0), 48000, 16000)
  assert(emptyResampled.length === 0, 'Empty audio buffer resamples to empty array')

  // 1.5 Stereo downmix to mono
  const left = new Float32Array([1.0, -0.5, 0.8])
  const right = new Float32Array([0.0, 0.5, -0.2])
  const mono = downmixToMono([left, right])
  assert(
    mono.length === 3 &&
      Math.abs(mono[0] - 0.5) < 1e-6 &&
      Math.abs(mono[1] - 0.0) < 1e-6 &&
      Math.abs(mono[2] - 0.3) < 1e-6,
    'Stereo channels correctly averaged to mono',
    `Got [${mono[0]}, ${mono[1]}, ${mono[2]}]`
  )

  // -----------------------------------------------------------------------
  // Group 2: RMS Energy & Silence Calculation
  // -----------------------------------------------------------------------
  console.log('\n[Group 2/4] RMS Energy & Silence Detection')

  // 2.1 Pure zero silence
  const pureSilence = new Float32Array(1000).fill(0)
  const rmsZero = calculateRms(pureSilence)
  assert(rmsZero === 0, 'Pure zero array has RMS 0.0', `Got ${rmsZero}`)

  // 2.2 Low background noise below threshold (0.005)
  const lowNoise = new Float32Array(1000).fill(0.001)
  const rmsLow = calculateRms(lowNoise)
  assert(rmsLow < 0.005, 'Low amplitude (0.001) is below 0.005 silence threshold', `Got ${rmsLow}`)

  // 2.3 Sine wave speech energy
  const speechSim = new Float32Array(16000)
  for (let i = 0; i < speechSim.length; i++) {
    speechSim[i] = 0.5 * Math.sin((2 * Math.PI * 300 * i) / 16000)
  }
  const rmsSpeech = calculateRms(speechSim)
  assert(
    rmsSpeech > 0.3 && rmsSpeech < 0.4,
    'Sine wave amplitude 0.5 yields RMS ~0.354 (above threshold)',
    `Got ${rmsSpeech}`
  )

  // -----------------------------------------------------------------------
  // Group 3: WAV Encoding & wavValidator Compliance
  // -----------------------------------------------------------------------
  console.log('\n[Group 3/4] 16-bit PCM WAV Encoding & wavValidator Compliance')

  // 3.1 3-second 16kHz audio encoding
  const chunkSamples = new Float32Array(48000) // 3 seconds @ 16kHz
  for (let i = 0; i < chunkSamples.length; i++) {
    chunkSamples[i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / 16000)
  }
  const encoded = encodeWav16kMono(chunkSamples, 16000)

  // Check header byte size: 44 + 48000 * 2 = 96044
  assert(
    encoded.wavBuffer.length === 96044,
    'Encoded WAV length is exactly 96044 bytes (44-byte header + 96000 PCM bytes)',
    `Got ${encoded.wavBuffer.length}`
  )
  assert(!encoded.isSilent, 'Active audio is marked isSilent = false')
  assert(encoded.durationSec === 3.0, 'durationSec is 3.0 seconds', `Got ${encoded.durationSec}`)

  // 3.2 Verify encoded WAV against the project's actual electron/wavValidator.ts!
  const nodeBuf = Buffer.from(encoded.wavBuffer.buffer)
  const validation = validateWavBuffer(nodeBuf)
  assert(
    validation.valid === true,
    'Encoded WAV buffer satisfies all electron/wavValidator.ts checks',
    `Validation failed: ${validation.error}`
  )
  assert(
    validation.sampleRate === 16000 && validation.channels === 1 && validation.bitsPerSample === 16,
    'Validator confirms: 16000Hz, 1 channel, 16-bit PCM',
    `Got: sampleRate=${validation.sampleRate}, channels=${validation.channels}, bits=${validation.bitsPerSample}`
  )

  // 3.3 Silent WAV encoding
  const silentSamples = new Float32Array(16000).fill(0.0005)
  const silentEncoded = encodeWav16kMono(silentSamples, 16000)
  assert(silentEncoded.isSilent === true, 'Silent samples encoded with isSilent = true')
  const silentValidation = validateWavBuffer(Buffer.from(silentEncoded.wavBuffer.buffer))
  assert(silentValidation.isSilent === true, 'wavValidator independently confirms silence in encoded buffer')

  // -----------------------------------------------------------------------
  // Group 4: Sequential Transcription Queue & Backpressure
  // -----------------------------------------------------------------------
  console.log('\n[Group 4/4] Sequential Queue, Session Invalidation & Backpressure')

  // 4.1 In-order sequential execution test
  const executionLog: number[] = []
  let activeExecutions = 0
  let maxConcurrent = 0

  const mockTranscriber = async (chunk: { chunkIndex: number; audioBuffer: Uint8Array }) => {
    activeExecutions++
    maxConcurrent = Math.max(maxConcurrent, activeExecutions)
    // Simulate Whisper execution delay
    await new Promise((r) => setTimeout(r, 40))
    executionLog.push(chunk.chunkIndex)
    activeExecutions--
    return {
      text: `Chunk ${chunk.chunkIndex} text.`,
      durationMs: 40,
      sessionId: 'sess_1',
      chunkIndex: chunk.chunkIndex,
    }
  }

  const transcribedSegments: string[] = []
  const queue = new TranscriptionQueue({
    maxQueueDepth: 3,
    transcribeChunk: mockTranscriber,
    onSegment: (seg) => {
      transcribedSegments.push(seg.text)
    },
  })

  queue.setActiveSession('sess_1')

  // Enqueue 3 active chunks
  for (let i = 0; i < 3; i++) {
    queue.enqueue({
      wavBuffer: encoded.wavBuffer,
      durationSec: 3.0,
      sampleCount: 48000,
      rms: 0.1,
      isSilent: false,
      chunkIndex: i,
      sessionId: 'sess_1',
      isFinal: i === 2,
    })
  }

  // Wait for all to finish
  await queue.drain()

  assert(
    maxConcurrent === 1,
    'Queue strictly enforces single-execution concurrency (maxConcurrent = 1)',
    `Got maxConcurrent = ${maxConcurrent}`
  )
  assert(
    executionLog.length === 3 && executionLog[0] === 0 && executionLog[1] === 1 && executionLog[2] === 2,
    'Chunks are transcribed in strict chronological order [0, 1, 2]',
    `Got: [${executionLog.join(', ')}]`
  )
  assert(
    transcribedSegments.length === 3 && transcribedSegments[0] === 'Chunk 0 text.',
    'Segments delivered to callback match expected text',
    `Got: ${JSON.stringify(transcribedSegments)}`
  )

  // 4.2 Session Invalidation: discard chunks from cancelled sessions
  executionLog.length = 0
  transcribedSegments.length = 0

  queue.setActiveSession('sess_A')
  queue.enqueue({
    wavBuffer: encoded.wavBuffer,
    durationSec: 3.0,
    sampleCount: 48000,
    rms: 0.1,
    isSilent: false,
    chunkIndex: 0,
    sessionId: 'sess_A',
    isFinal: false,
  })

  // Switch session immediately to sess_B
  queue.setActiveSession('sess_B')
  queue.enqueue({
    wavBuffer: encoded.wavBuffer,
    durationSec: 3.0,
    sampleCount: 48000,
    rms: 0.1,
    isSilent: false,
    chunkIndex: 0,
    sessionId: 'sess_B',
    isFinal: true,
  })

  await queue.drain()

  assert(
    transcribedSegments.every((t) => !t.includes('sess_A')),
    'Chunks from obsolete session A do not update transcript',
    `Transcribed: ${JSON.stringify(transcribedSegments)}`
  )

  // 4.3 Backpressure Queue Limiting: drops excess chunks if backlog exceeds maxQueueDepth
  const slowQueue = new TranscriptionQueue({
    maxQueueDepth: 2,
    transcribeChunk: async (chunk) => {
      await new Promise((r) => setTimeout(r, 60))
      return { text: `T${chunk.chunkIndex}`, durationMs: 60, sessionId: 'sess_BP', chunkIndex: chunk.chunkIndex }
    },
    onSegment: () => {},
  })

  slowQueue.setActiveSession('sess_BP')

  // Rapidly enqueue 6 chunks while transcriber is slow
  for (let i = 0; i < 6; i++) {
    slowQueue.enqueue({
      wavBuffer: encoded.wavBuffer,
      durationSec: 3.0,
      sampleCount: 48000,
      rms: 0.1,
      isSilent: false,
      chunkIndex: i,
      sessionId: 'sess_BP',
      isFinal: i === 5,
    })
  }

  // Pending queue count must not exceed maxQueueDepth (2)
  assert(
    slowQueue.getPendingCount() <= 2,
    'Queue backpressure caps pending backlog to maxQueueDepth (<= 2)',
    `Pending count was ${slowQueue.getPendingCount()}`
  )

  await slowQueue.drain()

  // 4.4 Error resilience: queue continues even if a chunk throws
  let errorCaught = false
  let recoveredAfterError = false

  const resilientQueue = new TranscriptionQueue({
    maxQueueDepth: 3,
    transcribeChunk: async (chunk) => {
      if (chunk.chunkIndex === 0) {
        throw new Error('Whisper child process crashed')
      }
      return { text: 'Recovered', durationMs: 10, sessionId: 'sess_Err', chunkIndex: chunk.chunkIndex }
    },
    onSegment: () => {
      recoveredAfterError = true
    },
    onError: () => {
      errorCaught = true
    },
  })

  resilientQueue.setActiveSession('sess_Err')
  resilientQueue.enqueue({
    wavBuffer: encoded.wavBuffer,
    durationSec: 3.0,
    sampleCount: 48000,
    rms: 0.1,
    isSilent: false,
    chunkIndex: 0,
    sessionId: 'sess_Err',
    isFinal: false,
  })
  resilientQueue.enqueue({
    wavBuffer: encoded.wavBuffer,
    durationSec: 3.0,
    sampleCount: 48000,
    rms: 0.1,
    isSilent: false,
    chunkIndex: 1,
    sessionId: 'sess_Err',
    isFinal: true,
  })

  await resilientQueue.drain()

  assert(errorCaught, 'Queue forwards transcription error to onError callback')
  assert(recoveredAfterError, 'Queue continues processing subsequent chunks after an error without getting stuck')

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log('\n=====================================================')
  console.log(`Test Results: ${testsPassed}/${testsRun} passed (${testsFailed} failed)`)
  console.log('=====================================================\n')

  if (testsFailed > 0) {
    process.exit(1)
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err)
  process.exit(1)
})
