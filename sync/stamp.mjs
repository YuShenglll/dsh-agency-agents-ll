// Stamp every Chinese persona with the sha256 of the English file it was
// translated from.
//
// Translators must not compute hashes: asking 279 independent runs to hash their
// own source guarantees drift. The hash is derived here, once, from the files on
// disk — so `sourceSha256` always describes what the Chinese was actually
// translated from, and a later English change turns it into a hard failure.
//
// A profile whose frontmatter cannot be found is listed under `skipped` and makes
// the run exit non-zero: "everything was already stamped" and "three profiles
// could not be stamped" must not look the same to a caller.
//
// Run with: pnpm sync:stamp   (node is not on PATH in this environment)
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitFrontmatter } from './corpus.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const enRoot = path.join(projectRoot, 'assets', 'en')
const zhRoot = path.join(projectRoot, 'assets', 'zh')

const KEY_LINE = /^sourceSha256\s*:.*$/m

async function listMarkdown(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort()
}

async function listDivisions(root) {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

let stamped = 0
let unchanged = 0
const skipped = []

for (const division of await listDivisions(enRoot)) {
  const enDir = path.join(enRoot, division)
  const zhDir = path.join(zhRoot, division)
  const zhNames = new Set(await listMarkdown(zhDir))
  for (const name of await listMarkdown(enDir)) {
    if (!zhNames.has(name)) continue
    const enBytes = await readFile(path.join(enDir, name))
    const digest = sha256(enBytes)
    const zhPath = path.join(zhDir, name)
    const raw = await readFile(zhPath, 'utf8')
    // One reading path with the other three scripts: the BOM rule and the fence
    // rule come from sync/corpus.mjs, so a BOM-prefixed profile is stamped like
    // any other instead of being skipped. The BOM itself is not written back —
    // checks.mjs grades one a hard `frontmatter` failure, so a rewrite without it
    // is the repair.
    const parts = splitFrontmatter(raw)
    if (parts === null) {
      skipped.push(`${division}/${name}: no frontmatter`)
      continue
    }
    const head = parts.head
    let block = parts.block
    const tail = parts.tail
    const rest = parts.rest
    if (KEY_LINE.test(block)) {
      const next = block.replace(KEY_LINE, `sourceSha256: "${digest}"`)
      if (next === block) {
        unchanged += 1
        continue
      }
      block = next
    } else {
      block = `${block}\nsourceSha256: "${digest}"`
    }
    await writeFile(zhPath, `${head}${block}${tail}${rest}`, 'utf8')
    stamped += 1
  }
}

console.log(`stamped:  ${stamped}`)
console.log(`already:  ${unchanged}`)
if (skipped.length > 0) {
  console.log(`skipped:  ${skipped.length}`)
  for (const line of skipped.slice(0, 20)) console.log(`  ${line}`)
  console.log('这些档案的 frontmatter 读不出来，无法盖戳；先跑 pnpm check 看 frontmatter 门禁怎么说。')
  process.exitCode = 1
}
