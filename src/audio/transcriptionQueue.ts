/**
 * Sequential Transcription Queue & Backpressure Controller (Phase 4)
 *
 * Guarantees in-order, non-overlapping transcription execution for incoming audio chunks.
 * Prevents CPU thrashing by ensuring only one Whisper transcription runs at any given moment.
 * Discards stale chunks from superseded recording sessions and limits queue backlog (backpressure).
 */

import { AudioChunkPayload } from './audioRecorder'
import type { TranscriptionChunkResult } from '../types/electron'

export interface TranscriptionQueueOptions {
  /** Maximum number of pending chunks allowed in queue before dropping/backpressure (default: 3) */
  maxQueueDepth?: number
  /** Transcription executor function, typically window.electronApi.transcribeAudioChunk */
  transcribeChunk: (chunk: {
    audioBuffer: Uint8Array
    sessionId: string
    chunkIndex: number
    isFinal?: boolean
  }) => Promise<TranscriptionChunkResult>
  /** Callback invoked when a segment is successfully transcribed */
  onSegment: (segment: {
    text: string
    sessionId: string
    chunkIndex: number
    isFinal?: boolean
    durationMs: number
    isSilent?: boolean
  }) => void
  /** Callback fired on transcription error */
  onError?: (error: Error) => void
  /** Callback fired when queue activity changes */
  onStatusChange?: (status: { pendingCount: number; isProcessing: boolean }) => void
}

export class TranscriptionQueue {
  private queue: AudioChunkPayload[] = []
  private isProcessing = false
  private activeSessionId = ''
  private options: Required<TranscriptionQueueOptions>
  /** Keys (sessionId:chunkIndex) already accepted, so a re-submitted chunk is never transcribed twice. */
  private acceptedKeys = new Set<string>()
  private droppedCount = 0

  constructor(options: TranscriptionQueueOptions) {
    this.options = {
      maxQueueDepth: options.maxQueueDepth ?? 3,
      transcribeChunk: options.transcribeChunk,
      onSegment: options.onSegment,
      onError: options.onError ?? (() => {}),
      onStatusChange: options.onStatusChange ?? (() => {}),
    }
  }

  /**
   * Sets the currently active recording session.
   * Chunks belonging to earlier session IDs will be discarded.
   */
  public setActiveSession(sessionId: string): void {
    if (sessionId !== this.activeSessionId) {
      this.acceptedKeys.clear()
      this.droppedCount = 0
    }
    this.activeSessionId = sessionId
    // Clear out any pending chunks from an older session
    this.queue = this.queue.filter((chunk) => chunk.sessionId === sessionId)
    this.notifyStatus()
  }

  /**
   * Enqueues an audio chunk for sequential transcription.
   */
  public enqueue(chunk: AudioChunkPayload): void {
    // If chunk belongs to a dead/older session, ignore immediately
    if (this.activeSessionId && chunk.sessionId !== this.activeSessionId) {
      return
    }

    // Duplicate prevention: the same (session, chunk) is accepted at most once.
    const key = `${chunk.sessionId}:${chunk.chunkIndex}`
    if (this.acceptedKeys.has(key)) {
      return
    }

    // Skip silent chunks if Whisper doesn't need to transcribe pure silence
    if (chunk.isSilent && !chunk.isFinal) {
      return
    }
    this.acceptedKeys.add(key)

    // Backpressure enforcement: If queue exceeds max depth, drop oldest silent or non-final chunk
    if (this.queue.length >= this.options.maxQueueDepth) {
      const silentIndex = this.queue.findIndex((c) => c.isSilent && !c.isFinal)
      if (silentIndex !== -1) {
        this.queue.splice(silentIndex, 1)
        this.droppedCount++
      } else {
        // Drop the oldest non-final chunk to keep memory bounded and prevent lag accumulation
        const dropIndex = this.queue.findIndex((c) => !c.isFinal)
        if (dropIndex !== -1) {
          this.queue.splice(dropIndex, 1)
          this.droppedCount++
        }
      }
    }

    this.queue.push(chunk)
    this.notifyStatus()
    this.processNext()
  }

  /**
   * Processes the next queued chunk sequentially.
   */
  private async processNext(): Promise<void> {
    if (this.isProcessing) return
    if (this.queue.length === 0) {
      this.notifyStatus()
      return
    }

    const chunk = this.queue.shift()!
    this.isProcessing = true
    this.notifyStatus()

    try {
      // Discard if session changed while in queue
      if (this.activeSessionId && chunk.sessionId !== this.activeSessionId) {
        return
      }

      // If chunk is silent, emit empty segment without calling Whisper
      if (chunk.isSilent) {
        this.options.onSegment({
          text: '',
          sessionId: chunk.sessionId,
          chunkIndex: chunk.chunkIndex,
          isFinal: chunk.isFinal,
          durationMs: 0,
        })
        return
      }

      const result = await this.options.transcribeChunk({
        audioBuffer: chunk.wavBuffer,
        sessionId: chunk.sessionId,
        chunkIndex: chunk.chunkIndex,
        isFinal: chunk.isFinal,
      })

      // Verify session is still active when response returns
      if (!this.activeSessionId || chunk.sessionId === this.activeSessionId) {
        const text = result?.text ? result.text.trim() : ''
        if (text && !result?.isSilent) {
          this.options.onSegment({
            text,
            sessionId: chunk.sessionId,
            chunkIndex: chunk.chunkIndex,
            isFinal: chunk.isFinal,
            durationMs: result.durationMs ?? 0,
            isSilent: Boolean(result?.isSilent),
          })
        }
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.options.onError(error)
    } finally {
      this.isProcessing = false
      this.notifyStatus()
      // Continue draining queue
      this.processNext()
    }
  }

  /**
   * Waits for all currently pending chunks to finish transcription.
   */
  public async drain(timeoutMs = 15000): Promise<void> {
    const startTime = Date.now()
    while ((this.isProcessing || this.queue.length > 0) && Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  /**
   * Empties the queue immediately.
   */
  public clear(): void {
    this.queue = []
    this.notifyStatus()
  }

  private notifyStatus(): void {
    this.options.onStatusChange({
      pendingCount: this.queue.length,
      isProcessing: this.isProcessing,
    })
  }

  /** Number of queued chunks discarded by backpressure in the current session (diagnostics). */
  public getDroppedCount(): number {
    return this.droppedCount
  }

  public getPendingCount(): number {
    return this.queue.length
  }

  public getIsProcessing(): boolean {
    return this.isProcessing
  }
}

