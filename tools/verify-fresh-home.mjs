#!/usr/bin/env node
/**
 * Fresh-home install verification.
 *
 * Builds a throwaway DSH home, installs this plugin into one profile exactly the
 * way a tarball install lays it out (`profiles/<p>/node_modules/dsh-a2ui`), and
 * then exercises the enable/disable path at the manifest level:
 *
 *   1. install  → every published file is present and byte-identical, the
 *                 profile dependency and bundle list are set;
 *   2. disable  → dropping the bundle row makes the verifier report it, which is
 *                 the same manifest-driven switch DSH reads;
 *   3. re-enable → the checks pass again.
 *
 * What this cannot cover: rendering inside the GUI, clicking a card, reopening a
 * session and paging history — those need a running Host with a browser. The
 * script prints that limit rather than implying coverage.
 *
 * Usage: node tools/verify-fresh-home.mjs [--keep]
 */
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { verifyInstall } from './verify-install.mjs'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const NAME = manifest.name

/** Expand the `files` whitelist into concrete source paths. */
async function publishedFiles() {
  const out = []
  const add = (path) => out.push(path)
  for (const pattern of manifest.files) {
    if (pattern.endsWith('/**/*.js')) {
      const base = pattern.slice(0, -'/**/*.js'.length)
      const walk = async (dirRelative) => {
        for (const entry of await readdir(join(root, dirRelative), { withFileTypes: true })) {
          const next = `${dirRelative}/${entry.name}`
          if (entry.isDirectory()) await walk(next)
          else if (entry.name.endsWith('.js')) add(next)
        }
      }
      await walk(base)
      continue
    }
    if (pattern.includes('*')) {
      const [dir, filePattern] = [pattern.slice(0, pattern.lastIndexOf('/')), pattern.slice(pattern.lastIndexOf('/') + 1)]
      const suffix = filePattern.replace('*', '')
      for (const entry of await readdir(join(root, dir))) if (entry.endsWith(suffix)) add(`${dir}/${entry}`)
      continue
    }
    add(pattern)
  }
  add('package.json')
  return [...new Set(out)]
}

async function installInto(profileDir, files) {
  const target = join(profileDir, 'node_modules', NAME)
  for (const relative of files) {
    const destination = join(target, relative)
    await mkdir(join(destination, '..'), { recursive: true })
    await cp(join(root, relative), destination)
  }
  const profileManifest = {
    name: `dsh-profile-${manifest.name}-review`,
    private: true,
    version: '0.0.0',
    dependencies: { [NAME]: `file:node_modules/${NAME}` },
    dsh: { profile: { bundles: [NAME] } },
  }
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify(profileManifest, null, 2)}\n`, 'utf8')
}

function report(label, result, expectation) {
  const ok = expectation === 'pass' ? result.failures.length === 0 : result.failures.length > 0
  console.log(`\n[${ok ? 'ok' : 'FAIL'}] ${label}`)
  for (const line of result.passes) console.log(`   PASS  ${line}`)
  for (const line of result.failures) console.log(`   FAIL  ${line}`)
  return ok
}

const home = await mkdtemp(join(tmpdir(), 'dsh-a2ui-fresh-home-'))
const profile = 'review'
const profileDir = join(home, 'profiles', profile)
await mkdir(profileDir, { recursive: true })

const files = await publishedFiles()
console.log(`fresh DSH home : ${home}`)
console.log(`published files: ${files.length} (from package.json "files")`)

await installInto(profileDir, files)
let failures = 0
if (!report('install', verifyInstall({ dshHome: home, profile }), 'pass')) failures += 1

// Disable: the bundle row is what DSH reads to load a bundle.
const manifestPath = join(profileDir, 'package.json')
const profileManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
profileManifest.dsh.profile.bundles = []
await writeFile(manifestPath, `${JSON.stringify(profileManifest, null, 2)}\n`, 'utf8')
if (!report('disable (bundle row removed)', verifyInstall({ dshHome: home, profile }), 'fail')) failures += 1

// Re-enable.
profileManifest.dsh.profile.bundles = [NAME]
await writeFile(manifestPath, `${JSON.stringify(profileManifest, null, 2)}\n`, 'utf8')
if (!report('re-enable', verifyInstall({ dshHome: home, profile }), 'pass')) failures += 1

// A version skew must be caught (the checks compare against the repository).
const installedManifestPath = join(profileDir, 'node_modules', NAME, 'package.json')
const installedManifest = JSON.parse(await readFile(installedManifestPath, 'utf8'))
installedManifest.version = '0.0.1-skew'
await writeFile(installedManifestPath, `${JSON.stringify(installedManifest, null, 2)}\n`, 'utf8')
if (!report('version skew is detected', verifyInstall({ dshHome: home, profile }), 'fail')) failures += 1

console.log('\nNot covered by this harness (needs a running Host + browser):')
console.log('  · rendering a card in the GUI, clicking an action, and the queued user message')
console.log('  · reopening a session and paging history')
if (process.argv.includes('--keep') === false) console.log(`\n(the throwaway home is kept at ${home}; delete it with your file rules if unwanted)`)

if (failures > 0) {
  console.error(`\n${failures} scenario(s) failed.`)
  process.exit(1)
}
console.log('\nAll fresh-home scenarios behaved as expected.')
