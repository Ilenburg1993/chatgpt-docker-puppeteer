// @ts-check
/**
 * src/copilot/terminal/dialog/engine.js
 *
 * @module copilot/terminal/dialog/engine
 * @see EventBus
 */

import { emitNerv } from '#copilot/bridges';
import { LLM_B_BOOT_TIMEOUT_MS } from '#copilot/config';
import { cancelTimer, container, registerInterval, sleepMs, toError } from '#copilot/core';
import { log, METRICS_STORE } from '#copilot/observability';
import { resolveOptionalDialogTimeout } from '../../presentation/dialog-timeout-policy.js';
import { embedMultiple, readFileContext } from '../../presentation/files/index.js';
import { describeSdkRecoveryPolicy, getSdkRecoveryPolicy } from '../../presentation/sdk/index.js';
import {
    clearAttachments,
    getAttachmentQueue,
    getHubSessionId,
    getRl,
    getShowStreaming,
    getShowThinking,
    getShowUsage,
    setBusy,
} from '../../presentation/state/index.js';
import {
    readTerminalDialogStreamMeta,
    readTerminalRuntimeControlState,
    readTerminalRuntimeState,
    runTerminalDialogTurn,
    startTerminalAgentRuntime,
    startTerminalDialogMode,
} from '../frontend/gateways/index.js';
import { normalizeTerminalModelBillingProjection } from '../frontend/projections/index.js';
import { markTerminalActivityIdle, recordTerminalActivity } from '../state/dialog/index.js';
import { drainPendingNotifications, getPersistenceFailureCount, persistTurnToHub } from './engine-persistence.js';
import {
    BOOT_PROMPT,
    buildUserPrompt,
    buildWaitingPrompt,
    clearInlineStatus,
    printExchange,
    println,
    SEPARATOR,
    TURN_TIMEOUT_MS,
    writeInlineStatus,
} from './output.js';
import { broadcastSse } from './sse.js';
import {
    createDeltaCallback,
    createDisplayState,
    createReasoningCallback,
    renderStreamingFooter,
} from './turn-display.js';

export { drainPendingNotifications, getPersistenceFailureCount };

const MAX_TURN_QUEUE_SIZE = 10;
/** @type {number} */
let _turnQueueDepth = 0;

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

const IDLE_TRANSITION_TIMEOUT_MS = resolveBoundedTimeoutMs(LLM_B_BOOT_TIMEOUT_MS, 60_000);

/**
 * Retorna a profundidade atual da fila de turnos.
 *
 * @returns {number}
 */
export function getTurnQueueDepth() {
    return _turnQueueDepth;
}
/** @type {Promise<string | null>} */
let _sendTurnMutex = Promise.resolve(null);
/** @type {Promise<void> | null} */
let _ensureDialogLoopInFlight = null;

const WAITING_FRAMES = ['⏳', '⌛', '⏳'];
const LIVE_TURN_NARRATION_INTERVAL_MS = 10_000;

/**
 * @param {{
 *     startedAt: number;
 *     model: string;
 *     effort: string;
 *     timeoutMs: number | null;
 *     timeoutStrategy: 'explicit' | 'adaptive' | 'disabled';
 * }} opts
 * @returns {string}
 */
function formatLiveWaitingStatus({ startedAt, model, effort, timeoutMs, timeoutStrategy }) {
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const elapsed = `${(elapsedMs / 1000).toFixed(1)}s`;
    const frame = WAITING_FRAMES[Math.floor(elapsedMs / 600) % WAITING_FRAMES.length] ?? '⏳';
    const elapsedRatio = timeoutMs && timeoutMs > 0 ? elapsedMs / timeoutMs : 0;
    const elapsedColor = elapsedRatio >= 0.85 ? '\x1b[31m' : elapsedRatio >= 0.6 ? '\x1b[33m' : '\x1b[90m';
    const timeoutLabel = timeoutMs === null ? 'watchdog' : `${Math.max(1, Math.round(timeoutMs / 1000))}s`;
    const strategyLabel = timeoutStrategy === 'disabled' ? 'no-timeout' : timeoutStrategy;
    const quickActions =
        elapsedMs >= 30_000
            ? ' \x1b[90m[/status] [/errors] [/restart]\x1b[0m'
            : elapsedMs >= 15_000
              ? ' \x1b[90m[/status] [/errors]\x1b[0m'
              : '';
    return `  \x1b[90m${frame} aguardando \x1b[36m${model}\x1b[90m · \x1b[35m${effort}\x1b[90m · ${elapsedColor}${elapsed}\x1b[0m\x1b[90m · ${timeoutLabel}/${strategyLabel}…\x1b[0m${quickActions}`;
}

