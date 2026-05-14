// @ts-check
/**
 * Barrel de policies internas de infra.
 *
 * @module copilot/infra/policy
 */

export { limitTextLines, normalizeCursorOffset, normalizeMaxResults, windowItems, windowTextLines } from './output-window.js';
export { assertExpectedSha256 } from './preconditions.js';
