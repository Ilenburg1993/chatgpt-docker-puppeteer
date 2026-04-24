// @ts-check
/**
 * @module copilot/terminal/repl
 * @file REPL interativo do terminal LLM-B: lê input do usuário, resolve aliases, despacha comandos e exibe respostas
 *   formatadas com suporte a streaming.
 *
 *   src/copilot/terminal/repl.js
 * @see EventBus
 * @see module:copilot/always-alive
 * @see module:copilot/terminal/dialog
 */

import { readCopilotBootConfig } from '#copilot/boot';
import { LLM_B_BOOT_TIMEOUT_MS } from '#copilot/config';
import { runShutdown, toError } from '#copilot/core';
import { EMITTER_DIALOG_READY } from '#copilot/events';
import { log } from '#copilot/observability';
import readline from 'node:readline';
import { logSwallowed } from '../core/error-handlers.js';
import { extractAtReferences } from '../presentation/runtime-file-context.js';
import { addAttachment, getHubSessionId, setRl } from '../presentation/runtime-ui-state-store.js';
import { resolve } from './alias-store.js';
import {
    cmdActivity as _cmdActivity,
    cmdAlias as _cmdAlias,
    cmdAnswer as _cmdAnswer,
    cmdAttach as _cmdAttach,
    cmdAudit as _cmdAudit,
    cmdClear as _cmdClear,
    cmdClearShadow as _cmdClearShadow,
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
    cmdRemember as _cmdRemember,
    cmdResume as _cmdResume,
    cmdSearch as _cmdSearch,
    cmdSessionList as _cmdSessionList,
    cmdSessionRestore as _cmdSessionRestore,
    cmdSessionSave as _cmdSessionSave,
    cmdSkills as _cmdSkills,
    cmdStatus as _cmdStatus,
    cmdThinking as _cmdThinking,
    cmdTools as _cmdTools,
    cmdUsage as _cmdUsage,
    cmdWho as _cmdWho,
} from './commands/index.js';
import { buildUserPrompt, ensureDialogLoop, println, sendTurn } from './dialog/index.js';
import {
    offTerminalAgentRuntimeEvent,
    onceTerminalAgentRuntimeEvent,
    pauseTerminalDialogLoop,
    readTerminalHandoffHistory,
    readTerminalRuntimeControlState,
    resumeTerminalDialogLoop,
    stopTerminalDialogMode,
} from './frontend/llm-b-runtime.js';
import { clearRateLimiters } from './rate-limiter-state.js';
import { setupAgentListeners } from './repl-listeners.js';

const INJECT_PORT = readCopilotBootConfig().server.port;