/**
 * READY pendente significa que o SDK já entregou o `ask_user` controlado pelo protocolo e o loop está semanticamente
 * vivo, mesmo que um snapshot operacional ainda esteja se atualizando após timeout/recovery.
 *
 * @returns {boolean}
 */
function hasReadyProtocolQuestion() {
    const state = readTerminalRuntimeState();
    return state.status === 'waiting_for_input' && state.pendingQuestionKind === 'ready';
}

/**
 * Garante que o dialog loop está ativo. Se não estiver, inicia-o.
 *
 * @returns {Promise<void>}
 */
export function ensureDialogLoop() {
    const runtimeState = readTerminalRuntimeControlState();
    if (runtimeState.dialogLoopActive) {
        return Promise.resolve();
    }
    if (hasReadyProtocolQuestion()) {
        log('WARN', '[dialog] ensureDialogLoop() tratou READY pendente como loop ativo recuperado.');
        return Promise.resolve();
    }
    if (runtimeState.dialogPaused) {
        log('INFO', '[dialog] ensureDialogLoop() ignorado — dialogPaused=true (pausado pelo usuário)');
        return Promise.resolve();
    }
    if (_ensureDialogLoopInFlight !== null) {
        return _ensureDialogLoopInFlight;
    }
    _ensureDialogLoopInFlight = _doEnsureDialogLoop().finally(() => {
        _ensureDialogLoopInFlight = null;
    });
    return _ensureDialogLoopInFlight;
}

/**
 * Implementação interna de ensureDialogLoop com retry.
 *
 * @returns {Promise<void>}
 */
async function _doEnsureDialogLoop() {
    const MAX_RETRIES = 3;
    let attempt = 0;

    while (attempt <= MAX_RETRIES) {
        try {
            await _tryStartDialogLoop();
            return;
        } catch (err) {
            attempt++;
            const sdkRecoveryPolicy = getSdkRecoveryPolicy(err, 'session');
            if (sdkRecoveryPolicy.kind !== 'unknown' && !sdkRecoveryPolicy.allowReconnect) {
                const message = toError(err).message;
                const recoveryMessage = describeSdkRecoveryPolicy(sdkRecoveryPolicy, err);
                log(
                    'WARN',
                    `[dialog] ensureDialogLoop pausado por policy SDK (kind=${sdkRecoveryPolicy.kind}): ${message}`,
                );
                recordTerminalActivity('error', 'Boot do dialog loop bloqueado pela policy SDK', {
                    detail: message,
                    severity: 'warn',
                    source: 'sdk',
                });
                println(`\n\x1b[31m  ${recoveryMessage.label}\x1b[0m ${recoveryMessage.headline}`);
                println(`  \x1b[90m${recoveryMessage.detail}\x1b[0m`);
                println(`  \x1b[90m${recoveryMessage.actionHint}\x1b[0m`);
                emitNerv('copilot:dialog:boot_blocked', {
                    error: message,
                    reason: `sdk_${sdkRecoveryPolicy.kind}`,
                    actionHint: recoveryMessage.actionHint,
                    severity: 'warn',
                });
                return;
            }
            if (attempt > MAX_RETRIES) {
                log(
                    'ERROR',
                    `[dialog] ensureDialogLoop falhou após ${MAX_RETRIES} tentativas: ${toError(err).message}`,
                );
                emitNerv('copilot:dialog:boot_failed', {
                    error: toError(err).message,
                    attempts: MAX_RETRIES,
                    severity: 'error',
                });
                throw err;
            }
            const delay = 2000 * 2 ** (attempt - 1);
            log(
                'WARN',
                `[dialog] ensureDialogLoop falhou (tentativa ${attempt}/${MAX_RETRIES}) — retry em ${delay}ms: ${toError(err).message}`,
            );
            await sleepMs(delay, { id: `terminal.dialog.ensure-retry:${attempt}`, unref: true });
        }
    }
}

