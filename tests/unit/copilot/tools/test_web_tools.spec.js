// @ts-check
/**
 * tests/unit/copilot/tools/test_web_tools.spec.js
 *
 * Testes unitários para src/copilot/tools/web/web-tools.js.
 *
 * Valida:
 *
 * - webTools exporta array com web_fetch_local (sempre) + web_search (quando habilitado)
 * - web_fetch_local: URL válida, URL inválida, SSRF blocked, content-type blocked, advisory timeout/rate telemetry
 * - web_search: resultados DDG JSON API, fallback HTML scraping, SSRF filter nos resultados
 * - Rate limiting compartilhado entre web_fetch e web_search
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
    validateUrl: vi.fn((/** @type {URL} */ url) => {
        const host = url.hostname;
        if (host === '127.0.0.1' || host === 'localhost' || host === '10.0.0.1' || host === '192.168.1.1') {
            return { safe: false, reason: 'private IP' };
        }
        return { safe: true, reason: '' };
    }),
    logSwallowed: vi.fn(),
    toError: vi.fn((error) => {
        if (error instanceof Error) return error;
        return new Error(String(error));
    }),
    log: vi.fn(),
    buildTool: vi.fn((opts) => ({
        name: opts.name,
        description: opts.description,
        handler: opts.handler,
        parameters: opts.parameters,
    })),
    withSkipPermission: vi.fn((tool) => tool),
}));

// Mock url-validator
vi.mock('#copilot/core', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        logSwallowed: mocks.logSwallowed,
        toError: mocks.toError,
        validateUrl: mocks.validateUrl,
    };
});

// Mock config/env
vi.mock('#copilot/config/env', () => ({
    getWebRateLimitPolicy: () => ({ perMinute: 60, enforced: false }),
    WEB_FETCH_DISABLED: false,
    WEB_SEARCH_DISABLED: false,

    COPILOT_MCP_SERVERS: '',
    COPILOT_CUSTOM_AGENTS: '',
    COPILOT_DISABLED_AGENTS: '',
    COPILOT_OPERATIONAL_PROFILE: 'production',
}));

// Mock logger
vi.mock('../../../../src/copilot/tools/infra/logger.js', () => ({
    log: mocks.log,
}));

