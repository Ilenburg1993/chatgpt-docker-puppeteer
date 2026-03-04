// @ts-check

import http from 'node:http';
import { inferenceGateway } from './gateway.js';

/**
 * @typedef {object} InferenceGatewayServerOptions
 * @property {typeof inferenceGateway} [gateway]
 * @property {(() => Promise<unknown>|unknown)|null} [reloadPolicies]
 */
/** @typedef {Error & { statusCode?: number, code?: string }} InferenceGatewayServerError */

/** @param {any} req */
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on(
            'data',
            /** @param {any} chunk */ chunk => {
                raw += String(chunk);
                if (raw.length > 2_000_000) {
                    reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
                    req.destroy();
                }
            }
        );
        req.on('end', () => {
            if (!raw.trim()) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch (error) {
                reject(Object.assign(new Error('invalid json body'), { statusCode: 400, cause: error }));
            }
        });
        req.on('error', reject);
    });
}

/**
 * @param {any} res
 * @param {any} statusCode
 * @param {any} body
 */
function writeJson(res, statusCode, body) {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
}

/**
 * Cria o servidor HTTP do Inference Gateway.
 * Expõe health, metrics, reload de policies e endpoints de inferência.
 * @param {InferenceGatewayServerOptions} [options={}]
 * @returns {http.Server}
 */
export function createInferenceGatewayServer(options = {}) {
    const { gateway = inferenceGateway, reloadPolicies = null } = options;
    return http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url || '/', 'http://localhost');

            if (req.method === 'GET' && url.pathname === '/health') {
                return writeJson(res, 200, { ok: true, service: 'inference-gateway' });
            }
            if (req.method === 'GET' && url.pathname === '/metrics') {
                return writeJson(res, 200, { ok: true, metrics: gateway.getMetrics() });
            }
            if (req.method === 'GET' && url.pathname === '/v1/policies') {
                return writeJson(res, 200, {
                    ok: true,
                    summary: typeof gateway.getPolicySummary === 'function' ? gateway.getPolicySummary() : null,
                });
            }
            if (req.method === 'POST' && url.pathname === '/v1/policies/reload') {
                if (typeof reloadPolicies !== 'function') {
                    return writeJson(res, 501, { ok: false, error: 'reload_not_supported' });
                }
                const out = await reloadPolicies();
                return writeJson(res, 200, { ok: true, reloaded: out || null });
            }
            if (req.method === 'POST' && url.pathname === '/v1/generate') {
                const body = /** @type {Parameters<typeof gateway.generate>[0]} */ (await readJsonBody(req));
                const out = await gateway.generate(body);
                return writeJson(res, 200, out);
            }
            if (req.method === 'POST' && url.pathname === '/v1/validate/generate') {
                const body = /** @type {Parameters<NonNullable<typeof gateway.validateGenerate>>[0]} */ (
                    await readJsonBody(req)
                );
                const out =
                    typeof gateway.validateGenerate === 'function'
                        ? gateway.validateGenerate(body)
                        : { ok: false, error: 'validate_not_supported' };
                return writeJson(res, out?.ok ? 200 : 400, out);
            }
            if (req.method === 'POST' && url.pathname === '/v1/embed') {
                const body = /** @type {Parameters<typeof gateway.embed>[0]} */ (await readJsonBody(req));
                const out = await gateway.embed(body);
                return writeJson(res, 200, out);
            }
            if (req.method === 'POST' && url.pathname === '/v1/models') {
                const body = /** @type {Parameters<typeof gateway.listModels>[0]} */ (await readJsonBody(req));
                const out = await gateway.listModels(body);
                return writeJson(res, 200, out);
            }

            return writeJson(res, 404, { ok: false, error: 'not_found' });
        } catch (error) {
            const typedError = /** @type {InferenceGatewayServerError} */ (error);
            return writeJson(res, typedError.statusCode || 500, {
                ok: false,
                error: typedError.code || 'INFERENCE_GATEWAY_ERROR',
                message: /** @type {any} */ (error)?.message || String(error),
            });
        }
    });
}
