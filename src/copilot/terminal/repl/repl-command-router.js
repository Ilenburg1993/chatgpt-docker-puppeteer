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
import { container } from '../../core/di-container.js';
import { logSwallowed } from '../../core/error-handlers.js';
import {
    clearRuntimeInterventionMailbox,
    consumeRuntimeInterventionMailbox,
    enqueueRuntimeInterventionMailbox,
    getHubSessionId,
    readRuntimeInterventionMailboxSummary,
    setRl,
} from '../../presentation/state/index.js';
import { promoteTerminalDeferredByokRouteSwitchesAtTurnBoundary } from '../byok/index.js';
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
    cmdRecall as _cmdRecall,
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
    cmdTerminal as _cmdTerminal,
    cmdTerminalLibs as _cmdTerminalLibs,
    cmdThinking as _cmdThinking,
    cmdTools as _cmdTools,
    cmdUsage as _cmdUsage,
    cmdWho as _cmdWho,
    cmdWorkspace as _cmdWorkspace,
} from '../commands/index.js';
import {
    ensureDialogLoop,
    getTurnQueueDepth,
    println,
    printlnBlock,
    readTerminalExclusiveTtyReadiness,
    sendTurn,
    withTerminalExclusiveTty,
} from '../dialog/index.js';
import {
    abortTerminalCurrentMessage,
    answerTerminalPendingQuestion,
    listTerminalSdkSessionInventory,
    offTerminalAgentRuntimeEvent,
    onceTerminalAgentRuntimeEvent,
    pauseTerminalDialogLoop,
    readTerminalHandoffHistory,
    readTerminalRuntimeControlState,
    readTerminalRuntimeState,
    resumeTerminalDialogLoop,
    scheduleTerminalSdkSessionBootSelection,
    startTerminalAgentRuntime,
    steerTerminalMessage,
    stopTerminalAgentRuntimeSession,
    stopTerminalDialogMode,
} from '../frontend/gateways/index.js';
import { clearRateLimiters } from '../state/repl-runtime/index.js';
import { terminalThemeHeadline, terminalThemeRow, terminalThemeRows } from '../state/repl/index.js';
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
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function countLabel(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * @param {{ queueSize: number; dropped?: number }} summary
 * @returns {string}
 */
function renderInterventionQueueTail(summary) {
    const dropped = Number(summary.dropped ?? 0);
    return `${countLabel(Number(summary.queueSize ?? 0), 'item', 'itens')} na fila${dropped > 0 ? ` · ${countLabel(dropped, 'descartada', 'descartadas')}` : ''}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderInterventionSourceLabel(value) {
    const source = String(value ?? '').trim();
    if (source === 'terminal') return 'terminal';
    if (source === 'llm-a') return 'LLM-A';
    if (source === 'user') return 'operador';
    return source.replace(/[._-]+/gu, ' ') || 'origem n/d';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderInterventionModeLabel(value) {
    const mode = String(value ?? '').trim();
    if (mode === 'queue') return 'fila';
    if (mode === 'steer') return 'intervenção imediata';
    if (mode === 'interrupt') return 'substituição após interrupção';
    if (mode === 'mailbox') return 'fila de intervenção';
    return mode.replace(/[._-]+/gu, ' ') || 'modo n/d';
}

/**
 * @typedef {{
 *     hubSessionId: string | null;
 *     injectPort: number;
 *     eventBus: import('../../core/event-bus.js').EventBus | null;
 * }} CmdCtx
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

/** F16.2 — Limpa rate limiters e reinicia a conversa (útil após throttling acidental). */
async function _cmdEmergencyReset() {
    println(terminalThemeRow('Reset de emergência', 'limpando limitadores locais', { role: 'warn' }));
    clearRateLimiters();
    println(terminalThemeRow('Reset de emergência', 'reiniciando conversa', { role: 'warn' }));
    await _cmdConversationRestart();
    println(terminalThemeRow('Reset de emergência', 'limitadores limpos e conversa reiniciada', { role: 'success' }));
}

async function _cmdConversationRestart() {
    println(terminalThemeRow('Conversa', 'reiniciando', { role: 'muted' }));
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
        println(terminalThemeRow('Conversa', `falha ao reiniciar · ${toError(e).message}`, { role: 'error' }));
        await ensureDialogLoop().catch((e) => logSwallowed(e, 'terminal.repl.ensureDialogLoop'));
    }
    println(terminalThemeRow('Conversa', 'reiniciada', { role: 'success' }));
}

/**
 * @param {string} target
 * @param {{
 *     currentSessionId: string | null;
 *     lastSessionId: string | null;
 *     foregroundSessionId: string | null;
 *     sessions: { sessionId: string }[];
 * }} inventory
 * @returns {{ sessionId: string; source: string } | null}
 */
function resolveRestartSdkSessionResumeTarget(target, inventory) {
    const clean = target.trim();
    const normalized = clean.toLowerCase();
    if ((normalized === 'current' || normalized === 'atual') && inventory.currentSessionId) {
        return { sessionId: inventory.currentSessionId, source: 'atual' };
    }
    if ((normalized === 'last' || normalized === 'ultima' || normalized === 'última') && inventory.lastSessionId) {
        return { sessionId: inventory.lastSessionId, source: 'última usada' };
    }
    if (
        (normalized === 'foreground' || normalized === 'primeiro-plano' || normalized === 'primeiro_plano') &&
        inventory.foregroundSessionId
    ) {
        return { sessionId: inventory.foregroundSessionId, source: 'primeiro plano' };
    }
    const indexed = /^#(?<index>\d+)$/u.exec(clean);
    if (indexed?.groups?.['index']) {
        const index = Number.parseInt(indexed.groups['index'], 10) - 1;
        const entry = inventory.sessions[index];
        return entry ? { sessionId: entry.sessionId, source: clean } : null;
    }
    return clean ? { sessionId: clean, source: 'id' } : null;
}

/**
 * @param {string[]} tokens
 * @returns {Promise<string | null>}
 */
async function scheduleRestartSdkSessionBootSelection(tokens) {
    if (tokens.length === 0) {
        return 'executar seleção SDK pendente/automática';
    }
    const [rawMode = '', ...modeRest] = tokens;
    const mode = rawMode.toLowerCase();
    if (mode === 'new') {
        const result = await scheduleTerminalSdkSessionBootSelection({ mode: 'new' });
        if (!result.ok) throw result.error;
        return 'criar nova sessão SDK';
    }
    if (mode === 'resume') {
        const target = modeRest.join(' ').trim();
        if (!target) {
            println(terminalThemeRow('Uso', '/restart resume <id|#n|atual|última|primeiro-plano>', { role: 'warn' }));
            return null;
        }
        let resolved;
        if (/^(?:#\d+|current|last|foreground|atual|ultima|última|primeiro[-_]plano)$/iu.test(target)) {
            const inventory = await listTerminalSdkSessionInventory();
            resolved = resolveRestartSdkSessionResumeTarget(target, inventory);
        } else {
            resolved = resolveRestartSdkSessionResumeTarget(target, {
                currentSessionId: null,
                lastSessionId: null,
                foregroundSessionId: null,
                sessions: [],
            });
        }
        if (!resolved) {
            println(
                terminalThemeRow(
                    'Sessão SDK',
                    `não resolvida para ${target} · rode /session sdk para ver o inventário`,
                    { role: 'warn' },
                ),
            );
            return null;
        }
        const result = await scheduleTerminalSdkSessionBootSelection({
            mode: 'resume',
            sessionId: resolved.sessionId,
        });
        if (!result.ok) throw result.error;
        return `retomar sessão SDK${resolved.source === 'id' ? ' informada' : ` ${resolved.source}`}`;
    }
    if (mode === 'auto' || mode === 'clear') {
        const result = await scheduleTerminalSdkSessionBootSelection(null);
        if (!result.ok) throw result.error;
        return 'usar seleção automática de sessão SDK';
    }
    println(
        terminalThemeRow('Uso', '/restart [new|resume <id|#n|atual|última|primeiro-plano>|auto]', { role: 'warn' }),
    );
    return null;
}

/**
 * @param {string[] | string} args
 * @returns {Promise<void>}
 */
async function _cmdRestartSdkSession(args = []) {
    const tokens = Array.isArray(args) ? args.filter(Boolean) : args.split(/\s+/u).filter(Boolean);
    try {
        const selectionLabel = await scheduleRestartSdkSessionBootSelection(tokens);
        if (!selectionLabel) return;
        println(terminalThemeRow('Sessão SDK', `${selectionLabel} no restart`, { role: 'success' }));
        const promoted = await promoteTerminalDeferredByokRouteSwitchesAtTurnBoundary({
            source: 'terminal.restart_sdk_session.route_promotion',
        }).catch((error) => {
            println(
                terminalThemeRow('BYOK', `promoção diferida ignorada · ${toError(error).message}`, { role: 'warn' }),
            );
            return null;
        });
        if (promoted && promoted.promoted > 0) {
            println(
                terminalThemeRow('BYOK', `${promoted.promoted} rota(s) diferida(s) promovida(s) antes do restart`, {
                    role: 'success',
                }),
            );
        }
        println(terminalThemeRow('Sessão SDK', 'encerrando runtime atual', { role: 'muted' }));
        const { promise: readyPromise, resolve: resolveReady, reject: rejectReady } = Promise.withResolvers();
        /** @type {ReturnType<typeof setTimeout> | null} */
        let timeout = setTimeout(
            () => rejectReady(new Error(`Timeout aguardando sessão SDK (${RESTART_WAIT_TIMEOUT_MS}ms)`)),
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
        await stopTerminalAgentRuntimeSession(null, { preserveDialogLoopIntent: true });
        await startTerminalAgentRuntime();
        if (!readTerminalRuntimeControlState().dialogLoopActive) {
            await readyPromise;
        } else {
            settled = true;
            cleanupReadyWait();
        }
        const state = readTerminalRuntimeControlState();
        println(
            terminalThemeRow(
                'Sessão SDK',
                `reiniciada · sessionId ${state.sessionId ?? 'n/d'} · modelo ${state.model}`,
                { role: 'success' },
            ),
        );
    } catch (e) {
        println(terminalThemeRow('Sessão SDK', `falha ao reiniciar · ${toError(e).message}`, { role: 'error' }));
        await ensureDialogLoop().catch((error) =>
            logSwallowed(error, 'terminal.repl.restartSdkSession.ensureDialogLoop'),
        );
    }
}

async function _cmdPauseDialogLoop() {
    try {
        await pauseTerminalDialogLoop();
        println(
            terminalThemeRow('Conversa', 'pausada · use /dialog-resume para retomar sem consumir PR', { role: 'warn' }),
        );
    } catch (e) {
        println(terminalThemeRow('Conversa', `erro ao pausar · ${toError(e).message}`, { role: 'error' }));
    }
}

async function _cmdDialogResume() {
    try {
        await resumeTerminalDialogLoop();
        println(terminalThemeRow('Conversa', 'retomada', { role: 'success' }));
    } catch (e) {
        println(terminalThemeRow('Conversa', `erro ao retomar · ${toError(e).message}`, { role: 'error' }));
    }
}

/**
 * @returns {Promise<boolean>} true quando o abort foi aceito pelo runtime.
 */
async function _cmdAbortCurrentTurn() {
    try {
        await abortTerminalCurrentMessage();
        println(
            terminalThemeRow('Abortar turno', 'turno SDK ativo abortado; a próxima mensagem da fila pode prosseguir', {
                role: 'warn',
            }),
        );
        return true;
    } catch (e) {
        println(
            terminalThemeRow('Abortar turno', `falha ao abortar turno ativo · ${toError(e).message}`, {
                role: 'error',
            }),
        );
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
 * Tenta aplicar intervenção imediatamente em pergunta humana pendente, sem abrir novo turno.
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
        println(terminalThemeRow('/steer', 'Uso: /steer <mensagem imediata para o turno ativo>', { role: 'command' }));
        return;
    }
    const interventionPolicy = getTerminalInterventionPolicy();
    if (interventionPolicy.enabled && !interventionPolicy.allowSteer) {
        if (tryApplyImmediateTerminalZeroPr(prompt)) {
            println(
                terminalThemeRow('Intervenção', 'aplicada imediatamente na pergunta pendente', { role: 'success' }),
            );
            return;
        }
        println(
            terminalThemeRow('/steer', 'bloqueado para evitar consumo implícito de PR', {
                role: 'warn',
            }),
        );
        const queued = enqueueRuntimeInterventionMailbox({
            runtimeId: null,
            source: 'terminal',
            modeHint: 'steer',
            message: prompt,
        });
        println(
            terminalThemeRow(
                'Intervenção',
                `guardada para a próxima pergunta humana (${renderInterventionQueueTail(queued)})`,
                { role: 'success' },
            ),
        );
        println(
            terminalThemeRow(
                'Próximo',
                'Use /abort para interromper sem PR, ou /turn <mensagem> para abrir novo turno explicitamente.',
            ),
        );
        return;
    }
    try {
        const messageId = await steerTerminalMessage(prompt);
        println(
            terminalThemeRow(
                '/steer',
                `intervenção immediate enviada ao SDK${messageId ? ` (mensagem ${messageId})` : ''}`,
                { role: 'success' },
            ),
        );
        println(terminalThemeRow('Nota', '/steer pode consumir PR via SDK immediate.'));
    } catch (e) {
        println(
            terminalThemeRow('/steer', `falha ao enviar intervenção imediata: ${toError(e).message}`, {
                role: 'error',
            }),
        );
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
                println(
                    terminalThemeRow('Intervenção', 'aplicada imediatamente na pergunta pendente', { role: 'success' }),
                );
                return;
            }
            const aborted = await _cmdAbortCurrentTurn();
            if (!aborted) {
                println(
                    terminalThemeRow('/interrupt', 'abort falhou; nenhuma substituição foi aplicada', {
                        role: 'error',
                    }),
                );
                return;
            }
            const queued = enqueueRuntimeInterventionMailbox({
                runtimeId: null,
                source: 'terminal',
                modeHint: 'interrupt',
                message: prompt,
            });
            println(
                terminalThemeRow(
                    '/interrupt',
                    'substituição preservada fora de novo turno para evitar consumo implícito de PR',
                    { role: 'warn' },
                ),
            );
            println(
                terminalThemeRow(
                    'Intervenção',
                    `substituição guardada para a próxima pergunta humana (${renderInterventionQueueTail(queued)})`,
                    { role: 'success' },
                ),
            );
            println(terminalThemeRow('Próximo', 'Se precisar abrir novo turno manualmente, use /turn <mensagem>.'));
            return;
        }
        const aborted = await _cmdAbortCurrentTurn();
        if (!aborted) {
            println(
                terminalThemeRow('/interrupt', 'mensagem substituta não foi enviada porque o abort falhou', {
                    role: 'error',
                }),
            );
            return;
        }
        const queuedBefore = getTurnQueueDepth();
        const turn = sendTurn(prompt, 'user');
        println(
            terminalThemeRow(
                '/interrupt',
                `mensagem substituta enfileirada para a LLM-B (posição ${Math.max(1, queuedBefore + 1)})`,
                { role: 'success' },
            ),
        );
        void turn.catch((e) => {
            println(
                terminalThemeRow('/interrupt', `turno substituto falhou: ${toError(e).message}`, { role: 'error' }),
            );
        });
    });
}

/**
 * Operações da fila de intervenção.
 *
 * @param {string} arg
 * @returns {void}
 */
function _cmdMailbox(arg) {
    const [subRaw] = arg.trim().split(/\s+/).filter(Boolean);
    const sub = (subRaw ?? 'status').toLowerCase();
    if (sub === 'clear') {
        const removed = clearRuntimeInterventionMailbox(null);
        println(
            terminalThemeRow(
                'Fila de intervenção',
                `limpa · ${countLabel(removed, 'item removido', 'itens removidos')}`,
                { role: 'success' },
            ),
        );
        return;
    }
    if (sub === 'consume' || sub === 'pop') {
        const entry = consumeRuntimeInterventionMailbox(null);
        if (!entry) {
            println(terminalThemeRow('Fila de intervenção', 'vazia', { role: 'warn' }));
            return;
        }
        println(
            terminalThemeRow(
                'Fila de intervenção',
                `consumida · origem ${renderInterventionSourceLabel(entry.source)} · ${renderInterventionModeLabel(entry.modeHint)} · ${entry.message.slice(0, 140)}`,
                { role: 'success' },
            ),
        );
        deliverEntryAsTurnIfIdle(entry, 'manual_consume');
        return;
    }
    const summary = readRuntimeInterventionMailboxSummary(null);
    const latest = summary.latest;
    println(
        terminalThemeRow(
            'Fila de intervenção',
            `${countLabel(summary.queueSize, 'item', 'itens')} na fila · ${countLabel(summary.dropped, 'descartada', 'descartadas')}`,
        ),
    );
    if (latest) {
        println(
            terminalThemeRow(
                'Última',
                `origem ${renderInterventionSourceLabel(latest.source)} · ${renderInterventionModeLabel(latest.modeHint)} · mesclas ${latest.mergedCount} · ${latest.message.slice(0, 180)}`,
            ),
        );
    }
    println(terminalThemeRow('Comandos', '/queue status · /queue consume · /queue clear', { role: 'command' }));
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
        println(terminalThemeRow('/turn', 'Uso: /turn <mensagem>', { role: 'command' }));
        return;
    }
    const queuedBefore = getTurnQueueDepth();
    const wasBusy = readTerminalRuntimeControlState().status !== 'idle' || queuedBefore > 0;
    println(
        wasBusy
            ? terminalThemeRow(
                  '/turn',
                  `turno explícito aguardando posição ${Math.max(1, queuedBefore + 1)} na fila canônica. Este caminho pode consumir PR.`,
                  { role: 'warn' },
              )
            : terminalThemeRow('/turn', 'turno explícito iniciado no foreground. Este caminho pode consumir PR.', {
                  role: 'warn',
              }),
    );
    try {
        const reply = await sendTurn(prompt, 'user');
        if (reply === null) {
            println(
                terminalThemeRow('/turn', 'turno explícito concluído sem resposta textual. Veja /errors ou /status.', {
                    role: 'warn',
                }),
            );
        }
    } catch (e) {
        println(terminalThemeRow('/turn', `falha no turno explícito: ${toError(e).message}`, { role: 'error' }));
    }
}

/**
 * Enfileira uma intervenção sem abrir novo turno SDK.
 *
 * @param {string} message
 * @returns {void}
 */
function _cmdQueueMailbox(message) {
    const prompt = message.trim();
    if (/^(status|clear|consume|pop)$/iu.test(prompt)) {
        _cmdMailbox(prompt);
        return;
    }
    if (!prompt) {
        _cmdMailbox('status');
        println(
            terminalThemeRow('Uso', '/queue <mensagem> · /queue status · /queue consume · /queue clear', {
                role: 'command',
            }),
        );
        return;
    }
    if (tryApplyImmediateTerminalZeroPr(prompt)) {
        println(
            terminalThemeRow('Intervenção', 'aplicada imediatamente na pergunta pendente', {
                role: 'success',
            }),
        );
        return;
    }
    const queued = enqueueRuntimeInterventionMailbox({
        runtimeId: null,
        source: 'terminal',
        modeHint: 'queue',
        message: prompt,
    });
    println(
        terminalThemeRow(
            'Fila',
            `intervenção guardada para a próxima pergunta humana (${renderInterventionQueueTail(queued)})`,
            { role: 'success' },
        ),
    );
}

function _cmdHandoff() {
    const history = readTerminalHandoffHistory();
    if (!history) {
        println(terminalThemeRow('Handoff', 'gerenciador não disponível', { role: 'error' }));
        return;
    }
    if (history.length === 0) {
        println(terminalThemeRow('Handoff', 'nenhuma troca registrada nesta sessão', { role: 'muted' }));
        return;
    }
    println(terminalThemeHeadline('info', 'Histórico de handoff', [`${history.length} registros`]));
    for (const h of history) {
        const ts = new Date(Number(h.receivedAt)).toISOString();
        println(
            terminalThemeRow(
                `${h.fromAgent} → ${h.toAgent}`,
                `${ts} · motivo ${h.reason ?? 'n/d'} · status ${h.status}`,
                { role: 'info' },
            ),
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
    println(terminalThemeRow('Sessão', 'encerrando terminal', { role: 'muted' }));
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
    const sdkRestart = sub === 'sdk' && parsed.rest[0]?.toLowerCase() === 'restart';
    if (sdkRestart) {
        await _cmdRestartSdkSession(parsed.rest.slice(1));
    } else if (sub === 'restart') {
        await _cmdRestartSdkSession(parsed.rest);
    } else if (!sub || sub === 'sdk') {
        await _cmdSessionSdk({ println }, sub === 'sdk' ? parsed.rest.join(' ') : '');
    } else if (sub === 'save') {
        await _cmdSessionSave({ println }, parsed.rest.join(' ') || undefined);
    } else if (sub === 'list') {
        await _cmdSessionList({ println });
    } else if (sub === 'restore') {
        await _cmdSessionRestore({ println }, parsed.rest[0] || '');
    } else {
        println(
            terminalThemeRows(
                'Uso',
                [
                    '/session sdk [n]',
                    '/session sdk next <new|resume <id|#n|current|last|foreground>|auto>',
                    '/session sdk restart <new|resume <id|#n|current|last|foreground>|auto>',
                    '/session save [reason]',
                    '/session list',
                    '/session restore <id>',
                ],
                { role: 'command' },
            ),
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
    [['health'], (ctx, arg) => _cmdDiagnose({ hubSessionId: ctx.hubSessionId, println }, arg)],
    [
        ['diagnose', 'diag'],
        (ctx, arg) => _cmdDiagnose({ hubSessionId: ctx.hubSessionId, println }, arg?.trim() ? arg : 'full'),
    ],
    [['history'], (_, arg) => _cmdHistory({ println }, Number(arg) || 10)],
    [
        ['db-history'],
        (ctx, arg, rest) =>
            _cmdDbHistory({ hubSessionId: ctx.hubSessionId, println }, Number(arg) || 20, Number(rest[0]) || 0),
    ],
    [['db-sessions'], (ctx, arg) => _cmdDbSessions({ hubSessionId: ctx.hubSessionId, println }, Number(arg) || 10)],
    [['remember'], (ctx, arg) => _cmdRemember({ hubSessionId: ctx.hubSessionId, println }, arg)],
    [['recall'], (_, arg) => _cmdRecall({ println }, arg)],
    [['forget'], (ctx, arg) => _cmdForget({ hubSessionId: ctx.hubSessionId, println }, arg)],
    [['who'], (ctx, arg) => _cmdWho({ injectPort: ctx.injectPort, println }, arg)],
    [['clear'], () => _cmdClear({ println })],
    [['answer'], (_, arg) => _cmdAnswer({ println }, arg)],
    [['clear-shadow'], () => _cmdClearShadow({ println })],
    [['count'], (ctx) => _cmdCount({ hubSessionId: ctx.hubSessionId, println })],
    [['restart'], (_, arg) => _cmdRestartSdkSession(arg)],
    [['conversation-restart', 'dialog-restart'], () => _cmdConversationRestart()],
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
    [['terminal'], (_, arg) => _cmdTerminal({ println }, arg)],
    [['libs', 'terminal-libs'], (_, arg) => _cmdTerminalLibs({ println }, arg)],
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
                readExclusiveTtyReadiness: () => readTerminalExclusiveTtyReadiness(rl, { ignoreRenderLock: true }),
                withExclusiveTty: (operation) => withTerminalExclusiveTty(rl, operation, { ignoreRenderLock: true }),
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
        println(
            terminalThemeRow('Comando', `/${cmd} não existe. Use /help para ver todos os comandos.`, { role: 'warn' }),
        );
    }
}
