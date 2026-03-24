// @ts-check
// O terminal LLM-B sempre requer o subsistema Copilot SDK habilitado.
// Configuramos antes dos imports para que todos os módulos vejam o valor correto.
if (!process.env.COPILOT_SDK_ENABLED) process.env.COPILOT_SDK_ENABLED = 'true';

/**
 * src/copilot/terminal-server.js
 *
 * Terminal Permanente LLM-B — sessão aberta, multi-ator.
 *
 * Mantém uma sessão de diálogo sempre ativa com a LLM-B (AlwaysAliveAgent no modo dialog loop). Dois atores podem
 * enviar mensagens:
 *
 * 1. **Usuário humano** via readline stdin/stdout (interface interativa no terminal)
 * 2. **LLM-A** via HTTP POST `http://localhost:<LLM_B_TERMINAL_PORT>/inject` (também disponível via `POST /api/hub/inject`
 *    no servidor principal)
 *
 * Comportamento:
 *
 * - Ao iniciar, o agente sobe automaticamente e o dialog loop é ativado
 * - Cada mensagem de qualquer fonte é roteada para `alwaysAliveAgent.sendDialogTurn()`
 * - A resposta é exibida no stdout com prefixo do ator: [user], [llm-a], [llm-b]
 * - Ctrl+C pausa readline mas NÃO encerra o dialog loop (LLM-B fica aguardando)
 * - `/quit` encerra o loop e o processo
 *
 * @module copilot/terminal-server
 *
 * @example
 *     ```bash
 *     # Iniciar diretamente:
 *     node --strip-types src/copilot/terminal-server.js
 *
 *     # Injetar mensagem de LLM-A (com servidor ativo):
 *     curl -X POST http://localhost:3009/inject \
 *       -H 'Content-Type: application/json' \
 *       -d '{"message": "Olá LLM-B!", "from": "llm-a"}'
 *     ```;
 */

import { log } from '#core/logger';
import http from 'node:http';
import readline from 'node:readline';
import { formatAliases, loadAliases, removeAlias, resolve, setAlias } from './alias-store.js';
import { alwaysAliveAgent } from './always-alive.js';
import { conversationStore } from './conversation-hub/store.js';
import {
    closeIssue,
    commentIssue,
    createIssue,
    diffPr,
    formatIssueList,
    formatPrList,
    formatReleaseList,
    formatRunList,
    getStatus as ghGetStatus,
    rawApi as ghRawApi,
    listIssues,
    listPrs,
    listReleases,
    listRuns,
    searchIssues,
    viewIssue,
    viewPr,
    viewRun,
} from './gh-bridge.js';
import {
    formatBranch,
    formatLog,
    formatStatus,
    gitBranch,
    gitDiff,
    gitLog,
    gitPull,
    gitStash,
    gitStashList,
    gitStatus,
} from './git-bridge.js';
import { llmBridgeClient } from './llm-bridge-client.js';

/** ID da hub_session permanente criada no boot. @type {string | null} */
let _hubSessionId = null;
// ─── Configuração ─────────────────────────────────────────────────────────────

const INJECT_PORT = Number(process.env.LLM_B_TERMINAL_PORT ?? 3009);

/** Timeout para aguardar resposta da LLM-B por turno (ms). */
const TURN_TIMEOUT_MS = Number(process.env.LLM_B_TURN_TIMEOUT ?? 120_000);

/**
 * Boot prompt padrão enviado à LLM-B ao iniciar o dialog loop. Pode ser sobrescrito pela variável de ambiente
 * `LLM_B_BOOT_PROMPT`.
 */
const DEFAULT_BOOT_PROMPT = `Você é a LLM-B — assistente técnico interno do projeto chatgpt-docker-puppeteer.

Contexto do projeto:
- Node.js 24+ ESM; arquitetura orientada a eventos via barramento NERV
- Camadas principais: kernel, driver, orchestrator, agent, infra, server, missions
- Você opera como agente contínuo de longa duração, nunca encerra sessões

Seu papel:
- Responder perguntas técnicas sobre o codebase, arquitetura e decisões de design
- Ajudar na análise de bugs, código e logs quando solicitado
- Colaborar criticamente com o desenvolvedor e com a LLM-A (seu parceiro de raciocínio)

Protocolo OBRIGATÓRIO de comunicação via ask_user:
1. Chame ask_user("READY: aguardando próxima mensagem") para sinalizar prontidão.
2. Ao receber uma mensagem, processe-a e formule uma resposta completa.
3. Chame ask_user("REPLY: " + sua_resposta) para enviar a resposta.
4. Retorne ao passo 1. NUNCA encerre o loop. Sempre use ask_user para comunicar.

Se receber "STOP_DIALOG", responda com ask_user("STOPPED") e então pode encerrar.`;

/** Boot prompt efetivo: env var sobrescreve o padrão. */
const BOOT_PROMPT = process.env.LLM_B_BOOT_PROMPT ?? DEFAULT_BOOT_PROMPT;

const BANNER = `
\x1b[36m╔══════════════════════════════════════════════════════════════════════════╗
║            Terminal LLM-B — Sessão Permanente Aberta                    ║
╚══════════════════════════════════════════════════════════════════════════╝\x1b[0m
  \x1b[33m/status\x1b[0m · \x1b[33m/history [n]\x1b[0m · \x1b[33m/db-history [n]\x1b[0m · \x1b[33m/db-sessions [n]\x1b[0m · \x1b[33m/who\x1b[0m · \x1b[33m/clear\x1b[0m · \x1b[33m/restart\x1b[0m
  \x1b[33m/remember [tag:] texto\x1b[0m · \x1b[33m/recall [tag]\x1b[0m · \x1b[33m/recall ?busca\x1b[0m · \x1b[33m/forget <id>\x1b[0m · \x1b[33m/count\x1b[0m
  \x1b[36m/gh issue list\x1b[0m · \x1b[36m/gh pr list\x1b[0m · \x1b[36m/gh run list\x1b[0m · \x1b[36m/git status\x1b[0m · \x1b[36m/git log\x1b[0m · \x1b[36m/alias\x1b[0m · \x1b[36m/help\x1b[0m
  \x1b[90mPOST :${INJECT_PORT}/inject  ·  POST :${INJECT_PORT}/pipeline  ·  GET :${INJECT_PORT}/events  ·  GET :${INJECT_PORT}/sessions  ·  POST/GET/DELETE :${INJECT_PORT}/memory\x1b[0m
  \x1b[90mGET :${INJECT_PORT}/gh/issues  ·  GET :${INJECT_PORT}/gh/prs  ·  GET :${INJECT_PORT}/gh/ci  ·  GET :${INJECT_PORT}/git/status  ·  GET :${INJECT_PORT}/git/log\x1b[0m
`;

const PROMPT_USER = '\x1b[32mvocê\x1b[0m\x1b[90m›\x1b[0m ';
const PROMPT_WAITING = '     ';

// ─── Estado global do terminal ────────────────────────────────────────────────

/** Mutex simples: evita dois turnos simultâneos. @type {boolean} */
let _busy = false;

/** Clientes SSE conectados ao endpoint GET /events (todos os eventos). @type {Set<import('node:http').ServerResponse>} */
const _sseClients = new Set();

/**
 * Clientes SSE que pedem apenas eventos críticos (?level=critical) — stalled, fatal, system. @type
 * {Set<import('node:http').ServerResponse>}
 */
const _sseCriticalClients = new Set();

/** Interface readline ativa. @type {readline.Interface | null} */
let _rl = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Escreve linha no stdout preservando o estado do prompt.
 *
 * @param {string} text - Texto a exibir
 * @returns {void}
 */
function println(text) {
    process.stdout.write(`\r${text}\n`);
}

