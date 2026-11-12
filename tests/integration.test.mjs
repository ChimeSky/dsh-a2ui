/**
 * Integration tests: the Host plugin as the registry sees it, and the browser
 * bundle as the module table sees it (loaded in a `vm` with a React stub, so the
 * real wrapper, linker, and `apply()` run without a DOM).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

import * as host from '../index.js'
import { shared } from '../build/shared.mjs'

const { safeMediaUrl, safeExternalUrl, safeSvgPath } = shared

function makeHostContext() {
  const tools = new Map()
  const sections = []
  const effects = []
  return {
    tools: {
      register(definition) {
        if (tools.has(definition.name)) throw new Error(`duplicate tool ${definition.name}`)
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    systemPrompt: {
      section(definition) {
        sections.push(definition)
        return () => {
          sections.splice(sections.indexOf(definition), 1)
        }
      },
    },
    effect(factory, label) {
      const cleanup = factory()
      effects.push({ label, cleanup })
      return cleanup
    },
    logger: { debug() {}, warn() {} },
    tools_, sections_, effects_,
  }
  function tools_() {
    return tools
  }
  function sections_() {
    return sections
  }
  function effects_() {
    return effects
  }
}

function mount(config) {
  const ctx = makeHostContext()
  host.apply(ctx, config)
  return ctx
}

test('host exports a Cordis plugin shape', () => {
  assert.equal(typeof host.apply, 'function')
  assert.deepEqual(host.inject, ['tools', 'systemPrompt'])
  assert.equal(host.name, 'dsh-a2ui')
})

test('host registers the two tools and one prompt section', () => {
  const ctx = mount({})
  const tools = ctx.tools_()
  assert.deepEqual([...tools.keys()].sort(), ['a2ui', 'a2ui_catalog'])
  const tool = tools.get('a2ui')
  assert.deepEqual(Object.keys(tool.parameters.properties).sort(), ['messages', 'title'])
  assert.deepEqual(tool.parameters.required, ['messages'])
  assert.equal(tool.parameters.additionalProperties, false)
  assert.match(tool.description, /A2UI 1\.0/u)
  assert.match(tool.description, /\[A2UI action\]/u)

  const sections = ctx.sections_()
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'dsh-a2ui:guidance')
  assert.equal(sections[0].order, 120)
  assert.match(sections[0].text, /createSurface/u)
  assert.match(sections[0].text, /rules|Rules/u)

  assert.deepEqual(
    ctx.effects_().map((effect) => effect.label),
    ['dsh-a2ui: tool', 'dsh-a2ui: catalog tool', 'dsh-a2ui: prompt section'],
  )
})

test('mounting can mute the prompt section or the catalog tool', () => {
  const quiet = mount({ muteSection: true, catalogTool: false })
  assert.deepEqual([...quiet.tools_().keys()], ['a2ui'])
  assert.equal(quiet.sections_().length, 0)
})

test('the guidance triggers proactively by default', () => {
  const ctx = mount({})
  const prompt = ctx.sections_()[0].text
  assert.match(prompt, /Decide from what the answer contains/u)
  assert.match(prompt, /does not have to say|No one has to say/u)
  assert.match(prompt, /3\+ comparable rows/u)
  assert.match(ctx.tools_().get('a2ui').description, /proactively/u)
  assert.ok(prompt.length < 4_000, 'the always-on guidance must stay small')
})

test('autoRender false switches to on-request guidance only', () => {
  const ctx = mount({ autoRender: false })
  const prompt = ctx.sections_()[0].text
  assert.ok(!prompt.includes('Decide from what the answer contains'))
  assert.match(prompt, /Only render a surface when the user asks/u)
  assert.ok(!/proactively/u.test(ctx.tools_().get('a2ui').description))
  assert.ok(prompt.length < mount({}).sections_()[0].text.length, 'the opt-out text is shorter')
})

test('the tool executes a valid payload and renders a compact summary', async () => {
  const ctx = mount({})
  const tool = ctx.tools_().get('a2ui')
  const args = {
    title: 'Monthly sales',
    messages: [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'sales',
          components: [
            { id: 'root', component: 'Column', children: ['chart'] },
            { id: 'chart', component: 'BarChart', categories: ['Jan', 'Feb'], series: [{ label: 'Units', values: [3, 5] }] },
          ],
        },
      },
    ],
  }
  const value = await tool.execute(args, { signal: new AbortController().signal })
  assert.equal(value.ok, true)
  assert.deepEqual(value.surfaces.map((surface) => surface.surfaceId), ['sales'])
  assert.match(value.note, /interface carries the detail/u)

  const content = tool.output.render(args, value)
  assert.equal(content[0].type, 'text')
  assert.match(content[0].text, /Rendered surface "sales" \(2 components\)/u)

  const meta = tool.output.presentationMeta(args, value)
  assert.equal(meta.kind, 'a2ui')
  assert.equal(meta.title, 'Monthly sales')
  assert.equal(meta.messages.length, 1)
  assert.equal(meta.surfaces[0].surfaceId, 'sales')
  assert.equal(meta.messagesOmitted, undefined)
})

test('the tool rejects an invalid payload with path-qualified reasons', async () => {
  const ctx = mount({})
  const tool = ctx.tools_().get('a2ui')
  await assert.rejects(
    () => tool.execute({ messages: [{ version: '1.0', createSurface: { surfaceId: 's', components: [{ id: 'root', component: 'Nope' }] } }] }, { signal: new AbortController().signal }),
    (error) => {
      assert.match(error.message, /A2UI payload rejected/u)
      assert.match(error.message, /\/messages\/0\/createSurface\/components\/0\/component/u)
      assert.match(error.message, /unknown component "Nope"/u)
      return true
    },
  )
})

test('a payload whose replay copy is too large omits it instead of failing', async () => {
  const ctx = mount({})
  const tool = ctx.tools_().get('a2ui')
  const chunk = 'x'.repeat(6_000)
  const components = [{ id: 'root', component: 'Column', children: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't'] }]
  'abcdefghijklmnopqrst'.split('').forEach((id) => components.push({ id, component: 'Text', text: chunk }))
  const args = { messages: [{ version: '1.0', createSurface: { surfaceId: 'big', components } }] }
  const value = await tool.execute(args, { signal: new AbortController().signal })
  assert.equal(value.ok, true)
  const meta = tool.output.presentationMeta(args, value)
  assert.equal(meta.messagesOmitted, true)
  assert.equal(meta.messages, undefined)
})

test('the catalog tool returns the component reference', async () => {
  const ctx = mount({})
  const tool = ctx.tools_().get('a2ui_catalog')
  const value = await tool.execute({ detail: 'full' }, { signal: new AbortController().signal })
  assert.match(value.text, /Table/u)
  assert.match(value.text, /Plot/u)
  assert.match(value.text, /BarChart/u)
  const brief = await tool.execute({ detail: 'brief' }, { signal: new AbortController().signal })
  assert.ok(brief.text.length < value.text.length)
})

test('effect cleanups remove every registration (plugin lifecycle)', () => {
  const ctx = mount({})
  assert.equal(ctx.tools_().size, 2)
  for (const effect of [...ctx.effects_()].reverse()) effect.cleanup?.()
  assert.equal(ctx.tools_().size, 0)
  assert.equal(ctx.sections_().length, 0)
})

/* ------------------------------------------------------------------ */
/* URL admission                                                       */
/* ------------------------------------------------------------------ */

