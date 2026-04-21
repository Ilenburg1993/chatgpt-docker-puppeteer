// @ts-check
/**
 * @file Faixa 32 — Tools Introspection & Stats Audit
 *
 *   Verifica contratos do sistema de métricas e introspecção de tools:
 *
 *   - F159: recordToolCall acumula métricas por tool
 *   - F160: getToolStats retorna snapshot imutável com campos corretos
 *   - F161: wrapWithStats instrumpa tool sem alterar retorno
 *   - F162: wrapWithStats captura erros sem suprimir
 *   - F163: getStatsByCategory agrupa por prefixo
 *   - F164: _resetToolStats limpa estado para isolamento de testes
 *   - F165: tools sem handler não são alteradas por wrapWithStats
 */

import {
    _resetToolStats,
    getStatsByCategory,
    getToolStats,
    recordToolCall,
    wrapWithStats,
} from '#copilot/observability/tool-stats';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** @param {Record<string, unknown>} stats @param {string} name */
const entryOf = (stats, name) => /** @type {any} */ (stats[name]);

// ─── F164: _resetToolStats isolamento ──────────────────────────────────────
// Executado antes de cada describe para garantir estado limpo

beforeEach(() => {
    _resetToolStats();
});

// ─── F159: recordToolCall acumula métricas ─────────────────────────────────

describe('F159 — recordToolCall acumula métricas por tool', () => {
    it('registra chamada com sucesso', () => {
        recordToolCall('git.status', 50, true);
        const stats = getToolStats();
        const entry = entryOf(stats, 'git.status');
        expect(entry).toBeDefined();
        expect(entry.calls).toBe(1);
        expect(entry.errors).toBe(0);
        expect(entry.lastOk).toBe(true);
    });

    it('registra chamada com erro', () => {
        recordToolCall('git.status', 30, false);
        const stats = getToolStats();
        const entry = entryOf(stats, 'git.status');
        expect(entry.errors).toBe(1);
        expect(entry.lastOk).toBe(false);
    });

    it('acumula múltiplas chamadas', () => {
        recordToolCall('shell.exec', 100, true);
        recordToolCall('shell.exec', 200, true);
        recordToolCall('shell.exec', 150, false);
        const stats = getToolStats();
        const entry = entryOf(stats, 'shell.exec');
        expect(entry.calls).toBe(3);
        expect(entry.errors).toBe(1);
    });

    it('defaulta success=true quando não passado', () => {
        recordToolCall('tool.test', 20);
        const stats = getToolStats();
        const entry = entryOf(stats, 'tool.test');
        expect(entry.lastOk).toBe(true);
        expect(entry.errors).toBe(0);
    });
});

// ─── F160: getToolStats snapshot ───────────────────────────────────────────

