/**
 * Host-side reads of the two settings entries this plugin consumes: its own,
 * and the harness locale entry.
 *
 * DSH 0.1.7 replaced per-plugin namespace registration with a form projection
 * over each plugin's own Cordis `Config`. A business plugin therefore no longer
 * asks the settings service for a section by name; it reads the values the
 * service projects for its profile entry, which is exactly the surface the
 * browser page edits. Reading the same projection on both halves is what keeps
 * a toggle and a summoned persona from disagreeing about the stored document.
 *
 * The volatile fields arrive in the raw config as cosmokit references rather
 * than plain values, so this module deliberately does not read `config`
 * directly: the service's projection already unwraps them, and a second reader
 * with its own unwrapping rule is how the two halves would drift apart.
 *
 * Every accessor tolerates a settings service that is absent or that serves no
 * row for the namespace. A plugin may be composed before the harness registers
 * its own entry, and a missing row has to read as "nothing stored" rather than
 * throw from inside a tool call.
 *
 * @module dsh-agency-agents-ll/host-settings
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { coercePromptLocale, LOCALE_NS, SETTINGS_NS, type PromptLocale } from './contract.js'
import { formatHost, resolveHostLocale, type LocaleId } from './i18n.js'
import type { RosterSettingsState } from './roster-settings.js'

/** One `settings.describe()` row, narrowed to what this plugin reads. */
interface SettingsRow {
  readonly ns?: string
  readonly revision?: number
  readonly value?: unknown
}

/**
 * Every row the settings service currently projects.
 * @param ctx - context carrying the settings service.
 * @returns the rows, or none when the service is absent or refuses to describe.
 */
function describeRows(ctx: Context): readonly SettingsRow[] {
  try {
    return (ctx.settings?.describe?.() ?? []) as readonly SettingsRow[]
  } catch {
    return []
  }
}

/**
 * One namespace's projected row.
 * @param ctx - context carrying the settings service.
 * @param ns - profile entry id the row belongs to.
 * @returns the row, or `undefined` when the harness serves no such entry.
 */
function describeRow(ctx: Context, ns: string): SettingsRow | undefined {
  return describeRows(ctx).find((candidate) => candidate.ns === ns)
}

/** One reading of this plugin's own entry: what it stores, and what it means. */
export interface RosterSettingsReading {
  /** The values normalized into what the roster logic reads. */
  readonly state: RosterSettingsState
  /**
   * The same values exactly as stored. Kept beside the normalized state so the
   * caller can report what a hand-edit got wrong — normalizing first would
   * erase the very shape the report is about.
   */
  readonly raw: { readonly enabled?: unknown; readonly customExperts?: unknown }
}

/**
 * The stored roster state of this plugin's own entry.
 *
 * The entry comes from a document a user can hand-edit and the schema accepts
 * whatever container it holds (see `Config`): a wrong shape must cost the user
 * the marks or experts it made unreadable until they fix it, not cost them the
 * whole plugin. `validateRosterSettings` records what was wrong, so nothing
 * degrades silently.
 *
 * @param ctx - context carrying the settings service.
 * @returns what the entry stores and how it reads, or `undefined` when the
 *   harness serves no entry for this plugin — which is a different fact from
 *   "the user stored nothing" and must not be mistaken for one.
 */
export function readRosterSettings(ctx: Context): RosterSettingsReading | undefined {
  const value = describeRow(ctx, SETTINGS_NS)?.value as { enabled?: unknown; customExperts?: unknown } | undefined
  if (value === undefined) return undefined
  return {
    raw: value,
    state: {
      // A mark that is not a string names no expert. Dropping it here is the
      // same degradation the reported problem describes; keeping it would let a
      // hand-edit become a slug the resolver can never match.
      enabled: Array.isArray(value.enabled) ? value.enabled.filter((entry): entry is string => typeof entry === 'string') : [],
      customExperts: Array.isArray(value.customExperts) ? value.customExperts : [],
    },
  }
}

/**
 * Revision fencing the next write to this plugin's own entry.
 * @param ctx - context carrying the settings service.
 * @param locale - language for the failure message.
 * @returns the current revision.
 * @throws when the harness serves no entry for this plugin, so no write could
 *   be fenced and the caller must not silently drop the user's edit.
 */
export function rosterRevision(ctx: Context, locale: LocaleId): number {
  const revision = describeRow(ctx, SETTINGS_NS)?.revision
  if (revision === undefined) throw new Error(formatHost(locale, 'error.rosterUnavailable'))
  return revision
}

/**
 * The persona-language preference stored in this plugin's own entry.
 * @param ctx - context carrying the settings service.
 * @returns the preference, defaulting the way any unreadable value does.
 */
export function readPromptLocale(ctx: Context): PromptLocale {
  const value = describeRow(ctx, SETTINGS_NS)?.value as { promptLocale?: unknown } | undefined
  return coercePromptLocale(value?.promptLocale)
}

/**
 * The interface language the harness locale entry currently holds.
 *
 * A missing locale entry reads as Chinese, which is the default this plugin
 * uses everywhere else when the interface language cannot be determined.
 *
 * @param ctx - context carrying the settings service.
 * @returns the interface language.
 */
export function readHostLocale(ctx: Context): LocaleId {
  const value = describeRow(ctx, LOCALE_NS)?.value as { preference?: unknown } | undefined
  return resolveHostLocale(value?.preference)
}
