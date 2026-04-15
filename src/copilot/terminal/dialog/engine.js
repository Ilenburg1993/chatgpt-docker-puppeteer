// @ts-check
/**
 * src/copilot/terminal/dialog/engine.js
 *
 * @module copilot/terminal/dialog/engine
 * @see EventBus
 */

import { ALWAYS_ALIVE_AGENT } from '#copilot/agent';
import { emitNerv } from '#copilot/bridges';
import { llmBridgeClient } from '#copilot/channel';
import { container, toError } from '#copilot/core';
import { log } from '#copilot/observability';
import { embedMultiple, readFileContext } from '../file-context.js';
import {
    clearAttachments,
    getAttachmentQueue,
    getHubSessionId,
    getPlanMode,
    getRl,
    getShowThinking,
    getShowUsage,
    setBusy,
} from '../state.js';
import { drainPendingNotifications, getPersistenceFailureCount, persistTurnToHub } from './engine-persistence.js';
import {
    BOOT_PROMPT,
    PLAN_PREFIX,
    PROMPT_USER,
    PROMPT_WAITING,
    SEPARATOR,
    TURN_TIMEOUT_MS,
    printExchange,
    println,
} from './output.js';
import { broadcastSse } from './sse.js';
import {
    createDeltaCallback,
    createDisplayState,
    createReasoningCallback,
    renderStreamingFooter,
} from './turn-display.js';

export { drainPendingNotifications, getPersistenceFailureCount };

/** @returns {import('../../agent/always-alive.js').AlwaysAliveAgent} */
const getAgent = () => container.resolve(ALWAYS_ALIVE_AGENT);

const MAX_TURN_QUEUE_SIZE = 10;
/** @type {number} */
let _turnQueueDepth = 0;

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

/**
 * Garante que o dialog loop está ativo. Se não estiver, inicia-o.
 *
 * @returns {Promise<void>}
 */
export function ensureDialogLoop() {
    if (getAgent().dialogLoopActive) {
        return Promise.resolve();
    }
    if (getAgent().dialogPaused) {
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
            await new Promise((r) => setTimeout(r, delay));
        }
    }
}

/**
 * Tenta iniciar o dialog loop uma vez.
 *
 * @returns {Promise<void>}
 */
async function _tryStartDialogLoop() {
    const status = getAgent().status;
    if (status === 'stopped') {
        println('\x1b[90m  Iniciando AlwaysAliveAgent…\x1b[0m');
        await getAgent().start();
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout aguardando idle')), 30_000);
            const check = () => {
                if (getAgent().status === 'idle') {
                    clearTimeout(timeout);
                    resolve(undefined);
                } else {
                    setTimeout(check, 500);
                }
            };
            check();
        });
    }

    if (getAgent().status === 'processing') {
        println('\x1b[90m  Aguardando agente concluir tarefa em andamento…\x1b[0m');
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(
                () => reject(new Error('Timeout aguardando idle após processing (30s)')),
                30_000,
            );
            const check = () => {
                const s = getAgent().status;
                if (s === 'idle') {
                    clearTimeout(timeout);
                    resolve(undefined);
                } else if (s === 'stopped') {
                    clearTimeout(timeout);
                    reject(new Error(`Agente parado inesperadamente antes de dialog loop`));
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

    _turnQueueDepth++;
    const next = _sendTurnMutex.then(() => _executeTurn(message, actor)).catch(() => null);
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
 * @returns {Promise<string | null>}
 */
async function _executeTurn(message, actor) {
    const ctxState = getAgent().getStatusSnapshot().contextWindow;
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

    setBusy(true);
    broadcastSse('busy', { busy: true, actor });
    const rl = getRl();
    if (rl) {
        const model = getAgent().model;
        const effort = getAgent().reasoningEffort ?? 'high';
        process.stdout.write(`  \x1b[90m⏳ aguardando \x1b[36m${model}\x1b[90m · \x1b[35m${effort}\x1b[90m…\x1b[0m`);
        rl.setPrompt(PROMPT_WAITING);
    }

    let enrichedMessage = message;

    const queue = getAttachmentQueue();
    if (queue.length > 0) {
        clearAttachments();
        try {
            const ctxs = await Promise.all(queue.map(readFileContext));
            enrichedMessage = embedMultiple(ctxs, enrichedMessage);
            println(`\x1b[90m  📎 ${ctxs.length} arquivo(s) embutido(s): ${ctxs.map((c) => c.path).join(', ')}\x1b[0m`);
        } catch (embedErr) {
            println(`\x1b[33m  ⚠️  Falha ao embutir arquivo(s): ${toError(embedErr).message}\x1b[0m`);
        }
    }

    if (getPlanMode()) {
        enrichedMessage = PLAN_PREFIX + enrichedMessage;
    }

    const t0 = Date.now();
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
        const model = getAgent().model;
        const effort = getAgent().reasoningEffort ?? 'high';
        const displayState = createDisplayState({ model, effort, turnStartTime: t0 });

        /** @type {((chunk: string, reasoningId: string | null) => void) | undefined} */
        const onReasoning = showThinking ? createReasoningCallback(displayState) : undefined;

        /** @type {(chunk: string) => void} */
        const onDelta = createDeltaCallback(displayState);

        const reply = await llmBridgeClient.dialogTurn(enrichedMessage, {
            timeout: TURN_TIMEOUT_MS,
            onDelta,
            ...(onReasoning && { onReasoning }),
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
            const snap = getAgent().getStatusSnapshot();
            const ctxWin = snap?.contextWindow;
            const prInfo = getAgent().lastPrInfo;
            if (ctxWin || prInfo) {
                const parts = [];
                if (prInfo) {
                    if (prInfo.model) parts.push(`modelo=\x1b[36m${prInfo.model}\x1b[0m`);
                    if (typeof prInfo.cost === 'number') parts.push(`custo=\x1b[33m${prInfo.cost.toFixed(4)}\x1b[0m`);
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
        println(`[erro] ${toError(e).message}`);
        log('ERROR', `[TerminalServer] Erro no turno ${actor}: ${toError(e).message}`);
        if (!getAgent().dialogLoopActive) {
            log('WARN', '[TerminalServer] Dialog loop inativo após erro — reagendando ensureDialogLoop');
            setTimeout(() => {
                ensureDialogLoop().catch((restartErr) => {
                    log('ERROR', `[TerminalServer] Falha ao reiniciar dialog loop: ${restartErr.message}`);
                });
            }, 2_000);
        }
        return null;
    } finally {
        setBusy(false);
        broadcastSse('busy', { busy: false });
        const rl = getRl();
        if (rl) {
            rl.setPrompt(PROMPT_USER);
            rl.prompt();
        }
    }
}
