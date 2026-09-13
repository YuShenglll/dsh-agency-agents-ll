/**
 * dsh-agency-agents-ll — a bilingual Agency expert roster for DeepSeek Harness.
 *
 * Reads the English roster shipped in `assets/en` (synced byte-for-byte from the
 * upstream repository) plus the Chinese translations in `assets/zh`, and
 * exposes a summonable expert roster:
 *
 *   - `list_experts(division?)`            browse the roster grouped by division.
 *   - `describe_expert(expert)`            one expert's name, summary and intro.
 *   - `summon_expert(expert, task)`        delegate one task to one expert.
 *   - `summon_experts(experts[])`          run several experts in parallel.
 *
 * A summoned expert does not replace the parent's persona: the child shadows
 * only its own `deployment:persona` section through the subagent provider's
 * `persona` capability, so it runs with the expert's identity plus the ordinary
 * DSH tool set.
 *
 * The tools read the merged roster: the experts shipped in the assets plus the
 * ones the user authored in the settings document, so a custom expert is
 * summonable exactly like a shipped one. `Config.enabled` curates only the
 * browser-side surfaces, never what the tools may see.
 *
 * Expert names stay Chinese in the roster regardless of the prompt language;
 * only the persona text switches.
 *
 * @module dsh-agency-agents-ll
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { coercePromptLocale, DEFAULT_PROMPT_LOCALE, LOCALE_NS, PROMPT_LOCALES, resolvePromptLocale, SETTINGS_NS, type PromptLocale } from './contract.js'
import { assetStamp, loadCatalog, resolveExpert, type AssetRoots, type CatalogLoad, type Expert } from './catalog.js'
import { validateRosterSettings, type ExpertSummary } from './expert-contract.js'
import { formatHost, resolveHostLocale, type LocaleId } from './i18n.js'
import { DIVISIONS, EN_DIVISION, ZH_DIVISION } from './names.js'
import { loadPersona, sanitizePersona } from './persona.js'
import {
  AGENCY_LIBRARY_SERVICE,
  AGENCY_PERSONA_SERVICE,
  createRosterLibrary,
  type AgencyPersonaSource,
  type RosterLibrary,
  type RosterSettingsState,
} from './roster-settings.js'

/** Cordis plugin name; must match the row `name` in `cordis.patch.yml`. */
export const name = 'agency-agents-ll'

/** Services this plugin needs before `apply` runs. */
export const inject = ['tools', 'subagents', 'systemPrompt', 'settings']

/** Prompt-section name, namespaced so it cannot collide with another plugin's. */
export const ROSTER_PROMPT_SECTION = `${name}:roster`

/** Most experts one `summon_experts` call may start. */
export const SUMMON_EXPERTS_MAX = 8

/** How many expert runs `summon_experts` keeps in flight. */
export const SUMMON_EXPERTS_CONCURRENCY = 4

/** Longest task text one expert accepts, in code points. */
export const SUMMON_TASK_MAX_CHARS = 8000

/** Longest expert description echoed by `list_experts`, in code points. */
const DESCRIPTION_LIMIT = 160

export interface Config {
  /** Language the summoned expert persona is written in. */
  readonly promptLocale: PromptLocale
  /**
   * External roster root; empty uses the assets bundled with this package. The
   * directory must be laid out like them, holding the English and Chinese trees
   * as `en/` and `zh/` subdirectories — see {@link resolveAssetRoots}.
   */
  readonly root: string
  /** Subagent provider used to run an expert. */
  readonly provider: string
  /**
   * Slugs the browser-side surfaces offer the user — the `@` menu and the
   * lexicon — written by the browser settings page. Deliberately NOT a filter
   * on the four tools: they search the whole roster, because the default is an
   * empty list and filtering would gut `list_experts` on a fresh install.
   */
  readonly enabled: string[]
  /**
   * Experts the user authored; written by the browser custom-expert editor.
   *
   * Typed as `unknown` on purpose: the document this is read from is
   * hand-editable, so the container can be anything, and only `apply`'s
   * normalization gives it a usable shape.
   */
  readonly customExperts: unknown
}

export const Config: z<Config> = z.object({
  promptLocale: z.union([...PROMPT_LOCALES]).default(DEFAULT_PROMPT_LOCALE),
  root: z.string().default(''),
  provider: z.string().default('spawn'),
  enabled: z.array(z.string()).default([]),
  // Anything goes, including a container that is not an array: the section is
  // read from a document a user can hand-edit, and a schema that refuses it
  // here fails the whole namespace registration — which strands the settings
  // page on "not ready yet" with no way to retry. `apply` normalizes instead,
  // and `validateRosterSettings` reports what was wrong.
  customExperts: z.any().default([]),
})

