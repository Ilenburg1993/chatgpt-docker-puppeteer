// @ts-check
/**
 * src/copilot/audit/index.js
 *
 * Barrel exports do módulo unificado de auditoria.
 *
 * @module copilot/audit
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
} from './pipeline.js';
