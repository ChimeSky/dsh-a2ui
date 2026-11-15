/**
 * The `tool.call.toolview` component for the `a2ui` tool.
 *
 * It turns the tool call's own arguments (or, once settled, the durable `meta`
 * copy) into surfaces, renders them, and routes user actions back to the agent
 * as a normal queued user message. Nothing is persisted in plugin memory: a
 * reopened conversation re-renders from the session log alone, and no action is
 * ever replayed on load.
 */
import * as React from 'react'
import { h } from './h.js'
import type { A2UIComponent, SurfaceState, SurfaceTouch } from '../shared/validate.js'
import { validateToolArguments, applyMessageBatch } from '../shared/validate.js'
import { COMPONENT_BY_NAME } from '../shared/catalog.js'
import type { JsonValue } from '../shared/json.js'
import { interactionFor, modelFor, setInteractionState, stateKey, storeVersion, subscribeStore, writeModel } from './model-store.js'
import type { Violation } from '../shared/schema.js'
import { FUNCTIONS } from '../shared/functions.js'
import { estimateExpansion } from '../shared/budget.js'
import { foldStreaming } from '../shared/stream.js'
import { dropStreamedArguments, subscribeStream, streamTextFor } from './stream-store.js'
import { A2UISurface } from './surface.js'
import type { InteractionState, Scope, SurfaceView } from './context.js'
import { useClaimCopy, useCopyClaimed } from './claims-react.js'
import { resolveValue, type ResolveContext } from '../shared/binding.js'
import { buildAction } from './action.js'

/** What the plugin needs from the browser shell (locale + prompt delivery). */
export interface ClientRuntime {
  t: (key: string) => string
  locale: () => string
  sendPrompt: (sessionId: string, text: string) => Promise<void>
}

interface ToolBlockLike {
  kind?: string
  phase?: string
  callId?: string
  name?: string
  argsRaw?: string
  call?: { name?: string; argsRaw?: string } | null
  content?: unknown
  isError?: boolean
  error?: unknown
  meta?: Record<string, unknown>
  args?: { get?: (key: string) => unknown } | unknown
}

export interface ToolViewProps {
  callId: string
  toolName: string
  phase?: 'preparing' | 'start' | 'result'
  block?: ToolBlockLike
  sessionId?: string
  runtime: ClientRuntime
  /**
   * Which host is rendering: the process row (`row`) or the turn tail (`tail`).
   * A `tail` copy claims itself, and the `row` copy degrades to a one-line
   * pointer only while that claim exists — so the interface can never disappear.
   */
  mode?: 'row' | 'tail'
  /** Force the one-line pointer (used by the render harness). */
  compact?: boolean
}

interface Payload {
  title?: string
  messages: unknown[]
  origin: 'meta' | 'args' | 'none'
  /** Set when the payload could not be read at all. */
  readError?: string
}

function textOfContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const entry of content) {
    if (entry !== null && typeof entry === 'object' && (entry as Record<string, unknown>).type === 'text') {
      const value = (entry as Record<string, unknown>).text
      if (typeof value === 'string') parts.push(value)
    }
  }
  return parts.join('\n')
}

