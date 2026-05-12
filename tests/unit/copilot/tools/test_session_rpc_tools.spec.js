// @ts-check
/**
 * tests/unit/copilot/tools/test_session_rpc_tools.spec.js
 *
 * Testes unitários para src/copilot/tools/session/session-rpc-tools.js.
 *
 * Valida:
 *
 * - sessionRpcTools exporta array com 10 tools
 * - setSessionRpc injeta o RPC handle
 * - Todas as ferramentas retornam erro quando RPC indisponível
 * - session_mode_get: retorna modo atual
 * - session_mode_set: muda modo
 * - session_plan_read: lê plan.md
 * - session_plan_update: atualiza plan.md
 * - session_plan_delete: remove plan.md
 * - session_agent_list: lista agentes
 * - session_agent_select: bloqueia especialistas e reforça o maestro
 * - session_compact: aciona compactação
 * - wrapRpc: timeout, erro genérico
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
    log: vi.fn(),
    withSkipPermission: vi.fn((tool) => tool),
    buildTool: vi.fn((config) => config),
    toError: vi.fn((error) => (error instanceof Error ? error : new Error(String(error)))),
}));

vi.mock('#copilot/config/env', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        COPILOT_RPC_TIMEOUT_MS: 5000,
        COPILOT_MCP_SERVERS: '',
        COPILOT_CUSTOM_AGENTS: '',
        COPILOT_DISABLED_AGENTS: '',
        COPILOT_OPERATIONAL_PROFILE: 'production',
    };
});

vi.mock('#copilot/core', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        TimeoutError: class TimeoutError extends Error {
            constructor(/** @type {string} */ msg) {
                super(msg);
                this.name = 'TimeoutError';
            }
        },
        toError: mocks.toError,
    };
});

vi.mock('../../../../src/copilot/tools/infra/logger.js', () => ({
    log: mocks.log,
}));

vi.mock('#copilot/sdk', () => ({
    createTool: vi.fn((config) => ({
        name: config.name,
        description: config.description,
        handler: config.handler,
    })),
    defineTool: vi.fn((name, config) => ({
        name,
        description: config.description,
        handler: config.handler,
    })),
    SYSTEM_PROMPT_SECTIONS: {},
}));

vi.mock('../../../../src/copilot/tools/infra/tool-factory.js', () => ({
    withSkipPermission: mocks.withSkipPermission,
    buildTool: mocks.buildTool,
}));

// ─── Fake RPC ─────────────────────────────────────────────────────────────────

