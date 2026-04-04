// @ts-check
/**
 * src/copilot/terminal/repl.js
 *
 * Interface REPL readline do Terminal Permanente LLM-B.
 *
 * Responsável por:
 *
 * - Criar/gerenciar readline interface (`startRepl`)
 * - Registrar listeners de eventos do AlwaysAliveAgent (`setupAgentListeners`)
 * - Fazer dispatch dos comandos `/xxx` para os módulos de commands/
 *
 * @module copilot/terminal/repl
 * @see module:copilot/always-alive
 * @see module:copilot/terminal/dialog
 */

import { log } from '#copilot/observability/logger';
import readline from 'node:readline';
import { alwaysAliveAgent } from '../agent/always-alive.js';
import { resolve } from '../bridges/alias-store.js';
import { llmBridgeClient } from '../channel/client.js';
import {
    cmdAlias as _cmdAlias,
    cmdAnswer as _cmdAnswer,
    cmdAttach as _cmdAttach,
    cmdAudit as _cmdAudit,
    cmdClear as _cmdClear,
    cmdCompact as _cmdCompact,
    cmdContext as _cmdContext,
    cmdCount as _cmdCount,
    cmdDbHistory as _cmdDbHistory,
    cmdDbSessions as _cmdDbSessions,
    cmdDiagnose as _cmdDiagnose,
    cmdDisplay as _cmdDisplay,
    cmdErrors as _cmdErrors,
    cmdExport as _cmdExport,
    cmdForget as _cmdForget,
    cmdGh as _cmdGh,
    cmdGit as _cmdGit,
    cmdHelp as _cmdHelp,
    cmdHistory as _cmdHistory,
    cmdMetrics as _cmdMetrics,
    cmdModel as _cmdModel,
    cmdPlan as _cmdPlan,
    cmdReasoning as _cmdReasoning,
    cmdRecall as _cmdRecall,
    cmdRemember as _cmdRemember,
    cmdResume as _cmdResume,
    cmdSkills as _cmdSkills,
    cmdStatus as _cmdStatus,
    cmdThinking as _cmdThinking,
    cmdTools as _cmdTools,
    cmdUsage as _cmdUsage,
    cmdWho as _cmdWho,
} from './commands/index.js';
import { ensureDialogLoop, println, sendTurn, broadcastSse } from './dialog.js';
import { extractAtReferences } from './file-context.js';
import { clearRateLimiters } from './rate-limiter-state.js';
import { addAttachment, getHubSessionId, setRl } from './state.js';

// ─── Configuração ─────────────────────────────────────────────────────────────

const INJECT_PORT = Number(process.env['LLM_B_TERMINAL_PORT'] ?? 3009);
const PROMPT_USER = '\x1b[32mvocê\x1b[0m\x1b[90m›\x1b[0m ';

