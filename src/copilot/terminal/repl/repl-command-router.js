// @ts-check
/**
 * @module copilot/terminal/repl-command-router
 * @file Tabela de roteamento e dispatch de comandos do REPL terminal LLM-B.
 *
 *   Extrai CMD_ROUTES, _cmdRouteMap e dispatchCmd do composition root (repl.js), bem como as funções de comando locais
 *   que não são delegates diretos dos módulos de commands/index.js.
 *
 *   src/copilot/terminal/repl/repl-command-router.js
 * @see module:copilot/terminal/repl
 */

import { readCopilotBootConfig } from '#copilot/boot';
import { LLM_B_BOOT_TIMEOUT_MS } from '#copilot/config';
import { runShutdown, toError } from '#copilot/core';
import { EMITTER_DIALOG_READY } from '#copilot/events';
import { logSwallowed } from '../../core/error-handlers.js';
import { getHubSessionId, setRl } from '../../presentation/runtime-ui-state-store.js';
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
    cmdElicitation as _cmdElicitation,
    cmdErrors as _cmdErrors,
    cmdExport as _cmdExport,
    cmdForget as _cmdForget,
    cmdFs as _cmdFs,
    cmdGh as _cmdGh,
    cmdGit as _cmdGit,
    cmdHelp as _cmdHelp,
    cmdHistory as _cmdHistory,
    cmdIndex as _cmdIndex,
    cmdLive as _cmdLive,
    cmdMenu as _cmdMenu,
    cmdMetrics as _cmdMetrics,
    cmdModel as _cmdModel,
    cmdNow as _cmdNow,
    cmdPermission as _cmdPermission,
    cmdPlan as _cmdPlan,
    cmdReasoning as _cmdReasoning,
    cmdRemember as _cmdRemember,
    cmdResume as _cmdResume,
    cmdScope as _cmdScope,
    cmdSdk as _cmdSdk,
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
    cmdWorkspace as _cmdWorkspace,
} from '../commands/index.js';
import { ensureDialogLoop, println } from '../dialog/index.js';
import {
    offTerminalAgentRuntimeEvent,
    onceTerminalAgentRuntimeEvent,
    pauseTerminalDialogLoop,
    readTerminalHandoffHistory,
    readTerminalRuntimeControlState,
    resumeTerminalDialogLoop,
} from '../frontend/gateways/agent-runtime.js';
import { stopTerminalDialogMode } from '../frontend/gateways/dialog.js';
import { clearRateLimiters } from '../state/rate-limiter-state.js';
import { parseTerminalReplCommand } from './repl-command-parser.js';

/** @type {number} */
const INJECT_PORT = readCopilotBootConfig().server.port;

const RESTART_WAIT_TIMEOUT_MS = Math.max(15_000, Math.min(120_000, Math.round(LLM_B_BOOT_TIMEOUT_MS * 0.5)));

/**
 * @typedef {{ hubSessionId: string | null; injectPort: number }} CmdCtx
 */

/**
 * Verifica se o readline ainda está aberto.
 *
 * @param {import('node:readline').Interface | null | undefined} rl
 * @returns {boolean}
 */
export function isReadlineOpen(rl) {
    const state = /** @type {{ closed?: boolean }} */ (rl ?? {});
    return Boolean(rl) && state.closed !== true;
}

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
 * Timeout máximo para graceful shutdown no /quit. Após este prazo, força saída. Garante que /quit nunca fique travado
 * esperando um dialog loop em estado degradado.
 */
const QUIT_SHUTDOWN_TIMEOUT_MS = 8_000;

/**
 * @param {import('node:readline').Interface} rl
 * @param {import('node:http').Server} injectServer
 * @param {() => void} cleanup
 */
