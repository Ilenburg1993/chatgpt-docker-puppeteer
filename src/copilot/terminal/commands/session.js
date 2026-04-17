// @ts-check
/**
 * src/copilot/terminal/commands/session.js
 *
 * Comandos de sessão do REPL terminal LLM-B: /status, /history, /db-history, /db-sessions, /who, /count, /clear,
 * /answer, /restart, /quit, /exit
 *
 * @module copilot/terminal/commands/session
 * @see EventBus
 */

import { toError } from '#copilot/core';
import {
    answerPendingTerminalQuestion,
    clearTerminalHistory,
    listTerminalSnapshotsProjection,
    loadTerminalSnapshotProjection,
    readTerminalCountProjection,
    readTerminalDbHistoryProjection,
    readTerminalDbSessionsProjection,
    readTerminalHistoryProjection,
    readTerminalStatusProjection,
    saveTerminalSnapshotProjection,
} from '../frontend/index.js';

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
    const projection = readTerminalStatusProjection({
        hubSessionId: hubSessionId ?? null,
        ...(typeof injectPort === 'number' ? { injectPort } : {}),
    });
    const { snap, health } = projection;
    const active = projection.dialogLoopActive;
    const statusColor =
        snap['status'] === 'waiting_for_input' ? '\x1b[32m' : snap['status'] === 'idle' ? '\x1b[33m' : '\x1b[31m';
    const effort = snap['reasoningEffort'] ?? 'high';
    const healthColor =
        health?.['status'] === 'healthy' ? '\x1b[32m' : health?.['status'] === 'degraded' ? '\x1b[33m' : '\x1b[31m';
    const ws = projection.workspace;
    const branchStr = ws.currentBranch ? `\x1b[32m${ws.currentBranch}\x1b[0m` : '\x1b[90m(sem branch)\x1b[0m';
    println(`
  \x1b[36mStatus do Terminal LLM-B\x1b[0m
  ─────────────────────────────────────
  agente           ${statusColor}${snap['status']}\x1b[0m
        health           ${health ? `${healthColor}${health['status']}\x1b[0m` : '\x1b[90m(n/d)\x1b[0m'}
  dialog loop      ${active ? '\x1b[32m● ativo\x1b[0m' : '\x1b[31m○ inativo\x1b[0m'}
  modelo           \x1b[36m${snap['model']}\x1b[0m
  reasoning        \x1b[35m${effort}\x1b[0m
        bg tasks         ${health?.['backgroundPendingCount'] ?? 0}
        issues           ${Array.isArray(health?.['issues']) ? health['issues'].length : 0}
    runtime session  \x1b[90m${projection.runtimeSessionId ?? '(sem runtime)'}\x1b[0m
    sdk session      \x1b[90m${projection.sdkSessionId ?? '(sem sdk)'}\x1b[0m
    hub session      \x1b[90m${projection.hubSessionId ?? '(sem hub)'}\x1b[0m
    turnos (memória) ${projection.turnCount}
    inject port      ${projection.injectPort}
  ─────────────────────────────────────
  workspace        \x1b[90m${ws.cwd}\x1b[0m
  git root         \x1b[90m${ws.gitRoot ?? '(não é git repo)'}\x1b[0m
  branch           ${branchStr}
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
    const hist = readTerminalHistoryProjection(n);
    if (hist.length === 0) {
        println('[history] Histórico vazio.');
        return;
    }
    println(`\n── Histórico (últimos ${Math.floor(hist.length / 2)} pares) ──`);
    for (const turn of hist) {
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
 * @param {number} [n] - Número de turnos a exibir (padrão: 20)
 * @param {number} [offset] - Offset de paginação (UPG-PROP-13)
 * @returns {void}
 */
export function cmdDbHistory({ hubSessionId, println }, n = 20, offset = 0) {
    const projection = readTerminalDbHistoryProjection({ hubSessionId: hubSessionId ?? null, limit: n, offset });
    if (!projection.available) {
        println('\x1b[90m  /db-history: Hub session não disponível (sem persistência).\x1b[0m');
        return;
    }
    try {
        const turns = projection.turns;
        if (turns.length === 0) {
            println('\x1b[90m  /db-history: Nenhum turno persistido ainda.\x1b[0m');
            return;
        }
        const offsetLabel = offset > 0 ? ` (offset ${offset})` : '';
        println(`\n  \x1b[36mÚltimos ${turns.length} turnos da sessão atual${offsetLabel}\x1b[0m`);
        println('  ─────────────────────────────────────────────────');
        for (const t of turns) {
            const ts = new Date(String(t['created_at'] ?? '')).toLocaleTimeString('pt-BR');
            const role = String(t['role'] ?? 'user');
            const content = String(t['content'] ?? '');
            const emoji = role === 'llm_b' ? '🧠' : role === 'llm_a' ? '🤖' : '👤';
            const preview = content.slice(0, 160) + (content.length > 160 ? '…' : '');
            println(`  \x1b[90m[${ts}]\x1b[0m ${emoji}  ${preview}`);
        }
        println('  ─────────────────────────────────────────────────\n');
    } catch (e) {
        println(`\x1b[31m  /db-history erro: ${toError(e).message}\x1b[0m`);
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
        const { sessions, currentHubSessionId } = readTerminalDbSessionsProjection({
            currentHubSessionId: hubSessionId ?? null,
            limit: n,
        });
        if (sessions.length === 0) {
            println('\x1b[90m  /db-sessions: Nenhuma sessão persistida ainda.\x1b[0m');
            return;
        }
        println(`\n  \x1b[36mÚltimas ${sessions.length} hub sessions\x1b[0m`);
        println('  ──────────────────────────────────────────────────────────────');
        for (const s of sessions) {
            const createdAt = new Date(String(s['created_at'] ?? '')).toLocaleString('pt-BR');
            const sessionId = String(s['id'] ?? '');
            const sessionStatus = String(s['status'] ?? 'unknown');
            const title = String(s['title'] ?? '(sem título)');
            const isCurrent = sessionId === currentHubSessionId;
            const statusColor = sessionStatus === 'active' ? '\x1b[32m' : '\x1b[90m';
            const marker = isCurrent ? ' \x1b[33m← atual\x1b[0m' : '';
            println(
                `  ${statusColor}${sessionStatus}\x1b[0m  \x1b[90m${createdAt}\x1b[0m  \x1b[2m${sessionId.slice(0, 8)}\x1b[0m  ${title}${marker}`,
            );
        }
        println('  ──────────────────────────────────────────────────────────────\n');
    } catch (e) {
        println(`\x1b[31m  /db-sessions erro: ${toError(e).message}\x1b[0m`);
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
    const projection = readTerminalCountProjection({ hubSessionId: hubSessionId ?? null });
    if (!projection.available) {
        println('\x1b[33m  Nenhuma hub session ativa.\x1b[0m');
        return;
    }
    println(`
  \x1b[36mEstatísticas da sessão\x1b[0m
  ─────────────────────────────────────────────
    Turnos (usuário):   ${String(projection.userTurns).padStart(4)}
    Turnos (LLM-B):     ${String(projection.llmBTurns).padStart(4)}
    Turnos (total):     ${String(projection.turns).padStart(4)}
    Memórias salvas:    ${String(projection.memories).padStart(4)}
    Hub session:        ${projection.hubSessionId?.slice(0, 8) ?? '—'}…
    SDK session:        ${projection.sdkSessionId?.slice(0, 8) ?? '—'}…
  ─────────────────────────────────────────────\n`);
}

/**
 * Limpa histórico em memória.
 *
 * @param {SessionContext} ctx
 * @returns {void}
 */
export function cmdClear({ println }) {
    clearTerminalHistory();
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
    const ok = answerPendingTerminalQuestion(arg);
    println(ok ? `[answer] Resposta enviada: "${arg}"` : '[answer] Nenhuma pergunta pendente.');
}

/**
 * F41.5: Salva snapshot da sessão atual.
 *
 * @param {SessionContext} ctx
 * @param {string} [reason]
 * @returns {Promise<void>}
 */
export async function cmdSessionSave({ println }, reason) {
    const { data, path } = await saveTerminalSnapshotProjection(reason);
    println(`\x1b[32m  ✓ Snapshot salvo: ${String(data['snapshotId'] ?? '(sem id)')}\x1b[0m`);
    println(`\x1b[90m    Path: ${path}\x1b[0m`);
}

/**
 * F41.5: Lista snapshots disponíveis.
 *
 * @param {SessionContext} ctx
 * @returns {Promise<void>}
 */
export async function cmdSessionList({ println }) {
    const snaps = await listTerminalSnapshotsProjection();
    if (snaps.length === 0) {
        println('\x1b[90m  Nenhum snapshot encontrado.\x1b[0m');
        return;
    }
    println(`\x1b[36m  Snapshots disponíveis (${snaps.length}):\x1b[0m`);
    for (const s of snaps) {
        const createdAt = s['createdAt'];
        const date =
            typeof createdAt === 'number' || typeof createdAt === 'string'
                ? new Date(createdAt).toISOString().replace('T', ' ').slice(0, 19)
                : 'invalid-date';
        println(`    ${String(s['snapshotId'] ?? '')}  ${date}  model=${String(s['model'] ?? '')}  ${String(s['reason'] ?? '')}`);
    }
}

/**
 * F41.5: Exibe detalhes de um snapshot.
 *
 * @param {SessionContext} ctx
 * @param {string} snapshotId
 * @returns {Promise<void>}
 */
export async function cmdSessionRestore({ println }, snapshotId) {
    if (!snapshotId) {
        println('\x1b[33m  Uso: /session restore <snapshotId>\x1b[0m');
        println('\x1b[90m  Use /session list para ver snapshots disponíveis.\x1b[0m');
        return;
    }

    const snap = await loadTerminalSnapshotProjection(snapshotId);
    if (!snap) {
        println(`\x1b[31m  Snapshot não encontrado: ${snapshotId}\x1b[0m`);
        return;
    }

    println(`\x1b[36m  Snapshot: ${String(snap['snapshotId'] ?? '(sem id)')}\x1b[0m`);
    const createdAt = snap['createdAt'];
    const createdAtIso =
        typeof createdAt === 'number' || typeof createdAt === 'string' ? new Date(createdAt).toISOString() : 'invalid-date';
    println(`    Criado: ${createdAtIso}`);
    println(`    Session: ${String(snap['sessionId'] ?? '(none)')}`);
    println(`    Model: ${String(snap['model'] ?? 'unknown')}  Status: ${String(snap['status'] ?? 'unknown')}`);
    println(`    Send count: ${Number(snap['sendCount'] ?? 0)}`);
    println(`    Dialog loop: ${snap['dialogLoopActive'] ? 'active' : 'inactive'}${snap['dialogPaused'] ? ' (paused)' : ''}`);
    if (snap['pendingQuestion']) println(`    Pending question: ${String(snap['pendingQuestion'])}`);
    if (snap['prMetrics']) {
        const prMetrics = /** @type {{ boots?: number; resumesWithPR?: number; resumesZeroPR?: number }} */ (snap['prMetrics']);
        println(
            `    PR metrics: boots=${Number(prMetrics.boots ?? 0)} resumePR=${Number(prMetrics.resumesWithPR ?? 0)} zeroPR=${Number(prMetrics.resumesZeroPR ?? 0)}`,
        );
    }
    println('\x1b[90m    (Restore automático ocorre no boot via PM2 — use /session save antes de reiniciar)\x1b[0m');
}
