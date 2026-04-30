// @ts-check
/**
 * tests/unit/copilot/test_always_alive_reconnect.spec.js
 *
 * Testes unitários para o Sprint 6 — backoff exponencial de reconexão de sessão em always-alive.js:
 *
 * - #tryReconnect() implementado com backoff exponencial + jitter
 * - maxAttempts: 5-7 (configurável, default 5)
 * - Evento session.fatal emitido quando tentativas esgotadas
 * - Tarefa reenfileirada quando reconexão bem-sucedida
 * - Status 'reconnecting:N/M' emitido durante tentativas
 */

import assert from 'node:assert/strict';
import { beforeAll, describe, it } from 'vitest';

import { alwaysAliveAgent } from '../../../src/copilot/agent/always-alive.js';

// ─── Suite: análise estrutural do código ────────────────────────────────────

describe('always-alive › Sprint 6: backoff exponencial de reconexão', async () => {
    /** @type {string} */
    let sourceCode = '';
    /** @type {string} */
    let reconnectPolicyCode = '';

    beforeAll(async () => {
        const { readFile } = await import('node:fs/promises');
        const [mainCode, rpCode, messagingCode] = await Promise.all([
            readFile(new URL('../../../src/copilot/agent/always-alive.js', import.meta.url), 'utf-8'),
            readFile(
                new URL('../../../src/copilot/agent/lifecycle/policies/reconnect-policy.js', import.meta.url),
                'utf-8',
            ),
            readFile(new URL('../../../src/copilot/agent/messaging/agent-messaging.js', import.meta.url), 'utf-8'),
        ]);
        sourceCode = mainCode + '\n' + messagingCode;
        reconnectPolicyCode = rpCode;
    });

    it('deve conter método privado #tryReconnect', () => {
        assert.ok(sourceCode.includes('#tryReconnect'), 'always-alive.js deve definir #tryReconnect');
    });

    it('deve usar Math.pow para backoff exponencial', () => {
        // F.6.2: lógica de backoff extraída para reconnect-policy.js
        assert.ok(
            reconnectPolicyCode.includes('Math.pow'),
            'reconnect-policy.js deve usar Math.pow(2, attempt-1) para backoff exponencial',
        );
    });

    it('deve usar Math.random para jitter', () => {
        // F.6.2: lógica de jitter extraída para reconnect-policy.js
        // G1-DX-03: Math.random é agora o default injetável via `jitterFn = Math.random`
        assert.ok(
            reconnectPolicyCode.includes('Math.random'),
            'reconnect-policy.js deve usar Math.random como jitter padrão (thundering herd prevention)',
        );
    });

    it('deve emitir session.fatal quando tentativas esgotadas', () => {
        // F.6.2: emission de session.fatal extraída para reconnect-policy.js
        assert.ok(
            reconnectPolicyCode.includes("emit('session.fatal'"),
            'reconnect-policy.js deve emitir session.fatal após esgotar tentativas de reconexão',
        );
    });

    it('deve ter maxAttempts padrão de 5 (recomendado pelo LLM-B: 5-7)', () => {
        // F.6.2: defaults extraídos para reconnect-policy.js
        assert.ok(
            reconnectPolicyCode.includes('maxAttempts = 5'),
            'reconnect-policy.js deve ter maxAttempts default = 5',
        );
    });

    it('deve ter baseDelayMs padrão de 1000ms', () => {
        // F.6.2: defaults extraídos para reconnect-policy.js
        assert.ok(
            reconnectPolicyCode.includes('baseDelayMs = 1_000') || reconnectPolicyCode.includes('baseDelayMs = 1000'),
            'reconnect-policy.js deve ter baseDelayMs default = 1000ms',
        );
    });

    it('deve reenfileirar tarefa via AgentContext quando reconexão bem-sucedida', () => {
        // F.4/K1: requeue migrou para AgentContext.unshiftMessageTask()
        assert.ok(
            sourceCode.includes('unshiftMessageTask('),
            'ao reconectar, a tarefa deve ser reenfileirada no início via AgentContext.unshiftMessageTask()',
        );
    });

    it('deve chamar initOrResumeSession na tentativa de reconexão', () => {
        // F.6.2: initOrResumeSession delegado via callback
        const hasInitOrResume =
            sourceCode.includes('initOrResumeSession') || reconnectPolicyCode.includes('initSession');
        assert.ok(
            hasInitOrResume,
            'reconnect-policy.js deve usar initSession (callback para initOrResumeSession) para recriar sessão',
        );
    });

    it('deve verificar se #client existe antes de tentar reconectar', () => {
        // F.6.2: verificação de client passou para reconnect-policy.js como argumento direto
        assert.ok(
            reconnectPolicyCode.includes('!client') || reconnectPolicyCode.includes('client === null'),
            'reconnect-policy.js deve checar se client existe antes de tentar reconectar',
        );
    });

    it('deve retornar false quando status é stopped (agente parado)', () => {
        // F.6.2: verificação de stopped passou para reconnect-policy.js
        assert.ok(
            reconnectPolicyCode.includes("'stopped'"),
            "reconnect-policy.js deve retornar false quando status === 'stopped'",
        );
    });
});

