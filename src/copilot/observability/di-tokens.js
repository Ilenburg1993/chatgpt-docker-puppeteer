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

/**
 * Gerenciador de alertas e notificações de saúde.
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const ALERTS_MANAGER = createToken('ALERTS_MANAGER');

/**
 * Monitor de quota do SDK (Faixa 25).
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const QUOTA_MONITOR = createToken('QUOTA_MONITOR');

/**
 * Gerenciador de saúde do sistema (health check aggregator).
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const HEALTH_MANAGER = createToken('HEALTH_MANAGER');

/**
 * Tracer OpenTelemetry (noop se OTEL desabilitado).
 *
 * @type {import('../core/di.js').Token<object>}
 */
export const OTEL_TRACER = createToken('OTEL_TRACER');
