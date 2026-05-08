// @ts-check

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, it } from 'vitest';

describe('channel/inject.js — diagnostics contract', () => {
    /** @type {typeof import('../../../src/copilot/channel/inject.js').injectToLlmB} */
    let injectToLlmB;
    /** @type {import('node:http').Server[]} */
    const servers = [];

    beforeAll(async () => {
        injectToLlmB = (await import('../../../src/copilot/channel/inject.js')).injectToLlmB;
    });

    afterAll(() => {
        for (const server of servers) {
            server.close();
        }
    });

    /**
     * @param {import('node:http').Server} server
     * @returns {Promise<number>}
     */
    async function listen(server) {
        servers.push(server);
        return await new Promise((resolve) => {
            server.listen(0, '127.0.0.1', () => {
                resolve(/** @type {import('node:net').AddressInfo} */ (server.address()).port);
            });
        });
    }

    it('propaga trace, prompt e diagnostics retornados pela borda /inject', async () => {
        const server = createServer((req, res) => {
            if (req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, dialogLoopActive: true, busy: false }));
                return;
            }

            if (req.url === '/inject' && req.method === 'POST') {
                req.resume();
                req.on('end', () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(
                        JSON.stringify({
                            ok: true,
                            reply: 'OK CANONICAL',
                            durationMs: 123,
                            from: 'llm-a',
                            traceId: 'inject-trace-1',
                            promptDigest: 'sha256:abc123',
                            promptFreshness: {
                                isStale: false,
                                reason: 'binding ok',
                                recommendedAction: 'none',
                            },
                            diagnostics: {
                                preflightDurationMs: 12,
                                dialogDurationMs: 111,
                                runtimeDialog: {
                                    autoStarted: false,
                                    recoveredInputChannel: true,
                                },
                            },
                        }),
                    );
                });
                return;
            }

            res.writeHead(404);
            res.end();
        });

        const port = await listen(server);
        const result = await injectToLlmB('diagnostics please', {
            port,
            retries: 0,
            timeoutMs: 0,
        });

        assert.equal(result.ok, true);
        assert.equal(result.reply, 'OK CANONICAL');
        assert.equal(result.traceId, 'inject-trace-1');
        assert.equal(result.promptDigest, 'sha256:abc123');
        assert.equal(result.timeoutMs, null);
        assert.equal(result.timeoutStrategy, 'disabled');
        assert.equal(result.transportTimeoutStrategy, 'disabled');
        assert.deepEqual(result.promptFreshness, {
            isStale: false,
            reason: 'binding ok',
            recommendedAction: 'none',
        });
        assert.deepEqual(result.diagnostics, {
            preflightDurationMs: 12,
            dialogDurationMs: 111,
            runtimeDialog: {
                autoStarted: false,
                recoveredInputChannel: true,
            },
        });
    });

    it('propaga modo steer no payload e retorna messageId sem exigir reply', async () => {
        /** @type {Record<string, unknown> | null} */
        let receivedPayload = null;
        const server = createServer((req, res) => {
            if (req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, dialogLoopActive: true, busy: false }));
                return;
            }

            if (req.url === '/inject' && req.method === 'POST') {
                let body = '';
                req.on('data', (chunk) => {
                    body += chunk.toString('utf8');
                });
                req.on('end', () => {
                    receivedPayload = /** @type {Record<string, unknown>} */ (JSON.parse(body));
                    res.writeHead(202, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, mode: 'steer', reply: null, messageId: 'msg-123' }));
                });
                return;
            }

            res.writeHead(404);
            res.end();
        });

        const port = await listen(server);
        const result = await injectToLlmB('corrija o rumo', {
            port,
            retries: 0,
            timeoutMs: 0,
            mode: 'steer',
        });

        assert.equal(result.ok, true);
        assert.equal(result.reply, '');
        assert.equal(result.mode, 'steer');
        assert.equal(result.messageId, 'msg-123');
        assert.equal(receivedPayload?.['mode'], 'steer');
        assert.equal(receivedPayload?.['message'], 'corrija o rumo');
    });
});
