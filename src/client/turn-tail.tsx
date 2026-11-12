/**
 * `conversation.chat.turnTail` entry: the A2UI card in the main conversation.
 *
 * Why this slot: a `tool.call.toolview` lives inside the turn's "process"
 * window, which DSH folds for every completed turn that is no longer the newest
 * (`ChatNodeSeat`: `defaultOpen = bottom && deferCollapse`, hidden by
 * `processMember && !processOpen`). The turn tail renders after the turn's
 * answer, outside that window, which is exactly how the shipped action cards
 * keep their card visible.
 *
 * The card itself is the same component the tool row uses, so both surfaces stay
 * identical; only the host slot differs.
 */
import * as React from 'react'
import { h } from './h.js'
import type { ClientRuntime } from './tool-view.js'
import { A2UIToolView } from './tool-view.js'
import { collectA2uiRoots } from './surfaces.js'

type Selector = (state: unknown) => unknown

export interface TurnTailProps {
  turn?: { turn?: number; status?: string }
  seq?: number
  sessionId?: string
  runtime: ClientRuntime
  /** Chat store hooks supplied by the slot runtime. */
  useChat?: (selector: Selector) => unknown
  useConversation?: (selector: Selector) => unknown
}

interface ChatState {
  order?: string[]
  nodes?: unknown
}

/**
 * Render every `a2ui` surface produced by one completed turn.
 *
 * The selector reads only `order` and `nodes`, which are stable references the
 * store replaces on change; the derived list is memoized so an unrelated node
 * update does not re-render the cards.
 */
export function A2uiTurnTail(props: TurnTailProps): ReturnType<typeof h> | null {
  const { turn, sessionId, runtime } = props
  const useChat = props.useChat

  const order = (useChat?.((state) => (state as ChatState).order) ?? []) as string[]
  const nodes = useChat?.((state) => (state as ChatState).nodes)

  const entries = React.useMemo(
    () => collectA2uiRoots(order, nodes, turn?.turn, 'a2ui'),
    [order, nodes, turn?.turn],
  )

  if (entries.length === 0) return null

  return h(
    'div',
    { className: 'a2ui-tail' },
    ...entries.map((entry) =>
      h(A2UIToolView, {
        key: entry.key,
        // The call id is what the row copy uses, so both hosts claim the same id.
        callId: entry.root.callId ?? entry.key,
        toolName: 'a2ui',
        phase: entry.phase,
        block: entry.root,
        sessionId,
        mode: 'tail',
        runtime,
      }),
    ),
  )
}

export type { ChatNodeLike } from './surfaces.js'
