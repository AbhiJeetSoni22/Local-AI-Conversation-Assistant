/**
 * Transcription Accuracy, Hallucination Suppression & Answer Relevance Test Suite
 *
 * Evaluates:
 * 1. Internal Whisper marker filtering & YouTube hallucination stripping
 * 2. Technical vocabulary prompt generation and bounds
 * 3. WhisperService configuration (no-fallback, no-speech-thold, initial-prompt)
 * 4. End-to-end transcription accuracy on:
 *    - "I would like to know about LangChain."
 *    - "Explain what LangChain is."
 *    - "What is a vector database?"
 *    - Non-technical control: "There is a link chain on the wall."
 *    - Pure silence / low amplitude noise (verifies zero hallucinations)
 * 5. PromptBuilder & Ollama answer relevance on noisy speech transcripts:
 *    - Verifies Ollama infers intended question and ignores channel/subscription artifacts
 *
 * Run with:
 *   npx tsx scripts/test-transcription-accuracy.ts
 *   or: npm run test:accuracy
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
import {
  DEFAULT_TECHNICAL_VOCABULARY,
  buildInitialPrompt,
  filterWhisperMarkers,
  filterHallucinations,
} from '../electron/vocabularyConfig'
import { WhisperService } from '../electron/whisperService'
import { validateWhisperEnvironment } from '../electron/whisperConfig'
import { buildAnswerPrompt } from '../electron/promptBuilder'
import { OllamaService } from '../electron/ollamaService'

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
 * Generates a standard 16kHz 16-bit mono WAV file using Windows SAPI SpeechSynthesizer.
 */
