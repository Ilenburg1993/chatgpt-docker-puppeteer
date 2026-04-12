// @ts-check
import { describe, it } from 'node:test';
import { describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────

const { mockLog } = vi.hoisted(() => {
    /** @type {any} */
    const mockLog = vi.fn();
    return { mockLog };
});

vi.mock('@github/copilot-sdk', () => {
    const SYSTEM_PROMPT_SECTIONS = Object.freeze({
        identity: 'identity',
        tone: 'tone',
        tool_efficiency: 'tool_efficiency',
        environment_context: 'environment_context',
        code_change_rules: 'code_change_rules',
        guidelines: 'guidelines',
        safety: 'safety',
        instructions: 'instructions',
        docs: 'docs',
        context: 'context',
    });
    return { SYSTEM_PROMPT_SECTIONS, CopilotClient: vi.fn() };
});

vi.mock('#copilot/core/errors', () => ({
    ConfigError: class ConfigError extends Error {
        /** @param {string} msg */
        constructor(msg) {
            super(msg);
            this.name = 'ConfigError';
        }
    },
    CopilotError: class CopilotError extends Error {
        /** @param {string} msg */
        constructor(msg) {
            super(msg);
            this.name = 'CopilotError';
        }
    },
}));

vi.mock('#copilot/observability/logger', () => ({
    log: mockLog,
}));

// ─── Imports ───────────────────────────────────────────────────────────────

import {
    buildAgentList,
    createAgent,
    createAnalystAgent,
    createFullAccessAgent,
    createReadOnlyAgent,
    deselectAgent,
    filterInferableAgents,
    getCurrentAgent,
    isValidAgentName,
    listAgents,
    READ_ONLY_TOOLS,
    reloadAgents,
    selectAgent,
} from '#copilot/sdk/agents';

// ─── Fixtures ──────────────────────────────────────────────────────────────

/** @returns {any} */
function makeSession(rpcOverrides = {}) {
    return {
        sessionId: 'sess-001',
        rpc: {
            agent: {
                list: vi.fn().mockResolvedValue({
                    agents: [
                        { name: 'auditor', displayName: 'Auditor', description: 'Code audit' },
                        { name: 'fixer', displayName: 'Fixer', description: 'Bug fixer' },
                    ],
                }),
                getCurrent: vi.fn().mockResolvedValue({
                    agent: { name: 'auditor', displayName: 'Auditor', description: 'Code audit' },
                }),
                select: vi.fn().mockResolvedValue({
                    agent: { name: 'fixer', displayName: 'Fixer', description: 'Bug fixer' },
                }),
                deselect: vi.fn().mockResolvedValue({}),
                reload: vi.fn().mockResolvedValue({
                    agents: [{ name: 'auditor', displayName: 'Auditor', description: 'Code audit' }],
                }),
                ...rpcOverrides,
            },
        },
    };
}

// ═════════════════════════════════════════════════════════════════════════════
// Factory helpers (pre-existing)
// ═════════════════════════════════════════════════════════════════════════════

describe('agents.js - Factory helpers', () => {
    it('createAgent cria config com name e prompt obrigatorios', () => {
        const agent = createAgent({ name: 'test', prompt: 'Do stuff' });
        expect(agent.name).toBe('test');
        expect(agent.prompt).toBe('Do stuff');
    });

    it('createAgent lanca ConfigError para name vazio', () => {
        expect(() => createAgent({ name: '', prompt: 'x' })).toThrow();
    });

    it('createAgent lanca ConfigError para prompt vazio', () => {
        expect(() => createAgent({ name: 'x', prompt: '' })).toThrow();
    });

    it('createReadOnlyAgent inclui READ_ONLY_TOOLS', () => {
        const agent = createReadOnlyAgent('ro', 'read only');
        expect(agent.tools).toEqual(expect.arrayContaining(READ_ONLY_TOOLS));
    });

    it('createFullAccessAgent usa tools=null', () => {
        const agent = createFullAccessAgent('full', 'all access');
        expect(agent.tools).toBeNull();
    });

    it('createAnalystAgent usa READ_ONLY_TOOLS', () => {
        const agent = createAnalystAgent('analyst', 'analyze');
        expect(agent.tools).toEqual(READ_ONLY_TOOLS);
    });

    it('buildAgentList retorna array', () => {
        const a1 = createAgent({ name: 'a', prompt: 'p' });
        const list = buildAgentList(a1);
        expect(list).toEqual([a1]);
    });

    it('isValidAgentName valida nomes corretos', () => {
        expect(isValidAgentName('auditor')).toBe(true);
        expect(isValidAgentName('my-agent-01')).toBe(true);
        expect(isValidAgentName('')).toBe(false);
        expect(isValidAgentName('has space')).toBe(false);
    });

    it('filterInferableAgents filtra agents com infer=false', () => {
        const agents = [
            createAgent({ name: 'a', prompt: 'p', infer: true }),
            createAgent({ name: 'b', prompt: 'p', infer: false }),
            createAgent({ name: 'c', prompt: 'p' }),
        ];
        const result = filterInferableAgents(agents);
        expect(result).toHaveLength(2);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F81 - listAgents via RPC
// ═════════════════════════════════════════════════════════════════════════════

describe('F81 - listAgents', () => {
    it('retorna lista de agents da sessao', async () => {
        const session = makeSession();
        const result = await listAgents(session);
        expect(result.agents).toHaveLength(2);
        expect(result.agents[0].name).toBe('auditor');
        expect(session.rpc.agent.list).toHaveBeenCalledOnce();
    });

    it('lanca TypeError para sessao invalida', async () => {
        await expect(listAgents(/** @type {any} */ (null))).rejects.toThrow(TypeError);
    });

    it('lanca TypeError para sessao sem rpc', async () => {
        await expect(listAgents(/** @type {any} */ ({}))).rejects.toThrow(TypeError);
    });

    it('propaga erro do RPC', async () => {
        const session = makeSession({
            list: vi.fn().mockRejectedValue(new Error('rpc fail')),
        });
        await expect(listAgents(session)).rejects.toThrow('rpc fail');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F81b - getCurrentAgent via RPC
// ═════════════════════════════════════════════════════════════════════════════

describe('F81b - getCurrentAgent', () => {
    it('retorna agent atual', async () => {
        const session = makeSession();
        const result = await getCurrentAgent(session);
        expect(result.agent).toBeDefined();
        expect(result.agent?.name).toBe('auditor');
    });

    it('retorna null quando nenhum agent selecionado', async () => {
        const session = makeSession({
            getCurrent: vi.fn().mockResolvedValue({ agent: null }),
        });
        const result = await getCurrentAgent(session);
        expect(result.agent).toBeNull();
    });

    it('lanca TypeError para sessao invalida', async () => {
        await expect(getCurrentAgent(/** @type {any} */ (null))).rejects.toThrow(TypeError);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F82 - selectAgent via RPC
// ═════════════════════════════════════════════════════════════════════════════

describe('F82 - selectAgent', () => {
    it('seleciona agent por nome', async () => {
        const session = makeSession();
        const result = await selectAgent(session, 'fixer');
        expect(result.agent.name).toBe('fixer');
        expect(session.rpc.agent.select).toHaveBeenCalledWith({ name: 'fixer' });
    });

    it('lanca TypeError para name vazio', async () => {
        const session = makeSession();
        await expect(selectAgent(session, '')).rejects.toThrow(TypeError);
    });

    it('lanca TypeError para name nao-string', async () => {
        const session = makeSession();
        await expect(selectAgent(session, /** @type {any} */ (123))).rejects.toThrow(TypeError);
    });

    it('lanca TypeError para sessao invalida', async () => {
        await expect(selectAgent(/** @type {any} */ (null), 'x')).rejects.toThrow(TypeError);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F83 - deselectAgent via RPC
// ═════════════════════════════════════════════════════════════════════════════

describe('F83 - deselectAgent', () => {
    it('deseleciona agent da sessao', async () => {
        const session = makeSession();
        const result = await deselectAgent(session);
        expect(result).toEqual({});
        expect(session.rpc.agent.deselect).toHaveBeenCalledOnce();
    });

    it('lanca TypeError para sessao invalida', async () => {
        await expect(deselectAgent(/** @type {any} */ (null))).rejects.toThrow(TypeError);
    });

    it('propaga erro do RPC', async () => {
        const session = makeSession({
            deselect: vi.fn().mockRejectedValue(new Error('deselect fail')),
        });
        await expect(deselectAgent(session)).rejects.toThrow('deselect fail');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F84 - reloadAgents via RPC
// ═════════════════════════════════════════════════════════════════════════════

describe('F84 - reloadAgents', () => {
    it('recarrega agents e retorna lista atualizada', async () => {
        const session = makeSession();
        const result = await reloadAgents(session);
        expect(result.agents).toHaveLength(1);
        expect(session.rpc.agent.reload).toHaveBeenCalledOnce();
    });

    it('lanca TypeError para sessao invalida', async () => {
        await expect(reloadAgents(/** @type {any} */ ({}))).rejects.toThrow(TypeError);
    });

    it('propaga erro do RPC', async () => {
        const session = makeSession({
            reload: vi.fn().mockRejectedValue(new Error('reload fail')),
        });
        await expect(reloadAgents(session)).rejects.toThrow('reload fail');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F85 - Agent selection flow
// ═════════════════════════════════════════════════════════════════════════════

describe('F85 - Agent selection flow', () => {
    it('lista -> seleciona -> getCurrent retorna selecionado', async () => {
        const session = makeSession();
        const { agents } = await listAgents(session);
        expect(agents.length).toBeGreaterThan(0);

        await selectAgent(session, agents[1].name);
        expect(session.rpc.agent.select).toHaveBeenCalledWith({ name: 'fixer' });

        const current = await getCurrentAgent(session);
        expect(current.agent).not.toBeNull();
    });

    it('seleciona -> deseleciona -> getCurrent retorna null', async () => {
        const session = makeSession({
            getCurrent: vi
                .fn()
                .mockResolvedValueOnce({ agent: { name: 'auditor', displayName: 'Auditor', description: '' } })
                .mockResolvedValueOnce({ agent: null }),
        });

        await selectAgent(session, 'auditor');
        const before = await getCurrentAgent(session);
        expect(before.agent).not.toBeNull();

        await deselectAgent(session);
        const after = await getCurrentAgent(session);
        expect(after.agent).toBeNull();
    });

    it('reload atualiza lista apos mudanca', async () => {
        const session = makeSession();
        const initial = await listAgents(session);
        expect(initial.agents).toHaveLength(2);

        const reloaded = await reloadAgents(session);
        expect(reloaded.agents).toHaveLength(1);
    });

    it('selectAgent com nome invalido nao chama RPC', async () => {
        const session = makeSession();
        await expect(selectAgent(session, '')).rejects.toThrow(TypeError);
        expect(session.rpc.agent.select).not.toHaveBeenCalled();
    });

    it('todas as funcoes RPC logam operacao', async () => {
        const session = makeSession();
        mockLog.mockClear();

        await listAgents(session);
        await getCurrentAgent(session);
        await selectAgent(session, 'fixer');
        await deselectAgent(session);
        await reloadAgents(session);

        expect(mockLog).toHaveBeenCalledTimes(5);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// Barrel exports
// ═════════════════════════════════════════════════════════════════════════════

describe('Barrel - Faixa 15 exports', () => {
    it('barrel exporta funcoes RPC de agents', async () => {
        const barrel = await import('#copilot/sdk/index.js');
        const expected = ['listAgents', 'getCurrentAgent', 'selectAgent', 'deselectAgent', 'reloadAgents'];
        for (const name of expected) {
            expect(typeof barrel[name]).toBe('function');
        }
    });

    it('barrel mantém exports pre-existentes de agents', async () => {
        const barrel = await import('#copilot/sdk/index.js');
        const existing = [
            'READ_ONLY_TOOLS',
            'buildAgentList',
            'createAgent',
            'createAnalystAgent',
            'createFullAccessAgent',
            'createReadOnlyAgent',
            'filterInferableAgents',
            'isValidAgentName',
        ];
        for (const name of existing) {
            expect(barrel[name]).toBeDefined();
        }
    });
});
