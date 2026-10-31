/**
 * Ollama Unit & Integration Test Suite (Phase 3)
 *
 * Runs deterministic tests for:
 * 1. Configuration resolution and environment variable overrides
 * 2. Prompt builder validation, truncation, and anti-hallucination guarding
 * 3. Health & readiness checks against mock HTTP server (reachable, model missing, offline)
 * 4. Streaming token consumption, accumulation, and error handling
 * 5. Stream cancellation via AbortController
 * 6. Concurrency guards (preventing simultaneous generation requests)
 *
 * Run with:
 *   npx tsx scripts/test-ollama.ts
 *   or: npm run test:ollama
 */

import http from 'node:http'
import { AddressInfo } from 'node:net'
import { getOllamaConfig, checkOllamaHealth } from '../electron/ollamaConfig'
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

// -------------------------------------------------------------------------
// Mock Ollama HTTP Server Helper
// -------------------------------------------------------------------------
interface MockServerState {
  versionStatus: number
  versionPayload: any
  tagsStatus: number
  tagsPayload: any
  chatStatus: number
  chatChunks: string[]
  chatDelayMs?: number
  lastChatRequestBody?: any
}

function createMockOllamaServer(initialState: Partial<MockServerState>): {
  server: http.Server
  state: MockServerState
  getUrl: () => string
  close: () => Promise<void>
} {
  const state: MockServerState = {
    versionStatus: 200,
    versionPayload: { version: '0.5.4' },
    tagsStatus: 200,
    tagsPayload: { models: [{ name: 'qwen2.5:3b' }] },
    chatStatus: 200,
    chatChunks: [
      JSON.stringify({ message: { role: 'assistant', content: 'The key ' }, done: false }) + '\n',
      JSON.stringify({ message: { role: 'assistant', content: 'reason is ' }, done: false }) + '\n',
      JSON.stringify({ message: { role: 'assistant', content: 'complete privacy and zero latency.' }, done: true }) + '\n',
    ],
    chatDelayMs: 0,
    ...initialState,
  }

  const server = http.createServer((req, res) => {
    const url = req.url || ''

    if (url === '/api/version' && req.method === 'GET') {
      res.writeHead(state.versionStatus, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(state.versionPayload))
      return
    }

    if (url === '/api/tags' && req.method === 'GET') {
      res.writeHead(state.tagsStatus, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(state.tagsPayload))
      return
    }

    if (url === '/api/chat' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', async () => {
        try {
          state.lastChatRequestBody = JSON.parse(body)
        } catch {
          state.lastChatRequestBody = body
        }

        if (state.chatStatus !== 200) {
          res.writeHead(state.chatStatus, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error in mock' }))
          return
        }

        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson',
          'Transfer-Encoding': 'chunked',
        })

        for (const chunk of state.chatChunks) {
          if (state.chatDelayMs && state.chatDelayMs > 0) {
            await new Promise((r) => setTimeout(r, state.chatDelayMs))
          }
          if (res.writableEnded || res.destroyed) break
          res.write(chunk)
        }
        res.end()
      })
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found in mock' }))
  })

  return {
    server,
    state,
    getUrl: () => {
      const addr = server.address() as AddressInfo
      return `http://127.0.0.1:${addr.port}`
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

// -------------------------------------------------------------------------
// Test Suite Execution
// -------------------------------------------------------------------------
async function runTests(): Promise<void> {
  console.log('=====================================================')
  console.log('   Ollama & Prompt Builder Test Suite (Phase 3)')
  console.log('=====================================================\n')

  // -----------------------------------------------------------------------
  // Group 1: Configuration Tests
  // -----------------------------------------------------------------------
  console.log('[Group 1/4] Ollama Configuration Resolution')

  const defaultConfig = getOllamaConfig()
  assert(
    defaultConfig.baseUrl === 'http://127.0.0.1:11434',
    'Default baseUrl is http://127.0.0.1:11434',
    `Got ${defaultConfig.baseUrl}`
  )
  assert(
    defaultConfig.model === 'qwen2.5:3b',
    'Default target model is qwen2.5:3b',
    `Got ${defaultConfig.model}`
  )
  assert(
    defaultConfig.timeoutMs === 60000,
    'Default timeout is 60000ms',
    `Got ${defaultConfig.timeoutMs}`
  )
  assert(
    defaultConfig.temperature === 0.7,
    'Default temperature is 0.7',
    `Got ${defaultConfig.temperature}`
  )

  // Test environment variable overrides
  process.env.OLLAMA_HOST = 'http://10.0.0.5:11434/'
  process.env.OLLAMA_MODEL = 'qwen2.5:7b'
  process.env.OLLAMA_TIMEOUT_MS = '90000'

  const envConfig = getOllamaConfig()
  assert(
    envConfig.baseUrl === 'http://10.0.0.5:11434',
    'Base URL respects OLLAMA_HOST and trims trailing slash',
    `Got ${envConfig.baseUrl}`
  )
  assert(
    envConfig.model === 'qwen2.5:7b',
    'Target model respects OLLAMA_MODEL override',
    `Got ${envConfig.model}`
  )
  assert(
    envConfig.timeoutMs === 90000,
    'Timeout respects OLLAMA_TIMEOUT_MS override',
    `Got ${envConfig.timeoutMs}`
  )

  // Reset env
  delete process.env.OLLAMA_HOST
  delete process.env.OLLAMA_MODEL
  delete process.env.OLLAMA_TIMEOUT_MS

  // -----------------------------------------------------------------------
  // Group 2: Prompt Builder Tests
  // -----------------------------------------------------------------------
  console.log('\n[Group 2/4] Prompt Builder Validation & Anti-Hallucination Framing')

  // Test empty transcript rejection
  let emptyThrows = false
  try {
    buildAnswerPrompt('')
  } catch (err) {
    emptyThrows = true
  }
  assert(emptyThrows, 'Empty transcript throws validation error')

  let whitespaceThrows = false
  try {
    buildAnswerPrompt('    \n\t  ')
  } catch (err) {
    whitespaceThrows = true
  }
  assert(whitespaceThrows, 'Whitespace-only transcript throws validation error')

  // Valid prompt structure
  const sampleTranscript = 'Speaker: How do we achieve zero-cost local LLM inference?'
  const built = buildAnswerPrompt(sampleTranscript)
  assert(
    built.systemPrompt.includes('Base your response EXCLUSIVELY on the provided conversation transcript'),
    'System prompt enforces strict grounding in transcript'
  )
  assert(
    built.systemPrompt.includes('Do NOT fabricate facts'),
    'System prompt contains explicit anti-hallucination constraint'
  )
  assert(
    built.userPrompt.includes('--- BEGIN TRANSCRIPT ---') &&
      built.userPrompt.includes(sampleTranscript) &&
      built.userPrompt.includes('--- END TRANSCRIPT ---'),
    'User prompt wraps transcript in clear context boundaries'
  )
  assert(!built.truncated, 'Normal transcript length is not truncated')

  // Context truncation test
  const hugeTranscript = 'A'.repeat(15000)
  const truncatedBuilt = buildAnswerPrompt(hugeTranscript, { maxTranscriptChars: 5000 })
  assert(truncatedBuilt.truncated, 'Oversized transcript marks truncated=true')
  assert(
    truncatedBuilt.userPrompt.includes('...[earlier context truncated]...'),
    'Truncated prompt includes contextual truncation notice'
  )
  assert(
    truncatedBuilt.userPrompt.length < 10000,
    'Truncated prompt length stays within bounded limit'
  )

  // Custom role override
  const customRole = 'You are a technical interviewer assistant.'
  const customBuilt = buildAnswerPrompt(sampleTranscript, { assistantRole: customRole })
  assert(customBuilt.systemPrompt === customRole, 'Assistant role override is respected')

  // -----------------------------------------------------------------------
  // Group 3: Health & Readiness Probing (Mock HTTP)
  // -----------------------------------------------------------------------
  console.log('\n[Group 3/4] Ollama Health Probing & Model Matching')

  // 1. Unreachable endpoint test
  const unreachableConfig = getOllamaConfig({ baseUrl: 'http://127.0.0.1:65530' })
  const unreachableStatus = await checkOllamaHealth(unreachableConfig)
  assert(
    !unreachableStatus.ready && !unreachableStatus.serviceReachable && unreachableStatus.status === 'Unavailable',
    'Unreachable daemon reports ready=false and status=Unavailable without uncaught exceptions'
  )
  assert(
    unreachableStatus.error !== undefined && unreachableStatus.error.includes('unreachable'),
    'Unreachable daemon provides actionable error message'
  )

  // 2. Mock daemon setup
  const mock = createMockOllamaServer({})
  await new Promise<void>((resolve) => mock.server.listen(0, '127.0.0.1', () => resolve()))
  const mockUrl = mock.getUrl()

  try {
    // 3. Healthy daemon with matching model
    const healthyConfig = getOllamaConfig({ baseUrl: mockUrl, model: 'qwen2.5:3b' })
    const healthyStatus = await checkOllamaHealth(healthyConfig)
    assert(
      healthyStatus.ready && healthyStatus.serviceReachable && healthyStatus.modelAvailable && healthyStatus.status === 'Ready',
      'Reachable daemon with target model reports Ready'
    )
    assert(healthyStatus.version === '0.5.4', 'Readiness reports correct daemon version string')

    // 4. Healthy daemon missing requested model
    mock.state.tagsPayload = { models: [{ name: 'llama3.2:1b' }, { name: 'mistral:latest' }] }
    const missingModelStatus = await checkOllamaHealth(healthyConfig)
    assert(
      !missingModelStatus.ready && missingModelStatus.serviceReachable && !missingModelStatus.modelAvailable,
      'Reachable daemon without target model reports ready=false with modelAvailable=false'
    )
    assert(
      missingModelStatus.error !== undefined && missingModelStatus.error.includes('ollama pull qwen2.5:3b'),
      'Missing model error gives exact command to pull model'
    )

    // 5. Version endpoint returning HTTP 500
    mock.state.versionStatus = 500
    const serverErrorStatus = await checkOllamaHealth(healthyConfig)
    assert(
      !serverErrorStatus.ready && !serverErrorStatus.serviceReachable,
      'Daemon returning HTTP 500 on /api/version reports serviceReachable=false'
    )
  } finally {
    await mock.close()
  }

  // -----------------------------------------------------------------------
  // Group 4: Streaming Generation & Cancellation (Mock HTTP)
  // -----------------------------------------------------------------------
  console.log('\n[Group 4/4] Streaming Generation, NDJSON Parsing & Cancellation')

  const streamMock = createMockOllamaServer({
    tagsPayload: { models: [{ name: 'qwen2.5:3b' }] },
  })
  await new Promise<void>((resolve) => streamMock.server.listen(0, '127.0.0.1', () => resolve()))

  try {
    const service = new OllamaService({
      baseUrl: streamMock.getUrl(),
      model: 'qwen2.5:3b',
      timeoutMs: 5000,
    })

    // Test successful stream accumulation
    const chunksReceived: string[] = []
    const genResult = await service.generateStreaming('User: Why local LLMs?', (chunk) => {
      chunksReceived.push(chunk)
    })

    assert(
      chunksReceived.length === 3,
      'Received 3 token chunks progressively from streaming NDJSON',
      `Got ${chunksReceived.length} chunks`
    )
    assert(
      genResult.fullText === 'The key reason is complete privacy and zero latency.',
      'Accumulated fullText matches combined stream chunks',
      `Got "${genResult.fullText}"`
    )
    assert(!genResult.isCancelled, 'Normal generation finishes with isCancelled=false')
    assert(genResult.durationMs >= 0, 'durationMs is recorded accurately')
    assert(
      streamMock.state.lastChatRequestBody?.model === 'qwen2.5:3b',
      'Request payload transmitted target model identifier'
    )
    assert(
      Array.isArray(streamMock.state.lastChatRequestBody?.messages) &&
        streamMock.state.lastChatRequestBody.messages.length === 2,
      'Request payload transmitted both system and user prompt messages'
    )

    // Test concurrency guard
    streamMock.state.chatDelayMs = 200
    const firstPromise = service.generateStreaming('First query', () => {})

    let secondRejected = false
    try {
      await service.generateStreaming('Second simultaneous query', () => {})
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('already in progress')) {
        secondRejected = true
      }
    }
    assert(secondRejected, 'Concurrent generation attempt is rejected with descriptive error')

    // Wait for first to complete
    await firstPromise
    streamMock.state.chatDelayMs = 0

    // Test cancellation
    streamMock.state.chatDelayMs = 300
    const cancelPromise = service.generateStreaming('Query to be cancelled', () => {})
    // Give it 50ms to start, then trigger cancel
    await new Promise((r) => setTimeout(r, 50))
    service.cancel()

    const cancelResult = await cancelPromise
    assert(cancelResult.isCancelled === true, 'service.cancel() successfully aborts active stream and returns isCancelled=true')
    assert(!service.isGenerating(), 'service.isGenerating() returns false after cancellation')

    // Test Ollama server stream error handling
    streamMock.state.chatDelayMs = 0
    streamMock.state.chatChunks = [
      JSON.stringify({ error: 'CUDA out of memory error' }) + '\n',
    ]

    let streamErrorCaught = false
    try {
      await service.generateStreaming('Query causing CUDA error', () => {})
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('CUDA out of memory')) {
        streamErrorCaught = true
      }
    }
    assert(streamErrorCaught, 'In-stream error payload from Ollama throws descriptive error')

    // Test malformed JSON chunk
    streamMock.state.chatChunks = ['NOT_VALID_JSON\n']
    let malformedCaught = false
    try {
      await service.generateStreaming('Query with malformed response', () => {})
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Malformed stream chunk')) {
        malformedCaught = true
      }
    }
    assert(malformedCaught, 'Malformed non-JSON stream chunk throws descriptive error')

    // Test clean disposal
    service.dispose()
    assert(!service.isGenerating(), 'service.dispose() cleanly resets state')
  } finally {
    await streamMock.close()
  }

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
  console.error('Fatal test runner error:', err)
  process.exit(1)
})

