// @ts-check
/**
 * Política pura para nomes de tools.
 *
 * @module copilot/core/tool-name-policy
 */

/** @type {RegExp} */
export const TOOL_NAME_RE = /^[a-zA-Z0-9_]+$/;

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
