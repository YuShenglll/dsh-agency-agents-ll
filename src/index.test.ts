import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog, normalizeName, parseFrontmatter, resolveExpert } from './catalog.js'
import { coercePromptLocale, resolvePromptLocale } from './contract.js'
import { formatHost, resolveHostLocale } from './i18n.js'
import { mapPool, validateSummonSpecs } from './index.js'
import { loadPersona, sanitizePersona } from './persona.js'

describe('prompt locale preference', () => {
  it('defers to the interface language under auto', () => {
    expect(resolvePromptLocale('auto', 'en')).toBe('en')
    expect(resolvePromptLocale('auto', 'zh')).toBe('zh')
  })

  it('lets an explicit preference override the interface language', () => {
    expect(resolvePromptLocale('zh', 'en')).toBe('zh')
    expect(resolvePromptLocale('en', 'zh')).toBe('en')
  })

  it('falls back to the default for unknown values', () => {
    expect(coercePromptLocale('fr')).toBe('en')
    expect(coercePromptLocale(undefined)).toBe('en')
    expect(coercePromptLocale(7)).toBe('en')
    expect(coercePromptLocale('zh')).toBe('zh')
  })

  it('reads the host language as zh unless it is exactly en', () => {
    expect(resolveHostLocale('en')).toBe('en')
    expect(resolveHostLocale('zh')).toBe('zh')
    expect(resolveHostLocale(undefined)).toBe('zh')
  })

  it('keeps both host dictionaries on the same key set', () => {
    expect(formatHost('zh', 'error.expertRequired')).not.toBe(formatHost('en', 'error.expertRequired'))
    expect(formatHost('zh', 'list.group', { division: '工程', count: 2, names: 'a、b' })).toBe('工程（2）：a、b')
    expect(formatHost('en', 'list.group', { division: 'Engineering', count: 2, names: 'a, b' })).toBe('Engineering (2): a, b')
  })
})

describe('frontmatter parsing', () => {
  it('reads quoted fields and the body', () => {
    const parsed = parseFrontmatter('---\nname: "前端工程师"\ndescription: \'x\'\nemoji: 🎨\n---\n\nbody text\n')
    expect(parsed?.name).toBe('前端工程师')
    expect(parsed?.description).toBe('x')
    expect(parsed?.emoji).toBe('🎨')
    expect(parsed?.body).toBe('body text')
  })

  it('tolerates a BOM and CRLF', () => {
    const parsed = parseFrontmatter('\uFEFF---\r\nname: A\r\ndescription: B\r\n---\r\nbody\r\n')
    expect(parsed?.name).toBe('A')
    expect(parsed?.body).toBe('body')
  })

  it('returns undefined without a fence', () => {
    expect(parseFrontmatter('# just a heading\n')).toBeUndefined()
  })

  it('reads the translation source hash', () => {
    const parsed = parseFrontmatter('---\nname: A\ndescription: B\nsourceSha256: abc123\n---\nbody\n')
    expect(parsed?.sourceSha256).toBe('abc123')
  })
})

