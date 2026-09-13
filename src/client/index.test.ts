// @vitest-environment jsdom
/**
 * Roster page behaviour, driven through the real registration path.
 *
 * The fixture is deliberately the shipped shape — 279 experts across 18
 * divisions with full-length Chinese introductions — because the failure this
 * spec exists for only appears once the page is carrying the real volume.
 */
import { resolve } from 'node:path'
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DIVISIONS } from '../names.js'
import { loadCatalog } from '../catalog.js'
import { createRosterLibrary, type RosterSettingsStore } from '../roster-settings.js'
import type { CatalogSnapshot, CustomExpertInput, ExpertSummary } from '../expert-contract.js'
import { apply, buildReference } from './index.js'
import { acceptCatalog, acceptEnabled, catalogState } from './catalog.js'
import { AVATARS } from './avatars.js'
import { DICTIONARIES } from './locales.js'
import type { AgencyRosterRemote } from './remote.js'

/** The shipped asset trees, read exactly as the Host reads them. */
const ASSET_ROOT = {
  en: resolve(process.cwd(), 'assets/en'),
  zh: resolve(process.cwd(), 'assets/zh'),
}

/**
 * A settings store that stores nothing: this fixture only needs the projection.
 *
 * `createRosterLibrary` is the real Host path, so `conflict` is computed here
 * exactly as it is in production. Projecting with `toExpertSummary` alone —
 * which hardcodes `conflict: false` — is how two shipped experts sharing a
 * Chinese name stayed invisible to every assertion in this file.
 */
function emptyStore(): RosterSettingsStore {
  return {
    read: () => ({ enabled: [], customExperts: [] }),
    revision: () => 7,
    mutate: async () => {},
  }
}

/** The real roster, through the same projection the Host serves. */
async function shippedRoster(): Promise<ExpertSummary[]> {
  const { experts } = await loadCatalog(ASSET_ROOT, DIVISIONS)
  const library = createRosterLibrary(
    () => Promise.resolve([...experts.values()]),
    emptyStore(),
    () => 'en',
    () => 'zh',
  )
  return (await library.catalog()).experts
}

/** The subset of the Remote face the page uses, with a controllable revision. */
interface FakeRemote {
  calls: string[]
  revision: number
  enabled: string[]
  catalog: CatalogSnapshot
  failNextWrite: boolean
  /** Hold every `setEnabled` until {@link FakeRemote.release} is called. */
  hold(): void
  release(): void
  /** Hold every `getPrompt` until {@link FakeRemote.releasePrompts} is called. */
  holdPrompts(): void
  releasePrompts(): void
  getCatalog(): Promise<{ ok: true; value: CatalogSnapshot }>
  setEnabled(enabled: string[], expectedRevision: number): Promise<{ ok: true; value: { enabled: string[]; revision: number } } | { ok: false; error: { code: string; message: string } }>
  getPrompt(slug: string, division: string): Promise<{ ok: true; value: { prompt: string; locale: 'zh' | 'en'; fallback: boolean } }>
  getCustomExpert(slug: string): Promise<{ ok: true; value: CustomExpertInput } | { ok: false; error: { code: string; message: string } }>
  getEnabled(): Promise<{ ok: true; value: { enabled: string[]; revision: number } }>
  getPromptLocale(): Promise<{ ok: true; value: { promptLocale: CatalogSnapshot['promptLocale']; revision: number } }>
  saveCustomExpert(): Promise<{ ok: false; error: { code: string; message: string } }>
  deleteCustomExpert(): Promise<{ ok: false; error: { code: string; message: string } }>
}

/** One synthetic expert, sized like a real roster entry. */
function expert(index: number, division: string, slug: string): ExpertSummary {
  const intro = `这位专家负责第 ${index} 项工作，覆盖从问题定义到结论交付的完整链路。`
    + '他习惯先把边界画清楚，再逐项核对证据，最后给出可执行的结论与风险清单。'
    + '当你要处理的正是这一类问题时，就该找他。'
  return {
    slug,
    division,
    emoji: '🧭',
    name: `专家${index}`,
    nameEn: `Expert ${index}`,
    description: `第 ${index} 位专家的一句话说明。`,
    descriptionEn: `One-line description for expert ${index}.`,
    intro,
    translated: false,
    custom: false,
    conflict: false,
  }
}

/** A realistic roster: every division populated, 279 entries in total. */
function roster(): ExpertSummary[] {
  const out: ExpertSummary[] = []
  const perDivision = Math.floor(279 / DIVISIONS.length)
  for (const [divisionIndex, division] of DIVISIONS.entries()) {
    const size = divisionIndex === DIVISIONS.length - 1 ? 279 - out.length : perDivision
    for (let i = 0; i < size; i += 1) {
      out.push(expert(out.length + 1, division, `${division}-expert-${String(i).padStart(2, '0')}`))
    }
  }
  return out
}

