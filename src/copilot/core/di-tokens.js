// @ts-check
/**
 * src/copilot/core/di-tokens.js — [L0] Tokens DI canônicos.
 *
 * Tokens L0 (core) são definidos aqui. Tokens de camadas superiores vivem em seus módulos.
 *
 * @module copilot/core/di-tokens
 */

import { createToken } from './di.js';

/**
 * Assinatura canônica do logger injetável via DI.
 *
 * @typedef {(
 *     level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL',
 *     msg: string | Error | Record<string, unknown>,
 *     metaOrTaskId?: string | Record<string, unknown>,
 * ) => void} CopilotLogger
 */

/**
 * Logger para módulo core/shutdown.
 *
 * @type {import('./di.js').Token<CopilotLogger>}
 */
export const SHUTDOWN_LOGGER = createToken('SHUTDOWN_LOGGER');

/**
 * Logger para módulo db/sqlite.
 *
 * @type {import('./di.js').Token<CopilotLogger>}
 */
export const DB_LOGGER = createToken('DB_LOGGER');

/**
 * Event bus cross-module centralizado.
 *
 * @type {import('./di.js').Token<import('./event-bus.js').EventBus>}
 */
export const EVENT_BUS = createToken('EVENT_BUS');
