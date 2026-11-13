import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(import.meta.dirname, '..')

/**
 * Verify that a profile directory holds a self-consistent install of this plugin.
 *
 * Checks the profile manifest (dependency + bundle list), the installed copy's
 * manifest, every published file byte-for-byte against the repository, and the
 * Cordis patch row. Importable so an isolated-home harness can reuse it.
 *
 * @param options.dshHome DSH home to inspect.
 * @param options.profile profile name inside that home.
 * @returns the passing and failing check descriptions.
 */
export function verifyInstall(options = {}) {
  const sourceManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const dshHome = resolve(options.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))
  const profile = options.profile ?? process.env.DSH_PROFILE ?? 'desktop'
  const profileDir = join(dshHome, 'profiles', profile)
  const manifestPath = join(profileDir, 'package.json')
  const installedDir = join(profileDir, 'node_modules', sourceManifest.name)

  const failures = []
  const passes = []
  const check = (condition, message) => (condition ? passes.push(message) : failures.push(message))
  const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

  check(existsSync(manifestPath), `profile manifest exists: ${manifestPath}`)
  if (existsSync(manifestPath)) {
    const profileManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const dependency = profileManifest.dependencies?.[sourceManifest.name]
    check(typeof dependency === 'string', `dependency "${sourceManifest.name}" is present`)
    check(
      Array.isArray(profileManifest.dsh?.profile?.bundles) && profileManifest.dsh.profile.bundles.includes(sourceManifest.name),
      `bundle list contains "${sourceManifest.name}"`,
    )
  }

  check(existsSync(installedDir), `installed package exists: ${installedDir}`)
  if (existsSync(installedDir)) {
    const installedManifest = JSON.parse(readFileSync(join(installedDir, 'package.json'), 'utf8'))
    check(installedManifest.name === sourceManifest.name, `installed name is ${sourceManifest.name}`)
    check(
      installedManifest.version === sourceManifest.version,
      `installed version is ${installedManifest.version} (source ${sourceManifest.version})`,
    )

    const files = [
      'index.js',
      'client.js',
      'cordis.patch.yml',
      'icon.svg',
      'locale/en.json',
      'locale/zh.json',
      'lib/host/index.js',
      'lib/shared/index.js',
      'lib/shared/validate.js',
    ]
    for (const relative of files) {
      const installedFile = join(installedDir, relative)
      if (!existsSync(installedFile)) {
        failures.push(`installed file missing: ${relative}`)
        continue
      }
      check(digest(join(root, relative)) === digest(installedFile), `byte-identical: ${relative}`)
    }

    const installedPatch = readFileSync(join(installedDir, 'cordis.patch.yml'), 'utf8')
    check(installedPatch.includes('id: dsh-a2ui'), 'installed patch inserts the dsh-a2ui row')
  }

  return { dshHome, profile, installedDir, passes, failures, sourceManifest }
}

/** CLI entry: print the checks and exit non-zero on failure. */
function main() {
  const args = process.argv.slice(2)
  const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`)
    return index >= 0 ? args[index + 1] : fallback
  }
  const result = verifyInstall({ dshHome: option('dsh-home', undefined), profile: option('profile', undefined) })
  console.log('dsh-a2ui install verification')
  console.log(`  DSH home : ${result.dshHome}`)
  console.log(`  Profile  : ${result.profile}`)
  console.log(`  Installed: ${result.installedDir}`)
  for (const line of result.passes) console.log(`  PASS  ${line}`)
  for (const line of result.failures) console.log(`  FAIL  ${line}`)
  if (result.failures.length > 0) {
    console.error(`\n${result.failures.length} check(s) failed.`)
    process.exit(1)
  }
  console.log(`\nAll ${result.passes.length} checks passed.`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
