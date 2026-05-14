// @ts-check
/**
 * src/copilot/sdk/di-tokens.js — Tokens DI do módulo SDK.
 *
 * @module copilot/sdk/di-tokens
 */

import { createToken } from '#copilot/core/di';

/**
 * Logger do SDK (proxy para observability/logger).
 *
 * @type {import('#copilot/core/di').Token<import('#copilot/core/di-tokens').CopilotLogger>}
 */
export const SDK_LOGGER = createToken('SDK_LOGGER');

/**
 * Factory de custom tools (injeta builder externo).
 *
 * @type {import('#copilot/core/di').Token<import('./tools/custom.js').BuildToolFn>}
 */
export const TOOLS_BUILDER = createToken('TOOLS_BUILDER');

/**
 * Manager isolável do lifecycle do CopilotClient.
 *
 * @type {import('#copilot/core/di').Token<import('./session/client.js').CopilotClientManager>}
 */
export const SDK_CLIENT_MANAGER = createToken('SDK_CLIENT_MANAGER');

/**
 * Runtime isolável de registry/selector/stats de modelos.
 *
 * @type {import('#copilot/core/di').Token<import('./models/registry.js').ModelRuntime>}
 */
export const SDK_MODEL_RUNTIME = createToken('SDK_MODEL_RUNTIME');

/**
 * Logger do runtime de hooks (superfície neutra SDK).
 *
 * @type {import('#copilot/core/di').Token<import('#copilot/core/di-tokens').CopilotLogger>}
 */
export const HOOKS_LOGGER = createToken('HOOKS_LOGGER');
