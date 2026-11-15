/**
 * Progressive rendering: recovering a partly streamed payload, folding it into
 * drawable surfaces, the client cache that carries the raw fragments, and the
 * observer registration that connects the two.
 *
 * The properties that matter and are asserted here:
 *
 * - recovery never invents data: only values whose own slice `JSON.parse`
 *   accepts are ever returned, and a half-written component is never rendered;
 * - a *closed* component is checked exactly like the settled path checks it, so
 *   a preview cannot draw something the real result would reject;
 * - the fold is monotonic while a payload streams in and is bounded per surface
 *   and per call, in the units the settled path uses;
 * - the cache is derived from the Definition's own state, so replaying the same
 *   events twice yields the same prefix instead of a duplicated one;
 * - only calls the host named `a2ui` are collected, and the registration goes
 *   through the registry *method* (the reviewer's `this` bug).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { shared, client } = await import('../build/shared.mjs')
const { recoverArguments, foldStreaming, validateToolArguments, MAX_RECOVERY_DEPTH, LIMITS } = shared
const store = client['stream-store']
const plugin = client.index

/** A complete, valid single-surface call, as the model would write it. */
const SURFACE = {
  version: '1.0',
  createSurface: {
    surfaceId: 'sales',
    catalogId: 'dsh-a2ui/catalog/v1',
    dataModel: { rows: [{ label: 'Q1', value: 3 }] },
    components: [
      { id: 'root', component: 'Column', children: ['title', 'chart'] },
      { id: 'title', component: 'Text', text: 'Revenue' },
      { id: 'chart', component: 'BarChart', categories: ['Q1'], series: [{ label: 'Revenue', values: [3] }] },
    ],
  },
}

const ARGUMENTS = JSON.stringify({ title: 'Quarterly revenue', messages: [SURFACE] })

/* ------------------------------------------------------------------ */
/* Recovery                                                            */
/* ------------------------------------------------------------------ */

test('recovery keeps only values that closed', () => {
  // Cut inside the third component: the first two are real, the third is not.
  const cut = ARGUMENTS.indexOf('"BarChart"')
  const recovered = recoverArguments(ARGUMENTS.slice(0, cut))
  assert.equal(recovered.invalid, false)
  assert.equal(recovered.open, true)
  assert.equal(recovered.messages.length, 1)
  const surface = recovered.messages[0].createSurface
  assert.equal(surface.surfaceId, 'sales')
  assert.deepEqual(surface.components.map((component) => component.id), ['root', 'title'])
  assert.deepEqual(surface.dataModel, { rows: [{ label: 'Q1', value: 3 }] })
})

test('recovery reports the closed document and the finished title', () => {
  const recovered = recoverArguments(ARGUMENTS)
  assert.deepEqual([recovered.closed, recovered.open, recovered.invalid], [true, false, false])
  assert.equal(recovered.title, 'Quarterly revenue')
  assert.equal(recovered.messages.length, 1)
  assert.equal(recovered.messages[0].createSurface.components.length, 3)
})

test('a title is not read until its string closes', () => {
  const text = '{"title":"Revenue by region'
  const recovered = recoverArguments(text)
  assert.equal(recovered.title, undefined)
  assert.deepEqual([recovered.open, recovered.invalid], [true, false])
  assert.equal(recoverArguments(`${text}"}`).title, 'Revenue by region')
})

test('escapes are decoded exactly once, by JSON.parse', () => {
  const text = '{"messages":[{"version":"1.0","createSurface":{"surfaceId":"s","components":[{"id":"root","component":"Text","text":"a\\"b\\u00e9\\\\c"}]}}]}'
  const recovered = recoverArguments(text)
  assert.equal(recovered.messages[0].createSurface.components[0].text, 'a"bé\\c')
})

