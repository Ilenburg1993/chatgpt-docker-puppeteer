/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- test file uses untyped mocks extensively
/**
 * Testes — Faixa 9: sdk/server-rpc.js + sdk/health.js
 *
 * Cobre: ping, modelsList, toolsList, accountGetQuota, createServerRpcFacade, pingCheck, getAuthStatus, getQuota,
 * fullHealthCheck, isServerReachable
 */

import { SdkOperationError } from '#copilot/sdk/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLog } = vi.hoisted(() => ({
    mockLog: vi.fn(),
}));

vi.mock('#copilot/observability/logger', () => ({
    log: mockLog,
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

vi.mock('@github/copilot-sdk', () => ({
    CopilotClient: vi.fn(),
    approveAll: vi.fn(),
    defineTool: vi.fn(),
    SYSTEM_PROMPT_SECTIONS: {
        guidelines: { name: 'guidelines' },
        identity: { name: 'identity' },
        context: { name: 'context' },
        safety: { name: 'safety' },
        responseFormat: { name: 'responseFormat' },
        tools: { name: 'tools' },
        abilities: { name: 'abilities' },
        instructions: { name: 'instructions' },
        conversationRules: { name: 'conversationRules' },
        errorHandling: { name: 'errorHandling' },
    },
}));

import { accountGetQuota, createServerRpcFacade, modelsList, ping, toolsList } from '#copilot/sdk/server-rpc';

import { fullHealthCheck, getAuthStatus, getQuota, isServerReachable, pingCheck } from '#copilot/sdk/health';

// ─── Helper: fake CopilotClient ────────────────────────────────────────────

function fakeClient(overrides = {}) {
    return {
        rpc: {
            ping: vi.fn().mockResolvedValue({ message: 'pong', timestamp: 1700000000000, protocolVersion: 1 }),
            models: {
                list: vi.fn().mockResolvedValue({
                    models: [
                        {
                            id: 'gpt-4.1',
                            name: 'GPT-4.1',
                            capabilities: {
                                supports: { vision: true, reasoningEffort: false },
                                limits: { max_context_window_tokens: 128000 },
                            },
                        },
                    ],
                }),
            },
            tools: {
                list: vi.fn().mockResolvedValue({
                    tools: [{ name: 'bash', description: 'Run shell commands' }],
                }),
            },
            account: {
                getQuota: vi.fn().mockResolvedValue({
                    quotaSnapshots: {
                        chat: {
                            entitlementRequests: 100,
                            usedRequests: 30,
                            remainingPercentage: 70,
                            overage: 0,
                            overageAllowedWithExhaustedQuota: false,
                        },
                    },
                }),
            },
            ...overrides,
        },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('sdk/server-rpc', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ─── PING ──────────────────────────────────────────────────────────────

    describe('ping', () => {
        it('retorna echo + timestamp + protocolVersion', async () => {
            const c = fakeClient();
            const result = await ping(c);
            expect(result.message).toBe('pong');
            expect(result.protocolVersion).toBe(1);
            expect(c.rpc.ping).toHaveBeenCalledOnce();
        });

        it('passa mensagem opcional', async () => {
            const c = fakeClient();
            await ping(c, 'hello');
            expect(c.rpc.ping).toHaveBeenCalledWith(expect.objectContaining({ message: 'hello' }));
        });

        it('rejeita client inválido', async () => {
            await expect(ping(null)).rejects.toThrow(TypeError);
        });

        it('converte erro de ping em SdkOperationError', async () => {
            const c = fakeClient({ ping: vi.fn().mockRejectedValue(new Error('socket hang up')) });
            await expect(ping(c)).rejects.toBeInstanceOf(SdkOperationError);
        });
    });

    // ─── MODELS ────────────────────────────────────────────────────────────

    describe('modelsList', () => {
        it('retorna lista de modelos', async () => {
            const c = fakeClient();
            const result = await modelsList(c);
            expect(result.models).toHaveLength(1);
            expect(result.models[0].id).toBe('gpt-4.1');
        });

        it('rejeita client inválido', async () => {
            await expect(modelsList(null)).rejects.toThrow(TypeError);
        });

        it('converte erro de models.list em SdkOperationError', async () => {
            const c = fakeClient({
                models: {
                    list: vi.fn().mockRejectedValue(new Error('models unavailable')),
                },
            });
            await expect(modelsList(c)).rejects.toBeInstanceOf(SdkOperationError);
        });
    });

    // ─── TOOLS ─────────────────────────────────────────────────────────────

    describe('toolsList', () => {
        it('retorna lista de tools', async () => {
            const c = fakeClient();
            const result = await toolsList(c);
            expect(result.tools).toHaveLength(1);
            expect(result.tools[0].name).toBe('bash');
        });

        it('passa filtro por modelo', async () => {
            const c = fakeClient();
            await toolsList(c, { model: 'gpt-4.1' });
            expect(c.rpc.tools.list).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4.1' }));
        });

        it('rejeita client inválido', async () => {
            await expect(toolsList(null)).rejects.toThrow(TypeError);
        });

        it('converte erro de tools.list em SdkOperationError', async () => {
            const c = fakeClient({
                tools: {
                    list: vi.fn().mockRejectedValue(new Error('tools backend down')),
                },
            });
            await expect(toolsList(c)).rejects.toBeInstanceOf(SdkOperationError);
        });
    });

    // ─── QUOTA ─────────────────────────────────────────────────────────────

    describe('accountGetQuota', () => {
        it('retorna quotaSnapshots', async () => {
            const c = fakeClient();
            const result = await accountGetQuota(c);
            expect(result.quotaSnapshots).toHaveProperty('chat');
            expect(result.quotaSnapshots.chat.remainingPercentage).toBe(70);
        });

        it('rejeita client inválido', async () => {
            await expect(accountGetQuota(null)).rejects.toThrow(TypeError);
        });

        it('converte erro de account.getQuota em SdkOperationError', async () => {
            const c = fakeClient({
                account: {
                    getQuota: vi.fn().mockRejectedValue(new Error('quota endpoint timeout')),
                },
            });
            await expect(accountGetQuota(c)).rejects.toBeInstanceOf(SdkOperationError);
        });
    });

    // ─── FACADE ────────────────────────────────────────────────────────────

    describe('createServerRpcFacade', () => {
        it('cria facade com 4 subsistemas', () => {
            const c = fakeClient();
            const facade = createServerRpcFacade(c);
            expect(facade.ping).toBeTypeOf('function');
            expect(facade.models.list).toBeTypeOf('function');
            expect(facade.tools.list).toBeTypeOf('function');
            expect(facade.account.getQuota).toBeTypeOf('function');
        });

        it('facade.ping delega para ping()', async () => {
            const c = fakeClient();
            const facade = createServerRpcFacade(c);
            const result = await facade.ping('test');
            expect(result.message).toBe('pong');
        });

        it('rejeita client inválido', () => {
            expect(() => createServerRpcFacade(null)).toThrow(TypeError);
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════

describe('sdk/health', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ─── pingCheck ─────────────────────────────────────────────────────────

    describe('pingCheck', () => {
        it('retorna ok=true + latency quando ping sucede', async () => {
            const c = fakeClient();
            const result = await pingCheck(c);
            expect(result.ok).toBe(true);
            expect(result.latencyMs).toBeGreaterThanOrEqual(0);
            expect(result.protocolVersion).toBe(1);
        });

        it('retorna ok=false quando ping falha', async () => {
            const c = fakeClient({
                ping: vi.fn().mockRejectedValue(new Error('connection refused')),
            });
            const result = await pingCheck(c);
            expect(result.ok).toBe(false);
            expect(result.message).toBe('connection refused');
        });
    });

    // ─── getAuthStatus ─────────────────────────────────────────────────────

    describe('getAuthStatus', () => {
        it('retorna authenticated=true quando quota funciona', async () => {
            const c = fakeClient();
            const result = await getAuthStatus(c);
            expect(result.ok).toBe(true);
            expect(result.authenticated).toBe(true);
        });

        it('retorna authenticated=false quando quota falha', async () => {
            const c = fakeClient({
                account: {
                    getQuota: vi.fn().mockRejectedValue(new Error('unauthorized')),
                },
            });
            const result = await getAuthStatus(c);
            expect(result.ok).toBe(false);
            expect(result.authenticated).toBe(false);
            expect(result.error).toBe('unauthorized');
        });
    });

    // ─── getQuota ──────────────────────────────────────────────────────────

    describe('getQuota', () => {
        it('retorna ok=true com snapshots quando quota disponível', async () => {
            const c = fakeClient();
            const result = await getQuota(c);
            expect(result.ok).toBe(true);
            expect(result.exhausted).toBe(false);
            expect(result.quotaSnapshots).toHaveProperty('chat');
        });

        it('retorna exhausted=true quando remainingPercentage=0', async () => {
            const c = fakeClient({
                account: {
                    getQuota: vi.fn().mockResolvedValue({
                        quotaSnapshots: {
                            chat: {
                                entitlementRequests: 100,
                                usedRequests: 100,
                                remainingPercentage: 0,
                                overage: 0,
                                overageAllowedWithExhaustedQuota: false,
                            },
                        },
                    }),
                },
            });
            const result = await getQuota(c);
            expect(result.ok).toBe(false);
            expect(result.exhausted).toBe(true);
        });

        it('ok=true se overage é permitido mesmo com quota zerada', async () => {
            const c = fakeClient({
                account: {
                    getQuota: vi.fn().mockResolvedValue({
                        quotaSnapshots: {
                            chat: {
                                entitlementRequests: 100,
                                usedRequests: 100,
                                remainingPercentage: 0,
                                overage: 5,
                                overageAllowedWithExhaustedQuota: true,
                            },
                        },
                    }),
                },
            });
            const result = await getQuota(c);
            expect(result.ok).toBe(true);
            expect(result.exhausted).toBe(false);
        });

        it('retorna error quando quota falha', async () => {
            const c = fakeClient({
                account: {
                    getQuota: vi.fn().mockRejectedValue(new Error('network')),
                },
            });
            const result = await getQuota(c);
            expect(result.ok).toBe(false);
            expect(result.error).toBe('network');
        });
    });

    // ─── fullHealthCheck ───────────────────────────────────────────────────

    describe('fullHealthCheck', () => {
        it('retorna healthy quando todos os checks OK', async () => {
            const c = fakeClient();
            const result = await fullHealthCheck(c);
            expect(result.status).toBe('healthy');
            expect(result.checks.ping.ok).toBe(true);
            expect(result.checks.auth.ok).toBe(true);
            expect(result.checks.quota.ok).toBe(true);
            expect(result.timestamp).toBeTruthy();
        });

        it('retorna unhealthy quando ping falha', async () => {
            const c = fakeClient({
                ping: vi.fn().mockRejectedValue(new Error('timeout')),
                account: {
                    getQuota: vi.fn().mockRejectedValue(new Error('timeout')),
                },
            });
            const result = await fullHealthCheck(c);
            expect(result.status).toBe('unhealthy');
        });

        it('retorna degraded quando auth falha mas ping OK', async () => {
            const c = fakeClient({
                account: {
                    getQuota: vi.fn().mockRejectedValue(new Error('auth expired')),
                },
            });
            const result = await fullHealthCheck(c);
            expect(result.status).toBe('degraded');
            expect(result.checks.ping.ok).toBe(true);
            expect(result.checks.auth.ok).toBe(false);
        });

        it('retorna degraded quando quota exauriu mas ping OK', async () => {
            const c = fakeClient({
                account: {
                    getQuota: vi.fn().mockResolvedValue({
                        quotaSnapshots: {
                            chat: {
                                entitlementRequests: 100,
                                usedRequests: 100,
                                remainingPercentage: 0,
                                overage: 0,
                                overageAllowedWithExhaustedQuota: false,
                            },
                        },
                    }),
                },
            });
            const result = await fullHealthCheck(c);
            expect(result.status).toBe('degraded');
            expect(result.checks.quota.exhausted).toBe(true);
        });
    });

    // ─── isServerReachable ─────────────────────────────────────────────────

    describe('isServerReachable', () => {
        it('retorna true quando ping OK', async () => {
            const c = fakeClient();
            expect(await isServerReachable(c)).toBe(true);
        });

        it('retorna false quando ping falha', async () => {
            const c = fakeClient({
                ping: vi.fn().mockRejectedValue(new Error('down')),
            });
            expect(await isServerReachable(c)).toBe(false);
        });

        it('retorna false para client inválido', async () => {
            expect(await isServerReachable(null)).toBe(false);
        });
    });

    // ─── Barrel re-export ──────────────────────────────────────────────────

    describe('barrel re-export (Faixa 9)', () => {
        it('exporta 9 símbolos via barrel (sem alias redundante)', async () => {
            const barrel = await import('#copilot/sdk');
            expect(barrel.ping).toBeTypeOf('function');
            expect(barrel.modelsList).toBeTypeOf('function');
            expect(barrel.toolsList).toBeTypeOf('function');
            expect(barrel.accountGetQuota).toBeTypeOf('function');
            expect(barrel.createServerRpcFacade).toBeTypeOf('function');
            expect(barrel.pingCheck).toBeTypeOf('function');
            expect(barrel.getQuota).toBeTypeOf('function');
            expect(barrel.fullHealthCheck).toBeTypeOf('function');
            expect(barrel.isServerReachable).toBeTypeOf('function');
        });
    });
});
