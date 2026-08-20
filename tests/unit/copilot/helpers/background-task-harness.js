// @ts-check
/**
 * Deterministic harness for Agent background-task ports.
 * Mirrors the production contract while exposing tracked promises to tests without relying on untyped arrays.
 */

/**
 * @typedef {{ label?: string; description?: string }} BackgroundTaskMeta
 * @typedef {{ task: Promise<unknown>; meta: BackgroundTaskMeta | undefined }} TrackedBackgroundTask
 */

/**
 * @param {{ awaitInsideTracker?: boolean }} [options]
 */
export function createBackgroundTaskHarness(options = {}) {
    const awaitInsideTracker = options.awaitInsideTracker !== false;
    /** @type {TrackedBackgroundTask[]} */
    const tracked = [];
    return {
        tracked,
        /**
         * @param {Promise<unknown>} task
         * @param {BackgroundTaskMeta} [meta]
         * @returns {Promise<void>}
         */
        async trackBackgroundTask(task, meta) {
            tracked.push({ task, meta });
            if (awaitInsideTracker) await task;
        },
        /** @param {number} [index] @returns {TrackedBackgroundTask} */
        get(index = 0) {
            const entry = tracked[index];
            if (!entry) throw new Error(`Expected tracked background task at index ${index}`);
            return entry;
        },
        /** @returns {Promise<void>} */
        async awaitAll() {
            await Promise.all(tracked.map((entry) => entry.task));
        },
        /** @returns {Promise<void>} */
        async drain() {
            const entries = tracked.splice(0);
            await Promise.all(entries.map((entry) => entry.task));
        },
    };
}
