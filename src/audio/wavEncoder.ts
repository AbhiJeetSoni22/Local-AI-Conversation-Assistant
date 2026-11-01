/**
 * WAV Encoder Utility (Phase 4)
 *
 * Encodes 16,000 Hz 1-channel mono Float32Array PCM samples into a standard
 * 44-byte header RIFF/WAVE 16-bit linear PCM byte buffer (Uint8Array)
 * that satisfies all Whisper.cpp and electron/wavValidator.ts constraints.
 */

export interface WavEncodingResult {
  wavBuffer: Uint8Array
  durationSec: number
  sampleCount: number
  rms: number
  isSilent: boolean
}

/**
 * Encodes 16kHz mono Float32Array audio samples into a standard 16-bit PCM WAV.
 *
 * @param samples Float32Array of normalized audio samples [-1.0, 1.0]
 * @param sampleRate Expected 16000 Hz
 * @param silenceThreshold RMS amplitude below which audio is flagged silent (default: 0.005)
 */
export function encodeWav16kMono(
  samples: Float32Array,
  sampleRate = 16000,
  silenceThreshold = 0.005
): WavEncodingResult {
  const numSamples = samples.length
  const numChannels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const dataSize = numSamples * numChannels * bytesPerSample
  const totalFileSize = 44 + dataSize

  const buffer = new ArrayBuffer(totalFileSize)
  const view = new DataView(buffer)

  // 1. RIFF Chunk Descriptor
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true) // File size - 8
  writeAscii(view, 8, 'WAVE')

  // 2. "fmt " Sub-chunk
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // Subchunk1Size (16 for standard PCM)
  view.setUint16(20, 1, true)  // AudioFormat (1 = Linear PCM)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true) // ByteRate
  view.setUint16(32, numChannels * bytesPerSample, true) // BlockAlign
  view.setUint16(34, bitsPerSample, true)

  // 3. "data" Sub-chunk
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // 4. Write 16-bit signed PCM samples & compute RMS
  let sumSquares = 0
  let offset = 44

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1.0, Math.min(1.0, samples[i]))
    sumSquares += s * s
    // Scale to 16-bit signed integer [-32768, 32767]
    const pcm = s < 0 ? s * 32768 : s * 32767
    view.setInt16(offset, Math.max(-32768, Math.min(32767, Math.round(pcm))), true)
    offset += 2
  }

  const rms = numSamples > 0 ? Math.sqrt(sumSquares / numSamples) : 0
  const isSilent = rms < silenceThreshold
  const durationSec = numSamples / sampleRate

  return {
    wavBuffer: new Uint8Array(buffer),
    durationSec,
    sampleCount: numSamples,
    rms,
    isSilent,
  }
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}

