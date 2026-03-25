// @ts-check
/**
 * src/copilot/terminal/commands/context.js
 *
 * Comandos `/context` e `/compact` para gerenciamento de contexto do dialog loop.
 *
 * `/context` → mostra estimativa de uso do context window com barra visual `/compact` → envia pedido de compactação à
 * LLM-B e limpa o histórico local
 *
 * @module copilot/terminal/commands/context
 */

import { llmBridgeClient } from '../../bridges/llm-bridge-client.js';

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
 * Exibe o uso estimado do context window com barra visual.
 *
 * @param {{ println: (text: string) => void }} ctx
 * @returns {void}
 */
export function cmdContext({ println }) {
    const history = /** @type {{ role: string; content: string }[]} */ (
        /** @type {unknown} */ (llmBridgeClient.history) ?? []
    );
    if (history.length === 0) {
        println('\x1b[90m  Nenhum histórico em memória ainda. Envie um turno primeiro.\x1b[0m');
        return;
    }

    // Total de chars
    let totalChars = 0;
    let turnCount = 0;
    for (const turn of history) {
        const text = typeof turn.content === 'string' ? turn.content : JSON.stringify(turn.content);
        totalChars += text.length;
        turnCount++;
    }

    const estimatedTokens = estimateTokens(totalChars);
    const maxTokens = DEFAULT_MAX_TOKENS;
    const pct = Math.min(estimatedTokens / maxTokens, 1);
    const pctStr = (pct * 100).toFixed(1);
    const bar = progressBar(estimatedTokens, maxTokens);

    println('');
    println(`\x1b[36m  ─── Uso do Contexto ────────────────────────────────────────────\x1b[0m`);
    println(`  ${bar} \x1b[1m${pctStr}%\x1b[0m`);
    println(
        `  Tokens estimados : \x1b[33m${estimatedTokens.toLocaleString('pt-BR')}\x1b[0m / \x1b[90m${maxTokens.toLocaleString('pt-BR')}\x1b[0m`,
    );
    println(`  Chars totais     : \x1b[33m${totalChars.toLocaleString('pt-BR')}\x1b[0m`);
    println(`  Turnos na memória: \x1b[33m${turnCount}\x1b[0m`);

    if (pct > 0.85) {
        println('');
        println(`\x1b[31m  ⚠️  Context window acima de 85% — considere usar /compact para compactar.\x1b[0m`);
    } else if (pct > 0.65) {
        println('');
        println(`\x1b[33m  ℹ️  Context window acima de 65% — monitore se a conversa for longa.\x1b[0m`);
    }

    println(`\x1b[90m  (estimativa heurística: 4 chars ≈ 1 token; limite real depende do modelo)\x1b[0m`);
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

    // Limpar histórico local — substitui por resumo
    if (Array.isArray(llmBridgeClient.history)) {
        llmBridgeClient.history.length = 0;
        llmBridgeClient.history.push({ role: 'assistant', content: reply });
    }

    const estimatedNew = estimateTokens(reply?.length ?? 0);
    println('');
    println(`\x1b[32m  ✓ Histórico local compactado.\x1b[0m`);
    println(`\x1b[90m  Tokens estimados após compactação: ~${estimatedNew.toLocaleString('pt-BR')} tokens\x1b[0m`);
    println('');
}
