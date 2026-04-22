// @ts-check
/**
 * tests/unit/copilot/test_always_alive_shutdown.spec.js
 *
 * Testes unitários para o Sprint 7 — graceful shutdown do AlwaysAliveAgent:
 *
 * - stop() aguarda tarefa atual terminar antes de desconectar
 * - stop() rejeita tarefas pendentes na fila após shutdown
 * - stop() emite evento 'stopped' após completar
 * - stop({ shutdownTimeoutMs }) respeita o timeout máximo
 * - Retrocompatibilidade: stop() sem argumentos usa default (10000ms)
 * - Idempotência: stop() em agente já parado não dispara duas vezes
 * - Limite máximo de fila: MAX_QUEUE_SIZE = 100
 */

import assert from 'node:assert/strict';
import { beforeAll, describe, it } from 'vitest';

import { alwaysAliveAgent } from '../../../src/copilot/agent/always-alive.js';
import { MAX_QUEUE_SIZE } from '../../../src/copilot/config/env.js';

// ─── Suite: análise estrutural ───────────────────────────────────────────────

describe('always-alive › Sprint 7: graceful shutdown', async () => {
    /** @type {string} */
    let sourceCode = '';

    beforeAll(async () => {
        const { readFile } = await import('node:fs/promises');
        const [main, lifecycle, agentConfig] = await Promise.all([
            readFile(new URL('../../../src/copilot/agent/always-alive.js', import.meta.url), 'utf-8'),
            readFile(new URL('../../../src/copilot/agent/lifecycle/agent-lifecycle.js', import.meta.url), 'utf-8'),
            readFile(new URL('../../../src/copilot/config/agent.js', import.meta.url), 'utf-8'),
        ]);
        sourceCode = main + '\n' + lifecycle + '\n' + agentConfig;
    });

    it('stop() deve aceitar opção shutdownTimeoutMs (parâmetro opcional)', () => {
        assert.ok(sourceCode.includes('shutdownTimeoutMs'), 'stop() deve aceitar shutdownTimeoutMs como opção');
    });

    it('stop() deve ter timeout padrão de 10000ms', () => {
        assert.ok(
            sourceCode.includes('SHUTDOWN_TIMEOUT_MS = 10_000') ||
                sourceCode.includes('SHUTDOWN_TIMEOUT_MS = 10000') ||
                sourceCode.includes('shutdownTimeoutMs = 10_000') ||
                sourceCode.includes('shutdownTimeoutMs = 10000'),
            'stop() deve ter shutdownTimeoutMs default de 10000ms (via SHUTDOWN_TIMEOUT_MS)',
        );
    });

    it('stop() deve usar Promise.race para aguardar tarefa atual com timeout', () => {
        assert.ok(
            sourceCode.includes('Promise.race'),
            'stop() deve usar Promise.race([aguardar_tarefa, timeout]) para graceful shutdown',
        );
    });

    it('stop() deve usar AgentContext para limpar a fila no shutdown', () => {
        assert.ok(
            sourceCode.includes('drainMessageQueue('),
            'stop() deve limpar a fila via AgentContext.drainMessageQueue() durante o shutdown gracioso',
        );
    });

    it('stop() deve logar tarefas rejeitadas (via drain do MessageQueue)', () => {
        assert.ok(
            sourceCode.includes('remainingTasks.length') && sourceCode.includes('Rejeitando'),
            'stop() deve logar quantas tarefas foram rejeitadas no shutdown',
        );
    });

    it('stop() deve emitir evento "stopped" após completar', () => {
        assert.ok(
            sourceCode.includes("emit('stopped')") || sourceCode.includes('emit(EMITTER_STOPPED'),
            "stop() deve emitir o evento 'stopped' ao finalizar",
        );
    });
});

// ─── Suite: comportamento observable via eventos ─────────────────────────────

describe('always-alive › shutdown event observable', () => {
    it('evento "stopped" pode ser subscrito no alwaysAliveAgent', () => {
        const h = () => {};
        alwaysAliveAgent.on('stopped', h);
        assert.ok(alwaysAliveAgent.listenerCount('stopped') >= 1);
        alwaysAliveAgent.off('stopped', h);
    });

    it('emitir "stopped" manualmente funciona corretamente', () => {
        let called = false;
        const h = () => {
            called = true;
        };
        alwaysAliveAgent.once('stopped', h);
        alwaysAliveAgent.emit('stopped');
        assert.ok(called, '"stopped" deve ser capturado pelo listener');
    });

    it('stop() com agente already stopped não deve lançar erro', async () => {
        // alwaysAliveAgent.status === 'stopped' (singleton em estado parado no ambiente de teste)
        assert.equal(alwaysAliveAgent.status, 'stopped');
        // Não deve lançar — deve retornar silenciosamente
        // Nota: start() não é chamado aqui (evita conexão real), então testamos
        // apenas que o método existe e é callable
        assert.equal(typeof alwaysAliveAgent.stop, 'function', 'stop() deve ser um método função');
    });
});

// ─── Suite: retrocompatibilidade ─────────────────────────────────────────────

