// @ts-check
/**
 * src/copilot/lib/permissions.js
 *
 * @module copilot/lib/permissions
 * @deprecated Use `#copilot/hooks/permission` (src/copilot/hooks/permission-handler.js) diretamente. Re-export de
 *   compatibilidade — mantido para não quebrar importações via `lib/index.js`.
 * @see DOCUMENTAÇÃO/ARQUITETURA/HOOKS-SYSTEM-ANALYSIS-ROADMAP.md Fase N.4
 */

export {
    createApproveAllPermission,
    createAuditOnlyPermission,
    createPermissionHandler,
    createRestrictedPermission,
    createSafePermission,
} from '#copilot/hooks/permission';
