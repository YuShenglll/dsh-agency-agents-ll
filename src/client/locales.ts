/**
 * Browser copy, in both languages.
 *
 * `zh` is the key-set source of truth; `en` must cover exactly the same keys,
 * which `satisfies` enforces at compile time. No user-visible string in the
 * client may be written inline — everything routes through here so the two
 * languages cannot drift apart.
 *
 * Division display names are not repeated: they are imported from
 * `src/names.ts`, which stays the one home for the 18 divisions.
 */
import { DIVISIONS, EN_DIVISION, ZH_DIVISION } from '../names.js'

/** One division's label key, derived so a new division cannot be forgotten. */
type DivisionKey = `division.${(typeof DIVISIONS)[number]}`

/** The division slice of the dictionary, checked against the real roster. */
function zhDivisions(): Record<DivisionKey, string> {
  const entries = DIVISIONS.map((division) => [`division.${division}`, ZH_DIVISION[division] ?? division])
  return Object.fromEntries(entries) as Record<DivisionKey, string>
}

/** The division slice of the dictionary, checked against the real roster. */
function enDivisions(): Record<DivisionKey, string> {
  const entries = DIVISIONS.map((division) => [`division.${division}`, EN_DIVISION[division] ?? division])
  return Object.fromEntries(entries) as Record<DivisionKey, string>
}

const zh = {
  ...zhDivisions(),
  'nav': '专家库',
  'title': '专家库',
  'loading': '正在读取名册…',
  'empty': '名册为空。请确认插件资产目录存在。',
  'emptyFilter': '没有匹配的专家。试试换个关键词，或清除筛选。',
  'emptyFilter.reset': '清除筛选',
  'retry': '重试',
  'refresh': '刷新',
  'search': '搜索',
  'search.placeholder': '搜索中文名、英文名、分区或简介',
  'search.clear': '清除搜索',
  'filter.division': '分区',
  'filter.division.all': '全部分区',
  'filter.enabledOnly': '只看已启用',
  'filter.division.option': '{name}（{count}）',
  'summary.total': '共 {total} 位专家',
  'summary.enabled': '已启用 {enabled} 位',
  'enabled': '已启用',
  'disabled': '已停用',
  'toggle.enable': '启用',
  'toggle.disable': '停用',
  'badge.custom': '自定义',
  'badge.translated': '中文人设',
  'badge.notTranslated': '仅英文人设',
  'badge.conflict': '名称冲突',
  'card.englishName': '英文名：{name}',
  'card.introHeading': '中文简介',
  'card.introMissing': '这位专家尚未提供中文简介。',
  'card.viewPrompt': '查看提示词',
  'card.copyPrompt': '复制提示词',
  'card.copied': '已复制',
  'card.copyFailed': '无法复制提示词，请检查浏览器剪贴板权限。',
  'prompt.title': '{name} 的提示词',
  'prompt.locale.zh': '中文人设',
  'prompt.locale.en': '英文原文',
  'prompt.fallback': '这位专家没有中文正文，已回退英文原文。',
  'prompt.loading': '正在读取提示词…',
  'prompt.close': '关闭',
  'promptLocale.label': '提示词语言',
  'promptLocale.auto': '跟随界面',
  'promptLocale.zh': '中文',
  'promptLocale.en': '英文',
  'custom.add': '新建自定义专家',
  'custom.edit': '编辑',
  'custom.delete': '删除',
  'custom.newTitle': '新建自定义专家',
  'custom.editTitle': '编辑自定义专家',
  'custom.name': '名称',
  'custom.description': '一句话简介',
  'custom.intro': '中文简介',
  'custom.division': '分区',
  'custom.emoji': '召唤图标（一个 Emoji）',
  'custom.prompt': '人设提示词',
  'custom.promptHint': '这段正文会作为被召唤专家的人设注入。',
  'custom.enabled': '创建后立即启用',
  'custom.save': '保存',
  'custom.cancel': '取消',
  'custom.saving': '正在保存…',
  'custom.deleteTitle': '删除自定义专家',
  'custom.deleteConfirm': '确定要删除「{name}」吗？此操作不可撤销。',
  'custom.deleted': '已删除。',
  'custom.saved': '已保存。',
  'custom.limit': '自定义专家数量已达上限（{limit} 位）。',
  'error.load': '读取名册失败：{detail}',
  'error.save': '保存失败：{detail}',
  'error.render': '专家名册页面渲染失败，已就地还原而不是清空整页。请把下面这行发给维护者：{detail}',
  'menu.button': '专家',
  'menu.title': '召唤专家',
  'menu.empty': '还没有启用任何专家。请先在设置页启用。',
  'error.conflict': '专家配置已被其他窗口修改，已为您刷新，请重试。',
  'error.conflict.refreshFailed': '专家配置已被其他窗口修改，但刷新失败，请手动刷新。',
  'error.insertFailed': '未能插入专家引用，请重试。',
  'error.unavailable': '所选专家不存在或已被停用，请重新选择。',
  'mention.removed': '@已移除专家（请重新选择）',
} satisfies Record<string, string>

