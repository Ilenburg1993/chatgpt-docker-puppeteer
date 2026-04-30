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
import { beforeAll, describe, it } from 'vitest';
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
    /** @type {string} */
    let runtimeTeardownSrc;

    beforeAll(async () => {
        [src, runtimeTeardownSrc] = await Promise.all([
            readFile(new URL('../../../src/copilot/agent/lifecycle/agent-lifecycle.js', import.meta.url), 'utf-8'),
            readFile(new URL('../../../src/copilot/agent/lifecycle/runtime-teardown.js', import.meta.url), 'utf-8'),
        ]);
    });

    it('agentStop aceita shutdownTimeoutMs como parâmetro', () => {
        assert.ok(src.includes('shutdownTimeoutMs'), 'agentStop deve usar shutdownTimeoutMs');
    });

    it('agentStop chama drainMessageQueue()', () => {
        assert.ok(src.includes('drainMessageQueue('), 'agentStop deve limpar fila via AgentContext');
    });

    it('agentStop delega persistência de gracefulShutdown para a façade de runtime state', () => {
        assert.ok(
            src.includes('persistAgentRuntimeGracefulShutdownState('),
            'agentStop deve persistir gracefulShutdown via façade',
        );
    });

    it('agentStop pode preservar intenção de dialog loop para retomada após restart do processo', () => {
        assert.ok(src.includes('preserveDialogLoopIntent'), 'agentStop deve aceitar preserveDialogLoopIntent');
        assert.ok(
            src.includes('restoreDialogLoopOnNextBoot'),
            'agentStop deve calcular restoreDialogLoopOnNextBoot para shutdown do terminal',
        );
        assert.ok(
            src.includes('dialogLoopActive: restoreDialogLoopOnNextBoot'),
            'state persistido deve preservar intenção de loop no shutdown do processo',
        );
    });

    it('agentStart chama ctx.setStatus("starting")', () => {
        assert.ok(src.includes("setStatus('starting'"), 'agentStart deve definir status starting');
    });

    it('agentStart usa SHUTDOWN_TIMEOUT_MS do config', () => {
        assert.ok(src.includes('SHUTDOWN_TIMEOUT_MS'), 'deve importar SHUTDOWN_TIMEOUT_MS');
    });

    it('agentStart reconcilia boot state persistido pela façade de runtime state', () => {
        assert.ok(
            src.includes('restoreAgentRuntimePersistentBootState('),
            'agentStart deve restaurar sendCount/shadow via façade',
        );
    });

    it('agentStart executa rollback best-effort em falha parcial de boot', () => {
        assert.ok(src.includes('rollbackFailedAgentStart('), 'agentStart deve chamar rollback em falha parcial');
        assert.ok(
            src.includes('agent.start.rollback.ownership.clear'),
            'rollback deve limpar ownership de sessão SDK compartilhada',
        );
        assert.ok(
            src.includes("teardownRuntimeSidecars(ctx, 'agent_start_failed')") &&
                runtimeTeardownSrc.includes('ctx.stopKeepalive(keepaliveStopReason)'),
            'rollback deve parar keepalive iniciado antes da falha',
        );
        assert.ok(
            runtimeTeardownSrc.includes('stopAgentSdkClient(client)'),
            'rollback deve parar client SDK pela façade canônica',
        );
        assert.ok(
            runtimeTeardownSrc.includes('disconnectAgentSdkSession(session)'),
            'rollback deve desconectar sessão SDK pela façade canônica',
        );
    });

    it('agentStart registra relatório transacional de load/start', () => {
        assert.ok(src.includes('runAgentStartPhase('), 'agentStart deve instrumentar fases transacionais');
        assert.ok(src.includes('ctx.setStartReport('), 'agentStart deve publicar AgentStartReport no contexto');
        assert.ok(src.includes("'sdk.client.create'"), 'start report deve medir criação do client SDK');
        assert.ok(src.includes("'sdk.session.init'"), 'start report deve medir init/resume da sessão SDK');
        assert.ok(src.includes("'agent.session.runtime.wire'"), 'start report deve medir wiring pós sessão');
        assert.ok(src.includes("'agent.start.rollback'"), 'start report deve medir rollback em falha parcial');
    });

    it('wireAgentSessionRuntime instala handles de cleanup antes de propagar erro do boot wiring', () => {
        const unsubsPos = src.indexOf('ctx.setSessionEventUnsubscribers(bootResult.unsubs)');
        const errorPos = src.indexOf('if (bootResult.error)');

        assert.ok(unsubsPos > 0, 'wireAgentSessionRuntime deve instalar unsubscribers do boot wiring');
        assert.ok(errorPos > 0, 'wireAgentSessionRuntime deve testar bootResult.error');
        assert.ok(
            unsubsPos < errorPos,
            'handles retornados por performBootWiring precisam ser instalados antes de lançar erro para permitir rollback',
        );
    });

    it('initSession recebe ctx, client e host como parâmetros', () => {
        assert.ok(src.includes('function initSession(ctx, client, host)'), 'initSession deve ter assinatura correta');
    });

    it('initSession explicita start do client SDK pela façade antes de criar/retomar sessão', () => {
        assert.ok(
            src.includes('ensureAgentSdkClientStarted(client)'),
            'initSession deve explicitar start do client via façade',
        );
    });

    it('agentTryReconnect delega para tryReconnect policy', () => {
        assert.ok(src.includes('tryReconnect('), 'agentTryReconnect deve usar reconnect-policy');
    });

    it('agentStop para o client SDK pela façade, sem chamar client.stop() cru', () => {
        assert.ok(
            src.includes('disconnectRuntimeSdkHandles(ctx') &&
                runtimeTeardownSrc.includes('stopAgentSdkClient(client)'),
            'agentStop deve usar a façade para parar o client SDK',
        );
        assert.ok(
            !src.includes('await client.stop()') && !runtimeTeardownSrc.includes('await client.stop()'),
            'agentStop não deve chamar client.stop() cru',
        );
    });

    it('lifecycle delega I/O de runtime state e snapshot de shutdown para façades', () => {
        assert.ok(src.includes('resetAgentRuntimeGracefulShutdownFlag('));
        assert.ok(src.includes('persistAgentRuntimePrConsumptionSnapshot('));
        assert.ok(src.includes('saveAgentRuntimeShutdownSnapshot('));
        assert.ok(!src.includes('readStateAsync('));
        assert.ok(!src.includes('persistStateWithPolicy('));
        assert.ok(!src.includes('createSnapshot('));
        assert.ok(!src.includes('saveSnapshotAsync('));
    });

    it('hot path evita aliases crus de subestado no lifecycle', () => {
        assert.ok(
            !src.includes('const sessionState = ctx.sessionState ?? ctx;') &&
                !src.includes('const dialogState = ctx.dialogState ?? ctx;') &&
                !src.includes('const runtimeState = ctx.runtimeState ?? ctx;') &&
                !src.includes('const metricsState = ctx.metricsState ?? ctx;') &&
                !src.includes('const ioState = ctx.ioState ?? ctx;') &&
                !src.includes('const configState = ctx.configState ?? ctx;'),
            'agent-lifecycle não deve reintroduzir aliases crus de subestado no hot path',
        );
    });
});
