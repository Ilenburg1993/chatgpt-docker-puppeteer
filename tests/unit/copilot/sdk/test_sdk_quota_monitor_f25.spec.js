// @ts-check
/**
 * tests/unit/copilot/sdk/test_sdk_quota_monitor_f25.spec.js
 *
 * Faixa 25 — Quota Monitor Integration
 *
 * F118: createQuotaMonitor integrado ao performBootWiring (via boot-wiring.js) F119: quotaMonitor.stop() chamado no
 * shutdown (via agent-lifecycle.js) F120: createQuotaMonitor contratos — start, stop, status, poll F121: callbacks
 * onWarning e onUpdate acionados corretamente F122: barrel exporta createQuotaMonitor
 *
 * @module tests/unit/copilot/sdk/test_sdk_quota_monitor_f25
 */

import { describe, expect, it, vi } from 'vitest';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Cria snapshot de quota mock.
 *
 * @param {number} remainingPercentage
 * @returns {{
 *     entitlementRequests: number;
 *     usedRequests: number;
 *     remainingPercentage: number;
 *     overage: number;
 *     overageAllowedWithExhaustedQuota: boolean;
 * }}
 */
function makeSnapshot(remainingPercentage) {
    return {
        entitlementRequests: 1000,
        usedRequests: Math.floor(((100 - remainingPercentage) / 100) * 1000),
        remainingPercentage,
        overage: 0,
        overageAllowedWithExhaustedQuota: false,
    };
}

// ─── F122: barrel exporta createQuotaMonitor ─────────────────────────────────

describe('F122 — barrel exporta createQuotaMonitor', () => {
    it('exporta createQuotaMonitor', async () => {
        const sdk = await import('#copilot/sdk');
        expect(typeof sdk.createQuotaMonitor).toBe('function');
    });

    it('módulo interno exporta createQuotaMonitor', async () => {
        const mod = await import('#copilot/sdk/telemetry');
        expect(typeof mod.createQuotaMonitor).toBe('function');
    });
});

// ─── F120: createQuotaMonitor — contratos ─────────────────────────────────────

describe('F120 — createQuotaMonitor contratos básicos', () => {
    it('lança TypeError quando client é null', async () => {
        const { createQuotaMonitor } = await import('#copilot/sdk/telemetry');
        expect(() => createQuotaMonitor({ client: /** @type {any} */ (null), intervalMs: 5000 })).toThrow(TypeError);
    });

    it('lança TypeError quando client não é objeto', async () => {
        const { createQuotaMonitor } = await import('#copilot/sdk/telemetry');
        expect(() => createQuotaMonitor({ client: /** @type {any} */ ('string'), intervalMs: 5000 })).toThrow(
            TypeError,
        );
    });

    it('lança RangeError quando intervalMs < 1000', async () => {
        const { createQuotaMonitor } = await import('#copilot/sdk/telemetry');
        expect(() => createQuotaMonitor({ client: /** @type {any} */ ({}), intervalMs: 500 })).toThrow(RangeError);
    });

    it('retorna objeto com start, stop, status, poll', async () => {
        const { createQuotaMonitor } = await import('#copilot/sdk/telemetry');
        const monitor = createQuotaMonitor({ client: /** @type {any} */ ({}), intervalMs: 60_000 });
        expect(typeof monitor.start).toBe('function');
        expect(typeof monitor.stop).toBe('function');
        expect(typeof monitor.status).toBe('function');
        expect(typeof monitor.poll).toBe('function');
    });

    it('status inicial: running=false, snapshots vazio, ts=0', async () => {
        const { createQuotaMonitor } = await import('#copilot/sdk/telemetry');
        const monitor = createQuotaMonitor({ client: /** @type {any} */ ({}), intervalMs: 60_000 });
        const status = monitor.status();
        expect(status.running).toBe(false);
        expect(status.ts).toBe(0);
        expect(status.snapshots).toEqual({});
    });

    it('start() faz monitor passar para running=true', async () => {
        const { createQuotaMonitor } = await import('#copilot/sdk/telemetry');
        const monitor = createQuotaMonitor({ client: /** @type {any} */ ({}), intervalMs: 60_000 });
        monitor.start();
        expect(monitor.status().running).toBe(true);
        monitor.stop();
    });

    it('stop() faz monitor retornar a running=false', async () => {
        const { createQuotaMonitor } = await import('#copilot/sdk/telemetry');
        const monitor = createQuotaMonitor({ client: /** @type {any} */ ({}), intervalMs: 60_000 });
        monitor.start();
        monitor.stop();
        expect(monitor.status().running).toBe(false);
    });

    it('start() é idempotente (não cria múltiplos timers)', async () => {
        const { createQuotaMonitor } = await import('#copilot/sdk/telemetry');
        const monitor = createQuotaMonitor({ client: /** @type {any} */ ({}), intervalMs: 60_000 });
        monitor.start();
        monitor.start(); // segunda chamada não deve lançar
        expect(monitor.status().running).toBe(true);
        monitor.stop();
    });

    it('stop() é idempotente (não lança em segunda chamada)', async () => {
        const { createQuotaMonitor } = await import('#copilot/sdk/telemetry');
        const monitor = createQuotaMonitor({ client: /** @type {any} */ ({}), intervalMs: 60_000 });
        monitor.start();
        monitor.stop();
        expect(() => monitor.stop()).not.toThrow();
    });
});

