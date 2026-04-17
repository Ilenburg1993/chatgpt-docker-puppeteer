// @ts-check

import { describe, expect, it, vi } from 'vitest';

const readTerminalConfigProjection = vi.fn(() => ({
    currentModel: 'gpt-5',
    currentReasoningEffort: 'high',
    modelMeta: { costTier: 'high', speedTier: 'fast', contextWindow: 128000 },
    binding: { hubSessionId: 'hub-1', sdkSessionId: 'sdk-1' },
    runtimeSessionId: 'sdk-1',
}));
const readTerminalModelStatsProjection = vi.fn(() => ({
    currentModel: 'gpt-5',
    stats: [{ modelId: 'gpt-5', totalCalls: 4, avgLatencyMs: 120, successRate: 0.75, totalTokens: 987 }],
}));
const listTerminalAvailableModelsProjection = vi.fn(async () => ({
    currentModel: 'gpt-5',
    models: [
        { id: 'gpt-5', capabilities: { supports: { reasoningEffort: true, vision: true } } },
        { id: 'gpt-4.1', capabilities: { supports: { reasoningEffort: false, vision: false } } },
    ],
}));
const setTerminalModelProjection = vi.fn((modelId) => ({ previousModel: 'gpt-5', currentModel: modelId }));
const setTerminalReasoningProjection = vi.fn((effort) => ({
    previousReasoningEffort: 'high',
    currentReasoningEffort: effort ?? 'off',
}));
const readTerminalErrorsProjection = vi.fn(() => ({
    stats: { total: 3, buffered: 2 },
    recent: [
        { timestamp: 1713250000000, errorType: 'TypeError', source: 'agent', message: 'boom' },
        { timestamp: 1713250001000, errorType: 'Error', source: 'sdk', message: 'oops' },
    ],
}));

vi.mock('../../../../src/copilot/terminal/frontend/index.js', () => ({
    readTerminalConfigProjection,
    readTerminalModelStatsProjection,
    listTerminalAvailableModelsProjection,
    setTerminalModelProjection,
    setTerminalReasoningProjection,
    readTerminalErrorsProjection,
}));

const { cmdModel, cmdReasoning } = await import('../../../../src/copilot/terminal/commands/config.js');
const { cmdErrors } = await import('../../../../src/copilot/terminal/commands/errors.js');

function mockCtx() {
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    return { println, output: () => lines.join('\n') };
}

describe('terminal commands config/errors com frontend canônico', () => {
    it('cmdModel sem args usa projection de config', async () => {
        const ctx = mockCtx();

        await cmdModel({ println: ctx.println });

        expect(ctx.output()).toContain('Modelo ativo');
        expect(ctx.output()).toContain('gpt-5');
        expect(readTerminalConfigProjection).toHaveBeenCalled();
    });

    it('cmdModel stats usa stats projection', async () => {
        const ctx = mockCtx();

        await cmdModel({ println: ctx.println }, 'stats');

        expect(ctx.output()).toContain('Estatísticas por modelo');
        expect(ctx.output()).toContain('avg_latency=120ms');
        expect(readTerminalModelStatsProjection).toHaveBeenCalled();
    });

    it('cmdModel list usa models projection', async () => {
        const ctx = mockCtx();

        await cmdModel({ println: ctx.println }, 'list');

        expect(ctx.output()).toContain('modelo(s) disponível');
        expect(ctx.output()).toContain('gpt-4.1');
        expect(listTerminalAvailableModelsProjection).toHaveBeenCalled();
    });

    it('cmdReasoning atualiza via projection canônica', () => {
        const ctx = mockCtx();

        cmdReasoning({ println: ctx.println }, 'medium');

        expect(setTerminalReasoningProjection).toHaveBeenCalledWith('medium');
        expect(ctx.output()).toContain('Reasoning trocado');
    });

    it('cmdErrors usa projection de erros do frontend', () => {
        const ctx = mockCtx();

        cmdErrors({ println: ctx.println }, '2');

        expect(readTerminalErrorsProjection).toHaveBeenCalledWith(2);
        expect(ctx.output()).toContain('Erros rastreados');
        expect(ctx.output()).toContain('TypeError');
        expect(ctx.output()).toContain('boom');
    });
});
