// @ts-check
/**
 * Barrel do subdomínio `tools/introspection`.
 *
 * Boundary físico estável do subdomínio; consumidores externos usam a surface canônica de `tools/`.
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

export {
    createEmptyToolContractReport,
    verifyToolOperationResultFieldsForCategory,
    verifyToolRegistryContracts,
} from './tool-contract-verifier.js';
export { buildToolDefinitionMetadata, isHighImpactToolRisk, permissionModeSkipsPrompts } from './tool-metadata.js';
