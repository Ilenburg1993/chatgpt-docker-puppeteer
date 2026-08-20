// @ts-check
/**
 * @file Faixa 49 — error-alerting, jsonl-writer, engine-persistence
 *
 *   Cobre:
 *
 *   - observability/error-alerting.js (239L) — createErrorAlerter
 *   - audit/jsonl-writer.js (79L) — createJsonlWriter
 *   - terminal/dialog/engine-persistence.js (148L) — persistTurnToHub, failure count
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const timerMocks = vi.hoisted(() => ({
    registerInterval: vi.fn((id, _fn) => ({ id, unref: vi.fn() })),
    cancelTimer: vi.fn(),
}));

// ─── Mock logger (usado por todos) ──────────────────────────────────────────

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

vi.mock('#copilot/core', async (importOriginal) => ({
    .../** @type {any} */ (await importOriginal()),
    registerInterval: timerMocks.registerInterval,
    cancelTimer: timerMocks.cancelTimer,
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
        timerMocks.registerInterval.mockClear();
        timerMocks.cancelTimer.mockClear();
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
        tracker.getErrors.mockReturnValue(Array.from({ length: 6 }, (_, i) => ({ timestamp: now - i * 1000 })));
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
        alerter.destroy();
        expect(timerMocks.cancelTimer).toHaveBeenCalledWith(expect.stringMatching(/^observability\.errorAlerting:/u));
        expect(alerter.getLastAlert()).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. audit/jsonl-writer.js — createJsonlWriter
// ═══════════════════════════════════════════════════════════════════════════════

describe('F49 — createJsonlWriter', () => {
    /** @type {typeof import('#copilot/audit/jsonl-writer')} */
    let jsonlMod;
    /** @type {string[]} */
    const tempDirs = [];

    beforeAll(async () => {
        jsonlMod = await import('#copilot/audit/jsonl-writer');
    });

    afterEach(async () => {
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop();
            if (dir) await rm(dir, { recursive: true, force: true });
        }
    });

    async function tempPath(/** @type {string} */ name) {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-audit-jsonl-'));
        tempDirs.push(dir);
        return join(dir, name);
    }

    it('write + flush publica uma linha JSONL e getState observa a fila drenada', async () => {
        const filePath = await tempPath('audit.jsonl');
        const writer = jsonlMod.createJsonlWriter({ filePath });

        writer.write({ event: 'test', ts: 123 });
        await writer.flush();

        const persisted = await readFile(filePath, 'utf8');
        expect(persisted).toContain('"event":"test"');
        expect(persisted).toContain('"ts":123');
        expect(writer.getState()).toMatchObject({ queueDepth: 0, persistedLines: 1 });
    });

    it('redige segredos antes da persistência observável', async () => {
        const githubToken = 'ghs_abcdefghijklmnopqrstuvwxyz1234567890';
        const byokToken = 'sk-testsecret1234567890';
        const filePath = await tempPath('redacted.jsonl');
        const writer = jsonlMod.createJsonlWriter({ filePath });

        writer.write({
            gitHubToken: githubToken,
            headers: { Authorization: `Bearer ${byokToken}` },
            tokens: 42,
        });
        await writer.flush();

        const persisted = await readFile(filePath, 'utf8');
        expect(persisted).not.toContain(githubToken);
        expect(persisted).not.toContain(byokToken);
        expect(persisted).toContain('[redacted]');
        expect(persisted).toContain('"tokens":42');
    });
});
