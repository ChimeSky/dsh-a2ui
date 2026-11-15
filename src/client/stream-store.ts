/**
 * Live tool-argument observation.
 *
 * The browser's `tool.call.toolview` receives a `PreparingToolCall`, whose
 * documented argument reader (`PartialArguments`) exposes *top-level* fields
 * only: a nested `messages` array cannot be read until it closes, so a preparing
 * view has no characters to render. The raw fragments do exist, however, in the
 * `assistant/live-chunk` stream — and a Conversation Context is the supported way
 * for a plugin to see an event: registering a Definition with **no view target**
 * keeps the state machine (and therefore nothing) out of the transcript.
 *
 * This module is exactly that: a state-only Definition that copies each
 * `tool-call-delta` into one small store keyed by call id, plus the React binding
 * the tool view reads during the preparing stage. The store is the *only* place
 * the plugin keeps data that is not derivable from the session log, so it is
 * bounded (per call and by age) and never persisted.
 */
import { isPlainObject } from '../shared/json.js'

/** Longest argument text kept per call. */
export const MAX_STREAM_CHARS = 256 * 1024

/** How long an unused entry is kept before the next append prunes it. */
export const MAX_STREAM_AGE_MS = 120_000

interface StreamEntry {
  text: string
  updatedAt: number
  truncated: boolean
}

const entries = new Map<string, StreamEntry>()
const listeners = new Set<() => void>()

let pendingNotify = false
let timer: ReturnType<typeof setTimeout> | undefined
let clock = (): number => Date.now()

/** Replace the clock (tests only). */
export function setStreamClock(now: () => number): void {
  clock = now
}

function notifyNow(): void {
  pendingNotify = false
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // A broken listener must not stop the others, and this runs inside the
      // conversation engine's publication loop.
    }
  }
}

/** Coalesce notifications to one per animation frame. */
function scheduleNotify(): void {
  if (pendingNotify) return
  pendingNotify = true
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(notifyNow)
    return
  }
  if (typeof setTimeout === 'function') {
    timer = setTimeout(notifyNow, 16)
    return
  }
  // A host without a scheduler (a static render harness): publish at once.
  notifyNow()
}

/** Run pending notifications now (used by tests and by a manual flush). */
export function flushStreamNotifications(): void {
  if (timer !== undefined && typeof clearTimeout === 'function') {
    clearTimeout(timer)
    timer = undefined
  }
  if (pendingNotify) notifyNow()
}

/** Subscribe to any call's streamed text changing. */
export function subscribeStream(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Argument text received so far for one call. */
export function streamTextFor(callId: string | undefined): string | undefined {
  if (callId === undefined || callId === '') return undefined
  return entries.get(callId)?.text
}

/** Whether the kept text was cut off at {@link MAX_STREAM_CHARS}. */
export function streamTruncatedFor(callId: string | undefined): boolean {
  if (callId === undefined || callId === '') return false
  return entries.get(callId)?.truncated === true
}

function prune(now: number): void {
  for (const [callId, entry] of entries) {
    if (now - entry.updatedAt > MAX_STREAM_AGE_MS) entries.delete(callId)
  }
}

function append(callId: string, delta: string): void {
  if (callId === '' || delta === '') return
  const now = clock()
  prune(now)
  const previous = entries.get(callId)
  const room = MAX_STREAM_CHARS - (previous?.text.length ?? 0)
  if (previous?.truncated === true || room <= 0) {
    if (previous !== undefined) previous.updatedAt = now
    return
  }
  const text = (previous?.text ?? '') + (delta.length <= room ? delta : delta.slice(0, room))
  entries.set(callId, { text, updatedAt: now, truncated: delta.length > room })
  scheduleNotify()
}

/** Start or extend one call's argument text. */
export function appendStreamedArguments(callId: string, delta: string): void {
  append(callId, delta)
}

/** Forget one call's text (a settled call has its own `argsRaw`). */
export function dropStreamedArguments(callId: string): void {
  if (entries.delete(callId)) scheduleNotify()
}

/** Reset the store (tests, and a profile switch). */
export function resetStreams(): void {
  if (entries.size === 0) return
  entries.clear()
  scheduleNotify()
}

/** The argument text a Definition state carries; kept tiny on purpose. */
export interface StreamState {
  readonly callId: string
  /** Characters seen, so the engine can tell two states apart cheaply. */
  readonly seen: number
}

/** Minimal shape of the Conversation event this Definition cares about. */
interface StreamEvent {
  readonly type?: string
  readonly data?: { readonly chunk?: unknown }
}

/** Minimal shape of one Conversation match. */
interface StreamMatch {
  readonly event: StreamEvent
}

/** The state-only Conversation Definition that feeds the store. */
export interface StreamDefinition {
  readonly kind: string
  match(event: StreamEvent): { readonly id: string; readonly role: 'start' | 'update' } | null
  start(context: unknown, match: StreamMatch): StreamState
  update(context: { readonly state: StreamState }, match: StreamMatch): StreamState
  publication(match: StreamMatch): 'animation-frame'
}

function readChunk(match: StreamMatch): { callId: string; delta: string } | undefined {
  const chunk = match.event.data?.chunk
  if (!isPlainObject(chunk)) return undefined
  const callId = typeof chunk.id === 'string' ? chunk.id : ''
  if (callId === '') return undefined
  if (chunk.type !== 'tool-call-delta') return undefined
  const delta = chunk.argumentsDelta
  return typeof delta === 'string' ? { callId, delta } : undefined
}

function advance(state: StreamState | undefined, match: StreamMatch): StreamState {
  const chunk = readChunk(match)
  if (chunk === undefined) return state ?? { callId: '', seen: 0 }
  append(chunk.callId, chunk.delta)
  return { callId: chunk.callId, seen: (state?.callId === chunk.callId ? state.seen : 0) + chunk.delta.length }
}

/**
 * Create the Definition that mirrors streaming arguments into the store.
 *
 * `kind` is unique per plugin installation and the Definition declares no view
 * target, so the engine runs it without materialising a Node: the transcript is
 * untouched whatever this observes.
 */
export function createStreamDefinition(): StreamDefinition {
  return {
    kind: 'a2ui-stream',
    match(event: StreamEvent) {
      if (!isPlainObject(event) || event.type !== 'assistant/live-chunk') return null
      const chunk = readChunk({ event })
      return chunk === undefined ? null : { id: chunk.callId, role: 'start' }
    },
    start(_context: unknown, match: StreamMatch) {
      return advance(undefined, match)
    },
    update(context: { readonly state: StreamState }, match: StreamMatch) {
      return advance(context.state, match)
    },
    // Live chunks are already published on the animation-frame cadence by the
    // Assistant Definition; asking for the same cadence means this observation
    // rides that flush instead of forcing a chat publication of its own.
    publication() {
      return 'animation-frame' as const
    },
  }
}
