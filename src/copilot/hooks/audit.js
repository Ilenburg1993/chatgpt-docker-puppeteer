// @ts-check
/**
 * src/copilot/hooks/audit.js
 *
 * @deprecated Desde F6 — migrado para `audit/pipeline.js`. Este arquivo é um re-export de compatibilidade.
 * @module copilot/hooks/audit
 */

export { AuditRingBuffer } from '#copilot/audit/ring-buffer';
export { createAuditPostToolHandler, getAuditTail, globalAuditBuffer } from '#copilot/audit/pipeline';

