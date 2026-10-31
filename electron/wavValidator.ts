import fs from 'node:fs'

export interface WavValidationResult {
  valid: boolean
  error?: string
  durationSec?: number
  sampleRate?: number
  channels?: number
  bitsPerSample?: number
  isSilent?: boolean
}

export interface WavValidatorOptions {
  /** Maximum allowed audio duration in seconds (default: 120s) */
  maxDurationSec?: number
  /** Allowed sample rates. Whisper natively expects 16000 Hz */
  expectedSampleRate?: number
  /** Strict sample rate checking (default: false - logs warning instead of fatal failure) */
  strictSampleRate?: boolean
  /** RMS amplitude threshold below which audio is treated as silent (default: 0.005) */
  silenceThreshold?: number
}

/**
 * Validates a WAV buffer or file against standard PCM 16-bit requirements for whisper.cpp.
 *
 * Inspects:
 * 1. File size & RIFF/WAVE container header
 * 2. 'fmt ' chunk (PCM format, channels, sample rate, bit depth)
 * 3. 'data' chunk (data size, completeness)
 * 4. Duration limits
 * 5. Silence / energy detection
 */
export function validateWavBuffer(
  buffer: Buffer,
  options: WavValidatorOptions = {}
): WavValidationResult {
  const maxDurationSec = options.maxDurationSec ?? 120
  const expectedSampleRate = options.expectedSampleRate ?? 16000
  const strictSampleRate = options.strictSampleRate ?? false
  const silenceThreshold = options.silenceThreshold ?? 0.005

  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Audio input is empty (0 bytes).' }
  }

  // Minimum WAV header is 44 bytes
  if (buffer.length < 44) {
    return {
      valid: false,
      error: `Invalid WAV file: buffer size (${buffer.length} bytes) is too small to contain a standard WAV header.`,
    }
  }

  // Check 'RIFF' marker
  const riffHeader = buffer.toString('ascii', 0, 4)
  if (riffHeader !== 'RIFF') {
    return {
      valid: false,
      error: `Invalid WAV header: expected "RIFF", found "${riffHeader}".`,
    }
  }

  // Check 'WAVE' marker
  const waveHeader = buffer.toString('ascii', 8, 12)
  if (waveHeader !== 'WAVE') {
    return {
      valid: false,
      error: `Invalid WAV header: expected "WAVE", found "${waveHeader}".`,
    }
  }

  // Parse RIFF chunks
  let offset = 12
  let fmtFound = false
  let dataFound = false
  let audioFormat = 0
  let channels = 0
  let sampleRate = 0
  let bitsPerSample = 0
  let dataOffset = 0
  let dataSize = 0

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    offset += 8

    if (chunkId === 'fmt ') {
      fmtFound = true
      if (chunkSize < 16) {
        return { valid: false, error: `Invalid "fmt " chunk size: ${chunkSize} (expected at least 16).` }
      }
      audioFormat = buffer.readUInt16LE(offset)
      channels = buffer.readUInt16LE(offset + 2)
      sampleRate = buffer.readUInt32LE(offset + 4)
      bitsPerSample = buffer.readUInt16LE(offset + 14)
    } else if (chunkId === 'data') {
      dataFound = true
      dataOffset = offset
      dataSize = chunkSize
      break
    }

    offset += chunkSize
    // Chunks are padded to even byte boundaries
    if (chunkSize % 2 !== 0) {
      offset += 1
    }
  }

  if (!fmtFound) {
    return { valid: false, error: 'Invalid WAV format: missing required "fmt " subchunk.' }
  }

  if (!dataFound) {
    return { valid: false, error: 'Invalid WAV format: missing required "data" subchunk.' }
  }

  // Audio format 1 is standard linear uncompressed PCM
  if (audioFormat !== 1) {
    return {
      valid: false,
      error: `Unsupported audio encoding: format code ${audioFormat} (only standard linear PCM format 1 is supported).`,
    }
  }

  if (channels !== 1 && channels !== 2) {
    return {
      valid: false,
      error: `Unsupported channel count: ${channels} (whisper expects mono 1-channel or stereo 2-channel audio).`,
    }
  }

  if (bitsPerSample !== 16) {
    return {
      valid: false,
      error: `Unsupported bit depth: ${bitsPerSample}-bit (only 16-bit PCM is supported).`,
    }
  }

  if (strictSampleRate && sampleRate !== expectedSampleRate) {
    return {
      valid: false,
      error: `Unsupported sample rate: ${sampleRate} Hz (expected ${expectedSampleRate} Hz for whisper.cpp).`,
    }
  }

  // Verify data completeness
  const availableData = buffer.length - dataOffset
  const actualDataLength = Math.min(dataSize, availableData)

  if (actualDataLength <= 0) {
    return { valid: false, error: 'WAV data subchunk contains 0 bytes of audio data.' }
  }

  const bytesPerSample = bitsPerSample / 8
  const bytesPerFrame = channels * bytesPerSample
  const totalFrames = Math.floor(actualDataLength / bytesPerFrame)
  const durationSec = totalFrames / sampleRate

  if (durationSec <= 0) {
    return { valid: false, error: 'WAV audio duration is 0 seconds.' }
  }

  if (durationSec > maxDurationSec) {
    return {
      valid: false,
      error: `WAV audio duration (${durationSec.toFixed(1)}s) exceeds maximum allowed limit (${maxDurationSec}s).`,
      durationSec,
    }
  }

  // Check for silence / low energy: compute RMS on 16-bit PCM samples
  const sampleCount = Math.floor(actualDataLength / 2)
  let sumSquares = 0
  // Sub-sample large audio buffers for performance
  const step = Math.max(1, Math.floor(sampleCount / 10000))
  let evaluatedSamples = 0

  for (let i = 0; i < sampleCount; i += step) {
    const sample = buffer.readInt16LE(dataOffset + i * 2)
    // Normalize to -1.0 .. 1.0
    const normalized = sample / 32768.0
    sumSquares += normalized * normalized
    evaluatedSamples++
  }

  const rms = evaluatedSamples > 0 ? Math.sqrt(sumSquares / evaluatedSamples) : 0
  const isSilent = rms < silenceThreshold

  return {
    valid: true,
    durationSec: Number(durationSec.toFixed(3)),
    sampleRate,
    channels,
    bitsPerSample,
    isSilent,
  }
}

/**
 * Validates a WAV file on disk.
 */
export function validateWavFile(
  filePath: string,
  options: WavValidatorOptions = {}
): WavValidationResult {
  if (!fs.existsSync(filePath)) {
    return { valid: false, error: `WAV file not found at path "${filePath}".` }
  }

  try {
    const buffer = fs.readFileSync(filePath)
    return validateWavBuffer(buffer, options)
  } catch (err) {
    return {
      valid: false,
      error: `Failed to read WAV file: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

