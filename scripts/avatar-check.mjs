/**
 * Check a delivered avatar set against the roster and the brief.
 *
 * The brief hands out one filename per expert, so a delivery is only usable
 * when it names exactly the current slugs. This reports what is missing, what
 * is extra, and which files break the format rules in `docs/AVATARS.md`, so a
 * partial batch can be assessed without opening the files.
 *
 * Usage: pnpm avatars:check <directory>
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { roster } from './avatar-manifest.mjs'

/** Elements and attributes the brief forbids, with why they matter here. */
const FORBIDDEN = [
  ['<image', '内嵌位图'],
  ['<text', '文字不是形状'],
  ['<foreignObject', '外部内容'],
  ['<script', '脚本'],
  ['<style', '内联样式表'],
  ['<mask', '内联后无法复现'],
  ['<filter', '内联后无法复现'],
  ['<pattern', '内联后无法复现'],
  ['xlink:href', '外部引用'],
  ['href=', '外部引用'],
  ['url(', '间接引用画笔'],
]

const HARD_LIMIT = 5 * 1024
const SOFT_LIMIT = 2 * 1024
const TOTAL_LIMIT = 600 * 1024

/**
 * Every regular file under a directory.
 * @param root - directory to walk.
 * @param out - accumulator.
 * @returns absolute file paths.
 */
function walk(root, out = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile()) out.push(full)
  }
  return out
}

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

const svgFiles = walk(dir).filter((path) => path.toLowerCase().endsWith('.svg'))
const bySlug = new Map()
for (const path of svgFiles) {
  const slug = basename(path).replace(/\.svg$/i, '')
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
  const viewBox = /viewBox="([^"]+)"/.exec(source)?.[1]
  if (viewBox === undefined) {
    notSquare.push(`${slug} 无 viewBox`)
  } else {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number)
    if (parts.length !== 4 || parts.some(Number.isNaN)) notSquare.push(`${slug} viewBox 无法解析：${viewBox}`)
    else if (parts[2] !== parts[3]) notSquare.push(`${slug} 非正方形：${viewBox}`)
  }
  for (const [needle, why] of FORBIDDEN) {
    if (source.includes(needle)) forbidden.push(`${slug} 含 ${needle}（${why}）`)
  }
  if (/\sid="/.test(source)) withIds.push(slug)
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
list('含 id 属性（内联时需加命名空间）', withIds)

if (overSoft.length > 0) console.log(`\n超过软目标 ${SOFT_LIMIT} B 但未超硬上限：${overSoft.length} 个（可接受）`)
if (total > TOTAL_LIMIT) console.log(`\n警告：合计 ${(total / 1024).toFixed(0)} KB，超过总体积目标 ${TOTAL_LIMIT / 1024} KB`)

const blocking = missing.length + extra.length + tooBig.length + tooSmall.length + notSquare.length + forbidden.length
console.log(blocking === 0 ? '\n格式校验通过' : `\n${blocking} 项需要处理`)
process.exit(blocking === 0 ? 0 : 1)
