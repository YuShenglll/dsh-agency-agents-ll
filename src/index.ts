/**
 * Host half of the plugin.
 *
 * Owns the settings section that stores the persona-prompt language. Persona
 * loading, the roster catalog, and the summon tools land in P3; P0 proves the
 * package builds, installs as a bundle, and serves its namespace.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_PROMPT_LOCALE, PROMPT_LOCALES, SETTINGS_NS } from './contract.js'

/** Cordis plugin name; must match the row `name` in `cordis.patch.yml`. */
export const name = 'agency-agents-ll'

export interface Config {
  /** Language the summoned expert persona is written in. */
  readonly promptLocale: (typeof PROMPT_LOCALES)[number]
  /** External roster root; empty uses the assets bundled with this package. */
  readonly root: string
}

export const Config: z<Config> = z.object({
  promptLocale: z.union([...PROMPT_LOCALES]).default(DEFAULT_PROMPT_LOCALE),
  root: z.string().default(''),
})

/**
 * Mount the Host half.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  // `installSection` hands back a thunk; reading through it keeps us correct
  // when the settings provider is replaced under us.
  let source: () => Config = () => config
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, SETTINGS_NS, Config, config, {
      setSource: (current: () => Config) => {
        source = current
      },
      onChange: () => {},
    })
  })
  /** Current configuration, including values the user edited in the settings card. */
  void ((): Config => source())
}
