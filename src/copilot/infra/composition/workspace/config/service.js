// @ts-check
/**
 * Immutable workspace-scoped Infra configuration projected from one explicit environment snapshot.
 *
 * @module copilot/infra/composition/workspace/config/service
 */

import { readIoExternalWatchConfig } from '../../../filesystem/invalidation/external-watch/index.js';
import { readEnvPositiveInt } from '../../../platform/index.js';

/** @param {NodeJS.ProcessEnv | Record<string,string|undefined>} env */
export function readWorkspaceInfraConfig(env) {
    return Object.freeze({
        externalWatch: readIoExternalWatchConfig(/** @type {NodeJS.ProcessEnv} */ (env)),
        indexingContext: Object.freeze({
            maxActiveScopes: readEnvPositiveInt('IO_MAX_ACTIVE_SCOPES', 10, /** @type {NodeJS.ProcessEnv} */ (env)),
        }),
    });
}
