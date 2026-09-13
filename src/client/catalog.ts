/**
 * Client-side roster cache.
 *
 * One cache per Remote face keeps every mounted surface (the settings page and
 * the composer trigger) on the same snapshot. Async results are published under
 * a generation guard, so a slow read that started before a write can never
 * overwrite the write's answer.
 *
 * Ordering is decided here, never by the Host revision: the Host restarts a
 * namespace it registers again at 0 (cordis HMR, `dsh plugin add/remove`, a
 * `cordis.patch.yml` edit), so a held snapshot may legitimately carry a higher
 * revision than the one that follows it.
 */
import type { CatalogSnapshot } from '../expert-contract.js'
import type { AgencyRosterRemote } from './remote.js'

/** The roster as the browser renders it. */
export interface CatalogState {
  readonly snapshot: CatalogSnapshot | undefined
  readonly enabled: ReadonlySet<string>
  /**
   * Settings revision the snapshot was read at. This is the fence token a write
   * carries as `expectedRevision`; it orders nothing, because the Host resets a
   * namespace it re-registers back to 0.
   */
  readonly revision: number
  readonly promptLocale: CatalogSnapshot['promptLocale']
}

interface CatalogCache {
  value: CatalogState
  listeners: Set<() => void>
  pending: Promise<CatalogState> | undefined
  generation: number
  /** Id handed to each write, so an older answer cannot clobber a newer one. */
  writeSequence: number
  /** Id of the newest write whose answer has been applied. */
  appliedWrite: number
}

const EMPTY: CatalogState = { snapshot: undefined, enabled: new Set(), revision: -1, promptLocale: 'en' }

const caches = new WeakMap<AgencyRosterRemote, CatalogCache>()

function cache(remote: AgencyRosterRemote): CatalogCache {
  let entry = caches.get(remote)
  if (entry === undefined) {
    entry = { value: EMPTY, listeners: new Set(), pending: undefined, generation: 0, writeSequence: 0, appliedWrite: 0 }
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

/**
 * Publish one accepted snapshot and wake the listeners.
 *
 * The Host revision is deliberately not consulted. Gating on it dropped exactly
 * the two answers that mattered: the write the user had just made, and the
 * refresh that recovers the page after the Host re-registered its namespace at
 * revision 0. Ordering belongs to the callers — a read compares the generation
 * it started in, a write compares its own client-side sequence number.
 * @param remote - mounted Remote face.
 * @param snapshot - the snapshot to publish.
 * @returns the published state.
 */
function publish(remote: AgencyRosterRemote, snapshot: CatalogSnapshot): CatalogState {
  const entry = cache(remote)
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

/**
 * Accept an enabled-only answer by folding it into the held snapshot.
 * @param remote - mounted Remote face.
 * @param value - the answer: the new enabled list and the revision it landed at.
 * @param sequence - the write id from {@link writeEnabled}. Required: only a
 *   write that carries its own id can be ordered against the others.
 * @returns the accepted state; unchanged when nothing may be folded in.
 */
export function acceptEnabled(
  remote: AgencyRosterRemote,
  value: { enabled: string[]; revision: number },
  sequence: number,
): CatalogState {
  const entry = cache(remote)
  const held = entry.value.snapshot
  if (held === undefined) return entry.value
  // A newer write has already landed, so this answer describes an older state.
  // Only the client's own counter may say so; the Host revision cannot.
  if (sequence < entry.appliedWrite) return entry.value
  entry.appliedWrite = sequence
  return publish(remote, { ...held, enabled: value.enabled, revision: value.revision })
}

/**
 * Observable pair for one Remote face, cached by face identity.
 *
 * `useSyncExternalStore` resubscribes whenever the `subscribe` reference moves,
 * so a component that builds these inline churns one unsubscribe/resubscribe
 * pair per render — and every extra listener lengthens the notification loop of
 * every later write. The pair is therefore minted once per face.
 */
export interface CatalogSubscription {
  /** Observe snapshot replacements. */
  readonly subscribe: (listener: () => void) => () => void
  /** Current snapshot; the same reference until the roster moves. */
  readonly getSnapshot: () => CatalogState
}

const subscriptions = new WeakMap<AgencyRosterRemote, CatalogSubscription>()

/**
 * Stable observable pair for one Remote face.
 * @param remote - mounted Remote face.
 * @returns the cached pair.
 */
export function catalogSubscription(remote: AgencyRosterRemote): CatalogSubscription {
  let entry = subscriptions.get(remote)
  if (entry === undefined) {
    entry = {
      subscribe: (listener) => subscribeCatalog(remote, listener),
      getSnapshot: () => catalogState(remote),
    }
    subscriptions.set(remote, entry)
  }
  return entry
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
    // A write that landed while this read was in flight wins: this answer
    // describes the state from before it, so it must not be published.
    if (generation !== entry.generation) return entry.value
    if (!result.ok) throw new Error(result.error.message)
    return publish(remote, result.value)
  }).finally(() => { if (entry.pending === pending) entry.pending = undefined })
  entry.pending = pending
  return pending
}

/**
 * Write the enabled slug list under the held revision.
 *
 * The answer is tagged with a client-side sequence, so the only write answer
 * that can be dropped is one a later write has already superseded.
 * @param remote - mounted Remote face.
 * @param enabled - the complete next enabled set.
 * @param expectedRevision - revision the caller read.
 * @returns the accepted snapshot.
 */
export async function writeEnabled(remote: AgencyRosterRemote, enabled: ReadonlySet<string>, expectedRevision: number): Promise<CatalogState> {
  const entry = cache(remote)
  entry.writeSequence += 1
  const sequence = entry.writeSequence
  const result = await remote.setEnabled([...enabled], expectedRevision)
  if (!result.ok) throw new Error(result.error.message)
  return acceptEnabled(remote, result.value, sequence)
}
