// @ts-check

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { ChannelError } from '../../../src/copilot/channel/errors.js';

/**
 * @param {number} statusCode
 * @param {string | null} body
 */
function createTimeoutContractServer(statusCode, body) {
    const server = createServer((req, res) => {
        if (req.url === '/inject' && req.method === 'POST') {
            req.resume();
            req.on('end', () => {
                res.writeHead(statusCode, body === null ? undefined : { 'Content-Type': 'application/json' });
                res.end(body ?? undefined);
            });
            return;
        }

        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, dialogLoopActive: true, busy: false }));
            return;
        }

        res.writeHead(404);
        res.end();
    });

    return server;
}

describe('channel/inject.js — timeout contract', () => {
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

    /** @param {import('node:http').Server} server */
    async function listen(server) {
        servers.push(server);
        return await new Promise((resolve) => {
            server.listen(0, '127.0.0.1', () => {
                resolve(/** @type {import('node:net').AddressInfo} */ (server.address()).port);
            });
        });
    }

    it('mapeia HTTP 408 vazio para LLM_B_TIMEOUT', async () => {
        const port = await listen(createTimeoutContractServer(408, null));

        await assert.rejects(
            () => injectToLlmB('timeout-408', { port, retries: 0, timeoutMs: 15_000 }),
            (error) => {
                assert.ok(error instanceof ChannelError);
                assert.equal(error.code, 'LLM_B_TIMEOUT');
                return true;
            },
        );
    });

    it('mapeia HTTP 504 JSON para LLM_B_TIMEOUT', async () => {
        const port = await listen(
            createTimeoutContractServer(504, JSON.stringify({ ok: false, error: 'gateway timeout' })),
        );

        await assert.rejects(
            () => injectToLlmB('timeout-504', { port, retries: 0, timeoutMs: 15_000 }),
            (error) => {
                assert.ok(error instanceof ChannelError);
                assert.equal(error.code, 'LLM_B_TIMEOUT');
                return true;
            },
        );
    });

    it('mapeia HTTP 500 vazio para LLM_B_ERROR em vez de invalid response', async () => {
        const port = await listen(createTimeoutContractServer(500, null));

        await assert.rejects(
            () => injectToLlmB('error-500', { port, retries: 0, timeoutMs: 15_000 }),
            (error) => {
                assert.ok(error instanceof ChannelError);
                assert.equal(error.code, 'LLM_B_ERROR');
                return true;
            },
        );
    });

    it('rejeita Content-Length acima do hard cap antes de materializar a resposta', async () => {
        const server = createServer((req, res) => {
            req.resume();
            req.on('end', () => {
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Content-Length': String(32 * 1024 * 1024 + 1),
                });
                res.end('{}');
            });
        });
        const port = await listen(server);

        await assert.rejects(
            () => injectToLlmB('oversized', { port, retries: 0, timeoutMs: 15_000 }),
            (error) => {
                assert.ok(error instanceof ChannelError);
                assert.equal(error.code, 'LLM_B_RESPONSE_TOO_LARGE');
                return true;
            },
        );
    });
});
