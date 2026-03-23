// @ts-check
/**
 * tests/unit/copilot/test_lib_models.spec.js
 *
 * Testes unitários para src/copilot/lib/models.js Usa mocks de ModelInfo sem chamar o SDK real.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    buildReasoningConfig,
    filterEnabledModels,
    filterReasoningModels,
    filterVisionModels,
    getContextWindowSize,
    getModelById,
    getSupportedReasoningEfforts,
    indexModelsById,
    pickModel,
    resolveModelId,
    supportsReasoning,
} from '../../../src/copilot/lib/models.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** @returns {import('@github/copilot-sdk').ModelInfo} */
function makeModel(id, overrides = {}) {
    return {
        id,
        name: `Model ${id}`,
        capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: 128000 },
        },
        ...overrides,
    };
}

/** @returns {import('@github/copilot-sdk').ModelInfo} */
function makeVisionModel(id) {
    return makeModel(id, {
        capabilities: {
            supports: { vision: true, reasoningEffort: false },
            limits: { max_context_window_tokens: 64000 },
        },
    });
}

/** @returns {import('@github/copilot-sdk').ModelInfo} */
function makeReasoningModel(id, efforts = ['low', 'medium', 'high']) {
    return makeModel(id, {
        capabilities: {
            supports: { vision: false, reasoningEffort: true },
            limits: { max_context_window_tokens: 200000 },
        },
        supportedReasoningEfforts: efforts,
        defaultReasoningEffort: 'medium',
    });
}

/** @returns {import('@github/copilot-sdk').ModelInfo} */
function makeDisabledModel(id) {
    return makeModel(id, {
        policy: { state: 'disabled', terms: '' },
    });
}

/** @returns {import('@github/copilot-sdk').ModelInfo} */
function makeEnabledModel(id) {
    return makeModel(id, {
        policy: { state: 'enabled', terms: '' },
    });
}

// ─── filterEnabledModels ──────────────────────────────────────────────────────

describe('filterEnabledModels', () => {
    it('deve incluir modelos sem policy (default = habilitado)', () => {
        const m = makeModel('m1');
        assert.equal(filterEnabledModels([m]).length, 1);
    });

    it('deve incluir modelos com policy.state = enabled', () => {
        const m = makeEnabledModel('m2');
        assert.equal(filterEnabledModels([m]).length, 1);
    });

    it('deve excluir modelos com policy.state = disabled', () => {
        const m = makeDisabledModel('m3');
        assert.equal(filterEnabledModels([m]).length, 0);
    });

    it('deve excluir modelos com policy.state = unconfigured', () => {
        const m = makeModel('m4', { policy: { state: 'unconfigured', terms: '' } });
        assert.equal(filterEnabledModels([m]).length, 0);
    });

    it('deve filtrar lista mista corretamente', () => {
        const models = [makeEnabledModel('ok'), makeDisabledModel('no'), makeModel('noPolicy')];
        const result = filterEnabledModels(models);
        assert.equal(result.length, 2);
        assert.ok(result.some((m) => m.id === 'ok'));
        assert.ok(result.some((m) => m.id === 'noPolicy'));
    });
});

// ─── filterReasoningModels ────────────────────────────────────────────────────

describe('filterReasoningModels', () => {
    it('deve incluir apenas modelos com reasoning = true', () => {
        const models = [makeModel('plain'), makeReasoningModel('reasoner')];
        const result = filterReasoningModels(models);
        assert.equal(result.length, 1);
        assert.equal(result[0].id, 'reasoner');
    });

    it('deve retornar array vazio se nenhum suportar reasoning', () => {
        assert.deepEqual(filterReasoningModels([makeModel('m')]), []);
    });
});

// ─── filterVisionModels ───────────────────────────────────────────────────────

