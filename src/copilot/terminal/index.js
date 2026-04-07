// @ts-check
/**
 * src/copilot/terminal/index.js
 *
 * Ponto de entrada do Terminal Permanente LLM-B.
 *
 * Orquestra a inicialização sequencial de todos os subsistemas:
 *
 * 1. Carrega aliases customizados
 * 2. Cria o servidor HTTP de injeção (via `server.js`)
 * 3. Cria hub_session no ConversationStore (best-effort)
 * 4. Registra watchdogs e listeners de eventos do AlwaysAliveAgent
 * 5. Ativa o reflection loop periódico (se configurado)
 * 6. Inicia o REPL readline (via `repl.js`)
 *
 * @module copilot/terminal
 */

import { LLM_B_REFLECTION_INTERVAL_MIN } from '#copilot/config/env';
import { AGENT_EVENTS } from '#copilot/core';
import { log } from '#copilot/observability/logger';
import { resolve } from 'node:path';
import { alwaysAliveAgent, configureHookTools, setHub, setPermissionAgent } from '../agent/index.js';
import { loadAliases } from './alias-store.js';
import { getMcpStatus } from '../bridges/mcp-tool-bridge.js';
import { llmBridgeClient, setBridgeAgent } from '../channel/client.js';
import { PinnedFilesLoader } from '../config/pinned-files.js';
import { conversationHub } from '../conversation-hub/hub.js';
import { setFallbackAgent } from '../conversation-hub/orchestrator.js';
import { startTodoCleanupJob } from '../tools/todo/store.js';
import { broadcastSse, ensureDialogLoop, println, sendTurn } from './dialog.js';
import { startRepl } from './repl.js';
import { createInjectServer } from './server.js';
import { getHubSessionId, setHubSessionId } from './state.js';

/**
 * F10.3: Imprime o banner de diagnóstico do modo de operação (standalone vs. conectado ao server).
 *
 * Útil para o usuário do terminal saber quais recursos estão disponíveis.
 *
 * @returns {void}
 */
function printStandaloneBanner() {
    const mcp = getMcpStatus();
    const isStandalone = !mcp.available;
    const lines = [
        '',
        '┌─────────────────────────────────────────────────────────────┐',
        '│  Terminal Permanente LLM-B                                  │',
        isStandalone
            ? '│  Modo: STANDALONE  (server 3008 não detectado)              │'
            : `│  Modo: CONECTADO   (MCP: ${String(mcp.toolCount).padEnd(2)} tools via :3008)              │`,
        '│  Inject server: http://localhost:3009                       │',
        '│  Comandos: /help  /status  /skills  /ask                   │',
        '└─────────────────────────────────────────────────────────────┘',
        '',
    ];
    for (const line of lines) println(line);
    if (isStandalone) {
        println('  ⚠  MCP tools indisponíveis — tools locais ativas. Inicie src/server para habilitar.');
        println('');
    }
}

/** @type {boolean} */
let _agentListenersRegistered = false;

// T-20: armazenar referência do reflectionTimer em escopo de módulo para permitir cancelamento
/** @type {ReturnType<typeof setInterval> | null} */
let _reflectionTimer = null;

/**
 * Registra todos os event listeners do AlwaysAliveAgent no terminal server.
 *
 * @returns {void}
 */
