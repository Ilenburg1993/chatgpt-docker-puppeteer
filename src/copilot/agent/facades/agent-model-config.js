// @ts-check
/**
 * src/copilot/agent/facades/agent-model-config.js
 *
 * Facade para configuração de modelo LLM em runtime: modelo, nível de raciocínio, modelos disponíveis. Extraído de
 * always-alive.js (O3 — PARTE-22).
 *
 * @module copilot/agent/facades/agent-model-config
 * @see EventBus
 */

import { resolveModelSelectionMismatch, toError } from '#copilot/core';
import { describeAutoModelPolicy, listModels, modelRegistry, modelStatsTracker } from '#copilot/sdk/models';
import { log } from '../ports/index.js';
import { trySetLiveSessionModel } from '../runtime/contracts/index.js';
import { readAgentRuntimeStatusSnapshot } from '../runtime/index.js';
import { persistAgentRuntimeStatePartial } from './agent-runtime-state.js';

/**
 * @param {import('../agent-context.js').AgentContext} ctx
 * @param {Partial<import('../lifecycle/state/index.js').AliveAgentState>} partial
 * @param {{ label: string; description: string }} meta
 * @returns {void}
 */
function persistRuntimeConfigChange(ctx, partial, meta) {
    const task = persistAgentRuntimeStatePartial(partial, { label: meta.label }).then((result) => {
        if (!result.ok) {
            throw result.error;
        }
        return undefined;
    });
    void ctx.trackBackgroundTask(task, meta);
}

/**
 * Retorna o ID do modelo atual configurado no contexto.
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @returns {string}
 */
export function getModel(ctx) {
    return ctx.getModelSnapshot();
}

/**
 * Troca o modelo em uso. Aplica também na sessão SDK ativa (se suportado).
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @param {string} modelId - ID do modelo (ex. `'gpt-4.1'`, `'claude-sonnet-4-5'`)
 * @returns {void}
 */
export function setModel(ctx, modelId) {
    ctx.setModel(modelId);
    const reasoningEffort = ctx.getReasoningEffortSnapshot();
    trySetLiveSessionModel(
        ctx.getSessionSnapshot(),
        modelId,
        'AlwaysAlive',
        modelId === 'auto' ? undefined : { reasoningEffort },
    );
    const previousPrInfo = ctx.getLastPrInfoSnapshot?.() ?? null;
    const previousEffectiveModel =
        typeof previousPrInfo?.effectiveModel === 'string' ? previousPrInfo.effectiveModel : undefined;
    const previousBilledModel = typeof previousPrInfo?.model === 'string' ? previousPrInfo.model : undefined;
    const sessionId = ctx.getSessionSnapshot()?.sessionId ?? previousPrInfo?.sessionId ?? null;
    ctx.setLastPrInfo({
        ...(previousPrInfo ?? { ts: Date.now() }),
        configuredModel: modelId,
        ...(previousEffectiveModel ? { effectiveModel: previousEffectiveModel } : {}),
        ...(previousBilledModel ? { model: previousBilledModel } : {}),
        modelMismatch: resolveModelSelectionMismatch({
            configuredModel: modelId,
            billedModel: previousBilledModel,
            effectiveModel: previousEffectiveModel,
        }),
        sessionId,
        ts: Date.now(),
    });
    persistRuntimeConfigChange(
        ctx,
        { model: modelId },
        {
            label: 'runtime.config.model',
            description: 'Persist current runtime model after operator change',
        },
    );
}

/**
 * Explica a política local de `model="auto"` sem assumir controle do roteamento interno do Copilot.
 *
 * @param {import('../types.js').IAlwaysAliveAgent} runtime
 * @returns {ReturnType<typeof describeAutoModelPolicy>}
 */
export function readRuntimeAutoModelPolicy(runtime) {
    const selection = readRuntimeModelSelection(runtime);
    const snap = readAgentRuntimeStatusSnapshot(runtime);
    const runtimeWithPrInfo = /**
     * @type {{
     *     getLastPrInfoSnapshot?: () => Record<string, unknown> | null;
     *     lastPrInfo?: Record<string, unknown> | null;
     * }}
     */ (runtime);
    const explicitPrInfo =
        typeof runtimeWithPrInfo.getLastPrInfoSnapshot === 'function'
            ? runtimeWithPrInfo.getLastPrInfoSnapshot()
            : (runtimeWithPrInfo.lastPrInfo ?? null);
    const lastPrInfo =
        explicitPrInfo ??
        (snap['lastPrInfo'] && typeof snap['lastPrInfo'] === 'object'
            ? /** @type {Record<string, unknown>} */ (snap['lastPrInfo'])
            : null);
    const observedModel =
        typeof lastPrInfo?.['effectiveModel'] === 'string'
            ? lastPrInfo['effectiveModel']
            : typeof lastPrInfo?.['model'] === 'string'
              ? lastPrInfo['model']
              : null;
    return describeAutoModelPolicy({
        configuredModel: selection.model,
        observedModel,
    });
}

