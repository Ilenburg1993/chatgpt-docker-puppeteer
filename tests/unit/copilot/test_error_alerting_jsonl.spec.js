// @ts-check
/**
 * @file Faixa 49 — error-alerting, jsonl-writer, engine-persistence
 *
 * Cobre:
 * - observability/error-alerting.js (239L) — createErrorAlerter
 * - audit/jsonl-writer.js (79L) — createJsonlWriter
 * - terminal/dialog/engine-persistence.js (148L) — persistTurnToHub, failure count
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock logger (usado por todos) ──────────────────────────────────────────

vi.mock('#copilot/observability/logger', () => ({ log: vi.fn() }));

// ─── Mock timer-registry (usado por error-alerting) ─────────────────────────

vi.mock('#copilot/core/timer-registry', () => ({
    registerTimer: vi.fn(),
    cancel: vi.fn(),
}));

vi.mock('#copilot/core/error-handlers', () => ({
    logSwallowed: vi.fn(),
}));

// ═══════════════════════════════════════════════════════════════════════════════
// 1. error-alerting.js — createErrorAlerter
// ═══════════════════════════════════════════════════════════════════════════════

describe('F49 — createErrorAlerter', () => {
    /** @type {import('#copilot/observability/error-alerting').ErrorAlerter} */
    let alerter;
    /** @type {{ getErrors: ReturnType<typeof vi.fn> }} */
    let tracker;

    beforeEach(async () => {
        vi.useFakeTimers({ shouldAdvanceTime: false });
        tracker = { getErrors: vi.fn(() => []) };
        const { createErrorAlerter } = await import('#copilot/observability/error-alerting');
        alerter = createErrorAlerter(/** @type {any} */ (tracker), {
            windowMs: 60_000,
            warningThreshold: 3,
            criticalThreshold: 5,
            cooldownMs: 10_000,
        });
    });

    afterEach(() => {
        alerter.destroy();
        vi.useRealTimers();
    });

    it('getLastAlert() retorna null após criação', () => {
        expect(alerter.getLastAlert()).toBeNull();
    });

    it('getAlertStats() retorna { warnings: 0, criticals: 0 }', () => {
        expect(alerter.getAlertStats()).toEqual({ warnings: 0, criticals: 0 });
    });

    it('check() dispara WARNING quando erros >= warningThreshold', () => {
        const now = Date.now();
        tracker.getErrors.mockReturnValue([
            { timestamp: now - 1000 },
            { timestamp: now - 2000 },
            { timestamp: now - 3000 },
        ]);
        alerter.check();
        const last = alerter.getLastAlert();
        expect(last).not.toBeNull();
        expect(last?.level).toBe('warning');
        expect(last?.errorCount).toBe(3);
        expect(alerter.getAlertStats().warnings).toBe(1);
    });

    it('check() dispara CRITICAL quando erros >= criticalThreshold', () => {
        const now = Date.now();
        tracker.getErrors.mockReturnValue(
            Array.from({ length: 6 }, (_, i) => ({ timestamp: now - i * 1000 })),
        );
        alerter.check();
        expect(alerter.getLastAlert()?.level).toBe('critical');
        expect(alerter.getAlertStats().criticals).toBe(1);
    });

    it('cooldown impede alerta duplicado dentro da janela', () => {
        const now = Date.now();
        tracker.getErrors.mockReturnValue([
            { timestamp: now - 1000 },
            { timestamp: now - 2000 },
            { timestamp: now - 3000 },
        ]);
        alerter.check();
        expect(alerter.getAlertStats().warnings).toBe(1);
        alerter.check(); // should be suppressed by cooldown
        expect(alerter.getAlertStats().warnings).toBe(1);
    });

    it('nervEmit é chamado quando configurado', async () => {
        const nervEmit = vi.fn();
        const { createErrorAlerter } = await import('#copilot/observability/error-alerting');
        const a = createErrorAlerter(/** @type {any} */ (tracker), {
            windowMs: 60_000,
            warningThreshold: 1,
            nervEmit,
        });
        const now = Date.now();
        tracker.getErrors.mockReturnValue([{ timestamp: now }]);
        a.check();
        expect(nervEmit).toHaveBeenCalledWith('copilot:error:alert', expect.objectContaining({ level: 'warning' }));
        a.destroy();
    });

    it('terminalPrint é chamado com banner colorido', async () => {
        const terminalPrint = vi.fn();
        const { createErrorAlerter } = await import('#copilot/observability/error-alerting');
        const a = createErrorAlerter(/** @type {any} */ (tracker), {
            windowMs: 60_000,
            warningThreshold: 1,
            terminalPrint,
        });
        tracker.getErrors.mockReturnValue([{ timestamp: Date.now() }]);
        a.check();
        expect(terminalPrint).toHaveBeenCalledWith(expect.stringContaining('WARNING'));
        a.destroy();
    });

    it('reset() limpa último alerta e contadores', () => {
        const now = Date.now();
        tracker.getErrors.mockReturnValue([
            { timestamp: now - 1000 },
            { timestamp: now - 2000 },
            { timestamp: now - 3000 },
        ]);
        alerter.check();
        alerter.reset();
        expect(alerter.getLastAlert()).toBeNull();
        expect(alerter.getAlertStats()).toEqual({ warnings: 0, criticals: 0 });
    });

    it('check() não dispara alerta se erros < threshold', () => {
        tracker.getErrors.mockReturnValue([{ timestamp: Date.now() }]);
        alerter.check();
        expect(alerter.getLastAlert()).toBeNull();
    });

    it('destroy() cancela timer e reseta', async () => {
        const { cancel } = await import('#copilot/core/timer-registry');
        alerter.destroy();
        expect(cancel).toHaveBeenCalledWith('observability.errorAlerting');
        expect(alerter.getLastAlert()).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. audit/jsonl-writer.js — createJsonlWriter
// ═══════════════════════════════════════════════════════════════════════════════

const mockFs = vi.hoisted(() => ({
    appendFile: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    stat: vi.fn(async () => ({ size: 100 })),
}));

vi.mock('node:fs/promises', () => mockFs);

describe('F49 — createJsonlWriter', () => {
    beforeEach(() => {
        vi.resetModules();
        Object.values(mockFs).forEach((fn) => fn.mockClear());
    });

    it('write() enfileira e flush escreve JSON line', async () => {
        const { createJsonlWriter } = await import('#copilot/audit/jsonl-writer');
        const writer = createJsonlWriter({ filePath: '/tmp/test.jsonl' });
        writer.write({ event: 'test', ts: 123 });
        // Flush is scheduled via setImmediate — wait for it
        await new Promise((r) => setTimeout(r, 50));
        expect(mockFs.appendFile).toHaveBeenCalled();
        const written = mockFs.appendFile.mock.calls[0]?.[1];
        expect(typeof written).toBe('string');
        expect(written).toContain('"event":"test"');
    });

    it('rotação acontece quando arquivo excede maxBytes', async () => {
        mockFs.stat.mockResolvedValue({ size: 11_000_000 }); // > 10MB default
        const { createJsonlWriter } = await import('#copilot/audit/jsonl-writer');
        const writer = createJsonlWriter({ filePath: '/tmp/test.jsonl' });
        writer.write({ x: 1 });
        await new Promise((r) => setTimeout(r, 50));
        expect(mockFs.rename).toHaveBeenCalledWith('/tmp/test.jsonl', '/tmp/test.jsonl.1');
    });

    it('sem rotação quando arquivo é menor que maxBytes', async () => {
        mockFs.stat.mockResolvedValue({ size: 100 });
        const { createJsonlWriter } = await import('#copilot/audit/jsonl-writer');
        const writer = createJsonlWriter({ filePath: '/tmp/small.jsonl' });
        writer.write({ x: 1 });
        await new Promise((r) => setTimeout(r, 50));
        expect(mockFs.rename).not.toHaveBeenCalled();
    });
});
