// @ts-check
/**
 * @module copilot/agent/facades/agent-runtime-controls
 * @file Facade canônica para controles/mutações auxiliares do runtime do agent.
 *
 *   Esta camada concentra helpers operacionais que antes eram importados de forma solta do barrel do `agent/` (snapshots,
 *   threshold de compaction e leitura do handoff manager), deixando as bordas consumirem uma superfície explícita e
 *   estável.
 */

import { setBackgroundCompactionThreshold } from '../session/initializer.js';
import { createSnapshot, listSnapshotsAsync, loadSnapshotAsync, saveSnapshotAsync } from '../session/snapshot.js';

/**
 * @typedef {{ getHandoffManager?: () => import('../infra/handoff-manager.js').HandoffManager | null }} AgentRuntimeControlsTarget
 */

/**
 * @param {AgentRuntimeControlsTarget} runtime
 * @returns {import('../infra/handoff-manager.js').HandoffManager | null}
 */
export function getRuntimeHandoffManager(runtime) {
    return runtime.getHandoffManager?.() ?? null;
}

/**
 * @param {AgentRuntimeControlsTarget} runtime
 * @returns {import('../infra/handoff-manager.js').HandoffRequest[]}
 */
export function getRuntimeHandoffHistory(runtime) {
    return getRuntimeHandoffManager(runtime)?.getHistory?.() ?? [];
}

/**
 * @param {number} threshold
 * @returns {void}
 */
export function setRuntimeBackgroundCompactionThreshold(threshold) {
    setBackgroundCompactionThreshold(threshold);
}

/**
 * @param {Parameters<typeof createSnapshot>[0]} data
 * @returns {ReturnType<typeof createSnapshot>}
 */
export function createRuntimeSnapshot(data) {
    return createSnapshot(data);
}

/**
 * @param {Parameters<typeof saveSnapshotAsync>[0]} snapshot
 * @returns {ReturnType<typeof saveSnapshotAsync>}
 */
export function saveRuntimeSnapshot(snapshot) {
    return saveSnapshotAsync(snapshot);
}

/**
 * @returns {ReturnType<typeof listSnapshotsAsync>}
 */
export function listRuntimeSnapshots() {
    return listSnapshotsAsync();
}

/**
 * @param {string} snapshotId
 * @returns {ReturnType<typeof loadSnapshotAsync>}
 */
export function loadRuntimeSnapshot(snapshotId) {
    return loadSnapshotAsync(snapshotId);
}
