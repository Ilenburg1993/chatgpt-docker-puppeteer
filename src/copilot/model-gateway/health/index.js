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
    byokProviderHealthRecordKey,
    byokProviderHealthRecordLastObservedAt,
    listByokProviderModelHealth,
    mergeByokProviderHealthRecords,
    readByokProviderHealthState,
    readByokProviderModelHealth,
    recordByokProviderModelAgentProbeFailure,
    recordByokProviderModelAgentProbeSuccess,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
    recordByokProviderModelProbeResult,
    resetByokProviderHealthForTests,
    subscribeByokProviderHealthChanges,
} from './provider-health.js';
export { classifyByokProviderFailure } from './provider-failure.js';
export {
    comparableModelGatewayRuntimeHealthRecord,
    diffModelGatewayRuntimeHealthSnapshots,
    summarizeModelGatewayRuntimeHealthRecords,
} from './runtime-health-diff.js';
export {
    flushAndMirrorByokProviderHealthToSqlite,
    installByokProviderHealthSqliteMirror,
    mirrorByokProviderHealthToSqlite,
} from './sqlite-health-mirror.js';