const BANNER = `
\x1b[36m╔══════════════════════════════════════════════════════════════════════════╗\x1b[0m
\x1b[36m║\x1b[0m  💬  \x1b[1mTerminal LLM-B\x1b[0m  \x1b[90m—\x1b[0m  Sessão Permanente                            \x1b[36m║\x1b[0m
\x1b[36m╚══════════════════════════════════════════════════════════════════════════╝\x1b[0m
    \x1b[33m/status\x1b[0m · \x1b[33m/history [n]\x1b[0m · \x1b[33m/db-history [n] [offset]\x1b[0m · \x1b[33m/db-sessions [n]\x1b[0m · \x1b[33m/who\x1b[0m · \x1b[33m/clear\x1b[0m · \x1b[33m/clear-shadow\x1b[0m · \x1b[33m/restart\x1b[0m
    \x1b[33m/activity [n]\x1b[0m \x1b[90m← atividade atual + timeline\x1b[0m
  \x1b[33m/model [list|id]\x1b[0m · \x1b[33m/reasoning [low|medium|high|xhigh|off]\x1b[0m · \x1b[33m/count\x1b[0m
    \x1b[33m/attach [path|clear]\x1b[0m · \x1b[33m/context\x1b[0m · \x1b[33m/compact\x1b[0m · \x1b[33m/plan [on|off|autopilot|read|clear]\x1b[0m · \x1b[33m/resume [id]\x1b[0m
  \x1b[33m/pause\x1b[0m · \x1b[33m/dialog-resume [bootPrompt]\x1b[0m · \x1b[33m/handoff\x1b[0m \x1b[90m← pausa/retoma/handoff\x1b[0m
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

const RESTART_WAIT_TIMEOUT_MS = Math.max(15_000, Math.min(120_000, Math.round(LLM_B_BOOT_TIMEOUT_MS * 0.5)));

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
    [
        ['status'],
        (ctx, arg) => _cmdStatus({ hubSessionId: ctx.hubSessionId, injectPort: ctx.injectPort, println }, arg),
    ],
    [['activity'], (_, arg) => _cmdActivity({ println }, arg)],
    [['diagnose', 'diag'], (ctx, arg) => _cmdDiagnose({ hubSessionId: ctx.hubSessionId, println }, arg)],
    [['history'], (_, arg) => _cmdHistory({ println }, Number(arg) || 10)],
    [
        ['db-history'],
        (ctx, arg, rest) =>
            _cmdDbHistory({ hubSessionId: ctx.hubSessionId, println }, Number(arg) || 20, Number(rest[0]) || 0),
    ],
    [['db-sessions'], (ctx, arg) => _cmdDbSessions({ hubSessionId: ctx.hubSessionId, println }, Number(arg) || 10)],
    [['remember'], (ctx, arg) => _cmdRemember({ hubSessionId: ctx.hubSessionId, println }, arg)],
    [['forget'], (ctx, arg) => _cmdForget({ hubSessionId: ctx.hubSessionId, println }, arg)],
    [['who'], (ctx) => _cmdWho({ injectPort: ctx.injectPort, println })],
    [['clear'], () => _cmdClear({ println })],
    [['answer'], (_, arg) => _cmdAnswer({ println }, arg)],
    [['clear-shadow'], () => _cmdClearShadow({ println })],
    [['count'], (ctx) => _cmdCount({ hubSessionId: ctx.hubSessionId, println })],
    [['restart'], () => _cmdRestart()],
    [['emergency-reset', 'ereset'], () => _cmdEmergencyReset()],
    [['model'], (_, arg) => _cmdModel({ println }, arg)],
    [['reasoning'], (_, arg) => _cmdReasoning({ println }, arg)],
    [['attach'], (_, arg) => _cmdAttach({ println }, arg)],
    [['context'], (_, arg) => _cmdContext({ println }, arg)],
    [['compact'], (_, arg) => _cmdCompact({ println }, arg)],
    [['plan'], (_, arg) => _cmdPlan({ println }, arg)],
    [['resume'], (ctx, arg) => _cmdResume({ println, hubSessionId: ctx.hubSessionId }, arg)],
    [['pause'], () => _cmdPauseDialogLoop()],
    [['dialog-resume'], () => _cmdDialogResume()],
    [['handoff'], () => _cmdHandoff()],
    [['skills'], (_, arg) => _cmdSkills({ println }, arg)],
    [['thinking'], (_, arg) => _cmdThinking({ println }, arg)],
    [['tools'], () => _cmdTools({ println })],
    [['usage'], (_, arg) => _cmdUsage({ println }, arg)],
    [['errors'], (_, arg) => _cmdErrors({ println }, arg)],
    [['audit'], (_, arg) => _cmdAudit({ println }, arg)],
    [['display'], (_, arg, rest) => _cmdDisplay({ println }, arg, rest)],
    [['export'], (_, arg) => _cmdExport({ println }, arg)],
    [['metrics'], (_, arg) => _cmdMetrics({ println }, arg)],
    [['search'], (ctx, arg) => _cmdSearch({ println, hubSessionId: ctx.hubSessionId }, arg)],
    [['session'], (_, arg, rest) => _cmdSessionDispatch(arg, rest)],
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
/**
 * F41.5: Dispatcher para subcomandos de `/session save|list|restore`.
 *
 * @param {string} subCmd
 * @param {string[]} rest
 */
async function _cmdSessionDispatch(subCmd, rest) {
    const sub = (subCmd || '').toLowerCase();
    if (sub === 'save') {
        await _cmdSessionSave({ println }, rest.join(' ') || undefined);
    } else if (sub === 'list') {
        await _cmdSessionList({ println });
    } else if (sub === 'restore') {
        await _cmdSessionRestore({ println }, rest[0] || '');
    } else {
        println('\x1b[33m  Uso: /session save [reason] | /session list | /session restore <id>\x1b[0m');
    }
}

/** F16.2 — Limpa rate limiters e reinicia dialog loop (útil após throttling acidental). */
async function _cmdEmergencyReset() {
    println('\x1b[33m  [emergency-reset] Limpando rate limiters…\x1b[0m');
    clearRateLimiters();
    println('\x1b[33m  [emergency-reset] Reiniciando dialog loop…\x1b[0m');
    await _cmdRestart();
    println('\x1b[32m  [emergency-reset] OK — rate limiters limpos e loop reiniciado.\x1b[0m');
}

/**
 * @param {readline.Interface | null | undefined} rl
 * @returns {boolean}
 */
function isReadlineOpen(rl) {
    const state = /** @type {{ closed?: boolean }} */ (rl ?? {});
    return Boolean(rl) && state.closed !== true;
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
        const timeout = setTimeout(
            () => rejectReady(new Error(`Timeout aguardando restart (${RESTART_WAIT_TIMEOUT_MS}ms)`)),
            RESTART_WAIT_TIMEOUT_MS,
        );
        /** @type {() => void} */
        const onReady = () => {
            clearTimeout(timeout);
            resolveReady();
        };
        onceTerminalAgentRuntimeEvent(EMITTER_DIALOG_READY, onReady);
        await stopTerminalDialogMode();
        if (!readTerminalRuntimeControlState().dialogLoopActive) {
            await readyPromise;
        } else {
            // dialog loop já está ativo — não precisamos aguardar, limpar listener e timeout
            clearTimeout(timeout);
            offTerminalAgentRuntimeEvent(EMITTER_DIALOG_READY, onReady);
        }
    } catch (e) {
        println(`\x1b[31m  Falha no restart: ${toError(e).message}\x1b[0m`);
        await ensureDialogLoop().catch((e) => logSwallowed(e, 'terminal.repl.ensureDialogLoop'));
    }
    println('\x1b[32m  Dialog loop reiniciado.\x1b[0m');
}

async function _cmdPauseDialogLoop() {
    try {
        await pauseTerminalDialogLoop();
        println('\x1b[33m  Dialog loop pausado. Use /dialog-resume para retomar sem consumir PR.\x1b[0m');
    } catch (e) {
        println(`\x1b[31m  Erro ao pausar: ${toError(e).message}\x1b[0m`);
    }
}

async function _cmdDialogResume() {
    try {
        await resumeTerminalDialogLoop();
        println('\x1b[32m  Dialog loop retomado.\x1b[0m');
    } catch (e) {
        println(`\x1b[31m  Erro ao retomar: ${toError(e).message}\x1b[0m`);
    }
}

function _cmdHandoff() {
    const history = readTerminalHandoffHistory();
    if (!history) {
        println('\x1b[31m  HandoffManager não disponível.\x1b[0m');
        return;
    }
    if (history.length === 0) {
        println('\x1b[33m  Nenhum handoff registrado nesta sessão.\x1b[0m');
        return;
    }
    println('\x1b[36m  ── Handoff History ──\x1b[0m');
    for (const h of history) {
        const ts = new Date(Number(h.receivedAt)).toISOString();
        println(
            `  \x1b[90m${ts}\x1b[0m  ${h.fromAgent}→\x1b[33m${h.toAgent}\x1b[0m  reason=\x1b[90m${h.reason ?? '-'}\x1b[0m  status=\x1b[36m${h.status}\x1b[0m`,
        );
    }
}
/**
 * @param {readline.Interface} rl
 * @param {import('node:http').Server} injectServer
 * @param {() => void} cleanup
 */
async function _cmdQuit(rl, injectServer, cleanup) {
    void injectServer;
    println('[terminal] Encerrando sessão…');
    cleanup();
    try {
        await runShutdown('terminal.quit');
    } catch (e) {
        logSwallowed(e, 'terminal.repl.stopLoop');
    }
    rl.close();
    setRl(null);
    setImmediate(() => process.exit(0));
}

export { setupAgentListeners } from './repl-listeners.js';

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

    // F37: lista de comandos para tab completion
    const _cmdNames = CMD_ROUTES.flatMap(([names]) => names).map((n) => `/${n}`);

    /**
     * Readline completer para comandos REPL (F37.1).
     *
     * @param {string} line
     * @returns {[string[], string]}
     */
    function _completer(line) {
        if (!line.startsWith('/')) return [[], line];
        const hits = _cmdNames.filter((c) => c.startsWith(line));
        return [hits.length ? hits : _cmdNames, line];
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        prompt: buildUserPrompt(),
        completer: _completer,
    });
    setRl(rl);

    const cleanup = setupAgentListeners(rl);

    println(BANNER);
    println('\x1b[90m  Iniciando sessão com LLM-B…\x1b[0m');

    try {
        await ensureDialogLoop();
    } catch (e) {
        println(`\x1b[31m  [erro de boot] ${toError(e).message}\x1b[0m`);
        log('ERROR', `[TerminalServer] Boot error: ${toError(e).message}`);
    }

    rl.setPrompt(buildUserPrompt());
    rl.prompt();

    // F37.6: Buffer para multiline input via backslash continuation
    /** @type {string[]} */
    let _multilineBuffer = [];
    const PROMPT_CONTINUATION = '\x1b[90m  ...\x1b[0m ';

    rl.on('line', async (line) => {
        // F37.6: Se a linha termina com `\`, acumular no buffer multiline
        if (line.endsWith('\\')) {
            _multilineBuffer.push(line.slice(0, -1));
            rl.setPrompt(PROMPT_CONTINUATION);
            rl.prompt();
            return;
        }

        // Se havia buffer multiline acumulado, juntar tudo
        if (_multilineBuffer.length > 0) {
            _multilineBuffer.push(line);
            line = _multilineBuffer.join('\n');
            _multilineBuffer = [];
            rl.setPrompt(buildUserPrompt());
        }

        const trimmed = line.trim();
        if (!trimmed) {
            if (isReadlineOpen(rl)) {
                rl.setPrompt(buildUserPrompt());
                rl.prompt();
            }
            return;
        }

        if (trimmed.startsWith('/')) {
            const resolved = resolve(trimmed);
            const [cmd, ...rest] = resolved.slice(1).split(' ');
            const arg = rest.join(' ');
            await dispatchCmd(cmd ?? '', arg, rest, rl, injectServer, cleanup);
            if (isReadlineOpen(rl)) {
                rl.setPrompt(buildUserPrompt());
                rl.prompt();
            }
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
        rl.setPrompt(buildUserPrompt());
        rl.prompt();
    });
}
