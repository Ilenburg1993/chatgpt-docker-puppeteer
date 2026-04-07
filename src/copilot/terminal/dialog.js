// @ts-check
/**
 * src/copilot/terminal/dialog.js
 *
 * Shim de compatibilidade — re-exporta do submódulo `dialog/`.
 *
 * A implementação real foi decomposta em:
 *
 * - `dialog/output.js` — helpers de output e constantes
 * - `dialog/sse.js` — transmissão SSE e Socket.io
 * - `dialog/engine.js` — dialog loop e execução de turnos
 *
 * @module copilot/terminal/dialog
 */

export {
    BOOT_PROMPT,
    CRITICAL_EVENTS,
    PLAN_PREFIX,
    PROMPT_USER,
    PROMPT_WAITING,
    SEPARATOR,
    TURN_TIMEOUT_MS,
    broadcastSse,
    drainPendingNotifications,
    ensureDialogLoop,
    getPersistenceFailureCount,
    getTurnQueueDepth,
    nextSseEventId,
    printExchange,
    println,
    sendTurn,
} from './dialog/index.js';
