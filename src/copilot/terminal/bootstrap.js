// @ts-check
/**
 * Minimal launcher for the permanent LLM-B terminal.
 *
 * Dotenv is loaded before compile-cache configuration; the heavy terminal/runtime graph is imported only after the Node
 * 24 module compile cache is active.
 *
 * @module copilot/terminal/bootstrap
 */

import {
    enableCopilotNodeCompileCache,
    flushCopilotNodeCompileCache,
    readCopilotNodeCompileCacheConfig,
} from '#copilot/infra/public/platform/node';

await import('./bootstrap-dotenv.js');
enableCopilotNodeCompileCache(readCopilotNodeCompileCacheConfig(process.env));
await import('./bootstrap-runtime.js');
flushCopilotNodeCompileCache();
