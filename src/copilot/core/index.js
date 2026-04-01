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
 * - `types` — StructuredMessage schema, builders, serializers, parser
 *
 * @module copilot/core
 *
 * @example
 *     ```js
 *     import { LLM_B_TERMINAL_PORT, CopilotError, AGENT_EVENTS } from '#copilot/core';
 *     ```;
 */

export * from '../types/index.js';
export * from './constants.js';
export * from './errors.js';