// Mock tool-factory
vi.mock('../../../../src/copilot/tools/infra/tool-factory.js', () => ({
    buildTool: mocks.buildTool,
    withSkipPermission: mocks.withSkipPermission,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Cria um mock fetch Response.
 *
 * @param {string} body
 * @param {object} [opts]
 * @param {number} [opts.status]
 * @param {string} [opts.contentType]
 * @param {string} [opts.url]
 * @param {boolean} [opts.ok]
 */
function mockResponse(body, opts = {}) {
    const { status = 200, contentType = 'text/html', url = 'https://example.com', ok = true } = opts;
    const bytes = new TextEncoder().encode(body);
    let read = false;
    return {
        ok,
        status,
        url,
        headers: { get: (/** @type {string} */ name) => (name === 'content-type' ? contentType : null) },
        body: {
            getReader: () => ({
                read: async () => {
                    if (!read) {
                        read = true;
                        return { done: false, value: bytes };
                    }
                    return { done: true, value: undefined };
                },
                cancel: vi.fn(),
                releaseLock: vi.fn(),
            }),
        },
    };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('web-tools', () => {
    /** @type {typeof import('../../../../src/copilot/tools/web/index.js')} */
    let mod;
    /** @type {any} */
    let fetchSpy;

    beforeAll(async () => {
        mod = await import('../../../../src/copilot/tools/web/index.js');
    });

    beforeEach(() => {
        // Reset global fetch mock
        fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        mod.resetWebToolsRateLimitWindowForTests();
    });

    // ── Exports ───────────────────────────────────────────────────────────

    describe('exports', () => {
        it('webTools é um array não vazio', () => {
            expect(Array.isArray(mod.webTools)).toBe(true);
            expect(mod.webTools.length).toBeGreaterThanOrEqual(1);
        });

        it('inclui web_fetch_local', () => {
            expect(mod.webTools.some((t) => t.name === 'web_fetch_local')).toBe(true);
        });

        it('inclui web_search quando WEB_SEARCH_DISABLED=false', () => {
            expect(mod.webTools.some((t) => t.name === 'web_search')).toBe(true);
        });
    });

    // ── web_fetch_local ───────────────────────────────────────────────────

    describe('web_fetch_local', () => {
        /** @returns {any} */
        const findFetch = () => mod.webTools.find((t) => t.name === 'web_fetch_local');

        it('retorna conteúdo para URL pública válida', async () => {
            fetchSpy.mockResolvedValueOnce(mockResponse('<h1>Hello</h1>', { url: 'https://example.com' }));

            const tool = findFetch();
            const result = await tool.handler({ url: 'https://example.com' });

            expect(result.success).toBe(true);
            expect(result.content).toContain('Hello');
            expect(result.status).toBe(200);
            expect(result.contentType).toBe('text/html');
            expect(result.io?.operation).toBe('fetch');
        });

        it('sanitiza conteúdo textual em web_fetch_local', async () => {
            fetchSpy.mockResolvedValueOnce(
                mockResponse('token Bearer abcdefghijklmnopqrstuvwxyz1234567890', {
                    url: 'https://example.com/token',
                }),
            );

            const tool = findFetch();
            const result = await tool.handler({ url: 'https://example.com/token' });

            expect(result.success).toBe(true);
            expect(result.content).toContain('Bearer [redacted]');
            expect(result.content).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890');
            expect(result.sanitized).toBe(true);
            expect(result.redactions).toBeGreaterThanOrEqual(1);
        });

        it('rejeita URL inválida', async () => {
            const tool = findFetch();
            const result = await tool.handler({ url: 'not-a-url' });

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/URL inválida/i);
        });

        it('rejeita URL privada (SSRF protection)', async () => {
            const tool = findFetch();
            const result = await tool.handler({ url: 'http://127.0.0.1:8080/admin' });

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/bloqueada/i);
        });

        it('rejeita URL privada 10.x (SSRF protection)', async () => {
            const tool = findFetch();
            const result = await tool.handler({ url: 'http://10.0.0.1/internal' });

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/bloqueada/i);
        });

        it('rejeita content-type não-text', async () => {
            fetchSpy.mockResolvedValueOnce(
                mockResponse('binary', {
                    contentType: 'application/octet-stream',
                    url: 'https://example.com/file.bin',
                }),
            );

            const tool = findFetch();
            const result = await tool.handler({ url: 'https://example.com/file.bin' });

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/content-type/i);
        });

        it('retorna erro de AbortError externo sem timeout local bloqueante', async () => {
            fetchSpy.mockRejectedValueOnce(
                Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
            );

            const tool = findFetch();
            const result = await tool.handler({ url: 'https://slow.example.com', timeoutMs: 1000 });

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/abort/i);
        });

        it('retorna erro em falha de rede', async () => {
            fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

            const tool = findFetch();
            const result = await tool.handler({ url: 'https://down.example.com' });

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/ECONNREFUSED/i);
        });

        it('bloqueia redirect para IP privado', async () => {
            fetchSpy.mockResolvedValueOnce(
                mockResponse('pwned', { url: 'http://127.0.0.1/admin', contentType: 'text/html' }),
            );

            const tool = findFetch();
            const result = await tool.handler({ url: 'https://redirect.example.com' });

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/redirect bloqueado/i);
        });

        it('mantém resposta integral quando excede maxBytes informativo', async () => {
            const bigBody = 'x'.repeat(1000);
            fetchSpy.mockResolvedValueOnce(mockResponse(bigBody, { url: 'https://example.com/big' }));

            const tool = findFetch();
            const result = await tool.handler({ url: 'https://example.com/big', maxBytes: 100 });

            expect(result.success).toBe(true);
            expect(result.truncated).toBe(false);
            expect(result.content.length).toBe(1000);
            expect(result.advisoryMaxBytes).toBe(100);
        });

        it('retorna erro para resposta sem corpo', async () => {
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                status: 200,
                url: 'https://example.com',
                headers: { get: () => 'text/plain' },
                body: null,
            });

            const tool = findFetch();
            const result = await tool.handler({ url: 'https://example.com/no-body' });

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/sem corpo/i);
        });
    });

    // ── web_search ────────────────────────────────────────────────────────

    describe('web_search', () => {
        /** @returns {any} */
        const findSearch = () => mod.webTools.find((t) => t.name === 'web_search');

        it('retorna resultados da DDG JSON API', async () => {
            const ddgResponse = {
                Heading: 'Node.js',
                AbstractText: 'Node.js is a runtime',
                AbstractURL: 'https://nodejs.org',
                RelatedTopics: [
                    { FirstURL: 'https://nodejs.org/docs', Text: 'Documentation - Official docs' },
                    { FirstURL: 'https://npmjs.com', Text: 'npm - Package manager' },
                ],
            };

            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ddgResponse,
            });

            const tool = findSearch();
            const result = await tool.handler({ query: 'Node.js', maxResults: 5 });

            expect(result.success).toBe(true);
            expect(result.query).toBe('Node.js');
            expect(result.results.length).toBeGreaterThanOrEqual(1);
            expect(result.results[0].url).toBe('https://nodejs.org');
            expect(result.io?.operation).toBe('search');
        });

        it('sanitiza snippets de web_search', async () => {
            const ddgResponse = {
                RelatedTopics: [
                    {
                        FirstURL: 'https://safe.example.com',
                        Text: 'Token - Bearer abcdefghijklmnopqrstuvwxyz1234567890',
                    },
                ],
            };

            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ddgResponse,
            });

            const tool = findSearch();
            const result = await tool.handler({ query: 'token' });

            expect(result.success).toBe(true);
            expect(result.results[0].snippet).toContain('Bearer [redacted]');
            expect(result.results[0].snippet).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890');
            expect(result.sanitized).toBe(true);
            expect(result.redactions).toBeGreaterThanOrEqual(1);
        });

        it('cai para HTML scraping quando JSON API retorna 0 resultados', async () => {
            // DDG JSON API retorna vazio
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ RelatedTopics: [] }),
            });

            // DDG HTML scraping
            const html = `
                <a class="result__a" href="https://example.com/result1">Result 1</a>
                <a class="result__snippet">Snippet 1 text</a>
                <a class="result__a" href="https://example.com/result2">Result 2</a>
                <a class="result__snippet">Snippet 2 text</a>
            `;
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                text: async () => html,
            });

            const tool = findSearch();
            const result = await tool.handler({ query: 'obscure search' });

            expect(result.success).toBe(true);
            expect(result.results.length).toBe(2);
        });

        it('filtra URLs privadas dos resultados (SSRF)', async () => {
            const ddgResponse = {
                RelatedTopics: [
                    { FirstURL: 'https://safe.example.com', Text: 'Safe result' },
                    { FirstURL: 'http://127.0.0.1/admin', Text: 'Internal admin' },
                ],
            };

            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ddgResponse,
            });

            const tool = findSearch();
            const result = await tool.handler({ query: 'test' });

            expect(result.success).toBe(true);
            // Deve ter filtrado o 127.0.0.1
            expect(result.results.every((/** @type {{ url: string }} */ r) => !r.url.includes('127.0.0.1'))).toBe(true);
        });

        it('retorna erro de AbortError externo sem timeout local bloqueante', async () => {
            fetchSpy.mockRejectedValueOnce(Object.assign(new Error('Aborted'), { name: 'AbortError' }));

            const tool = findSearch();
            const result = await tool.handler({ query: 'slow query' });

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/abort/i);
        });

        it('retorna erro quando DDG HTML retorna status não-OK', async () => {
            // JSON API falha
            fetchSpy.mockRejectedValueOnce(new Error('Network error'));

            // HTML scraping retorna 429
            fetchSpy.mockResolvedValueOnce({
                ok: false,
                status: 429,
            });

            const tool = findSearch();
            const result = await tool.handler({ query: 'rate limited' });

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/429/);
        });
    });
});
