// @ts-check
/**
 * Operational health facts for model-gateway provider/model routes.
 *
 * This module owns runtime-proved health independently from terminal rendering. Terminal commands may display and
 * update these facts, but the storage contract belongs to model-gateway.
 *
 * @module copilot/model-gateway/health
 */

export { classifyByokProviderFailure } from './provider-failure.js';
export {
    byokProviderHealthRecordKey,
    byokProviderHealthRecordLastObservedAt,
    clearByokProviderModelHealth,
    configureByokProviderHealthPersistenceStoreForTests,
    createByokProviderHealthPersistenceStore,
    flushByokProviderHealth,
    hydrateByokProviderHealthFromDisk,
    listByokProviderModelHealth,
    mergeByokProviderHealthRecords,
    readByokProviderHealthPersistenceFingerprint,
    readByokProviderHealthState,
    readByokProviderModelHealth,
    readHydratedByokProviderHealthSnapshot,
    recordByokProviderModelAgentProbeFailure,
    recordByokProviderModelAgentProbeSuccess,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
    recordByokProviderModelProbeResult,
    resetByokProviderHealthForTests,
    resolveByokProviderHealthPersistenceBinding,
    restoreByokProviderHealthPersistenceStoreForTests,
    subscribeByokProviderHealthChanges,
} from './provider-health.js';
export {
    comparableModelGatewayRuntimeHealthRecord,
    diffModelGatewayRuntimeHealthSnapshots,
    summarizeModelGatewayRuntimeHealthRecords,
} from './runtime-health-diff.js';
export {
    flushAndMirrorByokProviderHealthToSqlite,
    installByokProviderHealthSqliteMirror,
    mirrorByokProviderHealthToSqlite,
    reconcileByokProviderHealthToSqlite,
} from './sqlite-health-mirror.js';
