# dsh-a2ui — Generative UI for DeepSeek Harness

[![CI](https://github.com/ChimeSky/dsh-a2ui/actions/workflows/ci.yml/badge.svg)](https://github.com/ChimeSky/dsh-a2ui/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-8A2BE2)](https://github.com/topics/dsh-plugin)
[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)

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

## Status (v0.2.1)

> This is the correctness and safety release: A2UI 1.0 alignment (all 43 official catalog examples pass), a build that never deletes a file, and a bounded regex evaluator. See [CHANGELOG.md](CHANGELOG.md) for the itemised list.

| Capability | Status |
|---|---|
| Host tool registration (`a2ui`, `a2ui_catalog`) | Done |
| A2UI 1.0 validation (`createSurface` / `updateComponents` / `updateDataModel` / `deleteSurface`) | Done |
| Inline native rendering via `tool.call.toolview` | Done |
| All 18 official basic-catalog components | Done |
| Extension catalog: Table / Bar / Line / Pie / Stat / Progress / Plot / FramePlayer | Done |
| Data-model bindings + local functions (`formatString`, `formatNumber`, validators, …) | Done |
| Round trip (button/form → session → agent) | Done |
| Multiple surfaces, incremental updates within one call | Done |
| Session restore, replay without side effects | Done (derived from the log) |
| Light/dark theme, responsive, keyboard, ARIA | Done (`--dsw-alias-*` tokens) |
| Character-level streaming render | Partial: renders as soon as the call reaches `start`; further tool calls update incrementally |
| Replacing an existing card in place across calls | Not implemented (see [Known limitations](#known-limitations)) |
| `callRendererFunction` / `agentFunctionResponse` | Not supported: explicitly rejected with a reason |
| PTC (`run_code`) sub-call presentation | Partial: renders as a sub-call row, not styled specifically |

---

## Install, enable, disable, remove

The plugin ships as a **bundle** (`dsh.bundle` + `dsh.client`): the repository root is the installable package, providing both the Host and browser halves. Build artifacts are committed, so installing does not compile anything.

**A — from GitHub (recommended).** Run `dsh plugin --profile desktop add github:ChimeSky/dsh-a2ui#v0.2.1`. The tag pins the install; replace `desktop` with the target profile (usually `web` for the web build).

**B — frozen tarball.** `vendor/dsh-a2ui-0.2.1.tgz` matches the tested bytes: `dsh plugin --profile desktop add <absolute path>/vendor/dsh-a2ui-0.2.1.tgz`. `tools/install.ps1` wraps install, uninstall and an installed-copy check.

**C — DSH plugin manager.** Run `plugin_manager action=install_bundle target=<absolute path or tarball>`. The bundle is written to the active profile (Desktop uses `desktop`) and appears in Settings → Plugins. New bundles activate through HMR; replacing an already-installed package requires a restart to load a fresh JavaScript module generation.

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

### Examples

A single call can compose a complete surface: a card with `ChoicePicker` and `Button` for choosing a plan; `BarChart` and `LineChart` sharing one data model; `Slider` bound to `Plot` variables for local redraws; `FramePlayer` playing precomputed step animations. Exact parameters, component properties and allowed values are in the `a2ui_catalog` `full` output.

---

## How a user action reaches the agent

Clicking a button whose action is `action.event` (or submitting a form) builds an A2UI 1.0 `action` message and sends a message starting with `[A2UI action]` through the **session's own Conversation service** as a normal queued user message. The payload carries `name`, `surfaceId`, `sourceComponentId`, `timestamp` and the `context` resolved against the current data model.

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
| Expanded-size budget | Before rendering, the expanded **node** count (templates multiply by data length) and data units (table rows + chart points + animation items + Plot scatter points) are estimated: one surface above 4000 nodes or 5000 units, or one call above 6000 nodes / 6000 units in total, is rejected. Host and client share the estimator |
| Catastrophic regex | `regex` runs the specification's static safety check (longer than 256 code points; a bounded-above-1 quantifier over a subexpression with an unbounded one; an unbounded quantifier over alternatives sharing a first character; adjacent unbounded quantifiers with overlapping character sets) and rejects backreferences, lookbehind, named groups, `\p{...}`, `\cX` and inline flags. Input is capped at 4096 code points. A literal pattern fails validation; a bound one is refused at evaluation |
| Deep JSON | `isJsonValue` is iterative and bounded at 128 levels, checked before any serialization: an 11,000-level array is rejected instead of overflowing the stack |
| Hostile JSON Pointers | Path ≤ 1024 chars, ≤ 64 segments, array index ≤ 10000, no `__proto__`/`prototype`/`constructor`, sparse writes refused (no hole-punched arrays), `-` append supported. A refused write is reported at `updateDataModel.path` instead of claiming success |
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
2. **Each card contains only its own call's messages.** One tool call is one self-contained card: the renderer folds that call's messages, so `createSurface → updateComponents → updateDataModel` inside one call composes correctly (including delete-then-create), but a **cross-call** `updateComponents` / `updateDataModel` / `deleteSurface` does not modify a card rendered in an earlier turn — it renders as an "interface updated" note instead of replacing the card in place.
   - To show a **changed** interface, send a **complete** `createSurface` (components plus `dataModel`); see [Example — interactive card](#example--interactive-card).
   - To remove an old card, `deleteSurface` and re-create it **within the same call**.
   - True cross-call live surfaces need a DSH session-projection change and are a separate piece of work; the snapshot contract above is what this release supports (locked by 8 regression tests).
3. **No character-level streaming.** The surface renders when the call reaches `start`; `preparing` shows a skeleton. Chained tool calls in one turn produce incremental UI.
4. **`callRendererFunction` / `agentFunctionResponse` unsupported.** They need an agent→renderer channel between tool calls, which the tool model does not provide; sending them yields an explicit error.
5. **PTC / code mode**: `run_code` sub-calls render as nested rows without dedicated styling.
6. **Media needs the network** except `data:` images.
7. **Relative bindings inside template items are read-only**; editing requires an absolute `/...` path.
8. **`regex` has a match work limit.** Accepted patterns run on a bounded evaluator capped at 100,000 steps per match; hitting the cap returns `valid: false` with `pattern exceeded the match work limit`. An extremely long **non-matching** input can therefore be reported as invalid (common shapes are unaffected: greedy-first evaluation means ordinary inputs never need exhaustive backtracking). Combine a higher constant with the 4096-code-point input cap if you need looser semantics.

---

## Development

```bash
npm install --ignore-scripts     # typescript/@types + react/react-dom/jsdom (test and render checks only)
npm run typecheck                # tsc --noEmit
npm run build                    # tsc + module linker → index.js, lib/**, client.js (written into the repo root)
npm test                         # all cases (node:test, in-process; includes the jsdom DOM cases)
npm run verify                   # pre-install bundle invariants
npm run render                   # real-React render check over in-repo fixtures (no network)
npm run pack:vendor              # regenerate vendor/dsh-a2ui-<version>.tgz
npm run all                      # all of the above
```

**The build never deletes a file.** The compiler emits into memory; linking and the `lib/**` copy are driven by that emit manifest. If `lib/` still holds a file that belongs to no current module, the build **prints its full path** rather than removing it — remove that exact file yourself with `Remove-Item "path"` if it is unwanted.

The build does not use esbuild: its native service needs pipes that the Windows sandbox refuses (`spawn EPERM`). `tools/build.mjs` compiles in-process through the TypeScript compiler API, then links the browser half into one file with a ~120-line module registry wrapped in `__ModuleLoader__.load({ id, factory })`. `npm test` uses `tools/run-tests.mjs` for the same reason (no child process per file). `index.js`, `lib/**` and `client.js` are build artifacts committed to the repository so that `dsh plugin add github:` works without a build step; rerun `npm run build` and commit after changing `src/`.

The pinned official catalog examples live in `tests/fixtures/examples` (commit `58379ad`) and are validated by `npm test`; `tools/fetch-fixtures.mjs` downloads them again.

---

## Test results

See [docs/TEST-REPORT.md](docs/TEST-REPORT.md) for the acceptance scenarios, the 130 automated cases (including 10 jsdom DOM cases and the 43 official examples), the 11 real-React render cases, and an explicit split between "verified in a real DSH Desktop session" and "verified headlessly only".

---

## License and attribution

- This plugin: MIT (see [LICENSE](LICENSE)).
- A2UI specification, catalog ids and component/function names: A2UI project, Copyright 2024 Google LLC, Apache-2.0. No upstream source code is copied; the validator and renderer are independent implementations of the published schemas. See [NOTICE](NOTICE).
- The DSH integration uses public extension points only; no Harness source is modified or vendored.
