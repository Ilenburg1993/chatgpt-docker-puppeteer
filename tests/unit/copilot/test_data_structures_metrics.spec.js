// @ts-check
import { describe, it } from 'node:test';
/**
 * @file Faixa 45 — Data structures & metrics: histogram, ring-buffer, known-models, stats-tracker
 *
 *   Cobre módulos de lógica pura verdadeiramente sem cobertura:
 *
 *   - observability/metrics-histogram.js (157L) — percentile() + createHistogram()
 *   - audit/ring-buffer.js (79L) — AuditRingBuffer
 *   - sdk/models/known-models.js (130L) — KNOWN_MODELS catalog + COST/SPEED tiers
 *   - sdk/models/stats-tracker.js (125L) — ModelStatsTracker
 */

import { describe, expect, it } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. metrics-histogram.js — percentile + createHistogram
// ═══════════════════════════════════════════════════════════════════════════════

describe('F45 — metrics-histogram: percentile()', () => {
    it('retorna 0 para array vazio', async () => {
        const { percentile } = await import('#copilot/observability/metrics-histogram');
        expect(percentile([], 50)).toBe(0);
    });

    it('retorna valor único para array com 1 elemento', async () => {
        const { percentile } = await import('#copilot/observability/metrics-histogram');
        expect(percentile([42], 50)).toBe(42);
        expect(percentile([42], 99)).toBe(42);
    });

    it('calcula p50 corretamente para array par', async () => {
        const { percentile } = await import('#copilot/observability/metrics-histogram');
        // sorted: [1, 2, 3, 4] — p50 = ceil(0.5*4)-1 = idx 1 → 2
        expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    });

    it('calcula p95 para array com 100 elementos', async () => {
        const { percentile } = await import('#copilot/observability/metrics-histogram');
        const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
        const p95 = percentile(sorted, 95);
        expect(p95).toBe(95);
    });

    it('calcula p99 para array com 1000 elementos', async () => {
        const { percentile } = await import('#copilot/observability/metrics-histogram');
        const sorted = Array.from({ length: 1000 }, (_, i) => i);
        const p99 = percentile(sorted, 99);
        expect(p99).toBe(989); // ceil(0.99*1000)-1 = 989
    });
});

