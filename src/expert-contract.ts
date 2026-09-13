/**
 * Data contract shared by the Host Remote service and the browser half.
 *
 * This module must stay free of Host and browser dependencies: the client
 * bundle inlines everything that is not a platform-frozen module, so pulling a
 * Node built-in in here would break the browser build. It carries the zod
 * schemas that ride the Typert wire descriptors, which is why the shapes are
 * declared once here instead of being restated on both sides.
 */
import { z } from 'zod'

/** Most custom experts one installation may define. */
export const CUSTOM_EXPERT_LIMIT = 200

/** Longest custom persona body, in code points. */
export const CUSTOM_EXPERT_PROMPT_MAX = 20_000

/** Longest custom Chinese introduction, in code points. */
export const CUSTOM_EXPERT_INTRO_MAX = 2_000

/** Emoji served when a custom expert supplies none. */
export const DEFAULT_EXPERT_EMOJI = '🧩'

/** Stable slug shape for roster entries defined by the user. */
export const CUSTOM_EXPERT_SLUG = /^custom-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

/** Division directory names the roster serves, as the wire accepts them. */
const DIVISION_SLUG = /^[a-z][a-z0-9-]{0,63}$/u

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Whether a value is exactly one emoji, including skin-tone, flag and ZWJ
 * sequences. Plain text and multi-icon strings are refused.
 * @param value - candidate emoji.
 * @returns whether it is one pictographic grapheme.
 */
export function isExpertEmoji(value: string): boolean {
  return value.length <= 32
    && [...segmenter.segment(value)].length === 1
    && /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Presentation}|[0-9#*]\uFE0F?\u20E3/u.test(value)
}

/** Names reject the mention trigger and every line-breaking control character. */
const NAME_PATTERN = /^[^@\r\n\u0000-\u001f\u007f]+$/u

/**
 * One roster entry as the browser renders it.
 *
 * `name` is the display name (Chinese when the archive provides one, English
 * otherwise) while `nameEn` stays the upstream name, so the UI can always show
 * both. `intro` is the Chinese introduction — the deliverable this plugin
 * exists to surface — and is empty when the archive is missing. `translated`
 * says whether a Chinese persona body exists, which is what makes the prompt
 * language switch real for this expert.
 */
export const expertSummarySchema = z.object({
  slug: z.string(),
  division: z.string(),
  emoji: z.string(),
  name: z.string(),
  nameEn: z.string(),
  description: z.string(),
  descriptionEn: z.string(),
  intro: z.string(),
  translated: z.boolean(),
  custom: z.boolean(),
  conflict: z.boolean(),
})

/** One roster entry as the browser renders it. */
export type ExpertSummary = z.infer<typeof expertSummarySchema>

/** Roster snapshot: every entry, the enabled slugs, and the settings revision. */
export const catalogSnapshotSchema = z.object({
  experts: z.array(expertSummarySchema),
  enabled: z.array(z.string()),
  revision: z.number().int().min(0),
  promptLocale: z.enum(['auto', 'zh', 'en']),
})

/** Roster snapshot: every entry, the enabled slugs, and the settings revision. */
export type CatalogSnapshot = z.infer<typeof catalogSnapshotSchema>

/** Enabled-slug read-back, both for `setEnabled` and for the prompt language. */
export const enabledStateSchema = z.object({
  enabled: z.array(z.string()),
  revision: z.number().int().min(0),
})

/** Enabled-slug read-back. */
export type EnabledState = z.infer<typeof enabledStateSchema>

/** One persona body, in the language the current preference resolves to. */
export const expertPromptSchema = z.object({
  prompt: z.string(),
  locale: z.enum(['zh', 'en']),
  fallback: z.boolean(),
})

/** One persona body plus the language actually served. */
export type ExpertPrompt = z.infer<typeof expertPromptSchema>

/**
 * The persona-language preference and what it currently resolves to. The
 * preference lives in the settings section the browser reads directly; this
 * shape exists so the roster can label a prompt honestly.
 */
export const promptLocaleStateSchema = z.object({
  preference: z.enum(['auto', 'zh', 'en']),
  effective: z.enum(['zh', 'en']),
})

/** Persona-language preference plus its resolution. */
export type PromptLocaleState = z.infer<typeof promptLocaleStateSchema>

/**
 * A user-authored expert. `slug` is present only when editing: leaving it out
 * creates a new expert and the Host mints the slug.
 */
