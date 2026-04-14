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
    AGENT_EVENTS,
    EMITTER_DIALOG_LOOP_CHANGED,
    EMITTER_DIALOG_READY,
    EMITTER_DIALOG_REPLY,
    EMITTER_DIALOG_STALLED,
    EMITTER_DIALOG_STOPPED,
    EMITTER_SESSION_FATAL,
    EMITTER_SESSION_USAGE,
    EMITTER_TASK_COMPLETED,
    EMITTER_TASK_DELTA,
    EMITTER_TASK_ERROR,
    EMITTER_TASK_REASONING,
} from '#copilot/events';
import { log } from '#copilot/observability';
import { ALWAYS_ALIVE_AGENT } from '../agent/di-tokens.js';
import { llmBridgeClient } from '../channel/client.js';
import { HUB } from '../conversation-hub/di-tokens.js';
import { container } from '../core/di-container.js';
import { logSwallowed } from '../core/error-handlers.js';
import { broadcastSse, ensureDialogLoop, println } from './dialog.js';
import { getHubSessionId } from './state.js';

/** @returns {import('../agent/always-alive.js').AlwaysAliveAgent} */
const getAgent = () => container.resolve(ALWAYS_ALIVE_AGENT);

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
    getAgent().on(EMITTER_DIALOG_STALLED, async (/** @type {{ stalledMs: number }} */ evt) => {
        const secs = Math.round(evt.stalledMs / 1000);
        log('WARN', `[TerminalServer] Watchdog disparou (${secs}s inativo).`);

        // F52 (PARTE-9): Zero-PR Watchdog Recovery — tentar recuperar SEM consumir PR.
        // 1. Abortar mensagem travada (session.abort — 0 PR)
        await getAgent().abortCurrentMessage();

        // 2. Aguardar até 5s para o ask_user reaparecer (0 PR se reaparecer)
        const recovered = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(false), 5_000);
            const check = () => {
                if (getAgent().pendingQuestion) {
                    clearTimeout(timeout);
                    resolve(true);
                }
            };
            // Verificar imediatamente e a cada 500ms
            check();
            const interval = setInterval(() => {
                check();
                if (getAgent().pendingQuestion) clearInterval(interval);
            }, 500);
            setTimeout(() => clearInterval(interval), 5_100);
        });

        if (recovered) {
            // F52.3: ask_user reapareceu — dialog loop continua sem custo de PR
            println(`\n[watchdog] ✅  Dialog loop recuperado sem consumir PR (ask_user preservado).`);
            log('INFO', '[TerminalServer] F52: Watchdog recovery zero-PR — ask_user reapareceu após abort.');
            getAgent().pingDialogWatchdog();
            broadcastSse('dialog.stalled', { stalledMs: evt.stalledMs, recoveredZeroPR: true });
            return;
        }

        // F52.4: ask_user NÃO reapareceu — fallback para restart completo (1 PR)
        println(`\n[watchdog] ⚠️  Dialog loop inativo há ${secs}s — reiniciando (1 PR)…`);
        log('WARN', `[TerminalServer] F52: Watchdog recovery falhou — restart com boot prompt (1 PR).`);

        const _hubSessionId = getHubSessionId();
        if (_hubSessionId) {
            try {
                await container.resolve(HUB).store.writeTurn(_hubSessionId, {
                    role: 'user',
                    content: `[SISTEMA] Watchdog: dialog loop inativo por ${secs}s — reinício automático.`,
                });
            } catch (/** @type {any} */ e) {
                logSwallowed(e, 'terminal.index.watchdogWriteTurn');
            }
        }
        // DL-PERM-06: stopDialogMode() usará reason='watchdog_restart', que o handler de
        // 'dialog.stopped' capturará e chamará ensureDialogLoop(). Não chamar ensureDialogLoop()
        // aqui diretamente para evitar duplo restart.
        llmBridgeClient.stopDialogMode().catch((/** @type {any} */ e) => {
            log('ERROR', `[TerminalServer] Falha ao parar dialog loop no watchdog: ${e.message}`);
            // Fallback: se stopDialogMode() falhar, tentar reiniciar diretamente
            ensureDialogLoop().catch((/** @type {any} */ e2) =>
                log('ERROR', `[TerminalServer] Falha no fallback de restart após watchdog: ${e2.message}`),
            );
        });
        broadcastSse('dialog.stalled', { stalledMs: evt.stalledMs, recoveredZeroPR: false });
    });

    // SSE: transmite respostas da LLM-B para clientes subscritos
    getAgent().on(EMITTER_DIALOG_REPLY, (/** @type {{ reply: string }} */ evt) => {
        broadcastSse('dialog.reply', {
            content: evt.reply,
            timestamp: Date.now(),
            model: getAgent().model,
            reasoningEffort: getAgent().reasoningEffort ?? 'high',
        });
    });
    // F4.6 (UPG-11): emite dialog.loop.changed para dashboard responsivo
    getAgent().on(EMITTER_DIALOG_LOOP_CHANGED, (/** @type {{ active: boolean; ts: number }} */ evt) => {
        broadcastSse('dialog.loop.changed', { active: evt.active, timestamp: evt.ts });
    });
    getAgent().on(EMITTER_DIALOG_READY, () => {
        broadcastSse('dialog.ready', {
            timestamp: Date.now(),
            model: getAgent().model,
            reasoningEffort: getAgent().reasoningEffort ?? 'high',
        });
    });

    // DL-PERM: dialog loop permanente — reinicia automaticamente se o modelo encerrar o loop.
    getAgent().on(EMITTER_DIALOG_STOPPED, (/** @type {{ reason: string; authorized?: boolean }} */ evt) => {
        const reason = evt.reason ?? 'desconhecido';

        if (reason === 'authorized_stop') {
            println(`\n\x1b[33m  [dialog] Loop encerrado por autorização explícita do usuário.\x1b[0m`);
            log('INFO', '[TerminalServer] Dialog loop encerrado com autorização do usuário.');
            broadcastSse('dialog.stopped', { authorized: true, reason });
            return;
        }

        // T-15: respeitar pausa intencional do usuário — não reiniciar se dialogPaused
        if (getAgent().dialogPaused) {
            println(`\n\x1b[33m  [dialog] Loop encerrado enquanto pausado pelo usuário — não reiniciando.\x1b[0m`);
            log('INFO', '[TerminalServer] Dialog loop encerrado com dialogPaused=true. Não reiniciando.');
            broadcastSse('dialog.stopped', { reason, paused: true });
            return;
        }

        const isWatchdog = reason === 'watchdog_restart';
        const label = isWatchdog ? 'reinício por watchdog' : `reason: ${reason}`;
        println(`\n\x1b[33m  [dialog] Loop encerrado (${label}) — reiniciando automaticamente…\x1b[0m`);
        log('WARN', `[TerminalServer] Dialog loop encerrado (${label}). Reiniciando.`);
        broadcastSse('dialog.stopped', { reason, restarting: true });
        ensureDialogLoop().catch((/** @type {any} */ e) =>
            log('ERROR', `[TerminalServer] Falha ao reiniciar dialog loop após stop: ${e.message}`),
        );
    });

    // AA.4: SSE 'context' event
    getAgent().on(EMITTER_SESSION_USAGE, (/** @type {{ currentTokens: number; tokenLimit: number }} */ data) => {
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
    getAgent().on(
        'session.compaction_complete',
        (/** @type {{ compactionTokensUsed?: { cachedInput?: number }; success?: boolean }} */ evt) => {
            const cachedInput = evt?.compactionTokensUsed?.cachedInput ?? 0;
            if (cachedInput > 0) {
                broadcastSse('session.compaction_complete', { cachedInput, timestamp: Date.now() });
            }
        },
    );

    // Persiste reconexões e sessões fatais no Hub
    getAgent().on(
        'ready',
        async (/** @type {{ sessionId: string; isResumed: boolean; reconected?: boolean }} */ evt) => {
            // F10.3: banner de status após agente pronto (só na primeira vez, não em reconexões)
            if (!evt.reconected) {
                printBanner();
            }
            const _hubSessionId = getHubSessionId();
            if (!_hubSessionId || !evt.reconected) return;
            try {
                await container.resolve(HUB).store.writeTurn(_hubSessionId, {
                    role: 'user',
                    content: `[SISTEMA] Session reconectada: ${evt.sessionId} (retomada: ${evt.isResumed})`,
                });
            } catch (/** @type {any} */ e) {
                logSwallowed(e, 'terminal.index.reconnectWriteTurn');
            }
        },
    );
    getAgent().on(EMITTER_SESSION_FATAL, async (/** @type {{ originalError: string; attempts: number }} */ evt) => {
        const _hubSessionId = getHubSessionId();
        if (!_hubSessionId) return;
        try {
            await container.resolve(HUB).store.writeTurn(_hubSessionId, {
                role: 'user',
                content: `[SISTEMA] session.fatal após ${evt.attempts} tentativas: ${evt.originalError}`,
            });
        } catch (/** @type {any} */ e) {
            logSwallowed(e, 'terminal.index.fatalWriteTurn');
        }
    });

    // ── F36.3: Terminal buffer para task streaming ─────────────────────────
    // Quando task.delta/task.reasoning são emitidos fora do dialog loop, renderiza no terminal.
    // Rastreia a task ativa por ID para evitar estado inconsistente com tasks concorrentes.

    /** @type {string | null} ID da task com streaming ativo */
    let _activeTaskId = null;

    /**
     * Inicia o bloco visual de task streaming (se não houver um ativo).
     *
     * @param {string | null} taskId
     */
    const _startTaskBlock = (taskId) => {
        if (_activeTaskId) return; // já há um streaming ativo
        _activeTaskId = taskId ?? '__anonymous__';
        println('');
        println(`  \x1b[90m┌── task streaming${taskId ? ` (${taskId})` : ''} ──┐\x1b[0m`);
        process.stdout.write('  \x1b[90m│\x1b[0m  ');
    };

    /**
     * Escreve texto no bloco de streaming (com word-wrap por linhas).
     *
     * @param {string} text
     */
    const _writeTaskChunk = (text) => {
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (i > 0) process.stdout.write('\n  \x1b[90m│\x1b[0m  ');
            process.stdout.write(/** @type {string} */ (lines[i]));
        }
    };

    getAgent().on(EMITTER_TASK_DELTA, (/** @type {{ taskId?: string | null; chunk?: string }} */ evt) => {
        const chunk = evt?.chunk ?? '';
        if (!chunk) return;
        _startTaskBlock(evt.taskId ?? null);
        _writeTaskChunk(chunk);
    });
    getAgent().on(EMITTER_TASK_REASONING, (/** @type {{ taskId?: string | null; text?: string }} */ evt) => {
        const text = evt?.text ?? '';
        if (!text) return;
        _startTaskBlock(evt.taskId ?? null);
        _writeTaskChunk(`\x1b[2m${text}\x1b[22m`); // dim text para reasoning
    });
    getAgent().on(EMITTER_TASK_COMPLETED, () => {
        if (_activeTaskId) {
            process.stdout.write('\n');
            println('  \x1b[90m└── task complete ───┘\x1b[0m');
            _activeTaskId = null;
        }
    });
    getAgent().on(EMITTER_TASK_ERROR, () => {
        if (_activeTaskId) {
            process.stdout.write('\n');
            println('  \x1b[31m└── task error ──────┘\x1b[0m');
            _activeTaskId = null;
        }
    });

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
        'ready',
        'session.fatal',
        'task.delta',
        'task.completed',
        'task.error',
        'task.reasoning',
    ]);
    for (const evt of AGENT_EVENTS) {
        if (!handledEvents.has(evt)) {
            getAgent().on(evt, (/** @type {unknown} */ data) => {
                broadcastSse(evt, /** @type {object} */ (data ?? {}));
            });
        }
    }
}
