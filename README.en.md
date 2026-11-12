# dsh-a2ui — Generative UI for DeepSeek Harness

*Bring interactive, agent-generated interfaces into DeepSeek Harness through the Google A2UI protocol.*

[简体中文](README.md) | **English**

---

## What it is

`dsh-a2ui` is an installable DeepSeek Harness (DSH) plugin that integrates **Google A2UI 1.0** (Agent-to-User Interface) into the chat surface:

- The agent calls the `a2ui` tool with a list of **A2UI 1.0 messages**.
- The Host validates them against the official schema (surface ids, component graph, properties, data bindings, resource limits).
- The browser renders them **inline in the conversation** as native-looking cards, tables, charts, forms, sliders and animations.
- When the user clicks a button or submits a form, the plugin sends the A2UI `action` event back to the current session as an ordinary user message and the agent continues.

Rendering is derived entirely from the **session log**: no plugin-private persistence, so reopening a conversation restores the UI, and replay never re-fires an action.

> This is a **protocol implementation**, not a custom HTML/JSON lookalike. Message names, component types, property names and function signatures come from the A2UI v1.0 schemas (see [Compatibility](#compatibility)); extra components are declared through a **custom catalog**, not by bypassing the protocol.

---

## Status (v0.1.0)

| Capability | Status |
|---|---|
| Host tool registration (`a2ui`, `a2ui_catalog`) | ✅ |
| A2UI 1.0 validation (`createSurface` / `updateComponents` / `updateDataModel` / `deleteSurface`) | ✅ |
| Inline native rendering via `tool.call.toolview` | ✅ |
| All 18 official basic-catalog components | ✅ |
| Extension catalog: Table / Bar / Line / Pie / Stat / Progress / Plot / FramePlayer | ✅ |
| Data-model bindings + local functions (`formatString`, `formatNumber`, validators, …) | ✅ |
| Round trip (button/form → session → agent) | ✅ |
| Multiple surfaces, incremental updates within one call | ✅ |
| Session restore, replay without side effects | ✅ (derived from the log) |
| Light/dark theme, responsive, keyboard, ARIA | ✅ (`--dsw-alias-*` tokens) |
| Character-level streaming render | ⚠️ Partial: renders as soon as the call reaches `start`; further tool calls update incrementally |
| Replacing an existing card in place across calls | ❌ (see [Known limitations](#known-limitations)) |
| `callRendererFunction` / `agentFunctionResponse` | ❌ Explicitly rejected with a reason |
| PTC (`run_code`) sub-call presentation | ⚠️ Renders as a sub-call row, not styled specifically |

---

## Install, enable, disable, remove

The plugin ships as a **bundle** (`dsh.bundle.patch` + `dsh.client`), providing both the Host and browser halves from one package.

**Recommended — via the DSH plugin manager:**

```text
plugin_manager  action=install_bundle  target=<absolute path>/plugins/a2ui/package
```

This installs the package into the active profile (the Desktop build uses `desktop`) and selects the bundle; it also appears in Settings → Plugins. New bundles activate through HMR; replacing an already-installed package requires a restart to load a fresh JavaScript module generation.

- Disable: `plugin_manager action=set_plugin target=dsh-a2ui enabled=false`. The two tools disappear from the model, the prompt section is removed, the chat view is no longer registered, and styles/dictionaries are disposed with their `ctx.effect` — ordinary chat is unaffected.
- Enable: `enabled=true`.
- Remove: `plugin_manager action=remove_bundle target=dsh-a2ui`.

---

## How the agent generates UI

Two tools plus one short prompt section:

- **`a2ui`** — `messages: object[]` (required), `title?: string`. Returns `{ ok, surfaces[], warnings[], note }`.
- **`a2ui_catalog`** — returns the component/function reference on demand (`detail: "brief" | "full"`). The prompt only carries the *rules* for when a UI helps, so the full component table costs tokens only when actually needed.

The prompt section requires Markdown for explanations and reserves the UI for things that are better seen than read: data comparison, charts, KPI tiles, configurable parameters, structured forms, step animations, approval controls. It also forbids repeating in prose what the surface already shows.

### Trigger policy (proactive by default, `autoRender: true`)

**The user does not have to say "chart", "visualize", "UI" or "a2ui".** The guidance tells the model to decide from *what the answer contains*:

| Content | Surface |
|---|---|
| 3+ comparable rows (options, versions, items, before/after) | `Table`; 2-4 headline numbers as a `Row` of `Stat` |
| Values over time / across categories / as shares | `BarChart`, `LineChart`, `PieChart` |
| Target, progress, coverage | `Progress`, `Stat` with trend |
| A value worth trying, or a formula | `Slider` + `Plot` bound to the data model |
| Discrete steps, ordering, algorithm walk-through | `FramePlayer` |
| Input or approval the user must give | form components + one submit/approve button |

**No surface** for: a single fact, a definition, yes/no, a greeting, a one-or-two-sentence explanation, code, diffs, logs, paths. Numbers a surface already shows must not be repeated in text.

Cost: the guidance is ~2.8 KB (~700 tokens) of always-on prompt; the component reference still loads on demand through `a2ui_catalog`.

| Config | Default | Meaning |
|---|---|---|
| `autoRender` | `true` | `false` switches to "only when requested or clearly needed", tightening both the prompt and the tool description |
| `catalogTool` | `true` | register the `a2ui_catalog` reference tool |
| `sectionOrder` | `120` | order of the prompt section |
| `muteSection` | `false` | drop the prompt section entirely (tools stay) |
| `toolName` | `a2ui` | **not recommended**: the client view is registered under this name |

### Example — interactive card

```json
{
  "title": "Choose a plan",
  "messages": [{
    "version": "1.0",
    "createSurface": {
      "surfaceId": "plan",
      "dataModel": { "plan": ["pro"] },
      "components": [
        { "id": "root", "component": "Card", "child": "body" },
        { "id": "body", "component": "Column", "children": ["t", "picker", "btn"] },
        { "id": "t", "component": "Text", "text": "**Choose your plan**" },
        { "id": "picker", "component": "ChoicePicker", "label": "Plan",
          "options": [{ "label": "Starter", "value": "free" }, { "label": "Pro", "value": "pro" }],
          "value": { "@path": "/plan" } },
        { "id": "btnLabel", "component": "Text", "text": "Continue" },
        { "id": "btn", "component": "Button", "variant": "primary", "child": "btnLabel",
          "action": { "event": { "name": "choose-plan", "context": { "plan": { "@path": "/plan" } } } } }
      ]
    }
  }]
}
```

### Example — parameter exploration (sliders drive a plot locally)

```json
{
  "messages": [{
    "version": "1.0",
    "createSurface": {
      "surfaceId": "quad",
      "dataModel": { "a": 1, "b": 0, "c": -4 },
      "components": [
        { "id": "root", "component": "Column", "children": ["a", "b", "c", "plot"] },
        { "id": "a", "component": "Slider", "label": "a", "min": -5, "max": 5, "value": { "@path": "/a" } },
        { "id": "b", "component": "Slider", "label": "b", "min": -5, "max": 5, "value": { "@path": "/b" } },
        { "id": "c", "component": "Slider", "label": "c", "min": -10, "max": 10, "value": { "@path": "/c" } },
        { "id": "plot", "component": "Plot",
          "plots": [{ "label": "f(x)", "expression": "a*x^2 + b*x + c" }],
          "variables": { "a": { "@path": "/a" }, "b": { "@path": "/b" }, "c": { "@path": "/c" } },
          "xMin": -6, "xMax": 6 }
      ]
    }
  }]
}
```

---

## How a user action reaches the agent

Clicking a button whose action is `action.event` (or submitting a form) builds an A2UI 1.0 `action` message and sends it through the **session's own Conversation service** as a normal queued user message:

````text
[A2UI action] Generate a study plan

```json
{"version":"1.0","action":{"name":"generate-plan","surfaceId":"study","sourceComponentId":"submit","timestamp":"2026-11-12T12:34:56.000Z","context":{"level":["beginner"],"hours":8,"goal":"become a backend dev","algorithms":true}}}
```
````

- It uses the native message path, so Host admission rules (running turn, queue limits, permissions) apply exactly as if the user had typed it. A surface cannot grant itself capabilities.
- `context` values are resolved against the **current data model** at click time, so edited form values are always included.
- Only `action.event` bothers the agent; `action.functionCall` (e.g. `openUrl`) runs locally.
- Replay never re-fires an action: it always takes a real click.

---

## Components

Default `catalogId` is `dsh-a2ui/catalog/v1` (everything below); the official basic catalog id is also accepted (first 18 only).

### Official basic catalog (18)

`Text`, `Image`, `Icon`, `Video`, `AudioPlayer`, `Row`, `Column`, `List`, `Card`, `Tabs`, `Modal`, `Divider`, `Button`, `TextField`, `CheckBox`, `ChoicePicker`, `Slider`, `DateTimeInput` — plus `checks` validation rules (`required`, `regex`, `length`, `numeric`, `email`) that disable the action button and show the message when they fail.

### Extension catalog (8)

| Component | Notes |
|---|---|
| `Table` | Column declarations + rows; number/currency/percent/date formatting, alignment, horizontal scroll, 40-row fold |
| `BarChart` | Grouped, stacked or horizontal bars |
| `LineChart` | Line, area, smooth curves, point markers |
| `PieChart` | Pie or donut with a percentage legend |
| `Stat` | KPI tile: value, unit, delta, trend colour |
| `Progress` | Progress bar with tone |
| `Plot` | Safe arithmetic function plot; `variables` may bind to the data model for local redraws |
| `FramePlayer` | Step animation (play/pause/step/reset/speed) over precomputed frames |

`Plot` expressions are evaluated by a **hand-written parser** that accepts only numbers, `x`, caller-supplied variables, `+ - * / ^ %`, parentheses, and a closed set of math functions. `this`, `window`, `constructor`, and anything outside the whitelist fail to compile. No `eval`, no `new Function`.

---

## Architecture

```text
DeepSeek Agent
   │  a2ui({ messages, title })
   ▼
Host  ──  catalog + schema validation (surface / component / property / binding / depth / quota)
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

Design choices:

1. **The UI is the log.** One tool call is one self-contained surface snapshot; the renderer folds only that call's messages. No private store, restore is a re-render, replay is idempotent.
2. **Validate twice, implement once.** `src/shared` is imported by both halves, so "server accepts, browser crashes" cannot happen.
3. **Edits stay local.** Slider/input writes go to a copy-on-write model in component state, never into the log.
4. **Zero runtime dependencies.** The browser half only `require`s `react`; charts are hand-written SVG (no CDN, no chart library, offline-capable).

---

## Security

| Risk | Handling |
|---|---|
| Model-authored HTML/script | All text is a React text node; inline Markdown only produces `<strong>/<em>/<code>/<br>`; `dangerouslySetInnerHTML` does not exist in the bundle |
| Arbitrary code execution | No `eval` / `new Function`; `Plot` uses a whitelist arithmetic parser |
| Hostile URLs | `safeMediaUrl` admits only `http(s)` (plus `data:image/*;base64` for images); `javascript:`, `file:`, `data:text/html` are rejected; `openUrl` requires a user gesture |
| Unknown components/properties | Rejected at validation with a JSON path; the renderer additionally degrades to a readable placeholder instead of throwing (a throw blanks the whole slot) |
| Oversized/deep/cyclic graphs | 32 messages, 300 components per message, 400 per surface, depth 64, 16K strings, 500 series points, 400 frames, 384K payload; cycle and duplicate-id detection |
| Privilege escalation | A surface can only ask the agent for work through a normal user message; files/commands/network still go through the agent's tools and approvals |
| Plugin isolation | Every registration is owned by `ctx.effect`; disabling removes the view, styles, dictionaries, tools and prompt section |

Trade-off: `Image` accepts `https://` URLs, so rendering causes a request to that host (no credentials, `referrerPolicy="no-referrer"`). For a fully offline setup, use `data:` images only.

---

## Compatibility

| Item | Version |
|---|---|
| Verified on | **DSH 0.2.2-rc.1** (Desktop/Web, profile `desktop`) |
| `engines.dsh` | `>=0.2.2-rc.1 <0.3.0-0` |
| A2UI protocol | **1.0** (`version: "1.0"`; v0.8/v0.9 payloads are rejected with a clear message) |
| Spec source | v1.0 zod schemas + basic catalog in `@a2ui/web_core@0.15.0` (Apache-2.0) |
| Node | ≥ 20 (build requires `typescript`) |
| Browser side | only `react`, provided by the Harness module table |

**Why the official `@a2ui/react` renderer is not used:** its basic catalog has no Table/Chart/Progress/Select (the chart catalog is unpublished), it ships its own Material-style components and CSS that would clash with `--dsw-alias-*` theming, and it adds `zod` + `markdown-it` to a single-file client bundle where only `react` is guaranteed. The protocol layer, validator and action channel are therefore reimplemented from the official schemas; swapping in the official renderer would mean replacing `src/client/surface.tsx` only.

---

## Interaction (local by default, no agent traffic)

| Interaction | Behaviour |
|---|---|
| Chart hover | Bar / line / pie highlight the point and show an in-chart tooltip; the line chart adds a guide line and lists every series at that category; pie slices lift out and the centre shows that slice's value and share |
| Legend click | Shows/hides a series (local redraw) |
| Table header | Click to sort (asc, desc, off) with `aria-sort` |
| Tabs / sliders / animation | Switch, redraw, play/pause/step/speed — all local |
| `action.event` buttons | **Only these send a message and start a turn**, and their hover text says so; the prompt only allows them for an explicit submit/approve/refresh request |

The rule: anything the interface can do locally must not send a message. Sorting, legend toggling, tooltips, tab switching and slider redraws are pure client state.

## Known limitations

1. **Placement and the "never disappears" guarantee.** The card has two hosts: the **turn tail** (`conversation.chat.turnTail`), which renders after the turn's answer in the main flow and never folds with the process area, and the **process row** (`tool.call.toolview`), used while the tool is still running and as the fallback. They coordinate through **copy claims**: while the tail copy is mounted it claims the call and the process row collapses to a one-line pointer; the moment the tail copy unmounts for any reason (paging, a new turn, an aborted turn) the claim is released and the process row restores the full card. The interface therefore degrades to an expandable row instead of vanishing.
2. **Cross-call updates appear as a new card.** A2UI allows `updateComponents` to modify an existing surface; this renderer treats one tool call as one self-contained card, so a later call updating the same surface appends a card (the older one shows "interface data updated") instead of replacing it in place. Updates *within* one call are fully supported.
3. **No character-level streaming.** The surface renders when the call reaches `start`; `preparing` shows a skeleton. Chained tool calls in one turn produce incremental UI.
4. **`callRendererFunction` / `agentFunctionResponse` unsupported.** They need an agent→renderer channel between tool calls, which the tool model does not provide; sending them yields an explicit error.
5. **PTC / code mode**: `run_code` sub-calls render as nested rows without dedicated styling.
6. **Media needs the network** except `data:` images.
7. **Relative bindings inside template items are read-only**; editing requires an absolute `/...` path.

---

## Development

```bash
npm install --ignore-scripts     # typescript/@types only (esbuild's postinstall needs pipes the sandbox forbids)
npm run typecheck                # tsc --noEmit
npm run build                    # tsc + module linker → package/index.js, package/lib/**, package/client.js
npm test                         # 57 cases (node:test, in-process)
npm run verify                   # pre-install bundle invariants
npm run all                      # all of the above
```

The build does not use esbuild: its native service needs pipes that the Windows sandbox refuses (`spawn EPERM`). `tools/build.mjs` compiles in-process through the TypeScript compiler API, then links the browser half into one file with a ~120-line module registry wrapped in `__ModuleLoader__.load({ id, factory })`. `npm test` uses `tools/run-tests.mjs` for the same reason (no child process per file).

---

## Test results

See [docs/TEST-REPORT.md](docs/TEST-REPORT.md) for the ten acceptance scenarios, the 57 automated cases, and an explicit split between "verified in a real DSH Desktop session" and "verified headlessly only".

---

## License and attribution

- This plugin: MIT (see [LICENSE](LICENSE)).
- A2UI specification, catalog ids and component/function names: A2UI project, Copyright 2024 Google LLC, Apache-2.0. No upstream source code is copied; the validator and renderer are independent implementations of the published schemas. See [NOTICE](NOTICE).
- The DSH integration uses public extension points only; no Harness source is modified or vendored.
