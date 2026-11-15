/**
 * Progressive fold: render an `a2ui` call while the model is still writing it.
 *
 * The finished-call path is strict — `validateToolArguments` decides, and a
 * single violation turns the whole card into a readable error. That is right for
 * settled data and useless for data still arriving, so this module is the
 * deliberately weaker sibling used *only* while a call is being prepared:
 *
 * - It folds whatever {@link recoverArguments} could close (whole messages, whole
 *   components) with the same merge semantics the settled path uses, so a surface
 *   grows instead of being rebuilt.
 * - Every component is shape-checked on its own (id, type name) and the resulting
 *   surface still has to pass the expansion budget, so a partial tree cannot be
 *   larger than a settled one.
 * - A surface without its `root` component yet is not rendered at all: there is
 *   nothing to place, and an empty card would flicker.
 *
 * Nothing here authorises anything: the streaming card is non-interactive, and
 * the settled call replaces it with the validated snapshot.
 */
import { estimateExpansion } from './budget.js'
import { isPlainObject, type JsonValue } from './json.js'
import { LIMITS } from './limits.js'
import { recoverArguments } from './partial-json.js'
import { EXTENSION_CATALOG_ID, PROTOCOL_VERSION } from './catalog.js'
import { applyMessageBatch, type A2UIComponent, type AgentToRendererMessage, type SurfaceState } from './validate.js'

/** Component and surface ids the protocol admits. */
const ID_PATTERN = /^[A-Za-z0-9._:-]+$/u

/** What a partly streamed call can draw right now. */
export interface StreamingFold {
  /** `title`, once the model finished writing that string. */
  title?: string
  /** Surfaces whose `root` exists, in declaration order. */
  surfaces: SurfaceState[]
  /** Components recovered so far, across every surface. */
  components: number
  /** More content can still arrive. */
  streaming: boolean
  /** The prefix is unusable; stop trying to draw it. */
  stopped: boolean
}

const EMPTY: StreamingFold = { surfaces: [], components: 0, streaming: false, stopped: false }

function validId(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= LIMITS.maxIdLength && ID_PATTERN.test(value)
}

/**
 * Keep the components that are structurally complete.
 *
 * Property values are *not* validated here: every renderer reads its properties
 * totally (an absent or wrongly typed value falls back), and validating a graph
 * whose children may still arrive would reject exactly the intermediate states
 * this module exists to draw. The settled call is still fully validated.
 */
function sanitiseComponents(value: unknown): A2UIComponent[] {
  if (!Array.isArray(value)) return []
  const out: A2UIComponent[] = []
  const seen = new Set<string>()
  for (const entry of value.slice(0, LIMITS.maxComponentsPerMessage)) {
    if (!isPlainObject(entry)) continue
    if (!validId(entry.id)) continue
    if (seen.has(entry.id)) continue
    if (typeof entry.component !== 'string' || entry.component === '' || entry.component === 'Surface') continue
    seen.add(entry.id)
    out.push(entry as unknown as A2UIComponent)
  }
  return out
}

/** Shape-check one recovered message; anything unfamiliar is skipped. */
function sanitiseMessage(value: unknown): AgentToRendererMessage | undefined {
  if (!isPlainObject(value)) return undefined
  const create = value.createSurface
  if (isPlainObject(create)) {
    if (!validId(create.surfaceId)) return undefined
    const catalogId = typeof create.catalogId === 'string' && create.catalogId !== '' ? create.catalogId : EXTENSION_CATALOG_ID
    return {
      version: PROTOCOL_VERSION,
      createSurface: {
        surfaceId: create.surfaceId,
        catalogId,
        ...(typeof create.sendDataModel === 'boolean' ? { sendDataModel: create.sendDataModel } : {}),
        ...(isPlainObject(create.dataModel) ? { dataModel: create.dataModel as Record<string, JsonValue> } : {}),
        components: sanitiseComponents(create.components),
      },
    }
  }
  const update = value.updateComponents
  if (isPlainObject(update)) {
    if (!validId(update.surfaceId)) return undefined
    return {
      version: PROTOCOL_VERSION,
      updateComponents: { surfaceId: update.surfaceId, components: sanitiseComponents(update.components) },
    }
  }
  const data = value.updateDataModel
  if (isPlainObject(data)) {
    if (!validId(data.surfaceId)) return undefined
    if (!Object.prototype.hasOwnProperty.call(data, 'value')) return undefined
    const path = data.path
    if (path !== undefined && typeof path !== 'string') return undefined
    return {
      version: PROTOCOL_VERSION,
      updateDataModel: {
        surfaceId: data.surfaceId,
        ...(typeof path === 'string' ? { path } : {}),
        value: data.value as JsonValue,
      },
    }
  }
  const drop = value.deleteSurface
  if (isPlainObject(drop)) {
    if (!validId(drop.surfaceId)) return undefined
    return { version: PROTOCOL_VERSION, deleteSurface: { surfaceId: drop.surfaceId } }
  }
  return undefined
}

/**
 * Fold the argument characters received so far into renderable surfaces.
 *
 * @param text argument text of the call being prepared.
 * @returns surfaces that can be drawn now, plus whether to keep listening.
 */
export function foldStreaming(text: string): StreamingFold {
  const recovered = recoverArguments(text)
  if (recovered.invalid) return { ...EMPTY, stopped: true }
  const messages: AgentToRendererMessage[] = []
  for (const message of recovered.messages) {
    const sanitised = sanitiseMessage(message)
    if (sanitised !== undefined) messages.push(sanitised)
  }
  if (messages.length === 0) return { ...EMPTY, streaming: recovered.open }
  const folded = applyMessageBatch(new Map<string, SurfaceState>(), messages)
  const surfaces: SurfaceState[] = []
  let components = 0
  for (const touch of folded.touches) {
    if (touch.deleted) continue
    const state = folded.surfaces.get(touch.surfaceId)
    if (state === undefined) continue
    // Without a declared root there is nothing to place yet: an empty card would
    // appear and disappear as each component lands.
    if (!state.components.has('root')) continue
    const estimate = estimateExpansion(state)
    if (estimate.reason !== undefined) {
      // A partial tree over the settled budget is never completed into a legal
      // one, and drawing it would freeze the tab.
      return { ...EMPTY, stopped: true }
    }
    surfaces.push(state)
    components += state.components.size
  }
  return {
    ...(recovered.title === undefined ? {} : { title: recovered.title }),
    surfaces,
    components,
    streaming: recovered.open,
    stopped: false,
  }
}
