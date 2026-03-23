// @ts-check
/**
 * src/copilot/types/index.js
 *
 * Barrel de re-exportação para os tipos do protocolo de comunicação LLM-A ↔ LLM-B.
 *
 * Módulos disponíveis:
 *
 * - structured-message — StructuredMessage schema, builders, serializers, parser
 *
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
} from './structured-message.js';
