/**
 * Whisper Edge Cases & Failure Tests Suite (Phase 2)
 *
 * Verifies all negative pathways, input validation, silence handling,
 * server startup failures, and error reporting without crashing the process.
 *
 * Run with:
 *   npx tsx scripts/test-whisper-failures.ts
 *   or: npm run test:whisper
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { WhisperService } from '../electron/whisperService'
import { validateWavBuffer, validateWavFile } from '../electron/wavValidator'
import { validateWhisperEnvironment, getWhisperConfig } from '../electron/whisperConfig'

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

/**
 * Creates a synthetic standard 16kHz 16-bit mono PCM WAV buffer.
 */
function createSyntheticWav(durationSec: number, frequencyHz: number = 440, amplitude: number = 0.5): Buffer {
  const sampleRate = 16000
  const channels = 1
  const bitsPerSample = 16
  const totalSamples = Math.floor(sampleRate * durationSec)
  const bytesPerSample = bitsPerSample / 8
  const dataSize = totalSamples * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  // RIFF chunk descriptor
  buffer.write('RIFF', 0, 4, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 4, 'ascii')

  // "fmt " sub-chunk
  buffer.write('fmt ', 12, 4, 'ascii')
  buffer.writeUInt32LE(16, 16) // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20)  // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28) // ByteRate
  buffer.writeUInt16LE(channels * bytesPerSample, 32) // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34)

  // "data" sub-chunk
  buffer.write('data', 36, 4, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)

  // Write sine wave or silence
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate
    const sampleVal = amplitude === 0 ? 0 : Math.sin(2 * Math.PI * frequencyHz * t) * amplitude
    const clamped = Math.max(-1, Math.min(1, sampleVal))
    const int16 = Math.round(clamped * 32767)
    buffer.writeInt16LE(int16, 44 + i * 2)
  }

  return buffer
}