/** Key union of the browser dictionary. */
export type AgencyClientKey = keyof typeof zh

const en = {
  ...enDivisions(),
  'nav': 'Expert library',
  'title': 'Expert library',
  'loading': 'Loading the roster…',
  'empty': 'The roster is empty. Check that the plugin assets are present.',
  'emptyFilter': 'No matching experts. Try another keyword, or clear the filters.',
  'emptyFilter.reset': 'Clear filters',
  'retry': 'Retry',
  'refresh': 'Refresh',
  'search': 'Search',
  'search.placeholder': 'Search Chinese name, English name, division or introduction',
  'search.clear': 'Clear search',
  'filter.division': 'Division',
  'filter.division.all': 'All divisions',
  'filter.enabledOnly': 'Enabled only',
  'filter.division.option': '{name} ({count})',
  'summary.total': '{total} experts',
  'summary.enabled': '{enabled} enabled',
  'enabled': 'Enabled',
  'disabled': 'Disabled',
  'toggle.enable': 'Enable',
  'toggle.disable': 'Disable',
  'badge.custom': 'Custom',
  'badge.translated': 'Chinese persona',
  'badge.notTranslated': 'English persona only',
  'badge.conflict': 'Name conflict',
  'card.englishName': 'English name: {name}',
  'card.introHeading': 'Chinese introduction',
  'card.introMissing': 'This expert has no Chinese introduction yet.',
  'card.viewPrompt': 'View prompt',
  'card.copyPrompt': 'Copy prompt',
  'card.copied': 'Copied',
  'card.copyFailed': 'Could not copy the prompt. Check browser clipboard permissions.',
  'prompt.title': 'Prompt for {name}',
  'prompt.locale.zh': 'Chinese persona',
  'prompt.locale.en': 'English original',
  'prompt.fallback': 'This expert has no Chinese body; the English original is served instead.',
  'prompt.loading': 'Loading the prompt…',
  'prompt.close': 'Close',
  'promptLocale.label': 'Prompt language',
  'promptLocale.auto': 'Follow interface',
  'promptLocale.zh': 'Chinese',
  'promptLocale.en': 'English',
  'custom.add': 'New custom expert',
  'custom.edit': 'Edit',
  'custom.delete': 'Delete',
  'custom.newTitle': 'New custom expert',
  'custom.editTitle': 'Edit custom expert',
  'custom.name': 'Name',
  'custom.description': 'One-line summary',
  'custom.intro': 'Chinese introduction',
  'custom.division': 'Division',
  'custom.emoji': 'Summon icon (one emoji)',
  'custom.prompt': 'Persona prompt',
  'custom.promptHint': 'This body is injected as the summoned expert\'s persona.',
  'custom.enabled': 'Enable after saving',
  'custom.save': 'Save',
  'custom.cancel': 'Cancel',
  'custom.saving': 'Saving…',
  'custom.deleteTitle': 'Delete custom expert',
  'custom.deleteConfirm': 'Delete “{name}”? This cannot be undone.',
  'custom.deleted': 'Deleted.',
  'custom.saved': 'Saved.',
  'custom.limit': 'The limit of {limit} custom experts has been reached.',
  'error.load': 'Could not load the roster: {detail}',
  'error.save': 'Could not save: {detail}',
  'error.render': 'The roster page failed while rendering and was contained instead of blanking the panel. Please send this line to the maintainer: {detail}',
  'menu.button': 'Expert',
  'menu.title': 'Summon expert',
  'menu.empty': 'No experts are enabled yet. Enable some in Settings first.',
  'error.conflict': 'Expert settings were changed in another window; the roster was refreshed, please retry.',
  'error.conflict.refreshFailed': 'Expert settings were changed in another window, but the refresh failed. Please refresh manually.',
  'error.insertFailed': 'The expert reference could not be inserted. Please try again.',
  'error.unavailable': 'That expert is missing or no longer enabled. Choose again.',
  'mention.removed': '@Removed expert (please reselect)',
} satisfies Record<AgencyClientKey, string>

/** Dictionary pair registered under the plugin's locale namespace. */
export const DICTIONARIES = { zh, en } as const

/**
 * Render one client string in the requested language.
 *
 * The slot machinery usually injects `t`, but error paths and non-React
 * helpers have no seat, so the same lookup is available as a plain function.
 * @param locale - language to render in.
 * @param key - dictionary key.
 * @param params - values substituted into `{name}` placeholders.
 * @returns the rendered text.
 */
export function formatClient(locale: 'zh' | 'en', key: AgencyClientKey, params?: Record<string, string | number>): string {
  let text: string = (locale === 'en' ? en : zh)[key]
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}