/**
 * Lista os modelos disponíveis via SDK client.
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @returns {Promise<import('#copilot/sdk/types').ModelInfo[]>}
 */
export async function listAvailableModels(ctx) {
    if (!ctx.getClientSnapshot()) return [];
    try {
        return await listModels();
    } catch (e) {
        log('WARN', `[AlwaysAlive] listModels() falhou: ${toError(e).message}`);
        return [];
    }
}

/**
 * Lista o catálogo vanilla de modelos conhecido pelo SDK.
 *
 * @returns {Promise<import('#copilot/sdk/types').ModelInfo[]>}
 */
export async function listSdkCatalogModels() {
    return listModels();
}

/**
 * Lê metadata local do catálogo de modelos do SDK.
 *
 * @param {string} modelId
 * @returns {{
 *     costTier?: string;
 *     speedTier?: string;
 *     contextWindow?: number;
 *     supportsReasoning?: boolean;
 *     supportsVision?: boolean;
 * } | null}
 */
export function readSdkModelMetadata(modelId) {
    const rawMeta = modelRegistry.get(modelId);
    return rawMeta
        ? {
              costTier: rawMeta.costTier,
              speedTier: rawMeta.speedTier,
              contextWindow: rawMeta.contextWindow,
              supportsReasoning: rawMeta.supportsReasoning,
              supportsVision: rawMeta.supportsVision,
          }
        : null;
}

/**
 * @returns {ReturnType<typeof modelStatsTracker.allStats>}
 */
export function readSdkModelStats() {
    return modelStatsTracker.allStats();
}

/**
 * Lê modelo/raciocínio atuais de um runtime vivo sem expor propriedades diretas para `presentation/`.
 *
 * @param {import('../types.js').IAlwaysAliveAgent} runtime
 * @returns {{ model: string; reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | undefined }}
 */
export function readRuntimeModelSelection(runtime) {
    const snap = readAgentRuntimeStatusSnapshot(runtime);
    const reasoning = snap['reasoningEffort'];
    return {
        model: String(snap['model'] ?? 'unknown'),
        reasoningEffort:
            reasoning === 'low' || reasoning === 'medium' || reasoning === 'high' || reasoning === 'xhigh'
                ? reasoning
                : undefined,
    };
}

/**
 * Troca o modelo de um runtime vivo por sua API pública.
 *
 * @param {{ setModel?: (modelId: string) => void }} runtime
 * @param {string} modelId
 * @returns {void}
 */
export function setRuntimeModel(runtime, modelId) {
    if (typeof runtime.setModel !== 'function') throw new Error('AGENT_RUNTIME_MODEL_SET_UNAVAILABLE');
    runtime.setModel(modelId);
}

/**
 * Troca o reasoning effort de um runtime vivo por sua API pública.
 *
 * @param {{ setReasoningEffort?: (effort: 'low' | 'medium' | 'high' | 'xhigh' | undefined) => void }} runtime
 * @param {'low' | 'medium' | 'high' | 'xhigh' | undefined} effort
 * @returns {void}
 */
export function setRuntimeReasoningEffort(runtime, effort) {
    if (typeof runtime.setReasoningEffort !== 'function') {
        throw new Error('AGENT_RUNTIME_REASONING_SET_UNAVAILABLE');
    }
    runtime.setReasoningEffort(effort);
}

/**
 * Retorna o nível de raciocínio atual.
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @returns {'low' | 'medium' | 'high' | 'xhigh' | undefined}
 */
export function getReasoningEffort(ctx) {
    return ctx.getReasoningEffortSnapshot();
}

/**
 * Troca o nível de raciocínio. Efetivo no próximo `sendMessage()`.
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @param {'low' | 'medium' | 'high' | 'xhigh' | undefined} effort
 * @returns {void}
 */
export function setReasoningEffort(ctx, effort) {
    ctx.setReasoningEffort(effort);
    if (effort === undefined) {
        return;
    }
    persistRuntimeConfigChange(
        ctx,
        { reasoningEffort: effort },
        {
            label: 'runtime.config.reasoning',
            description: 'Persist current runtime reasoning effort after operator change',
        },
    );
}
