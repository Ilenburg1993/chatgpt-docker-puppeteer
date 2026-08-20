// @ts-check
/**
 * src/copilot/lib/http-request.js
 *
 * Helper HTTP(S) genérico para chamadas internas usando URL completa. Centraliza timeout, limite de resposta e
 * validação explícita de protocolo.
 *
 * @module copilot/lib/http-request
 * @see EventBus
 * @see module:copilot/tools/web-tools
 */

import { utf8ByteLength } from '#copilot/infra/public/buffer';
import { createBoundedProcessOutputCapture } from '#copilot/infra/public/process-output';
import http from 'node:http';
import https from 'node:https';

/**
 * Executa uma requisição HTTP(S) simples para URLs `http://` e `https://`.
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
        let url;
        try {
            url = new URL(urlStr);
        } catch {
            reject(new TypeError(`[http-request] URL inválida: ${urlStr}`));
            return;
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            reject(new TypeError(`[http-request] protocolo não suportado: ${url.protocol}`));
            return;
        }
        const transport = url.protocol === 'https:' ? https : http;
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers: /** @type {Record<string, string>} */ ({}),
        };
        if (body) {
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = String(utf8ByteLength(body, 'http request body'));
        }
        const req = transport.request(options, (res) => {
            const capture = createBoundedProcessOutputCapture({ maxBytes: maxResponseBytes });
            const effectiveMaxBytes = capture.snapshot().maxBytes;
            const contentLength = Number(res.headers['content-length'] ?? 0);
            if (Number.isFinite(contentLength) && contentLength > effectiveMaxBytes) {
                req.destroy(new Error(`Resposta excede limite de ${effectiveMaxBytes} bytes`));
                return;
            }
            res.on('data', (/** @type {Buffer} */ chunk) => {
                if (capture.append(chunk).truncated) {
                    req.destroy(new Error(`Resposta excede limite de ${effectiveMaxBytes} bytes`));
                    return;
                }
            });
            res.on('end', () => {
                try {
                    resolve({
                        statusCode: res.statusCode ?? 0,
                        body: capture.toString({ fatal: true, label: 'HTTP response' }),
                    });
                } catch (error) {
                    reject(error instanceof Error ? error : new Error(String(error)));
                }
            });
        });
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Timeout após ${timeoutMs}ms`));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}
