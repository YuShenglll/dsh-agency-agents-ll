/**
 * Roster projection and settings-contract coverage.
 *
 * These tests pin the two halves that meet in the settings document: what a
 * colliding name does to a summary, and what a write is allowed to store. The
 * store here is a stand-in for the Host namespace, so the tests describe the
 * contract the browser and the tools rely on rather than the Cordis wiring.
 */
import { describe, expect, it } from 'vitest'
import type { Expert } from './catalog.js'
import { validateRosterSettings, type CustomExpert } from './expert-contract.js'
import { createRosterLibrary, type RosterLibrary, type RosterSettingsStore } from './roster-settings.js'

/** One shipped entry; only the fields the projection reads matter here. */
function shipped(slug: string, nameZh: string, nameEn: string): Expert {
  return {
    slug,
    division: 'engineering',
    emoji: '🧪',
    nameZh,
    nameEn,
    descriptionZh: '一句话简介',
    descriptionEn: 'One-line description',
    introZh: '中文简介',
    translated: true,
  }
}

/** A settings store with the revision behaviour of the Host namespace. */
interface FakeStore extends RosterSettingsStore {
  /** The document as stored. */
  state: { enabled: string[]; customExperts: unknown[] }
  /** Current revision, advanced by every accepted write. */
  current: number
  /** How often the revision was read; the Host clones every namespace to answer. */
  revisionReads: number
}

/**
 * Build one in-memory settings store.
 * @param initial - the document the store starts from.
 * @returns the store, exposing its document and counters for assertions.
 */
function fakeStore(initial?: { enabled?: readonly string[]; customExperts?: readonly unknown[] }): FakeStore {
  const fake: FakeStore = {
    state: { enabled: [...(initial?.enabled ?? [])], customExperts: [...(initial?.customExperts ?? [])] },
    current: 0,
    revisionReads: 0,
    read() {
      return fake.state
    },
    revision() {
      fake.revisionReads += 1
      return fake.current
    },
    async mutate(ops, expectedRevision) {
      if (expectedRevision !== fake.current) throw new Error('the section changed since it was read')
      const state = { ...fake.state }
      for (const op of ops) {
        if (op.path[0] === 'enabled') state.enabled = op.value as string[]
        if (op.path[0] === 'customExperts') state.customExperts = op.value as unknown[]
      }
      fake.state = state
      fake.current += 1
    },
  }
  return fake
}

/**
 * Build the library under test over a fixed roster.
 * @param roster - entries the projection starts from.
 * @param store - settings store to read and write.
 * @returns the roster library.
 */
function mount(roster: readonly Expert[], store: FakeStore): RosterLibrary {
  return createRosterLibrary(async () => roster, store, () => 'en', () => 'zh')
}

/**
 * The settings-page toggle, as the browser performs it: take the projected
 * list, flip one slug, and write the whole set back under the revision the
 * snapshot carried (the shape of `toggle` in `src/client/index.ts`).
 * @param library - library under test.
 * @param slug - the card the user clicked.
 */
async function toggle(library: RosterLibrary, slug: string): Promise<void> {
  const catalog = await library.catalog()
  const next = new Set(catalog.enabled)
  if (next.has(slug)) next.delete(slug)
  else next.add(slug)
  await library.setEnabled([...next], catalog.revision)
}

// The shipped defect: two experts share one Chinese name. Their slugs differ,
// and the slug is the only key the settings document needs.
const drupal = shipped('engineering-drupal-shopping-cart', '电商购物车工程师', 'Drupal Shopping Cart Engineer')
const wordpress = shipped('engineering-wordpress-shopping-cart', '电商购物车工程师', 'WordPress Shopping Cart Engineer')
const solo = shipped('engineering-frontend-developer', '前端开发工程师', 'Frontend Developer')

/** The slug a custom expert is stored under; the shape is fixed by contract. */
const GOOD_SLUG = 'custom-11111111-1111-4111-8111-111111111111'

/** One stored custom expert that satisfies the schema. */
const GOOD: CustomExpert = {
  slug: GOOD_SLUG,
  name: '自定义评审员',
  description: '负责代码评审。',
  division: 'engineering',
  emoji: '🧪',
  intro: '代码评审专家，负责在合并前找出实现与契约的偏差。',
  prompt: '你是代码评审员。',
}

/** A hand-edited entry: the name no longer satisfies the schema. */
const MALFORMED = { ...GOOD, slug: 'custom-22222222-2222-4222-9222-222222222222', name: '' }

/** An entry a future version wrote: one key this version does not know. */
const FUTURE = { ...GOOD, slug: 'custom-33333333-3333-4333-8333-333333333333', name: '未来版本专家', version: 2 }

