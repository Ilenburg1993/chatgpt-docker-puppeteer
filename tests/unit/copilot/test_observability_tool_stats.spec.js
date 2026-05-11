// @ts-check
/**
 * tests/unit/copilot/test_observability_tool_stats.spec.js
 *
 * Testes unitários para src/copilot/observability/tool-stats.js.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'vitest';

describe('tool-stats — estatísticas de ferramentas', () => {
    beforeEach(async () => {
        const { _resetToolStats } = await import('../../../src/copilot/observability/tool-stats.js');
        _resetToolStats();
    });

    it('getToolStats retorna objeto inicialmente', async () => {
        const { getToolStats } = await import('../../../src/copilot/observability/tool-stats.js');
        const stats = getToolStats();
        assert.ok(stats !== null && typeof stats === 'object', 'getToolStats deve retornar objeto');
    });

    it('recordToolCall registra chamada de ferramenta', async () => {
        const { recordToolCall, getToolStats } = await import('../../../src/copilot/observability/tool-stats.js');
        recordToolCall('my_tool', 50, true);
        const stats = getToolStats();
        assert.ok('my_tool' in stats, 'Deve conter chave my_tool após recordToolCall');
        assert.equal(stats['my_tool'].calls, 1, 'calls deve ser 1');
        assert.equal(stats['my_tool'].avgLatencyMs, 50, 'avgLatencyMs deve ser 50');
    });

    it('recordBlockedToolCall registra bloqueio sem contar execução', async () => {
        const { recordBlockedToolCall, getToolStats } =
            await import('../../../src/copilot/observability/tool-stats.js');
        recordBlockedToolCall('my_tool');
        const stats = getToolStats();
        const myTool = stats['my_tool'];
        assert.ok(myTool, 'stats deve conter my_tool após blocked record');
        assert.equal(myTool.calls, 0, 'calls deve permanecer 0 para bloqueios');
        assert.equal(myTool.blocked, 1, 'blocked deve ser 1');
    });

    it('getStatsByCategory retorna objeto', async () => {
        const { getStatsByCategory } = await import('../../../src/copilot/observability/tool-stats.js');
        const byCat = getStatsByCategory();
        assert.ok(byCat !== null && typeof byCat === 'object', 'getStatsByCategory deve retornar objeto');
    });

    it('wrapWithStats é função', async () => {
        const { wrapWithStats } = await import('../../../src/copilot/observability/tool-stats.js');
        assert.equal(typeof wrapWithStats, 'function', 'wrapWithStats deve ser função');
    });
});
