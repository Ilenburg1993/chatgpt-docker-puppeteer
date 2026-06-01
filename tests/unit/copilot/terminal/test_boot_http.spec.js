// @ts-check
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- legacy fixture inference is intentionally outside the MCP strict hardening pass

import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';

import { runTerminalHttpServerPhase } from '../../../../src/copilot/terminal/terminal-phases/boot-http.js';

function makeCtx(startCopilotServer) {
    return /** @type {import('../../../../src/copilot/terminal/runtime-root.js').TerminalBootContext} */ ({
        bootConfig: {
            server: { host: '127.0.0.1', port: 3009, token: null, url: 'http://127.0.0.1:3009' },
        },
        startCopilotServer,
        copilotServer: null,
    });
}

describe('terminal/terminal-phases/boot-http', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('realoca o inject server para a próxima porta quando a porta padrão está ocupada', async () => {
        const startCopilotServer = vi.fn(async (opts) => {
            if (opts?.port === 3009) {
                const error = Object.assign(new Error('busy'), { code: 'EADDRINUSE' });
                throw error;
            }
            return /** @type {any} */ ({
                httpServer: {},
                port: opts?.port,
                host: opts?.host,
                url: `http://${opts?.host}:${opts?.port}`,
                close: async () => {},
            });
        });
        const ctx = makeCtx(startCopilotServer);

        await runTerminalHttpServerPhase(ctx);

        assert.deepEqual(
            startCopilotServer.mock.calls.map(([opts]) => opts?.port),
            [3009, 3010],
        );
        assert.equal(ctx.copilotServer?.port, 3010);
    });

    it('respeita LLM_B_TERMINAL_PORT_STRICT=true e não tenta fallback', async () => {
        vi.stubEnv('LLM_B_TERMINAL_PORT_STRICT', 'true');
        const startCopilotServer = vi.fn(async () => {
            throw Object.assign(new Error('busy'), { code: 'EADDRINUSE' });
        });
        const ctx = makeCtx(startCopilotServer);

        await assert.rejects(() => runTerminalHttpServerPhase(ctx), /busy/);
        assert.equal(startCopilotServer.mock.calls.length, 1);
    });
});