/** A new custom expert as the editor submits it, before the Host mints a slug. */
const INPUT = {
  name: '自定义测试员',
  description: '负责测试。',
  division: 'engineering',
  emoji: '🧪',
  intro: '测试专家，负责把实现与契约逐条对账。',
  prompt: '你是测试员。',
}

describe('collision projection', () => {
  it('marks both cards of a shared Chinese name and leaves the rest alone', async () => {
    const catalog = await mount([drupal, wordpress, solo], fakeStore()).catalog()
    const conflict = (slug: string): boolean | undefined =>
      catalog.experts.find((expert) => expert.slug === slug)?.conflict
    expect(conflict(drupal.slug)).toBe(true)
    expect(conflict(wordpress.slug)).toBe(true)
    expect(conflict(solo.slug)).toBe(false)
  })

  it('compares each name of one entry against both names of the other', async () => {
    // Cross-field match: one entry's Chinese name is the other's English name.
    const left = shipped('engineering-left', 'Shared Name', '甲')
    const right = shipped('engineering-right', '乙', '  shared name  ')
    const catalog = await mount([left, right], fakeStore()).catalog()
    expect(catalog.experts.map((expert) => expert.conflict)).toEqual([true, true])
  })

  it('folds width and case before comparing names', async () => {
    const wide = shipped('engineering-wide', 'ＡＢＣ', 'Alpha')
    const plain = shipped('engineering-plain', 'abc', 'Beta')
    const catalog = await mount([wide, plain], fakeStore()).catalog()
    expect(catalog.experts.map((expert) => expert.conflict)).toEqual([true, true])
  })

  it('treats a shared slug as a collision even when the names differ', async () => {
    // The shipped roster is keyed by slug, so this cannot happen there; the
    // projection still has to answer for a store that hands it one.
    const catalog = await mount([shipped('same', '甲', 'First'), shipped('same', '乙', 'Second')], fakeStore()).catalog()
    expect(catalog.experts.map((expert) => expert.conflict)).toEqual([true, true])
  })
})

describe('enabled marks', () => {
  it('keeps a stored mark when its expert becomes ambiguous', async () => {
    const store = fakeStore({ enabled: [drupal.slug] })
    const library = mount([drupal, wordpress, solo], store)
    const catalog = await library.catalog()
    // The card still reports the collision: the browser needs it to explain the
    // disabled switch.
    expect(catalog.experts.find((expert) => expert.slug === drupal.slug)?.conflict).toBe(true)
    // The mark survives the projection it cannot be resolved from.
    expect(catalog.enabled).toEqual([drupal.slug])

    // An unrelated card is flipped, so the page writes the whole list back.
    await toggle(library, solo.slug)
    expect(store.state.enabled).toEqual([drupal.slug, solo.slug])
  })

  it('refuses a slug the roster has never defined', async () => {
    const store = fakeStore()
    const library = mount([drupal, wordpress, solo], store)
    await expect(library.setEnabled(['nope'], 0)).rejects.toThrow(/不存在/)
    await expect(library.setEnabled(['custom-99999999-9999-4999-8999-999999999999'], 0)).rejects.toThrow(/不存在/)
    expect(store.state.enabled).toEqual([])
  })

  it('keeps a mark whose expert left the roster, and still lets it be removed', async () => {
    const store = fakeStore({ enabled: ['engineering-retired'] })
    const library = mount([drupal, wordpress, solo], store)
    await toggle(library, solo.slug)
    expect(store.state.enabled).toEqual(['engineering-retired', solo.slug])
    await toggle(library, 'engineering-retired')
    expect(store.state.enabled).toEqual([solo.slug])
  })

  it('fences every write on the revision the caller read', async () => {
    const store = fakeStore()
    const library = mount([solo], store)
    await library.setEnabled([solo.slug], 0)
    await expect(library.setEnabled([], 0)).rejects.toThrow(/其他窗口/)
    expect(store.state.enabled).toEqual([solo.slug])
  })

  it('reads the settings revision twice per write, once per projection', async () => {
    const store = fakeStore()
    const library = mount([solo], store)
    await library.catalog()
    expect(store.revisionReads).toBe(1)
    store.revisionReads = 0
    await library.setEnabled([solo.slug], 0)
    // The fence, then the revision the write answer carries; the projection's
    // own read is not repeated, because the Host clones every namespace for it.
    expect(store.revisionReads).toBe(2)
  })
})

