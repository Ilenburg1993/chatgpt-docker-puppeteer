// @ts-check
/**
 * src/copilot/agent/session/index.js — sub-barrel do subsistema Session.
 *
 * @module copilot/agent/session
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
export { createSnapshot, listSnapshots, loadLatestSnapshot, loadSnapshot, saveSnapshot } from './snapshot.js';
