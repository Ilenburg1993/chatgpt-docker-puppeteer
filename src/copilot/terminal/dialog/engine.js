// @ts-check
/**
 * src/copilot/terminal/dialog/engine.js
 *
 * Motor de diálogo do Terminal Permanente LLM-B — dialog loop e execução de turnos.
 *
 * @module copilot/terminal/dialog/engine
 */

import { alwaysAliveAgent } from '#copilot/agent';
import { emitNerv } from '#copilot/bridges/nerv-bridge';
import { llmBridgeClient } from '#copilot/channel/client';
import { conversationHub } from '#copilot/conversation-hub/hub';
import { log } from '#copilot/observability/logger';
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

// ─── F35.1: Queue local para notifyTerminalTurn em standalone ─────────────────

/**
 * @typedef {object} PendingTurnNotification
 * @property {string} hubSessionId
 * @property {{ turnId: number; role: 'user' | 'llm_a'; content: string; turnNumber: number }} userTurn
 * @property {{ turnId: number; content: string; turnNumber: number; durationMs: number }} llmBTurn
 */

/** @type {PendingTurnNotification[]} */
const _pendingNotifications = [];

/** F35.4: Counter de falhas de persistência (notifyTerminalTurn). */
let _persistenceFailureCount = 0;

/** Máximo de notificações pendentes na fila local. */
const MAX_PENDING_NOTIFICATIONS = 50;

/**
 * Drena a fila de notificações pendentes quando o hub ficar disponível.
 */
export function drainPendingNotifications() {
    if (!conversationHub.isReady || _pendingNotifications.length === 0) return;
    const drained = _pendingNotifications.splice(0);
    let replayed = 0;
    for (const n of drained) {
        try {
            conversationHub.notifyTerminalTurn(n.hubSessionId, n.userTurn, n.llmBTurn);
            replayed++;
        } catch (/** @type {any} */ e) {
            log('WARN', `[dialog] F35.1: replay notifyTerminalTurn falhou: ${e.message}`);
            _persistenceFailureCount++;
        }
    }
    if (replayed > 0) {
        log('INFO', `[dialog] F35.1: ${replayed} notificações pendentes drenadas com sucesso.`);
    }
}

/**
 * Retorna o counter de falhas de persistência.
 *
 * @returns {number}
 */
export function getPersistenceFailureCount() {
    return _persistenceFailureCount;
}

// ─── Fila de serialização de turnos (TERM-01) ─────────────────────────────────

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

// ─── Dialog loop ──────────────────────────────────────────────────────────────

/** @type {Promise<void> | null} */
let _ensureDialogLoopInFlight = null;

/**
 * Garante que o dialog loop está ativo. Se não estiver, inicia-o.
 *
 * @returns {Promise<void>}
 */
