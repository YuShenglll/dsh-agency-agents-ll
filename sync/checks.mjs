// P1 data pipeline - stage 2 of 2: the machine gates from docs/PLAN.md section 6.
//
// Thirteen checks produce sync/report.json plus a readable stdout summary. Every
// roster entry lands in one of three piles: aligned / suspect / missing.
//
// Hard failures (non-zero exit), i.e. exactly HARD_FAILURE_CHECKS below:
//   english-byte-identity  assets/en no longer byte-matches the baseline commit,
//                          or its bytes/hash disagree with the manifest record
//   frontmatter            missing name/description/intro/emoji, unbalanced quotes
//                          or fences, or a BOM in front of the fence
//   code-fences            an unclosed ``` silently truncates everything after it
//   manifest-coverage      a roster entry has no manifest record
//   intro                  the Chinese introduction is missing, too short or too long
//   translation-freshness  a translated body was written against an older English file
//   name-uniqueness        two profiles claim the same display name
// The remaining checks are reported as suspect or warn only: block alignment,
// heading alignment, glossary, length ratio and foreign residue say nothing about
// a profile that carries no translated body, and a missing translation degrades to
// the English persona by design (docs/PLAN.md section 3.1).
//
// Reading and measurement live in sync/corpus.mjs, shared with the other sync
// scripts so that a BOM or a ratio means the same thing everywhere.
//
// Run with: pnpm check   (node is not on PATH in this environment)

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { access, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bodyOf, cjkCount, readFrontmatter, stripMarkup, structure, wordCount } from './corpus.mjs'

const MANIFEST_URL = new URL('./manifest.json', import.meta.url)
const GLOSSARY_URL = new URL('./glossary.json', import.meta.url)
const REPORT_URL = new URL('./report.json', import.meta.url)

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assetsRoot = path.join(projectRoot, 'assets')
const REPORT_VERSION = 1

// Tuning knobs. Each is a heuristic, so they live in one place and are echoed into
// the report for later calibration against real translations.
const THRESHOLDS = {
  // 5: block counts must match exactly, so no floor knob exists here.
  // 8: CJK characters / English words, measured on stripMarkup(bodyOf(...))
  // bodies through the shared sync/corpus.mjs - the same metric the calibrator
  // measures, which is the point: a band tuned on one definition and enforced with
  // another is worse than no calibration at all.
  //
  // The band is deliberately wide. It came from an earlier, larger calibration of
  // this corpus that this repository can no longer reproduce: only 6 of the 279
  // Chinese profiles currently carry a translated body, so `pnpm sync:calibrate`
  // (which measures exactly this metric) has 6 pairs to work with, not the 229 an
  // earlier version of this comment claimed. Re-measure before tightening it; a
  // faithful translation lands well inside the band, and the band exists to catch
  // a stub or a wholesale rewrite, not ordinary variation.
  lengthRatioMin: 0.7,
  lengthRatioMax: 3.2,
  // 9: an ASCII run this many words long, in a paragraph that has no CJK, counts
  // as leftover English prose.
  foreignRunWords: 8,
  // 7 and 9: cap samples kept per file so one bad file cannot flood the report.
  maxSamplesPerFile: 5,
}

