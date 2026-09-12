/**
 * Host-side copy, in both languages.
 *
 * `zh` is the key-set source of truth; `en` must cover exactly the same keys,
 * which `satisfies` enforces at compile time.
 */
import type { PromptLocale } from './contract.js'

/** A concrete language for rendered host text. */
export type LocaleId = 'zh' | 'en'

const zh = {
  'error.rootMissing': '专家名册目录不存在：{root}',
  'error.catalogEmpty': '专家名册为空：{root}',
  'error.expertRequired': '请提供专家名称。',
  'error.expertMissing': '未找到专家：{query}',
  'error.expertAmbiguous': '专家名称不唯一：{query}，候选：{candidates}',
  'error.personaMissing': '未找到专家提示词：{division}/{slug}',
  'error.personaInvalid': '专家提示词格式无效：{division}/{slug}',
  'error.summonRequiresAgent': '召唤专家需要运行中的主会话。',
  'error.taskRequired': '请提供任务内容。',
  'error.taskEmpty': '第 {index} 个任务内容为空。',
  'error.taskTooLong': '第 {index} 个任务超过 {max} 个字符（实际 {length}）。',
  'error.expertsEmpty': '请至少提供一位专家。',
  'error.expertsTooMany': '一次最多召唤 {max} 位专家（实际 {count}）。',
  'error.expertEmpty': '第 {index} 位专家名称为空。',
  'error.summonManyRequiresAgent': '批量召唤专家需要运行中的主会话。',
  'error.providerMissing': '子代理提供方不可用：{provider}',
  'error.providerNoPersona': '子代理提供方 {provider} 不支持 persona。',
  'error.providerNoToolFilter': '子代理提供方 {provider} 不支持工具过滤。',
  'error.expertRun': '专家运行未正常结束（{reason}）。{detail}',
  'error.partialOutput': '部分输出：{text}',
  'error.expertFailed': '（失败：{error}）',
  'list.heading': '共 {total} 位可选专家，覆盖 {divisions} 个分区。先说分区名可展开该分区的专家。',
  'list.group': '{division}（{count}）：{names}',
  'list.groupHeading': '{division}（{count}）',
  'list.expertLine': '- {name} —— {description}',
  'list.empty': '暂无可召唤的专家。',
  'list.emptyDivision': '没有匹配「{division}」的分区。',
  'profile.heading': '{name}（{division}）',
  'profile.englishName': '英文名：{name}',
  'profile.oneLine': '一句话简介：{text}',
  'profile.introHeading': '中文简介：',
  'profile.introMissing': '（这位专家尚未提供中文简介，名册会回退显示英文一句话简介：{fallback}）',
  'profile.personaProvided': '中文提示词：已提供，切换到中文时使用。',
  'profile.personaMissing': '中文提示词：未提供，召唤时使用英文原文。',
} satisfies Record<string, string>

/** Key union of the host dictionary. */
export type HostKey = keyof typeof zh

const en = {
  'error.rootMissing': 'Expert roster directory not found: {root}',
  'error.catalogEmpty': 'Expert roster is empty: {root}',
  'error.expertRequired': 'Provide an expert name.',
  'error.expertMissing': 'No such expert: {query}',
  'error.expertAmbiguous': 'Ambiguous expert name: {query}; candidates: {candidates}',
  'error.personaMissing': 'No persona for {division}/{slug}',
  'error.personaInvalid': 'Malformed persona: {division}/{slug}',
  'error.summonRequiresAgent': 'Summoning an expert needs a running parent session.',
  'error.taskRequired': 'Provide the task.',
  'error.taskEmpty': 'Task {index} is empty.',
  'error.taskTooLong': 'Task {index} exceeds {max} characters (got {length}).',
  'error.expertsEmpty': 'Provide at least one expert.',
  'error.expertsTooMany': 'At most {max} experts per call (got {count}).',
  'error.expertEmpty': 'Expert {index} has an empty name.',
  'error.summonManyRequiresAgent': 'Summoning several experts needs a running parent session.',
  'error.providerMissing': 'Subagent provider unavailable: {provider}',
  'error.providerNoPersona': 'Subagent provider {provider} does not support personas.',
  'error.providerNoToolFilter': 'Subagent provider {provider} does not support tool filters.',
  'error.expertRun': 'The expert run did not finish cleanly ({reason}). {detail}',
  'error.partialOutput': 'Partial output: {text}',
  'error.expertFailed': '(failed: {error})',
  'list.heading': '{total} experts available across {divisions} divisions. Name a division to expand it.',
  'list.group': '{division} ({count}): {names}',
  'list.groupHeading': '{division} ({count})',
  'list.expertLine': '- {name} — {description}',
  'list.empty': 'No experts are available.',
  'list.emptyDivision': 'No division matches "{division}".',
  'profile.heading': '{name} ({division})',
  'profile.englishName': 'English name: {name}',
  'profile.oneLine': 'One-line summary: {text}',
  'profile.introHeading': 'Chinese introduction:',
  'profile.introMissing': '(No Chinese introduction yet; the roster falls back to the English one-line summary: {fallback})',
  'profile.personaProvided': 'Chinese persona: provided; used when the prompt language is Chinese.',
  'profile.personaMissing': 'Chinese persona: not provided; the summon uses the English original.',
} satisfies Record<HostKey, string>

/**
 * Render one host string in the requested language.
 * @param locale - language to render in.
 * @param key - dictionary key.
 * @param params - values substituted into `{name}` placeholders.
 * @returns the rendered text.
 */
export function formatHost(locale: LocaleId, key: HostKey, params?: Record<string, string | number>): string {
  let text: string = (locale === 'en' ? en : zh)[key]
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

/**
 * Narrow an arbitrary preference value to a locale this plugin renders.
 * @param value - raw `locale.preference` value read from host settings.
 * @returns `en` or `zh`; anything unrecognized falls back to `zh`.
 */
export function resolveHostLocale(value: unknown): LocaleId {
  return value === 'en' ? 'en' : 'zh'
}

/** Preference values a caller may pass; kept for documentation of the surface. */
export const HOST_LOCALES: readonly PromptLocale[] = ['auto', 'zh', 'en']
