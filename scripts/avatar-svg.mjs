/**
 * The one place that knows how an avatar SVG is found and read.
 *
 * `scripts/avatar-check.mjs` (the delivery gate) and `scripts/avatars-inline.mjs`
 * (the generator) used to carry their own copies, and the copies disagreed:
 *
 *   * the checker accepted `.SVG` and stripped the extension case-insensitively,
 *     while the generator only looked at lowercase `.svg` — so a file the checker
 *     blessed was silently skipped by the generator and the card quietly fell back
 *     to its frontmatter emoji, with nothing reported;
 *   * the checker's `viewBox` pattern only matched double quotes, and its
 *     forbidden-element list was matched case-sensitively, so `<TEXT>` slipped
 *     through both.
 *
 * Everything either script needs to know about a delivered file is exported from
 * here, so "the file is fine" and "the file is used" cannot diverge again.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Elements and attributes the brief forbids, with why they matter here. */
export const FORBIDDEN = [
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

/**
 * Whether a name is an SVG file, whatever case the extension is written in.
 * @param name - file name or path.
 * @returns true for `.svg`, `.SVG` and anything between.
 */
export function isSvg(name) {
  return name.toLowerCase().endsWith('.svg')
}

/**
 * The slug a delivered file claims: its name without the extension, which has to
 * equal `<slug>` in `assets/en/<division>/<slug>.md`.
 * @param name - file name, extension included.
 * @returns the slug.
 */
export function slugOf(name) {
  return name.replace(/\.svg$/i, '')
}

/**
 * Every regular file under a directory, recursively.
 * @param root - directory to walk.
 * @param out - accumulator.
 * @returns absolute file paths.
 */
export function walkFiles(root, out = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) walkFiles(full, out)
    else if (entry.isFile()) out.push(full)
  }
  return out
}

/**
 * Analyse one SVG source against the brief's format rules.
 * @param source - file contents.
 * @returns the `viewBox` value (undefined when absent), the forbidden needles the
 *   file contains, and whether any element carries an `id`.
 */
export function inspectSvg(source) {
  // Single or double quotes: hand-written and SVGO output both occur, and the
  // double-quote-only pattern used to report a perfectly square icon as
  // "viewBox 无法解析".
  const viewBox = /viewBox\s*=\s*(["'])([^"']*)\1/.exec(source)?.[2]
  // Case-insensitive: `<TEXT>` is the same defect as `<text>`.
  const lower = source.toLowerCase()
  const forbidden = FORBIDDEN.filter(([needle]) => lower.includes(needle.toLowerCase()))
  // `id` as a whole attribute name, so `data-id` is not mistaken for one.
  return { viewBox, forbidden, hasId: /(?:^|\s)id\s*=\s*["']/.test(source) }
}
