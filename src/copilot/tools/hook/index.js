// @ts-check
/**
 * src/copilot/tools/hook/index.js
 *
 * Barrel do subdomínio `hook/`. Re-exporta a API pública de hook-tools.
 *
 * @module copilot/tools/hook
 */
export {
    cancelAllUserInputRequests,
    configureHookTools,
    getPendingInputIds,
    getPendingInputRequests,
    hasPendingUserInputRequests,
    hookGetAuditTailTool,
    hookGetPendingTasksTool,
    hookTools,
    requestUserInputTool,
    resolveUserInput,
} from './hook-tools.js';
