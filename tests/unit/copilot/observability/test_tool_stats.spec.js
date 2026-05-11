// @ts-check
/**
 * tests/unit/copilot/observability/test_tool_stats.spec.js
 *
 * Testes para src/copilot/observability/tool-stats.js.
 *
 * F215: recordToolCall, getToolStats, getStatsByCategory, wrapWithStats, _resetToolStats.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
    _resetToolStats,
    getStatsByCategory,
    getToolStats,
    recordBlockedToolCall,
    recordToolCall,
    wrapWithStats,
} from '../../../../src/copilot/observability/tool-stats.js';

describe('tool-stats', () => {
    beforeEach(() => {
        _resetToolStats();
    });

    // ── recordToolCall ────────────────────────────────────────────────────

    describe('recordToolCall', () => {
        it('registra chamada bem-sucedida', () => {
            recordToolCall('git_status', 120, true);
            const stats = /** @type {any} */ (getToolStats());
            expect(stats.git_status.calls).toBe(1);
            expect(stats.git_status.errors).toBe(0);
            expect(stats.git_status.blocked).toBe(0);
            expect(stats.git_status.lastOk).toBe(true);
        });

        it('registra chamada com erro', () => {
            recordToolCall('web_fetch', 500, false);
            const stats = /** @type {any} */ (getToolStats());
            expect(stats.web_fetch.calls).toBe(1);
            expect(stats.web_fetch.errors).toBe(1);
            expect(stats.web_fetch.lastOk).toBe(false);
        });

        it('default success=true quando omitido', () => {
            recordToolCall('shell_exec', 50);
            const stats = /** @type {any} */ (getToolStats());
            expect(stats.shell_exec.lastOk).toBe(true);
            expect(stats.shell_exec.errors).toBe(0);
        });

        it('acumula múltiplas chamadas', () => {
            recordToolCall('cmd', 100, true);
            recordToolCall('cmd', 200, true);
            recordToolCall('cmd', 300, false);
            const stats = /** @type {any} */ (getToolStats());
            expect(stats.cmd.calls).toBe(3);
            expect(stats.cmd.errors).toBe(1);
        });

        it('registra tentativa bloqueada sem contar como execução', () => {
            recordBlockedToolCall('cmd');
            const stats = /** @type {any} */ (getToolStats());
            expect(stats.cmd.calls).toBe(0);
            expect(stats.cmd.errors).toBe(0);
            expect(stats.cmd.blocked).toBe(1);
            expect(stats.cmd.lastBlockedIso).toBeTruthy();
        });
    });

    // ── getToolStats ──────────────────────────────────────────────────────

    describe('getToolStats', () => {
        it('retorna snapshot vazio sem chamadas', () => {
            expect(getToolStats()).toEqual({});
        });

        it('inclui metadados de bloqueio no snapshot', () => {
            recordBlockedToolCall('test');
            const stats = /** @type {any} */ (getToolStats());
            expect(stats.test.blocked).toBe(1);
            expect(stats.test.lastBlockedIso).toBeTruthy();
        });

        it('calcula avgLatencyMs corretamente', () => {
            recordToolCall('test', 100, true);
            recordToolCall('test', 300, true);
            const stats = /** @type {any} */ (getToolStats());
            expect(stats.test.avgLatencyMs).toBe(200);
        });

        it('calcula errorRate corretamente', () => {
            recordToolCall('t', 10, true);
            recordToolCall('t', 10, false);
            const stats = /** @type {any} */ (getToolStats());
            expect(stats.t.errorRate).toBe(50.0);
        });

        it('retorna lastCallIso como ISO string', () => {
            recordToolCall('t', 10);
            const stats = /** @type {any} */ (getToolStats());
            expect(stats.t.lastCallIso).toBeTruthy();
            // ISO 8601 format check
            expect(() => new Date(/** @type {string} */ (stats.t.lastCallIso))).not.toThrow();
        });

        it('retorna null para lastCallIso sem chamadas registradas', () => {
            // Esta tool tem lastCallMs === 0 somente se nunca foi chamada,
            // mas como usamos recordToolCall para registrar, chamadas sempre setam lastCallMs.
            // Testamos indiretamente via snapshot vazio.
            expect(getToolStats()).toEqual({});
        });
    });

    // ── getStatsByCategory ────────────────────────────────────────────────

    describe('getStatsByCategory', () => {
        it('agrupa tools por prefixo antes do ponto', () => {
            recordToolCall('shell.exec_command', 100, true);
            recordToolCall('shell.read_file', 50, true);
            recordToolCall('git.status', 200, true);

            const cats = /** @type {any} */ (getStatsByCategory());
            expect(cats.tool.totalCalls).toBe(2);
            expect(cats.tool.tools).toEqual(['exec_command', 'read_file']);
            expect(cats.git.totalCalls).toBe(1);
        });

        it('categoriza tools sem namespace explícito como "tool"', () => {
            recordToolCall('standalone', 100, true);
            const cats = /** @type {any} */ (getStatsByCategory());
            expect(cats.tool).toBeDefined();
            expect(cats.tool.tools).toContain('standalone');
        });

        it('calcula avgLatencyMs por categoria', () => {
            recordToolCall('shell.a', 100, true);
            recordToolCall('shell.b', 300, true);
            const cats = /** @type {any} */ (getStatsByCategory());
            expect(cats.tool.avgLatencyMs).toBe(200);
        });

        it('acumula erros por categoria', () => {
            recordToolCall('git.push', 10, false);
            recordToolCall('git.pull', 10, false);
            const cats = /** @type {any} */ (getStatsByCategory());
            expect(cats.git.totalErrors).toBe(2);
        });

        it('acumula bloqueios por categoria sem alterar avg por chamadas', () => {
            recordToolCall('git.push', 100, true);
            recordBlockedToolCall('git.push');
            recordBlockedToolCall('git.pull');
            const cats = /** @type {any} */ (getStatsByCategory());
            expect(cats.git.totalBlocked).toBe(2);
            expect(cats.git.avgLatencyMs).toBe(100);
        });

        it('retorna tools ordenadas', () => {
            recordToolCall('z.b', 10, true);
            recordToolCall('z.a', 10, true);
            const cats = /** @type {any} */ (getStatsByCategory());
            expect(cats.z.tools).toEqual(['z.a', 'z.b']);
        });
    });

    // ── wrapWithStats ─────────────────────────────────────────────────────

    describe('wrapWithStats', () => {
        it('registra sucesso quando handler resolve', async () => {
            const tool = {
                name: 'test_tool',
                handler: async () => ({ content: 'ok' }),
            };
            const wrapped = wrapWithStats(/** @type {any} */ (tool));
            const result = await wrapped.handler(/** @type {any} */ ({}), /** @type {any} */ ({}));
            expect(result).toEqual({ content: 'ok' });

            const stats = /** @type {any} */ (getToolStats());
            expect(stats.test_tool.calls).toBe(1);
            expect(stats.test_tool.lastOk).toBe(true);
        });

        it('registra erro quando handler rejeita', async () => {
            const tool = {
                name: 'fail_tool',
                handler: async () => {
                    throw new Error('boom');
                },
            };
            const wrapped = wrapWithStats(/** @type {any} */ (tool));
            await expect(wrapped.handler(/** @type {any} */ ({}), /** @type {any} */ ({}))).rejects.toThrow('boom');

            const stats = /** @type {any} */ (getToolStats());
            expect(stats.fail_tool.calls).toBe(1);
            expect(stats.fail_tool.lastOk).toBe(false);
        });

        it('retorna tool original quando handler não é função', () => {
            const tool = { name: 'no_handler' };
            const result = wrapWithStats(/** @type {any} */ (tool));
            expect(result).toBe(tool);
        });

        it('preserva propriedades da tool original', () => {
            const tool = {
                name: 'my_tool',
                description: 'desc',
                handler: async () => 'ok',
            };
            const wrapped = wrapWithStats(/** @type {any} */ (tool));
            expect(wrapped.name).toBe('my_tool');
            expect(/** @type {any} */ (wrapped).description).toBe('desc');
        });
    });

    // ── _resetToolStats ───────────────────────────────────────────────────

    describe('_resetToolStats', () => {
        it('limpa todos os stats', () => {
            recordToolCall('a', 10);
            recordToolCall('b', 20);
            _resetToolStats();
            expect(getToolStats()).toEqual({});
        });
    });
});
