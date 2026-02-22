// @ts-check
import { Buffer } from 'node:buffer';

/** Função exportada: ok. */
function ok(res, req, data, meta = {}) {
    res.json({
        success: true,
        request_id: req.id,
        data,
        meta,
    });
}

/** Função exportada: fail. */
function fail(res, req, httpStatus, options = {}) {
    const { code, error, details } = /** @type {{code?: string, error?: string, details?: any}} */ (options);
    res.status(httpStatus).json({
        success: false,
        request_id: req.id,
        error: error || 'Request failed',
        code: code || 'UNKNOWN',
        details: details ?? null,
    });
}

/** Função exportada: encodeCursor. */
function encodeCursor(obj) {
    if (!obj || typeof obj !== 'object') return null;
    try {
        const raw = JSON.stringify(obj);
        return Buffer.from(raw, 'utf8').toString('base64');
    } catch (_) {
        return null;
    }
}

/** Função exportada: decodeCursor. */
function decodeCursor(cursor) {
    if (!cursor) return null;
    try {
        const raw = Buffer.from(String(cursor), 'base64').toString('utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
        return null;
    }
}

/** Função exportada: parseIncludeParam. */
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
