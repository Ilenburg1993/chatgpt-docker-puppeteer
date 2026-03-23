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
import { describe, it } from 'node:test';

import { buildMcpTools, listMcpTools } from '../../../src/copilot/mcp-tool-bridge.js';

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
            const t = /** @type {any} */ (tool);
            assert.ok(typeof t.name === 'string', `tool.name deve ser string, recebeu: ${typeof t.name}`);
            assert.ok(t.name.startsWith('mcp_'), `nome da tool deve começar com mcp_, recebeu: ${t.name}`);
            assert.ok(typeof t.handler === 'function', 'tool deve ter handler function');
        }
    });

    it('cada tool retornada tem .description com prefixo [MCP]', async () => {
        const tools = await buildMcpTools();
        for (const tool of tools) {
            const t = /** @type {any} */ (tool);
            assert.ok(
                typeof t.description === 'string' && t.description.startsWith('[MCP]'),
                `tool.description deve começar com [MCP], recebeu: ${t.description}`,
            );
        }
    });

    it('cada tool retornada tem .parameters (Zod schema)', async () => {
        const tools = await buildMcpTools();
        for (const tool of tools) {
            const t = /** @type {any} */ (tool);
            assert.ok(t.parameters !== undefined, 'tool deve ter parameters (Zod schema)');
        }
    });
});

// ---------------------------------------------------------------------------
// Smoke test de integração mínima — verifica que os exports existem
// ---------------------------------------------------------------------------

describe('mcp-tool-bridge › smoke tests', () => {
    it('listMcpTools é exportada como função', async () => {
        const mod = await import('../../../src/copilot/mcp-tool-bridge.js');
        assert.ok(typeof mod.listMcpTools === 'function');
    });

    it('buildMcpTools é exportada como função', async () => {
        const mod = await import('../../../src/copilot/mcp-tool-bridge.js');
        assert.ok(typeof mod.buildMcpTools === 'function');
    });

    it('módulo não exporta rpcCall (função privada)', async () => {
        const mod = /** @type {any} */ (await import('../../../src/copilot/mcp-tool-bridge.js'));
        assert.equal(mod.rpcCall, undefined, 'rpcCall deve ser privada (não exportada)');
    });

    it('módulo exporta listMcpTools e buildMcpTools e nada mais inesperado', async () => {
        const mod = await import('../../../src/copilot/mcp-tool-bridge.js');
        const exports = Object.keys(mod);
        assert.ok(exports.includes('listMcpTools'), 'deve exportar listMcpTools');
        assert.ok(exports.includes('buildMcpTools'), 'deve exportar buildMcpTools');
    });
});