function createRemote(experts: ExpertSummary[]): FakeRemote {
  let gate: (() => void) | undefined
  let held: Promise<void> = Promise.resolve()
  let promptGate: (() => void) | undefined
  let promptHeld: Promise<void> = Promise.resolve()
  const remote: FakeRemote = {
    calls: [],
    revision: 7,
    enabled: [],
    failNextWrite: false,
    hold() {
      held = new Promise<void>((resolve) => { gate = resolve })
    },
    release() {
      gate?.()
      gate = undefined
      held = Promise.resolve()
    },
    holdPrompts() {
      promptHeld = new Promise<void>((resolve) => { promptGate = resolve })
    },
    releasePrompts() {
      promptGate?.()
      promptGate = undefined
      promptHeld = Promise.resolve()
    },
    catalog: undefined as unknown as CatalogSnapshot,
    async getCatalog() {
      remote.calls.push('getCatalog')
      return { ok: true, value: remote.catalog }
    },
    async setEnabled(enabled, expectedRevision) {
      remote.calls.push('setEnabled')
      await held
      if (remote.failNextWrite) {
        remote.failNextWrite = false
        return { ok: false, error: { code: 'internal', message: 'boom' } }
      }
      if (expectedRevision !== remote.revision) {
        // The Host's own wording: `isSettingsConflict` classifies a relayed
        // failure by this text, because the Remote hop carries only the message.
        return { ok: false, error: { code: 'conflict', message: 'the section changed since it was read' } }
      }
      remote.revision += 1
      remote.enabled = enabled
      remote.catalog = { ...remote.catalog, enabled, revision: remote.revision }
      return { ok: true, value: { enabled, revision: remote.revision } }
    },
    async getPrompt(slug, _division) {
      remote.calls.push('getPrompt')
      await promptHeld
      return { ok: true, value: { prompt: `PERSONA ${slug}`, locale: 'en', fallback: true } }
    },
    async getCustomExpert() {
      return { ok: false, error: { code: 'missing', message: 'not custom' } }
    },
    async getEnabled() {
      return { ok: true, value: { enabled: remote.enabled, revision: remote.revision } }
    },
    async getPromptLocale() {
      return { ok: true, value: { promptLocale: 'en', revision: remote.revision } }
    },
    async saveCustomExpert() {
      return { ok: false, error: { code: 'invalid', message: 'not supported' } }
    },
    async deleteCustomExpert() {
      return { ok: false, error: { code: 'missing', message: 'not supported' } }
    },
  }
  remote.catalog = { experts, enabled: [], revision: remote.revision, promptLocale: 'en' }
  return remote
}

/** Mount the plugin against a fake client context and hand back the page. */
async function mount(remote: FakeRemote): Promise<{
  component: React.ComponentType<Record<string, unknown>>
  composer: React.ComponentType<Record<string, unknown>>
  t: (key: string) => string
  options: Record<string, unknown>
  sources: Array<Record<string, unknown>>
}> {
  const registered: Array<{ options: Record<string, unknown>; component: React.ComponentType<Record<string, unknown>> }> = []
  const sources: Array<Record<string, unknown>> = []
  const t = (key: string): string => (DICTIONARIES.zh as Record<string, string>)[key] ?? key

  const ctx = {
    effect: (run: () => unknown) => run(),
    logger: { warn: () => {} },
    locale: {
      register: () => () => {},
      bind: () => t,
      getSnapshot: () => ({ active: 'zh', revision: 1 }),
    },
    settingsScope: {
      bind: () => ({ getSnapshot: () => ({ value: { promptLocale: 'en' as const } }), set: async () => {} }),
    },
    slots: {
      inject: (name: string, callback: () => unknown) => {
        if (name === 'settings.section' || name === 'conversation.input.left') callback()
      },
      register: (options: Record<string, unknown>, component: React.ComponentType<Record<string, unknown>>) => {
        registered.push({ options, component })
        return () => {}
      },
    },
    remote: { $mount: async () => async () => {} },
    inputTriggers: { registerSource: (source: Record<string, unknown>) => { sources.push(source); return () => {} } },
    get: () => remote,
  }

  apply(ctx as unknown as Parameters<typeof apply>[0])
  // Registration is deferred until the Remote face is mounted, so the fake
  // context needs its microtask queue drained before the section exists.
  for (let tick = 0; tick < 8; tick += 1) {
    await act(async () => { await Promise.resolve() })
  }

  const entry = registered.find((item) => item.options.name === 'settings.section')
  if (entry === undefined) throw new Error('the settings section was never registered')
  const composer = registered.find((item) => item.options.name === 'conversation.input.left')
  if (composer === undefined) throw new Error('the composer button was never registered')
  return { component: entry.component, composer: composer.component, t, options: entry.options, sources }
}

