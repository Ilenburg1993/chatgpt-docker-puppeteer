// @ts-check
/**
 * src/copilot/terminal/commands/context.js
 *
 * Comandos `/context` e `/compact` para gerenciamento de contexto do dialog loop.
 *
 * `/context` → mostra uso da janela de contexto (tokens reais do SDK quando disponíveis; fallback para heurística 4
 * chars/token) `/compact` → envia pedido de compactação à LLM-B e limpa o histórico local
 *
 * @module copilot/terminal/commands/context
 * @see EventBus
 */

import { readTerminalContextProjection, requestTerminalCompactionProjection } from '../frontend/projections/timeline.js';
import {
    formatTerminalTimeLabel,
    terminalThemeHeadline,
    terminalThemeRow,
    terminalThemeText,
} from '../state/index.js';
import { callWithRuntimeTarget, extractRuntimeTarget } from './runtime-target.js';

/**
 * Renderiza uma barra de progresso ASCII.
 *
 * @param {number} used - Valor atual
 * @param {number} total - Valor máximo
 * @param {number} [width=20] - Largura da barra em caracteres. Default is `20`
 * @returns {string}
 */
function progressBar(used, total, width = 20) {
    const pct = Math.min(used / total, 1);
    const filled = Math.round(pct * width);
    const empty = width - filled;
    const role = pct > 0.85 ? 'error' : pct > 0.65 ? 'warn' : 'success';
    return terminalThemeText(role, `${'█'.repeat(filled)}${'░'.repeat(empty)}`);
}

/**
 * @param {unknown} value
 * @param {Record<string, string>} labels
 * @returns {string}
 */