export function ensureDialogLoop() {
    if (alwaysAliveAgent.dialogLoopActive) {
        return Promise.resolve();
    }
    if (alwaysAliveAgent.dialogPaused) {
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
        } catch (/** @type {any} */ err) {
            attempt++;
            if (attempt > MAX_RETRIES) {
                log('ERROR', `[dialog] ensureDialogLoop falhou após ${MAX_RETRIES} tentativas: ${err.message}`);
                emitNerv('copilot:dialog:boot_failed', {
                    error: err.message,
                    attempts: MAX_RETRIES,
                    severity: 'error',
                });
                throw err;
            }
            const delay = 2000 * 2 ** (attempt - 1);
            log(
                'WARN',
                `[dialog] ensureDialogLoop falhou (tentativa ${attempt}/${MAX_RETRIES}) — retry em ${delay}ms: ${err.message}`,
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
    const status = alwaysAliveAgent.status;
    if (status === 'stopped') {
        println('\x1b[90m  Iniciando AlwaysAliveAgent…\x1b[0m');
        await alwaysAliveAgent.start();
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

    if (alwaysAliveAgent.status === 'processing') {
        println('\x1b[90m  Aguardando agente concluir tarefa em andamento…\x1b[0m');
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(
                () => reject(new Error('Timeout aguardando idle após processing (30s)')),
                30_000,
            );
            const check = () => {
                const s = alwaysAliveAgent.status;
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

// ─── Envio de turnos ──────────────────────────────────────────────────────────

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
    const ctxState = alwaysAliveAgent.getStatusSnapshot().contextWindow;
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
        const model = alwaysAliveAgent.model;
        const effort = alwaysAliveAgent.reasoningEffort ?? 'high';
        process.stdout.write(`  \x1b[90m⏳ aguardando \x1b[36m${model}\x1b[90m · \x1b[35m${effort}\x1b[90m…\x1b[0m`);
        rl.setPrompt(PROMPT_WAITING);
    }

    // ── Enriquecimento da mensagem ──────────────────────────────────────────
    let enrichedMessage = message;

    const queue = getAttachmentQueue();
    if (queue.length > 0) {
        clearAttachments();
        try {
            const ctxs = await Promise.all(queue.map(readFileContext));
            enrichedMessage = embedMultiple(ctxs, enrichedMessage);
            println(`\x1b[90m  📎 ${ctxs.length} arquivo(s) embutido(s): ${ctxs.map((c) => c.path).join(', ')}\x1b[0m`);
        } catch (/** @type {any} */ embedErr) {
            println(`\x1b[33m  ⚠️  Falha ao embutir arquivo(s): ${embedErr.message}\x1b[0m`);
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

        // ── Thinking display (reasoning deltas) ─────────────────────────────
        const showThinking = getShowThinking();
        let _reasoningStarted = false;
        let _reasoningChars = 0;
        let _reasoningContent = '';
        let _reasoningId = /** @type {string | null} */ (null);
        const tThinkingStart = Date.now();

        /** @type {((chunk: string, reasoningId: string | null) => void) | undefined} */
        const onReasoning = showThinking
            ? (chunk, rId) => {
                  if (!_reasoningStarted) {
                      _reasoningStarted = true;
                      _reasoningId = rId;
                      process.stdout.write('\r\x1b[K');
                      const tsNow = new Date().toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                      });
                      println(SEPARATOR);
                      println(`  \x1b[90m[${tsNow}]\x1b[0m  💭  \x1b[2m\x1b[35mpensando…\x1b[0m`);
                      println('');
                      process.stdout.write('  \x1b[2m\x1b[90m│\x1b[0m  \x1b[2m\x1b[37m');
                  }
                  _reasoningChars += chunk.length;
                  _reasoningContent += chunk;
                  const lines = chunk.split('\n');
                  for (let i = 0; i < lines.length; i++) {
                      if (i > 0) process.stdout.write('\n  \x1b[2m\x1b[90m│\x1b[0m  \x1b[2m\x1b[37m');
                      process.stdout.write(/** @type {string} */ (lines[i]));
                  }
                  broadcastSse('reasoning', { chunk, reasoningId: rId });
              }
            : undefined;

        // ── Streaming response (message deltas) ─────────────────────────────
        let _streamingStarted = false;
        let _streamingChars = 0;
        let _firstChunkTime = 0;

        /** @type {((chunk: string) => void) | undefined} */
        const onDelta = (chunk) => {
            if (!_streamingStarted) {
                _streamingStarted = true;
                _firstChunkTime = Date.now();
                if (_reasoningStarted) {
                    process.stdout.write('\x1b[0m\n');
                    const thinkSecs = ((Date.now() - tThinkingStart) / 1000).toFixed(1);
                    println(`  \x1b[90m└── pensamento completo (${thinkSecs}s · ${_reasoningChars} chars)\x1b[0m`);
                    println('');
                    broadcastSse('reasoning.complete', {
                        content: _reasoningContent,
                        reasoningId: _reasoningId,
                        durationMs: Date.now() - tThinkingStart,
                        chars: _reasoningChars,
                    });
                } else {
                    process.stdout.write('\r\x1b[K');
                }
                const tsNow = new Date().toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                });
                const model = alwaysAliveAgent.model;
                const effort = alwaysAliveAgent.reasoningEffort ?? 'high';
                println(SEPARATOR);
                println(
                    `  \x1b[90m[${tsNow}]\x1b[0m  🧠  \x1b[32mLLM-B\x1b[0m  \x1b[90m·\x1b[0m  \x1b[36m${model}\x1b[0m  \x1b[90m·\x1b[0m  \x1b[35m${effort}\x1b[0m`,
                );
                println('');
                process.stdout.write('  \x1b[32m│\x1b[0m  ');
            }
            _streamingChars += chunk.length;
            const lines = chunk.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (i > 0) process.stdout.write('\n  \x1b[32m│\x1b[0m  ');
                process.stdout.write(/** @type {string} */ (lines[i]));
            }
            broadcastSse('delta', { chunk });
        };

        const reply = await llmBridgeClient.dialogTurn(enrichedMessage, {
            timeout: TURN_TIMEOUT_MS,
            onDelta,
            ...(onReasoning && { onReasoning }),
        });
        const durationMs = Date.now() - t0;

        if (_streamingStarted) {
            const secs = (durationMs / 1000).toFixed(1);
            const secsNum = durationMs / 1000;
            const secsColor =
                secsNum < 5
                    ? `\x1b[32m${secs}s\x1b[0m`
                    : secsNum < 15
                      ? `\x1b[33m${secs}s\x1b[0m`
                      : `\x1b[31m${secs}s\x1b[0m`;
            const ttft = _firstChunkTime > 0 ? ((_firstChunkTime - t0) / 1000).toFixed(1) + 's TTFT' : '';
            process.stdout.write('\n');
            println(`  \x1b[90m└── ${secsColor}${ttft ? `  \x1b[90m·\x1b[0m  \x1b[90m${ttft}\x1b[0m` : ''}\x1b[0m`);
            println('');
        } else {
            printExchange(actor, message, reply, durationMs);
        }

        if (_reasoningStarted && !_streamingStarted) {
            process.stdout.write('\x1b[0m\n');
            const thinkSecs = ((Date.now() - tThinkingStart) / 1000).toFixed(1);
            println(`  \x1b[90m└── pensamento completo (${thinkSecs}s · ${_reasoningChars} chars)\x1b[0m`);
            println('');
            broadcastSse('reasoning.complete', {
                content: _reasoningContent,
                reasoningId: _reasoningId,
                durationMs: Date.now() - tThinkingStart,
                chars: _reasoningChars,
            });
        }

        if (_firstChunkTime > 0) {
            const ttftMs = _firstChunkTime - t0;
            emitNerv('copilot:turn:streaming_metrics', {
                timeToFirstTokenMs: ttftMs,
                totalDurationMs: durationMs,
                streamedChars: _streamingChars,
                reasoningChars: _reasoningChars,
            });
        }

        log('INFO', `[TerminalServer] Turno ${actor} concluído em ${durationMs}ms`);

        if (getShowUsage()) {
            const snap = alwaysAliveAgent.getStatusSnapshot();
            const ctxWin = snap?.contextWindow;
            const prInfo = alwaysAliveAgent.lastPrInfo;
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
                /** @type {'user' | 'llm_a'} */
                const senderRole = actor === 'llm-a' ? 'llm_a' : 'user';
                const msgTurnId = await conversationHub.store.writeTurn(_hubSessionId, {
                    role: senderRole,
                    content: message,
                });
                const replyTurnId = await conversationHub.store.writeTurn(_hubSessionId, {
                    role: 'llm_b',
                    content: reply,
                    durationMs,
                });
                if (conversationHub.isReady) {
                    try {
                        const msgTurn = conversationHub.store.getTurn(msgTurnId);
                        const replyTurn = conversationHub.store.getTurn(replyTurnId);
                        conversationHub.notifyTerminalTurn(
                            _hubSessionId,
                            {
                                turnId: msgTurnId,
                                role: senderRole,
                                content: message,
                                turnNumber: msgTurn?.turn_number ?? 0,
                            },
                            {
                                turnId: replyTurnId,
                                content: reply,
                                turnNumber: replyTurn?.turn_number ?? 0,
                                durationMs,
                            },
                        );
                    } catch (/** @type {any} */ hubErr) {
                        _persistenceFailureCount++;
                        log('DEBUG', `[dialog] notifyTerminalTurn falhou (enfileirado): ${hubErr.message}`);
                        if (_pendingNotifications.length < MAX_PENDING_NOTIFICATIONS) {
                            const msgTurn = conversationHub.store.getTurn(msgTurnId);
                            const replyTurn = conversationHub.store.getTurn(replyTurnId);
                            _pendingNotifications.push({
                                hubSessionId: _hubSessionId,
                                userTurn: {
                                    turnId: msgTurnId,
                                    role: senderRole,
                                    content: message,
                                    turnNumber: msgTurn?.turn_number ?? 0,
                                },
                                llmBTurn: {
                                    turnId: replyTurnId,
                                    content: reply,
                                    turnNumber: replyTurn?.turn_number ?? 0,
                                    durationMs,
                                },
                            });
                        }
                    }
                } else if (_pendingNotifications.length < MAX_PENDING_NOTIFICATIONS) {
                    const msgTurn = conversationHub.store.getTurn(msgTurnId);
                    const replyTurn = conversationHub.store.getTurn(replyTurnId);
                    _pendingNotifications.push({
                        hubSessionId: _hubSessionId,
                        userTurn: {
                            turnId: msgTurnId,
                            role: senderRole,
                            content: message,
                            turnNumber: msgTurn?.turn_number ?? 0,
                        },
                        llmBTurn: {
                            turnId: replyTurnId,
                            content: reply,
                            turnNumber: replyTurn?.turn_number ?? 0,
                            durationMs,
                        },
                    });
                }
                emitNerv('copilot:turn:sent', {
                    hubSessionId: _hubSessionId,
                    turnId: msgTurnId,
                    role: senderRole,
                    contentLen: message.length,
                });
                emitNerv('copilot:turn:complete', {
                    hubSessionId: _hubSessionId,
                    turnId: replyTurnId,
                    role: 'llm_b',
                    contentLen: reply.length,
                    durationMs,
                });
            } catch (/** @type {any} */ hubErr) {
                log('WARN', `[TerminalServer] Hub writeTurn falhou: ${hubErr.message}`);
            }
        }

        return reply;
    } catch (/** @type {any} */ e) {
        println(`[erro] ${e.message}`);
        log('ERROR', `[TerminalServer] Erro no turno ${actor}: ${e.message}`);
        if (!alwaysAliveAgent.dialogLoopActive) {
            log('WARN', '[TerminalServer] Dialog loop inativo após erro — reagendando ensureDialogLoop');
            setTimeout(() => {
                ensureDialogLoop().catch((/** @type {any} */ restartErr) => {
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
