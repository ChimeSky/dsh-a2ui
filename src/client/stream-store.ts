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
 * Three rules keep this honest:
 *
 * 1. The Definition's own state is the source of truth. It is recomputed from
 *    scratch on every context replay, and the cache is a *replacement* of that
 *    state, never an append to a separate global log — so replaying the same
 *    events twice yields the same prefix instead of a duplicated one.
 * 2. Only calls the host named `a2ui` are collected. A delta that carries no
 *    name is appended only to a call that is already tracked; an unattributed
 *    fragment is never buffered, because it may belong to any tool.
 * 3. The cache is bounded twice (per call, and in total), and an entry is
 *    released as soon as the host settles the call (`tool/call` means the
 *    arguments are complete and `argsRaw` takes over).
 */
import { isPlainObject } from '../shared/json.js'

/** Wire name of the tool whose arguments can be previewed. */
export const STREAM_TOOL_NAME = 'a2ui'

/** Longest argument text kept for one call. */
export const MAX_STREAM_CHARS = 256 * 1024

/** Longest argument text kept across every call in one browser session. */
export const MAX_STREAM_TOTAL_CHARS = 1024 * 1024

/** Most calls kept at once; the oldest entry is evicted beyond this. */
export const MAX_STREAM_ENTRIES = 32

/** How long an untouched entry survives, so a lost `tool/call` still expires. */
export const MAX_STREAM_AGE_MS = 120_000

interface CacheEntry {
  text: string
  updatedAt: number
  truncated: boolean
}

const cache = new Map<string, CacheEntry>()
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

/** Run pending notifications now (used by tests and by the operator). */
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
  return cache.get(callId)?.text
}

/** Whether the kept text was cut off at {@link MAX_STREAM_CHARS}. */
export function streamTruncatedFor(callId: string | undefined): boolean {
  if (callId === undefined || callId === '') return false
  return cache.get(callId)?.truncated === true
}

function totalChars(): number {
  let total = 0
  for (const entry of cache.values()) total += entry.text.length
  return total
}

/** Drop entries that are over the age bound, then the oldest until within size. */
function trim(now: number, keep: string): void {
  for (const [callId, entry] of cache) {
    if (now - entry.updatedAt > MAX_STREAM_AGE_MS) cache.delete(callId)
  }
  while (cache.size > MAX_STREAM_ENTRIES || totalChars() > MAX_STREAM_TOTAL_CHARS) {
    let oldestId: string | undefined
    let oldestAt = Number.POSITIVE_INFINITY
    for (const [callId, entry] of cache) {
      if (callId === keep) continue
      if (entry.updatedAt < oldestAt) {
        oldestAt = entry.updatedAt
        oldestId = callId
      }
    }
    if (oldestId === undefined) break
    cache.delete(oldestId)
  }
}

/**
 * Write one call's text, keeping the cache bounded.
 *
 * A call that is itself larger than the whole-call allowance is dropped rather
 * than allowed to evict every other call: the preview degrades to the skeleton
 * for that one card, which is exactly what a browser without this feature shows.
 */
function publish(callId: string, text: string | undefined, truncated = false): void {
  const now = clock()
  const previous = cache.get(callId)
  if (text === undefined) {
    if (previous === undefined) return
    cache.delete(callId)
    scheduleNotify()
    return
  }
  cache.set(callId, { text, updatedAt: now, truncated })
  trim(now, callId)
  if (!cache.has(callId)) {
    // Over the total bound on its own.
    if (previous !== undefined) scheduleNotify()
    return
  }
  if (previous?.text !== text || previous.truncated !== truncated) scheduleNotify()
}

/** Test hook: append fragments directly, bypassing the Definition. */
export function appendStreamedArguments(callId: string, delta: string): void {
  if (callId === '' || delta === '') return
  const previous = cache.get(callId)
  const room = MAX_STREAM_CHARS - (previous?.text.length ?? 0)
  if (previous?.truncated === true || room <= 0) {
    if (previous !== undefined) previous.updatedAt = clock()
    return
  }
  const text = (previous?.text ?? '') + (delta.length <= room ? delta : delta.slice(0, room))
  publish(callId, text, (previous?.truncated ?? false) || delta.length > room)
}

/** Forget one call's text (a settled call has its own `argsRaw`). */
export function dropStreamedArguments(callId: string): void {
  publish(callId, undefined)
}

/** Reset the whole cache (plugin unload, profile switch, tests). */
export function resetStreams(): void {
  if (cache.size === 0) return
  cache.clear()
  scheduleNotify()
}

/** The argument text one Definition state carries. */
export interface StreamState {
  readonly callId: string
  /** Whether this call was identified as the A2UI tool. */
  readonly tracked: boolean
  readonly text: string
  readonly truncated: boolean
}

const EMPTY_STATE: StreamState = { callId: '', tracked: false, text: '', truncated: false }