describe('custom expert writes', () => {
  it('carries an unreadable entry through a write instead of deleting it', async () => {
    const store = fakeStore({ customExperts: [GOOD, MALFORMED] })
    const library = mount([solo], store)
    const answer = await library.saveCustom(INPUT, true, 0)
    // Stored state this version cannot read is not the write's to delete...
    expect(store.state.customExperts).toContainEqual(MALFORMED)
    // ...and the roster serves what it can read, plus the new expert.
    const slugs = answer.experts.filter((expert) => expert.custom).map((expert) => expert.slug)
    expect(slugs).toHaveLength(2)
    expect(slugs[0]).toBe(GOOD_SLUG)
    expect(store.state.enabled).toEqual([slugs[1]])
  })

  it('deletes one expert without deleting the rest of the list', async () => {
    const store = fakeStore({ customExperts: [GOOD, MALFORMED], enabled: [GOOD_SLUG] })
    const library = mount([solo], store)
    await library.deleteCustom(GOOD_SLUG, 0)
    expect(store.state.customExperts).toEqual([MALFORMED])
    expect(store.state.enabled).toEqual([])
  })

  it('refuses a division the roster does not serve', async () => {
    const store = fakeStore()
    const library = mount([solo], store)
    // Its own message, not the generic one: this is the failure that would
    // otherwise store an expert no read path could serve.
    await expect(library.saveCustom({ ...INPUT, division: 'bogus' }, false, 0)).rejects.toThrow(/请选择有效的分区/)
    expect(store.state.customExperts).toEqual([])
  })
})

describe('custom expert documents', () => {
  it('records a malformed entry and a future-version entry instead of failing', () => {
    const problems = validateRosterSettings({ enabled: [], customExperts: [GOOD, MALFORMED, FUTURE] }, 'zh')
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain('customExperts[1]')
    expect(problems[1]).toContain('customExperts[2]')
  })

  it('registers the namespace and serves the rest of the roster', async () => {
    const stored = [GOOD, MALFORMED, FUTURE]
    // Registration runs this hook on the resolved section. Throwing here fails
    // the whole namespace, and every read afterwards reports it as unavailable.
    expect(() => validateRosterSettings({ enabled: [], customExperts: stored }, 'zh')).not.toThrow()

    const library = mount([solo], fakeStore({ customExperts: stored }))
    const catalog = await library.catalog()
    // The unreadable entries are gone; the readable one and the shipped roster
    // are intact.
    expect(catalog.experts.filter((expert) => expert.custom).map((expert) => expert.slug)).toEqual([GOOD_SLUG])
    expect(catalog.experts.some((expert) => expert.slug === solo.slug)).toBe(true)
    expect(library.getCustom(GOOD_SLUG)?.name).toBe(GOOD.name)
    expect(library.getCustom(MALFORMED.slug)).toBeUndefined()
  })

  it('degrades a document whose customExperts is not a list instead of failing', async () => {
    // Registration runs this hook on the resolved section, so a throw here fails
    // the whole namespace: every read afterwards reports the roster as
    // unavailable and the panel says only "try again later" — for good. No typo in
    // a hand-edited document is worth that, so the container degrades the same way
    // an unreadable entry does, and the problem is recorded instead.
    expect(validateRosterSettings({ enabled: [], customExperts: 'oops' }, 'zh')).toHaveLength(1)

    const store = fakeStore()
    ;(store.state as { customExperts: unknown }).customExperts = 'oops'
    const library = mount([solo], store)
    const catalog = await library.catalog()
    expect(catalog.experts.filter((expert) => expert.custom)).toEqual([])
    expect(catalog.experts.some((expert) => expert.slug === solo.slug)).toBe(true)
  })

  it('drops a stored entry whose division the roster does not serve', async () => {
    const stray = { ...GOOD, slug: 'custom-55555555-5555-4555-8555-555555555555', name: '错分区专家', division: 'bogus' }
    // Readable and writable agree: an entry under a division the wire refuses is
    // not served, and the document reports it instead of bricking the namespace.
    expect(validateRosterSettings({ customExperts: [GOOD, stray] }, 'zh')).toHaveLength(1)
    const library = mount([solo], fakeStore({ customExperts: [GOOD, stray] }))
    const catalog = await library.catalog()
    expect(catalog.experts.filter((expert) => expert.custom).map((expert) => expert.slug)).toEqual([GOOD_SLUG])
  })

  it('records a duplicate and an over-limit list without refusing them', () => {
    const duplicate = { ...GOOD, slug: 'custom-44444444-4444-4444-8444-444444444444' }
    expect(validateRosterSettings({ customExperts: [GOOD, duplicate] }, 'zh')).toHaveLength(1)

    const many = Array.from({ length: 201 }, (_, index) => ({
      ...GOOD,
      slug: `custom-00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      name: `专家 ${index}`,
    }))
    const problems = validateRosterSettings({ customExperts: many }, 'zh')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('200')
  })
})
