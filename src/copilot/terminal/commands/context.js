// @ts-check
/**
 * src/copilot/terminal/commands/context.js
 *
 * Comandos `/context` e `/compact` para gerenciamento de contexto do dialog loop.
 *
 * `/context` → mostra uso do context window (tokens reais do SDK quando disponíveis; fallback para heurística 4
 * chars/token) `/compact` → envia pedido de compactação à LLM-B e limpa o histórico local
 *
 * @module copilot/terminal/commands/context
 * @see EventBus
 */

import { readTerminalContextProjection, requestTerminalCompactionProjection } from '../frontend/index.js';
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

// ─── /context ─────────────────────────────────────────────────────────────────

/**
 * Exibe o uso do context window — usa tokens reais do SDK quando disponíveis; fallback para heurística.
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
    println(terminalThemeHeadline('command', 'Uso do contexto'));
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
        println(terminalThemeRow('Chars totais', projection.totalChars.toLocaleString('pt-BR'), { role: 'info', width: 17 }));
        println(terminalThemeRow('Turnos memória', String(projection.turnCount), { role: 'info', width: 17 }));
    }

    if (pct > 0.85) {
        println('');
        println(terminalThemeRow('Atenção', 'context window acima de 85%; considere usar /compact', { role: 'error' }));
    } else if (pct > 0.65) {
        println('');
        println(terminalThemeRow('Atenção', 'context window acima de 65%; monitore conversas longas', { role: 'warn' }));
    }

    if (!isRealData) {
        println(terminalThemeText('muted', '  (estimativa heurística: 4 chars ~= 1 token; limite real depende do modelo)'));
    }

    // AG.5 — workspace SessionContext
    const ws = projection.workspace;
    println(terminalThemeHeadline('command', 'Workspace'));
    println(terminalThemeRow('cwd', ws.cwd, { role: 'muted' }));
    if (ws.gitRoot) println(terminalThemeRow('git', `${ws.gitRoot} · branch ${ws.currentBranch ?? '?'}`, { role: 'muted' }));

    println(terminalThemeHeadline('command', 'Timeline canônica'));
    println(
        terminalThemeRow('Autoridade', `${projection.timelineSource} · ${projection.timelineAuthority} · ${projection.reconciliationStatus}`, {
            role: 'muted',
        }),
    );
    println(
        terminalThemeRow('Persistência', `${projection.persistedTurnCount} persistidos · ${projection.bridgeTurnCount} bridge · ${projection.liveBridgeTailCount} live-tail`, {
            role: 'muted',
        }),
    );
    println(
        terminalThemeRow('Sync Hub', `${projection.syncStatus}${projection.syncPendingCount > 0 ? ` · pendentes=${projection.syncPendingCount}` : ''}${projection.syncSyncedCount > 0 ? ` · gravados=${projection.syncSyncedCount}` : ''}${projection.syncFailedCount > 0 ? ` · falhas=${projection.syncFailedCount}` : ''}`, {
            role: 'muted',
        }),
    );
    if (projection.reconciliationStatus === 'diverged') {
        println(
            terminalThemeRow(
                'Nota',
                `bridge e persistência divergiram; sync bloqueado${
                    projection.syncBlockedReason ? ` (${projection.syncBlockedReason})` : ''
                }; live-tail visível foi preservado`,
                { role: 'warn' },
            ),
        );
    }
    if (projection.syncStatus === 'failed') {
        const retryLabel =
            typeof projection.syncNextRetryAt === 'number'
                ? ` próxima tentativa ${formatTerminalTimeLabel(projection.syncNextRetryAt, { mode: 'dual' })}`
                : '';
        println(terminalThemeRow('Sync Hub', `falhou: ${projection.syncLastError ?? 'erro desconhecido'}${retryLabel}`, { role: 'warn' }));
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