/**
 * Tenta iniciar o dialog loop uma vez.
 *
 * @returns {Promise<void>}
 */
async function _tryStartDialogLoop() {
    let status = readTerminalRuntimeControlState().status;
    if (status === 'starting') {
        recordTerminalActivity('boot', 'Aguardando boot do agente', {
            detail: 'Status=starting antes de iniciar dialog loop',
            source: 'dialog',
        });
        println('\x1b[90m  Aguardando boot do agente concluir…\x1b[0m');
        const deadline = Date.now() + IDLE_TRANSITION_TIMEOUT_MS;
        while (Date.now() < deadline) {
            status = readTerminalRuntimeControlState().status;
            if (status !== 'starting') break;
            await sleepMs(500, { id: 'terminal.dialog.wait-starting-transition', unref: true });
        }
        status = readTerminalRuntimeControlState().status;
        if (status === 'starting') {
            throw new Error(`Timeout aguardando transição de status 'starting' (${IDLE_TRANSITION_TIMEOUT_MS}ms)`);
        }
    }

    if (status === 'stopped') {
        recordTerminalActivity('boot', 'Iniciando agente', {
            detail: 'AlwaysAliveAgent start()',
            source: 'dialog',
        });
        println('\x1b[90m  Iniciando AlwaysAliveAgent…\x1b[0m');
        await startTerminalAgentRuntime();
        const deadline = Date.now() + IDLE_TRANSITION_TIMEOUT_MS;
        while (Date.now() < deadline) {
            if (readTerminalRuntimeControlState().status === 'idle') break;
            await sleepMs(500, { id: 'terminal.dialog.wait-idle.after-start', unref: true });
        }
        if (readTerminalRuntimeControlState().status !== 'idle') {
            throw new Error(`Timeout aguardando idle (${IDLE_TRANSITION_TIMEOUT_MS}ms)`);
        }
    }

    if (readTerminalRuntimeControlState().status === 'processing') {
        recordTerminalActivity('boot', 'Aguardando agente ficar idle', {
            detail: 'Há trabalho em andamento antes do dialog loop',
            source: 'dialog',
        });
        println('\x1b[90m  Aguardando agente concluir tarefa em andamento…\x1b[0m');
        const deadline = Date.now() + IDLE_TRANSITION_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const s = readTerminalRuntimeControlState().status;
            if (s === 'idle') break;
            if (s === 'stopped') {
                throw new Error(`Agente parado inesperadamente antes de dialog loop`);
            }
            await sleepMs(500, { id: 'terminal.dialog.wait-idle.after-processing', unref: true });
        }
        if (readTerminalRuntimeControlState().status !== 'idle') {
            throw new Error(`Timeout aguardando idle após processing (${IDLE_TRANSITION_TIMEOUT_MS}ms)`);
        }
    }

    if (hasReadyProtocolQuestion()) {
        markTerminalActivityIdle('Aguardando próxima mensagem');
        log('WARN', '[dialog] startDialogLoop() pulado — READY pendente já está aguardando input.');
        return;
    }

    recordTerminalActivity('boot', 'Conectando ao dialog loop', {
        detail: 'Iniciando protocolo READY/REPLY do terminal',
        source: 'dialog',
    });
    println('\x1b[90m  Conectando ao agente…\x1b[0m');
    const resumeSessionAttach = true;
    log('INFO', '[dialog] reanexando terminal sem boot prompt automático.');
    println('\x1b[90m  Reanexando sessão SDK sem boot prompt…\x1b[0m');
    await startTerminalDialogMode(resumeSessionAttach ? undefined : (BOOT_PROMPT ?? undefined), {
        resumeSessionAttach,
        onReady: () => println('\n  \x1b[32m●\x1b[0m  LLM-B pronta — pode começar\n'),
    });
}

