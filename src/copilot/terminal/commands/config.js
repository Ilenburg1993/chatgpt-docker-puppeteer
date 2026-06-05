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
import { buildTerminalModelTransitionPresentation } from '../events/model-transition-presenter.js';
import { recordTerminalActivity } from '../state/activity-state.js';
import { terminalThemeHeadline, terminalThemeRow, terminalThemeText } from '../state/ui/index.js';
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

const MODEL_LIST_DEFAULT_LIMIT = 40;

/**
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function countLabel(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function yesNoPt(value) {
    if (typeof value !== 'boolean') return 'n/d';
    return value ? 'sim' : 'não';
}

/**
 * @param {{ capabilities?: { supports?: { reasoningEffort?: boolean; vision?: boolean } } }} model
 * @param {boolean} isActive
 * @returns {string}
 */
function renderModelListDetails(model, isActive) {
    const parts = [
        isActive ? 'ativo' : null,
        model.capabilities?.supports?.reasoningEffort ? 'raciocínio' : null,
        model.capabilities?.supports?.vision ? 'visão' : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : 'sem recursos especiais declarados';
}

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
        println('');
        println(terminalThemeHeadline('assistant', 'Modelo ativo', [current]));
        if (current === 'auto' && autoModelPolicy) {
            println(
                terminalThemeRow(
                    'Auto',
                    `autoridade GitHub Copilot · preferência local ${autoModelPolicy.preferredModel}/${autoModelPolicy.preferredReasoningEffort} (${autoModelPolicy.canForcePreference ? 'forçável' : 'observável'})`,
                ),
            );
            if (autoModelPolicy.observedModel) {
                const satisfied =
                    autoModelPolicy.preferenceSatisfied === true
                        ? 'preferência atendida'
                        : autoModelPolicy.preferenceSatisfied === false
                          ? 'roteamento diferente'
                          : 'sem conclusão';
                println(terminalThemeRow('Efetivo', `${autoModelPolicy.observedModel} · ${satisfied}`));
            }
        }
        if (meta) {
            const contextWindowLabel =
                typeof meta.contextWindow === 'number' ? meta.contextWindow.toLocaleString() : 'n/a';
            println(terminalThemeRow('Perfil', `custo ${meta.costTier} · velocidade ${meta.speedTier} · contexto ${contextWindowLabel}`));
            println(terminalThemeRow('Recursos', `raciocínio ${yesNoPt(meta.supportsReasoning)} · visão ${yesNoPt(meta.supportsVision)}`));
        }
        if (byok.enabled) {
            const ready = byok.ready ? terminalThemeText('success', 'pronto') : terminalThemeText('error', 'incompleto');
            println(terminalThemeRow('BYOK', `${ready} · preset ${byok.preset ?? '-'} · provedor ${byok.providerType ?? '-'} · modelo ${byok.model ?? '-'} · /byok`));
        }
        println(
            terminalThemeRow('Uso', byok.enabled ? '/model list | stats  (/model <id> é governado por COPILOT_BYOK_MODEL)' : '/model list | stats | <id>', { role: 'command' }),
        );
        println('');
        return;
    }

    const trimmed = cleanArg.trim().toLowerCase();

    if (trimmed === 'stats') {
        const { stats } = callWithRuntimeTarget(readTerminalModelStatsProjection, runtimeId);
        if (stats.length === 0) {
            println(`  ${terminalThemeText('warn', 'Sem estatísticas coletadas ainda.')}\n`);
            return;
        }
        println('');
        println(terminalThemeHeadline('assistant', 'Estatísticas por modelo'));
        println('');
        for (const s of stats) {
            const isActive = s.modelId === current;
            const marker = isActive ? ` ${terminalThemeText('success', 'ativo')}` : '';
            const rate = (s.successRate * 100).toFixed(0);
            println(`    ${terminalThemeText('command', s.modelId)}${marker}`);
            println(
                `      chamadas ${s.totalCalls} · latência média ${s.avgLatencyMs}ms · sucesso ${rate}% · tokens ${s.totalTokens}`,
            );
        }
        println('');
        return;
    }

    const modelListParts = trimmed.split(/\s+/u).filter(Boolean);
    if (modelListParts[0] === 'list') {
        const showAll =
            modelListParts.includes('full') ||
            modelListParts.includes('all') ||
            modelListParts.includes('--full') ||
            modelListParts.includes('--all');
        if (byok.enabled) {
            const ready = byok.ready ? 'pronto' : 'incompleto';
            println(
                terminalThemeRow('BYOK', `${ready}: catálogo vem de onListModels/configuração BYOK quando a sessão SDK usa provedor customizado.`),
            );
        }
        println(`  ${terminalThemeText('muted', 'Consultando modelos disponíveis...')}`);
        try {
            const { models } = await callWithRuntimeTarget(listTerminalAvailableModelsProjection, runtimeId);
            if (models.length === 0) {
                println(`  ${terminalThemeText('warn', 'Nenhum modelo retornado pelo SDK.')}\n`);
                return;
            }
            println('');
            const visibleModels = showAll ? models : models.slice(0, MODEL_LIST_DEFAULT_LIMIT);
            println(
                terminalThemeHeadline('assistant', 'Modelos disponíveis', [
                    countLabel(models.length, 'modelo', 'modelos'),
                    showAll ? 'lista completa' : `mostrando ${countLabel(visibleModels.length, 'modelo', 'modelos')}`,
                ]),
            );
            println('');
            for (const m of visibleModels) {
                const isActive = m.id === current;
                const details = renderModelListDetails(m, isActive);
                const suffix = details === 'sem recursos especiais declarados' ? '' : ` · ${details}`;
                println(terminalThemeRow('Modelo', `${m.id}${suffix}`, { role: isActive ? 'success' : 'command' }));
            }
            if (visibleModels.length < models.length) {
                println(
                    terminalThemeRow(
                        'Omitidos',
                        `${countLabel(models.length - visibleModels.length, 'modelo', 'modelos')} · use /model list full`,
                        { role: 'muted' },
                    ),
                );
            }
            println('');
        } catch (e) {
            println(`  ${terminalThemeText('error', `Erro ao listar modelos: ${toError(e).message}`)}\n`);
        }
        return;
    }

    // Troca de modelo
    if (byok.enabled) {
        println('');
        println(terminalThemeRow('BYOK', '/model <id> não troca provedor customizado em runtime.', { role: 'warn' }));
        println(terminalThemeRow('Modelo', `${byok.model ?? '(ausente)'} · preset ${byok.preset ?? '-'} · provedor ${byok.providerType ?? '-'}`));
        println(terminalThemeRow('Ação', 'Use /byok model <id> no mesmo provedor; troca de provedor/perfil continua em /byok + /session sdk next new no próximo boot.', { role: 'command' }));
        println('');
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
    const requestPresentation = buildTerminalModelTransitionPresentation({
        from: previous,
        to: trimmed,
        kind: 'requested',
        source: 'terminal',
        reason: 'aguardando confirmação SDK ou próximo uso observado',
    });
    recordTerminalActivity('system', 'Modelo solicitado', {
        detail: requestPresentation.detail,
        source: 'terminal.model',
        recordHistory: true,
        updateCurrent: false,
    });

    println('');
    println(terminalThemeHeadline('assistant', 'Modelo solicitado', [requestPresentation.transition]));
    if (trimmed === 'auto') {
        println(
            terminalThemeRow('Auto', 'roteamento nativo do Copilot; gpt-5.4/high é preferência local observável, não parâmetro oficial forçado.'),
        );
    }
    if (modelMeta) {
        const ctxLabel = typeof modelMeta.contextWindow === 'number' ? modelMeta.contextWindow.toLocaleString() : 'n/a';
        println(terminalThemeRow('Recursos', `raciocínio ${yesNoPt(modelMeta.supportsReasoning)} · visão ${yesNoPt(modelMeta.supportsVision)} · contexto ${ctxLabel}`));
    }
    if (reasoningAdjusted) {
        println(
            terminalThemeRow('Raciocínio', `${previousReasoningEffort} → ${currentReasoningEffort} (modelo sem suporte explícito a controle de raciocínio).`, { role: 'warn' }),
        );
    }
    if (observed.observedModel && observed.observedModel !== trimmed) {
        println(
            terminalThemeRow('Efetivo', `${observed.observedModel}. A troca para ${trimmed} ainda precisa ser confirmada pelo SDK ou por uso registrado.`, { role: 'warn' }),
        );
    } else if (observed.modelMismatch && observed.configuredModel === trimmed) {
        println(
            terminalThemeRow('Aviso', 'Há divergência entre o modelo configurado e o efetivo observado. Use /status, /sdk status ou um turno curto para revalidar a sessão.', { role: 'warn' }),
        );
    } else {
        println(
            terminalThemeRow('Próximo', 'A sessão SDK será revalidada no próximo turno. Use /status ou /sdk status para conferir o modelo efetivo.'),
        );
    }
    println(terminalThemeRow('Nota', 'Use /restart apenas se quiser reiniciar a conversa; não é mais a confirmação primária de modelo.'));
    println('');
}

