/**
 * Protocol-level tests: what the Host accepts and, more importantly, what it
 * refuses. Every case is an assertion about A2UI 1.0 message validity, not about
 * an implementation convenience.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shared } from '../build/shared.mjs'

const {
  validateToolArguments,
  applyMessageBatch,
  BASIC_CATALOG_ID,
  EXTENSION_CATALOG_ID,
  PROTOCOL_VERSION,
  LIMITS,
} = shared

const card = (extra = {}) => ({
  version: '1.0',
  createSurface: {
    surfaceId: 's1',
    components: [
      { id: 'root', component: 'Card', child: 'col' },
      { id: 'col', component: 'Column', children: ['title', 'btn'] },
      { id: 'title', component: 'Text', text: 'Hello' },
      { id: 'btn', component: 'Button', child: 'btnLabel', action: { event: { name: 'go' } } },
      { id: 'btnLabel', component: 'Text', text: 'Go' },
    ],
    dataModel: { name: 'x' },
    ...extra,
  },
})

test('accepts a minimal v1.0 createSurface and reports the surface', () => {
  const result = validateToolArguments({ messages: [card()] })
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.equal(result.surfaces.length, 1)
  assert.equal(result.surfaces[0].surfaceId, 's1')
  assert.equal(result.surfaces[0].components, 5)
  assert.equal(result.surfaces[0].catalogId, EXTENSION_CATALOG_ID)
})

test('accepts the official basic catalog and its components', () => {
  const result = validateToolArguments({
    messages: [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'b',
          catalogId: BASIC_CATALOG_ID,
          components: [
            { id: 'root', component: 'Column', children: ['a'] },
            { id: 'a', component: 'Slider', min: 0, max: 10, value: 3 },
          ],
        },
      },
    ],
  })
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.equal(result.surfaces[0].catalogId, BASIC_CATALOG_ID)
})

test('rejects the extension catalog components under the basic catalog id', () => {
  const result = validateToolArguments({
    messages: [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'b',
          catalogId: BASIC_CATALOG_ID,
          components: [{ id: 'root', component: 'Table', columns: [], rows: [] }],
        },
      },
    ],
  })
  assert.equal(result.ok, false)
  assert.match(result.errors.map((error) => error.message).join('\n'), /extension catalog/u)
})

test('rejects a missing or wrong version', () => {
  const missing = validateToolArguments({ messages: [{ createSurface: { surfaceId: 's' } }] })
  assert.equal(missing.ok, false)
  assert.match(missing.errors[0].message, /required/u)

  const legacy = validateToolArguments({ messages: [{ version: 'v0.9', createSurface: { surfaceId: 's' } }] })
  assert.equal(legacy.ok, false)
  assert.match(legacy.errors[0].message, /"1\.0"/u)

  const v08 = validateToolArguments({
    messages: [{ beginRendering: { surfaceId: 's', root: 'root' } }],
  })
  assert.equal(v08.ok, false)
  assert.match(v08.errors.map((error) => error.message).join(' '), /exactly one of/u)
})

test('rejects unknown message properties and two message kinds in one envelope', () => {
  const unknown = validateToolArguments({
    messages: [{ version: '1.0', createSurface: { surfaceId: 's', bogus: 1 } }],
  })
  assert.equal(unknown.ok, false)
  assert.match(unknown.errors[0].message, /unsupported property "bogus"/u)

  const double = validateToolArguments({
    messages: [
      {
        version: '1.0',
        createSurface: { surfaceId: 's' },
        deleteSurface: { surfaceId: 's' },
      },
    ],
  })
  assert.equal(double.ok, false)
  assert.match(double.errors[0].message, /exactly one/u)
})

test('rejects unsupported but valid v1.0 messages with an explicit reason', () => {
  const result = validateToolArguments({
    messages: [{ version: '1.0', callRendererFunction: { functionCallId: 'c1', callFunction: { '@call': 'formatString' } } }],
  })
  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /not supported by dsh-a2ui/u)
})

test('rejects an unknown component and unknown component property', () => {
  const unknownComponent = validateToolArguments({
    messages: [{ version: '1.0', createSurface: { surfaceId: 's', components: [{ id: 'root', component: 'FancyThing' }] } }],
  })
  assert.equal(unknownComponent.ok, false)
  assert.match(unknownComponent.errors[0].message, /unknown component "FancyThing"/u)

  const unknownProperty = validateToolArguments({
    messages: [{ version: '1.0', createSurface: { surfaceId: 's', components: [{ id: 'root', component: 'Text', text: 'x', colour: 'red' }] } }],
  })
  assert.equal(unknownProperty.ok, false)
  assert.match(unknownProperty.errors[0].message, /not a property of Text/u)
})

test('rejects a missing required property', () => {
  const result = validateToolArguments({
    messages: [{ version: '1.0', createSurface: { surfaceId: 's', components: [{ id: 'root', component: 'Slider', max: 10 }] } }],
  })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => /missing required property "value"/u.test(error.message)))
})

test('rejects a tree without root, with a dangling child, or with a cycle', () => {
  const noRoot = validateToolArguments({
    messages: [{ version: '1.0', createSurface: { surfaceId: 's', components: [{ id: 'other', component: 'Text', text: 'x' }] } }],
  })
  assert.equal(noRoot.ok, false)
  assert.match(noRoot.errors.map((error) => error.message).join('\n'), /id "root"/u)

  const dangling = validateToolArguments({
    messages: [{ version: '1.0', createSurface: { surfaceId: 's', components: [{ id: 'root', component: 'Column', children: ['nope'] }] } }],
  })
  assert.equal(dangling.ok, false)
  assert.match(dangling.errors.map((error) => error.message).join('\n'), /missing child "nope"/u)

  const cycle = validateToolArguments({
    messages: [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 's',
          components: [
            { id: 'root', component: 'Column', children: ['a'] },
            { id: 'a', component: 'Card', child: 'root' },
          ],
        },
      },
    ],
  })
  assert.equal(cycle.ok, false)
  assert.match(cycle.errors.map((error) => error.message).join('\n'), /circular/u)

  const self = validateToolArguments({
    messages: [{ version: '1.0', createSurface: { surfaceId: 's', components: [{ id: 'root', component: 'Card', child: 'root' }] } }],
  })
  assert.equal(self.ok, false)
})

test('rejects duplicate component ids inside one message', () => {
  const result = validateToolArguments({
    messages: [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 's',
          components: [
            { id: 'root', component: 'Column', children: ['a'] },
            { id: 'a', component: 'Text', text: 'one' },
            { id: 'a', component: 'Text', text: 'two' },
          ],
        },
      },
    ],
  })
  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /duplicates component id "a"/u)
})

test('rejects Surface as a declared component', () => {
  const result = validateToolArguments({
    messages: [{ version: '1.0', createSurface: { surfaceId: 's', components: [{ id: 'root', component: 'Surface' }] } }],
  })
  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /implicit protocol container/u)
})

test('accepts an update that addresses a surface created earlier, with a warning', () => {
  const result = validateToolArguments({
    messages: [{ version: '1.0', updateDataModel: { surfaceId: 'earlier', path: '/name', value: 'x' } }],
  })
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.equal(result.surfaces.length, 0)
})

test('warns when updateComponents targets a surface not created in this call', () => {
  const result = validateToolArguments({
    messages: [
      {
        version: '1.0',
        updateComponents: { surfaceId: 'earlier', components: [{ id: 'title', component: 'Text', text: 'new' }] },
      },
    ],
  })
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.ok(result.warnings.some((warning) => /not created in this tool call/u.test(warning)))
})

test('rejects a payload over the message-count and size limits', () => {
  const messages = Array.from({ length: LIMITS.maxMessages + 1 }, (_, index) => ({
    version: '1.0',
    createSurface: { surfaceId: `s${index}`, components: [{ id: 'root', component: 'Text', text: 'x' }] },
  }))
  const tooMany = validateToolArguments({ messages })
  assert.equal(tooMany.ok, false)
  assert.match(tooMany.errors.map((error) => error.message).join('\n'), /message count exceeds/u)

  const tooBig = validateToolArguments({
    messages: [{ version: '1.0', createSurface: { surfaceId: 's', components: [{ id: 'root', component: 'Text', text: 'x'.repeat(20000) }] } }],
  })
  assert.equal(tooBig.ok, false)
  assert.match(tooBig.errors.map((error) => error.message).join('\n'), /string length exceeds/u)
})

test('rejects an unknown catalog id', () => {
  const result = validateToolArguments({
    messages: [{ version: '1.0', createSurface: { surfaceId: 's', catalogId: 'https://example.com/nope', components: [{ id: 'root', component: 'Text', text: 'x' }] } }],
  })
  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /not a known catalog/u)
})

test('rejects malformed data bindings and function calls', () => {
  const badBinding = validateToolArguments({
    messages: [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 's',
          components: [{ id: 'root', component: 'TextField', label: 'Name', value: { path: '/a', extra: true } }],
        },
      },
    ],
  })
  assert.equal(badBinding.ok, false)
  assert.match(badBinding.errors.map((error) => error.message).join('\n'), /unexpected properties: extra/u)

  const unknownFunction = validateToolArguments({
    messages: [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 's',
          components: [{ id: 'root', component: 'Text', text: { '@call': 'eval', args: {} } }],
        },
      },
    ],
  })
  assert.equal(unknownFunction.ok, false)
  assert.match(unknownFunction.errors.map((error) => error.message).join('\n'), /unknown function "eval"/u)
})

test('folds updateComponents by merging only the listed components', () => {
  const first = validateToolArguments({ messages: [card()] })
  const folded = applyMessageBatch(new Map(), first.messages)
  const before = folded.surfaces.get('s1')
  assert.equal(before.components.get('title').text, 'Hello')

  const second = validateToolArguments({
    messages: [
      {
        version: '1.0',
        updateComponents: { surfaceId: 's1', components: [{ id: 'title', component: 'Text', text: 'Updated' }] },
      },
    ],
  })
  const merged = applyMessageBatch(folded.surfaces, second.messages)
  const after = merged.surfaces.get('s1')
  assert.equal(after.components.get('title').text, 'Updated')
  assert.equal(after.components.size, before.components.size, 'unlisted components are kept')
  assert.equal(after.components.get('btnLabel').text, 'Go')
})

test('folds updateDataModel at a JSON pointer and deletes with null', () => {
  const first = validateToolArguments({
    messages: [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 's',
          components: [{ id: 'root', component: 'Text', text: { '@path': '/user/name' } }],
          dataModel: { user: { name: 'A', age: 3 }, other: true },
        },
      },
    ],
  })
  const folded = applyMessageBatch(new Map(), first.messages)
  const second = validateToolArguments({
    messages: [{ version: '1.0', updateDataModel: { surfaceId: 's', path: '/user/name', value: 'B' } }],
  })
  const after = applyMessageBatch(folded.surfaces, second.messages).surfaces.get('s')
  assert.equal(after.dataModel.user.name, 'B')
  assert.equal(after.dataModel.user.age, 3)
  assert.equal(after.dataModel.other, true)

  const third = validateToolArguments({
    messages: [{ version: '1.0', updateDataModel: { surfaceId: 's', path: '/user/age', value: null } }],
  })
  const removed = applyMessageBatch(folded.surfaces, third.messages).surfaces.get('s')
  assert.equal('age' in removed.dataModel.user, false)
})

test('deleteSurface removes the surface and reports the deletion', () => {
  const first = validateToolArguments({ messages: [card()] })
  const folded = applyMessageBatch(new Map(), first.messages)
  const deletion = validateToolArguments({ messages: [{ version: '1.0', deleteSurface: { surfaceId: 's1' } }] })
  const after = applyMessageBatch(folded.surfaces, deletion.messages)
  assert.equal(after.surfaces.has('s1'), false)
  assert.equal(after.touches[0].deleted, true)
})

test('keeps multiple surfaces independent', () => {
  const result = validateToolArguments({
    messages: [
      { version: '1.0', createSurface: { surfaceId: 'a', components: [{ id: 'root', component: 'Text', text: 'A' }] } },
      { version: '1.0', createSurface: { surfaceId: 'b', components: [{ id: 'root', component: 'Text', text: 'B' }] } },
    ],
  })
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  const folded = applyMessageBatch(new Map(), result.messages)
  assert.equal(folded.surfaces.get('a').components.get('root').text, 'A')
  assert.equal(folded.surfaces.get('b').components.get('root').text, 'B')

  const update = validateToolArguments({
    messages: [{ version: '1.0', updateComponents: { surfaceId: 'a', components: [{ id: 'root', component: 'Text', text: 'A2' }] } }],
  })
  const after = applyMessageBatch(folded.surfaces, update.messages)
  assert.equal(after.surfaces.get('a').components.get('root').text, 'A2')
  assert.equal(after.surfaces.get('b').components.get('root').text, 'B')
})

test('accepts a template child list and expands it from the data model', () => {
  const result = validateToolArguments({
    messages: [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 's',
          components: [
            { id: 'root', component: 'Column', children: { componentId: 'row', path: '/items' } },
            { id: 'row', component: 'Text', text: { '@path': 'name' } },
          ],
          dataModel: { items: [{ name: 'one' }, { name: 'two' }] },
        },
      },
    ],
  })
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  const folded = applyMessageBatch(new Map(), result.messages)
  assert.equal(folded.surfaces.get('s').components.get('row').component, 'Text')
})

test('protocol version constant is the v1.0 string', () => {
  assert.equal(PROTOCOL_VERSION, '1.0')
})

/* ------------------------------------------------------------------ */
/* §1 same-batch surface state machine                                  */
/* ------------------------------------------------------------------ */