/** The revision the page holds, read from the very cache the page renders. */
function heldRevision(remote: FakeRemote): number {
  return catalogState(remote as unknown as AgencyRosterRemote).revision
}

describe('roster settings page', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    container.remove()
  })

  it('renders the whole roster', async () => {
    const remote = createRemote(roster())
    const { component, t } = await mount(remote)
    await act(async () => { root.render(React.createElement(component, { t })) })

    const cards = container.querySelectorAll('.aall-card')
    expect(cards.length).toBe(279)
    expect(container.querySelectorAll('.aall-group').length).toBe(18)
  })

  it('keeps the page alive across consecutive enables', async () => {
    const remote = createRemote(roster())
    const { component, t } = await mount(remote)
    await act(async () => { root.render(React.createElement(component, { t })) })

    const toggleAt = async (index: number): Promise<void> => {
      const input = container.querySelectorAll<HTMLInputElement>('.aall-card .aall-switch-input')[index]
      if (input === undefined) throw new Error(`no toggle at ${index}`)
      await act(async () => { input.click(); await Promise.resolve(); await Promise.resolve() })
    }

    await toggleAt(1)
    expect(remote.enabled.length).toBe(1)
    expect(container.querySelectorAll('.aall-card').length, 'after the second expert was enabled').toBe(279)

    await toggleAt(2)
    expect(remote.enabled.length).toBe(2)
    expect(container.querySelectorAll('.aall-card').length, 'after the third expert was enabled').toBe(279)

    const stuck = [...container.querySelectorAll<HTMLInputElement>('.aall-switch-input')].filter((input) => input.disabled)
    expect(stuck.length, 'every toggle must be clickable again once the write settles').toBe(0)
  })
})

describe('roster settings page against the shipped roster', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    container.remove()
  })

  it('sees the shipped roster through the Host projection, conflicts included', async () => {
    const experts = await shippedRoster()
    // `toExpertSummary` alone hardcodes `conflict: false`; only `project()`
    // computes it. Two shipped experts once shared the Chinese name
    // 电商购物车工程师 and this fixture could not see it, which made the "no
    // toggle may be left disabled" assertion below vacuous. Uniqueness is a
    // content gate now; this is what keeps the fixture honest about it.
    expect(experts.filter((expert) => expert.conflict).map((expert) => expert.slug)).toEqual([])
  })

  it('renders every shipped expert with its Chinese introduction', async () => {
    const experts = await shippedRoster()
    expect(experts.length).toBe(279)

    const remote = createRemote(experts)
    const { component, t } = await mount(remote)
    await act(async () => { root.render(React.createElement(component, { t })) })

    expect(container.querySelectorAll('.aall-card').length).toBe(279)
    const missing = [...container.querySelectorAll('.aall-intro')].filter((node) => node.textContent?.includes('尚未提供中文简介'))
    expect(missing.length, 'every shipped expert must carry an introduction').toBe(0)
  })

  it('survives enabling the second and third shipped expert', async () => {
    const experts = await shippedRoster()
    const remote = createRemote(experts)
    const { component, t } = await mount(remote)
    await act(async () => { root.render(React.createElement(component, { t })) })

    const toggleAt = async (index: number): Promise<void> => {
      const input = container.querySelectorAll<HTMLInputElement>('.aall-card .aall-switch-input')[index]
      if (input === undefined) throw new Error(`no toggle at ${index}`)
      expect(input.disabled, `toggle ${index} must be clickable`).toBe(false)
      await act(async () => { input.click(); await Promise.resolve(); await Promise.resolve() })
    }

    await toggleAt(1)
    expect(container.querySelectorAll('.aall-card').length).toBe(279)
    await toggleAt(2)
    expect(container.querySelectorAll('.aall-card').length).toBe(279)

    const stuck = [...container.querySelectorAll<HTMLInputElement>('.aall-switch-input')].filter((input) => input.disabled)
    expect(stuck.length, 'no toggle may be left disabled after the write settles').toBe(0)
  })
})

