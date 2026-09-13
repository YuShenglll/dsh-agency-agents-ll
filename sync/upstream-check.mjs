// Answer one question, cheaply: has the upstream roster moved since the last
// sync?
//
// `pnpm sync:upstream` both checks and updates, which means asking it "is there
// anything new?" also pulls, copies and rewrites the manifest. This only checks,
// so it is safe to run on a schedule, from CI, or from a bored Tuesday -- it
// writes nothing outside sync/.cache and never touches assets/ or the manifest.
//
// Two stages, because the overwhelmingly common answer is "nothing changed":
//
//   1. `git ls-remote <repo> HEAD` -- one request and no disk. If it equals the
//      commit recorded in sync/manifest.json there is nothing to do, and the
//      check stops here.
//   2. Only when the tip moved, shallow-clone (or refresh) the throwaway
//      sync/.cache/upstream-probe and diff its roster against the manifest:
//      added, changed and removed experts, plus division drift.
//
// It answers "did the roster move", not "is my tree healthy" -- that is
// `pnpm check`. And it says nothing about the Chinese side: a new upstream expert
// has no Chinese profile yet, which `pnpm authoring` names after you sync.
//
// Exit codes: 0 up to date, 1 the roster moved, 2 could not check (so a scheduled
// runner can tell "no news" from "the check itself broke").
//
// Run with: pnpm upstream:check        add --json for machine-readable output.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(projectRoot, 'sync', 'manifest.json')

const EXIT = { upToDate: 0, moved: 1, failed: 2 }

function log(message) {
  process.stdout.write(`${message}\n`)
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

/**
 * The probe cache is keyed by the repository it came from.
 *
 * A single fixed directory would be answered by whichever upstream was cloned
 * into it first -- silently, and with a perfectly plausible roster. Keying the
 * path costs one directory per distinct upstream (in practice, one) and removes
 * the need to detect and delete a stale cache at all.
 */
const probeDirFor = (repo) => path.join(projectRoot, 'sync', '.cache', `upstream-probe-${sha256(repo).slice(0, 8)}`)

/**
 * Delete a checkout. git's object files are read-only, and on Windows that makes
 * a plain recursive remove fail with EPERM, so clear the attribute first.
 */
function removeTree(dir) {
  if (!existsSync(dir)) return
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries = []
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else {
        try {
          chmodSync(full, 0o666)
        } catch {
          // Best effort: if this fails the remove below reports it.
        }
      }
    }
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })
}

function probe(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error !== undefined && result.error !== null) {
    return { ok: false, stdout: '', stderr: String(result.error.message ?? result.error) }
  }
  return { ok: result.status === 0, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() }
}

function run(command, args) {
  const result = probe(command, args)
  if (!result.ok) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

/** The commit and roster the last `pnpm sync` recorded. */
function readBaseline() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const files = manifest.files ?? {}
  return {
    repo: manifest.upstream?.repo,
    commit: manifest.upstream?.commit,
    divisions: Object.keys(manifest.upstream?.divisions ?? {}),
    files,
    keys: new Set(Object.keys(files)),
  }
}

/**
 * The tip of the upstream default branch. Asking for `HEAD` rather than
 * `refs/heads/main` means a rename upstream does not silently break this.
 */
function remoteHead(repo) {
  const out = run('git', ['ls-remote', repo, 'HEAD'])
  const line = out.split('\n').find((entry) => entry.trim() !== '')
  if (line === undefined) throw new Error(`git ls-remote returned no HEAD for ${repo}`)
  return line.split(/\s+/)[0]
}

/**
 * A throwaway shallow checkout of the upstream tip, refreshed in place.
 *
 * This is deliberately not the checkout `pnpm sync` reads: the check must not
 * move the tree that a concurrent sync might be copying from, and it must not
 * depend on one existing at all.
 */
