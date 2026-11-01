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

export const DEFAULT_SYSTEM_PROMPT = `You are a professional real-time conversation assistant helping the user during meetings, interviews, or discussions.

Context & Instructions:
1. The conversation transcript is captured from real-time speech-to-text. It may contain occasional phonetic inaccuracies, informal phrasing, or speech-recognition artifacts.
2. Infer the speaker's true question, core topic, or underlying intent from the transcript.
3. Provide a direct, concise, and helpful answer or key talking points that the user can immediately speak or reference. Use your domain knowledge to accurately explain technical concepts (such as LangChain, LLMs, RAG, Python, etc.) when asked.
4. Ignore speech-to-text noise, filler fragments, or stray hallucinations (such as mentions of YouTube channels, subscribing, liking, videos, or outros). Never talk about channels, subscriptions, or video rules; do NOT fabricate facts, and focus purely on answering the actual conversational question or topic.
5. If the transcript is genuinely unintelligible or lacks any clear question or topic, formulate one brief, polite clarifying question instead of guessing.
6. Keep your answer brief, crisp, and conversational (typically 2 to 4 sentences). Avoid preambles, meta-commentary, or repetitive filler phrases.`

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

  const userPrompt = `Below is the live meeting/conversation transcript recorded via speech recognition:

--- BEGIN TRANSCRIPT ---
${boundedTranscript}
--- END TRANSCRIPT ---

Based on the conversation transcript above, infer the speaker's true question or intent (ignoring any transcription noise or stray artifacts) and provide a direct, concise, and helpful response.`

  return {
    systemPrompt: options.assistantRole || DEFAULT_SYSTEM_PROMPT,
    userPrompt,
    rawTranscript: cleaned,
    truncated,
  }
}
