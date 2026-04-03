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
 *
 * INC-CORE-002 fix: `types/` não mais re-exportado daqui para evitar violação de camada core→types. Importar tipos
 * diretamente via '#copilot/types' ou '#copilot/types/structured-message'.
 *
 * @module copilot/core
 *
 * @example
 *     ```js
 *     import { LLM_B_TERMINAL_PORT, CopilotError, AGENT_EVENTS } from '#copilot/core';
 *     import { buildStructuredRequest } from '#copilot/types/structured-message';
 *     ```;
 */

export * from './constants.js';
export * from './errors.js';
