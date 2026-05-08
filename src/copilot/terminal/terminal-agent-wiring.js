// @ts-check
/**
 * src/copilot/terminal/terminal-agent-wiring.js
 *
 * Wiring de eventos do AlwaysAliveAgent → terminal server (SSE broadcast, watchdog, streaming). Extração de
 * `registerAgentEventListeners` do `index.js` para separação de responsabilidades.
 *
 * @module copilot/terminal/terminal-agent-wiring
 * @see EventBus
 */

import { LLM_B_TURN_TIMEOUT_MS } from '#copilot/config';
import {
    EMITTER_ASSISTANT_STREAMING_DELTA,
    EMITTER_DIALOG_LOOP_CHANGED,
    EMITTER_DIALOG_READY,
    EMITTER_DIALOG_REPLY,
    EMITTER_DIALOG_STALLED,
    EMITTER_DIALOG_STOPPED,
    EMITTER_SESSION_FATAL,
    EMITTER_SESSION_USAGE,
} from '#copilot/events';
import { log } from '#copilot/observability';
import { logSwallowed } from '../core/error-handlers.js';
import { getHubSessionId } from '../presentation/runtime-ui-state-store.js';
import { markTerminalActivityIdle, recordTerminalActivity } from './activity-state.js';
import { registerTerminalAgentSsePassthrough } from './agent-sse-passthrough.js';
import { broadcastSse, ensureDialogLoop, println } from './dialog/index.js';
import {
    createTerminalHandledAgentEventsSet,
    createTerminalPassthroughAgentEventsSet,
} from './event-adapter-events.js';
import { setupTerminalHeadlessEventAdapters } from './event-adapters.js';
import {
    abortTerminalCurrentMessage,
    pingTerminalDialogWatchdog,
    readTerminalAgentRuntimeEventHost,
    readTerminalDialogStreamMeta,
    readTerminalRuntimeState,
} from './frontend/gateways/agent-runtime.js';
import { stopTerminalDialogMode } from './frontend/gateways/dialog.js';
import { writeTerminalHubSystemTurn } from './frontend/gateways/hub.js';
import { setupTerminalTaskStreamListeners } from './task-stream-events.js';

/** @type {boolean} */
let _agentListenersRegistered = false;

const WATCHDOG_RECOVERY_WAIT_MS = Math.max(5_000, Math.min(30_000, Math.round(LLM_B_TURN_TIMEOUT_MS * 0.2)));

