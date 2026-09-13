import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { loadCatalog, normalizeName, parseFrontmatter, resolveExpert } from './catalog.js'
import { coercePromptLocale, resolvePromptLocale, SETTINGS_NS } from './contract.js'
import { formatHost, resolveHostLocale } from './i18n.js'
import { apply, Config, mapPool, resolveAssetRoots, validateSummonSpecs } from './index.js'
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

  it('reports a malformed archive instead of a missing one', async () => {
    // A file that is there but carries no usable body is a content fault, not
    // the ordinary "no Chinese archive yet" case.
    await writeFile(join(en, 'engineering', 'c.md'), '# no frontmatter\n', 'utf8')
    await expect(loadPersona({ en, zh }, 'engineering', 'c', 'en'))
      .rejects.toThrow(formatHost('en', 'error.personaInvalid', { division: 'engineering', slug: 'c' }))
  })

  it('refuses a slug that would leave the asset tree', async () => {
    // The file exists, one level above the tree: the wire codec refuses this
    // shape, and the loader refuses it again rather than reading outside.
    await writeFile(join(root, 'secret.md'), '---\nname: Secret\ndescription: s\n---\n\noutside the tree\n', 'utf8')
    await expect(loadPersona({ en, zh }, 'engineering', '../../secret', 'en'))
      .rejects.toThrow(formatHost('en', 'error.personaMissing', { division: 'engineering', slug: '../../secret' }))
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

  it('stops starting work once the signal is aborted', async () => {
    const controller = new AbortController()
    const cancelled = new Error('turn cancelled')
    const started: number[] = []
    await expect(mapPool([0, 1, 2, 3], 1, async (item) => {
      started.push(item)
      if (item === 1) controller.abort(cancelled)
      return item
    }, controller.signal)).rejects.toBe(cancelled)
    // Items 2 and 3 are never started: a cancellation must not be reported as
    // if the remaining experts had each failed on their own.
    expect(started).toEqual([0, 1])
  })
})

describe('asset root layout', () => {
  it('treats a configured root as the directory holding both trees', () => {
    // One tree cannot be both halves: each expert file carries one `name:`, so
    // a root pointing at a single tree would read the English name as Chinese.
    const roots = resolveAssetRoots(join('roster', 'external'))
    expect(roots.en).toBe(join('roster', 'external', 'en'))
    expect(roots.zh).toBe(join('roster', 'external', 'zh'))
  })
})

describe('settings section shape', () => {
  it('accepts a container a hand-edited document got wrong', () => {
    // Schemastery refusing this value fails the whole namespace registration,
    // which strands the settings page on "not ready yet" with no way to retry.
    // The field therefore accepts whatever the document holds; `apply` reads a
    // non-array as "nothing stored" and the validate hook records the problem.
    const resolved = Config({ promptLocale: 'en', root: '', provider: 'spawn', enabled: [], customExperts: 'oops' })
    expect(resolved.customExperts).toBe('oops')
    expect(resolved.enabled).toEqual([])
  })
})

/** A user-authored expert as the settings document stores it. */
const customExpert = {
  slug: 'custom-22222222-2222-4222-8222-222222222222',
  name: '我的专家',
  description: '负责核对发布清单。',
  division: 'engineering',
  emoji: '🧪',
  intro: '发布核对专家，负责在发布前逐条核对清单，确认每一项都有证据。',
  prompt: '你是发布核对专家，只按证据下结论。',
}

/**
 * The text of one rendered content block; other block kinds carry none.
 * @param block - one rendered block.
 * @returns the block's text, or an empty string.
 */
function textOf(block: { type: string; text?: string }): string {
  return block.type === 'text' ? (block.text ?? '') : ''
}

