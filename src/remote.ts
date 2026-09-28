/**
 * Host-side Remote service: the browser's only way into the roster.
 *
 * This service is mounted by the Host half (`src/index.ts`) as a child plugin
 * rather than as a Loader row of its own. Under 0.1.7 a package may hold only
 * one active row: the client module system keys its bundle table by package and
 * refuses two rows resolving to the same one. The Gateway still reaches the
 * service — Cordis registers a service in the root store, which any fiber
 * reads — and the typert contribution registered below is what carries the
 * strict descriptors it dispatches on.
 *
 * Every mutating method takes the settings revision the caller read, so two
 * windows editing the same roster cannot silently overwrite each other.
 *
 * @module dsh-agency-agents-ll/remote
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import { resolvePromptLocale, type PromptLocale } from './contract.js'
import type { CatalogSnapshot, CustomExpertInput, EnabledState, ExpertPrompt, PromptLocaleState } from './expert-contract.js'
import { customError } from './expert-contract.js'
import { readHostLocale, readPromptLocale } from './host-settings.js'
import { formatHost, type LocaleId } from './i18n.js'
import { AGENCY_AGENTS_DESCRIPTORS, TYPERT_NAMESPACE, TYPERT_PACKAGE } from './remote-contract.js'
import { AGENCY_LIBRARY_SERVICE, AGENCY_PERSONA_SERVICE, type AgencyPersonaSource, type RosterLibrary } from './roster-settings.js'

/**
 * Re-exported so the published artifact carries the descriptor table the
 * browser mounts: both halves must be built from one copy of this contract.
 */
export { AGENCY_AGENTS_DESCRIPTORS }

/**
 * Strict Host descriptors. The gateway prefers this contribution over its
 * startup source scan, so a service loaded after boot is still routable.
 */
const TYPERT = {
  package: TYPERT_PACKAGE,
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: AGENCY_AGENTS_DESCRIPTORS,
} satisfies TypertContribution

/**
 * The plugin's Remote half.
 *
 * `getCatalog` returns the whole roster description but never a persona body:
 * prompts are large and most of them are never opened, so the browser pulls
 * one on demand through `getPrompt`.
 */
export default class AgencyAgentsRemote extends TypertRemoteService {
  static inject = ['settings', 'typert']

  /**
   * @param ctx - Host plugin context.
   */
  constructor(ctx: Context) {
    super(ctx, TYPERT_NAMESPACE)
    ctx.effect(() => ctx.typert.register(TYPERT))
  }

  /** Language the roster text renders in. */
  private rosterLocale(): LocaleId {
    return readHostLocale(this.ctx)
  }

  /** Stored persona-language preference. */
  private preference(): PromptLocale {
    return readPromptLocale(this.ctx)
  }

  /** Language a persona body loads in. */
  private effectiveLocale(): LocaleId {
    return resolvePromptLocale(this.preference(), this.rosterLocale())
  }

  private library(): RosterLibrary {
    const library = this.ctx.get(AGENCY_LIBRARY_SERVICE) as RosterLibrary | undefined
    if (library === undefined) throw new Error(formatHost(this.rosterLocale(), 'error.rosterUnavailable'))
    return library
  }

  private personaSource(): AgencyPersonaSource {
    const source = this.ctx.get(AGENCY_PERSONA_SERVICE) as AgencyPersonaSource | undefined
    if (source === undefined) throw new Error(formatHost(this.rosterLocale(), 'error.rosterUnavailable'))
    return source
  }

  /** Every roster entry, the enabled slugs, the revision and the preference. */
  @Remote('getCatalog')
  async getCatalog(): Promise<CatalogSnapshot> {
    return this.library().catalog()
  }

  /** Enabled slugs plus the settings revision that fences the next write. */
  @Remote('getEnabled')
  getEnabled(): EnabledState {
    return this.library().enabledState()
  }

  /** Replace the enabled slug list wholesale; a stale revision is refused. */
  @Remote('setEnabled')
  async setEnabled(enabled: string[], expectedRevision: number): Promise<EnabledState> {
    return this.library().setEnabled(enabled, expectedRevision)
  }

  /** The persona-language preference and what it resolves to right now. */
  @Remote('getPromptLocale')
  getPromptLocale(): PromptLocaleState {
    return { preference: this.preference(), effective: this.effectiveLocale() }
  }

  /** One persona body in the language the preference selects. */
  @Remote('getPrompt')
  async getPrompt(slug: string, division: string): Promise<ExpertPrompt> {
    return this.personaSource().getPrompt(slug, division, this.effectiveLocale())
  }

  /** One stored custom expert, ready to be edited. */
  @Remote('getCustomExpert')
  getCustomExpert(slug: string): CustomExpertInput {
    const expert = this.library().getCustom(slug)
    if (expert === undefined) throw customError('missing', this.rosterLocale())
    return expert
  }

  /** Create or update one custom expert, together with its enabled state. */
  @Remote('saveCustomExpert')
  async saveCustomExpert(expert: CustomExpertInput, enabled: boolean, expectedRevision: number): Promise<CatalogSnapshot> {
    return this.library().saveCustom(expert, enabled, expectedRevision)
  }

  /** Delete one custom expert; a stale revision is refused. */
  @Remote('deleteCustomExpert')
  async deleteCustomExpert(slug: string, expectedRevision: number): Promise<CatalogSnapshot> {
    return this.library().deleteCustom(slug, expectedRevision)
  }
}