const BANNER = `
\x1b[36m╔══════════════════════════════════════════════════════════════════════════╗\x1b[0m
\x1b[36m║\x1b[0m  💬  \x1b[1mTerminal LLM-B\x1b[0m  \x1b[90m—\x1b[0m  Sessão Permanente                            \x1b[36m║\x1b[0m
\x1b[36m╚══════════════════════════════════════════════════════════════════════════╝\x1b[0m
  \x1b[33m/status\x1b[0m · \x1b[33m/history [n]\x1b[0m · \x1b[33m/db-history [n] [offset]\x1b[0m · \x1b[33m/db-sessions [n]\x1b[0m · \x1b[33m/who\x1b[0m · \x1b[33m/clear\x1b[0m · \x1b[33m/restart\x1b[0m
  \x1b[33m/model [list|id]\x1b[0m · \x1b[33m/reasoning [low|medium|high|xhigh|off]\x1b[0m · \x1b[33m/count\x1b[0m
  \x1b[33m/attach [path|clear]\x1b[0m · \x1b[33m/context\x1b[0m · \x1b[33m/compact\x1b[0m · \x1b[33m/plan [on|off]\x1b[0m · \x1b[33m/resume [id]\x1b[0m
  \x1b[33m/pause\x1b[0m · \x1b[33m/dialog-resume [bootPrompt]\x1b[0m \x1b[90m← NEW-PAUSE: pausa/retoma sem PR\x1b[0m
  \x1b[33m/thinking [on|off]\x1b[0m · \x1b[33m/usage [on|off|now]\x1b[0m \x1b[90m← F18/F20: thinking display + usage\x1b[0m
  \x1b[33m/tools\x1b[0m · \x1b[33m/errors [n]\x1b[0m · \x1b[33m/audit [n]\x1b[0m \x1b[90m← F22: tool stats, error tracker, audit log\x1b[0m
  \x1b[33m/display [toggle] [on|off]\x1b[0m · \x1b[33m/metrics\x1b[0m · \x1b[33m/export [path]\x1b[0m \x1b[90m← F24: display, metrics, export\x1b[0m
  \x1b[33m/remember [tag:] texto\x1b[0m · \x1b[33m/recall [tag]\x1b[0m · \x1b[33m/recall ?busca\x1b[0m · \x1b[33m/forget <id>\x1b[0m
  \x1b[33m/skills [list|add <path>|remove <path>|reload]\x1b[0m
  \x1b[36m/gh issue list\x1b[0m · \x1b[36m/gh pr list\x1b[0m · \x1b[36m/gh run list\x1b[0m · \x1b[36m/git status\x1b[0m · \x1b[36m/git log\x1b[0m · \x1b[36m/alias\x1b[0m · \x1b[36m/help\x1b[0m
  \x1b[90mPOST :${INJECT_PORT}/inject  ·  POST :${INJECT_PORT}/pipeline  ·  GET :${INJECT_PORT}/events  ·  GET :${INJECT_PORT}/sessions  ·  POST/GET/DELETE :${INJECT_PORT}/memory\x1b[0m
  \x1b[90mGET :${INJECT_PORT}/gh/issues  ·  GET :${INJECT_PORT}/gh/prs  ·  GET :${INJECT_PORT}/gh/ci  ·  GET :${INJECT_PORT}/git/status  ·  GET :${INJECT_PORT}/git/log\x1b[0m
  \x1b[90mGET :${INJECT_PORT}/config  ·  GET :${INJECT_PORT}/health  |  @caminho/arquivo → embed automático\x1b[0m
`;

// ─── Helpers de dispatch ──────────────────────────────────────────────────────

/**
 * @typedef {{ hubSessionId: string | null; injectPort: number }} CmdCtx
 */

/**
 * Tabela de roteamento de comandos REPL. `println` é resolvida via closure sobre o módulo. Cada entry: `[nomes[],
 * handler(ctx, arg, rest, rl, injectServer, cleanup)]`
 *
 * @type {[
 *     string[],
 *     (
 *         ctx: CmdCtx,
 *         arg: string,
 *         rest: string[],
 *         rl: readline.Interface,
 *         injectServer: import('node:http').Server,
 *         cleanup: () => void,
 *     ) => Promise<void> | void,
 * ][]}
 */
