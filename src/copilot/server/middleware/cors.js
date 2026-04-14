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
 * @property {string | string[]} [origin] - Origem(ns) permitidas. Default: '*' (loopback seguro)
 * @property {string} [methods] - Métodos HTTP permitidos
 * @property {string} [allowedHeaders] - Headers permitidos
 * @property {number} [maxAge] - Max-Age em segundos para preflight cache
 */

const DEFAULT_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const DEFAULT_HEADERS = 'Authorization, Content-Type, X-Request-ID';
const DEFAULT_MAX_AGE = 86400;

/**
 * Cria middleware CORS para preflight OPTIONS e respostas normais.
 *
 * @param {CorsOptions} [opts]
 * @returns {import('express').RequestHandler}
 */
export function createCorsMiddleware(opts) {
    const origin = opts?.origin ?? '*';
    const methods = opts?.methods ?? DEFAULT_METHODS;
    const allowedHeaders = opts?.allowedHeaders ?? DEFAULT_HEADERS;
    const maxAge = opts?.maxAge ?? DEFAULT_MAX_AGE;

    const originHeader = Array.isArray(origin) ? origin.join(', ') : origin;

    return function corsMiddleware(req, res, next) {
        res.setHeader('Access-Control-Allow-Origin', originHeader);
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
