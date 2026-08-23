// @ts-check
/**
 * src/copilot/audit/index.js
 *
 * Barrel exports do módulo unificado de auditoria.
 *
 * @module copilot/audit
 * @see EventBus
 */

/** @typedef {import('./pipeline-audit-log.js').AuditEntry} AuditEntry */

// Ring buffer genérico
export { AuditRingBuffer } from './ring-buffer.js';

// Pipeline unificado
export {
    buildAuditingPermissionHandler,
    createAuditLog,
    createAuditPostToolHandler,
    defaultAuditLog,
    flushPermissionAudit,
    getAuditTail,
    globalAuditBuffer,
    isHighRiskTool,
    logToolAudit,
    setAuditBus,
} from './pipeline.js';

export {
    AuditTrail,
    globalAuditTrail,
    withErrorAudit,
    withPostToolAudit,
    withPreToolAudit,
} from './hook-audit-trail.js';

// Logger proxy (DI)
export { setAuditErrorReporter, setAuditLogger } from './logger.js';

// Re-export de constantes de eventos de auditoria (SSOT vive em #copilot/events)
export { AUDIT_LOG } from '#copilot/events';

// ─── DI Tokens ────────────────────────────────────────────────────────────────