/**
 * Exibe um turno completo (mensagem + resposta) com formatação visual limpa.
 *
 * @param {string} actor - Ator que enviou ('user' | 'llm-a')
 * @param {string} message - Mensagem enviada
 * @param {string} reply - Resposta da LLM-B
 * @param {number} durationMs - Duração da chamada em ms
 * @returns {void}
 */
function printExchange(actor, message, reply, durationMs) {
    const ts = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const secs = (durationMs / 1000).toFixed(1);

    // Cabeçalho do ator
    if (actor === 'llm-a') {
        println(`\n  🤖  \x1b[34mLLM-A\x1b[0m  \x1b[90m[${ts}]\x1b[0m`);
        println(`  ${message}`);
    }
    // (mensagens do usuário já visíveis no REPL — não repetimos)

    // Separador + resposta LLM-B
    println(`\n  🧠  \x1b[32mLLM-B\x1b[0m  \x1b[90m[${ts}] ${secs}s\x1b[0m`);

    // Exibe cada linha da resposta com recuo
    for (const line of reply.split('\n')) {
        println(`  ${line}`);
    }
    println('');
}

/**
 * Exibe snapshot de status do agente.
 *
 * @returns {void}
 */
function cmdStatus() {
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
  hub session     \x1b[90m${_hubSessionId ?? '(sem hub)'}\x1b[0m
  inject port     ${INJECT_PORT}
  ─────────────────────────────────────
`);
}

/**
 * Exibe o histórico de conversa local.
 *
 * @param {number} n - Número de pares a exibir
 * @returns {void}
 */
function cmdHistory(n = 10) {
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

// ─── Motor de diálogo ─────────────────────────────────────────────────────────

/**
 * Exibe o histórico de conversa persistido no SQLite Hub (sobrevive a restarts).
 *
 * @param {number} [n] - Número de turnos a exibir (padrão: 20)
 * @returns {void}
 */
function cmdDbHistory(n = 20) {
    if (!_hubSessionId) {
        println('\x1b[90m  /db-history: Hub session não disponível (sem persistência).\x1b[0m');
        return;
    }
    try {
        const turns = conversationStore.readTurns(_hubSessionId, { limit: n });
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
 * Lista as hub_sessions persistidas no DB (auditoria, P9).
 *
 * @param {number} [n] - Número de sessões a exibir (padrão: 10)
 * @returns {void}
 */
function cmdDbSessions(n = 10) {
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
            const isCurrent = s.id === _hubSessionId;
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

// ─── Comandos GitHub CLI ──────────────────────────────────────────────────────

/**
 * Handler do comando /gh <subcomando> [args…].
 *
 * Subcomandos: issue list [state] [label] — lista issues issue <n> — detalhes de uma issue issue create <title> — cria
 * issue (body vazio) issue close <n> — fecha issue issue comment <n> <texto> — comenta na issue pr list [state] — lista
 * pull requests pr <n> — detalhes de um PR pr diff <n> — diff de um PR run list [limit] — lista CI runs run <id> —
 * detalhes de um run release list — lista releases search <query> — busca issues/prs status — status geral da conta gh
 * api <endpoint> — chamada raw à gh api
 *
 * @param {string[]} args - argumentos após "/gh"
 * @returns {Promise<void>}
 */
async function cmdGh(args) {
    const sub = args[0]?.toLowerCase() ?? '';

    // ── issue ──────────────────────────────────────────────────────────────
    if (sub === 'issue' || sub === 'issues') {
        const action = args[1]?.toLowerCase() ?? 'list';

        if (action === 'list' || action === 'ls') {
            const stateArg = args[2] ?? 'open';
            const label = args[3];
            println('\x1b[90m  Buscando issues…\x1b[0m');
            const issues = await listIssues({ state: /** @type {any} */ (stateArg), label }).catch(() => []);
            if (!issues.length) {
                println('\x1b[90m  Nenhuma issue encontrada.\x1b[0m');
                return;
            }
            println(`\n  \x1b[36mIssues\x1b[0m \x1b[90m(${stateArg})\x1b[0m`);
            println(formatIssueList(issues));
            return;
        }

        if (action === 'create') {
            const title = args.slice(2).join(' ');
            if (!title) {
                println('\x1b[90m  Uso: /gh issue create <título>\x1b[0m');
                return;
            }
            println('\x1b[90m  Criando issue…\x1b[0m');
            const result = await createIssue(title, '').catch(() => null);
            if (result?.url) println(`\x1b[32m  ✓ Issue criada: ${result.url}\x1b[0m`);
            else println('\x1b[31m  Falha ao criar issue.\x1b[0m');
            return;
        }

        if (action === 'close') {
            const n = Number(args[2]);
            if (!n) {
                println('\x1b[90m  Uso: /gh issue close <número>\x1b[0m');
                return;
            }
            const ok = await closeIssue(n).catch(() => false);
            println(ok ? `\x1b[32m  ✓ Issue #${n} fechada.\x1b[0m` : `\x1b[31m  Falha ao fechar #${n}.\x1b[0m`);
            return;
        }

        if (action === 'comment') {
            const n = Number(args[2]);
            const body = args.slice(3).join(' ');
            if (!n || !body) {
                println('\x1b[90m  Uso: /gh issue comment <n> <texto>\x1b[0m');
                return;
            }
            const ok = await commentIssue(n, body).catch(() => false);
            println(ok ? `\x1b[32m  ✓ Comentário adicionado em #${n}.\x1b[0m` : `\x1b[31m  Falha ao comentar.\x1b[0m`);
            return;
        }

        // action é número — ver detalhes
        const n = Number(action);
        if (n) {
            println('\x1b[90m  Buscando issue…\x1b[0m');
            const issue = await viewIssue(n).catch(() => null);
            if (!issue) {
                println(`\x1b[31m  Issue #${n} não encontrada.\x1b[0m`);
                return;
            }
            println(
                `\n  \x1b[36m#${issue.number}\x1b[0m \x1b[1m${issue.title}\x1b[0m  \x1b[90m[${issue.state}]\x1b[0m`,
            );
            println(`  URL: \x1b[34m${issue.url}\x1b[0m`);
            if (issue.labels?.length) println(`  Labels: ${issue.labels.map((l) => l.name).join(', ')}`);
            println(`  Autor: ${issue.author?.login}  ·  Comentários: ${issue.comments}`);
            if (issue.body) {
                println('  ─────────────────────────────────────────────');
                for (const line of issue.body.slice(0, 800).split('\n')) println(`  ${line}`);
                if (issue.body.length > 800) println('  \x1b[90m…(truncado)\x1b[0m');
            }
            println('');
            return;
        }

        println('\x1b[90m  Uso: /gh issue [list|<n>|create|close|comment] [args…]\x1b[0m');
        return;
    }

    // ── pr ────────────────────────────────────────────────────────────────
    if (sub === 'pr' || sub === 'prs') {
        const action = args[1]?.toLowerCase() ?? 'list';

        if (action === 'list' || action === 'ls') {
            const stateArg = args[2] ?? 'open';
            println('\x1b[90m  Buscando PRs…\x1b[0m');
            const prs = await listPrs({ state: /** @type {any} */ (stateArg) }).catch(() => []);
            if (!prs.length) {
                println('\x1b[90m  Nenhum PR encontrado.\x1b[0m');
                return;
            }
            println(`\n  \x1b[36mPull Requests\x1b[0m \x1b[90m(${stateArg})\x1b[0m`);
            println(formatPrList(prs));
            return;
        }

        if (action === 'diff') {
            const n = Number(args[2]);
            if (!n) {
                println('\x1b[90m  Uso: /gh pr diff <número>\x1b[0m');
                return;
            }
            println('\x1b[90m  Buscando diff…\x1b[0m');
            const diff = await diffPr(n).catch(() => '');
            if (!diff) {
                println(`\x1b[90m  Sem diff para PR #${n}.\x1b[0m`);
                return;
            }
            // Exibe até 120 linhas
            const lines = diff.split('\n').slice(0, 120);
            for (const l of lines) {
                if (l.startsWith('+')) println(`\x1b[32m  ${l}\x1b[0m`);
                else if (l.startsWith('-')) println(`\x1b[31m  ${l}\x1b[0m`);
                else println(`  ${l}`);
            }
            if (diff.split('\n').length > 120) println('  \x1b[90m…(diff truncado a 120 linhas)\x1b[0m');
            return;
        }

        // action é número
        const n = Number(action);
        if (n) {
            println('\x1b[90m  Buscando PR…\x1b[0m');
            const pr = await viewPr(n).catch(() => null);
            if (!pr) {
                println(`\x1b[31m  PR #${n} não encontrado.\x1b[0m`);
                return;
            }
            const draftTag = pr.isDraft ? '\x1b[33m[DRAFT]\x1b[0m ' : '';
            println(
                `\n  \x1b[36m#${pr.number}\x1b[0m ${draftTag}\x1b[1m${pr.title}\x1b[0m  \x1b[90m[${pr.state}]\x1b[0m`,
            );
            println(`  Branch: ${pr.headRefName}  ·  Autor: ${pr.author?.login}`);
            println(`  URL: \x1b[34m${pr.url}\x1b[0m`);
            if (pr.body) {
                println('  ─────────────────────────────────────────────');
                for (const line of pr.body.slice(0, 600).split('\n')) println(`  ${line}`);
            }
            println('');
            return;
        }

        println('\x1b[90m  Uso: /gh pr [list|<n>|diff <n>] [args…]\x1b[0m');
        return;
    }

    // ── run / ci ──────────────────────────────────────────────────────────
    if (sub === 'run' || sub === 'runs' || sub === 'ci') {
        const action = args[1]?.toLowerCase() ?? 'list';

        if (action === 'list' || action === 'ls') {
            const limit = Number(args[2]) || 10;
            println('\x1b[90m  Buscando CI runs…\x1b[0m');
            const runs = await listRuns({ limit }).catch(() => []);
            if (!runs.length) {
                println('\x1b[90m  Nenhum run encontrado.\x1b[0m');
                return;
            }
            println('\n  \x1b[36mCI Runs\x1b[0m');
            println(formatRunList(runs));
            return;
        }

        const runId = action;
        if (runId && runId !== 'list') {
            println('\x1b[90m  Buscando run…\x1b[0m');
            const run = /** @type {any} */ (await viewRun(runId).catch(() => null));
            if (!run) {
                println(`\x1b[31m  Run "${runId}" não encontrado.\x1b[0m`);
                return;
            }
            println(`\n  \x1b[36mRun #${run.databaseId ?? runId}\x1b[0m  ${run.displayTitle ?? run.name}`);
            println(`  Status: ${run.status}  ·  Conclusão: ${run.conclusion ?? '…'}`);
            println(`  Branch: ${run.headBranch}  ·  Workflow: ${run.workflowName}`);
            println(`  URL: \x1b[34m${run.url}\x1b[0m`);
            println('');
            return;
        }

        println('\x1b[90m  Uso: /gh run [list|<runId>]\x1b[0m');
        return;
    }

    // ── release ───────────────────────────────────────────────────────────
    if (sub === 'release' || sub === 'releases') {
        println('\x1b[90m  Buscando releases…\x1b[0m');
        const releases = await listReleases().catch(() => []);
        if (!releases.length) {
            println('\x1b[90m  Nenhuma release encontrada.\x1b[0m');
            return;
        }
        println('\n  \x1b[36mReleases\x1b[0m');
        println(formatReleaseList(releases));
        return;
    }

    // ── search ────────────────────────────────────────────────────────────
    if (sub === 'search') {
        const query = args.slice(1).join(' ');
        if (!query) {
            println('\x1b[90m  Uso: /gh search <query>\x1b[0m');
            return;
        }
        println('\x1b[90m  Buscando…\x1b[0m');
        const results = await searchIssues(query, { limit: 10 }).catch(() => []);
        if (!results.length) {
            println('\x1b[90m  Nenhum resultado.\x1b[0m');
            return;
        }
        println(`\n  \x1b[36mResultados para:\x1b[0m "${query}"`);
        for (const r of /** @type {any[]} */ (results)) {
            const typeLabel = r.isPullRequest ? '\x1b[34mPR\x1b[0m' : '\x1b[36missue\x1b[0m';
            println(`  ${typeLabel}  #${r.number}  ${r.title}  \x1b[90m[${r.state}]\x1b[0m`);
        }
        println('');
        return;
    }

    // ── status ────────────────────────────────────────────────────────────
    if (sub === 'status' || sub === 'st') {
        println('\x1b[90m  Verificando status gh…\x1b[0m');
        const status = await ghGetStatus().catch(() => null);
        if (!status) {
            println('\x1b[90m  Status gh não disponível.\x1b[0m');
            return;
        }
        println(`\n  \x1b[36mGitHub Status\x1b[0m\n  ${status}\n`);
        return;
    }

    // ── api ───────────────────────────────────────────────────────────────
    if (sub === 'api') {
        const endpoint = args[1];
        if (!endpoint) {
            println('\x1b[90m  Uso: /gh api <endpoint>  ex: /gh api /user\x1b[0m');
            return;
        }
        println('\x1b[90m  Chamando gh api…\x1b[0m');
        const data = await ghRawApi(endpoint).catch(() => null);
        if (data === null) {
            println('\x1b[31m  Falha na chamada a gh api.\x1b[0m');
            return;
        }
        const out = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        for (const line of out.split('\n').slice(0, 80)) println(`  ${line}`);
        if (out.split('\n').length > 80) println('  \x1b[90m…(truncado)\x1b[0m');
        return;
    }

    // ── help ──────────────────────────────────────────────────────────────
    println(`
  \x1b[36m/gh — GitHub CLI\x1b[0m
  ─────────────────────────────────────────────────────────────────
  \x1b[33m/gh issue list [open|closed|all] [label]\x1b[0m  — lista issues
  \x1b[33m/gh issue <n>\x1b[0m                             — detalhe de issue
  \x1b[33m/gh issue create <título>\x1b[0m                 — cria issue
  \x1b[33m/gh issue close <n>\x1b[0m                       — fecha issue
  \x1b[33m/gh issue comment <n> <texto>\x1b[0m             — comenta issue
  \x1b[33m/gh pr list [open|closed|merged]\x1b[0m          — lista PRs
  \x1b[33m/gh pr <n>\x1b[0m                                — detalhe de PR
  \x1b[33m/gh pr diff <n>\x1b[0m                           — diff de PR
  \x1b[33m/gh run list [limit]\x1b[0m                      — lista CI runs
  \x1b[33m/gh run <id>\x1b[0m                              — detalhe de run
  \x1b[33m/gh release list\x1b[0m                          — lista releases
  \x1b[33m/gh search <query>\x1b[0m                        — busca issues/prs
  \x1b[33m/gh status\x1b[0m                                — status geral da conta
  \x1b[33m/gh api <endpoint>\x1b[0m                        — chamada raw à API
  ─────────────────────────────────────────────────────────────────
`);
}

// ─── Comandos Git CLI ─────────────────────────────────────────────────────────

/**
 * Handler do comando /git <subcomando> [args…].
 *
 * Subcomandos: status — arquivos modificados/staged log [n] — últimos N commits log --oneline [n]— log compacto diff
 * [--staged] [arquivo] branch — lista branches pull — git pull stash — git stash (sem args = push) stash list — lista
 * stashes
 *
 * @param {string[]} args - argumentos após "/git"
 * @returns {Promise<void>}
 */
async function cmdGit(args) {
    const sub = args[0]?.toLowerCase() ?? '';

    if (sub === 'status' || sub === 'st' || sub === '') {
        println('\x1b[90m  Verificando status git…\x1b[0m');
        const entries = await gitStatus().catch(() => []);
        println('\n  \x1b[36mGit Status\x1b[0m');
        println(formatStatus(entries));
        println('');
        return;
    }

    if (sub === 'log') {
        const oneline = args.includes('--oneline') || args.includes('-1');
        const nArg = args.find((a) => /^\d+$/.test(a));
        const n = nArg ? Number(nArg) : 15;
        println('\x1b[90m  Buscando log…\x1b[0m');
        const entries = await gitLog({ n, oneline }).catch(() => []);
        println(`\n  \x1b[36mGit Log\x1b[0m \x1b[90m(últimos ${entries.length} commits)\x1b[0m`);
        println(formatLog(entries, oneline));
        println('');
        return;
    }

    if (sub === 'diff') {
        const staged = args.includes('--staged') || args.includes('--cached');
        const file = args.find((a) => !a.startsWith('-') && a !== 'diff');
        println('\x1b[90m  Gerando diff…\x1b[0m');
        const diff = await gitDiff({ staged, file }).catch(() => '');
        if (!diff) {
            println('\x1b[90m  Sem diferenças.\x1b[0m');
            return;
        }
        const lines = diff.split('\n').slice(0, 150);
        for (const l of lines) {
            if (l.startsWith('+') && !l.startsWith('+++')) println(`\x1b[32m  ${l}\x1b[0m`);
            else if (l.startsWith('-') && !l.startsWith('---')) println(`\x1b[31m  ${l}\x1b[0m`);
            else if (l.startsWith('@@')) println(`\x1b[36m  ${l}\x1b[0m`);
            else println(`  ${l}`);
        }
        if (diff.split('\n').length > 150) println('\x1b[90m  …(truncado a 150 linhas)\x1b[0m');
        return;
    }

    if (sub === 'branch' || sub === 'branches') {
        println('\x1b[90m  Buscando branches…\x1b[0m');
        const branches = await gitBranch().catch(() => []);
        println('\n  \x1b[36mGit Branch\x1b[0m');
        println(formatBranch(branches));
        println('');
        return;
    }

    if (sub === 'pull') {
        println('\x1b[90m  Executando git pull…\x1b[0m');
        const output = await gitPull().catch((e) => `Erro: ${e.message}`);
        println(output.startsWith('Erro') ? `\x1b[31m  ✗ ${output}\x1b[0m` : `\x1b[32m  ✓ ${output || 'ok'}\x1b[0m`);
        return;
    }

    if (sub === 'stash') {
        const stashSub = args[1]?.toLowerCase() ?? 'push';
        if (stashSub === 'list') {
            const stashOut = await gitStashList().catch(() => '');
            if (!stashOut) {
                println('\x1b[90m  Nenhum stash encontrado.\x1b[0m');
                return;
            }
            println('\n  \x1b[36mGit Stash List\x1b[0m');
            for (const s of stashOut.split('\n').filter(Boolean)) println(`  ${s}`);
            println('');
            return;
        }
        const stashOut2 = await gitStash({ pop: stashSub === 'pop' }).catch((e) => `Erro: ${e.message}`);
        println(
            stashOut2.startsWith('Erro')
                ? `\x1b[31m  ✗ ${stashOut2}\x1b[0m`
                : `\x1b[32m  ✓ ${stashOut2 || 'ok'}\x1b[0m`,
        );
        return;
    }

    // help / fallback
    println(`
  \x1b[36m/git — Git CLI\x1b[0m
  ─────────────────────────────────────────────────
  \x1b[33m/git status\x1b[0m                    — status do working tree
  \x1b[33m/git log [n] [--oneline]\x1b[0m       — log de commits
  \x1b[33m/git diff [--staged] [file]\x1b[0m    — diff
  \x1b[33m/git branch\x1b[0m                    — branches
  \x1b[33m/git pull\x1b[0m                      — git pull
  \x1b[33m/git stash [list|pop|drop]\x1b[0m     — stash
  ─────────────────────────────────────────────────
`);
}

// ─── Comando Alias ────────────────────────────────────────────────────────────

/**
 * Handler do comando /alias [set|remove|reset|list].
 *
 * @param {string[]} args
 * @returns {void}
 */
function cmdAlias(args) {
    const action = args[0]?.toLowerCase() ?? 'list';

    if (action === 'list' || action === '') {
        println('\n  \x1b[36mAliases\x1b[0m');
        println(formatAliases());
        println('');
        return;
    }

    if (action === 'set') {
        const name = args[1];
        const expansion = args.slice(2).join(' ');
        if (!name || !expansion) {
            println('\x1b[90m  Uso: /alias set <nome> <comando>   ex: /alias set /myissues /gh issue list\x1b[0m');
            return;
        }
        setAlias(name.startsWith('/') ? name : `/${name}`, expansion);
        println(`\x1b[32m  ✓ Alias definido: ${name} → ${expansion}\x1b[0m`);
        return;
    }

    if (action === 'remove' || action === 'rm' || action === 'delete') {
        const name = args[1];
        if (!name) {
            println('\x1b[90m  Uso: /alias remove <nome>\x1b[0m');
            return;
        }
        const ok = removeAlias(name.startsWith('/') ? name : `/${name}`);
        println(ok ? `\x1b[32m  ✓ Alias removido: ${name}\x1b[0m` : `\x1b[33m  Alias não encontrado: ${name}\x1b[0m`);
        return;
    }

    println('\x1b[90m  Uso: /alias [list|set <nome> <cmd>|remove <nome>]\x1b[0m');
}

// ─── Comando Help ─────────────────────────────────────────────────────────────

/**
 * Exibe ajuda completa do terminal.
 *
 * @returns {void}
 */
function cmdHelp() {
    println(`
  \x1b[36m╔═══════════════════════ Terminal LLM-B — Ajuda ═══════════════════════╗\x1b[0m

  \x1b[1mComandos de Sessão\x1b[0m
  \x1b[33m/status\x1b[0m                              — status do agente LLM-B
  \x1b[33m/history [n]\x1b[0m                         — últimos N turnos em memória
  \x1b[33m/db-history [n]\x1b[0m                      — últimos N turnos (SQLite)
  \x1b[33m/db-sessions [n]\x1b[0m                     — últimas N sessões hub
  \x1b[33m/who\x1b[0m                                 — atores e canais ativos
  \x1b[33m/count\x1b[0m                               — estatísticas da sessão
  \x1b[33m/clear\x1b[0m                               — limpa histórico em memória
  \x1b[33m/restart\x1b[0m                             — reinicia dialog loop
  \x1b[33m/quit\x1b[0m / \x1b[33m/exit\x1b[0m                         — encerra terminal

  \x1b[1mMemória Semântica\x1b[0m
  \x1b[33m/remember [tag:] texto\x1b[0m               — persiste memória
  \x1b[33m/recall [tag]\x1b[0m                        — recupera por tag
  \x1b[33m/recall ?busca\x1b[0m                       — busca full-text
  \x1b[33m/forget <id>\x1b[0m                         — remove memória por ID

  \x1b[1mGitHub CLI (/gh)\x1b[0m
  \x1b[33m/gh issue list\x1b[0m                       — listar issues (aliases: /issues)
  \x1b[33m/gh issue <n>\x1b[0m                        — detalhe de issue
  \x1b[33m/gh issue create <título>\x1b[0m            — criar issue
  \x1b[33m/gh issue close <n>\x1b[0m                  — fechar issue
  \x1b[33m/gh issue comment <n> <txt>\x1b[0m          — comentar issue
  \x1b[33m/gh pr list\x1b[0m                          — listar PRs (alias: /prs)
  \x1b[33m/gh pr <n>\x1b[0m                           — detalhe de PR
  \x1b[33m/gh pr diff <n>\x1b[0m                      — diff de PR
  \x1b[33m/gh run list\x1b[0m                         — listar CI runs (alias: /runs, /ci)
  \x1b[33m/gh run <id>\x1b[0m                         — detalhe de run
  \x1b[33m/gh release list\x1b[0m                     — listar releases
  \x1b[33m/gh search <query>\x1b[0m                   — buscar issues/prs
  \x1b[33m/gh status\x1b[0m                           — status da conta GitHub
  \x1b[33m/gh api <endpoint>\x1b[0m                   — chamada raw à API

  \x1b[1mGit CLI (/git)\x1b[0m
  \x1b[33m/git status\x1b[0m                          — status working tree (alias: /st, /gst)
  \x1b[33m/git log [n] [--oneline]\x1b[0m             — log de commits (alias: /log, /glog)
  \x1b[33m/git diff [--staged] [file]\x1b[0m          — diff (alias: /diff)
  \x1b[33m/git branch\x1b[0m                          — branches
  \x1b[33m/git pull\x1b[0m                            — git pull
  \x1b[33m/git stash [list|pop|drop]\x1b[0m           — stash

  \x1b[1mAliases\x1b[0m
  \x1b[33m/alias\x1b[0m / \x1b[33m/alias list\x1b[0m                — listar aliases
  \x1b[33m/alias set <nome> <cmd>\x1b[0m              — criar alias
  \x1b[33m/alias remove <nome>\x1b[0m                 — remover alias

  \x1b[1mHTTP Endpoints\x1b[0m  \x1b[90m(porta ${INJECT_PORT})\x1b[0m
  \x1b[33mPOST /inject\x1b[0m  \x1b[33mPOST /pipeline\x1b[0m  \x1b[33mGET /events\x1b[0m
  \x1b[33mGET /sessions\x1b[0m  \x1b[33mPOST|GET|DELETE /memory\x1b[0m
  \x1b[33mGET /gh/issues\x1b[0m  \x1b[33mGET /gh/prs\x1b[0m  \x1b[33mGET /gh/ci\x1b[0m
  \x1b[33mGET /git/status\x1b[0m  \x1b[33mGET /git/log\x1b[0m

  \x1b[90mTipo qualquer coisa sem /  para enviar mensagem à LLM-B\x1b[0m
  \x1b[36m╚═══════════════════════════════════════════════════════════════════════╝\x1b[0m
`);
}

// ─── Motor de diálogo ─────────────────────────────────────────────────────────

/**
 * Garante que o dialog loop está ativo. Se não estiver, inicia-o.
 *
 * @returns {Promise<void>}
 */
async function ensureDialogLoop() {
    if (alwaysAliveAgent.dialogLoopActive) {
        return;
    }

    const status = alwaysAliveAgent.status;
    if (status === 'stopped') {
        println('\x1b[90m  Iniciando AlwaysAliveAgent…\x1b[0m');
        await alwaysAliveAgent.start();
        // Aguarda idle
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout aguardando idle')), 30_000);
            const check = () => {
                if (alwaysAliveAgent.status === 'idle') {
                    clearTimeout(timeout);
                    resolve(undefined);
                } else {
                    setTimeout(check, 500);
                }
            };
            check();
        });
    }

    println('\x1b[90m  Conectando ao agente…\x1b[0m');
    await llmBridgeClient.startDialogMode(BOOT_PROMPT ?? undefined, {
        onReady: () => println('\n  \x1b[32m●\x1b[0m  LLM-B pronta — pode começar\n'),
    });
}

/**
 * Envia um turno de diálogo para a LLM-B e exibe a resposta.
 *
 * @param {string} message - Mensagem a enviar
 * @param {string} [actor] - Quem está enviando ('user' | 'llm-a')
 * @returns {Promise<string | null>} Resposta da LLM-B, ou null se busy
 */
async function sendTurn(message, actor = 'user') {
    if (_busy) {
        println('\x1b[33m  ⏳ Aguarde — LLM-B está processando...\x1b[0m');
        return null;
    }
    _busy = true;
    if (_rl) {
        process.stdout.write(`\x1b[90m  …\x1b[0m`);
        _rl.setPrompt(PROMPT_WAITING);
    }

    const t0 = Date.now();
    try {
        await ensureDialogLoop();
        const reply = await llmBridgeClient.dialogTurn(message, { timeout: TURN_TIMEOUT_MS });
        const durationMs = Date.now() - t0;
        printExchange(actor, message, reply, durationMs);
        log('INFO', `[TerminalServer] Turno ${actor} concluído em ${durationMs}ms`);

        // Persistir no ConversationHub (best-effort)
        if (_hubSessionId) {
            try {
                /** @type {'user' | 'llm_a'} */
                const senderRole = actor === 'llm-a' ? 'llm_a' : 'user';
                conversationStore.writeTurn(_hubSessionId, { role: senderRole, content: message });
                conversationStore.writeTurn(_hubSessionId, { role: 'llm_b', content: reply, durationMs });
            } catch (/** @type {any} */ hubErr) {
                log('WARN', `[TerminalServer] Hub writeTurn falhou: ${hubErr.message}`);
            }
        }

        return reply;
    } catch (/** @type {any} */ e) {
        println(`[erro] ${e.message}`);
        log('ERROR', `[TerminalServer] Erro no turno ${actor}: ${e.message}`);
        return null;
    } finally {
        _busy = false;
        if (_rl) {
            _rl.setPrompt(PROMPT_USER);
            _rl.prompt();
        }
    }
}

// ─── Servidor HTTP de injeção ─────────────────────────────────────────────────

/** Eventos considerados críticos para clientes em modo ?level=critical. */
const CRITICAL_EVENTS = new Set(['stalled', 'fatal', 'system']);

/**
 * Transmite um evento SSE para todos os clientes conectados ao endpoint GET /events. Clientes em modo `?level=critical`
 * recebem apenas eventos em CRITICAL_EVENTS.
 *
 * @param {string} event - Tipo do evento (ex: 'reply', 'ready', 'stalled')
 * @param {object} data - Payload JSON serializável
 * @returns {void}
 */
function broadcastSse(event, data) {
    if (_sseClients.size === 0 && _sseCriticalClients.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of _sseClients) {
        try {
            client.write(payload);
        } catch {
            _sseClients.delete(client);
        }
    }
    if (CRITICAL_EVENTS.has(event)) {
        for (const client of _sseCriticalClients) {
            try {
                client.write(payload);
            } catch {
                _sseCriticalClients.delete(client);
            }
        }
    }
}

/**
 * Cria HTTP server interno para injeção de mensagens de LLM-A.
 *
 * Endpoint: POST /inject Body JSON: { "message": "...", "from": "llm-a" } Resposta: { "reply": "...", "durationMs":
 * 123, "ok": true }
 *
 * @returns {http.Server} Servidor HTTP iniciado
 */
function createInjectServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost:${INJECT_PORT}`);

        // Health check
        if (req.method === 'GET' && url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
                JSON.stringify({
                    ok: true,
                    dialogLoopActive: alwaysAliveAgent.dialogLoopActive,
                    agentStatus: alwaysAliveAgent.status,
                    busy: _busy,
                    hubSessionId: _hubSessionId,
                    sseClients: _sseClients.size,
                }),
            );
            return;
        }

        // Canal de subscrição LLM-A: SSE — ouve respostas da LLM-B em tempo real
        // GET /events           → stream completo: "reply", "ready", "stalled", "system"
        // GET /events?level=critical → apenas eventos críticos: "stalled", "fatal", "system"
        if (req.method === 'GET' && url.pathname === '/events') {
            const isCriticalOnly = url.searchParams.get('level') === 'critical';
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
                'Access-Control-Allow-Origin': '*',
            });
            res.write(`: connected (level=${isCriticalOnly ? 'critical' : 'all'})\n\n`);
            if (isCriticalOnly) {
                _sseCriticalClients.add(res);
                req.on('close', () => _sseCriticalClients.delete(res));
            } else {
                _sseClients.add(res);
                req.on('close', () => _sseClients.delete(res));
            }
            return;
        }

        // P9: Lista hub_sessions — auditoria
        // GET /sessions → JSON array de sessions persistidas
        if (req.method === 'GET' && url.pathname === '/sessions') {
            try {
                const limit = Number(url.searchParams.get('limit') ?? '20');
                const offset = Number(url.searchParams.get('offset') ?? '0');
                const status = url.searchParams.get('status') ?? undefined;
                const sessions = conversationStore.listHubSessions({
                    limit: isNaN(limit) ? 20 : limit,
                    offset: isNaN(offset) ? 0 : offset,
                    status: /** @type {any} */ (status),
                });
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ ok: true, sessions, current: _hubSessionId }));
            } catch (/** @type {any} */ e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: e.message }));
            }
            return;
        }

        // P9: Turnos de uma sessão específica — via REST
        // GET /sessions/:id/turns → JSON array de turns
        if (req.method === 'GET' && /^\/sessions\/[^/]+\/turns$/.test(url.pathname)) {
            const sessionId = url.pathname.split('/')[2] ?? '';
            try {
                const limit = Number(url.searchParams.get('limit') ?? '50');
                const offset = Number(url.searchParams.get('offset') ?? '0');
                const turns = conversationStore.readTurns(sessionId, {
                    limit: isNaN(limit) ? 50 : limit,
                    offset: isNaN(offset) ? 0 : offset,
                });
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ ok: true, turns, sessionId }));
            } catch (/** @type {any} */ e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: e.message }));
            }
            return;
        }

        // P5: Memória semântica
        // POST /memory  Body: { tag?: string; content: string }
        // GET  /memory?tag=X&search=X&limit=N
        if (req.method === 'POST' && url.pathname === '/memory') {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', () => {
                try {
                    const parsed = /** @type {{ tag?: string; content?: string }} */ (JSON.parse(body));
                    if (!parsed.content) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: '"content" obrigatório' }));
                        return;
                    }
                    const id = conversationStore.storeMemory({
                        content: parsed.content,
                        tag: parsed.tag ?? 'geral',
                        ...(_hubSessionId ? { hubSessionId: _hubSessionId } : {}),
                    });
                    res.writeHead(201, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, id }));
                } catch (/** @type {any} */ e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                }
            });
            return;
        }

        if (req.method === 'GET' && url.pathname === '/memory') {
            try {
                const tagParam = url.searchParams.get('tag');
                const searchParam = url.searchParams.get('search');
                const limitParam = Number(url.searchParams.get('limit') ?? '20');
                const memories = conversationStore.recallMemories({
                    ...(tagParam ? { tag: tagParam } : {}),
                    ...(searchParam ? { search: searchParam } : {}),
                    limit: isNaN(limitParam) ? 20 : limitParam,
                });
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ ok: true, memories }));
            } catch (/** @type {any} */ e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: e.message }));
            }
            return;
        }

        // DELETE /memory/:id  — remove uma memória semântica pelo id
        if (req.method === 'DELETE' && /^\/memory\/[^/]+$/.test(url.pathname)) {
            const memoryId = url.pathname.split('/')[2] ?? '';
            try {
                const deleted = conversationStore.deleteMemory(memoryId);
                res.writeHead(deleted ? 200 : 404, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                });
                res.end(JSON.stringify({ ok: deleted, id: memoryId }));
            } catch (/** @type {any} */ e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: e.message }));
            }
            return;
        }

        // P6: Pipeline orchestration — executa uma sequência ordenada de mensagens para LLM-B
        // POST /pipeline  Body: { steps: [{ prompt: string; waitMs?: number; from?: string }]; from?: string }
        // Resposta: { ok: true; results: [{ step: number; prompt: string; reply: string; durationMs: number }] }
        if (req.method === 'POST' && url.pathname === '/pipeline') {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', async () => {
                /** @type {{ steps?: { prompt: string; waitMs?: number; from?: string }[]; from?: string } | null} */
                let parsed;
                try {
                    parsed = JSON.parse(body);
                } catch {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'JSON inválido' }));
                    return;
                }

                if (!Array.isArray(parsed?.steps) || parsed.steps.length === 0) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: '"steps" deve ser um array não vazio' }));
                    return;
                }

                const globalFrom = parsed.from ?? 'llm-a';
                const results = [];

                for (let i = 0; i < parsed.steps.length; i++) {
                    const step = parsed.steps[i];
                    if (!step?.prompt) continue;
                    const from = step.from ?? globalFrom;

                    if (step.waitMs && step.waitMs > 0) {
                        await new Promise((r) => setTimeout(r, step.waitMs));
                    }

                    const t0 = Date.now();
                    const reply = await sendTurn(step.prompt, from).catch(() => null);
                    results.push({
                        step: i + 1,
                        prompt: step.prompt,
                        reply: reply ?? null,
                        durationMs: Date.now() - t0,
                    });

                    // Se reply for null (busy), abortar pipeline
                    if (reply === null) {
                        res.writeHead(409, { 'Content-Type': 'application/json' });
                        res.end(
                            JSON.stringify({
                                ok: false,
                                error: `Step ${i + 1} retornou null (LLM-B ocupada) — pipeline interrompido`,
                                results,
                            }),
                        );
                        return;
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, results }));
            });
            return;
        }

        // Injeção de mensagem
        if (req.method === 'POST' && url.pathname === '/inject') {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', () => {
                /** @type {{ message?: string; from?: string } | null} */
                let parsed = null;
                try {
                    parsed = /** @type {{ message?: string; from?: string }} */ (JSON.parse(body));
                } catch {
                    /* JSON inválido tratado abaixo */
                }
                if (!parsed) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'JSON inválido' }));
                    return;
                }

                const message = parsed.message?.trim();
                const from = parsed.from ?? 'llm-a';

                if (!message) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: '"message" é obrigatório' }));
                    return;
                }

                const t0 = Date.now();
                sendTurn(message, from)
                    .then((reply) => {
                        res.writeHead(reply !== null ? 200 : 409, { 'Content-Type': 'application/json' });
                        res.end(
                            JSON.stringify({
                                ok: reply !== null,
                                reply: reply ?? null,
                                durationMs: Date.now() - t0,
                                from,
                            }),
                        );
                    })
                    .catch((/** @type {any} */ e) => {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: e.message }));
                    });
                return;
            });
            return;
        }

        // ── GET /gh/issues ────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/gh/issues') {
            const state = url.searchParams.get('state') ?? 'open';
            const limit = Number(url.searchParams.get('limit') ?? '15');
            listIssues({ state: /** @type {any} */ (state), limit })
                .then((issues) => {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ ok: true, issues }));
                })
                .catch((/** @type {any} */ e) => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                });
            return;
        }

        // ── GET /gh/prs ───────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/gh/prs') {
            const state = url.searchParams.get('state') ?? 'open';
            const limit = Number(url.searchParams.get('limit') ?? '15');
            listPrs({ state: /** @type {any} */ (state), limit })
                .then((prs) => {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ ok: true, prs }));
                })
                .catch((/** @type {any} */ e) => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                });
            return;
        }

        // ── GET /gh/ci ────────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/gh/ci') {
            const limit = Number(url.searchParams.get('limit') ?? '15');
            listRuns({ limit })
                .then((runs) => {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ ok: true, runs }));
                })
                .catch((/** @type {any} */ e) => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                });
            return;
        }

        // ── GET /git/status ───────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/git/status') {
            gitStatus()
                .then((entries) => {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ ok: true, entries }));
                })
                .catch((/** @type {any} */ e) => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                });
            return;
        }

        // ── GET /git/log ──────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/git/log') {
            const n = Number(url.searchParams.get('n') ?? '20');
            gitLog({ n })
                .then((entries) => {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ ok: true, entries }));
                })
                .catch((/** @type {any} */ e) => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                });
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Not found' }));
    });

    server.listen(INJECT_PORT, '127.0.0.1', () => {
        log('INFO', `[TerminalServer] Inject server ativo em http://127.0.0.1:${INJECT_PORT}`);
        println(`[inject] Servidor de injeção ativo em http://127.0.0.1:${INJECT_PORT}`);
    });

    server.on('error', (/** @type {any} */ e) => {
        log('ERROR', `[TerminalServer] Inject server erro: ${e.message}`);
        println(`[inject] Erro no servidor de injeção: ${e.message}`);
    });

    return server;
}

// ─── REPL readline ────────────────────────────────────────────────────────────

/**
 * Registra listeners de eventos do AlwaysAliveAgent para exibição no terminal.
 *
 * @param {readline.Interface} rl - Interface readline ativa
 * @returns {() => void} Função de cleanup
 */
function setupAgentListeners(rl) {
    const onQuestion = (/** @type {any} */ evt) => {
        const q = /** @type {string} */ (evt?.question ?? '');
        const choices = /** @type {string[]} */ (evt?.choices ?? []);

        // Filtra mensagens internas do protocolo dialog loop (READY:/REPLY:/DONE:/STOPPED)
        // O usuário nunca precisa interagir com elas — são tratadas automaticamente.
        if (/^(READY[:\s]|REPLY[:\s]|DONE[:\s]|STOPPED|STOP_DIALOG)/i.test(q.trim())) {
            return;
        }

        // Pergunta real do LLM-B (fora do protocolo READY/REPLY)
        rl.pause();
        println(`\n⚡ LLM-B perguntou: "${q}"`);
        if (choices.length > 0) {
            println(`   Opções: ${choices.join(' | ')}`);
        }
        println('   → Responda digitando normalmente. Sua próxima mensagem será a resposta.');
        rl.resume();
        rl.prompt();
    };

    const onStopped = () => {
        println('[llm-b] ⚠️  Agente parado. Use /restart para reiniciar.');
    };

    alwaysAliveAgent.on('question.pending', onQuestion);
    alwaysAliveAgent.once('stopped', onStopped);

    return () => {
        alwaysAliveAgent.off('question.pending', onQuestion);
        alwaysAliveAgent.off('stopped', onStopped);
    };
}

/**
 * Inicia o REPL readline do terminal permanente.
 *
 * @param {http.Server} injectServer - Servidor HTTP de injeção (para fechar no /quit)
 * @returns {Promise<void>}
 */
async function startRepl(injectServer) {
    // Modo headless: stdin não é um TTY (background, PM2 stdin:false, /dev/null)
    // Neste caso, não criamos readline e usamos apenas o inject server HTTP.
    if (!process.stdin.isTTY) {
        println('[boot] Modo headless detectado — REPL desativado. Use POST :' + INJECT_PORT + '/inject.');
        await ensureDialogLoop();
        // O inject server mantém o event loop ativo indefinidamente
        return;
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        prompt: PROMPT_USER,
    });
    _rl = rl;

    const cleanup = setupAgentListeners(rl);

    println(BANNER);
    println('\x1b[90m  Iniciando sessão com LLM-B…\x1b[0m');

    try {
        await ensureDialogLoop();
    } catch (/** @type {any} */ e) {
        println(`\x1b[31m  [erro de boot] ${e.message}\x1b[0m`);
        log('ERROR', `[TerminalServer] Boot error: ${e.message}`);
    }

    rl.prompt();

    rl.on('line', async (line) => {
        const trimmed = line.trim();
        if (!trimmed) {
            rl.prompt();
            return;
        }

        // Comandos especiais
        if (trimmed.startsWith('/')) {
            // Resolve aliases antes do dispatch (ex: /st → /git status)
            const resolved = resolve(trimmed);
            const [cmd, ...rest] = resolved.slice(1).split(' ');
            const arg = rest.join(' ');

            switch (cmd?.toLowerCase()) {
                case 'status':
                    cmdStatus();
                    break;
                case 'history': {
                    const n = Number(arg) || 10;
                    cmdHistory(n);
                    break;
                }
                case 'db-history': {
                    const n = Number(arg) || 20;
                    cmdDbHistory(n);
                    break;
                }
                case 'db-sessions': {
                    const n = Number(arg) || 10;
                    cmdDbSessions(n);
                    break;
                }
                case 'remember': {
                    // /remember [tag:] conteúdo
                    const match = arg.match(/^([a-z0-9_-]+):\s*(.+)$/i);
                    const tag = match ? (match[1] ?? 'geral') : 'geral';
                    const content = match ? (match[2] ?? '').trim() : arg.trim();
                    if (!content) {
                        println('\x1b[90m  Uso: /remember [tag:] conteúdo\x1b[0m');
                    } else {
                        const id = conversationStore.storeMemory({
                            tag,
                            content,
                            ...(_hubSessionId ? { hubSessionId: _hubSessionId } : {}),
                        });
                        println(`\x1b[32m  ✓ Memória salva\x1b[0m \x1b[90m[${tag}] ${id.slice(0, 8)}…\x1b[0m`);
                    }
                    break;
                }
                case 'recall': {
                    // /recall [tag] ou /recall ?busca textual
                    const isSearch = arg.startsWith('?');
                    const memories = conversationStore.recallMemories({
                        ...(isSearch ? { search: arg.slice(1).trim() } : arg ? { tag: arg } : {}),
                        limit: 10,
                    });
                    if (memories.length === 0) {
                        println('\x1b[90m  Nenhuma memória encontrada.\x1b[0m');
                    } else {
                        println(`\n  \x1b[36mMemórias\x1b[0m ${arg ? `[${arg}]` : '(todas)'}`);
                        println('  ─────────────────────────────────────────────');
                        for (const m of memories) {
                            const ts = new Date(m.created_at).toLocaleString('pt-BR');
                            println(`  \x1b[90m[${ts}]\x1b[0m \x1b[33m${m.tag}\x1b[0m  ${m.content}`);
                        }
                        println('  ─────────────────────────────────────────────\n');
                    }
                    break;
                }
                case 'who':
                    println(`
  \x1b[36mAtores ativos nesta sessão:\x1b[0m
  👤  \x1b[32mVocê\x1b[0m          — stdin (digitar diretamente aqui)
  🤖  \x1b[34mLLM-A\x1b[0m         — POST http://localhost:${INJECT_PORT}/inject
  🧠  \x1b[35mLLM-B\x1b[0m         — AlwaysAliveAgent (GPT-4.1 Copilot SDK)
  📡  \x1b[90mSSE stream\x1b[0m    — GET  http://localhost:${INJECT_PORT}/events
`);
                    break;
                case 'clear':
                    llmBridgeClient.clearHistory();
                    println('\x1b[90m  Histórico em memória limpo.\x1b[0m');
                    break;
                case 'answer': {
                    const ok = alwaysAliveAgent.answerPendingQuestion(arg);
                    println(ok ? `[answer] Resposta enviada: "${arg}"` : '[answer] Nenhuma pergunta pendente.');
                    break;
                }
                case 'forget': {
                    // /forget <id>  — remove memória semântica pelo ID (use /recall para ver IDs)
                    if (!arg) {
                        println('\x1b[90m  Uso: /forget <id>\x1b[0m');
                    } else {
                        const deleted = conversationStore.deleteMemory(arg);
                        println(
                            deleted
                                ? `\x1b[32m  ✓ Memória removida: ${arg.slice(0, 8)}…\x1b[0m`
                                : `\x1b[33m  Memória não encontrada: ${arg}\x1b[0m`,
                        );
                    }
                    break;
                }
                case 'count': {
                    // /count — estatísticas rápidas da sessão atual
                    if (!_hubSessionId) {
                        println('\x1b[33m  Nenhuma hub session ativa.\x1b[0m');
                        break;
                    }
                    const turns = conversationStore.readTurns(_hubSessionId, { limit: 9999 });
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
  Hub session:        ${_hubSessionId?.slice(0, 8) ?? '—'}…
  ─────────────────────────────────────────────\n`);
                    break;
                }
                case 'restart':
                    println('\x1b[90m  Reiniciando dialog loop…\x1b[0m');
                    try {
                        await llmBridgeClient.stopDialogMode();
                    } catch {
                        /* já estava parado */
                    }
                    await ensureDialogLoop();
                    println('\x1b[32m  Dialog loop reiniciado.\x1b[0m');
                    break;
                case 'quit':
                case 'exit':
                    println('[terminal] Encerrando sessão…');
                    cleanup();
                    try {
                        await llmBridgeClient.stopDialogMode();
                    } catch {
                        /* ignora */
                    }
                    rl.close();
                    injectServer.close();
                    _rl = null;
                    return;
                case 'gh':
                    await cmdGh(rest);
                    break;
                case 'git':
                    await cmdGit(rest);
                    break;
                case 'alias':
                    cmdAlias(rest);
                    break;
                case 'help':
                    cmdHelp();
                    break;
                default:
                    println(`\x1b[90m  Comando desconhecido: /${cmd}. Use /help para ver todos os comandos.\x1b[0m`);
            }
            rl.prompt();
            return;
        }

        // Mensagem normal → envia ao LLM-B via dialog loop
        await sendTurn(trimmed, 'user');
    });

    rl.on('close', () => {
        cleanup();
        _rl = null;
        println('[terminal] readline fechado. Inject server continua ativo.');
        log('INFO', '[TerminalServer] readline encerrado.');
    });

    // Ctrl+C: pausa readline mas mantém o dialog loop ativo
    rl.on('SIGINT', () => {
        println('\n[terminal] Ctrl+C detectado. Dialog loop mantido ativo. Use /quit para encerrar.');
        rl.prompt();
    });
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

/**
 * Inicia o Terminal Permanente LLM-B.
 *
 * @returns {Promise<void>}
 */
export async function startTerminalServer() {
    log('INFO', '[TerminalServer] Iniciando terminal permanente LLM-B…');

    // Carregar aliases customizados
    loadAliases();

    const injectServer = createInjectServer();

    // Criar hub_session permanente no ConversationStore (best-effort; não depende de Socket.io)
    try {
        conversationStore.init();
        _hubSessionId = conversationStore.createHubSession({
            title: 'Terminal Permanente LLM-B',
            metadata: { source: 'terminal-server', startedAt: new Date().toISOString() },
        });
        log('INFO', `[TerminalServer] Hub session criada: ${_hubSessionId}`);
    } catch (/** @type {any} */ e) {
        log('WARN', `[TerminalServer] Hub storage indisponível, continua sem persistência: ${e.message}`);
    }

    // Registrar watchdog: ao detectar dialog loop travado, reiniciar automaticamente
    alwaysAliveAgent.on('dialog.stalled', (/** @type {{ stalledMs: number }} */ evt) => {
        const secs = Math.round(evt.stalledMs / 1000);
        println(`\n[watchdog] ⚠️  Dialog loop inativo há ${secs}s — reiniciando automaticamente…`);
        log('WARN', `[TerminalServer] Watchdog disparou (${secs}s inativo). Reiniciando dialog loop.`);
        if (_hubSessionId) {
            try {
                conversationStore.writeTurn(_hubSessionId, {
                    role: 'user',
                    content: `[SISTEMA] Watchdog: dialog loop inativo por ${secs}s — reinício automático.`,
                });
            } catch {
                /* best-effort */
            }
        }
        // Reinicia de forma assíncrona
        llmBridgeClient
            .stopDialogMode()
            .catch(() => {})
            .then(() => ensureDialogLoop())
            .catch((/** @type {any} */ e) =>
                log('ERROR', `[TerminalServer] Falha ao reiniciar dialog loop: ${e.message}`),
            );
        // Notifica clientes SSE
        broadcastSse('stalled', { stalledMs: evt.stalledMs });
    });

    // SSE: transmitir respostas da LLM-B para clientes subscritos (canal LLM-A proativo)
    alwaysAliveAgent.on('dialog.reply', (/** @type {{ reply: string }} */ evt) => {
        broadcastSse('reply', { content: evt.reply, timestamp: Date.now() });
    });
    alwaysAliveAgent.on('dialog.ready', () => {
        broadcastSse('ready', { timestamp: Date.now() });
    });

    // P4: persiste eventos de sistema no Hub (reconexões, falhas fatais)
    alwaysAliveAgent.on(
        'ready',
        (/** @type {{ sessionId: string; isResumed: boolean; reconected?: boolean }} */ evt) => {
            if (!_hubSessionId || !evt.reconected) return; // evita registrar boot normal
            try {
                conversationStore.writeTurn(_hubSessionId, {
                    role: 'user',
                    content: `[SISTEMA] Session reconectada: ${evt.sessionId} (retomada: ${evt.isResumed})`,
                });
            } catch {
                /* best-effort */
            }
        },
    );
    alwaysAliveAgent.on('session.fatal', (/** @type {{ originalError: string; attempts: number }} */ evt) => {
        if (!_hubSessionId) return;
        try {
            conversationStore.writeTurn(_hubSessionId, {
                role: 'user',
                content: `[SISTEMA] session.fatal após ${evt.attempts} tentativas: ${evt.originalError}`,
            });
        } catch {
            /* best-effort */
        }
    });

    // P7: Reflection loop periódico — LLM-B avalia o histórico recente e emite insights
    // Ativado apenas se a env var LLM_B_REFLECTION_INTERVAL_MIN estiver definida (> 0)
    const reflectionIntervalMin = Number(process.env.LLM_B_REFLECTION_INTERVAL_MIN ?? '0');
    if (reflectionIntervalMin > 0) {
        const reflectionIntervalMs = reflectionIntervalMin * 60 * 1000;
        log('INFO', `[TerminalServer] Reflection loop ativado: a cada ${reflectionIntervalMin}min.`);

        const runReflection = () => {
            if (!alwaysAliveAgent.dialogLoopActive || _busy) return;
            log('INFO', '[TerminalServer] Executando reflection loop…');
            sendTurn(
                '[REFLEXÃO] Faça uma breve reflexão sobre as últimas mensagens desta conversa: o que foi discutido, o que está pendente, e se você tem alguma sugestão ou insight que ainda não mencionou. Seja conciso.',
                'llm-a',
            ).catch((/** @type {any} */ e) => log('WARN', `[TerminalServer] Reflection loop falhou: ${e.message}`));
        };

        const reflectionTimer = setInterval(runReflection, reflectionIntervalMs);
        // Garantir que o timer não impede o processo de encerrar
        if (typeof reflectionTimer.unref === 'function') reflectionTimer.unref();
    }

    await startRepl(injectServer);
}

// Executa diretamente quando chamado via `node terminal-server.js`
const isMain = process.argv[1]?.endsWith('terminal-server.js') ?? false;
if (isMain) {
    startTerminalServer().catch((e) => {
        console.error('[TerminalServer] Erro fatal:', e);
        process.exit(1);
    });
}
