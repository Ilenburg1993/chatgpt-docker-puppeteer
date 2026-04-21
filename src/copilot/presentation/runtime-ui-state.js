// @ts-check
/**
 * @module copilot/presentation/runtime-ui-state
 * @file Façade compartilhada de leitura do estado operacional/UI do runtime.
 *
 *   A implementação-base agora vive em `runtime-ui-state-store.js` e `runtime-file-context.js`, deixando
 *   `terminal/state.js` apenas como shim de compatibilidade. Esta camada mantém a surface de leitura/registro estável
 *   para consumers compartilhados.
 */

import { getFileCacheStats } from './runtime-file-context.js';
import {
    getBusy,
    getHubSessionId,
    getInjectHistory,
    getLastSdkPlanOperation,
    getSdkSessionMode,
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
 * @param {Parameters<typeof recordInjectHistory>[0]} entry
 * @returns {void}
 */
export function recordRuntimeInjectHistory(entry) {
    recordInjectHistory(entry);
}

/** @returns {{ hits: number; misses: number; size: number }} */
export function readRuntimeFileCacheStats() {
    return getFileCacheStats();
}
