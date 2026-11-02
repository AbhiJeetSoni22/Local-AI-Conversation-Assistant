/**
 * Vocabulary & Initial Prompt Configuration for Whisper STT
 *
 * Provides a curated list of technical vocabulary to condition Whisper's
 * decoder context. The prompt is an OPTIONAL experiment and is OFF by default
 * (see getWhisperConfig / WHISPER_USE_VOCAB_PROMPT): a prompt is injected into the only decode
 * window of every chunk, so a poor prompt biases every chunk. Enable it only after measuring
 * (npm run diagnose:whisper).
 *
 * Also provides non-destructive cleaning of Whisper output: internal annotation markers are
 * stripped and a decoder repetition loop is trimmed. Spoken content is never rewritten or replaced.
 */

export const DEFAULT_TECHNICAL_VOCABULARY: readonly string[] = [
  'React',
  'FastAPI',
  'PostgreSQL',
  'Retrieval-Augmented Generation',
  'RAG',
  'LangChain',
  'API endpoints',
  'Postman',
  'Docker',
  'NGINX',
  'LLMs',
  'Python',
  'TypeScript',
] as const

/**
 * Non-speech annotations that whisper.cpp / Whisper emit instead of words. Spoken words are never wrapped
 * in square brackets by the decoder, so any short [bracketed] span is an annotation ([BLANK_AUDIO],
 * [ Silence ], [MUSIC], [inaudible] ...). Parenthesised spans are only removed when they describe a
 * sound ((applause), (whirring), (door closes)), so real parenthetical speech is left alone.
 */
const SOUND_WORDS =
  'music|noise|silence|silent|applause|laugh|laughs|laughter|laughing|cough|coughs|coughing|sigh|sighs|' +
  'gasp|beep|beeps|click|clicks|clicking|whirr|whirring|whir|static|wind|typing|crowd|cheer|cheering|bell|bells|' +
  'rustl|sniff|breath|breathing|inaudible|unintelligible|blank|speaking in|foreign language|door|footsteps|' +
  'engine|thunder|scream|groan|sob|sobbing|whisper|whispering|snort|yawn|singing|ringing|buzz|hum|humming|sound'

export const WHISPER_INTERNAL_MARKER_REGEX = new RegExp(
  '\\[[^\\]\\n]{0,60}\\]' + // [BLANK_AUDIO], [ Silence ], [MUSIC] ...
    '|' +
    '\\((?=[^)\\n]{0,60}\\))[^)\\n]*\\b(?:' + SOUND_WORDS + ')[^)\\n]*\\)' + // (applause), (whirring) ...
    '|' +
    '[\\u266A\\u266B\\u266C]+', // musical notes
  'gi'
)

/**
 * Removes Whisper's non-speech annotations. Does not touch spoken words.
 *
 * Examples:
 * - "[BLANK_AUDIO]" -> ""
 * - "I like LangChain [BLANK_AUDIO]" -> "I like LangChain"
 * - "[MUSIC] Hello world (applause)" -> "Hello world"
 * - "Is the customer happy?" -> "Is the customer happy?"   (unchanged)
 */
export function filterWhisperMarkers(text: string): string {
  if (!text) return ''
  return text.replace(WHISPER_INTERNAL_MARKER_REGEX, ' ').replace(/\s+/g, ' ').trim()
}

export interface RepetitionGuardOptions {
  /** A single word repeated this many times in a row is treated as a decoder loop (default 8). */
  maxIdenticalWords?: number
  /** A phrase of 2-4 words repeated this many times in a row is treated as a decoder loop (default 5). */
  maxPhraseRepeats?: number
}

export interface RepetitionGuardResult {
  text: string
  /** True if a degenerate loop was detected and trimmed. */
  trimmed: boolean
  /** Number of words removed (diagnostics). */
  removedWords: number
}

function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')
}

/**
 * Trims a decoder repetition loop ("bye bye bye bye bye bye bye bye bye ...") down to ONE occurrence
 * of the looping unit. Greedy decoders can fall into such loops on weak audio; people do not say one
 * word eight times in a row. Thresholds are deliberately high so ordinary emphasis ("no no no no") and
 * counting are untouched, and only the loop itself is trimmed - text before and after is preserved.
 */
