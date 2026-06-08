// @ts-check
/**
 * src/copilot/events/hook-events.js
 *
 * Constantes de eventos emitidos pelo HookBus (hooks de pré/pós processamento, session, error).
 *
 * Migrado de `types/events.js` (FAIXA-2A). Consumidores devem importar de `#copilot/events`.
 *
 * @module copilot/events/hook-events
 * @see EventBus
 */

/** @readonly */
export const HOOK_PRE_TOOL_USE = 'hook:pre_tool_use';
/** @readonly */
export const HOOK_PRE_MCP_TOOL_CALL = 'hook:pre_mcp_tool_call';
/** @readonly */
export const HOOK_POST_TOOL_USE = 'hook:post_tool_use';
/** @readonly */
export const HOOK_POST_TOOL_USE_FAILURE = 'hook:post_tool_use_failure';
/** @readonly */
export const HOOK_PROMPT_SUBMITTED = 'hook:prompt_submitted';
/** @readonly */
export const HOOK_SESSION_START = 'hook:session_start';
/** @readonly */
export const HOOK_SESSION_END = 'hook:session_end';
/** @readonly */
export const HOOK_ERROR_OCCURRED = 'hook:error_occurred';
