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

import { ALWAYS_ALIVE_AGENT } from '#copilot/agent';
import { llmBridgeClient } from '#copilot/channel';
import { container } from '#copilot/core';
import { getWorkspaceContext } from '../workspace-context.js';

// ─── Estimativa de tokens ─────────────────────────────────────────────────────

/** Heurística de tokens: ~4 chars por token. */
const CHARS_PER_TOKEN = 4;

/** Limite padrão estimado de tokens (128k context window — conservador). */
const DEFAULT_MAX_TOKENS = 128_000;

/**
 * Estima o número de tokens a partir de uma contagem de caracteres.
 *
 * @param {number} charCount - Número de caracteres
 * @returns {number}
 */
function estimateTokens(charCount) {
    return Math.ceil(charCount / CHARS_PER_TOKEN);
}

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
    const history = /** @type {{ role: string; content: string }[]} */ (
        /** @type {unknown} */ (llmBridgeClient.history) ?? []
    );

    // AA.3: usar dados reais do SDK se disponíveis
    const sdkContext = container.resolve(ALWAYS_ALIVE_AGENT).getStatusSnapshot().contextWindow;

    if (!sdkContext && history.length === 0) {
        println('\x1b[90m  Nenhum histórico em memória ainda. Envie um turno primeiro.\x1b[0m');
        return;
    }

    // Total de chars (para exibição complementar)
    let totalChars = 0;
    let turnCount = 0;
    for (const turn of history) {
        const text = typeof turn.content === 'string' ? turn.content : JSON.stringify(turn.content);
        totalChars += text.length;
        turnCount++;
    }

    let usedTokens, maxTokens, pct, pctStr, isRealData;
    if (sdkContext) {
        usedTokens = sdkContext.tokens;
        maxTokens = sdkContext.tokenLimit;
        pct = Math.min(sdkContext.utilization, 1);
        pctStr = (pct * 100).toFixed(1);
        isRealData = true;
    } else {
        usedTokens = estimateTokens(totalChars);
        maxTokens = DEFAULT_MAX_TOKENS;
        pct = Math.min(usedTokens / maxTokens, 1);
        pctStr = (pct * 100).toFixed(1);
        isRealData = false;
    }

    const bar = progressBar(usedTokens, maxTokens);

    println('');
    println(`\x1b[36m  ─── Uso do Contexto ────────────────────────────────────────────\x1b[0m`);
    println(`  ${bar} \x1b[1m${pctStr}%\x1b[0m`);
    println(
        `  Tokens${isRealData ? ' (real SDK)' : ' estimados'}: \x1b[33m${usedTokens.toLocaleString('pt-BR')}\x1b[0m / \x1b[90m${maxTokens.toLocaleString('pt-BR')}\x1b[0m`,
    );
    if (turnCount > 0) {
        println(`  Chars totais     : \x1b[33m${totalChars.toLocaleString('pt-BR')}\x1b[0m`);
        println(`  Turnos na memória: \x1b[33m${turnCount}\x1b[0m`);
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
    const ws = getWorkspaceContext();
    println(`\x1b[36m  ─── Workspace ──────────────────────────────────────────────────\x1b[0m`);
    println(`  cwd    \x1b[90m${ws.cwd}\x1b[0m`);
    if (ws.gitRoot) println(`  git    \x1b[90m${ws.gitRoot}\x1b[0m  branch: \x1b[32m${ws.currentBranch ?? '?'}\x1b[0m`);

    println('');
}

// ─── /compact ─────────────────────────────────────────────────────────────────

/** Pedido de compactação enviado à LLM-B como mensagem de sistema. */
const COMPACT_PROMPT =
    '[SISTEMA] Compacte toda esta conversa em um resumo técnico denso. Preserve: ' +
    'todos os fatos, código, decisões, estados e contexto de arquivos discutidos. ' +
    'Responda APENAS com esse resumo. Após isso, considere o resumo como o novo ' +
    'contexto inicial desta sessão.';

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

    // Import dinâmico para evitar ciclo dialog.js ↔ commands/context.js
    const { sendTurn } = await import('../dialog.js');

    const reply = await sendTurn(COMPACT_PROMPT, 'user');
    if (!reply) {
        println('\x1b[31m  ✗ LLM-B ocupada ou sem resposta. Tente novamente.\x1b[0m');
        return;
    }

    // BUG-05 (fix): usar clearHistory()/seedHistory() em vez de mutação direta de ReadonlyArray
    llmBridgeClient.clearHistory();
    llmBridgeClient.seedHistory('assistant', reply);

    const estimatedNew = estimateTokens(reply?.length ?? 0);
    println('');
    println(`\x1b[32m  ✓ Histórico local compactado.\x1b[0m`);
    println(`\x1b[90m  Tokens estimados após compactação: ~${estimatedNew.toLocaleString('pt-BR')} tokens\x1b[0m`);
    println('');
}
