export interface PromptOptions {
  maxTranscriptChars?: number
  assistantRole?: string
}

export interface BuiltPrompt {
  systemPrompt: string
  userPrompt: string
  rawTranscript: string
  truncated: boolean
}

const DEFAULT_SYSTEM_PROMPT = `You are a professional, real-time conversation assistant helping the user during meetings, interviews, or discussions.

Strict Instructions:
1. Base your response EXCLUSIVELY on the provided conversation transcript.
2. Provide a concise, direct, and actionable suggested answer, response, or key talking point that the user can immediately use.
3. Do NOT fabricate facts, cite external knowledge, or assume experience or qualifications that are not explicitly stated in the transcript.
4. If the context in the transcript is insufficient, unclear, or incomplete, acknowledge the uncertainty directly and formulate a brief, polite clarifying question instead of guessing.
5. Keep your answer brief, crisp, and conversational (typically 2 to 4 sentences). Avoid preambles, meta-commentary, or repetitive filler phrases.`

/**
 * Builds a validated, structured prompt for Ollama based on untrusted conversation transcript input.
 *
 * @throws Error if transcript is empty or contains only whitespace.
 */
export function buildAnswerPrompt(
  transcript: string,
  options: PromptOptions = {}
): BuiltPrompt {
  const maxChars = options.maxTranscriptChars ?? 12000

  if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
    throw new Error('Cannot generate answer: conversation transcript is empty. Please provide or record speech first.')
  }

  const cleaned = transcript.trim()
  let truncated = false
  let boundedTranscript = cleaned

  if (cleaned.length > maxChars) {
    // Preserve the most recent context from the end of the transcript
    boundedTranscript = '...[earlier context truncated]...\n' + cleaned.slice(cleaned.length - maxChars)
    truncated = true
  }

  const userPrompt = `Below is the live meeting/conversation transcript recorded so far:

--- BEGIN TRANSCRIPT ---
${boundedTranscript}
--- END TRANSCRIPT ---

Based solely on the transcript above, provide the most relevant, direct, and helpful answer or response.`

  return {
    systemPrompt: options.assistantRole || DEFAULT_SYSTEM_PROMPT,
    userPrompt,
    rawTranscript: cleaned,
    truncated,
  }
}

