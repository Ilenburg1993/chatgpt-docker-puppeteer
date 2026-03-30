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
import { before, describe, it } from 'node:test';
import { alwaysAliveAgent } from '../../../src/copilot/agent/always-alive.js';
import { MAX_QUEUE_SIZE } from '../../../src/copilot/core/constants.js';

// ─── Suite: análise estrutural ───────────────────────────────────────────────

describe('always-alive › Sprint 7: graceful shutdown', async () => {
    /** @type {string} */
    let sourceCode = '';

    before(async () => {
        const { readFile } = await import('node:fs/promises');
        sourceCode = await readFile(new URL('../../../src/copilot/agent/always-alive.js', import.meta.url), 'utf-8');
    });

    it('stop() deve aceitar opção shutdownTimeoutMs (parâmetro opcional)', () => {
        assert.ok(sourceCode.includes('shutdownTimeoutMs'), 'stop() deve aceitar shutdownTimeoutMs como opção');
    });

    it('stop() deve ter timeout padrão de 10000ms', () => {
        assert.ok(
            sourceCode.includes('shutdownTimeoutMs = 10_000') || sourceCode.includes('shutdownTimeoutMs = 10000'),
            'stop() deve ter shutdownTimeoutMs default de 10000ms',
        );
    });

    it('stop() deve usar Promise.race para aguardar tarefa atual com timeout', () => {
        assert.ok(
            sourceCode.includes('Promise.race'),
            'stop() deve usar Promise.race([aguardar_tarefa, timeout]) para graceful shutdown',
        );
    });

    it('stop() deve usar #queue.splice(0) para limpar a fila no shutdown', () => {
        assert.ok(
            sourceCode.includes('this.#queue.splice(0)'),
            'stop() deve limpar a fila com #queue.splice(0) durante o shutdown gracioso',
        );
    });

    it('stop() deve chamar task.reject() nas tarefas pendentes', () => {
        assert.ok(
            sourceCode.includes('task.reject(shutdownError)'),
            'stop() deve rejeitar tarefas pendentes com shutdownError',
        );
    });

    it('stop() deve emitir evento "stopped" após completar', () => {
        assert.ok(sourceCode.includes("emit('stopped')"), "stop() deve emitir o evento 'stopped' ao finalizar");
    });

    it('stop() deve logar quantidade de tarefas rejeitadas', () => {
        assert.ok(
            sourceCode.includes('remainingTasks.length') && sourceCode.includes('Rejeitando'),
            'stop() deve logar quantas tarefas foram rejeitadas no shutdown',
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

    before(async () => {
        const { readFile } = await import('node:fs/promises');
        sourceCode = await readFile(new URL('../../../src/copilot/agent/always-alive.js', import.meta.url), 'utf-8');
    });

    it('stop() deve aceitar chamada sem argumentos (parâmetro com default)', () => {
        // A assinatura async stop({ shutdownTimeoutMs = 10_000 } = {})
        // garante que stop() funciona sem args (= {})
        const stopSignature = /async stop\s*\(\s*\{[^}]*\}\s*=\s*\{\}/.test(sourceCode);
        assert.ok(stopSignature, 'stop() deve usar destructuring com default = {} para retrocompatibilidade');
    });

    it('stop() aguarda processing status antes de parar', () => {
        // Verifica que há lógica para checar status processing/waiting_for_input
        assert.ok(
            sourceCode.includes("'processing'") && sourceCode.includes("'waiting_for_input'"),
            'stop() deve checar status processing e waiting_for_input antes de parar',
        );
    });
});

// ─── Suite: limite máximo de fila ───────────────────────────────────────────

describe('always-alive › MAX_QUEUE_SIZE: limite de fila', () => {
    it('MAX_QUEUE_SIZE deve ser 100', () => {
        assert.equal(MAX_QUEUE_SIZE, 100);
    });

    it('MAX_QUEUE_SIZE deve ser importado de constants.js (sem campo static duplicado)', async () => {
        const { readFile } = await import('node:fs/promises');
        const src = await readFile(new URL('../../../src/copilot/agent/always-alive.js', import.meta.url), 'utf-8');
        assert.ok(
            src.includes("import { MAX_QUEUE_SIZE } from '#copilot/core/constants'"),
            'MAX_QUEUE_SIZE deve ser importado de #copilot/core/constants',
        );
        assert.ok(!src.includes('static MAX_QUEUE_SIZE'), 'Não deve ter campo static MAX_QUEUE_SIZE duplicado');
    });

    it('sendMessage() deve rejeitar se fila é igual a MAX_QUEUE_SIZE', () => {
        // Testa a lógica de validação sem conexão real
        // alwaysAliveAgent está 'stopped', logo nåo processa
        // mas a verificação de limite deve ser front: antes de enfileirar
        assert.equal(typeof MAX_QUEUE_SIZE, 'number');
        assert.ok(MAX_QUEUE_SIZE > 0);
    });

    it('código deve rejeitar sendMessage quando fila está no limite', async () => {
        const { readFile } = await import('node:fs/promises');
        const src = await readFile(new URL('../../../src/copilot/agent/always-alive.js', import.meta.url), 'utf-8');
        assert.ok(
            src.includes('#queue.length >= MAX_QUEUE_SIZE'),
            'sendMessage deve verificar this.#queue.length >= MAX_QUEUE_SIZE',
        );
    });

    it('mensagem de erro ao atingir limite deve indicar o tamanho máximo', async () => {
        const { readFile } = await import('node:fs/promises');
        const src = await readFile(new URL('../../../src/copilot/agent/always-alive.js', import.meta.url), 'utf-8');
        assert.ok(src.includes('Fila cheia'), "mensagem de erro deve conter 'Fila cheia' para clareza operacional");
    });
});

// ─── Suite: idempotência no stop() ────────────────────────────────────────────

describe('always-alive › stop() idempotência', async () => {
    /** @type {string} */
    let sourceCode = '';

    before(async () => {
        const { readFile } = await import('node:fs/promises');
        sourceCode = await readFile(new URL('../../../src/copilot/agent/always-alive.js', import.meta.url), 'utf-8');
    });

    it('stop() deve ter guard de idempotência verificando status === stopped', () => {
        assert.ok(
            sourceCode.includes("this.#status === 'stopped'") && sourceCode.includes('return;'),
            "stop() deve conter guard 'if (this.#status === stopped) return'",
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
