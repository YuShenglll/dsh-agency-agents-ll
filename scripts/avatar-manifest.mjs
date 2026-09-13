/**
 * Generate `docs/AVATARS.md`: the avatar brief plus the exact slug manifest.
 *
 * The roster is defined by `assets/en`, and each slug is a filename there, so
 * the manifest is derived rather than maintained. Run it after any upstream
 * sync; `scripts/verify.mjs` fails when the manifest and the roster disagree.
 *
 * Written as a repository script rather than a throwaway because the manifest
 * has to be regenerated whenever upstream adds or renames an expert.
 *
 * Division labels come from `sync/glossary.json`, whose `division:` entries
 * `verify.mjs` already gates against `src/names.ts` — so this reads no build
 * output and needs no type stripping to run.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ZH_ROOT = join(ROOT, 'assets', 'zh')
const EN_ROOT = join(ROOT, 'assets', 'en')
const TARGET = join(ROOT, 'docs', 'AVATARS.md')

/** Division directory names, in glossary order, with their Chinese labels. */
function divisions() {
  const glossary = JSON.parse(readFileSync(join(ROOT, 'sync', 'glossary.json'), 'utf8'))
  const labelled = Object.entries(glossary.terms ?? {})
    .filter(([key]) => key.startsWith('division:'))
    .map(([key, label]) => [key.slice('division:'.length), label])
  const present = new Set(labelled.map(([division]) => division))
  let onDisk = []
  try {
    onDisk = readdirSync(EN_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    onDisk = []
  }
  for (const division of onDisk) {
    if (!present.has(division)) labelled.push([division, division])
  }
  return labelled
}

/** Frontmatter fields plus the body, tolerating a quoted key and a BOM. */
function frontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw.replace(/^\uFEFF/, ''))
  if (match === undefined || match === null) return undefined
  const fields = {}
  for (const line of match[1].split(/\r?\n/)) {
    const entry = /^"?([A-Za-z_][\w-]*)"?\s*:\s*(.*)$/.exec(line)
    if (entry) fields[entry[1]] = entry[2].trim().replace(/^["']|["']$/g, '')
  }
  return { fields, body: match[2] }
}

/** Read one field from one file, or the empty string when it is absent. */
function field(path, key) {
  try {
    return frontmatter(readFileSync(path, 'utf8'))?.fields[key] ?? ''
  } catch {
    return ''
  }
}

/** Every roster entry, in division then slug order. */
export function roster() {
  const rows = []
  for (const [division] of divisions()) {
    let files
    try {
      files = readdirSync(join(EN_ROOT, division))
    } catch {
      continue
    }
    for (const file of files.filter((name) => name.endsWith('.md')).sort()) {
      const slug = file.replace(/\.md$/, '')
      rows.push({
        division,
        slug,
        emoji: field(join(EN_ROOT, division, file), 'emoji'),
        nameEn: field(join(EN_ROOT, division, file), 'name'),
        nameZh: field(join(ZH_ROOT, division, file), 'name'),
      })
    }
  }
  return rows
}

/** The full brief and manifest, as Markdown. */
export function render(rows) {
  const divisionCount = new Set(rows.map((row) => row.division)).size
  const out = [
    '# 卡片头像素材：规格与清单',
    '',
    `名册共 **${rows.length}** 个专家，覆盖 **${divisionCount}** 个分区。头像按**专家**提供，一个专家一张。`,
    '',
    '文件名的**主干必须逐字符等于**下表 `slug` 列，扩展名 `.svg`。除此之外不接受任何别名。',
    '',
    '## 1. 规格',
    '',
    '| 项 | 要求 |',
    '|---|---|',
    '| 格式 | **SVG**，纯文本，可优化过的导出 |',
    '| 画布 | 任意**正方形** `viewBox`，推荐 `0 0 48 48` |',
    '| 渲染尺寸 | **36 × 36 CSS px** |',
    '| 安全区 | 内容落在**内切圆**内（容器是 `border-radius:50%`），四周留约 8% 边距 |',
    '| 背景 | **透明**。不要铺满画布的底色矩形 |',
    '| 配色 | 由你定，但必须**在浅色和深色主题下都看得清**；避免大面积接近纯黑或纯白 |',
    '| 单文件体积 | 目标 ≤ 2 KB，硬上限 5 KB |',
    '| 总体积 | 目标 ≤ 600 KB（279 张合计） |',
    '',
    '**允许的元素**：`<path>` `<g>` `<circle>` `<rect>` `<ellipse>` `<polygon>` `<line>` `<polyline>`，以及文件内自带的 `<defs>` 渐变。',
    '',
    '**不允许**：`<image>`（内嵌位图）、`<text>`、`<foreignObject>`、`<script>`、`<style>`、`<mask>`、`<filter>`、`<pattern>`、任何外部引用。',
    '',
    '`id` 可以保留 —— 构建时会给每个文件加命名空间，279 个文件不会互相撞名。',
    '',
    '**请去掉编辑器元数据**：Figma / Sketch / Inkscape 的 `<metadata>`、`id="Layer_1"`、`xmlns:inkscape` 之类。跑一遍 SVGO 最好。',
    '',
    '## 2. 兜底',
    '',
    '下表 `emoji` 列是当前显示的内容，**会保留为兜底**：没有对应 SVG 的专家继续显示 emoji。',
    '',
    '所以**可以分批交付**，不必一次给全。每批给完我会跑一次校验，缺哪些当场就能列出来。',
    '',
    '## 3. 交付',
    '',
    '一个目录，`.svg` 平铺即可（不用按分区建子目录）。告诉我路径，我按文件名映射。',
    '',
    '## 4. 清单',
    '',
  ]
  const byDivision = new Map()
  for (const row of rows) {
    if (!byDivision.has(row.division)) byDivision.set(row.division, [])
    byDivision.get(row.division).push(row)
  }
  const labels = new Map(divisions())
  for (const [division, list] of byDivision) {
    out.push(`### ${labels.get(division) ?? division}（\`${division}\`）— ${list.length} 个`)
    out.push('')
    out.push('| slug（= 文件名主干） | 中文名 | 英文名 | 当前 emoji |')
    out.push('|---|---|---|---|')
    for (const row of list) {
      out.push(`| \`${row.slug}\` | ${row.nameZh || '—'} | ${row.nameEn || '—'} | ${row.emoji || '—'} |`)
    }
    out.push('')
  }
  return out.join('\n')
}

// Only write when run directly; `verify.mjs` imports `roster` to cross-check
// the manifest against the assets, and an import must not rewrite the file.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = roster()
  writeFileSync(TARGET, render(rows), 'utf8')
  console.log(`docs/AVATARS.md 已生成：${rows.length} 个专家 / ${new Set(rows.map((row) => row.division)).size} 个分区`)
}
