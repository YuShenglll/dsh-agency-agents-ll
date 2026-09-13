/**
 * Remote method descriptors, hand-written instead of generated.
 *
 * The same table feeds both halves: the Host registers it as its Typert
 * contribution so the gateway can find the endpoints, and the browser mounts it
 * as its client contribution. Keeping one source is what stops the two sides
 * from drifting apart — a second copy would be a second contract.
 */
import type { InvocationDescriptor, TypertCodec } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import {
  CUSTOM_EXPERT_SLUG,
  catalogSnapshotSchema,
  customExpertInputSchema,
  enabledStateSchema,
  expertPromptSchema,
  promptLocaleStateSchema,
} from './expert-contract.js'
import { DIVISIONS } from './names.js'

/** npm package that owns these endpoints. */
export const TYPERT_PACKAGE = 'dsh-agency-agents-ll'

/** Wire namespace; matches the Cordis service key the Host service registers. */
export const TYPERT_NAMESPACE = 'agencyAgents'

/**
 * Build one strict codec.
 * @param typeSymbol - canonical type name carried for diagnostics.
 * @param schema - boundary validator.
 * @returns the codec descriptor.
 */
function strict(typeSymbol: string, schema: z.ZodType): TypertCodec {
  return { mode: 'strict', typeSymbol, schema }
}

/**
 * Build one JSON parameter descriptor.
 * @param name - source-level parameter name, which is also the wire key.
 * @param typeSymbol - canonical type name carried for diagnostics.
 * @param schema - boundary validator.
 * @returns the parameter descriptor.
 */
function json(name: string, typeSymbol: string, schema: z.ZodType): InvocationDescriptor['parameters'][number] {
  return { name, wire: name, source: 'json', codec: strict(typeSymbol, schema) }
}

/** Build one descriptor whose result is a full roster snapshot. */
function catalogMethod(method: string, parameters: readonly InvocationDescriptor['parameters'][number][]): InvocationDescriptor {
  return {
    id: `${TYPERT_PACKAGE}#${TYPERT_NAMESPACE}/${method}`,
    service: TYPERT_NAMESPACE,
    namespace: TYPERT_NAMESPACE,
    method,
    invocation: { kind: 'direct' },
    parameters,
    result: strict('CatalogSnapshot', catalogSnapshotSchema),
  }
}

const revision = json('expectedRevision', 'number', z.number().int().min(0))
const slug = json('slug', 'string', z.string().regex(CUSTOM_EXPERT_SLUG))

/**
 * Slug shape of a roster entry. Every shipped expert is `[a-z0-9][a-z0-9-]*`
 * and a user-authored one is `custom-<uuid>`, so this accepts both — and, being
 * an identifier, it cannot name anything outside the expert's asset directory
 * (`../`, a separator, a drive letter and a dot all fail the shape).
 */
const ROSTER_SLUG = /^[a-z0-9][a-z0-9-]{0,127}$/u

/**
 * Division directories as the wire accepts them, derived from `DIVISIONS` so a
 * new division is admitted by the same list that defines the roster. `getPrompt`
 * joins this value onto an asset path, so a free-form string is not acceptable
 * there even though a length check alone was.
 */
const DIVISION_PATTERN = new RegExp(`^(?:${DIVISIONS.join('|')})$`, 'u')

/** Host and browser share this exact table. */
export const AGENCY_AGENTS_DESCRIPTORS = [
  catalogMethod('getCatalog', []),
  catalogMethod('saveCustomExpert', [
    json('expert', 'CustomExpertInput', customExpertInputSchema),
    json('enabled', 'boolean', z.boolean()),
    revision,
  ]),
  catalogMethod('deleteCustomExpert', [slug, revision]),
  {
    id: `${TYPERT_PACKAGE}#${TYPERT_NAMESPACE}/getCustomExpert`,
    service: TYPERT_NAMESPACE,
    namespace: TYPERT_NAMESPACE,
    method: 'getCustomExpert',
    invocation: { kind: 'direct' },
    parameters: [slug],
    result: strict('CustomExpertInput', customExpertInputSchema),
  },
  {
    id: `${TYPERT_PACKAGE}#${TYPERT_NAMESPACE}/getEnabled`,
    service: TYPERT_NAMESPACE,
    namespace: TYPERT_NAMESPACE,
    method: 'getEnabled',
    invocation: { kind: 'direct' },
    parameters: [],
    result: strict('EnabledState', enabledStateSchema),
  },
  {
    id: `${TYPERT_PACKAGE}#${TYPERT_NAMESPACE}/setEnabled`,
    service: TYPERT_NAMESPACE,
    namespace: TYPERT_NAMESPACE,
    method: 'setEnabled',
    invocation: { kind: 'direct' },
    parameters: [json('enabled', 'string[]', z.array(z.string())), revision],
    result: strict('EnabledState', enabledStateSchema),
  },
  {
    id: `${TYPERT_PACKAGE}#${TYPERT_NAMESPACE}/getPrompt`,
    service: TYPERT_NAMESPACE,
    namespace: TYPERT_NAMESPACE,
    method: 'getPrompt',
    invocation: { kind: 'direct' },
    parameters: [json('slug', 'string', z.string().regex(ROSTER_SLUG)), json('division', 'string', z.string().regex(DIVISION_PATTERN))],
    result: strict('ExpertPrompt', expertPromptSchema),
  },
  {
    id: `${TYPERT_PACKAGE}#${TYPERT_NAMESPACE}/getPromptLocale`,
    service: TYPERT_NAMESPACE,
    namespace: TYPERT_NAMESPACE,
    method: 'getPromptLocale',
    invocation: { kind: 'direct' },
    parameters: [],
    // The preference itself lives in the settings section, which the browser
    // reads and writes through `remote.settings`; this endpoint only reports
    // which preference is *effective*, which is what the roster needs in order
    // to label a prompt honestly.
    result: strict('PromptLocaleState', promptLocaleStateSchema),
  },
] as const satisfies readonly InvocationDescriptor[]