const v = (messages) => validateToolArguments({ messages })

test('a single batch composes create + update + data updates', () => {
  const result = v([
    { version: '1.0', createSurface: { surfaceId: 'x', dataModel: { a: 1 }, components: [{ id: 'root', component: 'Column', children: ['t'] }, { id: 't', component: 'Text', text: 'hi' }] } },
    { version: '1.0', updateComponents: { surfaceId: 'x', components: [{ id: 't', component: 'Text', text: 'hello' }] } },
    { version: '1.0', updateDataModel: { surfaceId: 'x', path: '/b', value: 2 } },
    { version: '1.0', updateDataModel: { surfaceId: 'x', path: '/a', value: 3 } },
  ])
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  const state = result.states.get('x')
  assert.deepEqual([...state.components.keys()].sort(), ['root', 't'])
  assert.equal(state.components.get('t').text, 'hello')
  assert.deepEqual(state.dataModel, { a: 3, b: 2 })
  assert.equal(state.catalogId, 'dsh-a2ui/catalog/v1')
  assert.equal(result.surfaces[0].components, 2)
})

test('two updateComponents in one batch change different components', () => {
  const result = v([
    { version: '1.0', createSurface: { surfaceId: 'x', components: [{ id: 'root', component: 'Column', children: ['a', 'b'] }, { id: 'a', component: 'Text', text: 'a0' }, { id: 'b', component: 'Text', text: 'b0' }] } },
    { version: '1.0', updateComponents: { surfaceId: 'x', components: [{ id: 'a', component: 'Text', text: 'a1' }] } },
    { version: '1.0', updateComponents: { surfaceId: 'x', components: [{ id: 'b', component: 'Text', text: 'b1' }] } },
  ])
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  const state = result.states.get('x')
  assert.equal(state.components.get('a').text, 'a1')
  assert.equal(state.components.get('b').text, 'b1')
  assert.equal(state.components.get('root').children.length, 2)
})

