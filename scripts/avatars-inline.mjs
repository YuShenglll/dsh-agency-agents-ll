/**
 * Generate `src/client/avatars.ts` from `assets/avatar/*.svg`.
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
 * The avatar tree is deliberately kept out of the repository and lives only on
 * the machine that has it, so this script must succeed either way: with no
 * source tree it writes a module with no entries, and every card falls back to
 * its frontmatter emoji. That is why the generated module is ignored by git
 * rather than committed — it is a local build input, not a source file, and a
 * clean checkout would otherwise carry a module claiming artwork it lacks.
 *
 * Because `src/client/index.ts` imports the module statically, it has to exist
 * before `tsc`, vitest or `verify` run. Every entry point that needs it invokes
 * this script first (see package.json and vitest.config.ts) instead of asking
 * a person to remember.
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

/** Roster slugs that have an SVG on disk, plus the two ways they can disagree. */
function collect() {
  const slugs = roster().map((row) => row.slug)
  let entries = []
  try {
    entries = readdirSync(SOURCE)
  } catch {
    // No avatar tree on this machine. Not an error: the roster still renders.
  }
  const present = new Set(entries.filter((name) => name.endsWith('.svg')).map((name) => name.slice(0, -4)))
  const known = new Set(slugs)
  return {
    found: slugs.filter((slug) => present.has(slug)),
    missing: slugs.filter((slug) => !present.has(slug)),
    extra: [...present].filter((slug) => !known.has(slug)).sort(),
  }
}

/**
 * The generated module's full text.
 * @returns TypeScript source.
 */
export function render() {
  const { found, missing } = collect()
  const absent = missing.length === found.length + missing.length
  const lines = [
    '/**',
    ' * Avatar data URIs, one per expert. GENERATED — do not edit, and not committed.',
    ' *',
    ` * ${absent ? 'No avatar tree is present on this machine, so every expert falls' : `${found.length} of ${found.length + missing.length} roster experts have an avatar. One without falls`}`,
    ' * back to the emoji in its frontmatter.',
    ' *',
    ' * Source: `assets/avatar/*.svg`, kept off the repository by request. Run',
    ' * `pnpm avatars:inline` after changing it; `pnpm verify` fails when this file',
    ' * and that tree disagree.',
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
  if (missing.length > 0 && missing.length < found.length + missing.length) {
    lines.push(
      '/** Roster experts with no avatar yet; they render their emoji instead. */',
      'export const MISSING_AVATARS: readonly string[] = [',
      ...missing.map((slug) => `  '${slug}',`),
      ']',
      '',
    )
  }
  return lines.join('\n')
}

/**
 * Write the module, reporting what it found.
 * @returns what the write covered.
 */
export function generate() {
  const { found, missing, extra } = collect()
  writeFileSync(TARGET, render(), 'utf8')
  const bytes = readFileSync(TARGET).length
  const note = found.length === 0
    ? '没有本地头像素材，全部回退 emoji'
    : `${found.length} 张，${(bytes / 1024).toFixed(0)} KB`
  console.log(`src/client/avatars.ts 已生成：${note}`)
  if (missing.length > 0 && found.length > 0) {
    console.log(`  没有头像、回退 emoji：${missing.length} 个 —— ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''}`)
  }
  if (extra.length > 0) console.log(`  assets/avatar 里有多余名册之外的图：${extra.length} 个（已忽略）`)
  return { found, missing, extra }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generate()
}
