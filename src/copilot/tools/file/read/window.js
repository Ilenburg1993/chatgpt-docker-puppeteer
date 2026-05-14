// @ts-check
/**
 * Normalização de janela/cursor para `read_file_content`.
 *
 * @module copilot/tools/file/read/window
 */

/**
 * @param {unknown} value
 * @param {number | undefined} fallback
 * @returns {number | undefined}
 */
export function normalizePositiveInteger(value, fallback = undefined) {
    if (value === undefined || value === null) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function normalizeNonNegativeInteger(value, fallback = 0) {
    if (value === undefined || value === null) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

/**
 * @param {unknown} cursor
 * @param {{ min: number; label: string }} options
 * @returns {{ ok: true; value: number | null } | { ok: false; reason: string }}
 */
export function parseReadCursor(cursor, options) {
    if (cursor === undefined || cursor === null || cursor === '') return { ok: true, value: null };
    if (typeof cursor !== 'string' && typeof cursor !== 'number') {
        return { ok: false, reason: `${options.label} inválido: cursor deve ser string numérica.` };
    }
    const parsed = Number(String(cursor).trim());
    if (!Number.isInteger(parsed) || parsed < options.min) {
        return { ok: false, reason: `${options.label} inválido: cursor deve ser inteiro >= ${options.min}.` };
    }
    return { ok: true, value: parsed };
}

/**
 * @param {{ start: number; end: number }} returnedLines
 * @param {number | null | undefined} totalLines
 * @param {boolean} totalLinesKnown
 * @returns {string | null}
 */
export function nextLineCursor(returnedLines, totalLines, totalLinesKnown) {
    if (returnedLines.end < returnedLines.start) return null;
    if (totalLinesKnown && Number.isFinite(totalLines) && returnedLines.end >= Number(totalLines)) return null;
    return String(returnedLines.end + 1);
}