describe('F45 — metrics-histogram: createHistogram()', () => {
    it('snapshot vazio retorna zeros', async () => {
        const { createHistogram } = await import('#copilot/observability/metrics-histogram');
        const h = createHistogram(10);
        const snap = h.snapshot();
        expect(snap.count).toBe(0);
        expect(snap.sum).toBe(0);
        expect(snap.min).toBe(0);
        expect(snap.max).toBe(0);
        expect(snap.p50).toBe(0);
    });

    it('record + snapshot reflete valores corretamente', async () => {
        const { createHistogram } = await import('#copilot/observability/metrics-histogram');
        const h = createHistogram(100);
        h.record(10);
        h.record(20);
        h.record(30);
        const snap = h.snapshot();
        expect(snap.count).toBe(3);
        expect(snap.sum).toBe(60);
        expect(snap.min).toBe(10);
        expect(snap.max).toBe(30);
    });

    it('ring buffer: descarta amostras mais antigas quando excede maxSamples', async () => {
        const { createHistogram } = await import('#copilot/observability/metrics-histogram');
        const h = createHistogram(3);
        h.record(100);
        h.record(200);
        h.record(300);
        h.record(400); // remove 100
        const snap = h.snapshot();
        expect(snap.count).toBe(3);
        expect(snap.min).toBe(200);
        expect(snap.max).toBe(400);
    });

    it('sum se mantém correto após evicção (FINDING-P4-1)', async () => {
        const { createHistogram } = await import('#copilot/observability/metrics-histogram');
        const h = createHistogram(2);
        h.record(10);
        h.record(20);
        h.record(30); // evict 10 → sum = 20+30 = 50
        const snap = h.snapshot();
        expect(snap.sum).toBe(50);
    });

    it('p50/p95/p99 corretos para amostra grande', async () => {
        const { createHistogram } = await import('#copilot/observability/metrics-histogram');
        const h = createHistogram(500);
        for (let i = 1; i <= 100; i++) h.record(i);
        const snap = h.snapshot();
        expect(snap.p50).toBe(50);
        expect(snap.p95).toBe(95);
        expect(snap.p99).toBe(99);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. audit/ring-buffer.js — AuditRingBuffer
// ═══════════════════════════════════════════════════════════════════════════════

describe('F45 — AuditRingBuffer', () => {
    it('inicia vazio com size=0 e total=0', async () => {
        const { AuditRingBuffer } = await import('#copilot/audit/ring-buffer');
        const buf = new AuditRingBuffer({ capacity: 5 });
        expect(buf.size).toBe(0);
        expect(buf.total).toBe(0);
    });

    it('push incrementa size e total', async () => {
        const { AuditRingBuffer } = await import('#copilot/audit/ring-buffer');
        const buf = new AuditRingBuffer({ capacity: 5 });
        buf.push('a');
        buf.push('b');
        expect(buf.size).toBe(2);
        expect(buf.total).toBe(2);
    });

    it('tail() retorna entradas em ordem cronológica', async () => {
        const { AuditRingBuffer } = await import('#copilot/audit/ring-buffer');
        const buf = new AuditRingBuffer({ capacity: 10 });
        buf.push(1);
        buf.push(2);
        buf.push(3);
        expect(buf.tail(10)).toEqual([1, 2, 3]);
    });

    it('tail(n) limita a N entradas mais recentes', async () => {
        const { AuditRingBuffer } = await import('#copilot/audit/ring-buffer');
        const buf = new AuditRingBuffer({ capacity: 10 });
        for (let i = 1; i <= 5; i++) buf.push(i);
        expect(buf.tail(2)).toEqual([4, 5]);
    });

    it('sobrescreve entradas antigas quando excede capacity', async () => {
        const { AuditRingBuffer } = await import('#copilot/audit/ring-buffer');
        const buf = new AuditRingBuffer({ capacity: 3 });
        buf.push('a');
        buf.push('b');
        buf.push('c');
        buf.push('d'); // sobrescreve 'a'
        expect(buf.total).toBe(4);
        expect(buf.size).toBe(3);
        expect(buf.tail(10)).toEqual(['b', 'c', 'd']);
    });

    it('clear() reseta o buffer', async () => {
        const { AuditRingBuffer } = await import('#copilot/audit/ring-buffer');
        const buf = new AuditRingBuffer({ capacity: 5 });
        buf.push(1);
        buf.push(2);
        buf.clear();
        expect(buf.size).toBe(0);
        expect(buf.total).toBe(0);
        expect(buf.tail(10)).toEqual([]);
    });

    it('capacity default é 500', async () => {
        const { AuditRingBuffer } = await import('#copilot/audit/ring-buffer');
        const buf = new AuditRingBuffer();
        // Push 501 to verify capacity
        for (let i = 0; i < 501; i++) buf.push(i);
        expect(buf.size).toBe(500);
        expect(buf.total).toBe(501);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. sdk/models/known-models.js — Catálogo estático
// ═══════════════════════════════════════════════════════════════════════════════

describe('F45 — KNOWN_MODELS catalog', () => {
    it('KNOWN_MODELS é frozen array com >= 10 modelos', async () => {
        const { KNOWN_MODELS } = await import('#copilot/sdk/models/known-models');
        expect(Array.isArray(KNOWN_MODELS)).toBe(true);
        expect(KNOWN_MODELS.length).toBeGreaterThanOrEqual(10);
        expect(Object.isFrozen(KNOWN_MODELS)).toBe(true);
    });

    it('todos os modelos têm campos obrigatórios', async () => {
        const { KNOWN_MODELS } = await import('#copilot/sdk/models/known-models');
        for (const m of KNOWN_MODELS) {
            expect(m.id).toBeDefined();
            expect(m.costTier).toBeDefined();
            expect(m.speedTier).toBeDefined();
            expect(typeof m.contextWindow).toBe('number');
            expect(typeof m.supportsReasoning).toBe('boolean');
            expect(typeof m.supportsVision).toBe('boolean');
            expect(Array.isArray(m.aliases)).toBe(true);
        }
    });

    it('IDs são únicos', async () => {
        const { KNOWN_MODELS } = await import('#copilot/sdk/models/known-models');
        const ids = KNOWN_MODELS.map((m) => m.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('COST_ORDER possui todas as tiers', async () => {
        const { COST_ORDER } = await import('#copilot/sdk/models/known-models');
        expect(COST_ORDER.free).toBeDefined();
        expect(COST_ORDER.low).toBeDefined();
        expect(COST_ORDER.medium).toBeDefined();
        expect(COST_ORDER.high).toBeDefined();
        expect(COST_ORDER.premium).toBeDefined();
        expect(COST_ORDER.free).toBeLessThan(COST_ORDER.premium);
    });

    it('SPEED_ORDER possui todas as tiers', async () => {
        const { SPEED_ORDER } = await import('#copilot/sdk/models/known-models');
        expect(SPEED_ORDER.slow).toBeDefined();
        expect(SPEED_ORDER.medium).toBeDefined();
        expect(SPEED_ORDER.fast).toBeDefined();
        expect(SPEED_ORDER.slow).toBeLessThan(SPEED_ORDER.fast);
    });

    it('modelos com reasoning têm contextWindow >= 200_000', async () => {
        const { KNOWN_MODELS } = await import('#copilot/sdk/models/known-models');
        const reasoningModels = KNOWN_MODELS.filter((m) => m.supportsReasoning);
        expect(reasoningModels.length).toBeGreaterThan(0);
        for (const m of reasoningModels) {
            expect(m.contextWindow).toBeGreaterThanOrEqual(200_000);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. sdk/models/stats-tracker.js — ModelStatsTracker
// ═══════════════════════════════════════════════════════════════════════════════

describe('F45 — ModelStatsTracker', () => {
    it('getStats retorna null para modelo sem dados', async () => {
        const { ModelStatsTracker } = await import('#copilot/sdk/models/stats-tracker');
        const tracker = new ModelStatsTracker();
        expect(tracker.getStats('gpt-4o')).toBeNull();
    });

    it('record + getStats retorna métricas corretas', async () => {
        const { ModelStatsTracker } = await import('#copilot/sdk/models/stats-tracker');
        const tracker = new ModelStatsTracker();
        tracker.record('gpt-4o', { latencyMs: 100, success: true, inputTokens: 50, outputTokens: 100 });
        tracker.record('gpt-4o', { latencyMs: 200, success: true, inputTokens: 30, outputTokens: 70 });
        tracker.record('gpt-4o', { latencyMs: 300, success: false });
        const stats = tracker.getStats('gpt-4o');
        expect(stats).not.toBeNull();
        expect(stats?.totalCalls).toBe(3);
        expect(stats?.avgLatencyMs).toBe(200); // (100+200+300)/3
        expect(stats?.successRate).toBeCloseTo(2 / 3);
        expect(stats?.totalTokens).toBe(250); // 50+100+30+70
    });

    it('allStats retorna array de todos os modelos', async () => {
        const { ModelStatsTracker } = await import('#copilot/sdk/models/stats-tracker');
        const tracker = new ModelStatsTracker();
        tracker.record('gpt-4o', { latencyMs: 100, success: true });
        tracker.record('o3', { latencyMs: 500, success: true, inputTokens: 100, outputTokens: 200 });
        const all = tracker.allStats();
        expect(all).toHaveLength(2);
        expect(all.map((s) => s.modelId).sort()).toEqual(['gpt-4o', 'o3']);
    });

    it('allStats ignora modelos com 0 calls', async () => {
        const { ModelStatsTracker } = await import('#copilot/sdk/models/stats-tracker');
        const tracker = new ModelStatsTracker();
        tracker._getOrCreate('gpt-4o'); // empty
        expect(tracker.allStats()).toHaveLength(0);
    });

    it('reset() limpa todas as estatísticas', async () => {
        const { ModelStatsTracker } = await import('#copilot/sdk/models/stats-tracker');
        const tracker = new ModelStatsTracker();
        tracker.record('gpt-4o', { latencyMs: 100, success: true });
        tracker.reset();
        expect(tracker.getStats('gpt-4o')).toBeNull();
        expect(tracker.allStats()).toHaveLength(0);
    });

    it('record acumula inputTokens e outputTokens default 0', async () => {
        const { ModelStatsTracker } = await import('#copilot/sdk/models/stats-tracker');
        const tracker = new ModelStatsTracker();
        tracker.record('gpt-4o', { latencyMs: 50, success: true }); // no tokens
        const stats = tracker.getStats('gpt-4o');
        expect(stats?.totalTokens).toBe(0);
    });
});