const CMD_ROUTES = [
    [['status'], (ctx) => _cmdStatus({ hubSessionId: ctx.hubSessionId, injectPort: ctx.injectPort, println })],
    [['diagnose', 'diag'], (ctx) => _cmdDiagnose({ hubSessionId: ctx.hubSessionId, println })],
    [['history'], (_, arg) => _cmdHistory({ println }, Number(arg) || 10)],
    [
        ['db-history'],
        (ctx, arg, rest) =>
            _cmdDbHistory({ hubSessionId: ctx.hubSessionId, println }, Number(arg) || 20, Number(rest[0]) || 0),
    ],
    [['db-sessions'], (ctx, arg) => _cmdDbSessions({ hubSessionId: ctx.hubSessionId, println }, Number(arg) || 10)],
    [['remember'], (ctx, arg) => _cmdRemember({ hubSessionId: ctx.hubSessionId, println }, arg)],
    [['recall'], (ctx, arg) => _cmdRecall({ hubSessionId: ctx.hubSessionId, println }, arg)],
    [['forget'], (ctx, arg) => _cmdForget({ hubSessionId: ctx.hubSessionId, println }, arg)],
    [['who'], (ctx) => _cmdWho({ injectPort: ctx.injectPort, println })],
    [['clear'], () => _cmdClear({ println })],
    [['answer'], (_, arg) => _cmdAnswer({ println }, arg)],
    [['count'], (ctx) => _cmdCount({ hubSessionId: ctx.hubSessionId, println })],
    [['restart'], () => _cmdRestart()],
    [['emergency-reset', 'ereset'], () => _cmdEmergencyReset()],
    [['model'], (_, arg) => _cmdModel({ println }, arg)],
    [['reasoning'], (_, arg) => _cmdReasoning({ println }, arg)],
    [['attach'], (_, arg) => _cmdAttach({ println }, arg)],
    [['context'], () => _cmdContext({ println })],
    [['compact'], () => _cmdCompact({ println })],
    [['plan'], (_, arg) => _cmdPlan({ println }, arg)],
    [['resume'], (ctx, arg) => _cmdResume({ println, hubSessionId: ctx.hubSessionId }, arg)],
    [['pause'], () => _cmdPauseDialogLoop()],
    [['dialog-resume'], () => _cmdDialogResume()],
    [['skills'], (_, arg) => _cmdSkills({ println }, arg)],
    [['thinking'], (_, arg) => _cmdThinking({ println }, arg)],
    [['tools'], () => _cmdTools({ println })],
    [['usage'], (_, arg) => _cmdUsage({ println }, arg)],
    [['errors'], (_, arg) => _cmdErrors({ println }, arg)],
    [['audit'], (_, arg) => _cmdAudit({ println }, arg)],
    [['display'], (_, arg, rest) => _cmdDisplay({ println }, arg, rest)],
    [['export'], (_, arg) => _cmdExport({ println }, arg)],
    [['metrics'], () => _cmdMetrics({ println })],
    [['quit', 'exit'], (_, _2, _3, rl, injectServer, cleanup) => _cmdQuit(rl, injectServer, cleanup)],
    [['gh'], (_, _2, rest) => _cmdGh({ println }, rest)],
    [['git'], (_, _2, rest) => _cmdGit({ println }, rest)],
    [['alias'], (_, _2, rest) => _cmdAlias({ println }, rest)],
    [['help'], (ctx) => _cmdHelp({ println, injectPort: ctx.injectPort })],
];

/**
 * @type {Map<
 *     string,
 *     (
 *         ctx: CmdCtx,
 *         arg: string,
 *         rest: string[],
 *         rl: readline.Interface,
 *         injectServer: import('node:http').Server,
 *         cleanup: () => void,
 *     ) => Promise<void> | void
 * >}
 */
const _cmdRouteMap = new Map(CMD_ROUTES.flatMap(([names, fn]) => names.map((n) => [n, fn])));

/**
 * @param {string} cmd
 * @param {string} arg
 * @param {string[]} rest
 * @param {readline.Interface} rl
 * @param {import('node:http').Server} injectServer
 * @param {() => void} cleanup
 * @returns {Promise<void>}
 */
async function dispatchCmd(cmd, arg, rest, rl, injectServer, cleanup) {
    const ctx = { println, hubSessionId: getHubSessionId(), injectPort: INJECT_PORT };
    const handler = _cmdRouteMap.get(cmd?.toLowerCase() ?? '');
    if (handler) {
        await handler(ctx, arg, rest, rl, injectServer, cleanup);
    } else {
        println(`\x1b[90m  Comando desconhecido: /${cmd}. Use /help para ver todos os comandos.\x1b[0m`);
    }
}

// ─── Handlers standalone de comandos inline ───────────────────────────────────

