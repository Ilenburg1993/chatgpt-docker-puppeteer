// @ts-check
/**
 * src/copilot/audit/di-tokens.js — Tokens DI do módulo Audit.
 *
 * @module copilot/audit/di-tokens
 */

import { createToken } from '../core/di.js';

/**
 * Logger do audit pipeline.
 *
 * @type {import('../core/di.js').Token<import('../core/di-tokens.js').CopilotLogger>}
 */
export const AUDIT_LOGGER = createToken('AUDIT_LOGGER');

/**
 * Bus de eventos do audit (emitHook).
 *
 * @type {import('../core/di.js').Token<{
 *     emitHook: (name: string, sessionId: string, input: unknown, output?: unknown) => void;
 * }>}
 */
export const AUDIT_BUS = createToken('AUDIT_BUS');
