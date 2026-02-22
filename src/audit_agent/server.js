// @ts-check

import http from 'node:http';

function writeJson(res, statusCode, body) {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', chunk => {
            raw += String(chunk);
            if (raw.length > 1_000_000) {
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

/**
 * @param {{ runtime: import('./runtime.js').AuditAgentRuntime }} deps
 */
export function createAuditAgentServer({ runtime }) {
    return http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url || '/', 'http://localhost');
            if (req.method === 'GET' && url.pathname === '/health') {
                return writeJson(res, 200, { ok: true, service: 'audit-agent', metrics: runtime.getMetrics() });
            }
            if (req.method === 'GET' && url.pathname === '/metrics') {
                return writeJson(res, 200, { ok: true, metrics: runtime.getMetrics() });
            }
            if (req.method === 'GET' && url.pathname === '/jobs') {
                const status = url.searchParams.get('status');
                const limit = Number(url.searchParams.get('limit') || 100);
                return writeJson(res, 200, { ok: true, items: runtime.listJobs({ status, limit }) });
            }
            if (req.method === 'GET' && url.pathname.match(/^\/jobs\/[^/]+$/)) {
                const id = decodeURIComponent(url.pathname.split('/')[2]);
                const job = runtime.getJob(id);
                if (!job) {
                    return writeJson(res, 404, { ok: false, error: 'not_found', code: 'AUDIT_JOB_NOT_FOUND' });
                }
                return writeJson(res, 200, { ok: true, job });
            }
            if (req.method === 'POST' && url.pathname === '/jobs') {
                const body = /** @type {any} */ (await readJsonBody(req));
                const job = runtime.createJob(body);
                return writeJson(res, 201, { ok: true, job });
            }
            if (req.method === 'POST' && url.pathname.match(/^\/jobs\/[^/]+\/run$/)) {
                const id = decodeURIComponent(url.pathname.split('/')[2]);
                const job = runtime.queueJob(id);
                await runtime.tick();
                return writeJson(res, 200, { ok: true, job: runtime.getJob(job.id) });
            }
            if (req.method === 'POST' && url.pathname.match(/^\/jobs\/[^/]+\/cancel$/)) {
                const id = decodeURIComponent(url.pathname.split('/')[2]);
                const body = /** @type {any} */ (await readJsonBody(req));
                const job = runtime.cancelJob(id, body.reason || 'manual_cancel');
                return writeJson(res, 200, { ok: true, job });
            }
            return writeJson(res, 404, { ok: false, error: 'not_found' });
        } catch (error) {
            return writeJson(res, /** @type {any} */ (error).statusCode || 500, {
                ok: false,
                error: /** @type {any} */ (error).code || 'AUDIT_AGENT_SERVER_ERROR',
                message: error?.message || String(error),
            });
        }
    });
}
