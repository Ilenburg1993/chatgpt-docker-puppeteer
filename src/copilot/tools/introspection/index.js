// @ts-check
/**
 * Barrel do subdomínio `tools/introspection`.
 *
 * Mantém compatibilidade durante migração física incremental dos arquivos de introspecção.
 *
 * @module copilot/tools/introspection
 */

export {
    getDisabledToolRecords,
    getDisabledTools,
    introspectionTools,
    isToolDisabled,
    readIntrospectionRegistrySnapshot,
    readToolContractReport,
    registerForIntrospection,
    resetIntrospectionStateForTests,
    setAgentInfoProvider,
    setSessionExcludedTools,
    setToolBootstrapHealth,
    setToolContractReport,
} from './introspection-tools.js';

export { createEmptyToolContractReport, verifyToolRegistryContracts } from './tool-contract-verifier.js';
export {
    buildToolDefinitionMetadata,
    isHighImpactToolRisk,
    permissionModeSkipsPrompts,
} from './tool-metadata.js';
