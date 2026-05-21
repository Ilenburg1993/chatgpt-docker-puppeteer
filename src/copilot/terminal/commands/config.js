// @ts-check
/**
 * src/copilot/terminal/commands/config.js
 *
 * Comandos de configuração em runtime do REPL terminal LLM-B: /model, /reasoning.
 *
 * Permitem trocar o modelo e o nível de raciocínio sem reiniciar a sessão.
 *
 * @module copilot/terminal/commands/config
 * @see EventBus
 */

import { toError } from '#copilot/core';
import { resolveModelSelectionMismatch } from '#copilot/core';
import {
    listTerminalAvailableModelsProjection,
    readTerminalConfigProjection,
    readTerminalModelStatsProjection,
    readTerminalRuntimeState,
    setTerminalModelProjection,
    setTerminalReasoningProjection,
} from '../frontend/index.js';
import { callWithRuntimeTarget, extractRuntimeTarget } from './runtime-target.js';

/** @typedef {'low' | 'medium' | 'high' | 'xhigh'} ReasoningEffort */

/** Esforços de raciocínio válidos. @type {readonly ReasoningEffort[]} */
const VALID_EFFORTS = /** @type {const} */ (['low', 'medium', 'high', 'xhigh']);

const DISABLED_BYOK_SUMMARY = Object.freeze({
    enabled: false,
    ready: false,
    preset: null,
    providerType: null,
    baseUrl: null,
    model: null,
    wireApi: null,
    azureApiVersion: null,
    auth: {
        apiKeyConfigured: false,
        bearerTokenConfigured: false,
        headersConfigured: false,
    },
    modelList: {
        configured: false,
        count: 0,
    },
    capabilities: {
        reasoningEffort: false,
        vision: false,
        contextWindowTokens: null,
    },
    warnings: [],
    errors: [],
});

/**
 * @param {ReturnType<typeof readTerminalRuntimeState>} state
 * @returns {{ observedModel: string | null; configuredModel: string | null; modelMismatch: boolean }}
 */
function resolveObservedModelState(state) {
    const lastPrInfo = /** @type {Record<string, unknown> | null} */ (state.lastPrInfo ?? null);
    const configuredModel = typeof lastPrInfo?.['configuredModel'] === 'string' ? lastPrInfo['configuredModel'] : null;
    const effectiveModel = typeof lastPrInfo?.['effectiveModel'] === 'string' ? lastPrInfo['effectiveModel'] : null;
    const billedModel = typeof lastPrInfo?.['model'] === 'string' ? lastPrInfo['model'] : null;
    const modelMismatch = resolveModelSelectionMismatch({
        configuredModel,
        billedModel,
        effectiveModel,
        explicitMismatch: Boolean(lastPrInfo?.['modelMismatch']),
    });
    return {
        observedModel: effectiveModel ?? billedModel,
        configuredModel,
        modelMismatch,
    };
}

/**
 * @typedef {object} ConfigContext
 * @property {(text: string) => void} println - Função de output do terminal
 */

// ─── /model ──────────────────────────────────────────────────────────────────

/**
 * Comando `/model [id|list]`.
 *
 * - Sem argumento: exibe o modelo atual.
 * - `list`: lista modelos disponíveis via SDK.
 * - `<id>`: troca para o modelo indicado (sem validação remota — troca imediata).
 *
 * @param {ConfigContext} ctx
 * @param {string} [arg] - Argumento fornecido pelo usuário
 * @returns {Promise<void>}
 */
