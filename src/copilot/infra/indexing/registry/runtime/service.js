// @ts-check
/** Public persistent-index runtime façade and invalidation-hook composition. */
import { registerIoInvalidationHook } from '#copilot/infra/internal/filesystem/invalidation';
import { resolve } from 'node:path';
import {
    getIoIndexAutoRefreshStats,
    refreshIoIndexPathsScheduled,
    scheduleIoIndexAutoRefresh,
} from '../refresh/index.js';
import { getIoIndexInstance, isIoIndexDisabled } from '../state/index.js';

/** @type {(() => void) | null} */
let indexInvalidationUnregister = null;
function ensureIndexInvalidationHook() {
    if (indexInvalidationUnregister) return;
    indexInvalidationUnregister =
        registerIoInvalidationHook((filePath, event) => {
            try {
                getIoIndexInstance()?.invalidatePath(filePath);
                scheduleIoIndexAutoRefresh(filePath, event);
            } catch {
                /* writer-critical invalidation remains best-effort */
            }
        }) ?? null;
}
export function getIoIndex() {
    ensureIndexInvalidationHook();
    return getIoIndexInstance();
}
export function getIoIndexStats() {
    const index = getIoIndex();
    if (!index)
        return {
            enabled: false,
            available: false,
            reason: isIoIndexDisabled() ? 'disabled-via-env' : 'unavailable',
            autoRefresh: getIoIndexAutoRefreshStats(),
        };
    return { ...index.getStats(), autoRefresh: getIoIndexAutoRefreshStats() };
}
/** @param {readonly string[]} filePaths @param {Parameters<typeof refreshIoIndexPathsScheduled>[1]} options */
export async function refreshIoIndexPaths(filePaths, options) {
    // Preserve the historical side effect: explicit refresh also activates the invalidation hook for future convergence.
    getIoIndex();
    return refreshIoIndexPathsScheduled(filePaths, { ...options, workspaceRoot: resolve(options.workspaceRoot) });
}
/** Test-control leaf target. */
export function resetIoIndexRuntimeHookForTest() {
    indexInvalidationUnregister?.();
    indexInvalidationUnregister = null;
}
