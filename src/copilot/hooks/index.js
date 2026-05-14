// @ts-check
/**
 * src/copilot/hooks/index.js — [L3] Sistema de permissão e lifecycle.
 *
 * Barrel de exportação do módulo de hooks do Copilot. Ponto de entrada único para todo o sistema de hooks. Import via
 * alias: `import { ... } from '#copilot/hooks'`.
 *
 * ### Categorias de API pública
 *
 * | Categoria        | Exports principais                                           |
 * | ---------------- | ------------------------------------------------------------ | ----------------------------------- |
 * | **Factory**      | createHooks, createMinimalHooks, createSafeHooks, etc.       |
 * | **Permission**   | createPermissionHandler, createApproveAllPermission, etc.    |
 * | **Lifecycle**    | createSessionHooks                                           |
 * | **Prompt**       | createPromptTransformer, createContextInjector, etc.         |
 * | **Interceptors** | createAllowlistHook, createBlocklistHook, createArgSanitizer |
 * | **User Input**   | createReadlineInputHandler, createQueuedInputHandler         |
 * | **Bus**          | HookBus, defaultBus, attachBus                               |
 * | **Registry**     | HookRegistry, SDK_HOOKS                                      |
 * | **Composer**     | composeHandlers, pipeline, conditional, fallback, memoize    |
 * | **Presets**      | createAuditPreset, createProductionHooks, etc.               | r, createApproveAllPermission, etc. |
 * | **Lifecycle**    | createSessionHooks                                           |
 * | **Prompt**       | createPromptTransformer, createContextInjector, etc.         |
 * | **Interceptors** | createAllowlistHook, createBlocklistHook, createArgSanitizer |
 * | **User Input**   | createReadlineInputHandler, createQueuedInputHandler         |
 * | **Bus**          | HookBus, defaultBus, attachBus                               |
 * | **Registry**     | HookRegistry, SDK_HOOKS                                      |
 * | **Composer**     | composeHandlers, pipeline, conditional, fallback, memoize    |
 * | **Presets**      | createAuditPreset, createProductionHooks, etc.               |
 *
 * @module copilot/hooks
 * @see EventBus
 */

import { approveAll, createPermissionHandler as createSdkPermissionHandler } from '#copilot/sdk/session';

// ─── Tipos (sem lógica executável) ────────────────────────────────────────────
export * from './types.js';

// ─── Factory principal de hooks (migrado de lib/hooks.js) ─────────────────────
export {
    composePreToolUseHandlers,
    createAuditHooks,
    createDenyAllHooks,
    createErrorNotifierHook,
    createHooks,
    createMinimalHooks,
    createSafeHooks,
} from './factory.js';

// ─── Permission handlers (API pública em cima do núcleo canônico do SDK) ─────
export { createAllowlistPermissionHandler, createPermissionHandler } from '#copilot/sdk/session';

/**
 * @returns {import('./types.js').PermissionHandler}
 */
export function createApproveAllPermission() {
    return /** @type {import('./types.js').PermissionHandler} */ (approveAll);
}

/**
 * @returns {import('./types.js').PermissionHandler}
 */
export function createAuditOnlyPermission() {
    return /** @type {import('./types.js').PermissionHandler} */ (createSdkPermissionHandler({ auditMode: true }));
}

/**
 * @param {string[]} allowedTools
 * @returns {import('./types.js').PermissionHandler}
 */
export function createRestrictedPermission(allowedTools) {
    return /** @type {import('./types.js').PermissionHandler} */ (createSdkPermissionHandler({ allowTools: allowedTools }));
}

/**
 * @param {string[]} [additionalDenyTools]
 * @returns {import('./types.js').PermissionHandler}
 */
export function createSafePermission(additionalDenyTools) {
    return /** @type {import('./types.js').PermissionHandler} */ (
        createSdkPermissionHandler({
            denyKinds: ['shell'],
            denyTools: ['run_shell_command', 'run_npm_script', 'run_node_script', ...(additionalDenyTools ?? [])],
        })
    );
}

// ─── Session lifecycle (migrado de agent/session-hooks.js) ────────────────────
export { createCleanupHandler, createSessionHooks } from './session-hooks.js';

// ─── Prompt transformer (Gap 1) ───────────────────────────────────────────────
export {
    createContextInjector,
    createLoggingPromptHook,
    createPromptTransformer,
    createSensitiveDataRedactor,
} from './prompt-transformer.js';

// ─── Tool interceptor (Gap 2 + Gap 3) ────────────────────────────────────────
export {
    createAllowlistHook,
    createArgSanitizerHook,
    createBlocklistHook,
    createPostToolEnricher,
    createRuntimeDisableHook,
    createTimingEnricherHook,
} from './tool-interceptor.js';

// ─── User input handler (Gap 5) ───────────────────────────────────────────────
export { createQueuedElicitationHandler } from './elicitation.js';
export { createQueuedInputHandler, createReadlineInputHandler, createStaticInputHandler } from './user-input.js';

// ─── HookBus (Gap 6) ──────────────────────────────────────────────────────────
export { HookBus, attachBus, defaultBus } from './bus.js';

// ─── HookRegistry ─────────────────────────────────────────────────────────────
export { HookRegistry, SDK_HOOKS } from './registry.js';

// ─── Composer (composição de handlers) ───────────────────────────────────────
export {
    composeHandlers,
    conditional,
    fallback,
    forTools,
    loggingMiddleware,
    memoize,
    middleware,
    pipeline,
    raceWithTimeout,
} from './composer.js';

// ─── Presets standalone (Gap 7) ───────────────────────────────────────────────
// ARCH-OBS-003 fix: audit preset agora reside em hooks/presets/ (antes: observability/)
export { createHooksAuditPreset as createAuditPreset } from './presets/audit.js';
export { createDenyAllPreset } from './presets/deny-all.js';
export { createInteractivePreset } from './presets/interactive.js';
export { createMinimalPreset } from './presets/minimal.js';
export { createProductionHooks } from './presets/production.js';
export {
    buildAlwaysAliveConfig,
    buildDiagnosticConfig,
    buildFullAccessConfig,
    buildReadOnlyConfig,
} from './presets/profiles.js';
export { createSafePreset } from './presets/safe.js';

// ─── Error handler com circuit-breaker (Fase I) ───────────────────────────────
export { createCircuitBreakerHandler, createContextualErrorHandler, createErrorHandler } from './error-handler.js';

// ─── Audit ring buffer (Gap 10) ───────────────────────────────────────────────
export { AuditRingBuffer, createAuditPostToolHandler, getAuditTail, globalAuditBuffer } from '#copilot/audit';

// ─── Logger injection (Faixa 3.1 — desacopla hooks/ de observability/) ────────
export { clearHooksLogger, setHooksLogger } from './logger.js';

// ─── DI Tokens ───────────────────────────────────────────────────────────────
export { HOOKS_LOGGER } from './di-tokens.js';

// ─── Tool Filter (Faixa E — filtering estático → SDK nativo) ─────────────────
export { extractStaticFilters, isDynamicOnly, mergeStaticFilters } from './tool-filter.js';

// ─── Audit Trail (E3.1 — decisões estruturadas de hooks) ─────────────────────
export { AuditTrail, globalAuditTrail, withErrorAudit, withPostToolAudit, withPreToolAudit } from './audit-trail.js';
