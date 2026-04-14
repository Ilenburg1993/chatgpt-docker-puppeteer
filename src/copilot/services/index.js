// @ts-check
/**
 * src/copilot/services/index.js
 *
 * Barrel canônico do módulo `services/` — fachadas de alto nível para subsistemas.
 *
 * Este módulo é **L4** — consolida agent, sdk, config, tools, hooks, bridges em interfaces coesas. Consumido por `api/`
 * e `terminal/` para reduzir fan-out.
 *
 * @module copilot/services
 * @see EventBus
 */

export { AuditService, createAuditService } from './audit-service.js';
export { ConversationService, createConversationService } from './conversation-service.js';
export { SessionService, approveAll, createSessionService, pickDefined } from './session-service.js';
export { ToolService, createToolService } from './tool-service.js';

// ── Re-exports de L4 para api/ e terminal/ ────────────────────────────────────
// Concentrar aqui reduz o fan-out de api/ e terminal/ e cumpre C10.

// De #copilot/agent
export {
    alwaysAliveAgent,
    createSnapshot,
    listSnapshotsAsync,
    loadSnapshotAsync,
    saveSnapshotAsync,
    setBackgroundCompactionThreshold,
} from '#copilot/agent';

// De #copilot/conversation-hub
export { broadcastGlobal, broadcastToSession, conversationHub, conversationStore } from '#copilot/conversation-hub';

// De #copilot/channel
export { CHANNEL_VERSION, llmBridgeClient } from '#copilot/channel';
