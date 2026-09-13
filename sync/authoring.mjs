// P1 data pipeline - the authoring report: what a human still has to write after
// the upstream roster moves.
//
// `pnpm check` answers "is what is on disk consistent?". This answers the other
// question an upstream update raises: "what is now missing, and exactly which
// file do I create or delete?". The two are not the same, and the gap is
// dangerous: a new upstream expert is deliberately NOT a gate failure, because an
// expert without a Chinese profile degrades to its English persona and is
// counted, not failed. So an update that added three experts passes every check
// in silence, and `pnpm check` still exits 0.
//
// Buckets, in the order they have to be dealt with:
//   enOutOfSync      assets/en no longer matches upstream        -> pnpm sync
//   divisionDrift    upstream's division set moved               -> edit code
//   missingZh        upstream ships an expert with no Chinese    -> write one
//   staleZh          English moved on under a translation        -> retranslate
//   unstamped        a Chinese profile has no sourceSha256       -> pnpm sync:stamp
//   removedUpstream  upstream dropped an expert we still ship    -> delete files
//   missingAvatar    no assets/avatar/<slug>.svg                -> optional
//
// The first six are todo; avatars are reported separately and never counted,
// because emoji is the documented fallback and artwork arrives in batches
// (docs/AVATARS.md section 2).
//
// Also writes sync/authoring.json. Exits non-zero when there is anything to
// author, so a caller can tell "nothing to do" from "authoring needed" without
// parsing prose.
//
// Run with: pnpm authoring   (node is not on PATH in this environment)

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFrontmatter } from './corpus.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assetsRoot = path.join(projectRoot, 'assets')
const enRoot = path.join(assetsRoot, 'en')
const zhRoot = path.join(assetsRoot, 'zh')
const avatarRoot = path.join(assetsRoot, 'avatar')
const namesPath = path.join(projectRoot, 'src', 'names.ts')
const reportPath = path.join(projectRoot, 'sync', 'authoring.json')
const DEFAULT_UPSTREAM = 'G:\\dsh\\agency-agents'
const REPORT_VERSION = 1

/** Where an expert's files live, relative to the project root. */
const zhFile = (key) => `assets/zh/${key}.md`
const avatarFile = (slug) => `assets/avatar/${slug}.svg`

function log(message) {
  process.stdout.write(`${message}\n`)
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

/**
 * Read a file's frontmatter, or null when the file is absent or unreadable. The
 * parsing — one BOM rule, shared with sync.mjs, checks.mjs and stamp.mjs — lives
 * in sync/corpus.mjs; a profile that is present but malformed is `pnpm check`'s
 * problem, not this report's: here it only means "there is nothing to quote".
 */
async function frontmatterOf(file) {
  if (file === undefined) return null
  try {
    return readFrontmatter(await readFile(file, 'utf8')).fields
  } catch {
    return null
  }
}

/** key -> absolute path, for the already-flattened assets trees. */
async function indexTree(root) {
  const index = new Map()
  let divisions
  try {
    divisions = await readdir(root, { withFileTypes: true })
  } catch {
    return index
  }
  for (const division of divisions) {
    if (!division.isDirectory()) continue
    const dir = path.join(root, division.name)
    for (const file of await readdir(dir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith('.md')) continue
      index.set(`${division.name}/${file.name.slice(0, -3)}`, path.join(dir, file.name))
    }
  }
  return index
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

/**
 * Resolve the upstream checkout exactly as sync.mjs and checks.mjs do, so all
 * three always talk about the same tree.
 */
function resolveUpstreamDir() {
  const candidates = [process.env.AGENCY_UPSTREAM, path.join(projectRoot, 'sync', '.cache', 'agency-agents'), DEFAULT_UPSTREAM]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim() === '') continue
    const resolved = path.resolve(candidate)
    if (existsSync(path.join(resolved, 'divisions.json'))) return resolved
  }
  return null
}

function readCommit(dir) {
  const result = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  return result.status === 0 ? (result.stdout ?? '').trim() : null
}

/** Division directory names declared by the upstream divisions.json. */
function readUpstreamDivisions(dir) {
  try {
    const raw = JSON.parse(readFileSync(path.join(dir, 'divisions.json'), 'utf8'))
    const source = raw.divisions ?? raw
    return Object.keys(source).filter((name) => !name.startsWith('_'))
  } catch {
    return null
  }
}