test('malformed syntax stops the stream instead of guessing', () => {
  for (const broken of ['{"messages":[}]}', '{"messages":[{}],}', 'not json']) {
    const recovered = recoverArguments(broken)
    assert.equal(recovered.invalid, true, `expected ${broken} to be rejected`)
    const folded = foldStreaming(broken)
    assert.deepEqual([folded.surfaces.length, folded.stopped], [0, true])
  }
  // A missing final brace is not an error: more text can still arrive.
  assert.deepEqual([recoverArguments('{"messages":[{}]').invalid, recoverArguments('{"messages":[{}]').open], [false, true])
})

test('a payload deeper than the recovery bound is refused', () => {
  const deep = `${'['.repeat(MAX_RECOVERY_DEPTH + 2)}x${']'.repeat(MAX_RECOVERY_DEPTH + 2)}`
  assert.equal(recoverArguments(`{"messages":${deep}}`).invalid, true)
})

/* ------------------------------------------------------------------ */
/* Fold                                                                */
/* ------------------------------------------------------------------ */

test('the fold grows monotonically while the payload streams in', () => {
  let previous = 0
  let everStopped = false
  for (let length = 1; length <= ARGUMENTS.length; length += 1) {
    const folded = foldStreaming(ARGUMENTS.slice(0, length))
    everStopped = everStopped || folded.stopped
    assert.ok(folded.components >= previous, `component count regressed at ${length}`)
    previous = folded.components
    // A root is required before anything is drawn: no empty cards.
    for (const surface of folded.surfaces) assert.ok(surface.components.has('root'))
  }
  assert.equal(everStopped, false)
  assert.equal(previous, 3)
})

test('a surface without its root is not drawn yet', () => {
  const folded = foldStreaming('{"messages":[{"version":"1.0","createSurface":{"surfaceId":"s","components":[{"id":"a","component":"Text","text":"hi"}]}}]}')
  assert.deepEqual([folded.surfaces.length, folded.streaming, folded.stopped], [0, false, false])
})

test('one fold merges create and update messages like the settled path', () => {
  const create = { version: '1.0', createSurface: { surfaceId: 's', components: [{ id: 'root', component: 'Column', children: ['t'] }, { id: 't', component: 'Text', text: 'one' }] } }
  const update = { version: '1.0', updateComponents: { surfaceId: 's', components: [{ id: 't', component: 'Text', text: 'two' }] } }
  const folded = foldStreaming(JSON.stringify({ messages: [create, update] }))
  assert.equal(folded.surfaces.length, 1)
  const state = folded.surfaces[0]
  assert.equal(state.components.size, 2)
  assert.equal(state.components.get('t').text, 'two')
})

test('components that are structurally impossible are skipped, not drawn', () => {
  const messages = [
    {
      version: '1.0',
      createSurface: {
        surfaceId: 's',
        components: [
          { id: 'root', component: 'Column', children: ['ok'] },
          { id: 'ok', component: 'Text', text: 'kept' },
          { id: 'bad id', component: 'Text', text: 'space in id' },
          { id: 'root', component: 'Text', text: 'duplicate' },
          { id: 'surfaceish', component: 'Surface' },
          { id: 'numeric', component: 7 },
          'not an object',
          { id: 'x'.repeat(200), component: 'Text' },
        ],
      },
    },
  ]
  const folded = foldStreaming(JSON.stringify({ messages }))
  assert.deepEqual([...folded.surfaces[0].components.keys()].sort(), ['ok', 'root'])
  // The duplicate did not replace the real root.
  assert.equal(folded.surfaces[0].components.get('root').component, 'Column')
  assert.equal(folded.truncated, true)
})

/* --- the reviewer's preview-validation bypass ---------------------- */

/** Cut a payload right after `needle`, so the component closed but the JSON did not. */
function cutAfter(payload, needle) {
  const at = payload.indexOf(needle)
  assert.ok(at > 0, `payload does not contain ${needle}`)
  return payload.slice(0, at + needle.length)
}