/** F16.2 — Limpa rate limiters e reinicia dialog loop (útil após throttling acidental). */
async function _cmdEmergencyReset() {
    println('\x1b[33m  [emergency-reset] Limpando rate limiters…\x1b[0m');
    clearRateLimiters();
    println('\x1b[33m  [emergency-reset] Reiniciando dialog loop…\x1b[0m');
    await _cmdRestart();
    println('\x1b[32m  [emergency-reset] OK — rate limiters limpos e loop reiniciado.\x1b[0m');
}

async function _cmdRestart() {
    println('\x1b[90m  Reiniciando dialog loop…\x1b[0m');
    try {
        // FINDING-P4-1 (T-05 fix): registrar 'dialog.ready' ANTES de stopDialogMode()
        // para evitar race condition (o evento pode disparar antes do .once ser registrado)
        /** @type {(v?: unknown) => void} */
        let resolveReady = () => {};
        /** @type {(e: Error) => void} */
        let rejectReady = () => {};
        const readyPromise = new Promise((resolve, reject) => {
            resolveReady = resolve;
            rejectReady = reject;
        });
        const timeout = setTimeout(() => rejectReady(new Error('Timeout aguardando restart')), 30_000);
        /** @type {() => void} */
        const onReady = () => {
            clearTimeout(timeout);
            resolveReady();
        };
        alwaysAliveAgent.once('dialog.ready', onReady);
        await llmBridgeClient.stopDialogMode();
        if (!alwaysAliveAgent.dialogLoopActive) {
            await readyPromise;
        } else {
            // dialog loop já está ativo — não precisamos aguardar, limpar listener e timeout
            clearTimeout(timeout);
            alwaysAliveAgent.off('dialog.ready', onReady);
        }
    } catch (/** @type {any} */ e) {
        println(`\x1b[31m  Falha no restart: ${e.message}\x1b[0m`);
        await ensureDialogLoop().catch(() => {});
    }
    println('\x1b[32m  Dialog loop reiniciado.\x1b[0m');
}

async function _cmdPauseDialogLoop() {
    try {
        await alwaysAliveAgent.pauseDialogLoop();
        println('\x1b[33m  Dialog loop pausado. Use /dialog-resume para retomar sem consumir PR.\x1b[0m');
    } catch (/** @type {any} */ e) {
        println(`\x1b[31m  Erro ao pausar: ${e.message}\x1b[0m`);
    }
}

async function _cmdDialogResume() {
    try {
        await alwaysAliveAgent.resumeDialogLoop();
        println('\x1b[32m  Dialog loop retomado.\x1b[0m');
    } catch (/** @type {any} */ e) {
        println(`\x1b[31m  Erro ao retomar: ${e.message}\x1b[0m`);
    }
}

/**
 * @param {readline.Interface} rl
 * @param {import('node:http').Server} injectServer
 * @param {() => void} cleanup
 */
async function _cmdQuit(rl, injectServer, cleanup) {
    println('[terminal] Encerrando sessão…');
    cleanup();
    try {
        await alwaysAliveAgent.stopDialogLoop({ authorized: true, reason: 'authorized_stop' });
    } catch {
        /* ignora — loop pode já estar parado */
    }
    rl.close();
    injectServer.close();
    setRl(null);
}

// ─── Agent listeners ──────────────────────────────────────────────────────────

/**
 * Registra listeners de eventos do AlwaysAliveAgent para exibição no terminal.
 *
 * @param {readline.Interface} rl - Interface readline ativa
 * @returns {() => void} Função de cleanup
 */
