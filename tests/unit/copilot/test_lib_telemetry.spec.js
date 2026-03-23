// @ts-check
/**
 * tests/unit/copilot/test_lib_telemetry.spec.js
 *
 * Testes unitários para src/copilot/lib/telemetry.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    clearTelemetry,
    createTelemetry,
    getAverageDuration,
    getCallsBySession,
    getCallsByTool,
    getErrorCalls,
    getErrorCount,
    getRecentCalls,
    getSuccessCount,
    getSummary,
    getTotalCalls,
    recordSessionEnd,
    recordSessionStart,
    recordToolCall,
} from '../../../src/copilot/lib/telemetry.js';

// ─── createTelemetry ─────────────────────────────────────────────────────────

describe('createTelemetry', () => {
    it('deve criar store vazio', () => {
        const tel = createTelemetry();
        assert.deepEqual(tel.toolCalls, []);
        assert.deepEqual(tel.sessions, []);
        assert.equal(tel.maxRecords, 500);
    });

    it('deve aceitar maxRecords customizado', () => {
        const tel = createTelemetry({ maxRecords: 10 });
        assert.equal(tel.maxRecords, 10);
    });

    it('deve criar instâncias independentes', () => {
        const a = createTelemetry();
        const b = createTelemetry();
        recordToolCall(a, 'tool', { durationMs: 10, success: true });
        assert.equal(b.toolCalls.length, 0);
    });
});

// ─── recordToolCall ───────────────────────────────────────────────────────────

describe('recordToolCall', () => {
    it('deve registrar chamada bem-sucedida', () => {
        const tel = createTelemetry();
        recordToolCall(tel, 'lint', { durationMs: 120, success: true });
        assert.equal(tel.toolCalls.length, 1);
        assert.equal(tel.toolCalls[0]?.toolName, 'lint');
        assert.equal(tel.toolCalls[0]?.durationMs, 120);
        assert.equal(tel.toolCalls[0]?.success, true);
    });

    it('deve registrar chamada com erro', () => {
        const tel = createTelemetry();
        recordToolCall(tel, 'test', { durationMs: 50, success: false, error: 'falhou' });
        assert.equal(tel.toolCalls[0]?.success, false);
        assert.equal(tel.toolCalls[0]?.error, 'falhou');
    });

    it('deve registrar sessionId quando fornecido', () => {
        const tel = createTelemetry();
        recordToolCall(tel, 't', { durationMs: 5, success: true, sessionId: 'sess-1' });
        assert.equal(tel.toolCalls[0]?.sessionId, 'sess-1');
    });

    it('deve usar timestamp customizado quando fornecido', () => {
        const tel = createTelemetry();
        const ts = 1700000000000;
        recordToolCall(tel, 't', { durationMs: 5, success: true, timestamp: ts });
        assert.equal(tel.toolCalls[0]?.timestamp, ts);
    });

    it('deve gerar timestamp automático quando não fornecido', () => {
        const tel = createTelemetry();
        const before = Date.now();
        recordToolCall(tel, 't', { durationMs: 5, success: true });
        const after = Date.now();
        const ts = tel.toolCalls[0]?.timestamp ?? 0;
        assert.ok(ts >= before && ts <= after);
    });

    it('deve lançar se toolName for inválido', () => {
        const tel = createTelemetry();
        assert.throws(() => recordToolCall(tel, '', { durationMs: 0, success: true }), /toolName/);
    });

    it('deve lançar se toolName não for string', () => {
        const tel = createTelemetry();
        // @ts-expect-error — teste de runtime
        assert.throws(() => recordToolCall(tel, null, { durationMs: 0, success: true }), /toolName/);
    });

    it('deve aplicar circular buffer quando atingir maxRecords', () => {
        const tel = createTelemetry({ maxRecords: 3 });
        recordToolCall(tel, 'a', { durationMs: 1, success: true });
        recordToolCall(tel, 'b', { durationMs: 1, success: true });
        recordToolCall(tel, 'c', { durationMs: 1, success: true });
        recordToolCall(tel, 'd', { durationMs: 1, success: true }); // Deve descartar 'a'
        assert.equal(tel.toolCalls.length, 3);
        assert.equal(tel.toolCalls[0]?.toolName, 'b');
        assert.equal(tel.toolCalls[2]?.toolName, 'd');
    });
});

// ─── recordSessionStart / recordSessionEnd ────────────────────────────────────

describe('recordSessionStart', () => {
    it('deve registrar sessão com status ativo', () => {
        const tel = createTelemetry();
        recordSessionStart(tel, 'sess-1');
        assert.equal(tel.sessions.length, 1);
        assert.equal(tel.sessions[0]?.sessionId, 'sess-1');
        assert.equal(tel.sessions[0]?.status, 'active');
    });

    it('deve aceitar startedAt customizado', () => {
        const tel = createTelemetry();
        recordSessionStart(tel, 'sess-1', { startedAt: 1000 });
        assert.equal(tel.sessions[0]?.startedAt, 1000);
    });

    it('deve lançar se sessionId inválido', () => {
        const tel = createTelemetry();
        assert.throws(() => recordSessionStart(tel, ''), /sessionId/);
    });
});

describe('recordSessionEnd', () => {
    it('deve marcar sessão como encerrada', () => {
        const tel = createTelemetry();
        recordSessionStart(tel, 'sess-1');
        const ok = recordSessionEnd(tel, 'sess-1');
        assert.equal(ok, true);
        assert.equal(tel.sessions[0]?.status, 'ended');
        assert.ok(tel.sessions[0]?.endedAt !== undefined);
    });

    it('deve marcar sessão com status error', () => {
        const tel = createTelemetry();
        recordSessionStart(tel, 'sess-1');
        recordSessionEnd(tel, 'sess-1', { status: 'error', error: 'conexão perdida' });
        assert.equal(tel.sessions[0]?.status, 'error');
        assert.equal(tel.sessions[0]?.error, 'conexão perdida');
    });

    it('deve retornar false se sessão não existe', () => {
        const tel = createTelemetry();
        const ok = recordSessionEnd(tel, 'inexistente');
        assert.equal(ok, false);
    });

    it('deve retornar false se sessão já foi encerrada', () => {
        const tel = createTelemetry();
        recordSessionStart(tel, 'sess-1');
        recordSessionEnd(tel, 'sess-1');
        const ok = recordSessionEnd(tel, 'sess-1'); // Segunda chamada
        assert.equal(ok, false);
    });

    it('deve usar endedAt customizado', () => {
        const tel = createTelemetry();
        recordSessionStart(tel, 'sess-1');
        recordSessionEnd(tel, 'sess-1', { endedAt: 9999 });
        assert.equal(tel.sessions[0]?.endedAt, 9999);
    });
});

// ─── getTotalCalls / getSuccessCount / getErrorCount ──────────────────────────

describe('getTotalCalls', () => {
    it('deve retornar 0 para store vazio', () => {
        assert.equal(getTotalCalls(createTelemetry()), 0);
    });

    it('deve retornar contagem correta', () => {
        const tel = createTelemetry();
        recordToolCall(tel, 'a', { durationMs: 1, success: true });
        recordToolCall(tel, 'b', { durationMs: 1, success: false });
        assert.equal(getTotalCalls(tel), 2);
    });
});

describe('getSuccessCount', () => {
    it('deve contar apenas chamadas bem-sucedidas', () => {
        const tel = createTelemetry();
        recordToolCall(tel, 'a', { durationMs: 1, success: true });
        recordToolCall(tel, 'b', { durationMs: 1, success: false });
        recordToolCall(tel, 'c', { durationMs: 1, success: true });
        assert.equal(getSuccessCount(tel), 2);
    });
});

describe('getErrorCount', () => {
    it('deve contar apenas chamadas com erro', () => {
        const tel = createTelemetry();
        recordToolCall(tel, 'a', { durationMs: 1, success: true });
        recordToolCall(tel, 'b', { durationMs: 1, success: false });
        assert.equal(getErrorCount(tel), 1);
    });

    it('deve retornar 0 se não há erros', () => {
        const tel = createTelemetry();
        recordToolCall(tel, 'a', { durationMs: 1, success: true });
        assert.equal(getErrorCount(tel), 0);
    });
});

// ─── getAverageDuration ───────────────────────────────────────────────────────

describe('getAverageDuration', () => {
    it('deve retornar 0 para store vazio', () => {
        assert.equal(getAverageDuration(createTelemetry()), 0);
    });

    it('deve calcular média corretamente', () => {
        const tel = createTelemetry();
        recordToolCall(tel, 'a', { durationMs: 100, success: true });
        recordToolCall(tel, 'b', { durationMs: 200, success: true });
        recordToolCall(tel, 'c', { durationMs: 300, success: true });
        assert.equal(getAverageDuration(tel), 200);
    });
});

// ─── getCallsByTool / getCallsBySession ───────────────────────────────────────

describe('getCallsByTool', () => {
    it('deve filtrar por nome de ferramenta', () => {
        const tel = createTelemetry();
        recordToolCall(tel, 'lint', { durationMs: 1, success: true });
        recordToolCall(tel, 'test', { durationMs: 1, success: true });
        recordToolCall(tel, 'lint', { durationMs: 1, success: false });
        const calls = getCallsByTool(tel, 'lint');
        assert.equal(calls.length, 2);
        assert.ok(calls.every((c) => c.toolName === 'lint'));
    });

    it('deve retornar array vazio se ferramenta não usada', () => {
        assert.deepEqual(getCallsByTool(createTelemetry(), 'nope'), []);
    });
});

describe('getCallsBySession', () => {
    it('deve filtrar por sessionId', () => {
        const tel = createTelemetry();
        recordToolCall(tel, 't', { durationMs: 1, success: true, sessionId: 'a' });
        recordToolCall(tel, 't', { durationMs: 1, success: true, sessionId: 'b' });
        const calls = getCallsBySession(tel, 'a');
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.sessionId, 'a');
    });
});

// ─── getRecentCalls ───────────────────────────────────────────────────────────

describe('getRecentCalls', () => {
    it('deve retornar os N mais recentes', () => {
        const tel = createTelemetry();
        for (let i = 1; i <= 5; i++) {
            recordToolCall(tel, `t${i}`, { durationMs: i, success: true });
        }
        const recent = getRecentCalls(tel, 3);
        assert.equal(recent.length, 3);
        assert.equal(recent[0]?.toolName, 't3');
        assert.equal(recent[2]?.toolName, 't5');
    });

    it('deve retornar todos se n > total', () => {
        const tel = createTelemetry();
        recordToolCall(tel, 't', { durationMs: 1, success: true });
        assert.equal(getRecentCalls(tel, 100).length, 1);
    });

    it('deve usar n=10 como padrão', () => {
        const tel = createTelemetry();
        for (let i = 0; i < 15; i++) recordToolCall(tel, 't', { durationMs: 1, success: true });
        assert.equal(getRecentCalls(tel).length, 10);
    });
});

// ─── getErrorCalls ────────────────────────────────────────────────────────────

describe('getErrorCalls', () => {
    it('deve retornar apenas chamadas com erro', () => {
        const tel = createTelemetry();
        recordToolCall(tel, 'ok', { durationMs: 1, success: true });
        recordToolCall(tel, 'fail', { durationMs: 1, success: false, error: 'x' });
        const errors = getErrorCalls(tel);
        assert.equal(errors.length, 1);
        assert.equal(errors[0]?.toolName, 'fail');
    });
});

// ─── getSummary ───────────────────────────────────────────────────────────────

describe('getSummary', () => {
    it('deve retornar sumário correto', () => {
        const tel = createTelemetry();
        recordSessionStart(tel, 'sess-1');
        recordSessionStart(tel, 'sess-2');
        recordSessionEnd(tel, 'sess-1');
        recordToolCall(tel, 'lint', { durationMs: 100, success: true });
        recordToolCall(tel, 'lint', { durationMs: 200, success: true });
        recordToolCall(tel, 'test', { durationMs: 50, success: false });

        const s = getSummary(tel);
        assert.equal(s.totalCalls, 3);
        assert.equal(s.successCalls, 2);
        assert.equal(s.errorCalls, 1);
        assert.ok(Math.abs(s.averageDurationMs - (100 + 200 + 50) / 3) < 0.01);
        assert.equal(s.activeSessions, 1);
        assert.equal(s.totalSessions, 2);
        assert.equal(s.topTools[0]?.toolName, 'lint');
        assert.equal(s.topTools[0]?.count, 2);
    });

    it('deve retornar sumário vazio', () => {
        const s = getSummary(createTelemetry());
        assert.equal(s.totalCalls, 0);
        assert.equal(s.successCalls, 0);
        assert.equal(s.errorCalls, 0);
        assert.equal(s.averageDurationMs, 0);
        assert.equal(s.activeSessions, 0);
        assert.equal(s.totalSessions, 0);
        assert.deepEqual(s.topTools, []);
    });
});

// ─── clearTelemetry ───────────────────────────────────────────────────────────

describe('clearTelemetry', () => {
    it('deve limpar todos os registros', () => {
        const tel = createTelemetry();
        recordToolCall(tel, 't', { durationMs: 1, success: true });
        recordSessionStart(tel, 'sess-1');
        clearTelemetry(tel);
        assert.equal(tel.toolCalls.length, 0);
        assert.equal(tel.sessions.length, 0);
    });

    it('deve preservar maxRecords após clear', () => {
        const tel = createTelemetry({ maxRecords: 42 });
        clearTelemetry(tel);
        assert.equal(tel.maxRecords, 42);
    });
});
