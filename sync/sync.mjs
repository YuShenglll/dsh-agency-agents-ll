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
//   - Offline by default. A plain run never touches the network: it compares the
//     checkout against the remote-tracking ref it already has and warns when that
//     ref has moved on. `--pull` is the explicit opt-in to `git fetch` +
//     fast-forward, so the same command still produces the same bytes on a
//     machine with no network.
//
// Run with: pnpm sync            (sync what the local checkout already has)
//           pnpm sync -- --pull  (fetch + fast-forward first)
//           pnpm sync:upstream   (that, plus the authoring report and the gates)
//           node is not on PATH in this environment.

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

/** Run without throwing, so a probe can treat "git said no" as an answer. */
function probe(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error !== undefined && result.error !== null) {
    return { ok: false, status: null, stdout: '', stderr: String(result.error.message ?? result.error) }
  }
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  }
}

function run(command, args) {
  const result = probe(command, args)
  if (!result.ok) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})${result.stderr === '' ? '' : `: ${result.stderr}`}`)
  }
  return result.stdout
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

/**
 * How far the checkout sits behind its own remote-tracking ref.
 *
 * `HEAD..@{u}` reads no network — it compares against the ref as it was last
 * fetched, which is exactly the signal a sync needs before it copies anything.
 * A checkout with no upstream branch (`@{u}` unresolvable) returns null.
 */
function commitsBehind(dir) {
  const branch = probe('git', ['-C', dir, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (!branch.ok || branch.stdout === '') return null
  const count = probe('git', ['-C', dir, 'rev-list', '--count', 'HEAD..@{u}'])
  if (!count.ok) return null
  const behind = Number.parseInt(count.stdout, 10)
  return Number.isNaN(behind) ? null : { ref: branch.stdout, behind }
}

/**
 * Decide whether the checkout is current, and optionally make it so.
 *
 * The point of this function is that a stale checkout used to sync silently: the
 * script copied whatever it found and reported success. Now a stale checkout is
 * either refreshed (`--pull`) or announced.
 */
async function refreshUpstream(upstream, options) {
  const { dir } = upstream
  if (!probe('git', ['-C', dir, 'rev-parse', '--git-dir']).ok) {
    log(`upstream: ${upstream.source} is not a git checkout, so its freshness cannot be checked`)
    return { before: null, after: null, pulled: false }
  }

  const before = readCommit(dir)

  if (!options.pull) {
    const behind = commitsBehind(dir)
    if (behind !== null && behind.behind > 0) {
      log('')
      log(`WARNING: this checkout is ${behind.behind} commit(s) behind ${behind.ref}, as last fetched.`)
      log('         Syncing now copies the OLD content and still reports success.')
      log('         Run `pnpm sync:upstream` to fetch and fast-forward first.')
      log('')
    }
    return { before, after: before, pulled: false }
  }

  // Fetch first, then measure: counting before the fetch would report the stale
  // ref's lag and understate how far behind the checkout really is.
  log('upstream: fetching origin')
  run('git', ['-C', dir, 'fetch', '--quiet', 'origin'])
  const behind = commitsBehind(dir)
  if (behind === null) {
    throw new Error(
      `${dir} has no upstream branch to pull from; set one, or point AGENCY_UPSTREAM at a fresh clone`,
    )
  }
  if (behind.behind === 0) {
    log(`upstream: already current with ${behind.ref} (${before.slice(0, 12)})`)
    return { before, after: before, pulled: false }
  }
  log(`upstream: ${behind.behind} new commit(s) on ${behind.ref}; fast-forwarding`)
  run('git', ['-C', dir, 'merge', '--ff-only', '@{u}'])
  const after = readCommit(dir)
  log(`upstream: ${before.slice(0, 12)} -> ${after.slice(0, 12)}`)
  return { before, after, pulled: true }
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
  const refresh = await refreshUpstream(upstream, options)
  const commit = readCommit(upstream.dir)
  const divisions = await readDivisions(upstream.dir)
  log(`upstream commit: ${commit}`)
  log(`divisions: ${Object.keys(divisions).length}`)

  // Read the previous manifest before overwriting it: the delta between the two
  // is the only trustworthy way to say "the roster moved", and it names the keys
  // rather than comparing against a constant that would need editing every time
  // upstream adds an expert.
  const previousText = (await exists(manifestPath)) ? await readFile(manifestPath, 'utf8') : null
  let previousFiles = {}
  try {
    previousFiles = JSON.parse(previousText ?? '{}').files ?? {}
  } catch {
    previousFiles = {}
  }

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
  const previous = previousText
  const candidate = `${JSON.stringify(manifest, null, 2)}\n`
  // A no-op sync must leave the committed manifest byte-identical. Keep the
  // previous timestamp whenever the timestamp is the only thing that would move,
  // and do not rewrite the file at all in that case.
  const manifestChanged = previous === null || !sameManifest(previous, candidate)
  if (manifestChanged) {
    await writeFile(manifestPath, candidate, 'utf8')
  } else {
    const previousStamp = /"fetchedAt": "([^"]*)"/.exec(previous)?.[1]
    if (previousStamp !== undefined) manifest.upstream.fetchedAt = previousStamp
  }

  log('')
  log(`agents:      ${agents}`)
  log(`divisions:   ${manifest.totals.divisions}`)
  log(`en written:  ${written} (unchanged ${skipped})`)
  log(`zh missing:  ${zhMissing}  current: ${zhCurrent}  stale: ${zhStale}`)
  log(`manifest:    ${manifestChanged ? 'updated' : 'unchanged'} -> ${path.relative(projectRoot, manifestPath)}`)

  // -- roster delta ---------------------------------------------------------
  const previousKeys = new Set(Object.keys(previousFiles))
  const currentKeys = Object.keys(files)
  const added = currentKeys.filter((key) => !previousKeys.has(key)).sort()
  const dropped = [...previousKeys].filter((key) => !(key in files)).sort()
  log('')
  if (previousText === null) {
    log(`roster:      ${agents} (no previous manifest, so there is nothing to compare against)`)
  } else if (added.length === 0 && dropped.length === 0) {
    log(`roster:      ${agents} (unchanged)`)
  } else {
    log(`roster:      ${previousKeys.size} -> ${agents}`)
    if (added.length > 0) {
      log(`  upstream added (${added.length}):`)
      for (const key of added) log(`    + ${key}`)
    }
    if (dropped.length > 0) {
      log(`  gone from upstream (${dropped.length}):`)
      for (const key of dropped) log(`    - ${key}`)
      log('    assets/en and assets/zh still hold these; `pnpm authoring` names the deletions.')
    }
  }

  if (added.length > 0) {
    log('')
    log('next: `pnpm authoring` lists the Chinese profile and avatar each new expert still needs.')
  }
}

/**
 * fetchedAt moves on every run, so compare everything except that timestamp when
 * deciding whether the manifest actually changed.
 *
 * Normalise CRLF first. `git checkout` rewrites a modified file with CRLF when
 * core.autocrlf is true (the Git for Windows default), and then the trailing
 * `\n` in the pattern below no longer matches. That made a content-identical
 * manifest look changed and get rewritten on the first sync after any checkout —
 * the exact "running twice changes nothing on disk" invariant this file opens
 * with, broken by the checkout rather than by the sync.
 */
function sameManifest(previous, next) {
  const strip = (text) => text.replace(/\r\n/g, '\n').replace(/"fetchedAt": "[^"]*",\n/, '')
  return strip(previous) === strip(next)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const unknownFlags = argv.filter((flag) => flag !== '--pull')
if (unknownFlags.length > 0) {
  process.stderr.write(`sync: unknown argument(s): ${unknownFlags.join(', ')}  (usage: sync.mjs [--pull])\n`)
  process.exit(1)
}
const options = { pull: argv.includes('--pull') }

const startedAt = Date.now()
try {
  await main()
  log(`done in ${Date.now() - startedAt}ms`)
} catch (error) {
  process.stderr.write(`sync failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
