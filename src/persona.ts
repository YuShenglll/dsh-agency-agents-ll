/**
 * Persona text loading.
 *
 * The English tree is the fallback of record: a missing or empty Chinese
 * persona serves the English one and says so, rather than failing the summon.
 */
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { parseFrontmatter, type AssetRoots } from './catalog.js'
import { formatHost, type LocaleId } from './i18n.js'

/** One loaded persona, with the language actually served. */
export interface LoadedPersona {
  /** The persona body handed to the subagent. */
  readonly prompt: string
  /** Language actually served; differs from the request when a fallback ran. */
  readonly locale: LocaleId
  /** Whether the requested language was unavailable and English was served. */
  readonly fallback: boolean
}

/**
 * Neutralize strict `{{...}}` interpolation inside persona prose.
 *
 * System-prompt assembly interpolates every `{{name}}` group, so persona text
 * containing one would throw. A zero-width space between the braces keeps the
 * rendering identical while hiding the group from the interpolator.
 *
 * @param text - raw persona body.
 * @returns the body safe to place in a system-prompt section.
 */
export function sanitizePersona(text: string): string {
  return text.replace(/\{(?=\{)/g, '{\u200b')
}

/** What one persona file turned out to hold. */
type BodyOutcome =
  | { readonly kind: 'body'; readonly body: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid' }

/**
 * Read one persona body, keeping "there is no such file" apart from "the file
 * is there but carries no usable body". The two have different meanings to a
 * reader: an absent archive is the ordinary intro-only case, while a malformed
 * one is a content fault worth reporting.
 *
 * @param file - absolute path of the persona file.
 * @returns the body, or why there is none.
 */
async function readBody(file: string): Promise<BodyOutcome> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    // Covers both "does not exist" and "cannot be read"; neither is a content fault.
    return { kind: 'missing' }
  }
  const parsed = parseFrontmatter(raw)
  if (parsed === undefined) return { kind: 'invalid' }
  const body = parsed.body.trim()
  return body === '' ? { kind: 'invalid' } : { kind: 'body', body }
}

/**
 * Resolve one persona file inside its asset tree.
 *
 * The Host tools pass a division and a slug taken from the roster itself, but
 * the Remote endpoint receives both off the wire, so the pair is checked
 * before it reaches the file system: a crafted slug must not read a `.md`
 * anywhere outside the tree.
 *
 * @param root - the asset tree the file must live under.
 * @param division - division directory as received.
 * @param slug - expert slug as received.
 * @returns the absolute file path, or `undefined` when the pair escapes `root`.
 */
function personaFile(root: string, division: string, slug: string): string | undefined {
  const base = resolve(root)
  const file = resolve(base, division, `${slug}.md`)
  return file.startsWith(base + sep) ? file : undefined
}

/**
 * Load one persona body in the requested language.
 *
 * @param roots - the two asset trees.
 * @param division - division directory the expert belongs to.
 * @param slug - expert file name without `.md`.
 * @param locale - requested language.
 * @returns the persona, the language served, and whether a fallback ran.
 * @throws when neither tree holds a usable persona for the slug.
 */
export async function loadPersona(
  roots: AssetRoots,
  division: string,
  slug: string,
  locale: LocaleId,
): Promise<LoadedPersona> {
  const zhFile = personaFile(roots.zh, division, slug)
  const enFile = personaFile(roots.en, division, slug)
  // A pair that escapes either tree names no roster entry at all, so it is
  // reported exactly like one: the caller learns nothing about the disk layout.
  if (zhFile === undefined || enFile === undefined) {
    throw new Error(formatHost(locale, 'error.personaMissing', { division, slug }))
  }
  if (locale === 'zh') {
    const zh = await readBody(zhFile)
    if (zh.kind === 'body') return { prompt: zh.body, locale: 'zh', fallback: false }
  }
  const en = await readBody(enFile)
  if (en.kind === 'body') return { prompt: en.body, locale: 'en', fallback: locale !== 'en' }
  if (en.kind === 'invalid') {
    throw new Error(formatHost(locale, 'error.personaInvalid', { division, slug }))
  }
  throw new Error(formatHost(locale, 'error.personaMissing', { division, slug }))
}
