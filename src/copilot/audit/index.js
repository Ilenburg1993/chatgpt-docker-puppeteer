// @ts-check
/**
 * src/copilot/audit/index.js
 *
 * Barrel exports do módulo unificado de auditoria.
 *
 * @module copilot/audit
 * @see EventBus
 */

// Ring buffer genérico
export { AuditRingBuffer } from './ring-buffer.js';

// JSONL writer
export { createJsonlWriter } from './jsonl-writer.js';

// Pipeline unificado
export {
    buildAuditingPermissionHandler,
    createAuditLog,
    createAuditPostToolHandler,
    defaultAuditLog,
    getAuditTail,
    globalAuditBuffer,
    isHighRiskTool,
    logToolAudit,
    setAuditBus,
} from './pipeline.js';

// Logger proxy (DI)
export { setAuditLogger } from './logger.js';

// Re-export de constantes de eventos de auditoria (SSOT vive em #copilot/events)
export { AUDIT_LOG } from '#copilot/events';

// ─── DI Tokens ────────────────────────────────────────────────────────────────
export { AUDIT_BUS, AUDIT_LOGGER } from './di-tokens.js';