test('a closed component is validated exactly like the settled path validates it', () => {
  // `tabs: [null]` crashes a renderer that trusts the property; the settled path
  // rejects it, so the preview must not draw it either.
  const bad = JSON.stringify({
    messages: [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'tabs',
          catalogId: 'dsh-a2ui/catalog/v1',
          components: [{ id: 'root', component: 'Tabs', tabs: [null] }],
        },
      },
    ],
  })
  const settled = validateToolArguments(JSON.parse(bad))
  assert.equal(settled.ok, false, 'the settled path must reject this payload')

  const folded = foldStreaming(cutAfter(bad, '"tabs":[null]}]'))
  assert.deepEqual([folded.surfaces.length, folded.stopped, folded.truncated], [0, false, true])

  // Another renderer, another malformed nested property.
  const badTable = JSON.stringify({
    messages: [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'table',
          catalogId: 'dsh-a2ui/catalog/v1',
          components: [{ id: 'root', component: 'Table', columns: [null], rows: [] }],
        },
      },
    ],
  })
  assert.equal(validateToolArguments(JSON.parse(badTable)).ok, false)
  assert.deepEqual(foldStreaming(cutAfter(badTable, '"rows":[]}')).surfaces.length, 0)

  // The same shape with a legal property previews fine, and recovers as soon as
  // the payload becomes drawable again.
  const good = JSON.stringify({
    messages: [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'tabs',
          catalogId: 'dsh-a2ui/catalog/v1',
          components: [{ id: 'root', component: 'Tabs', tabs: [{ title: 'One', child: 'later' }] }],
        },
      },
    ],
  })
  const recovered = foldStreaming(cutAfter(good, '"tabs":[{"title":"One","child":"later"}]}]'))
  assert.equal(recovered.surfaces.length, 1)
  assert.equal(recovered.surfaces[0].components.size, 1)
})

test('an illegal component is skipped while its legal siblings still draw', () => {
  const payload = JSON.stringify({
    messages: [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 's',
          catalogId: 'dsh-a2ui/catalog/v1',
          components: [
            { id: 'root', component: 'Column', children: ['good', 'bad'] },
            { id: 'good', component: 'Text', text: 'kept' },
            { id: 'bad', component: 'Progress', caption: 'not a property of Progress' },
          ],
        },
      },
    ],
  })
  const folded = foldStreaming(payload)
  assert.deepEqual([...folded.surfaces[0].components.keys()].sort(), ['good', 'root'])
  assert.equal(folded.truncated, true)
})

/* --- budgets ------------------------------------------------------- */

/** One surface whose root expands a template over `items`. */
function templatedSurface(surfaceId, items) {
  return {
    version: '1.0',
    createSurface: {
      surfaceId,
      catalogId: 'dsh-a2ui/catalog/v1',
      dataModel: { items },
      components: [
        { id: 'root', component: 'Column', children: { componentId: 'row', path: '/items' } },
        { id: 'row', component: 'Text', text: 'x' },
      ],
    },
  }
}

test('a single surface over its own budget is skipped, the rest still draws', () => {
  const huge = templatedSurface('huge', Array.from({ length: LIMITS.maxExpandedNodes + 10 }, (_, index) => index))
  const small = templatedSurface('small', [1, 2, 3])
  const folded = foldStreaming(JSON.stringify({ messages: [small, huge] }))
  assert.deepEqual(folded.surfaces.map((surface) => surface.surfaceId), ['small'])
  assert.deepEqual([folded.stopped, folded.truncated], [false, true])
})

