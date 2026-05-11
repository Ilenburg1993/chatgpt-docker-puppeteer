// @ts-check
/**
 * Utilitários canônicos de runtime para sistema de permissões.
 *
 * @module copilot/sdk/session/permission-runtime
 */

/** @type {RegExp} */
export const TOOL_NAME_RE = /^[a-zA-Z0-9_]+$/;

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
 * @param {string[] | undefined} names
 * @returns {string[]}
 */
export function sanitizeToolNames(names) {
    if (!Array.isArray(names)) return [];
    const unique = new Set();
    for (const raw of names) {
        if (typeof raw !== 'string') continue;
        const normalized = raw.trim();
        if (!normalized || !TOOL_NAME_RE.test(normalized)) continue;
        unique.add(normalized);
    }
    return [...unique];
}

/**
 * @param {unknown} request
 * @returns {string}
 */
export function extractPermissionToolName(request) {
    const rec = /** @type {{ toolName?: string; tool?: string; name?: string }} */ (request ?? {});
    return rec.toolName ?? rec.tool ?? rec.name ?? 'unknown';
}
