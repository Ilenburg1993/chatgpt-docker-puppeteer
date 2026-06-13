// @ts-check
/**
 * src/copilot/infra/index.js — Barrel do módulo infra.
 *
 * Exporta utilitários de infraestrutura: DI tokens, fila assíncrona, storage, lockfile e SSE.
 *
 * @module copilot/infra
 */

export {
    getIoCacheStats,
    getIoL1Cache,
    getVerifiedIoL1Entry,
    invalidateIoCachePath,
    invalidateIoCacheSubtree,
    makeBytesKey,
    makeTextKey,
    normalizeIoCacheKey,
    resetIoL1CacheForTest,
} from './io-cache.js';

export { createIoL2SqliteCache, isIoL2Cache } from './io-cache-l2-sqlite.js';

export { getIoL2Cache, getIoL2CacheHealth, getIoL2CacheStats, resetIoL2CacheForTest } from './io-cache-l2-registry.js';

export { aggregateIoCacheTierStats, buildIoCacheTierPlan } from './io-cache-tiering.js';
export {
    buildIoIndexForDirectory,
    findIoIndexSymbol,
    getIoIndex,
    getIoIndexStats,
    invalidateIoIndexPath,
    resetIoIndexForTest,
    searchIoIndex,
} from './io-index-registry.js';
export { createIoIndexSqlite, isIoIndex } from './io-index-sqlite.js';

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
    readTextChunks,
    withIoResourceLock,
    writeFileAtomic,
} from './io-engine.js';
export { readIoRuntimeHealthSnapshot } from './io-health.js';
export { acquireIoResourceLock, acquireIoResourceLocks, getIoLockStats, withIoResourceLocks } from './io-locks.js';
export { getIoDurabilityStats, nowIoMs, publishIoLifecycleEvent, publishIoOperation } from './io-observability.js';
export {
    buildOutline,
    extractJsonSchema,
    extractMarkdownOutline,
    extractTopComments,
    getParserCacheStats,
    invalidateParserCache,
    parseAndCacheSymbols,
    parseFileForContext,
    parseFileSymbols,
    resolveParserWorkerPoolPolicy,
    shutdownParserWorkerPool,
} from './io-parser.js';
export {
    endSessionScope,
    getSessionScopeStats,
    listSessionScopes,
    startSessionScope,
    warmCacheForPaths,
    warmFromDirectory,
    warmRecentPaths,
} from './io-prefetch.js';
export { getIoScanBasename, scanDirectory } from './io-scanner.js';
export {
    closeScope,
    declareScope,
    findSymbol,
    getScopeContext,
    getScopeStats,
    getScopeSymbolIndex,
    invalidateScopePath,
    listScopes,
    refreshScope,
} from './io-session-scope.js';
export { acquireLock, releaseLock, releaseLockAsync } from './lockfile.js';
export {
    INFRA_MODULE_LAYOUT,
    buildInfraModuleScorecard,
    getInfraModuleDescriptor,
    listInfraModulesByRisk,
    listInfraModulesByRole,
} from './module-map.js';
export * from './public/buffer.js';
export * from './public/cache.js';
export * from './public/events.js';
export * from './public/health.js';
export * from './public/indexing.js';
export * from './public/io.js';
export * from './public/runtime.js';
export * from './public/session.js';
export * from './public/testing.js';
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