export async function cmdModel({ println }, arg) {
    const { runtimeId, arg: cleanArg } = extractRuntimeTarget(arg);
    const configProjection = callWithRuntimeTarget(readTerminalConfigProjection, runtimeId);
    const {
        currentModel: current,
        modelMeta: meta,
        autoModelPolicy,
    } = configProjection;
    const byok = configProjection.byok ?? DISABLED_BYOK_SUMMARY;

    if (!cleanArg || cleanArg.trim() === '') {
        println(`\n  🤖  Modelo ativo: \x1b[36m${current}\x1b[0m`);
        if (current === 'auto' && autoModelPolicy) {
            println(
                `  \x1b[90m    auto: autoridade=GitHub Copilot · preferência local=${autoModelPolicy.preferredModel}/${autoModelPolicy.preferredReasoningEffort} (${autoModelPolicy.canForcePreference ? 'forçável' : 'advisory'})\x1b[0m`,
            );
            if (autoModelPolicy.observedModel) {
                const satisfied =
                    autoModelPolicy.preferenceSatisfied === true
                        ? 'preferência atendida'
                        : autoModelPolicy.preferenceSatisfied === false
                          ? 'roteamento diferente'
                          : 'sem conclusão';
                println(`  \x1b[90m    último efetivo=${autoModelPolicy.observedModel} · ${satisfied}\x1b[0m`);
            }
        }
        if (meta) {
            const contextWindowLabel =
                typeof meta.contextWindow === 'number' ? meta.contextWindow.toLocaleString() : 'n/a';
            println(`  \x1b[90m    cost=${meta.costTier}  speed=${meta.speedTier}  ctx=${contextWindowLabel}\x1b[0m`);
            println(
                `  \x1b[90m    caps: reasoning=${meta.supportsReasoning ? 'yes' : 'no'}  vision=${meta.supportsVision ? 'yes' : 'no'}\x1b[0m`,
            );
        }
        if (byok.enabled) {
            const ready = byok.ready ? '\x1b[32mready\x1b[0m' : '\x1b[31mincompleto\x1b[0m';
            println(
                `  \x1b[90m    byok: ${ready} · preset=${byok.preset ?? '-'} · provider=${byok.providerType ?? '-'} · model=${byok.model ?? '-'} · /byok\x1b[0m`,
            );
        }
        println(
            `  \x1b[90mUso: ${byok.enabled ? '/model list | stats  (/model <id> é governado por COPILOT_BYOK_MODEL)' : '/model list | stats | <id>'}\x1b[0m\n`,
        );
        return;
    }

    const trimmed = cleanArg.trim().toLowerCase();

    if (trimmed === 'stats') {
        const { stats } = callWithRuntimeTarget(readTerminalModelStatsProjection, runtimeId);
        if (stats.length === 0) {
            println('  \x1b[33mSem estatísticas coletadas ainda.\x1b[0m\n');
            return;
        }
        println(`\n  \x1b[36mEstatísticas por modelo:\x1b[0m\n`);
        for (const s of stats) {
            const isActive = s.modelId === current;
            const marker = isActive ? ' \x1b[32m← ativo\x1b[0m' : '';
            const rate = (s.successRate * 100).toFixed(0);
            println(`    \x1b[33m${s.modelId}\x1b[0m${marker}`);
            println(
                `      calls=${s.totalCalls}  avg_latency=${s.avgLatencyMs}ms  success=${rate}%  tokens=${s.totalTokens}`,
            );
        }
        println('');
        return;
    }

    if (trimmed === 'list') {
        if (byok.enabled) {
            const ready = byok.ready ? 'ready' : 'incompleto';
            println(
                `\x1b[90m  BYOK ${ready}: catálogo vem de onListModels/configuração BYOK quando a sessão SDK usa provider customizado.\x1b[0m`,
            );
        }
        println('\x1b[90m  Consultando modelos disponíveis…\x1b[0m');
        try {
            const { models } = await callWithRuntimeTarget(listTerminalAvailableModelsProjection, runtimeId);
            if (models.length === 0) {
                println('  \x1b[33mNenhum modelo retornado pelo SDK.\x1b[0m\n');
                return;
            }
            println(`\n  \x1b[36m${models.length} modelo(s) disponível(is):\x1b[0m\n`);
            for (const m of models) {
                const isActive = m.id === current;
                const activeMarker = isActive ? ' \x1b[32m← ativo\x1b[0m' : '';
                const reasoning = m.capabilities?.supports?.reasoningEffort ? ' \x1b[90m[reasoning]\x1b[0m' : '';
                const vision = m.capabilities?.supports?.vision ? ' \x1b[90m[vision]\x1b[0m' : '';
                println(`    \x1b[33m${m.id}\x1b[0m${activeMarker}${reasoning}${vision}`);
            }
            println('');
        } catch (e) {
            println(`  \x1b[31m[erro] Não foi possível listar modelos: ${toError(e).message}\x1b[0m\n`);
        }
        return;
    }

    // Troca de modelo
    if (byok.enabled) {
        println(
            `\n  \x1b[33mBYOK está ativo: /model <id> não troca provider customizado em runtime.\x1b[0m`,
        );
        println(
            `  \x1b[90mModelo BYOK canônico: ${byok.model ?? '(ausente)'} · preset=${byok.preset ?? '-'} · provider=${byok.providerType ?? '-'}.\x1b[0m`,
        );
        println(
            '  \x1b[90mUse /byok model <id> para trocar modelo no mesmo provider quando a sessão viva já estiver bound; troca de provider/perfil continua em /byok + /session sdk next new no próximo boot.\x1b[0m\n',
        );
        return;
    }

    const {
        previousModel: previous,
        previousReasoningEffort,
        currentReasoningEffort,
        reasoningAdjusted,
        modelMeta,
    } = callWithRuntimeTarget(setTerminalModelProjection, runtimeId, trimmed);
    const runtimeState = callWithRuntimeTarget(readTerminalRuntimeState, runtimeId);
    const observed = resolveObservedModelState(runtimeState);

    println(`\n  🔄  Modelo configurado: \x1b[90m${previous}\x1b[0m → \x1b[36m${trimmed}\x1b[0m`);
    if (trimmed === 'auto') {
        println(
            '  \x1b[90mAuto usa roteamento nativo do Copilot; gpt-5.4/high é preferência local observável, não parâmetro oficial forçado.\x1b[0m',
        );
    }
    if (modelMeta) {
        const ctxLabel = typeof modelMeta.contextWindow === 'number' ? modelMeta.contextWindow.toLocaleString() : 'n/a';
        println(
            `  \x1b[90mCapabilities: reasoning=${modelMeta.supportsReasoning ? 'yes' : 'no'} · vision=${modelMeta.supportsVision ? 'yes' : 'no'} · ctx=${ctxLabel}\x1b[0m`,
        );
    }
    if (reasoningAdjusted) {
        println(
            `  \x1b[33mReasoning ajustado: ${previousReasoningEffort} → ${currentReasoningEffort} (modelo sem suporte explícito a reasoning effort).\x1b[0m`,
        );
    }
    if (observed.observedModel && observed.observedModel !== trimmed) {
        println(
            `  \x1b[33mÚltimo modelo efetivo observado na sessão: ${observed.observedModel}. A troca para ${trimmed} ainda precisa ser confirmada pelo SDK/usage.\x1b[0m`,
        );
    } else if (observed.modelMismatch && observed.configuredModel === trimmed) {
        println(
            `  \x1b[33mHá mismatch entre o modelo configurado e o efetivo observado. Use /status, /sdk status ou um turno curto para revalidar a sessão.\x1b[0m`,
        );
    } else {
        println(
            '  \x1b[90mA sessão SDK será revalidada no próximo turno. Use /status ou /sdk status para conferir o modelo efetivo.\x1b[0m',
        );
    }
    println(
        '  \x1b[90mUse /restart apenas se quiser rebalancear o loop; não é mais a confirmação primária de modelo.\x1b[0m\n',
    );
}

