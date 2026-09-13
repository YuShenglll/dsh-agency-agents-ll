/**
 * Browser half of the plugin.
 *
 * Three contributions, all on top of the shared roster cache:
 *
 *   - `settings.section`        a roster page: division groups, search, a
 *                               division filter, per-expert enable/disable,
 *                               the Chinese introduction, prompt view/copy and
 *                               the custom-expert editor.
 *   - `conversation.input.left` a composer button that inserts an enabled
 *                               expert as an atomic `@name` reference.
 *   - an input-trigger source   the `@` menu itself.
 *
 * Everything user-visible goes through the dictionary in `./locales`, and the
 * roster is only ever read through the Host Remote service, so nothing here
 * duplicates Host state.
 */
import React from 'react'
import type { Context as CordisClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { InputTriggerSource, ReferenceInsert, TokenSpan } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SETTINGS_NS, isSettingsConflict } from '../contract.js'
import { DIVISIONS, EN_DIVISION, ZH_DIVISION } from '../names.js'
import {
  CUSTOM_EXPERT_INTRO_MAX,
  CUSTOM_EXPERT_PROMPT_MAX,
  DEFAULT_EXPERT_EMOJI,
  customExpertInputSchema,
  type CatalogSnapshot,
  type CustomExpertInput,
  type ExpertSummary,
} from '../expert-contract.js'
import { acceptCatalog, catalogState, catalogSubscription, refreshCatalog, subscribeCatalog, writeEnabled } from './catalog.js'
import { DICTIONARIES, formatClient, type AgencyClientKey } from './locales.js'
import type { AgencyRosterRemote } from './remote.js'
import TYPERT_REMOTE from './remote.js'

/** Plugin id used for slot ids, the style tag and the Remote package. */
const PLUGIN_ID = 'dsh-agency-agents-ll'

/** Locale namespace holding this plugin's browser copy. */
const NS = 'agencyLL'

/** Stable id of the settings page inside `settings.section`. */
const SECTION_ID = 'agency-agents-ll'

/** Divisions in a fixed order, so the filter list never reshuffles. */
const DIVISION_ORDER = DIVISIONS

type ClientLocale = 'zh' | 'en'

/** Cordis client context narrowed to the services this plugin reaches. */
interface ClientSlots {
  inject(key: string, callback: () => void): void
  register(options: unknown, component: unknown): () => void
}

/** Mount face of the typed Remote service. */
interface ClientRemoteService {
  $mount(contribution: unknown): Promise<() => Promise<void>>
}

type ClientContext = CordisClientContext & {
  readonly slots: ClientSlots
  readonly remote: ClientRemoteService
  readonly sessions: unknown
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** This plugin's browser dictionary. */
    agencyLL: AgencyClientKey
  }
}

// ---------------------------------------------------------------------------
// Pure helpers. Kept free of React so the `@` sources can reuse them.
// ---------------------------------------------------------------------------

/** Normalize a query: full width folds, runs of space collapse, case folds. */
export function normalizeQuery(query: string): string {
  return query.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
}

/**
 * Whether one expert matches every term of a query. The introduction is part of
 * the haystack because it is the field that says when to call the expert.
 * @param expert - roster entry.
 * @param query - raw user query.
 * @returns whether the entry matches.
 */
export function matchesQuery(expert: ExpertSummary, query: string): boolean {
  const needle = normalizeQuery(query)
  if (needle === '') return true
  const fields = [
    expert.slug,
    expert.name,
    expert.nameEn,
    expert.division,
    ZH_DIVISION[expert.division] ?? '',
    EN_DIVISION[expert.division] ?? '',
    expert.description,
    expert.descriptionEn,
    expert.intro,
  ].map(normalizeQuery)
  return needle.split(' ').every((term) => fields.some((field) => field.includes(term)))
}

/**
 * Apply the division filter and the query.
 * @param experts - roster entries.
 * @param division - division key, or empty for all.
 * @param query - raw user query.
 * @returns the matching entries, in roster order.
 */
export function filterExperts(experts: readonly ExpertSummary[], division: string, query: string): ExpertSummary[] {
  return experts.filter((expert) => (division === '' || expert.division === division) && matchesQuery(expert, query))
}

/** One division group as the page renders it. */
export interface DivisionGroup {
  readonly division: string
  readonly label: string
  readonly experts: ExpertSummary[]
}

/** Division label for one key, falling back to the raw directory name. */
export function groupLabel(division: string, locale: ClientLocale): string {
  const names = locale === 'en' ? EN_DIVISION : ZH_DIVISION
  return names[division] ?? division
}

/**
 * Group entries by division, in the fixed division order.
 * @param experts - entries to group.
 * @param locale - language for division labels.
 * @returns the non-empty groups.
 */
export function groupByDivision(experts: readonly ExpertSummary[], locale: ClientLocale): DivisionGroup[] {
  const known = new Set<string>(DIVISION_ORDER)
  const extra = [...new Set(experts.map((expert) => expert.division))].filter((division) => !known.has(division))
  const groups: DivisionGroup[] = []
  for (const division of [...DIVISION_ORDER, ...extra]) {
    const members = experts.filter((expert) => expert.division === division)
    if (members.length === 0) continue
    groups.push({ division, label: groupLabel(division, locale), experts: [...members].sort((a, b) => a.slug.localeCompare(b.slug)) })
  }
  return groups
}

/**
 * Division filter entries with their counts.
 * @param experts - the unfiltered roster.
 * @param locale - language for division labels.
 * @returns one entry per division that has members, plus a leading "all" entry.
 */
export function divisionOptions(experts: readonly ExpertSummary[], locale: ClientLocale): Array<{ value: string; label: string }> {
  const known = new Set<string>(DIVISION_ORDER)
  const present = [...new Set(experts.map((expert) => expert.division))]
  const order = [...DIVISION_ORDER.filter((division) => present.includes(division)), ...present.filter((division) => !known.has(division))]
  const count = (division: string): number => experts.filter((expert) => expert.division === division).length
  return [
    { value: '', label: formatClient(locale, 'filter.division.all') },
    ...order.map((division) => ({
      value: division,
      label: formatClient(locale, 'filter.division.option', { name: groupLabel(division, locale), count: count(division) }),
    })),
  ]
}

/**
 * Whether a failure is the Host's revision conflict rather than a real error.
 * @param error - a caught value.
 * @returns whether the settings revision moved under us.
 */
export function isConflict(error: unknown): boolean {
  return isSettingsConflict(error)
}