/** Minimal shape of the Conversation event this Definition cares about. */
interface StreamEvent {
  readonly type?: string
  readonly data?: { readonly chunk?: unknown; readonly callId?: unknown; readonly name?: unknown; readonly message?: unknown }
}

/** Minimal shape of one Conversation match. */
interface StreamMatch {
  readonly event: StreamEvent
}

/** The state-only Conversation Definition that feeds the cache. */
export interface StreamDefinition {
  readonly kind: string
  match(event: StreamEvent): { readonly id: string; readonly role: 'start' | 'update' } | null
  start(context: unknown, match: StreamMatch): StreamState
  update(context: { readonly state: StreamState }, match: StreamMatch): StreamState
  publication(match: StreamMatch): 'animation-frame'
}

function idOf(value: unknown): string {
  return typeof value === 'string' && value !== '' ? value : ''
}

/** The call a settle event refers to, if the event carries one. */
function settledCallId(event: StreamEvent): string {
  // `tool/call` names its tool, so a foreign call is not even given a context.
  if (event.type === 'tool/call') return event.data?.name === STREAM_TOOL_NAME ? idOf(event.data?.callId) : ''
  if (event.type === 'tool/result') {
    // A result carries no tool name; the release is a keyed delete, so matching
    // every result is harmless and covers a call whose `tool/call` fell outside
    // the loaded window.
    const message = event.data?.message
    if (!isPlainObject(message)) return ''
    const source = message.source
    return isPlainObject(source) ? idOf(source.callId) : ''
  }
  return ''
}

/** One streamed argument fragment. */
interface Delta {
  callId: string
  name?: string
  text: string
}

function deltaOf(event: StreamEvent): Delta | undefined {
  if (event.type !== 'assistant/live-chunk') return undefined
  const chunk = event.data?.chunk
  if (!isPlainObject(chunk)) return undefined
  if (chunk.type !== 'tool-call-delta') return undefined
  const callId = idOf(chunk.id)
  if (callId === '') return undefined
  const text = typeof chunk.argumentsDelta === 'string' ? chunk.argumentsDelta : ''
  return typeof chunk.name === 'string' && chunk.name !== '' ? { callId, name: chunk.name, text } : { callId, text }
}

/**
 * Fold one event into the Definition state.
 *
 * The state owns the text; the cache mirrors it. Replaying the same context from
 * its earliest match therefore *replaces* the text instead of appending to it
 * again.
 */
function advance(previous: StreamState | undefined, match: StreamMatch): StreamState {
  const base = previous ?? EMPTY_STATE
  const settled = settledCallId(match.event)
  if (settled !== '') {
    // The host has the complete arguments: `argsRaw` renders from here on.
    publish(settled, undefined)
    return base.callId === settled ? EMPTY_STATE : base
  }
  const delta = deltaOf(match.event)
  if (delta === undefined) return base
  const sameCall = base.callId === delta.callId
  const tracked = delta.name === undefined ? sameCall && base.tracked : delta.name === STREAM_TOOL_NAME
  if (!tracked) {
    // Unidentified or foreign: keep the decision so later unnamed fragments stay
    // out of the preview instead of being attributed by guesswork.
    return { callId: delta.callId, tracked: false, text: '', truncated: false }
  }
  const room = MAX_STREAM_CHARS - (sameCall ? base.text.length : 0)
  const truncated = sameCall ? base.truncated : false
  if (room <= 0 || truncated) {
    publish(delta.callId, sameCall ? base.text : '', true)
    return { callId: delta.callId, tracked: true, text: sameCall ? base.text : '', truncated: true }
  }
  const text = (sameCall ? base.text : '') + (delta.text.length <= room ? delta.text : delta.text.slice(0, room))
  const overflow = delta.text.length > room
  publish(delta.callId, text, overflow)
  return { callId: delta.callId, tracked: true, text, truncated: overflow }
}

/**
 * Create the Definition that mirrors streaming arguments into the cache.
 *
 * `kind` is unique per installation and the Definition declares no view target,
 * so the engine runs it without materialising a Node: the transcript is
 * untouched whatever this observes.
 */
export function createStreamDefinition(): StreamDefinition {
  return {
    kind: 'a2ui-stream',
    match(event: StreamEvent) {
      if (!isPlainObject(event)) return null
      const delta = deltaOf(event)
      if (delta !== undefined) return { id: delta.callId, role: 'start' }
      const settled = settledCallId(event)
      return settled === '' ? null : { id: settled, role: 'update' }
    },
    start(_context: unknown, match: StreamMatch) {
      return advance(undefined, match)
    },
    update(context: { readonly state: StreamState }, match: StreamMatch) {
      return advance(context.state, match)
    },
    // Live chunks already publish on the animation-frame cadence; asking for the
    // same cadence rides that flush instead of forcing a chat publication.
    publication() {
      return 'animation-frame' as const
    },
  }
}
