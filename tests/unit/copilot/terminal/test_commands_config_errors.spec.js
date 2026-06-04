// @ts-check

import { describe, expect, it, vi } from 'vitest';

const readTerminalConfigProjection = vi.fn(
    /** @returns {any} */ () => ({
        currentModel: 'gpt-5',
        currentReasoningEffort: 'high',
        modelMeta: {
            costTier: 'high',
            speedTier: 'fast',
            contextWindow: 128000,
            supportsReasoning: true,
            supportsVision: true,
        },
        autoModelPolicy: {
            configuredModel: 'gpt-5',
            observedModel: null,
            preferredModel: 'gpt-5.4',
            preferredReasoningEffort: 'high',
            preferenceSatisfied: null,
            selectionAuthority: 'github-copilot',
            canForcePreference: false,
            criteria: [],
            excludedByAuto: [],
        },
        binding: { hubSessionId: 'hub-1', sdkSessionId: 'sdk-1' },
        runtimeSessionId: 'sdk-1',
    }),
);
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
const setTerminalModelProjection = vi.fn((modelId) => ({
    previousModel: 'gpt-5',
    previousReasoningEffort: 'high',
    currentModel: modelId,
    currentReasoningEffort: modelId === 'gpt-4.1' ? 'off' : 'high',
    reasoningAdjusted: modelId === 'gpt-4.1',
    modelMeta:
        modelId === 'gpt-4.1'
            ? {
                  costTier: 'medium',
                  speedTier: 'fast',
                  contextWindow: 1047576,
                  supportsReasoning: false,
                  supportsVision: false,
              }
            : modelId === 'auto'
              ? null
              : {
                    costTier: 'high',
                    speedTier: 'fast',
                    contextWindow: 128000,
                    supportsReasoning: true,
                    supportsVision: true,
                },
}));
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
const readTerminalRuntimeState = vi.fn(() => ({
    lastPrInfo: { model: 'claude-haiku-4.5', configuredModel: 'gpt-4.1', modelMismatch: true, ts: 10 },
}));

vi.mock('../../../../src/copilot/terminal/frontend/index.js', () => ({
    readTerminalConfigProjection,
    readTerminalModelStatsProjection,
    listTerminalAvailableModelsProjection,
    readTerminalRuntimeState,
    setTerminalModelProjection,
    setTerminalReasoningProjection,
    readTerminalErrorsProjection,
}));

const { cmdModel, cmdReasoning } = await import('../../../../src/copilot/terminal/commands/config.js');
const { cmdErrors } = await import('../../../../src/copilot/terminal/commands/errors.js');

function mockCtx() {
    /** @type {string[]} */
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
        expect(ctx.output()).toContain('Recursos');
        expect(ctx.output()).toContain('raciocínio sim');
        expect(readTerminalConfigProjection).toHaveBeenCalled();
    });

    it('cmdModel sem args explica Auto quando configurado', async () => {
        readTerminalConfigProjection.mockReturnValueOnce({
            currentModel: 'auto',
            currentReasoningEffort: 'high',
            modelMeta: null,
            autoModelPolicy: {
                configuredModel: 'auto',
                observedModel: 'claude-haiku-4.5',
                preferredModel: 'gpt-5.4',
                preferredReasoningEffort: 'high',
                preferenceSatisfied: false,
                selectionAuthority: 'github-copilot',
                canForcePreference: false,
                criteria: [],
                excludedByAuto: [],
            },
        });
        const ctx = mockCtx();

        await cmdModel({ println: ctx.println });

        expect(ctx.output()).toContain('preferência local gpt-5.4/high');
        expect(ctx.output()).toContain('Efetivo');
        expect(ctx.output()).toContain('claude-haiku-4.5');
        expect(ctx.output()).not.toContain('preferência local=');
        expect(ctx.output()).not.toContain('último efetivo=');
    });

    it('cmdModel stats usa stats projection', async () => {
        const ctx = mockCtx();

        await cmdModel({ println: ctx.println }, 'stats');

        expect(ctx.output()).toContain('Estatísticas por modelo');
        expect(ctx.output()).toContain('latência média 120ms');
        expect(readTerminalModelStatsProjection).toHaveBeenCalled();
    });

    it('cmdModel list usa models projection', async () => {
        const ctx = mockCtx();

        await cmdModel({ println: ctx.println }, 'list');

        expect(ctx.output()).toContain('modelo(s) disponível');
        expect(ctx.output()).toContain('gpt-4.1');
        expect(listTerminalAvailableModelsProjection).toHaveBeenCalled();
    });

    it('cmdModel encaminha runtimeId explícito para a projection', async () => {
        const ctx = mockCtx();

        await cmdModel({ println: ctx.println }, '--runtime alt list');

        expect(listTerminalAvailableModelsProjection).toHaveBeenCalledWith('alt');
    });

    it('cmdReasoning atualiza via projection canônica', () => {
        const ctx = mockCtx();

        cmdReasoning({ println: ctx.println }, 'medium');

        expect(setTerminalReasoningProjection).toHaveBeenCalledWith('medium');
        expect(ctx.output()).toContain('Raciocínio alterado');
    });

    it('cmdReasoning mostra rótulo cotidiano ao consultar o nível atual', () => {
        const ctx = mockCtx();

        cmdReasoning({ println: ctx.println }, '');

        expect(ctx.output()).toContain('Nível de raciocínio');
        expect(ctx.output()).not.toContain('Reasoning effort');
    });

    it('cmdReasoning encaminha runtimeId explícito para a mutation', () => {
        const ctx = mockCtx();

        cmdReasoning({ println: ctx.println }, '--runtime alt medium');

        expect(setTerminalReasoningProjection).toHaveBeenCalledWith('medium', 'alt');
    });

    it('cmdModel explica ajuste de reasoning quando o modelo alvo não suporta capability', async () => {
        const ctx = mockCtx();

        await cmdModel({ println: ctx.println }, 'gpt-4.1');

        expect(setTerminalModelProjection).toHaveBeenCalledWith('gpt-4.1');
        expect(ctx.output()).toContain('Modelo solicitado');
        expect(ctx.output()).toContain('Raciocínio');
        expect(ctx.output()).toContain('high → off');
        expect(ctx.output()).not.toContain('Reasoning ajustado');
        expect(ctx.output()).toContain('raciocínio não');
        expect(ctx.output()).toContain('Efetivo');
        expect(ctx.output()).toContain('claude-haiku-4.5');
    });

    it('cmdModel auto preserva roteamento nativo e explica preferência advisory', async () => {
        const ctx = mockCtx();

        await cmdModel({ println: ctx.println }, 'auto');

        expect(setTerminalModelProjection).toHaveBeenCalledWith('auto');
        expect(ctx.output()).toContain('Auto');
        expect(ctx.output()).toContain('roteamento nativo do Copilot');
        expect(ctx.output()).toContain('gpt-5.4/high');
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
