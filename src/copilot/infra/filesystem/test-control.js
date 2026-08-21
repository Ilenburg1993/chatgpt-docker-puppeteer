// @ts-check
/** Private filesystem test-control aggregator. Runtime filesystem barrels never reexport this surface. */
export { resetIoCapacityPreflightCacheForTest, resetSiblingTempCleanupForTest } from './transaction/test-control.js';
export {
    getValidatedMutableWorkspacePathStats,
    getValidatedReadWorkspacePathStats,
    resetValidatedMutableWorkspacePathStatsForTest,
    resetValidatedReadWorkspacePathStatsForTest,
} from './workspace/test-control.js';
