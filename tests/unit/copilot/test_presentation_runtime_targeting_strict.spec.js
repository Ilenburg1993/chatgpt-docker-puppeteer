// @ts-check

import { describe, expect, it, vi } from 'vitest';

const defaultRuntime = /** @type {any} */ ({
    getStatusSnapshot: () => ({ status: 'idle', model: 'gpt-5-mini' }),
    getToolRegistryEntriesSnapshot: () => [{ name: 'read_file', category: 'file' }],
});

vi.mock('#copilot/agent', () => ({
    listSdkCatalogModels: vi.fn(async () => [{ id: 'gpt-5-mini' }]),
    readRuntimeModelSelection: vi.fn(() => ({ model: 'gpt-5-mini', reasoningEffort: 'high' })),
    readSdkModelMetadata: vi.fn(() => ({ supportsReasoning: true })),
    readSdkModelStats: vi.fn(() => ({ total: 1 })),
    setRuntimeModel: vi.fn(),
    setRuntimeReasoningEffort: vi.fn(),
    readAgentRuntimeTools: vi.fn(() => ({ ok: true, source: 'registry', count: 1, tools: [{ name: 'read_file' }] })),
}));

vi.mock('../../../src/copilot/presentation/agent-runtime.js', async (importOriginal) => {
    const actual = /** @type {any} */ (await importOriginal());
    return {
        ...actual,
        requireAgentRuntimeSelection: (/** @type {string | null | undefined} */ runtimeId) => {
            if (runtimeId === 'missing') {
                throw Object.assign(new Error("Runtime 'missing' não encontrado."), {
                    name: 'NotFoundError',
                    code: 'AGENT_RUNTIME_NOT_FOUND',
                    status: 404,
                });
            }
            return {
                runtime: defaultRuntime,
                requestedRuntimeId: runtimeId ?? null,
                runtimeId: runtimeId ?? 'default',
                runtimeFound: true,
                usedDefaultRuntimeFallback: false,
                defaultRuntimeId: 'default',
            };
        },
    };
});

describe('presentation strict runtime targeting', () => {
    it('rejeita runtimeId inexistente em runtime-models', async () => {
        const mod = await import('../../../src/copilot/presentation/runtime-models.js');

        await expect(mod.listRuntimeAvailableModelsProjection('missing')).rejects.toThrow(
            "Runtime 'missing' não encontrado.",
        );
        expect(() => mod.readRuntimeModelStatsProjection('missing')).toThrow("Runtime 'missing' não encontrado.");
        expect(() => mod.setRuntimeModelProjection('gpt-5-mini', 'missing')).toThrow(
            "Runtime 'missing' não encontrado.",
        );
    });

    it('rejeita runtimeId inexistente em runtime-tools', async () => {
        const mod = await import('../../../src/copilot/presentation/runtime-tools.js');

        expect(() => mod.readAgentRuntimeToolsProjectionForRuntime('missing')).toThrow(
            "Runtime 'missing' não encontrado.",
        );
    });
});
