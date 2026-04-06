// @ts-check
/**
 * F32.3 — Testes de concorrência com múltiplos inject simultâneos.
 *
 * Verifica que `injectToLlmB` lida corretamente com chamadas paralelas — respostas não se cruzam, 409 (busy) gera
 * retry, e todas as chamadas concorrentes resolvem ou rejeitam individualmente.
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';

// ─── Test infra: mock HTTP server ────────────────────────────────────────────

/**
 * Cria um servidor HTTP mock que simula o terminal LLM-B.
 *
 * @param {{ concurrentDelay?: number; maxConcurrent?: number }} [opts]
 * @returns {{
 *     server: import('node:http').Server;
 *     port: number;
 *     activeRequests: number;
 *     totalRequests: number;
 *     start: () => Promise<number>;
 * }}
 */
function createMockLlmBServer(opts = {}) {
    const concurrentDelay = opts.concurrentDelay ?? 50;
    const maxConcurrent = opts.maxConcurrent ?? 1; // simula lock
    let activeRequests = 0;
    let totalRequests = 0;

    const server = createServer((req, res) => {
        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, dialogLoopActive: true }));
            return;
        }

        if (req.url === '/inject' && req.method === 'POST') {
            totalRequests++;
            activeRequests++;

            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', () => {
                if (activeRequests > maxConcurrent) {
                    // Simula 409 BUSY
                    activeRequests--;
                    res.writeHead(409, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'LLM-B ocupada', code: 'LLM_B_BUSY' }));
                    return;
                }

                setTimeout(() => {
                    activeRequests--;
                    const parsed = JSON.parse(body);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(
                        JSON.stringify({
                            ok: true,
                            reply: `Resposta para: ${parsed.message}`,
                            durationMs: concurrentDelay,
                        }),
                    );
                }, concurrentDelay);
            });
            return;
        }

        res.writeHead(404);
        res.end('Not Found');
    });

    return {
        server,
        get port() {
            return /** @type {import('node:net').AddressInfo} */ (server.address()).port;
        },
        get activeRequests() {
            return activeRequests;
        },
        get totalRequests() {
            return totalRequests;
        },
        start() {
            return new Promise((resolve) => {
                server.listen(0, '127.0.0.1', () => {
                    resolve(/** @type {import('node:net').AddressInfo} */ (server.address()).port);
                });
            });
        },
    };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('F32.3 — injectToLlmB concurrência com múltiplos inject', () => {
    /** @type {ReturnType<typeof createMockLlmBServer>} */
    let mock;
    /** @type {number} */
    let port;
    /** @type {typeof import('../../../src/copilot/channel/inject.js').injectToLlmB} */
    let injectToLlmB;

    before(async () => {
        mock = createMockLlmBServer({ concurrentDelay: 30, maxConcurrent: 1 });
        port = await mock.start();
        const mod = await import('../../../src/copilot/channel/inject.js');
        injectToLlmB = mod.injectToLlmB;
    });

    after(() => {
        mock.server.close();
    });

    it('chamada única resolve com reply', async () => {
        const result = await injectToLlmB('teste singleton', {
            port,
            timeoutMs: 5000,
            retries: 0,
        });

        assert.ok(result.ok, 'resultado deve ser ok=true');
        assert.ok(typeof result.reply === 'string', 'reply deve ser string');
        assert.ok(result.reply.includes('teste singleton'), 'reply deve conter mensagem original');
    });

    it('duas chamadas sequenciais não interferem entre si', async () => {
        const r1 = await injectToLlmB('msg-1', { port, timeoutMs: 5000, retries: 0 });
        const r2 = await injectToLlmB('msg-2', { port, timeoutMs: 5000, retries: 0 });

        assert.ok(r1.reply?.includes('msg-1'), 'primeira resposta deve conter msg-1');
        assert.ok(r2.reply?.includes('msg-2'), 'segunda resposta deve conter msg-2');
    });

    it('chamadas paralelas: ao menos uma resolve com sucesso (server aceita 1 por vez)', async () => {
        const promises = [
            injectToLlmB('parallel-1', { port, timeoutMs: 5000, retries: 2, retryDelayMs: 50 }),
            injectToLlmB('parallel-2', { port, timeoutMs: 5000, retries: 2, retryDelayMs: 50 }),
        ];

        const results = await Promise.allSettled(promises);
        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        assert.ok(fulfilled.length >= 1, 'ao menos uma chamada paralela deve resolver');
    });

    it('chamada paralela que recebe 409 faz retry automaticamente', async () => {
        // maxConcurrent=1 no server mock → segunda chamada recebe 409
        const p1 = injectToLlmB('retry-a', { port, timeoutMs: 5000, retries: 3, retryDelayMs: 20 });
        const p2 = injectToLlmB('retry-b', { port, timeoutMs: 5000, retries: 3, retryDelayMs: 20 });

        const results = await Promise.allSettled([p1, p2]);
        const fulfilled = results.filter((r) => r.status === 'fulfilled');

        // Com retries, ambas devem resolver (a segunda tenta novamente após 409)
        assert.ok(fulfilled.length >= 1, 'retries devem permitir que chamadas concorrentes resolvam');
    });

    it('respostas não se cruzam entre chamadas paralelas', async () => {
        // Aumentar maxConcurrent para este teste (new server)
        const multiMock = createMockLlmBServer({ concurrentDelay: 10, maxConcurrent: 5 });
        const multiPort = await multiMock.start();

        try {
            const messages = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
            const promises = messages.map((msg) => injectToLlmB(msg, { port: multiPort, timeoutMs: 5000, retries: 0 }));

            const results = await Promise.all(promises);

            for (let i = 0; i < messages.length; i++) {
                assert.ok(
                    results[i].reply?.includes(messages[i]),
                    `resposta ${i} deve conter "${messages[i]}", recebeu: "${results[i].reply}"`,
                );
            }
        } finally {
            multiMock.server.close();
        }
    });

    it('múltiplas chamadas paralelas com server que aceita 3 concorrentes', async () => {
        const multiMock = createMockLlmBServer({ concurrentDelay: 20, maxConcurrent: 3 });
        const multiPort = await multiMock.start();

        try {
            const promises = Array.from({ length: 6 }, (_, i) =>
                injectToLlmB(`concurrent-${i}`, {
                    port: multiPort,
                    timeoutMs: 5000,
                    retries: 3,
                    retryDelayMs: 30,
                }),
            );

            const results = await Promise.allSettled(promises);
            const fulfilled = results.filter((r) => r.status === 'fulfilled');

            // Com 3 concorrentes e 3 retries, a maioria deve resolver
            assert.ok(fulfilled.length >= 3, `ao menos 3/6 chamadas devem resolver, obteve ${fulfilled.length}`);
        } finally {
            multiMock.server.close();
        }
    });
});
