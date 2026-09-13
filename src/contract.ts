/**
 * Values both halves of the plugin share. This module must stay free of Host
 * and browser dependencies: the client bundle inlines everything except the
 * platform-frozen modules, so importing a Host-only module here would drag it
 * into the browser bundle.
 */

/** Settings namespace; also the join key between the Host section and the browser card. */
export const SETTINGS_NS = 'agency-agents-ll'

/** Persona-prompt language preference. `auto` follows the DSH interface language. */
export type PromptLocale = 'auto' | 'zh' | 'en'

/** A persona language that is always concrete. */
export type ResolvedLocale = 'zh' | 'en'

/** Selectable preference values, in display order. */
export const PROMPT_LOCALES: readonly PromptLocale[] = ['auto', 'zh', 'en']

/** Preference used when a user document carries no explicit value. */
export const DEFAULT_PROMPT_LOCALE: PromptLocale = 'en'

/**
 * Fold a preference and the host interface language into the persona language to load.
 * @param preference - the stored preference; `auto` defers to the interface language.
 * @param host - the current DSH interface language.
 * @returns the concrete language whose persona file is loaded.
 */
export function resolvePromptLocale(preference: PromptLocale, host: ResolvedLocale): ResolvedLocale {
  return preference === 'auto' ? host : preference
}

/**
 * Narrow an arbitrary settings value to a known preference.
 * @param value - raw value read from the settings document.
 * @returns the value when it is a known preference, otherwise the default.
 */
export function coercePromptLocale(value: unknown): PromptLocale {
  return PROMPT_LOCALES.includes(value as PromptLocale) ? (value as PromptLocale) : DEFAULT_PROMPT_LOCALE
}

/**
 * Whether a settings provider refused a write because the section had moved
 * since the caller read it.
 *
 * The code is the stable signal (`SettingsConflictError.code`); the message test
 * covers the relay boundary, where a business failure can arrive as a plain
 * error carrying only the original text. This is the one place that knows how a
 * conflict is spelled, so the Host never rewrites the refusal into a generic
 * failure and the browser can still tell a lost race from a real fault.
 *
 * @param error - a caught value.
 * @returns whether the write was refused as stale.
 */
export function isSettingsConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ((error as { code?: unknown }).code === 'SETTINGS_CONFLICT') return true
  return error instanceof Error && error.message.includes('changed since it was read')
}