function refreshProbe(repo) {
  const probeDir = probeDirFor(repo)
  try {
    if (!existsSync(path.join(probeDir, '.git'))) {
      removeTree(probeDir)
      run('git', ['clone', '--depth', '1', '--quiet', repo, probeDir])
    } else {
      run('git', ['-C', probeDir, 'fetch', '--quiet', '--depth', '1', 'origin', 'HEAD'])
      run('git', ['-C', probeDir, 'reset', '--quiet', '--hard', 'FETCH_HEAD'])
    }
  } catch (error) {
    // A half-cloned probe is not worth diagnosing: throw it away and take a
    // fresh one, so the failure cannot become permanent.
    removeTree(probeDir)
    run('git', ['clone', '--depth', '1', '--quiet', repo, probeDir])
    if (process.env.DSH_DEBUG === '1') log(`probe rebuilt after: ${String(error)}`)
  }
  return { dir: probeDir, commit: run('git', ['-C', probeDir, 'rev-parse', 'HEAD']) }
}

function readProbeDivisions(probeDir) {
  const raw = JSON.parse(readFileSync(path.join(probeDir, 'divisions.json'), 'utf8'))
  const source = raw.divisions ?? raw
  return Object.keys(source).filter((name) => !name.startsWith('_'))
}

/** Recursively collect *.md, mirroring sync.mjs's flattening of subdirectories. */
async function walkMarkdown(dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await walkMarkdown(full)))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) found.push(full)
  }
  return found
}

/** key -> absolute path, for the probe's roster. */
async function indexProbe(probeDir, divisions) {
  const index = new Map()
  for (const division of divisions) {
    const divisionDir = path.join(probeDir, division)
    if (!existsSync(divisionDir)) continue
    for (const file of await walkMarkdown(divisionDir)) {
      const key = `${division}/${path.basename(file, '.md')}`
      if (!index.has(key)) index.set(key, file)
    }
  }
  return index
}

/**
 * The same finding as a GitHub issue body, for the scheduled watcher. Only ever
 * called when the roster moved: a tip that advanced without the roster changing
 * is not worth an issue.
 */