describe('filterVisionModels', () => {
    it('deve incluir apenas modelos com vision = true', () => {
        const models = [makeModel('text-only'), makeVisionModel('vision-model')];
        const result = filterVisionModels(models);
        assert.equal(result.length, 1);
        assert.equal(result[0].id, 'vision-model');
    });

    it('deve retornar array vazio se nenhum suportar vision', () => {
        assert.deepEqual(filterVisionModels([makeModel('m')]), []);
    });
});

// ─── pickModel ────────────────────────────────────────────────────────────────

describe('pickModel', () => {
    it('deve retornar o primeiro modelo habilitado por padrão', () => {
        const models = [makeEnabledModel('first'), makeEnabledModel('second')];
        assert.equal(pickModel(models)?.id, 'first');
    });

    it('deve excluir modelos desabilitados quando enabledOnly = true (padrão)', () => {
        const models = [makeDisabledModel('disabled'), makeEnabledModel('enabled')];
        assert.equal(pickModel(models)?.id, 'enabled');
    });

    it('deve incluir modelos desabilitados quando enabledOnly = false', () => {
        const models = [makeDisabledModel('disabled'), makeEnabledModel('enabled')];
        assert.equal(pickModel(models, { enabledOnly: false })?.id, 'disabled');
    });

    it('deve retornar undefined se nenhum modelo passar nos critérios', () => {
        const models = [makeDisabledModel('d')];
        assert.equal(pickModel(models), undefined);
    });

    it('deve priorizar modelo preferido se disponível e compatível', () => {
        const models = [makeEnabledModel('a'), makeEnabledModel('b'), makeEnabledModel('c')];
        assert.equal(pickModel(models, { prefer: 'b' })?.id, 'b');
    });

    it('deve usar fallback se modelo preferido não estiver disponível', () => {
        const models = [makeEnabledModel('a'), makeEnabledModel('b')];
        assert.equal(pickModel(models, { prefer: 'c' })?.id, 'a');
    });

    it('deve filtrar por vision', () => {
        const models = [makeEnabledModel('text'), makeVisionModel('vision')];
        // makeVisionModel não tem policy então é habilitado por padrão
        assert.equal(pickModel(models, { vision: true })?.id, 'vision');
    });

    it('deve filtrar por reasoning', () => {
        const models = [makeEnabledModel('text'), makeReasoningModel('reasoning')];
        assert.equal(pickModel(models, { reasoning: true })?.id, 'reasoning');
    });
});

// ─── resolveModelId ───────────────────────────────────────────────────────────

describe('resolveModelId', () => {
    it('deve retornar o ID do modelo preferido se habilitado', () => {
        const models = [makeEnabledModel('gpt-4'), makeEnabledModel('claude')];
        assert.equal(resolveModelId(models, 'claude'), 'claude');
    });

    it('deve usar fallback se modelo preferido não existir', () => {
        const models = [makeEnabledModel('gpt-4')];
        assert.equal(resolveModelId(models, 'claude'), 'gpt-4.1');
    });

    it('deve usar fallback customizado se fornecido', () => {
        const models = [makeEnabledModel('gpt-4')];
        assert.equal(resolveModelId(models, 'missing', 'gpt-4'), 'gpt-4');
    });

    it('deve retornar fallback se modelo preferido estiver desabilitado', () => {
        const models = [makeDisabledModel('claude'), makeEnabledModel('gpt-4')];
        assert.equal(resolveModelId(models, 'claude', 'gpt-4'), 'gpt-4');
    });
});

// ─── supportsReasoning ────────────────────────────────────────────────────────

describe('supportsReasoning', () => {
    it('deve retornar true para modelos com reasoning = true', () => {
        assert.equal(supportsReasoning(makeReasoningModel('r')), true);
    });

    it('deve retornar false para modelos sem reasoning', () => {
        assert.equal(supportsReasoning(makeModel('plain')), false);
    });
});

// ─── getSupportedReasoningEfforts ────────────────────────────────────────────

