// @ts-check
/**
 * src/copilot/infra/index.js — Barrel do módulo infra.
 *
 * Exporta utilitários de infraestrutura: DI tokens, fila assíncrona, storage, lockfile e SSE.
 *
 * @module copilot/infra
 */

export {
    appendTextLocked,
    copyFileLocked,
    createOrReplaceFileAtomic,
    deleteFileLocked,
    diffText,
    moveFileLocked,
    patchTextLocked,
    readBytes,
    readLines,
    readText,
    withIoResourceLock,
    writeFileAtomic,
} from './io-engine.js';
export { getIoLockStats, withIoResourceLocks } from './io-locks.js';
export { nowIoMs, publishIoOperation } from './io-observability.js';
export { getIoScanBasename, scanDirectory } from './io-scanner.js';
export { acquireLock, releaseLock } from './lockfile.js';
export { AsyncQueue } from './queue.js';
export {
    EventFanout,
    SseReplayBuffer,
    eventFanout,
    getSseClients,
    getSseCriticalClients,
    getTerminalReplayBuffer,
} from './sse/index.js';
export { fileExists, readJson, writeJson } from './storage.js';