/** Visible name including the summon icon, as the `@` menu renders it. */
export function candidateName(expert: ExpertSummary): string {
  return expert.emoji === '' ? expert.name : `${expert.emoji} ${expert.name}`
}

/** The plain-text mention a reference projects to, terminated by a hard space. */
export function mentionText(expert: ExpertSummary | undefined, locale: ClientLocale): string {
  if (expert === undefined) return `${formatClient(locale, 'mention.removed')}\u00A0`
  return `@${expert.name}\u00A0`
}

/** Reference source id; stable across languages so drafts keep their codec. */
export function referenceSource(division: string): string {
  return `${PLUGIN_ID}:${division}`
}

/**
 * Project one expert onto the host's atomic reference.
 * @param expert - roster entry.
 * @param locale - language for the mention text.
 * @returns the reference to insert.
 */
export function buildReference(expert: ExpertSummary, locale: ClientLocale): ReferenceInsert {
  return {
    source: referenceSource(expert.division),
    ref: expert.slug,
    label: expert.name,
    appearance: 'session',
    clipboardText: mentionText(expert, locale),
  }
}

/**
 * Names the host may decorate as plain-text references: enabled experts only.
 * @param experts - roster entries.
 * @param enabled - enabled slugs.
 * @returns the name lexicon.
 */
export function buildLexicon(experts: readonly ExpertSummary[], enabled: ReadonlySet<string>): string[] {
  return experts.filter((expert) => enabled.has(expert.slug)).map((expert) => expert.name)
}

// ---------------------------------------------------------------------------
// Styles. Inline text in a `ctx.effect`-owned <style> tag: the bundle carries no
// CSS pipeline, and this plugin owns no stylesheet of the shell's.
// ---------------------------------------------------------------------------

const CSS = `
.aall-section{box-sizing:border-box;display:flex;flex-direction:column;gap:16px;width:100%;max-width:880px;margin:0 auto;padding:0 0 32px;color:var(--dsw-alias-label-primary)}
.aall-head{display:flex;flex-wrap:wrap;align-items:flex-start;gap:12px}
.aall-head-text{flex:1 1 260px;min-width:0}
.aall-title{margin:0;font-size:20px;line-height:32px;font-weight:650}
.aall-summary{margin:8px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.aall-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-left:auto}
.aall-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:0 12px;border:1px solid transparent;border-radius:8px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-size:13px;font-weight:550;cursor:pointer}
.aall-btn:hover:not(:disabled){opacity:.9}
.aall-btn:disabled{opacity:.5;cursor:default}
.aall-btn-secondary{background:transparent;border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.aall-btn-secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);opacity:1}
.aall-btn:focus-visible,.aall-control:focus-visible,.aall-switch-input:focus-visible+.aall-switch-track,.aall-segment:focus-visible{outline:2px solid var(--dsw-alias-state-success-primary);outline-offset:2px}
.aall-filters{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px}
.aall-field{display:flex;flex:1 1 220px;min-width:0;flex-direction:column;gap:6px}
.aall-field-narrow{flex:0 1 200px}
.aall-label{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px}
.aall-control{box-sizing:border-box;width:100%;min-height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.aall-segmented{align-self:flex-start;display:inline-flex;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.aall-segment{min-height:28px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.aall-segment[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}
.aall-error{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px}
.aall-note{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.aall-empty{padding:24px 16px;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;text-align:center}
.aall-group{display:flex;flex-direction:column;gap:6px}
.aall-group-title{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;margin:0;padding:8px 0 6px;font-size:16px;line-height:22px;font-weight:650;background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l2)}
.aall-group-title::before{content:"";flex:0 0 auto;width:3px;height:16px;border-radius:2px;background:var(--dsw-alias-label-primary)}
.aall-group-count{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:18px;padding:0 6px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;font-weight:600}
.aall-list{display:flex;flex-direction:column;gap:6px}
.aall-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.aall-card[data-enabled="true"]{border-color:var(--dsw-alias-state-success-primary)}
.aall-card-body{display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:10px;padding:10px 12px}
.aall-emoji{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:var(--dsw-alias-bg-layer-3);font-size:18px}
.aall-identity{min-width:0}
.aall-name{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;font-size:15px;font-weight:650;line-height:22px}
.aall-name-en{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400}
.aall-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:4px}
.aall-division{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.aall-badges{display:flex;flex-wrap:wrap;gap:6px}
.aall-badge{padding:1px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}
.aall-intro{margin:6px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;white-space:pre-wrap}
.aall-description{margin:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.aall-switch{position:relative;align-self:start;display:inline-flex;align-items:center;cursor:pointer}
.aall-switch-input{position:absolute;inset:0;width:1px;height:1px;margin:0;padding:0;opacity:0;pointer-events:none}
.aall-switch-track{position:relative;display:block;width:40px;height:22px;border:1px solid var(--dsw-alias-border-l3);border-radius:11px;background:var(--dsw-alias-bg-layer-3);transition:background 160ms ease,border-color 160ms ease}
.aall-switch-track::after{position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary);content:"";transition:transform 160ms ease,background 160ms ease}
.aall-switch-input:checked+.aall-switch-track{border-color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 32%,transparent)}
.aall-switch-input:checked+.aall-switch-track::after{transform:translateX(18px);background:var(--dsw-alias-label-primary)}
.aall-switch-input:disabled+.aall-switch-track{opacity:.5}
.aall-card-foot{display:flex;flex-wrap:wrap;gap:8px;padding:0 12px 10px}
.aall-link{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:18px;cursor:pointer}
.aall-link:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.aall-link:disabled{opacity:.5;cursor:default}
.aall-modal{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.56)}
.aall-dialog{display:flex;flex-direction:column;box-sizing:border-box;width:min(760px,100%);max-height:min(720px,100%);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2));box-shadow:var(--dsw-shadow-lv3)}
.aall-dialog-narrow{width:min(520px,100%)}
.aall-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.aall-dialog-title{margin:0;font-size:15px;line-height:22px}
.aall-dialog-body{display:flex;flex-direction:column;gap:12px;overflow:auto;padding:16px}
.aall-dialog-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--dsw-alias-border-l2)}
.aall-prompt{margin:0;padding:16px;overflow:auto;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.65}
.aall-fieldset{display:flex;flex-direction:column;gap:6px}
.aall-textarea{min-height:160px;padding:8px 10px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.6}
.aall-check{display:inline-flex;align-items:center;gap:8px;font-size:13px}
.aall-check-control{min-height:34px;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer}
.aall-btn-wrap{position:relative;display:inline-flex;flex:0 0 auto}
.aall-menu{position:absolute;bottom:calc(100% + 6px);left:0;z-index:10000;box-sizing:border-box;display:flex;flex-direction:column;width:280px;max-height:min(420px,60vh);overflow:auto;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2));box-shadow:var(--dsw-shadow-lv3)}
.aall-menu-group{padding:6px 10px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.aall-menu-item{display:flex;align-items:center;gap:8px;width:100%;min-height:36px;padding:6px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.aall-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.aall-menu-empty{padding:10px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
@media (max-width:640px){.aall-card-body{grid-template-columns:32px minmax(0,1fr)}.aall-card-body>.aall-switch{grid-column:1/-1}}
@media (prefers-reduced-motion:reduce){.aall-switch-track,.aall-switch-track::after{transition:none}}
`

