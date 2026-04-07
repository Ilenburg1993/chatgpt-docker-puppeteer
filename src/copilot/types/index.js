// @ts-check
/**
 * src/copilot/types/index.js
 *
 * @module copilot/types
 * @deprecated Desde F8 — migrado para core/. Este arquivo é um re-export de compatibilidade.
 */

export {
    PRIORITY_LEVELS,
    RESPONSE_TYPES,
    StructuredMessageSchema,
    buildStructuredRequest,
    buildStructuredResponse,
    isStructuredMessage,
    parseStructuredResponse,
    serializeStructuredMessage,
} from '#copilot/core/structured-message';