describe('getSupportedReasoningEfforts', () => {
    it('deve retornar lista de esforços do modelo', () => {
        const m = makeReasoningModel('r', ['low', 'high']);
        assert.deepEqual(getSupportedReasoningEfforts(m), ['low', 'high']);
    });

    it('deve retornar default se supportedReasoningEfforts ausente', () => {
        const m = makeReasoningModel('r');
        delete (/** @type {any} */ (m).supportedReasoningEfforts);
        const efforts = getSupportedReasoningEfforts(m);
        assert.ok(efforts.includes('low'));
        assert.ok(efforts.includes('high'));
    });

    it('deve retornar array vazio para modelo sem reasoning', () => {
        assert.deepEqual(getSupportedReasoningEfforts(makeModel('plain')), []);
    });
});

// ─── buildReasoningConfig ─────────────────────────────────────────────────────

describe('buildReasoningConfig', () => {
    it('deve incluir reasoningEffort para modelos que suportam', () => {
        const models = [makeReasoningModel('claude', ['low', 'medium', 'high'])];
        const cfg = buildReasoningConfig(models, 'claude', 'high');
        assert.equal(cfg.model, 'claude');
        assert.equal(cfg.reasoningEffort, 'high');
    });

    it('deve omitir reasoningEffort para modelos que não suportam', () => {
        const models = [makeModel('gpt-4')];
        const cfg = buildReasoningConfig(models, 'gpt-4', 'high');
        assert.equal(cfg.model, 'gpt-4');
        assert.equal(Object.prototype.hasOwnProperty.call(cfg, 'reasoningEffort'), false);
    });

    it('deve lançar erro se effort não for suportado pelo modelo', () => {
        const models = [makeReasoningModel('claude', ['low', 'medium'])];
        assert.throws(
            // @ts-expect-error teste com valor inválido
            () => buildReasoningConfig(models, 'claude', 'xhigh'),
            /xhigh.*não é suportado|não é suportado.*xhigh/,
        );
    });

    it('deve retornar com effort se modelo não encontrado na lista', () => {
        // Modelo desconhecido — passa através sem validação
        const cfg = buildReasoningConfig([], 'unknown-model', 'low');
        assert.equal(cfg.model, 'unknown-model');
        assert.equal(cfg.reasoningEffort, 'low');
    });
});

// ─── getModelById ─────────────────────────────────────────────────────────────

describe('getModelById', () => {
    it('deve retornar o modelo com o ID correspondente', () => {
        const models = [makeModel('a'), makeModel('b')];
        assert.equal(getModelById(models, 'b')?.id, 'b');
    });

    it('deve retornar undefined se não encontrar', () => {
        assert.equal(getModelById([makeModel('a')], 'x'), undefined);
    });
});

// ─── indexModelsById ──────────────────────────────────────────────────────────

describe('indexModelsById', () => {
    it('deve retornar objeto com chaves = IDs dos modelos', () => {
        const models = [makeModel('a'), makeModel('b'), makeModel('c')];
        const index = indexModelsById(models);
        assert.ok(index['a']);
        assert.ok(index['b']);
        assert.ok(index['c']);
    });

    it('deve preservar referência ao objeto ModelInfo', () => {
        const m = makeModel('x');
        const index = indexModelsById([m]);
        assert.strictEqual(index['x'], m);
    });

    it('deve retornar objeto vazio para array vazio', () => {
        assert.deepEqual(indexModelsById([]), {});
    });
});

// ─── getContextWindowSize ─────────────────────────────────────────────────────

describe('getContextWindowSize', () => {
    it('deve retornar o tamanho de contexto do modelo', () => {
        const m = makeModel('gpt', {
            capabilities: {
                supports: { vision: false, reasoningEffort: false },
                limits: { max_context_window_tokens: 32000 },
            },
        });
        assert.equal(getContextWindowSize([m], 'gpt'), 32000);
    });

    it('deve retornar undefined para modelo não encontrado', () => {
        assert.equal(getContextWindowSize([makeModel('a')], 'x'), undefined);
    });
});
