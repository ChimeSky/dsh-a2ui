#!/usr/bin/env node
/**
 * Real-render check for the shipped browser bundle.
 *
 * Loads `client.js` exactly as the Harness module table does, registers
 * the tool view through a fake Client context, then renders it server-side with
 * React against (a) the payload actually recorded in this workspace's newest
 * session log and (b) a synthetic surface that uses every catalog component.
 *
 * This catches render-time crashes that unit tests cannot see (hooks order, bad
 * props, undefined access), which is the difference between "the slot entry is
 * registered" and "the user sees a card".
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/* ------------------------------------------------------------------ */
/* Load the bundle the way the browser does                            */
/* ------------------------------------------------------------------ */

function loadView() {
  const source = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')
  const registered = []
  const localeRegister = []
  const document = {
    head: { appendChild() {} },
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
    addEventListener() {},
    removeEventListener() {},
  }
  const loaded = {}
  const sandbox = {
    window: { __ModuleLoader__: { load: (definition) => (loaded[definition.id] = definition) }, open() {}, setInterval() {}, clearInterval() {} },
    document,
    console,
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  const definition = loaded['dsh-a2ui']
  if (definition === undefined) throw new Error('bundle did not register under dsh-a2ui')
  const module = definition.factory((specifier) => {
    if (specifier === 'react') return React
    throw new Error(`unexpected external module: ${specifier}`)
  })
  const ctx = {
    effect(factory) {
      factory()
    },
    slots: {
      inject(_key, callback) {
        callback()
      },
      register(options, component) {
        registered.push({ options, component })
        return () => {}
      },
    },
    locale: {
      register(namespace) {
        localeRegister.push(namespace)
        return () => {}
      },
      bind() {
        return (key) => key
      },
      getLocale: () => ({ id: 'zh-CN' }),
    },
    sessions: { scope: () => undefined },
  }
  module.apply(ctx)
  const view = registered.find((entry) => entry.options.name === 'tool.call.toolview')
  const tail = registered.find((entry) => entry.options.name === 'conversation.chat.turnTail')
  if (view === undefined) throw new Error('tool.call.toolview was not registered')
  if (tail === undefined) throw new Error('conversation.chat.turnTail was not registered')
  return { View: view.component, Tail: tail.component }
}

/* ------------------------------------------------------------------ */
/* Payloads                                                            */
/* ------------------------------------------------------------------ */

function decodeLog(buffer) {
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const starts = []
  let cursor = buffer.indexOf(magic)
  while (cursor >= 0) {
    starts.push(cursor)
    cursor = buffer.indexOf(magic, cursor + 4)
  }
  if (starts.length <= 1) return zlib.zstdDecompressSync(buffer).toString('utf8')
  const parts = []
  for (let index = 0; index < starts.length; index += 1) {
    const end = index + 1 < starts.length ? starts[index + 1] : buffer.length
    try {
      parts.push(zlib.zstdDecompressSync(buffer.subarray(starts[index], end)).toString('utf8'))
    } catch {
      /* partial trailing frame */
    }
  }
  return parts.join('')
}

/** The newest recorded `a2ui` result meta in this workspace, if any. */
function recordedCall() {
  const dir = path.join('C:\\Users\\ChimeSky\\.dsh\\sessions', '--C-Users-ChimeSky-Desktop-DSH-plugins-a2ui--')
  if (!fs.existsSync(dir)) return undefined
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name, 'session.v4.jsonl.zstd'))
    .filter((file) => fs.existsSync(file))
    .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)

  for (const candidate of files.slice(0, 4)) {
    const events = decodeLog(fs.readFileSync(candidate.file))
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return undefined
        }
      })
      .filter(Boolean)
    const calls = new Map()
    for (const event of events) if (event.type === 'tool/call' && event.data?.name === 'a2ui') calls.set(event.data.callId, event.data)
    for (const event of events) {
      if (event.type !== 'tool/result') continue
      const callId = event.data?.message?.source?.callId
      if (!calls.has(callId)) continue
      const meta = event.data?.meta
      if (meta?.kind !== 'a2ui' || !Array.isArray(meta.messages)) continue
      return {
        source: candidate.file,
        seq: event.seq,
        callId,
        call: calls.get(callId),
        block: {
          kind: 'tool-result',
          callId,
          name: 'a2ui',
          call: { name: 'a2ui', argsRaw: calls.get(callId)?.arguments ?? '' },
          content: event.data?.message?.content ?? [],
          isError: false,
          meta,
          argsRaw: calls.get(callId)?.arguments ?? '',
        },
      }
    }
  }
  return undefined
}