/**
 * Read the DSH interface language. A plugin can be loaded before the locale
 * namespace registers, so an unavailable section reads as Chinese — the same
 * default the Host copy uses everywhere else.
 * @param ctx - context carrying the settings service.
 * @returns the interface language.
 */
function readLocalePreference(ctx: Context): LocaleId {
  try {
    const section = ctx.settings?.get?.(LOCALE_NS) as { preference?: unknown } | undefined
    return resolveHostLocale(section?.preference)
  } catch {
    return 'zh'
  }
}

const BUNDLED_EN = fileURLToPath(new URL('../assets/en/', import.meta.url))
const BUNDLED_ZH = fileURLToPath(new URL('../assets/zh/', import.meta.url))

/**
 * Environment variable that overrides the bundled roster root. Like
 * `Config.root`, it names a directory that holds the two trees as `en/` and
 * `zh/`.
 */
const ROOT_ENV = 'AGENCY_AGENTS_ROOT'

/**
 * Resolve the asset trees to read: explicit config wins, then the environment,
 * then the assets bundled with this package.
 *
 * A configured root is laid out exactly like the bundled assets, holding the
 * English and Chinese trees as `en/` and `zh/` subdirectories. One directory
 * cannot serve as both halves: each expert file carries a single `name:`, so
 * pointing both roots at the same tree would make the English name and the
 * Chinese name the same string.
 *
 * @param root - configured root; empty means "not configured".
 * @returns the two trees to read.
 */
export function resolveAssetRoots(root: string): AssetRoots {
  const configured = root.trim() !== '' ? root.trim() : (process.env[ROOT_ENV] ?? '').trim()
  if (configured === '') return { en: BUNDLED_EN, zh: BUNDLED_ZH }
  return { en: join(configured, 'en'), zh: join(configured, 'zh') }
}

/**
 * Build the persona reader both halves of the Host read through.
 *
 * A user-authored expert lives in the settings document, not in either asset
 * tree, so it is resolved first; the shipped trees only serve the slugs they
 * own. Keeping this in one exported factory is what stops the summon tools and
 * the browser's "view prompt" from answering differently about the same slug.
 *
 * @param library - roster library owning the user's custom experts.
 * @param roots - the two asset trees.
 * @returns the persona source the tools and the Remote service both use.
 */
export function createPersonaSource(library: RosterLibrary, roots: AssetRoots): AgencyPersonaSource {
  return {
    async getPrompt(slug, division, locale) {
      const custom = library.getCustom(slug)
      if (custom !== undefined) {
        if (custom.division !== division) throw new Error(formatHost(locale, 'error.expertMissing', { query: slug }))
        return { prompt: custom.prompt, locale: 'zh', fallback: false }
      }
      if (slug.startsWith('custom-')) throw new Error(formatHost(locale, 'error.expertMissing', { query: slug }))
      return loadPersona(roots, division, slug, locale)
    },
  }
}

/**
 * Project one merged roster entry onto the shape the name resolver reads.
 *
 * The tools search the merged roster, so every entry — shipped or user-authored
 * — has to arrive in one shape. A summary carries a single display name beside
 * the upstream English name, so the Chinese name is what is left over: equal
 * strings mean there is no Chinese name, which keeps `nameZh` empty for an
 * untranslated archive (and for a custom expert, whose name the store uses on
 * both sides).
 *
 * @param summary - merged roster entry as the library reports it.
 * @returns the resolver-facing expert.
 */
function toRosterExpert(summary: ExpertSummary): Expert {
  return {
    slug: summary.slug,
    division: summary.division,
    emoji: summary.emoji,
    nameZh: summary.name === summary.nameEn ? '' : summary.name,
    nameEn: summary.nameEn,
    descriptionZh: summary.description === summary.descriptionEn ? '' : summary.description,
    descriptionEn: summary.descriptionEn,
    introZh: summary.intro,
    translated: summary.translated,
  }
}

/**
 * Count code points, so a limit is not a byte or UTF-16 unit count.
 * @param text - text to measure.
 * @returns the number of code points.
 */
function codePoints(text: string): number {
  return Array.from(text).length
}

