// @ts-check
/**
 * src/copilot/types/index.js
 *
 * @deprecated Desde F8 — migrado para core/. Este arquivo é um re-export de compatibilidade.
 * @module copilot/types
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