/** A surface that exercises every component in the catalog. */
function allComponents() {
  const components = [
    { id: 'root', component: 'Column', children: ['text', 'icons', 'layout', 'card', 'tabs', 'divider', 'form', 'table', 'stats', 'charts', 'plot', 'player', 'progress', 'modal', 'media'] },
    { id: 'text', component: 'Text', text: '**Bold** and *italic* and `code`\nsecond line' },
    { id: 'icons', component: 'Row', children: ['iconOk', 'iconWarn'] },
    { id: 'iconOk', component: 'Icon', name: 'check' },
    { id: 'iconWarn', component: 'Icon', name: 'warning' },
    { id: 'layout', component: 'Row', children: ['l1', 'l2'], justify: 'spaceBetween' },
    { id: 'l1', component: 'Text', text: 'left', weight: 1 },
    { id: 'l2', component: 'Text', text: 'right', weight: 2 },
    { id: 'card', component: 'Card', child: 'text' },
    { id: 'tabs', component: 'Tabs', tabs: [{ title: 'One', child: 'l1' }, { title: 'Two', child: 'l2' }] },
    { id: 'divider', component: 'Divider' },
    { id: 'form', component: 'Column', children: ['tf', 'cb', 'cp', 'sl', 'dt', 'btn'] },
    { id: 'tf', component: 'TextField', label: 'Name', value: { '@path': '/name' }, placeholder: 'x' },
    { id: 'cb', component: 'CheckBox', label: 'Agree', value: { '@path': '/agree' } },
    { id: 'cp', component: 'ChoicePicker', label: 'Pick', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }], value: { '@path': '/pick' }, variant: 'multipleSelection', displayStyle: 'chips' },
    { id: 'sl', component: 'Slider', label: 'Amount', min: 0, max: 10, value: { '@path': '/amount' } },
    { id: 'dt', component: 'DateTimeInput', label: 'When', value: '', enableDate: true },
    { id: 'btn', component: 'Button', variant: 'primary', child: 'btnText', action: { event: { name: 'go', context: { name: { '@path': '/name' } } } } },
    { id: 'btnText', component: 'Text', text: 'Submit' },
    { id: 'table', component: 'Table', caption: 'Rows', columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B', format: 'number' }], rows: [{ a: 'x', b: 1 }, { a: 'y', b: 2 }] },
    { id: 'stats', component: 'Row', children: ['s1', 's2'], justify: 'start' },
    { id: 's1', component: 'Stat', label: 'Revenue', value: 1200, unit: 'CNY', trend: 'up', delta: '+8%' },
    { id: 's2', component: 'Stat', label: 'Churn', value: 0.03, trend: 'down', delta: '-1%' },
    { id: 'charts', component: 'Column', children: ['bar', 'line', 'pie'] },
    { id: 'bar', component: 'BarChart', categories: ['Q1', 'Q2'], series: [{ label: 'A', values: [3, 5] }, { label: 'B', values: [1, 2] }] },
    { id: 'line', component: 'LineChart', categories: ['Q1', 'Q2', 'Q3'], series: [{ label: 'A', values: [1, 4, 2] }], area: true, curve: 'smooth' },
    { id: 'pie', component: 'PieChart', slices: [{ label: 'x', value: 3 }, { label: 'y', value: 1 }], donut: true },
    { id: 'plot', component: 'Plot', plots: [{ label: 'f', expression: 'a*x^2+b' }], variables: { a: { '@path': '/a' }, b: 1 }, xMin: -3, xMax: 3 },
    { id: 'player', component: 'FramePlayer', frames: [{ label: 'f1', items: [{ value: 1 }, { value: 2 }] }, { label: 'f2', items: [{ value: 2, state: 'sorted' }, { value: 1 }] }], mode: 'bars' },
    { id: 'progress', component: 'Progress', label: 'Done', value: 4, max: 10, tone: 'success' },
    { id: 'modal', component: 'Modal', trigger: 'btn', content: 'text' },
    { id: 'media', component: 'Column', children: ['img'] },
    { id: 'img', component: 'Image', url: 'https://example.com/a.png', description: 'x' },
  ]
  return [{ version: '1.0', createSurface: { surfaceId: 'all', catalogId: 'dsh-a2ui/catalog/v1', components, dataModel: { name: 'Ada', agree: true, pick: ['a'], amount: 5, a: 2 } } }]
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

const { View, Tail } = loadView()
const failures = []