// ─── F121: callbacks onWarning e onUpdate ─────────────────────────────────────

describe('F121 — callbacks onWarning e onUpdate', () => {
    it('onUpdate é chamado após poll bem-sucedido', async () => {
        const { createQuotaMonitor } = await import('#copilot/sdk/telemetry');
        const onUpdate = vi.fn();

        // Mock do client com rpc.account.getQuota
        const mockClient = {
            rpc: {
                account: {
                    getQuota: vi.fn().mockResolvedValue({
                        quotaSnapshots: {
                            premium: makeSnapshot(50),
                        },
                    }),
                },
            },
        };

        const monitor = createQuotaMonitor({
            client: /** @type {any} */ (mockClient),
            intervalMs: 60_000,
            onUpdate,
        });

        await monitor.poll();
        expect(onUpdate).toHaveBeenCalledOnce();
        expect(onUpdate).toHaveBeenCalledWith({ premium: makeSnapshot(50) });
    });

    it('onWarning é chamado quando remainingPercentage <= warningThreshold', async () => {
        const { createQuotaMonitor } = await import('#copilot/sdk/telemetry');
        const onWarning = vi.fn();

        const mockClient = {
            rpc: {
                account: {
                    getQuota: vi.fn().mockResolvedValue({
                        quotaSnapshots: {
                            premium: makeSnapshot(15), // abaixo de 20%
                        },
                    }),
                },
            },
        };

        const monitor = createQuotaMonitor({
            client: /** @type {any} */ (mockClient),
            intervalMs: 60_000,
            warningThreshold: 20,
            onWarning,
        });

        await monitor.poll();
        expect(onWarning).toHaveBeenCalledOnce();
        expect(onWarning).toHaveBeenCalledWith('premium', makeSnapshot(15));
    });

    it('onWarning NÃO é chamado quando quota está acima do threshold', async () => {
        const { createQuotaMonitor } = await import('#copilot/sdk/telemetry');
        const onWarning = vi.fn();

        const mockClient = {
            rpc: {
                account: {
                    getQuota: vi.fn().mockResolvedValue({
                        quotaSnapshots: {
                            premium: makeSnapshot(50), // acima de 20%
                        },
                    }),
                },
            },
        };

        const monitor = createQuotaMonitor({
            client: /** @type {any} */ (mockClient),
            intervalMs: 60_000,
            warningThreshold: 20,
            onWarning,
        });

        await monitor.poll();
        expect(onWarning).not.toHaveBeenCalled();
    });

    it('poll() retorna snapshots atualizados', async () => {
        const { createQuotaMonitor } = await import('#copilot/sdk/telemetry');

        const snapshots = { premium: makeSnapshot(75), copilot: makeSnapshot(40) };
        const mockClient = {
            rpc: {
                account: {
                    getQuota: vi.fn().mockResolvedValue({ quotaSnapshots: snapshots }),
                },
            },
        };

        const monitor = createQuotaMonitor({
            client: /** @type {any} */ (mockClient),
            intervalMs: 60_000,
        });

        const result = await monitor.poll();
        expect(result).toEqual(snapshots);
    });

    it('poll() atualiza status().snapshots', async () => {
        const { createQuotaMonitor } = await import('#copilot/sdk/telemetry');

        const mockClient = {
            rpc: {
                account: {
                    getQuota: vi.fn().mockResolvedValue({
                        quotaSnapshots: { premium: makeSnapshot(60) },
                    }),
                },
            },
        };

        const monitor = createQuotaMonitor({
            client: /** @type {any} */ (mockClient),
            intervalMs: 60_000,
        });

        expect(monitor.status().snapshots).toEqual({});
        await monitor.poll();
        expect(monitor.status().snapshots).toHaveProperty('premium');
    });

    it('poll() atualiza status().ts para valor positivo', async () => {
        const { createQuotaMonitor } = await import('#copilot/sdk/telemetry');

        const mockClient = {
            rpc: {
                account: {
                    getQuota: vi.fn().mockResolvedValue({
                        quotaSnapshots: { premium: makeSnapshot(60) },
                    }),
                },
            },
        };

        const monitor = createQuotaMonitor({
            client: /** @type {any} */ (mockClient),
            intervalMs: 60_000,
        });

        await monitor.poll();
        expect(monitor.status().ts).toBeGreaterThan(0);
    });
});

