// @ts-check
/**
 * src/copilot/terminal/commands/usage.js
 *
 * Comando `/usage [on|off|now]` do REPL terminal LLM-B.
 *
 * Controla a exibição de telemetria de tokens/custo após cada turno.
 *
 * @module copilot/terminal/commands/usage
 * @see EventBus
 */

import { getShowUsage, setShowUsage } from '../../presentation/state/index.js';
import { renderTerminalLlmUsageKind } from '../events/presenters/index.js';
import { compactTerminalDiagnosticId } from '../events/presenters/tools/index.js';
import { readTerminalConfigProjection } from '../frontend/projections/config.js';
import { readTerminalUsageNowProjection } from '../frontend/projections/usage.js';
import { terminalThemeHeadline, terminalThemeRow, terminalThemeRows, terminalThemeText } from '../state/ui/index.js';
import { callWithRuntimeTarget, extractRuntimeTarget } from './runtime-target.js';

/**
 * @typedef {object} UsageContext
 * @property {(text: string) => void} println - Função de output do terminal
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderUsageSdkMode(value) {
    const mode = String(value ?? '');
    if (mode === 'interactive') return 'interativo';
    if (mode === 'plan') return 'plano';
    if (mode === 'autopilot') return 'autopiloto';
    return mode.replace(/[._-]+/gu, ' ') || 'desconhecido';
}

/**
 * @param {ReturnType<typeof readTerminalConfigProjection>} configProjection
 * @returns {number | null}
 */
function readKnownContextLimit(configProjection) {
    const candidates = [
        configProjection.modelMeta?.contextWindow,
        configProjection.observedModelMeta?.contextWindow,
        configProjection.byok?.capabilities?.contextWindowTokens,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
            return Math.round(candidate);
        }
    }
    return null;
}

/**
 * Comando `/usage [on|off|now]`.
 *
 * - Sem argumento: toggle do display pós-turno.
 * - `on`: ativa display de telemetria pós-turno.
 * - `off`: desativa display de telemetria pós-turno.
 * - `now`: mostra snapshot instantâneo da context window.
 *
 * @param {UsageContext} ctx
 * @param {string} [arg] - Argumento fornecido pelo usuário
 * @returns {void}
 */