function parseJson(raw: string | undefined): unknown {
  if (raw === undefined || raw.trim() === '') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/** Read the A2UI payload from whichever stage the call is in. */
function readPayload(props: ToolViewProps): Payload {
  const block = props.block
  if (block === undefined) return { messages: [], origin: 'none' }
  const meta = block.meta
  if (meta !== undefined && meta !== null && meta.kind === 'a2ui' && Array.isArray(meta.messages)) {
    return {
      messages: meta.messages as unknown[],
      title: typeof meta.title === 'string' ? meta.title : undefined,
      origin: 'meta',
    }
  }
  const raw = props.phase === 'result' ? block.call?.argsRaw ?? block.argsRaw : block.argsRaw
  const parsed = parseJson(raw)
  if (parsed !== null && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>
    if (Array.isArray(record.messages)) {
      return {
        messages: record.messages,
        title: typeof record.title === 'string' ? record.title : undefined,
        origin: 'args',
      }
    }
  }
  if (meta !== undefined && meta !== null && meta.messagesOmitted === true) {
    return { messages: [], origin: 'none', readError: 'the replay copy was omitted because the payload exceeded the meta budget' }
  }
  return { messages: [], origin: 'none' }
}

interface RenderedSurface {
  state: SurfaceState
  created: boolean
  componentCount: number
}

interface Analysis {
  ok: boolean
  errors: Violation[]
  warnings: string[]
  surfaces: RenderedSurface[]
  updatedOnly: string[]
  deleted: string[]
}

function analyse(payload: Payload): Analysis {
  if (payload.messages.length === 0) {
    return { ok: true, errors: [], warnings: [], surfaces: [], updatedOnly: [], deleted: [] }
  }
  const validation = validateToolArguments({ messages: payload.messages })
  if (!validation.ok) {
    return { ok: false, errors: validation.errors, warnings: validation.warnings, surfaces: [], updatedOnly: [], deleted: [] }
  }
  const folded = applyMessageBatch(new Map<string, SurfaceState>(), validation.messages)
  const surfaces: RenderedSurface[] = []
  const updatedOnly: string[] = []
  const deleted: string[] = []
  for (const touch of folded.touches) {
    const state = folded.surfaces.get(touch.surfaceId)
    if (touch.deleted) {
      deleted.push(touch.surfaceId)
      continue
    }
    if (state === undefined) continue
    if (touch.created) {
      // The Host applies the same budget; re-checking here keeps an old or
      // foreign payload from expanding into a huge tree.
      const estimate = estimateExpansion(state)
      if (estimate.reason !== undefined) {
        return { ok: false, errors: [{ path: `/surfaces/${touch.surfaceId}`, message: estimate.reason }], warnings: validation.warnings, surfaces: [], updatedOnly: [], deleted: [] }
      }
      surfaces.push({ state, created: true, componentCount: state.components.size })
    } else if (touch.changedComponentIds.length > 0 || touch.dataModelChanged) {
      updatedOnly.push(touch.surfaceId)
    }
  }
  return { ok: true, errors: [], warnings: validation.warnings, surfaces, updatedOnly, deleted }
}

function sparkle(className: string): ReturnType<typeof h> {
  return h(
    'span',
    { className, 'aria-hidden': true },
    h(
      'svg',
      { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.35, strokeLinecap: 'round', strokeLinejoin: 'round' },
      h('path', { d: 'M7 1.9l1.4 3.6 3.6 1.4-3.6 1.4L7 11.9 5.6 8.3 2 6.9l3.6-1.4L7 1.9z' }),
      h('path', { d: 'M12.6 10.6l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6.6-1.5z' }),
    ),
  )
}

function Notice(props: { title: string; body?: string; error?: boolean }): ReturnType<typeof h> {
  return h(
    'div',
    { className: `a2ui-notice${props.error === true ? ' a2ui-notice-error' : ''}`, role: props.error === true ? 'alert' : 'status' },
    h('div', null, h('div', { className: 'a2ui-notice-title' }, props.title), props.body === undefined || props.body === '' ? null : h('div', { className: 'a2ui-notice-body' }, props.body)),
  )
}

function formatViolations(errors: Violation[]): string {
  return errors
    .slice(0, 10)
    .map((error) => `${error.path === '' ? 'arguments' : error.path}: ${error.message}`)
    .join('\n')
}

/**
 * Read the argument characters a preparing call has already streamed.
 *
 * Subscribed only while the call is being prepared, so a settled card costs
 * nothing. The snapshot is a plain string, which keeps
 * `useSyncExternalStore` from re-rendering on equal text.
 */
function useStreamedArguments(callId: string | undefined): string | undefined {
  const read = React.useCallback(() => (callId === undefined ? undefined : streamTextFor(callId)), [callId])
  // The same read serves server rendering: the tool view is only ever mounted in
  // a browser, but a static harness must see exactly what the browser would.
  return React.useSyncExternalStore(subscribeStream, read, read)
}

/** Placeholder body shown until the first component (and its root) arrives. */
function Skeleton(): ReturnType<typeof h> {
  return h(
    'div',
    { className: 'a2ui-skel', 'aria-hidden': true },
    h('span', { className: 'a2ui-skel-line a2ui-skel-w70' }),
    h('span', { className: 'a2ui-skel-line a2ui-skel-w92' }),
    h('span', { className: 'a2ui-skel-line a2ui-skel-w60' }),
    h('span', { className: 'a2ui-skel-block' }),
  )
}

/**
 * Preview-only error boundary.
 *
 * The streaming fold validates every closed component, so a preview should never
 * throw; this is the backstop that keeps a slip in one renderer from blanking the
 * whole slot. It is deliberately *not* wrapped around the settled card: a real
 * result must keep surfacing its own errors.
 *
 * The class is created on first render rather than at module load, so merely
 * loading the bundle never depends on `React.Component` being present.
 */
interface PreviewBoundaryProps {
  readonly text: string
  readonly children?: unknown
}

type PreviewBoundaryType = new (props: PreviewBoundaryProps) => React.Component<PreviewBoundaryProps, { failed: boolean }>

let previewBoundaryType: PreviewBoundaryType | undefined

function previewBoundary(): PreviewBoundaryType {
  if (previewBoundaryType !== undefined) return previewBoundaryType
  class PreviewBoundary extends React.Component<PreviewBoundaryProps, { failed: boolean }> {
    override state = { failed: false }

    static getDerivedStateFromError(): { failed: boolean } {
      return { failed: true }
    }

    override componentDidUpdate(previous: PreviewBoundaryProps): void {
      // A new fragment may well fix whatever threw: recover instead of staying
      // blank for the rest of the call.
      if (this.state.failed && previous.text !== this.props.text) this.setState({ failed: false })
    }

    override render(): React.ReactNode {
      return this.state.failed ? Skeleton() : (this.props.children as React.ReactNode)
    }
  }
  previewBoundaryType = PreviewBoundary as unknown as PreviewBoundaryType
  return previewBoundaryType
}

/** Props of the card drawn while the arguments are still arriving. */
interface StreamingCardProps {
  callId: string
  title: string
  surfaces: readonly SurfaceState[]
  text: string
  locale: string
  now: number
  t: (key: string) => string
}

/**
 * The card shown during `preparing`.
 *
 * Its body is inert: the preview renders unvalidated components, so Tab, Enter,
 * Space and the mouse must not reach a control before the call settles. `inert`
 * is set through the DOM because React 18 does not type it; a host that rejects
 * the attribute simply loses the extra guard, since submit/write are also stubs
 * here and the settled card is what can actually act.
 */
function StreamingCard(props: StreamingCardProps): ReturnType<typeof h> {
  const bodyRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    const node = bodyRef.current
    if (node === null) return undefined
    node.setAttribute('inert', '')
    return () => node.removeAttribute('inert')
  }, [])

  const view = (state: SurfaceState): SurfaceView => ({
    surfaceId: state.surfaceId,
    callId: props.callId,
    state,
    // The streamed data model is authoritative for this frame; edits and actions
    // belong to the settled card.
    model: state.dataModel,
    locale: props.locale,
    now: props.now,
    interaction: { state: 'idle' },
    t: props.t,
    streaming: true,
    setValue: () => {},
    submit: () => {},
    runLocal: () => {},
  })

  const bodies: Array<ReturnType<typeof h>> =
    props.surfaces.length === 0
      ? [h('div', { key: 'skeleton', className: 'a2ui-stack' }, Skeleton())]
      : props.surfaces.map((state) =>
          h(
            'div',
            { key: state.surfaceId, className: 'a2ui-stack' },
            props.surfaces.length > 1 ? h('span', { className: 'a2ui-caption' }, state.surfaceId) : null,
            h(A2UISurface, { view: view(state) }),
          ),
        )

  return h(
    'div',
    { className: 'a2ui-root' },
    h(
      'div',
      { className: 'a2ui-card a2ui-card-streaming', 'aria-busy': true },
      h(
        'div',
        { className: 'a2ui-card-head' },
        sparkle('a2ui-card-spark'),
        h('span', { className: 'a2ui-card-title' }, props.title),
        h('span', { className: 'a2ui-card-state' }, props.t('streaming')),
      ),
      h(
        'div',
        { className: 'a2ui-card-body', ref: bodyRef },
        h(previewBoundary(), { text: props.text }, h('div', { className: 'a2ui-stack' }, ...bodies)),
      ),
    ),
  )
}

