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
    const color = pct > 0.85 ? '\x1b[31m' : pct > 0.65 ? '\x1b[33m' : '\x1b[32m';
    return `${color}${'█'.repeat(filled)}${'░'.repeat(empty)}\x1b[0m`;
}

// ─── /context ─────────────────────────────────────────────────────────────────

/**
 * Exibe o uso do context window — usa tokens reais do SDK quando disponíveis; fallback para heurística.
 *
 * @param {{ println: (text: string) => void }} ctx
 * @returns {void}
 */
export function cmdContext({ println }) {
    const projection = readTerminalContextProjection();

    if (!projection.isRealData && !projection.hasHistory) {
        println('\x1b[90m  Nenhum histórico em memória ainda. Envie um turno primeiro.\x1b[0m');
        return;
    }

    const usedTokens = projection.usedTokens;
    const maxTokens = projection.maxTokens;
    const pct = Math.min(projection.utilization, 1);
    const pctStr = (pct * 100).toFixed(1);
    const isRealData = projection.isRealData;

    const bar = progressBar(usedTokens, maxTokens);

    println('');
    println(`\x1b[36m  ─── Uso do Contexto ────────────────────────────────────────────\x1b[0m`);
    println(`  ${bar} \x1b[1m${pctStr}%\x1b[0m`);
    println(
        `  Tokens${isRealData ? ' (real SDK)' : ' estimados'}: \x1b[33m${usedTokens.toLocaleString('pt-BR')}\x1b[0m / \x1b[90m${maxTokens.toLocaleString('pt-BR')}\x1b[0m`,
    );
    if (projection.turnCount > 0) {
        println(`  Chars totais     : \x1b[33m${projection.totalChars.toLocaleString('pt-BR')}\x1b[0m`);
        println(`  Turnos na memória: \x1b[33m${projection.turnCount}\x1b[0m`);
    }

    if (pct > 0.85) {
        println('');
        println(`\x1b[31m  ⚠️  Context window acima de 85% — considere usar /compact para compactar.\x1b[0m`);
    } else if (pct > 0.65) {
        println('');
        println(`\x1b[33m  ℹ️  Context window acima de 65% — monitore se a conversa for longa.\x1b[0m`);
    }

    if (!isRealData) {
        println(`\x1b[90m  (estimativa heurística: 4 chars ≈ 1 token; limite real depende do modelo)\x1b[0m`);
    }

    // AG.5 — workspace SessionContext
    const ws = projection.workspace;
    println(`\x1b[36m  ─── Workspace ──────────────────────────────────────────────────\x1b[0m`);
    println(`  cwd    \x1b[90m${ws.cwd}\x1b[0m`);
    if (ws.gitRoot) println(`  git    \x1b[90m${ws.gitRoot}\x1b[0m  branch: \x1b[32m${ws.currentBranch ?? '?'}\x1b[0m`);

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
 * @returns {Promise<void>}
 */
export async function cmdCompact({ println }) {
    println('\x1b[90m  ⚙️  Solicitando compactação à LLM-B… aguarde.\x1b[0m');

    const result = await requestTerminalCompactionProjection();
    if (!result.ok || !result.reply) {
        println('\x1b[31m  ✗ LLM-B ocupada ou sem resposta. Tente novamente.\x1b[0m');
        return;
    }

    const estimatedNew = result.estimatedTokens ?? 0;
    println('');
    println(`\x1b[32m  ✓ Histórico local compactado.\x1b[0m`);
    println(`\x1b[90m  Tokens estimados após compactação: ~${estimatedNew.toLocaleString('pt-BR')} tokens\x1b[0m`);
    println('');
}