test('the per-call expansion budget is enforced across surfaces', () => {
  const each = Math.floor(LIMITS.maxTotalExpandedNodes / 2) + 500
  const first = templatedSurface('one', Array.from({ length: each }, (_, index) => index))
  const second = templatedSurface('two', Array.from({ length: each }, (_, index) => index))
  const folded = foldStreaming(JSON.stringify({ messages: [first, second] }))
  // The first fits on its own; adding the second would exceed the call budget,
  // so the preview keeps the last safe snapshot instead of drawing both.
  assert.deepEqual(folded.surfaces.map((surface) => surface.surfaceId), ['one'])
  assert.equal(folded.truncated, true)
  // And the settled path rejects the whole call, which is what makes the preview
  // a preview.
  assert.equal(validateToolArguments(JSON.parse(JSON.stringify({ messages: [first, second] }))).ok, false)
})

test('the per-call data-unit budget is enforced across surfaces', () => {
  const rows = Array.from({ length: LIMITS.maxTableRows }, (_, index) => ({ a: index }))
  const tables = (surfaceId, count) => ({
    version: '1.0',
    createSurface: {
      surfaceId,
      catalogId: 'dsh-a2ui/catalog/v1',
      components: [
        { id: 'root', component: 'Column', children: Array.from({ length: count }, (_, index) => `t${index}`) },
        ...Array.from({ length: count }, (_, index) => ({ id: `t${index}`, component: 'Table', columns: [{ key: 'a', label: 'A' }], rows })),
      ],
    },
  })
  // Exactly at the per-surface allowance: legal, and still previewed.
  const perSurface = Math.floor(LIMITS.maxExpandedDataUnits / LIMITS.maxTableRows)
  const first = tables('one', perSurface)
  const single = foldStreaming(JSON.stringify({ messages: [first] }))
  assert.equal(single.surfaces.length, 1, 'one legal surface still previews')
  const second = tables('two', perSurface)
  const both = foldStreaming(JSON.stringify({ messages: [first, second] }))
  assert.deepEqual(both.surfaces.map((surface) => surface.surfaceId), ['one'])
  assert.equal(both.truncated, true)
})

test('more surfaces than one call may create are left out', () => {
  const messages = Array.from({ length: LIMITS.maxSurfacesPerCall + 2 }, (_, index) => templatedSurface(`s${index}`, [index]))
  const folded = foldStreaming(JSON.stringify({ messages }))
  assert.equal(folded.surfaces.length, LIMITS.maxSurfacesPerCall)
  assert.equal(folded.truncated, true)
})

test('a surface with more components than the settled path allows is left out', () => {
  const over = (surfaceId) => ({
    version: '1.0',
    createSurface: {
      surfaceId,
      catalogId: 'dsh-a2ui/catalog/v1',
      components: [
        { id: 'root', component: 'Column', children: [] },
        ...Array.from({ length: LIMITS.maxComponentsPerSurface }, (_, index) => ({ id: `c${index}`, component: 'Text', text: 'x' })),
      ],
    },
  })
  const folded = foldStreaming(JSON.stringify({ messages: [over('big')] }))
  assert.deepEqual([folded.surfaces.length, folded.truncated], [0, true])
  assert.equal(validateToolArguments(JSON.parse(JSON.stringify({ messages: [over('big')] }))).ok, false)
})

/* ------------------------------------------------------------------ */
/* Cache and observer                                                  */
/* ------------------------------------------------------------------ */

function delta(callId, argumentsDelta, name) {
  return { event: { type: 'assistant/live-chunk', data: { chunk: { type: 'tool-call-delta', id: callId, name, argumentsDelta } } } }
}

function settle(callId) {
  return { event: { type: 'tool/call', data: { callId, name: 'a2ui' } } }
}