test('delete then create in one batch renders the new instance', () => {
  const result = v([
    { version: '1.0', createSurface: { surfaceId: 'y', components: [{ id: 'root', component: 'Text', text: 'first' }] } },
    { version: '1.0', deleteSurface: { surfaceId: 'y' } },
    { version: '1.0', createSurface: { surfaceId: 'y', components: [{ id: 'root', component: 'Text', text: 'second' }] } },
  ])
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.equal(result.states.get('y').components.get('root').text, 'second')
  assert.equal(result.states.get('y').components.size, 1, 'the deleted instance leaves no components behind')
  assert.equal(result.surfaces.length, 1)
  assert.equal(result.surfaces[0].deleted, false)
  assert.equal(result.surfaces[0].components, 1)
})

test('a second create for a live surface is rejected with the message path', () => {
  const result = v([
    { version: '1.0', createSurface: { surfaceId: 'z', components: [{ id: 'root', component: 'Text', text: 'a' }] } },
    { version: '1.0', createSurface: { surfaceId: 'z', components: [{ id: 'root', component: 'Text', text: 'b' }] } },
  ])
  assert.equal(result.ok, false)
  assert.equal(result.errors[0].path, '/messages/1/createSurface/surfaceId')
  assert.match(result.errors[0].message, /already exists in this batch/u)
})

