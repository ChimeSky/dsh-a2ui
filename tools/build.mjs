#!/usr/bin/env node
/**
 * Build the installable bundle without a bundler process.
 *
 * Why not esbuild: it talks to a native service over pipes, which the DSH file
 * sandbox refuses to create (`spawn EPERM`). Everything here runs in-process:
 *
 *   1. `typescript` compiles `src/**` to ESM in `build/esm`.
 *   2. The Host half is shipped as ordinary ESM files (`lib/**`), so
 *      Node resolves its imports natively.
 *   3. The browser half is linked into ONE file (`client.js`) by a
 *      small registry linker, wrapped in the `__ModuleLoader__` factory the
 *      Harness module table expects, with `react` left external.
 *
 * The linker only needs the ESM forms this repository emits (named/namespace
 * imports, named exports); `tools/verify-bundle.mjs` fails the build if the
 * output does not expose `apply`/`inject`.
 */
import ts from 'typescript'
import { mkdir, readdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const BUILD = path.join(ROOT, 'build')
const ESM = path.join(BUILD, 'esm')
const PKG = ROOT
const CLIENT_ID = 'dsh-a2ui'

const COMPILER_OPTIONS = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.React,
  jsxFactory: 'h',
  jsxFragmentFactory: 'Fragment',
  rootDir: SRC,
  outDir: ESM,
  declaration: false,
  sourceMap: false,
  removeComments: false,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  isolatedModules: true,
  skipLibCheck: true,
  strict: false,
  noEmitOnError: false,
}

function collectSources(dir) {
  return readdir(dir, { withFileTypes: true }).then(async (entries) => {
    const out = []
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...(await collectSources(full)))
      else if (/\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name)) out.push(full)
    }
    return out
  })
}

async function compile() {
  await rm(BUILD, { recursive: true, force: true })
  await mkdir(ESM, { recursive: true })
  const files = await collectSources(SRC)
  const program = ts.createProgram(files, COMPILER_OPTIONS)
  const result = program.emit()
  const diagnostics = [...ts.getPreEmitDiagnostics(program), ...result.diagnostics]
  const errors = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
  if (errors.length > 0) {
    const host = {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => ROOT,
      getNewLine: () => '\n',
    }
    throw new Error(`TypeScript emitted ${errors.length} error(s):\n${ts.formatDiagnostics(errors, host)}`)
  }
  return files
}

async function listEmitted(dir, prefix = '') {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const id = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await listEmitted(full, id)))
    else if (entry.name.endsWith('.js')) out.push(id)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* ESM -> registry linker                                              */
/* ------------------------------------------------------------------ */

