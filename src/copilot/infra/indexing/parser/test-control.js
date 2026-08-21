// @ts-check
/** Privileged parser test-control surface. Not re-exported by the runtime parser barrel. */
import { resetParserCachesForTest } from './cache/test-control.js';
import { resetParserRuntimeStatsForTest } from './foundation/test-control.js';
import { teardownParserWorkerPoolForTest } from './worker/test-control.js';

/** @param {{ teardownWorkers?: boolean }} [options] */
export async function resetParserCacheForTest(options = {}) {
    resetParserCachesForTest();
    resetParserRuntimeStatsForTest();
    if (options.teardownWorkers === true) await teardownParserWorkerPoolForTest();
}
