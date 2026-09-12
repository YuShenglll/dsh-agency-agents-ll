// Re-measure the CJK-characters / English-words ratio on this project's own
// translation pairs, so THRESHOLDS.lengthRatio* in checks.mjs stays grounded in
// the shipped corpus instead of a guess.
//
// Run with: pnpm sync:calibrate   (node is not on PATH in this environment)
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const enRoot = path.join(projectRoot, 'assets', 'en')
const zhRoot = path.join(projectRoot, 'assets', 'zh')

function body(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw.replace(/^\uFEFF/, ''))
  return (match?.[2] ?? raw).trim()
}
const cjk = (text) => (text.match(/[\u4e00-\u9fff]/g) ?? []).length
const words = (text) => (text.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).length

async function listMarkdown(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

const ratios = []
for (const division of await readdir(enRoot, { withFileTypes: true })) {
  if (!division.isDirectory()) continue
  const zhNames = new Set(await listMarkdown(path.join(zhRoot, division.name)))
  for (const name of await listMarkdown(path.join(enRoot, division.name))) {
    if (!zhNames.has(name)) continue
    const en = body(await readFile(path.join(enRoot, division.name, name), 'utf8'))
    const zh = body(await readFile(path.join(zhRoot, division.name, name), 'utf8'))
    const w = words(en)
    const c = cjk(zh)
    if (w < 100 || c < 100) continue
    ratios.push(c / w)
  }
}

if (ratios.length === 0) {
  console.log('no translation pairs yet; nothing to calibrate')
  process.exit(0)
}

ratios.sort((a, b) => a - b)
const q = (p) => ratios[Math.min(ratios.length - 1, Math.floor(p * ratios.length))]
console.log(JSON.stringify({
  pairs: ratios.length,
  min: +ratios[0].toFixed(3),
  p05: +q(0.05).toFixed(3),
  p25: +q(0.25).toFixed(3),
  median: +q(0.5).toFixed(3),
  p75: +q(0.75).toFixed(3),
  p95: +q(0.95).toFixed(3),
  max: +ratios[ratios.length - 1].toFixed(3),
}, null, 2))
