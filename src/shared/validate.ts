/**
 * A2UI 1.0 message validation and surface folding.
 *
 * The Host calls {@link validateToolArguments} before accepting a tool call;
 * the browser calls {@link applyMessageBatch} to fold a validated batch into the
 * renderer state. Both share one implementation so the two sides cannot drift.
 */
import { isJsonValue, isPlainObject, pointerSet, type JsonValue } from './json.js'
import { LIMITS, limitMessage } from './limits.js'
import {
  BASIC_CATALOG_ID,
  CATALOG_IDS,
  COMPONENT_BY_NAME,
  EXTENSION_CATALOG_ID,
  PROTOCOL_VERSION,
  accessibilityValidator,
  componentAllowedIn,
  metadataValidator,
  resolveCatalogId,
  type ComponentSpec,
} from './catalog.js'
import { fail, type Violation } from './schema.js'

/** A component as authored by the model (validated, not yet rendered). */
export interface A2UIComponent {
  id: string
  component: string
  catalogId?: string
  accessibility?: Record<string, unknown>
  metadata?: Record<string, unknown>
  weight?: number
  [property: string]: unknown
}

export type AgentToRendererMessage =
  | {
      version: typeof PROTOCOL_VERSION
      createSurface: {
        surfaceId: string
        catalogId?: string
        sendDataModel?: boolean
        components?: A2UIComponent[]
        dataModel?: Record<string, JsonValue>
        metadata?: { extensions?: Record<string, unknown> }
      }
    }
  | { version: typeof PROTOCOL_VERSION; updateComponents: { surfaceId: string; components: A2UIComponent[] } }
  | { version: typeof PROTOCOL_VERSION; updateDataModel: { surfaceId: string; path?: string; value: JsonValue } }
  | { version: typeof PROTOCOL_VERSION; deleteSurface: { surfaceId: string } }

export type SupportedMessageKind = 'createSurface' | 'updateComponents' | 'updateDataModel' | 'deleteSurface'

const MESSAGE_KINDS: readonly string[] = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface']
const ALL_MESSAGE_KEYS: readonly string[] = [
  'createSurface',
  'updateComponents',
  'updateDataModel',
  'deleteSurface',
  'callRendererFunction',
  'agentFunctionResponse',
]

/** A folded surface: the renderer's authoritative state for one surfaceId. */
export interface SurfaceState {
  surfaceId: string
  catalogId: string
  components: ReadonlyMap<string, A2UIComponent>
  /** Declaration order, used as the render fallback when a child list is absent. */
  order: readonly string[]
  dataModel: JsonValue
  sendDataModel: boolean
}

/** What one validated batch does to one surface. */
export interface SurfaceTouch {
  surfaceId: string
  created: boolean
  deleted: boolean
  /** Every component id whose definition this batch added or replaced. */
  changedComponentIds: readonly string[]
  dataModelChanged: boolean
}

export interface BatchOutcome {
  surfaces: Map<string, SurfaceState>
  touches: SurfaceTouch[]
  errors: Violation[]
  warnings: string[]
}

/** Result of validating one `a2ui` tool call's arguments. */
export interface ToolValidation {
  ok: boolean
  errors: Violation[]
  warnings: string[]
  /** Surface summary the tool reports back to the model. */
  surfaces: Array<{ surfaceId: string; catalogId: string; components: number; deleted: boolean }>
  messages: AgentToRendererMessage[]
}

function invalidEnvelope(message: Record<string, unknown>, path: string, out: Violation[]): string | undefined {
  const keys = Object.keys(message)
  if (!Object.prototype.hasOwnProperty.call(message, 'version')) {
    fail(out, `${path}/version`, 'is required and must be "1.0"')
  } else if (message.version !== PROTOCOL_VERSION) {
    fail(out, `${path}/version`, `must be "1.0" (got ${JSON.stringify(message.version)}); v0.8 and v0.9 payloads are not accepted`)
  }
  const unknown = keys.filter((key) => key !== 'version' && !ALL_MESSAGE_KEYS.includes(key))
  if (unknown.length > 0) fail(out, path, `has unsupported properties: ${unknown.join(', ')}`)
  const kinds = keys.filter((key) => ALL_MESSAGE_KEYS.includes(key))
  if (kinds.length !== 1) {
    fail(out, path, `must contain exactly one of ${ALL_MESSAGE_KEYS.join(', ')} (got ${kinds.length === 0 ? 'none' : kinds.join(', ')})`)
    return undefined
  }
  const kind = kinds[0] as string
  if (kind === 'callRendererFunction' || kind === 'agentFunctionResponse') {
    fail(out, `${path}/${kind}`, `is a valid A2UI 1.0 message but is not supported by dsh-a2ui 0.1.0; send createSurface/updateComponents/updateDataModel/deleteSurface instead`)
    return undefined
  }
  return kind
}

