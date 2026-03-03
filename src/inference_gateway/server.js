// @ts-check

import http from 'node:http';
import { inferenceGateway } from './gateway.js';

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', chunk => {
            raw += String(chunk);
            if (raw.length > 2_000_000) {
                reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
                req.destroy();
            }
        });
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

function writeJson(res, statusCode, body) {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
}

/**
 * Cria o servidor HTTP do Inference Gateway.
 * Expõe health, metrics, reload de policies e endpoints de inferência.
 * @param {{ gateway?: typeof inferenceGateway, reloadPolicies?: (() => Promise<unknown>|unknown)|null }} [options={}]
 * @returns {http.Server}
 */
export function createInferenceGatewayServer({ gateway = inferenceGateway, reloadPolicies = null } = {}) {
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
                const body = /** @type {any} */ (await readJsonBody(req));
                const out = await gateway.generate(body);
                return writeJson(res, 200, out);
            }
            if (req.method === 'POST' && url.pathname === '/v1/validate/generate') {
                const body = /** @type {any} */ (await readJsonBody(req));
                const out =
                    typeof gateway.validateGenerate === 'function'
                        ? gateway.validateGenerate(body)
                        : { ok: false, error: 'validate_not_supported' };
                return writeJson(res, out?.ok ? 200 : 400, out);
            }
            if (req.method === 'POST' && url.pathname === '/v1/embed') {
                const body = /** @type {any} */ (await readJsonBody(req));
                const out = await gateway.embed(body);
                return writeJson(res, 200, out);
            }
            if (req.method === 'POST' && url.pathname === '/v1/models') {
                const body = /** @type {any} */ (await readJsonBody(req));
                const out = await gateway.listModels(body);
                return writeJson(res, 200, out);
            }

            return writeJson(res, 404, { ok: false, error: 'not_found' });
        } catch (error) {
            return writeJson(res, /** @type {any} */ (error).statusCode || 500, {
                ok: false,
                error: /** @type {any} */ (error).code || 'INFERENCE_GATEWAY_ERROR',
                message: error?.message || String(error),
            });
        }
    });
}
