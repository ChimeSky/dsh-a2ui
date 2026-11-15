/**
 * Progressive rendering: recovering a partly streamed payload, folding it into
 * drawable surfaces, and the client store that carries the raw fragments.
 *
 * The properties that matter and are asserted here:
 *
 * - recovery never invents data: only values whose own slice `JSON.parse`
 *   accepts are ever returned, and a half-written component is never rendered;
 * - the fold is monotonic while a payload streams in — the surface only grows,
 *   never shrinks and never falls back to an error;
 * - the client store is bounded, and the Definition it hands the conversation
 *   engine touches no transcript node.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { shared, client } = await import('../build/shared.mjs')
const { recoverArguments, foldStreaming, MAX_RECOVERY_DEPTH } = shared
const store = client['stream-store']

/** A complete, valid single-surface call, as the model would write it. */
const SURFACE = {
  version: '1.0',
  createSurface: {
    surfaceId: 'sales',
    catalogId: 'https://a2ui.org/specification/v1_0/catalogs/extended',
    dataModel: { rows: [{ label: 'Q1', value: 3 }] },
    components: [
      { id: 'root', component: 'Column', children: ['title', 'chart'] },
      { id: 'title', component: 'Text', text: 'Revenue' },
      { id: 'chart', component: 'BarChart', categories: ['Q1'], series: [{ name: 'Revenue', values: [3] }] },
    ],
  },
}

const ARGUMENTS = JSON.stringify({ title: 'Quarterly revenue', messages: [SURFACE] })

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
})

test('a partial tree over the render budget stops the preview', () => {
  const items = Array.from({ length: 4200 }, (_, index) => index)
  const messages = [
    {
      version: '1.0',
      createSurface: {
        surfaceId: 's',
        dataModel: { items },
        components: [
          { id: 'root', component: 'Column', children: { componentId: 'row', path: '/items' } },
          { id: 'row', component: 'Text', text: 'x' },
        ],
      },
    },
  ]
  const folded = foldStreaming(JSON.stringify({ messages }))
  assert.deepEqual([folded.surfaces.length, folded.stopped], [0, true])
})

test('the stream store keeps, bounds and releases fragments', () => {
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

  store.appendStreamedArguments('call-2', 'x'.repeat(store.MAX_STREAM_CHARS + 10))
  assert.equal(store.streamTextFor('call-2').length, store.MAX_STREAM_CHARS)
  assert.equal(store.streamTruncatedFor('call-2'), true)

  // Age prunes on the next append, so a long session cannot accumulate text.
  store.setStreamClock(() => 1_000 + store.MAX_STREAM_AGE_MS + 1)
  store.appendStreamedArguments('call-3', '{}')
  assert.equal(store.streamTextFor('call-1'), undefined)
  assert.equal(store.streamTextFor('call-3'), '{}')

  store.dropStreamedArguments('call-3')
  assert.equal(store.streamTextFor('call-3'), undefined)
  store.resetStreams()
  unsubscribe()
  store.flushStreamNotifications()
})

test('the observer Definition copies chunks and declares no view target', () => {
  store.resetStreams()
  const definition = store.createStreamDefinition()
  assert.equal(definition.target, undefined, 'a view target would add a transcript node')
  assert.equal(definition.kind, 'a2ui-stream')

  const delta = (id, argumentsDelta, name) => ({ event: { type: 'assistant/live-chunk', data: { chunk: { type: 'tool-call-delta', id, name, argumentsDelta } } } })
  assert.deepEqual(definition.match(delta('call-9', '{"a"', 'a2ui').event), { id: 'call-9', role: 'start' })
  assert.equal(definition.match({ event: { type: 'assistant/live-chunk', data: { chunk: { type: 'text-delta', index: 0, text: 'hi' } } } }), null)
  assert.equal(definition.match({ event: { type: 'tool/call', data: {} } }), null)
  assert.equal(definition.match({ event: { type: 'assistant/live-chunk', data: { chunk: { type: 'tool-call-delta', argumentsDelta: 'x' } } } }), null)

  // start then update, exactly as the engine calls them.
  const first = definition.start(undefined, delta('call-9', '{"mes', 'a2ui'))
  const second = definition.update({ state: first }, delta('call-9', 'sages":[]}', undefined))
  store.flushStreamNotifications()
  assert.equal(store.streamTextFor('call-9'), '{"messages":[]}')
  assert.equal(second.callId, 'call-9')
  assert.equal(second.seen, '{"messages":[]}'.length)
  assert.equal(definition.publication(delta('call-9', 'x')), 'animation-frame')
  store.resetStreams()
})
