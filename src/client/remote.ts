/**
 * Browser-side Remote face.
 *
 * The descriptor table is the same one the Host registers, so the two sides
 * cannot drift; this module only adds the mountable contribution and the typed
 * method signatures the React code consumes.
 */
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {
  CatalogSnapshot,
  CustomExpertInput,
  EnabledState,
  ExpertPrompt,
  PromptLocaleState,
} from '../expert-contract.js'
import { AGENCY_AGENTS_DESCRIPTORS, TYPERT_PACKAGE } from '../remote-contract.js'

/** Roster surface this plugin mounts. */
export interface AgencyRosterRemote {
  getCatalog(): Promise<RemoteResult<CatalogSnapshot>>
  getEnabled(): Promise<RemoteResult<EnabledState>>
  setEnabled(enabled: string[], expectedRevision: number): Promise<RemoteResult<EnabledState>>
  getPromptLocale(): Promise<RemoteResult<PromptLocaleState>>
  getPrompt(slug: string, division: string): Promise<RemoteResult<ExpertPrompt>>
  getCustomExpert(slug: string): Promise<RemoteResult<CustomExpertInput>>
  saveCustomExpert(expert: CustomExpertInput, enabled: boolean, expectedRevision: number): Promise<RemoteResult<CatalogSnapshot>>
  deleteCustomExpert(slug: string, expectedRevision: number): Promise<RemoteResult<CatalogSnapshot>>
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  /** Direct namespace surface for `ctx.remote.agencyAgents`. */
  interface TypertRemoteNamespaceMap {
    'agencyAgents': AgencyRosterRemote
  }
  /** Flat endpoint map, one entry per descriptor above. */
  interface TypertRemoteMap {
    'agencyAgents/getCatalog': AgencyRosterRemote['getCatalog']
    'agencyAgents/getEnabled': AgencyRosterRemote['getEnabled']
    'agencyAgents/setEnabled': AgencyRosterRemote['setEnabled']
    'agencyAgents/getPromptLocale': AgencyRosterRemote['getPromptLocale']
    'agencyAgents/getPrompt': AgencyRosterRemote['getPrompt']
    'agencyAgents/getCustomExpert': AgencyRosterRemote['getCustomExpert']
    'agencyAgents/saveCustomExpert': AgencyRosterRemote['saveCustomExpert']
    'agencyAgents/deleteCustomExpert': AgencyRosterRemote['deleteCustomExpert']
  }
}

/** Contribution mounted by `ctx.remote.$mount` in the plugin's own fiber. */
export const TYPERT_REMOTE: TypertRemoteContribution = {
  package: TYPERT_PACKAGE,
  descriptors: AGENCY_AGENTS_DESCRIPTORS,
}

export default TYPERT_REMOTE
