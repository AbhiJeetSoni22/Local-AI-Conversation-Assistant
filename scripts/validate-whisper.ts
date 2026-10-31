/**
 * Standalone Whisper Validation Script (Phase 2)
 *
 * Verifies local whisper.cpp executable, model, and runs a real local transcription
 * on a sample WAV file without starting Electron or requiring microphone access.
 *
 * Usage:
 *   npx tsx scripts/validate-whisper.ts
 *   or: npm run validate:whisper
 *
 * Exits with 0 on success, 1 on failure.
 */

import path from 'node:path'
import fs from 'node:fs'
import {
  getWhisperConfig,
  validateWhisperEnvironment,
} from '../electron/whisperConfig'
import { validateWavFile } from '../electron/wavValidator'
import { WhisperService } from '../electron/whisperService'

async function runValidation(): Promise<void> {
  console.log('=====================================================')
  console.log('   Whisper.cpp Local Transcription Validation')
  console.log('=====================================================\n')

  const config = getWhisperConfig()
  console.log('Active Configuration:')
  console.log(` - Executable: ${config.binPath}`)
  console.log(` - Model:      ${config.modelPath}`)
  console.log(` - Engine:     ${config.engine}`)
  console.log(` - Threads:    ${config.threads}\n`)

  // 1. Environment check
  console.log('[Step 1/4] Validating runtime executable and model...')
  const env = validateWhisperEnvironment(config)

  if (!env.valid) {
    console.error('\n❌ Environment Validation Failed:')
    console.error(`   ${env.error}\n`)
    console.error('Action Required:')
    console.error(' - Download whisper.cpp Windows release and place whisper-cli.exe in bin/')
    console.error(' - Download ggml-base.en.bin and place it in models/')
    console.error('See README.md for complete manual download instructions.')
    process.exit(1)
  }

  console.log('   ✅ Executable found and verified.')
  console.log('   ✅ Model file found and verified.\n')

  // 2. Audio input verification
  console.log('[Step 2/4] Resolving sample audio...')
  const rootDir = process.cwd()
  let samplePath = path.join(rootDir, 'samples', 'jfk.wav')

  if (!fs.existsSync(samplePath)) {
    // Check if an alternative WAV is supplied via CLI argument
    if (process.argv[2] && fs.existsSync(process.argv[2])) {
      samplePath = path.resolve(process.argv[2])
    } else {
      console.error(`\n❌ Sample audio file not found at: ${samplePath}`)
      console.error('   Please provide a 16kHz 16-bit mono WAV at samples/jfk.wav or pass a path as an argument:')
      console.error('   npm run validate:whisper -- path/to/sample.wav\n')
      process.exit(1)
    }
  }

  console.log(`   Selected audio: ${samplePath}`)
  const wavValidation = validateWavFile(samplePath)

  if (!wavValidation.valid) {
    console.error(`\n❌ WAV Validation Failed: ${wavValidation.error}`)
    process.exit(1)
  }

  console.log(`   ✅ Valid WAV format: ${wavValidation.sampleRate}Hz, ${wavValidation.channels}ch, ${wavValidation.bitsPerSample}-bit, duration: ${wavValidation.durationSec}s\n`)

  // 3. Run transcription
  console.log('[Step 3/4] Running local Whisper transcription...')
  const service = new WhisperService(config)

  const startTime = Date.now()
  try {
    const result = await service.transcribe(samplePath, { timeoutMs: 45000 })
    const elapsedMs = Date.now() - startTime

    console.log('   ✅ Transcription completed successfully!\n')

    // 4. Output results
    console.log('[Step 4/4] Output Verification:')
    console.log('-----------------------------------------------------')
    console.log(`Recognized Text: "${result.text}"`)
    console.log('-----------------------------------------------------')
    console.log(`Duration:        ${elapsedMs} ms (${(elapsedMs / 1000).toFixed(2)}s)`)
    console.log(`Engine:          ${result.engine}`)
    console.log(`Model:           ${result.modelUsed}`)
    console.log(`Silent:          ${result.isSilent ? 'Yes' : 'No'}`)

    if (!result.text || result.text.trim().length === 0) {
      console.warn('\n⚠️ Warning: Transcription produced an empty string.')
    } else {
      console.log('\n🎉 Standalone Whisper validation succeeded! Foundation verified.')
    }

    service.dispose()
    process.exit(0)
  } catch (err) {
    service.dispose()
    console.error('\n❌ Transcription Execution Failed:')
    console.error(`   ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }
}

runValidation()