const IMPORT_FROM = /^import\s+([^;]*?)\s+from\s+(['"])([^'"]+)\2;?[ \t]*$/gm
const IMPORT_SIDE_EFFECT = /^import\s+(['"])([^'"]+)\1;?[ \t]*$/gm
const EXPORT_STAR = /^export\s+\*\s+from\s+(['"])([^'"]+)\1;?[ \t]*$/gm
const EXPORT_DECL = /^export\s+(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm
const EXPORT_LIST = /^export\s*\{([^}]*)\};?[ \t]*$/gm

function resolveSpecifier(fromId, specifier) {
  if (!specifier.startsWith('.')) return specifier
  const base = path.posix.dirname(`/${fromId}`)
  const joint = path.posix.normalize(path.posix.join(base, specifier))
  return `.${joint}`
}

function importClauseToRequire(clause, targetId) {
  const target = JSON.stringify(targetId)
  const trimmed = clause.trim()
  if (trimmed.startsWith('* as ')) return `const ${trimmed.slice(5).trim()} = require(${target});`
  if (trimmed.startsWith('{')) {
    const inner = trimmed.slice(1, trimmed.lastIndexOf('}'))
    const bindings = inner
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const alias = entry.split(/\s+as\s+/u)
        return alias.length === 2 ? `${alias[0].trim()}: ${alias[1].trim()}` : entry
      })
    return `const { ${bindings.join(', ')} } = require(${target});`
  }
  return `const ${trimmed} = require(${target});`
}

function linkModule(id, source) {
  const exported = new Set()
  const aliases = []
  let body = source

  body = body.replace(IMPORT_FROM, (_match, clause, _quote, specifier) =>
    importClauseToRequire(clause, resolveSpecifier(id, specifier)),
  )
  body = body.replace(IMPORT_SIDE_EFFECT, (_match, _quote, specifier) =>
    `require(${JSON.stringify(resolveSpecifier(id, specifier))});`,
  )
  body = body.replace(EXPORT_STAR, (_match, _quote, specifier) =>
    `Object.assign(exports, require(${JSON.stringify(resolveSpecifier(id, specifier))}));`,
  )
  body = body.replace(EXPORT_DECL, (_match, kind, name) => {
    exported.add(name)
    return `${kind} ${name}`
  })
  body = body.replace(EXPORT_LIST, (_match, inner) => {
    for (const entry of inner.split(',')) {
      const trimmed = entry.trim()
      if (trimmed === '') continue
      const alias = trimmed.split(/\s+as\s+/u)
      if (alias.length === 2) {
        const local = alias[0].trim()
        const name = alias[1].trim()
        exported.add(name)
        aliases.push(`${name} = ${local}`)
      } else {
        exported.add(trimmed)
      }
    }
    return ''
  })
  if (/\bexport\s+default\b/u.test(body)) throw new Error(`${id}: default exports are not supported by the linker`)

  const tail = []
  for (const alias of aliases) {
    const [name, local] = alias.split(' = ')
    tail.push(`exports[${JSON.stringify(name)}] = ${local};`)
  }
  for (const name of exported) if (!aliases.some((alias) => alias.startsWith(`${name} =`))) tail.push(`exports[${JSON.stringify(name)}] = ${name};`)

  return `${body}\n${tail.join('\n')}`
}

async function buildClient() {
  const ids = [...(await listEmitted(path.join(ESM, 'shared'), 'shared')), ...(await listEmitted(path.join(ESM, 'client'), 'client'))]
  const modules = new Map()
  const dependencies = new Map()
  for (const id of ids) {
    const source = await readFile(path.join(ESM, ...id.split('/')), 'utf8')
    modules.set(`./${id}`, linkModule(`./${id}`, source))
    const specs = new Set()
    for (const match of source.matchAll(/^\s*import\s+(?:[^;]*?\s+from\s+)?(['"])([^'"]+)\1/gmu)) {
      const resolved = resolveSpecifier(`./${id}`, match[2])
      if (resolved.startsWith('.')) specs.add(resolved)
    }
    dependencies.set(`./${id}`, [...specs])
  }

  // Topological order so a module's dependencies initialize first.
  const order = []
  const state = new Map()
  const visit = (id) => {
    const status = state.get(id)
    if (status === 'done') return
    if (status === 'visiting') throw new Error(`circular client import involving ${id}`)
    state.set(id, 'visiting')
    for (const dependency of dependencies.get(id) ?? []) {
      if (modules.has(dependency)) visit(dependency)
      else if (dependency.startsWith('.')) throw new Error(`unresolved client import ${dependency} from ${id}`)
    }
    state.set(id, 'done')
    order.push(id)
  }
  visit('./client/index.js')

  const chunks = []
  chunks.push(`window.__ModuleLoader__.load({
  id: ${JSON.stringify(CLIENT_ID)},
  factory(require) {
    "use strict";
    var __cache = {};
    var __registry = {};
    function __load(id) {
      var hit = __cache[id];
      if (hit !== undefined) return hit.exports;
      var factory = __registry[id];
      if (factory === undefined) throw new Error("dsh-a2ui: unknown module " + id);
      var module = { exports: {} };
      __cache[id] = module;
      factory(module, module.exports, __require);
      return module.exports;
    }
    function __require(specifier) {
      return specifier.charAt(0) === "." ? __load(specifier) : require(specifier);
    }
`)
  for (const id of order) {
    chunks.push(`__registry[${JSON.stringify(id)}] = function(module, exports, require) {\n${modules.get(id)}\n};`)
  }
  chunks.push(`    return __load("./client/index.js");`)
  chunks.push(`  },`)
  chunks.push(`});`)
  const output = `/* dsh-a2ui — generated by tools/build.mjs. Do not edit. */\n${chunks.join('\n')}\n`
  await writeFile(path.join(PKG, 'client.js'), output, 'utf8')
  return output.length
}

async function buildHost(files) {
  for (const folder of ['host', 'shared']) {
    await rm(path.join(PKG, 'lib', folder), { recursive: true, force: true })
    await mkdir(path.join(PKG, 'lib', folder), { recursive: true })
  }
  for (const id of await listEmitted(path.join(ESM, 'host'), 'host')) {
    await copyEmitted(id)
  }
  for (const id of await listEmitted(path.join(ESM, 'shared'), 'shared')) {
    await copyEmitted(id)
  }
  await writeFile(
    path.join(PKG, 'index.js'),
    `/* dsh-a2ui — generated by tools/build.mjs. Do not edit. */
export { apply, inject, name } from './lib/host/index.js'
`,
    'utf8',
  )
  return files.length
}

async function copyEmitted(id) {
  const source = path.join(ESM, ...id.split('/'))
  const target = path.join(PKG, 'lib', ...id.split('/'))
  await mkdir(path.dirname(target), { recursive: true })
  await copyFile(source, target)
}

async function buildSharedForTests() {
  const target = path.join(BUILD, 'shared.mjs')
  const ids = await listEmitted(path.join(ESM, 'shared'), 'shared')
  const modules = new Map()
  for (const id of ids) modules.set(`./${id}`, linkModule(`./${id}`, await readFile(path.join(ESM, ...id.split('/')), 'utf8')))
  const chunks = [
    `/* dsh-a2ui — generated by tools/build.mjs. Do not edit. */`,
    `var __cache = {}; var __registry = {};`,
    `function __load(id) { var hit = __cache[id]; if (hit !== undefined) return hit.exports; var f = __registry[id]; if (f === undefined) throw new Error("unknown module " + id); var m = { exports: {} }; __cache[id] = m; f(m, m.exports, __require); return m.exports; }`,
    `function __require(specifier) { return __load(specifier); }`,
  ]
  for (const [id, source] of modules) chunks.push(`__registry[${JSON.stringify(id)}] = function(module, exports, require) {\n${source}\n};`)
  chunks.push(`export const shared = __load("./shared/index.js");`)
  await writeFile(target, `${chunks.join('\n')}\n`, 'utf8')
}

async function main() {
  const started = Date.now()
  const files = await compile()
  const clientBytes = await buildClient()
  await buildHost(files)
  await buildSharedForTests()
  console.log(`built ${files.length} TypeScript modules in ${Date.now() - started} ms`)
  console.log(`  index.js  (host ESM entry)`)
  console.log(`  lib/**    (host + shared modules)`)
  console.log(`  client.js (${Math.round(clientBytes / 1024)} KiB browser bundle)`)
  console.log(`  build/shared.mjs  (test harness)`)
}

await main()
