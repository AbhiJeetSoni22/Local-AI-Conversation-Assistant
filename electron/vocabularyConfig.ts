/**
 * Vocabulary & Initial Prompt Configuration for Whisper STT
 *
 * Provides a curated list of technical vocabulary to condition Whisper's
 * decoder context, improving speech recognition accuracy for technical
 * proper nouns and domain terminology without modifying acoustic models.
 * Also provides robust filtering for Whisper acoustic markers and silence hallucinations.
 */

export const DEFAULT_TECHNICAL_VOCABULARY: readonly string[] = [
  'LangChain',
  'LLMs',
  'RAG',
  'Python',
  'React',
  'TypeScript',
] as const

/**
 * Regex matching internal Whisper non-speech acoustic tokens, special markers,
 * and bracketed annotations (e.g. [BLANK_AUDIO], [MUSIC], [APPLAUSE], (applause)).
 */
export const WHISPER_INTERNAL_MARKER_REGEX =
  /\[(BLANK_AUDIO|MUSIC|APPLAUSE|LAUGHTER|LAUGHS|NOISE|SILENCE|WHISPERING|COUGH|COUGHS|SNORT|BELLS?|BEEP|SIGH|GASP|YAWN|THUNDER|SCREAM|CHEERING|GROAN|SINGING|INAUDIBLE|SOBBING|UNKNOWN)\]|\((applause|laughter|music|silence|cheering|coughs?|gasp|sigh|whispering|bell rings?)\)/gi

/**
 * Regex patterns matching common Whisper hallucinations triggered by silence,
 * background hiss, or YouTube training corpus boilerplate.
 */
export const WHISPER_HALLUCINATION_PATTERNS: readonly RegExp[] = [
  /The channel is called\s+[^.!?]+[.!?]?/gi,
  /and if you subscribe[^.!?]*[.!?]?/gi,
  /Importance and the Rule of[^.!?]*[.!?]?/gi,
  /please (like and )?subscribe[^.!?]*[.!?]?/gi,
  /thank you for watching[^.!?]*[.!?]?/gi,
  /thanks for watching[^.!?]*[.!?]?/gi,
  /like,? share,? and subscribe[^.!?]*[.!?]?/gi,
  /don't forget to (like and )?subscribe[^.!?]*[.!?]?/gi,
  /\bhappy\?\s*$/gi,
]

/**
 * Filters out common YouTube boilerplate hallucinations that Whisper decoders
 * produce when processing low-confidence or silent trailing audio.
 */
export function filterHallucinations(text: string): string {
  if (!text) return ''
  let cleaned = text
  for (const pattern of WHISPER_HALLUCINATION_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ')
  }
  return cleaned.replace(/\s+/g, ' ').trim()
}

/**
 * Builds the initial prompt string for Whisper.
 *
 * Rules:
 * 1. If WHISPER_DISABLE_PROMPT is set ('1' or 'true'), returns empty string.
 * 2. If WHISPER_INITIAL_PROMPT is set, returns that custom prompt string.
 * 3. Otherwise, combines DEFAULT_TECHNICAL_VOCABULARY with any extra terms from
 *    WHISPER_EXTRA_VOCABULARY (comma-separated).
 * 4. Bounds the prompt length to 200 tokens / ~800 chars to fit within Whisper's
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

  // Format as natural conversational context to avoid acronym collisions
  let prompt: string
  if (uniqueTerms.length <= 1) {
    prompt = uniqueTerms.join('') + '.'
  } else {
    const last = uniqueTerms[uniqueTerms.length - 1]
    const rest = uniqueTerms.slice(0, -1)
    prompt = `Discussion regarding ${rest.join(', ')}, and ${last}.`
  }

  // Safe truncation ceiling: ~800 characters
  if (prompt.length > 800) {
    return prompt.slice(0, 800).replace(/,[^,]*$/, '.')
  }

  return prompt
}

/**
 * Filters internal Whisper tokens, acoustic annotations, and silence hallucinations
 * from transcribed text. Leaves genuine spoken speech completely intact.
 *
 * Examples:
 * - "[BLANK_AUDIO]" -> ""
 * - "I like LangChain [BLANK_AUDIO]" -> "I like LangChain"
 * - "[MUSIC] Hello world (applause)" -> "Hello world"
 * - "Hello The channel is called LANGCHAIN and if you subscribe it's a..." -> "Hello"
 */
export function filterWhisperMarkers(text: string): string {
  if (!text) return ''

  // 1. Remove internal acoustic markers like [BLANK_AUDIO], (applause)
  let cleaned = text.replace(WHISPER_INTERNAL_MARKER_REGEX, ' ')

  // 2. Remove known silence/low-confidence YouTube boilerplate hallucinations
  cleaned = filterHallucinations(cleaned)

  // 3. Normalize whitespace
  return cleaned.replace(/\s+/g, ' ').trim()
}