async function _cmdQuit(rl, injectServer, cleanup) {
    void injectServer;
    println('[terminal] Encerrando sessão…');
    cleanup();
    try {
        // Hard timeout: se runShutdown não completar em QUIT_SHUTDOWN_TIMEOUT_MS, sai mesmo assim.
        // Evita travamento de /quit quando o dialog loop está em estado degradado (ex.: after freeze).
        await Promise.race([
            runShutdown('terminal.quit'),
            new Promise((_, reject) =>
                setTimeout(
                    () => reject(new Error(`Shutdown timeout após ${QUIT_SHUTDOWN_TIMEOUT_MS}ms`)),
                    QUIT_SHUTDOWN_TIMEOUT_MS,
                ),
            ),
        ]);
    } catch (e) {
        logSwallowed(e, 'terminal.repl.stopLoop');
    }
    rl.close();
    setRl(null);
    setImmediate(() => process.exit(0));
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
 *         rl: import('node:readline').Interface,
 *         injectServer: import('node:http').Server,
 *         cleanup: () => void,
 *     ) => Promise<void> | void,
 * ][]}
 */
export const CMD_ROUTES = [
    [
        ['status'],
        (ctx, arg) => _cmdStatus({ hubSessionId: ctx.hubSessionId, injectPort: ctx.injectPort, println }, arg),
    ],
    [['now'], (ctx, arg) => _cmdNow({ hubSessionId: ctx.hubSessionId, injectPort: ctx.injectPort, println }, arg)],
    [['live'], (ctx, arg) => _cmdLive({ hubSessionId: ctx.hubSessionId, injectPort: ctx.injectPort, println }, arg)],
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
    [['who'], (ctx, arg) => _cmdWho({ injectPort: ctx.injectPort, println }, arg)],
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
    [['sdk'], (_, arg) => _cmdSdk({ println }, arg)],
    [['workspace', 'ws'], (_, arg) => _cmdWorkspace({ println }, arg)],
    [['fs', 'files'], (_, arg) => _cmdFs({ println }, arg)],
    [['scope', 'scopes'], (ctx, arg) => _cmdScope({ println, hubSessionId: ctx.hubSessionId }, arg)],
    [['index', 'idx'], (_, arg) => _cmdIndex({ println }, arg)],
    [['elicitation', 'elicit'], (_, arg) => _cmdElicitation({ println }, arg)],
    [['permission', 'perm'], (_, arg) => _cmdPermission({ println }, arg)],
    [['usage'], (_, arg) => _cmdUsage({ println }, arg)],
    [['errors'], (_, arg) => _cmdErrors({ println }, arg)],
    [['audit'], (_, arg) => _cmdAudit({ println }, arg)],
    [['display'], (_, arg, rest) => _cmdDisplay({ println }, arg, rest)],
    [['export'], (_, arg) => _cmdExport({ println }, arg)],
    [['metrics'], (_, arg) => _cmdMetrics({ println }, arg)],
    [
        ['menu'],
        (_, arg, rest, rl, injectServer, cleanup) =>
            _cmdMenu({ println }, arg, rest, {
                executeCommandLine: async (commandLine) => {
                    const parsed = parseTerminalReplCommand(commandLine);
                    if (!parsed) return false;
                    if (parsed.command.toLowerCase() === 'menu') return false;
                    await dispatchCmd(parsed.command, parsed.arg, parsed.rest, rl, injectServer, cleanup);
                    return true;
                },
            }),
    ],
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
 *         rl: import('node:readline').Interface,
 *         injectServer: import('node:http').Server,
 *         cleanup: () => void,
 *     ) => Promise<void> | void
 * >}
 */
const _cmdRouteMap = new Map(CMD_ROUTES.flatMap(([names, fn]) => names.map((n) => [n, fn])));

/**
 * Despacha um comando REPL pelo nome.
 *
 * @param {string} cmd - Nome do comando (sem barra inicial)
 * @param {string} arg - Primeiro argumento
 * @param {string[]} rest - Demais argumentos
 * @param {import('node:readline').Interface} rl - Interface readline ativa
 * @param {import('node:http').Server} injectServer - Servidor de injeção HTTP
 * @param {() => void} cleanup - Callback de limpeza do REPL
 * @returns {Promise<void>}
 */
export async function dispatchCmd(cmd, arg, rest, rl, injectServer, cleanup) {
    const ctx = { println, hubSessionId: getHubSessionId(), injectPort: INJECT_PORT };
    const handler = _cmdRouteMap.get(cmd?.toLowerCase() ?? '');
    if (handler) {
        await handler(ctx, arg, rest, rl, injectServer, cleanup);
    } else {
        println(`\x1b[90m  Comando desconhecido: /${cmd}. Use /help para ver todos os comandos.\x1b[0m`);
    }
}
