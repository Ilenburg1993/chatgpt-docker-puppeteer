// @ts-check
/** @module copilot/infra/governance */

export {
    INFRA_ARCHITECTURE_MANIFEST,
    INFRA_PRIMARY_CAPABILITY_PATHS,
    INFRA_PUBLIC_ENTRY_PATHS,
} from './architecture-manifest.js';
export {
    INFRA_MODULE_LAYOUT,
    buildInfraModuleScorecard,
    getInfraModuleDescriptor,
    listInfraModulesByRisk,
    listInfraModulesByRole,
} from './module-map.js';
export {
    buildInfraMutableStateReport,
    findInfraMutableModuleState,
    listMutableModuleBindings,
} from './mutable-state.js';
export {
    buildInfraPublicApiCostReport,
    buildStaticImportClosure,
    listStaticModuleSpecifiers,
} from './public-api-cost.js';
export {
    INFRA_PUBLIC_API_COST_TIER_LIMITS,
    INFRA_PUBLIC_API_MANIFEST,
    getInfraPublicApiDescriptor,
    listInfraPublicApisByAudience,
} from './public-api-manifest.js';
export { INFRA_STATE_SCOPE_MANIFEST } from './state-scope-manifest.js';
