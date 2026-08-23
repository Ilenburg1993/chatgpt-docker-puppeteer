// @ts-check
/**
 * Utilitários canônicos de runtime para sistema de permissões.
 *
 * @module copilot/sdk/session/permission-runtime
 */

export { TOOL_NAME_RE, sanitizeToolNames } from '#copilot/sdk/tools';

/** @type {ReadonlyArray<'approve_all' | 'audit_only' | 'selective'>} */
export const PERMISSION_MODES = Object.freeze(['approve_all', 'audit_only', 'selective']);

/** @type {'approve_all'} */
export const DEFAULT_PERMISSION_MODE = 'approve_all';

/**
 * @param {unknown} mode
 * @returns {'approve_all' | 'audit_only' | 'selective'}
 */
export function normalizePermissionMode(mode) {
    if (mode === 'approve_all' || mode === 'audit_only' || mode === 'selective') {
        return mode;
    }
    return DEFAULT_PERMISSION_MODE;
}

/**
 * @param {unknown} request
 * @returns {string}
 */
export function extractPermissionToolName(request) {
    const rec = /** @type {{ toolName?: string; tool?: string; name?: string }} */ (request ?? {});
    return rec.toolName ?? rec.tool ?? rec.name ?? 'unknown';
}