// ---------------------------------------------------------------------------
// Icons. Drawn inline: the frozen platform table exposes no icon set.
// ---------------------------------------------------------------------------

function lineIcon(size: number, path: string): React.ReactElement {
  return React.createElement('svg', {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
  }, React.createElement('path', { d: path }))
}

/**
 * A solid glyph. Sparkles read as a blob when stroked at label size, so the
 * summon mark is filled instead of joining the stroked set above.
 * @param size - square edge in px.
 * @param path - the glyph outline.
 * @returns the icon element.
 */
function solidIcon(size: number, path: string): React.ReactElement {
  return React.createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'currentColor',
    'aria-hidden': true,
    focusable: false,
  }, React.createElement('path', { d: path }))
}

/**
 * Summon mark: one four-point sparkle with a small companion.
 *
 * The quadratic control points sit close to the centre, which is what pulls the
 * waist concave; a straight-line star reads as a plain asterisk instead.
 * @returns the icon element.
 */
function SparkIcon(): React.ReactElement {
  return solidIcon(15, 'M9.8 2.4Q11.3 9.7 18.6 11.2Q11.3 12.7 9.8 20Q8.3 12.7 1 11.2Q8.3 9.7 9.8 2.4Z'
    + 'M19.4 13.6Q20 17 23 17.6Q20 18.2 19.4 21.6Q18.8 18.2 15.8 17.6Q18.8 17 19.4 13.6Z')
}

function CopyIcon(): React.ReactElement {
  return lineIcon(14, 'M9 9h9v9H9zM6 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1')
}

function EyeIcon(): React.ReactElement {
  return lineIcon(14, 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z')
}

function PlusIcon(): React.ReactElement {
  return lineIcon(14, 'M12 5v14M5 12h14')
}

// ---------------------------------------------------------------------------
// Composer button: insert an enabled expert as an atomic reference.
// ---------------------------------------------------------------------------

/** Minimal face of the per-session input machine the button writes through. */
interface ReferenceInsertionTarget {
  readonly state: {
    getSnapshot(): {
      readonly draft: string
      readonly draftRev: number
      readonly occurrences?: ReadonlyArray<{ readonly source: string; readonly offset: number }>
    }
  }
  insertReference(reference: ReferenceInsert, span: TokenSpan): boolean
}

/** Session registry face used to resolve the current input machine. */
interface SessionAccess {
  readonly list?: { getSnapshot(): { readonly current?: SessionId } }
  scope?(id: SessionId): CordisClientContext | undefined
  binding?(id: SessionId): { readonly ctx: CordisClientContext } | undefined
}

/** Conversation registry face exposing the per-session input machine. */
interface ConversationAccess {
  readonly input: { for(actx: CordisClientContext): ReferenceInsertionTarget | undefined }
}

/**
 * Resolve the current session's input machine.
 * @param sessions - session registry.
 * @param sessionId - session the slot belongs to, when the slot supplies one.
 * @param getConversation - conversation registry resolver.
 * @returns the insertion target, or undefined when unavailable.
 */
export function resolveInsertionTarget(
  sessions: SessionAccess,
  sessionId?: SessionId,
  getConversation?: (actx: CordisClientContext) => ConversationAccess | undefined,
): ReferenceInsertionTarget | undefined {
  const target = sessionId ?? sessions.list?.getSnapshot().current
  if (target === undefined) return undefined
  const actx = sessions.scope?.(target) ?? sessions.binding?.(target)?.ctx
  return actx === undefined ? undefined : getConversation?.(actx)?.input.for(actx)
}

/**
 * Insert one reference at the end of the leading reference run, so a second
 * expert appends after the first instead of jumping to the caret.
 * @param target - input machine, when resolvable.
 * @param reference - reference to insert.
 * @returns whether the insert was accepted.
 */
export function insertReference(target: ReferenceInsertionTarget | undefined, reference: ReferenceInsert): boolean {
  if (target === undefined) return false
  const snapshot = target.state.getSnapshot()
  const offsets = new Set((snapshot.occurrences ?? []).map((occurrence) => occurrence.offset))
  let offset = 0
  while (offsets.has(offset)) {
    offset += 1
    if (snapshot.draft[offset] === ' ') offset += 1
  }
  // Older hosts publish no occurrences; the draft then carries the object
  // replacement character for each atomic reference.
  while (snapshot.draft[offset] === '\uFFFC') {
    offset += 1
    if (snapshot.draft[offset] === ' ') offset += 1
  }
  return target.insertReference(reference, { start: offset, end: offset, draftRev: snapshot.draftRev })
}

interface ComposerProps extends PropsLocale<'agencyLL'> {
  readonly remote: AgencyRosterRemote
  readonly locale: () => ClientLocale
  readonly insertReference?: (reference: ReferenceInsert) => boolean
}

function ComposerButton(props: ComposerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const state = React.useSyncExternalStore(
    (listener) => subscribeCatalog(props.remote, listener),
    () => catalogState(props.remote),
  )
  const enabled = state.snapshot === undefined ? [] : state.snapshot.experts.filter((expert) => state.enabled.has(expert.slug))
  const groups = groupByDivision(enabled, props.locale())

  const pick = (expert: ExpertSummary): void => {
    if (props.insertReference?.(buildReference(expert, props.locale())) !== true) {
      setError(props.t('error.insertFailed'))
      return
    }
    setError(null)
    setOpen(false)
  }

  return React.createElement('div', { className: 'aall-btn-wrap' },
    React.createElement('button', {
      type: 'button',
      className: 'aall-btn aall-btn-secondary',
      title: props.t('menu.title'),
      'aria-expanded': open,
      onClick: () => { setError(null); setOpen((current) => !current) },
    }, React.createElement(SparkIcon, null), React.createElement('span', null, props.t('menu.button'))),
    open
      ? React.createElement('div', { className: 'aall-menu', role: 'menu' },
        error === null ? null : React.createElement('div', { className: 'aall-error', role: 'alert' }, error),
        groups.length === 0
          ? React.createElement('div', { className: 'aall-menu-empty' }, props.t('menu.empty'))
          : groups.map((group) => React.createElement('div', { key: group.division },
            React.createElement('div', { className: 'aall-menu-group' }, group.label),
            group.experts.map((expert) => React.createElement('button', {
              key: expert.slug,
              type: 'button',
              role: 'menuitem',
              className: 'aall-menu-item',
              onClick: () => { pick(expert) },
            }, React.createElement('span', null, expert.emoji), React.createElement('span', null, expert.name))))))
      : null)
}

// ---------------------------------------------------------------------------
// Prompt viewer.
// ---------------------------------------------------------------------------

interface PromptView {
  readonly title: string
  readonly body: string
  readonly note: string | null
}

function PromptDialog(props: {
  readonly view: PromptView
  readonly t: (key: AgencyClientKey) => string
  readonly onClose: () => void
}): React.ReactElement {
  return React.createElement('div', { className: 'aall-modal', role: 'presentation', onClick: props.onClose },
    React.createElement('div', {
      className: 'aall-dialog',
      role: 'dialog',
      'aria-modal': true,
      'aria-label': props.view.title,
      onClick: (event: React.MouseEvent) => { event.stopPropagation() },
    },
      React.createElement('div', { className: 'aall-dialog-head' },
        React.createElement('h3', { className: 'aall-dialog-title' }, props.view.title),
        React.createElement('button', { type: 'button', className: 'aall-btn aall-btn-secondary', onClick: props.onClose }, props.t('prompt.close'))),
      props.view.note === null ? null : React.createElement('div', { className: 'aall-note', style: { padding: '10px 16px 0' } }, props.view.note),
      React.createElement('pre', { className: 'aall-prompt' }, props.view.body)))
}

// ---------------------------------------------------------------------------
// Custom expert editor.
// ---------------------------------------------------------------------------

interface EditorState {
  readonly draft: CustomExpertInput
  readonly enabled: boolean
  readonly revision: number
}

/**
 * Drop the fields the wire rejects. A strict codec on the Host side refuses an
 * empty emoji or an empty slug, so the draft is normalized before it is sent.
 * @param draft - raw editor draft.
 * @returns the normalized draft.
 */
export function normalizeDraft(draft: CustomExpertInput): CustomExpertInput {
  const emoji = (draft.emoji ?? '').trim()
  return {
    name: (draft.name ?? '').trim(),
    description: (draft.description ?? '').trim(),
    division: draft.division,
    emoji: emoji === '' ? DEFAULT_EXPERT_EMOJI : emoji,
    intro: (draft.intro ?? '').trim(),
    prompt: (draft.prompt ?? '').trim(),
    ...(draft.slug === undefined ? {} : { slug: draft.slug }),
  }
}

/**
 * Validate one editor draft with the same schema the Host enforces, so the user
 * sees the failure before the round trip.
 * @param draft - raw editor draft.
 * @returns `null` when valid, otherwise the first reason.
 */
export function validateDraft(draft: CustomExpertInput): string | null {
  const parsed = customExpertInputSchema.safeParse(normalizeDraft(draft))
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'invalid')
}