describe('composer summon menu', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    container.remove()
  })

  /** Open the menu and hand back the trigger. */
  const openMenu = async (): Promise<void> => {
    const experts = await shippedRoster()
    const remote = createRemote(experts)
    remote.enabled = experts.slice(0, 3).map((expert) => expert.slug)
    remote.catalog = { ...remote.catalog, enabled: remote.enabled }
    const { composer, t } = await mount(remote)
    await act(async () => { root.render(React.createElement(composer, { t, insertReference: () => true })) })
    const trigger = container.querySelector<HTMLButtonElement>('.aall-btn')
    expect(trigger, 'the summon button must render').not.toBeNull()
    await act(async () => { trigger!.click(); await Promise.resolve() })
    expect(container.querySelector('.aall-menu'), 'the menu opens on click').not.toBeNull()
  }

  it('closes when the pointer presses anywhere else', async () => {
    await openMenu()

    // The menu covers the composer, and the pointer naturally goes there next.
    // A menu only its own trigger can close is the defect this pins.
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      await Promise.resolve()
    })
    expect(container.querySelector('.aall-menu'), 'an outside press dismisses it').toBeNull()
  })

  it('closes on Escape', async () => {
    await openMenu()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await Promise.resolve()
    })
    expect(container.querySelector('.aall-menu'), 'Escape dismisses it').toBeNull()
  })

  it('stays open when the press is inside it', async () => {
    await openMenu()
    const item = container.querySelector('.aall-menu-item')
    expect(item).not.toBeNull()
    await act(async () => {
      item!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      await Promise.resolve()
    })
    expect(container.querySelector('.aall-menu'), 'a press inside must not dismiss').not.toBeNull()
  })

  it('contains a composer render failure instead of retiring the slot entry', async () => {
    // React re-dispatches a caught error as a DOM error event so DevTools can
    // see it; jsdom would report that as an uncaught exception. Claim it here.
    const claim = (event: Event): void => { event.preventDefault() }
    window.addEventListener('error', claim)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    // `conversation.input.left` is one slot entry: a throw during render retires
    // it for the life of the page unless a boundary catches it, exactly like the
    // settings section. This snapshot shape is what the composer cannot read.
    const broken = createRemote(roster())
    broken.catalog = { ...broken.catalog, experts: undefined as unknown as ExpertSummary[] }

    const { composer, t } = await mount(broken)
    await act(async () => { root.render(React.createElement(composer, { t, insertReference: () => true })) })
    logged.mockRestore()
    window.removeEventListener('error', claim)

    const alert = container.querySelector('.aall-error')
    expect(alert, 'a thrown render must surface as a message, not an empty input bar').not.toBeNull()
    expect(alert?.textContent).toContain('TypeError')
  })
})

