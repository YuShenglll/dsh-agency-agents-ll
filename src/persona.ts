/**
 * Persona text loading.
 *
 * The English tree is the fallback of record: a missing or empty Chinese
 * persona serves the English one and says so, rather than failing the summon.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
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

async function readBody(file: string): Promise<string | undefined> {
  try {
    const parsed = parseFrontmatter(await readFile(file, 'utf8'))
    if (parsed === undefined) return undefined
    const body = parsed.body.trim()
    return body === '' ? undefined : body
  } catch {
    return undefined
  }
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
  if (locale === 'zh') {
    const zh = await readBody(join(roots.zh, division, `${slug}.md`))
    if (zh !== undefined) return { prompt: zh, locale: 'zh', fallback: false }
  }
  const en = await readBody(join(roots.en, division, `${slug}.md`))
  if (en === undefined) {
    throw new Error(formatHost(locale, 'error.personaMissing', { division, slug }))
  }
  return { prompt: en, locale: 'en', fallback: locale !== 'en' }
}