test('URL admission blocks script and local-file schemes', () => {
  for (const bad of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,<script>', 'vbscript:x', '  ', 'https://a b c']) {
    assert.equal(safeMediaUrl(bad, true), undefined, bad)
  }
  assert.equal(safeMediaUrl('https://example.com/a.png', true), 'https://example.com/a.png')
  assert.equal(safeMediaUrl('http://example.com/a.png', false), 'http://example.com/a.png')
  assert.equal(safeMediaUrl('data:image/png;base64,iVBORw0KGgo=', true), 'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(safeMediaUrl('data:image/png;base64,iVBORw0KGgo=', false), undefined)
  assert.equal(safeExternalUrl('https://example.com'), 'https://example.com')
  assert.equal(safeExternalUrl('javascript:alert(1)'), undefined)
})

test('SVG path admission accepts path grammar and rejects markup', () => {
  assert.equal(safeSvgPath('M4 12l5 5L20 6z'), 'M4 12l5 5L20 6z')
  assert.equal(safeSvgPath('M0 0h10v10H0z'), 'M0 0h10v10H0z')
  assert.equal(safeSvgPath('"/><script>alert(1)</script>'), undefined)
  assert.equal(safeSvgPath('M0 0 onclick=alert(1)'), undefined)
})

/* ------------------------------------------------------------------ */
/* Browser bundle                                                      */
/* ------------------------------------------------------------------ */

async function loadClientBundle() {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const loaded = {}
  const document = {
    head: { appendChild() {} },
    querySelector() {
      return null
    },
    createElement() {
      return { dataset: {}, textContent: '', remove() {} }
    },
    addEventListener() {},
    removeEventListener() {},
  }
  const sandbox = { window: { __ModuleLoader__: { load: (definition) => (loaded[definition.id] = definition) } }, document, console }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  return { source, loaded }
}

const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: Symbol.for('react.fragment'),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: (value) => ({ current: value }),
  useCallback: (callback) => callback,
}