function registerAgentEventListeners() {
    // T-14: guard contra registros duplicados (ex: hot-reload, tests)
    if (_agentListenersRegistered) return;
    _agentListenersRegistered = true;
    alwaysAliveAgent.on('dialog.stalled', async (/** @type {{ stalledMs: number }} */ evt) => {
        const secs = Math.round(evt.stalledMs / 1000);
        log('WARN', `[TerminalServer] Watchdog disparou (${secs}s inativo).`);

        // F52 (PARTE-9): Zero-PR Watchdog Recovery — tentar recuperar SEM consumir PR.
        // 1. Abortar mensagem travada (session.abort — 0 PR)
        await alwaysAliveAgent.abortCurrentMessage();

        // 2. Aguardar até 5s para o ask_user reaparecer (0 PR se reaparecer)
        const recovered = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(false), 5_000);
            const check = () => {
                if (alwaysAliveAgent.pendingQuestion) {
                    clearTimeout(timeout);
                    resolve(true);
                }
            };
            // Verificar imediatamente e a cada 500ms
            check();
            const interval = setInterval(() => {
                check();
                if (alwaysAliveAgent.pendingQuestion) clearInterval(interval);
            }, 500);
            setTimeout(() => clearInterval(interval), 5_100);
        });

        if (recovered) {
            // F52.3: ask_user reapareceu — dialog loop continua sem custo de PR
            println(`\n[watchdog] ✅  Dialog loop recuperado sem consumir PR (ask_user preservado).`);
            log('INFO', '[TerminalServer] F52: Watchdog recovery zero-PR — ask_user reapareceu após abort.');
            alwaysAliveAgent.pingDialogWatchdog();
            broadcastSse('dialog.stalled', { stalledMs: evt.stalledMs, recoveredZeroPR: true });
            return;
        }

        // F52.4: ask_user NÃO reapareceu — fallback para restart completo (1 PR)
        println(`\n[watchdog] ⚠️  Dialog loop inativo há ${secs}s — reiniciando (1 PR)…`);
        log('WARN', `[TerminalServer] F52: Watchdog recovery falhou — restart com boot prompt (1 PR).`);

        const _hubSessionId = getHubSessionId();
        if (_hubSessionId) {
            try {
                await conversationHub.store.writeTurn(_hubSessionId, {
                    role: 'user',
                    content: `[SISTEMA] Watchdog: dialog loop inativo por ${secs}s — reinício automático.`,
                });
            } catch {
                /* best-effort */
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
    alwaysAliveAgent.on('dialog.reply', (/** @type {{ reply: string }} */ evt) => {
        broadcastSse('dialog.reply', {
            content: evt.reply,
            timestamp: Date.now(),
            model: alwaysAliveAgent.model,
            reasoningEffort: alwaysAliveAgent.reasoningEffort ?? 'high',
        });
    });
    // F4.6 (UPG-11): emite dialog.loop.changed para dashboard responsivo
    alwaysAliveAgent.on('dialog.loop.changed', (/** @type {{ active: boolean; ts: number }} */ evt) => {
        broadcastSse('dialog.loop.changed', { active: evt.active, timestamp: evt.ts });
    });
    alwaysAliveAgent.on('dialog.ready', () => {
        broadcastSse('dialog.ready', {
            timestamp: Date.now(),
            model: alwaysAliveAgent.model,
            reasoningEffort: alwaysAliveAgent.reasoningEffort ?? 'high',
        });
    });

    // DL-PERM: dialog loop permanente — reinicia automaticamente se o modelo encerrar o loop.
    alwaysAliveAgent.on('dialog.stopped', (/** @type {{ reason: string; authorized?: boolean }} */ evt) => {
        const reason = evt.reason ?? 'desconhecido';

        if (reason === 'authorized_stop') {
            println(`\n\x1b[33m  [dialog] Loop encerrado por autorização explícita do usuário.\x1b[0m`);
            log('INFO', '[TerminalServer] Dialog loop encerrado com autorização do usuário.');
            broadcastSse('dialog.stopped', { authorized: true, reason });
            return;
        }

        // T-15: respeitar pausa intencional do usuário — não reiniciar se dialogPaused
        if (alwaysAliveAgent.dialogPaused) {
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
    alwaysAliveAgent.on('session.usage', (/** @type {{ currentTokens: number; tokenLimit: number }} */ data) => {
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
    alwaysAliveAgent.on(
        'session.compaction_complete',
        (/** @type {{ compactionTokensUsed?: { cachedInput?: number }; success?: boolean }} */ evt) => {
            const cachedInput = evt?.compactionTokensUsed?.cachedInput ?? 0;
            if (cachedInput > 0) {
                broadcastSse('session.compaction_complete', { cachedInput, timestamp: Date.now() });
            }
        },
    );

    // Persiste reconexões e sessões fatais no Hub
    alwaysAliveAgent.on(
        'ready',
        async (/** @type {{ sessionId: string; isResumed: boolean; reconected?: boolean }} */ evt) => {
            // F10.3: banner de status após agente pronto (só na primeira vez, não em reconexões)
            if (!evt.reconected) {
                printStandaloneBanner();
            }
            const _hubSessionId = getHubSessionId();
            if (!_hubSessionId || !evt.reconected) return;
            try {
                await conversationHub.store.writeTurn(_hubSessionId, {
                    role: 'user',
                    content: `[SISTEMA] Session reconectada: ${evt.sessionId} (retomada: ${evt.isResumed})`,
                });
            } catch {
                /* best-effort */
            }
        },
    );
    alwaysAliveAgent.on('session.fatal', async (/** @type {{ originalError: string; attempts: number }} */ evt) => {
        const _hubSessionId = getHubSessionId();
        if (!_hubSessionId) return;
        try {
            await conversationHub.store.writeTurn(_hubSessionId, {
                role: 'user',
                content: `[SISTEMA] session.fatal após ${evt.attempts} tentativas: ${evt.originalError}`,
            });
        } catch {
            /* best-effort */
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

    alwaysAliveAgent.on('task.delta', (/** @type {{ taskId?: string | null; chunk?: string }} */ evt) => {
        const chunk = evt?.chunk ?? '';
        if (!chunk) return;
        _startTaskBlock(evt.taskId ?? null);
        _writeTaskChunk(chunk);
    });
    alwaysAliveAgent.on('task.reasoning', (/** @type {{ taskId?: string | null; text?: string }} */ evt) => {
        const text = evt?.text ?? '';
        if (!text) return;
        _startTaskBlock(evt.taskId ?? null);
        _writeTaskChunk(`\x1b[2m${text}\x1b[22m`); // dim text para reasoning
    });
    alwaysAliveAgent.on('task.completed', () => {
        if (_activeTaskId) {
            process.stdout.write('\n');
            println('  \x1b[90m└── task complete ───┘\x1b[0m');
            _activeTaskId = null;
        }
    });
    alwaysAliveAgent.on('task.error', () => {
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
            alwaysAliveAgent.on(evt, (/** @type {unknown} */ data) => {
                broadcastSse(evt, /** @type {object} */ (data ?? {}));
            });
        }
    }
}

/**
 * Ativa o reflection loop periódico se `LLM_B_REFLECTION_INTERVAL_MIN` > 0.
 *
 * @returns {void}
 */
function startReflectionLoop() {
    const reflectionIntervalMin = LLM_B_REFLECTION_INTERVAL_MIN;
    if (reflectionIntervalMin <= 0) return;

    const reflectionIntervalMs = reflectionIntervalMin * 60 * 1000;
    log('INFO', `[TerminalServer] Reflection loop ativado: a cada ${reflectionIntervalMin}min.`);

    const runReflection = () => {
        if (!alwaysAliveAgent.dialogLoopActive) return;
        // ARCH-07 (fix): skip reflection se fila já tem tarefas para evitar acúmulo
        if (alwaysAliveAgent.queueSize > 0) {
            log('INFO', '[TerminalServer] Reflection loop pulado — fila ocupada.');
            return;
        }
        log('INFO', '[TerminalServer] Executando reflection loop…');
        sendTurn(
            '[REFLEXÃO] Faça uma breve reflexão sobre as últimas mensagens desta conversa: o que foi discutido, o que está pendente, e se você tem alguma sugestão ou insight que ainda não mencionou. Seja conciso.',
            'llm-a',
        ).catch((/** @type {any} */ e) => log('WARN', `[TerminalServer] Reflection loop falhou: ${e.message}`));
    };

    // T-20: armazenar referência em variável de módulo para permitir cancelamento no graceful shutdown
    _reflectionTimer = setInterval(runReflection, reflectionIntervalMs);
    if (typeof _reflectionTimer.unref === 'function') _reflectionTimer.unref();
}

/**
 * Inicia o Terminal Permanente LLM-B.
 *
 * @returns {Promise<void>}
 */
export async function startTerminalServer() {
    log('INFO', '[TerminalServer] Iniciando terminal permanente LLM-B…');

    loadAliases();

    // ARCH-02 (fix): injetar hub explicitamente nas hub-tools para evitar import dinâmico oculto
    setHub(conversationHub);
    // ARCH-03 (fix): injetar broadcastSse nas hook-tools para remover import dinâmico circular
    configureHookTools({ broadcastSse });
    // ARCH-03 (fix): injetar agent nas permission-tools e orchestrator para quebrar circular deps
    setPermissionAgent(alwaysAliveAgent);
    setFallbackAgent(alwaysAliveAgent);
    setBridgeAgent(alwaysAliveAgent);

    // ARCH-05 (fix): instanciar PinnedFilesLoader com paths reais dos skills e instruções
    // Isso habilita o comando /skills reload e o sistema de pinned context files
    const _root = resolve(import.meta.dirname, '../../..');
    const pinnedLoader = new PinnedFilesLoader([
        resolve(_root, '.github', 'skills'),
        resolve(_root, '.github', 'instructions'),
    ]);
    await pinnedLoader.start().catch((/** @type {any} */ e) => {
        log('WARN', `[TerminalServer] PinnedFilesLoader não pôde iniciar: ${e.message}`);
    });
    pinnedLoader.on('changed', (/** @type {{ file: string; type: string }} */ evt) => {
        // F13.5: hot-reload de skills/instruções sem reiniciar o agente.
        // buildHookSystemContext() já lê do disco a cada chamada (sem cache), então a próxima
        // sessão ou turno que chamar initOrResumeSession receberá automaticamente o conteúdo atualizado.
        // Aqui apenas emitimos o evento SSE para que LLM-A (e dashboards) sejam notificados.
        const updatedAt = new Date().toISOString();
        const fileCount = pinnedLoader.getFiles().length;
        log(
            'WARN',
            `[TerminalServer] Skills/instruções atualizadas — hot-reload ativo (${fileCount} arquivo(s), trigger: ${evt?.file ?? 'unknown'})`,
        );
        broadcastSse('skills.reloaded', {
            updatedAt,
            fileCount,
            trigger: evt?.file ?? null,
            type: evt?.type ?? 'change',
            note: 'Context refreshed. Next session turn will use updated skills/instructions.',
        });
    });

    const injectServer = createInjectServer();

    // Criar hub_session permanente (best-effort)
    try {
        conversationHub.initStandalone();
        const hubSessionId = conversationHub.store.createHubSession({
            title: 'Terminal Permanente LLM-B',
            metadata: { source: 'terminal-server', startedAt: new Date().toISOString() },
        });
        setHubSessionId(hubSessionId);
        log('INFO', `[TerminalServer] Hub session criada: ${hubSessionId}`);
    } catch (/** @type {any} */ e) {
        log('WARN', `[TerminalServer] Hub storage indisponível, continua sem persistência: ${e.message}`);
    }

    registerAgentEventListeners();
    startReflectionLoop();

    // F7.1: cleanup diário de tarefas TODO antigas (done/cancelled > 7 dias)
    startTodoCleanupJob();

    // T-21: graceful shutdown handlers para SIGTERM/SIGINT
    const _onShutdown = () => {
        log('INFO', '[TerminalServer] Sinal de encerramento recebido — cleanup...');
        if (_reflectionTimer !== null) {
            clearInterval(_reflectionTimer);
            _reflectionTimer = null;
        }
    };
    process.once('SIGTERM', _onShutdown);
    process.once('SIGINT', _onShutdown);

    // T-22: SIGHUP é enviado pelo VS Code quando o painel do terminal é fechado.
    // Ignorar para manter o inject server HTTP ativo mesmo após o painel ser fechado.
    process.on('SIGHUP', () => {
        log('INFO', '[TerminalServer] SIGHUP recebido — mantendo inject server ativo (painel reaberto).');
    });

    // F13.2: emitir evento terminal.started com snapshot de boot para monitoramento
    broadcastSse('terminal.started', {
        timestamp: Date.now(),
        operationMode: (() => {
            const s = getMcpStatus();
            return s.available && s.toolCount > 0 && !s.circuitOpen ? 'connected' : 'standalone';
        })(),
        mcpToolCount: getMcpStatus().toolCount,
        hubSessionId: getHubSessionId(),
        dialogLoopActive: alwaysAliveAgent.dialogLoopActive,
        model: alwaysAliveAgent.model,
    });
    log('INFO', '[TerminalServer] terminal.started emitido.');

    await startRepl(injectServer);
}
