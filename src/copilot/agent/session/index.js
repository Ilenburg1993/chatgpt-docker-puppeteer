// @ts-check
/**
 * src/copilot/agent/session/index.js — sub-barrel do subsistema Session.
 *
 * @module copilot/agent/session
 * @see EventBus
 */

export { performBootWiring } from './boot-wiring.js';
export { cleanupStaleSessions } from './cleanup.js';
export { wireSessionEvents } from './event-wirer.js';
export { SessionMessagesCache, syncSdkHistory } from './history-sync.js';
export {
    buildHookSystemContext,
    buildHookSystemContextSafe,
    initOrResumeSession,
    setBackgroundCompactionThreshold,
} from './initializer.js';
export { SessionKeepalive } from './keepalive.js';
export { shouldRotateSession } from './rotation.js';
export { createSnapshot, listSnapshotsAsync, loadSnapshotAsync, saveSnapshotAsync } from './snapshot.js';
