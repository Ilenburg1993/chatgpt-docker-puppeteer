// @ts-check
/** @module copilot/infra/filesystem/workspace/path-policy */

export {
    activateWorkspacePathPolicyCacheConfig,
    getWorkspacePathPolicyCacheStats,
    invalidateWorkspacePathPolicyCache,
    readWorkspacePathPolicyCacheConfig,
} from './cache.js';
export { evaluateWorkspacePathPolicyAsync } from './service.js';
