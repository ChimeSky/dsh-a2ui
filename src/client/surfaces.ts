/**
 * Transcript lookup used by the turn-tail entry.
 *
 * The turn tail renders in the main conversation column, after the turn's
 * answer, and is therefore never folded with the "process" area. To draw the
 * surfaces a turn produced it needs that turn's `tool-call` nodes, which the
 * slot exposes through the standard `useChat` store (`nodes` map + `order`).
 *
 * Kept as pure functions so the selection logic is unit-testable without a
 * browser: a wrong guess about the store shape must fail a test, not a page.
 */

/** The block a `tool.call.toolview` receives (start, preparing, or result). */
export interface ToolBlockLike {
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
}

export type ToolPhase = 'preparing' | 'start' | 'result'

/** Minimal Chat node shape needed by the lookup (subset of `ChatNode`). */
export interface ChatNodeLike {
  kind?: string
  anchorSeq?: number
  visibility?: string
  location?: { kind?: string; turn?: { turn?: number } }
  data?: { root?: ToolBlockLike }
}

export interface A2uiRootEntry {
  key: string
  root: ToolBlockLike
  phase: ToolPhase
}

/** Node phase, mirroring how the Chat tool node reports its current stage. */
export function toolPhaseOf(root: ToolBlockLike | undefined): ToolPhase {
  if (root === undefined) return 'preparing'
  if (root.kind !== undefined) return 'result'
  return root.phase === 'preparing' ? 'preparing' : 'start'
}

/** The wire tool name of a block, whichever stage it is in. */
export function blockToolName(root: ToolBlockLike | undefined): string | undefined {
  if (root === undefined) return undefined
  return root.name ?? root.call?.name
}

/** Turn number a node belongs to, or `undefined` when it is not turn-scoped. */
export function nodeTurn(node: ChatNodeLike | undefined): number | undefined {
  const location = node?.location
  if (location === undefined) return undefined
  if (location.kind !== 'turn' && location.kind !== 'step') return undefined
  return location.turn?.turn
}

function lookup(nodes: unknown, key: string): ChatNodeLike | undefined {
  if (nodes === null || nodes === undefined) return undefined
  const candidate = nodes as { get?: (key: string) => unknown }
  if (typeof candidate.get === 'function') return candidate.get(key) as ChatNodeLike | undefined
  return (nodes as Record<string, ChatNodeLike>)[key]
}

/**
 * Collect the `a2ui` calls of one turn, in transcript order.
 * @param order node keys in render order.
 * @param nodes key → node store.
 * @param turnNumber the turn being rendered; `undefined` yields an empty result.
 * @param toolName wire tool name, default `a2ui`.
 */
export function collectA2uiRoots(
  order: readonly string[] | undefined,
  nodes: unknown,
  turnNumber: number | undefined,
  toolName = 'a2ui',
): A2uiRootEntry[] {
  if (turnNumber === undefined || !Array.isArray(order)) return []
  const entries: A2uiRootEntry[] = []
  for (const key of order) {
    const node = lookup(nodes, key)
    if (node?.kind !== 'tool-call' || node.visibility === 'hidden') continue
    if (nodeTurn(node) !== turnNumber) continue
    const root = node.data?.root
    if (blockToolName(root) !== toolName) continue
    entries.push({ key, root: root as ToolBlockLike, phase: toolPhaseOf(root) })
  }
  return entries
}