// ─── /reasoning ──────────────────────────────────────────────────────────────

/**
 * Comando `/reasoning [level]`.
 *
 * - Sem argumento: exibe o nível atual.
 * - `<level>`: troca para `low`, `medium`, `high` ou `xhigh`.
 * - `off` / `none`: desativa raciocínio estendido (undefined).
 *
 * @param {ConfigContext} ctx
 * @param {string} [arg] - Argumento fornecido pelo usuário
 * @returns {void}
 */
export function cmdReasoning({ println }, arg) {
    const { runtimeId, arg: cleanArg } = extractRuntimeTarget(arg);
    const { currentReasoningEffort: current } = callWithRuntimeTarget(readTerminalConfigProjection, runtimeId);

    if (!cleanArg || cleanArg.trim() === '') {
        println('');
        println(terminalThemeHeadline('thinking', 'Nível de raciocínio', [current]));
        println(terminalThemeRow('Uso', '/reasoning low | medium | high | xhigh | off', { role: 'command' }));
        println('');
        return;
    }

    const trimmed = cleanArg.trim().toLowerCase();

    if (trimmed === 'off' || trimmed === 'none') {
        callWithRuntimeTarget(setTerminalReasoningProjection, runtimeId, undefined);
        println('');
        println(terminalThemeRow('Raciocínio', 'desativado · modelo decide autonomamente', { role: 'warn' }));
        println('');
        return;
    }

    if (!VALID_EFFORTS.includes(/** @type {ReasoningEffort} */ (trimmed))) {
        println('');
        println(terminalThemeRow('Erro', `nível de raciocínio inválido "${trimmed}". Use: ${VALID_EFFORTS.join(' | ')} | off`, { role: 'error' }));
        println('');
        return;
    }

    const { previousReasoningEffort: previous } = callWithRuntimeTarget(
        setTerminalReasoningProjection,
        runtimeId,
        /** @type {ReasoningEffort} */ (trimmed),
    );
    println('');
    println(terminalThemeHeadline('thinking', 'Raciocínio alterado', [`${previous} -> ${trimmed}`]));
    println(terminalThemeRow('Próximo', 'Efetivo no próximo turno.'));
    println('');
}
