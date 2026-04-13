// @ts-check
/**
 * src/copilot/api/sse/utils.js
 *
 * @module copilot/api/sse-utils
 * @deprecated Onda 3.6 → 4.5 — Movido para `src/copilot/server/sse/utils.js`. Stub de re-export sem consumidores
 *   diretos (Onda 4.5 migrou api/bridge/stream.js). Remover na Onda 5.0.
 */

export {
    SseConnectionTracker,
    createEventFilter,
    createSseWriter,
    sanitizeSseEvent,
    standardizeSsePayload,
} from '../../server/sse/utils.js';
