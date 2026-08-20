// @ts-check
/**
 * Low-level filesystem watch primitive. High-level consumers must enter through an explicit public facade or
 * invalidation service; direct node:fs watch calls outside this root are prohibited by architecture guards.
 *
 * @module copilot/infra/io/fs/watch
 */

import { watch } from 'node:fs';

/**
 * @param {string} targetPath
 * @param {import('node:fs').WatchOptionsWithStringEncoding} options
 * @param {import('node:fs').WatchListener<string>} listener
 * @returns {import('node:fs').FSWatcher}
 */
export function watchPath(targetPath, options, listener) {
    return watch(targetPath, options, listener);
}
