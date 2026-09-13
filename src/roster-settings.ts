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
  /** Enabled expert slugs: the user's own marks, never filtered by name resolution. */
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
  /**
   * Replace the enabled slug list wholesale. Every slug the roster defines is
   * accepted — a colliding name still has exactly one slug — as is a mark the
   * document already carries, because the browser echoes the whole list back on
   * each toggle.
   */
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
 * shows every expert and keeps the user's mark — but an ambiguous name cannot
 * be resolved by name, so `resolve_expert` would have to guess.
 * @param left - one entry.
 * @param right - the other entry.
 * @returns whether they share a slug or a name.
 */
function collides(left: ExpertSummary, right: ExpertSummary): boolean {
  if (left.slug === right.slug) return true
  return [left.name, left.nameEn].some((name) => [right.name, right.nameEn].some((other) => normalizeExpertName(name) === normalizeExpertName(other)))
}

/**
 * The projected entry list: shipped experts first, then the user's own.
 * @param builtins - shipped entries, already projected.
 * @param custom - stored custom experts.
 * @returns every entry the roster shows.
 */
function mergedEntries(builtins: readonly ExpertSummary[], custom: readonly CustomExpert[]): ExpertSummary[] {
  return [...builtins, ...custom.map(customSummary)]
}

/**
 * Every entry that collides with another entry in the same list.
 *
 * The question is the one {@link collides} answers, but read off buckets
 * instead of off every pair: each name is normalised exactly once, so a roster
 * of n entries costs O(n) rather than O(n²). Two entries collide when their
 * slugs are equal, or when any of one entry's two names equals any of the
 * other's under {@link normalizeExpertName} — that is, when a bucket holds more
 * than one entry. Buckets hold entries by identity, so an entry never collides
 * with itself.
 *
 * @param all - every projected entry, shipped and user-authored.
 * @returns the colliding entries, by identity.
 */