export function cmdUsage({ println }, arg) {
    const { runtimeId, arg: cleanArg } = extractRuntimeTarget(arg);
    const tokens = cleanArg.trim().toLowerCase().split(/\s+/u).filter(Boolean);
    const trimmed = tokens.join(' ');
    const showNow = tokens.includes('now');
    const detail = tokens.includes('detail') || tokens.includes('--detail') || tokens.includes('debug') || tokens.includes('--debug');

    if (showNow) {
        const projection = callWithRuntimeTarget(readTerminalUsageNowProjection, runtimeId);
        const configProjection = callWithRuntimeTarget(readTerminalConfigProjection, runtimeId);
        const ctx = projection.contextWindow;
        if (ctx) {
            const pct = (ctx.utilization * 100).toFixed(0);
            const bar = _renderBar(ctx.utilization);
            println('');
            println(terminalThemeHeadline('command', 'Janela de contexto', [`${bar} ${pct}%`]));
            println(terminalThemeRow('Tokens', `${ctx.tokens.toLocaleString('pt-BR')} / ${ctx.tokenLimit.toLocaleString('pt-BR')}`, {
                role: 'info',
            }));
        } else {
            const knownLimit = readKnownContextLimit(configProjection);
            println('');
            println(terminalThemeHeadline('command', 'Janela de contexto', ['uso ainda não medido']));
            println(
                terminalThemeRow(
                    'Medição',
                    'SDK ainda não reportou tokens usados nesta sessão',
                    { role: 'warn' },
                ),
            );
            if (knownLimit !== null) {
                println(
                    terminalThemeRow(
                        'Limite do modelo',
                        `${knownLimit.toLocaleString('pt-BR')} tokens`,
                        { role: 'info' },
                    ),
                );
            }
        }

        const modelBilling = projection.modelBilling;
        const byok = configProjection.byok;
        const byokActive = byok?.enabled === true;
        const byokRouteLabel = byok?.preset ?? byok?.providerType ?? '-';
        const byokModelLabel = byok?.model ?? '-';
        if (projection.pr) {
            const cost = modelBilling.cost === null ? '?' : modelBilling.cost.toFixed(4);
            const modelLabel = modelBilling.mismatch
                ? `configurado ${modelBilling.configuredModel ?? '-'} · cobrado ${modelBilling.billedModel ?? '-'}`
                : `rota ${modelBilling.displayModel}${modelBilling.observedModel && modelBilling.observedModel !== modelBilling.displayModel ? ` · observado ${modelBilling.observedModel}` : ''}`;
            if (byokActive) {
                println(
                    terminalThemeRow(
                        'Rota BYOK',
                        `${byokRouteLabel} · modelo ${byokModelLabel}`,
                        { role: 'success' },
                    ),
                );
                println(
                    terminalThemeRow(
                        'Histórico',
                        `Copilot ${renderHistoricalCopilotSnapshotLabel(modelBilling)} · custo ${cost} · anterior/lateral; BYOK atual separado`,
                    ),
                );
            } else {
                println(
                    terminalThemeRow(
                        'Telemetria PR',
                        `${modelLabel} · custo ${cost} · histórica; não implica consumo neste boot/sonda`,
                    ),
                );
            }
        } else if (byokActive) {
            println(
                terminalThemeRow(
                    'Rota BYOK',
                    `${byokRouteLabel} · modelo ${byokModelLabel}`,
                    { role: 'success' },
                ),
            );
            println(terminalThemeRow('Histórico', 'Copilot sem snapshot histórico classificado'));
        } else {
            println(terminalThemeRow('Pedido premium', 'sem snapshot histórico classificado'));
        }
        if (projection.llmUsage) {
            const llmCost =
                projection.llmUsageBilling.cost === null ? '?' : projection.llmUsageBilling.cost.toFixed(4);
            const llmClass =
                typeof projection.llmUsage['classification'] === 'string'
                    ? projection.llmUsage['classification']
                    : 'unknown';
            const llmReason =
                typeof projection.llmUsage['premiumRequestReason'] === 'string'
                    ? projection.llmUsage['premiumRequestReason']
                    : 'n/d';
            const premiumRequest =
                projection.llmUsage['premiumRequest'] === true
                    ? 'com pedido premium nesta telemetria'
                    : 'sem pedido premium';
            const llmUsageKind = renderTerminalLlmUsageKind(llmClass, llmReason);
            if (detail) {
                println(
                    terminalThemeRow(
                        'LLM',
                        `modelo ${projection.llmUsageBilling.displayModel} · ${premiumRequest} · tipo ${llmUsageKind} · classe ${llmClass} · motivo ${llmReason} · custo ${llmCost}`,
                    ),
                );
            } else {
                println(
                    terminalThemeRow(
                        'LLM',
                        `modelo ${projection.llmUsageBilling.displayModel} · custo ${llmCost}`,
                    ),
                );
                println(terminalThemeRow('Pedido', premiumRequest));
                println(terminalThemeRow('Tipo', llmUsageKind));
                println(terminalThemeRow('Mais detalhes', '/usage now detail para classe técnica', { role: 'command' }));
            }
            if (/ask_user|user_input/iu.test(llmClass) || /ask_user|user_input/iu.test(llmReason)) {
                println(
                    terminalThemeRow(
                        'Pergunta',
                        'telemetria pós-resposta humana separada da fala inicial',
                        { role: 'success' },
                    ),
                );
                println(
                    terminalThemeRow('Conferir', '/events event=assistant.message · /export', {
                        role: 'command',
                    }),
                );
            }
        }
        if (projection.runtimeSessionId || projection.binding.sdkSessionId || projection.binding.hubSessionId) {
            const runtimeLabel = renderUsageBindingId(projection.runtimeSessionId, detail);
            const sdkLabel = renderUsageBindingId(projection.binding.sdkSessionId, detail);
            const hubLabel = renderUsageBindingId(projection.binding.hubSessionId, detail);
            println(
                detail
                    ? terminalThemeRow('Vínculo', `ambiente ${runtimeLabel} · SDK ${sdkLabel} · hub ${hubLabel}`)
                    : terminalThemeRow('Conexão', `${renderUsageBindingSummary({
                          runtimeSessionId: projection.runtimeSessionId,
                          sdkSessionId: projection.binding.sdkSessionId,
                          hubSessionId: projection.binding.hubSessionId,
                      })} · IDs em /usage now detail`),
            );
        }
        println(terminalThemeRow('Modo', `SDK ${renderUsageSdkMode(configProjection.sdkSessionMode)} · plano ${configProjection.sdkPlanOperation ?? '(sem alterações)'}`));
        println('');
        return;
    }

    let next;
    if (trimmed === 'on') {
        next = true;
    } else if (trimmed === 'off') {
        next = false;
    } else {
        next = !getShowUsage();
    }

    setShowUsage(next);
    const status = next ? terminalThemeText('success', 'on') : terminalThemeText('error', 'off');
    println('');
    println(terminalThemeRow('Telemetria', `pós-turno ${status}`, { role: next ? 'success' : 'error' }));
    println(terminalThemeRows('Uso', ['/usage [on|off|now] [detail]'], { role: 'command' }));
    println('');
}

