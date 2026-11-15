/**
 * DOM-level behaviour of the shipped browser bundle.
 *
 * The SSR harness proves structure; these tests prove the interaction contract
 * the review asked for with real events: a double click enqueues once, a rejected
 * send leaves the form editable so it can be retried, an edit made in the process
 * row is still there when the turn tail takes over, and a hidden call never
 * renders.
 *
 * The action path is exercised through the plugin's *own* `sendPrompt`, which
 * looks the Conversation service up through `sessions.scope(id).get(...)`; the
 * harness supplies that service, so a click proves the message would really be
 * queued — not that a test double was called.
 *
 * jsdom is a dev-only dependency; the bundle itself still needs only `react`.
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' })
const { window } = dom

/** Node's own globals for `window`/`navigator` are read-only accessors. */
function defineGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}

// The DOM globals must exist *before* `react-dom` is imported: it captures
// `document`/`window` while initializing, and with them missing the event system
// never receives a single event (silent, and very confusing).
defineGlobal('window', window)
defineGlobal('document', window.document)
defineGlobal('navigator', window.navigator)
defineGlobal('IS_REACT_ACT_ENVIRONMENT', true)
defineGlobal('HTMLElement', window.HTMLElement)
defineGlobal('HTMLInputElement', window.HTMLInputElement)
defineGlobal('MouseEvent', window.MouseEvent)
defineGlobal('Event', window.Event)

const { createRoot } = await import('react-dom/client')
const { act } = await import('react-dom/test-utils')
const { loadView, React, ROOT, sessionEvents, toolDelta } = await import('../tools/lib/render-view.mjs')

/** Messages the plugin would queue, in order. */
let sent = []
/** When set, the next queued send rejects with this message. */
let sendFailure = null

const feeds = new Map()
const { View, Tail } = loadView({
  eventSource: (sessionId) => feeds.get(sessionId),
  locale: 'en-US',
  // The plugin attaches the modal's Escape/Tab handling to `document`, so the
  // bundle must see the same document the test dispatches into.
  document: window.document,
  onSend: async (text, sessionId) => {
    if (sendFailure !== null) {
      const failure = sendFailure
      sendFailure = null
      throw new Error(failure)
    }
    sent.push({ text, sessionId })
  },
})

function surfaceBlock(messages) {
  return {
    kind: 'tool-result',
    callId: 'call_dom',
    name: 'a2ui',
    call: { name: 'a2ui', argsRaw: JSON.stringify({ messages }) },
    content: [{ type: 'text', text: 'rendered' }],
    isError: false,
    meta: { kind: 'a2ui', messages },
  }
}

function formMessages() {
  return [
    {
      version: '1.0',
      createSurface: {
        surfaceId: 'form',
        dataModel: { name: '' },
        components: [
          { id: 'root', component: 'Column', children: ['field', 'slider', 'submit'] },
          { id: 'field', component: 'TextField', label: 'Name', value: { '@path': '/name' } },
          { id: 'slider', component: 'Slider', label: 'Amount', min: 0, max: 10, value: { '@path': '/amount' } },
          {
            id: 'submit',
            component: 'Button',
            child: 'submitLabel',
            action: { event: { name: 'save', context: { name: { '@path': '/name' }, amount: { '@path': '/amount' } } } },
          },
          { id: 'submitLabel', component: 'Text', text: 'Save' },
        ],
      },
    },
  ]
}

/** Each test gets its own session, so no editable state leaks between cases. */
let sessionSerial = 0

function viewProps(overrides = {}) {
  sessionSerial += 1
  return {
    callId: 'call_dom',
    toolName: 'a2ui',
    sessionId: `session-dom-${sessionSerial}`,
    phase: 'result',
    block: surfaceBlock(formMessages()),
    ...overrides,
  }
}

