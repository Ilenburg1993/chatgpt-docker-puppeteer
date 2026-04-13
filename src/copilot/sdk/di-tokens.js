// @ts-check
/**
 * src/copilot/sdk/di-tokens.js — Tokens DI do módulo SDK.
 *
 * @module copilot/sdk/di-tokens
 */

import { createToken } from '../core/di.js';

/**
 * Logger do SDK (proxy para observability/logger).
 *
 * @type {import('../core/di.js').Token<Function>}
 */
export const SDK_LOGGER = createToken('SDK_LOGGER');

/**
 * Factory de custom tools (injeta builder externo).
 *
 * @type {import('../core/di.js').Token<Function>}
 */
export const TOOLS_BUILDER = createToken('TOOLS_BUILDER');
