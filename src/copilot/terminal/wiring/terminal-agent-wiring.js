// @ts-check
/**
 * src/copilot/terminal/wiring/terminal-agent-wiring.js
 *
 * Wiring de eventos do AlwaysAliveAgent → terminal server (SSE broadcast, watchdog, streaming). Extração de
 * `registerAgentEventListeners` do `index.js` para separação de responsabilidades.
 *
 * @module copilot/terminal/terminal-agent-wiring
 * @see EventBus
 */

import { LLM_B_TURN_TIMEOUT_MS, LLM_B_WATCHDOG_STALL_MS } from '#copilot/config';
import { sleepMs } from '#copilot/core';
import {
    EMITTER_ASSISTANT_STREAMING_DELTA,
    EMITTER_DIALOG_LOOP_CHANGED,
    EMITTER_DIALOG_PRE_STALL_WARNING,
    EMITTER_DIALOG_READY,
    EMITTER_DIALOG_RECOVERY,
    EMITTER_DIALOG_REPLY,
    EMITTER_DIALOG_STALLED,
    EMITTER_DIALOG_STOPPED,
    EMITTER_SESSION_FATAL,
    EMITTER_SESSION_USAGE,
} from '#copilot/events';
import { log } from '#copilot/observability';
import { logSwallowed } from '../../core/error-handlers.js';
import { getHubSessionId } from '../../presentation/state/index.js';
import { broadcastSse, ensureDialogLoop, println } from '../dialog/index.js';
import {
    createTerminalHandledAgentEventsSet,
    createTerminalPassthroughAgentEventsSet,
    isTerminalAssistantTranscriptCovered,
    registerTerminalAgentSsePassthrough,
    renderTerminalAssistantTranscript,
    setupTerminalTaskStreamListeners,
} from '../events/index.js';
import {
    abortTerminalCurrentMessage,
    pingTerminalDialogWatchdog,
    readTerminalAgentRuntimeEventHost,
    readTerminalDialogStreamMeta,
    readTerminalRuntimeState,
    stopTerminalDialogMode,
    writeTerminalHubSystemTurn,
} from '../frontend/gateways/index.js';
import { markTerminalActivityIdle, recordTerminalActivity, terminalThemeText } from '../state/dialog/index.js';
import { terminalThemeBadge } from '../state/events/index.js';
import { shouldSuppressTerminalAssistantMessageAsMaterializedTurn, withTerminalTurnCorrelation } from '../state/events/index.js';
import { drainMailboxToTurnIfIdle } from './mailbox-drain.js';

/** @type {boolean} */
let _agentListenersRegistered = false;

const WATCHDOG_RECOVERY_WAIT_MS = Math.max(5_000, Math.min(30_000, Math.round(LLM_B_TURN_TIMEOUT_MS * 0.2)));

const AUTO_RESTART_DIALOG_STOP_REASONS = new Set(['watchdog_restart', 'model_stopped']);
const EMITTER_DIALOG_TURN_END = 'dialog.turn_end';
const DIALOG_LOOP_CHANGED_DEDUP_WINDOW_MS = 250;

/**
 * @template {Record<string, unknown>} T
 * @param {T} payload
 * @param {string} source
 * @returns {T & { source: string; timestamp: number; traceId?: string; turnId?: string }}
 */
function withTerminalAgentSseEnvelope(payload, source) {
    return withTerminalTurnCorrelation({
        ...payload,
        source,
        timestamp: typeof payload['timestamp'] === 'number' ? payload['timestamp'] : Date.now(),
    });
}

/**
 * `dialog.turn_end` e um evento de ciclo de vida, nao uma segunda fonte canonica de transcript. Quando o texto ja foi
 * materializado por `dialog.delta` ou `assistant.message`, mantemos o evento publico, mas removemos o `reply` do payload
 * para que SSE/JSONL/export nao preservem um prefixo truncado como se fosse uma nova mensagem.
 *
 * @param {{
 *     reply?: string;
 *     turnId?: string | number | null;
 *     durationMs?: number;
 *     timestamp?: number;
 *     [key: string]: unknown;
 * }} evt
 * @returns {{
 *     envelope: Record<string, unknown>;
 *     reply: string;
 *     turnId: string | null;
 *     replyAlreadyMaterialized: boolean;
 * }}
 */
