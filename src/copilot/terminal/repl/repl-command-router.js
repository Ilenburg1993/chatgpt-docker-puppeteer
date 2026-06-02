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
import { getTerminalInterventionPolicy, LLM_B_BOOT_TIMEOUT_MS } from '#copilot/config';
import { EVENT_BUS, runShutdown, toError } from '#copilot/core';
import { EMITTER_DIALOG_READY } from '#copilot/events';
import { logSwallowed } from '../../core/error-handlers.js';
import { container } from '../../core/di-container.js';
import {
    clearRuntimeInterventionMailbox,
    consumeRuntimeInterventionMailbox,
    enqueueRuntimeInterventionMailbox,
    getHubSessionId,
    readRuntimeInterventionMailboxSummary,
    setRl,
} from '../../presentation/state/index.js';
import {
    cmdActivity as _cmdActivity,
    cmdAlias as _cmdAlias,
    cmdAnswer as _cmdAnswer,
    cmdAttach as _cmdAttach,
    cmdAudit as _cmdAudit,
    cmdByok as _cmdByok,
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
    cmdEvents as _cmdEvents,
    cmdExport as _cmdExport,
    cmdForget as _cmdForget,
    cmdFs as _cmdFs,
    cmdGh as _cmdGh,
    cmdGit as _cmdGit,
    cmdHelp as _cmdHelp,
    cmdHistory as _cmdHistory,
    cmdIndex as _cmdIndex,
    cmdIntent as _cmdIntent,
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
    cmdSessionSdk as _cmdSessionSdk,
    cmdSkills as _cmdSkills,
    cmdStatus as _cmdStatus,
    cmdThinking as _cmdThinking,
    cmdTools as _cmdTools,
    cmdUsage as _cmdUsage,
    cmdWho as _cmdWho,
    cmdWorkspace as _cmdWorkspace,
} from '../commands/index.js';
import { ensureDialogLoop, getTurnQueueDepth, println, printlnBlock, sendTurn } from '../dialog/index.js';
import {
    abortTerminalCurrentMessage,
    answerTerminalPendingQuestion,
    offTerminalAgentRuntimeEvent,
    onceTerminalAgentRuntimeEvent,
    pauseTerminalDialogLoop,
    readTerminalHandoffHistory,
    readTerminalRuntimeControlState,
    readTerminalRuntimeState,
    resumeTerminalDialogLoop,
    steerTerminalMessage,
    stopTerminalDialogMode,
} from '../frontend/gateways/index.js';
import { clearRateLimiters } from '../state/repl-runtime/index.js';
import { deliverEntryAsTurnIfIdle } from '../wiring/mailbox/index.js';
import { parseTerminalReplCommand, parseTerminalSubcommand } from './repl-command-parser.js';

/**
 * @param {unknown} value
 * @param {number} fallbackMs
 * @returns {number}
 */
function resolveBoundedTimeoutMs(value, fallbackMs) {
    const numeric = Number(value);
    const base = Number.isFinite(numeric) && numeric > 0 ? numeric : fallbackMs;
    return Math.max(15_000, Math.min(120_000, Math.round(base * 0.5)));
}

/** @type {number} */
const INJECT_PORT = readCopilotBootConfig().server.port;
let activeInjectPort = INJECT_PORT;

const RESTART_WAIT_TIMEOUT_MS = resolveBoundedTimeoutMs(LLM_B_BOOT_TIMEOUT_MS, 60_000);
/** @type {Promise<void>} */
let _terminalInterventionQueue = Promise.resolve();

