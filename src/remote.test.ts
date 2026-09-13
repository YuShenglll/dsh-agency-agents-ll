/**
 * Remote-layer coverage: the state read/write path and its revision fencing.
 *
 * The Host service is exercised through a fake Cordis context that exposes only
 * the seams it uses (`ctx.settings`, `ctx.get`, `ctx.reflect`, `ctx.effect`,
 * `ctx.typert`), so the tests describe the contract rather than the framework.
 */
import { rm, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { remoteMethods, type InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import { loadCatalog, type Expert } from './catalog.js'
import { coercePromptLocale, resolvePromptLocale, SETTINGS_NS } from './contract.js'
import type { CustomExpertInput } from './expert-contract.js'
import { formatHost } from './i18n.js'
import { createPersonaSource } from './index.js'
import { DIVISIONS } from './names.js'
import AgencyAgentsRemote from './remote.js'
import { AGENCY_AGENTS_DESCRIPTORS } from './remote-contract.js'
import {
  AGENCY_LIBRARY_SERVICE,
  AGENCY_PERSONA_SERVICE,
  createRosterLibrary,
  type RosterSettingsState,
} from './roster-settings.js'

/** A settings namespace stand-in with the revision behaviour of the real one. */
interface FakeSettings {
  state: RosterSettingsState
  promptLocale: 'auto' | 'zh' | 'en'
  localePreference: string
  revision: number
  get(ns: string): unknown
  describe(): Array<{ ns: string; revision: number }>
  mutate(ns: string, ops: readonly { op: 'set'; path: readonly string[]; value: unknown }[], expectedRevision?: number): Promise<void>
}

/**
 * Build the smallest context the Remote service accepts.
 * @param settings - fake settings provider.
 * @param services - services reachable through `ctx.get`.
 * @param registered - receives every Typert contribution the service registers.
 * @returns the fake context, which the constructor is handed through a cast.
 */
function fakeContext(
  settings: FakeSettings,
  services: Map<string, unknown>,
  registered: unknown[],
): unknown {
  return {
    settings,
    // `Service`'s constructor registers itself through `ctx.reflect.provide`,
    // so the fake context has to accept that call.
    reflect: {
      provide: (key: string, value: unknown) => {
        services.set(key, value)
        return () => { services.delete(key) }
      },
    },
    typert: { register: (contribution: unknown) => { registered.push(contribution); return async () => {} } },
    effect: (body: () => unknown) => { body(); return async () => {} },
    get: (key: string) => services.get(key),
  }
}

/** A settings namespace whose revision advances once per accepted write. */
function fakeSettings(): FakeSettings {
  const settings: FakeSettings = {
    state: { enabled: [], customExperts: [] },
    promptLocale: 'en',
    localePreference: 'zh',
    revision: 0,
    get(ns) {
      if (ns === 'locale') return { preference: settings.localePreference }
      if (ns === SETTINGS_NS) return { promptLocale: settings.promptLocale, ...settings.state }
      return undefined
    },
    describe() {
      return [{ ns: SETTINGS_NS, revision: settings.revision }]
    },
    async mutate(ns, ops, expectedRevision) {
      if (ns !== SETTINGS_NS) throw new Error(`unexpected namespace ${ns}`)
      if (expectedRevision !== undefined && expectedRevision !== settings.revision) {
        throw new Error('the section changed since it was read')
      }
      for (const op of ops) {
        const key = op.path[0]
        if (key === 'enabled') settings.state = { ...settings.state, enabled: op.value as string[] }
        if (key === 'customExperts') settings.state = { ...settings.state, customExperts: op.value as unknown[] }
      }
      settings.revision += 1
    },
  }
  return settings
}

/**
 * Validate one parameter the way the gateway codec validates it off the wire.
 * @param descriptor - the invocation descriptor under test.
 * @param index - parameter position.
 * @param value - untrusted wire value.
 * @returns the validated value.
 */
function parseParameter(descriptor: InvocationDescriptor | undefined, index: number, value: unknown): unknown {
  const parameter = descriptor?.parameters[index]
  if (parameter === undefined || parameter.codec.mode !== 'strict') {
    throw new Error('expected a strict parameter codec')
  }
  return parameter.codec.schema.parse(value)
}

describe('roster library over a settings store', () => {
  let root = ''
  let en = ''
  let zh = ''
  let experts: Expert[] = []

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'll-remote-'))
    en = join(root, 'en')
    zh = join(root, 'zh')
    await mkdir(join(en, 'engineering'), { recursive: true })
    await mkdir(join(zh, 'engineering'), { recursive: true })
    await writeFile(join(en, 'engineering', 'engineering-frontend.md'),
      '---\nname: Frontend Developer\ndescription: Builds UIs.\nemoji: 🎨\n---\n\nEnglish persona body\n', 'utf8')
    await writeFile(join(zh, 'engineering', 'engineering-frontend.md'),
      '---\nname: 前端开发工程师\ndescription: 负责 Web 前端开发。\nintro: 前端开发专家，负责把设计落成可用的界面。\nemoji: 🎨\n---\n\n中文人设正文\n', 'utf8')
    await writeFile(join(en, 'engineering', 'engineering-agentic.md'),
      '---\nname: Agentic Engineer\ndescription: Builds agents.\nemoji: 🧭\n---\n\nAnother English body\n', 'utf8')
    // intro-only archive: Chinese metadata, English persona body
    await writeFile(join(zh, 'engineering', 'engineering-agentic.md'),
      '---\nname: 智能体工程师\ndescription: 负责智能体系统。\nintro: 智能体工程师，负责多智能体系统的设计与落地。\nemoji: 🧭\n---\n', 'utf8')
    experts = [...(await loadCatalog({ en, zh }, ['engineering'])).experts.values()]
  })

  afterAll(async () => {
    if (root !== '') await rm(root, { recursive: true, force: true })
  })

  /** Wire one Remote service over a fresh fake settings document. */
  function mount(options?: { readonly preference?: 'auto' | 'zh' | 'en' }) {
    const settings = fakeSettings()
    settings.promptLocale = options?.preference ?? 'en'
    const registered: unknown[] = []
    const services = new Map<string, unknown>()
    const library = createRosterLibrary(
      async () => experts,
      {
        read: () => settings.state,
        revision: () => settings.revision,
        mutate: (ops, expectedRevision) => settings.mutate(SETTINGS_NS, ops, expectedRevision),
      },
      () => coercePromptLocale(settings.promptLocale),
      () => (settings.localePreference === 'en' ? 'en' : 'zh'),
    )
    // The Host's own persona source, not a copy: the custom-vs-shipped branches
    // this suite cares about only exist in one place.
    const personaSource = createPersonaSource(library, { en, zh })
    services.set(AGENCY_LIBRARY_SERVICE, library)
    services.set(AGENCY_PERSONA_SERVICE, personaSource)
    const Service = AgencyAgentsRemote as unknown as new (ctx: unknown) => AgencyAgentsRemote
    const remote = new Service(fakeContext(settings, services, registered))
    return { remote, settings, registered, library }
  }

  const newExpert: CustomExpertInput = {
    name: '自定义评审员',
    description: '负责代码评审。',
    division: 'engineering',
    emoji: '🧪',
    intro: '代码评审专家，负责在合并前找出实现与契约的偏差。',
    prompt: '你是代码评审员。',
  }

  it('publishes one Remote marker per descriptor', () => {
    const { remote, registered } = mount()
    const exported = remoteMethods(remote).map((marker) => marker.exportName ?? marker.method).sort()
    expect(exported).toEqual([
      'deleteCustomExpert',
      'getCatalog',
      'getCustomExpert',
      'getEnabled',
      'getPrompt',
      'getPromptLocale',
      'saveCustomExpert',
      'setEnabled',
    ])
    expect(registered).toHaveLength(1)
    const contribution = registered[0] as { package: string; face: string; invocations: readonly { method: string }[] }
    expect(contribution.package).toBe('dsh-agency-agents-ll')
    expect(contribution.face).toBe('host')
    expect(contribution.invocations.map((descriptor) => descriptor.method)).toEqual(
      AGENCY_AGENTS_DESCRIPTORS.map((descriptor) => descriptor.method),
    )
  })

  it('returns the roster with the Chinese introduction and translation flag', async () => {
    const { remote } = mount()
    const catalog = await remote.getCatalog()
    expect(catalog.revision).toBe(0)
    expect(catalog.promptLocale).toBe('en')
    expect(catalog.enabled).toEqual([])
    const frontend = catalog.experts.find((expert) => expert.slug === 'engineering-frontend')
    // The name stays Chinese even though the prompt language is English: names
    // do not switch, only personas do.
    expect(frontend?.name).toBe('前端开发工程师')
    expect(frontend?.nameEn).toBe('Frontend Developer')
    expect(frontend?.intro).toContain('前端开发专家')
    expect(frontend?.translated).toBe(true)
    const agentic = catalog.experts.find((expert) => expert.slug === 'engineering-agentic')
    expect(agentic?.intro).toContain('智能体工程师')
    // Intro-only archive: Chinese metadata, but the persona still falls back.
    expect(agentic?.translated).toBe(false)
  })

  it('writes the enabled set under the held revision', async () => {
    const { remote, settings, library } = mount()
    expect(library.enabledState()).toEqual({ enabled: [], revision: 0 })
    const written = await remote.setEnabled(['engineering-frontend'], 0)
    expect(written).toEqual({ enabled: ['engineering-frontend'], revision: 1 })
    expect(settings.state.enabled).toEqual(['engineering-frontend'])
    const catalog = await remote.getCatalog()
    expect(catalog.enabled).toEqual(['engineering-frontend'])
    expect(catalog.revision).toBe(1)
  })

  it('refuses a write whose revision is stale', async () => {
    const { remote } = mount()
    await remote.setEnabled(['engineering-frontend'], 0)
    // A second window still holding revision 0 must not overwrite the first.
    await expect(remote.setEnabled(['engineering-agentic'], 0)).rejects.toThrow(/changed since it was read/)
    await expect(remote.setEnabled(['engineering-agentic'], 0)).rejects.toThrow(/其他窗口/)
    await expect(remote.setEnabled(['engineering-agentic'], -1)).rejects.toThrow(/changed since it was read/)
    await expect(remote.setEnabled(['engineering-agentic'], Number.NaN)).rejects.toThrow(/changed since it was read/)
    // The window that reloaded succeeds.
    expect(await remote.setEnabled(['engineering-agentic'], 1)).toEqual({ enabled: ['engineering-agentic'], revision: 2 })
  })

  it('refuses to enable an expert that is not on the roster', async () => {
    const { remote } = mount()
    await expect(remote.setEnabled(['nope'], 0)).rejects.toThrow()
    await expect(remote.setEnabled(['custom-00000000-0000-4000-8000-000000000000'], 0)).rejects.toThrow()
  })

  it('creates, reads, enables and deletes a custom expert', async () => {
    const { remote, library } = mount()
    const created = await remote.saveCustomExpert(newExpert, true, 0)
    expect(created.revision).toBe(1)
    const custom = created.experts.find((expert) => expert.custom)
    expect(custom?.name).toBe('自定义评审员')
    expect(custom?.intro).toContain('代码评审专家')
    expect(custom?.translated).toBe(true)
    // The write answer already reflects the new document.
    expect(created.enabled).toEqual([custom?.slug])

    const reloaded = await remote.getCustomExpert(custom?.slug ?? '')
    expect(reloaded.name).toBe('自定义评审员')
    expect(reloaded.prompt).toBe('你是代码评审员。')

    // A custom expert serves its own persona; there is nothing to fall back to.
    expect(await remote.getPrompt(custom?.slug ?? '', 'engineering'))
      .toEqual({ prompt: '你是代码评审员。', locale: 'zh', fallback: false })

    const disabled = await library.setEnabled([], 1)
    expect(disabled.enabled).toEqual([])

    const removed = await remote.deleteCustomExpert(custom?.slug ?? '', disabled.revision)
    expect(removed.experts.some((expert) => expert.custom)).toBe(false)
    expect(removed.enabled).toEqual([])
    // The read path reports the miss rather than serving an empty persona.
    let thrown: unknown
    try { remote.getCustomExpert(custom?.slug ?? '') } catch (cause: unknown) { thrown = cause }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain('不存在')
  })

  it('refuses a custom expert edit under a stale revision', async () => {
    const { remote } = mount()
    const created = await remote.saveCustomExpert(newExpert, false, 0)
    const slug = created.experts.find((expert) => expert.custom)?.slug ?? ''
    await expect(remote.saveCustomExpert({ ...newExpert, slug, name: '改名' }, false, 0))
      .rejects.toThrow(/changed since it was read/)
    await expect(remote.deleteCustomExpert(slug, 0)).rejects.toThrow(/changed since it was read/)
    // The refused writes left the document alone.
    expect((await remote.getCustomExpert(slug)).name).toBe('自定义评审员')
  })

  it('rejects a malformed or colliding custom expert instead of storing it', async () => {
    const { remote } = mount()
    await expect(remote.saveCustomExpert({ ...newExpert, emoji: 'abc' }, false, 0)).rejects.toThrow(/请检查/)
    await expect(remote.saveCustomExpert({ ...newExpert, name: '' }, false, 0)).rejects.toThrow(/请检查/)
    await expect(remote.saveCustomExpert({ ...newExpert, slug: 'engineering-frontend' }, false, 0)).rejects.toThrow(/请检查/)
    // A new expert may not make an existing name ambiguous.
    await expect(remote.saveCustomExpert({ ...newExpert, name: 'Frontend Developer' }, false, 0)).rejects.toThrow(/已被占用/)
    await expect(remote.saveCustomExpert({ ...newExpert, name: '前端开发工程师' }, false, 0)).rejects.toThrow(/已被占用/)
  })

  it('serves the prompt in the language the preference resolves to', async () => {
    const english = mount({ preference: 'en' })
    expect(english.remote.getPromptLocale()).toEqual({ preference: 'en', effective: 'en' })
    expect(await english.remote.getPrompt('engineering-frontend', 'engineering'))
      .toEqual({ prompt: 'English persona body', locale: 'en', fallback: false })

    const chinese = mount({ preference: 'zh' })
    expect(chinese.remote.getPromptLocale()).toEqual({ preference: 'zh', effective: 'zh' })
    expect(await chinese.remote.getPrompt('engineering-frontend', 'engineering'))
      .toEqual({ prompt: '中文人设正文', locale: 'zh', fallback: false })
    // intro-only archive: asking for Chinese serves English and says so
    expect(await chinese.remote.getPrompt('engineering-agentic', 'engineering'))
      .toEqual({ prompt: 'Another English body', locale: 'en', fallback: true })

    // `auto` follows the interface language
    const auto = mount({ preference: 'auto' })
    expect(auto.remote.getPromptLocale()).toEqual({ preference: 'auto', effective: 'zh' })
    auto.settings.localePreference = 'en'
    expect(auto.remote.getPromptLocale()).toEqual({ preference: 'auto', effective: 'en' })
  })

  it('rejects a prompt request for an unknown expert', async () => {
    const { remote } = mount()
    await expect(remote.getPrompt('nope', 'engineering')).rejects.toThrow(/nope/)
  })

  it('refuses a custom persona read through a division it does not belong to', async () => {
    const { remote } = mount()
    const created = await remote.saveCustomExpert(newExpert, true, 0)
    const slug = created.experts.find((expert) => expert.custom)?.slug ?? ''
    await expect(remote.getPrompt(slug, 'design'))
      .rejects.toThrow(formatHost('en', 'error.expertMissing', { query: slug }))
    // The division it does belong to still serves the stored persona.
    expect(await remote.getPrompt(slug, 'engineering'))
      .toEqual({ prompt: newExpert.prompt, locale: 'zh', fallback: false })
  })

  it('reports a custom-shaped slug that no document holds', async () => {
    const { remote } = mount()
    const stranger = 'custom-33333333-3333-4333-8333-333333333333'
    // No asset tree can hold a `custom-` slug, so the miss is reported as one
    // rather than being probed for on disk.
    await expect(remote.getPrompt(stranger, 'engineering'))
      .rejects.toThrow(formatHost('en', 'error.expertMissing', { query: stranger }))
  })

  it('constrains the getPrompt boundary to a roster slug and a known division', () => {
    const prompt = AGENCY_AGENTS_DESCRIPTORS.find((descriptor) => descriptor.method === 'getPrompt')
    expect(prompt).toBeDefined()
    // `division` and `slug` are joined onto an asset path, so a crafted pair
    // must not survive the wire boundary.
    for (const attack of ['../../../../Users/LL/secret', '..', '../secret', '/etc/passwd', 'C:\\Windows\\win.ini', 'engineering/../../secret', '']) {
      expect(() => parseParameter(prompt, 0, attack)).toThrow()
    }
    for (const attack of ['..', '../..', 'engineering/../../secret', 'academic ', '']) {
      expect(() => parseParameter(prompt, 1, attack)).toThrow()
    }
    // Every legitimate value still passes: the shipped slugs, every division
    // the roster defines, and a Host-minted custom slug.
    expect(parseParameter(prompt, 0, 'engineering-frontend')).toBe('engineering-frontend')
    expect(parseParameter(prompt, 0, 'custom-22222222-2222-4222-8222-222222222222'))
      .toBe('custom-22222222-2222-4222-8222-222222222222')
    for (const division of DIVISIONS) expect(parseParameter(prompt, 1, division)).toBe(division)
  })

  it('keeps the revision fence authoritative when the store refuses the fence itself', async () => {
    const { remote, settings } = mount()
    // Simulate a concurrent writer that moved the document between the read and
    // the write: the store refuses, and the failure must reach the caller.
    settings.revision = 5
    await expect(remote.setEnabled(['engineering-frontend'], 0)).rejects.toThrow(/changed since it was read/)
    expect(settings.state.enabled).toEqual([])
  })

  it('reports a missing roster service instead of serving an empty roster', () => {
    const settings = fakeSettings()
    const services = new Map<string, unknown>()
    const Service = AgencyAgentsRemote as unknown as new (ctx: unknown) => AgencyAgentsRemote
    const remote = new Service(fakeContext(settings, services, []))
    expect(() => remote.getEnabled()).toThrow(formatHost('zh', 'error.rosterUnavailable'))
  })

  it('resolves the persona language the same way the host tools do', () => {
    expect(resolvePromptLocale(coercePromptLocale('auto'), 'en')).toBe('en')
    expect(resolvePromptLocale(coercePromptLocale('zh'), 'en')).toBe('zh')
    expect(resolvePromptLocale(coercePromptLocale(undefined), 'zh')).toBe('en')
  })
})
