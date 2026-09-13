/**
 * Host-side copy, in both languages.
 *
 * `zh` is the key-set source of truth; `en` must cover exactly the same keys,
 * which `satisfies` enforces at compile time.
 */

/** A concrete language for rendered host text. */
export type LocaleId = 'zh' | 'en'

const zh = {
  'error.rootMissing': '专家名册目录不存在：{root}',
  'error.zhRootMissing': '中文档案目录不存在：{root}（名册仍可用，但名称与简介会回退显示英文）',
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
  'error.rosterUnavailable': '专家名册服务尚未就绪，请稍后重试。',
  'list.heading': '共 {total} 位可选专家，覆盖 {divisions} 个分区。先说分区名可展开该分区的专家。',
  // Joins the expert names on one condensed division line: the separator is
  // punctuation, so it belongs to the rendered language rather than to the code.
  'list.nameSeparator': '、',
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
  // The system-prompt section that makes the roster discoverable. Deliberately
  // narrow: the owner's decision is that an expert is summoned only when the user
  // asks for one, so the text has to say when NOT to reach for the tools — not just
  // that they exist. Summoning is a whole subagent run, so a model that decides on
  // its own that a task "looks specialist" spends real time and quota unasked.
  'systemPrompt.roster': [
    '本会话有一份可召唤的专家名册（279 位专家 / 18 个分区），通过 list_experts / describe_expert / summon_expert / summon_experts 使用。',
    '',
    '**只在用户明确要求时使用。** 用户说「叫专家」「用专家看看」「找个专家审一下」，或在输入框里 @ 了某位专家，都算明确要求。',
    '',
    '**不要自作主张召唤。**「这个任务看起来属于某个专业领域」不是理由——没有这样的要求时，你自己做完就好。',
    '',
    '一次召唤 = 一次完整的子代理运行，要花时间也花额度：只叫真正需要的那几位；纯事实查询、小改动、需要快速来回迭代的事都不要叫。',
    '',
    '用户要求评审时，必须给对方留「说没问题」的余地：让它如实报告，没发现问题就直说没发现——为了凑一份完整的评审而编造发现，比报告「没发现问题」更糟。',
  ].join('\n'),
} satisfies Record<string, string>

/** Key union of the host dictionary. */
export type HostKey = keyof typeof zh

const en = {
  'error.rootMissing': 'Expert roster directory not found: {root}',
  'error.zhRootMissing': 'Chinese archive directory not found: {root} (the roster still works, but names and summaries fall back to English)',
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
  'error.rosterUnavailable': 'The expert roster service is not ready yet; try again in a moment.',
  'list.heading': '{total} experts available across {divisions} divisions. Name a division to expand it.',
  'list.nameSeparator': ', ',
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
  'systemPrompt.roster': [
    'An Agency expert roster is available in this session (279 experts across 18 divisions): list_experts / describe_expert / summon_expert / summon_experts.',
    '',
    '**Use it only when the user explicitly asks for an expert.** "Call an expert", "have an expert look at this", "get someone to review it", or an @-mention of an expert all count as an explicit request.',
    '',
    '**Do not summon on your own initiative.** "This task looks like it belongs to a specialist domain" is not a reason. Without such a request, just do the work yourself.',
    '',
    'One summon is a full subagent run: it costs time and quota. Call only the experts you actually need, and skip it for plain fact lookups, small edits, and anything that needs fast back-and-forth.',
    '',
    'When the user does ask for a review, leave room for "no problems found": require an honest report, and treat inventing findings to fill out a review as worse than reporting none.',
  ].join('\n'),
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
