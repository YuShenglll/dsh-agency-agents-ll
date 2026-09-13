// One reading path and one measurement for the content pipeline.
//
// Two pairs of scripts used to carry their own copies of these helpers, and both
// pairs had drifted:
//
//   * `sync/checks.mjs` (the gate that enforces the length-ratio band) measured
//     CJK characters / English words over `stripMarkup(...)` output, while
//     `sync/calibrate-ratio.mjs` (the tool that calibrates that band) measured
//     raw bodies. Stripping deletes fenced code blocks, inline code, links and
//     URLs, and the English personas are full of fenced code, so the enforced
//     ratio sat systematically above the calibrated one: anybody tuning the band
//     from the calibrator's output tuned it wrong. The two also disagreed on the
//     character classes (checks.mjs counted CJK extension A as well).
//   * `sync/sync.mjs` did not strip a leading BOM before looking for the leading
//     `---` fence, while `sync/stamp.mjs` and `sync/authoring.mjs` did. The same
//     Chinese profile therefore read as "no frontmatter, so no sourceSha256, so
//     stale" to the manifest and as an ordinary profile to the other two readers.
//
// Everything the whole pipeline reads or counts now comes from here, so the four
// scripts cannot disagree again. Node built-ins only; `sync/` is deliberately not
// part of the published package (package.json `files`), so this is a development
// module like its callers and needs no packaging story.

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

/**
 * Strip a leading UTF-8 BOM. The one BOM rule every script shares.
 * @param text - raw file text.
 * @returns the text without a leading BOM.
 */
export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * Split a document into its frontmatter fence, the block between the fences and
 * everything after it, so a rewriter can rebuild the file without touching a byte
 * it did not mean to change: `head + block + tail + rest` is the original text
 * (minus a leading BOM). `block` excludes the newline that ends its last line and
 * `tail` includes it, which is what makes appending a key to `block` produce a
 * well-formed file.
 *
 * The opening line is whatever the file starts with; the block ends at the first
 * later line that trims to exactly `---`. That is deliberately the same rule the
 * gate used before this module existed, including its tolerance of an opening
 * line with trailing whitespace (reported separately, see `readFrontmatter`).
 *
 * @param raw - raw file contents.
 * @returns `{ bom, head, block, tail, rest }`, or null when the file does not
 *   start with `---` or the fence is never closed. `bom` records whether a BOM
 *   was stripped from the returned parts.
 */
export function splitFrontmatter(raw) {
  const bom = raw.charCodeAt(0) === 0xfeff
  const text = bom ? raw.slice(1) : raw
  if (!text.startsWith('---')) return null
  const newline = text.indexOf('\n')
  if (newline === -1) return null
  const head = text.slice(0, newline + 1)
  const remainder = text.slice(newline + 1)
  const closing = /^[ \t]*---[ \t]*(?:\r?\n|$)/m.exec(remainder)
  if (closing === null) return null
  const before = remainder.slice(0, closing.index)
  const endsBlock = /(\r?\n)$/.exec(before)
  return {
    bom,
    head,
    block: endsBlock === null ? before : before.slice(0, -endsBlock[0].length),
    tail: (endsBlock === null ? '' : endsBlock[0]) + closing[0],
    rest: remainder.slice(closing.index + closing[0].length),
  }
}

/**
 * Parse the leading `---` frontmatter block.
 *
 * Structural problems are reported rather than thrown, because a gate has to keep
 * auditing a broken profile: a file whose fence never closes still has to be
 * counted in the report and in the piles.
 *
 * The BOM is stripped for READING in both trees — that is the one rule this
 * module exists for — and a BOM in front of a valid fence is still reported as a
 * problem, because `assets/en` has a byte-identity contract with upstream
 * (docs/PLAN.md section 3) and a file that carries one has to be repaired rather
 * than read around; the gate grades it a hard `frontmatter` failure. Before this
 * module, sync.mjs read such a file as having no frontmatter at all (so the
 * manifest recorded it as `stale` with a null `zhSourceSha256`) while stamp.mjs
 * and authoring.mjs stripped the BOM and read the same fields the runtime does.
 *
 * Quote rule: a value that OPENS with a quote must close it, otherwise a
 * translation silently swallows the rest of the line. A quote appearing inside an
 * otherwise unquoted scalar is valid YAML and common upstream
 * (`vibe: ... where "secure by default" isn't just a slide title.`), so it is not
 * a defect and must not fail the build.
 *
 * @param raw - raw file contents.
 * @returns `{ present, fields, problems, bom }`; `present` is true when both
 *   fences were found.
 */
