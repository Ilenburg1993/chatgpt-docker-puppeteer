// @ts-check
/**
 * src/copilot/audit/pipeline.js
 *
 * Barrel do pipeline unificado de auditoria. Re-exporta dos 3 sub-módulos:
 *
 * - `pipeline-sdk-buffer.js` — ring buffer SDK (`globalAuditBuffer`, `getAuditTail`, `createAuditPostToolHandler`)
 * - `pipeline-audit-log.js` — ring buffer geral + tool call correlation + JSONL I/O (`defaultAuditLog`)
 * - `pipeline-permission.js` — permission logging + high risk classification + event bus
 *
 * @module copilot/audit/pipeline
 * @see EventBus
 */

/**
 * Re-export de typedefs para compatibilidade com referências externas existentes.
 *
 * @typedef {import('./pipeline-audit-log.js').AuditEntry} AuditEntry
 *
 * @typedef {import('./pipeline-audit-log.js').AuditLog} AuditLog
 *
 * @typedef {import('./pipeline-audit-log.js').ToolAuditStartEntry} ToolAuditStartEntry
 *
 * @typedef {import('./pipeline-audit-log.js').ToolAuditCompleteEntry} ToolAuditCompleteEntry
 */

export { createAuditPostToolHandler, getAuditTail, globalAuditBuffer } from './pipeline-sdk-buffer.js';

export { createAuditLog, defaultAuditLog } from './pipeline-audit-log.js';

export {
    buildAuditingPermissionHandler,
    flushPermissionAudit,
    isHighRiskTool,
    logToolAudit,
    setAuditBus,
} from './pipeline-permission.js';
