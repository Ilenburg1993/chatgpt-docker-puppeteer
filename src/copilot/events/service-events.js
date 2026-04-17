// @ts-check
/**
 * src/copilot/events/service-events.js
 *
 * FAIXA-L2 — Constantes SSOT para eventos de facades/integrações de serviço.
 *
 * Mantidas por retrocompatibilidade de naming, mesmo após a remoção do diretório `services/` na Fase 1 da migração.
 * Garantem conformidade C11 (single source of truth para event strings).
 *
 * @module copilot/events/service-events
 */

/** @type {string} */ export const SERVICE_SESSION_CREATED = 'service:session:created';
/** @type {string} */ export const SERVICE_SESSION_DISCONNECTED = 'service:session:disconnected';
/** @type {string} */ export const SERVICE_SESSION_RESUMED = 'service:session:resumed';
/** @type {string} */ export const SERVICE_SESSION_MESSAGE = 'service:session:message';
/** @type {string} */ export const SERVICE_TOOL_INVOKED = 'service:tool:invoked';