test('the browser bundle loads through the module table and registers the tool view', async () => {
  const { source, loaded } = await loadClientBundle()
  assert.ok(source.includes('window.__ModuleLoader__.load'))
  assert.ok(!/\beval\s*\(/u.test(source), 'the bundle must not call eval')
  assert.ok(!/new\s+Function\s*\(/u.test(source), 'the bundle must not construct functions from strings')
  assert.ok(!/dangerouslySetInnerHTML\s*:/u.test(source.replace(/^.*?\/\*.*?\*\/.*$/gmu, '')), 'the bundle must not inject HTML')

  const definition = loaded['dsh-a2ui']
  assert.ok(definition !== undefined, 'the bundle registers under the package name')
  const clientModule = definition.factory((specifier) => {
    if (specifier === 'react') return reactStub
    throw new Error(`unexpected external import: ${specifier}`)
  })
  assert.equal(typeof clientModule.apply, 'function')
  assert.deepEqual([...clientModule.inject], ['slots', 'locale', 'sessions'])

  const registrations = []
  const locales = []
  const injections = []
  const ctx = {
    effect(factory) {
      factory()
    },
    slots: {
      inject(key, callback) {
        injections.push(key)
        callback()
      },
      register(options) {
        registrations.push(options)
        return () => {}
      },
    },
    locale: {
      register(namespace) {
        locales.push(namespace)
        return () => {}
      },
      bind() {
        return (key) => key
      },
      getLocale() {
        return { id: 'zh-CN' }
      },
    },
    sessions: { scope: () => undefined },
  }
  clientModule.apply(ctx)
  assert.deepEqual(locales, ['dsh-a2ui'])
  assert.deepEqual(injections, ['tool.call.toolview', 'conversation.chat.turnTail'])
  assert.equal(registrations.length, 2)
  const toolRow = registrations.find((options) => options.name === 'tool.call.toolview')
  const turnTail = registrations.find((options) => options.name === 'conversation.chat.turnTail')
  assert.equal(toolRow.key, 'a2ui')
  assert.equal(turnTail.id, 'dsh-a2ui-surfaces')
})

test('the bundle exposes no Host-only modules to the browser', async () => {
  const { loaded } = await loadClientBundle()
  const requested = []
  loaded['dsh-a2ui'].factory((specifier) => {
    requested.push(specifier)
    if (specifier === 'react') return reactStub
    throw new Error(`unexpected external import: ${specifier}`)
  })
  assert.deepEqual([...new Set(requested)], ['react'], 'react must be the only external module')
})