interface EditorProps {
  readonly state: EditorState
  readonly busy: boolean
  readonly error: string | null
  readonly t: (key: AgencyClientKey) => string
  readonly onChange: (next: CustomExpertInput) => void
  readonly onToggleEnabled: (next: boolean) => void
  readonly onCancel: () => void
  readonly onSave: () => void
}

function CustomEditor(props: EditorProps): React.ReactElement {
  const { state, t } = props
  const draft = state.draft

  const textField = (key: 'name' | 'description' | 'emoji' | 'intro' | 'prompt', label: AgencyClientKey, options?: { readonly textarea?: boolean; readonly max?: number }): React.ReactElement => {
    const id = `aall-field-${key}`
    const shared = {
      id,
      className: options?.textarea === true ? 'aall-control aall-textarea' : 'aall-control',
      value: String(draft[key] ?? ''),
      maxLength: options?.max,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        props.onChange({ ...draft, [key]: event.target.value })
      },
    }
    return React.createElement('div', { className: 'aall-fieldset', key },
      React.createElement('label', { className: 'aall-label', htmlFor: id }, t(label)),
      options?.textarea === true
        ? React.createElement('textarea', shared)
        : React.createElement('input', { ...shared, type: 'text' }))
  }

  return React.createElement('div', { className: 'aall-modal', role: 'presentation', onClick: props.busy ? undefined : props.onCancel },
    React.createElement('div', {
      className: 'aall-dialog',
      role: 'dialog',
      'aria-modal': true,
      'aria-label': t(draft.slug === undefined ? 'custom.newTitle' : 'custom.editTitle'),
      onClick: (event: React.MouseEvent) => { event.stopPropagation() },
    },
      React.createElement('div', { className: 'aall-dialog-head' },
        React.createElement('h3', { className: 'aall-dialog-title' }, t(draft.slug === undefined ? 'custom.newTitle' : 'custom.editTitle')),
        React.createElement('button', { type: 'button', className: 'aall-btn aall-btn-secondary', disabled: props.busy, onClick: props.onCancel }, t('custom.cancel'))),
      React.createElement('div', { className: 'aall-dialog-body' },
        props.error === null ? null : React.createElement('div', { className: 'aall-error', role: 'alert' }, props.error),
        textField('name', 'custom.name', { max: 40 }),
        textField('description', 'custom.description', { max: 160 }),
        React.createElement('div', { className: 'aall-fieldset' },
          React.createElement('label', { className: 'aall-label', htmlFor: 'aall-field-division' }, t('custom.division')),
          React.createElement('select', {
            id: 'aall-field-division',
            className: 'aall-control',
            value: draft.division,
            onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { props.onChange({ ...draft, division: event.target.value }) },
          }, DIVISION_ORDER.map((division) => React.createElement('option', { key: division, value: division }, ZH_DIVISION[division] ?? division)))),
        textField('emoji', 'custom.emoji'),
        textField('intro', 'custom.intro', { textarea: true }),
        textField('prompt', 'custom.prompt', { textarea: true }),
        React.createElement('div', { className: 'aall-note' }, t('custom.promptHint')),
        React.createElement('label', { className: 'aall-check' },
          React.createElement('input', {
            type: 'checkbox',
            checked: state.enabled,
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => { props.onToggleEnabled(event.target.checked) },
          }),
          t('custom.enabled'))),
      React.createElement('div', { className: 'aall-dialog-foot' },
        React.createElement('button', { type: 'button', className: 'aall-btn aall-btn-secondary', disabled: props.busy, onClick: props.onCancel }, t('custom.cancel')),
        React.createElement('button', { type: 'button', className: 'aall-btn', disabled: props.busy, onClick: props.onSave }, props.busy ? t('custom.saving') : t('custom.save')))))
}