export function createDialogTurnEndSseEnvelope(evt) {
    const reply = typeof evt.reply === 'string' ? evt.reply : '';
    const turnId = typeof evt.turnId === 'string' || typeof evt.turnId === 'number' ? String(evt.turnId) : null;
    const timestamp = typeof evt.timestamp === 'number' ? evt.timestamp : Date.now();
    const replyAlreadyMaterialized =
        reply.trim().length > 0 &&
        (shouldSuppressTerminalAssistantMessageAsMaterializedTurn({ content: reply, turnId, now: timestamp }) ||
            isTerminalAssistantTranscriptCovered(reply));
    const envelope = withTerminalAgentSseEnvelope(
        {
            ...evt,
            reply: replyAlreadyMaterialized ? '' : reply,
            ...(turnId ? { turnId } : {}),
            ...(replyAlreadyMaterialized
                ? {
                      replySuppressed: true,
                      replySuppressionReason: 'already_materialized',
                      originalReplyChars: reply.length,
                      transcriptCanonicalSource: 'assistant.message_or_dialog.delta',
                  }
                : {}),
        },
        'terminal-agent-wiring/dialog.turn_end',
    );
    return { envelope, reply, turnId, replyAlreadyMaterialized };
}

/**
 * Política local de UX: restart automático é exceção. O Agent continua sendo dono do lifecycle, mas o terminal só
 * reabre a conversa sozinho quando a razão representa falha operacional clara.
 *
 * @param {string} reason
 * @returns {boolean}
 */
export function shouldAutoRestartStoppedDialog(reason) {
    return AUTO_RESTART_DIALOG_STOP_REASONS.has(reason);
}

/**
 * Descreve a política operacional aplicada a uma parada da conversa.
 *
 * @param {string} reason
 * @returns {{
 *     label: string;
 *     activityTitle: string;
 *     activityDetail: string;
 *     terminalMessage: string;
 *     sse: Record<string, unknown>;
 * }}
 */
export function describeDialogStoppedRestartPolicy(reason) {
    if (reason === 'reconnect_restart') {
        return {
            label: 'reconexão SDK',
            activityTitle: 'Conversa preservada após reconexão',
            activityDetail: 'reconexão SDK concluída; reenvio automático de prompt bloqueado',
            terminalMessage:
                'Conversa reconectada; reenvio automático do prompt foi bloqueado para evitar duplicação. Use /dialog-resume ou reenvie a mensagem se quiser continuar.',
            sse: {
                reason,
                restarting: false,
                reconnect: true,
                promptReplayBlocked: true,
                operatorAction: '/dialog-resume',
            },
        };
    }

    const isWatchdog = reason === 'watchdog_restart';
    const label = isWatchdog ? 'reinício por watchdog' : `reason: ${reason}`;
    return {
        label,
        activityTitle: 'Conversa encerrada sem restart automático',
        activityDetail: label,
        terminalMessage: `Conversa encerrada (${label}). Restart automático bloqueado; use /dialog-resume se precisar.`,
        sse: { reason, restarting: false },
    };
}

/**
 * @param {{ active: boolean; at: number } | null} last
 * @param {{ active: boolean; at: number }} next
 * @returns {boolean}
 */
export function shouldSuppressDialogLoopChangedSse(last, next) {
    return Boolean(
        last &&
            last.active === next.active &&
            next.at - last.at >= 0 &&
            next.at - last.at <= DIALOG_LOOP_CHANGED_DEDUP_WINDOW_MS,
    );
}

/**
 * Registra todos os event listeners do AlwaysAliveAgent no terminal server.
 *
 * @param {() => void} printBanner - Callback para imprimir o banner de status após agente pronto
 * @returns {void}
 */
