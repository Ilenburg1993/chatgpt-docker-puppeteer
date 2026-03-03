// @ts-check
import { Buffer } from 'node:buffer';

/**
 * @typedef {Record<string, unknown> & { id?: string|null }} ApiRequestLike
 */

/**
 * @typedef {{
 *   json(payload: unknown): void,
 *   status(code: number): ApiResponseLike
 * }} ApiResponseLike
 */

/**
 * @typedef {Record<string, unknown> & {
 *   code?: string,
 *   error?: string,
 *   details?: unknown
 * }} FailureOptions
 */

/**
 * Sends a successful JSON envelope with the request identifier.
 * @param {ApiResponseLike} res
 * @param {ApiRequestLike} req
 * @param {unknown} data
 * @param {Record<string, unknown>} [meta={}]
 * @returns {void}
 */
function ok(res, req, data, meta = {}) {
    res.json({
        success: true,
        request_id: req.id,
        data,
        meta,
    });
}

/**
 * Sends a failed JSON envelope with a stable error shape.
 * @param {ApiResponseLike} res
 * @param {ApiRequestLike} req
 * @param {number} httpStatus
 * @param {FailureOptions} [options={}]
 * @returns {void}
 */
function fail(res, req, httpStatus, options = {}) {
    const { code, error, details } = options;
    res.status(httpStatus).json({
        success: false,
        request_id: req.id,
        error: error || 'Request failed',
        code: code || 'UNKNOWN',
        details: details ?? null,
    });
}

/**
 * Encodes a cursor object as base64 JSON.
 * @param {Record<string, unknown>|null|undefined} obj
 * @returns {string|null}
 */
function encodeCursor(obj) {
    if (!obj || typeof obj !== 'object') return null;
    try {
        const raw = JSON.stringify(obj);
        return Buffer.from(raw, 'utf8').toString('base64');
    } catch (_) {
        return null;
    }
}

/**
 * Decodes a base64 cursor payload into an object.
 * @param {unknown} cursor
 * @returns {Record<string, unknown>|null}
 */
function decodeCursor(cursor) {
    if (!cursor) return null;
    try {
        const raw = Buffer.from(String(cursor), 'base64').toString('utf8');
        const parsed = /** @type {unknown} */ (JSON.parse(raw));
        return parsed && typeof parsed === 'object' ? /** @type {Record<string, unknown>} */ (parsed) : null;
    } catch (_) {
        return null;
    }
}

/**
 * Parses a comma-separated include list into a normalized set.
 * @param {unknown} raw
 * @returns {Set<string>}
 */
function parseIncludeParam(raw) {
    const value = raw ? String(raw) : '';
    const set = new Set(
        value
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
    );
    return set;
}

export { decodeCursor, encodeCursor, fail, ok, parseIncludeParam };