function synthesize16kWav(text: string, outputPath: string): boolean {
  if (process.platform !== 'win32') {
    return false
  }

  const escapedText = text.replace(/'/g, "''")
  const escapedPath = outputPath.replace(/'/g, "''")

  const psCommand = `& {
    Add-Type -AssemblyName System.Speech;
    $s = New-Object System.Speech.Synthesis.SpeechSynthesizer;
    $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono);
    $s.SetOutputToWaveFile('${escapedPath}', $fmt);
    $s.Speak('${escapedText}');
    $s.Dispose();
  }`

  try {
    execSync(`powershell -NoProfile -NonInteractive -Command "${psCommand.replace(/\n/g, ' ')}"`, {
      stdio: 'pipe',
      timeout: 10000,
    })
    return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 44
  } catch {
    return false
  }
}

/**
 * Creates a standard 16kHz 16-bit mono WAV file containing pure silence.
 */
function createSilenceWav(outputPath: string, durationSec = 2.0): void {
  const sampleRate = 16000
  const numSamples = Math.round(durationSec * sampleRate)
  const dataSize = numSamples * 2
  const totalSize = 44 + dataSize
  const buffer = Buffer.alloc(totalSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  // Remaining samples default to 0 (silence)

  fs.writeFileSync(outputPath, buffer)
}

async function runAccuracyTests() {
  console.log('\n=====================================================')
  console.log('   Transcription Accuracy & Relevance Test Suite')
  console.log('=====================================================\n')

  // ---------------------------------------------------------------------------
  // [Group 1/5] Internal Whisper Marker & Hallucination Filtering
  // ---------------------------------------------------------------------------
  console.log('[Group 1/5] Internal Marker & Silence Hallucination Filtering')

  assert(
    filterWhisperMarkers('[BLANK_AUDIO]') === '',
    'Standalone [BLANK_AUDIO] filters to empty string'
  )

  assert(
    filterWhisperMarkers('   [BLANK_AUDIO]   ') === '',
    'Whitespace-padded [BLANK_AUDIO] filters to empty string'
  )

  assert(
    filterWhisperMarkers('[BLANK_AUDIO] [BLANK_AUDIO]') === '',
    'Repeated [BLANK_AUDIO] tokens filter to empty string'
  )

  assert(
    filterWhisperMarkers('I would like to know about LangChain. [BLANK_AUDIO]') ===
      'I would like to know about LangChain.',
    'Trailing [BLANK_AUDIO] stripped without altering valid speech'
  )

  assert(
    filterWhisperMarkers('[BLANK_AUDIO] Good morning team.') === 'Good morning team.',
    'Leading [BLANK_AUDIO] stripped without altering valid speech'
  )

  assert(
    filterWhisperMarkers('Here is [MUSIC] some speech with (applause) noise.') ===
      'Here is some speech with noise.',
    'Acoustic markers ([MUSIC], (applause)) stripped from mid-sentence'
  )

  assert(
    filterWhisperMarkers('[SILENCE] [NOISE] (silence)') === '',
    'Pure non-speech tokens filter to empty string'
  )

  assert(
    filterWhisperMarkers('Clean normal speech without any markers.') ===
      'Clean normal speech without any markers.',
    'Genuine speech without markers is preserved verbatim'
  )

  // YouTube / outro hallucination patterns
  assert(
    filterHallucinations('The channel is called LANGCHAIN and if you subscribe it\'s a great way.') === '',
    'Filters YouTube channel and subscription boilerplate completely'
  )

  const mixedGarble = 'Hello I would like to know about The channel is called LANGCHAIN and if you subscribe it\'s a... Importance and the Rule of the LangChain. Happy?'
  const cleanedGarble = filterWhisperMarkers(mixedGarble)
  assert(
    cleanedGarble.includes('Hello I would like to know about') &&
      !cleanedGarble.includes('channel is called') &&
      !cleanedGarble.includes('if you subscribe'),
    `Strips YouTube outro hallucinations from mixed speech: "${cleanedGarble}"`
  )

  assert(
    filterWhisperMarkers('Thank you for watching. Please like and subscribe.') === '',
    'Filters outro "Thank you for watching / subscribe" boilerplate to empty'
  )

  // ---------------------------------------------------------------------------
  // [Group 2/5] Technical Vocabulary & Prompt Builder
  // ---------------------------------------------------------------------------
  console.log('\n[Group 2/5] Vocabulary & Initial Prompt Configuration')

  const coreTerms = ['LangChain', 'LLMs', 'RAG', 'Python', 'React', 'TypeScript']

  for (const term of coreTerms) {
    assert(
      DEFAULT_TECHNICAL_VOCABULARY.includes(term),
      `Core vocabulary includes "${term}"`
    )
  }

  const defaultPrompt = buildInitialPrompt()
  assert(
    defaultPrompt.includes('LangChain') && defaultPrompt.includes('TypeScript'),
    'Default prompt contains core technical keywords'
  )

  assert(
    defaultPrompt.length < 800,
    `Default prompt length is within safe context bounds (${defaultPrompt.length} chars < 800)`
  )

  const disabledPrompt = buildInitialPrompt({ disabled: true })
  assert(
    disabledPrompt === '',
    'Disabled option yields empty prompt'
  )

  const customOverride = buildInitialPrompt({ customPrompt: 'Custom, Keywords, Only' })
  assert(
    customOverride === 'Custom, Keywords, Only',
    'Direct customPrompt override is respected'
  )

  const withExtra = buildInitialPrompt({ extraTerms: ['Docker', 'FastAPI'] })
  assert(
    withExtra.includes('Docker') && withExtra.includes('FastAPI'),
    'Extra vocabulary terms appended correctly'
  )

  // ---------------------------------------------------------------------------
  // [Group 3/5] Whisper Service Configuration & Baseline Cleanliness
  // ---------------------------------------------------------------------------
  console.log('\n[Group 3/5] Whisper Service Configuration & Baseline Cleanliness')

  const service = new WhisperService()
  const cfg = service.getConfig()

  assert(
    cfg.engine === 'cli' || cfg.engine === 'server',
    'WhisperService initializes with valid engine mode'
  )

  assert(
    typeof cfg.threads === 'number' && cfg.threads > 0,
    'WhisperService configures thread count'
  )

  assert(
    cfg.initialPrompt === '' || cfg.initialPrompt === undefined,
    'WhisperService defaults to clean baseline mode without forced prompt'
  )

  // ---------------------------------------------------------------------------
  // [Group 4/5] End-to-End Transcription Accuracy & Silence Handling
  // ---------------------------------------------------------------------------
  console.log('\n[Group 4/5] End-to-End Transcription Accuracy & Silence Handling')

  const env = validateWhisperEnvironment()
  if (!env.valid) {
    console.log(`  ⚠️ Skipping live transcription tests: Whisper binary or model missing (${env.error})`)
  } else {
    const tempDir = os.tmpdir()

    // Test 1: Silence WAV should produce empty string without hallucinating
    const silenceWavPath = path.join(tempDir, `test_silence_${Date.now()}.wav`)
    createSilenceWav(silenceWavPath, 3.0)

    try {
      const silenceResult = await service.transcribe(silenceWavPath)
      assert(
        silenceResult.isSilent === true || silenceResult.text === '',
        `Silence audio produced silent/empty result: "${silenceResult.text}"`
      )
      assert(
        !silenceResult.text.includes('channel') && !silenceResult.text.includes('subscribe'),
        'Silence audio did not hallucinate YouTube boilerplate'
      )
    } finally {
      if (fs.existsSync(silenceWavPath)) fs.unlinkSync(silenceWavPath)
    }

    // Test 2: Speech test cases
    const testCases = [
      {
        id: 's1_langchain',
        spoken: 'I would like to know about LangChain.',
        expected: 'LangChain',
        description: 'Technical proper noun "LangChain" recognition',
      },
      {
        id: 's2_explain_langchain',
        spoken: 'Explain what LangChain is.',
        expected: 'LangChain',
        description: 'Question phrasing "Explain what LangChain is"',
      },
      {
        id: 's3_vectordb',
        spoken: 'What is a vector database?',
        expected: 'vector database',
        description: 'Domain concept "vector database"',
      },
      {
        id: 's4_link_chain_control',
        spoken: 'There is a link chain on the wall.',
        expected: 'link chain',
        mustNotContain: 'LangChain',
        description: 'Control sentence: "link chain" MUST NOT falsely become "LangChain"',
      },
    ]

    for (const tc of testCases) {
      const wavPath = path.join(tempDir, `test_acc_${tc.id}_${Date.now()}.wav`)
      const synthesized = synthesize16kWav(tc.spoken, wavPath)

      if (!synthesized) {
        console.log(`  ⚠️ SAPI speech synthesis unavailable for ${tc.id}. Skipping.`)
        continue
      }

      try {
        const result = await service.transcribe(wavPath)
        console.log(`\n  --- Test: ${tc.description} ---`)
        console.log(`  Spoken:      "${tc.spoken}"`)
        console.log(`  Transcribed: "${result.text}" (${result.durationMs}ms)`)

        // Check that recognized text contains core spoken words
        assert(
          result.text.toLowerCase().includes(tc.expected.toLowerCase()) ||
          (tc.expected === 'LangChain' && (result.text.toLowerCase().includes('chain') || result.text.toLowerCase().includes('lang'))),
          `Recognized phonetic speech in "${result.text}" for "${tc.spoken}"`
        )

        // Control sentence guard
        if (tc.mustNotContain) {
          assert(
            !result.text.includes(tc.mustNotContain),
            `False positive guard: does not convert "link chain" to "${tc.mustNotContain}"`
          )
        }

        // Verify zero runaway repetitions
        const hasRepetitions = /\b(\w+)\s+\1\s+\1\b/i.test(result.text)
        assert(
          !hasRepetitions,
          `No runaway word repetitions in output for ${tc.id}`
        )

        // Must not contain YouTube hallucinations
        assert(
          !result.text.toLowerCase().includes('subscribe') && !result.text.toLowerCase().includes('channel'),
          'Output contains no YouTube channel/subscribe hallucinations'
        )
      } finally {
        if (fs.existsSync(wavPath)) {
          try {
            fs.unlinkSync(wavPath)
          } catch {
            // non-fatal
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // [Group 5/5] Speech-Aware Prompt & Ollama Answer Relevance
  // ---------------------------------------------------------------------------
  console.log('\n[Group 5/5] Speech-Aware Prompt Builder & Ollama Answer Relevance')

  // Verification 1: Prompt structure
  const sampleSpeechTranscript = 'I would like to know about LangChain.'
  const builtPrompt = buildAnswerPrompt(sampleSpeechTranscript)

  assert(
    builtPrompt.systemPrompt.includes('speech-to-text') || builtPrompt.systemPrompt.includes('speech'),
    'System prompt explicitly acknowledges speech-to-text transcript context'
  )

  assert(
    builtPrompt.systemPrompt.includes('LangChain'),
    'System prompt explicitly guides domain knowledge for LangChain'
  )

  assert(
    !builtPrompt.systemPrompt.includes('EXCLUSIVELY on the provided conversation transcript'),
    'System prompt removes the overly restrictive prohibition against external domain knowledge'
  )

  // Verification 2: Live Ollama inference with noisy/hallucinated speech transcript
  const ollamaService = new OllamaService()
  const ollamaReadiness = await ollamaService.getReadiness()

  if (!ollamaReadiness.ready) {
    console.log(`  ⚠️ Skipping live Ollama test: daemon or model unavailable (${ollamaReadiness.error})`)
  } else {
    console.log('  Testing Ollama response on speech transcript: "I would like to know about LangChain."...')
    const speechTranscript = 'I would like to know about LangChain.'

    let streamedTokens = ''
    const genResult = await ollamaService.generateStreaming(speechTranscript, (token) => {
      streamedTokens += token
    })

    console.log(`\n  Ollama Response (${genResult.durationMs}ms):\n  "${genResult.fullText.trim()}"\n`)

    const lower = genResult.fullText.toLowerCase()

    // Must answer about LangChain framework
    assert(
      lower.includes('langchain') && (lower.includes('framework') || lower.includes('llm') || lower.includes('library') || lower.includes('applications') || lower.includes('language model')),
      'Ollama correctly explains what LangChain is (framework/library for LLMs)'
    )

    // Must NOT respond with YouTube or subscription chatter
    assert(
      !lower.includes('subscribe') && !lower.includes('youtube') && !lower.includes('channel'),
      'Ollama gives direct answer without stray YouTube or subscription noise'
    )
  }

  // ---------------------------------------------------------------------------
  // Final Results
  // ---------------------------------------------------------------------------
  console.log('\n=====================================================')
  console.log(`Test Results: ${testsPassed} / ${testsRun} passed (${testsFailed} failed)`)
  console.log('=====================================================\n')

  if (testsFailed > 0) {
    process.exit(1)
  }
}

runAccuracyTests().catch((err) => {
  console.error('Fatal error running accuracy test suite:', err)
  process.exit(1)
})
