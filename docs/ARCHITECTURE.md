# dsh-a2ui — Architecture

This document holds the implementation details behind the README's product overview: how a tool call becomes a card, how the streaming preview is recovered, and which limits apply. User-facing behaviour and install instructions live in [README.md](../README.md).

## Layers

```text
DeepSeek Agent
   │  a2ui({ messages, title })
   ▼
Host  ──  A2UI 1.0 schema validation (surface / component / property / binding / depth / quota)
   │      tool result { ok, surfaces, warnings }; a replay copy is kept in result meta
   ▼
Session log (tool/call + tool/result.meta)   ← single source of truth
   │
   ▼
Client ── tool.call.toolview(key="a2ui")
   │      1. read args (or meta)
   │      2. validate again + applyMessageBatch → SurfaceState
   │      3. render the component tree against a local data model
   ▼
Chat UI (multiple surfaces per card)
   │  click / submit
   ▼
conversation.send("[A2UI action] …")  →  current session → agent
```

- **Host** — registers `a2ui` and `a2ui_catalog`, injects the guidance section, validates the payload with the shared validator, and stores a replay copy in the tool result meta.
- **Session log** — the only source of truth. A card is derived from its own tool call; there is no plugin-private store.
- **Client** — registers a `tool.call.toolview` view and a turn-tail view, folds the call's messages with `applyMessageBatch`, and renders the component tree against a local (copy-on-write) data model.

## Validation pipeline

`src/shared/validate.ts` is imported by both halves, so the Host and the browser accept exactly the same payloads:

1. Message envelope: version `1.0`, known message type, surface ids.
2. Component graph: known component, catalog membership, property schema, duplicate ids, cycles, depth.
3. Bindings and calls: JSON Pointer syntax, function names, argument shapes.
4. Resource limits: message count, components per message/surface, payload size, series points, frames.
5. Expanded budget: estimated rendered nodes and data units (templates multiply by data length) are counted before any element is created.
6. Safety: no HTML, no `eval`, URL admission, regex static safety check, iterative deep-JSON check.

A validation failure is reported with a JSON path. The renderer additionally degrades unknown or invalid content to a readable placeholder rather than throwing.

## Surface folding

`applyMessageBatch` folds `createSurface`, `updateComponents`, `updateDataModel` and `deleteSurface` in order. The settled card and the streaming preview use the same folding function; the difference is only which prefix of messages is passed in.

Within one call the folds compose (including delete-then-create). Across calls they do not: each card is a snapshot of its own call.

## Progressive streaming

During the `preparing` stage the model is still writing the tool arguments, so the complete JSON does not exist yet. Since v0.3.0 the card grows from the fragments that have already closed:

1. **Read each Session's event window.** A preparing card subscribes to the already-open Session binding and reads its own `tool-call-delta` fragments. Each Session has its own event window, so two calls with the same ID in different Sessions stay separate.
2. **Collect only calls the host names `a2ui`.** The first fragment of a call carries its tool name; anything else is ignored outright, and a name-less fragment is only appended to a call that is already identified, so another tool's arguments never enter the cache.
3. **Recover only what closed.** The recovery scanner (`src/shared/partial-json.ts`) walks the prefix and returns only values whose own slice `JSON.parse` accepts: finished messages, finished components. A half-written component is dropped, so the preview never shows half a component or invents data.
4. **Keep the Surface and its data until the root arrives.** The preview and settled result share `applyMessageBatch`. A `createSurface` can be followed by data and component updates; the preview draws the accumulated data as soon as the root is ready. Messages with an explicit unsupported version are skipped.
5. **Validate closed components.** The preview uses the settled validator's component type, catalog, property and alias checks. It skips invalid components and shows the skeleton when the remaining Surface cannot be drawn.
6. **Absence is a placeholder.** A child that is referenced but has not arrived renders as a skeleton, never as a "missing child" error.
7. **The preview body is `inert`.** Keyboard, pointer, submit and write interactions are disabled while the card is preparing. The normal card restores its usual focus and interaction behaviour.
8. **Release withdrawn fragments.** A window replacement recomputes the prefix. Settling or cancelling a call clears its prefix, and unmounting the card releases its subscription.

Bounds and stop conditions:

| Limit | Value / behaviour |
|---|---|
| Retained argument text per preview | 262,144 UTF-16 code units, truncated beyond that |
| Cache entries / total size | 32 / 1,048,576 UTF-16 code units, oldest evicted first |
| Characters scanned per frame | 512 KiB |
| Recovered JSON nesting depth | 128 |
| Components per message / per surface | 300 / 400 (an over-limit intermediate is not drawn; the settled result decides) |
| Expanded nodes / data units per call | 6,000 / 6,000 (the same limits as the settled path); beyond that the surfaces that already fit are kept |
| Malformed prefix | Preview stops and falls back to the skeleton; the Host still reports the precise error |
| One surface over its own budget | That surface is skipped; the others keep previewing |

The preview changes no authority: whether a payload may render, and what is wrong with it, is still decided by `validateToolArguments` on the Host. Streaming only replaces *waiting* with *appearing*. Because `assistant/live-chunk` is a transient event, reopening a session always renders the validated cards.

## Card hosting and copy claims

The card has two hosts:

- **Turn tail** (`conversation.chat.turnTail`), rendered after the turn's answer in the main flow and never folded with the process area.
- **Process row** (`tool.call.toolview`), used while the tool is still running and as the fallback.

They coordinate through **copy claims**: while the tail copy is mounted it claims the call and the process row collapses to a one-line pointer; the moment the tail copy unmounts for any reason (paging, a new turn, an aborted turn) the claim is released and the process row restores the full card. The interface therefore degrades to an expandable row instead of vanishing.

A custom `toolName` still renders at the turn tail (matched through `meta.kind === 'a2ui'`), but the process row falls back to a generic tool row.

## Configuration

| Config | Default | Meaning |
|---|---|---|
| `autoRender` | `true` | `false` switches to "only when requested or clearly needed", tightening both the prompt and the tool description |
| `catalogTool` | `true` | register the `a2ui_catalog` reference tool |
| `sectionOrder` | `120` | order of the prompt section |
| `muteSection` | `false` | drop the prompt section entirely (tools stay) |
| `toolName` | `a2ui` | not recommended: the inline process row registers under this name |

## Build and test pipeline

- `tools/build.mjs` compiles `src/**` with the TypeScript compiler API in-process (no esbuild: its native service needs pipes the Windows sandbox refuses), links the browser half into one `client.js`, and copies the Host ESM files into `lib/**`. It never deletes files; stale files are reported by path.
- `tools/run-tests.mjs` loads the test files into one process (no per-file child process). The suite includes protocol, unit, integration, acceptance, DOM (jsdom), streaming and limit cases.
- `tools/render-check.mjs` renders the shipped bundle with real React against the pinned official examples and synthetic cases.
- `tools/verify-bundle.mjs` checks the installable bundle invariants; `tools/verify-fresh-home.mjs` installs it into a throwaway DSH home and checks layout, bundle toggle and version skew.
