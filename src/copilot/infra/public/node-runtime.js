// @ts-check
/**
 * Minimal public facade for process-level Node runtime optimizations.
 *
 * Kept separate from public/runtime.js so early bootstraps do not pull mutation/rollback infrastructure before the
 * module compile cache is enabled.
 *
 * @module copilot/infra/public/node-runtime
 */

export {
    enableCopilotNodeCompileCache,
    flushCopilotNodeCompileCache,
    getCopilotNodeCompileCacheHealth,
    resetCopilotNodeCompileCacheHealthForTest,
    withCopilotNodeCompileCacheEnv,
} from '../runtime/node-compile-cache.js';