describe('roster page presentation', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    container.remove()
  })

  it('is called "专家库" in the settings navigation', async () => {
    const remote = createRemote(roster())
    const { options } = await mount(remote)
    const label = options.label as (() => string) | undefined
    expect(label?.(), 'the settings entry name').toBe('专家库')
  })

  it('shows the title, the count and the actions, with no subtitle line', async () => {
    const remote = createRemote(roster())
    const { component, t } = await mount(remote)
    await act(async () => { root.render(React.createElement(component, { t })) })

    expect(container.querySelector('.aall-title')?.textContent).toBe('专家库')
    expect(container.querySelector('.aall-subtitle'), 'the subtitle line was removed').toBeNull()
    expect(container.querySelector('.aall-summary')?.textContent).toContain('共 279 位专家')
    expect(container.querySelector('.aall-actions')?.textContent).toContain('新建自定义专家')

    // All three are siblings under the section. A dropped parenthesis in the
    // createElement chain turns the tail into a comma expression, which still
    // parses, so assert the nesting rather than only that each part exists.
    expect(container.querySelector('.aall-section > .aall-head')).not.toBeNull()
    expect(container.querySelector('.aall-section > .aall-filters')).not.toBeNull()
    expect(container.querySelector('.aall-filters .aall-head'), 'the filters must not swallow the head').toBeNull()
    expect(container.querySelector('.aall-filters > .aall-field-search'), 'the search field must stay a filter').not.toBeNull()
  })

  it('reads its label and tooltip from two separate dictionary keys', () => {
    // The button shows the short name; the tooltip keeps the fuller phrasing.
    expect(DICTIONARIES.zh['menu.button']).toBe('专家')
    expect(DICTIONARIES.zh['menu.title']).toBe('召唤专家')
    expect(DICTIONARIES.zh['nav']).toBe('专家库')
  })

  it('keeps the scrollbar painted so the content width cannot change', async () => {
    const remote = createRemote(roster())
    await mount(remote)

    const sheet = [...document.head.querySelectorAll('style')].map((tag) => tag.textContent).join('\n')
    const section = /\.aall-section\{([^}]*)\}/.exec(sheet)?.[1] ?? ''
    expect(section, 'the section rule must exist').not.toBe('')
    // The panel's bar is a real 8px gutter, so losing it widens the content box
    // and rewraps every card. Both guards are asserted because either one alone
    // can miss: the first needs a definite height on the container, the second
    // needs :has() to reach it.
    expect(section, 'the section must always overflow by a hair').toContain('min-height:calc(100% + 1px)')
    expect(sheet, 'and the container must reserve its gutter').toContain(':has(> .aall-section){scrollbar-gutter:stable}')
  })

  it('puts the header actions on the same right edge as the cards', async () => {
    const remote = createRemote(roster())
    await mount(remote)

    const sheet = [...document.head.querySelectorAll('style')].map((tag) => tag.textContent).join('\n')
    const actions = /\.aall-actions\{([^}]*)\}/.exec(sheet)?.[1] ?? ''
    const text = /\.aall-head-text\{([^}]*)\}/.exec(sheet)?.[1] ?? ''
    expect(actions, 'the actions must reach the right edge').toContain('margin-left:auto')
    expect(text, 'a growing text block is what pushes them there').toContain('flex:1 1 260px')
  })

  it('no longer lets a filter field grow with the scrollbar', async () => {
    const remote = createRemote(roster())
    await mount(remote)

    const sheet = [...document.head.querySelectorAll('style')].map((tag) => tag.textContent).join('\n')
    const field = /\.aall-field\{([^}]*)\}/.exec(sheet)?.[1] ?? ''
    expect(field, 'the field rule must exist').not.toBe('')
    expect(field, 'a growing field absorbs the scrollbar delta').toContain('flex:0 1')
  })

  it('gives every division heading a sticky band with its count', async () => {
    const remote = createRemote(roster())
    const { component, t } = await mount(remote)
    await act(async () => { root.render(React.createElement(component, { t })) })

    expect(container.querySelectorAll('.aall-group-title').length).toBe(18)
    expect(container.querySelector('.aall-group-title')?.textContent).toContain('学术')
    expect(container.querySelector('.aall-group-count')?.textContent).toBe('15')
  })

  it('gives the introduction the full card width, flush under the head row', async () => {
    const remote = createRemote(roster())
    const { component, t } = await mount(remote)
    await act(async () => { root.render(React.createElement(component, { t })) })

    // Not inside the indented identity column and not inside the head grid, so
    // its left edge is the card's own padding and its right edge is the one the
    // switch sits on.
    expect(container.querySelector('.aall-identity .aall-intro')).toBeNull()
    expect(container.querySelector('.aall-card-head .aall-intro')).toBeNull()
    expect(container.querySelector('.aall-card-body > .aall-intro')).not.toBeNull()
    expect(container.querySelector('.aall-card-body > .aall-description')).not.toBeNull()

    // The switch lives in the head row, which is the only gridded row left.
    expect(container.querySelector('.aall-card-head > .aall-switch')).not.toBeNull()
    expect(container.querySelector('.aall-card-head > .aall-emoji')).not.toBeNull()
  })

  it('keys an inserted reference by the registered source name', async () => {
    const experts = await shippedRoster()
    const { sources } = await mount(createRemote(experts))

    const source = sources.find((item) => item.trigger === '@')
    expect(source, 'the @ source must be registered').toBeDefined()

    // serializeReference looks the owner up with
    // `roster.all().find(s => s.name === reference.source)` and rejects with
    // "no serializer for reference source" otherwise, which blocks the whole
    // submit. Insertion still looks fine, so only sending reveals a mismatch.
    const reference = buildReference(experts[0]!, 'zh')
    expect(reference.source, 'the reference must carry the source name, not a per-division id').toBe(source!.name)
    expect(reference.source, 'a per-division source is what broke sending').not.toContain('academic')
  })

  it('answers an @ query from the held snapshot instead of refetching the roster', async () => {
    const experts = await shippedRoster()
    const remote = createRemote(experts)
    remote.enabled = [experts[0]!.slug]
    remote.catalog = { ...remote.catalog, enabled: remote.enabled }
    const { sources } = await mount(remote)

    const source = sources.find((item) => item.trigger === '@')
    expect(source, 'the @ source must be registered').toBeDefined()
    const candidates = source!.candidates as (session: unknown, request: { query: string }) => Promise<Array<{ hint?: string }>>
    const reads = (): number => remote.calls.filter((call) => call === 'getCatalog').length
    const before = reads()

    const listed = await candidates(undefined, { query: '' })
    expect(listed.length, 'the held snapshot already knows the enabled expert').toBe(1)
    expect(listed[0]?.hint).toBe(experts[0]!.slug)
    // A full getCatalog carries all 279 experts and their introductions; one per
    // keystroke is the defect this pins.
    expect(reads(), 'typing @ must not put the roster on the wire again').toBe(before)
  })

  it('keeps a name-conflicted expert out of the @ candidates', async () => {
    const experts = await shippedRoster()
    const twin: ExpertSummary = { ...experts[0]!, slug: 'twin-expert', conflict: true }
    const remote = createRemote([...experts, twin])
    remote.enabled = [twin.slug]
    remote.catalog = { ...remote.catalog, enabled: remote.enabled }
    const { sources } = await mount(remote)

    const source = sources.find((item) => item.trigger === '@')
    const candidates = source!.candidates as (session: unknown, request: { query: string }) => Promise<unknown[]>
    // A mention carries only the name, and `resolveExpert` refuses an ambiguous
    // one, so offering this expert would insert a reference that cannot be
    // summoned. The picker fails closed.
    expect(await candidates(undefined, { query: '' })).toEqual([])
  })

  it('gives the prompt dialog a heading name and closes it on Escape', async () => {
    const remote = createRemote(roster())
    const { component, t } = await mount(remote)
    await act(async () => { root.render(React.createElement(component, { t })) })

    const card = container.querySelector('.aall-card')
    const view = [...(card?.querySelectorAll('.aall-link') ?? [])].find((node) => node.textContent === '查看提示词')
    await act(async () => {
      (view as HTMLButtonElement).click()
      for (let tick = 0; tick < 6; tick += 1) await Promise.resolve()
    })

    const dialog = container.querySelector('.aall-dialog')
    expect(dialog, 'the prompt dialog opens').not.toBeNull()
    const labelId = dialog?.getAttribute('aria-labelledby')
    expect(labelId, 'a dialog must be named by its own heading').not.toBeNull()
    expect(container.querySelector(`#${String(labelId)}`)?.textContent).toContain('提示词')
    expect(container.querySelector('.aall-prompt')?.textContent, 'the read landed').toContain('PERSONA')

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await Promise.resolve()
    })
    expect(container.querySelector('.aall-dialog'), 'Escape closes the dialog').toBeNull()
  })

  it('shows the shipped artwork, and the emoji when there is none', async () => {
    const experts = await shippedRoster()
    const remote = createRemote(experts)
    const { component, t } = await mount(remote)
    await act(async () => { root.render(React.createElement(component, { t })) })

    // The avatar tree is kept off the repository, so a checkout may legitimately
    // hold none. Assert the wiring against whatever the generated module
    // carries, rather than against a count that only holds on one machine.
    const withArt = experts.filter((expert) => AVATARS[expert.slug] !== undefined).length
    const images = [...container.querySelectorAll('.aall-avatar')]
    expect(images.length, 'one image per expert that has artwork').toBe(withArt)

    // The artwork paints with #RRGGBB, and a raw # would open a fragment and
    // truncate the image at the first colour. This is the one real trap in
    // shipping SVG as a data URI.
    for (const image of images) {
      expect(image.getAttribute('src'), 'no raw # in a data URI').not.toContain('#')
    }

    // A slug with no artwork - a roster entry added upstream, say - keeps the
    // emoji from its frontmatter rather than rendering an empty circle. The
    // synthetic roster has no artwork at all, so this covers that path on any
    // machine.
    const fallback = await mount(createRemote(roster()))
    await act(async () => { root.render(React.createElement(fallback.component, { t: fallback.t })) })
    expect(container.querySelectorAll('.aall-avatar').length).toBe(0)
    expect(container.querySelector('.aall-emoji')?.textContent).toBe('🧭')
  })

  it('keeps the card switch label-free so the introduction reaches further right', async () => {
    const remote = createRemote(roster())
    const { component, t } = await mount(remote)
    await act(async () => { root.render(React.createElement(component, { t })) })

    const card = container.querySelector('.aall-card')
    expect(card?.querySelector('.aall-label'), 'the switch carries no text label').toBeNull()
    // The state still reaches assistive tech through the input's own name.
    const input = card?.querySelector<HTMLInputElement>('.aall-switch-input')
    expect(input?.getAttribute('aria-label')).toContain('启用')
  })

  it('offers exactly two actions on a shipped expert', async () => {
    const remote = createRemote(roster())
    const { component, t } = await mount(remote)
    await act(async () => { root.render(React.createElement(component, { t })) })

    const foot = container.querySelector('.aall-card .aall-card-foot')
    const labels = [...(foot?.querySelectorAll('.aall-link') ?? [])].map((node) => node.textContent)
    expect(labels).toEqual(['查看提示词', '复制提示词'])
    // Creating a custom expert stays a single page-level entry point.
    expect(container.querySelector('.aall-actions')?.textContent).toContain('新建自定义专家')
  })

  it('badges only the experts that actually carry a Chinese prompt', async () => {
    const experts = await shippedRoster()
    const remote = createRemote(experts)
    const { component, t } = await mount(remote)
    await act(async () => { root.render(React.createElement(component, { t })) })

    // 273 of 279 ship an English persona and no Chinese one, so badging that
    // default would put the same tag on almost every card. Only the exception
    // is marked, and a Chinese introduction is not what the badge means.
    const badged = [...container.querySelectorAll('.aall-badge')].filter((node) => node.textContent === '中文提示词')
    expect(badged.length).toBe(6)
    expect(experts.filter((expert) => expert.translated).length).toBe(6)
    expect(container.textContent).not.toContain('仅英文人设')
  })

  it('narrows the roster to enabled experts only', async () => {
    const experts = await shippedRoster()
    const remote = createRemote(experts)
    remote.catalog = { ...remote.catalog, enabled: ['academic-historian'] }
    const { component, t } = await mount(remote)
    await act(async () => { root.render(React.createElement(component, { t })) })
    expect(container.querySelectorAll('.aall-card').length).toBe(279)

    const box = [...container.querySelectorAll<HTMLInputElement>('.aall-check-control input')][0]
    expect(box, 'the enabled-only filter must exist').toBeDefined()
    await act(async () => { box!.click(); await Promise.resolve() })

    expect(container.querySelectorAll('.aall-card').length, 'only the enabled expert remains').toBe(1)
    expect(container.querySelector('.aall-name')?.textContent).toContain('历史学家')
  })

  it('offers deletion from the editor of an existing custom expert', async () => {
    const experts = await shippedRoster()
    const custom: ExpertSummary = {
      slug: 'custom-mine',
      division: 'engineering',
      emoji: '🧪',
      name: '我的专家',
      nameEn: '我的专家',
      description: '一句话说明。',
      descriptionEn: '一句话说明。',
      intro: '这是我自己写的专家简介，用来验证编辑弹窗里的删除入口。',
      translated: true,
      custom: true,
      conflict: false,
    }
    const remote = createRemote([...experts, custom])
    remote.getCustomExpert = async () => ({
      ok: true as const,
      value: { slug: 'custom-mine', name: '我的专家', description: '一句话说明。', division: 'engineering', emoji: '🧪', intro: custom.intro, prompt: 'PERSONA' },
    })
    const { component, t } = await mount(remote)
    await act(async () => { root.render(React.createElement(component, { t })) })

    const card = [...container.querySelectorAll('.aall-card')].find((node) => node.textContent?.includes('我的专家'))
    const edit = [...(card?.querySelectorAll('.aall-link') ?? [])].find((node) => node.textContent === '编辑')
    expect(edit, 'a custom expert is editable').toBeDefined()
    await act(async () => { (edit as HTMLButtonElement).click(); await Promise.resolve(); await Promise.resolve() })

    const dialog = container.querySelector('.aall-dialog')
    const remove = [...(dialog?.querySelectorAll('button') ?? [])].find((node) => node.textContent === '删除')
    expect(remove, 'the editor of an existing expert must offer deletion').toBeDefined()

    await act(async () => { (remove as HTMLButtonElement).click(); await Promise.resolve() })
    const confirm = DICTIONARIES.zh['custom.deleteConfirm'].replace('{name}', '我的专家')
    expect(container.textContent, 'deleting asks first').toContain(confirm)
    expect(container.querySelector('.aall-dialog'), 'the editor closes behind the confirmation').not.toBeNull()
  })
})

