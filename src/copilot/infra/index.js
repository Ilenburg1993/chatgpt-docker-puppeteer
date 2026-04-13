// @ts-check
/**
 * src/copilot/infra/index.js — Barrel do módulo infra.
 *
 * Exporta utilitários de infraestrutura: DI tokens, fila assíncrona, storage e lockfile.
 *
 * @module copilot/infra
 */

export { CACHE_MANAGER, MISSION_CONTROL, MUTEX_POOL, RATE_LIMITER, TIMER_REGISTRY, WORKER_POOL } from './di-tokens.js';
export { acquireLock, releaseLock } from './lockfile.js';
export { AsyncQueue } from './queue.js';
export { fileExists, readJson, writeJson } from './storage.js';