async function runTestSuite(): Promise<void> {
  console.log('=====================================================')
  console.log('   Whisper Failure Modes & Reliability Test Suite')
  console.log('=====================================================\n')

  const baseConfig = getWhisperConfig()

  // Test 1: Missing executable handling
  console.log('[Test Group 1] Missing & Invalid Executable')
  const missingBinValidation = validateWhisperEnvironment({
    ...baseConfig,
    binPath: path.join(os.tmpdir(), 'non_existent_whisper_bin.exe'),
  })
  assert(
    !missingBinValidation.valid && !missingBinValidation.executableFound,
    'Missing executable detected',
    missingBinValidation.error
  )
  assert(
    typeof missingBinValidation.error === 'string' && missingBinValidation.error.includes('Whisper executable not found'),
    'Actionable error message returned for missing executable',
    missingBinValidation.error
  )

  // Test 2: Missing model handling
  console.log('\n[Test Group 2] Missing & Corrupted Model')
  const missingModelValidation = validateWhisperEnvironment({
    ...baseConfig,
    modelPath: path.join(os.tmpdir(), 'non_existent_model.bin'),
  })
  assert(
    !missingModelValidation.valid && !missingModelValidation.modelFound,
    'Missing model detected',
    missingModelValidation.error
  )
  assert(
    typeof missingModelValidation.error === 'string' && missingModelValidation.error.includes('Whisper model not found'),
    'Actionable error message returned for missing model',
    missingModelValidation.error
  )

  // Test 2b: Undersized / empty model file
  const emptyModelPath = path.join(os.tmpdir(), `corrupt_model_${Date.now()}.bin`)
  fs.writeFileSync(emptyModelPath, Buffer.alloc(1024)) // only 1KB
  const corruptModelValidation = validateWhisperEnvironment({
    ...baseConfig,
    modelPath: emptyModelPath,
  })
  fs.unlinkSync(emptyModelPath)
  assert(
    !corruptModelValidation.valid && Boolean(corruptModelValidation.error?.includes('unexpectedly small')),
    'Undersized/corrupted model rejected',
    corruptModelValidation.error
  )

  // Test 3: Audio Validation Failures
  console.log('\n[Test Group 3] Audio Input Validation')

  // 3a: Empty buffer
  const emptyBufferRes = validateWavBuffer(Buffer.alloc(0))
  assert(!emptyBufferRes.valid && Boolean(emptyBufferRes.error?.includes('empty')), 'Empty buffer rejected', emptyBufferRes.error)

  // 3b: Corrupted header (less than 44 bytes)
  const shortBufferRes = validateWavBuffer(Buffer.from('RIFF1234'))
  assert(!shortBufferRes.valid && Boolean(shortBufferRes.error?.includes('too small')), 'Truncated WAV header rejected', shortBufferRes.error)

  // 3c: Non-RIFF format
  const badRiff = Buffer.from('NOT_A_RIFF_HEADER_12345678901234567890123456789012345678901234')
  const badRiffRes = validateWavBuffer(badRiff)
  assert(!badRiffRes.valid && Boolean(badRiffRes.error?.includes('expected "RIFF"')), 'Invalid RIFF magic rejected', badRiffRes.error)

  // 3d: Valid WAV with synthetic audio
  const syntheticWav = createSyntheticWav(1.5, 440, 0.5)
  const syntheticRes = validateWavBuffer(syntheticWav)
  assert(syntheticRes.valid && syntheticRes.durationSec === 1.5 && !syntheticRes.isSilent, 'Valid synthetic WAV recognized')

  // 3e: Silent audio detection
  const silentWav = createSyntheticWav(1.0, 0, 0)
  const silentRes = validateWavBuffer(silentWav)
  assert(silentRes.valid && silentRes.isSilent === true, 'Silent audio detected without error')

  // Test 4: WhisperService handling of silent audio without calling CLI
  console.log('\n[Test Group 4] Silent Audio Handling in Service')
  const service = new WhisperService(baseConfig)
  try {
    const silentResult = await service.transcribe(silentWav)
    assert(silentResult.isSilent === true && silentResult.text === '', 'Service gracefully handles silent audio')
  } catch (err) {
    assert(false, 'Silent audio transcription threw an error', String(err))
  }

  // Test 5: Service rejection of invalid WAV without launching Whisper
  console.log('\n[Test Group 5] Service Error Rejection')
  let threwExpected = false
  try {
    await service.transcribe(Buffer.from('CORRUPT_AUDIO_DATA_FOR_TESTING_12345678901234567890'))
  } catch (err) {
    threwExpected = true
    assert(
      err instanceof Error && err.message.includes('Audio validation failed'),
      'Invalid audio rejected before execution',
      String(err)
    )
  }
  if (!threwExpected) {
    assert(false, 'Invalid audio did not throw')
  }

  // Test 6: Server Startup Failure with Missing Binary
  console.log('\n[Test Group 6] Server Failure Modes')
  const brokenServerService = new WhisperService({
    binPath: path.join(os.tmpdir(), 'non_existent_server.exe'),
    engine: 'server',
  })
  let serverStartupThrew = false
  try {
    await brokenServerService.startServer(2000)
  } catch (err) {
    serverStartupThrew = true
    assert(
      err instanceof Error && err.message.includes('Cannot start Whisper server'),
      'Server fails cleanly when binary is missing',
      String(err)
    )
  }
  if (!serverStartupThrew) {
    assert(false, 'Broken server did not throw on startup')
  }

  // Test 7: Port Conflict Detection for Server Mode
  const occupiedPort = 9876
  const dummyServer = http.createServer((_req, res) => {
    res.writeHead(200)
    res.end('OK')
  })
  await new Promise<void>((resolve) => dummyServer.listen(occupiedPort, '127.0.0.1', resolve))

  const conflictServerService = new WhisperService({
    ...baseConfig,
    serverPort: occupiedPort,
    engine: 'server',
  })
  let portConflictThrew = false
  try {
    await conflictServerService.startServer(2000)
  } catch (err) {
    portConflictThrew = true
    assert(
      err instanceof Error && err.message.includes('already in use'),
      'Occupied port detected and rejected before server launch',
      String(err)
    )
  } finally {
    await new Promise<void>((resolve) => dummyServer.close(() => resolve()))
  }
  if (!portConflictThrew) {
    assert(false, 'Port conflict did not trigger expected error')
  }

  // Test 8: Multiple start/stop & disposal idempotency
  console.log('\n[Test Group 8] Service Lifecycle & Cleanup')
  try {
    service.dispose()
    service.dispose() // Repeated call must not crash
    assert(true, 'Repeated service dispose() calls are safe and idempotent')
  } catch (err) {
    assert(false, 'dispose() threw on repeated call', String(err))
  }

  // Test 9: End-to-End Transcription on JFK Sample WAV
  console.log('\n[Test Group 9] End-to-End Real Inference Verification')
  const jfkPath = path.join(process.cwd(), 'samples', 'jfk.wav')
  if (fs.existsSync(jfkPath)) {
    const wavCheck = validateWavFile(jfkPath)
    assert(wavCheck.valid, 'JFK WAV file passes validator')
    const realService = new WhisperService(baseConfig)
    try {
      const result = await realService.transcribe(jfkPath, { timeoutMs: 30000 })
      assert(
        result.text.toLowerCase().includes('ask not what your country can do for you'),
        'Real local transcription produces expected JFK phrase',
        `Received: "${result.text}"`
      )
      assert(result.durationMs > 0, `Transcription timing recorded (${result.durationMs}ms)`)
      realService.dispose()
    } catch (err) {
      realService.dispose()
      assert(false, 'Real transcription threw an error', String(err))
    }
  } else {
    console.log('  ⚠️ Skipping JFK sample audio test: samples/jfk.wav not found on disk.')
  }

  // Summary
  console.log('\n=====================================================')
  console.log(`Results: ${testsPassed} / ${testsRun} passed (${testsFailed} failed)`)
  console.log('=====================================================\n')

  if (testsFailed > 0) {
    process.exit(1)
  } else {
    process.exit(0)
  }
}

runTestSuite()