function conflictedEntries(all: readonly ExpertSummary[]): Set<ExpertSummary> {
  const bySlug = new Map<string, Set<ExpertSummary>>()
  const byName = new Map<string, Set<ExpertSummary>>()
  const add = (index: Map<string, Set<ExpertSummary>>, key: string, entry: ExpertSummary): void => {
    const bucket = index.get(key)
    if (bucket === undefined) index.set(key, new Set([entry]))
    else bucket.add(entry)
  }
  for (const entry of all) {
    add(bySlug, entry.slug, entry)
    add(byName, normalizeExpertName(entry.name), entry)
    add(byName, normalizeExpertName(entry.nameEn), entry)
  }
  const conflicted = new Set<ExpertSummary>()
  for (const bucket of [...bySlug.values(), ...byName.values()]) {
    if (bucket.size < 2) continue
    for (const entry of bucket) conflicted.add(entry)
  }
  return conflicted
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
  /**
   * The stored custom list exactly as the document holds it.
   *
   * The section is user-editable, so the container itself can be anything at all.
   * A non-list degrades to "no custom experts" rather than throwing, which is what
   * `validateRosterSettings` records at registration time — the two agree, so a
   * document cannot be simultaneously "fine to register" and "fatal to read".
   */
  const rawCustom = (): readonly unknown[] => {
    const value = store.read().customExperts
    return Array.isArray(value) ? value : []
  }

  /** One stored entry as this version reads it, or `undefined` when it cannot. */
  const parseCustom = (entry: unknown): CustomExpert | undefined => {
    const parsed = customExpertSchema.safeParse(entry)
    return parsed.success ? parsed.data : undefined
  }

  /**
   * Custom experts as stored, parsed entry by entry so one unreadable entry
   * costs exactly that expert instead of the whole list. This is the same
   * degradation `validateRosterSettings` reports at registration time.
   */
  const readCustom = (): CustomExpert[] => {
    const entries: CustomExpert[] = []
    for (const entry of rawCustom()) {
      const parsed = parseCustom(entry)
      if (parsed !== undefined) entries.push(parsed)
    }
    return entries
  }

  /**
   * Restate the stored custom list with one expert replaced, removed or added.
   *
   * An entry this version cannot read is carried through untouched — a write
   * must not delete user state it never served (D18) — so the document is
   * repaired by hand, not by the next unrelated save.
   *
   * @param slug - the expert being written.
   * @param replacement - its new value, or `undefined` to remove it.
   * @returns the list to store, and the experts that list holds.
   */
  const restate = (slug: string, replacement: CustomExpert | undefined): { next: unknown[]; experts: CustomExpert[] } => {
    const next: unknown[] = []
    const experts: CustomExpert[] = []
    let found = false
    for (const entry of rawCustom()) {
      const parsed = parseCustom(entry)
      if (parsed === undefined) {
        next.push(entry)
        continue
      }
      if (parsed.slug !== slug) {
        next.push(entry)
        experts.push(parsed)
        continue
      }
      found = true
      if (replacement !== undefined) {
        next.push(replacement)
        experts.push(replacement)
      }
    }
    if (!found && replacement !== undefined) {
      next.push(replacement)
      experts.push(replacement)
    }
    return { next, experts }
  }

  const checkRevision = (expected: number): void => {
    if (!Number.isSafeInteger(expected) || expected < 0 || expected !== store.revision()) {
      throw customError('conflict', locale())
    }
  }

  const project = (builtins: readonly ExpertSummary[], custom: readonly CustomExpert[]): CatalogSnapshot => {
    const all = mergedEntries(builtins, custom)
    const conflicted = conflictedEntries(all)
    const experts = all.map((expert) => ({ ...expert, conflict: conflicted.has(expert) }))
    // Enabled marks are the user's, keyed by slug: deduplicate, never filter. A
    // colliding name only makes `resolve_expert` ambiguous; dropping the mark
    // here would erase it from the settings document on the next toggle.
    const enabled = [...new Set(store.read().enabled)]
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
      if (!parsed.success) {
        // A division the roster does not serve gets its own message: it is the
        // one per-field failure the user fixes by picking from a list, and the
        // one that must never be stored, because `getPrompt` refuses to read an
        // expert back out of a division the roster does not have.
        const divisionProblem = parsed.error.issues.some((issue) => issue.path[0] === 'division')
        throw customError(divisionProblem ? 'division' : 'invalid', locale())
      }
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
      const others = current.filter((entry) => entry.slug !== stored.slug)
      if (mergedEntries(builtins, others).some((entry) => collides(entry, customSummary(stored)))) {
        throw customError('duplicate', locale())
      }
      const { next, experts } = restate(stored.slug, stored)
      await store.mutate([
        { op: 'set', path: ['customExperts'], value: next },
        { op: 'set', path: ['enabled'], value: [...new Set([...store.read().enabled.filter((slug) => slug !== stored.slug), ...(enabled ? [stored.slug] : [])])] },
      ], expectedRevision)
      return snapshot(experts)
    },

    async deleteCustom(slug, expectedRevision) {
      assertEditable(slug)
      checkRevision(expectedRevision)
      const current = readCustom()
      if (!current.some((entry) => entry.slug === slug)) throw customError('missing', locale())
      const { next, experts } = restate(slug, undefined)
      await store.mutate([
        { op: 'set', path: ['customExperts'], value: next },
        { op: 'set', path: ['enabled'], value: [...new Set(store.read().enabled.filter((item) => item !== slug))] },
      ], expectedRevision)
      return snapshot(experts)
    },

    async setEnabled(enabled, expectedRevision) {
      checkRevision(expectedRevision)
      // A mark is legitimate when the roster defines its slug — a colliding name
      // still has exactly one slug — or when the document already carries it.
      // The browser echoes the whole list back on every toggle, so a mark must
      // stay writable after its expert became ambiguous or left the roster; only
      // a slug this installation has never seen is refused.
      const entries = mergedEntries((await base()).map(toExpertSummary), readCustom())
      const known = new Set([...entries.map((expert) => expert.slug), ...store.read().enabled])
      if (enabled.some((slug) => !known.has(slug))) throw customError('unavailable', locale())
      const next = [...new Set(enabled)]
      // Only the field this call owns is restated. The provider applies path ops
      // to the section as it stands, so a toggle cannot lose `customExperts` by
      // leaving it alone — and writing that array back here would rewrite a
      // field this call has no business changing.
      await store.mutate([{ op: 'set', path: ['enabled'], value: next }], expectedRevision)
      return { enabled: next, revision: store.revision() }
    },
  }
  return library
}
