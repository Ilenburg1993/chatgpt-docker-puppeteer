// @ts-check
/**
 * src/copilot/terminal/commands/session.js
 *
 * Comandos de sessão do REPL terminal LLM-B: /status, /history, /db-history, /db-sessions, /who, /count, /clear,
 * /answer, /restart, /quit, /exit
 *
 * @module copilot/terminal/commands/session
 */

import { alwaysAliveAgent } from '../../agent/always-alive.js';
import { llmBridgeClient } from '../../bridges/llm-bridge-client.js';
import { conversationStore } from '../../conversation-hub/store.js';

/**
 * Referência ao _hubSessionId gerenciado pelo terminal server. É passado como parâmetro pois não pode ser importado
 * estaticamente (é mutável).
 *
 * @typedef {object} SessionContext
 * @property {string | null} [hubSessionId] - ID da hub session ativa
 * @property {number} [injectPort] - Porta do inject server
 * @property {(text: string) => void} println - Função de output do terminal
 */

/**
 * Exibe snapshot de status do agente.
 *
 * @param {SessionContext} ctx
 * @returns {void}
 */
export function cmdStatus({ hubSessionId, injectPort, println }) {
    const snap = /** @type {any} */ (alwaysAliveAgent.getStatusSnapshot());
    const active = alwaysAliveAgent.dialogLoopActive;
    const statusColor =
        snap.status === 'waiting_for_input' ? '\x1b[32m' : snap.status === 'idle' ? '\x1b[33m' : '\x1b[31m';
    println(`
  \x1b[36mStatus do Terminal LLM-B\x1b[0m
  ─────────────────────────────────────
  agente          ${statusColor}${snap.status}\x1b[0m
  dialog loop     ${active ? '\x1b[32m● ativo\x1b[0m' : '\x1b[31m○ inativo\x1b[0m'}
  turnos (memória) ${llmBridgeClient.turnCount}
  hub session     \x1b[90m${hubSessionId ?? '(sem hub)'}\x1b[0m
  inject port     ${injectPort}
  ─────────────────────────────────────
`);
}

/**
 * Exibe o histórico de conversa local.
 *
 * @param {SessionContext} ctx
 * @param {number} [n] - Número de pares a exibir
 * @returns {void}
 */
export function cmdHistory({ println }, n = 10) {
    const hist = llmBridgeClient.history;
    if (hist.length === 0) {
        println('[history] Histórico vazio.');
        return;
    }
    const slice = hist.slice(-n * 2);
    println(`\n── Histórico (últimos ${Math.floor(slice.length / 2)} pares) ──`);
    for (const turn of slice) {
        const ts = new Date(turn.timestamp).toLocaleTimeString('pt-BR');
        const roleLabel = turn.role === 'user' ? '👤' : '🧠';
        const preview = turn.content.slice(0, 160) + (turn.content.length > 160 ? '…' : '');
        println(`  [${ts}] ${roleLabel} ${preview}`);
    }
    println('─────────────────────────────────');
}

/**
 * Exibe o histórico SQLite persistido.
 *
 * @param {SessionContext} ctx
 * @param {number} [n]
 * @returns {void}
 */
export function cmdDbHistory({ hubSessionId, println }, n = 20) {
    if (!hubSessionId) {
        println('\x1b[90m  /db-history: Hub session não disponível (sem persistência).\x1b[0m');
        return;
    }
    try {
        const turns = conversationStore.readTurns(hubSessionId, { limit: n });
        if (turns.length === 0) {
            println('\x1b[90m  /db-history: Nenhum turno persistido ainda.\x1b[0m');
            return;
        }
        println(`\n  \x1b[36mÚltimos ${turns.length} turnos da sessão atual\x1b[0m`);
        println('  ─────────────────────────────────────────────────');
        for (const t of turns) {
            const ts = new Date(t.created_at).toLocaleTimeString('pt-BR');
            const emoji = t.role === 'llm_b' ? '🧠' : t.role === 'llm_a' ? '🤖' : '👤';
            const preview = t.content.slice(0, 160) + (t.content.length > 160 ? '…' : '');
            println(`  \x1b[90m[${ts}]\x1b[0m ${emoji}  ${preview}`);
        }
        println('  ─────────────────────────────────────────────────\n');
    } catch (/** @type {any} */ e) {
        println(`\x1b[31m  /db-history erro: ${e.message}\x1b[0m`);
    }
}

