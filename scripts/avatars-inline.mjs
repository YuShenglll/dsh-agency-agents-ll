/**
 * Inline `assets/avatar/*.svg` into a generated client module.
 *
 * The browser half cannot read `assets/` — that tree is on the Host's disk and
 * reaches the page only over the wire — so the avatars have to travel inside
 * the client bundle. 279 files at ~800 bytes each is about 220 KB, which the
 * bundle absorbs; a raster set would not have fitted.
 *
 * Each SVG becomes a `data:` URI at generation time rather than at render time,
 * so a card only looks its avatar up. `encodeURIComponent` is required, not
 * cosmetic: the artwork paints with `#RRGGBB`, and an unencoded `#` would start
 * a fragment and truncate the image.
 *
 * The output is committed rather than generated during the build. A file that
 * must exist before `tsc` and vitest can run turns the build into a sequence
 * someone will eventually get wrong; committing it keeps every entry point
 * working from a clean checkout, and `scripts/verify.mjs` fails when the
 * committed copy and `assets/avatar/` disagree.
 *
 * Usage: pnpm avatars:inline
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { roster } from './avatar-manifest.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = join(ROOT, 'assets', 'avatar')
const TARGET = join(ROOT, 'src', 'client', 'avatars.ts')

/** Slug to file, for every roster slug that has an avatar on disk. */
function collect() {
  const present = new Set(readdirSync(SOURCE).filter((name) => name.endsWith('.svg')).map((name) => name.slice(0, -4)))
  const slugs = roster().map((row) => row.slug)
  const found = slugs.filter((slug) => present.has(slug))
  const missing = slugs.filter((slug) => !present.has(slug))
  const known = new Set(slugs)
  const extra = [...present].filter((slug) => !known.has(slug)).sort()
  return { found, missing, extra }
}

/**
 * The generated module's full text.
 * @returns TypeScript source.
 */
export function render() {
  const { found, missing, extra } = collect()
  const lines = [
    '/**',
    ' * Avatar data URIs, one per expert. GENERATED — do not edit.',
    ' *',
    ' * Source: `assets/avatar/*.svg`. Regenerate with `pnpm avatars:inline`;',
    ' * `pnpm verify` fails when this file and that tree disagree.',
    ' *',
    ` * ${found.length} of ${found.length + missing.length} roster experts have an avatar. One without falls`,
    ' * back to the emoji in its frontmatter, which is why a missing entry is not',
    ' * an error here.',
    ' */',
    '',
    '/** Expert slug to a `data:image/svg+xml` URI. */',
    'export const AVATARS: Readonly<Record<string, string>> = {',
  ]
  for (const slug of found) {
    const svg = readFileSync(join(SOURCE, `${slug}.svg`), 'utf8')
    lines.push(`  '${slug}': 'data:image/svg+xml,${encodeURIComponent(svg)}',`)
  }
  lines.push('}', '')
  if (missing.length > 0) {
    lines.push(
      `/** Roster experts with no avatar yet; they render their emoji instead. */`,
      `export const MISSING_AVATARS: readonly string[] = [`,
      ...missing.map((slug) => `  '${slug}',`),
      ']',
      '',
    )
  }
  void extra
  return lines.join('\n')
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { found, missing, extra } = collect()
  writeFileSync(TARGET, render(), 'utf8')
  const bytes = readFileSync(TARGET).length
  console.log(`src/client/avatars.ts 已生成：${found.length} 张，${(bytes / 1024).toFixed(0)} KB`)
  if (missing.length > 0) console.log(`没有头像、回退 emoji：${missing.length} 个 —— ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''}`)
  if (extra.length > 0) console.log(`assets/avatar 里有多余名册之外的图：${extra.length} 个（已忽略）`)
}
