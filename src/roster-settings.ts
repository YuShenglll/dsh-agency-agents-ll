/**
 * Roster state: which experts are enabled, and the experts the user authored.
 *
 * The roster itself is read-only content shipped with the package; the only
 * mutable state lives in the `agency-agents-ll` settings section. Every write
 * carries the settings revision the caller read, so a second window editing
 * the same document is refused instead of silently overwritten.
 */
import { randomUUID } from 'node:crypto'
import type { Expert } from './catalog.js'
import {
  CUSTOM_EXPERT_LIMIT,
  CUSTOM_EXPERT_SLUG,
  customError,
  customExpertInputSchema,
  customExpertSchema,
  normalizeExpertName,
  type CatalogSnapshot,
  type CustomExpert,
  type CustomExpertInput,
  type EnabledState,
  type ExpertSummary,
} from './expert-contract.js'

/** Cordis service key under which the roster library is provided. */
export const AGENCY_LIBRARY_SERVICE = 'agencyAgentsLibrary'

/** Cordis service key under which the persona reader is provided. */
export const AGENCY_PERSONA_SERVICE = 'agencyAgentsPersona'

/** Persona language a caller asks for; always concrete by this point. */
export type PersonaLocale = 'zh' | 'en'

/** Host-side persona reader, shared by the summon tools and the Remote service. */
export interface AgencyPersonaSource {
  /**
   * Read one persona body.
   * @param slug - expert slug.
   * @param division - division directory the expert belongs to.
   * @param locale - language to serve.
   * @returns the body plus the language actually served.
   */
  getPrompt(slug: string, division: string, locale: PersonaLocale): Promise<{ prompt: string; locale: PersonaLocale; fallback: boolean }>
}

/** The mutable half of the settings section. */
export interface RosterSettingsState {
  /** Enabled expert slugs. */
  readonly enabled: readonly string[]
  /** Stored custom experts, including any whose slug the user retired. */
  readonly customExperts: readonly unknown[]
}

/**
 * Persistence seam over one settings namespace. Kept narrow so the roster
 * logic is testable without a Cordis application.
 */
export interface RosterSettingsStore {
  /** Current resolved section. */
  read(): RosterSettingsState
  /** Current raw-section revision, used as the write fence. */
  revision(): number
  /**
   * Apply ordered path edits, refusing a stale revision.
   * @param ops - settings path operations.
   * @param expectedRevision - revision the caller read.
   */
  mutate(ops: readonly { op: 'set'; path: readonly string[]; value: unknown }[], expectedRevision: number): Promise<void>
}

/** Roster operations the Host exposes to its Remote service and tools. */
export interface RosterLibrary {
  /** Roster snapshot: every entry, the enabled slugs, the revision and the preference. */
  catalog(): Promise<CatalogSnapshot>
  /** Enabled-slug read-back. */
  enabledState(): EnabledState
  /**
   * One stored custom expert, without its slug.
   * @param slug - expert slug.
   * @returns the stored expert, or `undefined` when the slug is not user-owned.
   *   A slug that *is* user-shaped but absent would otherwise be read as a
   *   shipped expert and returned as an English tarball entry — and indeed the
   *   caller needs to tell those apart, so an absent custom slug resolves as
   *   `undefined` and the caller reports the miss.
   */
  getCustom(slug: string): CustomExpert | undefined
  /** Create or update one custom expert and set its enabled state. */
  saveCustom(input: CustomExpertInput, enabled: boolean, expectedRevision: number): Promise<CatalogSnapshot>
  /** Delete one custom expert. */
  deleteCustom(slug: string, expectedRevision: number): Promise<CatalogSnapshot>
  /** Replace the enabled slug list wholesale. */
  setEnabled(enabled: readonly string[], expectedRevision: number): Promise<EnabledState>
}

/**
 * Project the merged roster entry onto the wire summary the browser renders.
 * @param expert - merged roster entry.
 * @returns the browser-facing summary.
 */
export function toExpertSummary(expert: Expert): ExpertSummary {
  return {
    slug: expert.slug,
    division: expert.division,
    emoji: expert.emoji,
    name: expert.nameZh !== '' ? expert.nameZh : expert.nameEn,
    nameEn: expert.nameEn,
    description: expert.descriptionZh !== '' ? expert.descriptionZh : expert.descriptionEn,
    descriptionEn: expert.descriptionEn,
    intro: expert.introZh,
    translated: expert.translated,
    custom: false,
    conflict: false,
  }
}

/** Project one stored custom expert onto the same summary shape. */
function customSummary(expert: CustomExpert): ExpertSummary {
  return {
    slug: expert.slug,
    division: expert.division,
    emoji: expert.emoji,
    name: expert.name,
    nameEn: expert.name,
    description: expert.description,
    descriptionEn: expert.description,
    intro: expert.intro,
    translated: true,
    custom: true,
    conflict: false,
  }
}

/**
 * Whether two entries collide. A collision is not fatal — the roster still
 * shows every expert — but an ambiguous name cannot be enabled, because
 * `resolve_expert` would have to guess.
 * @param left - one entry.
 * @param right - the other entry.
 * @returns whether they share a slug or a name.
 */
function collides(left: ExpertSummary, right: ExpertSummary): boolean {
  if (left.slug === right.slug) return true
  return [left.name, left.nameEn].some((name) => [right.name, right.nameEn].some((other) => normalizeExpertName(name) === normalizeExpertName(other)))
}

