// @ts-check
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────

const { mockGetClient } = vi.hoisted(() => {
    /** @type {any} */
    const mockGetClient = vi.fn();
    return { mockGetClient };
});

vi.mock('@github/copilot-sdk', () => {
    const SYSTEM_PROMPT_SECTIONS = Object.freeze({
        identity: 'identity',
        tone: 'tone',
        tool_efficiency: 'tool_efficiency',
        environment_context: 'environment_context',
        code_change_rules: 'code_change_rules',
        guidelines: 'guidelines',
        safety: 'safety',
        instructions: 'instructions',
        docs: 'docs',
        context: 'context',
    });
    return {
        SYSTEM_MESSAGE_SECTIONS: SYSTEM_PROMPT_SECTIONS,
        SYSTEM_PROMPT_SECTIONS,
        CopilotClient: vi.fn(),
        defineTool: vi.fn(),
        approveAll: vi.fn(),
    };
});

vi.mock('#copilot/sdk/session', () => ({
    getClient: mockGetClient,
}));

vi.mock('#copilot/core/errors', () => ({
    ConfigError: class ConfigError extends Error {
        /** @param {string} msg */
        constructor(msg) {
            super(msg);
            this.name = 'ConfigError';
        }
    },
    CopilotError: class CopilotError extends Error {
        /** @param {string} msg */
        constructor(msg) {
            super(msg);
            this.name = 'CopilotError';
        }
    },
}));

// ─── Imports ───────────────────────────────────────────────────────────────

import { setModelListClientProvider } from '../../../../src/copilot/sdk/models/client-provider.js';
import {
    clearModelsCacheAsync,
    filterModels,
    getBillingMultiplier,
    getDefaultReasoningEffort,
    getMaxContextTokens,
    getMaxPromptTokens,
    getModelById,
    getSupportedReasoningEfforts,
    getVisionMediaTypes,
    hasVision,
    isModelEnabled,
    listModels,
    supportsReasoning,
} from '../../../../src/copilot/sdk/models/helpers.js';
import { KNOWN_MODELS } from '../../../../src/copilot/sdk/models/known-models.js';
import { createModelRuntime } from '../../../../src/copilot/sdk/models/registry.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

/** @returns {any} */
function makeModel(overrides = {}) {
    return {
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        capabilities: {
            supports: { vision: true, reasoningEffort: false },
            limits: {
                max_context_window_tokens: 128000,
                max_prompt_tokens: 64000,
                vision: {
                    supported_media_types: ['image/png', 'image/jpeg'],
                    max_prompt_images: 10,
                    max_prompt_image_size: 20000000,
                },
            },
        },
        policy: { state: 'enabled', terms: '' },
        billing: { multiplier: 1.0 },
        ...overrides,
    };
}

