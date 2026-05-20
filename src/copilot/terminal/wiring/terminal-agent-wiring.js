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
import { markTerminalActivityIdle, recordTerminalActivity } from '../state/dialog/index.js';
import { shouldSuppressTerminalAssistantMessageAsMaterializedTurn, withTerminalTurnCorrelation } from '../state/events/index.js';
import { drainMailboxToTurnIfIdle } from './mailbox-drain.js';

/** @type {boolean} */
let _agentListenersRegistered = false;

const WATCHDOG_RECOVERY_WAIT_MS = Math.max(5_000, Math.min(30_000, Math.round(LLM_B_TURN_TIMEOUT_MS * 0.2)));

const AUTO_RESTART_DIALOG_STOP_REASONS = new Set(['watchdog_restart', 'model_stopped']);
const EMITTER_DIALOG_TURN_END = 'dialog.turn_end';

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
 * Política local de UX: restart automático é exceção. O Agent continua sendo dono do lifecycle, mas o terminal só
 * reabre o loop sozinho quando a razão representa falha operacional clara.
 *
 * @param {string} reason
 * @returns {boolean}
 */
export function shouldAutoRestartStoppedDialog(reason) {
    return AUTO_RESTART_DIALOG_STOP_REASONS.has(reason);
}

/**
 * Descreve a política operacional aplicada a uma parada do dialog loop.
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
            activityTitle: 'Dialog loop preservado após reconexão',
            activityDetail: 'reconexão SDK concluída; reenvio automático de prompt bloqueado',
            terminalMessage:
                'Loop reconectado; reenvio automático do prompt foi bloqueado para evitar duplicação. Use /dialog-resume ou reenvie a mensagem se quiser continuar.',
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
        activityTitle: 'Dialog loop encerrado sem restart automático',
        activityDetail: label,
        terminalMessage: `Loop encerrado (${label}). Restart automático bloqueado; use /dialog-resume se precisar.`,
        sse: { reason, restarting: false },
    };
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
                recovered ? 'Dialog loop recuperado' : 'Dialog loop recovery sem reanexo',
                {
                    detail: `${reason} · ${strategy} · ${prConsumed ? '1 PR' : 'zero-PR'} · ${duration}`,
                    severity,
                    source: 'dialog',
                },
            );
            if (!success || prConsumed) {
                const label = success ? 'recuperado com restart' : 'falha no recovery';
                println(`\n\x1b[33m  [dialog] ${label}: ${strategy} · ${reason} · ${duration}\x1b[0m`);
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
            // F52.3: ask_user reapareceu — dialog loop continua sem custo de PR
            println(`\n[watchdog] ✅  Dialog loop recuperado sem consumir PR (ask_user preservado).`);
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
        println(`\n[watchdog] ⚠️  Dialog loop inativo há ${secs}s — reiniciando (1 PR)…`);
        log('WARN', `[TerminalServer] F52: Watchdog recovery falhou — restart com boot prompt (1 PR).`);

        const _hubSessionId = getHubSessionId();
        if (_hubSessionId) {
            try {
                await writeTerminalHubSystemTurn(
                    _hubSessionId,
                    `[SISTEMA] Watchdog: dialog loop inativo por ${secs}s — reinício automático.`,
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
                detail: `${secs}s — status=${runtimeState.status}, ping preventivo emitido`,
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

        // Loop genuinamente inativo: aviso visual com tempo restante estimado
        println(
            `\n\x1b[33m[watchdog] ⚠️  Pré-stall: loop inativo há ${secs}s (~${remainingSecs}s para restart automático).\x1b[0m`,
        );
        log('WARN', `[TerminalServer] Pré-stall: loop inativo há ${secs}s (~${remainingSecs}s restantes).`);
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
            const reply = typeof evt.reply === 'string' ? evt.reply : '';
            const turnId =
                typeof evt.turnId === 'string' || typeof evt.turnId === 'number' ? String(evt.turnId) : null;
            const envelope = withTerminalAgentSseEnvelope(
                {
                    ...evt,
                    reply,
                    ...(turnId ? { turnId } : {}),
                },
                'terminal-agent-wiring/dialog.turn_end',
            );
            broadcastSse('dialog.turn_end', envelope);
            if (!reply.trim()) return;
            if (shouldSuppressTerminalAssistantMessageAsMaterializedTurn({ content: reply, turnId })) {
                recordTerminalActivity('turn', 'dialog.turn_end reconciliado sem novo bloco visual', {
                    detail: turnId ? `turn=${turnId} · conteúdo já materializado` : 'conteúdo já materializado',
                    source: 'dialog.turn_end',
                    recordHistory: false,
                    updateCurrent: false,
                });
                return;
            }
            recordTerminalActivity('turn', 'Mensagem final do dialog loop recebida', {
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
    agentEvents.on(EMITTER_DIALOG_LOOP_CHANGED, (/** @type {{ active: boolean; ts: number }} */ evt) => {
        broadcastSse(
            'dialog.loop.changed',
            withTerminalAgentSseEnvelope(
                { active: evt.active, timestamp: evt.ts },
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
        // Drain do mailbox zero-PR: cobre abort pelo watchdog (que não dispara TURN_END).
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

    // DL-PERM: dialog loop permanente — reinicia automaticamente se o modelo encerrar o loop.
    agentEvents.on(EMITTER_DIALOG_STOPPED, (/** @type {{ reason: string; authorized?: boolean }} */ evt) => {
        const reason = evt.reason ?? 'desconhecido';

        if (reason === 'recovery_restart') {
            recordTerminalActivity('system', 'Dialog loop em recuperação', {
                detail: 'Reinício semântico coordenado pelo Agent',
                source: 'dialog',
            });
            log('INFO', '[TerminalServer] Dialog loop encerrado para recovery semântico coordenado pelo Agent.');
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
            recordTerminalActivity('system', 'Dialog loop encerrado', {
                detail: 'Parado por autorização explícita do usuário',
                source: 'dialog',
            });
            println(`\n\x1b[33m  [dialog] Loop encerrado por autorização explícita do usuário.\x1b[0m`);
            log('INFO', '[TerminalServer] Dialog loop encerrado com autorização do usuário.');
            broadcastSse(
                'dialog.stopped',
                withTerminalAgentSseEnvelope({ authorized: true, reason }, 'terminal-agent-wiring/dialog.stopped'),
            );
            return;
        }

        // T-15: respeitar pausa intencional do usuário — não reiniciar se dialogPaused
        if (readTerminalRuntimeState().dialogPaused) {
            recordTerminalActivity('system', 'Dialog loop pausado', {
                detail: `Encerrado enquanto pausado (${reason})`,
                source: 'dialog',
            });
            println(`\n\x1b[33m  [dialog] Loop encerrado enquanto pausado pelo usuário — não reiniciando.\x1b[0m`);
            log('INFO', '[TerminalServer] Dialog loop encerrado com dialogPaused=true. Não reiniciando.');
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
                `[TerminalServer] Dialog loop encerrado (${stopPolicy.label}). Restart automático bloqueado por política.`,
            );
            broadcastSse(
                'dialog.stopped',
                withTerminalAgentSseEnvelope(stopPolicy.sse, 'terminal-agent-wiring/dialog.stopped'),
            );
            return;
        }
        const isWatchdog = reason === 'watchdog_restart';
        const label = isWatchdog ? 'reinício por watchdog' : `reason: ${reason}`;
        recordTerminalActivity('system', 'Reiniciando dialog loop', {
            detail: label,
            severity: 'warn',
            source: 'dialog',
        });
        println(`\n\x1b[33m  [dialog] Loop encerrado (${label}) — reiniciando automaticamente…\x1b[0m`);
        log('WARN', `[TerminalServer] Dialog loop encerrado (${label}). Reiniciando.`);
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
