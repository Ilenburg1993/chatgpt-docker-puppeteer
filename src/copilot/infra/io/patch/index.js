// @ts-check
/**
 * Barrel interno de patch/diff textual.
 *
 * @module copilot/infra/io/patch
 */

export { diffText, diffTextWithReader } from './text-diff-service.js';
export { buildSimpleTextDiff, buildSimpleTextDiffAroundLineRange } from './text-diff.js';
export { computeTextPatch } from './text-patch.js';
