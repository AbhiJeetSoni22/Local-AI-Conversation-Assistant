/**
 * Audio Resampling & Channel Downmixing Utilities (Phase 4)
 *
 * Converts arbitrary input audio (e.g. 48,000 Hz or 44,100 Hz, mono or stereo)
 * into 16,000 Hz 1-channel mono PCM Float32Array suitable for Whisper.cpp.
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
 * Resamples a mono Float32Array from sourceSampleRate to targetSampleRate (default 16000 Hz)
 * using linear interpolation with an anti-aliasing moving average filter for downsampling.
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

  const ratio = sourceSampleRate / targetSampleRate
  const outputLength = Math.max(1, Math.round(input.length / ratio))
  const output = new Float32Array(outputLength)

  // When downsampling (ratio > 1), apply an anti-aliasing box filter
  const filterWidth = Math.max(1, Math.floor(ratio))

  for (let i = 0; i < outputLength; i++) {
    const center = i * ratio

    if (ratio > 1.5) {
      // Downsampling: average samples within filter window
      const start = Math.max(0, Math.floor(center - filterWidth / 2))
      const end = Math.min(input.length - 1, Math.floor(center + filterWidth / 2))
      let sum = 0
      let count = 0
      for (let j = start; j <= end; j++) {
        sum += input[j]
        count++
      }
      output[i] = count > 0 ? sum / count : input[Math.min(Math.floor(center), input.length - 1)]
    } else {
      // Linear interpolation
      const indexFloor = Math.floor(center)
      const indexCeil = Math.min(indexFloor + 1, input.length - 1)
      const fraction = center - indexFloor
      output[i] = input[indexFloor] * (1 - fraction) + input[indexCeil] * fraction
    }
  }

  return output
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

