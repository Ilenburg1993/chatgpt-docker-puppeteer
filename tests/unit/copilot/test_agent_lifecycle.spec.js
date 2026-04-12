// @ts-check
/**
 * tests/unit/copilot/test_agent_lifecycle.spec.js
 *
 * F41.2: Testes unitários para agent-lifecycle.js (F36).
 *
 * agentStart/agentStop/initSession dependem fortemente do SDK real (CopilotClient), então os testes focam em contratos
 * estruturais (exports, guards) e source-scanning para verificar padrões de implementação.
 */

import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { AgentContext } from '../../../src/copilot/agent/agent-context.js';

describe('agent-lifecycle › exports', () => {
    it('exporta agentStart, agentStop, initSession e agentTryReconnect', async () => {
        const mod = await import('../../../src/copilot/agent/lifecycle/agent-lifecycle.js');
        assert.equal(typeof mod.agentStart, 'function');
        assert.equal(typeof mod.agentStop, 'function');
        assert.equal(typeof mod.initSession, 'function');
        assert.equal(typeof mod.agentTryReconnect, 'function');
    });
});

describe('agent-lifecycle › agentStart guard', () => {
    it('retorna silenciosamente se status não é stopped', async () => {
        const { agentStart } = await import('../../../src/copilot/agent/lifecycle/agent-lifecycle.js');
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);
        ctx.status = 'idle'; // não é stopped

        const host = /** @type {any} */ (
            Object.assign(emitter, {
                sessionId: null,
                getStatusSnapshot: () => ({}),
                resumeDialogLoop: async () => {},
                startDialogLoop: async () => {},
                dialogPrMetrics: null,
                ensureDialogLoopAttached: () => {},
                sendMessage: async () => '',
                sendMessageDialogBoot: async () => '',
                answerPendingQuestion: () => false,
            })
        );

        // Não deve lançar,  apenas retornar
        await agentStart(ctx, host);
        assert.equal(ctx.status, 'idle', 'status não deve mudar');
    });
});

describe('agent-lifecycle › source contracts', () => {
    /** @type {string} */
    let src;

    beforeAll(async () => {
        src = await readFile(
            new URL('../../../src/copilot/agent/lifecycle/agent-lifecycle.js', import.meta.url),
            'utf-8',
        );
    });

    it('agentStop aceita shutdownTimeoutMs como parâmetro', () => {
        assert.ok(src.includes('shutdownTimeoutMs'), 'agentStop deve usar shutdownTimeoutMs');
    });

    it('agentStop chama messageQueue.drain()', () => {
        assert.ok(src.includes('messageQueue.drain('), 'agentStop deve limpar fila via drain()');
    });

    it('agentStop chama persistState com gracefulShutdown=true', () => {
        assert.ok(src.includes('gracefulShutdown: true'), 'agentStop deve marcar gracefulShutdown=true');
    });

    it('agentStart chama ctx.setStatus("starting")', () => {
        assert.ok(src.includes("setStatus('starting'"), 'agentStart deve definir status starting');
    });

    it('agentStart usa SHUTDOWN_TIMEOUT_MS do config', () => {
        assert.ok(src.includes('SHUTDOWN_TIMEOUT_MS'), 'deve importar SHUTDOWN_TIMEOUT_MS');
    });

    it('initSession recebe ctx, client e host como parâmetros', () => {
        assert.ok(src.includes('function initSession(ctx, client, host)'), 'initSession deve ter assinatura correta');
    });

    it('agentTryReconnect delega para tryReconnect policy', () => {
        assert.ok(src.includes('tryReconnect('), 'agentTryReconnect deve usar reconnect-policy');
    });
});
