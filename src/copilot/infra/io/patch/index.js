// @ts-check
/**
 * Barrel interno de patch/diff textual.
 *
 * @module copilot/infra/io/patch
 */

export { buildSimpleTextDiff } from './text-diff.js';
export { diffText, diffTextWithReader } from './text-diff-service.js';
export { computeTextPatch } from './text-patch.js';
