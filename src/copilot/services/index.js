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
 */

export { AuditService, createAuditService } from './audit-service.js';
export { ConversationService, createConversationService } from './conversation-service.js';
export { SessionService, approveAll, createSessionService, pickDefined } from './session-service.js';
export { ToolService, createToolService } from './tool-service.js';
