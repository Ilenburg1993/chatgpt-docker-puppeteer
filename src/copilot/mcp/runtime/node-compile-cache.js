// @ts-check
/**
 * Compatibility facade for the shared Node 24 compile-cache runtime foundation.
 *
 * @module copilot/mcp/runtime/node-compile-cache
 */

export {
    enableCopilotNodeCompileCache,
    flushCopilotNodeCompileCache,
    getCopilotNodeCompileCacheHealth,
    withCopilotNodeCompileCacheEnv,
} from '#copilot/infra/public/platform/node';
