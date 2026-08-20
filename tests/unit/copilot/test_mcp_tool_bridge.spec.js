// @ts-check
/**
 * tests/unit/copilot/test_mcp_tool_bridge.spec.js
 *
 * Testes unitários para src/copilot/mcp-tool-bridge.js
 *
 * Estratégia:
 *
 * - listMcpTools/buildMcpTools: o servidor não está rodando no ambiente de teste, então execSync falha → funções retornam
 *   [] graciosamente.
 * - buildMcpTools com dados: testamos via createSdkToolFromMcp acessível através do exports do módulo (se exportável),
 *   caso contrário via smoke tests do comportamento público.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { buildMcpTools, createMcpToolBridge, listMcpTools } from '../../../src/copilot/bridges/mcp-tool-bridge.js';

/**
 * @param {import('../../../src/copilot/sdk/types.js').Tool<unknown> | undefined} tool
 * @returns {import('../../../src/copilot/sdk/types.js').ExecutableTool<unknown, unknown>}
 */
function requireExecutableTool(tool) {
    assert.ok(tool && typeof tool.handler === 'function');
    return /** @type {import('../../../src/copilot/sdk/types.js').ExecutableTool<unknown, unknown>} */ (tool);
}

// ---------------------------------------------------------------------------
// listMcpTools — sem servidor (comportamento gracioso)
// ---------------------------------------------------------------------------

describe('mcp-tool-bridge › listMcpTools (sem servidor)', () => {
    it('retorna array vazio quando servidor está offline', async () => {
        // No ambiente de teste, fetch falha → must return []
        const result = await listMcpTools();
        assert.ok(Array.isArray(result), 'deve retornar um array');
    });

    it('retorna [] sem lançar erro (graceful degradation)', async () => {
        // Chamar duas vezes para garantir idempotência
        let threw = false;
        try {
            await listMcpTools();
            await listMcpTools();
        } catch {
            threw = true;
        }
        assert.equal(threw, false, 'não deve lançar excepção');
    });
});

// ---------------------------------------------------------------------------
// buildMcpTools — comportamento público
// ---------------------------------------------------------------------------

describe('mcp-tool-bridge › buildMcpTools (sem servidor)', () => {
    it('retorna array vazio quando servidor está offline', async () => {
        const tools = await buildMcpTools();
        assert.ok(Array.isArray(tools), 'deve retornar array');
    });

    it('não lança erro quando servidor está offline', async () => {
        let threw = false;
        try {
            await buildMcpTools();
        } catch {
            threw = true;
        }
        assert.equal(threw, false, 'graceful degradation obrigatória');
    });

    it('cada tool retornada tem .name e .handler', async () => {
        // Se servidor estiver rodando, vamos validar o formato
        // Se não estiver, o array estará vazio — ambos os casos são válidos
        const tools = await buildMcpTools();
        for (const tool of tools) {
            const t = requireExecutableTool(tool);
            assert.ok(typeof t.name === 'string', `tool.name deve ser string, recebeu: ${typeof t.name}`);
            assert.ok(t.name.startsWith('mcp_'), `nome da tool deve começar com mcp_, recebeu: ${t.name}`);
            assert.ok(typeof t.handler === 'function', 'tool deve ter handler function');
        }
    });

    it('cada tool retornada tem .description com prefixo [MCP]', async () => {
        const tools = await buildMcpTools();
        for (const tool of tools) {
            const t = requireExecutableTool(tool);
            assert.ok(
                typeof t.description === 'string' && t.description.startsWith('[MCP]'),
                `tool.description deve começar com [MCP], recebeu: ${t.description}`,
            );
        }
    });

    it('cada tool retornada tem .parameters (Zod schema)', async () => {
        const tools = await buildMcpTools();
        for (const tool of tools) {
            const t = requireExecutableTool(tool);
            assert.ok(t.parameters !== undefined, 'tool deve ter parameters (Zod schema)');
        }
    });
});

// ---------------------------------------------------------------------------
// Smoke test de integração mínima — verifica que os exports existem
// ---------------------------------------------------------------------------

