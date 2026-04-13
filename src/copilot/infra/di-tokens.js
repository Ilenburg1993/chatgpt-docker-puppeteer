// @ts-check
/**
 * src/copilot/infra/di-tokens.js — Tokens DI do módulo Infra.
 *
 * @module copilot/infra/di-tokens
 */

import { createToken } from '../core/di.js';

/**
 * Gerenciador de rate-limit (throttle/debounce centralizado).
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const RATE_LIMITER = createToken('RATE_LIMITER');

/**
 * Gerenciador de cache em memória.
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const CACHE_MANAGER = createToken('CACHE_MANAGER');

/**
 * Pool de mutexes de exclusão mútua.
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const MUTEX_POOL = createToken('MUTEX_POOL');

/**
 * Registro de timers ativos (para cancel-all no shutdown).
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const TIMER_REGISTRY = createToken('TIMER_REGISTRY');

/**
 * Worker pool para tarefas paralelas.
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const WORKER_POOL = createToken('WORKER_POOL');

/**
 * Controle de fluxo de missões (controle.json).
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const MISSION_CONTROL = createToken('MISSION_CONTROL');
