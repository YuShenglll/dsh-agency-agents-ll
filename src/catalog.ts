/**
 * Roster catalog.
 *
 * The English tree defines the roster: whatever upstream ships is what exists.
 * The Chinese tree only supplies display metadata and persona text, so a
 * missing or stale translation degrades one expert rather than changing the
 * roster.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { formatHost, type LocaleId } from './i18n.js'

/** One roster entry, merged from the English and Chinese trees. */
export interface Expert {
  /** File name without `.md`; stable identifier across both trees. */
  readonly slug: string
  /** Division directory the expert belongs to. */
  readonly division: string
  readonly emoji: string
  /** Chinese display name; empty when no Chinese profile exists yet. */
  readonly nameZh: string
  /** English display name, from the English tree. */
  readonly nameEn: string
  /** Chinese one-line description; empty when no Chinese profile exists yet. */
  readonly descriptionZh: string
  /** English one-line description. */
  readonly descriptionEn: string
  /**
   * Chinese introduction of the expert: what the role is, what it is good at,
   * and when to call it. This is what the roster shows in Chinese; empty when
   * no Chinese profile exists yet.
   */
  readonly introZh: string
  /** Whether a Chinese persona body exists, so the prompt can switch to it. */
  readonly translated: boolean
}

/** The two asset trees this plugin reads. */
export interface AssetRoots {
  /** Directory holding the `assets/en` tree. */
  readonly en: string
  /** Directory holding the `assets/zh` tree. */
  readonly zh: string
}

/** Frontmatter fields this plugin reads; every field is optional on parse. */
export interface Frontmatter {
  readonly name?: string
  readonly description?: string
  /** Chinese introduction of the expert; present only in the Chinese tree. */
  readonly intro?: string
  readonly emoji?: string
  /** sha256 of the English source this Chinese file was written from. */
  readonly sourceSha256?: string
  /** Everything after the closing `---`, trimmed. Empty for an intro-only profile. */
  readonly body: string
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/

/**
 * Strip a UTF-8 BOM so the leading `---` fence is recognized.
 * @param text - raw file text.
 * @returns the text without a leading BOM.
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * Split one persona file into frontmatter fields and body.
 * @param raw - raw file contents.
 * @returns the parsed file, or `undefined` when the frontmatter fence is absent.
 */
export function parseFrontmatter(raw: string): Frontmatter | undefined {
  const match = FRONTMATTER_PATTERN.exec(stripBom(raw))
  if (match === null) return undefined
  const block = match[1] ?? ''
  const body = (match[2] ?? '').trim()
  const get = (key: string): string | undefined => {
    // Tolerate a quoted key ("name": "x"); the sync gate accepts the same form.
    const found = new RegExp(`^"?${key}"?\\s*:\\s*(.*)$`, 'm').exec(block)
    if (found === null) return undefined
    let value = (found[1] ?? '').trim()
    const first = value.charAt(0)
    if (value.length >= 2 && (first === '"' || first === "'") && value.endsWith(first)) {
      value = value.slice(1, -1)
    }
    return value
  }
  return {
    name: get('name'),
    description: get('description'),
    intro: get('intro'),
    emoji: get('emoji'),
    sourceSha256: get('sourceSha256'),
    body,
  }
}

async function readFrontmatter(file: string): Promise<Frontmatter | undefined> {
  try {
    return parseFrontmatter(await readFile(file, 'utf8'))
  } catch {
    return undefined
  }
}

async function listMarkdown(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name.slice(0, -3))
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Build the roster index from both asset trees.
 *
 * The English tree is authoritative: a slug present only in the Chinese tree is
 * not part of the roster and is dropped, because the roster is defined entirely
 * by what upstream ships.
 *
 * @param roots - the two asset trees.
 * @param divisions - division directory names to walk.
 * @returns experts keyed by slug, plus the divisions that actually held files.
 */
export async function loadCatalog(
  roots: AssetRoots,
  divisions: readonly string[],
): Promise<{ experts: Map<string, Expert>; divisions: string[] }> {
  const experts = new Map<string, Expert>()
  const present: string[] = []
  for (const division of divisions) {
    const enDir = join(roots.en, division)
    if (!(await isDirectory(enDir))) continue
    const slugs = await listMarkdown(enDir)
    if (slugs.length > 0) present.push(division)
    for (const slug of slugs) {
      const en = await readFrontmatter(join(enDir, `${slug}.md`))
      if (en?.name === undefined || en.description === undefined) continue
      const zh = await readFrontmatter(join(roots.zh, division, `${slug}.md`))
      experts.set(slug, {
        slug,
        division,
        emoji: en.emoji ?? '',
        nameEn: en.name,
        descriptionEn: en.description,
        nameZh: zh?.name ?? '',
        descriptionZh: zh?.description ?? '',
        introZh: zh?.intro ?? '',
        translated: zh !== undefined && zh.body.trim() !== '',
      })
    }
  }
  return { experts, divisions: present }
}

/**
 * Normalize a name for comparison, folding width and case so a query matches
 * regardless of which side it came from.
 * @param value - raw name or query.
 * @returns the comparison key.
 */
export function normalizeName(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase()
}

/**
 * Resolve one expert by name, accepting either the Chinese or the English name.
 * @param experts - roster entries to search.
 * @param query - Chinese name, English name, or an unambiguous fragment.
 * @param locale - language for error text.
 * @returns the single matching expert.
 * @throws when the query is empty, matches nothing, or matches several experts.
 */
export function resolveExpert(
  experts: Iterable<Expert>,
  query: unknown,
  locale: LocaleId,
): Expert {
  const list = [...experts]
  const q = normalizeName(query)
  if (q.length === 0) throw new Error(formatHost(locale, 'error.expertRequired'))
  const exact = list.filter((expert) => normalizeName(expert.nameZh) === q || normalizeName(expert.nameEn) === q)
  if (exact.length === 1) return exact[0] as Expert
  const pool = exact.length > 1 ? exact : list.filter((expert) =>
    normalizeName(expert.nameZh).includes(q) || normalizeName(expert.nameEn).includes(q))
  if (pool.length === 1) return pool[0] as Expert
  if (pool.length > 1) {
    const candidates = [...new Set(pool.map((expert) => expert.nameZh !== '' ? `${expert.nameZh} (${expert.nameEn})` : expert.nameEn))]
      .slice(0, 12)
      .join(', ')
    throw new Error(formatHost(locale, 'error.expertAmbiguous', { query: String(query), candidates }))
  }
  throw new Error(formatHost(locale, 'error.expertMissing', { query: String(query) }))
}