function checkSurfaceId(value: unknown, path: string, out: Violation[]): string | undefined {
  if (typeof value !== 'string' || value === '') {
    fail(out, path, 'must be a non-empty string')
    return undefined
  }
  if (value.length > LIMITS.maxIdLength) {
    fail(out, path, limitMessage('surfaceId length', LIMITS.maxIdLength, value.length))
    return undefined
  }
  if (!/^[A-Za-z0-9._:-]+$/u.test(value)) {
    fail(out, path, 'must contain only letters, digits, ".", "_", ":" or "-"')
    return undefined
  }
  return value
}

function checkCatalogId(value: unknown, path: string, out: Violation[]): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    fail(out, path, 'must be a string')
    return undefined
  }
  if (!CATALOG_IDS.has(value)) {
    fail(out, path, `is not a known catalog; use "${BASIC_CATALOG_ID}" or a catalog id listed by a2ui_catalog`)
    return undefined
  }
  return value
}

function checkDataModel(value: unknown, path: string, out: Violation[]): void {
  if (!isPlainObject(value)) {
    fail(out, path, 'must be a JSON object')
    return
  }
  if (!isJsonValue(value)) fail(out, path, 'must be a lossless JSON value')
}

function checkComponentShape(component: unknown, path: string, out: Violation[]): A2UIComponent | undefined {
  if (!isPlainObject(component)) {
    fail(out, path, 'must be an object')
    return undefined
  }
  const id = component.id
  if (typeof id !== 'string' || id === '') {
    fail(out, `${path}/id`, 'must be a non-empty string')
    return undefined
  }
  if (id.length > LIMITS.maxIdLength) {
    fail(out, `${path}/id`, limitMessage('component id length', LIMITS.maxIdLength, id.length))
    return undefined
  }
  if (!/^[A-Za-z0-9._:-]+$/u.test(id)) {
    fail(out, `${path}/id`, 'must contain only letters, digits, ".", "_", ":" or "-"')
    return undefined
  }
  if (typeof component.component !== 'string' || component.component === '') {
    fail(out, `${path}/component`, 'must name the component type (e.g. "Text")')
    return undefined
  }
  if (component.component === 'Surface') {
    fail(out, `${path}/component`, '"Surface" is the implicit protocol container and must not be declared as a component')
    return undefined
  }
  return component as A2UIComponent
}

/** Property-level validation against the catalog entry. */
function checkComponentProperties(
  component: A2UIComponent,
  catalogId: string,
  path: string,
  out: Violation[],
  isExtensionCatalog: boolean,
): void {
  const spec: ComponentSpec | undefined = COMPONENT_BY_NAME.get(component.component)
  if (spec === undefined) {
    const known = [...COMPONENT_BY_NAME.keys()].join(', ')
    fail(out, `${path}/component`, `unknown component "${component.component}". Known components: ${known}`)
    return
  }
  if (!componentAllowedIn(catalogId, spec.name)) {
    fail(
      out,
      `${path}/component`,
      `"${spec.name}" belongs to the dsh-a2ui extension catalog, not the official basic catalog; set createSurface.catalogId to the extension catalog id`,
    )
    return
  }
  const common = new Set(['id', 'component', 'catalogId', 'accessibility', 'metadata', 'weight'])
  for (const key of Object.keys(component)) {
    if (common.has(key)) continue
    if (!Object.prototype.hasOwnProperty.call(spec.properties, key)) {
      fail(out, `${path}/${key}`, `is not a property of ${spec.name}`)
    }
  }
  if (component.accessibility !== undefined) accessibilityValidator(component.accessibility, `${path}/accessibility`, out)
  if (component.metadata !== undefined) metadataValidator(component.metadata, `${path}/metadata`, out)
  for (const key of spec.required) {
    if (!Object.prototype.hasOwnProperty.call(component, key)) fail(out, path, `is missing required property "${key}" for ${spec.name}`)
  }
  const weightValidator = spec.properties.weight
  if (weightValidator !== undefined && component.weight !== undefined) weightValidator(component.weight, `${path}/weight`, out)
  for (const [key, validator] of Object.entries(spec.properties)) {
    if (key === 'weight') continue
    const value = component[key]
    if (value === undefined) continue
    validator(value, `${path}/${key}`, out)
  }
  if (isExtensionCatalog && spec.origin === 'basic') return
}