/** What one mounted Host half offers a test. */
interface HostHarness {
  /** Registered tools by name. */
  readonly tools: Map<string, ToolDefinition>
  /** One record per subagent the tools started, in call order. */
  readonly starts: Array<{ readonly label: string; readonly persona: string }>
  /** One entry per warning the plugin logged while mounting. */
  readonly warnings: string[]
  /**
   * Run one registered tool.
   * @param name - tool name.
   * @param args - tool arguments.
   * @param signal - cancellation signal; a fresh unaborted one by default.
   * @returns the canonical value the tool returned.
   */
  call(name: string, args: unknown, signal?: AbortSignal): Promise<unknown>
  /**
   * Run one registered tool and render its value the way the model reads it.
   * @param name - tool name.
   * @param args - tool arguments.
   * @returns the concatenated text blocks.
   */
  text(name: string, args: unknown): Promise<string>
}

/**
 * Mount the Host half over a temp asset tree and an in-memory settings document.
 *
 * The fake context exposes exactly the seams `apply` uses — the tool registry,
 * the subagent runtime, the settings provider and the logger — so these tests
 * describe the tools' contract rather than Cordis.
 *
 * @param options - asset root, languages, the stored custom experts and a start hook.
 * @returns the registered tools, the recorded subagent starts and call helpers.
 */
function mountHost(options: {
  readonly root: string
  readonly promptLocale: 'auto' | 'zh' | 'en'
  readonly locale?: string
  /** Stored document value, deliberately untyped: the document is hand-editable. */
  readonly customExperts?: unknown
  readonly onStart?: () => void
}): HostHarness {
  const tools = new Map<string, ToolDefinition>()
  const services = new Map<string, unknown>()
  const starts: Array<{ label: string; persona: string }> = []
  const warnings: string[] = []
  // The stored document, kept apart from the composition base the way the real
  // provider keeps them: the tests exercise the read path over what it holds.
  const stored: { enabled: string[]; customExperts: unknown } = {
    enabled: [],
    customExperts: options.customExperts ?? [],
  }
  let revision = 0

  const settings = {
    get: (ns: string): unknown => {
      if (ns === 'locale') return { preference: options.locale ?? 'zh' }
      if (ns === SETTINGS_NS) return { promptLocale: options.promptLocale, ...stored }
      return undefined
    },
    describe: () => [{ ns: SETTINGS_NS, revision }],
    mutate: async () => { revision += 1 },
    installSection: (
      _owner: unknown,
      _ns: string,
      _schema: unknown,
      entry: Config,
      hooks: { setSource: (current: () => Config) => void; validate?: (value: Config) => void },
    ) => {
      // The real provider hands the resolved section back and validates it at
      // registration, where a refusal fails the whole namespace: the fake must
      // therefore let a `validate` failure through rather than swallow it.
      const resolved: Config = { ...entry, enabled: stored.enabled, customExperts: stored.customExperts }
      hooks.setSource(() => resolved)
      hooks.validate?.(resolved)
    },
  }

  const provider = {
    capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: true, persona: true },
    async start(request: { label?: string; persona?: string }) {
      options.onStart?.()
      starts.push({ label: request.label ?? '', persona: request.persona ?? '' })
      return {
        result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '专家答复' }] }),
        dispose: async () => {},
      }
    },
  }

  const subagents = {
    getProvider: (name: string) => (name === 'spawn' ? provider : undefined),
    start: (name: string, request: { label?: string; persona?: string }) => {
      if (name !== 'spawn') throw new Error(`unknown provider ${name}`)
      return provider.start(request)
    },
  }

  const ctx = {
    tools: { register: (definition: ToolDefinition) => { tools.set(definition.name, definition); return () => {} } },
    subagents,
    settings,
    logger: { warn: (message: unknown) => { warnings.push(String(message)) } },
    provide: (key: string, value: unknown) => { services.set(key, value) },
    // `apply` reaches the settings provider only through this callback.
    inject: (_names: readonly string[], callback: (scoped: unknown) => void) => { callback({ settings }) },
    get: (key: string) => services.get(key),
  }

  apply(ctx as unknown as Context, {
    promptLocale: options.promptLocale,
    root: options.root,
    provider: 'spawn',
    enabled: [],
    customExperts: [],
  })

  const tool = (name: string): ToolDefinition => {
    const definition = tools.get(name)
    if (definition === undefined) throw new Error(`tool ${name} is not registered`)
    return definition
  }

  /** The run context a tool body receives from the registry. */
  const exec = (signal: AbortSignal): ToolRunContext => ({ agent: {}, signal }) as unknown as ToolRunContext

  return {
    tools,
    starts,
    warnings,
    call: (name, args, signal = new AbortController().signal) => tool(name).execute(args, exec(signal)),
    text: async (name, args) => {
      const definition = tool(name)
      const value = await definition.execute(args, exec(new AbortController().signal))
      const blocks = definition.output.render(args, value as Parameters<ToolDefinition['output']['render']>[1])
      return blocks.map(textOf).join('')
    },
  }
}

