// @ts-check
/**
 * src/copilot/core/di-tokens.js — [L0] Tokens DI canônicos.
 *
 * Define todos os tokens DI do sistema copilot. Cada token representa uma
 * dependência injetável via `container.register(TOKEN, factory)`.
 *
 * Organizados por camada (L0→L6) para manter coerência com a arquitetura.
 *
 * @module copilot/core/di-tokens
 */

import { createToken } from './di.js';

// ═══════════════════════════════════════════════════════════════════════════════
// L0 — Core
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Logger para módulo core/shutdown.
 * @type {import('./di.js').Token<Function>}
 */
export const SHUTDOWN_LOGGER = createToken('SHUTDOWN_LOGGER');

// ═══════════════════════════════════════════════════════════════════════════════
// L0 — DB
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Logger para módulo db/sqlite.
 * @type {import('./di.js').Token<Function>}
 */
export const DB_LOGGER = createToken('DB_LOGGER');

// ═══════════════════════════════════════════════════════════════════════════════
// L1 — SDK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Logger do SDK (proxy para observability/logger).
 * @type {import('./di.js').Token<Function>}
 */
export const SDK_LOGGER = createToken('SDK_LOGGER');

/**
 * Factory de custom tools (injeta builder externo).
 * @type {import('./di.js').Token<Function>}
 */
export const TOOLS_BUILDER = createToken('TOOLS_BUILDER');

// ═══════════════════════════════════════════════════════════════════════════════
// L1 — Audit
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Logger do audit pipeline.
 * @type {import('./di.js').Token<Function>}
 */
export const AUDIT_LOGGER = createToken('AUDIT_LOGGER');

/**
 * Bus de eventos do audit (emitHook).
 * @type {import('./di.js').Token<{ emitHook: (name: string, sessionId: string, input: unknown, output?: unknown) => void }>}
 */
export const AUDIT_BUS = createToken('AUDIT_BUS');

// ═══════════════════════════════════════════════════════════════════════════════
// L3 — Tools / Bridges
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Agent ponte para LLM bridge client.
 * @type {import('./di.js').Token<object>}
 */
export const BRIDGE_AGENT = createToken('BRIDGE_AGENT');

/**
 * Agent fallback para orchestrator.
 * @type {import('./di.js').Token<object>}
 */
export const FALLBACK_AGENT = createToken('FALLBACK_AGENT');

/**
 * ConversationHub singleton.
 * @type {import('./di.js').Token<object>}
 */
export const HUB = createToken('HUB');

/**
 * Agent de permissões.
 * @type {import('./di.js').Token<object>}
 */
export const PERMISSION_AGENT = createToken('PERMISSION_AGENT');

/**
 * Session RPC facade.
 * @type {import('./di.js').Token<unknown>}
 */
export const SESSION_RPC = createToken('SESSION_RPC');

/**
 * Agent para nerv-bridge (AlwaysAliveAgent-like).
 * @type {import('./di.js').Token<object>}
 */
export const NERV_BRIDGE_AGENT = createToken('NERV_BRIDGE_AGENT');
