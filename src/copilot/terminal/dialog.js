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
 * @see EventBus
 */

export {
    BOOT_PROMPT,
    CRITICAL_EVENTS,
    PROMPT_USER,
    PROMPT_WAITING,
    SEPARATOR,
    TURN_TIMEOUT_MS,
    broadcastSse,
    buildUserPrompt,
    buildWaitingPrompt,
    drainPendingNotifications,
    ensureDialogLoop,
    getPersistenceFailureCount,
    getTurnQueueDepth,
    nextSseEventId,
    printExchange,
    println,
    sendTurn,
} from './dialog/index.js';