test('createSurface validates dataModel/sendDataModel/metadata even without components', () => {
  const badSend = v([{ version: '1.0', createSurface: { surfaceId: 'w', sendDataModel: 'yes' } }])
  assert.equal(badSend.ok, false)
  assert.equal(badSend.errors[0].path, '/messages/0/createSurface/sendDataModel')

  const badModel = v([{ version: '1.0', createSurface: { surfaceId: 'w', dataModel: 7 } }])
  assert.equal(badModel.ok, false)
  assert.equal(badModel.errors[0].path, '/messages/0/createSurface/dataModel')

  const badMeta = v([{ version: '1.0', createSurface: { surfaceId: 'w', metadata: { extensions: 5 } } }])
  assert.equal(badMeta.ok, false)
  assert.equal(badMeta.errors[0].path, '/messages/0/createSurface/metadata/extensions')

  const ok = v([{ version: '1.0', createSurface: { surfaceId: 'w', sendDataModel: true, dataModel: { a: 1 }, metadata: { extensions: { x: 1 } } } }])
  assert.equal(ok.ok, true, JSON.stringify(ok.errors))
  assert.equal(ok.states.get('w').sendDataModel, true)
})

test('a basic-catalog surface rejects an extension component in a later update', () => {
  const result = v([
    {
      version: '1.0',
      createSurface: {
        surfaceId: 'b',
        catalogId: BASIC_CATALOG_ID,
        components: [{ id: 'root', component: 'Column', children: ['t'] }, { id: 't', component: 'Text', text: 'x' }],
      },
    },
    { version: '1.0', updateComponents: { surfaceId: 'b', components: [{ id: 'kpi', component: 'Stat', label: 'L', value: 1 }] } },
  ])
  assert.equal(result.ok, false)
  assert.match(result.errors.map((error) => error.message).join('\n'), /extension catalog/u)
})

