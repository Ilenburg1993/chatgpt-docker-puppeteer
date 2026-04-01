// @ts-check
/**
 * src/copilot/lib/http-request.js
 *
 * Helper HTTP genérico para chamadas internas (loopback) usando URL completa. Centraliza o padrão de `http.request` com
 * limite de resposta e timeout.
 *
 * @module copilot/lib/http-request
 * @see module:copilot/tools/web-tools
 */

import http from 'node:http';

/**
 * Executa uma requisição HTTP simples para URLs `http://`.
 *
 * @example
 *     const { statusCode, body } = await httpRequest('GET', 'http://localhost:3009/health');
 *
 * @param {string} method - Verbo HTTP (GET, POST, PUT, DELETE…)
 * @param {string} urlStr - URL completa, ex: `http://127.0.0.1:3009/api/tasks`
 * @param {string | null} [body] - Corpo serializado (JSON string) ou null
 * @param {number} [timeoutMs] - Timeout em ms (padrão: 5000)
 * @param {number} [maxResponseBytes] - Limite de bytes na resposta (padrão: 1 MB)
 * @returns {Promise<{ statusCode: number; body: string }>}
 */
export function httpRequest(method, urlStr, body = null, timeoutMs = 5000, maxResponseBytes = 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers: /** @type {Record<string, string>} */ ({}),
        };
        if (body) {
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = String(Buffer.byteLength(body));
        }
        const req = http.request(options, (res) => {
            let data = '';
            let received = 0;
            res.on('data', (/** @type {Buffer} */ chunk) => {
                received += chunk.length;
                if (received > maxResponseBytes) {
                    req.destroy(new Error(`Resposta excede limite de ${maxResponseBytes} bytes`));
                    return;
                }
                data += chunk.toString('utf8');
            });
            res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: data }));
        });
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Timeout após ${timeoutMs}ms`));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}
