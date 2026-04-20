// @ts-check
/**
 * tests/unit/copilot/sdk/test_sdk_observability_f21.spec.js
 *
 * Faixa 21 — Observability Integration: typed events, quota monitor, auth status.
 *
 * F113: event-collector usa onSessionEvent (typed events bridge) F114: (removido — nerv-bridge.js excluído em L36)
 * F115: quota-monitor.js — polling periódico com callbacks F116: health.js — checkAuthStatus exposto no barrel +
 * healthGetAuthStatus alias F117: integração typed events → quota → auth
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { readFileSync } = require('node:fs');

const ROOT = process.cwd();
const SRC_COPILOT = join(ROOT, 'src/copilot');

/**
 * @param {string} relPath
 * @returns {string}
 */
function readSource(relPath) {
    return readFileSync(join(SRC_COPILOT, relPath), 'utf8');
}

// ─── F113: event-collector usa onSessionEvent ─────────────────────────────────

describe('F21 — F113: event-collector usa onSessionEvent typed', () => {
    it('event-collector.js importa onSessionEvent de #copilot/sdk (barrel ou events.js)', () => {
        const src = readSource('observability/event-collector.js');
        expect(src).toMatch(/from '#copilot\/sdk(?:\/events\.js)?'/);
        expect(src).toContain('onSessionEvent');
    });

    it('event-collector.js exporta attachSdkEventTyped', () => {
        const src = readSource('observability/event-collector.js');
        expect(src).toContain('export function attachSdkEventTyped');
    });

    it('attachSdkEventTyped delega para onSessionEvent', () => {
        const src = readSource('observability/event-collector.js');
        const fn = src.match(/function attachSdkEventTyped[\s\S]{0,200}}/);
        expect(fn).not.toBeNull();
        expect(fn?.[0]).toContain('onSessionEvent');
    });

    it('event-collector.js preserva export attachSdkEventTyped com assinatura correta', () => {
        const src = readSource('observability/event-collector.js');
        // Deve ter 3 params: session, eventType, handler
        expect(src).toMatch(/attachSdkEventTyped\s*\(session,\s*eventType,\s*handler\)/);
    });
});

// ─── F114: nerv-bridge removido (L36) — testes migrados para nerv-event-bus-adapter ──

// ─── F115: quota-monitor.js ───────────────────────────────────────────────────

describe('F21 — F115: createQuotaMonitor', () => {
    /** @type {ReturnType<typeof vi.fn>} */
    let mockAccountGetQuota;

    beforeEach(() => {
        mockAccountGetQuota = vi.fn().mockResolvedValue({
            quotaSnapshots: {
                chat: {
                    remainingPercentage: 75,
                    usedRequests: 25,
                    entitlementRequests: 100,
                    overage: 0,
                    overageAllowedWithExhaustedQuota: false,
                },
            },
        });
        vi.doMock('#copilot/sdk/server-rpc', () => ({ accountGetQuota: mockAccountGetQuota }));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('quota-monitor.js existe', () => {
        const { existsSync } = require('node:fs');
        expect(existsSync(join(SRC_COPILOT, 'sdk/quota-monitor.js'))).toBe(true);
    });

    it('quota-monitor.js exporta createQuotaMonitor', () => {
        const src = readSource('sdk/quota-monitor.js');
        expect(src).toContain('export function createQuotaMonitor');
    });

    it('createQuotaMonitor lança TypeError se client inválido', async () => {
        const { createQuotaMonitor } = await import('../../../../src/copilot/sdk/telemetry/quota-monitor.js');
        expect(() => createQuotaMonitor(/** @type {any} */ ({ client: null }))).toThrow(TypeError);
    });

    it('createQuotaMonitor lança RangeError se intervalMs < 1000', async () => {
        const { createQuotaMonitor } = await import('../../../../src/copilot/sdk/telemetry/quota-monitor.js');
        expect(() => createQuotaMonitor(/** @type {any} */ ({ client: {}, intervalMs: 500 }))).toThrow(RangeError);
    });

    it('monitor.status() retorna running=false antes de start()', async () => {
        const { createQuotaMonitor } = await import('../../../../src/copilot/sdk/telemetry/quota-monitor.js');
        const monitor = createQuotaMonitor(/** @type {any} */ ({ client: { rpc: {} }, intervalMs: 60_000 }));
        const s = monitor.status();
        expect(s.running).toBe(false);
        expect(s.ts).toBe(0);
    });

    it('createQuotaMonitor suporta callbacks onUpdate e onWarning (interface)', () => {
        const src = readSource('sdk/quota-monitor.js');
        expect(src).toContain('onUpdate');
        expect(src).toContain('onWarning');
        expect(src).toContain('warningThreshold');
    });
});

// ─── F116: checkAuthStatus no barrel ─────────────────────────────────────────

describe('F21 — F116: checkAuthStatus no barrel e health.js', () => {
    it('sdk/index.js exporta checkAuthStatus', () => {
        const src = readSource('sdk/index.js');
        expect(src).toMatch(/checkAuthStatus/);
    });

    it('sdk/index.js exporta createQuotaMonitor', () => {
        const src = readSource('sdk/index.js');
        expect(src).toContain('createQuotaMonitor');
    });

    it('sdk/index.js mantém healthGetAuthStatus (backward compat)', () => {
        const src = readSource('sdk/index.js');
        expect(src).toContain('healthGetAuthStatus');
    });

    it('health.js tem getAuthStatus implementado', () => {
        const src = readSource('sdk/health.js');
        expect(src).toContain('export async function getAuthStatus');
    });

    it('health.js getAuthStatus delega para accountGetQuota (proxy de auth)', () => {
        const src = readSource('sdk/health.js');
        // Verifica que getAuthStatus existe e chama accountGetQuota
        expect(src).toContain('export async function getAuthStatus');
        // A ordem de aparição garante que está dentro da função (getAuthStatus antes de accountGetQuota no corpo)
        const getAuthIdx = src.indexOf('export async function getAuthStatus');
        const accountGetQuotaIdx = src.indexOf('await accountGetQuota(client)', getAuthIdx);
        expect(accountGetQuotaIdx).toBeGreaterThan(getAuthIdx);
    });
});

// ─── F117: integração typed events → health ──────────────────────────────────

describe('F21 — F117: integração observability', () => {
    it('sdk/events.js exporta onSessionEvent', () => {
        const src = readSource('sdk/events.js');
        expect(src).toContain('export function onSessionEvent');
    });

    it('sdk/events.js exporta onSessionEvents (multi-event)', () => {
        const src = readSource('sdk/events.js');
        expect(src).toContain('export function onSessionEvents');
    });

    it('sdk/barrel reexporta onSessionEvent', () => {
        const src = readSource('sdk/index.js');
        expect(src).toContain('onSessionEvent');
    });

    it('sdk/quota-monitor.js importa de server-rpc.js (não de @github/copilot-sdk direto)', () => {
        const src = readSource('sdk/quota-monitor.js');
        expect(src).not.toContain("from '@github/copilot-sdk'");
        expect(src).toContain("from './server-rpc.js'");
    });

    it('event-collector não importa @github/copilot-sdk direto (runtime)', () => {
        const collector = readSource('observability/event-collector.js');
        const runtimeImportPattern = /^\s*import\s.*from\s+['"]@github\/copilot-sdk['"]/m;
        expect(runtimeImportPattern.test(collector)).toBe(false);
    });
});