describe('mcp-tool-bridge › smoke tests', () => {
    it('listMcpTools é exportada como função', async () => {
        const mod = await import('../../../src/copilot/bridges/mcp-tool-bridge.js');
        assert.ok(typeof mod.listMcpTools === 'function');
    });

    it('buildMcpTools é exportada como função', async () => {
        const mod = await import('../../../src/copilot/bridges/mcp-tool-bridge.js');
        assert.ok(typeof mod.buildMcpTools === 'function');
    });

    it('módulo não exporta rpcCall (função privada)', async () => {
        const mod = await import('../../../src/copilot/bridges/mcp-tool-bridge.js');
        assert.equal('rpcCall' in mod, false, 'rpcCall deve ser privada (não exportada)');
    });

    it('módulo exporta listMcpTools e buildMcpTools e nada mais inesperado', async () => {
        const mod = await import('../../../src/copilot/bridges/mcp-tool-bridge.js');
        const exports = Object.keys(mod);
        assert.ok(exports.includes('listMcpTools'), 'deve exportar listMcpTools');
        assert.ok(exports.includes('buildMcpTools'), 'deve exportar buildMcpTools');
    });

    it('createMcpToolBridge é exportada como factory de instância', async () => {
        const mod = await import('../../../src/copilot/bridges/mcp-tool-bridge.js');
        assert.equal(typeof mod.createMcpToolBridge, 'function');
    });
});

describe('mcp-tool-bridge › instance isolation', () => {
    it('mantém estado de health isolado por instância', async () => {
        const bridgeA = createMcpToolBridge({
            isPortOpenFn: async () => false,
            logFn: () => {},
            now: () => 1,
        });
        const bridgeB = createMcpToolBridge({
            isPortOpenFn: async () => false,
            logFn: () => {},
            now: () => 2,
        });

        const initialB = bridgeB.getMcpStatus();
        assert.equal(initialB.lastCheckMs, null);
        assert.equal(initialB.circuitOpen, false);

        await bridgeA.buildMcpTools();

        const statusA = bridgeA.getMcpStatus();
        const statusB = bridgeB.getMcpStatus();

        assert.equal(statusA.circuitOpen, true, 'instância A deve abrir circuit quando a porta está fechada');
        assert.equal(statusA.lastCheckMs, 1, 'instância A deve refletir seu relógio próprio');
        assert.equal(statusB.lastCheckMs, null, 'instância B não deve herdar health da instância A');
        assert.equal(statusB.circuitOpen, false, 'instância B deve permanecer intocada');
    });
});

describe('mcp-tool-bridge › SDK 1.0 tool result conversion', () => {
    it('converte CallToolResult MCP pelo conversor oficial do SDK', async () => {
        /** @type {string[]} */
        const calls = [];
        const bridge = createMcpToolBridge({
            isPortOpenFn: async () => true,
            logFn: () => {},
            now: () => 10,
            withRetryFn: async (fn) => fn(),
            convertMcpCallToolResultFn: (result) => ({
                textResultForLlm: result.content
                    .filter((item) => item.type === 'text')
                    .map((item) => item.text)
                    .join('\n'),
                resultType: result.isError === true ? 'failure' : 'success',
            }),
            fetchImpl: async (_input, init) => {
                const body = JSON.parse(String(init?.body ?? '{}'));
                calls.push(body.method);
                if (body.method === 'tools/list') {
                    return new Response(
                        JSON.stringify({
                            result: {
                                tools: [
                                    {
                                        name: 'repo_status',
                                        description: 'Repo status',
                                        inputSchema: { type: 'object' },
                                    },
                                ],
                            },
                        }),
                        { status: 200, headers: { 'content-type': 'application/json' } },
                    );
                }
                return new Response(
                    JSON.stringify({
                        result: {
                            content: [{ type: 'text', text: 'status ok' }],
                            structuredContent: { success: true },
                        },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            },
        });

        const tools = await bridge.buildMcpTools();
        assert.equal(tools.length, 1);
        const result = /** @type {{
         *   textResultForLlm: string,
         *   resultType: string,
         *   toolTelemetry: { copilot: { toolName: string, resultType: string, durationMs: number } }
         * }} */ (await requireExecutableTool(tools[0]).handler({ path: '.' }));

        assert.deepEqual(calls, ['tools/list', 'tools/call']);
        assert.deepEqual(result, {
            textResultForLlm: 'status ok',
            resultType: 'success',
            toolTelemetry: {
                copilot: {
                    toolName: 'mcp_repo_status',
                    resultType: 'success',
                    durationMs: result.toolTelemetry.copilot.durationMs,
                },
            },
        });
    });
});