/**
 * Truncate to a code-point budget with an ellipsis.
 * @param text - text to shorten.
 * @param limit - maximum code points to keep.
 * @returns the original text, or a truncated copy.
 */
function truncate(text: string, limit: number): string {
  const points = Array.from(text)
  return points.length <= limit ? text : `${points.slice(0, limit).join('')}…`
}

/** Join the text blocks of one subagent output. */
function textBlocks(blocks: readonly { type: string; text?: string }[]): string {
  return blocks.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('')
}

/**
 * One caught value as the text a failure entry carries.
 * @param error - a caught value.
 * @returns the message, or the value rendered as text.
 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Run tasks with a bounded number in flight, preserving input order.
 *
 * Once the caller's signal is aborted no further item is started: the caller is
 * cancelling a turn, and running the rest only to have them cancelled would
 * report a cancellation as if it were an ordinary per-item failure.
 *
 * @param items - items to process.
 * @param limit - maximum concurrent workers.
 * @param worker - per-item worker.
 * @param signal - cancellation signal; absent means run to completion.
 * @returns results in input order.
 * @throws the signal's abort reason once a cancellation is observed.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      if (signal?.aborted === true) throw signal.reason ?? new Error('aborted')
      const index = next++
      if (index >= items.length) return
      results[index] = await worker(items[index] as T)
    }
  })
  await Promise.all(runners)
  return results
}

/** Normalize one task string against the code-point budget. */
function normalizeTask(task: unknown, locale: LocaleId, index?: number): string {
  const text = String(task ?? '').trim()
  if (text === '') {
    throw new Error(index === undefined
      ? formatHost(locale, 'error.taskRequired')
      : formatHost(locale, 'error.taskEmpty', { index }))
  }
  const length = codePoints(text)
  if (length > SUMMON_TASK_MAX_CHARS) {
    throw new Error(index === undefined
      ? formatHost(locale, 'error.taskTooLong', { index: 1, length, max: SUMMON_TASK_MAX_CHARS })
      : formatHost(locale, 'error.taskTooLong', { index, length, max: SUMMON_TASK_MAX_CHARS }))
  }
  return text
}

/** One expert-summon request after validation. */
interface SummonSpec {
  readonly expert: string
  readonly task: string
}

/**
 * Validate the `summon_experts` request array.
 * @param specs - raw request value.
 * @param locale - language for error text.
 * @returns validated specs.
 */
export function validateSummonSpecs(specs: unknown, locale: LocaleId): SummonSpec[] {
  if (!Array.isArray(specs) || specs.length === 0) throw new Error(formatHost(locale, 'error.expertsEmpty'))
  if (specs.length > SUMMON_EXPERTS_MAX) {
    throw new Error(formatHost(locale, 'error.expertsTooMany', { max: SUMMON_EXPERTS_MAX, count: specs.length }))
  }
  return specs.map((raw, index) => {
    const record = (raw ?? {}) as Record<string, unknown>
    const expert = String(record.expert ?? '').trim()
    if (expert === '') {
      throw new Error(formatHost(locale, 'error.expertEmpty', { index: index + 1 }))
    }
    return { expert, task: normalizeTask(record.task, locale, index + 1) }
  })
}