// ---------------------------------------------------------------------------
// Settings page.
// ---------------------------------------------------------------------------

/** One bound settings namespace, as the settings base service hands it out. */
interface PromptLocaleScope {
  getSnapshot(): { readonly value?: { readonly promptLocale?: CatalogSnapshot['promptLocale'] } }
  set(field: string, value: unknown): Promise<void>
}

interface SectionProps extends PropsLocale<'agencyLL'> {
  readonly remote: AgencyRosterRemote
  readonly locale: () => ClientLocale
  readonly promptLocaleScope: PromptLocaleScope
}

/** No card is mid-write. Shared so the empty case keeps one reference. */
const NO_PENDING: ReadonlySet<string> = new Set<string>()

/**
 * The page's own failure floor.
 *
 * `settings.section` is one slot entry, and the renderer retires an entry whose
 * component throws — permanently, for the life of the page. Catching here keeps
 * one bad render a visible message instead of an empty settings panel.
 */
class SectionBoundary extends React.Component<
  { readonly t: SectionProps['t']; readonly onError: (error: Error) => void; readonly children?: React.ReactNode },
  { readonly error: Error | null }
> {
  override state: { readonly error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { readonly error: Error | null } {
    return { error }
  }

  override componentDidCatch(error: Error): void {
    this.props.onError(error)
  }

  override render(): React.ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children
    const detail = `${error.name}: ${error.message}`
    return React.createElement('div', { className: 'aall-error', role: 'alert' }, this.props.t('error.render').replace('{detail}', detail))
  }
}

/** One roster row. Memoized: a write re-renders its own card, not all 279. */
interface CardProps {
  readonly expert: ExpertSummary
  readonly on: boolean
  readonly pending: boolean
  readonly copied: boolean
  readonly locale: ClientLocale
  readonly t: SectionProps['t']
  readonly onToggle: (expert: ExpertSummary) => void
  readonly onView: (expert: ExpertSummary) => void
  readonly onCopy: (expert: ExpertSummary) => void
  readonly onEdit: (expert: ExpertSummary) => void
  readonly onDelete: (expert: ExpertSummary) => void
}

const RosterCard = React.memo(function RosterCard(props: CardProps): React.ReactElement {
  const { expert, on, t } = props
  const label = t(on ? 'toggle.disable' : 'toggle.enable')
  return React.createElement('div', { className: 'aall-card', 'data-enabled': on },
    React.createElement('div', { className: 'aall-card-body' },
      React.createElement('div', { className: 'aall-emoji', 'aria-hidden': true }, expert.emoji),
      React.createElement('div', { className: 'aall-identity' },
        React.createElement('div', { className: 'aall-name' },
          React.createElement('span', null, expert.name),
          expert.nameEn === expert.name ? null : React.createElement('span', { className: 'aall-name-en' }, expert.nameEn)),
        React.createElement('div', { className: 'aall-meta' },
          React.createElement('span', { className: 'aall-division' }, groupLabel(expert.division, props.locale)),
          React.createElement('div', { className: 'aall-badges' },
            expert.custom ? React.createElement('span', { className: 'aall-badge' }, t('badge.custom')) : null,
            React.createElement('span', { className: 'aall-badge' }, t(expert.translated ? 'badge.translated' : 'badge.notTranslated')),
            expert.conflict ? React.createElement('span', { className: 'aall-badge' }, t('badge.conflict')) : null)),
        React.createElement('p', { className: 'aall-intro' },
          React.createElement('strong', null, `${t('card.introHeading')}: `),
          expert.intro.trim() === '' ? t('card.introMissing') : expert.intro),
        React.createElement('p', { className: 'aall-description' }, expert.description)),
      // The switch carries no text label: the track and the card border already
      // say on or off, and the freed column lets the introduction reach further
      // right, which is what shortens every card.
      React.createElement('label', { className: 'aall-switch', title: label },
        React.createElement('input', {
          type: 'checkbox',
          className: 'aall-switch-input',
          checked: on,
          disabled: props.pending || expert.conflict,
          'aria-label': `${label} ${expert.name}`,
          onChange: () => { props.onToggle(expert) },
        }),
        React.createElement('span', { className: 'aall-switch-track' }))),
    React.createElement('div', { className: 'aall-card-foot' },
      React.createElement('button', { type: 'button', className: 'aall-link', disabled: props.pending, onClick: () => { props.onView(expert) } },
        React.createElement(EyeIcon, null), React.createElement('span', null, t('card.viewPrompt'))),
      React.createElement('button', { type: 'button', className: 'aall-link', disabled: props.pending, onClick: () => { props.onCopy(expert) } },
        React.createElement(CopyIcon, null), React.createElement('span', null, t(props.copied ? 'card.copied' : 'card.copyPrompt'))),
      // Shipped experts have nothing to edit, so they show no third action; the
      // page header owns "new custom expert".
      expert.custom
        ? React.createElement('button', { type: 'button', className: 'aall-link', disabled: props.pending, onClick: () => { props.onEdit(expert) } }, t('custom.edit'))
        : null,
      expert.custom
        ? React.createElement('button', { type: 'button', className: 'aall-link', disabled: props.pending, onClick: () => { props.onDelete(expert) } }, t('custom.delete'))
        : null))
})

