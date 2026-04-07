// @ts-check
/**
 * src/copilot/core/constants.js
 *
 * Re-exports de constantes canônicas para acesso via `#copilot/core`.
 *
 * Todos os valores originam de `config/env.js` (SSOT) ou `core/events.js`.
 * Este módulo existe para manter retrocompatibilidade com importadores que usam
 * `#copilot/core/constants` ou o barrel `#copilot/core`.
 *
 * @module copilot/core/constants
 */

export {
    getCopilotFallbackModel,
    LLM_B_TERMINAL_PORT,
    LLM_B_TURN_TIMEOUT_MS,
    MAX_QUEUE_SIZE,
    MAX_SSE_CLIENTS,
    MAX_SSE_CONTENT_CHARS,
} from '#copilot/config/env';

export { AGENT_EVENTS, DIALOG_LOOP_EVENTS, PR_CONSUMING_EVENTS } from './events.js';
/** @typedef {import('./events.js').AgentEventName} AgentEventName */
