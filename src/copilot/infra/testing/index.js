// @ts-check
/**
 * Test-control boundary for infra stateful capabilities.
 *
 * Runtime barrels intentionally do not expose reset/test helpers. This is the only cross-capability composition root
 * allowed to bypass runtime barrels, and it may target only capability-local `test-control.js` leaves.
 *
 * @module copilot/infra/testing
 */

export {
    getValidatedMutableWorkspacePathStats,
    getValidatedReadWorkspacePathStats,
    resetIoCapacityPreflightCacheForTest,
    resetSiblingTempCleanupForTest,
    resetValidatedMutableWorkspacePathStatsForTest,
    resetValidatedReadWorkspacePathStatsForTest,
} from '../filesystem/test-control.js';
export { resetSearchSubprocessCacheForTest } from '../indexing/test-control.js';
export { resetCopilotNodeCompileCacheHealthForTest } from '../platform/node/test-control.js';