test('an explicit catalogId override admits an extension component on a basic surface', () => {
  const result = v([
    {
      version: '1.0',
      createSurface: {
        surfaceId: 'b',
        catalogId: BASIC_CATALOG_ID,
        components: [
          { id: 'root', component: 'Column', children: ['kpi'] },
          { id: 'kpi', component: 'Stat', catalogId: 'dsh-a2ui/catalog/v1', label: 'L', value: 1 },
        ],
      },
    },
  ])
  assert.equal(result.ok, true, JSON.stringify(result.errors))
})

test('cross-call update and delete keep their accepted shape', () => {
  const update = v([{ version: '1.0', updateComponents: { surfaceId: 'earlier', components: [{ id: 'root', component: 'Text', text: 'x' }] } }])
  assert.equal(update.ok, true)
  assert.ok(update.warnings.some((warning) => /not created in this tool call/u.test(warning)))
  assert.deepEqual(update.states.get('earlier').components.get('root').text, 'x')

  const remove = v([{ version: '1.0', deleteSurface: { surfaceId: 'earlier' } }])
  assert.equal(remove.ok, true)
  assert.equal(remove.surfaces[0].deleted, true)
})

/* ------------------------------------------------------------------ */
/* 官方样例：43 个 basic catalog 示例全部通过校验                        */
/* ------------------------------------------------------------------ */

test('every pinned official catalog example validates', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const dir = path.join(process.cwd(), 'tests', 'fixtures', 'examples')
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
  assert.ok(files.length >= 43, `expected the pinned example set, found ${files.length}`)
  const failures = []
  for (const file of files) {
    const document = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    const result = v(document.messages)
    if (!result.ok) failures.push(`${file}: ${result.errors.slice(0, 2).map((error) => `${error.path} ${error.message}`).join('; ')}`)
  }
  assert.deepEqual(failures, [], `official examples rejected:\n${failures.join('\n')}`)
})

test('the @-prefixed property aliases normalize to the plain names', () => {
  const aliased = v([
    {
      version: '1.0',
      createSurface: {
        surfaceId: 'a',
        components: [
          {
            id: 'root',
            component: 'TextField',
            label: 'Email',
            '@checks': [{ condition: { '@call': 'required', args: { value: { '@path': '/email' } } }, message: 'Email is required' }],
          },
        ],
      },
    },
  ])
  assert.equal(aliased.ok, true, JSON.stringify(aliased.errors))
  const component = aliased.states.get('a').components.get('root')
  assert.ok(Array.isArray(component.checks), 'the alias became plain `checks`')
  assert.equal('@checks' in component, false)

  // Both spellings with the same value are accepted; different values conflict.
  const same = v([
    {
      version: '1.0',
      createSurface: {
        surfaceId: 'b',
        components: [{ id: 'root', component: 'Text', text: 'x', '@catalogId': 'dsh-a2ui/catalog/v1', catalogId: 'dsh-a2ui/catalog/v1' }],
      },
    },
  ])
  assert.equal(same.ok, true, JSON.stringify(same.errors))
  const conflict = v([
    {
      version: '1.0',
      createSurface: {
        surfaceId: 'c',
        components: [{ id: 'root', component: 'Text', text: 'x', '@catalogId': 'dsh-a2ui/catalog/v1', catalogId: 'a2ui.org/basic' }],
      },
    },
  ])
  assert.equal(conflict.ok, false)
  assert.match(conflict.errors[0].path, /@catalogId$/u)
})
