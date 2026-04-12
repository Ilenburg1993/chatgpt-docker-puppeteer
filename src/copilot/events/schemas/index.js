// @ts-check
/**
 * src/copilot/events/schemas/index.js — FAIXA-L18
 *
 * Barrel export + inicialização dos schemas built-in.
 *
 * @module copilot/events/schemas
 */

export {
    registerEventSchema,
    registerEventSchemas,
    validateEvent,
    getEventSchema,
    getAllSchemas,
    clearSchemas,
    schemaCount,
} from './registry.js';

export { BUILTIN_SCHEMAS } from './builtin-schemas.js';
