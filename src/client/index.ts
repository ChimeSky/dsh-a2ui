/**
 * `dsh-a2ui` — browser half entry.
 *
 * Registers one `tool.call.toolview` renderer for the `a2ui` tool, its locale
 * dictionaries, and the renderer stylesheet. Every resource is created inside
 * `ctx.effect`, so disabling the plugin removes the view, the styles and the
 * dictionaries without residue.
 */
import { h } from './h.js'
import { DICTS, NS, en } from './locale.js'
import { CSS } from './styles.js'
import { A2UIToolView, type ClientRuntime } from './tool-view.js'
import { A2uiTurnTail } from './turn-tail.js'
import { createStreamDefinition, resetStreams } from './stream-store.js'

/**
 * Test hooks: the live-argument store the preparing card reads.
 *
 * The render harness loads this bundle exactly as the browser does, so priming
 * the store is the only way to render the progressive path against the shipped
 * artifact instead of a re-implementation of it.
 */
export {
  appendStreamedArguments as __appendStreamedArguments,
  flushStreamNotifications as __flushStreamNotifications,
  resetStreams as __resetStreams,
  streamTextFor as __streamTextFor,
} from './stream-store.js'

/** Services this plugin needs before it can register anything. */
export const inject = ['slots', 'locale', 'sessions']

/** Stable style element id, also used to avoid double injection on reload. */
const STYLE_ID = 'dsh-a2ui/renderer.css'

interface ClientContext {
  effect: (factory: () => (() => void) | void, label?: string) => void
  /**
   * Load a child plugin once the named services exist. Used for the optional
   * streaming observer: without `uiConversation` the card still renders, it just
   * cannot draw while the arguments are still arriving.
   */
  inject?: (deps: string[], callback: (scoped: ClientContext) => void) => { dispose?: () => unknown } | undefined
  uiConversation?: {
    events?: { register?: (definition: unknown) => (() => void) | void }
  }
  slots: {
    inject: (key: string, callback: () => (() => void) | void) => () => void
    register: (options: Record<string, unknown>, component: unknown) => () => void
  }
  locale: {
    register: (ns: string, dicts: Record<string, Record<string, string>>) => () => void
    bind: (ns: string) => (key: string) => string
    getLocale: () => { id?: string }
  }
  sessions: {
    scope: (sessionId: string) => { get: (name: string) => unknown } | undefined
  }
  get?: (name: string) => unknown
  logger?: { warn?: (...args: unknown[]) => void }
}

function installStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`)
  if (existing !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-a2ui'
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => {
    tag.remove()
  }
}

function toBcp47(id: string | undefined): string {
  if (typeof id !== 'string' || id === '') return 'en-US'
  if (id.toLowerCase().startsWith('zh')) return id.toLowerCase().startsWith('zh-tw') ? 'zh-TW' : 'zh-CN'
  return id
}

/**
 * Send an A2UI action to the agent as an ordinary queued user message.
 *
 * This goes through the session's own Conversation service, so the Host applies
 * its normal admission rules (running turn, queue limits, permissions) exactly
 * as if the user had typed the message.
 */
function makeSendPrompt(ctx: ClientContext): (sessionId: string, text: string) => Promise<void> {
  const scopeOf = (sessionId: string): { get: (name: string) => unknown } | undefined => ctx.sessions.scope(sessionId)
  return async (sessionId, text) => {
    const scope = scopeOf(sessionId)
    if (scope === undefined) throw new Error('this session is not open in the browser')
    // The Conversation service is session-scoped; fall back to the root context
    // so a future profile that registers it globally keeps working.
    const candidates = [scope.get('conversation'), typeof ctx.get === 'function' ? ctx.get('conversation') : undefined]
    const conversation = candidates.find(
      (candidate): candidate is { send: (message: string) => Promise<void> } =>
        candidate !== null && typeof candidate === 'object' && typeof (candidate as { send?: unknown }).send === 'function',
    )
    if (conversation === undefined) {
      throw new Error('the conversation service is unavailable for this session')
    }
    await conversation.send(text)
  }
}

/**
 * Register the A2UI tool view.
 * @param ctx client plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(installStyles, 'dsh-a2ui: styles')
  ctx.effect(() => ctx.locale.register(NS, DICTS), 'dsh-a2ui: locale')

  // Streaming: observe the raw argument fragments of a call that is still being
  // written, so the card can grow instead of waiting for the finished payload.
  // The observer is a state-only Conversation Definition (no view target), which
  // is the supported way to watch an event without touching the transcript.
  ctx.effect(() => {
    if (typeof ctx.inject !== 'function') return () => resetStreams()
    const fiber = ctx.inject(['uiConversation'], (scoped) => {
      scoped.effect(() => {
        // The registry is a class instance: its `register` is a method that reads
        // `this`, so it must be called *on* the events object. Taking the method
        // out of it first would throw and silently disable the preview.
        const events = scoped.uiConversation?.events
        if (events === undefined || typeof events.register !== 'function') return undefined
        let dispose: (() => void) | undefined
        try {
          const registered = events.register(createStreamDefinition())
          dispose = typeof registered === 'function' ? registered : undefined
        } catch (cause) {
          // Losing the observer costs the progressive preview, never the card.
          ctx.logger?.warn?.('dsh-a2ui: streaming observer unavailable', cause)
          return undefined
        }
        // The live-argument cache belongs to this registration: unloading the
        // observer releases it, and a re-mount starts from an empty cache.
        return () => {
          if (dispose !== undefined) dispose()
          resetStreams()
        }
      }, 'dsh-a2ui: stream observer')
    })
    return () => {
      if (typeof fiber?.dispose === 'function') void fiber.dispose()
      resetStreams()
    }
  }, 'dsh-a2ui: stream observer')

  const bound = ctx.locale.bind(NS)
  const t = (key: string): string => {
    const value = bound(key)
    if (typeof value === 'string' && value !== '' && value !== key) return value
    return en[key] ?? key
  }
  const runtime: ClientRuntime = {
    t,
    locale: () => toBcp47(ctx.locale.getLocale()?.id),
    sendPrompt: makeSendPrompt(ctx),
  }

  ctx.effect(
    () =>
      ctx.slots.inject('tool.call.toolview', () =>
        ctx.slots.register({ name: 'tool.call.toolview', key: 'a2ui', locale: NS }, (props: Record<string, unknown>) =>
          h(A2UIToolView, { ...props, runtime, mode: 'row' } as never),
        ),
      ),
    'dsh-a2ui: tool view',
  )

  // The turn tail is the card's visible home: it renders after the turn's answer,
  // outside the collapsible process window. Its copy claims the call while it is
  // mounted, and the process row only steps aside for as long as that claim lasts.
  ctx.effect(
    () =>
      ctx.slots.inject('conversation.chat.turnTail', () =>
        ctx.slots.register({ name: 'conversation.chat.turnTail', id: 'dsh-a2ui-surfaces', order: 10, locale: NS }, (props: Record<string, unknown>) =>
          h(A2uiTurnTail, { ...props, runtime } as never),
        ),
      ),
    'dsh-a2ui: turn tail',
  )
}