/** key -> absolute upstream path, honouring subdirectory flattening. */
async function indexUpstream(dir, divisions) {
  const index = new Map()
  for (const division of divisions) {
    const divisionDir = path.join(dir, division)
    if (!existsSync(divisionDir)) continue
    for (const file of await walkMarkdown(divisionDir)) {
      const key = `${division}/${path.basename(file, '.md')}`
      if (!index.has(key)) index.set(key, file)
    }
  }
  return index
}

/**
 * Read the division list out of src/names.ts.
 *
 * verify.mjs imports the built lib/names.js for this, which is the better source
 * but requires a build; this report has to run straight after a fetch. So parse
 * the one hand-written literal and report a parse failure instead of guessing --
 * a silently empty list would call all 18 divisions new.
 *
 * @returns {Promise<string[] | null>} division names, or null when unparseable.
 */
async function readKnownDivisions() {
  let text
  try {
    text = await readFile(namesPath, 'utf8')
  } catch {
    return null
  }
  const block = /export const ZH_DIVISION[^=]*=\s*\{([\s\S]*?)\n\}/.exec(text)
  if (block === null) return null
  const keys = []
  for (const line of block[1].split(/\r?\n/)) {
    const match = /^\s*'?([A-Za-z0-9][A-Za-z0-9-]*)'?\s*:/.exec(line)
    if (match !== null) keys.push(match[1])
  }
  return keys.length > 0 ? keys : null
}