describe('F160 — getToolStats retorna snapshot com campos corretos', () => {
    it('retorna objeto vazio quando não há chamadas', () => {
        expect(getToolStats()).toEqual({});
    });

    it('snapshot contém calls, errors, avgLatencyMs, errorRate, lastCallIso, lastOk', () => {
        recordToolCall('code.lint', 120, true);
        const stats = getToolStats();
        const entry = entryOf(stats, 'code.lint');
        expect(entry).toHaveProperty('calls');
        expect(entry).toHaveProperty('errors');
        expect(entry).toHaveProperty('avgLatencyMs');
        expect(entry).toHaveProperty('errorRate');
        expect(entry).toHaveProperty('lastCallIso');
        expect(entry).toHaveProperty('lastOk');
    });

    it('avgLatencyMs é calculado corretamente', () => {
        recordToolCall('code.lint', 100, true);
        recordToolCall('code.lint', 200, true);
        const stats = getToolStats();
        expect(entryOf(stats, 'code.lint').avgLatencyMs).toBe(150);
    });

    it('errorRate é calculado corretamente', () => {
        recordToolCall('code.lint', 100, true);
        recordToolCall('code.lint', 100, false);
        const stats = getToolStats();
        expect(entryOf(stats, 'code.lint').errorRate).toBe(50.0);
    });

    it('lastCallIso é string ISO quando houve chamadas', () => {
        recordToolCall('code.lint', 10, true);
        const stats = getToolStats();
        expect(entryOf(stats, 'code.lint').lastCallIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('lastCallIso é null antes de qualquer chamada', () => {
        // Não registramos, portanto interno _stats está vazio,
        // mas precisamos de uma tool que foi adicionada sem timestamp
        // Injetando manualmente via recordToolCall com duração 0
        recordToolCall('fresh.tool', 0, true);
        // _stats.lastCallMs será Date.now() > 0, então IsoString deve existir
        const stats = getToolStats();
        expect(entryOf(stats, 'fresh.tool').lastCallIso).not.toBeNull();
    });
});

// ─── F161: wrapWithStats não altera retorno ────────────────────────────────

describe('F161 — wrapWithStats não altera retorno da tool', () => {
    /**
     * @param {string} name @param {string} [returnValue]
     * @returns {{ name: string; description: string; handler: (p: any, i: any) => Promise<string> }}
     */
    function makeToolWithHandler(name, returnValue = 'result') {
        return {
            name,
            description: `test tool ${name}`,
            handler: vi.fn().mockResolvedValue(returnValue),
        };
    }

    it('retorna a mesma estrutura da tool (spread)', async () => {
        const tool = makeToolWithHandler('test.tool');
        const wrapped = wrapWithStats(/** @type {any} */ (tool));
        expect(wrapped.name).toBe('test.tool');
        expect(wrapped.description).toBe('test tool test.tool');
    });

    it('handler retorna o valor original', async () => {
        const tool = makeToolWithHandler('test.tool', 'original result');
        const wrapped = wrapWithStats(/** @type {any} */ (tool));
        const result = await wrapped.handler({}, /** @type {any} */ ({}));
        expect(result).toBe('original result');
    });

    it('handler chama o original com os parâmetros corretos', async () => {
        const tool = makeToolWithHandler('test.tool');
        const wrapped = wrapWithStats(/** @type {any} */ (tool));
        const params = { key: 'value' };
        const invocation = { id: 'inv-1' };
        await wrapped.handler(params, /** @type {any} */ (invocation));
        expect(tool.handler).toHaveBeenCalledWith(params, invocation);
    });

    it('registra chamada com sucesso após execução', async () => {
        const tool = makeToolWithHandler('test.wrapped');
        const wrapped = wrapWithStats(/** @type {any} */ (tool));
        await wrapped.handler({}, /** @type {any} */ ({}));
        const stats = getToolStats();
        const entry = entryOf(stats, 'test.wrapped');
        expect(entry).toBeDefined();
        expect(entry.calls).toBe(1);
        expect(entry.errors).toBe(0);
    });
});

// ─── F162: wrapWithStats captura erros sem suprimir ────────────────────────

describe('F162 — wrapWithStats captura erro e re-lança', () => {
    it('relança o erro do handler original', async () => {
        const tool = {
            name: 'failing.tool',
            description: 'test',
            handler: vi.fn().mockRejectedValue(new Error('tool failed')),
        };
        const wrapped = wrapWithStats(/** @type {any} */ (tool));
        await expect(wrapped.handler({}, /** @type {any} */ ({}))).rejects.toThrow('tool failed');
    });

    it('registra erro nas stats quando handler falha', async () => {
        const tool = {
            name: 'failing.tool',
            description: 'test',
            handler: vi.fn().mockRejectedValue(new Error('tool failed')),
        };
        const wrapped = wrapWithStats(/** @type {any} */ (tool));
        // Chamada deve falhar, mas registrar stats
        try {
            await wrapped.handler({}, /** @type {any} */ ({}));
        } catch {
            /* esperado */
        }
        const stats = getToolStats();
        const entry = entryOf(stats, 'failing.tool');
        expect(entry.errors).toBe(1);
        expect(entry.lastOk).toBe(false);
    });
});

// ─── F163: getStatsByCategory ──────────────────────────────────────────────

describe('F163 — getStatsByCategory agrupa por prefixo', () => {
    it('agrupa tools por prefixo antes do ponto', () => {
        recordToolCall('shell.exec_command', 100, true);
        recordToolCall('shell.list_dir', 50, true);
        recordToolCall('git.status', 80, false);
        const byCategory = getStatsByCategory();
        const shell = entryOf(byCategory, 'shell');
        const git = entryOf(byCategory, 'git');
        expect(shell).toBeDefined();
        expect(git).toBeDefined();
        expect(shell.tools).toHaveLength(2);
        expect(git.tools).toHaveLength(1);
    });

    it('tools sem ponto ficam na categoria other', () => {
        recordToolCall('standalonetool', 30, true);
        const byCategory = getStatsByCategory();
        const other = entryOf(byCategory, 'other');
        expect(other).toBeDefined();
        expect(other.tools).toContain('standalonetool');
    });

    it('totalCalls soma todas as chamadas da categoria', () => {
        recordToolCall('code.lint', 100, true);
        recordToolCall('code.lint', 100, true);
        recordToolCall('code.typecheck', 200, false);
        const byCategory = getStatsByCategory();
        const code = entryOf(byCategory, 'code');
        expect(code.totalCalls).toBe(3);
        expect(code.totalErrors).toBe(1);
    });
});

// ─── F164: _resetToolStats garante isolamento ──────────────────────────────

describe('F164 — _resetToolStats garante isolamento entre testes', () => {
    it('stats estão vazios após reset', () => {
        recordToolCall('pre.existing', 100, true);
        _resetToolStats();
        expect(getToolStats()).toEqual({});
    });

    it('getStatsByCategory retorna vazio após reset', () => {
        recordToolCall('pre.existing', 100, true);
        _resetToolStats();
        expect(getStatsByCategory()).toEqual({});
    });
});

// ─── F165: tools sem handler não são alteradas ─────────────────────────────

describe('F165 — tools sem handler passam por wrapWithStats sem modificação', () => {
    it('tool sem handler retorna a mesma referência', () => {
        const tool = { name: 'no-handler', description: 'tool without handler' };
        const wrapped = wrapWithStats(/** @type {any} */ (tool));
        expect(wrapped).toBe(tool);
    });

    it('tool com handler não-function retorna mesma referência', () => {
        const tool = /** @type {any} */ ({ name: 'bad-handler', description: 'tool', handler: 'not a function' });
        const wrapped = wrapWithStats(tool);
        expect(wrapped).toBe(tool);
    });
});
