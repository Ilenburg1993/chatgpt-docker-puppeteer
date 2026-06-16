// @ts-check
/**
 * Canonical model identity shared by catalog, routing, session binding and observability surfaces.
 *
 * @module copilot/model-gateway/contracts/model-identity
 */

import { buildProviderModelId, normalizeGatewayIdPart, optionalString } from './records.js';

export const MODEL_GATEWAY_MODEL_IDENTITY_SCHEMA_VERSION = 1;

/**
 * @param {string | null} value
 * @returns {string}
 */
function keyPart(value) {
    return encodeURIComponent(value ?? '-');
}

/**
 * @param {{
 *     providerId: string;
 *     providerModel: string;
 *     canonicalModelId?: string | null;
 *     routeProfile?: string | null;
 *     providerProfile?: string | null;
 *     snapshotId?: string | null;
 * }} input
 */
export function createModelGatewayModelIdentity(input) {
    const providerId = normalizeGatewayIdPart(input.providerId);
    const providerModel = optionalString(input.providerModel);
    if (!providerId) throw new Error('[model-gateway/model-identity] providerId is required');
    if (!providerModel) throw new Error('[model-gateway/model-identity] providerModel is required');
    const canonicalModelId = optionalString(input.canonicalModelId) ?? buildProviderModelId(providerId, providerModel);
    const routeProfile = optionalString(input.routeProfile) ?? 'default';
    const providerProfile = optionalString(input.providerProfile);
    const snapshotId = optionalString(input.snapshotId);
    const identityKey = [
        providerId,
        providerModel,
        routeProfile,
        providerProfile,
        snapshotId,
    ]
        .map(keyPart)
        .join('|');
    return Object.freeze({
        schemaVersion: MODEL_GATEWAY_MODEL_IDENTITY_SCHEMA_VERSION,
        identityKey,
        canonicalModelId,
        providerId,
        providerModel,
        routeProfile,
        providerProfile,
        snapshotId,
    });
}

/**
 * @param {ReturnType<typeof createModelGatewayModelIdentity>} identity
 * @returns {string}
 */
export function modelGatewayModelIdentityKey(identity) {
    return identity.identityKey;
}
