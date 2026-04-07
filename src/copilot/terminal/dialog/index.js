// @ts-check
/**
 * src/copilot/terminal/dialog/index.js
 *
 * Barrel do submódulo dialog do Terminal Permanente LLM-B.
 *
 * Re-exporta as APIs públicas de output, SSE e engine.
 *
 * @module copilot/terminal/dialog
 */

export { BOOT_PROMPT, PLAN_PREFIX, PROMPT_USER, PROMPT_WAITING, SEPARATOR, TURN_TIMEOUT_MS, printExchange, println } from './output.js';
export { CRITICAL_EVENTS, broadcastSse, nextSseEventId } from './sse.js';
export {
    drainPendingNotifications,
    ensureDialogLoop,
    getPersistenceFailureCount,
    getTurnQueueDepth,
    sendTurn,
} from './engine.js';