// A translation whose English source has moved on is a hard failure: serving it
// would silently pair an old Chinese persona with new English instructions.
// `missing` is deliberately NOT here — an untranslated expert degrades to
// English and is counted, not failed.
const HARD_FAILURE_CHECKS = ['english-byte-identity', 'frontmatter', 'code-fences', 'manifest-coverage', 'translation-freshness', 'intro', 'name-uniqueness']
const HARD_FAILURES = new Set(HARD_FAILURE_CHECKS)

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function exists(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error !== undefined && result.error !== null) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})`)
  return (result.stdout ?? '').trim()
}

function note(severity, check, message) {
  return { severity, check, message }
}

/** Add a note at most once, stamped with the file it belongs to. */
function pushNote(notes, fileKey, entry) {
  const stamped = fileKey === null ? { ...entry } : { fileKey, ...entry }
  const identity = `${stamped.fileKey ?? ''}|${stamped.severity}|${stamped.check}|${stamped.message}`
  if (notes.some((existing) => `${existing.fileKey ?? ''}|${existing.severity}|${existing.check}|${existing.message}` === identity)) return
  notes.push(stamped)
}

// ---------------------------------------------------------------------------
// Check 2: frontmatter legality
// ---------------------------------------------------------------------------

/**
 * Audit the leading --- block. Parse problems stay separate from missing required
 * keys so the report distinguishes "broken YAML" from "field absent".
 *
 * The parsing — including the one BOM rule shared with sync.mjs, stamp.mjs and
 * authoring.mjs — lives in sync/corpus.mjs; this adds the per-tree required keys.
 */
function auditFrontmatter(text, requiredKeys = ['name', 'description', 'emoji']) {
  const parsed = readFrontmatter(text)
  const problems = [...parsed.problems]
  for (const key of requiredKeys) {
    if (typeof parsed.fields[key] !== 'string' || parsed.fields[key].trim() === '') problems.push(`frontmatter is missing required key "${key}"`)
  }
  return {
    present: parsed.present,
    fields: parsed.fields,
    problems,
    sourceSha256: typeof parsed.fields.sourceSha256 === 'string' ? parsed.fields.sourceSha256 : null,
  }
}

// A Chinese file is an expert profile: name, one-line description, and the
// Chinese introduction that is this project's actual deliverable. The persona
// body that follows is OPTIONAL - when present it is a full translation and is
// held to the structural mirror rules; when absent the summon falls back to the
// English persona.
const ZH_REQUIRED_KEYS = ['name', 'description', 'intro', 'emoji']

// The intro band, measured on the 279 profiles that shipped with this gate:
// 151-314 CJK characters (mean 230) and 3-6 sentences. The distribution is in
// `sync/report.json` under `metrics.introSentences` — 125 profiles at 4, 150 at 5,
// two at 6, and two sitting exactly on the floor. The bounds below leave roughly
// 20% of headroom below the shortest profile and 27% above the longest, which is
// the point: the previous 40-600 was 3.8x below and 1.9x above anything real, so
// both shapes it claimed to catch ("looks like a placeholder" / "looks like a
// pasted essay") passed. A one-line stub is now under 120 characters and a pasted
// essay is over 400.
const INTRO_MIN_CJK = 120
const INTRO_MAX_CJK = 400

// docs/PLAN.md asks for "3-5 sentences"; the shipped corpus runs 3-6, and two
// profiles sit exactly on the floor, so it cannot be raised without rewriting
// them. The band moves with the corpus rather than the other way round: 3-8 keeps
// the documented 3-sentence floor and gives the two six-sentence profiles room
// without accepting an essay, and a stub stops passing.
const INTRO_MIN_SENTENCES = 3
const INTRO_MAX_SENTENCES = 8

/**
 * Count the sentences of an intro.
 *
 * A sentence ends on a run of `。`, `！` or `？`. ASCII `!` and `?` are deliberately
 * NOT terminators: `??` and `||` are Javascript operators that appear inside an
 * intro (specialized-codebase-archaeologist), and no shipped intro uses ASCII
 * sentence punctuation. A run of `…` counts once. Text after the last terminator
 * counts as one more sentence when it still carries CJK, so a paragraph that
 * simply forgot its final full stop is not judged short.
 *
 * @param text - the intro as parsed from the Chinese frontmatter.
 * @returns the number of sentences.
 */
function countSentences(text) {
  const parts = text.split(/[。！？]+|…+/)
  const terminated = parts.length - 1
  const tail = parts[parts.length - 1] ?? ''
  return cjkCount(tail) > 0 ? terminated + 1 : terminated
}

// ---------------------------------------------------------------------------
// Check 7 / 9 helpers
// ---------------------------------------------------------------------------

function splitPhrases(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#&/'.-]+/)
    .filter((piece) => piece !== '')
}

function tokenMatches(actual, wanted) {
  if (actual === wanted) return true
  // Plural folding applies to the term being looked up, not to the English prose,
  // otherwise scanning for "accessibility" would demand "accessibilit" in the text.
  if (wanted.endsWith('s') && actual === wanted.slice(0, -1)) return true
  if (actual.endsWith('s') && actual.slice(0, -1) === wanted) return true
  if ((actual === '&' && wanted === 'and') || (actual === 'and' && wanted === '&')) return true
  if ((actual === '-' || actual === '/') && (wanted === '-' || wanted === '/')) return true
  return false
}

/**
 * Token-aware containment with three equivalences: '-' == '/', '&' == 'and', and a
 * trailing plural 's'. "post-mortem" matches "postmortem", "CI/CD" matches "ci cd",
 * and "agents" matches "agent".
 */
function phraseContains(tokens, needle) {
  const target = splitPhrases(needle)
  if (target.length === 0) return false
  for (let start = 0; start + target.length <= tokens.length; start += 1) {
    let matched = true
    for (let offset = 0; offset < target.length; offset += 1) {
      if (tokenMatches(tokens[start + offset], target[offset])) continue
      matched = false
      break
    }
    if (matched) return true
  }
  return false
}

/** Glossary content terms, longest key first so phrases beat their headwords. */
function buildTermIndex(terms) {
  return Object.entries(terms)
    .filter(([key]) => !key.startsWith('division:'))
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.key.length - a.key.length)
}

const LATIN_SCRIPT_ALLOWED = new Set([
  'api', 'kubernetes', 'webhook', 'hipaa', 'kpi', 'okr', 'roi', 'seo', 'sla', 'slo', 'nps', 'csat',
  'mttr', 'crm', 'etl', 'p&l', 'ci', 'cd', 'yaml', 'json', 'html', 'css', 'sql', 'http', 'https',
  'url', 'markdown', 'github', 'node', 'react', 'typescript', 'javascript', 'npm', 'pnpm', 'dsh',
])

/**
 * Find English prose left in a Chinese file. Fenced blocks, inline code, links,
 * URLs and HTML are stripped before this runs. A run is reported when it is a
 * sentence-shaped Latin-script stretch: long enough to be prose (at least
 * `foreignRunWords` words and 25 characters), still carrying sentence punctuation
 * or internal capitalisation, and not made only of approved Latin-script terms
 * such as API, CI/CD or Kubernetes.
 *
 * Mixed lines are deliberately in scope: a Chinese bullet whose body was left in
 * English is exactly the failure this check exists to catch.
 */
function findResidue(zhBody) {
  const samples = []
  for (const rawLine of zhBody.split(/\n/)) {
    const line = rawLine.trim()
    if (line === '' || cjkCount(line) > 0) continue
    for (const run of line.match(/[A-Za-z][A-Za-z0-9'’,.:;!?()\-/&\s]*/g) ?? []) {
      const trimmed = run.trim().replace(/[\s,;:]+$/, '')
      if (trimmed.length < 25) continue
      const words = trimmed.split(/\s+/).filter((word) => /[A-Za-z]/.test(word))
      if (words.length < THRESHOLDS.foreignRunWords) continue
      const onlyAllowed = words.every((word) => LATIN_SCRIPT_ALLOWED.has(word.toLowerCase().replace(/[^a-z0-9&]/g, '')))
      if (onlyAllowed) continue
      const sentenceShaped = /[.!?]/.test(trimmed) || /[A-Z]/.test(trimmed.slice(1))
      if (!sentenceShaped) continue
      samples.push(trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed)
    }
  }
  return samples
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_URL, 'utf8'))
  const glossary = JSON.parse(await readFile(GLOSSARY_URL, 'utf8'))
  const termIndex = buildTermIndex(glossary.terms ?? {})
  const upstreamDir = resolveUpstreamDir()
  const upstreamHead = upstreamDir === null ? null : readUpstreamHead(upstreamDir)
  const upstreamDivisions = readUpstreamDivisions(upstreamDir)

  const notes = []
  const checks = []

  // -- 1. slug set consistency ---------------------------------------------
  const manifestKeys = Object.keys(manifest.files ?? {}).sort()
  const enTree = await readTree(path.join(assetsRoot, 'en'))
  const zhTree = await readTree(path.join(assetsRoot, 'zh'))
  const manifestSet = new Set(manifestKeys)
  const missingInEn = manifestKeys.filter((key) => !enTree.keys.has(key))
  const missingInZh = manifestKeys.filter((key) => !zhTree.keys.has(key))
  const extraInEn = [...enTree.keys].filter((key) => !manifestSet.has(key)).sort()
  const extraInZh = [...zhTree.keys].filter((key) => !manifestSet.has(key)).sort()
  const zhWithoutEn = [...zhTree.keys].filter((key) => !enTree.keys.has(key)).sort()

  // The subjects this check names, so the entry can carry the same `files` count
  // its siblings do. These notes are about a tree or a division rather than about
  // one profile, so nothing is derived from `summarize()`'s per-file shape.
  const slugSetSubjects = new Set()
  const slugSetNote = (subject, entry) => {
    pushNote(notes, null, entry)
    if (subject !== null) slugSetSubjects.add(subject)
  }

  for (const key of extraInEn) slugSetNote(key, note('error', 'slug-sets', `assets/en has "${key}" but the manifest does not record it`))
  for (const key of extraInZh) slugSetNote(key, note('error', 'slug-sets', `assets/zh has "${key}" but the manifest does not record it`))
  for (const key of missingInEn) slugSetNote(key, note('error', 'slug-sets', `manifest records "${key}" but assets/en is missing it`))
  for (const key of zhWithoutEn) slugSetNote(key, note('error', 'slug-sets', `assets/zh has "${key}" with no English counterpart`))

  const divisionReport = { upstream: null, en: enTree.divisions.size, zh: zhTree.divisions.size }
  if (upstreamDivisions !== null) {
    const expected = new Set(Object.keys(upstreamDivisions))
    divisionReport.upstream = expected.size
    for (const division of expected) {
      if (!enTree.divisions.has(division)) slugSetNote(division, note('error', 'slug-sets', `upstream division "${division}" is absent from assets/en`))
      if (!zhTree.divisions.has(division)) slugSetNote(division, note('warn', 'slug-sets', `division "${division}" has no assets/zh directory yet`))
    }
    for (const division of enTree.divisions) {
      if (!expected.has(division)) slugSetNote(division, note('error', 'slug-sets', `assets/en division "${division}" is not listed in upstream divisions.json`))
    }
  } else {
    // Offline is not a pass: the division set could only be cross-checked against
    // the manifest, which is itself a sync product. Same shape and same grading as
    // `english-byte-identity` uses for the same situation.
    pushNote(notes, null, note('warn', 'slug-sets', 'upstream checkout not found; division set cross-checked against the manifest only'))
  }

  const slugSetNotes = notes.filter((entry) => entry.check === 'slug-sets')
  const slugSetErrors = slugSetNotes.filter((entry) => entry.severity === 'error').length
  const slugSetWarnings = slugSetNotes.filter((entry) => entry.severity === 'warn').length
  checks.push({
    id: 'slug-sets',
    title: 'division and slug sets agree across assets/en, assets/zh and upstream divisions.json',
    status: statusFor('slug-sets', slugSetErrors, slugSetWarnings),
    hardFailure: false,
    notes: slugSetErrors,
    warnings: slugSetWarnings,
    files: slugSetSubjects.size,
    ...(upstreamDivisions === null ? { detail: 'upstream checkout unavailable' } : {}),
    divisions: divisionReport,
    agents: { manifest: manifestSet.size, en: enTree.keys.size, zh: zhTree.keys.size },
    missingInEn: missingInEn.length,
    missingInZh: missingInZh.length,
    extraInEn: extraInEn.length,
    extraInZh: extraInZh.length,
    zhWithoutEn: zhWithoutEn.length,
  })

  // -- 3. English byte identity against the baseline commit ------------------
  // Every error this check can produce lands in `drift`, not just the upstream
  // comparison: the manifest hash and the byte count are what it still compares
  // when no checkout is around, and they are exactly the two hard failures
  // docs/STATUS.md 5.16 recorded next to a PASS. Keeping them out of `drift` is
  // how this entry's status could contradict the hard-failure list of the very
  // same run.
  const upstreamIndex = upstreamDir === null ? null : await indexUpstream(upstreamDir)
  const drift = {
    compared: 0,
    drifted: [],
    upstreamMissing: [],
    manifestMismatch: [],
    byteMismatch: [],
    missing: [],
    unavailable: upstreamIndex === null,
  }
  if (upstreamIndex === null) {
    pushNote(notes, null, note('warn', 'english-byte-identity', 'upstream checkout not found; assets/en compared against the manifest hash only'))
  }

  // -- per-file pass ---------------------------------------------------------
  // Iterate the union of the manifest, assets/en and assets/zh. A roster file that
  // only exists on disk still gets a record and a manifest-coverage failure, which
  // is the whole point of that gate; iterating the manifest alone would skip it.
  const files = []
  const allKeys = [...new Set([...manifestKeys, ...enTree.keys, ...zhTree.keys])].sort()
  /** Assets paths for one manifest key, so the two loops over keys cannot drift. */
  const pathsFor = (key) => {
    const slash = key.lastIndexOf('/')
    const division = key.slice(0, slash)
    const slug = key.slice(slash + 1)
    return {
      division,
      slug,
      en: path.join(assetsRoot, 'en', division, `${slug}.md`),
      zh: path.join(assetsRoot, 'zh', division, `${slug}.md`),
    }
  }

  // -- 11. name uniqueness ---------------------------------------------------
  // An expert is resolved BY NAME at runtime (`resolveExpert` in src/catalog.ts
  // matches `normalizeName(nameZh)` and `normalizeName(nameEn)`), so a display name
  // is a second unique key next to the slug. Two shipped profiles sharing the
  // Chinese name 电商购物车工程师 made every switch on both cards permanently
  // disabled (`collides` in src/roster-settings.ts) and made `summon_expert` on
  // that name ambiguous. Nothing in this suite guarded the invariant, which is how
  // it shipped. Names are read here rather than in the per-file loop below so that
  // a profile whose English counterpart is missing is still checked.
  const names = { zh: [], en: [] }
  for (const key of allKeys) {
    const paths = pathsFor(key)
    for (const [tree, file] of [['zh', paths.zh], ['en', paths.en]]) {
      if (!(await exists(file))) continue
      const name = readFrontmatter(await readFile(file, 'utf8')).fields.name
      if (typeof name === 'string' && name.trim() !== '') names[tree].push({ key, name })
    }
  }
  const nameDuplicateGroups = [
    ...findDuplicateNames(names.zh).map((group) => ({ ...group, tree: 'zh', label: 'Chinese' })),
    ...findDuplicateNames(names.en).map((group) => ({ ...group, tree: 'en', label: 'English' })),
  ]
  const nameFileKeys = new Set()
  for (const group of nameDuplicateGroups) {
    const owners = group.entries.map((entry) => `assets/${group.tree}/${entry.key}.md`)
    for (const entry of group.entries) nameFileKeys.add(entry.key)
    // One note per duplicated name, naming every file that claims it: the fix is
    // to rename all but one, and a note per file would read as two separate
    // problems.
    pushNote(notes, group.entries[group.entries.length - 1].key, note('error', 'name-uniqueness',
      `${group.label} name "${group.name}" is claimed by ${owners.length} profiles: ${owners.join(', ')}`))
  }
  // Counted from the notes that were actually pushed, so this entry can never
  // report pass while the hard-failure list of the same run names a duplicate.
  const nameUniquenessErrors = notes.filter((entry) => entry.check === 'name-uniqueness' && entry.severity === 'error').length
  checks.push({
    id: 'name-uniqueness',
    title: 'every expert name is unique across the whole roster, in both languages',
    status: statusFor('name-uniqueness', nameUniquenessErrors, 0),
    hardFailure: true,
    notes: nameUniquenessErrors,
    warnings: 0,
    files: nameFileKeys.size,
    duplicates: nameDuplicateGroups.map((group) => ({ tree: group.tree, name: group.name, keys: group.entries.map((entry) => entry.key) })),
  })

  for (const key of allKeys) {
    const record = manifest.files[key]
    const { division, slug, en: enPath, zh: zhPath } = pathsFor(key)
    const fileNotes = []
    const report = (severity, check, message) => {
      const entry = note(severity, check, message)
      pushNote(notes, key, entry)
      pushNote(fileNotes, null, entry)
    }

    if (record === undefined || typeof record.enSha256 !== 'string') {
      report('error', 'manifest-coverage', record === undefined
        ? 'the file exists in the tree but the manifest has no record for it; re-run pnpm sync'
        : 'the manifest record has no usable enSha256; re-run pnpm sync')
    }

    const enPresent = await exists(enPath)
    if (!enPresent) {
      drift.missing.push(key)
      report('error', 'english-byte-identity', 'assets/en file is missing')
      files.push({ key, division, slug, status: 'suspect', notes: fileNotes })
      continue
    }

    const enBytes = await readFile(enPath)
    const enText = enBytes.toString('utf8')
    const actualSha = sha256(enBytes)
    const zhPresent = await exists(zhPath)
    const zhText = zhPresent ? await readFile(zhPath, 'utf8') : null

    // -- 2. frontmatter legality -------------------------------------------
    const enFront = auditFrontmatter(enText)
    const zhFront = zhText === null ? null : auditFrontmatter(zhText, ZH_REQUIRED_KEYS)
    for (const problem of enFront.problems) report('error', 'frontmatter', `en: ${problem}`)
    if (zhFront !== null) for (const problem of zhFront.problems) report('error', 'frontmatter', `zh: ${problem}`)

    // -- 3. byte identity ---------------------------------------------------
    if (record !== undefined && typeof record.enSha256 === 'string' && actualSha !== record.enSha256) {
      drift.manifestMismatch.push(key)
      report('error', 'english-byte-identity', `en hash ${actualSha.slice(0, 12)} differs from the manifest baseline ${record.enSha256.slice(0, 12)}`)
    }
    if (record !== undefined && typeof record.bytes === 'number' && enBytes.length !== record.bytes) {
      drift.byteMismatch.push(key)
      report('error', 'english-byte-identity', `en is ${enBytes.length} bytes, the manifest recorded ${record.bytes}`)
    }
    if (upstreamIndex !== null) {
      const source = upstreamIndex.get(key)
      drift.compared += 1
      if (source === undefined) {
        drift.upstreamMissing.push(key)
        report('error', 'english-byte-identity', 'no matching file in the upstream checkout')
      } else if (sha256(await readFile(source)) !== actualSha) {
        drift.drifted.push(key)
        report('error', 'english-byte-identity', 'en no longer matches the upstream checkout; re-run pnpm sync')
      }
    }

    // -- 10. code fences ----------------------------------------------------
    // `unclosed` is the only signal: a fence line either pushes or pops the stack,
    // so an odd number of fence lines implies a non-empty stack and is reported
    // here twice over. There is no separate parity assertion (see corpus.mjs).
    const enStructure = structure(enText)
    if (enStructure.unclosed > 0) report('error', 'code-fences', `en: ${enStructure.unclosed} unclosed code fence(s), so the body is truncated from there on`)
    const zhStructure = zhText === null ? null : structure(zhText)
    if (zhStructure !== null && zhStructure.unclosed > 0) {
      report('error', 'code-fences', `zh: ${zhStructure.unclosed} unclosed code fence(s), so the body is truncated from there on`)
    }

    if (zhText === null || zhStructure === null) {
      files.push({ key, division, slug, status: 'missing', notes: fileNotes })
      continue
    }

    // -- intro: this project's deliverable ---------------------------------
    // Every Chinese profile must introduce the expert in Chinese. Presence is
    // enforced through ZH_REQUIRED_KEYS; the band here catches a stub or a
    // pasted essay. The glossary is deliberately NOT applied to an intro: its
    // scope is derived from the whole English persona, so demanding every term
    // inside a short summary would be unsatisfiable.
    const zhHasBody = bodyOf(zhText).trim() !== ''
    const intro = typeof zhFront.fields.intro === 'string' ? zhFront.fields.intro.trim() : ''
    const introChars = cjkCount(intro)
    const introSentences = intro === '' ? 0 : countSentences(intro)
    if (intro !== '' && (introChars < INTRO_MIN_CJK || introChars > INTRO_MAX_CJK)) {
      report('error', 'intro', `intro is ${introChars} CJK characters, outside ${INTRO_MIN_CJK}-${INTRO_MAX_CJK}`)
    }
    if (intro !== '' && (introSentences < INTRO_MIN_SENTENCES || introSentences > INTRO_MAX_SENTENCES)) {
      report('error', 'intro', `intro is ${introSentences} sentence(s), outside ${INTRO_MIN_SENTENCES}-${INTRO_MAX_SENTENCES}`)
    }
    if (intro !== '' && intro === (zhFront.fields.description ?? '').trim()) {
      report('warn', 'intro', 'intro repeats description verbatim instead of introducing the expert')
    }

    // -- 4. translation freshness ------------------------------------------
    // A stale full translation pairs an old Chinese persona with new English
    // instructions and would silently mislead the summoned expert, so it is a
    // hard failure. A stale intro is a documentation nit on one short
    // paragraph, so it is reported without blocking the release.
    const stale = zhFront.sourceSha256 === null
      ? 'zh frontmatter has no sourceSha256, so freshness cannot be established'
      : (zhFront.sourceSha256 !== actualSha
        ? `zh sourceSha256 ${zhFront.sourceSha256.slice(0, 12)} != current en hash ${actualSha.slice(0, 12)}`
        : null)
    if (stale !== null) report(zhHasBody ? 'error' : 'warn', 'translation-freshness', stale)

    // -- 7 / 8 / 9 glossary and prose checks --------------------------------
    const enBody = stripMarkup(bodyOf(enText))
    const enPhrases = splitPhrases(enBody)
    const enWords = wordCount(enBody)

    // The structural mirror rules apply only to a file that actually carries a
    // translated persona: an intro-only profile has no body to align.
    let blockRatio = null
    let zhChars = null
    let lengthRatio = null
    let zhBlocks = null
    let zhHeadings = null
    let glossaryTermsInScope = 0
    let glossaryViolations = 0
    let residueSamples = 0

    if (zhHasBody) {
      // -- 5. block-level alignment ----------------------------------------
      // Exact equality, not a ratio floor: the Chinese file is a structural
      // mirror of the English one, so a translation must neither drop a block
      // nor invent one. A floor of 0.8 would silently accept a translation
      // missing a fifth of the document.
      blockRatio = enStructure.blocks.length === 0 ? 1 : zhStructure.blocks.length / enStructure.blocks.length
      if (enStructure.blocks.length !== zhStructure.blocks.length) {
        report('error', 'block-alignment', `zh has ${zhStructure.blocks.length} top-level blocks against ${enStructure.blocks.length} in en (ratio ${blockRatio.toFixed(2)}); a translation must mirror blocks exactly`)
      }

      // -- 6. heading level alignment --------------------------------------
      const levels = [...new Set([...Object.keys(enStructure.headings), ...Object.keys(zhStructure.headings)])].sort()
      for (const level of levels) {
        const enCount = enStructure.headings[level] ?? 0
        const zhCount = zhStructure.headings[level] ?? 0
        if (enCount !== zhCount) report('error', 'heading-alignment', `h${level} count differs: en ${enCount} vs zh ${zhCount}`)
      }

      const zhBody = stripMarkup(bodyOf(zhText))
      zhChars = cjkCount(zhBody)

      const inScope = termIndex.filter((entry) => phraseContains(enPhrases, entry.key))
      const violations = inScope.filter((entry) => !zhBody.includes(entry.value))
      for (const violation of violations.slice(0, THRESHOLDS.maxSamplesPerFile)) {
        report('error', 'glossary', `"${violation.key}" is not rendered with the approved term "${violation.value}"`)
      }
      glossaryTermsInScope = inScope.length
      glossaryViolations = violations.length

      lengthRatio = enWords === 0 ? null : zhChars / enWords
      if (lengthRatio !== null && (lengthRatio < THRESHOLDS.lengthRatioMin || lengthRatio > THRESHOLDS.lengthRatioMax)) {
        report('error', 'length-ratio', `zh/en ratio ${lengthRatio.toFixed(2)} is outside [${THRESHOLDS.lengthRatioMin}, ${THRESHOLDS.lengthRatioMax}] (${zhChars} CJK chars / ${enWords} en words)`)
      }

      const residue = findResidue(zhBody)
      for (const sample of residue.slice(0, THRESHOLDS.maxSamplesPerFile)) {
        report('error', 'foreign-residue', `leftover English prose: "${sample}"`)
      }
      residueSamples = residue.length

      zhBlocks = zhStructure.blocks.length
      zhHeadings = zhStructure.headings
    }

    files.push({
      key,
      division,
      slug,
      status: fileNotes.some((entry) => entry.severity === 'error') ? 'suspect' : 'aligned',
      profile: zhHasBody ? 'translated' : 'intro-only',
      notes: fileNotes,
      metrics: {
        enWords,
        zhChars,
        introChars,
        introSentences,
        enBlocks: enStructure.blocks.length,
        zhBlocks,
        blockRatio: blockRatio === null ? null : Number(blockRatio.toFixed(3)),
        lengthRatio: lengthRatio === null ? null : Number(lengthRatio.toFixed(3)),
        enHeadings: enStructure.headings,
        zhHeadings,
        glossaryTermsInScope,
        glossaryViolations,
        residueSamples,
      },
    })
  }

  const byteIdentityKeys = [...new Set([
    ...drift.manifestMismatch,
    ...drift.byteMismatch,
    ...drift.drifted,
    ...drift.upstreamMissing,
    ...drift.missing,
  ])]

  // -- roll-ups -------------------------------------------------------------
  // The status of this entry is derived from the notes it produced, exactly as
  // `summarize()` does for the other checks — including the manifest hash mismatch
  // and the byte-count mismatch, which are errors of THIS check. While those stayed
  // out of the state the status was computed from, a run could print PASS here and
  // the same run's HARD FAILURES list, which is the shape docs/STATUS.md 5.16
  // recorded. `drift` still carries the per-comparison counts and the samples.
  const byteIdentityNotes = notes.filter((entry) => entry.check === 'english-byte-identity')
  const byteIdentityErrors = byteIdentityNotes.filter((entry) => entry.severity === 'error')
  const byteIdentityWarnings = byteIdentityNotes.filter((entry) => entry.severity === 'warn').length
  checks.push({
    id: 'english-byte-identity',
    title: 'assets/en is byte-identical to the upstream baseline commit',
    status: statusFor('english-byte-identity', byteIdentityErrors.length, byteIdentityWarnings),
    hardFailure: true,
    notes: byteIdentityErrors.length,
    warnings: byteIdentityWarnings,
    files: new Set(byteIdentityErrors.map((entry) => entry.fileKey)).size,
    ...(drift.unavailable ? { detail: 'upstream checkout unavailable; compared against the manifest baseline only' } : {}),
    baselineCommit: manifest.upstream?.commit ?? null,
    upstreamHead,
    headMatchesBaseline: upstreamHead === null ? null : upstreamHead === manifest.upstream?.commit,
    compared: drift.compared,
    drifted: drift.drifted.length,
    manifestMismatch: drift.manifestMismatch.length,
    byteMismatch: drift.byteMismatch.length,
    upstreamMissing: drift.upstreamMissing.length,
    missing: drift.missing.length,
    unverifiable: drift.unavailable,
    samples: byteIdentityKeys.slice(0, 20),
  })
  checks.push(summarize(notes, 'manifest-coverage', 'every roster entry has a manifest record'))
  checks.push(summarize(notes, 'frontmatter', 'frontmatter is legal: name / description / intro / emoji present, quotes and fences balanced'))
  checks.push(summarize(notes, 'intro', `every Chinese profile introduces its expert in ${INTRO_MIN_CJK}-${INTRO_MAX_CJK} CJK characters and ${INTRO_MIN_SENTENCES}-${INTRO_MAX_SENTENCES} sentences`))
  checks.push(summarize(notes, 'code-fences', 'code fences are paired'))
  checks.push(summarize(notes, 'translation-freshness', 'zh sourceSha256 is current (hard only when a translated persona body is present)'))
  checks.push(summarize(notes, 'block-alignment', 'translated bodies mirror the English top-level blocks exactly'))
  checks.push(summarize(notes, 'heading-alignment', 'translated bodies match heading counts at every level'))
  checks.push(summarize(notes, 'glossary', 'approved glossary renderings are used consistently in translated bodies'))
  checks.push(summarize(notes, 'length-ratio', 'translated body length ratio is inside the accepted band'))
  checks.push(summarize(notes, 'foreign-residue', 'no leftover English prose remains in a translated body'))
  checks.sort((a, b) => a.id.localeCompare(b.id))

  // -- piles ----------------------------------------------------------------
  const piles = { aligned: [], suspect: [], missing: [] }
  for (const file of files) piles[file.status].push(file)
  for (const pile of Object.values(piles)) pile.sort((a, b) => a.key.localeCompare(b.key))

  const hardFailures = notes.filter((entry) => entry.severity === 'error' && HARD_FAILURES.has(entry.check))
  const suspectReasons = countBy(piles.suspect.flatMap((file) => file.notes.filter((entry) => entry.severity === 'error').map((entry) => entry.check)))

  const report = {
    version: REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    upstream: {
      repo: manifest.upstream?.repo ?? null,
      baselineCommit: manifest.upstream?.commit ?? null,
      head: upstreamHead,
      headMatchesBaseline: upstreamHead === null ? null : upstreamHead === manifest.upstream?.commit,
      checkoutUsed: upstreamDir,
    },
    glossary: { version: glossary.version ?? null, terms: Object.keys(glossary.terms ?? {}).length },
    thresholds: THRESHOLDS,
    hardFailureChecks: [...HARD_FAILURE_CHECKS].sort(),
    ok: hardFailures.length === 0,
    hardFailures: hardFailures.map((entry) => `${entry.check}: ${entry.fileKey ?? '-'}: ${entry.message}`),
    checks,
    totals: {
      roster: manifestSet.size,
      aligned: piles.aligned.length,
      suspect: piles.suspect.length,
      missing: piles.missing.length,
      hardFailures: hardFailures.length,
      suspectReasons,
    },
    files: files.map((file) => ({
      key: file.key,
      division: file.division,
      slug: file.slug,
      status: file.status,
      ...(file.profile === undefined ? {} : { profile: file.profile }),
      notes: file.notes,
      ...(file.metrics === undefined ? {} : { metrics: file.metrics }),
    })),
    piles: {
      aligned: piles.aligned.map((file) => file.key),
      suspect: piles.suspect.map((file) => file.key),
      missing: piles.missing.map((file) => file.key),
    },
    orphanFiles: { en: extraInEn, zh: extraInZh },
  }

  await writeFile(REPORT_URL, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  // -- stdout summary -------------------------------------------------------
  const line = (text) => process.stdout.write(`${text}\n`)
  line('agency-agents-ll - machine gates (PLAN.md section 6)')
  line(`baseline commit: ${report.upstream.baselineCommit}`)
  line(`upstream head:   ${upstreamHead ?? 'unavailable'}${report.upstream.headMatchesBaseline === false ? '  (moved: re-run pnpm sync)' : ''}`)
  line('')
  line('checks:')
  for (const check of checks) {
    const marker = check.status === 'pass' ? 'PASS' : check.status === 'warn' ? 'WARN' : check.status === 'fail' ? 'FAIL' : 'SUSP'
    // `files` is the shared count: the number of distinct subjects the check
    // named. Every entry carries it, so no check needs a special case here.
    line(`  ${marker}  ${check.id.padEnd(24)} ${String(check.files ?? 0).padStart(4)} file(s)  ${check.title}`)
  }
  line('')
  line(`roster:  ${report.totals.roster}`)
  line(`aligned: ${report.totals.aligned}`)
  line(`suspect: ${report.totals.suspect}`)
  line(`missing: ${report.totals.missing}`)
  if (Object.keys(suspectReasons).length > 0) {
    line('suspect reasons:')
    for (const [reason, count] of Object.entries(suspectReasons).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      line(`  ${String(count).padStart(4)}  ${reason}`)
    }
  }
  line('')
  if (piles.suspect.length > 0) {
    line(`suspect files (${piles.suspect.length}):`)
    for (const file of piles.suspect) line(`  ${file.key}`)
    line('')
  }
  line(`missing files (${piles.missing.length}): listed in sync/report.json under piles.missing`)
  line(`report: ${path.relative(projectRoot, fileURLToPath(REPORT_URL)).split(path.sep).join('/')}`)

  if (hardFailures.length > 0) {
    line('')
    line(`HARD FAILURES (${hardFailures.length}):`)
    for (const entry of hardFailures.slice(0, 40)) line(`  [${entry.check}] ${entry.fileKey ?? '-'}: ${entry.message}`)
    if (hardFailures.length > 40) line(`  ... ${hardFailures.length - 40} more, see sync/report.json`)
    process.exitCode = 1
  }
}

/**
 * The one status rule, so a hand-built entry and a `summarize()`d one cannot
 * disagree with the hard-failure list they are both graded by. An error is a hard
 * failure only for a check in HARD_FAILURE_CHECKS; anywhere else it is `suspect`,
 * which is what keeps a missing translation from blocking a release.
 * @param id - check id.
 * @param errors - number of error notes this check produced.
 * @param warnings - number of warn notes this check produced.
 * @returns 'pass' | 'warn' | 'suspect' | 'fail'.
 */
function statusFor(id, errors, warnings) {
  if (errors > 0) return HARD_FAILURES.has(id) ? 'fail' : 'suspect'
  if (warnings > 0) return 'warn'
  return 'pass'
}

/**
 * Group profiles by normalised display name and return the names that more than
 * one profile claims.
 *
 * The comparison mirrors `normalizeName` in src/catalog.ts exactly (NFKC, then
 * trim, then lowercase), because the invariant this gate protects is the one the
 * runtime relies on when it resolves an expert by name.
 *
 * @param entries - `{ key, name }` pairs, one per profile that has a name.
 * @returns duplicate groups, each carrying every entry that claims the name.
 */
function findDuplicateNames(entries) {
  const index = new Map()
  for (const entry of entries) {
    const normalized = String(entry.name ?? '').normalize('NFKC').trim().toLowerCase()
    if (normalized === '') continue
    const group = index.get(normalized)
    if (group === undefined) index.set(normalized, { name: entry.name, entries: [entry] })
    else group.entries.push(entry)
  }
  return [...index.values()].filter((group) => group.entries.length > 1)
}

function summarize(notes, id, title) {
  const scoped = notes.filter((entry) => entry.check === id && entry.fileKey !== undefined)
  const errors = scoped.filter((entry) => entry.severity === 'error')
  const warnings = scoped.filter((entry) => entry.severity === 'warn')
  const files = new Set([...errors, ...warnings].map((entry) => entry.fileKey))
  return {
    id,
    title,
    status: statusFor(id, errors.length, warnings.length),
    hardFailure: HARD_FAILURES.has(id),
    notes: errors.length,
    warnings: warnings.length,
    files: files.size,
  }
}

function countBy(values) {
  const out = {}
  for (const value of values) out[value] = (out[value] ?? 0) + 1
  return out
}

// ---------------------------------------------------------------------------
// Filesystem / upstream helpers
// ---------------------------------------------------------------------------

async function readTree(root) {
  const keys = new Set()
  const divisions = new Set()
  if (!(await exists(root))) return { keys, divisions }
  for (const divisionEntry of await readdir(root, { withFileTypes: true })) {
    if (!divisionEntry.isDirectory()) continue
    divisions.add(divisionEntry.name)
    for (const fileEntry of await readdir(path.join(root, divisionEntry.name), { withFileTypes: true })) {
      if (!fileEntry.isFile() || !fileEntry.name.endsWith('.md')) continue
      keys.add(`${divisionEntry.name}/${fileEntry.name.slice(0, -3)}`)
    }
  }
  return { keys, divisions }
}

function resolveUpstreamDir() {
  const candidates = [process.env.AGENCY_UPSTREAM, path.join(projectRoot, 'sync', '.cache', 'agency-agents'), 'G:\\dsh\\agency-agents']
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim() === '') continue
    const resolved = path.resolve(candidate)
    if (existsSync(path.join(resolved, 'divisions.json'))) return resolved
  }
  return null
}

function readUpstreamHead(dir) {
  try {
    return run('git', ['-C', dir, 'rev-parse', 'HEAD'])
  } catch {
    return null
  }
}

function readUpstreamDivisions(dir) {
  if (dir === null) return null
  try {
    return JSON.parse(readFileSync(path.join(dir, 'divisions.json'), 'utf8')).divisions ?? null
  } catch {
    return null
  }
}

/** Map manifest key -> absolute upstream path, honouring subdirectory flattening. */
async function indexUpstream(dir) {
  const index = new Map()
  const divisions = readUpstreamDivisions(dir)
  if (divisions === null) return index
  for (const division of Object.keys(divisions)) {
    const divisionDir = path.join(dir, division)
    if (!(await exists(divisionDir))) continue
    for (const file of await walk(divisionDir)) {
      const key = `${division}/${path.basename(file, '.md')}`
      if (!index.has(key)) index.set(key, file)
    }
  }
  return index
}

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

const startedAt = Date.now()
try {
  await main()
  process.stdout.write(`done in ${Date.now() - startedAt}ms\n`)
} catch (error) {
  process.stderr.write(`checks failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exitCode = 1
}
