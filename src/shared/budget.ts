/**
 * Render-budget estimation.
 *
 * A model-authored graph can stay small as *definitions* while expanding to a
 * huge React tree: seven components that each render six children per level
 * reach 46,656 leaves, and one template bound to a long data list does the same.
 * The validator and the renderer therefore ask the same estimator — before any
 * element is created — how many nodes a surface would actually produce, and
 * reject or degrade the card when the answer is too large.
 */
import { isPlainObject, type JsonValue } from './json.js'
import { LIMITS } from './limits.js'
import { isChildTemplate, childReferences } from './graph.js'
import { resolveBinding, resolveValue, type ResolveContext } from './binding.js'
import type { SurfaceState } from './validate.js'

/** Result of an expansion estimate. */
export interface ExpansionEstimate {
  /** Expanded component instances, counting template repetitions. */
  nodes: number
  /** Data units consumed by tables, charts and players (rows/points/items). */
  dataUnits: number
  /** Set when a limit was exceeded; `nodes`/`dataUnits` then hold the partial count. */
  reason?: string
}

interface Frame {
  id: string
  item?: JsonValue
  depth: number
}

function contextFor(state: SurfaceState, item: JsonValue | undefined): ResolveContext {
  return { dataModel: state.dataModel, item, locale: 'en', now: 0 }
}

/** Rows/points/items a single component would materialise. */
function dataUnitsOf(component: Record<string, unknown>, state: SurfaceState, item: JsonValue | undefined): number {
  const context = contextFor(state, item)
  const name = component.component
  try {
    if (name === 'Table') {
      const rows = resolveValue(component.rows, context)
      return Array.isArray(rows) ? rows.length : 0
    }
    if (name === 'BarChart' || name === 'LineChart') {
      const categories = Array.isArray(component.categories) ? component.categories.length : 0
      const series = Array.isArray(component.series) ? component.series : []
      let points = 0
      for (const entry of series) {
        if (!isPlainObject(entry)) continue
        const values = resolveValue(entry.values, context)
        points += Array.isArray(values) ? values.length : 0
      }
      return categories + points
    }
    if (name === 'PieChart') {
      return Array.isArray(component.slices) ? component.slices.length : 0
    }
    if (name === 'FramePlayer') {
      const frames = Array.isArray(component.frames) ? component.frames : []
      let items = 0
      for (const frame of frames) {
        if (isPlainObject(frame) && Array.isArray(frame.items)) items += frame.items.length
      }
      return items
    }
    if (name === 'Plot') {
      // Count what the renderer actually draws: every scatter point becomes a
      // circle, and every function plot adds `samples` computed points. The old
      // `plots × samples` estimate ignored data-bound scatter series entirely.
      const plots = Array.isArray(component.plots) ? component.plots : []
      const requested = typeof component.samples === 'number' ? component.samples : 240
      const samples = Math.max(8, Math.min(1200, requested))
      let units = 0
      for (const plot of plots) {
        if (!isPlainObject(plot)) continue
        const points = resolveValue(plot.points, context)
        if (Array.isArray(points)) units += points.length
        const scatter = plot.kind === 'scatter' || typeof plot.expression !== 'string'
        if (!scatter) units += samples
      }
      return units
    }
  } catch {
    return 0
  }
  return 0
}

/**
 * Estimate how large a surface becomes when rendered.
 *
 * @param state folded surface (components + data model).
 * @param maxNodes override the node budget (defaults to `LIMITS.maxExpandedNodes`).
 * @param maxDataUnits override the data-unit budget.
 */
export function estimateExpansion(
  state: SurfaceState,
  maxNodes: number = LIMITS.maxExpandedNodes,
  maxDataUnits: number = LIMITS.maxExpandedDataUnits,
): ExpansionEstimate {
  let nodes = 0
  let dataUnits = 0
  const stack: Frame[] = [{ id: 'root', depth: 0 }]
  while (stack.length > 0) {
    const frame = stack.pop() as Frame
    if (frame.depth > LIMITS.maxDepth) {
      nodes += 1
      if (nodes > maxNodes) return { nodes, dataUnits, reason: `expands to more than ${maxNodes} rendered components` }
      continue
    }
    const component = state.components.get(frame.id) as Record<string, unknown> | undefined
    if (component === undefined) continue
    nodes += 1
    if (nodes > maxNodes) return { nodes, dataUnits, reason: `expands to more than ${maxNodes} rendered components` }

    dataUnits += dataUnitsOf(component, state, frame.item)
    if (dataUnits > maxDataUnits) return { nodes, dataUnits, reason: `renders more than ${maxDataUnits} data rows, points or animation items` }

    // Template child list: expand it here so the estimate counts repetitions.
    const children = component.children
    if (isChildTemplate(children)) {
      const list = resolveBinding(children.path, contextFor(state, frame.item))
      if (Array.isArray(list)) {
        if (nodes + list.length > maxNodes) {
          return { nodes: nodes + list.length, dataUnits, reason: `expands to more than ${maxNodes} rendered components` }
        }
        for (const item of list) stack.push({ id: children.componentId, item: item as JsonValue, depth: frame.depth + 1 })
        continue
      }
    }
    for (const reference of childReferences(component)) {
      stack.push({ id: reference.id, item: frame.item, depth: frame.depth + 1 })
    }
  }
  return { nodes, dataUnits }
}
