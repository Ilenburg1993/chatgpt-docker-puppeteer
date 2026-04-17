// @ts-check
/**
 * src/copilot/infra/index.js — Barrel do módulo infra.
 *
 * Exporta utilitários de infraestrutura: DI tokens, fila assíncrona, storage, lockfile e SSE.
 *
 * @module copilot/infra
 */

export { acquireLock, releaseLock } from './lockfile.js';
export { AsyncQueue } from './queue.js';
export {
    clearActiveSdkSessions,
    getActiveSdkSession,
    getActiveSdkSessionCount,
    incrementActiveSdkSessionMessageCount,
    listActiveSdkSessions,
    registerActiveSdkSession,
    removeActiveSdkSession,
} from './sdk-session-registry.js';
export {
    EventFanout,
    SseReplayBuffer,
    eventFanout,
    getSseClients,
    getSseCriticalClients,
    getTerminalReplayBuffer,
} from './sse/index.js';
export { fileExists, readJson, writeJson } from './storage.js';
