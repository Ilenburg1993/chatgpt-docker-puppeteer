// @ts-check
/**
 * src/copilot/observability/di-tokens.js — Tokens DI do módulo Observability.
 *
 * @module copilot/observability/di-tokens
 */

import { createToken } from '../core/di.js';

/**
 * Repositório de métricas de sessão.
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const METRICS_STORE = createToken('METRICS_STORE');

/**
 * Tracker de erros (error collector/aggregator).
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const ERROR_TRACKER = createToken('ERROR_TRACKER');

/**
 * Coletor de eventos de observabilidade.
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const EVENT_COLLECTOR = createToken('EVENT_COLLECTOR');
