// @ts-check
/**
 * Barrel público do subdomínio `presentation/routing`.
 *
 * @module copilot/presentation/routing
 */

/** @typedef {import('./meta.js').RuntimeRouteMeta} RuntimeRouteMeta */
/** @typedef {import('./route-deps.js').CopilotApiRouteDeps} CopilotApiRouteDeps */
/** @typedef {import('./request.js').CopilotApiRouteBinding} CopilotApiRouteBinding */

export {
    buildMissingRuntimeRouteMeta,
    buildRuntimeFallbackWarning,
    buildRuntimeRouteMetaFromSelection,
    buildRuntimeRouteMetaPayload,
    normalizeRuntimeRouteMeta,
} from './meta.js';
export { resolveCopilotApiRouteBinding, resolveCopilotApiRouteDeps, resolveRequestedRuntimeId } from './request.js';
export { buildDefaultCopilotApiRouteDeps } from './route-deps.js';
export { hasRuntimeId, normalizeRuntimeId, pickRuntimeId, readRuntimeIdFromParams } from './targeting.js';
