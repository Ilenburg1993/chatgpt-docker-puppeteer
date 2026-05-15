// @ts-check
/**
 * Barrel do subdomínio `tools/introspection`.
 *
 * Mantém compatibilidade durante migração física incremental dos arquivos de introspecção.
 *
 * @module copilot/tools/introspection
 */

export {
    getDisabledTools,
    introspectionTools,
    isToolDisabled,
    readIntrospectionRegistrySnapshot,
    readToolContractReport,
    registerForIntrospection,
    resetIntrospectionStateForTests,
    setAgentInfoProvider,
    setToolContractReport,
} from './introspection-tools.js';

export { createEmptyToolContractReport, verifyToolRegistryContracts } from './tool-contract-verifier.js';