/** Collect child component ids a component references, with their property names. */
export function childReferences(component: A2UIComponent): Array<{ id: string; field: string }> {
  const out: Array<{ id: string; field: string }> = []
  const single = (field: string): void => {
    const value = component[field]
    if (typeof value === 'string' && value !== '') out.push({ id: value, field })
  }
  single('child')
  single('trigger')
  single('content')
  const children = component.children
  if (Array.isArray(children)) {
    for (const entry of children) if (typeof entry === 'string' && entry !== '') out.push({ id: entry, field: 'children' })
  } else if (isPlainObject(children) && typeof children.componentId === 'string') {
    out.push({ id: children.componentId, field: 'children' })
  }
  const tabs = component.tabs
  if (Array.isArray(tabs)) {
    for (const tab of tabs) {
      if (isPlainObject(tab) && typeof tab.child === 'string' && tab.child !== '') out.push({ id: tab.child, field: 'tabs' })
    }
  }
  return out
}

interface GraphCheck {
  components: Map<string, A2UIComponent>
  strict: boolean
  errors: Violation[]
  warnings: string[]
  pathPrefix: string
}

function checkGraph(graph: GraphCheck): void {
  const { components, strict, errors, warnings, pathPrefix } = graph
  if (components.size === 0) return
  if (!components.has('root')) {
    const message = 'the component tree needs a component with id "root" (createSurface wraps it in the implicit Surface container)'
    if (strict) fail(errors, pathPrefix, message)
    else warnings.push(`${pathPrefix}: ${message}`)
  }
  for (const component of components.values()) {
    for (const reference of childReferences(component)) {
      if (components.has(reference.id)) continue
      const message = `component "${component.id}" references missing child "${reference.id}" in ${reference.field}`
      if (strict) fail(errors, `${pathPrefix}/${component.id}/${reference.field}`, message)
      else warnings.push(message)
    }
  }
  // Depth and cycle check from the root (and from every orphan when non-strict).
  const state = new Map<string, 'visiting' | 'done'>()
  let deepest = 0
  const visit = (id: string, depth: number, chain: readonly string[]): void => {
    if (depth > deepest) deepest = depth
    if (depth > LIMITS.maxDepth) {
      fail(errors, `${pathPrefix}/${id}`, limitMessage('component depth', LIMITS.maxDepth, depth))
      return
    }
    const status = state.get(id)
    if (status === 'visiting') {
      fail(errors, `${pathPrefix}/${id}`, `circular component reference: ${[...chain, id].join(' -> ')}`)
      return
    }
    if (status === 'done') return
    state.set(id, 'visiting')
    const component = components.get(id)
    if (component !== undefined) {
      for (const reference of childReferences(component)) {
        if (components.has(reference.id)) visit(reference.id, depth + 1, [...chain, id])
      }
    }
    state.set(id, 'done')
  }
  if (components.has('root')) visit('root', 1, [])
  if (!strict) {
    for (const id of components.keys()) if (!state.has(id)) visit(id, 1, [])
  }
}

function applyComponents(
  previous: SurfaceState | undefined,
  surfaceId: string,
  catalogId: string,
  components: A2UIComponent[],
  sendDataModel: boolean,
  dataModel: JsonValue,
): { state: SurfaceState; changed: string[] } {
  const map = new Map<string, A2UIComponent>(previous?.components ?? [])
  const order = [...(previous?.order ?? [])]
  const changed: string[] = []
  for (const component of components) {
    if (!map.has(component.id)) order.push(component.id)
    // `updateComponents` replaces the listed component's definition; components
    // not listed keep their previous definition (A2UI 1.0 merge semantics).
    map.set(component.id, component)
    changed.push(component.id)
  }
  return {
    state: {
      surfaceId,
      catalogId,
      components: map,
      order,
      dataModel,
      sendDataModel,
    },
    changed,
  }
}

