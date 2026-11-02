/**
 * Transcript accumulation helpers (pure; used by App.tsx and unit-tested).
 *
 * The previous implementation skipped a segment whenever the transcript already *ended with the same
 * text*. That silently erased genuine repetition ("yes" ... "yes") while doing nothing about the real
 * duplicate risks. Duplicates are now prevented by segment identity instead of by comparing words:
 *
 *   - a (sessionId, chunkIndex) pair is accepted at most once
 *   - within a session, chunk indexes must strictly increase (late/out-of-order results are ignored)
 *   - segments from a different session than the active one are ignored
 */

export interface SegmentIdentity {
  sessionId: string
  chunkIndex: number
}

export class SegmentGate {
  private sessionId = ''
  private lastIndex = -1

  /** Begin a new recording session; resets the ordering state. */
  public startSession(sessionId: string): void {
    this.sessionId = sessionId
    this.lastIndex = -1
  }

  /** True if this segment should be appended. Records it so the same segment is never accepted twice. */
  public accept(seg: SegmentIdentity): boolean {
    if (seg.sessionId !== this.sessionId) return false
    if (seg.chunkIndex <= this.lastIndex) return false
    this.lastIndex = seg.chunkIndex
    return true
  }
}

/** Appends a segment to the running transcript with single-space separation. Never drops words. */
export function appendSegmentText(previous: string, segmentText: string): string {
  const clean = segmentText.trim()
  if (!clean) return previous
  if (!previous) return clean
  return `${previous} ${clean}`
}