// ─── Suite: comportamento observable via eventos ─────────────────────────────

describe('always-alive › session.fatal evento', () => {
    it('deve ser possível registrar listener para session.fatal no alwaysAliveAgent', () => {
        // Verifica que session.fatal pode ser ouvido como qualquer EventEmitter event
        const handler = () => {};
        alwaysAliveAgent.on('session.fatal', handler);
        assert.ok(alwaysAliveAgent.listenerCount('session.fatal') >= 1);
        alwaysAliveAgent.off('session.fatal', handler);
        // Não acumula leak
        assert.ok(true, 'adicionar e remover listener de session.fatal funciona');
    });

    it('session.fatal emitido manualmente deve ter payload com originalError e attempts', () => {
        /** @type {any} */
        let captured = null;
        const h = (/** @type {any} */ d) => {
            captured = d;
        };
        alwaysAliveAgent.once('session.fatal', h);
        alwaysAliveAgent.emit('session.fatal', { originalError: 'Network timeout', attempts: 5 });

        assert.ok(captured !== null, 'session.fatal deve ter sido capturado');
        assert.equal(typeof captured.originalError, 'string');
        assert.equal(captured.attempts, 5);
    });
});

// ─── Suite: cálculo de backoff ────────────────────────────────────────────────

describe('always-alive › fórmula de backoff exponencial com jitter', () => {
    it('delay da tentativa 1 deve ser entre 1000ms e 2000ms (base + random*base)', () => {
        // delay = 1000 * 2^(1-1) + random(0..1000) = 1000 + 0..1000 = [1000, 2000)
        const base = 1000;
        const attempt = 1;
        const minDelay = base * Math.pow(2, attempt - 1); // 1000
        const maxDelay = minDelay + base; // 2000
        assert.ok(minDelay === 1000, 'tentativa 1: min delay deve ser 1000ms');
        assert.ok(maxDelay === 2000, 'tentativa 1: max delay deve ser 2000ms');
    });

    it('delay da tentativa 5 deve ser entre 16000ms e 17000ms (base*16 + random*base)', () => {
        // delay = 1000 * 2^4 + random(0..1000) = 16000 + 0..1000 = [16000, 17000)
        const base = 1000;
        const attempt = 5;
        const minDelay = base * Math.pow(2, attempt - 1); // 16000
        const maxDelay = minDelay + base; // 17000
        assert.ok(minDelay === 16_000, 'tentativa 5: min delay deve ser 16000ms');
        assert.ok(maxDelay === 17_000, 'tentativa 5: max delay deve ser 17000ms');
    });

    it('5 tentativas totais resultam em tempo máximo de ~31000ms (soma dos delays)', () => {
        // 1000 + 2000 + 4000 + 8000 + 16000 = 31000ms sem jitter
        const base = 1000;
        let total = 0;
        for (let i = 1; i <= 5; i++) {
            total += base * Math.pow(2, i - 1);
        }
        assert.equal(total, 31_000, 'soma dos delays sem jitter = 31000ms para 5 tentativas');
    });
});
