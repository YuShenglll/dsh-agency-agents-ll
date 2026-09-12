// P1 data pipeline - stage 1 of 2: pull the English upstream into assets/en and
// record the sync baseline in sync/manifest.json.
//
// Contract: docs/PLAN.md sections 3 and 7.
// Invariants:
//   - assets/en/** is byte-identical to the upstream checkout; files are copied,
//     never re-encoded, so LF stays LF and no BOM appears.
//   - assets/zh/** persona files are owned by the translation stage and are never
//     written here. Only assets/zh/LICENSE is created by this script.
//   - Running twice in a row changes nothing on disk.
//
// Run with: pnpm sync   (node is not on PATH in this environment)

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const UPSTREAM_REPO = 'https://github.com/msitarzewski/agency-agents'
const MANIFEST_VERSION = 1
const DEFAULT_UPSTREAM = 'G:\\dsh\\agency-agents'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assetsRoot = path.join(projectRoot, 'assets')
const cacheRoot = path.join(projectRoot, 'sync', '.cache')
const cacheCheckout = path.join(cacheRoot, 'agency-agents')
const manifestPath = path.join(projectRoot, 'sync', 'manifest.json')

/** Tiny stdout logger; keeps the summary at the end readable. */
function log(message) {
  process.stdout.write(`${message}\n`)
}