/**
 * Mount the Host half.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const roots = resolveAssetRoots(config.root)
  let source: () => Config = () => config
  /** Roster state as stored; replaced with the live scope through installSection. */
  let roster: RosterSettingsState = { enabled: [], customExperts: [] }

  // Declared before the settings hook below: `ctx.inject` may run its callback
  // immediately, and the provider validates the stored section at registration,
  // so a hook that reached these would otherwise run during the temporal dead zone.
  const hostLocale = (): LocaleId => readLocalePreference(ctx)

  /** Language the roster text renders in: always the interface language. */
  const rosterLocale = (): LocaleId => hostLocale()

  /** Language the persona text loads in: the preference, then the interface. */
  const promptLocale = (): LocaleId => resolvePromptLocale(coercePromptLocale(source().promptLocale), hostLocale())

  /**
   * The stored roster state, with a container that is not an array read as
   * "nothing stored".
   *
   * The section comes from a document a user can hand-edit, and the schema
   * deliberately accepts whatever it holds (see `Config`): a wrong container
   * shape must cost the user their custom experts until they fix it, not cost
   * them the whole namespace. What was wrong is logged by the `validate` hook.
   *
   * @returns the enabled slugs and the stored custom experts.
   */
  const readStoredRoster = (): RosterSettingsState => {
    const current = source()
    return {
      enabled: Array.isArray(current.enabled) ? current.enabled : [],
      customExperts: Array.isArray(current.customExperts) ? current.customExperts : [],
    }
  }

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, SETTINGS_NS, Config, config, {
      setSource: (current: () => Config) => {
        source = current
        roster = readStoredRoster()
      },
      onChange: () => {
        roster = readStoredRoster()
      },
      validate: (value: Config) => {
        // The hook records what a document got wrong instead of refusing the
        // registration, so dropping the record would leave the degradation
        // undiagnosable: the roster quietly loses entries and nothing says why.
        for (const problem of validateRosterSettings(value, hostLocale())) {
          ctx.logger.warn(`[${name}] ${problem}`)
        }
      },
    })
  })

  /**
   * Tell the model the roster exists — and, just as importantly, when not to use
   * it.
   *
   * Without this section the tools are undiscoverable in practice: four schemas
   * among dozens give the model no reason to reach for them, so the roster stays a
   * browser-side feature and only an `@`-mention ever summons anyone. `text` is a
   * provider rather than a fixed string so the section follows the interface
   * language at each assembly, like the rest of the host copy.
   *
   * Placed at the subagent tool's own order, because that is the neighbouring
   * subject: what this section says is *when* that tool is allowed to run.
   */
  ctx.systemPrompt.section({
    name: ROSTER_PROMPT_SECTION,
    order: ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT'),
    text: () => formatHost(rosterLocale(), 'systemPrompt.roster'),
  })

  let index: Promise<CatalogLoad> | undefined
  /** Stamp the cached index was read at; empty before the first read. */
  let indexStamp = ''

  /**
   * Read the shipped roster, re-walking the trees only when their stamp moved.
   *
   * `pnpm sync:upstream` adds experts to the assets while the Host keeps
   * running, so a promise cached forever would keep serving the roster the
   * plugin started with — to the tools and to the settings page's refresh
   * button alike. Two racers may both reload; the stamp each recorded is
   * compared against a fresh one on the next call, so a late finisher cannot
   * keep a stale roster cached.
   *
   * @returns the shipped roster plus its read diagnostics.
   */
  const readIndex = async (): Promise<CatalogLoad> => {
    const stamp = await assetStamp(roots, DIVISIONS)
    if (index !== undefined && stamp === indexStamp) return index
    const pending = loadCatalog(roots, DIVISIONS)
    index = pending
    indexStamp = stamp
    return pending
  }

  /** Shipped experts by slug: the read-only half of the merged roster. */
  const experts = async (): Promise<Map<string, Expert>> => (await readIndex()).experts

  const library: RosterLibrary = createRosterLibrary(
    async () => [...(await experts()).values()],
    {
      read: () => roster,
      revision: () => {
        const descriptor = ctx.settings.describe().find((candidate) => candidate.ns === SETTINGS_NS)
        if (descriptor === undefined) throw new Error(formatHost(rosterLocale(), 'error.rosterUnavailable'))
        return descriptor.revision
      },
      mutate: (ops, expectedRevision) => ctx.settings.mutate(SETTINGS_NS, ops, expectedRevision),
    },
    () => coercePromptLocale(source().promptLocale),
    () => rosterLocale(),
  )

  // The Remote half is a separate top-level row (see cordis.patch.yml), so the
  // roster it serves has to be reachable from there: both faces are provided on
  // the root context rather than closed over. The summon tools read the same
  // object, so a persona can only ever be served one way.
  ctx.provide(AGENCY_LIBRARY_SERVICE, library)
  const loadExpertPersona = createPersonaSource(library, roots)
  ctx.provide(AGENCY_PERSONA_SERVICE, loadExpertPersona)

  /** Chinese name when translated, English name otherwise. */
  const displayName = (expert: Expert): string => (expert.nameZh !== '' ? expert.nameZh : expert.nameEn)

  /** Chinese description when translated, English description otherwise. */
  const displayDescription = (expert: Expert, locale: LocaleId): string => (
    locale === 'zh' && expert.descriptionZh !== ''
      ? expert.descriptionZh
      : expert.descriptionEn
  )

  /**
   * Every roster entry as the tools read it: the experts shipped with the
   * package plus the ones the user authored. Resolving against this merged view
   * is what makes a custom expert summonable at all — it has no file in either
   * asset tree — and what keeps a name the browser can insert into a message
   * resolvable by the tool that receives it.
   * @returns resolver-facing entries for the whole roster.
   */
  const rosterExperts = async (): Promise<Expert[]> => (await library.catalog()).experts.map(toRosterExpert)

  /**
   * Resolve one expert query against the merged roster.
   * @param query - Chinese name, English name, or an unambiguous fragment.
   * @param locale - language for error text.
   * @returns the single matching expert.
   */
  const resolveAnyExpert = async (query: unknown, locale: LocaleId): Promise<Expert> => (
    resolveExpert(await rosterExperts(), query, locale)
  )

  /**
   * Explain a roster the shipped halves could not serve.
   *
   * A wrong `config.root` used to degrade into an empty roster with no
   * diagnostic anywhere: `list_experts` answered "no experts are available",
   * which reads as a roster fact rather than as a configuration fault. The
   * three states are reported in the order that matters to a reader:
   *
   *   - the `en` tree is absent → nothing defines the roster at all;
   *   - the roster came back empty → the tree is there and holds no experts;
   *   - the `zh` tree is absent → the roster works, every entry is English.
   *
   * @param total - how many experts the merged roster holds.
   * @param locale - language for the diagnostic.
   * @returns the notice, empty when both trees are readable and the roster is not empty.
   */
  const rosterNotice = async (total: number, locale: LocaleId): Promise<string> => {
    const { missingRoot } = await readIndex()
    if (missingRoot === 'en') return formatHost(locale, 'error.rootMissing', { root: roots.en })
    if (total === 0) return formatHost(locale, 'error.catalogEmpty', { root: roots.en })
    if (missingRoot === 'zh') return formatHost(locale, 'error.zhRootMissing', { root: roots.zh })
    return ''
  }

  function groupByDivision(
    list: readonly Expert[],
    locale: LocaleId,
    withDescriptions: boolean,
  ): Array<{ division: string; label: string; count: number; names: string[]; experts: Array<{ name: string; emoji: string; description: string }> }> {
    const byDivision = new Map<string, Expert[]>()
    for (const expert of list) {
      const bucket = byDivision.get(expert.division)
      if (bucket === undefined) byDivision.set(expert.division, [expert])
      else bucket.push(expert)
    }
    return [...byDivision.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([division, group]) => {
        const sorted = [...group].sort((a, b) => a.slug.localeCompare(b.slug))
        return {
          division,
          label: (locale === 'en' ? EN_DIVISION[division] : ZH_DIVISION[division]) ?? division,
          count: sorted.length,
          names: sorted.map((expert) => `${expert.emoji !== '' ? `${expert.emoji} ` : ''}${displayName(expert)}`),
          experts: withDescriptions
            ? sorted.map((expert) => ({
              name: displayName(expert),
              emoji: expert.emoji,
              description: truncate(displayDescription(expert, locale), DESCRIPTION_LIMIT),
            }))
            : [],
        }
      })
  }

  ctx.tools.register(defineTool({
    name: 'list_experts',
    description: 'List the available Agency domain experts grouped by division. Without a division filter it returns division names and counts; pass a division to expand it with expert names. Call this before summon_expert when you need to choose an expert.',
    parameters: {
      division: { type: 'string', description: 'Optional division to expand (e.g. engineering, marketing, security, finance, design).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          divisions: { type: 'array', required: true, items: { type: 'json' } },
          total: { type: 'number', required: true },
          notice: { type: 'string', required: true },
        },
      },
      render: (args, value) => {
        const groups = value.divisions as Array<{ label: string; count: number; names: string[]; experts: Array<{ name: string; emoji: string; description: string }> }>
        const locale = rosterLocale()
        const query = String(args.division ?? '').trim()
        // A roster the shipped halves could not serve is reported as such,
        // whether it came back empty (a wrong `config.root`) or only partly
        // populated (no Chinese tree, so every name is English).
        const notice = String(value.notice ?? '')
        if (groups.length === 0) {
          return [{
            type: 'text',
            text: notice !== ''
              ? notice
              : query === ''
                ? formatHost(locale, 'list.empty')
                : formatHost(locale, 'list.emptyDivision', { division: query }),
          }]
        }
        const expanded = query !== ''
        const lines: string[] = []
        if (!expanded) {
          lines.push(formatHost(locale, 'list.heading', { total: value.total as number, divisions: groups.length }))
        }
        for (const group of groups) {
          if (expanded) {
            lines.push(formatHost(locale, 'list.groupHeading', { division: group.label, count: group.count }))
            for (const expert of group.experts) {
              lines.push(formatHost(locale, 'list.expertLine', {
                name: `${expert.emoji !== '' ? `${expert.emoji} ` : ''}${expert.name}`,
                description: expert.description,
              }))
            }
          } else {
            lines.push(formatHost(locale, 'list.group', {
              division: group.label,
              count: group.count,
              names: group.names.join(formatHost(locale, 'list.nameSeparator')),
            }))
          }
        }
        if (notice !== '') lines.push(notice)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const locale = rosterLocale()
      const all = await rosterExperts()
      const query = String(args.division ?? '').trim().toLowerCase()
      const filtered = query === ''
        ? all
        : all.filter((expert) => {
          const division = expert.division.toLowerCase()
          return division === query
            || division.includes(query)
            || (ZH_DIVISION[expert.division] ?? '').includes(query)
            || (EN_DIVISION[expert.division] ?? '').toLowerCase().includes(query)
        })
      const groups = groupByDivision(filtered, locale, query !== '')
      return { divisions: groups, total: filtered.length, notice: await rosterNotice(all.length, locale) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'describe_expert',
    description: 'Show one expert\'s profile: their Chinese name, one-line summary, and the Chinese introduction explaining what the role covers and when to call it. Use this to explain an expert to the user, or to decide between experts that look similar in list_experts.',
    parameters: {
      expert: { type: 'string', required: true, description: 'Expert name; the Chinese or the English name both work.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          nameEn: { type: 'string', required: true },
          division: { type: 'string', required: true },
          emoji: { type: 'string', required: true },
          description: { type: 'string', required: true },
          intro: { type: 'string', required: true },
          chinesePersona: { type: 'boolean', required: true },
          promptLocale: { type: 'string', required: true },
        },
      },
      render: (_args, value) => {
        const locale = rosterLocale()
        const lines = [
          formatHost(locale, 'profile.heading', {
            name: `${value.emoji as string} ${value.name as string}`.trim(),
            division: ((locale === 'en' ? EN_DIVISION : ZH_DIVISION)[value.division as string]) ?? (value.division as string),
          }),
          formatHost(locale, 'profile.englishName', { name: value.nameEn as string }),
          formatHost(locale, 'profile.oneLine', { text: value.description as string }),
        ]
        const intro = (value.intro as string).trim()
        lines.push(formatHost(locale, 'profile.introHeading'))
        lines.push(intro !== '' ? intro : formatHost(locale, 'profile.introMissing', { fallback: value.description as string }))
        lines.push(value.chinesePersona as boolean
          ? formatHost(locale, 'profile.personaProvided')
          : formatHost(locale, 'profile.personaMissing'))
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const locale = rosterLocale()
      const expert = await resolveAnyExpert(args.expert, locale)
      return {
        name: displayName(expert),
        nameEn: expert.nameEn,
        division: expert.division,
        emoji: expert.emoji,
        description: displayDescription(expert, locale),
        intro: expert.introZh,
        chinesePersona: expert.translated,
        promptLocale: promptLocale(),
      }
    },
  }))

  /**
   * Run one already-resolved expert on one task.
   *
   * Resolution stays with the caller so a batch can label a failure with the
   * same display name a success carries, instead of echoing the raw query.
   *
   * @param expert - the resolved roster entry to summon.
   * @param task - the task text for the child.
   * @param exec - the tool run context the child inherits.
   * @returns the expert's display name, its answer, and the persona language served.
   */
  async function runExpert(expert: Expert, task: unknown, exec: ToolRunContext): Promise<{ expert: string; answer: string; promptLocale: LocaleId }> {
    const text = promptLocale()
    const roster = rosterLocale()
    const taskText = normalizeTask(task, roster)
    if (exec.agent === undefined) throw new Error(formatHost(roster, 'error.summonRequiresAgent'))
    const provider = ctx.subagents.getProvider(source().provider)
    if (provider === undefined) throw new Error(formatHost(roster, 'error.providerMissing', { provider: source().provider }))
    if (!provider.capabilities.persona) throw new Error(formatHost(roster, 'error.providerNoPersona', { provider: source().provider }))
    if (!provider.capabilities.toolFilter) throw new Error(formatHost(roster, 'error.providerNoToolFilter', { provider: source().provider }))
    const persona = await loadExpertPersona.getPrompt(expert.slug, expert.division, text)
    const run: SubagentRun = await ctx.subagents.start(source().provider, {
      label: `expert:${expert.slug}`,
      prompt: [{ type: 'text', text: taskText }],
      parent: exec.agent,
      persona: sanitizePersona(persona.prompt),
      toolFilter: { deny: ['summon_expert', 'summon_experts', 'list_experts'] },
      signal: exec.signal,
    })
    try {
      const result = await run.result
      const answer = textBlocks(result.output as readonly { type: string; text?: string }[])
      if (result.stopReason !== 'completed') {
        const detail = answer.length > 0 ? formatHost(roster, 'error.partialOutput', { text: answer }) : ''
        throw new Error(formatHost(roster, 'error.expertRun', { reason: result.stopReason, detail }))
      }
      return { expert: displayName(expert), answer, promptLocale: persona.locale }
    } finally {
      await run.dispose()
    }
  }

  ctx.tools.register(defineTool({
    name: 'summon_expert',
    description: "Summon a domain expert from The Agency roster to complete a task: a specialist subagent runs with that expert's full persona and returns its result. Use for tasks that clearly belong to a specialist domain (frontend work, security review, marketing copy, etc.). This call waits for the expert's result. Call list_experts first if you do not know the expert name.",
    parameters: {
      expert: { type: 'string', required: true, description: 'Expert name to summon; the Chinese or the English name both work.' },
      task: { type: 'string', required: true, description: 'The complete, self-contained task to give the expert. Include all necessary context; fork providers may additionally inherit completed conversation turns.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          expert: { type: 'string', required: true },
          answer: { type: 'string', required: true },
          promptLocale: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.answer as string }],
    },
    async execute(args, exec) {
      const locale = rosterLocale()
      return runExpert(await resolveAnyExpert(args.expert, locale), args.task, exec)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'summon_experts',
    description: `Summon multiple domain experts in parallel to work on one mission. Each expert gets its own task and runs as a specialist subagent with its own persona. At most ${SUMMON_EXPERTS_MAX} experts run with concurrency ${SUMMON_EXPERTS_CONCURRENCY}; if some fail, successful answers are still returned. Use this to assemble a specialist team.`,
    parameters: {
      experts: {
        type: 'array',
        required: true,
        description: 'The experts to summon, each with an expert name and its own task.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            expert: { type: 'string', required: true, description: 'Expert name; the Chinese or the English name both work.' },
            task: { type: 'string', required: true, description: 'The complete, self-contained task for this expert.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { results: { type: 'array', required: true, items: { type: 'json' } } },
      },
      render: (_args, value) => {
        const results = value.results as Array<{ expert: string; ok: boolean; answer: string; error?: string }>
        const locale = rosterLocale()
        const sections = results.map((item) => {
          const heading = `### ${item.expert}`
          const body = item.ok ? item.answer : formatHost(locale, 'error.expertFailed', { error: item.error ?? '' })
          return `${heading}\n\n${body}`
        })
        return [{ type: 'text', text: sections.join('\n\n') }]
      },
    },
    async execute(args, exec) {
      const locale = rosterLocale()
      if (exec.agent === undefined) throw new Error(formatHost(locale, 'error.summonManyRequiresAgent'))
      const specs = validateSummonSpecs(args.experts, locale)
      const results = await mapPool(specs, SUMMON_EXPERTS_CONCURRENCY, async (spec): Promise<{ expert: string; ok: boolean; answer: string; error: string }> => {
        let expert: Expert
        try {
          expert = await resolveAnyExpert(spec.expert, locale)
        } catch (error) {
          // Nothing was resolved, so the query itself is the only label there is.
          return { expert: spec.expert, ok: false, answer: '', error: errorText(error) }
        }
        try {
          const outcome = await runExpert(expert, spec.task, exec)
          return { expert: outcome.expert, ok: true, answer: outcome.answer, error: '' }
        } catch (error) {
          // A cancelled turn is not a per-expert failure: rethrowing keeps the
          // cancellation from arriving as a "successful" batch of failures.
          if (exec.signal.aborted) throw error
          // Labelled like a success, so one output never mixes an English query
          // into an otherwise Chinese list of experts.
          return { expert: displayName(expert), ok: false, answer: '', error: errorText(error) }
        }
      }, exec.signal)
      return { results }
    },
  }))
}
