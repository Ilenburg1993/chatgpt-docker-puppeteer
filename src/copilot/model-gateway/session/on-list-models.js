// @ts-check
/**
 * Gateway-backed `CopilotClientOptions.onListModels` projection.
 *
 * The SDK layer must not import the model gateway. Runtime composition may inject this handler as a client option,
 * preserving the architectural boundary while letting the SDK advertise gateway records.
 *
 * @module copilot/model-gateway/session/on-list-models
 */

import { JsonModelGatewayCatalogStore } from '../catalog/json-catalog-store.js';
import { buildEnvByokModelGatewaySnapshot } from '../registry/snapshot.js';
import { toCopilotRouteModelInfoList } from './copilot-model-projection.js';

/**
 * @param {Record<string, string | undefined>} [env]
 * @param {{
 *     catalogStore?: {
 *         readSnapshot(): Promise<
 *             ReturnType<typeof import('../catalog/json-catalog-store.js').normalizeStoredCatalogSnapshot>
 *         >;
 *     };
 * }} [options]
 * @returns {(() => Promise<ReturnType<typeof toCopilotRouteModelInfoList>>) | undefined}
 */
export function buildModelGatewayOnListModelsHandler(env = process.env, options = {}) {
    const initialSnapshot = buildEnvByokModelGatewaySnapshot(env);
    if (initialSnapshot.active.enabled !== true) return undefined;
    const catalogStore = options.catalogStore ?? new JsonModelGatewayCatalogStore();
    return async () => {
        const compatibilitySnapshot = buildEnvByokModelGatewaySnapshot(env);
        const providerId = compatibilitySnapshot.active.providerId;
        const catalogSnapshot = await catalogStore.readSnapshot();
        const eligibleKeys = new Set(
            catalogSnapshot.modelEligibilityDecisions
                .filter((decision) => decision['include'] === true)
                .map((decision) =>
                    [decision['providerId'], decision['providerModel'], decision['routeProfile'] ?? 'default'].join(
                        ':',
                    ),
                ),
        );
        const projections = catalogSnapshot.projections.filter((projection) => {
            if (providerId && projection['providerId'] !== providerId) return false;
            if (eligibleKeys.size === 0) return true;
            return eligibleKeys.has(
                [projection['providerId'], projection['providerModel'], projection['routeProfile'] ?? 'default'].join(
                    ':',
                ),
            );
        });
        const routeOptions = catalogSnapshot.routeOptions.filter(
            (route) => !providerId || route['providerId'] === providerId,
        );
        if (projections.length > 0) {
            return toCopilotRouteModelInfoList({ projections, routeOptions });
        }
        return toCopilotRouteModelInfoList({ projections: compatibilitySnapshot.models, routeOptions: [] });
    };
}
