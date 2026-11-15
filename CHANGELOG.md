# Changelog

All notable changes to this plugin. Version numbers follow [SemVer](https://semver.org/); the
`engines.dsh` range states which DeepSeek Harness releases a version was verified against.

## 0.3.0 — 2026-11-15

Progressive streaming release. The card is now drawn **while** the model is still writing the tool
arguments, instead of appearing all at once when the arguments finish.

### Added

- **Progressive streaming render.** A call in the `preparing` stage is drawn from the argument
  fragments that have already *closed*: finished messages and finished components are folded with
  the same `applyMessageBatch` the settled snapshot uses, so a surface grows instead of being
  rebuilt. Components that are referenced but have not arrived render as skeleton placeholders
  rather than "missing child" errors, and nothing is drawn before `root` exists (no empty card
  flash).
- **Out-of-band fragment observation.** The plugin registers a Conversation Definition with **no
  view target** (`kind: a2ui-stream`) that copies `tool-call-delta` text from
  `assistant/live-chunk` events per call id. A target-less Definition materialises no Node, so the
  transcript, the process window and history replay are untouched; the copy is released as soon as
  the call settles.
- **`src/shared/partial-json.ts`** — a recovery scanner that only ever returns values whose own
  slice `JSON.parse` accepts, with a nesting bound (128), a scan cap (512 KiB) and an explicit
  `invalid` answer for a prefix it cannot follow.
- **`src/shared/stream.ts`** — the streaming fold: per-component structural checks, the same render
  budget as the settled path, and a `stopped` flag for a prefix that must not be drawn.

### Behaviour

- The preview is **not interactive**: the card is `pointer-events: none` with `aria-busy`, and
  submit/write paths are disabled until the call settles and its payload passes Host validation.
- Nothing about authority changed: `validateToolArguments` still decides what may render and
  reports the precise error. A preview that hits malformed syntax or the render budget stops and
  falls back to the skeleton.
- Bounds: 256 KiB of fragment text per call (truncated beyond that), 120 s retention after the last
  fragment, 512 KiB scanned per frame, recovered nesting depth 128.

### Tests

- 26 cases in `tests/streaming.test.mjs`: recovery of a truncated payload,
  monotonic growth over every prefix of a real payload, escape decoding,
  malformed/depth refusal, create+update merging, structural skipping, a
  closed-but-illegal component (the review's `Tabs` payload and a bad `Table`),
  per-surface and per-call budget stops, cache bounding (per call, entries,
  total characters), replay idempotence, tool-name filtering, concurrent calls,
  release on settle, and the `apply()`-level registration test whose fake
  registry reads `this` (calling it detached throws there too).
- 5 real-React render cases driven through the shipped `client.js`: a preparing
  card draws the components that arrived, drops the half-written one, keeps the
  skeleton when nothing is usable, refuses the illegal `Tabs`, and the settled
  path still reports that same payload as invalid.
- 1 jsdom case: the preview body is inert and a synthetic click queues nothing,
  and the same call settled is a normal interactive card again.
- 3 bundle invariants (the observer, the fragment reader, the recovery bound).

### Fixed (review pass)

- **The observer never registered.** `events.register` was taken out of the
  registry object and called as a plain function, so `this` was lost and the
  call threw inside the guard — the preview silently stayed at the skeleton in
  every real session. It is now invoked on the registry, and a regression test
  goes through `apply()` with a registry whose `register` reads `this` (calling
  it detached throws there too, so the test fails if the bug returns).
- **Replaying a window duplicated the prefix.** The cache was a global log that
  `start`/`update` appended to unconditionally, so a second replay of the same
  events produced `{"messages":[{{"messages":[{`. The text now lives in the
  Definition state, which the engine rebuilds from the earliest match, and the
  cache is a replacement of that state: replay is idempotent.
- **Foreign tools were collected.** Every `tool-call-delta` was kept, including
  another tool's arguments. Only calls the host names `a2ui` are tracked now, and
  a name-less fragment is appended only to a call that is already identified.
- **The cache had no lifecycle.** Entries were released only when a mounted card
  settled, and only bounded per call. `tool/call` and `tool/result` now release
  the entry, the plugin's own teardown clears the cache, and the cache is bounded
  in entries (32) and total characters (1 MiB) as well as per call.
- **A closed component was not validated.** `{"id":"root","component":"Tabs",
  "tabs":[null]}` was accepted by the preview and threw while rendering. Closed
  components now go through the settled path's own property validation
  (`checkComponentAlone`), so an illegal component is dropped, an illegal root
  falls back to the skeleton, and the same payload still produces the original
  validation error once settled.
- **The aggregate budget was not enforced.** Two surfaces of 3,501 nodes each
  passed the preview (7,002 in total) while the settled path rejects the call at
  6,000. The preview now accumulates expanded nodes and data units across the
  call against the same `LIMITS`, keeps the surfaces that already fit, and skips
  a surface over its own budget; message, surface and component counts are
  enforced too.
- **The preview was reachable from the keyboard.** `pointer-events: none` stops
  the mouse only, so Tab still entered a preview's tab strip. The preview body is
  `inert` now (set through the DOM, so it works on React 18 and 19), and a DOM
  test asserts the attribute is present while generating and gone once settled.
- **Preview failures could blank the slot.** A preview-only error boundary shows
  the skeleton instead; it is deliberately scoped to the preview so a settled
  card still surfaces its own errors.

## 0.2.1 — 2026-11-13

### Fixed

- **Bar chart tooltip placement.** The hover tooltip is now an HTML overlay anchored to the hovered
  bar and clamped to the plot area, so long labels and narrow cards no longer push it outside the
  chart or into the axis labels; it also clears when a series is hidden from the legend. Grouped,
  stacked and horizontal bars are covered by DOM tests that mock the layout geometry.

## 0.2.0 — 2026-11-13

Correctness and safety release. It aligns the renderer and the validator with the published A2UI
1.0 specification (all 43 official catalog examples now pass), removes every file deletion from the
build, and replaces the unbounded regex path with a bounded evaluator.

### Fixed

- **Same-call message folding.** `createSurface → updateComponents → updateDataModel` inside one
  tool call now composes; previously each message was folded against the state from *before* the
  call, so in-call updates and data writes were silently dropped. Deleting and re-creating a
  surface in one call now reports `deleted: false` and leaves no stale components behind.
- **Template scope.** Components nested inside a repeated template row resolve relative paths
  against that row (the official `00_incremental` example rendered empty labels with four
  "Book now" buttons); a row's button carries its own row values in the action `context`.
- **Official field aliases.** `@checks`, `@catalogId`, `@accessibility` and `@metadata` normalize to
  their plain names; an alias and the plain name must agree, and a conflict is reported at the alias.
- **Refused data-model writes.** A write that cannot be applied (`{arr:[]}` + `/arr/500`) is reported
  at `/messages/<i>/updateDataModel/path` instead of being reported as a successful update.
- **Pure date fields.** A `date` control no longer shifts through the local time zone: `2026-11-13`
  stays the 13th in every zone, and stored values use UTC midnight so the round trip is stable.
- **Failed sends lock the form.** Only `sending`/`sent` disable inputs; after a rejected send
  (`QUEUE_FULL`) the user can fix the value and retry, and a double click queues one message.
- **Edits survive the card hand-over.** The process row and the turn tail now share one edit model
  and action state per `sessionId + callId + surfaceId`, so an edit made in the row is still there
  when the tail takes over.
- **Turn tail visibility and renamed tools.** Hidden calls no longer appear at the turn tail, and a
  custom `toolName` still renders there through `meta.kind === 'a2ui'`.
- **Bar charts.** The baseline is always visible (positive-only starts at 0, negative-only ends at 0,
  mixed contains 0), explicit `yMin`/`yMax` clip instead of overflowing, stacked positives and
  negatives accumulate separately, and the horizontal variant grows from the baseline both ways.
- **Plots.** `variables` accepts one binding for the whole coefficient object, and a curve that
  leaves the plotted domain breaks instead of drawing a line through a discontinuity (`1/x`).
- **Pie charts.** Slices beyond the visible cap are grouped into one "Other (N)" slice whose value
  is the sum of the remainder, so percentages still add up; the legend reports further entries.

### Security

- **Regex.** The `regex` function now implements the specification's dialect and static safety
  check (>256 code points, a bounded-above-1 quantifier over a subexpression with an unbounded one,
  an unbounded quantifier over alternatives that share a first character, adjacent unbounded
  quantifiers with overlapping character sets; lookbehind, backreferences, named groups,
  `\p{...}`, `\cX` and inline flags are rejected) and evaluates accepted patterns with a bounded
  work-list (100,000 steps per match) instead of handing the whole pattern to a backtracking engine.
  Lookahead is allowed again; `(?:ab){2}` and `([A-Z]){2}` match again.
- **Render budget.** Before any element is created the validator and the renderer estimate the
  expanded node count (templates multiply by data length) and data units (table rows + chart points
  + animation items + plot scatter points): one surface above 4000 nodes or 5000 units, or one call
  above 6000 nodes / 6000 units in total, is rejected.
- **Deep JSON.** `isJsonValue` is iterative and bounded at 128 levels and runs before serialization,
  so an 11,000-level array is rejected instead of overflowing the stack.
- **JSON Pointer limits.** Path ≤ 1024 characters, ≤ 64 segments, array index ≤ 10000; prototype
  segments and sparse writes are refused, `-` append is supported, and `~0`/`~1` still decode.

### Changed

- **Cross-call updates are separate cards.** One tool call renders one self-contained card; the
  system prompt and both READMEs now say so and point at a complete `createSurface` payload when a
  changed interface must be shown. Incremental messages are still accepted.
- **`catalogTool: false`** also removes the `a2ui_catalog` reference from the tool parameter
  description, not only from the prompt section.
- **Documentation.** Known limitations, the security table and the test report were rewritten with
  the measured numbers, and the pinned official examples live in `tests/fixtures/examples`.

### Build and tests

- **The build deletes nothing.** TypeScript now emits into memory; linking, the `lib/**` copy and the
  test harness are driven by that emit manifest, so a stale `lib/` file is reported by its full path
  instead of being removed (or silently reused).
- 130 automated cases (was 70), including 10 jsdom DOM cases that dispatch real clicks, typing and
  keyboard events, and all 43 official catalog examples; 11 real-React render cases.
- `react`, `react-dom` and `jsdom` are dev dependencies; CI runs `npm run render` as well.

### Known limitations

- A pattern that hits the match work limit returns `valid: false` with a message; a long input can
  therefore be reported as non-matching. Common shapes are unaffected (greedy-first evaluation).
- `sendDataModel` is accepted and validated but no full model is echoed back.
- `callRendererFunction` / `agentFunctionResponse` are rejected with an explanatory error.
- Media URLs make a network request when rendered (`referrerPolicy="no-referrer"` only affects the
  referrer).
- Relative bindings inside template items are read-only for edits.
- A custom `toolName` renders at the turn tail but not as a dedicated process row.

## 0.1.0 — 2026-11-12

First installable release: Host tools (`a2ui`, `a2ui_catalog`), the A2UI 1.0 validator, the inline
renderer for the 18 basic-catalog components plus 8 extensions (Table, BarChart, LineChart,
PieChart, Stat, Progress, Plot, FramePlayer), the local interaction loop and the action round trip.