function markdown(report, baseline) {
  const out = ['**上游名册有更新。**', '']
  out.push('| | |', '|---|---|')
  out.push(`| 上游仓库 | \`${report.repo}\` |`)
  out.push(`| 上次同步的基线 | \`${baseline.commit.slice(0, 12)}\` |`)
  out.push(`| 远端默认分支 | \`${report.remoteCommit.slice(0, 12)}\` |`)
  out.push('')
  const section = (title, note, keys, bullet) => {
    if (keys.length === 0) return
    out.push(`### ${title}（${keys.length}）${note === '' ? '' : `\n${note}`}`, '')
    for (const key of keys) out.push(`- ${bullet}\`${key}\``)
    out.push('')
  }
  section('新增专家', '签下来就能用英文人设；中文名、中文简介和头像要另写。', report.added, '')
  section('英文有改动', '原有中文档案会因此变成「过期」。', report.changed, '')
  section('上游已删除', '本地两棵树还在，要一起删掉。', report.removed, '')
  if (report.divisionsAdded.length > 0 || report.divisionsRemoved.length > 0) {
    out.push('### 分区变化', '')
    if (report.divisionsAdded.length > 0) {
      out.push(`新增：${report.divisionsAdded.map((name) => `\`${name}\``).join('、')}`)
      out.push('')
      out.push('分区同时登记在三处，要一起改：`src/names.ts`、`sync/glossary.json`、`scripts/verify.mjs`。')
    }
    if (report.divisionsRemoved.length > 0) out.push(`移除：${report.divisionsRemoved.map((name) => `\`${name}\``).join('、')}`)
    out.push('')
  }
  out.push('---', '')
  out.push('下一步：`pnpm sync:upstream` → 按 `pnpm authoring` 的清单补中文档案与头像 → `pnpm build && pnpm test && pnpm verify && pnpm check`。')
  out.push('')
  out.push('<sub>由 <code>pnpm upstream:check</code> 生成。同步跟上之后，这个 issue 会自动关闭。</sub>')
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const json = process.argv.includes('--json')
  const asMarkdown = process.argv.includes('--markdown')
  const baseline = readBaseline()
  if (typeof baseline.repo !== 'string' || typeof baseline.commit !== 'string') {
    throw new Error('sync/manifest.json has no upstream repo/commit to compare against')
  }

  const head = remoteHead(baseline.repo)
  const report = {
    repo: baseline.repo,
    baselineCommit: baseline.commit,
    remoteCommit: head,
    tipMoved: head !== baseline.commit,
    rosterMoved: false,
    added: [],
    changed: [],
    removed: [],
    divisionsAdded: [],
    divisionsRemoved: [],
  }

  if (report.tipMoved) {
    const probe = refreshProbe(baseline.repo)
    report.probeCommit = probe.commit
    const divisions = readProbeDivisions(probe.dir)
    const index = await indexProbe(probe.dir, divisions)

    for (const [key, file] of index) {
      if (!baseline.keys.has(key)) report.added.push(key)
      else if (sha256(await readFile(file)) !== baseline.files[key].enSha256) report.changed.push(key)
    }
    for (const key of baseline.keys) if (!index.has(key)) report.removed.push(key)

    report.divisionsAdded = divisions.filter((name) => !baseline.divisions.includes(name)).sort()
    report.divisionsRemoved = baseline.divisions.filter((name) => !divisions.includes(name)).sort()

    for (const list of [report.added, report.changed, report.removed]) list.sort()
    report.rosterMoved =
      report.added.length + report.changed.length + report.removed.length + report.divisionsAdded.length + report.divisionsRemoved.length > 0
  }

  if (json) {
    log(JSON.stringify(report, null, 2))
  } else if (asMarkdown) {
    log(markdown(report, baseline))
  } else {
    log('agency-agents-ll - 上游有没有更新')
    log('')
    log(`上游:   ${report.repo}`)
    log(`基线:   ${baseline.commit.slice(0, 12)}  (sync/manifest.json，上次同步的记录)`)
    log(`远端:   ${report.remoteCommit.slice(0, 12)}${report.tipMoved ? '  <- 动过了' : '  没动'}`)
    log('')

    if (!report.tipMoved) {
      log(`上游无更新：远端默认分支仍是 ${baseline.commit.slice(0, 12)}，名册 ${baseline.keys.size} 位与基线一致。`)
    } else if (!report.rosterMoved) {
      log('上游有新提交，但**名册没变**：没有新增/改动/删除任何专家，分区也没变。')
      log('内容多半是文档、脚本或集成配置。可以不管，也可以跑 pnpm sync:upstream 跟上。')
    } else {
      log('上游名册有更新：')
      if (report.added.length > 0) {
        log(`  新增专家 (${report.added.length})：签下来就能用英文人设，中文档案要另写`)
        for (const key of report.added) log(`    + ${key}`)
      }
      if (report.changed.length > 0) {
        log(`  英文有改动 (${report.changed.length})：原有中文档案会因此变成「过期」`)
        for (const key of report.changed) log(`    ~ ${key}`)
      }
      if (report.removed.length > 0) {
        log(`  上游已删除 (${report.removed.length})：`)
        for (const key of report.removed) log(`    - ${key}`)
      }
      if (report.divisionsAdded.length > 0) log(`  新增分区 (${report.divisionsAdded.length})：${report.divisionsAdded.join(', ')}（要改三处代码）`)
      if (report.divisionsRemoved.length > 0) log(`  分区被移除 (${report.divisionsRemoved.length})：${report.divisionsRemoved.join(', ')}`)
      log('')
      log('下一步：pnpm sync:upstream —— 拉下来、列出还缺哪些中文档案，再跑门禁。')
    }
  }

  process.exitCode = report.rosterMoved ? EXIT.moved : EXIT.upToDate
}

try {
  await main()
} catch (error) {
  process.stderr.write(`upstream:check 无法完成：${error instanceof Error ? error.message : String(error)}\n`)
  process.stderr.write('（这不代表上游没有更新，只代表这次没查成 —— 检查网络与 git 是否可用）\n')
  process.exitCode = EXIT.failed
}