function tailProps(sessionId, nodes, turn) {
  return {
    turn: { turn, status: 'closed' },
    seq: 1,
    sessionId,
    useChat: (selector) => selector({ order: [...nodes.keys()], nodes, locations: { getTurn: () => [...nodes.keys()] } }),
  }
}

function nodeFor(root, turn, visibility = 'visible') {
  return { kind: 'tool-call', visibility, location: { kind: 'turn', turn: { turn } }, data: { root } }
}

function mount(element) {
  const container = window.document.getElementById('root')
  container.innerHTML = ''
  const root = createRoot(container)
  act(() => root.render(element))
  return {
    container,
    render: (next) => act(() => root.render(next)),
    unmount: () => act(() => root.unmount()),
  }
}

function query(container, selector) {
  const element = container.querySelector(selector)
  assert.ok(element !== null, `expected ${selector} to exist`)
  return element
}

function typeInto(element, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  act(() => {
    setter.call(element, value)
    element.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}

function click(element) {
  act(() => {
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
}

/** Click and let the send promise settle (the failure path is asynchronous). */
async function clickSettled(element) {
  await act(async () => {
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
}

before(() => {
  sent = []
  sendFailure = null
})

// No `after()` closing the jsdom window: with several test files imported into
// one process the hook can fire between them, leaving later renders with a
// closed document. The process exits without it.

test('an edit in the process row survives the hand-over to the turn tail', () => {
  const props = viewProps()
  const row = mount(React.createElement(View, props))
  typeInto(query(row.container, 'input[type="text"]'), 'Ada Lovelace')
  // The row is replaced by the tail copy — a different React tree and a fresh
  // component instance, so a component-local model would reset to `''` here.
  row.unmount()

  const nodes = new Map([['call:dom', nodeFor(surfaceBlock(formMessages()), 1)]])
  const tail = mount(React.createElement(Tail, tailProps(props.sessionId, nodes, 1)))
  assert.equal(query(tail.container, 'input[type="text"]').value, 'Ada Lovelace')
  tail.unmount()
})

test('a double click queues exactly one action', () => {
  sent = []
  const view = mount(React.createElement(View, viewProps()))
  const button = query(view.container, 'button')
  click(button)
  click(button)
  assert.equal(sent.length, 1, `expected one queued message, got ${sent.length}`)
  assert.match(sent[0].text, /^\[A2UI action\]/u)
  view.unmount()
})

test('a rejected send leaves the form editable so it can be retried', async () => {
  sent = []
  sendFailure = 'QUEUE_FULL'
  const view = mount(React.createElement(View, viewProps()))
  const button = query(view.container, 'button')
  const input = query(view.container, 'input[type="text"]')
  const slider = query(view.container, 'input[type="range"]')

  await clickSettled(button)
  assert.equal(sent.length, 0)
  assert.equal(input.disabled, false, 'the text field must be editable after a failure')
  assert.equal(slider.disabled, false, 'the slider must be editable after a failure')
  assert.equal(button.disabled, false, 'the button must be clickable again')

  typeInto(input, 'Grace Hopper')
  await clickSettled(button)
  assert.equal(sent.length, 1, 'the retry must queue exactly one message')
  assert.match(sent[0].text, /Grace Hopper/u)
  view.unmount()
})

test('a successful send locks the form', () => {
  sent = []
  const view = mount(React.createElement(View, viewProps()))
  click(query(view.container, 'button'))
  assert.equal(sent.length, 1)
  assert.equal(query(view.container, 'input[type="text"]').disabled, true)
  assert.equal(query(view.container, 'input[type="range"]').disabled, true)
  view.unmount()
})

test('a hidden call never renders at the turn tail', () => {
  const nodes = new Map([['call:hidden', nodeFor(surfaceBlock(formMessages()), 2, 'hidden')]])
  const tail = mount(React.createElement(Tail, tailProps('session-hidden', nodes, 2)))
  assert.equal(tail.container.querySelector('input[type="text"]'), null)
  tail.unmount()
})

test('a renamed tool still renders at the turn tail through its result meta', () => {
  const renamed = surfaceBlock(formMessages())
  renamed.name = 'myui'
  renamed.call = { name: 'myui', argsRaw: '{}' }
  const nodes = new Map([['call:renamed', nodeFor(renamed, 3)]])
  const tail = mount(React.createElement(Tail, tailProps('session-renamed', nodes, 3)))
  assert.ok(tail.container.querySelector('input[type="text"]') !== null, 'the renamed card must render')
  tail.unmount()
})

test('a renamed tool without a2ui meta is not claimed', () => {
  const foreign = { kind: 'tool-result', callId: 'call:foreign', name: 'myui', call: { name: 'myui', argsRaw: '{}' }, content: [], isError: false }
  const nodes = new Map([['call:foreign', nodeFor(foreign, 4)]])
  const tail = mount(React.createElement(Tail, tailProps('session-foreign', nodes, 4)))
  assert.equal(tail.container.innerHTML, '')
  tail.unmount()
})

test('the official incremental example wires each row button to its own row', () => {
  const messages = JSON.parse(fs.readFileSync(`${ROOT}/tests/fixtures/examples/00_incremental.json`, 'utf8')).messages
  sent = []
  const view = mount(React.createElement(View, viewProps({ block: surfaceBlock(messages) })))
  const buttons = [...view.container.querySelectorAll('button')]
  assert.equal(buttons.length, 4, 'one button per restaurant')
  click(buttons[2])
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /Pizzeria Roma/u)
  view.unmount()
})

/* ------------------------------------------------------------------ */
/* Keyboard behaviour: Tabs arrow keys, Modal focus management          */
/* ------------------------------------------------------------------ */

function keyboard(element, key) {
  act(() => {
    element.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

for (const [mode, options, anchor, expectedLeft, expectedTop] of [
  ['grouped', {}, { left: 60, top: 118, width: 20, height: 66 }, 88, 131],
  ['stacked', { stacked: true }, { left: 260, top: 104, width: 24, height: 12 }, 148, 90],
  ['horizontal', { horizontal: true }, { left: 50, top: 163, width: 52, height: 14 }, 110, 150],
]) {
  test(`the ${mode} bar tooltip follows the hovered rectangle and stays within the plot`, () => {
    const category = '末行分类'
    const label = '中文数据系列说明，包含足够长的文字'
    const messages = [{ version: '1.0', createSurface: { surfaceId: 'bar', components: [
      { id: 'root', component: 'BarChart', categories: ['首行', category], series: [
        { label: 'Series 1', values: [100, 64] },
        { label, values: [40, 24] },
      ], valueSuffix: '万元', ...options },
    ] } }]
    const { container, unmount } = mount(React.createElement(View, viewProps({ block: surfaceBlock(messages) })))
    const plot = query(container, '.a2ui-bar-plot')
    const bar = plot.querySelectorAll('rect').item(3)
    const measure = (left, top, width, height) => ({
      left: 150 + left * 2, top: 80 + top * 2, right: 150 + (left + width) * 2, bottom: 80 + (top + height) * 2,
      width: width * 2, height: height * 2,
    })
    Object.defineProperties(plot, { clientWidth: { value: 300 }, clientHeight: { value: 200 } })
    plot.getBoundingClientRect = () => measure(0, 0, 300, 200)
    bar.getBoundingClientRect = () => measure(anchor.left, anchor.top, anchor.width, anchor.height)
    const prototype = window.HTMLElement.prototype
    const original = prototype.getBoundingClientRect
    prototype.getBoundingClientRect = function () {
      return this.matches('.a2ui-bar-tip') ? measure(0, 0, 104, 40) : original.call(this)
    }
    try {
      act(() => bar.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true })))
      const tip = query(plot, '[role=tooltip]')
      assert.deepEqual([...tip.children].map((line) => line.textContent), [category, `${label}: 24 万元`])
      assert.equal(tip.style.left, `${expectedLeft}px`)
      assert.equal(tip.style.top, `${expectedTop}px`)
      act(() => bar.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true })))
      assert.equal(plot.querySelector('[role=tooltip]'), null)
    } finally {
      prototype.getBoundingClientRect = original
      unmount()
    }
  })
}

test('arrow keys move the selected tab and keep focus in the tab strip', () => {
  const messages = [
    {
      version: '1.0',
      createSurface: {
        surfaceId: 'tabs',
        components: [
          { id: 'root', component: 'Tabs', tabs: [{ title: 'One', child: 'p1' }, { title: 'Two', child: 'p2' }, { title: 'Three', child: 'p3' }] },
          { id: 'p1', component: 'Text', text: 'panel one' },
          { id: 'p2', component: 'Text', text: 'panel two' },
          { id: 'p3', component: 'Text', text: 'panel three' },
        ],
      },
    },
  ]
  const view = mount(React.createElement(View, viewProps({ block: surfaceBlock(messages) })))
  const tabs = [...view.container.querySelectorAll('[role="tab"]')]
  assert.equal(tabs.length, 3)
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true')
  assert.equal(tabs[0].getAttribute('tabindex'), '0')
  assert.equal(tabs[1].getAttribute('tabindex'), '-1')

  keyboard(tabs[0], 'ArrowRight')
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true')
  assert.equal(tabs[0].getAttribute('aria-selected'), 'false')
  assert.equal(window.document.activeElement, tabs[1], 'focus follows the selection')

  keyboard(tabs[1], 'End')
  assert.equal(tabs[2].getAttribute('aria-selected'), 'true')

  keyboard(tabs[2], 'ArrowRight')
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true', 'ArrowRight wraps to the first tab')

  keyboard(tabs[0], 'ArrowLeft')
  assert.equal(tabs[2].getAttribute('aria-selected'), 'true', 'ArrowLeft wraps to the last tab')
  view.unmount()
})

test('a modal traps focus, closes on Escape and returns focus to its trigger', () => {
  const messages = [
    {
      version: '1.0',
      createSurface: {
        surfaceId: 'modal',
        components: [
          { id: 'root', component: 'Modal', trigger: 'open', content: 'body' },
          // A local `functionCall` keeps the trigger a real, enabled button: an
          // `action.event` would disable it after the send, and a disabled button
          // cannot take focus back when the dialog closes.
          {
            id: 'open',
            component: 'Button',
            child: 'openLabel',
            action: { functionCall: { '@call': 'formatString', args: { value: 'open' } } },
          },
          { id: 'openLabel', component: 'Text', text: 'Open details' },
          { id: 'body', component: 'Text', text: 'Inside the dialog' },
        ],
      },
    },
  ]
  const view = mount(React.createElement(View, viewProps({ block: surfaceBlock(messages) })))
  const trigger = query(view.container, '.a2ui-modal-trigger button')
  click(trigger)

  const dialog = query(view.container, '[role="dialog"]')
  assert.equal(dialog.getAttribute('aria-modal'), 'true')
  const focusables = [...dialog.querySelectorAll('button')]
  assert.ok(focusables.length > 0)
  assert.ok(dialog.contains(window.document.activeElement), 'focus starts inside the dialog')

  keyboard(focusables[focusables.length - 1], 'Tab')
  assert.ok(dialog.contains(window.document.activeElement), 'Tab keeps focus inside the dialog')

  keyboard(dialog, 'Escape')
  assert.equal(view.container.querySelector('[role="dialog"]'), null, 'Escape closes the dialog')
  // The trigger element is re-created when the dialog closes, so focus is checked
  // against the current one rather than the reference captured before opening.
  const restored = query(view.container, '.a2ui-modal-trigger button')
  assert.equal(window.document.activeElement, restored, 'focus returns to the trigger')
  view.unmount()
})

/**
 * The generating preview must be genuinely read-only.
 *
 * jsdom does not implement `inert` semantics, so the DOM assertion is the
 * attribute React actually produced (the browser is what makes it block Tab and
 * clicks); the behavioural half is asserted separately: a click on a preview
 * button queues nothing, and the same call once settled is a normal card again.
 */
test('the generating preview body is inert and hands over to an interactive card', () => {
  const sessionId = 'session-stream-dom'
  const callId = 'call_stream_dom'
  const feed = sessionEvents()
  feeds.set(sessionId, feed)
  const components = [
    { id: 'root', component: 'Tabs', tabs: [{ title: 'One', child: 'panel' }] },
    { id: 'panel', component: 'Column', children: ['text', 'button'] },
    { id: 'text', component: 'Text', text: 'streamed text' },
    { id: 'button', component: 'Button', child: 'label', action: { event: { name: 'go' } } },
    { id: 'label', component: 'Text', text: 'Send it' },
  ]
  const messages = [{ version: '1.0', createSurface: { surfaceId: 'live', catalogId: 'dsh-a2ui/catalog/v1', components } }]
  const text = JSON.stringify({ messages })
  const cut = text.indexOf('streamed text')

  sent = []
  const preparing = mount(
    React.createElement(View, {
      callId,
      toolName: 'a2ui',
      sessionId,
      phase: 'preparing',
      block: { phase: 'preparing', callId, name: 'a2ui', subCalls: [] },
    }),
  )
  assert.equal(feed.subscriberCount(), 1)
  assert.ok(preparing.container.querySelector('.a2ui-skel'))
  act(() => feed.append(toolDelta(1, callId, text.slice(0, cut), { name: 'a2ui' })))
  assert.doesNotMatch(preparing.container.textContent, /streamed text/u)
  act(() => feed.append(toolDelta(2, callId, text.slice(cut))))
  assert.match(preparing.container.textContent, /streamed text/u)
  const body = query(preparing.container, '.a2ui-card-streaming .a2ui-card-body')
  assert.equal(body.getAttribute('inert'), '', 'the preview body carries the inert attribute')
  assert.equal(preparing.container.querySelectorAll('.a2ui-card-streaming').length, 1)
  // The content is still drawn — inert blocks input, it does not hide the card.
  assert.ok(query(preparing.container, '[role="tab"]') !== null)
  assert.equal(query(preparing.container, '.a2ui-card-title').textContent, 'Building interface…')
  assert.equal(query(preparing.container, '.a2ui-card-state').textContent, 'generating')

  // The submit path is a stub during the preview, so even a synthetic click queues
  // nothing (this is the guard that does not depend on `inert`).
  click(query(preparing.container, '.a2ui-btn'))
  assert.deepEqual(sent, [], 'a preview click must not send an action')
  act(() => feed.settle('attempt'))
  assert.doesNotMatch(preparing.container.textContent, /streamed text/u)
  act(() => feed.replace([toolDelta(3, callId, text, { name: 'a2ui', attemptId: 'retry' })]))
  assert.match(preparing.container.textContent, /streamed text/u)
  act(() => feed.replace([]))
  assert.doesNotMatch(preparing.container.textContent, /streamed text/u)

  // The same mounted card hands off to the normal interactive result.
  preparing.render(React.createElement(View, viewProps({ callId, sessionId, block: surfaceBlock(messages) })))
  assert.equal(feed.subscriberCount(), 0)
  const settled = preparing
  assert.equal(settled.container.querySelector('.a2ui-card-streaming'), null)
  const settledBody = query(settled.container, '.a2ui-card-body')
  assert.equal(settledBody.hasAttribute('inert'), false, 'the settled card is not inert')
  const tab = query(settled.container, '[role="tab"]')
  assert.equal(tab.getAttribute('tabindex'), '0', 'the settled card is back in the tab order')
  click(query(settled.container, '.a2ui-btn'))
  assert.equal(sent.length, 1, 'the settled card still sends its action')
  settled.unmount()
  feeds.delete(sessionId)
})
