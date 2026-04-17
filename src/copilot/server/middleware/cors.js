// @ts-check
/**
 * @module copilot/server/middleware/cors
 * @file Middleware CORS para o servidor copilot.
 *
 *   O servidor faz bind em 127.0.0.1 (loopback only), portanto CORS wildcard é seguro — apenas código local pode alcançar
 *   esta porta. Onda 3.0 — L54.4.
 *
 *   src/copilot/server/middleware/cors.js
 */

/**
 * Opções do middleware CORS.
 *
 * @typedef {object} CorsOptions
 * @property {string | string[]} [origin] - Origem(ns) permitidas. Use '*' para wildcard irrestrito ou array de origens
 *   explícitas.
 * @property {string} [methods] - Métodos HTTP permitidos
 * @property {string} [allowedHeaders] - Headers permitidos
 * @property {number} [maxAge] - Max-Age em segundos para preflight cache
 */

const DEFAULT_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const DEFAULT_HEADERS = 'Authorization, Content-Type, X-Request-ID';
const DEFAULT_MAX_AGE = 86400;

/** Regex que aceita qualquer porta em localhost (http ou https) */
const LOCALHOST_RE = /^https?:\/\/localhost(:\d+)?$/;

/**
 * Cria middleware CORS para preflight OPTIONS e respostas normais.
 *
 * Quando `origin` for `'*'`, envia `Access-Control-Allow-Origin: *`. Quando for um array, faz reflection da origem da
 * request se ela estiver na lista, emitindo exatamente 1 valor no header (browsers rejeitam múltiplos valores).
 *
 * @param {CorsOptions} [opts]
 * @returns {import('express').RequestHandler}
 */
export function createCorsMiddleware(opts) {
    const originConfig = opts?.origin ?? '*';
    const methods = opts?.methods ?? DEFAULT_METHODS;
    const allowedHeaders = opts?.allowedHeaders ?? DEFAULT_HEADERS;
    const maxAge = opts?.maxAge ?? DEFAULT_MAX_AGE;

    /** @type {string[]} */
    const explicitList = originConfig === '*' ? [] : Array.isArray(originConfig) ? originConfig : [originConfig];
    const isWildcard = originConfig === '*';

    return function corsMiddleware(req, res, next) {
        const requestOrigin = req.headers.origin;

        if (isWildcard) {
            res.setHeader('Access-Control-Allow-Origin', '*');
        } else if (requestOrigin) {
            // Permite localhost em qualquer porta (loopback seguro) ou origens explícitas
            const allowed = LOCALHOST_RE.test(requestOrigin) || explicitList.includes(requestOrigin);

            if (allowed) {
                res.setHeader('Access-Control-Allow-Origin', requestOrigin);
                res.setHeader('Vary', 'Origin');
            }
        }

        res.setHeader('Access-Control-Allow-Methods', methods);
        res.setHeader('Access-Control-Allow-Headers', allowedHeaders);

        // T-04/T-16: responder preflight CORS OPTIONS antes de qualquer auth/route check
        if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Max-Age', String(maxAge));
            res.status(204).end();
            return;
        }

        next();
    };
}
