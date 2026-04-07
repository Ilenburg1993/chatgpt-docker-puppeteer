// @ts-check
/**
 * src/copilot/observability/audit-log.js
 *
 * @deprecated Desde F6 — migrado para `audit/pipeline.js`. Este arquivo é um re-export de compatibilidade.
 * @module copilot/observability/audit-log
 */

export { createAuditLog, defaultAuditLog } from '#copilot/audit/pipeline';

/**
 * @typedef {import('#copilot/audit/pipeline').AuditEntry} AuditEntry
 * @typedef {import('#copilot/audit/pipeline').ToolAuditStartEntry} ToolAuditStartEntry
 * @typedef {import('#copilot/audit/pipeline').ToolAuditCompleteEntry} ToolAuditCompleteEntry
 * @typedef {import('#copilot/audit/pipeline').AuditLog} AuditLog
 */
