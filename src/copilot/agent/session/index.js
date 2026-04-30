// @ts-check
/**
 * src/copilot/agent/session/index.js — sub-barrel do subsistema Session.
 *
 * @module copilot/agent/session
 * @see EventBus
 */

export { performBootWiring } from './boot/boot-wiring.js';
export { SessionMessagesCache, syncSdkHistory } from './history/history-sync.js';
export {
    buildHookSystemContext,
    buildHookSystemContextSafe,
    initOrResumeSession,
    setBackgroundCompactionThreshold,
} from './initializers/initializer.js';
export { cleanupStaleSessions } from './lifecycle/cleanup.js';
export { SessionKeepalive } from './lifecycle/keepalive.js';
export { shouldRotateSession } from './lifecycle/rotation.js';
export {
    SESSION_MODULE_LAYOUT,
    getSessionModuleDescriptor,
    getSessionModuleRole,
    listSessionModulesByRole,
} from './module-map.js';
export { clearActiveSdkSessionOwnership, syncActiveSessionOwnership } from './state/ownership.js';
export { createSnapshot, listSnapshotsAsync, loadSnapshotAsync, saveSnapshotAsync } from './state/snapshot.js';
export { wireSessionEvents } from './wiring/event-wirer.js';