/**
 * Lista as hub_sessions persistidas no DB.
 *
 * @param {SessionContext} ctx
 * @param {number} [n]
 * @returns {void}
 */
export function cmdDbSessions({ hubSessionId, println }, n = 10) {
    try {
        const sessions = conversationStore.listHubSessions({ limit: n });
        if (sessions.length === 0) {
            println('\x1b[90m  /db-sessions: Nenhuma sessão persistida ainda.\x1b[0m');
            return;
        }
        println(`\n  \x1b[36mÚltimas ${sessions.length} hub sessions\x1b[0m`);
        println('  ──────────────────────────────────────────────────────────────');
        for (const s of sessions) {
            const createdAt = new Date(s.created_at).toLocaleString('pt-BR');
            const isCurrent = s.id === hubSessionId;
            const statusColor = s.status === 'active' ? '\x1b[32m' : '\x1b[90m';
            const marker = isCurrent ? ' \x1b[33m← atual\x1b[0m' : '';
            println(
                `  ${statusColor}${s.status}\x1b[0m  \x1b[90m${createdAt}\x1b[0m  \x1b[2m${s.id.slice(0, 8)}\x1b[0m  ${s.title}${marker}`,
            );
        }
        println('  ──────────────────────────────────────────────────────────────\n');
    } catch (/** @type {any} */ e) {
        println(`\x1b[31m  /db-sessions erro: ${e.message}\x1b[0m`);
    }
}

/**
 * Exibe atores ativos na sessão.
 *
 * @param {SessionContext} ctx
 * @returns {void}
 */
export function cmdWho({ injectPort, println }) {
    println(`
  \x1b[36mAtores ativos nesta sessão:\x1b[0m
  👤  \x1b[32mVocê\x1b[0m          — stdin (digitar diretamente aqui)
  🤖  \x1b[34mLLM-A\x1b[0m         — POST http://localhost:${injectPort}/inject
  🧠  \x1b[35mLLM-B\x1b[0m         — AlwaysAliveAgent (GPT-4.1 Copilot SDK)
  📡  \x1b[90mSSE stream\x1b[0m    — GET  http://localhost:${injectPort}/events
`);
}

/**
 * Exibe estatísticas da sessão atual.
 *
 * @param {SessionContext} ctx
 * @returns {void}
 */
export function cmdCount({ hubSessionId, println }) {
    if (!hubSessionId) {
        println('\x1b[33m  Nenhuma hub session ativa.\x1b[0m');
        return;
    }
    const turns = conversationStore.readTurns(hubSessionId, { limit: 9999 });
    const mems = conversationStore.recallMemories({ limit: 9999 });
    const userCount = turns.filter((t) => t.role === 'user').length;
    const llmbCount = turns.filter((t) => t.role === 'llm_b').length;
    println(`
  \x1b[36mEstatísticas da sessão\x1b[0m
  ─────────────────────────────────────────────
  Turnos (usuário):   ${String(userCount).padStart(4)}
  Turnos (LLM-B):     ${String(llmbCount).padStart(4)}
  Turnos (total):     ${String(turns.length).padStart(4)}
  Memórias salvas:    ${String(mems.length).padStart(4)}
  Hub session:        ${hubSessionId?.slice(0, 8) ?? '—'}…
  ─────────────────────────────────────────────\n`);
}

/**
 * Limpa histórico em memória.
 *
 * @param {SessionContext} ctx
 * @returns {void}
 */
export function cmdClear({ println }) {
    llmBridgeClient.clearHistory();
    println('\x1b[90m  Histórico em memória limpo.\x1b[0m');
}

/**
 * Responde pergunta pendente do LLM-B.
 *
 * @param {SessionContext} ctx
 * @param {string} arg
 * @returns {void}
 */
export function cmdAnswer({ println }, arg) {
    const ok = alwaysAliveAgent.answerPendingQuestion(arg);
    println(ok ? `[answer] Resposta enviada: "${arg}"` : '[answer] Nenhuma pergunta pendente.');
}
