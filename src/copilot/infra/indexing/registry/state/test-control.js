// @ts-check
/** Private registry-state reset composition. */
import { inflightIndexBuilds } from './builds.js';
import { resetIoIndexInstanceForTest } from './instance.js';
export function resetIoIndexStateForTest() {
    resetIoIndexInstanceForTest();
    inflightIndexBuilds.clear();
}
