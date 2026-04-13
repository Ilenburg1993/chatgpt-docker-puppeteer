// @ts-check
/**
 * src/copilot/core/di-tokens.js — [L0] Tokens DI canônicos.
 *
 * Tokens L0 (core) são definidos aqui. Tokens de camadas superiores vivem em seus módulos
 * e são re-exportados para backward compatibility.
 *
 * @module copilot/core/di-tokens
 */

import { createToken } from './di.js';

// ═══════════════════════════════════════════════════════════════════════════════
// L0 — Core (definidos aqui)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Logger para módulo core/shutdown.
 *
 * @type {import('./di.js').Token<Function>}
 */
export const SHUTDOWN_LOGGER = createToken('SHUTDOWN_LOGGER');

/**
 * Logger para módulo db/sqlite.
 *
 * @type {import('./di.js').Token<Function>}
 */
export const DB_LOGGER = createToken('DB_LOGGER');

/**
 * Event bus cross-module centralizado.
 *
 * @type {import('./di.js').Token<import('./event-bus.js').EventBus>}
 */
export const EVENT_BUS = createToken('EVENT_BUS');

/**
 * Logger raiz (root logger do sistema).
 *
 * @type {import('./di.js').Token<Function>}
 */
export const ROOT_LOGGER = createToken('ROOT_LOGGER');

/**
 * Configuração de runtime (config.json parseado + validado).
 *
 * @type {import('./di.js').Token<object>}
 */
export const APP_CONFIG = createToken('APP_CONFIG');

// ═══════════════════════════════════════════════════════════════════════════════
// Re-exports de tokens de camadas superiores (backward compatibility)
// ═══════════════════════════════════════════════════════════════════════════════

export { ALWAYS_ALIVE_AGENT, DIALOG_ENGINE } from '../agent/di-tokens.js';
export { AUDIT_BUS, AUDIT_LOGGER, AUDIT_PIPELINE } from '../audit/di-tokens.js';
export { BRIDGE_AGENT, FALLBACK_AGENT, NERV_BRIDGE_AGENT, PERMISSION_AGENT } from '../bridges/di-tokens.js';
export { INJECT_SERVER } from '../channel/di-tokens.js';
export { CONVERSATION_STORE, HUB, SESSION_RPC, SOCKET_NAMESPACE } from '../conversation-hub/di-tokens.js';
export { CACHE_MANAGER, MISSION_CONTROL, MUTEX_POOL, RATE_LIMITER, TIMER_REGISTRY, WORKER_POOL } from '../infra/di-tokens.js';
export {
    ALERTS_MANAGER, ERROR_TRACKER, EVENT_COLLECTOR, HEALTH_MANAGER,
    METRICS_STORE, OTEL_TRACER, QUOTA_MONITOR
} from '../observability/di-tokens.js';
export { CIRCUIT_BREAKER_REGISTRY, PLUGIN_REGISTRY } from '../plugins/di-tokens.js';
export { SDK_LOGGER, TOOLS_BUILDER } from '../sdk/di-tokens.js';
export { AGENT_SERVICE, CONVERSATION_SERVICE, DIALOG_SERVICE, SESSION_SERVICE } from '../services/di-tokens.js';