function createFakeRpc() {
    return {
        mode: {
            get: vi.fn(async () => ({ mode: 'interactive' })),
            set: vi.fn(async (/** @type {'interactive' | 'plan' | 'autopilot'} */ mode) => ({ mode })),
        },
        plan: {
            read: vi.fn(async () => ({ exists: true, filePath: '/plan.md', content: '# Plan' })),
            update: vi.fn(async (/** @type {string} */ _content) => ({ updated: true })),
            delete: vi.fn(async () => ({ deleted: true })),
        },
        agent: {
            list: vi.fn(async () => ({
                agents: [{ name: 'auditor', displayName: 'Auditor', description: 'Audit agent' }],
            })),
            getCurrent: vi.fn(async () => ({ agent: { name: 'agent-full' } })),
            select: vi.fn(async (/** @type {string} */ name) => ({ agent: { name } })),
            reload: vi.fn(async () => ({
                agents: [{ name: 'agent-full', displayName: 'Maestro', description: 'Maestro' }],
            })),
        },
        compaction: {
            compact: vi.fn(
                /** @returns {Promise<any>} */ async () => ({
                    success: true,
                    tokensFreed: 500,
                    messagesRemoved: 3,
                }),
            ),
        },
    };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('session-rpc-tools', () => {
    /** @type {typeof import('../../../../src/copilot/tools/session/session-rpc-tools.js')} */
    let mod;
    /** @type {ReturnType<typeof createFakeRpc>} */
    let fakeRpc;

    beforeAll(async () => {
        mod = await import('../../../../src/copilot/tools/session/session-rpc-tools.js');
    });

    beforeEach(() => {
        mod.setSessionRpc(null);
        fakeRpc = createFakeRpc();
        mod.setSessionRpc(fakeRpc);
    });

    afterEach(() => {
        mod.resetSessionRpcForTests();
    });

    // ── Exports ───────────────────────────────────────────────────────────

    describe('exports', () => {
        it('sessionRpcTools é array com 10 tools', () => {
            expect(Array.isArray(mod.sessionRpcTools)).toBe(true);
            expect(mod.sessionRpcTools.length).toBe(10);
        });

        it('contém as tools esperadas', () => {
            const names = mod.sessionRpcTools.map((t) => t.name);
            expect(names).toContain('session_mode_get');
            expect(names).toContain('session_mode_set');
            expect(names).toContain('session_plan_read');
            expect(names).toContain('session_plan_update');
            expect(names).toContain('session_plan_delete');
            expect(names).toContain('session_agent_list');
            expect(names).toContain('session_agent_current');
            expect(names).toContain('session_agent_select');
            expect(names).toContain('session_agent_reload');
            expect(names).toContain('session_compact');
        });
    });

    // ── RPC indisponível ──────────────────────────────────────────────────

    describe('RPC indisponível', () => {
        it('todas as tools retornam erro quando RPC é null', async () => {
            mod.setSessionRpc(null);

            for (const tool of mod.sessionRpcTools) {
                const result = await /** @type {any} */ (tool).handler({});
                expect(result.error).toMatch(/não disponível|sessão/i);
            }
        });
    });

    // ── session_mode_get ──────────────────────────────────────────────────

    describe('session_mode_get', () => {
        it('retorna modo atual', async () => {
            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_mode_get');
            const result = await /** @type {any} */ (tool).handler({});

            expect(result.mode).toBe('interactive');
            expect(fakeRpc.mode.get).toHaveBeenCalled();
        });
    });

    // ── session_mode_set ──────────────────────────────────────────────────

    describe('session_mode_set', () => {
        it('muda modo para plan', async () => {
            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_mode_set');
            const result = await /** @type {any} */ (tool).handler({ mode: 'plan' });

            expect(result.mode).toBe('plan');
            expect(fakeRpc.mode.set).toHaveBeenCalledWith('plan');
        });

        it('muda modo para autopilot', async () => {
            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_mode_set');
            const result = await /** @type {any} */ (tool).handler({ mode: 'autopilot' });

            expect(result.mode).toBe('autopilot');
        });
    });

    // ── session_plan_read ─────────────────────────────────────────────────

    describe('session_plan_read', () => {
        it('lê o plan.md', async () => {
            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_plan_read');
            const result = await /** @type {any} */ (tool).handler({});

            expect(result.exists).toBe(true);
            expect(result.content).toBe('# Plan');
        });
    });

    // ── session_plan_update ───────────────────────────────────────────────

    describe('session_plan_update', () => {
        it('atualiza o plan.md', async () => {
            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_plan_update');
            const result = await /** @type {any} */ (tool).handler({ content: '# New Plan' });

            expect(result.updated).toBe(true);
            expect(fakeRpc.plan.update).toHaveBeenCalledWith('# New Plan');
        });
    });

    // ── session_plan_delete ───────────────────────────────────────────────

    describe('session_plan_delete', () => {
        it('remove o plan.md', async () => {
            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_plan_delete');
            const result = await /** @type {any} */ (tool).handler({});

            expect(result.deleted).toBe(true);
        });
    });

    // ── session_agent_list ────────────────────────────────────────────────

    describe('session_agent_list', () => {
        it('lista agentes disponíveis', async () => {
            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_agent_list');
            const result = await /** @type {any} */ (tool).handler({});

            expect(result.agents.length).toBe(1);
            expect(result.agents[0].name).toBe('auditor');
        });
    });

    // ── session_agent_select ──────────────────────────────────────────────

    describe('session_agent_select', () => {
        it('bloqueia seleção direta de especialista', async () => {
            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_agent_select');
            const result = await /** @type {any} */ (tool).handler({ name: 'auditor' });

            expect(result.error).toMatch(/bloqueada/);
            expect(fakeRpc.agent.select).not.toHaveBeenCalled();
        });

        it('nome vazio reforça o maestro', async () => {
            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_agent_select');
            const result = await /** @type {any} */ (tool).handler({ name: '' });

            expect(result.agent.name).toBe('agent-full');
            expect(fakeRpc.agent.select).toHaveBeenCalledWith('agent-full');
        });
    });

    describe('session_agent_current', () => {
        it('retorna maestro atual sem reforço quando já ativo', async () => {
            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_agent_current');
            const result = await /** @type {any} */ (tool).handler({});

            expect(result).toEqual({ agent: { name: 'agent-full' }, enforced: false });
        });
    });

    describe('session_agent_reload', () => {
        it('recarrega agentes e reativa maestro', async () => {
            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_agent_reload');
            const result = await /** @type {any} */ (tool).handler({});

            expect(result.selectedAgent.name).toBe('agent-full');
            expect(fakeRpc.agent.reload).toHaveBeenCalled();
            expect(fakeRpc.agent.select).toHaveBeenCalledWith('agent-full');
        });
    });

    // ── session_compact ───────────────────────────────────────────────────

    describe('session_compact', () => {
        it('aciona compaction e retorna métricas', async () => {
            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_compact');
            const result = await /** @type {any} */ (tool).handler({});

            expect(result.success).toBe(true);
            expect(result.tokensFreed).toBe(500);
            expect(result.messagesRemoved).toBe(3);
        });

        it('não aplica timeout absoluto em compaction longa legítima', async () => {
            vi.useFakeTimers();
            fakeRpc.compaction.compact.mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        setTimeout(() => {
                            resolve({ success: true, tokensRemoved: 1200, messagesRemoved: 8 });
                        }, 7_000);
                    }),
            );

            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_compact');
            const pending = /** @type {any} */ (tool).handler({});
            await vi.advanceTimersByTimeAsync(7_000);
            const result = await pending;

            expect(result.success).toBe(true);
            expect(result.tokensRemoved).toBe(1200);
            expect(result.messagesRemoved).toBe(8);
            vi.useRealTimers();
        });
    });

    // ── wrapRpc error handling ────────────────────────────────────────────

    describe('wrapRpc error handling', () => {
        it('captura erro do RPC e retorna { error }', async () => {
            fakeRpc.mode.get.mockRejectedValueOnce(new Error('RPC crashed'));

            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_mode_get');
            const result = await /** @type {any} */ (tool).handler({});

            expect(result.error).toBe('RPC crashed');
        });

        it('timeout do RPC é informativo e não bloqueia a operação', async () => {
            fakeRpc.plan.read.mockResolvedValueOnce({ exists: true, filePath: 'plan.md', content: 'ok' });

            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_plan_read');
            const result = await /** @type {any} */ (tool).handler({ timeoutMs: 1 });

            expect(result.content).toBe('ok');
        });

        it('limpa timer de timeout após sucesso rápido (sem timer pendurado)', async () => {
            vi.useFakeTimers();
            fakeRpc.mode.get.mockResolvedValueOnce({ mode: 'plan' });

            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_mode_get');
            const result = await /** @type {any} */ (tool).handler({});

            expect(result.mode).toBe('plan');
            expect(vi.getTimerCount()).toBe(0);
            vi.useRealTimers();
        });
    });
});
