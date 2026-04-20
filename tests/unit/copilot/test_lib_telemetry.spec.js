// @ts-check
/**
 * tests/unit/copilot/test_lib_telemetry.spec.js
 *
 * Testes unitários da API de telemetria migrada → src/copilot/observability/metrics.js.
 *
 * Substituição canônica de `lib/telemetry.js` (deletado). Cobre createMetricsStore + todas as funções de registro.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { createMetricsStore } from '../../../src/copilot/observability/metrics.js';

// ─── createMetricsStore ───────────────────────────────────────────────────────

describe('createMetricsStore', () => {
    it('deve criar store vazio com getSummary retornando zeros', () => {
        const m = createMetricsStore();
        const s = m.getSummary();
        assert.deepEqual(s.tools, {});
        assert.equal(s.sessions.started, 0);
        assert.equal(s.sessions.ended, 0);
        assert.equal(s.sessions.errors, 0);
        assert.equal(s.dialog.turnsTotal, 0);
        assert.equal(s.tasks.completed, 0);
    });

    it('deve criar instâncias independentes', () => {
        const a = createMetricsStore();
        const b = createMetricsStore();
        a.recordToolCall('lint', 100, true);
        assert.deepEqual(b.getSummary().tools, {});
    });
});

// ─── recordToolCall ───────────────────────────────────────────────────────────

describe('recordToolCall', () => {
    it('deve registrar chamada bem-sucedida', () => {
        const m = createMetricsStore();
        m.recordToolCall('lint', 120, true);
        const s = m.getSummary();
        assert.equal(s.tools['lint']?.totalCalls, 1);
        assert.equal(s.tools['lint']?.successCount, 1);
        assert.equal(s.tools['lint']?.errorCount, 0);
    });

    it('deve registrar chamada com erro', () => {
        const m = createMetricsStore();
        m.recordToolCall('test', 50, false);
        const s = m.getSummary();
        assert.equal(s.tools['test']?.errorCount, 1);
        assert.equal(s.tools['test']?.successCount, 0);
    });

    it('deve acumular chamadas da mesma ferramenta', () => {
        const m = createMetricsStore();
        m.recordToolCall('lint', 100, true);
        m.recordToolCall('lint', 200, true);
        m.recordToolCall('lint', 50, false);
        const s = m.getSummary();
        assert.equal(s.tools['lint']?.totalCalls, 3);
        assert.equal(s.tools['lint']?.successCount, 2);
        assert.equal(s.tools['lint']?.errorCount, 1);
    });

    it('deve registrar múltiplas ferramentas independentes', () => {
        const m = createMetricsStore();
        m.recordToolCall('lint', 100, true);
        m.recordToolCall('test', 200, true);
        const s = m.getSummary();
        assert.equal(s.tools['lint']?.totalCalls, 1);
        assert.equal(s.tools['test']?.totalCalls, 1);
    });

    it('deve ter latency snapshot disponível', () => {
        const m = createMetricsStore();
        m.recordToolCall('lint', 100, true);
        const s = m.getSummary();
        const latency = s.tools['lint']?.latency;
        assert.ok(typeof latency === 'object' && latency !== null, 'latency deve ser um objeto');
    });
});

// ─── recordSessionStart / recordSessionEnd ────────────────────────────────────

describe('recordSessionStart', () => {
    it('deve incrementar contador de sessões iniciadas', () => {
        const m = createMetricsStore();
        m.recordSessionStart();
        const s = m.getSummary();
        assert.equal(s.sessions.started, 1);
    });

    it('deve acumular múltiplos starts', () => {
        const m = createMetricsStore();
        m.recordSessionStart();
        m.recordSessionStart();
        m.recordSessionStart();
        assert.equal(m.getSummary().sessions.started, 3);
    });
});

describe('recordSessionEnd', () => {
    it('deve incrementar contador de sessões encerradas', () => {
        const m = createMetricsStore();
        m.recordSessionStart();
        m.recordSessionEnd();
        const s = m.getSummary();
        assert.equal(s.sessions.ended, 1);
    });

    it('deve ser independente do start', () => {
        const m = createMetricsStore();
        m.recordSessionEnd();
        assert.equal(m.getSummary().sessions.ended, 1);
    });
});

describe('recordSessionError', () => {
    it('deve incrementar contador de sessions com erro', () => {
        const m = createMetricsStore();
        m.recordSessionError();
        assert.equal(m.getSummary().sessions.errors, 1);
    });
});

// ─── recordDialogTurn ─────────────────────────────────────────────────────────

describe('recordDialogTurn', () => {
    it('deve incrementar turnsTotal', () => {
        const m = createMetricsStore();
        m.recordDialogTurn(100, true);
        assert.equal(m.getSummary().dialog.turnsTotal, 1);
        assert.equal(m.getSummary().dialog.turnsSuccess, 1);
    });

    it('deve contabilizar turn com falha', () => {
        const m = createMetricsStore();
        m.recordDialogTurn(50, false);
        const s = m.getSummary();
        assert.equal(s.dialog.turnsTotal, 1);
        assert.equal(s.dialog.turnsSuccess, 0);
    });

    it('deve acumular múltiplos turns', () => {
        const m = createMetricsStore();
        m.recordDialogTurn(100, true);
        m.recordDialogTurn(200, true);
        m.recordDialogTurn(50, false);
        const s = m.getSummary();
        assert.equal(s.dialog.turnsTotal, 3);
        assert.equal(s.dialog.turnsSuccess, 2);
    });
});

// ─── recordDialogStall / recordDialogTimeout ──────────────────────────────────

describe('recordDialogStall', () => {
    it('deve incrementar stallsTotal', () => {
        const m = createMetricsStore();
        m.recordDialogStall(5000);
        assert.equal(m.getSummary().dialog.stallsTotal, 1);
    });
});

describe('recordDialogTimeout', () => {
    it('deve incrementar timeoutsTotal', () => {
        const m = createMetricsStore();
        m.recordDialogTimeout();
        assert.equal(m.getSummary().dialog.timeoutsTotal, 1);
    });
});

// ─── recordTaskCompletion ─────────────────────────────────────────────────────

describe('recordTaskCompletion', () => {
    it('deve incrementar tasks.completed quando success=true', () => {
        const m = createMetricsStore();
        m.recordTaskCompletion(1000, true);
        assert.equal(m.getSummary().tasks.completed, 1);
        assert.equal(m.getSummary().tasks.failed, 0);
    });

    it('deve incrementar tasks.failed quando success=false', () => {
        const m = createMetricsStore();
        m.recordTaskCompletion(500, false);
        assert.equal(m.getSummary().tasks.failed, 1);
        assert.equal(m.getSummary().tasks.completed, 0);
    });
});

// ─── recordCounter ────────────────────────────────────────────────────────────

describe('recordCounter', () => {
    it('deve incrementar contador personalizado', () => {
        const m = createMetricsStore();
        m.recordCounter('reconnects');
        m.recordCounter('reconnects');
        assert.equal(m.getSummary().counters['reconnects'], 2);
    });

    it('deve incrementar por valor fornecido', () => {
        const m = createMetricsStore();
        m.recordCounter('events', 5);
        assert.equal(m.getSummary().counters['events'], 5);
    });

    it('deve criar contador novo ao primeiro uso', () => {
        const m = createMetricsStore();
        m.recordCounter('novo');
        assert.equal(m.getSummary().counters['novo'], 1);
    });
});

// ─── getSummary ───────────────────────────────────────────────────────────────

describe('getSummary', () => {
    it('deve retornar sumário com todas as seções esperadas', () => {
        const m = createMetricsStore();
        const s = m.getSummary();
        assert.ok('tools' in s, 'deve ter seção tools');
        assert.ok('tokens' in s, 'deve ter seção tokens');
        assert.ok('sessions' in s, 'deve ter seção sessions');
        assert.ok('dialog' in s, 'deve ter seção dialog');
        assert.ok('tasks' in s, 'deve ter seção tasks');
        assert.ok('counters' in s, 'deve ter seção counters');
        assert.ok('collectedAt' in s, 'deve ter collectedAt');
    });

    it('deve retornar sumário com dados corretos após operações', () => {
        const m = createMetricsStore();
        m.recordSessionStart();
        m.recordSessionStart();
        m.recordSessionEnd();
        m.recordToolCall('lint', 100, true);
        m.recordToolCall('lint', 200, true);
        m.recordToolCall('test', 50, false);
        m.recordDialogTurn(150, true);

        const s = m.getSummary();
        assert.equal(s.sessions.started, 2);
        assert.equal(s.sessions.ended, 1);
        assert.equal(s.tools['lint']?.totalCalls, 2);
        assert.equal(s.tools['lint']?.successCount, 2);
        assert.equal(s.tools['test']?.totalCalls, 1);
        assert.equal(s.tools['test']?.errorCount, 1);
        assert.equal(s.dialog.turnsTotal, 1);
        assert.equal(s.dialog.turnsSuccess, 1);
    });

    it('deve retornar sumário vazio para store novo', () => {
        const s = createMetricsStore().getSummary();
        assert.deepEqual(s.tools, {});
        assert.equal(s.sessions.started, 0);
        assert.equal(s.sessions.ended, 0);
        assert.equal(s.dialog.turnsTotal, 0);
        assert.equal(s.tasks.completed, 0);
    });

    it('deve incluir collectedAt como timestamp recente', () => {
        const before = Date.now();
        const m = createMetricsStore();
        const s = m.getSummary();
        const after = Date.now();
        assert.ok(s.collectedAt >= before && s.collectedAt <= after);
    });
});

// ─── reset ────────────────────────────────────────────────────────────────────

describe('reset', () => {
    it('deve limpar todos os contadores', () => {
        const m = createMetricsStore();
        m.recordSessionStart();
        m.recordToolCall('lint', 100, true);
        m.recordDialogTurn(50, true);
        m.recordTaskCompletion(100, true);
        m.recordCounter('x');
        m.reset();
        const s = m.getSummary();
        assert.deepEqual(s.tools, {});
        assert.equal(s.sessions.started, 0);
        assert.equal(s.sessions.ended, 0);
        assert.equal(s.dialog.turnsTotal, 0);
        assert.equal(s.tasks.completed, 0);
        assert.deepEqual(s.counters, {});
    });

    it('deve permitir registros após reset', () => {
        const m = createMetricsStore();
        m.recordToolCall('a', 10, true);
        m.reset();
        m.recordToolCall('b', 20, true);
        const s = m.getSummary();
        assert.equal(s.tools['b']?.totalCalls, 1);
        assert.ok(!s.tools['a'], 'ferramentas pré-reset não devem aparecer');
    });
});

// ─── recordUsage ──────────────────────────────────────────────────────────────

describe('recordUsage', () => {
    it('deve acumular tokens de entrada e saída', () => {
        const m = createMetricsStore();
        m.recordUsage('gpt-4.1', 100, 50);
        const s = m.getSummary();
        assert.equal(s.tokens.inputTokens, 100);
        assert.equal(s.tokens.outputTokens, 50);
    });

    it('deve acumular tokens de múltiplas chamadas', () => {
        const m = createMetricsStore();
        m.recordUsage('gpt-4.1', 100, 50);
        m.recordUsage('gpt-4.1', 200, 75);
        const s = m.getSummary();
        assert.equal(s.tokens.inputTokens, 300);
        assert.equal(s.tokens.outputTokens, 125);
    });

    it('deve rastrear tokens por modelo', () => {
        const m = createMetricsStore();
        m.recordUsage('gpt-4.1', 100, 50);
        m.recordUsage('gpt-4o', 200, 75);
        const s = m.getSummary();
        assert.ok(s.tokens.byModel['gpt-4.1'], 'deve ter entrada para gpt-4.1');
        assert.ok(s.tokens.byModel['gpt-4o'], 'deve ter entrada para gpt-4o');
    });

    it('deve aceitar tokens de cache', () => {
        const m = createMetricsStore();
        m.recordUsage('m', 0, 0, 500, 200);
        const s = m.getSummary();
        assert.equal(s.tokens.cacheReadTokens, 500);
        assert.equal(s.tokens.cacheWriteTokens, 200);
    });
});