export function readFrontmatter(raw) {
  const bom = raw.charCodeAt(0) === 0xfeff
  const text = bom ? raw.slice(1) : raw
  const problems = []
  if (!text.startsWith('---')) {
    problems.push(bom ? 'file starts with a UTF-8 BOM before the frontmatter' : 'no leading "---" frontmatter fence')
    return { present: false, fields: {}, problems, bom }
  }
  const parts = splitFrontmatter(raw)
  if (parts === null) {
    problems.push('frontmatter "---" fence is never closed')
    return { present: false, fields: {}, problems, bom }
  }
  if (bom) problems.push('file starts with a UTF-8 BOM before the frontmatter')
  if (parts.head.trim() !== '---') problems.push('opening fence line is not exactly "---"')

  const fields = {}
  const lines = parts.block.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '' || /^\s/.test(line) || line.trimStart().startsWith('#')) continue
    // Tolerate a quoted key ("name": "x"): translators occasionally quote the
    // key as well as the value, which is harmless YAML-ish and not worth a hard
    // failure.
    const pair = /^"?([A-Za-z0-9_-]+)"?\s*:\s*(.*)$/.exec(line)
    if (pair === null) {
      if (line.includes(':')) problems.push(`frontmatter line ${index + 2} is not shaped like "key: value"`)
      continue
    }
    let value = pair[2].trim()
    const first = value[0]
    if (first === '"' || first === "'") {
      if (value.length < 2 || value[value.length - 1] !== first) {
        problems.push(`frontmatter "${pair[1]}" (line ${index + 2}) opens with a quote it never closes`)
      } else {
        value = value.slice(1, -1)
      }
    } else if (value.endsWith('"') || value.endsWith("'")) {
      // Plain scalar that happens to end on a quote; harmless, just unquote it.
      value = value.slice(0, -1).trim()
    }
    fields[pair[1]] = value
  }

  return { present: true, fields, problems, bom }
}

/**
 * Everything after the closing frontmatter fence, or the whole document when
 * there is none. The BOM is stripped first, so a BOM can neither hide the body
 * nor make an intro-only profile look like it carries a translation.
 * @param raw - raw file contents.
 * @returns the body text.
 */
export function bodyOf(raw) {
  const parts = splitFrontmatter(raw)
  return parts === null ? stripBom(raw) : parts.rest
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * Remove the markup that must not count towards a length ratio: fenced code
 * blocks, inline code, links, URLs and HTML. Both the gate and the calibrator
 * measure the output of this, which is the whole point of the module.
 * @param text - body text.
 * @returns the prose.
 */
export function stripMarkup(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/<[^>\n]{1,120}>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
}

/**
 * CJK characters, including extension A (U+3400-U+4DBF), which is where the rarer
 * Chinese ideographs live.
 * @param text - text to count.
 * @returns the number of CJK characters.
 */
export function cjkCount(text) {
  const matched = text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g)
  return matched === null ? 0 : matched.length
}

/**
 * Latin-script words, accepting the typographic apostrophe upstream uses.
 * @param text - text to count.
 * @returns the number of words.
 */
export function wordCount(text) {
  const matched = text.match(/[A-Za-z][A-Za-z'’-]*/g)
  return matched === null ? 0 : matched.length
}

/**
 * Split a document into top-level blocks and per-level heading counts.
 *
 * Fence tracking uses a stack rather than a single open/close flag: several
 * upstream personas legitimately nest a ```mermaid / ```bash / ```html fence
 * inside a ```markdown fence to show a whole document, and a single-slot parser
 * mistakes the nested closer for the outer one and then reports a false
 * "unclosed fence". Only a stack that is non-empty at EOF is a truncation risk.
 *
 * There is deliberately no "fence count is even" field here. Every fence line
 * either pushes or pops the stack, so the number of fence lines and the final
 * depth always share a parity (depth = pushes - pops), which means an odd fence
 * count can never say anything that `unclosed` does not already say. It used to
 * be reported separately and could not fire as a first signal.
 *
 * @param text - document text.
 * @returns `{ blocks, headings, unclosed }`.
 */
export function structure(text) {
  const lines = text.split(/\r?\n/)
  const blocks = []
  const headings = {}
  const stack = []
  let current = []

  const flush = () => {
    const body = current.join('\n').trim()
    if (body !== '') blocks.push(body)
    current = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fenceMatch = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if (fenceMatch !== null) {
      const marker = fenceMatch[1]
      const top = stack[stack.length - 1]
      if (top !== undefined && marker[0] === top[0] && marker.length >= top.length) stack.pop()
      else stack.push(marker)
      current.push(line)
      continue
    }
    if (stack.length === 0 && /^\s*#{1,6}\s+\S/.test(line)) {
      const level = /^\s*(#{1,6})/.exec(line)[1].length
      headings[level] = (headings[level] ?? 0) + 1
    }
    if (stack.length === 0 && line.trim() === '') {
      flush()
      continue
    }
    current.push(line)
  }
  flush()

  return { blocks, headings, unclosed: stack.length }
}