describe('catalog', () => {
  let root = ''
  let en = ''
  let zh = ''

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'll-catalog-'))
    en = join(root, 'en')
    zh = join(root, 'zh')
    await mkdir(join(en, 'engineering'), { recursive: true })
    await mkdir(join(en, 'design'), { recursive: true })
    await mkdir(join(zh, 'engineering'), { recursive: true })
    // translated expert
    await writeFile(join(en, 'engineering', 'engineering-frontend-developer.md'),
      '---\nname: Frontend Developer\ndescription: Builds UIs.\nemoji: 🎨\n---\n\nEnglish persona\n', 'utf8')
    await writeFile(join(zh, 'engineering', 'engineering-frontend-developer.md'),
      '---\nname: 前端开发工程师\ndescription: 负责 Web 前端开发。\nemoji: 🎨\nsourceSha256: deadbeef\n---\n\n中文角色设定\n', 'utf8')
    // untranslated expert: profile metadata only, no persona body
    await writeFile(join(en, 'design', 'design-ui-designer.md'),
      '---\nname: UI Designer\ndescription: Designs interfaces.\nemoji: 🖌️\n---\n\nEnglish persona two\n', 'utf8')
    await mkdir(join(zh, 'design'), { recursive: true })
    await writeFile(join(zh, 'design', 'design-ui-designer.md'),
      '---\nname: "UI 设计师"\ndescription: "负责界面设计。"\nintro: "界面设计专家，负责把产品需求落成可用的界面。擅长信息层级、组件规范与视觉一致性，交付设计稿与设计规范。适合在有明确产品目标、需要有人把交互与视觉收口时召唤。"\nemoji: "🖌️"\n---\n', 'utf8')
    // second designer, so a bare "designer" query is genuinely ambiguous
    await writeFile(join(en, 'design', 'design-ux-designer.md'),
      '---\nname: UX Designer\ndescription: Designs flows.\nemoji: 🧭\n---\n\nEnglish persona three\n', 'utf8')
    // orphan: present only in the Chinese tree
    await mkdir(join(zh, 'design'), { recursive: true })
    await writeFile(join(zh, 'design', 'design-orphan.md'),
      '---\nname: 孤儿\ndescription: 只存在于中文树。\n---\n\norphan\n', 'utf8')
    // malformed: no frontmatter, must be skipped
    await writeFile(join(en, 'design', 'design-broken.md'), '# no frontmatter\n', 'utf8')
  })

  afterAll(async () => {
    if (root !== '') await rm(root, { recursive: true, force: true })
  })

  it('takes the roster from the English tree only', async () => {
    const { experts, divisions } = await loadCatalog({ en, zh }, ['engineering', 'design'])
    expect([...experts.keys()].sort()).toEqual(['design-ui-designer', 'design-ux-designer', 'engineering-frontend-developer'])
    expect(divisions.sort()).toEqual(['design', 'engineering'])
  })

  it('merges the Chinese display metadata when a translation exists', async () => {
    const { experts } = await loadCatalog({ en, zh }, ['engineering', 'design'])
    const translated = experts.get('engineering-frontend-developer')
    expect(translated?.nameZh).toBe('前端开发工程师')
    expect(translated?.nameEn).toBe('Frontend Developer')
    expect(translated?.translated).toBe(true)
    const untranslated = experts.get('design-ux-designer')
    expect(untranslated?.nameZh).toBe('')
    expect(untranslated?.introZh).toBe('')
    expect(untranslated?.translated).toBe(false)
  })

  it('carries a Chinese introduction without requiring a translated persona', async () => {
    const { experts } = await loadCatalog({ en, zh }, ['engineering', 'design'])
    const profile = experts.get('design-ui-designer')
    expect(profile?.nameZh).toBe('UI 设计师')
    expect(profile?.descriptionZh).toBe('负责界面设计。')
    expect(profile?.introZh).toContain('界面设计专家')
    // Intro-only: the roster shows Chinese, but the summon must fall back to English.
    expect(profile?.translated).toBe(false)
  })

  it('normalizes full-width and case when comparing names', () => {
    expect(normalizeName('  Frontend  ')).toBe('frontend')
    expect(normalizeName('Ａ')).toBe(normalizeName('a'))
  })

  it('resolves by Chinese name, English name and fragment', async () => {
    const { experts } = await loadCatalog({ en, zh }, ['engineering', 'design'])
    expect(resolveExpert(experts.values(), '前端开发工程师', 'zh').slug).toBe('engineering-frontend-developer')
    expect(resolveExpert(experts.values(), 'Frontend Developer', 'zh').slug).toBe('engineering-frontend-developer')
    expect(resolveExpert(experts.values(), 'ui designer', 'en').slug).toBe('design-ui-designer')
    expect(resolveExpert(experts.values(), 'frontend', 'en').slug).toBe('engineering-frontend-developer')
  })

  it('rejects empty, unknown and ambiguous queries', async () => {
    const { experts } = await loadCatalog({ en, zh }, ['engineering', 'design'])
    expect(() => resolveExpert(experts.values(), '  ', 'en')).toThrow(formatHost('en', 'error.expertRequired'))
    expect(() => resolveExpert(experts.values(), 'nope', 'en')).toThrow(/nope/)
    expect(() => resolveExpert(experts.values(), 'designer', 'en')).toThrow(/Ambiguous|ambiguous|不唯一/)
  })
})

