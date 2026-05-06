// @ts-check
/**
 * Compat layer de permissões para hooks.
 *
 * Na arquitetura 2.0/2.1, o núcleo canônico de policy fica em `sdk/session/permissions.js`. Este módulo preserva a API
 * histórica de `#copilot/hooks` delegando 100% da lógica para o núcleo SDK.
 *
 * @module copilot/hooks/permission-handler
 */

import { approveAll, createPermissionHandler as createCanonicalPermissionHandler } from '#copilot/sdk';

/**
 * @typedef {import('./types.js').PermissionHandler} PermissionHandler
 *
 * @typedef {import('./types.js').PermissionHandlerConfig} PermissionHandlerConfig
 */

/**
 * @param {PermissionHandlerConfig} [config]
 * @returns {PermissionHandler}
 */
export function createPermissionHandler(config) {
    return /** @type {PermissionHandler} */ (createCanonicalPermissionHandler(config));
}

/**
 * @returns {PermissionHandler}
 */
export function createApproveAllPermission() {
    return /** @type {PermissionHandler} */ (approveAll);
}

/**
 * @returns {PermissionHandler}
 */
export function createAuditOnlyPermission() {
    return createPermissionHandler({ auditMode: true });
}

/**
 * @param {string[]} allowedTools
 * @returns {PermissionHandler}
 */
export function createRestrictedPermission(allowedTools) {
    return createPermissionHandler({ allowTools: allowedTools });
}

/**
 * @param {string[]} [additionalDenyTools]
 * @returns {PermissionHandler}
 */
export function createSafePermission(additionalDenyTools) {
    return createPermissionHandler({
        denyKinds: ['shell'],
        denyTools: ['run_shell_command', 'run_npm_script', 'run_node_script', ...(additionalDenyTools ?? [])],
    });
}