function humanEnum(value, labels) {
    const text = String(value ?? '').trim();
    if (!text) return '-';
    return labels[text] ?? text.replace(/[_-]+/gu, ' ');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderTimelineSourceLabel(value) {
    return humanEnum(value, {
        hub: 'hub persistido',
        bridge: 'conversa viva',
        terminal: 'terminal',
        mixed: 'mista',
        empty: 'vazia',
    });
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderTimelineAuthorityLabel(value) {
    return humanEnum(value, {
        persistent: 'persistência',
        transport: 'transporte vivo',
        reconciled: 'reconciliada',
        none: 'sem autoridade',
    });
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderReconciliationLabel(value) {
    return humanEnum(value, {
        persistent_only: 'só persistência',
        bridge_only: 'só conversa viva',
        aligned: 'alinhada',
        bridge_tail: 'cauda viva',
        diverged: 'divergente',
        empty: 'vazia',
    });
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderSyncStatusLabel(value) {
    return humanEnum(value, {
        not_needed: 'em dia',
        scheduled: 'agendada',
        unavailable: 'indisponível',
        blocked: 'bloqueada',
        failed: 'falhou',
        empty: 'vazia',
    });
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderSyncReasonLabel(value) {
    return humanEnum(value, {
        empty: 'sem histórico',
        aligned: 'timeline alinhada',
        bridge_tail: 'cauda viva pendente',
        'no-hub-session': 'sem sessão do hub',
        'diverged-no-overlap': 'sem sobreposição segura entre conversa viva e persistência',
    });
}

/**
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string | null}
 */
function optionalCount(count, singular, plural) {
    if (!Number.isFinite(count) || count <= 0) return null;
    return `${count} ${count === 1 ? singular : plural}`;
}

// ─── /context ─────────────────────────────────────────────────────────────────

/**
 * Exibe o uso da janela de contexto — usa tokens reais do SDK quando disponíveis; fallback para heurística.
 *
 * @param {{ println: (text: string) => void }} ctx
 * @param {string} [arg]
 * @returns {void}
 */
export function cmdContext({ println }, arg = '') {
    const { runtimeId } = extractRuntimeTarget(arg);
    const projection = callWithRuntimeTarget(readTerminalContextProjection, runtimeId);

    if (!projection.isRealData && !projection.hasHistory) {
        println(terminalThemeRow('Contexto', 'Nenhum histórico em memória ainda; envie um turno primeiro', { role: 'muted' }));
        return;
    }

    const usedTokens = projection.usedTokens;
    const maxTokens = projection.maxTokens;
    const pct = Math.min(projection.utilization, 1);
    const pctStr = (pct * 100).toFixed(1);
    const isRealData = projection.isRealData;

    const bar = progressBar(usedTokens, maxTokens);

    println('');
    println(terminalThemeHeadline('command', 'Janela de contexto'));
    println(`  ${bar} ${terminalThemeText('info', `${pctStr}%`)}`);
    println(
        terminalThemeRow(
            `Tokens${isRealData ? ' SDK' : ' estimados'}`,
            isRealData
                ? `real SDK · ${usedTokens.toLocaleString('pt-BR')} / ${maxTokens.toLocaleString('pt-BR')}`
                : `${usedTokens.toLocaleString('pt-BR')} / ${maxTokens.toLocaleString('pt-BR')}`,
            { role: 'info', width: 17 },
        ),
    );
    if (projection.turnCount > 0) {
        println(terminalThemeRow('Caracteres', projection.totalChars.toLocaleString('pt-BR'), { role: 'info', width: 17 }));
        println(terminalThemeRow('Turnos em memória', String(projection.turnCount), { role: 'info', width: 17 }));
    }

    if (pct > 0.85) {
        println('');
        println(terminalThemeRow('Atenção', 'janela de contexto acima de 85%; considere usar /compact', { role: 'error' }));
    } else if (pct > 0.65) {
        println('');
        println(terminalThemeRow('Atenção', 'janela de contexto acima de 65%; monitore conversas longas', { role: 'warn' }));
    }

    if (!isRealData) {
        println(terminalThemeText('muted', '  (estimativa heurística: 4 caracteres ~= 1 token; limite real depende do modelo)'));
    }

    // AG.5 — workspace SessionContext
    const ws = projection.workspace;
    println(terminalThemeHeadline('command', 'Workspace'));
    println(terminalThemeRow('Diretório', ws.cwd, { role: 'muted' }));
    if (ws.gitRoot) println(terminalThemeRow('Git', `${ws.gitRoot} · branch ${ws.currentBranch ?? '?'}`, { role: 'muted' }));

    println(terminalThemeHeadline('command', 'Timeline canônica'));
    println(
        terminalThemeRow('Fonte', `${renderTimelineSourceLabel(projection.timelineSource)} · ${renderTimelineAuthorityLabel(projection.timelineAuthority)} · ${renderReconciliationLabel(projection.reconciliationStatus)}`, {
            role: 'muted',
        }),
    );
    println(
        terminalThemeRow('Histórico', `${projection.persistedTurnCount} persistidos · ${projection.bridgeTurnCount} vivos · ${projection.liveBridgeTailCount} na cauda viva`, {
            role: 'muted',
        }),
    );
    const syncDetails = [
        renderSyncStatusLabel(projection.syncStatus),
        renderSyncReasonLabel(projection.syncReason),
        optionalCount(projection.syncPendingCount, 'pendente', 'pendentes'),
        optionalCount(projection.syncSyncedCount, 'gravado', 'gravados'),
        optionalCount(projection.syncFailedCount, 'falha', 'falhas'),
    ].filter(Boolean);
    println(
        terminalThemeRow('Sincronização', syncDetails.join(' · '), {
            role: 'muted',
        }),
    );
    if (projection.reconciliationStatus === 'diverged') {
        println(
            terminalThemeRow(
                'Nota',
                `conversa viva e persistência divergiram; sincronização bloqueada${
                    projection.syncBlockedReason ? ` (${renderSyncReasonLabel(projection.syncBlockedReason)})` : ''
                }; cauda viva visível foi preservada`,
                { role: 'warn' },
            ),
        );
    }
    if (projection.syncStatus === 'failed') {
        const retryLabel =
            typeof projection.syncNextRetryAt === 'number'
                ? ` próxima tentativa ${formatTerminalTimeLabel(projection.syncNextRetryAt, { mode: 'dual' })}`
                : '';
        println(terminalThemeRow('Sincronização', `falhou: ${projection.syncLastError ?? 'erro desconhecido'}${retryLabel}`, { role: 'warn' }));
    }

    println('');
}

// ─── /compact ─────────────────────────────────────────────────────────────────

/**
 * Solicita compactação manual à LLM-B e exibe o resultado.
 *
 * Após a resposta, limpa o histórico local do `llmBridgeClient`, mantendo apenas o resumo. A mensagem de compactação é
 * enviada via `sendTurn` (importado dinamicamente para evitar dependência circular — dialog.js importa state.js e
 * file-context.js).
 *
 * @param {{ println: (text: string) => void }} ctx
 * @param {string} [arg]
 * @returns {Promise<void>}
 */
export async function cmdCompact({ println }, arg = '') {
    const { runtimeId } = extractRuntimeTarget(arg);
    println(terminalThemeRow('Compactação', 'solicitada à LLM-B; aguarde', { role: 'muted' }));

    const result = await callWithRuntimeTarget(requestTerminalCompactionProjection, runtimeId);
    if (!result.ok || !result.reply) {
        println(terminalThemeRow('Compactação', 'LLM-B ocupada ou sem resposta; tente novamente', { role: 'error' }));
        return;
    }

    const estimatedNew = result.estimatedTokens ?? 0;
    println('');
    println(terminalThemeRow('Compactação', 'histórico local compactado', { role: 'success' }));
    println(terminalThemeRow('Tokens', `~${estimatedNew.toLocaleString('pt-BR')} após compactação`, { role: 'muted' }));
    println('');
}