test('the cache keeps, bounds and releases fragments', () => {
  store.resetStreams()
  store.setStreamClock(() => 1_000)
  let notifications = 0
  const unsubscribe = store.subscribeStream(() => {
    notifications += 1
  })

  store.appendStreamedArguments('call-1', '{"mess')
  store.appendStreamedArguments('call-1', 'ages":[]}')
  store.flushStreamNotifications()
  assert.equal(store.streamTextFor('call-1'), '{"messages":[]}')
  assert.equal(notifications, 1, 'appends coalesce into one notification')
  assert.equal(store.streamTextFor('other'), undefined)

  // Repeated identical text does not notify again.
  store.appendStreamedArguments('call-1', '')
  store.flushStreamNotifications()
  assert.equal(notifications, 1)

  store.appendStreamedArguments('call-2', 'x'.repeat(store.MAX_STREAM_CHARS + 10))
  assert.equal(store.streamTextFor('call-2').length, store.MAX_STREAM_CHARS)
  assert.equal(store.streamTruncatedFor('call-2'), true)

  // Age prunes on the next write, so a long session cannot accumulate text.
  store.setStreamClock(() => 1_000 + store.MAX_STREAM_AGE_MS + 1)
  store.appendStreamedArguments('call-3', '{}')
  assert.equal(store.streamTextFor('call-1'), undefined)
  assert.equal(store.streamTextFor('call-3'), '{}')

  store.dropStreamedArguments('call-3')
  assert.equal(store.streamTextFor('call-3'), undefined)
  store.resetStreams()
  unsubscribe()
  store.flushStreamNotifications()
  store.setStreamClock(() => Date.now())
})

test('the cache is bounded in entries and in total characters', () => {
  store.resetStreams()
  store.setStreamClock(() => 5_000)
  for (let index = 0; index < store.MAX_STREAM_ENTRIES + 5; index += 1) {
    store.appendStreamedArguments(`call-${index}`, `{"n":${index}}`)
  }
  assert.equal(store.streamTextFor('call-0'), undefined, 'the oldest entry is evicted')
  assert.equal(store.streamTextFor(`call-${store.MAX_STREAM_ENTRIES + 4}`), `{"n":${store.MAX_STREAM_ENTRIES + 4}}`)

  // The total allowance also holds: five calls at the per-call cap exceed it, so
  // the oldest is dropped instead of the newest.
  store.resetStreams()
  const full = 'x'.repeat(store.MAX_STREAM_CHARS)
  for (let index = 0; index < 5; index += 1) store.appendStreamedArguments(`big-${index}`, full)
  assert.equal(store.streamTextFor('big-0'), undefined, 'the total allowance evicted the oldest')
  assert.equal(store.streamTextFor('big-4').length, store.MAX_STREAM_CHARS)
  store.resetStreams()
  store.setStreamClock(() => Date.now())
})

test('replaying the same events cannot duplicate the prefix', () => {
  store.resetStreams()
  const definition = store.createStreamDefinition()
  const replay = () => {
    // Exactly what a window replacement does: start at the earliest match, then
    // fold the rest as updates.
    let state = definition.start(undefined, delta('call-r', '{"mes', 'a2ui'))
    state = definition.update({ state }, delta('call-r', 'sages":[{'))
    store.flushStreamNotifications()
    return state
  }
  const first = replay()
  const text = store.streamTextFor('call-r')
  assert.equal(text, '{"messages":[{')
  const second = replay()
  assert.equal(store.streamTextFor('call-r'), text, 'a replay replaces the prefix')
  assert.equal(second.seen ?? text.length, text.length)
  assert.equal(first.text, text)
  store.resetStreams()
})

test('only calls the host named a2ui are collected', () => {
  store.resetStreams()
  const definition = store.createStreamDefinition()

  // A foreign tool is never tracked, and its later unnamed fragments stay out.
  let state = definition.start(undefined, delta('call-shell', '{"cmd":"rm -rf /"', 'shell'))
  state = definition.update({ state }, delta('call-shell', ',"more":"x"'))
  store.flushStreamNotifications()
  assert.equal(store.streamTextFor('call-shell'), undefined)

  // An unattributed fragment before any name is not buffered at all.
  state = definition.start(undefined, delta('call-early', '{"unknown"'))
  store.flushStreamNotifications()
  assert.equal(store.streamTextFor('call-early'), undefined)

  // An unnamed fragment after the name extends the tracked call.
  state = definition.start(undefined, delta('call-ours', '{"mess', 'a2ui'))
  state = definition.update({ state }, delta('call-ours', 'ages":[]}'))
  store.flushStreamNotifications()
  assert.equal(store.streamTextFor('call-ours'), '{"messages":[]}')
  assert.equal(store.streamTextFor('call-shell'), undefined)
  store.resetStreams()
})

