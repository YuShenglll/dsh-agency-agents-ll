/**
 * Check a delivered avatar set against the roster and the brief.
 *
 * The brief hands out one filename per expert, so a delivery is only usable
 * when it names exactly the current slugs. This reports what is missing, what
 * is extra, and which files break the format rules in `docs/AVATARS.md`, so a
 * partial batch can be assessed without opening the files.
 *
 * How a file is found and read — extension case, quote style, forbidden elements
 * — comes from `avatar-svg.mjs`, shared with the generator that inlines the set:
 * the two used to disagree, and a file this gate blessed could be silently
 * skipped by `pnpm avatars:inline`.
 *
 * Usage: pnpm avatars:check <directory>
 */
import { readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { inspectSvg, isSvg, slugOf, walkFiles } from './avatar-svg.mjs'
import { roster } from './avatar-manifest.mjs'

const HARD_LIMIT = 5 * 1024
const SOFT_LIMIT = 2 * 1024
const TOTAL_LIMIT = 600 * 1024

const target = process.argv[2]
if (target === undefined) {
  console.error('用法：pnpm avatars:check <目录>')
  process.exit(2)
}
const dir = resolve(target)
if (!statSync(dir).isDirectory()) {
  console.error(`不是目录：${dir}`)
  process.exit(2)
}

const expected = roster().map((row) => row.slug)
const expectedSet = new Set(expected)

const svgFiles = walkFiles(dir).filter((path) => isSvg(basename(path)))
const bySlug = new Map()
for (const path of svgFiles) {
  const slug = slugOf(basename(path))
  if (!bySlug.has(slug)) bySlug.set(slug, path)
}

const missing = expected.filter((slug) => !bySlug.has(slug))
const extra = [...bySlug.keys()].filter((slug) => !expectedSet.has(slug)).sort()

const tooBig = []
const tooSmall = []
const overSoft = []
const notSquare = []
const forbidden = []
const withIds = []
let total = 0
let largest = { slug: '', bytes: 0 }

for (const [slug, path] of bySlug) {
  const bytes = statSync(path).size
  total += bytes
  if (bytes > largest.bytes) largest = { slug, bytes }
  if (bytes > HARD_LIMIT) tooBig.push(`${slug} ${bytes} B`)
  else if (bytes > SOFT_LIMIT) overSoft.push(`${slug} ${bytes} B`)
  if (bytes < 120) tooSmall.push(`${slug} ${bytes} B`)

  const source = readFileSync(path, 'utf8')
  const { viewBox, forbidden: hits, hasId } = inspectSvg(source)
  if (viewBox === undefined) {
    notSquare.push(`${slug} 无 viewBox`)
  } else {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number)
    if (parts.length !== 4 || parts.some(Number.isNaN)) notSquare.push(`${slug} viewBox 无法解析：${viewBox}`)
    else if (parts[2] !== parts[3]) notSquare.push(`${slug} 非正方形：${viewBox}`)
  }
  for (const [needle, why] of hits) forbidden.push(`${slug} 含 ${needle}（${why}）`)
  if (hasId) withIds.push(slug)
}

const CAP = 12
const list = (title, items) => {
  if (items.length === 0) return
  console.log(`\n${title}（${items.length}）：`)
  for (const item of items.slice(0, CAP)) console.log(`  ${item}`)
  if (items.length > CAP) console.log(`  …另有 ${items.length - CAP} 条`)
}

console.log(`交付目录：${dir}`)
console.log(`SVG 文件 ${svgFiles.length}    名册 ${expected.length}    覆盖 ${expected.length - missing.length} / ${expected.length}`)
console.log(`体积：合计 ${(total / 1024).toFixed(0)} KB，最大 ${largest.bytes} B（${largest.slug || '—'}）`)
if (svgFiles.length > 0) console.log(`平均 ${Math.round(total / svgFiles.length)} B`)

list('缺少（名册里有、交付里没有）', missing)
list('多余（交付里有、名册里没有）', extra)
list(`超硬上限 ${HARD_LIMIT} B`, tooBig)
list('疑似损坏（小于 120 B）', tooSmall)
list('viewBox 不是正方形或缺失', notSquare)
list('含不允许的元素', forbidden)
list('含 id 属性（全部内联进同一个模块，同名 id 会互相覆盖）', withIds)

if (overSoft.length > 0) console.log(`\n超过软目标 ${SOFT_LIMIT} B 但未超硬上限：${overSoft.length} 个（可接受）`)
if (total > TOTAL_LIMIT) console.log(`\n警告：合计 ${(total / 1024).toFixed(0)} KB，超过总体积目标 ${TOTAL_LIMIT / 1024} KB`)

// `withIds` is blocking: the brief forbids `id` outright, docs/AVATARS.md claims
// zero of them, and all 279 files end up inlined into one client module where a
// duplicated id is a real collision. Leaving it out of this sum let a violating
// delivery pass with a printed warning nobody had to act on.
const blocking = missing.length + extra.length + tooBig.length + tooSmall.length + notSquare.length + forbidden.length + withIds.length
console.log(blocking === 0 ? '\n格式校验通过' : `\n${blocking} 项需要处理`)
process.exit(blocking === 0 ? 0 : 1)