/** Slugs that already have artwork, from the flat assets/avatar directory. */
async function listAvatarSlugs() {
  const slugs = new Set()
  let entries
  try {
    entries = await readdir(avatarRoot, { withFileTypes: true })
  } catch {
    return slugs
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.svg')) slugs.add(entry.name.slice(0, -4))
  }
  return slugs
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Sort every key into at most one bucket, and separately record the two
 * conditions that make the buckets meaningless if they hold: the English tree
 * drifting from upstream, and a key upstream no longer ships.
 *
 * @returns the bucket contents plus the roster size.
 */
async function classify({ enIndex, zhIndex, upstreamIndex, knownDivisions, avatarSlugs }) {
  const buckets = { enOutOfSync: [], divisionDrift: [], missingZh: [], staleZh: [], unstamped: [], removedUpstream: [] }
  const missingAvatar = []
  const digests = new Map()
  const shaOf = async (file) => {
    if (!digests.has(file)) digests.set(file, sha256(await readFile(file)))
    return digests.get(file)
  }

  const allKeys = [...new Set([...enIndex.keys(), ...zhIndex.keys(), ...(upstreamIndex?.keys() ?? [])])].sort()
  for (const key of allKeys) {
    const slash = key.lastIndexOf('/')
    const division = key.slice(0, slash)
    const slug = key.slice(slash + 1)
    const enPath = enIndex.get(key)
    const zhPath = zhIndex.get(key)
    const upstreamPath = upstreamIndex?.get(key)
    const enFields = await frontmatterOf(enPath)
    const zhFields = await frontmatterOf(zhPath)

    if (upstreamIndex !== null && upstreamPath === undefined) {
      // Upstream dropped an expert, so both local trees and the manifest still
      // carry it. english-byte-identity already fails this loudly; the point of
      // listing it here is to name the exact files to delete.
      buckets.removedUpstream.push({
        key,
        division,
        slug,
        name: zhFields?.name ?? enFields?.name ?? '',
        delete: [...(enPath === undefined ? [] : [`assets/en/${key}.md`]), ...(zhPath === undefined ? [] : [zhFile(key)])],
      })
    } else if (zhPath === undefined) {
      if (enPath !== undefined) {
        buckets.missingZh.push({
          key,
          division,
          slug,
          name: enFields?.name ?? '',
          emoji: enFields?.emoji ?? '',
          description: enFields?.description ?? '',
          write: zhFile(key),
          avatar: avatarFile(slug),
        })
      }
    } else {
      const stamp = zhFields?.sourceSha256
      const stamped = typeof stamp === 'string' && stamp.length > 0 ? stamp : null
      const current = enPath === undefined ? null : await shaOf(enPath)
      if (stamped === null) {
        buckets.unstamped.push({ key, division, slug, name: zhFields?.name ?? '', run: 'pnpm sync:stamp' })
      } else if (current !== null && stamped !== current) {
        buckets.staleZh.push({
          key,
          division,
          slug,
          name: zhFields?.name ?? '',
          nameEn: enFields?.name ?? '',
          retranslate: zhFile(key),
        })
      }
    }

    // Independent of the buckets above: the English tree has to equal upstream
    // before any of this means anything, and `pnpm sync` is the fix.
    if (enPath !== undefined && upstreamPath !== undefined && (await shaOf(enPath)) !== (await shaOf(upstreamPath))) {
      buckets.enOutOfSync.push({ key, division, slug, run: 'pnpm sync' })
    }

    if ((enPath !== undefined || zhPath !== undefined) && !avatarSlugs.has(slug)) {
      missingAvatar.push({ key, division, slug, name: zhFields?.name ?? enFields?.name ?? '', add: avatarFile(slug) })
    }
  }

  const upstreamDivisions = upstreamIndex === null ? null : [...new Set([...upstreamIndex.keys()].map((key) => key.slice(0, key.lastIndexOf('/'))))]
  if (upstreamDivisions !== null && knownDivisions !== null) {
    for (const name of upstreamDivisions.filter((division) => !knownDivisions.includes(division)).sort()) {
      buckets.divisionDrift.push({ division: name, change: 'added' })
    }
    for (const name of knownDivisions.filter((division) => !upstreamDivisions.includes(division)).sort()) {
      buckets.divisionDrift.push({ division: name, change: 'removed' })
    }
  }

  return { buckets, missingAvatar, roster: allKeys.filter((key) => enIndex.has(key) || zhIndex.has(key)).length, allKeys }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const upstreamDir = resolveUpstreamDir()
  const upstreamCommit = upstreamDir === null ? null : readCommit(upstreamDir)
  const upstreamDivisionNames = upstreamDir === null ? null : readUpstreamDivisions(upstreamDir)
  const upstreamIndex =
    upstreamDir === null || upstreamDivisionNames === null ? null : await indexUpstream(upstreamDir, upstreamDivisionNames)

  const enIndex = await indexTree(enRoot)
  const zhIndex = await indexTree(zhRoot)
  const avatarSlugs = await listAvatarSlugs()
  const knownDivisions = await readKnownDivisions()

  const { buckets, missingAvatar, roster } = await classify({ enIndex, zhIndex, upstreamIndex, knownDivisions, avatarSlugs })

  const sections = [
    {
      id: 'enOutOfSync',
      title: '英文资产与上游不一致',
      hint: '先跑 pnpm sync，这份报告才有意义',
      items: buckets.enOutOfSync,
    },
    {
      id: 'divisionDrift',
      title: '分区集合变了',
      hint: '分区同时登记在三处：src/names.ts（ZH_DIVISION / EN_DIVISION 各一条）、sync/glossary.json（division:<名字>）、scripts/verify.mjs（DIVISIONS.length === 18）。漏掉 src/names.ts 不会编译失败——界面用 ZH_DIVISION[x] ?? x，会静默退回目录名——所以这条提示必须点名。',
      items: buckets.divisionDrift,
    },
    {
      id: 'missingZh',
      title: '中文档案缺失',
      hint: '每位写一个 assets/zh/<分区>/<slug>.md，至少含 name / description / emoji / intro',
      items: buckets.missingZh,
    },
    {
      id: 'staleZh',
      title: '英文已更新，中文档案基于旧版',
      hint: '更新译文后必须再跑 pnpm sync:stamp 重新盖戳；只有带译文正文的档案会让 translation-freshness 硬失败，intro-only 的只是 WARN',
      items: buckets.staleZh,
    },
    {
      id: 'unstamped',
      title: '中文档案没盖 sourceSha256',
      hint: '纯机械：跑一次 pnpm sync:stamp',
      items: buckets.unstamped,
    },
    {
      id: 'removedUpstream',
      title: '上游已删除，本地还在',
      hint: '删掉列出的文件，再跑 pnpm sync 让 manifest 丢掉记录',
      items: buckets.removedUpstream,
    },
  ]

  const todo = sections.reduce((sum, section) => sum + section.items.length, 0)
  const totals = Object.fromEntries([...sections.map((section) => [section.id, section.items.length]), ['missingAvatar', missingAvatar.length], ['todo', todo]])

  const report = {
    version: REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    upstream: {
      available: upstreamIndex !== null,
      dir: upstreamDir,
      commit: upstreamCommit,
      divisions: upstreamDivisionNames === null ? null : upstreamDivisionNames.length,
      experts: upstreamIndex === null ? null : upstreamIndex.size,
    },
    local: { experts: roster, divisions: new Set([...enIndex.keys(), ...zhIndex.keys()].map((key) => key.slice(0, key.lastIndexOf('/')))).size },
    knownDivisions,
    totals,
    sections,
    optional: { id: 'missingAvatar', title: '还没有头像（可选，emoji 兜底）', hint: '不放也行：没有素材时卡片显示 emoji，不会空白', items: missingAvatar },
  }

  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  // -- stdout summary -------------------------------------------------------
  log('agency-agents-ll - 上游更新待办 (docs/UPDATE.md)')
  if (upstreamDir === null) {
    log('上游:   未找到 checkout —— 只能做本地一致性检查')
    log('        「英文落后于上游」「上游已删除」「分区集合」三类判定已跳过')
  } else {
    log(`上游:   ${upstreamDir}`)
    log(`        ${upstreamCommit === null ? '未知提交' : upstreamCommit.slice(0, 12)}  ${upstreamIndex === null ? '' : `${upstreamIndex.size} 位专家`}`)
  }
  log(`名册:   本地 ${roster} 位专家 / 分区 ${knownDivisions === null ? '无法解析 src/names.ts' : `${knownDivisions.length} 个`}`)
  log('')

  for (const section of sections) {
    if (section.items.length === 0) continue
    log(`${section.title} (${section.items.length})`)
    log(`  -> ${section.hint}`)
    for (const item of section.items) for (const line of describe(item)) log(`  ${line}`)
    log('')
  }

  if (todo === 0) log('待办: 无 —— 上游的内容已全部落地，且每位专家都有中文档案。')
  else log(`待办: ${todo} 项（这些需要人写，不是脚本报错）`)
  if (missingAvatar.length > 0) log(`可选: ${missingAvatar.length} 位专家还没有头像，emoji 兜底，不影响任何门禁。`)
  log(`报告: ${path.relative(projectRoot, reportPath).split(path.sep).join('/')}`)

  process.exitCode = todo > 0 ? 1 : 0
}

/**
 * One item as report lines, indented by the caller: the first line identifies the
 * expert, the rest name the exact file to create or delete.
 */
function describe(item) {
  if (item.change !== undefined) {
    return [
      item.change === 'added'
        ? `+ 新分区 ${item.division}：需在 src/names.ts、sync/glossary.json、scripts/verify.mjs 三处登记（漏掉 src/names.ts 不会报错，界面会静默显示目录名）`
        : `- 分区 ${item.division} 上游已无，但仍是本地 18 个之一，需从这三处移除`,
    ]
  }
  if (item.delete !== undefined) return [`${item.key}   删除 ${item.delete.join(' 与 ')}`]
  if (item.write !== undefined) {
    const label = item.name === '' ? item.key : `${item.name}${item.emoji === '' ? '' : `  ${item.emoji}`}`
    const lines = [`${item.key}   ${label}`]
    if (item.description !== '') lines.push(`    ${item.description}`)
    lines.push(`    写 ${item.write}`)
    return lines
  }
  if (item.retranslate !== undefined) return [`${item.key}   更新 ${item.retranslate}`]
  if (item.run !== undefined) return [`${item.key}   ${item.run}`]
  if (item.add !== undefined) return [`${item.key}   补 ${item.add}`]
  return [String(item.key ?? JSON.stringify(item))]
}

const startedAt = Date.now()
try {
  await main()
  log('')
  log(`done in ${Date.now() - startedAt}ms`)
} catch (error) {
  process.stderr.write(`authoring failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
