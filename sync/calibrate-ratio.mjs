// Re-measure the CJK-characters / English-words ratio on this project's own
// translation pairs, so THRESHOLDS.lengthRatio* in checks.mjs stays grounded in
// the shipped corpus instead of a guess.
//
// It measures through sync/corpus.mjs — the same reading and counting code the gate
// uses — so the number printed here IS the number `pnpm check` enforces. The two
// scripts used to carry separate copies and had drifted: this one measured raw
// bodies while the gate measured `stripMarkup(...)` output, and stripping deletes
// fenced code blocks, inline code, links and URLs, of which the English personas
// are full. The enforced ratio therefore sat systematically ABOVE the calibrated
// one, and anybody tuning the band from this output tuned it wrong.
//
// `enforced` is the metric to calibrate on. `raw` is printed alongside it only to
// show how much of the English side the markup accounts for.
//
// Sample size: only profiles that carry a translated body take part (an
// intro-only profile has no Chinese body to measure), and the 100-word /
// 100-CJK-character floor keeps a half-finished translation out of the quantiles.
// On the current corpus that is 6 pairs, which is far too few to tighten a band
// on — an earlier comment in checks.mjs claimed 229 pairs and cannot be
// reproduced from this repository.
//
// Run with: pnpm sync:calibrate   (node is not on PATH in this environment)
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bodyOf, cjkCount, stripMarkup, wordCount } from './corpus.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const enRoot = path.join(projectRoot, 'assets', 'en')
const zhRoot = path.join(projectRoot, 'assets', 'zh')

async function listMarkdown(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** The same two counts the gate takes, over whatever text it is handed. */
const measure = (text) => ({ chars: cjkCount(text), words: wordCount(text) })

const enforced = []
const raw = []
for (const division of await readdir(enRoot, { withFileTypes: true })) {
  if (!division.isDirectory()) continue
  const zhNames = new Set(await listMarkdown(path.join(zhRoot, division.name)))
  for (const name of await listMarkdown(path.join(enRoot, division.name))) {
    if (!zhNames.has(name)) continue
    const enBody = bodyOf(await readFile(path.join(enRoot, division.name, name), 'utf8'))
    const zhBody = bodyOf(await readFile(path.join(zhRoot, division.name, name), 'utf8'))
    const strippedZh = measure(stripMarkup(zhBody))
    const strippedEn = measure(stripMarkup(enBody))
    if (strippedEn.words < 100 || strippedZh.chars < 100) continue
    enforced.push(strippedZh.chars / strippedEn.words)
    // Same pairs, same guards: the raw counts can only be larger, so both series
    // describe the same corpus and stay comparable.
    const rawZh = measure(zhBody)
    const rawEn = measure(enBody)
    if (rawEn.words > 0) raw.push(rawZh.chars / rawEn.words)
  }
}

if (enforced.length === 0) {
  console.log('no translation pairs yet; nothing to calibrate')
  process.exit(0)
}

enforced.sort((a, b) => a - b)
raw.sort((a, b) => a - b)

/**
 * Quantiles of one sorted series, with the same estimator the earlier version
 * used so the numbers stay comparable with what was published before.
 * @param values - ascending ratios.
 * @returns min / p05 / p25 / median / p75 / p95 / max, rounded to 3 decimals.
 */
function quantiles(values) {
  const q = (p) => values[Math.min(values.length - 1, Math.floor(p * values.length))]
  return {
    min: +values[0].toFixed(3),
    p05: +q(0.05).toFixed(3),
    p25: +q(0.25).toFixed(3),
    median: +q(0.5).toFixed(3),
    p75: +q(0.75).toFixed(3),
    p95: +q(0.95).toFixed(3),
    max: +values[values.length - 1].toFixed(3),
  }
}

console.log(JSON.stringify({
  metric: 'cjk(stripMarkup(body)) / words(stripMarkup(body))  — the gate\'s metric',
  pairs: enforced.length,
  enforced: quantiles(enforced),
  raw: raw.length === enforced.length ? quantiles(raw) : null,
}, null, 2))
