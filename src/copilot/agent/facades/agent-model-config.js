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

import { toError } from '#copilot/infra/public/platform/error';
import { executeModelGatewayRuntimeModelSwitch } from '#copilot/model-gateway';
import {
    describeAutoModelPolicy,
    listModels,
    modelRegistry,
    modelStatsTracker,
    resolveModelSelectionMismatch,
} from '#copilot/sdk/models';
import { setSessionModel } from '#copilot/sdk/session-runtime';
import { log } from '../ports/logging/index.js';
import { trySetLiveSessionModel } from '../runtime/contracts/index.js';
import { readAgentRuntimeStatusSnapshot } from '../runtime/status-readers.js';
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
 * Troca o modelo da sessão viva de forma transacional.
 *
 * O estado configurado só é alterado depois que o SDK confirma o modelo efetivo e a persistência termina. Em falha, o
 * control plane tenta restaurar o modelo anterior.
 *
 * @param {import('../agent-context.js').AgentContext} ctx
 * @param {string} modelId
 * @param {{ idempotencyKey?: string; source?: string }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function switchModelTransactional(ctx, modelId, options = {}) {
    const session = ctx.getSessionSnapshot();
    const previousModel = ctx.getModelSnapshot();
    const reasoningEffort = ctx.getReasoningEffortSnapshot();
    return executeModelGatewayRuntimeModelSwitch({
        targetModel: modelId,
        previousModel,
        sessionId: session?.sessionId ?? null,
        ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        source: options.source ?? 'agent.model-config',
        ...(session
            ? {
                  switchSessionModel: (targetModel) =>
                      setSessionModel(
                          session,
                          targetModel,
                          targetModel === 'auto' || !reasoningEffort ? undefined : { reasoningEffort },
                      ),
              }
            : {}),
        commit: async () => {
            const persisted = await persistAgentRuntimeStatePartial(
                { model: modelId },
                { label: 'runtime.config.model.transactional' },
            );
            if (!persisted.ok) throw persisted.error;
            ctx.setModel(modelId);
            const previousPrInfo = ctx.getLastPrInfoSnapshot?.() ?? null;
            const effectiveModel = session ? Reflect.get(session, '__copilotEffectiveModel') : null;
            const billedModel = typeof previousPrInfo?.model === 'string' ? previousPrInfo.model : undefined;
            ctx.setLastPrInfo({
                ...(previousPrInfo ?? {}),
                configuredModel: modelId,
                ...(typeof effectiveModel === 'string' ? { effectiveModel } : {}),
                ...(billedModel ? { model: billedModel } : {}),
                modelMismatch: resolveModelSelectionMismatch({
                    configuredModel: modelId,
                    billedModel,
                    effectiveModel: typeof effectiveModel === 'string' ? effectiveModel : modelId,
                }),
                sessionId: session?.sessionId ?? null,
                ts: Date.now(),
            });
        },
    });
}

/**
 * Materializa, no estado observado do runtime, uma confirmação emitida pela sessão SDK sobre o modelo vivo.
 *
 * Diferente de `setModel()`, esta função não tenta trocar nada no SDK. Ela apenas fecha o ciclo de feedback: operador
 * configura `/model`, SDK emite `session.model_changed`, prompt/status passam a distinguir com clareza modelo
 * configurado, modelo efetivo e eventual roteamento divergente.
 *
 * @param {import('../agent-context.js').AgentContext | { ctx?: import('../agent-context.js').AgentContext }} target
 * @param {{ previousModel?: string | null; newModel: string; reasoningEffort?: string | null; ts?: number }} event
 * @returns {void}
 */
export function observeRuntimeModelChange(target, event) {
    const ctx = /** @type {import('../agent-context.js').AgentContext} */ (
        'ctx' in target && target.ctx ? target.ctx : target
    );
    const newModel = typeof event.newModel === 'string' && event.newModel.length > 0 ? event.newModel : 'unknown';
    const configuredModel = ctx.getModelSnapshot?.() ?? newModel;
    const previousPrInfo = ctx.getLastPrInfoSnapshot?.() ?? null;
    const billedModel = typeof previousPrInfo?.model === 'string' ? previousPrInfo.model : undefined;
    const sessionId = ctx.getSessionSnapshot()?.sessionId ?? previousPrInfo?.sessionId ?? null;
    ctx.setLastPrInfo({
        ...(previousPrInfo ?? {}),
        configuredModel,
        effectiveModel: newModel,
        ...(billedModel ? { model: billedModel } : {}),
        modelMismatch: resolveModelSelectionMismatch({
            configuredModel,
            billedModel,
            effectiveModel: newModel,
        }),
        ...(event.previousModel ? { previousEffectiveModel: event.previousModel } : {}),
        ...(event.reasoningEffort ? { reasoningEffort: event.reasoningEffort } : {}),
        sessionId,
        ts: typeof event.ts === 'number' && Number.isFinite(event.ts) ? event.ts : Date.now(),
    });
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
    const runtimeWithPrInfo =
        /**
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
 * @param {{
 *     switchModel?: (
 *         modelId: string,
 *         options?: { idempotencyKey?: string; source?: string },
 *     ) => Promise<Record<string, unknown>>;
 * }} runtime
 * @param {string} modelId
 * @param {{ idempotencyKey?: string; source?: string }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export function switchRuntimeModelTransactional(runtime, modelId, options = {}) {
    if (typeof runtime.switchModel !== 'function') {
        throw new Error('AGENT_RUNTIME_TRANSACTIONAL_MODEL_SWITCH_UNAVAILABLE');
    }
    return runtime.switchModel(modelId, options);
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
