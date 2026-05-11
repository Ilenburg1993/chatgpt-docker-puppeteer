// @ts-check

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    log: vi.fn(),
    withSkipPermission: vi.fn((tool) => tool),
    toError: vi.fn((error) => (error instanceof Error ? error : new Error(String(error)))),
    fleetStart: vi.fn(/** @returns {Promise<any>} */ async () => ({ ok: true })),
    agentList: vi.fn(async () => ({ agents: [{ name: 'auditor' }] })),
    agentGetCurrent: vi.fn(async () => ({ agent: { name: 'auditor' } })),
    agentSelect: vi.fn(async (_session, name) => ({ agent: { name } })),
    agentReload: vi.fn(async () => ({ reloaded: true })),
    skillsList: vi.fn(async () => ({ skills: [] })),
    skillsEnable: vi.fn(async () => ({ enabled: true })),
    skillsDisable: vi.fn(async () => ({ disabled: true })),
    skillsReload: vi.fn(async () => ({ reloaded: true })),
    mcpList: vi.fn(async () => ({ servers: [] })),
    mcpEnable: vi.fn(async () => ({ enabled: true })),
    mcpDisable: vi.fn(async () => ({ disabled: true })),
    mcpReload: vi.fn(async () => ({ reloaded: true })),
    pluginsList: vi.fn(async () => ({ plugins: [] })),
    extensionsList: vi.fn(async () => ({ extensions: [] })),
    extensionsEnable: vi.fn(async () => ({ enabled: true })),
    extensionsDisable: vi.fn(async () => ({ disabled: true })),
    extensionsReload: vi.fn(async () => ({ reloaded: true })),
}));

vi.mock('#copilot/config/env', () => ({
    COPILOT_RPC_TIMEOUT_MS: 5000,
    COPILOT_MCP_SERVERS: '',
    COPILOT_CUSTOM_AGENTS: '',
    COPILOT_DISABLED_AGENTS: '',
    COPILOT_OPERATIONAL_PROFILE: 'production',
}));

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

vi.mock('../../../../src/copilot/tools/logger.js', () => ({
    log: mocks.log,
}));

vi.mock('../../../../src/copilot/tools/infra/tool-factory.js', () => ({
    withSkipPermission: mocks.withSkipPermission,
    buildTool: vi.fn((config) => config),
}));

vi.mock('#copilot/sdk', () => ({
    createTool: vi.fn((config) => ({
        name: config.name,
        description: config.description,
        handler: config.handler,
    })),
    fleetStart: mocks.fleetStart,
    agentList: mocks.agentList,
    agentGetCurrent: mocks.agentGetCurrent,
    agentSelect: mocks.agentSelect,
    agentReload: mocks.agentReload,
    skillsList: mocks.skillsList,
    skillsEnable: mocks.skillsEnable,
    skillsDisable: mocks.skillsDisable,
    skillsReload: mocks.skillsReload,
    mcpList: mocks.mcpList,
    mcpEnable: mocks.mcpEnable,
    mcpDisable: mocks.mcpDisable,
    mcpReload: mocks.mcpReload,
    pluginsList: mocks.pluginsList,
    extensionsList: mocks.extensionsList,
    extensionsEnable: mocks.extensionsEnable,
    extensionsDisable: mocks.extensionsDisable,
    extensionsReload: mocks.extensionsReload,
    SYSTEM_PROMPT_SECTIONS: {},
}));

describe('experimental-rpc-tools', () => {
    /** @type {typeof import('#copilot/tools')} */
    let mod;

    beforeAll(async () => {
        mod = await import('#copilot/tools');
    });

    beforeEach(() => {
        mod.setExperimentalSession(/** @type {any} */ ({ id: 'sess-1' }));
    });

    afterEach(() => {
        mod.setExperimentalSession(null);
    });

    it('exporta tools experimentais esperadas', () => {
        const names = mod.experimentalRpcTools.map((t) => t.name);
        expect(names).toContain('exp_fleet_start');
        expect(names).toContain('exp_agent_list');
        expect(names).toContain('exp_skills_list');
        expect(names).toContain('exp_mcp_list');
        expect(names).toContain('exp_plugins_list');
        expect(names).toContain('exp_extensions_list');
    });

    it('retorna erro quando sessão experimental não está disponível', async () => {
        mod.setExperimentalSession(null);
        const tool = mod.experimentalRpcTools.find((t) => t.name === 'exp_agent_list');
        const result = await /** @type {any} */ (tool).handler({});
        expect(result.error).toMatch(/não disponível|sessão/i);
    });

    it('limpa timer de timeout após sucesso rápido (sem timer pendurado)', async () => {
        vi.useFakeTimers();
        mocks.agentList.mockResolvedValueOnce({ agents: [{ name: 'planner' }] });

        const tool = mod.experimentalRpcTools.find((t) => t.name === 'exp_agent_list');
        const result = await /** @type {any} */ (tool).handler({});

        expect(result.agents[0].name).toBe('planner');
        expect(vi.getTimerCount()).toBe(0);
        vi.useRealTimers();
    });

    it('não aplica timeout absoluto em exp_fleet_start quando operação é longa legítima', async () => {
        vi.useFakeTimers();
        mocks.fleetStart.mockImplementationOnce(
            async () =>
                await new Promise((resolve) => {
                    setTimeout(() => resolve({ ok: true, started: 3 }), 7_000);
                }),
        );

        const tool = mod.experimentalRpcTools.find((t) => t.name === 'exp_fleet_start');
        const pending = /** @type {any} */ (tool).handler({ prompt: 'start' });

        await vi.advanceTimersByTimeAsync(7_000);
        const result = await pending;

        expect(result.ok).toBe(true);
        expect(result.started).toBe(3);
        vi.useRealTimers();
    });

    it('bloqueia seleção direta de especialista e preserva o maestro', async () => {
        const tool = mod.experimentalRpcTools.find((t) => t.name === 'exp_agent_select');
        const result = await /** @type {any} */ (tool).handler({ name: 'auditor' });

        expect(result.error).toMatch(/bloqueada/i);
        expect(result.enforcedAgent).toBe('agent-full');
        expect(mocks.agentSelect).not.toHaveBeenCalled();
    });

    it('seleciona agent-full quando seleção experimental pede o maestro', async () => {
        const tool = mod.experimentalRpcTools.find((t) => t.name === 'exp_agent_select');
        const result = await /** @type {any} */ (tool).handler({ name: 'agent-full' });

        expect(result.agent.name).toBe('agent-full');
        expect(mocks.agentSelect).toHaveBeenCalledWith(expect.anything(), 'agent-full');
    });

    it('exp_agent_deselect reforça agent-full em vez de deselecionar', async () => {
        const tool = mod.experimentalRpcTools.find((t) => t.name === 'exp_agent_deselect');
        const result = await /** @type {any} */ (tool).handler({});

        expect(result.agent.name).toBe('agent-full');
        expect(mocks.agentSelect).toHaveBeenCalledWith(expect.anything(), 'agent-full');
    });
});
