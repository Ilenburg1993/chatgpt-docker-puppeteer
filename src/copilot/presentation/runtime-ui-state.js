// @ts-check
/**
 * @module copilot/presentation/runtime-ui-state
 * @file Façade compartilhada de leitura do estado operacional/UI do runtime.
 *
 *   A implementação-base agora vive em `runtime-ui-state-store.js` e `runtime-file-context.js`. Esta camada mantém a
 *   surface de leitura/registro estável para consumers compartilhados.
 */

import { getFileCacheStats } from './runtime-file-context.js';
import {
    clearInjectHistory,
    getBusy,
    getHubSessionId,
    getInjectHistory,
    getInjectHistoryForRuntime,
    getLastSdkPlanOperation,
    getLatestInjectHistoryEntry,
    getLatestInjectHistoryEntryForRuntime,
    getLatestThinkingHistoryEntry,
    getSdkSessionMode,
    getThinkingHistory,
    getThinkingHistoryEntry,
    recordInjectHistory,
} from './runtime-ui-state-store.js';

/** @returns {boolean} */
export function readRuntimeBusyState() {
    return getBusy();
}

/** @returns {string | null} */
export function readRuntimeHubSessionId() {
    return getHubSessionId();
}

/** @returns {'interactive' | 'plan' | 'autopilot' | 'shell' | null} */
export function readRuntimeSdkSessionMode() {
    return getSdkSessionMode();
}

/** @returns {'create' | 'update' | 'delete' | null} */
export function readRuntimeLastSdkPlanOperation() {
    return getLastSdkPlanOperation();
}

/**
 * @param {number} [limit]
 * @returns {ReturnType<typeof getInjectHistory>}
 */
export function readRuntimeInjectHistory(limit) {
    return getInjectHistory(limit);
}

/**
 * @param {string | null | undefined} runtimeId
 * @param {number} [limit]
 * @returns {ReturnType<typeof getInjectHistoryForRuntime>}
 */
export function readRuntimeInjectHistoryForRuntime(runtimeId, limit) {
    return getInjectHistoryForRuntime(runtimeId, limit);
}

/** @returns {ReturnType<typeof getLatestInjectHistoryEntry>} */
export function readRuntimeLatestInjectHistoryEntry() {
    return getLatestInjectHistoryEntry();
}

/**
 * @param {string | null | undefined} runtimeId
 * @returns {ReturnType<typeof getLatestInjectHistoryEntryForRuntime>}
 */
export function readRuntimeLatestInjectHistoryEntryForRuntime(runtimeId) {
    return getLatestInjectHistoryEntryForRuntime(runtimeId);
}

/** @returns {void} */
export function clearRuntimeInjectHistory() {
    clearInjectHistory();
}

/**
 * @param {Parameters<typeof recordInjectHistory>[0]} entry
 * @returns {void}
 */
export function recordRuntimeInjectHistory(entry) {
    recordInjectHistory(entry);
}

/**
 * @param {number} [limit]
 * @returns {ReturnType<typeof getThinkingHistory>}
 */
export function readRuntimeThinkingHistory(limit) {
    return getThinkingHistory(limit);
}

/**
 * @param {string} id
 * @returns {ReturnType<typeof getThinkingHistoryEntry>}
 */
export function readRuntimeThinkingHistoryEntry(id) {
    return getThinkingHistoryEntry(id);
}

/** @returns {ReturnType<typeof getLatestThinkingHistoryEntry>} */
export function readRuntimeLatestThinkingHistoryEntry() {
    return getLatestThinkingHistoryEntry();
}

/** @returns {{ hits: number; misses: number; size: number }} */
export function readRuntimeFileCacheStats() {
    return getFileCacheStats();
}