describe('roster page stays usable while a write is in flight', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    container.remove()
  })

  /** Render the shipped roster and hand back the toggles. */
  const openPage = async (remote: FakeRemote): Promise<HTMLInputElement[]> => {
    const { component, t } = await mount(remote)
    await act(async () => { root.render(React.createElement(component, { t })) })
    return [...container.querySelectorAll<HTMLInputElement>('.aall-card .aall-switch-input')]
  }

  const click = async (control: HTMLElement): Promise<void> => {
    await act(async () => { control.click() })
  }

  const settle = async (): Promise<void> => {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
  }

  /** Drain microtasks until `done` holds, so a spec never asserts mid-write. */
  const waitFor = async (done: () => boolean): Promise<void> => {
    for (let tick = 0; tick < 20 && !done(); tick += 1) await settle()
  }

  const disabledCount = (): number =>
    [...container.querySelectorAll<HTMLInputElement>('.aall-switch-input')].filter((input) => input.disabled).length

  it('disables only the card being written, never the whole page', async () => {
    const remote = createRemote(roster())
    const toggles = await openPage(remote)
    remote.hold()
    await click(toggles[1]!)

    expect(disabledCount(), 'one write must not lock every other control on the page').toBe(1)

    remote.release()
    await settle()
    expect(disabledCount()).toBe(0)
  })

  it('applies every toggle when three experts are enabled in a row', async () => {
    const remote = createRemote(roster())
    const toggles = await openPage(remote)
    remote.hold()

    await click(toggles[1]!)
    await click(toggles[2]!)
    await click(toggles[3]!)

    remote.release()
    await settle()

    expect(remote.enabled.length, 'a second and third click must not be dropped').toBe(3)
  })

  it('recovers when the Host restarts its settings revision at 0', async () => {
    const remote = createRemote(roster())
    const toggles = await openPage(remote)
    // The Host half reloaded on its own — cordis HMR, `dsh plugin add/remove`,
    // an edited cordis.patch.yml — and re-registered the namespace at revision
    // 0 while this page kept its cache.
    remote.revision = 0
    remote.catalog = { ...remote.catalog, revision: 0 }

    await click(toggles[1]!)
    await waitFor(() => heldRevision(remote) === 0)

    expect(heldRevision(remote), 'the conflict refresh must land: the Host revision is not a clock').toBe(0)
    await click(toggles[2]!)
    await waitFor(() => remote.enabled.length === 1)
    expect(remote.enabled.length, 'a write after the reset must land instead of failing forever').toBe(1)
  })

  it('queues a prompt copy asked for while another card is copying', async () => {
    const experts = await shippedRoster()
    const remote = createRemote(experts)
    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => { written.push(text) } },
    })
    const toggles = await openPage(remote)
    expect(toggles.length).toBe(279)

    const copyAt = (index: number): HTMLButtonElement => {
      const card = container.querySelectorAll('.aall-card')[index]
      const action = [...(card?.querySelectorAll('.aall-link') ?? [])].find((node) => node.textContent === '复制提示词')
      if (action === undefined) throw new Error(`no copy action on card ${index}`)
      return action as HTMLButtonElement
    }

    remote.holdPrompts()
    await click(copyAt(1))
    await click(copyAt(2))
    expect(written.length, 'both copies are still waiting on the Host').toBe(0)
    expect(copyAt(1).disabled, 'the card being copied reports its own busy state').toBe(true)

    remote.releasePrompts()
    await waitFor(() => written.length === 2)

    expect(written.length, 'the second click must not be dropped').toBe(2)
    expect(written[0], 'copies run in click order').toContain(experts[1]!.slug)
    expect(written[1]).toContain(experts[2]!.slug)
  })

  it('keeps an older write answer from clobbering a newer one', () => {
    const face = createRemote(roster()) as unknown as AgencyRosterRemote
    acceptCatalog(face, { experts: [], enabled: [], revision: 4, promptLocale: 'en' })

    // Only answers that landed are ordered against each other, and the client's
    // own sequence decides — never the Host revision, which the first answer
    // here carries a *higher* value of.
    acceptEnabled(face, { enabled: ['second'], revision: 5 }, 2)
    acceptEnabled(face, { enabled: ['first'], revision: 6 }, 1)

    expect(catalogState(face).enabled.has('second'), 'the newer write wins').toBe(true)
    expect(catalogState(face).enabled.has('first'), 'the superseded answer is dropped').toBe(false)
  })

  it('leaves every card exactly where it was', async () => {
    const remote = createRemote(roster())
    const toggles = await openPage(remote)
    const orderBefore = [...container.querySelectorAll('.aall-name > span:first-child')].map((node) => node.textContent)

    await click(toggles[1]!)
    await waitFor(() => remote.enabled.length === 1)
    await settle()
    expect(remote.enabled.length, 'the write must have landed before the order is judged').toBe(1)

    const orderAfter = [...container.querySelectorAll('.aall-name > span:first-child')].map((node) => node.textContent)
    expect(orderAfter, 'enabling must not move rows out from under the pointer').toEqual(orderBefore)
    expect(container.querySelectorAll('.aall-card').length).toBe(279)
  })

  it('contains a render failure instead of letting the panel go blank', async () => {
    // React re-dispatches a caught error as a DOM error event so DevTools can
    // see it; jsdom would report that as an uncaught exception. Claim it here.
    const claim = (event: Event): void => { event.preventDefault() }
    window.addEventListener('error', claim)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = roster()
    broken[0] = { ...broken[0]!, intro: undefined as unknown as string }
    const remote = createRemote(broken)

    const { component, t } = await mount(remote)
    await act(async () => { root.render(React.createElement(component, { t })) })
    logged.mockRestore()
    window.removeEventListener('error', claim)

    const alert = container.querySelector('.aall-error')
    expect(alert, 'a thrown render must surface as a message, not an empty panel').not.toBeNull()
    expect(alert?.textContent).toContain('TypeError')
  })
})
