/**
 * Standalone Ollama Validation Script (Phase 3)
 *
 * Verifies live local Ollama runtime, model availability, and runs a real local inference test
 * on a sample conversation transcript without starting Electron.
 *
 * Usage:
 *   npx tsx scripts/validate-ollama.ts
 *   or: npm run validate:ollama
 *
 * Exits with 0 on success, 1 on failure.
 */

import { getOllamaConfig, checkOllamaHealth } from '../electron/ollamaConfig'
import { OllamaService } from '../electron/ollamaService'

async function runValidation(): Promise<void> {
  console.log('=====================================================')
  console.log('   Ollama Local LLM Runtime & Model Validation')
  console.log('=====================================================\n')

  const config = getOllamaConfig()
  console.log('Active Configuration:')
  console.log(` - Host / Base URL: ${config.baseUrl}`)
  console.log(` - Target Model:    ${config.model}`)
  console.log(` - Timeout:         ${config.timeoutMs}ms`)
  console.log(` - Temperature:     ${config.temperature}\n`)

  // Step 1: Health & reachability check
  console.log('[Step 1/3] Checking Ollama daemon reachability...')
  const readiness = await checkOllamaHealth(config)

  if (!readiness.serviceReachable) {
    console.error('\n❌ Ollama Daemon is Unreachable:')
    console.error(`   ${readiness.error}\n`)
    console.error('Troubleshooting & Setup Steps:')
    console.error(' 1. Ensure Ollama is installed (download from https://ollama.com if not installed).')
    console.error(' 2. Verify Ollama is running. On Windows, check the system tray icon or run:')
    console.error('    ollama --version')
    console.error(' 3. If running on a non-default port or host, set the OLLAMA_HOST environment variable:')
    console.error('    $env:OLLAMA_HOST="http://127.0.0.1:11434"')
    process.exit(1)
  }

  console.log(`   ✅ Ollama daemon reachable (version: ${readiness.version || 'unknown'}).\n`)

  // Step 2: Model availability check
  console.log('[Step 2/3] Checking installed models...')
  console.log(`   Installed models found (${readiness.availableModels.length}):`)
  if (readiness.availableModels.length === 0) {
    console.log('   (No models installed yet)')
  } else {
    for (const m of readiness.availableModels) {
      console.log(`   - ${m}`)
    }
  }

  if (!readiness.modelAvailable) {
    console.error(`\n❌ Target model "${config.model}" is not installed.`)
    console.error('\nAction Required:')
    console.error(`   Run the following command in PowerShell / Command Prompt to download it:`)
    console.error(`   ollama pull ${config.model}\n`)
    console.error(`After pulling finishes, re-run: npm run validate:ollama`)
    process.exit(1)
  }

  console.log(`   ✅ Target model "${config.model}" is installed and ready.\n`)

  // Step 3: Live inference test
  console.log('[Step 3/3] Running live sample inference test...')
  const sampleTranscript =
    'Speaker 1: We are designing a local-only AI assistant for meetings.\n' +
    'Speaker 2: How does the application ensure low latency without uploading audio to the cloud?'

  console.log('--- Sample Input Transcript ---')
  console.log(sampleTranscript)
  console.log('-------------------------------\n')
  console.log('Streaming response tokens from Ollama:\n')

  const service = new OllamaService(config)
  let tokenCount = 0

  try {
    const result = await service.generateStreaming(sampleTranscript, (chunk) => {
      process.stdout.write(chunk)
      tokenCount++
    })

    console.log('\n\n-------------------------------')
    console.log('✅ Inference Test Successful!')
    console.log(` - Model:       ${result.model}`)
    console.log(` - Duration:    ${(result.durationMs / 1000).toFixed(2)}s`)
    console.log(` - Tokens sent: ~${tokenCount} chunks`)
    console.log('=====================================================')
    process.exit(0)
  } catch (err: unknown) {
    console.error('\n\n❌ Inference Test Failed:')
    console.error(`   ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }
}

runValidation().catch((err) => {
  console.error('Unexpected validation error:', err)
  process.exit(1)
})