/**
 * Fold a batch of already shape-checked messages into surface state.
 *
 * @param surfaces current state (not mutated).
 * @param messages validated messages.
 */
export function applyMessageBatch(
  surfaces: ReadonlyMap<string, SurfaceState>,
  messages: readonly AgentToRendererMessage[],
): { surfaces: Map<string, SurfaceState>; touches: SurfaceTouch[] } {
  const next = new Map(surfaces)
  const touched = new Map<string, { created: boolean; deleted: boolean; changed: string[]; dataModel: boolean }>()
  const mark = (surfaceId: string) => {
    let entry = touched.get(surfaceId)
    if (entry === undefined) {
      entry = { created: false, deleted: false, changed: [], dataModel: false }
      touched.set(surfaceId, entry)
    }
    return entry
  }
  for (const message of messages) {
    if ('createSurface' in message) {
      const payload = message.createSurface
      const catalogId = payload.catalogId ?? (surfaces.get(payload.surfaceId)?.catalogId ?? '')
      const base = surfaces.get(payload.surfaceId)
      const dataModel = (payload.dataModel as JsonValue | undefined) ?? base?.dataModel ?? {}
      const { state, changed } = applyComponents(
        base,
        payload.surfaceId,
        catalogId,
        payload.components ?? [],
        payload.sendDataModel ?? base?.sendDataModel ?? false,
        dataModel,
      )
      next.set(payload.surfaceId, state)
      const entry = mark(payload.surfaceId)
      entry.created = true
      entry.changed.push(...changed)
      continue
    }
    if ('updateComponents' in message) {
      const payload = message.updateComponents
      const base = surfaces.get(payload.surfaceId)
      const catalogId = base?.catalogId ?? ''
      const { state, changed } = applyComponents(
        base,
        payload.surfaceId,
        catalogId,
        payload.components,
        base?.sendDataModel ?? false,
        base?.dataModel ?? {},
      )
      next.set(payload.surfaceId, state)
      mark(payload.surfaceId).changed.push(...changed)
      continue
    }
    if ('updateDataModel' in message) {
      const payload = message.updateDataModel
      const base = surfaces.get(payload.surfaceId)
      if (base === undefined) continue
      const path = payload.path === undefined || payload.path === '/' ? '/' : payload.path
      const dataModel = pointerSet(base.dataModel, path, payload.value as JsonValue)
      next.set(payload.surfaceId, { ...base, dataModel })
      mark(payload.surfaceId).dataModel = true
      continue
    }
    if ('deleteSurface' in message) {
      const payload = message.deleteSurface
      next.delete(payload.surfaceId)
      mark(payload.surfaceId).deleted = true
    }
  }
  const touches: SurfaceTouch[] = [...touched.entries()].map(([surfaceId, entry]) => ({
    surfaceId,
    created: entry.created,
    deleted: entry.deleted,
    changedComponentIds: entry.changed,
    dataModelChanged: entry.dataModel,
  }))
  return { surfaces: next, touches }
}

// `pointerSet` is imported from json.ts above.

/**
 * Validate one `a2ui` tool call's arguments.
 * @param input the raw `arguments` value reported by the model.
 */