// ─── F118/F119: integração boot-wiring e lifecycle ───────────────────────────

describe('F118 — boot-wiring importa e usa quota monitor via façade', () => {
    it('boot-wiring.js importa startAgentSdkBootQuotaBridge via agent-sdk-access', async () => {
        const { readFileSync } = await import('node:fs');
        const content = readFileSync(
            '/workspaces/chatgpt-docker-puppeteer/src/copilot/agent/session/boot/boot-wiring.js',
            'utf8',
        );
        expect(content).toContain('startAgentSdkBootQuotaBridge');
        expect(content).toContain("from '../../facades/index.js'");
        expect(content).not.toContain("from '#copilot/sdk'");
    });

    it('boot-wiring.js chama startAgentSdkBootQuotaBridge no performBootWiring', async () => {
        const { readFileSync } = await import('node:fs');
        const content = readFileSync(
            '/workspaces/chatgpt-docker-puppeteer/src/copilot/agent/session/boot/boot-wiring.js',
            'utf8',
        );
        expect(content).toContain('startAgentSdkBootQuotaBridge(');
        expect(content).not.toContain('quotaMonitor.start()');
    });

    it('BootWiringResult inclui campo quotaMonitor', async () => {
        const { readFileSync } = await import('node:fs');
        const content = readFileSync(
            '/workspaces/chatgpt-docker-puppeteer/src/copilot/agent/session/boot/boot-wiring.js',
            'utf8',
        );
        expect(content).toContain('quotaMonitor');
        expect(content).toContain('bootReport');
        expect(content).toContain('quotaMonitor,');
    });
});

describe('F119 — lifecycle para quotaMonitor no shutdown', () => {
    it('agent-lifecycle.js armazena ctx.quotaMonitor', async () => {
        const { readFileSync } = await import('node:fs');
        const content = readFileSync(
            '/workspaces/chatgpt-docker-puppeteer/src/copilot/agent/lifecycle/orchestrators/agent-lifecycle.js',
            'utf8',
        );
        expect(content).toContain('ctx.setQuotaMonitor(bootResult.quotaMonitor)');
    });

    it('agent-lifecycle.js para quotaMonitor via AgentContext no shutdown', async () => {
        const { readFileSync } = await import('node:fs');
        const content = readFileSync(
            '/workspaces/chatgpt-docker-puppeteer/src/copilot/agent/lifecycle/orchestrators/agent-lifecycle.js',
            'utf8',
        );
        expect(content).toContain('ctx.stopQuotaMonitor()');
    });

    it('agent-context.js define quotaMonitor como null', async () => {
        const { readFileSync } = await import('node:fs');
        const content = readFileSync('/workspaces/chatgpt-docker-puppeteer/src/copilot/agent/agent-context.js', 'utf8');
        expect(content).toContain('quotaMonitor = null');
    });
});