test('two concurrent calls never mix their arguments', () => {
  store.resetStreams()
  const definition = store.createStreamDefinition()
  const a = definition.start(undefined, delta('call-a', '{"a":1}', 'a2ui'))
  const b = definition.start(undefined, delta('call-b', '{"b":2}', 'a2ui'))
  definition.update({ state: a }, delta('call-a', '{"a":1}'))
  definition.update({ state: b }, delta('call-b', '{"b":2}'))
  store.flushStreamNotifications()
  assert.equal(store.streamTextFor('call-a'), '{"a":1}{"a":1}')
  assert.equal(store.streamTextFor('call-b'), '{"b":2}{"b":2}')
  store.resetStreams()
})

test('a settled call releases its fragments', () => {
  store.resetStreams()
  const definition = store.createStreamDefinition()
  const state = definition.start(undefined, delta('call-done', '{"messages":[]}', 'a2ui'))
  store.flushStreamNotifications()
  assert.equal(store.streamTextFor('call-done'), '{"messages":[]}')
  definition.update({ state }, settle('call-done'))
  store.flushStreamNotifications()
  assert.equal(store.streamTextFor('call-done'), undefined)

  // `tool/result` is the fallback when `tool/call` fell outside the window.
  definition.start(undefined, delta('call-2', '{"x":1}', 'a2ui'))
  store.flushStreamNotifications()
  definition.update({ state }, { event: { type: 'tool/result', data: { message: { source: { callId: 'call-2' } } } } })
  store.flushStreamNotifications()
  assert.equal(store.streamTextFor('call-2'), undefined)
  store.resetStreams()
})

test('the observer Definition declares no view target', () => {
  const definition = store.createStreamDefinition()
  assert.equal(definition.target, undefined, 'a view target would add a transcript node')
  assert.equal(definition.kind, 'a2ui-stream')
  assert.equal(definition.match(delta('call-9', '{"a"', 'a2ui').event).role, 'start')
  assert.equal(definition.match({ event: { type: 'assistant/live-chunk', data: { chunk: { type: 'text-delta', index: 0, text: 'hi' } } } }), null)
  assert.equal(definition.match(settle('call-9').event).role, 'update')
  assert.equal(definition.match({ event: { type: 'turn/end', data: {} } }), null)
  assert.equal(definition.publication(delta('call-9', 'x')), 'animation-frame')
})

/* ------------------------------------------------------------------ */
/* Registration through the plugin entry                                */
/* ------------------------------------------------------------------ */

/**
 * A registry shaped like `ConversationEventRegistry`: `register` is a method
 * that reads `this`. Calling it detached throws, which is exactly the bug this
 * test exists for.
 */
function fakeRegistry() {
  const definitions = new Map()
  return {
    definitions,
    calls: 0,
    register(definition) {
      return this.registerDefinition(definition)
    },
    registerDefinition(definition) {
      this.calls += 1
      definitions.set(definition.kind, definition)
      return () => definitions.delete(definition.kind)
    },
  }
}