export function trimRepetitionLoops(text: string, options: RepetitionGuardOptions = {}): RepetitionGuardResult {
  const maxWords = options.maxIdenticalWords ?? 8
  const maxPhrase = options.maxPhraseRepeats ?? 5
  const words = text.split(/\s+/).filter(Boolean)
  const norm = words.map(normalizeWord)
  const keep: boolean[] = new Array(words.length).fill(true)
  let removed = 0

  // Single-word loops
  for (let i = 0; i < words.length; ) {
    if (!norm[i]) { i++; continue }
    let j = i + 1
    while (j < words.length && norm[j] === norm[i]) j++
    const run = j - i
    if (run >= maxWords) {
      for (let k = i + 1; k < j; k++) keep[k] = false
      removed += run - 1
    }
    i = j
  }

  // Phrase loops (unit length 2..4)
  for (let unit = 2; unit <= 4; unit++) {
    for (let i = 0; i + unit * maxPhrase <= words.length; ) {
      if (!keep[i]) { i++; continue }
      const unitKey = norm.slice(i, i + unit).join(' ')
      if (!unitKey.trim()) { i++; continue }
      let reps = 1
      let j = i + unit
      while (j + unit <= words.length && norm.slice(j, j + unit).join(' ') === unitKey) { reps++; j += unit }
      if (reps >= maxPhrase) {
        for (let k = i + unit; k < j; k++) { if (keep[k]) { keep[k] = false; removed++ } }
        i = j
      } else {
        i++
      }
    }
  }

  if (removed === 0) return { text, trimmed: false, removedWords: 0 }
  return { text: words.filter((_, idx) => keep[idx]).join(' '), trimmed: true, removedWords: removed }
}

export interface CleanedWhisperOutput {
  /** Exactly what Whisper returned (diagnostics only; never shown or logged by default). */
  raw: string
  /** User-facing text: annotations stripped, decoder loops trimmed. */
  text: string
  markersRemoved: boolean
  loopTrimmed: boolean
}

/** Single entry point used by WhisperService. Keeps raw and cleaned text separate. */
export function cleanWhisperOutput(raw: string): CleanedWhisperOutput {
  const rawText = raw ?? ''
  const noMarkers = filterWhisperMarkers(rawText)
  const guarded = trimRepetitionLoops(noMarkers)
  return {
    raw: rawText,
    text: guarded.text,
    markersRemoved: noMarkers !== rawText.replace(/\s+/g, ' ').trim(),
    loopTrimmed: guarded.trimmed,
  }
}

/**
 * Builds the initial prompt string for Whisper.
 *
 * Rules:
 * 1. If WHISPER_DISABLE_PROMPT is set ('1' or 'true'), returns empty string.
 * 2. If WHISPER_INITIAL_PROMPT is set, returns that custom prompt string.
 * 3. Otherwise, combines DEFAULT_TECHNICAL_VOCABULARY with any extra terms from
 *    WHISPER_EXTRA_VOCABULARY (comma-separated).
 * 4. Formats as clean, direct comma-separated terms ending with a period to prime
 *    the dictionary without conversational bias.
 * 5. Bounds the prompt length to 200 tokens / ~800 chars to fit within Whisper's
 *    half text context limit (max n_text_ctx / 2 = 224 tokens for base model).
 */
export function buildInitialPrompt(options?: {
  customPrompt?: string
  extraTerms?: string[]
  disabled?: boolean
}): string {
  // Check disabled flag
  if (
    options?.disabled ||
    process.env.WHISPER_DISABLE_PROMPT === '1' ||
    process.env.WHISPER_DISABLE_PROMPT === 'true'
  ) {
    return ''
  }

  // Check direct prompt override
  const directOverride = options?.customPrompt || process.env.WHISPER_INITIAL_PROMPT
  if (directOverride && directOverride.trim()) {
    return directOverride.trim()
  }

  // Parse extra vocabulary from environment
  const envExtra = process.env.WHISPER_EXTRA_VOCABULARY
    ? process.env.WHISPER_EXTRA_VOCABULARY.split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : []

  const extraTerms = options?.extraTerms || envExtra
  const allTerms = [...DEFAULT_TECHNICAL_VOCABULARY, ...extraTerms]

  // Deduplicate case-insensitively while preserving original casing
  const seen = new Set<string>()
  const uniqueTerms: string[] = []
  for (const term of allTerms) {
    const lower = term.toLowerCase()
    if (!seen.has(lower) && term.length > 0) {
      seen.add(lower)
      uniqueTerms.push(term)
    }
  }

  // Format as clean, non-conversational comma-separated terms ending with period.
  // Direct vocabulary listing primes Whisper's internal dictionary without
  // conversational priming that can induce hallucinated dialogue.
  const prompt = `${uniqueTerms.join(', ')}.`

  // Safe truncation ceiling: ~800 characters
  if (prompt.length > 800) {
    return prompt.slice(0, 800).replace(/,[^,]*$/, '.')
  }

  return prompt
}
