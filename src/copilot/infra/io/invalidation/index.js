// @ts-check
/**
 * Barrel interno de invalidação de I/O.
 *
 * @module copilot/infra/io/invalidation
 */

export { publishIoInvalidation, registerIoInvalidationHook } from './bus.js';
export { normalizeIoInvalidationEvent } from './events.js';
