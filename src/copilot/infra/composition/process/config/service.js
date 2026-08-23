// @ts-check
/**
 * Immutable process-scoped Infra configuration. No operational child may consult process.env for these policies.
 *
 * @module copilot/infra/composition/process/config/service
 */

import { readWorkspacePathPolicyCacheConfig } from '#copilot/infra/internal/filesystem/workspace';
import { readIoSearchBudgetConfig } from '#copilot/infra/internal/policy';
import { readProcessLockConfig } from '../../../concurrency/locks/process/index.js';
import { readParserProcessConfig } from '../../../indexing/parser/foundation/index.js';
import { readSearchSubprocessProcessConfig } from '../../../indexing/search/subprocess/process/index.js';
import { readCopilotNodeCompileCacheConfig } from '../../../platform/node/index.js';
import { readInfraConfig } from '../../runtime/index.js';
import { readProcessRuntimePolicyConfig } from './policy.js';

/** @param {NodeJS.ProcessEnv | Record<string,string|undefined>} env */
export function readProcessInfraConfig(env) {
    const runtimePolicy = readProcessRuntimePolicyConfig(env);
    return Object.freeze({
        eventBus: runtimePolicy.eventBus,
        parser: readParserProcessConfig(env),
        locks: readProcessLockConfig(env),
        compileCache: readCopilotNodeCompileCacheConfig(/** @type {NodeJS.ProcessEnv} */ (env)),
        pathPolicyCache: readWorkspacePathPolicyCacheConfig(/** @type {NodeJS.ProcessEnv} */ (env)),
        search: Object.freeze({
            budget: readIoSearchBudgetConfig(env),
            subprocess: readSearchSubprocessProcessConfig(env),
        }),
        runtimeDefaults: readInfraConfig(env),
    });
}
