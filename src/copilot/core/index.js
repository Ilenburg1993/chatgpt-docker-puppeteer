// @ts-check
/**
 * src/copilot/core/index.js
 *
 * Barrel — ponto de entrada único para todos os contratos centrais do módulo copilot.
 *
 * Sub-módulos disponíveis:
 *
 * - `constants` — portas, limites e nomes de eventos canônicos
 * - `errors` — CopilotError, SessionError, BridgeError
 * - `structured-message` — StructuredMessage schema, builders, serializers, parser
 * - `sdk-types` — JSDoc typedefs para SDK (@github/copilot-sdk)
 *
 * @module copilot/core
 *
 * @example
 *     ```js
 *     import { LLM_B_TERMINAL_PORT, CopilotError, AGENT_EVENTS } from '#copilot/core';
 *     import { buildStructuredRequest } from '#copilot/core/structured-message';
 *     ```;
 */

export * from './constants.js';
export * from './errors.js';
export * from './structured-message.js';
