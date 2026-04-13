// @ts-check
/**
 * src/copilot/infra/index.js — Barrel do módulo infra.
 *
 * Exporta utilitários de infraestrutura: DI tokens, fila assíncrona, storage, lockfile e SSE.
 *
 * @module copilot/infra
 */

export { CACHE_MANAGER, MISSION_CONTROL, MUTEX_POOL, RATE_LIMITER, TIMER_REGISTRY, WORKER_POOL } from './di-tokens.js';
export { acquireLock, releaseLock } from './lockfile.js';
export { AsyncQueue } from './queue.js';
export { EventFanout, eventFanout, getSseClients, getSseCriticalClients, getTerminalReplayBuffer, SseReplayBuffer } from './sse/index.js';
export { fileExists, readJson, writeJson } from './storage.js';