/** Build the user message that carries an A2UI action to the agent. */
export { formatActionPrompt } from './action.js'

function openExternal(url: string): void {
  if (!/^https?:\/\//iu.test(url)) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Render one `a2ui` tool call.
 *
 * A tool call is a self-contained surface snapshot: the renderer folds that
 * call's messages only, which keeps rendering deterministic and replay-safe.
 * Cross-call updates therefore arrive as a later card (see README, "Known
 * limitations").
 */
export function A2UIToolView(props: ToolViewProps): ReturnType<typeof h> {
  const { runtime, sessionId } = props
  const mode = props.mode ?? 'row'
  const t = runtime.t
  const payload = React.useMemo(() => readPayload(props), [props.block, props.phase])
  const analysis = React.useMemo(() => analyse(payload), [payload])
  const now = React.useMemo(() => Date.now(), [props.callId])

  // While the call is being prepared the arguments arrive as raw fragments, so
  // the card is drawn from what has already closed (see `shared/stream.ts`).
  const preparing = props.phase === 'preparing'
  const streamedText = useStreamedArguments(preparing ? props.callId : undefined)
  const streamed = React.useMemo(
    () => (streamedText === undefined || streamedText === '' ? undefined : foldStreaming(streamedText)),
    [streamedText],
  )

  // Once the call settles its own `argsRaw` is authoritative, so the fragment
  // copy is released immediately instead of waiting for the age bound.
  React.useEffect(() => {
    if (preparing) return
    dropStreamedArguments(props.callId)
  }, [preparing, props.callId])

  // The tail copy claims the call; the row copy steps aside only while that
  // claim is held, and automatically restores the card when the tail unmounts.
  const claimedElsewhere = useCopyClaimed(sessionId, props.callId)
  useClaimCopy(sessionId, props.callId, mode === 'tail')
  const compact = props.compact ?? (mode === 'row' && claimedElsewhere && props.phase === 'result')

  // Edits and action state live in a store keyed by session + call + surface, so
  // the row and the turn tail show the same values when the card changes hands.
  React.useSyncExternalStore(subscribeStore, storeVersion, storeVersion)
  /** One in-flight send per (surface, component): a double click enqueues once. */
  const inFlight = React.useRef<Set<string>>(new Set())
  const keyFor = React.useCallback((surfaceId: string) => stateKey(sessionId, props.callId, surfaceId), [sessionId, props.callId])

  const locale = runtime.locale()
  const isErrorResult = props.phase === 'result' && props.block?.isError === true
  const errorText = isErrorResult ? textOfContent(props.block?.content) : ''

  const setValue = React.useCallback(
    (surfaceId: string, pointer: string, value: JsonValue) => {
      writeModel(keyFor(surfaceId), pointer, value)
    },
    [keyFor],
  )

  const setInteraction = React.useCallback(
    (surfaceId: string, state: InteractionState) => {
      setInteractionState(keyFor(surfaceId), state)
    },
    [keyFor],
  )

  const submit = React.useCallback(
    (
      surfaceId: string,
      scope: Scope,
      component: A2UIComponent,
      name: string,
      contextSpec: Record<string, unknown>,
      userMessage?: string,
    ) => {
      if (sessionId === undefined) {
        setInteraction(surfaceId, { state: 'error', message: t('sendFailed') })
        return
      }
      const requestKey = `${surfaceId}\u0000${component.id}`
      if (inFlight.current.has(requestKey)) return
      inFlight.current.add(requestKey)
      // The scope carries the template row, so a row button resolves its own item.
      const outcome = buildAction({
        surfaceId,
        component,
        name,
        contextSpec,
        dataModel: modelFor(keyFor(surfaceId), {}),
        item: scope.item,
        index: scope.index,
        locale,
        now: Date.now(),
        userMessage,
      })
      if (outcome.kind === 'refused') {
        inFlight.current.delete(requestKey)
        setInteraction(surfaceId, outcome.state)
        return
      }
      setInteraction(surfaceId, { state: 'sending' })
      void runtime
        .sendPrompt(sessionId, outcome.text)
        .then(() => {
          setInteraction(surfaceId, { state: 'sent' })
        })
        .catch((cause: unknown) => {
          // A failed send becomes editable again so the user can retry.
          inFlight.current.delete(requestKey)
          const message = cause instanceof Error ? cause.message : String(cause)
          setInteraction(surfaceId, { state: 'error', message })
        })
    },
    [keyFor, locale, runtime, sessionId, setInteraction, t],
  )

  const runLocal = React.useCallback(
    (surfaceId: string, scope: Scope, component: A2UIComponent, call: unknown) => {
      const resolveContext: ResolveContext = {
        dataModel: modelFor(keyFor(surfaceId), {}),
        item: scope.item,
        index: scope.index,
        locale,
        now: Date.now(),
      }
      const record = call as Record<string, unknown>
      const name = (record['@call'] ?? record.call) as string | undefined
      if (name === undefined) return
      const result = resolveValue(call, resolveContext)
      if (result !== null && typeof result === 'object' && '__a2uiOpenUrl' in (result as object)) {
        openExternal(String((result as Record<string, unknown>).__a2uiOpenUrl))
        return
      }
      if (name === 'openUrl') return
      // Any other local function only affects local state, which the data model
      // already owns; there is nothing further to do.
      void component
      void FUNCTIONS
    },
    [keyFor, locale],
  )

  const makeView = (surface: SurfaceState): SurfaceView => ({
    surfaceId: surface.surfaceId,
    callId: props.callId,
    state: surface,
    model: modelFor(keyFor(surface.surfaceId), surface.dataModel),
    locale,
    now,
    interaction: interactionFor(keyFor(surface.surfaceId)),
    t,
    setValue: (pointer, value) => setValue(surface.surfaceId, pointer, value),
    submit: (scope, component, name, context, userMessage) => submit(surface.surfaceId, scope, component, name, context, userMessage),
    runLocal: (scope, component, call) => runLocal(surface.surfaceId, scope, component, call),
  })

  // Stage: the arguments are still arriving. The card grows out of what has
  // already closed, never turns into an error notice (a half-written payload is
  // unfinished, not wrong) and never lets a control be operated.
  if (preparing) {
    return h(StreamingCard, {
      callId: props.callId,
      title: streamed?.title ?? t('rendering'),
      surfaces: streamed === undefined || streamed.stopped ? [] : streamed.surfaces,
      text: streamedText ?? '',
      locale,
      now,
      t,
    })
  }

  const header = h(
    'div',
    { className: 'a2ui-card-head' },
    sparkle('a2ui-card-spark'),
    h('span', { className: 'a2ui-card-title' }, payload.title ?? t('title')),
  )

  // A failed call never renders operable content: without this, an error result
  // with empty content would fall through and rebuild the surfaces from `meta`.
  if (isErrorResult) {
    return h(
      'div',
      { className: 'a2ui-root' },
      h('div', { className: 'a2ui-card' }, header, h('div', { className: 'a2ui-card-body' }, Notice({ title: t('invalid'), body: errorText === '' ? t('failedGeneric') : errorText, error: true }))),
    )
  }

  if (!analysis.ok) {
    return h(
      'div',
      { className: 'a2ui-root' },
      h(
        'div',
        { className: 'a2ui-card' },
        header,
        h('div', { className: 'a2ui-card-body' }, Notice({ title: t('invalid'), body: `${t('invalidHint')}\n${formatViolations(analysis.errors)}`, error: true })),
      ),
    )
  }

  if (payload.messages.length === 0) {
    return h(
      'div',
      { className: 'a2ui-root' },
      h('div', { className: 'a2ui-card' }, header, h('div', { className: 'a2ui-card-body' }, Notice({ title: t('empty'), body: payload.readError }))),
    )
  }

  const bodies: Array<ReturnType<typeof h>> = []
  for (const surface of analysis.surfaces) {
    const view = makeView(surface.state)
    const interaction = view.interaction
    bodies.push(
      h(
        'div',
        { key: surface.state.surfaceId, className: 'a2ui-stack' },
        analysis.surfaces.length > 1
          ? h('span', { className: 'a2ui-caption' }, surface.state.surfaceId)
          : null,
        h(A2UISurface, { view }),
        interaction.state === 'sent'
          ? h('div', { className: 'a2ui-notice', role: 'status' }, t('sent'))
          : interaction.state === 'sending'
            ? h('div', { className: 'a2ui-notice', role: 'status' }, t('sending'))
            : interaction.state === 'error'
              ? Notice({ title: t('sendFailed'), body: interaction.message, error: true })
              : null,
      ),
    )
  }
  for (const surfaceId of analysis.updatedOnly) {
    bodies.push(
      h('div', { key: `u-${surfaceId}`, className: 'a2ui-notice', role: 'status' }, h('div', null, h('div', { className: 'a2ui-notice-title' }, `${t('updated')}: ${surfaceId}`), h('div', { className: 'a2ui-notice-body' }, t('updatedOnlyHint')))),
    )
  }
  for (const surfaceId of analysis.deleted) {
    bodies.push(h('div', { key: `d-${surfaceId}`, className: 'a2ui-notice', role: 'status' }, `${t('updated')}: ${surfaceId} deleted`))
  }

  if (bodies.length === 0) {
    bodies.push(Notice({ title: t('updatedOnly'), body: t('updatedOnlyHint') }))
  }

  // The turn tail owns the card once it is mounted; keep the process row to a
  // single line so the same interface is never drawn twice. If the tail is
  // unmounted for any reason the claim disappears and this row draws the card
  // again, which is what makes "the interface can never vanish" true.
  if (mode === 'row' && compact && analysis.surfaces.length > 0) {
    const count = analysis.surfaces.reduce((total, surface) => total + surface.componentCount, 0)
    return h(
      'div',
      { className: 'a2ui-root' },
      h(
        'div',
        { className: 'a2ui-pointer' },
        sparkle('a2ui-pointer-icon'),
        h('span', { className: 'a2ui-pointer-text' }, payload.title ?? t('title')),
        h('span', { className: 'a2ui-pointer-meta' }, `${count} · ${t('atTurnTail')}`),
      ),
    )
  }

  return h(
    'div',
    { className: 'a2ui-root' },
    h('div', { className: 'a2ui-card' }, header, h('div', { className: 'a2ui-card-body' }, h('div', { className: 'a2ui-stack' }, ...bodies))),
  )
}

/** Exported for tests: which component names does the renderer know? */
export const KNOWN_COMPONENTS = [...COMPONENT_BY_NAME.keys()]

export type { SurfaceTouch }