describe('persona loading', () => {
  let root = ''
  let en = ''
  let zh = ''

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'll-persona-'))
    en = join(root, 'en')
    zh = join(root, 'zh')
    await mkdir(join(en, 'engineering'), { recursive: true })
    await mkdir(join(zh, 'engineering'), { recursive: true })
    await writeFile(join(en, 'engineering', 'a.md'), '---\nname: A\ndescription: d\n---\n\nEN body\n', 'utf8')
    await writeFile(join(zh, 'engineering', 'a.md'), '---\nname: 甲\ndescription: 描述\n---\n\n中文正文\n', 'utf8')
    await writeFile(join(en, 'engineering', 'b.md'), '---\nname: B\ndescription: d\n---\n\nEN body b\n', 'utf8')
    // empty Chinese body: must fall back rather than serve nothing
    await writeFile(join(zh, 'engineering', 'b.md'), '---\nname: 乙\ndescription: 描述\n---\n\n', 'utf8')
  })

  afterAll(async () => {
    if (root !== '') await rm(root, { recursive: true, force: true })
  })

  it('serves the requested language when it exists', async () => {
    const result = await loadPersona({ en, zh }, 'engineering', 'a', 'zh')
    expect(result.prompt).toBe('中文正文')
    expect(result.locale).toBe('zh')
    expect(result.fallback).toBe(false)
    const english = await loadPersona({ en, zh }, 'engineering', 'a', 'en')
    expect(english.prompt).toBe('EN body')
  })

  it('falls back to English and reports it when the Chinese body is unusable', async () => {
    const result = await loadPersona({ en, zh }, 'engineering', 'b', 'zh')
    expect(result.prompt).toBe('EN body b')
    expect(result.locale).toBe('en')
    expect(result.fallback).toBe(true)
  })

  it('throws when neither tree has a usable body', async () => {
    await expect(loadPersona({ en, zh }, 'engineering', 'missing', 'zh')).rejects.toThrow(/missing/)
  })

  it('neutralizes double-brace groups without changing the rendered text', () => {
    expect(sanitizePersona('use {{name}} here')).not.toContain('{{')
    expect(sanitizePersona('use {{name}} here').replace(/\u200b/g, '')).toBe('use {{name}} here')
    expect(sanitizePersona('plain {single} braces')).toBe('plain {single} braces')
  })
})

describe('summon request validation', () => {
  it('rejects an empty or oversized batch', () => {
    expect(() => validateSummonSpecs([], 'en')).toThrow(formatHost('en', 'error.expertsEmpty'))
    const nine = Array.from({ length: 9 }, () => ({ expert: 'a', task: 't' }))
    expect(() => validateSummonSpecs(nine, 'en')).toThrow(/8/)
  })

  it('rejects an empty expert name or task', () => {
    expect(() => validateSummonSpecs([{ expert: ' ', task: 't' }], 'en')).toThrow(/Expert 1/)
    expect(() => validateSummonSpecs([{ expert: 'a', task: '  ' }], 'en')).toThrow(formatHost('en', 'error.taskEmpty', { index: 1 }))
  })

  it('enforces the task length in code points, not UTF-16 units', () => {
    const astral = '𝄞'.repeat(8001)
    expect(() => validateSummonSpecs([{ expert: 'a', task: astral }], 'en')).toThrow(/8000/)
    expect(validateSummonSpecs([{ expert: 'a', task: '𝄞'.repeat(8000) }], 'en')).toHaveLength(1)
  })

  it('trims and returns valid specs', () => {
    expect(validateSummonSpecs([{ expert: ' a ', task: ' do it ' }], 'en')).toEqual([{ expert: 'a', task: 'do it' }])
  })
})

describe('bounded pool', () => {
  it('preserves input order and bounds concurrency', async () => {
    let inFlight = 0
    let peak = 0
    const items = Array.from({ length: 11 }, (_, i) => i)
    const out = await mapPool(items, 4, async (item) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      return item * 2
    })
    expect(out).toEqual(items.map((item) => item * 2))
    expect(peak).toBeLessThanOrEqual(4)
  })
})