const AUTO_RESTART_DIALOG_STOP_REASONS = new Set(['watchdog_restart', 'model_stopped']);

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
    if (!process.stdin.isTTY) {
        setupTerminalHeadlessEventAdapters();
    }
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
            broadcastSse('dialog.stalled', {
                stalledMs: evt.stalledMs,
                ignored: true,
                reason: 'waiting_for_input_question',
            });
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
        const recovered = await new Promise((resolve) => {
            let settled = false;
            const settle = (/** @type {boolean} */ value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            const timeout = setTimeout(() => settle(false), WATCHDOG_RECOVERY_WAIT_MS);
            const check = () => {
                if (readTerminalRuntimeState().pendingQuestionKind === 'ready') {
                    clearTimeout(timeout);
                    settle(true);
                }
            };
            // BUG-WDOG-02: check() imediato pode resolver a Promise antes do setInterval ser
            // criado, deixando interval e timeout cleanup pendentes por WATCHDOG_RECOVERY_WAIT_MS.
            // Solução: verificar `settled` antes de criar o interval.
            check();
            if (settled) return;
            const interval = setInterval(() => {
                check();
                if (settled) clearInterval(interval);
            }, 500);
            setTimeout(() => clearInterval(interval), WATCHDOG_RECOVERY_WAIT_MS + 100);
        });

        if (recovered) {
            // F52.3: ask_user reapareceu — dialog loop continua sem custo de PR
            println(`\n[watchdog] ✅  Dialog loop recuperado sem consumir PR (ask_user preservado).`);
            log('INFO', '[TerminalServer] F52: Watchdog recovery zero-PR — ask_user reapareceu após abort.');
            pingTerminalDialogWatchdog();
            broadcastSse('dialog.stalled', { stalledMs: evt.stalledMs, recoveredZeroPR: true });
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
        broadcastSse('dialog.stalled', { stalledMs: evt.stalledMs, recoveredZeroPR: false });
    });

    // SSE: transmite respostas da LLM-B para clientes subscritos
    agentEvents.on(EMITTER_DIALOG_REPLY, (/** @type {{ reply: string }} */ evt) => {
        const { model, reasoningEffort } = readTerminalDialogStreamMeta();
        broadcastSse('dialog.reply', {
            content: evt.reply,
            timestamp: Date.now(),
            model,
            reasoningEffort,
        });
    });
    // F4.6 (UPG-11): emite dialog.loop.changed para dashboard responsivo
    agentEvents.on(EMITTER_DIALOG_LOOP_CHANGED, (/** @type {{ active: boolean; ts: number }} */ evt) => {
        broadcastSse('dialog.loop.changed', { active: evt.active, timestamp: evt.ts });
    });
    agentEvents.on(EMITTER_DIALOG_READY, () => {
        const { model, reasoningEffort } = readTerminalDialogStreamMeta();
        markTerminalActivityIdle('Aguardando próxima mensagem');
        broadcastSse('dialog.ready', {
            timestamp: Date.now(),
            model,
            reasoningEffort,
        });
    });
    agentEvents.on(EMITTER_ASSISTANT_STREAMING_DELTA, (/** @type {{ totalResponseSizeBytes?: number }} */ evt) => {
        const totalBytes = Number(evt?.totalResponseSizeBytes ?? 0);
        if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
            return;
        }
        recordTerminalActivity('streaming', 'Transmitindo resposta', {
            detail: `${Math.round(totalBytes / 1024)} KB recebidos`,
            source: 'sdk',
            recordHistory: false,
        });
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
            broadcastSse('dialog.stopped', { authorized: true, reason, recovery: true });
            return;
        }

        if (reason === 'authorized_stop') {
            recordTerminalActivity('system', 'Dialog loop encerrado', {
                detail: 'Parado por autorização explícita do usuário',
                source: 'dialog',
            });
            println(`\n\x1b[33m  [dialog] Loop encerrado por autorização explícita do usuário.\x1b[0m`);
            log('INFO', '[TerminalServer] Dialog loop encerrado com autorização do usuário.');
            broadcastSse('dialog.stopped', { authorized: true, reason });
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
            broadcastSse('dialog.stopped', { reason, paused: true });
            return;
        }

        const isWatchdog = reason === 'watchdog_restart';
        const label = isWatchdog ? 'reinício por watchdog' : `reason: ${reason}`;
        if (!shouldAutoRestartStoppedDialog(reason)) {
            recordTerminalActivity('system', 'Dialog loop encerrado sem restart automático', {
                detail: label,
                severity: 'warn',
                source: 'dialog',
            });
            println(
                `\n\x1b[33m  [dialog] Loop encerrado (${label}). Restart automático bloqueado; use /dialog-resume se precisar.\x1b[0m`,
            );
            log(
                'WARN',
                `[TerminalServer] Dialog loop encerrado (${label}). Restart automático bloqueado por política.`,
            );
            broadcastSse('dialog.stopped', { reason, restarting: false });
            return;
        }
        recordTerminalActivity('system', 'Reiniciando dialog loop', {
            detail: label,
            severity: 'warn',
            source: 'dialog',
        });
        println(`\n\x1b[33m  [dialog] Loop encerrado (${label}) — reiniciando automaticamente…\x1b[0m`);
        log('WARN', `[TerminalServer] Dialog loop encerrado (${label}). Reiniciando.`);
        broadcastSse('dialog.stopped', { reason, restarting: true });
        ensureDialogLoop().catch((e) =>
            log('ERROR', `[TerminalServer] Falha ao reiniciar dialog loop após stop: ${e.message}`),
        );
    });

    // AA.4: SSE 'context' event
    agentEvents.on(EMITTER_SESSION_USAGE, (/** @type {{ currentTokens: number; tokenLimit: number }} */ data) => {
        const { currentTokens = 0, tokenLimit = 0 } = data;
        if (tokenLimit > 0) {
            broadcastSse('session.usage', {
                tokens: currentTokens,
                tokenLimit,
                utilization: currentTokens / tokenLimit,
                timestamp: Date.now(),
            });
        }
    });

    // AB.4: SSE 'cache.hit'
    agentEvents.on(
        'session.compaction_complete',
        (/** @type {{ compactionTokensUsed?: { cachedInput?: number }; success?: boolean }} */ evt) => {
            const cachedInput = evt?.compactionTokensUsed?.cachedInput ?? 0;
            if (cachedInput > 0) {
                broadcastSse('session.compaction_complete', { cachedInput, timestamp: Date.now() });
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
