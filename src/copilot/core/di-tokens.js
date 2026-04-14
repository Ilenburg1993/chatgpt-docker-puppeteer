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
// Re-exports de tokens de camadas superiores removidos — Faixa 3.4 (D2-12)
// Cada camada exporta seus próprios tokens diretamente via `<modulo>/di-tokens.js`.
// Exemplo: `import { ALWAYS_ALIVE_AGENT } from '#copilot/agent/di-tokens.js'`
// ═══════════════════════════════════════════════════════════════════════════════
