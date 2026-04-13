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
 * @see EventBus
 */

import { LLM_B_REFLECTION_INTERVAL_MIN } from '#copilot/config';
import { bridgeEmitter } from '#copilot/core';
import { CONFIG_PINNED_FILES_CHANGED } from '#copilot/events';
import { log } from '#copilot/observability';
import { resolve } from 'node:path';
import { alwaysAliveAgent } from '../agent/index.js';
import { getMcpStatus } from '../bridges/mcp-tool-bridge.js';
import { PinnedFilesLoader } from '../config/pinned-files.js';
import { conversationHub } from '../conversation-hub/hub.js';
import { container } from '../core/di-container.js';
import { EVENT_BUS } from '../core/di-tokens.js';
import { registerTimer } from '../core/timer-registry.js';
import { startCopilotServer } from '../server/index.js';
import { startTodoCleanupJob } from '../tools/todo/store.js';
import { loadAliasesAsync } from './alias-store.js';
import { wireTerminalDI } from './di-wiring.js';
import { broadcastSse, println, sendTurn } from './dialog.js';
import { startRepl } from './repl.js';
import { getHubSessionId, setHubSessionId } from './state.js';
import { registerAgentEventListeners } from './terminal-agent-wiring.js';

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

// T-20: armazenar referência do reflectionTimer em escopo de módulo para permitir cancelamento
/** @type {ReturnType<typeof setInterval> | null} */
let _reflectionTimer = null;

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
    // F153: registrar no timer-registry para cleanup automático via shutdown handler centralizado
    _reflectionTimer = setInterval(runReflection, reflectionIntervalMs);
    if (typeof _reflectionTimer.unref === 'function') _reflectionTimer.unref();
    registerTimer('terminal.reflection', 'interval', _reflectionTimer);
}

/**
 * Inicia o Terminal Permanente LLM-B.
 *
 * @returns {Promise<void>}
 */
export async function startTerminalServer() {
    log('INFO', '[TerminalServer] Iniciando terminal permanente LLM-B…');

    await loadAliasesAsync();

    // DI wiring extraído para di-wiring.js — registra tokens agent/tools e injeta setters legados
    wireTerminalDI();

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

    // FAIXA-2C: bridge PinnedFilesLoader → EventBus (6/6 emitters bridged)
    const _pinnedBus = container.resolve(EVENT_BUS);
    if (_pinnedBus) {
        bridgeEmitter(pinnedLoader, _pinnedBus, { changed: CONFIG_PINNED_FILES_CHANGED });
    }

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

    // Criar hub_session permanente (best-effort)
    try {
        await conversationHub.init();
        const hubSessionId = conversationHub.store.createHubSession({
            title: 'Terminal Permanente LLM-B',
            metadata: { source: 'terminal-server', startedAt: new Date().toISOString() },
        });
        setHubSessionId(hubSessionId);
        log('INFO', `[TerminalServer] Hub session criada: ${hubSessionId}`);
    } catch (/** @type {any} */ e) {
        log('WARN', `[TerminalServer] Hub storage indisponível, continua sem persistência: ${e.message}`);
    }

    // Onda 3.3: iniciar servidor copilot dedicado (Express + Socket.IO)
    // Passa orchestrator/store do hub para habilitar Socket.IO quando disponível
    const _hubReady = conversationHub.isReady;
    /** @type {import('../server/index.js').CopilotServerOptions} */
    const _serverOpts = {};
    if (_hubReady) {
        _serverOpts.orchestrator = conversationHub.orchestrator;
        _serverOpts.store = conversationHub.store;
    }
    const copilotServerPromise = startCopilotServer(_serverOpts);

    registerAgentEventListeners(printStandaloneBanner);
    startReflectionLoop();

    // F7.1: cleanup diário de tarefas TODO antigas (done/cancelled > 7 dias)
    // F152: registrar no timer-registry para evitar leak (handle era descartado)
    const todoCleanupTimer = startTodoCleanupJob();
    if (typeof todoCleanupTimer.unref === 'function') todoCleanupTimer.unref();
    registerTimer('terminal.todoCleanup', 'interval', todoCleanupTimer);

    // T-21: graceful shutdown handlers via registerShutdownHandler
    const { registerShutdownHandler } = await import('#copilot/core');

    // F153: reflectionTimer agora é gerenciado via timer-registry (cancelAll no shutdown),
    // mas manter shutdown handler para log explícito + nullify da referência local
    registerShutdownHandler(
        'terminal.reflectionTimer',
        async () => {
            if (_reflectionTimer !== null) {
                clearInterval(_reflectionTimer);
                _reflectionTimer = null;
            }
            log('INFO', '[TerminalServer] Reflection timer cancelado via shutdown handler.');
        },
        10,
    );

    const copilotServer = await copilotServerPromise;

    // Onda 5.0: conectar Socket.IO ao hub (upgrade de standalone → full)
    if (copilotServer.io && conversationHub.isReady) {
        conversationHub.attachSocketIO(copilotServer.io);
    }

    registerShutdownHandler(
        'terminal.injectServer',
        async () => {
            await copilotServer.close();
            log('INFO', '[TerminalServer] Copilot server encerrado via shutdown handler.');
        },
        20,
    );

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

    // Extrair httpServer compatível com startRepl (aceita http.Server)
    // CopilotServer tem .httpServer; o fallback legacy retorna http.Server diretamente
    const httpServerForRepl = /** @type {any} */ (copilotServer).httpServer ?? copilotServer;
    await startRepl(/** @type {import('node:http').Server} */ (httpServerForRepl));
}
