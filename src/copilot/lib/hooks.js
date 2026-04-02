// @ts-check
/**
 * src/copilot/lib/hooks.js
 *
 * @module copilot/lib/hooks
 * @deprecated Use `#copilot/hooks/factory` (src/copilot/hooks/factory.js) diretamente. Re-export de compatibilidade —
 *   mantido para não quebrar importações via `lib/index.js`.
 * @see DOCUMENTAÇÃO/ARQUITETURA/HOOKS-SYSTEM-ANALYSIS-ROADMAP.md Fase N.3
 */

export {
    composePreToolUseHandlers,
    createAuditHooks,
    createDenyAllHooks,
    createErrorNotifierHook,
    createHooks,
    createMinimalHooks,
    createSafeHooks,
} from '#copilot/hooks/factory';