export function setupAgentListeners(rl) {
    const onQuestion = (/** @type {Record<string, unknown>} */ evt) => {
        const q = /** @type {string} */ (evt?.['question'] ?? '');
        const choices = /** @type {string[]} */ (evt?.['choices'] ?? []);

        // Filtra mensagens internas do protocolo dialog loop
        if (/^(READY[:\s]|REPLY[:\s]|DONE[:\s]|STOPPED|STOP_DIALOG)/i.test(q.trim())) {
            return;
        }

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

    // F21.5: Tool execution inline display
    /** @type {Map<string, { name: string; t0: number }>} */
    const _activeTools = new Map();

    const onToolStart = (/** @type {Record<string, unknown>} */ evt) => {
        const toolCallId = /** @type {string} */ (evt?.['toolCallId'] ?? '');
        const name = /** @type {string} */ (evt?.['toolName'] ?? evt?.['name'] ?? 'tool');
        _activeTools.set(toolCallId, { name, t0: Date.now() });
        println(`  \x1b[90m🔧 ${name}\x1b[0m \x1b[33m(executando…)\x1b[0m`);
        broadcastSse('tool.start', { toolCallId, toolName: name });
    };

    const onToolComplete = (/** @type {Record<string, unknown>} */ evt) => {
        const toolCallId = /** @type {string} */ (evt?.['toolCallId'] ?? '');
        const success = Boolean(evt?.['success']);
        const entry = _activeTools.get(toolCallId);
        _activeTools.delete(toolCallId);
        const name = entry?.name ?? 'tool';
        const dur = entry ? ((Date.now() - entry.t0) / 1000).toFixed(1) : '?';
        const icon = success ? '\x1b[32m✅\x1b[0m' : '\x1b[31m❌\x1b[0m';
        println(`  ${icon} \x1b[90m${name}\x1b[0m \x1b[90m(${dur}s)\x1b[0m`);
        broadcastSse('tool.complete', { toolCallId, toolName: name, success, durationMs: entry ? Date.now() - entry.t0 : 0 });
    };

    // F22.2: Session error display
    const onSessionError = (/** @type {Record<string, unknown>} */ evt) => {
        const msg = /** @type {string} */ (evt?.['message'] ?? 'unknown error');
        const errorType = /** @type {string} */ (evt?.['errorType'] ?? 'error');
        println(`\n  \x1b[31m⚠️  Erro de sessão [${errorType}]: ${msg}\x1b[0m`);
        broadcastSse('session.error', { errorType, message: msg });
    };

    // F22.1: Compaction events display
    const onCompactionStart = () => {
        println(`  \x1b[33m🗜️  Compactando context window…\x1b[0m`);
        broadcastSse('compaction.start', {});
    };

    const onCompactionComplete = (/** @type {Record<string, unknown>} */ evt) => {
        const pre = /** @type {number | undefined} */ (evt?.['preCompactionTokens']);
        const post = /** @type {number | undefined} */ (evt?.['postCompactionTokens']);
        const success = Boolean(evt?.['success']);
        if (success && pre !== undefined && post !== undefined) {
            const pct = ((1 - post / pre) * 100).toFixed(0);
            println(`  \x1b[32m🗜️  Compactação concluída: ${pre.toLocaleString('pt-BR')} → ${post.toLocaleString('pt-BR')} tokens (-${pct}%)\x1b[0m`);
        } else if (!success) {
            println(`  \x1b[31m🗜️  Compactação falhou\x1b[0m`);
        }
        broadcastSse('compaction.complete', { success, pre, post });
    };

    // F23.1: Intent display
    const onIntent = (/** @type {Record<string, unknown>} */ evt) => {
        const intent = /** @type {string} */ (evt?.['intent'] ?? '');
        if (intent) {
            process.stdout.write(`\r  \x1b[90m⏳ ${intent}\x1b[0m\x1b[K`);
        }
    };

    // F23.5: Sub-agent events
    const onSubagentStarted = (/** @type {Record<string, unknown>} */ evt) => {
        const name = /** @type {string} */ (evt?.['agentName'] ?? 'sub-agent');
        println(`  \x1b[36m🤖 Sub-agente iniciado: ${name}\x1b[0m`);
    };

    const onSubagentCompleted = (/** @type {Record<string, unknown>} */ evt) => {
        const name = /** @type {string} */ (evt?.['agentName'] ?? 'sub-agent');
        println(`  \x1b[32m🤖 Sub-agente concluído: ${name}\x1b[0m`);
    };

    const onSubagentFailed = (/** @type {Record<string, unknown>} */ evt) => {
        const name = /** @type {string} */ (evt?.['agentName'] ?? 'sub-agent');
        const error = /** @type {string} */ (evt?.['error'] ?? 'unknown');
        println(`  \x1b[31m🤖 Sub-agente falhou: ${name} — ${error}\x1b[0m`);
    };

    alwaysAliveAgent.on('question.pending', onQuestion);
    alwaysAliveAgent.once('stopped', onStopped);
    alwaysAliveAgent.on('tool.execution_start', onToolStart);
    alwaysAliveAgent.on('tool.execution_complete', onToolComplete);
    alwaysAliveAgent.on('session.error', onSessionError);
    alwaysAliveAgent.on('session.compaction_start', onCompactionStart);
    alwaysAliveAgent.on('session.compaction_complete', onCompactionComplete);
    alwaysAliveAgent.on('assistant.intent', onIntent);
    alwaysAliveAgent.on('subagent.started', onSubagentStarted);
    alwaysAliveAgent.on('subagent.completed', onSubagentCompleted);
    alwaysAliveAgent.on('subagent.failed', onSubagentFailed);

    return () => {
        alwaysAliveAgent.off('question.pending', onQuestion);
        alwaysAliveAgent.off('stopped', onStopped);
        alwaysAliveAgent.off('tool.execution_start', onToolStart);
        alwaysAliveAgent.off('tool.execution_complete', onToolComplete);
        alwaysAliveAgent.off('session.error', onSessionError);
        alwaysAliveAgent.off('session.compaction_start', onCompactionStart);
        alwaysAliveAgent.off('session.compaction_complete', onCompactionComplete);
        alwaysAliveAgent.off('assistant.intent', onIntent);
        alwaysAliveAgent.off('subagent.started', onSubagentStarted);
        alwaysAliveAgent.off('subagent.completed', onSubagentCompleted);
        alwaysAliveAgent.off('subagent.failed', onSubagentFailed);
    };
}

// ─── REPL ─────────────────────────────────────────────────────────────────────

/**
 * Inicia o REPL readline do terminal permanente.
 *
 * Em modo headless (stdin não-TTY), apenas garante o dialog loop e retorna, deixando o inject server HTTP manter o
 * event loop ativo.
 *
 * @param {import('node:http').Server} injectServer - Servidor HTTP de injeção (para fechar no /quit)
 * @returns {Promise<void>}
 */
export async function startRepl(injectServer) {
    if (!process.stdin.isTTY) {
        println('[boot] Modo headless detectado — REPL desativado. Use POST :' + INJECT_PORT + '/inject.');
        await ensureDialogLoop();
        return;
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        prompt: PROMPT_USER,
    });
    setRl(rl);

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

        if (trimmed.startsWith('/')) {
            const resolved = resolve(trimmed);
            const [cmd, ...rest] = resolved.slice(1).split(' ');
            const arg = rest.join(' ');
            await dispatchCmd(cmd ?? '', arg, rest, rl, injectServer, cleanup);
            rl.prompt();
            return;
        }

        // Detectar referências @path inline e adicioná-las à fila de attachment
        const { paths: atPaths, strippedMessage } = extractAtReferences(trimmed);
        for (const p of atPaths) {
            addAttachment(p);
            println(`\x1b[90m  📎 @${p} adicionado à fila de attachments\x1b[0m`);
        }
        const finalMessage = atPaths.length > 0 ? strippedMessage || trimmed : trimmed;

        await sendTurn(finalMessage, 'user');
    });

    rl.on('close', () => {
        cleanup();
        setRl(null);
        println('[terminal] readline fechado. Inject server continua ativo.');
        log('INFO', '[TerminalServer] readline encerrado.');
    });

    rl.on('SIGINT', () => {
        // T-27: Ctrl+C mantém dialog loop ativo. Cancelar turno in-flight exigiria
        // propagar AbortController de sendTurn → sendMessage (infra AbortSignal já existe
        // em message-queue.js). Candidato a upgrade P4 futuro.
        println('\n[terminal] Ctrl+C detectado. Dialog loop mantido ativo. Use /quit para encerrar.');
        rl.prompt();
    });
}
