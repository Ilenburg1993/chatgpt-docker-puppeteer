// @ts-check
/**
 * src/copilot/hooks/index.js
 *
 * Barrel de exportação do módulo de hooks do Copilot.
 *
 * Ponto de entrada único para todo o sistema de hooks isolado sob src/copilot/hooks/. Importar via alias: `import { ...
 * } from '#copilot/hooks'`.
 *
 * Por quê um barrel centralizado?
 *
 * - Encapsulamento: consumidores importam de um path estável
 * - Introspection: todas as exports em um lugar
 * - Facilita substituições mockadas em testes
 *
 * @module copilot/hooks
 */

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

// ─── Permission handlers (migrado de lib/permissions.js) ──────────────────────
export {
    createApproveAllPermission,
    createAuditOnlyPermission,
    createPermissionHandler,
    createRestrictedPermission,
    createSafePermission,
} from './permission-handler.js';

// ─── Session lifecycle (migrado de agent/session-hooks.js) ────────────────────
export { createSessionHooks } from './session-lifecycle.js';

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
    createTimingEnricherHook,
} from './tool-interceptor.js';

// ─── User input handler (Gap 5) ───────────────────────────────────────────────
export { createQueuedInputHandler, createReadlineInputHandler, createStaticInputHandler } from './user-input.js';

// ─── HookBus (Gap 6) ──────────────────────────────────────────────────────────
export { HookBus, attachBus, defaultBus } from './bus.js';

// ─── HookRegistry ─────────────────────────────────────────────────────────────
export { HookRegistry, SDK_HOOKS } from './registry.js';

// ─── Composer (composição de handlers) ───────────────────────────────────────
export { composeHandlers, conditional, fallback, memoize, pipeline, raceWithTimeout } from './composer.js';

// ─── Presets standalone (Gap 7) ───────────────────────────────────────────────
export { createAuditPreset } from './presets/audit.js';
export { createDenyAllPreset } from './presets/deny-all.js';
export { createInteractivePreset } from './presets/interactive.js';
export { createMinimalPreset } from './presets/minimal.js';
export { createProductionHooks } from './presets/production.js';
export { createSafePreset } from './presets/safe.js';

// ─── Error handler com circuit-breaker (Fase I) ───────────────────────────────
export { createCircuitBreakerHandler, createContextualErrorHandler, createErrorHandler } from './error-handler.js';

// ─── Audit ring buffer (Gap 10) ───────────────────────────────────────────────
export { AuditRingBuffer, createAuditPostToolHandler, getAuditTail, globalAuditBuffer } from './audit.js';