describe('host tools over the merged roster', () => {
  let root = ''
  let en = ''
  let zh = ''

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'll-host-'))
    en = join(root, 'en')
    zh = join(root, 'zh')
    await mkdir(join(en, 'engineering'), { recursive: true })
    await mkdir(join(zh, 'engineering'), { recursive: true })
    await writeFile(join(en, 'engineering', 'engineering-frontend.md'),
      '---\nname: Frontend Developer\ndescription: Builds UIs.\nemoji: 🎨\n---\n\nEnglish persona body\n', 'utf8')
    // intro-only archive: Chinese display metadata, English persona body
    await writeFile(join(zh, 'engineering', 'engineering-frontend.md'),
      '---\nname: 前端开发工程师\ndescription: 负责 Web 前端开发。\nintro: 前端开发专家，负责把设计落成可用的界面。\nemoji: 🎨\n---\n', 'utf8')
  })

  afterAll(async () => {
    if (root !== '') await rm(root, { recursive: true, force: true })
  })

  it('serves a user-authored expert to all four tools', async () => {
    const host = mountHost({ root, promptLocale: 'zh', customExperts: [customExpert] })

    const listed = await host.text('list_experts', {})
    expect(listed).toContain('我的专家')
    expect(listed).toContain('前端开发工程师')

    const described = await host.call('describe_expert', { expert: '我的专家' }) as Record<string, unknown>
    expect(described.name).toBe('我的专家')
    expect(described.intro).toBe(customExpert.intro)
    expect(described.chinesePersona).toBe(true)

    const summoned = await host.call('summon_expert', { expert: '我的专家', task: '核对发布清单' }) as Record<string, unknown>
    expect(summoned.expert).toBe('我的专家')
    expect(host.starts).toHaveLength(1)
    // The whole point of the merge: the child runs with the stored persona,
    // which no asset tree holds.
    expect(host.starts[0]?.persona).toBe(customExpert.prompt)

    const batch = await host.call('summon_experts', {
      experts: [{ expert: '我的专家', task: '核对发布清单' }],
    }) as { results: Array<Record<string, unknown>> }
    expect(batch.results).toHaveLength(1)
    expect(batch.results[0]?.ok).toBe(true)
    expect(batch.results[0]?.expert).toBe('我的专家')
    expect(host.starts).toHaveLength(2)
    expect(host.starts[1]?.persona).toBe(customExpert.prompt)
  })

  it('keeps a shipped expert resolvable through the same path', async () => {
    const host = mountHost({ root, promptLocale: 'zh', customExperts: [customExpert] })
    const described = await host.call('describe_expert', { expert: 'Frontend Developer' }) as Record<string, unknown>
    expect(described.name).toBe('前端开发工程师')
    expect(described.chinesePersona).toBe(false)

    expect(await host.call('summon_expert', { expert: '前端开发工程师', task: '做一个页面' }))
      .toMatchObject({ expert: '前端开发工程师', answer: '专家答复' })
    // The shared persona source still falls back to the English original.
    expect(host.starts[0]?.persona).toBe('English persona body')
  })

  it('joins expert names with the separator of the rendered language', async () => {
    const english = mountHost({ root, promptLocale: 'en', locale: 'en', customExperts: [customExpert] })
    const englishText = await english.text('list_experts', {})
    expect(englishText).toContain(', ')
    expect(englishText).not.toContain('、')

    const chinese = mountHost({ root, promptLocale: 'zh', customExperts: [customExpert] })
    const chineseText = await chinese.text('list_experts', {})
    expect(chineseText).toContain('、')
    expect(chineseText).not.toContain(', ')
  })

  it('reports the missing half of the roster root instead of an empty roster', async () => {
    const missing = join(root, 'absent')
    // The notice names `<root>/en`, the half that is actually absent: that is
    // what a user pointing `config.root` somewhere wrong has to go and fix.
    const expected = formatHost('zh', 'error.rootMissing', { root: join(missing, 'en') })
    const host = mountHost({ root: missing, promptLocale: 'zh' })
    expect(await host.text('list_experts', {})).toBe(expected)
    const value = await host.call('list_experts', {}) as { total: number; notice: string }
    expect(value.total).toBe(0)
    expect(value.notice).toBe(expected)
  })

  it('reports a readable but empty asset tree', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'll-host-bare-'))
    try {
      // Both trees exist and hold nothing: the roster is genuinely empty, which
      // is a different fact from a root that cannot be read.
      await mkdir(join(bare, 'en'), { recursive: true })
      await mkdir(join(bare, 'zh'), { recursive: true })
      const host = mountHost({ root: bare, promptLocale: 'en', locale: 'en' })
      expect(await host.text('list_experts', {}))
        .toBe(formatHost('en', 'error.catalogEmpty', { root: join(bare, 'en') }))
    } finally {
      await rm(bare, { recursive: true, force: true })
    }
  })

  it('reports a missing Chinese tree without calling the roster empty', async () => {
    const half = await mkdtemp(join(tmpdir(), 'll-host-half-'))
    try {
      await mkdir(join(half, 'en', 'engineering'), { recursive: true })
      await writeFile(join(half, 'en', 'engineering', 'engineering-frontend.md'),
        '---\nname: Frontend Developer\ndescription: Builds UIs.\nemoji: 🎨\n---\n\nEnglish persona body\n', 'utf8')
      const host = mountHost({ root: half, promptLocale: 'zh' })
      const listed = await host.text('list_experts', {})
      // The roster still works; only the Chinese half is gone, so the notice
      // rides along with the experts instead of replacing them.
      expect(listed).toContain('Frontend Developer')
      expect(listed).toContain(formatHost('zh', 'error.zhRootMissing', { root: join(half, 'zh') }))
    } finally {
      await rm(half, { recursive: true, force: true })
    }
  })

  it('re-reads the asset tree when an expert is added', async () => {
    const host = mountHost({ root, promptLocale: 'zh' })
    expect(await host.text('list_experts', {})).not.toContain('迟到工程师')
    // What `pnpm sync:upstream` does to a running Host: the tree gains a file
    // while the cached roster is still alive.
    await writeFile(join(en, 'engineering', 'engineering-late.md'),
      '---\nname: Late Engineer\ndescription: Arrives later.\nemoji: 🕐\n---\n\nLate persona\n', 'utf8')
    await writeFile(join(zh, 'engineering', 'engineering-late.md'),
      '---\nname: 迟到工程师\ndescription: 后来才到。\nemoji: 🕐\n---\n', 'utf8')
    expect(await host.text('list_experts', {})).toContain('迟到工程师')
  })

  it('logs what a hand-edited document got wrong instead of refusing the section', () => {
    // A malformed entry costs the user that expert and nothing else — but the
    // reason has to be on the record, or the roster silently loses entries.
    const host = mountHost({
      root,
      promptLocale: 'zh',
      customExperts: [{ slug: 'not-a-custom-slug', name: '坏条目' }],
    })
    expect(host.warnings.filter((line) => line.includes('customExperts[0]'))).toHaveLength(1)
    expect(host.warnings[0]).toContain('[agency-agents-ll]')
  })

  it('treats a container that is not an array as no custom experts', async () => {
    // `customExperts: "oops"` must cost the user their custom experts until they
    // fix it, not cost them the whole namespace registration.
    const host = mountHost({ root, promptLocale: 'zh', customExperts: 'oops' })
    const listed = await host.text('list_experts', {})
    expect(listed).toContain('前端开发工程师')
    expect(listed).not.toContain('我的专家')
  })
})