// ─── /reasoning ──────────────────────────────────────────────────────────────

/**
 * Comando `/reasoning [level]`.
 *
 * - Sem argumento: exibe o nível atual.
 * - `<level>`: troca para `low`, `medium`, `high` ou `xhigh`.
 * - `off` / `none`: desativa raciocínio extendido (undefined).
 *
 * @param {ConfigContext} ctx
 * @param {string} [arg] - Argumento fornecido pelo usuário
 * @returns {void}
 */
export function cmdReasoning({ println }, arg) {
    const { runtimeId, arg: cleanArg } = extractRuntimeTarget(arg);
    const { currentReasoningEffort: current } = callWithRuntimeTarget(readTerminalConfigProjection, runtimeId);

    if (!cleanArg || cleanArg.trim() === '') {
        println(`\n  🧠  Reasoning effort: \x1b[36m${current}\x1b[0m`);
        println(`  \x1b[90mUso: /reasoning low | medium | high | xhigh | off\x1b[0m\n`);
        return;
    }

    const trimmed = cleanArg.trim().toLowerCase();

    if (trimmed === 'off' || trimmed === 'none') {
        callWithRuntimeTarget(setTerminalReasoningProjection, runtimeId, undefined);
        println(`\n  🧠  Raciocínio extendido \x1b[33mdesativado\x1b[0m (modelo decide autonomamente)\n`);
        return;
    }

    if (!VALID_EFFORTS.includes(/** @type {ReasoningEffort} */ (trimmed))) {
        println(`\n  \x1b[31m[erro]\x1b[0m Nível inválido: "${trimmed}". Use: ${VALID_EFFORTS.join(' | ')} | off\n`);
        return;
    }

    const { previousReasoningEffort: previous } = callWithRuntimeTarget(
        setTerminalReasoningProjection,
        runtimeId,
        /** @type {ReasoningEffort} */ (trimmed),
    );
    println(`\n  🧠  Reasoning trocado: \x1b[90m${previous}\x1b[0m → \x1b[36m${trimmed}\x1b[0m`);
    println('  \x1b[90mEfetivo no próximo turno.\x1b[0m\n');
}