export function registerAgentEventListeners(printBanner) {
    // T-14: guard contra registros duplicados (ex: hot-reload, tests)
    if (_agentListenersRegistered) return;
    _agentListenersRegistered = true;
    const agentEvents = readTerminalAgentRuntimeEventHost();
    agentEvents.on(
        EMITTER_DIALOG_RECOVERY,
        (
            /** @type {{
             *     reason?: string;
             *     recovered?: boolean;
             *     strategy?: string;
             *     prConsumed?: boolean;
             *     durationMs?: number;
             *     success?: boolean;
             *     traceId?: string;
             * }} */ evt,
        ) => {
            const recovered = evt.recovered === true;
            const prConsumed = evt.prConsumed === true;
            const strategy = evt.strategy ?? 'unknown';
            const reason = evt.reason ?? 'unknown';
            const success = evt.success !== false;
            const severity = success ? (prConsumed ? 'warn' : 'info') : 'error';
            const duration = typeof evt.durationMs === 'number' ? `${evt.durationMs}ms` : 'duração n/d';
            recordTerminalActivity(
                success && recovered ? 'system' : 'error',
                recovered ? 'Conversa recuperada' : 'Recovery da conversa sem reanexo',
                {
                    detail: `${reason} · ${strategy} · ${prConsumed ? '1 PR' : 'zero-PR'} · ${duration}`,
                    severity,
                    source: 'dialog',
                },
            );
            if (!success || prConsumed) {
                const label = success ? 'conversa recuperada com restart' : 'falha no recovery da conversa';
                println(`\n\x1b[33m  [conversa] ${label}: ${strategy} · ${reason} · ${duration}\x1b[0m`);
            }
            broadcastSse(
                'dialog.recovery',
                withTerminalAgentSseEnvelope(
                    {
                        ...evt,
                        reason,
                        recovered,
                        strategy,
                        prConsumed,
                    },
                    'terminal-agent-wiring/dialog.recovery',
                ),
            );
        },
    );
    agentEvents.on(EMITTER_DIALOG_STALLED, async (/** @type {{ stalledMs: number }} */ evt) => {
        const secs = Math.round(evt.stalledMs / 1000);
        const runtimeState = readTerminalRuntimeState();
        const waitingHumanInput =
            runtimeState.status === 'waiting_for_input' && runtimeState.pendingQuestionKind === 'question';

        if (waitingHumanInput) {
            recordTerminalActivity('system', 'Watchdog ignorado (input humano pendente)', {
                detail: `${secs}s em waiting_for_input/question`,
                source: 'watchdog',
            });
            log(
                'INFO',
                `[TerminalServer] Watchdog stall ignorado (${secs}s): runtime aguardando input humano (pendingQuestionKind=question).`,
            );
            pingTerminalDialogWatchdog();
            broadcastSse(
                'dialog.stalled',
                withTerminalAgentSseEnvelope(
                    {
                        stalledMs: evt.stalledMs,
                        ignored: true,
                        reason: 'waiting_for_input_question',
                    },
                    'terminal-agent-wiring/dialog.stalled',
                ),
            );
            return;
        }

        recordTerminalActivity('system', 'Watchdog disparou', {
            detail: `${secs}s sem progresso`,
            severity: 'warn',
            source: 'watchdog',
        });
        log('WARN', `[TerminalServer] Watchdog disparou (${secs}s inativo).`);

        // F52 (PARTE-9): Zero-PR Watchdog Recovery — tentar recuperar SEM consumir PR.
        // 1. Abortar mensagem travada (session.abort — 0 PR)
        // BUG-WDOG-01: sem try/catch, abortTerminalCurrentMessage() rejeita propagando
        // como unhandled rejection no listener de evento, silenciando o watchdog recovery.
        try {
            await abortTerminalCurrentMessage();
        } catch (e) {
            logSwallowed(e, 'terminal.wiring.watchdog.abort');
        }

        // 2. Aguardar janela adaptativa para o ask_user reaparecer (0 PR se reaparecer)
        let recovered = false;
        const recoveryDeadline = Date.now() + WATCHDOG_RECOVERY_WAIT_MS;
        while (Date.now() < recoveryDeadline) {
            if (readTerminalRuntimeState().pendingQuestionKind === 'ready') {
                recovered = true;
                break;
            }
            await sleepMs(500, { id: 'terminal.watchdog.recovery.wait', unref: true });
        }

        if (recovered) {
            // F52.3: ask_user reapareceu — a conversa continua sem custo de PR
            println(`\n  ${terminalThemeBadge('success', 'WATCHDOG')} ${terminalThemeText('success', 'Conversa recuperada sem consumir PR; pergunta humana preservada.')}`);
            log('INFO', '[TerminalServer] F52: Watchdog recovery zero-PR — ask_user reapareceu após abort.');
            pingTerminalDialogWatchdog();
            broadcastSse(
                'dialog.stalled',
                withTerminalAgentSseEnvelope(
                    { stalledMs: evt.stalledMs, recoveredZeroPR: true },
                    'terminal-agent-wiring/dialog.stalled',
                ),
            );
            return;
        }

        // F52.4: ask_user NÃO reapareceu — fallback para restart completo (1 PR)
        println(`\n  ${terminalThemeBadge('warn', 'WATCHDOG')} ${terminalThemeText('warn', `Conversa inativa há ${secs}s; reiniciando (1 PR).`)}`);
        log('WARN', `[TerminalServer] F52: Watchdog recovery falhou — restart com boot prompt (1 PR).`);

        const _hubSessionId = getHubSessionId();
        if (_hubSessionId) {
            try {
                await writeTerminalHubSystemTurn(
                    _hubSessionId,
                    `[SISTEMA] Watchdog: conversa inativa por ${secs}s — reinício automático.`,
                );
            } catch (e) {
                logSwallowed(e, 'terminal.index.watchdogWriteTurn');
            }
        }
        // DL-PERM-06: stopDialogMode() usará reason='watchdog_restart', que o handler de
        // 'dialog.stopped' capturará e chamará ensureDialogLoop(). Não chamar ensureDialogLoop()
        // aqui diretamente para evitar duplo restart.
        stopTerminalDialogMode().catch((e) => {
            log('ERROR', `[TerminalServer] Falha ao parar dialog loop no watchdog: ${e.message}`);
            // Fallback: se stopDialogMode() falhar, tentar reiniciar diretamente
            ensureDialogLoop().catch((e2) =>
                log('ERROR', `[TerminalServer] Falha no fallback de restart após watchdog: ${e2.message}`),
            );
        });
        broadcastSse(
            'dialog.stalled',
            withTerminalAgentSseEnvelope(
                { stalledMs: evt.stalledMs, recoveredZeroPR: false },
                'terminal-agent-wiring/dialog.stalled',
            ),
        );
    });

    // F41B.7: pré-stall warning — ação preemptiva quando loop está a 80% do limiar de stall.
    // Se terminal ativo: ping watchdog silencioso (suprime stall iminente).
    // Se genuinamente inativo: aviso visual + SSE para dashboard.
    agentEvents.on(EMITTER_DIALOG_PRE_STALL_WARNING, (/** @type {{ stalledMs: number }} */ evt) => {
        const secs = Math.round(evt.stalledMs / 1000);
        const remainingSecs = Math.round((LLM_B_WATCHDOG_STALL_MS - evt.stalledMs) / 1000);
        const runtimeState = readTerminalRuntimeState();
        const isTerminalActive =
            runtimeState.status !== 'idle' &&
            runtimeState.status !== 'waiting_for_input' &&
            runtimeState.dialogLoopActive;

        if (isTerminalActive) {
            // Terminal ativo mas sem turno SDK em andamento — ping preventivo para evitar stall falso
            pingTerminalDialogWatchdog();
            recordTerminalActivity('system', 'Pré-stall suprimido (terminal ativo)', {
                detail: `${secs}s — estado ${runtimeState.status}, ping preventivo emitido`,
                source: 'watchdog',
            });
            log('INFO', `[TerminalServer] Pré-stall (${secs}s) suprimido: terminal ativo (${runtimeState.status}).`);
            broadcastSse(
                'dialog.pre_stall_warning',
                withTerminalAgentSseEnvelope(
                    { stalledMs: evt.stalledMs, suppressed: true },
                    'terminal-agent-wiring/dialog.pre_stall_warning',
                ),
            );
            return;
        }

        // Conversa genuinamente inativa: aviso visual com tempo restante estimado
        println(
            `\n  ${terminalThemeBadge('warn', 'WATCHDOG')} ${terminalThemeText('warn', `Pré-stall: conversa inativa há ${secs}s (~${remainingSecs}s para restart automático).`)}`,
        );
        log('WARN', `[TerminalServer] Pré-stall: conversa inativa há ${secs}s (~${remainingSecs}s restantes).`);
        recordTerminalActivity('system', 'Pré-stall watchdog', {
            detail: `${secs}s inativo, restart em ~${remainingSecs}s`,
            severity: 'warn',
            source: 'watchdog',
        });
        broadcastSse(
            'dialog.pre_stall_warning',
            withTerminalAgentSseEnvelope(
                { stalledMs: evt.stalledMs, suppressed: false, remainingSecs },
                'terminal-agent-wiring/dialog.pre_stall_warning',
            ),
        );
    });

    // SSE: transmite respostas da LLM-B para clientes subscritos
    let lastStreamingKbReported = -1;
    let lastStreamingReportAt = 0;
    /** @type {{ active: boolean; reason: string; at: number } | null} */
    let lastDialogLoopChangedSse = null;

    agentEvents.on(EMITTER_DIALOG_REPLY, (/** @type {{ reply: string }} */ evt) => {
        const { model, reasoningEffort } = readTerminalDialogStreamMeta();
        broadcastSse(
            'dialog.reply',
            withTerminalTurnCorrelation({
                content: evt.reply,
                timestamp: Date.now(),
                model,
                reasoningEffort,
                source: 'terminal-agent-wiring/dialog.reply',
            }),
        );
    });
    agentEvents.on(
        EMITTER_DIALOG_TURN_END,
        (
            /** @type {{
             *     reply?: string;
             *     turnId?: string | number | null;
             *     durationMs?: number;
             *     timestamp?: number;
             * }} */ evt,
        ) => {
            const { envelope, reply, turnId, replyAlreadyMaterialized } = createDialogTurnEndSseEnvelope(evt);
            broadcastSse('dialog.turn_end', envelope);
            if (!reply.trim()) return;
            if (replyAlreadyMaterialized) {
                recordTerminalActivity('turn', 'dialog.turn_end reconciliado sem novo bloco visual', {
                    detail: turnId ? `turn=${turnId} · conteúdo já materializado` : 'conteúdo já materializado',
                    source: 'dialog.turn_end',
                    recordHistory: false,
                    updateCurrent: false,
                });
                return;
            }
            recordTerminalActivity('turn', 'Mensagem final da conversa recebida', {
                detail: turnId ? `turn=${turnId}` : 'turno sem id',
                source: 'dialog.turn_end',
                recordHistory: false,
                updateCurrent: false,
            });
            renderTerminalAssistantTranscript({
                content: reply,
                title: 'Continuação da LLM-B',
                source: 'dialog.turn_end',
                status: 'completed',
                suppressIfCoveredByRecent: true,
                detail: [
                    turnId ? `turn=${turnId}` : null,
                    typeof evt.durationMs === 'number' ? `${(evt.durationMs / 1000).toFixed(1)}s` : null,
                ]
                    .filter(Boolean)
                    .join(' · '),
                metadata: {
                    assistantMessageEnvelope: envelope,
                },
            });
        },
    );
    // F4.6 (UPG-11): emite dialog.loop.changed para dashboard responsivo
    agentEvents.on(EMITTER_DIALOG_LOOP_CHANGED, (/** @type {{ active: boolean; ts: number; reason?: string }} */ evt) => {
        const at = typeof evt.ts === 'number' ? evt.ts : Date.now();
        const reason = typeof evt.reason === 'string' && evt.reason.trim().length > 0 ? evt.reason : '';
        if (shouldSuppressDialogLoopChangedSse(lastDialogLoopChangedSse, { active: evt.active, at })) {
            recordTerminalActivity('system', 'dialog.loop.changed duplicado suprimido', {
                detail: `active=${evt.active}${reason ? ` · ${reason}` : ''}`,
                source: 'terminal-agent-wiring/dialog.loop.changed',
                recordHistory: false,
                updateCurrent: false,
            });
            return;
        }
        lastDialogLoopChangedSse = { active: evt.active, reason, at };
        broadcastSse(
            'dialog.loop.changed',
            withTerminalAgentSseEnvelope(
                { active: evt.active, timestamp: at, ...(reason ? { reason } : {}) },
                'terminal-agent-wiring/dialog.loop.changed',
            ),
        );
    });
    agentEvents.on(EMITTER_DIALOG_READY, () => {
        const { model, reasoningEffort } = readTerminalDialogStreamMeta();
        lastStreamingKbReported = -1;
        lastStreamingReportAt = 0;
        markTerminalActivityIdle('Aguardando próxima mensagem');
        broadcastSse(
            'dialog.ready',
            withTerminalAgentSseEnvelope({ model, reasoningEffort }, 'terminal-agent-wiring/dialog.ready'),
        );
        // Drenagem da fila de intervenção: cobre abort pelo watchdog (que não dispara TURN_END).
        drainMailboxToTurnIfIdle('dialog_ready');
    });
    agentEvents.on(EMITTER_ASSISTANT_STREAMING_DELTA, (/** @type {{ totalResponseSizeBytes?: number }} */ evt) => {
        const totalBytes = Number(evt?.totalResponseSizeBytes ?? 0);
        if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
            return;
        }

        const kb = Math.round(totalBytes / 1024);
        const now = Date.now();
        const sameBucket = kb === lastStreamingKbReported;
        const tooSoon = now - lastStreamingReportAt < 900;
        if (sameBucket && tooSoon) {
            return;
        }

        lastStreamingKbReported = kb;
        lastStreamingReportAt = now;
        // F1.1: NÃO registrar activity aqui — turn-display.js é o único responsável
        // por recordTerminalActivity('streaming', ...). Registrar aqui causava duplicação
        // no histórico com source='sdk' vs source='dialog' (dois caminhos para o mesmo evento).
        broadcastSse(
            'streaming.progress',
            withTerminalAgentSseEnvelope(
                {
                    totalBytes,
                    kb,
                    timestamp: now,
                },
                'terminal-agent-wiring/streaming.progress',
            ),
        );
    });

    // DL-PERM: conversa permanente — reinicia automaticamente se o modelo encerrar o loop.
    agentEvents.on(EMITTER_DIALOG_STOPPED, (/** @type {{ reason: string; authorized?: boolean }} */ evt) => {
        const reason = evt.reason ?? 'desconhecido';

        if (reason === 'recovery_restart') {
            recordTerminalActivity('system', 'Conversa em recuperação', {
                detail: 'Reinício semântico coordenado pelo Agent',
                source: 'dialog',
            });
            log('INFO', '[TerminalServer] Conversa encerrada para recovery semântico coordenado pelo Agent.');
            broadcastSse(
                'dialog.stopped',
                withTerminalAgentSseEnvelope(
                    { authorized: true, reason, recovery: true },
                    'terminal-agent-wiring/dialog.stopped',
                ),
            );
            return;
        }

        if (reason === 'authorized_stop') {
            recordTerminalActivity('system', 'Conversa encerrada', {
                detail: 'Parado por autorização explícita do usuário',
                source: 'dialog',
            });
            println(`\n\x1b[33m  [conversa] Encerrada por autorização explícita do usuário.\x1b[0m`);
            log('INFO', '[TerminalServer] Conversa encerrada com autorização do usuário.');
            broadcastSse(
                'dialog.stopped',
                withTerminalAgentSseEnvelope({ authorized: true, reason }, 'terminal-agent-wiring/dialog.stopped'),
            );
            return;
        }

        // T-15: respeitar pausa intencional do usuário — não reiniciar se dialogPaused
        if (readTerminalRuntimeState().dialogPaused) {
            recordTerminalActivity('system', 'Conversa pausada', {
                detail: `Encerrado enquanto pausado (${reason})`,
                source: 'dialog',
            });
            println(`\n\x1b[33m  [conversa] Encerrada enquanto pausada pelo usuário — não reiniciando.\x1b[0m`);
            log('INFO', '[TerminalServer] Conversa encerrada com dialogPaused=true. Não reiniciando.');
            broadcastSse(
                'dialog.stopped',
                withTerminalAgentSseEnvelope({ reason, paused: true }, 'terminal-agent-wiring/dialog.stopped'),
            );
            return;
        }

        const stopPolicy = describeDialogStoppedRestartPolicy(reason);
        if (!shouldAutoRestartStoppedDialog(reason)) {
            recordTerminalActivity('system', stopPolicy.activityTitle, {
                detail: stopPolicy.activityDetail,
                severity: 'warn',
                source: 'dialog',
            });
            println(`\n\x1b[33m  [dialog] ${stopPolicy.terminalMessage}\x1b[0m`);
            log(
                'WARN',
                `[TerminalServer] Conversa encerrada (${stopPolicy.label}). Restart automático bloqueado por política.`,
            );
            broadcastSse(
                'dialog.stopped',
                withTerminalAgentSseEnvelope(stopPolicy.sse, 'terminal-agent-wiring/dialog.stopped'),
            );
            return;
        }
        const isWatchdog = reason === 'watchdog_restart';
        const label = isWatchdog ? 'reinício por watchdog' : `reason: ${reason}`;
        recordTerminalActivity('system', 'Reiniciando conversa', {
            detail: label,
            severity: 'warn',
            source: 'dialog',
        });
        println(`\n\x1b[33m  [conversa] Encerrada (${label}) — reiniciando automaticamente…\x1b[0m`);
        log('WARN', `[TerminalServer] Conversa encerrada (${label}). Reiniciando.`);
        broadcastSse(
            'dialog.stopped',
            withTerminalAgentSseEnvelope({ reason, restarting: true }, 'terminal-agent-wiring/dialog.stopped'),
        );
        ensureDialogLoop().catch((e) =>
            log('ERROR', `[TerminalServer] Falha ao reiniciar dialog loop após stop: ${e.message}`),
        );
    });

    // AA.4: SSE 'context' event
    agentEvents.on(EMITTER_SESSION_USAGE, (/** @type {{ currentTokens: number; tokenLimit: number }} */ data) => {
        const { currentTokens = 0, tokenLimit = 0 } = data;
        if (tokenLimit > 0) {
            broadcastSse(
                'session.usage',
                withTerminalAgentSseEnvelope(
                    {
                        tokens: currentTokens,
                        tokenLimit,
                        utilization: currentTokens / tokenLimit,
                    },
                    'terminal-agent-wiring/session.usage',
                ),
            );
        }
    });

    // AB.4: SSE 'cache.hit'
    agentEvents.on(
        'session.compaction_complete',
        (/** @type {{ compactionTokensUsed?: { cachedInput?: number }; success?: boolean }} */ evt) => {
            const cachedInput = evt?.compactionTokensUsed?.cachedInput ?? 0;
            if (cachedInput > 0) {
                broadcastSse(
                    'session.compaction_complete',
                    withTerminalAgentSseEnvelope(
                        { cachedInput },
                        'terminal-agent-wiring/session.compaction_complete',
                    ),
                );
            }
        },
    );

    // Persiste reconexões e sessões fatais no Hub
    agentEvents.on(
        'ready',
        async (/** @type {{ sessionId: string; isResumed: boolean; reconected?: boolean }} */ evt) => {
            // F10.3: banner de status após agente pronto (só na primeira vez, não em reconexões)
            if (!evt.reconected) {
                printBanner();
            }
            const _hubSessionId = getHubSessionId();
            if (!_hubSessionId || !evt.reconected) return;
            try {
                await writeTerminalHubSystemTurn(
                    _hubSessionId,
                    `[SISTEMA] Session reconectada: ${evt.sessionId} (retomada: ${evt.isResumed})`,
                );
            } catch (e) {
                logSwallowed(e, 'terminal.index.reconnectWriteTurn');
            }
        },
    );
    agentEvents.on(EMITTER_SESSION_FATAL, async (/** @type {{ originalError: string; attempts: number }} */ evt) => {
        const _hubSessionId = getHubSessionId();
        if (!_hubSessionId) return;
        try {
            await writeTerminalHubSystemTurn(
                _hubSessionId,
                `[SISTEMA] session.fatal após ${evt.attempts} tentativas: ${evt.originalError}`,
            );
        } catch (e) {
            logSwallowed(e, 'terminal.index.fatalWriteTurn');
        }
    });

    setupTerminalTaskStreamListeners({ agent: agentEvents });

    registerTerminalAgentSsePassthrough({
        agent: agentEvents,
        handledEvents: createTerminalHandledAgentEventsSet(),
        passthroughEvents: createTerminalPassthroughAgentEventsSet(),
    });
}