/**
 * Envia um turno de diálogo para a LLM-B e exibe a resposta.
 *
 * @param {string} message - Mensagem a enviar
 * @param {string} [actor] - Quem está enviando ('user' | 'llm-a')
 * @returns {Promise<string | null>}
 */
export function sendTurn(message, actor = 'user') {
    if (_turnQueueDepth >= MAX_TURN_QUEUE_SIZE) {
        log(
            'WARN',
            `[TerminalServer] Fila de turnos cheia (${_turnQueueDepth}/${MAX_TURN_QUEUE_SIZE}) — rejeitando mensagem de ${actor}.`,
        );
        return Promise.resolve(null);
    }

    const attachments = actor === 'user' ? getAttachmentQueue() : [];
    if (attachments.length > 0) {
        clearAttachments();
    }

    _turnQueueDepth++;
    const next = _sendTurnMutex.then(() => _executeTurn(message, actor, attachments)).catch(() => null);
    _sendTurnMutex = next.then(
        () => null,
        () => null,
    );
    void next.finally(() => {
        _turnQueueDepth--;
        if (_turnQueueDepth === 0) {
            _sendTurnMutex = Promise.resolve(null);
        }
    });
    return next;
}

/**
 * Implementação interna do turno.
 *
 * @param {string} message
 * @param {string} actor
 * @param {string[]} attachments
 * @returns {Promise<string | null>}
 */
