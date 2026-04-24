// @ts-check
/**
 * tests/unit/copilot/tools/test_introspection_tools.spec.js
 *
 * Testes unitários para src/copilot/tools/introspection-tools.js.
 *
 * Valida:
 *
 * - introspectionTools exporta array com 6 tools
 * - registerForIntrospection, isToolDisabled, getDisabledTools helpers
 * - list_tools: listagem, filtro por search, filtro por categoria, exclui disabled
 * - get_agent_info: retorna sdkVersion, nodeVersion, model, toolsRegistered
 * - get_telemetry: retorna summary com totais, topTools, dialog, sessions
 * - legacy_report_intent: registra e retorna confirmação com timestamp
 * - toggle_tool: enable/disable, protege tools de introspection, tool inexistente
 * - get_tool_health: retorna stats, sort, limit, tool individual
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
    log: vi.fn(),
    getToolStats: vi.fn(() => ({
        legacy_web_fetch: { calls: 10, errors: 1, avgLatencyMs: 200, errorRate: 10, lastExecution: '2026-01-01' },
        git_status: { calls: 5, errors: 0, avgLatencyMs: 50, errorRate: 0, lastExecution: '2026-01-01' },
        shell_exec: { calls: 3, errors: 2, avgLatencyMs: 500, errorRate: 66, lastExecution: '2026-01-01' },
    })),
    getSummary: vi.fn(() => ({
        tools: {
            legacy_web_fetch: { totalCalls: 10, successCount: 9, errorCount: 1 },
            git_status: { totalCalls: 5, successCount: 5, errorCount: 0 },
        },
        dialog: { totalTurns: 3 },
        sessions: { active: 1 },
        tasks: { completed: 2 },
    })),
    withSkipPermission: vi.fn((tool) => tool),
}));

vi.mock('#copilot/config/env', () => ({
    COPILOT_MCP_SERVERS: 'test-server',
    COPILOT_MODEL: 'gpt-4.1-test',
    COPILOT_SDK_ENABLED: true,
    COPILOT_CUSTOM_AGENTS: '',
    COPILOT_DISABLED_AGENTS: '',
}));

vi.mock('../../../../src/copilot/tools/logger.js', () => ({
    log: mocks.log,
}));

vi.mock('../../../../src/copilot/tools/metrics-proxy.js', () => ({
    getSummary: mocks.getSummary,
    getToolStats: mocks.getToolStats,
}));

vi.mock('#copilot/sdk', () => ({
    createTool: vi.fn((config) => ({
        name: config.name,
        description: config.description,
        handler: config.handler,
        parameters: config.parameters,
    })),
    defineTool: vi.fn((name, config) => ({
        name,
        description: config.description,
        handler: config.handler,
        parameters: config.parameters,
    })),
    SYSTEM_PROMPT_SECTIONS: {},
}));

vi.mock('../../../../src/copilot/tools/tool-factory.js', () => ({
    buildTool: vi.fn((config) => config),
    withSkipPermission: mocks.withSkipPermission,
}));

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('introspection-tools', () => {
    /** @type {typeof import('../../../../src/copilot/tools/introspection-tools.js')} */
    let mod;

    /** Fake tools para simular registro */
    const fakeTools = [
        { name: 'legacy_web_fetch', description: 'Fetch web content' },
        { name: 'git_status', description: 'Show git status' },
        { name: 'list_tools', description: 'List tools' },
        { name: 'get_agent_info', description: 'Agent info' },
        { name: 'shell_exec', description: 'Execute shell command' },
    ];

    beforeEach(async () => {
        vi.resetModules();
        mod = await import('../../../../src/copilot/tools/introspection-tools.js');
        // Registrar fake tools
        mod.registerForIntrospection(/** @type {any} */ (fakeTools));
    });

    // ── Exports ───────────────────────────────────────────────────────────

    describe('exports', () => {
        it('introspectionTools é array com 6 tools', () => {
            expect(Array.isArray(mod.introspectionTools)).toBe(true);
            expect(mod.introspectionTools.length).toBe(6);
        });

        it('contém as tools esperadas', () => {
            const names = mod.introspectionTools.map((t) => t.name);
            expect(names).toContain('list_tools');
            expect(names).toContain('get_agent_info');
            expect(names).toContain('get_telemetry');
            expect(names).toContain('legacy_report_intent');
            expect(names).toContain('toggle_tool');
            expect(names).toContain('get_tool_health');
        });
    });

    // ── registerForIntrospection ──────────────────────────────────────────

    describe('registerForIntrospection', () => {
        it('registra tools para uso em list_tools', async () => {
            const listTool = mod.introspectionTools.find((t) => t.name === 'list_tools');
            const result = await /** @type {any} */ (listTool).handler({});
            expect(result.count).toBe(5);
        });
    });

    // ── isToolDisabled / getDisabledTools ─────────────────────────────────

    describe('isToolDisabled / getDisabledTools', () => {
        it('retorna false por default', () => {
            expect(mod.isToolDisabled('legacy_web_fetch')).toBe(false);
        });

        it('getDisabledTools retorna array vazio inicialmente', () => {
            expect(mod.getDisabledTools()).toEqual([]);
        });
    });

    // ── list_tools ────────────────────────────────────────────────────────

    describe('list_tools', () => {
        /** @returns {any} */
        const find = () => mod.introspectionTools.find((t) => t.name === 'list_tools');

        it('lista todas as tools registradas', async () => {
            const result = await find().handler({});
            expect(result.count).toBe(5);
            expect(result.tools.length).toBe(5);
        });

        it('filtra por search term', async () => {
            const result = await find().handler({ search: 'git' });
            expect(result.count).toBe(1);
            expect(result.tools[0].name).toBe('git_status');
        });

        it('filtra por categoria', async () => {
            const result = await find().handler({ category: 'git' });
            expect(
                result.tools.every((/** @type {{ name: string }} */ t) =>
                    ['git_status', 'git_diff', 'git_commit', 'git_changed_files'].includes(t.name),
                ),
            ).toBe(true);
        });

        it('exclui tools desabilitadas', async () => {
            // Desabilitar legacy_web_fetch
            const toggle = mod.introspectionTools.find((t) => t.name === 'toggle_tool');
            await /** @type {any} */ (toggle).handler({ toolName: 'legacy_web_fetch', enabled: false });

            const result = await find().handler({});
            expect(result.tools.some((/** @type {{ name: string }} */ t) => t.name === 'legacy_web_fetch')).toBe(false);
            expect(result.count).toBe(4);
        });
    });

    // ── get_agent_info ────────────────────────────────────────────────────

    describe('get_agent_info', () => {
        it('retorna informações do agente', async () => {
            const tool = mod.introspectionTools.find((t) => t.name === 'get_agent_info');
            const result = await /** @type {any} */ (tool).handler({});

            expect(result.nodeVersion).toBe(process.version);
            expect(result.model).toBe('gpt-4.1-test');
            expect(result.toolsRegistered).toBe(5);
            expect(result.toolNames).toContain('legacy_web_fetch');
            expect(result.hasTelemetry).toBe(true);
            expect(result.env.COPILOT_MCP_SERVERS).toBe('test-server');
        });
    });

    // ── get_telemetry ─────────────────────────────────────────────────────

    describe('get_telemetry', () => {
        it('retorna sumário de telemetria', async () => {
            const tool = mod.introspectionTools.find((t) => t.name === 'get_telemetry');
            const result = await /** @type {any} */ (tool).handler({});

            expect(result.available).toBe(true);
            expect(result.summary.total).toBe(15); // 10 + 5
            expect(result.summary.success).toBe(14); // 9 + 5
            expect(result.summary.errors).toBe(1);
            expect(result.summary.successRate).toBe(93); // Math.round(14/15*100)
            expect(result.topTools.length).toBeGreaterThanOrEqual(1);
        });

        it('filtra por toolName', async () => {
            const tool = mod.introspectionTools.find((t) => t.name === 'get_telemetry');
            const result = await /** @type {any} */ (tool).handler({ toolName: 'legacy_web_fetch' });

            expect(result.topTools.length).toBe(1);
            expect(result.topTools[0].name).toBe('legacy_web_fetch');
            expect(result.topTools[0].count).toBe(10);
        });

        it('retorna array vazio para toolName inexistente', async () => {
            const tool = mod.introspectionTools.find((t) => t.name === 'get_telemetry');
            const result = await /** @type {any} */ (tool).handler({ toolName: 'nonexistent' });

            expect(result.topTools).toEqual([]);
        });
    });

    // ── legacy_report_intent ──────────────────────────────────────────────

    describe('legacy_report_intent', () => {
        it('registra intent e retorna confirmação', async () => {
            const tool = mod.introspectionTools.find((t) => t.name === 'legacy_report_intent');
            const result = await /** @type {any} */ (tool).handler({
                intent: 'Deletar arquivo temporário',
                tool: 'delete_file',
                risk: 'medium',
            });

            expect(result.recorded).toBe(true);
            expect(result.intent).toBe('Deletar arquivo temporário');
            expect(result.tool).toBe('delete_file');
            expect(result.risk).toBe('medium');
            expect(result.timestamp).toBeTruthy();
        });

        it('usa risk=low como default', async () => {
            const tool = mod.introspectionTools.find((t) => t.name === 'legacy_report_intent');
            const result = await /** @type {any} */ (tool).handler({
                intent: 'Ler arquivo',
                tool: 'read_file',
            });

            expect(result.risk).toBe('low');
        });
    });

    // ── toggle_tool ───────────────────────────────────────────────────────

    describe('toggle_tool', () => {
        /** @returns {any} */
        const find = () => mod.introspectionTools.find((t) => t.name === 'toggle_tool');

        it('desabilita uma tool', async () => {
            const result = await find().handler({ toolName: 'legacy_web_fetch', enabled: false });

            expect(result.success).toBe(true);
            expect(result.enabled).toBe(false);
            expect(mod.isToolDisabled('legacy_web_fetch')).toBe(true);
            expect(mod.getDisabledTools()).toContain('legacy_web_fetch');
        });

        it('habilita uma tool previamente desabilitada', async () => {
            await find().handler({ toolName: 'legacy_web_fetch', enabled: false });
            const result = await find().handler({ toolName: 'legacy_web_fetch', enabled: true });

            expect(result.success).toBe(true);
            expect(result.enabled).toBe(true);
            expect(mod.isToolDisabled('legacy_web_fetch')).toBe(false);
        });

        it('protege tools de introspection', async () => {
            const result = await find().handler({ toolName: 'list_tools', enabled: false });

            expect(result.success).toBe(false);
            expect(result.reason).toMatch(/protegida/);
            expect(mod.isToolDisabled('list_tools')).toBe(false);
        });

        it('rejeita tool inexistente', async () => {
            const result = await find().handler({ toolName: 'nonexistent_tool', enabled: false });

            expect(result.success).toBe(false);
            expect(result.reason).toMatch(/não encontrada/);
        });
    });

    // ── get_tool_health ───────────────────────────────────────────────────

    describe('get_tool_health', () => {
        /** @returns {any} */
        const find = () => mod.introspectionTools.find((t) => t.name === 'get_tool_health');

        it('retorna health de todas as tools', async () => {
            const result = await find().handler({});

            expect(result.tracked).toBe(3);
            expect(result.totalCalls).toBe(18); // 10+5+3
            expect(result.totalErrors).toBe(3); // 1+0+2
            expect(result.overallErrorRate).toBeGreaterThan(0);
            expect(result.topTools.length).toBe(3);
        });

        it('filtra por tool_name específico', async () => {
            const result = await find().handler({ tool_name: 'legacy_web_fetch' });

            expect(result.found).toBe(true);
            expect(result.tool).toBe('legacy_web_fetch');
            expect(result.stats.calls).toBe(10);
        });

        it('retorna found=false para tool inexistente', async () => {
            const result = await find().handler({ tool_name: 'nonexistent' });

            expect(result.found).toBe(false);
        });

        it('ordena por error_rate', async () => {
            const result = await find().handler({ sort_by: 'error_rate' });

            expect(result.topTools[0].name).toBe('shell_exec'); // 66% error rate
        });

        it('respeita limit', async () => {
            const result = await find().handler({ limit: 1 });

            expect(result.topTools.length).toBe(1);
        });
    });
});