async function exists(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error !== undefined && result.error !== null) throw result.error
  if (result.status !== 0) {
    const detail = (result.stderr ?? '').trim()
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})${detail === '' ? '' : `: ${detail}`}`)
  }
  return (result.stdout ?? '').trim()
}

// ---------------------------------------------------------------------------
// Upstream resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the upstream checkout without touching the network when possible.
 * Priority: AGENCY_UPSTREAM -> sync/.cache/agency-agents -> default Windows path,
 * and only when none of them exists do we shallow-clone into sync/.cache.
 */
async function resolveUpstream() {
  const candidates = [
    ['env:AGENCY_UPSTREAM', process.env.AGENCY_UPSTREAM],
    ['cache', cacheCheckout],
    ['default', DEFAULT_UPSTREAM],
  ]
  for (const [source, candidate] of candidates) {
    if (typeof candidate !== 'string' || candidate.trim() === '') continue
    const resolved = path.resolve(candidate)
    if (await exists(path.join(resolved, 'divisions.json'))) {
      log(`upstream: ${source} -> ${resolved}`)
      return { dir: resolved, source, cloned: false }
    }
  }
  log(`upstream: none found, shallow-cloning ${UPSTREAM_REPO} into ${cacheCheckout}`)
  await mkdir(cacheRoot, { recursive: true })
  run('git', ['clone', '--depth', '1', UPSTREAM_REPO, cacheCheckout])
  return { dir: cacheCheckout, source: 'clone', cloned: true }
}

function readCommit(dir) {
  try {
    return run('git', ['-C', dir, 'rev-parse', 'HEAD'])
  } catch {
    return 'unknown'
  }
}

// ---------------------------------------------------------------------------
// Content model helpers
// ---------------------------------------------------------------------------

/** Read divisions.json: { divisions: { name: { label, icon, color } } }. */
async function readDivisions(dir) {
  const raw = JSON.parse(await readFile(path.join(dir, 'divisions.json'), 'utf8'))
  const source = raw.divisions ?? raw
  const divisions = {}
  for (const [name, value] of Object.entries(source)) {
    if (name.startsWith('_')) continue
    divisions[name] = {
      label: String(value?.label ?? name),
      icon: String(value?.icon ?? ''),
      color: String(value?.color ?? ''),
    }
  }
  return divisions
}

/** Recursively collect every *.md under dir (one flattened division level). */
async function collectMarkdown(dir) {
  const found = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await collectMarkdown(full)))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      found.push(full)
    }
  }
  return found
}

/**
 * Parse the leading --- frontmatter block. Used read-only here, to pick up the
 * sourceSha256 a translation stage recorded in assets/zh.
 */
function readFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (match === null) return null
  const fields = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (pair === null) continue
    let value = pair[2].trim()
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    fields[pair[1]] = value
  }
  return fields
}

async function readSourceSha(file) {
  try {
    const fields = readFrontmatter(await readFile(file, 'utf8'))
    const value = fields?.sourceSha256
    return typeof value === 'string' && value.length > 0 ? value : null
  } catch {
    return null
  }
}

/** Copy only when the bytes differ, so re-running is a no-op. */
async function copyIfChanged(source, destination) {
  const sourceBytes = await readFile(source)
  let same = false
  try {
    const destinationBytes = await readFile(destination)
    same = destinationBytes.length === sourceBytes.length && destinationBytes.equals(sourceBytes)
  } catch {
    same = false
  }
  if (same) return { sha256: sha256(sourceBytes), bytes: sourceBytes.length, written: false }
  await mkdir(path.dirname(destination), { recursive: true })
  await copyFile(source, destination)
  return { sha256: sha256(sourceBytes), bytes: sourceBytes.length, written: true }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const upstream = await resolveUpstream()
  const commit = readCommit(upstream.dir)
  const divisions = await readDivisions(upstream.dir)
  log(`upstream commit: ${commit}`)
  log(`divisions: ${Object.keys(divisions).length}`)

  // assets/en/<division>/<slug>.md, flattened, subdirectories stripped.
  const files = {}
  let written = 0
  let skipped = 0
  let zhMissing = 0
  let zhCurrent = 0
  let zhStale = 0
  const perDivision = {}

  for (const division of Object.keys(divisions)) {
    const sourceDir = path.join(upstream.dir, division)
    if (!(await exists(sourceDir))) {
      throw new Error(`division directory missing upstream: ${division}`)
    }
    const markdown = await collectMarkdown(sourceDir)
    const seen = new Map()
    let divisionWritten = 0

    for (const sourceFile of markdown) {
      const slug = path.basename(sourceFile, path.extname(sourceFile))
      if (seen.has(slug)) {
        // Flattening two subdirectories onto one level would silently lose an agent.
        throw new Error(`slug collision in ${division}: ${slug} <- ${seen.get(slug)} and ${sourceFile}`)
      }
      seen.set(slug, sourceFile)

      const key = `${division}/${slug}`
      const enPath = path.join(assetsRoot, 'en', division, `${slug}.md`)
      const result = await copyIfChanged(sourceFile, enPath)
      if (result.written) {
        written += 1
        divisionWritten += 1
      } else {
        skipped += 1
      }

      const zhPath = path.join(assetsRoot, 'zh', division, `${slug}.md`)
      let zhState = 'missing'
      let zhSourceSha = null
      if (await exists(zhPath)) {
        zhSourceSha = await readSourceSha(zhPath)
        zhState = zhSourceSha === result.sha256 ? 'current' : 'stale'
      }
      if (zhState === 'missing') zhMissing += 1
      else if (zhState === 'current') zhCurrent += 1
      else zhStale += 1

      files[key] = {
        enSha256: result.sha256,
        bytes: result.bytes,
        zhState,
        zhSourceSha256: zhSourceSha,
      }
    }
    perDivision[division] = { files: markdown.length, written: divisionWritten }
    log(`  ${division.padEnd(20)} ${String(markdown.length).padStart(3)} files (${divisionWritten} written)`)
  }

  // Licences: the English tree keeps upstream MIT verbatim; the Chinese tree is a
  // derivative work, so it carries the same notice.
  const upstreamLicense = path.join(upstream.dir, 'LICENSE')
  if (!(await exists(upstreamLicense))) throw new Error(`upstream LICENSE missing: ${upstreamLicense}`)
  const enLicense = await copyIfChanged(upstreamLicense, path.join(assetsRoot, 'en', 'LICENSE'))
  const zhLicense = await copyIfChanged(upstreamLicense, path.join(assetsRoot, 'zh', 'LICENSE'))
  log(`licenses: en ${enLicense.written ? 'written' : 'unchanged'}, zh ${zhLicense.written ? 'written' : 'unchanged'}`)

  const agents = Object.keys(files).length
  const manifest = {
    version: MANIFEST_VERSION,
    upstream: {
      repo: UPSTREAM_REPO,
      commit,
      fetchedAt: new Date().toISOString(),
      source: upstream.source,
      divisions,
    },
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    totals: {
      agents,
      divisions: Object.keys(divisions).length,
      zhMissing,
      zhCurrent,
      zhStale,
    },
  }

  await mkdir(path.dirname(manifestPath), { recursive: true })
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`
  const previous = (await exists(manifestPath)) ? await readFile(manifestPath, 'utf8') : null
  const manifestChanged = previous === null || !sameManifest(previous, serialized)
  await writeFile(manifestPath, serialized, 'utf8')

  log('')
  log(`agents:      ${agents}`)
  log(`divisions:   ${manifest.totals.divisions}`)
  log(`en written:  ${written} (unchanged ${skipped})`)
  log(`zh missing:  ${zhMissing}  current: ${zhCurrent}  stale: ${zhStale}`)
  log(`manifest:    ${manifestChanged ? 'updated' : 'unchanged'} -> ${path.relative(projectRoot, manifestPath)}`)

  const expected = 279
  if (agents !== expected) {
    log(`WARNING: expected ${expected} agents, found ${agents}`)
  }
}

/**
 * fetchedAt moves on every run, so compare everything except that timestamp when
 * deciding whether the manifest actually changed.
 */
function sameManifest(previous, next) {
  const strip = (text) => text.replace(/"fetchedAt": "[^"]*",\n/, '')
  return strip(previous) === strip(next)
}

const startedAt = Date.now()
try {
  await main()
  log(`done in ${Date.now() - startedAt}ms`)
} catch (error) {
  process.stderr.write(`sync failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
