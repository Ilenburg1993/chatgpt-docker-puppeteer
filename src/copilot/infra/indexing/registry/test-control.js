// @ts-check
/** Test-only lifecycle reset for registry internals. */
import { resetIoIndexAutoRefreshSchedulerForTest } from './refresh/test-control.js';
import { resetIoIndexRuntimeHookForTest } from './runtime/test-control.js';
import { resetIoIndexStateForTest } from './state/test-control.js';
export function resetIoIndexForTest() {
    resetIoIndexStateForTest();
    resetIoIndexAutoRefreshSchedulerForTest();
    resetIoIndexRuntimeHookForTest();
}