function RosterSection(props: SectionProps): React.ReactElement {
  const { t } = props
  const locale = props.locale()
  const subscription = catalogSubscription(props.remote)
  const state = React.useSyncExternalStore(subscription.subscribe, subscription.getSnapshot)
  const [loading, setLoading] = React.useState(state.snapshot === undefined)
  const [query, setQuery] = React.useState('')
  const [division, setDivision] = React.useState('')
  const [enabledOnly, setEnabledOnly] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [pending, setPending] = React.useState<ReadonlySet<string>>(NO_PENDING)
  const [error, setError] = React.useState<string | null>(null)
  const [note, setNote] = React.useState<string | null>(null)
  const [preference, setPreference] = React.useState<CatalogSnapshot['promptLocale']>('en')
  const [promptView, setPromptView] = React.useState<PromptView | null>(null)
  const [copied, setCopied] = React.useState<string | null>(null)
  const [editor, setEditor] = React.useState<EditorState | null>(null)
  const [editorError, setEditorError] = React.useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<ExpertSummary | null>(null)
  const saving = React.useRef(false)

  /** Fill in the `{detail}` placeholder of a failure message. */
  const fail = React.useCallback((key: AgencyClientKey, cause: unknown): void => {
    const detail = cause instanceof Error ? cause.message : String(cause)
    setError(t(key).replace('{detail}', detail))
  }, [t])

  const load = React.useCallback((): void => {
    void refreshCatalog(props.remote).then((current) => {
      setLoading(false)
      setError(null)
      setPreference(current.promptLocale)
    }).catch((cause: unknown) => { setLoading(false); fail('error.load', cause) })
  }, [props.remote, fail])

  React.useEffect(() => { load() }, [load])

  React.useEffect(() => {
    const scoped = props.promptLocaleScope.getSnapshot().value?.promptLocale
    if (scoped !== undefined) setPreference(scoped)
  }, [props.promptLocaleScope, state.revision])

  const snapshot = state.snapshot
  const experts = snapshot?.experts ?? []
  const enabled = state.enabled

  /** A tripped revision fence reloads the roster instead of retrying blind. */
  const handleFailure = React.useCallback((cause: unknown): void => {
    if (!isConflict(cause)) {
      fail('error.save', cause)
      return
    }
    void refreshCatalog(props.remote).then(
      () => { setError(t('error.conflict')) },
      () => { setError(t('error.conflict.refreshFailed')) },
    )
  }, [props.remote, fail, t])

  const markSettled = React.useCallback((slug: string): void => {
    setPending((prev) => {
      if (!prev.has(slug)) return prev
      const next = new Set(prev)
      next.delete(slug)
      return next
    })
  }, [])

  /**
   * Queue one card write. Writes run in click order and each reads the revision
   * at its own turn, so clicking three experts in a row enables all three
   * instead of dropping the ones that raced.
   */
  const queue = React.useRef<Promise<unknown>>(Promise.resolve())
  const enqueue = React.useCallback((slug: string, work: () => Promise<void>): void => {
    setPending((prev) => new Set(prev).add(slug))
    queue.current = queue.current.then(work).then(
      () => { markSettled(slug) },
      (cause: unknown) => { markSettled(slug); handleFailure(cause) },
    )
  }, [markSettled, handleFailure])

  /** Page-level write: only the header, the filters and the dialogs go busy. */
  const runWrite = React.useCallback(async (work: () => Promise<void>): Promise<void> => {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (cause: unknown) {
      handleFailure(cause)
    } finally {
      saving.current = false
      setBusy(false)
    }
  }, [handleFailure])

  const toggle = React.useCallback((expert: ExpertSummary): void => {
    enqueue(expert.slug, async () => {
      const current = catalogState(props.remote)
      if (current.snapshot === undefined) return
      const next = new Set(current.enabled)
      if (next.has(expert.slug)) next.delete(expert.slug)
      else next.add(expert.slug)
      await writeEnabled(props.remote, next, current.revision)
    })
  }, [props.remote, enqueue])

  const readPrompt = async (expert: ExpertSummary): Promise<PromptView> => {
    const result = await props.remote.getPrompt(expert.slug, expert.division)
    if (!result.ok) throw new Error(result.error.message)
    const served = t(result.value.locale === 'zh' ? 'prompt.locale.zh' : 'prompt.locale.en')
    return {
      title: t('prompt.title').replace('{name}', expert.name),
      body: result.value.prompt,
      note: result.value.fallback ? `${served} · ${t('prompt.fallback')}` : served,
    }
  }

  const viewPrompt = React.useCallback((expert: ExpertSummary): void => {
    void runWrite(async () => {
      setPromptView({ title: t('prompt.title').replace('{name}', expert.name), body: t('prompt.loading'), note: null })
      setPromptView(await readPrompt(expert))
    })
  // readPrompt closes over props.remote and t only; both are stable per face.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runWrite, props.remote, t])

  const copyPrompt = React.useCallback((expert: ExpertSummary): void => {
    void runWrite(async () => {
      const view = await readPrompt(expert)
      try {
        await navigator.clipboard.writeText(view.body)
        setCopied(expert.slug)
      } catch {
        setNote(t('card.copyFailed'))
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runWrite, props.remote, t])

  const openEditor = React.useCallback((expert?: ExpertSummary): void => {
    const current = catalogState(props.remote)
    if (current.snapshot === undefined) return
    setEditorError(null)
    if (expert === undefined) {
      setEditor({
        draft: { name: '', description: '', division: DIVISION_ORDER[0] ?? 'engineering', emoji: DEFAULT_EXPERT_EMOJI, intro: '', prompt: '' },
        enabled: true,
        revision: current.snapshot.revision,
      })
      return
    }
    void runWrite(async () => {
      const result = await props.remote.getCustomExpert(expert.slug)
      if (!result.ok) throw new Error(result.error.message)
      setEditor({ draft: result.value, enabled: current.enabled.has(expert.slug), revision: current.snapshot?.revision ?? current.revision })
    })
  }, [props.remote, runWrite])

  const saveEditor = (): void => {
    if (editor === null) return
    const invalid = validateDraft(editor.draft)
    if (invalid !== null) {
      setEditorError(invalid)
      return
    }
    setEditorError(null)
    void runWrite(async () => {
      const result = await props.remote.saveCustomExpert(normalizeDraft(editor.draft), editor.enabled, editor.revision)
      if (!result.ok) throw new Error(result.error.message)
      acceptCatalog(props.remote, result.value)
      setEditor(null)
      setNote(t('custom.saved'))
    })
  }

  const removeExpert = (expert: ExpertSummary): void => {
    if (snapshot === undefined) return
    void runWrite(async () => {
      const current = catalogState(props.remote)
      const result = await props.remote.deleteCustomExpert(expert.slug, current.revision)
      if (!result.ok) throw new Error(result.error.message)
      acceptCatalog(props.remote, result.value)
      setPendingDelete(null)
      setNote(t('custom.deleted'))
    })
  }

  const savePreference = (next: CatalogSnapshot['promptLocale']): void => {
    setPreference(next)
    void runWrite(async () => {
      await props.promptLocaleScope.set('promptLocale', next)
      await refreshCatalog(props.remote)
    })
  }

  if (snapshot === undefined) {
    return React.createElement('div', { className: 'aall-section' },
      React.createElement('div', { className: 'aall-empty' }, loading ? t('loading') : t('empty')),
      loading ? null : React.createElement('div', { className: 'aall-actions' },
        React.createElement('button', { type: 'button', className: 'aall-btn', onClick: load }, t('retry'))))
  }

  // Roster order, deliberately: re-sorting enabled entries to the front moved
  // rows out from under the pointer on every write. Enabled state is carried by
  // the switch, the card border and the summary count instead.
  const scoped = enabledOnly ? experts.filter((expert) => enabled.has(expert.slug)) : experts
  const filtered = filterExperts(scoped, division, query)
  const groups = groupByDivision(filtered, locale)
  const customCount = experts.filter((expert) => expert.custom).length

  const card = (expert: ExpertSummary): React.ReactElement => React.createElement(RosterCard, {
    key: expert.slug,
    expert,
    on: enabled.has(expert.slug),
    pending: pending.has(expert.slug),
    copied: copied === expert.slug,
    locale,
    t,
    onToggle: toggle,
    onView: viewPrompt,
    onCopy: copyPrompt,
    onEdit: openEditor,
    onDelete: setPendingDelete,
  })

  return React.createElement('div', { className: 'aall-section' },
    React.createElement('div', { className: 'aall-head' },
      React.createElement('div', { className: 'aall-head-text' },
        React.createElement('h2', { className: 'aall-title' }, t('title')),
        React.createElement('p', { className: 'aall-summary' },
          `${t('summary.total').replace('{total}', String(experts.length))} · ${t('summary.enabled').replace('{enabled}', String(enabled.size))} · ${t('badge.custom')} ${customCount}`)),
      React.createElement('div', { className: 'aall-actions' },
        React.createElement('button', { type: 'button', className: 'aall-btn aall-btn-secondary', disabled: busy, onClick: load }, t('refresh')),
        React.createElement('button', { type: 'button', className: 'aall-btn', disabled: busy, onClick: () => { openEditor() } },
          React.createElement(PlusIcon, null), React.createElement('span', null, t('custom.add'))))),
    React.createElement('div', { className: 'aall-filters' },
      React.createElement('div', { className: 'aall-field' },
        React.createElement('label', { className: 'aall-label', htmlFor: 'aall-search' }, t('search')),
        React.createElement('input', {
          id: 'aall-search',
          className: 'aall-control',
          type: 'search',
          value: query,
          placeholder: t('search.placeholder'),
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => { setQuery(event.target.value) },
        })),
      React.createElement('div', { className: 'aall-field aall-field-narrow' },
        React.createElement('label', { className: 'aall-label', htmlFor: 'aall-division' }, t('filter.division')),
        React.createElement('select', {
          id: 'aall-division',
          className: 'aall-control',
          value: division,
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { setDivision(event.target.value) },
        }, divisionOptions(experts, locale).map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)))),
      React.createElement('label', { className: 'aall-check aall-check-control' },
        React.createElement('input', {
          type: 'checkbox',
          checked: enabledOnly,
          disabled: busy,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => { setEnabledOnly(event.target.checked) },
        }),
        t('filter.enabledOnly')),
      React.createElement('div', { className: 'aall-field aall-field-narrow' },
        React.createElement('span', { className: 'aall-label' }, t('promptLocale.label')),
        React.createElement('div', { className: 'aall-segmented', role: 'group', 'aria-label': t('promptLocale.label') },
          (['auto', 'zh', 'en'] as const).map((value) => React.createElement('button', {
            key: value,
            type: 'button',
            className: 'aall-segment',
            'aria-pressed': preference === value,
            disabled: busy,
            onClick: () => { savePreference(value) },
          }, t(value === 'auto' ? 'promptLocale.auto' : value === 'zh' ? 'promptLocale.zh' : 'promptLocale.en')))))),
    error === null ? null : React.createElement('div', { className: 'aall-error', role: 'alert' }, error),
    note === null ? null : React.createElement('div', { className: 'aall-note' }, note),
    groups.length === 0
      ? React.createElement('div', { className: 'aall-empty' },
        t('emptyFilter'),
        React.createElement('div', { style: { marginTop: '10px' } },
          React.createElement('button', {
            type: 'button',
            className: 'aall-btn aall-btn-secondary',
            onClick: () => { setQuery(''); setDivision(''); setEnabledOnly(false) },
          }, t('emptyFilter.reset'))))
      : groups.map((group) => React.createElement('section', { className: 'aall-group', key: group.division },
        React.createElement('h3', { className: 'aall-group-title' },
          group.label,
          React.createElement('span', { className: 'aall-group-count' }, String(group.experts.length))),
        React.createElement('div', { className: 'aall-list' }, group.experts.map(card)))),
    promptView === null ? null : React.createElement(PromptDialog, { view: promptView, t, onClose: () => { setPromptView(null) } }),
    editor === null ? null : React.createElement(CustomEditor, {
      state: editor,
      busy,
      error: editorError,
      t,
      onChange: (draft) => { setEditor({ ...editor, draft }) },
      onToggleEnabled: (next) => { setEditor({ ...editor, enabled: next }) },
      onCancel: () => { setEditor(null) },
      onSave: saveEditor,
    }),
    pendingDelete === null ? null : React.createElement('div', { className: 'aall-modal', role: 'presentation' },
      React.createElement('div', { className: 'aall-dialog aall-dialog-narrow', role: 'dialog', 'aria-modal': true },
        React.createElement('div', { className: 'aall-dialog-head' },
          React.createElement('h3', { className: 'aall-dialog-title' }, t('custom.deleteTitle'))),
        React.createElement('div', { className: 'aall-dialog-body' },
          t('custom.deleteConfirm').replace('{name}', pendingDelete.name)),
        React.createElement('div', { className: 'aall-dialog-foot' },
          React.createElement('button', { type: 'button', className: 'aall-btn aall-btn-secondary', disabled: busy, onClick: () => { setPendingDelete(null) } }, t('custom.cancel')),
          React.createElement('button', { type: 'button', className: 'aall-btn', disabled: busy, onClick: () => { removeExpert(pendingDelete) } }, t('custom.delete'))))))
}

// ---------------------------------------------------------------------------
// Plugin body.
// ---------------------------------------------------------------------------

export const inject = ['slots', 'inputTriggers', 'locale', 'remote', 'sessions', 'conversation', 'settingsScope']

/**
 * Mount the browser half.
 * @param ctx - client root context.
 * @returns nothing; every contribution is owned by `ctx.effect` or the slot ledger.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = PLUGIN_ID
    tag.textContent = CSS
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, `${PLUGIN_ID}: styles`)

  ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), `${PLUGIN_ID}: dictionaries`)

  const t = ctx.locale.bind(NS)
  const locale = (): ClientLocale => (ctx.locale.getSnapshot().active === 'en' ? 'en' : 'zh')
  const promptLocaleScope: PromptLocaleScope = ctx.settingsScope.bind<{ promptLocale?: CatalogSnapshot['promptLocale'] }>({ namespace: SETTINGS_NS })

  let remote: AgencyRosterRemote | undefined

  const rosterRemote = (): AgencyRosterRemote => {
    if (remote === undefined) throw new Error(t('error.load').replace('{detail}', 'agencyAgents'))
    return remote
  }

  /**
   * Mount the Remote contribution in this plugin's own fiber. Reading
   * `ctx.remote.agencyAgents` before mounting would require injecting a service
   * that does not exist yet, which deadlocks the plugin.
   * @returns whether a Remote face is now available.
   */
  const mountRemote = async (): Promise<boolean> => {
    const dispose = await ctx.remote.$mount(TYPERT_REMOTE)
    const mounted = ctx.get('remote.agencyAgents') as AgencyRosterRemote | undefined
    if (mounted === undefined) {
      ctx.logger.warn('[agency-agents-ll] the agencyAgents Remote namespace did not mount')
      await dispose()
      return false
    }
    remote = mounted
    ctx.effect(() => () => { void dispose() }, `${PLUGIN_ID}: remote contribution`)
    await refreshCatalog(mounted).catch((cause: unknown) => {
      ctx.logger.warn('[agency-agents-ll] the initial roster read failed; the settings page can retry', cause)
    })
    return true
  }

  /** Insert the reference through the session the slot belongs to. */
  const bindInsertion = (sessionId?: SessionId): { readonly insertReference: (reference: ReferenceInsert) => boolean } => ({
    insertReference: (reference) => insertReference(
      resolveInsertionTarget(
        ctx.sessions as unknown as SessionAccess,
        sessionId,
        (actx) => actx.get('conversation') as ConversationAccess | undefined,
      ),
      reference,
    ),
  })

  /**
   * Every contribution needs a mounted Remote face, so nothing is registered
   * before one exists. Registering first and looking the face up during render
   * would make a not-yet-mounted service a render-time throw — and a render-time
   * throw retires the slot entry for the life of the page.
   */
  const registerContributions = (): void => {
    const reportRenderFailure = (error: Error): void => {
      ctx.logger.warn(`[${PLUGIN_ID}] the roster page failed to render`, error)
    }

    ctx.slots.inject('settings.section', () => ctx.slots.register(
      { name: 'settings.section', id: SECTION_ID, order: 24, label: () => t('nav'), locale: NS },
      (props: PropsLocale<'agencyLL'>) => React.createElement(SectionBoundary, {
        t: props.t,
        onError: reportRenderFailure,
      }, React.createElement(RosterSection, {
        ...props,
        remote: rosterRemote(),
        locale,
        promptLocaleScope,
      })),
    ))

    ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
      {
        name: 'conversation.input.left',
        id: PLUGIN_ID,
        order: 0,
        locale: NS,
        // The slot injects the owning session id, so the button writes into the
        // composer it is rendered next to rather than into "the current" one.
        inject: bindInsertion,
      },
      (props: PropsLocale<'agencyLL'> & { readonly insertReference?: (reference: ReferenceInsert) => boolean }) => React.createElement(ComposerButton, {
        ...props,
        remote: rosterRemote(),
        locale,
      }),
    ))

    ctx.effect(() => ctx.inputTriggers.registerSource({
      trigger: '@',
      name: `${PLUGIN_ID}:@`,
      order: 200,
      showGroupTitle: true,
      candidates: async (_session, request) => {
        const current = await refreshCatalog(rosterRemote()).catch(() => undefined)
        if (current?.snapshot === undefined) return []
        const needle = normalizeQuery(request.query ?? '')
        return current.snapshot.experts
          .filter((expert) => current.enabled.has(expert.slug) && matchesQuery(expert, needle))
          .map((expert) => ({
            name: candidateName(expert),
            description: expert.intro === '' ? expert.description : expert.intro.slice(0, 80),
            hint: expert.slug,
            section: groupLabel(expert.division, locale()),
          }))
      },
      onPick: (pick) => {
        const current = catalogState(rosterRemote())
        const slug = pick.candidate.hint ?? ''
        const expert = current.snapshot?.experts.find((item) => item.slug === slug)
        if (expert === undefined || !current.enabled.has(slug)) return undefined
        return { insert: buildReference(expert, locale()) }
      },
      warm: () => { void refreshCatalog(rosterRemote()).catch(() => undefined) },
      lexicon: () => {
        const current = catalogState(rosterRemote())
        return current.snapshot === undefined ? undefined : buildLexicon(current.snapshot.experts, current.enabled)
      },
      subscribeLexicon: (_session, listener) => subscribeCatalog(rosterRemote(), listener),
      codec: {
        clipboardText: (ref) => mentionText(
          catalogState(rosterRemote()).snapshot?.experts.find((expert) => expert.slug === ref),
          locale(),
        ),
        serialize: async (ref) => {
          const current = await refreshCatalog(rosterRemote())
          const expert = current.snapshot?.experts.find((item) => item.slug === ref)
          if (expert === undefined || !current.enabled.has(ref)) throw new Error(t('error.unavailable'))
          return mentionText(expert, locale())
        },
      },
    }), `${PLUGIN_ID}: @ source`)
  }

  void mountRemote().then((mounted) => {
    if (mounted) registerContributions()
  }).catch((cause: unknown) => {
    ctx.logger.warn('[agency-agents-ll] mounting the Remote contribution failed; no UI was registered', cause)
  })
}
