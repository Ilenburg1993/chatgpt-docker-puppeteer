// @ts-check
/**
 * tests/unit/copilot/tools/test_session_rpc_tools.spec.js
 *
 * Testes unitários para src/copilot/tools/session-rpc-tools.js.
 *
 * Valida:
 *
 * - sessionRpcTools exporta array com 8 tools
 * - setSessionRpc injeta o RPC handle
 * - Todas as tools retornam erro quando RPC indisponível
 * - session_mode_get: retorna modo atual
 * - session_mode_set: muda modo
 * - session_plan_read: lê plan.md
 * - session_plan_update: atualiza plan.md
 * - session_plan_delete: remove plan.md
 * - session_agent_list: lista agentes
 * - session_agent_select: seleciona agente, deselect com nome vazio
 * - session_compact: aciona compaction
 * - wrapRpc: timeout, erro genérico
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('#copilot/config/env', () => ({
    COPILOT_RPC_TIMEOUT_MS: 5000,

    COPILOT_MCP_SERVERS: '',
    COPILOT_CUSTOM_AGENTS: '',
    COPILOT_DISABLED_AGENTS: '',
}));

vi.mock('#copilot/core/errors', () => ({
    CopilotError: class CopilotError extends Error {
        constructor(/** @type {string} */ msg, /** @type {any} */ opts = {}) {
            super(msg);
            this.name = 'CopilotError';
            this.code = opts.code ?? 'UNKNOWN';
        }
    },
    TimeoutError: class TimeoutError extends Error {
        constructor(/** @type {string} */ msg) {
            super(msg);
            this.name = 'TimeoutError';
        }
    },
}));

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
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

vi.mock('../../../../src/copilot/tools/tool-factory.js', () => ({
    withSkipPermission: vi.fn((tool) => tool),
}));

// ─── Fake RPC ─────────────────────────────────────────────────────────────────

function createFakeRpc() {
    return {
        mode: {
            get: vi.fn(async () => ({ mode: 'interactive' })),
            set: vi.fn(async (/** @type {any} */ opts) => ({ mode: opts.mode })),
        },
        plan: {
            read: vi.fn(async () => ({ exists: true, filePath: '/plan.md', content: '# Plan' })),
            update: vi.fn(async () => ({ updated: true })),
            delete: vi.fn(async () => ({ deleted: true })),
        },
        agent: {
            list: vi.fn(async () => ({
                agents: [{ name: 'auditor', displayName: 'Auditor', description: 'Audit agent' }],
            })),
            select: vi.fn(async (/** @type {any} */ opts) => ({ agent: { name: opts.name } })),
            deselect: vi.fn(async () => ({})),
        },
        compaction: {
            compact: vi.fn(async () => ({ success: true, tokensFreed: 500, messagesRemoved: 3 })),
        },
    };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('session-rpc-tools', () => {
    /** @type {typeof import('../../../../src/copilot/tools/session-rpc-tools.js')} */
    let mod;
    /** @type {ReturnType<typeof createFakeRpc>} */
    let fakeRpc;

    beforeEach(async () => {
        vi.resetModules();
        mod = await import('../../../../src/copilot/tools/session-rpc-tools.js');
        fakeRpc = createFakeRpc();
        mod.setSessionRpc(fakeRpc);
    });

    // ── Exports ───────────────────────────────────────────────────────────

    describe('exports', () => {
        it('sessionRpcTools é array com 8 tools', () => {
            expect(Array.isArray(mod.sessionRpcTools)).toBe(true);
            expect(mod.sessionRpcTools.length).toBe(8);
        });

        it('contém as tools esperadas', () => {
            const names = mod.sessionRpcTools.map((t) => t.name);
            expect(names).toContain('session_mode_get');
            expect(names).toContain('session_mode_set');
            expect(names).toContain('session_plan_read');
            expect(names).toContain('session_plan_update');
            expect(names).toContain('session_plan_delete');
            expect(names).toContain('session_agent_list');
            expect(names).toContain('session_agent_select');
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
            expect(fakeRpc.mode.set).toHaveBeenCalledWith({ mode: 'plan' });
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
            expect(fakeRpc.plan.update).toHaveBeenCalledWith({ content: '# New Plan' });
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
        it('seleciona agente por nome', async () => {
            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_agent_select');
            const result = await /** @type {any} */ (tool).handler({ name: 'auditor' });

            expect(result.agent.name).toBe('auditor');
            expect(fakeRpc.agent.select).toHaveBeenCalledWith({ name: 'auditor' });
        });

        it('deselect com nome vazio', async () => {
            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_agent_select');
            const result = await /** @type {any} */ (tool).handler({ name: '' });

            expect(result.selected).toBe(null);
            expect(fakeRpc.agent.deselect).toHaveBeenCalled();
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
    });

    // ── wrapRpc error handling ────────────────────────────────────────────

    describe('wrapRpc error handling', () => {
        it('captura erro do RPC e retorna { error }', async () => {
            fakeRpc.mode.get.mockRejectedValueOnce(new Error('RPC crashed'));

            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_mode_get');
            const result = await /** @type {any} */ (tool).handler({});

            expect(result.error).toBe('RPC crashed');
        });

        it('timeout do RPC retorna erro', async () => {
            fakeRpc.plan.read.mockImplementationOnce(
                () =>
                    new Promise((_resolve) => {
                        /* never resolves */
                    }),
            );

            const tool = mod.sessionRpcTools.find((t) => t.name === 'session_plan_read');
            const result = await /** @type {any} */ (tool).handler({});

            expect(result.error).toMatch(/timeout/i);
        }, 10000);
    });
});