/**
 * @typedef {{ hubSessionId: string | null; injectPort: number; eventBus: import('../../core/event-bus.js').EventBus | null }} CmdCtx
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
        // Registrar 'dialog.ready' ANTES de stopDialogMode() para evitar race condition.
        const { promise: readyPromise, resolve: resolveReady, reject: rejectReady } = Promise.withResolvers();
        /** @type {ReturnType<typeof setTimeout> | null} */
        let timeout = setTimeout(
            () => rejectReady(new Error(`Timeout aguardando restart (${RESTART_WAIT_TIMEOUT_MS}ms)`)),
            RESTART_WAIT_TIMEOUT_MS,
        );
        let settled = false;
        /** @returns {void} */
        const cleanupReadyWait = () => {
            if (timeout !== null) {
                clearTimeout(timeout);
                timeout = null;
            }
            offTerminalAgentRuntimeEvent(EMITTER_DIALOG_READY, onReady);
        };
        /** @returns {void} */
        const onReady = () => {
            if (settled) return;
            settled = true;
            cleanupReadyWait();
            resolveReady(undefined);
        };
        onceTerminalAgentRuntimeEvent(EMITTER_DIALOG_READY, onReady);
        await stopTerminalDialogMode();
        if (!readTerminalRuntimeControlState().dialogLoopActive) {
            await readyPromise;
        } else {
            // dialog loop já está ativo — não precisamos aguardar, limpar listener e timeout.
            settled = true;
            cleanupReadyWait();
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

/**
 * @returns {Promise<boolean>} true quando o abort foi aceito pelo runtime.
 */
async function _cmdAbortCurrentTurn() {
    try {
        await abortTerminalCurrentMessage();
        println('\x1b[33m  [abort] Turno SDK ativo abortado. A próxima mensagem da fila poderá prosseguir.\x1b[0m');
        return true;
    } catch (e) {
        println(`\x1b[31m  [abort] Falha ao abortar turno ativo: ${toError(e).message}\x1b[0m`);
        return false;
    }
}

/**
 * @template T
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
async function runTerminalInterventionSequence(operation) {
    const next = _terminalInterventionQueue.catch(() => {}).then(operation);
    _terminalInterventionQueue = next.then(
        () => {},
        () => {},
    );
    return next;
}

/**
 * Tenta aplicar intervenção imediatamente em `ask_user` pendente (zero-PR).
 *
 * @param {string} message
 * @returns {boolean}
 */
function tryApplyImmediateTerminalZeroPr(message) {
    const runtime = readTerminalRuntimeState(null);
    const pending = runtime.pendingQuestion;
    const pendingKind = runtime.pendingQuestionKind;
    const protocolControlled = Boolean(
        pending && (pending.protocolControlled === true || (pendingKind !== null && pendingKind !== 'question')),
    );
    if (!pending || protocolControlled) {
        return false;
    }
    return answerTerminalPendingQuestion(message, null);
}

/**
 * Envia uma mensagem em modo SDK immediate, preservando o turno atual no comando.
 *
 * @param {string} message
 * @returns {Promise<void>}
 */
async function _cmdSteer(message) {
    const prompt = message.trim();
    if (!prompt) {
        println('\x1b[33m  Uso: /steer <mensagem imediata para o turno ativo>\x1b[0m');
        return;
    }
    const interventionPolicy = getTerminalInterventionPolicy();
    if (interventionPolicy.enabled && !interventionPolicy.allowSteer) {
        if (tryApplyImmediateTerminalZeroPr(prompt)) {
            println('\x1b[36m  [zero-pr] intervenção aplicada imediatamente na pergunta pendente.\x1b[0m');
            return;
        }
        println('\x1b[33m  [steer] Bloqueado por política zero-PR para evitar consumo implícito de PR.\x1b[0m');
        const queued = enqueueRuntimeInterventionMailbox({
            runtimeId: null,
            source: 'terminal',
            modeHint: 'steer',
            message: prompt,
        });
        println(
            `\x1b[36m  [mailbox] intervenção registrada para próxima pergunta humana (fila=${queued.queueSize}${queued.dropped > 0 ? ` · descartadas=${queued.dropped}` : ''}).\x1b[0m`,
        );
        println(
            '\x1b[90m  Use /abort para interromper sem PR, ou /turn <mensagem> para abrir novo turno explicitamente.\x1b[0m',
        );
        return;
    }
    try {
        const messageId = await steerTerminalMessage(prompt);
        println(
            `\x1b[36m  [steer] Intervenção immediate enviada ao SDK${messageId ? ` (messageId=${messageId})` : ''}.\x1b[0m`,
        );
        println('\x1b[90m  Observação: /steer pode consumir PR via SDK immediate.\x1b[0m');
    } catch (e) {
        println(`\x1b[31m  [steer] Falha ao enviar intervenção imediata: ${toError(e).message}\x1b[0m`);
    }
}

/**
 * Aborta o turno SDK atual e enfileira uma substituição como próximo turno canônico.
 *
 * @param {string} message
 * @returns {Promise<void>}
 */
async function _cmdInterrupt(message) {
    await runTerminalInterventionSequence(async () => {
        const prompt = message.trim();
        if (!prompt) {
            await _cmdAbortCurrentTurn();
            return;
        }
        const interventionPolicy = getTerminalInterventionPolicy();
        if (interventionPolicy.enabled && !interventionPolicy.allowQueueFallback) {
            if (tryApplyImmediateTerminalZeroPr(prompt)) {
                println('\x1b[36m  [zero-pr] intervenção aplicada imediatamente na pergunta pendente.\x1b[0m');
                return;
            }
            const aborted = await _cmdAbortCurrentTurn();
            if (!aborted) {
                println('\x1b[31m  [interrupt] Abort falhou; nenhuma substituição foi aplicada.\x1b[0m');
                return;
            }
            const queued = enqueueRuntimeInterventionMailbox({
                runtimeId: null,
                source: 'terminal',
                modeHint: 'interrupt',
                message: prompt,
            });
            println(
                '\x1b[33m  [interrupt] Política zero-PR ativa: substituição não foi enfileirada como turno para evitar consumo de PR.\x1b[0m',
            );
            println(
                `\x1b[36m  [mailbox] mensagem substituta registrada para próxima pergunta humana (fila=${queued.queueSize}${queued.dropped > 0 ? ` · descartadas=${queued.dropped}` : ''}).\x1b[0m`,
            );
            println('\x1b[90m  Se precisar abrir novo turno manualmente, use /turn <mensagem>.\x1b[0m');
            return;
        }
        const aborted = await _cmdAbortCurrentTurn();
        if (!aborted) {
            println('\x1b[31m  [interrupt] Mensagem substituta não foi enviada porque o abort falhou.\x1b[0m');
            return;
        }
        const queuedBefore = getTurnQueueDepth();
        const turn = sendTurn(prompt, 'user');
        println(
            `\x1b[36m  [interrupt] Mensagem substituta enfileirada para a LLM-B (posição ${Math.max(1, queuedBefore + 1)}).\x1b[0m`,
        );
        void turn.catch((e) => {
            println(`\x1b[31m  [interrupt] Turno substituto falhou: ${toError(e).message}\x1b[0m`);
        });
    });
}

/**
 * Operações do mailbox zero-PR de intervenção.
 *
 * @param {string} arg
 * @returns {void}
 */
function _cmdMailbox(arg) {
    const [subRaw] = arg.trim().split(/\s+/).filter(Boolean);
    const sub = (subRaw ?? 'status').toLowerCase();
    if (sub === 'clear') {
        const removed = clearRuntimeInterventionMailbox(null);
        println(`\x1b[32m  [mailbox] limpo (${removed} item(ns) removido(s)).\x1b[0m`);
        return;
    }
    if (sub === 'consume' || sub === 'pop') {
        const entry = consumeRuntimeInterventionMailbox(null);
        if (!entry) {
            println('\x1b[33m  [mailbox] vazio.\x1b[0m');
            return;
        }
        println(
            `\x1b[36m  [mailbox] consumido ${entry.id} (${entry.source}/${entry.modeHint}) · ${entry.message.slice(0, 140)}\x1b[0m`,
        );
        deliverEntryAsTurnIfIdle(entry, 'manual_consume');
        return;
    }
    const summary = readRuntimeInterventionMailboxSummary(null);
    const latest = summary.latest;
    println(
        `\x1b[36m  [mailbox] fila=${summary.queueSize} · descartadas=${summary.dropped} · runtime=${summary.runtimeId}\x1b[0m`,
    );
    if (latest) {
        println(
            `\x1b[90m  latest=${latest.id} (${latest.source}/${latest.modeHint}) merges=${latest.mergedCount} · ${latest.message.slice(0, 180)}\x1b[0m`,
        );
    }
    println('\x1b[90m  comandos: /mailbox status | /mailbox consume | /mailbox clear\x1b[0m');
}

/**
 * Envia explicitamente uma mensagem como novo turno na fila canônica.
 *
 * Este comando existe para casos em que o operador quer conscientemente consumir PR.
 *
 * @param {string} message
 * @returns {Promise<void>}
 */
async function _cmdTurn(message) {
    const prompt = message.trim();
    if (!prompt) {
        println('\x1b[33m  Uso: /turn <mensagem>\x1b[0m');
        return;
    }
    const queuedBefore = getTurnQueueDepth();
    const wasBusy = readTerminalRuntimeControlState().status !== 'idle' || queuedBefore > 0;
    println(
        wasBusy
            ? `\x1b[36m  [turn] Turno explícito aguardando posição ${Math.max(1, queuedBefore + 1)} na fila canônica. Este caminho pode consumir PR.\x1b[0m`
            : '\x1b[36m  [turn] Turno explícito iniciado no foreground. Este caminho pode consumir PR.\x1b[0m',
    );
    try {
        const reply = await sendTurn(prompt, 'user');
        if (reply === null) {
            println('\x1b[33m  [turn] Turno explícito concluído sem resposta textual. Veja /errors ou /status.\x1b[0m');
        }
    } catch (e) {
        println(`\x1b[31m  [turn] Falha no turno explícito: ${toError(e).message}\x1b[0m`);
    }
}

/**
 * Enfileira uma intervenção na mailbox zero-PR sem abrir novo turno SDK.
 *
 * @param {string} message
 * @returns {void}
 */
function _cmdQueueMailbox(message) {
    const prompt = message.trim();
    if (!prompt) {
        println('\x1b[33m  Uso: /queue <mensagem>\x1b[0m');
        return;
    }
    if (tryApplyImmediateTerminalZeroPr(prompt)) {
        println('\x1b[36m  [queue] intervenção aplicada imediatamente na pergunta pendente (zero-PR).\x1b[0m');
        return;
    }
    const queued = enqueueRuntimeInterventionMailbox({
        runtimeId: null,
        source: 'terminal',
        modeHint: 'queue',
        message: prompt,
    });
    println(
        `\x1b[36m  [queue] intervenção enfileirada no mailbox zero-PR (fila=${queued.queueSize}${queued.dropped > 0 ? ` · descartadas=${queued.dropped}` : ''}).\x1b[0m`,
    );
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
 * Dispatcher para o cockpit de sessão SDK e snapshots locais.
 *
 * @param {string} subCmd
 * @param {string[]} rest
 */
async function _cmdSessionDispatch(subCmd, rest) {
    const parsed = parseTerminalSubcommand(subCmd, rest);
    const sub = parsed.subcommand.toLowerCase();
    if (!sub || sub === 'sdk') {
        await _cmdSessionSdk({ println }, sub === 'sdk' ? parsed.rest.join(' ') : '');
    } else if (sub === 'save') {
        await _cmdSessionSave({ println }, parsed.rest.join(' ') || undefined);
    } else if (sub === 'list') {
        await _cmdSessionList({ println });
    } else if (sub === 'restore') {
        await _cmdSessionRestore({ println }, parsed.rest[0] || '');
    } else {
        println(
            '\x1b[33m  Uso: /session [sdk [n]|sdk next <new|resume <id|#n|current|last|foreground>|auto>] | /session save [reason] | /session list | /session restore <id>\x1b[0m',
        );
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
    [['diagnose', 'diag', 'health'], (ctx, arg) => _cmdDiagnose({ hubSessionId: ctx.hubSessionId, println }, arg)],
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
    [['byok'], (ctx, arg) => _cmdByok({ println, eventBus: ctx.eventBus }, arg)],
    [['models'], (ctx, arg) => _cmdByok({ println, eventBus: ctx.eventBus }, `models ${arg}`.trim())],
    [['providers'], (ctx, arg) => _cmdByok({ println, eventBus: ctx.eventBus }, `providers ${arg}`.trim())],
    [['reasoning'], (_, arg) => _cmdReasoning({ println }, arg)],
    [['attach'], (_, arg) => _cmdAttach({ println }, arg)],
    [['context'], (_, arg) => _cmdContext({ println }, arg)],
    [['compact'], (_, arg) => _cmdCompact({ println }, arg)],
    [['plan'], (_, arg) => _cmdPlan({ println }, arg)],
    [['resume'], (ctx, arg) => _cmdResume({ println, hubSessionId: ctx.hubSessionId }, arg)],
    [['pause'], () => _cmdPauseDialogLoop()],
    [['dialog-resume'], () => _cmdDialogResume()],
    [['abort'], () => runTerminalInterventionSequence(_cmdAbortCurrentTurn)],
    [['steer'], (_, arg) => _cmdSteer(arg)],
    [['interrupt'], (_, arg) => _cmdInterrupt(arg)],
    [['mailbox', 'ivbox'], (_, arg) => _cmdMailbox(arg)],
    [['queue'], (_, arg) => _cmdQueueMailbox(arg)],
    [['turn'], (_, arg) => _cmdTurn(arg)],
    [['handoff'], () => _cmdHandoff()],
    [['skills'], (_, arg) => _cmdSkills({ println }, arg)],
    [['thinking'], (_, arg) => _cmdThinking({ println, printlnBlock }, arg)],
    [['intent', 'intents'], (_, arg) => _cmdIntent({ println, printlnBlock }, arg)],
    [['tools'], (_, arg) => _cmdTools({ println }, arg)],
    [['sdk'], (_, arg) => _cmdSdk({ println }, arg)],
    [['workspace', 'ws'], (_, arg) => _cmdWorkspace({ println }, arg)],
    [['fs', 'files'], (_, arg) => _cmdFs({ println }, arg)],
    [['scope', 'scopes'], (ctx, arg) => _cmdScope({ println, hubSessionId: ctx.hubSessionId }, arg)],
    [['index', 'idx'], (_, arg) => _cmdIndex({ println }, arg)],
    [['elicitation', 'elicit'], (_, arg) => _cmdElicitation({ println }, arg)],
    [['permission', 'perm'], (_, arg) => _cmdPermission({ println }, arg)],
    [['usage'], (_, arg) => _cmdUsage({ println }, arg)],
    [['errors'], (_, arg) => _cmdErrors({ println }, arg)],
    [['events'], (_, arg) => _cmdEvents({ println }, arg)],
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
    [['help'], (ctx, arg) => _cmdHelp({ println, injectPort: ctx.injectPort }, arg)],
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
 * Atualiza a porta efetiva usada pelos comandos do REPL após fallback de bind do servidor HTTP.
 *
 * @param {number} port
 * @returns {void}
 */
export function setTerminalCommandRouterInjectPort(port) {
    if (Number.isFinite(port) && port > 0) {
        activeInjectPort = Math.trunc(port);
    }
}

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
    const ctx = {
        println,
        hubSessionId: getHubSessionId(),
        injectPort: activeInjectPort,
        eventBus: container.has(EVENT_BUS) ? container.resolve(EVENT_BUS) : null,
    };
    const handler = _cmdRouteMap.get(cmd?.toLowerCase() ?? '');
    if (handler) {
        await handler(ctx, arg, rest, rl, injectServer, cleanup);
    } else {
        println(`\x1b[90m  Comando desconhecido: /${cmd}. Use /help para ver todos os comandos.\x1b[0m`);
    }
}
