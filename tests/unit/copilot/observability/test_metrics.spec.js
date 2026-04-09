// @ts-check
/**
 * tests/unit/copilot/observability/test_metrics.spec.js
 *
 * Testes para src/copilot/observability/metrics.js — createMetricsStore.
 *
 * F208: counter increment/reset, metric export, memory bounds, summary structure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('#copilot/config/env', () => ({
    COPILOT_LOG_DIR: '/tmp/test-metrics',
    COPILOT_METRICS_SNAPSHOT_INTERVAL: 0, // desabilita snapshot automático
}));

vi.mock('node:fs/promises', () => ({
    appendFile: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
}));

vi.mock('../../../../src/copilot/core/error-handlers.js', () => ({
    logSwallowed: vi.fn(),
}));

vi.mock('../../../../src/copilot/core/timer-registry.js', () => ({
    registerTimer: vi.fn(),
    cancel: vi.fn(),
}));

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('createMetricsStore', () => {
    /** @type {import('../../../../src/copilot/observability/metrics.js').MetricsStore} */
    let store;

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../../../../src/copilot/observability/metrics.js');
        store = mod.createMetricsStore();
    });

    afterEach(() => {
        store.stopPeriodicSnapshot();
    });

    // ── recordToolCall ────────────────────────────────────────────────────

    describe('recordToolCall', () => {
        it('registra tool com sucesso', () => {
            store.recordToolCall('web_fetch', 150, true);
            const summary = store.getSummary();
            expect(summary.tools.web_fetch.totalCalls).toBe(1);
            expect(summary.tools.web_fetch.successCount).toBe(1);
            expect(summary.tools.web_fetch.errorCount).toBe(0);
        });

        it('registra tool com erro', () => {
            store.recordToolCall('web_fetch', 500, false);
            const summary = store.getSummary();
            expect(summary.tools.web_fetch.errorCount).toBe(1);
        });

        it('acumula múltiplas chamadas', () => {
            store.recordToolCall('git_status', 100, true);
            store.recordToolCall('git_status', 200, true);
            store.recordToolCall('git_status', 50, false);
            const summary = store.getSummary();
            expect(summary.tools.git_status.totalCalls).toBe(3);
            expect(summary.tools.git_status.successCount).toBe(2);
            expect(summary.tools.git_status.errorCount).toBe(1);
        });

        it('registra latência no histograma', () => {
            store.recordToolCall('test', 100, true);
            store.recordToolCall('test', 200, true);
            const latency = store.getSummary().tools.test.latency;
            expect(latency.count).toBe(2);
            expect(latency.min).toBe(100);
            expect(latency.max).toBe(200);
        });
    });

    // ── recordUsage ───────────────────────────────────────────────────────

    describe('recordUsage', () => {
        it('acumula tokens por modelo', () => {
            store.recordUsage('gpt-4.1', 100, 50, 10, 5);
            store.recordUsage('gpt-4.1', 200, 100);
            const summary = store.getSummary();
            expect(summary.tokens.inputTokens).toBe(300);
            expect(summary.tokens.outputTokens).toBe(150);
            expect(summary.tokens.cacheReadTokens).toBe(10);
            expect(summary.tokens.cacheWriteTokens).toBe(5);
            expect(summary.tokens.byModel['gpt-4.1']).toBe(150);
        });

        it('separa tokens por modelo', () => {
            store.recordUsage('gpt-4.1', 0, 100);
            store.recordUsage('claude', 0, 200);
            const tokens = store.getSummary().tokens;
            expect(tokens.byModel['gpt-4.1']).toBe(100);
            expect(tokens.byModel['claude']).toBe(200);
        });
    });

    // ── Session counters ──────────────────────────────────────────────────

    describe('session counters', () => {
        it('registra start/end/error/rotation/keepalive/cleanup/handoff', () => {
            store.recordSessionStart();
            store.recordSessionStart();
            store.recordSessionEnd();
            store.recordSessionError();
            store.recordSessionRotation();
            store.recordKeepalivePing();
            store.recordSessionCleanup();
            store.recordHandoff();

            const s = store.getSummary().sessions;
            expect(s.started).toBe(2);
            expect(s.ended).toBe(1);
            expect(s.errors).toBe(1);
            expect(s.rotations).toBe(1);
            expect(s.keepalivePings).toBe(1);
            expect(s.cleanedUp).toBe(1);
            expect(s.handoffs).toBe(1);
        });
    });

    // ── Dialog metrics ────────────────────────────────────────────────────

    describe('dialog metrics', () => {
        it('registra turns, stalls e timeouts', () => {
            store.recordDialogTurn(500, true);
            store.recordDialogTurn(1000, false);
            store.recordDialogStall(2000);
            store.recordDialogTimeout();

            const d = store.getSummary().dialog;
            expect(d.turnsTotal).toBe(2);
            expect(d.turnsSuccess).toBe(1);
            expect(d.stallsTotal).toBe(1);
            expect(d.stallSumMs).toBe(2000);
            expect(d.timeoutsTotal).toBe(1);
            expect(d.turnLatency.count).toBe(2);
        });
    });

    // ── Task metrics ──────────────────────────────────────────────────────

    describe('task metrics', () => {
        it('registra complete/failed com histograma', () => {
            store.recordTaskCompletion(300, true);
            store.recordTaskCompletion(100, false);

            const t = store.getSummary().tasks;
            expect(t.completed).toBe(1);
            expect(t.failed).toBe(1);
            expect(t.taskLatency.count).toBe(2);
        });
    });

    // ── Streaming + Question metrics ──────────────────────────────────────

    describe('streaming and question metrics', () => {
        it('registra streaming chunks', () => {
            store.recordStreamingChunk(50);
            store.recordStreamingChunk(80);
            const s = store.getSummary().streaming;
            expect(s.chunksTotal).toBe(2);
            expect(s.chunkLatency.count).toBe(2);
        });

        it('registra question latency', () => {
            store.recordQuestionLatency(1200);
            const q = store.getSummary().questions;
            expect(q.total).toBe(1);
            expect(q.latency.count).toBe(1);
        });
    });

    // ── Counters e Gauges ─────────────────────────────────────────────────

    describe('counters e gauges', () => {
        it('incrementa counters genéricos', () => {
            store.recordCounter('custom.counter', 5);
            store.recordCounter('custom.counter');
            expect(store.getSummary().counters['custom.counter']).toBe(6);
        });

        it('registra gauges com valor e timestamp', () => {
            store.recordGauge('cpu.usage', 42);
            const gauges = store.getGauges();
            expect(gauges['cpu.usage'].value).toBe(42);
            expect(gauges['cpu.usage'].ts).toBeGreaterThan(0);
        });

        it('gauge sobrescreve valor anterior', () => {
            store.recordGauge('mem', 100);
            store.recordGauge('mem', 200);
            expect(store.getGauges().mem.value).toBe(200);
        });
    });

    // ── getSummary ────────────────────────────────────────────────────────

    describe('getSummary', () => {
        it('retorna estrutura completa com collectedAt', () => {
            const summary = store.getSummary();
            expect(summary).toHaveProperty('tools');
            expect(summary).toHaveProperty('tokens');
            expect(summary).toHaveProperty('sessions');
            expect(summary).toHaveProperty('dialog');
            expect(summary).toHaveProperty('tasks');
            expect(summary).toHaveProperty('streaming');
            expect(summary).toHaveProperty('questions');
            expect(summary).toHaveProperty('counters');
            expect(summary).toHaveProperty('gauges');
            expect(summary.collectedAt).toBeGreaterThan(0);
        });

        it('retorna cópia imutável (shallow clone)', () => {
            store.recordSessionStart();
            const s1 = store.getSummary();
            store.recordSessionStart();
            const s2 = store.getSummary();
            expect(s1.sessions.started).toBe(1);
            expect(s2.sessions.started).toBe(2);
        });
    });

    // ── reset ─────────────────────────────────────────────────────────────

    describe('reset', () => {
        it('zera todos os contadores e histogramas', () => {
            store.recordToolCall('t', 100, true);
            store.recordUsage('m', 50);
            store.recordSessionStart();
            store.recordDialogTurn(200, true);
            store.recordTaskCompletion(100, true);
            store.recordStreamingChunk(10);
            store.recordQuestionLatency(500);
            store.recordCounter('c');
            store.recordGauge('g', 1);

            store.reset();

            const s = store.getSummary();
            expect(Object.keys(s.tools)).toHaveLength(0);
            expect(s.tokens.inputTokens).toBe(0);
            expect(s.sessions.started).toBe(0);
            expect(s.dialog.turnsTotal).toBe(0);
            expect(s.tasks.completed).toBe(0);
            expect(s.streaming.chunksTotal).toBe(0);
            expect(s.questions.total).toBe(0);
            expect(Object.keys(s.counters)).toHaveLength(0);
            expect(Object.keys(s.gauges)).toHaveLength(0);
        });
    });

    // ── defaultMetrics singleton ──────────────────────────────────────────

    describe('defaultMetrics', () => {
        it('exporta singleton com mesma interface', async () => {
            const mod = await import('../../../../src/copilot/observability/metrics.js');
            expect(mod.defaultMetrics).toBeDefined();
            expect(typeof mod.defaultMetrics.recordToolCall).toBe('function');
            expect(typeof mod.defaultMetrics.getSummary).toBe('function');
            expect(typeof mod.defaultMetrics.reset).toBe('function');
        });
    });
});