export function validateToolArguments(input: unknown): ToolValidation {
  const errors: Violation[] = []
  const warnings: string[] = []
  const surfaces: Map<string, SurfaceState> = new Map()
  const messages: AgentToRendererMessage[] = []

  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ path: '', message: 'arguments must be an object' }], warnings, surfaces: [], messages: [] }
  }
  const unknownRoot = Object.keys(input).filter((key) => key !== 'messages' && key !== 'title')
  if (unknownRoot.length > 0) fail(errors, '', `has unsupported properties: ${unknownRoot.join(', ')}`)
  if (input.title !== undefined && typeof input.title !== 'string') fail(errors, '/title', 'must be a string')
  if (typeof input.title === 'string' && input.title.length > 200) fail(errors, '/title', 'must be at most 200 characters')

  const raw = input.messages
  if (!Array.isArray(raw)) {
    fail(errors, '/messages', 'is required and must be an array of A2UI 1.0 messages')
    return { ok: false, errors, warnings, surfaces: [], messages: [] }
  }
  if (raw.length === 0) fail(errors, '/messages', 'must contain at least one message')
  if (raw.length > LIMITS.maxMessages) {
    fail(errors, '/messages', limitMessage('message count', LIMITS.maxMessages, raw.length))
  }
  const serialized = safeStringify(raw)
  if (serialized !== undefined && serialized.length > LIMITS.maxPayloadChars) {
    fail(errors, '/messages', limitMessage('payload size in characters', LIMITS.maxPayloadChars, serialized.length))
  }

  // Surface bookkeeping is local to this batch: the Host holds no per-session
  // surface state, so an update may legitimately address a surface an earlier
  // call created.
  const createdHere = new Set<string>()
  const batchComponents = new Map<string, Map<string, A2UIComponent>>()

  for (let index = 0; index < raw.length; index += 1) {
    const path = `/messages/${index}`
    const candidate = raw[index]
    if (!isPlainObject(candidate)) {
      fail(errors, path, 'must be an object')
      continue
    }
    const kind = invalidEnvelope(candidate, path, errors)
    if (kind === undefined) continue
    const payload = candidate[kind]
    if (!isPlainObject(payload)) {
      fail(errors, `${path}/${kind}`, 'must be an object')
      continue
    }
    const allowed: Record<string, readonly string[]> = {
      createSurface: ['surfaceId', 'catalogId', 'sendDataModel', 'components', 'dataModel', 'metadata'],
      updateComponents: ['surfaceId', 'components'],
      updateDataModel: ['surfaceId', 'path', 'value'],
      deleteSurface: ['surfaceId'],
    }
    for (const key of Object.keys(payload)) {
      if (!(allowed[kind] ?? []).includes(key)) fail(errors, `${path}/${kind}`, `has unsupported property "${key}"`)
    }
    const surfaceId = checkSurfaceId(payload.surfaceId, `${path}/${kind}/surfaceId`, errors)
    if (surfaceId === undefined) continue
    const surfaceCatalogId = checkCatalogId(payload.catalogId, `${path}/${kind}/catalogId`, errors)

    if (kind === 'deleteSurface') {
      messages.push({ version: PROTOCOL_VERSION, deleteSurface: { surfaceId } })
      continue
    }

    if (kind === 'updateDataModel') {
      if (!Object.prototype.hasOwnProperty.call(payload, 'value')) {
        fail(errors, `${path}/${kind}`, 'is missing required property "value" (use null to delete a key)')
      } else if (!isJsonValue(payload.value)) {
        fail(errors, `${path}/${kind}/value`, 'must be a lossless JSON value')
      }
      if (payload.path !== undefined) {
        if (typeof payload.path !== 'string') fail(errors, `${path}/${kind}/path`, 'must be a JSON Pointer string')
        else if (payload.path !== '' && !payload.path.startsWith('/')) fail(errors, `${path}/${kind}/path`, 'must start with "/"')
      }
      messages.push({
        version: PROTOCOL_VERSION,
        updateDataModel: { surfaceId, path: payload.path as string | undefined, value: payload.value as JsonValue },
      })
      continue
    }

    // createSurface / updateComponents
    const rawComponents = payload.components
    if (rawComponents === undefined) {
      if (kind === 'updateComponents') fail(errors, `${path}/${kind}`, 'is missing required property "components"')
      messages.push({
        version: PROTOCOL_VERSION,
        createSurface: {
          surfaceId,
          catalogId: surfaceCatalogId ?? EXTENSION_CATALOG_ID,
          ...(payload.sendDataModel === undefined ? {} : { sendDataModel: payload.sendDataModel as boolean }),
          ...(payload.dataModel === undefined ? {} : { dataModel: payload.dataModel as Record<string, JsonValue> }),
        },
      })
      if (kind === 'createSurface') createdHere.add(surfaceId)
      continue
    }
    if (!Array.isArray(rawComponents)) {
      fail(errors, `${path}/${kind}/components`, 'must be an array')
      continue
    }
    if (rawComponents.length === 0) fail(errors, `${path}/${kind}/components`, 'must contain at least one component')
    if (rawComponents.length > LIMITS.maxComponentsPerMessage) {
      fail(errors, `${path}/${kind}/components`, limitMessage('components per message', LIMITS.maxComponentsPerMessage, rawComponents.length))
    }
    if (payload.sendDataModel !== undefined && typeof payload.sendDataModel !== 'boolean') {
      fail(errors, `${path}/${kind}/sendDataModel`, 'must be a boolean')
    }
    if (payload.dataModel !== undefined) checkDataModel(payload.dataModel, `${path}/${kind}/dataModel`, errors)
    if (payload.metadata !== undefined && !isPlainObject(payload.metadata)) {
      fail(errors, `${path}/${kind}/metadata`, 'must be an object')
    }

    const effectiveCatalog = resolveCatalogId(surfaceCatalogId, undefined) ?? (surfaceCatalogId ?? '')
    const seen = new Map<string, number>()
    const accepted: A2UIComponent[] = []
    for (let position = 0; position < rawComponents.length; position += 1) {
      const componentPath = `${path}/${kind}/components/${position}`
      const component = checkComponentShape(rawComponents[position], componentPath, errors)
      if (component === undefined) continue
      if (seen.has(component.id)) {
        fail(errors, componentPath, `duplicates component id "${component.id}" already declared at index ${seen.get(component.id) ?? 0} in this message`)
        continue
      }
      seen.set(component.id, position)
      const componentCatalog = checkCatalogId(component.catalogId, `${componentPath}/catalogId`, errors)
      const catalogId = resolveCatalogId(effectiveCatalog, componentCatalog)
      if (catalogId === undefined) {
        fail(errors, componentPath, `cannot resolve catalog "${componentCatalog ?? effectiveCatalog}"`)
        continue
      }
      checkComponentProperties(component, catalogId, componentPath, errors, catalogId !== BASIC_CATALOG_ID)
      accepted.push(component)
      const surfaceComponents = batchComponents.get(surfaceId) ?? new Map<string, A2UIComponent>()
      surfaceComponents.set(component.id, component)
      batchComponents.set(surfaceId, surfaceComponents)
    }

    if (kind === 'createSurface') {
      createdHere.add(surfaceId)
      messages.push({
        version: PROTOCOL_VERSION,
        createSurface: {
          surfaceId,
          catalogId: surfaceCatalogId ?? EXTENSION_CATALOG_ID,
          ...(payload.sendDataModel === undefined ? {} : { sendDataModel: payload.sendDataModel as boolean }),
          ...(payload.dataModel === undefined ? {} : { dataModel: payload.dataModel as Record<string, JsonValue> }),
          components: accepted,
        },
      })
    } else {
      messages.push({ version: PROTOCOL_VERSION, updateComponents: { surfaceId, components: accepted } })
    }
  }

  // Per-surface graph checks over everything this batch declares.
  for (const [surfaceId, components] of batchComponents) {
    const strict = createdHere.has(surfaceId)
    checkGraph({
      components,
      strict,
      errors,
      warnings,
      pathPrefix: `/surfaces/${surfaceId}`,
    })
    if (components.size > LIMITS.maxComponentsPerSurface) {
      fail(errors, `/surfaces/${surfaceId}`, limitMessage('components per surface', LIMITS.maxComponentsPerSurface, components.size))
    }
  }
  if (createdHere.size > LIMITS.maxSurfacesPerCall) {
    fail(errors, '', limitMessage('surfaces per call', LIMITS.maxSurfacesPerCall, createdHere.size))
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings, surfaces: [], messages: [] }
  }

  const folded = applyMessageBatch(surfaces, messages)
  const summary = folded.touches
    .filter((touch) => touch.created || touch.changedComponentIds.length > 0 || touch.dataModelChanged || touch.deleted)
    .map((touch) => {
      const state = folded.surfaces.get(touch.surfaceId)
      return {
        surfaceId: touch.surfaceId,
        catalogId: state?.catalogId ?? '',
        components: state?.components.size ?? 0,
        deleted: touch.deleted,
      }
    })

  for (const touch of folded.touches) {
    if (touch.changedComponentIds.length === 0 && !touch.created && !touch.deleted && !touch.dataModelChanged) {
      warnings.push(`surface "${touch.surfaceId}" was referenced but nothing changed`)
    } else if (!touch.created && !touch.deleted && !surfaces.has(touch.surfaceId) && touch.changedComponentIds.length > 0) {
      warnings.push(
        `surface "${touch.surfaceId}" was updated here but not created in this tool call; if no earlier call created it, nothing will render. Send a createSurface message first.`,
      )
    }
  }

  return { ok: true, errors, warnings, surfaces: summary, messages }
}

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

/** Whether a value looks like a v1.0 message envelope (used by diagnostics only). */
export function looksLikeMessage(value: unknown): boolean {
  return isPlainObject(value) && (MESSAGE_KINDS.some((kind) => kind in value) || 'version' in value)
}
