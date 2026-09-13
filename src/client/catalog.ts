/**
 * Client-side roster cache.
 *
 * One cache per Remote face keeps every mounted surface (the settings page and
 * the composer trigger) on the same snapshot. Async results are published under
 * a generation guard, so a slow read that started before a write can never
 * overwrite the write's answer.
 */
import type { CatalogSnapshot } from '../expert-contract.js'
import type { AgencyRosterRemote } from './remote.js'

/** The roster as the browser renders it. */
export interface CatalogState {
  readonly snapshot: CatalogSnapshot | undefined
  readonly enabled: ReadonlySet<string>
  readonly revision: number
  readonly promptLocale: CatalogSnapshot['promptLocale']
}

interface CatalogCache {
  value: CatalogState
  listeners: Set<() => void>
  pending: Promise<CatalogState> | undefined
  generation: number
}

const EMPTY: CatalogState = { snapshot: undefined, enabled: new Set(), revision: -1, promptLocale: 'en' }

const caches = new WeakMap<AgencyRosterRemote, CatalogCache>()

function cache(remote: AgencyRosterRemote): CatalogCache {
  let entry = caches.get(remote)
  if (entry === undefined) {
    entry = { value: EMPTY, listeners: new Set(), pending: undefined, generation: 0 }
    caches.set(remote, entry)
  }
  return entry
}

/** Current snapshot; a stable reference between changes, so it is uSES-safe. */
export function catalogState(remote: AgencyRosterRemote): CatalogState {
  return cache(remote).value
}

/**
 * Observe snapshot replacements.
 * @param remote - mounted Remote face.
 * @param listener - change callback.
 * @returns the unsubscribe function.
 */
export function subscribeCatalog(remote: AgencyRosterRemote, listener: () => void): () => void {
  const entry = cache(remote)
  entry.listeners.add(listener)
  return () => { entry.listeners.delete(listener) }
}

/** Publish one accepted snapshot. A write answer must never be downgraded. */
function publish(remote: AgencyRosterRemote, snapshot: CatalogSnapshot): CatalogState {
  const entry = cache(remote)
  if (snapshot.revision < entry.value.revision) return entry.value
  entry.generation += 1
  entry.pending = undefined
  const enabled = new Set(snapshot.enabled)
  entry.value = { snapshot, enabled, revision: snapshot.revision, promptLocale: snapshot.promptLocale }
  for (const listener of entry.listeners) listener()
  return entry.value
}

/** Accept a write answer, which already carries the new snapshot. */
export function acceptCatalog(remote: AgencyRosterRemote, snapshot: CatalogSnapshot): CatalogState {
  return publish(remote, snapshot)
}

/** Accept an enabled-only answer by folding it into the held snapshot. */
export function acceptEnabled(remote: AgencyRosterRemote, value: { enabled: string[]; revision: number }): CatalogState {
  const entry = cache(remote)
  const held = entry.value.snapshot
  if (held === undefined) return entry.value
  return publish(remote, { ...held, enabled: value.enabled, revision: value.revision })
}

/**
 * Read the roster, coalescing concurrent readers onto one request.
 * @param remote - mounted Remote face.
 * @returns the accepted snapshot.
 */
export function refreshCatalog(remote: AgencyRosterRemote): Promise<CatalogState> {
  const entry = cache(remote)
  if (entry.pending !== undefined) return entry.pending
  const generation = entry.generation
  const pending: Promise<CatalogState> = remote.getCatalog().then((result) => {
    // A write that landed while this read was in flight wins; the read is
    // stale by definition and must not resurrect the older revision.
    if (generation !== entry.generation) return entry.value
    if (!result.ok) throw new Error(result.error.message)
    return publish(remote, result.value)
  }).finally(() => { if (entry.pending === pending) entry.pending = undefined })
  entry.pending = pending
  return pending
}

/**
 * Write the enabled slug list under the held revision.
 * @param remote - mounted Remote face.
 * @param enabled - the complete next enabled set.
 * @param expectedRevision - revision the caller read.
 * @returns the accepted snapshot.
 */
export async function writeEnabled(remote: AgencyRosterRemote, enabled: ReadonlySet<string>, expectedRevision: number): Promise<CatalogState> {
  const result = await remote.setEnabled([...enabled], expectedRevision)
  if (!result.ok) throw new Error(result.error.message)
  return acceptEnabled(remote, result.value)
}
