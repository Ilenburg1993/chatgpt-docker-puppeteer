// @ts-check
/**
 * src/copilot/hooks/audit.js
 *
 * @module copilot/hooks/audit
 * @deprecated Desde F6 — migrado para `audit/pipeline.js`. Este arquivo é um re-export de compatibilidade.
 */

export { createAuditPostToolHandler, getAuditTail, globalAuditBuffer } from '#copilot/audit/pipeline';
export { AuditRingBuffer } from '#copilot/audit/ring-buffer';