function fakeContext(registry, options = {}) {
  const cleanups = []
  const warnings = []
  const scoped = {
    effect(factory) {
      const cleanup = factory()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    uiConversation: registry === undefined ? undefined : { events: registry },
  }
  const ctx = {
    effect(factory) {
      const cleanup = factory()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    inject(deps, callback) {
      assert.deepEqual(deps, ['uiConversation'])
      callback(scoped)
      return { dispose() {} }
    },
    slots: { inject() {}, register: () => () => {} },
    locale: { register: () => () => {}, bind: () => (key) => key, getLocale: () => ({ id: 'en-US' }) },
    sessions: { scope: () => undefined },
    logger: { warn: (message) => warnings.push(message) },
    ...options,
  }
  return {
    ctx,
    warnings,
    unload() {
      // Reverse order, like a Cordis effect teardown.
      for (const cleanup of cleanups.reverse()) cleanup()
      cleanups.length = 0
    },
  }
}

test('apply() registers the observer through the registry method', () => {
  store.resetStreams()
  const registry = fakeRegistry()
  // The fake is faithful: taking the method out of the registry and calling it as
  // a plain function throws, which is exactly what the previous implementation did.
  assert.throws(() => {
    const detached = registry.register
    detached({ kind: 'detached' })
  }, TypeError)
  const { ctx, unload, warnings } = fakeContext(registry)
  plugin.apply(ctx)

  assert.equal(registry.definitions.size, 1, 'the registry holds exactly one observer')
  const definition = registry.definitions.get('a2ui-stream')
  assert.ok(definition, 'the registry received the a2ui-stream Definition')
  assert.equal(registry.calls, 1)
  assert.deepEqual(warnings, [], 'registration must not have thrown')

  // The registered Definition drives the real preview: two fragments, then the
  // card the tool view draws from them.
  let state = definition.start(undefined, delta('call-live', '{"title":"Live","messages":[{"version":"1.0","createSurface":{"surfaceId":"s","catalogId":"dsh-a2ui/catalog/v1","components":[{"id":"root","component":"Text","text":"Arrived"}]}}]}', 'a2ui'))
  definition.update({ state }, delta('call-live', ''))
  store.flushStreamNotifications()

  const html = sharedVisible(store.streamTextFor('call-live'))
  assert.match(html, /Arrived/u, 'the bundled renderer draws the streamed component')

  // Unloading releases both the registration and the cache.
  unload()
  assert.equal(registry.definitions.size, 0)
  assert.equal(store.streamTextFor('call-live'), undefined)

  // Re-mounting registers once more, not twice.
  const again = fakeContext(registry)
  plugin.apply(again.ctx)
  assert.equal(registry.definitions.size, 1)
  assert.equal(registry.calls, 2)
  again.unload()
  void state
})

test('apply() survives a host without the conversation service', () => {
  store.resetStreams()
  const { ctx, warnings } = fakeContext(undefined)
  ctx.inject = (deps, callback) => {
    callback({ effect() {}, uiConversation: undefined })
    return { dispose() {} }
  }
  plugin.apply(ctx)
  assert.deepEqual(warnings, [], 'a missing optional service is not an error')
})

/** Render the fold through the bundled client renderer, as static text. */
function sharedVisible(text) {
  const folded = foldStreaming(text ?? '')
  assert.equal(folded.surfaces.length, 1, 'the streamed payload folds into one surface')
  const state = folded.surfaces[0]
  const view = {
    surfaceId: state.surfaceId,
    callId: 'call-live',
    state,
    model: state.dataModel,
    locale: 'en-US',
    now: 0,
    interaction: { state: 'idle' },
    t: (key) => key,
    setValue() {},
    submit() {},
    runLocal() {},
    streaming: true,
  }
  return renderText(client.surface.A2UISurface({ view }))
}

/**
 * Flatten a React element tree to its text, without a DOM.
 *
 * Function components are invoked the way React would; this test only walks
 * hook-free renderers (`Column`, `ComponentNode`, `Text`), so calling them
 * directly is safe and keeps the assertion about visible text.
 */
function renderText(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(renderText).join(' ')
  const type = node.type
  if (typeof type === 'function') {
    if (typeof type.prototype?.render === 'function') return '' // a class component
    return renderText(type(node.props))
  }
  return renderText(node.props?.children)
}
