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

import { LLM_B_REFLECTION_INTERVAL_MIN } from '#copilot/config';
import { log } from '#copilot/observability';
import { resolve } from 'node:path';
import { alwaysAliveAgent, configureHookTools, setHub, setPermissionAgent } from '../agent/index.js';
import { getMcpStatus } from '../bridges/mcp-tool-bridge.js';
import { setBridgeAgent } from '../channel/client.js';
import { PinnedFilesLoader } from '../config/pinned-files.js';
import { conversationHub } from '../conversation-hub/hub.js';
import { setFallbackAgent } from '../conversation-hub/orchestrator.js';
import { container, wireLegacySetters } from '../core/di-container.js';
import { BRIDGE_AGENT, FALLBACK_AGENT, HUB, NERV_BRIDGE_AGENT, PERMISSION_AGENT } from '../core/di-tokens.js';
import { registerTimer } from '../core/timer-registry.js';
import { startTodoCleanupJob } from '../tools/todo/store.js';
import { loadAliasesAsync } from './alias-store.js';
import { broadcastSse, println, sendTurn } from './dialog.js';
import { startRepl } from './repl.js';
import { createInjectServer } from './server.js';
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

    // ARCH-02 (fix): injetar hub explicitamente nas hub-tools para evitar import dinâmico oculto
    // ARCH-03 (fix): injetar broadcastSse nas hook-tools para remover import dinâmico circular
    configureHookTools({ broadcastSse });

    // DI container — registrar dependências de runtime (agent/tools stack)
    container.register(HUB, () => conversationHub, 'singleton');
    container.register(PERMISSION_AGENT, () => alwaysAliveAgent, 'singleton');
    container.register(FALLBACK_AGENT, () => alwaysAliveAgent, 'singleton');
    container.register(BRIDGE_AGENT, () => alwaysAliveAgent, 'singleton');
    container.register(NERV_BRIDGE_AGENT, () => alwaysAliveAgent, 'singleton');

    // K-5: wiring centralizado — resolve tokens e invoca setters legados
    wireLegacySetters(container, [
        { token: HUB, setter: setHub },
        { token: PERMISSION_AGENT, setter: setPermissionAgent },
        { token: FALLBACK_AGENT, setter: setFallbackAgent },
        { token: BRIDGE_AGENT, setter: setBridgeAgent },
    ]);

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

    registerAgentEventListeners(printStandaloneBanner);
    startReflectionLoop();

    // F7.1: cleanup diário de tarefas TODO antigas (done/cancelled > 7 dias)
    // F152: registrar no timer-registry para evitar leak (handle era descartado)
    const todoCleanupTimer = startTodoCleanupJob();
    if (typeof todoCleanupTimer.unref === 'function') todoCleanupTimer.unref();
    registerTimer('terminal.todoCleanup', 'interval', todoCleanupTimer);

    // T-21: graceful shutdown handlers via registerShutdownHandler
    const { registerShutdownHandler } = await import('#copilot/core/shutdown');

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

    registerShutdownHandler(
        'terminal.injectServer',
        async () => {
            await new Promise((resolve) => injectServer.close(resolve));
            log('INFO', '[TerminalServer] Inject server encerrado via shutdown handler.');
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

    await startRepl(injectServer);
}
