// @ts-check
/**
 * src/copilot/services/index.js
 *
 * Barrel canônico do módulo `services/` — fachadas de alto nível para subsistemas.
 *
 * Consumido via imports diretos (`../../../services/audit-service.js` etc.) pelos sub-routers em `server/routes/sdk/`.
 *
 * @module copilot/services
 */

export { AuditService, createAuditService } from './audit-service.js';
export { ConversationService, createConversationService } from './conversation-service.js';
export { SessionService, approveAll, createSessionService, pickDefined } from './session-service.js';
export { ToolService, createToolService } from './tool-service.js';