/** @returns {any} */
function makeReasoningModel() {
    return makeModel({
        id: 'o3',
        name: 'O3',
        capabilities: {
            supports: { vision: false, reasoningEffort: true },
            limits: { max_context_window_tokens: 200000 },
        },
        supportedReasoningEfforts: ['low', 'medium', 'high'],
        defaultReasoningEffort: 'medium',
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// F76 - getModelById + listModels
// ═════════════════════════════════════════════════════════════════════════════

describe('F76 - listModels / getModelById', () => {
    /** @type {any} */
    let mockClient;
    /** @type {string | undefined} */
    let originalPersistentCacheEnabled;

    beforeEach(async () => {
        originalPersistentCacheEnabled = process.env['COPILOT_MODEL_PERSISTENT_CACHE_ENABLED'];
        process.env['COPILOT_MODEL_PERSISTENT_CACHE_ENABLED'] = 'false';
        await clearModelsCacheAsync();
        setModelListClientProvider(mockGetClient);
        mockClient = {
            listModels: vi.fn().mockResolvedValue([makeModel(), makeReasoningModel()]),
        };
        mockGetClient.mockResolvedValue(mockClient);
    });

    afterEach(async () => {
        await clearModelsCacheAsync();
        if (originalPersistentCacheEnabled === undefined) {
            delete process.env['COPILOT_MODEL_PERSISTENT_CACHE_ENABLED'];
        } else {
            process.env['COPILOT_MODEL_PERSISTENT_CACHE_ENABLED'] = originalPersistentCacheEnabled;
        }
    });

    it('listModels retorna array de modelos via client', async () => {
        const models = await listModels();
        expect(models).toHaveLength(2);
        expect(mockClient.listModels).toHaveBeenCalledOnce();
    });

    it('listModels usa cache na segunda chamada', async () => {
        await listModels();
        await listModels();
        expect(mockClient.listModels).toHaveBeenCalledTimes(1);
    });

    it('listModels com forceRefresh bypassa cache', async () => {
        await listModels();
        await listModels({}, true);
        expect(mockClient.listModels).toHaveBeenCalledTimes(2);
    });

    it('getModelById encontra modelo por ID', () => {
        const models = [makeModel(), makeReasoningModel()];
        const model = getModelById(models, 'o3');
        expect(model).toBeDefined();
        expect(model?.id).toBe('o3');
    });

    it('getModelById retorna undefined para ID inexistente', () => {
        const models = [makeModel()];
        const model = getModelById(models, 'nao-existe');
        expect(model).toBeUndefined();
    });
});

describe('known model catalog', () => {
    it('inclui modelos atuais de Auto model selection como metadata estática', () => {
        expect(KNOWN_MODELS.some((model) => model.id === 'gpt-5.4')).toBe(true);
        expect(KNOWN_MODELS.some((model) => model.id === 'gpt-5.3-codex')).toBe(true);
        expect(KNOWN_MODELS.some((model) => model.id === 'claude-haiku-4.5')).toBe(true);
        expect(KNOWN_MODELS.some((model) => model.id === 'grok-code-fast-1')).toBe(true);
    });

    it('inclui claude-sonnet-4-5 como fallback estático', () => {
        expect(KNOWN_MODELS.some((model) => model.id === 'claude-sonnet-4-5')).toBe(true);
    });

    it('inclui variantes Claude 4.5 adicionais como fallback estático', () => {
        expect(KNOWN_MODELS.some((model) => model.id === 'claude-opus-4-5')).toBe(true);
        expect(KNOWN_MODELS.some((model) => model.id === 'claude-haiku-4-5')).toBe(true);
    });
});

describe('model runtime factory', () => {
    it('cria runtimes isolados para registry e métricas', () => {
        const runtimeA = createModelRuntime();
        const runtimeB = createModelRuntime();

        runtimeA.registry.register({
            id: 'local-only-model',
            costTier: 'low',
            speedTier: 'fast',
            contextWindow: 128_000,
            supportsReasoning: false,
            supportsVision: false,
        });
        runtimeA.statsTracker.record('gpt-4.1', { latencyMs: 100, success: true });

        expect(runtimeA.registry.get('local-only-model')?.id).toBe('local-only-model');
        expect(runtimeB.registry.get('local-only-model')).toBeUndefined();
        expect(runtimeA.statsTracker.getStats('gpt-4.1')?.totalCalls).toBe(1);
        expect(runtimeB.statsTracker.getStats('gpt-4.1')).toBeNull();
    });

    it('resolve metadata para IDs atuais e aliases legados', () => {
        const runtime = createModelRuntime();

        expect(runtime.registry.get('claude-haiku-4.5')?.id).toBe('claude-haiku-4.5');
        expect(runtime.registry.get('gpt54')?.id).toBe('gpt-5.4');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F77 - Capability helpers
// ═════════════════════════════════════════════════════════════════════════════

describe('F77 - hasVision', () => {
    it('retorna true para modelo com vision', () => {
        expect(hasVision(makeModel())).toBe(true);
    });

    it('retorna false para modelo sem vision', () => {
        expect(hasVision(makeReasoningModel())).toBe(false);
    });

    it('retorna false para modelo null/undefined', () => {
        expect(hasVision(/** @type {any} */ (null))).toBe(false);
        expect(hasVision(/** @type {any} */ (undefined))).toBe(false);
    });

    it('retorna false para modelo sem capabilities', () => {
        expect(hasVision(/** @type {any} */ ({ id: 'x', name: 'x' }))).toBe(false);
    });
});

describe('F77 - getMaxContextTokens / getMaxPromptTokens', () => {
    it('retorna max_context_window_tokens', () => {
        expect(getMaxContextTokens(makeModel())).toBe(128000);
    });

    it('retorna max_prompt_tokens', () => {
        expect(getMaxPromptTokens(makeModel())).toBe(64000);
    });

    it('retorna undefined para modelo sem capabilities', () => {
        expect(getMaxContextTokens(/** @type {any} */ ({}))).toBeUndefined();
        expect(getMaxPromptTokens(/** @type {any} */ ({}))).toBeUndefined();
    });

    it('retorna undefined para modelo null', () => {
        expect(getMaxContextTokens(/** @type {any} */ (null))).toBeUndefined();
    });
});

describe('F77 - getVisionMediaTypes', () => {
    it('retorna media types para modelo com vision', () => {
        const types = getVisionMediaTypes(makeModel());
        expect(types).toContain('image/png');
        expect(types).toContain('image/jpeg');
    });

    it('retorna array vazio para modelo sem vision', () => {
        expect(getVisionMediaTypes(makeReasoningModel())).toEqual([]);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F78 - Reasoning effort helpers
// ═════════════════════════════════════════════════════════════════════════════

describe('F78 - reasoning effort helpers', () => {
    it('supportsReasoning retorna true para modelo com reasoning', () => {
        expect(supportsReasoning(makeReasoningModel())).toBe(true);
    });

    it('supportsReasoning retorna false para modelo sem reasoning', () => {
        expect(supportsReasoning(makeModel())).toBe(false);
    });

    it('getSupportedReasoningEfforts retorna array de efforts', () => {
        const efforts = getSupportedReasoningEfforts(makeReasoningModel());
        expect(efforts).toEqual(['low', 'medium', 'high']);
    });

    it('getSupportedReasoningEfforts retorna [] para modelo sem reasoning', () => {
        expect(getSupportedReasoningEfforts(makeModel())).toEqual([]);
    });

    it('getDefaultReasoningEffort retorna default', () => {
        expect(getDefaultReasoningEffort(makeReasoningModel())).toBe('medium');
    });

    it('getDefaultReasoningEffort retorna undefined quando nao disponivel', () => {
        expect(getDefaultReasoningEffort(makeModel())).toBeUndefined();
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F79 - isModelEnabled / getBillingMultiplier (policy & billing)
// ═════════════════════════════════════════════════════════════════════════════

describe('F79 - policy & billing helpers', () => {
    it('isModelEnabled retorna true para modelo com state=enabled', () => {
        expect(isModelEnabled(makeModel())).toBe(true);
    });

    it('isModelEnabled retorna false para modelo com state=disabled', () => {
        const m = makeModel({ policy: { state: 'disabled', terms: '' } });
        expect(isModelEnabled(m)).toBe(false);
    });

    it('isModelEnabled retorna true quando policy nao definida', () => {
        const m = makeModel({ policy: undefined });
        expect(isModelEnabled(m)).toBe(true);
    });

    it('isModelEnabled retorna false para null', () => {
        expect(isModelEnabled(/** @type {any} */ (null))).toBe(false);
    });

    it('getBillingMultiplier retorna multiplier', () => {
        expect(getBillingMultiplier(makeModel({ billing: { multiplier: 2.5 } }))).toBe(2.5);
    });

    it('getBillingMultiplier retorna 1 como default', () => {
        expect(getBillingMultiplier(makeModel({ billing: undefined }))).toBe(1);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F80 - filterModels
// ═════════════════════════════════════════════════════════════════════════════

describe('F80 - filterModels', () => {
    const allModels = [makeModel(), makeReasoningModel()];

    it('filtra por vision=true', () => {
        const result = filterModels(allModels, { vision: true });
        expect(result).toHaveLength(1);
        expect(result[0]?.id).toBe('gpt-4.1');
    });

    it('filtra por reasoningEffort=true', () => {
        const result = filterModels(allModels, { reasoningEffort: true });
        expect(result).toHaveLength(1);
        expect(result[0]?.id).toBe('o3');
    });

    it('filtra por enabled=true', () => {
        const disabled = makeModel({ id: 'x', policy: { state: 'disabled', terms: '' } });
        const result = filterModels([...allModels, disabled], { enabled: true });
        expect(result).toHaveLength(2);
    });

    it('combina filtros', () => {
        const result = filterModels(allModels, { vision: true, reasoningEffort: false });
        expect(result).toHaveLength(1);
        expect(result[0]?.id).toBe('gpt-4.1');
    });

    it('retorna array vazio para input nao-array', () => {
        expect(filterModels(/** @type {any} */ (null), {})).toEqual([]);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// Barrel exports
// ═════════════════════════════════════════════════════════════════════════════

describe('Barrel - Faixa 14 exports', () => {
    it('barrel exporta todas as funcoes novas da F14', async () => {
        const barrel = /** @type {Record<string, unknown>} */ (await import('#copilot/sdk'));
        const expected = [
            'filterModels',
            'getBillingMultiplier',
            'getDefaultReasoningEffort',
            'getMaxContextTokens',
            'getMaxPromptTokens',
            'getVisionMediaTypes',
            'hasVision',
            'isModelEnabled',
        ];
        for (const name of expected) {
            expect(typeof barrel[name]).toBe('function');
        }
    });

    it('barrel mantém exports pre-existentes de models', async () => {
        const barrel = /** @type {Record<string, unknown>} */ (await import('#copilot/sdk'));
        const existing = [
            'buildReasoningConfig',
            'filterEnabledModels',
            'filterReasoningModels',
            'filterVisionModels',
            'getContextWindowSize',
            'getModelById',
            'getSupportedReasoningEfforts',
            'indexModelsById',
            'listModels',
            'pickModel',
            'resolveModelId',
            'supportsReasoning',
        ];
        for (const name of existing) {
            expect(typeof barrel[name]).toBe('function');
        }
    });
});
