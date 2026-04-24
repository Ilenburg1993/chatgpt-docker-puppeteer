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
import { registerUnhandledAgentSseFallback } from './agent-sse-fallback.js';
import { broadcastSse, ensureDialogLoop, println } from './dialog/index.js';
import {
    abortTerminalCurrentMessage,
    pingTerminalDialogWatchdog,
    readTerminalAgentRuntimeEventHost,
    readTerminalDialogStreamMeta,
    readTerminalRuntimeState,
    stopTerminalDialogMode,
    writeTerminalHubSystemTurn,
} from './frontend/llm-b-runtime.js';
import { setupTerminalTaskStreamListeners } from './task-stream-events.js';

/** @type {boolean} */
let _agentListenersRegistered = false;

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
    agentEvents.on(EMITTER_DIALOG_STALLED, async (/** @type {{ stalledMs: number }} */ evt) => {
        const secs = Math.round(evt.stalledMs / 1000);
        recordTerminalActivity('system', 'Watchdog disparou', {
            detail: `${secs}s sem progresso`,
            severity: 'warn',
            source: 'watchdog',
        });
        log('WARN', `[TerminalServer] Watchdog disparou (${secs}s inativo).`);

        // F52 (PARTE-9): Zero-PR Watchdog Recovery — tentar recuperar SEM consumir PR.
        // 1. Abortar mensagem travada (session.abort — 0 PR)
        await abortTerminalCurrentMessage();

        // 2. Aguardar até 5s para o ask_user reaparecer (0 PR se reaparecer)
        const recovered = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(false), 5_000);
            const check = () => {
                if (readTerminalRuntimeState().pendingQuestionKind === 'ready') {
                    clearTimeout(timeout);
                    resolve(true);
                }
            };
            // Verificar imediatamente e a cada 500ms
            check();
            const interval = setInterval(() => {
                check();
                if (readTerminalRuntimeState().pendingQuestionKind === 'ready') clearInterval(interval);
            }, 500);
            setTimeout(() => clearInterval(interval), 5_100);
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

    // BUG-EVDUP-01 (fix): auto-wiring genérico para AGENT_EVENTS sem handler específico.
    // Garante que novos eventos adicionados a AGENT_EVENTS sejam automaticamente broadcast
    // no terminal SSE sem necessidade de wiring manual em cada adição.
    /** @type {Set<string>} */
    const handledEvents = new Set([
        'dialog.stalled',
        'dialog.reply',
        'dialog.loop.changed',
        'dialog.ready',
        'dialog.stopped',
        'session.usage',
        'session.compaction_complete',
        'question.pending',
        'stopped',
        'tool.execution_start',
        'tool.execution_partial_result',
        'tool.execution_progress',
        'tool.execution_complete',
        'session.error',
        'session.info',
        'session.warning',
        'session.model_changed',
        'session.context_changed',
        'session.mode_changed',
        'session.plan_changed',
        'session.task_complete',
        'session.truncation',
        'session.snapshot_rewind',
        'session.shutdown',
        'session.handoff',
        'session.workspace_file_changed',
        'exit_plan_mode.completed',
        'session.compaction_start',
        'assistant.intent',
        'assistant.reasoning_complete',
        'subagent.started',
        'subagent.completed',
        'subagent.failed',
        'ready',
        'session.fatal',
        'task.delta',
        'task.completed',
        'task.error',
        'task.reasoning',
    ]);
    registerUnhandledAgentSseFallback({ agent: agentEvents, handledEvents });
}
