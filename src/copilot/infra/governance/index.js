// @ts-check
/** @module copilot/infra/governance */

export {
    INFRA_ARCHITECTURE_MANIFEST,
    INFRA_LEGACY_ROOT_PATHS,
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