/**
 * @param {{
 *     mismatch?: boolean;
 *     configuredModel?: string | null;
 *     observedModel?: string | null;
 *     billedModel?: string | null;
 *     displayModel?: string | null;
 * }} modelBilling
 * @returns {string}
 */
function renderHistoricalCopilotSnapshotLabel(modelBilling) {
    if (modelBilling.mismatch) {
        return [
            `configurado ${modelBilling.configuredModel ?? '-'}`,
            modelBilling.observedModel ? `observado ${modelBilling.observedModel}` : null,
            `cobrado ${modelBilling.billedModel ?? modelBilling.observedModel ?? '-'}`,
        ]
            .filter(Boolean)
            .join(' · ');
    }
    return `último snapshot ${modelBilling.observedModel ?? modelBilling.displayModel ?? '-'}`;
}

/**
 * @param {string | null} value
 * @param {boolean} detail
 * @returns {string}
 */
function renderUsageBindingId(value, detail) {
    if (!value) return '-';
    return detail ? value : (compactTerminalDiagnosticId(value, 14) ?? value);
}

/**
 * @param {{ runtimeSessionId?: string | null; sdkSessionId?: string | null; hubSessionId?: string | null }} binding
 * @returns {string}
 */
function renderUsageBindingSummary(binding) {
    const present = [
        binding.runtimeSessionId ? 'ambiente' : null,
        binding.sdkSessionId ? 'SDK' : null,
        binding.hubSessionId ? 'hub' : null,
    ].filter(Boolean);
    if (present.length === 3) return 'sessão conectada';
    if (present.length > 0) return `sessão parcial: ${present.join(', ')}`;
    return 'sem sessão registrada';
}

/**
 * Renderiza barra de progresso ASCII simples.
 *
 * @param {number} ratio - Utilização 0..1
 * @returns {string}
 */
function _renderBar(ratio) {
    const total = 20;
    const filled = Math.round(ratio * total);
    const empty = total - filled;
    const role = ratio > 0.8 ? 'error' : ratio > 0.5 ? 'warn' : 'success';
    return terminalThemeText(role, `${'█'.repeat(filled)}${'░'.repeat(empty)}`);
}