function render(Component, name, props) {
  try {
    const html = renderToStaticMarkup(React.createElement(Component, props))
    const visible = html.replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim()
    console.log(`\n[ok] ${name}: ${html.length} bytes of HTML`)
    console.log(`     text: ${visible.slice(0, 220)}`)
    return html
  } catch (error) {
    failures.push({ name, error })
    console.log(`\n[FAIL] ${name}`)
    console.log(`     ${error && error.message}`)
    console.log(String(error && error.stack).split('\n').slice(0, 8).join('\n'))
    return ''
  }
}

const baseProps = {
  callId: 'call_test',
  toolName: 'a2ui',
  sessionId: 'session-test',
  runtime: undefined,
}

// The component receives `runtime` from apply(); capture it through a second
// registration pass by rendering the raw exported component instead.
// `loadView()` returns the slot component (already bound to a runtime), so we
// only need call-scoped props here.
const recorded = recordedCall()
if (recorded === undefined) {
  console.log('no recorded a2ui call found; skipping the "recorded payload" case')
} else {
  render(View, 'recorded payload (result phase)', { ...baseProps, phase: 'result', block: recorded.block })
}

render(View, 'synthetic all-components surface', {
  ...baseProps,
  phase: 'result',
  block: {
    kind: 'tool-result',
    callId: 'call_all',
    name: 'a2ui',
    call: { name: 'a2ui', argsRaw: JSON.stringify({ messages: allComponents(), title: 'All components' }) },
    content: [{ type: 'text', text: 'rendered' }],
    isError: false,
    meta: { kind: 'a2ui', title: 'All components', messages: allComponents(), surfaces: [{ surfaceId: 'all', components: 1 }] },
  },
})

render(View, 'preparing phase (skeleton)', { ...baseProps, phase: 'preparing', block: { phase: 'preparing', callId: 'call_p', name: 'a2ui', subCalls: [] } })

render(View, 'host rejection (error card)', {
  ...baseProps,
  phase: 'result',
  block: {
    kind: 'tool-result',
    callId: 'call_err',
    name: 'a2ui',
    call: { name: 'a2ui', argsRaw: '{}' },
    content: [{ type: 'text', text: 'Error: A2UI payload rejected (1 problem):\n- /messages/0/createSurface: nope' }],
    isError: true,
    meta: undefined,
  },
})

render(View, 'invalid payload (client-side guard)', {
  ...baseProps,
  phase: 'result',
  block: {
    kind: 'tool-result',
    callId: 'call_bad',
    name: 'a2ui',
    call: { name: 'a2ui', argsRaw: JSON.stringify({ messages: [{ version: '1.0', createSurface: { surfaceId: 'x', components: [{ id: 'root', component: 'Nope' }] } }] }) },
    content: [{ type: 'text', text: 'rendered' }],
    isError: false,
    meta: undefined,
  },
})

render(View, 'update-only card', {
  ...baseProps,
  phase: 'result',
  block: {
    kind: 'tool-result',
    callId: 'call_upd',
    name: 'a2ui',
    call: { name: 'a2ui', argsRaw: JSON.stringify({ messages: [{ version: '1.0', updateDataModel: { surfaceId: 'earlier', path: '/a', value: 1 } }] }) },
    content: [{ type: 'text', text: 'updated' }],
    isError: false,
    meta: undefined,
  },
})

// The process row must degrade to a one-line pointer once the turn tail owns the
// card, so the card is never drawn twice (the turn tail renders it then).
if (recorded !== undefined) {
  render(View, 'process row, copy claimed elsewhere (compact pointer)', {
    ...baseProps,
    phase: 'result',
    block: recorded.block,
    compact: true,
  })
}

// The turn tail: same card, host slot outside the foldable process window.
if (recorded !== undefined) {
  const tailNodes = new Map([
    ['call:test', { kind: 'tool-call', visibility: 'visible', location: { kind: 'step', turn: { turn: 1 } }, data: { root: recorded.block } }],
    ['call:other', { kind: 'tool-call', visibility: 'visible', location: { kind: 'step', turn: { turn: 9 } }, data: { root: recorded.block } }],
  ])
  render(Tail, 'turn tail (closed turn, one a2ui call)', {
    turn: { turn: 1, status: 'closed' },
    seq: 99,
    sessionId: 'session-test',
    useChat: (selector) => selector({ order: ['call:test', 'call:other'], nodes: tailNodes }),
  })
  render(Tail, 'turn tail with no a2ui call (must render nothing)', {
    turn: { turn: 2, status: 'closed' },
    seq: 100,
    sessionId: 'session-test',
    useChat: (selector) => selector({ order: ['call:test'], nodes: tailNodes }),
  })
}

if (failures.length > 0) {
  console.error(`\n${failures.length} render case(s) failed`)
  process.exit(1)
}
console.log('\nall render cases produced HTML without throwing')