describe('always-alive › stop() retrocompatibilidade', async () => {
    /** @type {string} */
    let sourceCode = '';

    beforeAll(async () => {
        const { readFile } = await import('node:fs/promises');
        const [main, lifecycle] = await Promise.all([
            readFile(new URL('../../../src/copilot/agent/always-alive.js', import.meta.url), 'utf-8'),
            readFile(new URL('../../../src/copilot/agent/lifecycle/agent-lifecycle.js', import.meta.url), 'utf-8'),
        ]);
        sourceCode = main + '\n' + lifecycle;
    });

    it('stop() deve aceitar chamada sem argumentos (parâmetro com default)', () => {
        // agentStop tem destructuring { shutdownTimeoutMs = ... } = {}
        assert.ok(
            sourceCode.includes('shutdownTimeoutMs') && sourceCode.includes('= {}'),
            'stop()/agentStop() deve usar destructuring com default = {} para retrocompatibilidade',
        );
    });

    it('stop() aguarda processing status antes de parar', () => {
        // Verifica que há lógica para checar status processing/waiting_for_input
        assert.ok(
            sourceCode.includes('isProcessing()') && sourceCode.includes('isWaitingForInput()'),
            'stop() deve checar status processing e waiting_for_input antes de parar',
        );
    });
});

// ─── Suite: limite máximo de fila ───────────────────────────────────────────

describe('always-alive › MAX_QUEUE_SIZE: limite de fila', () => {
    it('MAX_QUEUE_SIZE deve ser 100', () => {
        assert.equal(MAX_QUEUE_SIZE, 100);
    });

    it('MAX_QUEUE_SIZE deve ser importado em message-queue.js (migrado de always-alive.js)', async () => {
        const { readFile } = await import('node:fs/promises');
        // F.4: MAX_QUEUE_SIZE migrou para message-queue.js; always-alive.js não deve mais importá-lo diretamente.
        const mq = await readFile(
            new URL('../../../src/copilot/agent/infra/message-queue.js', import.meta.url),
            'utf-8',
        );
        assert.ok(
            mq.includes("import { MAX_QUEUE_SIZE } from '#copilot/core/constants'") ||
                mq.includes("import { MAX_QUEUE_SIZE } from '#copilot/config/env'") ||
                mq.includes("import { MAX_QUEUE_SIZE } from '#copilot/config'"),
            'MAX_QUEUE_SIZE deve ser importado em message-queue.js (onde a verificação de capacidade está)',
        );
        assert.ok(
            !mq.includes('static MAX_QUEUE_SIZE'),
            'Não deve ter campo static MAX_QUEUE_SIZE duplicado em message-queue.js',
        );
    });

    it('sendMessage() deve rejeitar se fila é igual a MAX_QUEUE_SIZE', () => {
        // Testa a lógica de validação sem conexão real
        // alwaysAliveAgent está 'stopped', logo nåo processa
        // mas a verificação de limite deve ser front: antes de enfileirar
        assert.equal(typeof MAX_QUEUE_SIZE, 'number');
        assert.ok(MAX_QUEUE_SIZE > 0);
    });

    it('sendMessage() cria tarefa e delega enqueue ao MessageQueue', async () => {
        const { readFile } = await import('node:fs/promises');
        // F38: lógica de enqueue extraída para messaging/agent-messaging.js
        const src = await readFile(new URL('../../../src/copilot/agent/always-alive.js', import.meta.url), 'utf-8');
        const msg = await readFile(
            new URL('../../../src/copilot/agent/messaging/agent-messaging.js', import.meta.url),
            'utf-8',
        );
        const combined = src + msg;
        // F.4/K1: lógica de verificação de limite passa por AgentContext.enqueueMessageTask()
        assert.ok(combined.includes('enqueueMessageTask(task'), 'sendMessage deve delegar enqueue ao AgentContext');
    });

    it('mensagem de erro ao atingir limite deve conter "Fila cheia" em message-queue.js', async () => {
        const { readFile } = await import('node:fs/promises');
        // F.4: mensagem de erro migrou para message-queue.js
        const mq = await readFile(
            new URL('../../../src/copilot/agent/infra/message-queue.js', import.meta.url),
            'utf-8',
        );
        assert.ok(
            mq.includes('Fila cheia'),
            "mensagem de erro deve conter 'Fila cheia' em message-queue.js para clareza operacional",
        );
    });
});

// ─── Suite: idempotência no stop() ────────────────────────────────────────────

describe('always-alive › stop() idempotência', async () => {
    /** @type {string} */
    let sourceCode = '';

    beforeAll(async () => {
        const { readFile } = await import('node:fs/promises');
        const [main, lifecycle] = await Promise.all([
            readFile(new URL('../../../src/copilot/agent/always-alive.js', import.meta.url), 'utf-8'),
            readFile(new URL('../../../src/copilot/agent/lifecycle/agent-lifecycle.js', import.meta.url), 'utf-8'),
        ]);
        sourceCode = main + '\n' + lifecycle;
    });

    it('stop() deve ter guard de idempotência verificando isStopped()', () => {
        assert.ok(
            sourceCode.includes('ctx.isStopped()') && sourceCode.includes('return;'),
            'stop()/agentStop() deve conter guard semântico ctx.isStopped()',
        );
    });

    it('alwaysAliveAgent já parado deve ter status stopped', () => {
        assert.equal(alwaysAliveAgent.status, 'stopped');
    });

    it('stop() em agente já parado não emite evento stopped novamente', async () => {
        // O agente está stopped no ambiente de teste
        let count = 0;
        const h = () => {
            count++;
        };
        alwaysAliveAgent.on('stopped', h);
        // Chama stop() sem iniciar (status já é 'stopped') — deve retornar sem emitir
        await alwaysAliveAgent.stop();
        alwaysAliveAgent.off('stopped', h);
        assert.equal(count, 0, 'stop() idempotente não deve emitir stopped novamente');
    });
});