export const customExpertInputSchema = z.object({
  slug: z.string().regex(CUSTOM_EXPERT_SLUG).optional(),
  name: z.string().trim().min(1).max(40).regex(NAME_PATTERN),
  description: z.string().trim().min(1).max(160),
  division: z.string().regex(DIVISION_SLUG),
  emoji: z.string().trim().min(1).max(32).refine(isExpertEmoji),
  intro: z.string().trim().min(1).max(CUSTOM_EXPERT_INTRO_MAX),
  prompt: z.string().trim().min(1).max(CUSTOM_EXPERT_PROMPT_MAX),
}).strict()

/** Wire/editor input for one custom expert. */
export type CustomExpertInput = z.input<typeof customExpertInputSchema>

/** A stored custom expert: the editor input plus the Host-minted slug. */
export const customExpertSchema = customExpertInputSchema.extend({
  slug: z.string().regex(CUSTOM_EXPERT_SLUG),
})

/** A stored custom expert. */
export type CustomExpert = z.output<typeof customExpertSchema>

/**
 * Shape of the `agency-agents-ll` settings section. Custom experts are stored
 * as `unknown` here and parsed by {@link customExpertSchema} on read, so a
 * hand-edited document degrades to "that expert is gone" instead of failing the
 * whole namespace registration.
 */
export const agencySettingsSchema = z.object({
  enabled: z.array(z.string()),
  customExperts: z.array(z.unknown()),
})

/** Every user-visible failure this plugin raises, in both languages. */
const messages = {
  invalid: ['请检查名称、简介、分区、召唤图标和提示词。', 'Check the name, introduction, division, summon icon and prompt.'],
  duplicate: ['这位专家的名称或标识已被占用，请换一个名称。', 'This expert name or id is already in use; choose another name.'],
  unavailable: ['所选专家不存在或已被停用，请刷新后重新选择。', 'An expert is missing or no longer enabled. Refresh and choose again.'],
  missing: ['自定义专家不存在或已删除，请刷新后重试。', 'The custom expert is missing or deleted. Refresh and try again.'],
  limit: [`自定义专家数量已达上限（${CUSTOM_EXPERT_LIMIT} 位），请先删除不再使用的专家。`, `The limit of ${CUSTOM_EXPERT_LIMIT} custom experts has been reached. Delete an unused expert first.`],
  division: ['请选择有效的分区。', 'Choose a valid division.'],
  // The message carries the settings provider's own conflict wording verbatim,
  // because that is the signal the browser classifies a lost race by (see
  // `isSettingsConflict`). Rewriting it would turn a refresh-and-retry into an
  // unexplained failure.
  conflict: ['专家配置已被其他窗口修改（changed since it was read），请刷新后重试。', 'Expert settings changed since it was read; refresh and try again.'],
} as const

/** Every user-visible failure this plugin raises. */
export type CustomErrorKey = keyof typeof messages

/**
 * Build one contract failure in the requested language.
 * @param key - which failure to raise.
 * @param locale - language for the message text.
 * @returns the error to throw.
 */
export function customError(key: CustomErrorKey, locale: 'zh' | 'en'): Error {
  return new Error(messages[key][locale === 'en' ? 1 : 0])
}

/**
 * Fold a name for comparison: case, width and surrounding space do not
 * distinguish two experts.
 * @param value - raw name.
 * @returns the comparison key.
 */
export function normalizeExpertName(value: string): string {
  return value.trim().normalize('NFKC').toLowerCase()
}

/**
 * Validate the owned settings section before it is stored, so a hand-edited
 * document cannot leave a half-broken roster behind.
 * @param value - resolved section.
 * @param locale - language for failure messages.
 */
export function validateRosterSettings(value: { enabled?: unknown; customExperts?: unknown }, locale: 'zh' | 'en' = 'zh'): void {
  if (!Array.isArray(value.customExperts ?? [])) throw customError('invalid', locale)
  const records = customExpertSchema.array().safeParse(value.customExperts ?? [])
  if (!records.success) throw customError('invalid', locale)
  if (records.data.length > CUSTOM_EXPERT_LIMIT) throw customError('limit', locale)
  const slugs = new Set<string>()
  const names = new Set<string>()
  for (const expert of records.data) {
    const name = normalizeExpertName(expert.name)
    if (slugs.has(expert.slug) || names.has(name)) throw customError('duplicate', locale)
    slugs.add(expert.slug)
    names.add(name)
  }
}
