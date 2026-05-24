// @ts-check
/**
 * Operational health facts for model-gateway provider/model routes.
 *
 * This module owns runtime-proved health independently from terminal rendering. Terminal commands may display and update
 * these facts, but the storage contract belongs to model-gateway.
 *
 * @module copilot/model-gateway/health
 */

export {
    clearByokProviderModelHealth,
    flushByokProviderHealth,
    listByokProviderModelHealth,
    readByokProviderHealthState,
    readByokProviderModelHealth,
    recordByokProviderModelAgentProbeFailure,
    recordByokProviderModelAgentProbeSuccess,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
    recordByokProviderModelProbeResult,
    resetByokProviderHealthForTests,
} from './provider-health.js';
export { classifyByokProviderFailure } from './provider-failure.js';
