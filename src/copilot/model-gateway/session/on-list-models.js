// @ts-check
/**
 * Gateway-backed `CopilotClientOptions.onListModels` projection.
 *
 * The SDK layer must not import the model gateway. Runtime composition may inject this handler as a client option,
 * preserving the architectural boundary while letting the SDK advertise gateway records.
 *
 * @module copilot/model-gateway/session/on-list-models
 */

import { buildEnvByokModelGatewaySnapshot } from '../registry/snapshot.js';
import { toCopilotModelInfoList } from './copilot-model-projection.js';

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {(() => Promise<import('#copilot/sdk/types').ModelInfo[]>) | undefined}
 */
export function buildModelGatewayOnListModelsHandler(env = process.env) {
    const initialSnapshot = buildEnvByokModelGatewaySnapshot(env);
    const initialActive = /** @type {{ enabled?: boolean }} */ (initialSnapshot.active);
    if (initialActive.enabled !== true) return undefined;
    return async () => {
        const snapshot = buildEnvByokModelGatewaySnapshot(env);
        return toCopilotModelInfoList(snapshot.models);
    };
}