async function _executeTurn(message, actor, attachments = []) {
    const t0 = Date.now();
    const runtimeState = readTerminalRuntimeState();
    const ctxState = runtimeState.contextWindow;
    if (ctxState) {
        const u = ctxState.utilization;
        if (u >= 0.95) {
            println(
                `\x1b[31m  ⛔ Context window em ${(u * 100).toFixed(0)}% — risco de perda de contexto. Use /compact antes de continuar.\x1b[0m`,
            );
        } else if (u >= 0.85) {
            println(
                `\x1b[33m  ⚠️  Context window em ${(u * 100).toFixed(0)}% — considere usar /compact em breve.\x1b[0m`,
            );
        }
    }

    const metricsSummary = (() => {
        try {
            return container.resolve(METRICS_STORE).getSummary();
        } catch {
            return null;
        }
    })();
    const timeoutDecision = resolveOptionalDialogTimeout({
        explicitTimeoutMs: 0,
        allowDisabled: true,
        defaultTimeoutMs: TURN_TIMEOUT_MS,
        queueDepth: runtimeState.queueSize,
        contextUtilization: runtimeState.contextWindow?.utilization,
        recentP50Ms: Number(metricsSummary?.dialog?.turnLatency?.p50 ?? 0),
        recentP95Ms: Number(metricsSummary?.dialog?.turnLatency?.p95 ?? 0),
        recentP99Ms: Number(metricsSummary?.dialog?.turnLatency?.p99 ?? 0),
    });

    setBusy(true);
    recordTerminalActivity('turn', actor === 'llm-a' ? 'Processando mensagem da LLM-A' : 'Processando mensagem', {
        detail: message.slice(0, 120),
        source: 'dialog',
    });
    broadcastSse('busy', { busy: true, actor });
    const rl = getRl();
    /** @type {NodeJS.Timeout | null} */
    let waitingTicker = null;
    /** @type {string | null} */
    let waitingTickerId = null;
    /** @type {{ firstOutputAt: number; lastNarrationAt: number; model: string; effort: string }} */
    const liveTurnSignal = { firstOutputAt: 0, lastNarrationAt: 0, model: '-', effort: '-' };
    if (rl) {
        const { model, reasoningEffort } = readTerminalDialogStreamMeta();
        const effort = reasoningEffort;
        liveTurnSignal.model = model;
        liveTurnSignal.effort = effort;
        const renderWaitingStatus = () =>
            writeInlineStatus(
                formatLiveWaitingStatus({
                    startedAt: t0,
                    model,
                    effort,
                    timeoutMs: timeoutDecision.timeoutMs,
                    timeoutStrategy: timeoutDecision.strategy,
                }),
            );
        const narrateWaitingStatus = () => {
            const now = Date.now();
            const elapsedMs = Math.max(0, now - t0);
            if (liveTurnSignal.firstOutputAt > 0 || elapsedMs < LIVE_TURN_NARRATION_INTERVAL_MS) return;
            if (now - liveTurnSignal.lastNarrationAt < LIVE_TURN_NARRATION_INTERVAL_MS) return;
            liveTurnSignal.lastNarrationAt = now;
            recordTerminalActivity('thinking', 'LLM-B trabalhando', {
                detail: `${liveTurnSignal.model} · ${liveTurnSignal.effort} · ${(elapsedMs / 1000).toFixed(0)}s sem delta visível`,
                source: 'dialog',
                recordHistory: false,
            });
            println(
                `  \x1b[90m↳ LLM-B ainda trabalhando · ${liveTurnSignal.model}/${liveTurnSignal.effort} · ${(elapsedMs / 1000).toFixed(0)}s sem saída incremental\x1b[0m`,
            );
        };
        renderWaitingStatus();
        rl.setPrompt(buildWaitingPrompt());
        waitingTickerId = `terminal.dialog.waiting:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        waitingTicker = registerInterval(
            waitingTickerId,
            () => {
                renderWaitingStatus();
                narrateWaitingStatus();
            },
            1000,
        );
        if (typeof waitingTicker.unref === 'function') waitingTicker.unref();
    }

    let enrichedMessage = message;

    if (attachments.length > 0) {
        try {
            const ctxs = await Promise.all(attachments.map(readFileContext));
            enrichedMessage = embedMultiple(ctxs, enrichedMessage);
            println(`\x1b[90m  📎 ${ctxs.length} arquivo(s) embutido(s): ${ctxs.map((c) => c.path).join(', ')}\x1b[0m`);
        } catch (embedErr) {
            println(`\x1b[33m  ⚠️  Falha ao embutir arquivo(s): ${toError(embedErr).message}\x1b[0m`);
        }
    }

    try {
        await ensureDialogLoop();

        if (actor === 'llm-a') {
            const tsNow = new Date().toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
            println(SEPARATOR);
            println(`  \x1b[90m[${tsNow}]\x1b[0m  🤖  \x1b[34mLLM-A\x1b[0m`);
            println('');
            for (const line of message.split('\n')) {
                println(`  \x1b[34m│\x1b[0m  ${line}`);
            }
            println('');
        }

        const showThinking = getShowThinking();
        const { model, reasoningEffort } = readTerminalDialogStreamMeta();
        const effort = reasoningEffort;
        const displayState = createDisplayState({
            model,
            effort,
            turnStartTime: t0,
            showStreaming: getShowStreaming(),
            showThinking,
        });
        displayState.timeoutMs = timeoutDecision.timeoutMs;
        displayState.timeoutStrategy = timeoutDecision.strategy;

        const renderReasoningChunk = createReasoningCallback(displayState);
        /** @type {(chunk: string, reasoningId: string | null) => void} */
        const onReasoning = (chunk, reasoningId) => {
            if (liveTurnSignal.firstOutputAt === 0) liveTurnSignal.firstOutputAt = Date.now();
            renderReasoningChunk(chunk, reasoningId);
        };

        const renderDeltaChunk = createDeltaCallback(displayState);
        /** @type {(chunk: string) => void} */
        const onDelta = (chunk) => {
            if (liveTurnSignal.firstOutputAt === 0) liveTurnSignal.firstOutputAt = Date.now();
            renderDeltaChunk(chunk);
        };

        const reply = await runTerminalDialogTurn(enrichedMessage, {
            timeout: timeoutDecision.timeoutMs,
            onDelta,
            onReasoning,
        });
        const durationMs = Date.now() - t0;

        renderStreamingFooter(displayState, durationMs);
        if (!displayState.streamingStarted) {
            printExchange(actor, message, reply, durationMs);
        }

        if (displayState.firstChunkTime > 0) {
            const ttftMs = displayState.firstChunkTime - t0;
            emitNerv('copilot:turn:streaming_metrics', {
                timeToFirstTokenMs: ttftMs,
                totalDurationMs: durationMs,
                streamedChars: displayState.streamingChars,
                reasoningChars: displayState.reasoningChars,
            });
        }

        log('INFO', `[TerminalServer] Turno ${actor} concluído em ${durationMs}ms`);

        if (getShowUsage()) {
            const latestRuntimeState = readTerminalRuntimeState();
            const ctxWin = latestRuntimeState.contextWindow;
            const prInfo = /** @type {Record<string, unknown> | null} */ (latestRuntimeState.lastPrInfo);
            if (ctxWin || prInfo) {
                const parts = [];
                if (prInfo) {
                    const modelBilling = normalizeTerminalModelBillingProjection(prInfo, latestRuntimeState.model);
                    if (modelBilling.mismatch) {
                        if (modelBilling.configuredModel) {
                            parts.push(`modeloCfg=\x1b[35m${modelBilling.configuredModel}\x1b[0m`);
                        }
                        if (modelBilling.billedModel) {
                            parts.push(`modeloCobrado=\x1b[36m${modelBilling.billedModel}\x1b[0m`);
                        }
                    } else if (modelBilling.displayModel !== '-') {
                        parts.push(`modelo=\x1b[36m${modelBilling.displayModel}\x1b[0m`);
                    }
                    if (modelBilling.cost !== null) {
                        parts.push(`custo=\x1b[33m${modelBilling.cost.toFixed(4)}\x1b[0m`);
                    }
                }
                if (ctxWin) {
                    parts.push(`ctx=${(ctxWin.utilization * 100).toFixed(0)}%`);
                    parts.push(
                        `${ctxWin.tokens.toLocaleString('pt-BR')}/${ctxWin.tokenLimit.toLocaleString('pt-BR')} tokens`,
                    );
                }
                println(`  \x1b[90m📊 ${parts.join(' · ')}\x1b[0m`);
            }
        }

        const _hubSessionId = getHubSessionId();
        if (_hubSessionId) {
            try {
                await persistTurnToHub(_hubSessionId, message, reply, actor, durationMs);
            } catch (hubErr) {
                log('WARN', `[TerminalServer] Hub writeTurn falhou: ${toError(hubErr).message}`);
            }
        }

        return reply;
    } catch (e) {
        recordTerminalActivity('error', 'Erro no turno', {
            detail: toError(e).message,
            severity: 'error',
            source: 'dialog',
        });
        println(`[erro] ${toError(e).message}`);
        log('ERROR', `[TerminalServer] Erro no turno ${actor}: ${toError(e).message}`);
        if (!readTerminalRuntimeControlState().dialogLoopActive) {
            log('WARN', '[TerminalServer] Dialog loop inativo após erro — reagendando ensureDialogLoop');
            void (async () => {
                await sleepMs(2_000, { id: 'terminal.dialog.restart-after-turn-error', unref: true });
                ensureDialogLoop().catch((restartErr) => {
                    log('ERROR', `[TerminalServer] Falha ao reiniciar dialog loop: ${restartErr.message}`);
                });
            })();
        }
        return null;
    } finally {
        if (waitingTicker !== null) {
            if (waitingTickerId) cancelTimer(waitingTickerId);
        }
        setBusy(false);
        if (readTerminalRuntimeControlState().dialogLoopActive) {
            markTerminalActivityIdle();
        }
        broadcastSse('busy', { busy: false });
        const rl = getRl();
        if (rl) {
            clearInlineStatus();
            rl.setPrompt(buildUserPrompt());
            rl.prompt();
        }
    }
}
