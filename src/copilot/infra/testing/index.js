// @ts-check
/**
 * Test-control boundary for infra stateful capabilities.
 *
 * Runtime barrels intentionally do not expose reset/test helpers. This is the only cross-capability composition root
 * allowed to bypass runtime barrels, and it may target only capability-local `test-control.js` leaves.
 *
 * @module copilot/infra/testing
 */

export { resetIoL1CacheForTest, resetIoL2CacheForTest } from '../cache/test-control.js';
export { resetInfraSqliteProviderForTest } from '../database/test-control.js';
export {
    resetByteLineIndexCacheForTest,
    resetCrossProcessInvalidationRuntimeForTest,
    resetIoCapacityPreflightCacheForTest,
    resetIoExternalWatchForTest,
    resetIoInvalidationBusForTest,
    resetIoReadHashStatsForTest,
    resetLineOffsetCacheForTest,
    resetSiblingTempCleanupForTest,
    resetValidatedMutableWorkspacePathStatsForTest,
    resetValidatedReadWorkspacePathStatsForTest,
} from '../filesystem/test-control.js';
export {
    resetIoIndexForTest,
    resetParserCacheForTest,
    resetSearchSubprocessCacheForTest,
} from '../indexing/test-control.js';
export { resetCopilotNodeCompileCacheHealthForTest } from '../platform/node/test-control.js';
export { resetIoAdvisoryBudgetForTest } from '../telemetry/test-control.js';