/**
 * Build the roster library over a settings store.
 *
 * @param base - read-only roster entries shipped with the package.
 * @param store - persistence seam over the owned settings namespace.
 * @param promptLocale - current persona language preference.
 * @param locale - language for failure messages.
 * @returns the roster library.
 */
export function createRosterLibrary(
  base: () => Promise<readonly Expert[]>,
  store: RosterSettingsStore,
  promptLocale: () => CatalogSnapshot['promptLocale'],
  locale: () => 'zh' | 'en',
): RosterLibrary {
  /** Custom experts as stored, with anything malformed dropped. */
  const readCustom = (): CustomExpert[] => {
    const parsed = customExpertSchema.array().safeParse(store.read().customExperts)
    return parsed.success ? parsed.data : []
  }

  const checkRevision = (expected: number): void => {
    if (!Number.isSafeInteger(expected) || expected < 0 || expected !== store.revision()) {
      throw customError('conflict', locale())
    }
  }

  const project = (builtins: readonly ExpertSummary[], custom: readonly CustomExpert[]): CatalogSnapshot => {
    const all = [...builtins, ...custom.map(customSummary)]
    const experts = all.map((expert) => ({
      ...expert,
      conflict: all.some((other) => other !== expert && collides(expert, other)),
    }))
    const unambiguous = new Set(experts.filter((expert) => !expert.conflict).map((expert) => expert.slug))
    const enabled = [...new Set(store.read().enabled)].filter((slug) => unambiguous.has(slug))
    return { experts, enabled, revision: store.revision(), promptLocale: promptLocale() }
  }

  const snapshot = async (custom: readonly CustomExpert[]): Promise<CatalogSnapshot> => (
    project((await base()).map(toExpertSummary), custom)
  )

  /** Reject a slug the user cannot edit: the shipped roster is read-only. */
  const assertEditable = (slug: string): void => {
    if (!CUSTOM_EXPERT_SLUG.test(slug)) throw customError('missing', locale())
  }

  const library: RosterLibrary = {
    async catalog() {
      return snapshot(readCustom())
    },

    enabledState() {
      return { enabled: [...new Set(store.read().enabled)], revision: store.revision() }
    },

    getCustom(slug) {
      return CUSTOM_EXPERT_SLUG.test(slug) ? readCustom().find((entry) => entry.slug === slug) : undefined
    },

    async saveCustom(input, enabled, expectedRevision) {
      checkRevision(expectedRevision)
      const parsed = customExpertInputSchema.safeParse(input)
      if (!parsed.success) throw customError('invalid', locale())
      if (typeof enabled !== 'boolean') throw customError('invalid', locale())
      const value = parsed.data
      const builtins = (await base()).map(toExpertSummary)
      const current = readCustom()
      if (value.slug !== undefined && !current.some((entry) => entry.slug === value.slug)) {
        throw customError('missing', locale())
      }
      if (value.slug === undefined && current.length >= CUSTOM_EXPERT_LIMIT) {
        throw customError('limit', locale())
      }
      const stored: CustomExpert = { ...value, slug: value.slug ?? `custom-${randomUUID()}` }
      // A custom expert must not make an existing name ambiguous: the shipped
      // roster and the user's own experts are both searched by `resolve_expert`.
      // Overlap between two shipped experts is reported as a conflict on the
      // summary instead of rejecting the write — the user cannot fix it, and
      // refusing the write would only leave the document uneditable.
      const next = [...current.filter((entry) => entry.slug !== stored.slug), stored]
      const projection = [...builtins, ...next.filter((entry) => entry.slug !== stored.slug).map(customSummary)]
      if (projection.some((entry) => collides(entry, customSummary(stored)))) {
        throw customError('duplicate', locale())
      }
      await store.mutate([
        { op: 'set', path: ['customExperts'], value: next },
        { op: 'set', path: ['enabled'], value: [...new Set([...store.read().enabled.filter((slug) => slug !== stored.slug), ...(enabled ? [stored.slug] : [])])] },
      ], expectedRevision)
      return snapshot(next)
    },

    async deleteCustom(slug, expectedRevision) {
      assertEditable(slug)
      checkRevision(expectedRevision)
      const current = readCustom()
      if (!current.some((entry) => entry.slug === slug)) throw customError('missing', locale())
      const next = current.filter((entry) => entry.slug !== slug)
      await store.mutate([
        { op: 'set', path: ['customExperts'], value: next },
        { op: 'set', path: ['enabled'], value: [...new Set(store.read().enabled.filter((item) => item !== slug))] },
      ], expectedRevision)
      return snapshot(next)
    },

    async setEnabled(enabled, expectedRevision) {
      checkRevision(expectedRevision)
      const available = new Set((await snapshot(readCustom())).experts.filter((expert) => !expert.conflict).map((expert) => expert.slug))
      if (enabled.some((slug) => !available.has(slug))) throw customError('unavailable', locale())
      const next = [...new Set(enabled)]
      await store.mutate([
        { op: 'set', path: ['customExperts'], value: readCustom() },
        { op: 'set', path: ['enabled'], value: next },
      ], expectedRevision)
      return { enabled: next, revision: store.revision() }
    },
  }
  return library
}
