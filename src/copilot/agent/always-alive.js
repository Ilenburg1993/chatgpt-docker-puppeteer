// @ts-check
/**
 * src/copilot/agent/always-alive.js
 *
 * Always-Alive Agent — núcleo do agente autônomo baseado no GitHub Copilot SDK.
 *
 * Fluxo de operação:
 *
 * 1. Inicializa/retoma sessão persistente (via session-manager.js)
 * 2. Processa a fila de mensagens/tarefas
 * 3. Quando o modelo pergunta algo (ask_user/onUserInputRequest), suspende e expõe a pergunta via HTTP (controlada por
 *    http-control-server.js)
 * 4. Ao receber resposta, retoma o processamento
 * 5. Emite eventos via NERV bridge para que o dashboard receba atualizações
 *
 * @module copilot/agent/always-alive
 * @see module:copilot/agent/dialog/loop-manager
 * @see module:copilot/agent/session/initializer
 * @see module:copilot/agent/lifecycle/state-io
 * @see module:copilot/agent/infra/message-queue
 */

import { SessionError } from '#copilot/core/errors';
import {
    buildTelemetryConfig,
    defaultErrorTracker,
    defaultMetrics,
    initEventCollector,
    startSpan,
} from '#copilot/observability';
import { log } from '#copilot/observability/logger';
import { raceEvents } from '#copilot/sdk/event-helpers';
import { createRegistry } from '#copilot/sdk/index';
import { CopilotClient } from '@github/copilot-sdk';
import EventEmitter from 'node:events';
import { buildMcpTools } from '../bridges/mcp-tool-bridge.js';
import { buildMcpConfig } from '../config/mcp-servers.js';
import { conversationStore } from '../conversation-hub/store.js';
import { getHubSessionId } from '../terminal/state.js';
import { DialogLoopManager } from './dialog/loop-manager.js';
// DialogProtocol agora é usado apenas pelo DialogLoopManager — removido daqui (E.1)
import { AGENT_EVENTS } from '#copilot/core/events';
import { wireDialogLoopEvents } from './dialog/loop-manager.js';
import { handleUserInputRequest } from './dialog/user-input-handler.js';
import { MessageQueue } from './infra/message-queue.js';
import { PermissionController } from './infra/permission-controller.js';
import { tryReconnect } from './lifecycle/reconnect-policy.js';
import { createSnapshot, saveSnapshot } from './session/snapshot.js';
// N.1: usar hooks module canônico em vez do arquivo @deprecated
import { attachBus } from '#copilot/hooks/bus';
import { createHooks } from '#copilot/hooks/factory';
import { createSessionHooks } from '#copilot/hooks/session-lifecycle';
import {
    CONTEXT_UTIL_BLOCK_THRESHOLD,
    CONTEXT_UTIL_WARN_THRESHOLD,
    COPILOT_MODEL,
    COPILOT_REASONING_EFFORT,
    MAX_LISTENERS,
    MESSAGES_CACHE_TTL_MS,
    SHUTDOWN_TIMEOUT_MS,
    STATUS_SNAPSHOT_TTL_MS,
    STOP_BOOT_WAIT_MS,
} from './config.js';
import { HandoffManager } from './infra/handoff-manager.js';
import { buildStatusSnapshot } from './infra/status-snapshot.js';
import { executeTask } from './infra/task-executor.js';
import { bootstrapTools, setSessionRpc } from './infra/tools-bootstrap.js';
import { WebhookManager } from './infra/webhook-manager.js';
import { persistState, readState, writeStateAsync } from './lifecycle/state-io.js';
import { performBootWiring } from './session/boot-wiring.js';
import { initOrResumeSession } from './session/initializer.js';
import { SessionKeepalive } from './session/keepalive.js';
// G2-ARCH-03: import estático em vez de dinâmico (hook-tools não cria circular dependency)
import { resolveUserInput as hookToolsResolveUserInput } from '../tools/hook-tools.js';

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 */

/**
 * @typedef {Object} PendingQuestion
 * @property {string} question - Texto da pergunta
 * @property {string[]} [choices] - Opções disponíveis (se houver)
 * @property {boolean} allowFreeform - Se permite resposta livre
 * @property {(answer: string) => void} resolve - Resolver a Promise do SDK
 * @property {number} askedAt - Timestamp em ms
 */

/**
 * @typedef {Object} AgentTask
 * @property {string} id - ID único da tarefa
 * @property {string} message - Mensagem a enviar ao modelo
 * @property {function(string): void} resolve - Callback de resolução
 * @property {function(Error): void} reject - Callback de erro
 * @property {number} enqueuedAt - Timestamp em ms
 * @property {number} [timeoutMs] - Timeout personalizado para sendAndWait (ms). undefined = usa padrão de 60s do SDK.
 * @property {import('@github/copilot-sdk').MessageOptions['attachments']} [attachments] - Anexos (arquivos, imagens,
 *   seleções) a enviar junto com a mensagem.
 */

/**
 * @typedef {'idle' | 'processing' | 'waiting_for_input' | 'starting' | 'stopped'} AgentStatus
 */

/**
 * Snapshot do estado atual do agente retornado por `getStatusSnapshot()`.
 *
 * @typedef {Object} AgentStatusSnapshot
 * @property {string} status - Estado atual do agente
 * @property {string | null} sessionId - ID da sessão ativa
 * @property {string} model - Modelo ativo
 * @property {string | undefined} reasoningEffort - Nível de esforço de ragionamento
 * @property {number} queueSize - Número de tarefas na fila
 * @property {number} oldestTaskWaitMs - Tempo de espera da tarefa mais antiga em ms
 * @property {boolean} starvationAlert - true se há tarefa esperando > 60s
 * @property {object | null} pendingQuestion - Pergunta pendente do modelo (ou null)
 * @property {boolean} isResumed - true se a sessão foi retomada
 * @property {number} resumeCount - Número de retomadas desde o início
 * @property {number} sendCount - Total de mensagens enviadas
 * @property {number | null} startedAt - Epoch ms do início da sessão
 * @property {{ tokens: number; tokenLimit: number; utilization: number } | null} contextWindow - Dados reais de uso de
 *   contexto do SDK (ou null se não disponível)
 * @property {string | null} lastCheckpointPath - Último caminho de checkpoint do SDK (ou null se nenhum ainda)
 * @property {'approve_all' | 'audit_only' | 'selective'} permissionMode - Modo de permissão ativo
 */

/**
 * Always-Alive Agent — instância singleton que gerencia o ciclo de vida completo do agente Copilot SDK neste processo.
 *
 * @extends EventEmitter
 */
export class AlwaysAliveAgent extends EventEmitter {
    /** @type {CopilotClient | null} */
    #client = null;

    /** @type {CopilotSession | null} */
    #session = null;

    /** @type {AgentStatus} */
    #status = 'stopped';

    /**
     * G1-ARCH-03: Flag de reconexão em andamento. Bloqueia #processQueue() durante a tentativa de reconexão para evitar
     * execução de tasks em sessão inválida.
     *
     * @type {boolean}
     */
    #isReconnecting = false;

    /** @type {PendingQuestion | null} */
    #pendingQuestion = null;

    /** @type {MessageQueue} */
    #messageQueue = new MessageQueue({
        onEnqueue: () => this.#processQueue(),
        onChanged: () => {
            this.#statusSnapshotCache = null;
        },
    });

    /**
     * E.1: DialogLoopManager — encapsula mutex, watchdog, backpressure, protocolo e pause/resume do dialog loop.
     *
     * @type {DialogLoopManager}
     */
    #dialogLoop = new DialogLoopManager();

    /**
     * Funções de unsubscribe retornadas por `session.on()`. O SDK não expõe um EventEmitter padrão — cada
     * `session.on()` retorna `() => void`. Chamadas em `stop()` e `#tryReconnect()` para prevenir memory leaks entre
     * ciclos de sessão.
     *
     * @type {(() => void)[]}
     */
    #sessionEventUnsubscribers = [];

    /**
     * Flag que indica se o DialogLoopManager já foi attached aos eventos deste agente. Evita `removeAllListeners()`
     * redundante em chamadas repetidas de `#ensureDialogLoopAttached()`.
     *
     * @type {boolean}
     */
    #dialogLoopAttached = false;

    /**
     * F29: Referência ao agent-event-observer para cleanup no stop(). Criado no start() para garantir que métricas são
     * coletadas para TODAS as tasks, não apenas aquelas executadas após o primeiro dialog loop boot.
     *
     * @type {{ attach: (agent: EventEmitter) => void; detach: () => void } | null}
     */
    #agentObserver = null;

    /**
     * Contador de mensagens enviadas mantido em memória para evitar I/O síncrono por envio. Inicializado a partir do
     * estado persistido no boot; salvo em disco apenas no `stop()`.
     *
     * @type {number}
     */
    #sendCount = 0;

    /**
     * Último snapshot de billing (model, cost, quotaSnapshots, timestamp). Atualizado pelo listener `assistant.usage`
     * durante o wiring de sessão em `start()`.
     *
     * @type {{ model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null}
     */
    #lastPrInfo = null;

    /** @type {string} */
    #model;

    /** @type {'low' | 'medium' | 'high' | 'xhigh' | undefined} */
    #reasoningEffort;

    /** @type {boolean} */
    #isResumed = false;

    /**
     * Snapshot de uso de contexto capturado do evento `session.usage_info` do SDK. Atualizado a cada turno; `null`
     * enquanto a sessão não emitir o primeiro evento.
     *
     * @type {{ tokens: number; tokenLimit: number; utilization: number } | null}
     */
    #contextState = null;

    /**
     * Cache de mensagens da sessão SDK para reduzir latência em chamadas repetidas via `getSessionMessages()`. Invalida
     * automaticamente após `#MESSAGES_CACHE_TTL` ou na troca de sessão.
     *
     * @type {unknown[] | null}
     */
    #messagesCache = null;

    /** @type {number} */
    #messagesCacheAt = 0;

    /**
     * TTL do cache de mensagens em ms. Padrão: 30 segundos. Configurável via AGENT_MESSAGES_CACHE_TTL_MS.
     *
     * @type {number}
     */
    static #MESSAGES_CACHE_TTL = MESSAGES_CACHE_TTL_MS;

    /**
     * Último caminho de checkpoint salvo pelo SDK durante compaction de contexto. `null` até a primeira compaction ser
     * concluída.
     *
     * @type {string | null}
     */
    #lastCheckpointPath = null;

    /** @type {WebhookManager} */
    #webhooks = new WebhookManager();

    /** @type {PermissionController} */
    #permissions = new PermissionController({
        onModeChanged: (mode) => this.emit('permission.mode_changed', { mode }),
    });

    /** @type {import('#copilot/sdk/tools-registry').ToolRegistry} */
    #toolsRegistry = createRegistry();

    /**
     * F9.2: Cancela o job de auto-reconnect ao MCP. null quando não está rodando.
     *
     * @type {(() => void) | null}
     */
    #mcpReconnectCancel = null;

    /**
     * F42.2 (BUG-SD-001 fix): Keepalive de sessão para prevenir expiração por idle timeout de 30 min do SDK.
     *
     * @type {SessionKeepalive}
     */
    #keepalive = new SessionKeepalive();

    /**
     * F45 (GAP-SD-07): HandoffManager — gerencia transferência de sessão entre agentes.
     *
     * @type {HandoffManager}
     */
    #handoff = new HandoffManager();

    /**
     * @param {{ model?: string; reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' }} [options]
     */
    constructor(options = {}) {
        super();
        // Agentes de alta carga acumulam múltiplos listeners por tarefa + SSE + bridge.
        // O padrão de 10 é insuficiente; configurável via AGENT_MAX_LISTENERS (padrão 50).
        this.setMaxListeners(MAX_LISTENERS);
        this.#model = options.model ?? COPILOT_MODEL;
        this.#reasoningEffort =
            options.reasoningEffort ??
            /** @type {'low' | 'medium' | 'high' | 'xhigh' | undefined} */ (COPILOT_REASONING_EFFORT || undefined);
    }

    // ─── Controle de permissão em runtime ─────────────────────────────────────

    /**
     * Retorna o modo de permissão ativo como string legível.
     *
     * Modos disponíveis:
     *
     * - `"approve_all"` — aprova tudo automaticamente (comportamento padrão, SDK approveAll)
     * - `"audit_only"` — aprova tudo mas loga cada decisão
     * - `"selective"` — whitelist/blacklist/callback customizado
     *
     * @returns {'approve_all' | 'audit_only' | 'selective'}
     */
    getPermissionMode() {
        return this.#permissions.getMode();
    }

    /**
     * Altera o modo de aprovação de tools em runtime — sem reiniciar o agente.
     *
     * A mudança é aplicada na PRÓXIMA reconexão/reinício real de sessão. Para sessões já ativas, apenas novos
     * `initOrResumeSession` usarão o handler atualizado.
     *
     * O dialog loop não é uma tool e não passa por este handler. Não é possível bloquear o encerramento do dialog loop
     * via configuração de permissão.
     *
     * @param {'approve_all' | 'audit_only' | 'selective'} mode - Modo de aprovação
     * @param {{ allowTools?: string[]; denyTools?: string[]; denyShell?: boolean }} [opts] - Opções para modo selective
     * @returns {void}
     */
    setPermissionMode(mode, opts = {}) {
        this.#permissions.setMode(mode, opts);
    }

    /**
     * Registra uma URL de webhook para notificações de sessão.
     *
     * @param {string} url - URL HTTP(S) que receberá POST com payload de evento
     * @returns {{ id: string; url: string }} Identificador do webhook registrado
     */
    registerWebhook(url) {
        return this.#webhooks.register(url);
    }

    /**
     * Remove um webhook previamente registrado.
     *
     * @param {string} id - ID do webhook a remover
     * @returns {boolean} true se removido, false se não encontrado
     */
    unregisterWebhook(id) {
        return this.#webhooks.unregister(id);
    }

    /**
     * Lista todos os webhooks registrados.
     *
     * @returns {{ id: string; url: string }[]}
     */
    listWebhooks() {
        return this.#webhooks.list();
    }

    /**
     * Retorna o status atual do agente.
     *
     * @returns {AgentStatus}
     */
    get status() {
        return this.#status;
    }

    /**
     * Indica se o modo de diálogo contínuo está ativo (startDialogLoop foi chamado e ainda não foi parado).
     *
     * @returns {boolean}
     */
    get dialogLoopActive() {
        return this.#dialogLoop.active;
    }

    /**
     * F45: Retorna o HandoffManager para uso em rotas HTTP e terminal.
     *
     * @returns {HandoffManager}
     */
    getHandoffManager() {
        return this.#handoff;
    }

    /**
     * Retorna o número atual de tarefas enfileiradas aguardando processamento.
     *
     * @returns {number}
     */
    get queueSize() {
        return this.#messageQueue.size;
    }

    /**
     * Retorna a pergunta pendente (se houver).
     *
     * @returns {PendingQuestion | null}
     */
    get pendingQuestion() {
        return this.#pendingQuestion;
    }

    /**
     * Retorna o sessionId da sessão ativa (ou null).
     *
     * @returns {string | null}
     */
    get sessionId() {
        return this.#session?.sessionId ?? readState()?.sessionId ?? null;
    }

    /**
     * Retorna o sumário de métricas da sessão atual (compatibilidade — use defaultMetrics diretamente).
     *
     * @returns {object}
     */
    get telemetry() {
        return defaultMetrics.getSummary();
    }

    /**
     * Retorna o registry de tools da sessão atual.
     *
     * @returns {import('#copilot/sdk/tools-registry').ToolRegistry}
     */
    get toolsRegistry() {
        return this.#toolsRegistry;
    }

    /**
     * M-04 (PARTE-8): Aborta a mensagem SDK em processamento na sessão atual.
     *
     * Útil para cancelar operações travadas (stall) sem destruir o dialog loop inteiro. Se não houver sessão ativa ou o
     * método `abort()` não estiver disponível, é um no-op.
     *
     * @returns {Promise<void>}
     */
    async abortCurrentMessage() {
        if (!this.#session || typeof this.#session.abort !== 'function') {
            log('DEBUG', '[AlwaysAlive] abortCurrentMessage(): sem sessão ativa ou abort indisponível.');
            return;
        }
        try {
            await this.#session.abort();
            log('INFO', '[AlwaysAlive] Mensagem SDK abortada via session.abort().');
        } catch (/** @type {any} */ e) {
            log('WARN', `[AlwaysAlive] session.abort() falhou: ${e.message}`);
        }
    }

    /**
     * F52 (PARTE-9): Pinga o watchdog do dialog loop para sinalizar atividade.
     *
     * Usado pelo handler de stall quando a recovery zero-PR é bem-sucedida, evitando que o watchdog dispare novamente
     * imediatamente.
     */
    pingDialogWatchdog() {
        this.#dialogLoop.pingWatchdog();
    }

    /**
     * M-05 (PARTE-8): Registra mensagem no timeline da sessão SDK via session.log().
     *
     * Torna eventos significativos (reconexão, rotação, keepalive) visíveis em ferramentas de debug do SDK/CLI. No-op
     * se a sessão não estiver ativa.
     *
     * @param {string} message - Mensagem para registrar no timeline
     * @param {{ level?: 'info' | 'warning' | 'error' }} [options]
     * @returns {Promise<void>}
     */
    async sessionLog(message, options) {
        if (!this.#session || typeof this.#session.log !== 'function') return;
        try {
            await this.#session.log(message, options);
        } catch {
            // best-effort — não bloqueia fluxo principal
        }
    }

    /**
     * Inicializa o agente: conecta ao CLI e cria/retoma sessão.
     *
     * @returns {Promise<void>}
     * @throws {Error} Se a conexão ao CLI ou criação/retomada de sessão SDK falhar
     */
    async start() {
        if (this.#status !== 'stopped') {
            log('WARN', '[AlwaysAlive] start() chamado com agente já ativo.');
            return;
        }

        this.#setStatus('starting');
        log('INFO', '[AlwaysAlive] Iniciando agente...');

        // F56.1 (PARTE-9): marcar que o shutdown não foi graceful inicialmente.
        // Se o processo morrer aqui, o próximo boot saberá que foi um crash.
        persistState({ gracefulShutdown: false }, '[AlwaysAlive] gracefulShutdown=false');

        // R.1: inicializar o event collector com métricas e errorTracker antes de qualquer attach
        // O defaultBus já está wired via attachBus() em #initSession() — passado aqui para
        // que o collector possa re-emitir hooks.
        initEventCollector({
            metrics: defaultMetrics,
            errorTracker: defaultErrorTracker,
            persist: true,
        });

        // CK: Ativar global error handlers em produção (idempotente — segunda chamada é no-op).
        if (process.env['NODE_ENV'] !== 'test') {
            defaultErrorTracker.registerGlobalHandlers();
        }

        // T.1: ativar snapshot periódico de métricas em metrics.jsonl (Fase T)
        defaultMetrics.startPeriodicSnapshot();

        try {
            const _otelConfig = buildTelemetryConfig();
            const client = new CopilotClient(...(_otelConfig ? [{ telemetry: _otelConfig }] : []));
            this.#client = client;

            const { session, isResumed } = await startSpan('session.boot', { model: this.#model }, () =>
                this.#initSession(client),
            );

            // F29-REFACTOR: delegar wirings pós-init para boot-wiring.js
            if (this.#agentObserver) this.#agentObserver.detach();
            const bootResult = performBootWiring(client, session, isResumed, this, {
                emit: (event, payload) => this.emit(event, payload),
                getStatusSnapshot: () => this.getStatusSnapshot(),
                onCheckpointPath: (path) => {
                    this.#lastCheckpointPath = path;
                },
                onContextState: (state) => {
                    this.#contextState = state;
                },
                onPrInfo: (info) => {
                    this.#lastPrInfo = info;
                },
                isProcessing: () => this.#status === 'processing',
                dialogLoopActive: () => this.#dialogLoop?.active ?? false,
                getSessionId: () => this.sessionId,
                getStatus: () => this.#status,
                dialogLoop: this.#dialogLoop,
                keepalive: this.#keepalive,
                handoff: this.#handoff,
                ensureDialogLoopAttached: () => this.#ensureDialogLoopAttached(),
                resumeDialogLoop: () => this.resumeDialogLoop(),
                startDialogLoop: () => this.startDialogLoop(),
                getDialogPrMetrics: () => this.dialogPrMetrics,
            });
            this.#sessionEventUnsubscribers = bootResult.unsubs;
            this.#agentObserver = bootResult.agentObserver;
            this.#metricsTimer = bootResult.metricsTimer;
            this.#mcpReconnectCancel = bootResult.mcpReconnectCancel;

            this.#setStatus('idle');
            this.#sendCount = readState()?.sendCount ?? 0;

            log(
                'INFO',
                `[AlwaysAlive] Agente pronto. SessionId: ${session.sessionId} (${isResumed ? 'retomada' : 'nova'})`,
            );

            if (isResumed) {
                void this.#syncSdkHistory(session);
            }

            this.emit('ready', { sessionId: session.sessionId, isResumed });
        } catch (/** @type {any} */ e) {
            this.#setStatus('stopped');
            log('ERROR', `[AlwaysAlive] Falha ao iniciar: ${e.message}`);
            this.emit('error', e);
            throw e;
        }
    }

    /**
     * Para o agente graciosamente:
     *
     * 1. Aguarda a tarefa atual terminar (até `shutdownTimeoutMs`)
     * 2. Rejeita tarefas pendentes na fila
     * 3. Desconecta a sessão SDK
     *
     * @param {{ shutdownTimeoutMs?: number }} [opts]
     * @returns {Promise<void>}
     */
    async stop({ shutdownTimeoutMs = SHUTDOWN_TIMEOUT_MS } = {}) {
        // Idempotente: se já está parado, retorna sem ação
        if (this.#status === 'stopped') return;

        log('INFO', '[AlwaysAlive] Parando agente...');

        // Sinaliza shutdown para que consumers externos removam seus próprios listeners
        // antes do dreno da fila, evitando dead callbacks em ciclos stop()/start().
        this.emit('before-stop');
        this.removeAllListeners('before-stop');

        // Garante que o boot não fique suspenso se stop() for chamado durante o start().
        if (this.#status === 'starting') {
            log('INFO', '[AlwaysAlive] stop() durante boot — aguardando conclusão (máx 15s)...');
            await raceEvents(this, ['ready', 'error'], { timeoutMs: STOP_BOOT_WAIT_MS }).catch(() => {});
        }

        // Se estiver processando uma tarefa, aguarda ela terminar (com timeout)
        if (this.#status === 'processing' || this.#status === 'waiting_for_input') {
            log('INFO', `[AlwaysAlive] Aguardando tarefa atual terminar (até ${shutdownTimeoutMs}ms)...`);
            await Promise.race([
                new Promise((resolve) => {
                    const onIdle = () => {
                        if (this.#status !== 'processing' && this.#status !== 'waiting_for_input') {
                            this.off('status', onIdle);
                            resolve(undefined);
                        }
                    };
                    this.on('status', onIdle);
                }),
                new Promise((resolve) => setTimeout(resolve, shutdownTimeoutMs)),
            ]);
        }

        // G1-BUG-02 (fix): resetar listeners e flag ANTES de forceDeactivate para evitar propagação
        // de eventos para SSE subscribers já removidos durante o shutdown.
        if (this.#dialogLoopAttached) {
            this.#dialogLoop.removeAllListeners();
            this.#dialogLoopAttached = false;
        }
        if (this.#dialogLoop.active) {
            this.#dialogLoop.forceDeactivate();
            this.emit('dialog.loop.changed', { active: false, ts: Date.now() });
        }

        // F41.4: auto-save snapshot antes de shutdown (para PM2 restart)
        try {
            const snap = createSnapshot({
                sessionId: this.sessionId ?? null,
                model: this.#model,
                status: this.#status,
                sendCount: this.#sendCount,
                dialogLoopActive: false, // acabou de ser desativado
                dialogPaused: this.#dialogLoop.paused,
                pendingQuestion: this.#pendingQuestion?.question ?? null,
                prMetrics: this.dialogPrMetrics,
                reason: 'auto-shutdown',
            });
            saveSnapshot(snap);
        } catch (/** @type {any} */ e) {
            log('WARN', `[AlwaysAlive] Auto-save snapshot falhou: ${e.message}`);
        }

        await writeStateAsync({ sendCount: this.#sendCount, gracefulShutdown: true }).catch((/** @type {any} */ e) =>
            log('WARN', `[AlwaysAlive] writeState sendCount falhou: ${e.message}`),
        );

        // G2-DX-17: limpar timer de métricas antes de alterar status
        if (this.#metricsTimer) {
            clearInterval(this.#metricsTimer);
            this.#metricsTimer = null;
        }
        // F9.2: cancelar job de auto-reconnect MCP
        if (this.#mcpReconnectCancel) {
            this.#mcpReconnectCancel();
            this.#mcpReconnectCancel = null;
        }
        // F42.2: parar keepalive de sessão
        this.#keepalive.stop();
        // Fase CB: parar snapshot periódico de métricas — sem isso, em ciclos stop→start
        // múltiplos snapshots rodam em paralelo, causando escrita concorrente em metrics.jsonl
        defaultMetrics.stopPeriodicSnapshot();

        this.#setStatus('stopped');

        // Rejeita todas as tarefas pendentes na fila
        const remainingTasks = this.#messageQueue.drain(
            new SessionError('[AlwaysAlive] Agente parado durante shutdown gracioso.', 'AGENT_STOPPED'),
        );
        this.#statusSnapshotCache = null;
        if (remainingTasks.length > 0) {
            log('WARN', `[AlwaysAlive] Rejeitando ${remainingTasks.length} tarefa(s) pendente(s) no shutdown.`);
        }

        // F29: detach agent-event-observer antes de limpar session event unsubscribers
        if (this.#agentObserver) {
            this.#agentObserver.detach();
            this.#agentObserver = null;
        }

        for (const unsub of this.#sessionEventUnsubscribers) unsub();
        this.#sessionEventUnsubscribers = [];

        if (this.#session) {
            try {
                await this.#session.disconnect();
            } catch (/** @type {any} */ e) {
                log('WARN', `[AlwaysAlive] Erro ao desconectar sessão: ${e.message}`);
            }
            this.#session = null;
            this.#messagesCache = null;
            setSessionRpc(null);
        }

        if (this.#client) {
            try {
                const stopErrors = await this.#client.stop();
                if (stopErrors.length > 0) {
                    log(
                        'WARN',
                        `[AlwaysAlive] SDK client.stop() erros: ${stopErrors.map((e) => e.message).join('; ')}`,
                    );
                }
            } catch (/** @type {any} */ e) {
                log('WARN', `[AlwaysAlive] Erro ao parar client SDK: ${e.message}`);
            }
            this.#client = null;
        }

        this.emit('stopped');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * Enfileira uma mensagem para ser enviada ao modelo.
     *
     * @param {string} message - Mensagem a enviar
     * @param {{
     *     timeoutMs?: number;
     *     attachments?: import('@github/copilot-sdk').MessageOptions['attachments'];
     *     signal?: AbortSignal;
     * }} [opts]
     *   - `timeoutMs` sobrescreve o timeout padrão de 60 s do SDK para `sendAndWait`. Use um valor grande (ex.: `24 * 60 *
     *       60 * 1000`) para tarefas de longa duração como o dialog loop, que nunca emitem `session.idle`
     *       organicamente.
     *   - `attachments` permite enviar arquivos, imagens ou referências de contexto junto com a mensagem.
     *   - `signal` permite cancelar a tarefa via `AbortSignal` antes ou durante o processamento.
     *
     * @returns {Promise<string>} Resposta completa do modelo
     */
    sendMessage(message, { timeoutMs, attachments, signal } = {}) {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(new DOMException('AbortError: sendMessage cancelado antes de enfileirar.', 'AbortError'));
                return;
            }
            if (this.#dialogLoop.active) {
                reject(
                    new SessionError(
                        '[AlwaysAlive] sendMessage() bloqueado: dialog loop ativo. Use sendDialogTurn().',
                        'DIALOG_ACTIVE',
                    ),
                );
                return;
            }
            this.#enqueueTask(message, {
                resolve,
                reject,
                ...(timeoutMs !== undefined ? { timeoutMs } : {}),
                ...(attachments !== undefined ? { attachments } : {}),
                ...(signal !== undefined ? { signal } : {}),
            });
        });
    }

    /**
     * Variante interna de sendMessage() usada pelo DialogLoopManager para enviar o boot prompt. Bypassa o guard de
     * dialog loop ativo — NÃO expor como API pública.
     *
     * @param {string} message
     * @param {{ timeoutMs?: number }} [opts]
     * @returns {Promise<string>}
     */
    sendMessageDialogBoot(message, opts = {}) {
        return new Promise((resolve, reject) => {
            this.#enqueueTask(message, { ...opts, resolve, reject });
        });
    }

    /**
     * Envia uma mensagem em modo "steering" (immediate) — injetada no turno ativo para redirecionar o agente sem
     * abortar o processamento. Se o agente não estiver processando, a mensagem inicia um novo turno.
     *
     * @param {string} prompt - Mensagem de steering
     * @returns {Promise<string>} messageId retornado pelo SDK
     * @throws {SessionError} Se a sessão não estiver ativa
     */
    async steerMessage(prompt) {
        if (!this.#session) {
            throw new SessionError('[AlwaysAlive] steerMessage() requer sessão ativa.', 'NO_SESSION');
        }
        const messageId = await this.#session.send({ prompt, mode: 'immediate' });
        log('INFO', `[AlwaysAlive] Steering enviado: messageId=${messageId}`);
        this.emit('steering.sent', { messageId, prompt: prompt.slice(0, 200), ts: Date.now() });
        return messageId;
    }

    /**
     * Enfileira uma task internamente — compartilhado por sendMessage e sendMessageDialogBoot.
     *
     * @param {string} message
     * @param {{
     *     timeoutMs?: number;
     *     attachments?: import('@github/copilot-sdk').MessageOptions['attachments'];
     *     signal?: AbortSignal;
     *     resolve: (v: string | PromiseLike<string>) => void;
     *     reject: (r: unknown) => void;
     * }} opts
     */
    #enqueueTask(message, { timeoutMs, attachments, signal, resolve, reject }) {
        const task = /** @type {AgentTask} */ ({
            id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            message,
            resolve,
            reject,
            enqueuedAt: Date.now(),
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
            ...(attachments !== undefined ? { attachments } : {}),
        });
        try {
            this.#messageQueue.enqueue(task, ...(signal ? [{ signal }] : []));
        } catch (/** @type {any} */ err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
        }
        this.emit('task.queued', { taskId: task.id, message });
    }

    /**
     * Responde a uma pergunta pendente do modelo.
     *
     * @param {string} answer - Resposta do usuário
     * @returns {boolean} True se havia pergunta pendente e foi respondida
     */
    answerPendingQuestion(answer) {
        if (!this.#pendingQuestion) {
            // ARCH-N01 (fix): mesmo sem pendingQuestion nativo, pode haver Promise de hook-tools.
            // G2-ARCH-03: resolveUserInput agora é import estático (sem circular dependency).
            if (!hookToolsResolveUserInput(answer)) {
                log('WARN', '[AlwaysAlive] answerPendingQuestion() chamado sem pergunta pendente.');
            }
            return false;
        }
        log('INFO', `[AlwaysAlive] Respondendo pergunta pendente: "${answer.slice(0, 80)}..."`);
        this.#pendingQuestion.resolve(answer);
        this.#pendingQuestion = null;
        persistState({ pendingQuestion: null }, '[AlwaysAlive] writeState pendingQuestion=null');
        this.emit('question.answered', { answer });
        // G2-ARCH-03: também resolver Promise da tool request_user_input — import estático
        hookToolsResolveUserInput(answer);
        return true;
    }

    // ─── Getters / Setters de configuração em runtime ─────────────────────────

    /**
     * ID do modelo atual em uso.
     *
     * @returns {string}
     */
    get model() {
        return this.#model;
    }

    /**
     * Troca o modelo em uso. A mudança é efetiva no próximo `sendMessage()`.
     *
     * @param {string} modelId - ID do modelo (ex. `'gpt-4.1'`, `'claude-sonnet-4-5'`)
     * @returns {void}
     */
    setModel(modelId) {
        this.#model = modelId;
        // G2-BUG-10: setModel() é uma API não documentada do SDK (não consta nos types oficiais).
        // O cast `any` é deliberado e a chamada é protegida por typeof para evitar crash em versões
        // do SDK que não suportem a troca de modelo em runtime.
        const sdkSession = /** @type {{ setModel?: (id: string) => void }} */ (this.#session);
        if (sdkSession && typeof sdkSession.setModel === 'function') {
            try {
                sdkSession.setModel(modelId);
            } catch (/** @type {any} */ e) {
                log('WARN', `[AlwaysAlive] setModel live falhou (SDK version?): ${e.message}`);
            }
        }
    }

    /**
     * Nível de raciocínio atual.
     *
     * @returns {'low' | 'medium' | 'high' | 'xhigh' | undefined}
     */
    get reasoningEffort() {
        return this.#reasoningEffort;
    }

    /**
     * Troca o nível de raciocínio. A mudança é efetiva no próximo `sendMessage()`.
     *
     * @param {'low' | 'medium' | 'high' | 'xhigh' | undefined} effort - Nível de raciocínio
     * @returns {void}
     */
    setReasoningEffort(effort) {
        this.#reasoningEffort = effort;
    }

    /** @type {{ snapshot: import('./always-alive.js').AgentStatusSnapshot; at: number } | null} */
    #statusSnapshotCache = null;

    /**
     * G2-DX-17: Timer de emissão periódica de `agent.metrics`. Iniciado em boot-wiring.js, limpo em `stop()`.
     *
     * @type {ReturnType<typeof setInterval> | null}
     */
    #metricsTimer = null;

    /**
     * Retorna um snapshot do estado atual do agente para a API HTTP.
     *
     * G2-PERF-01: Dirty flag primário + TTL safety net. O cache é invalidado (null) em toda mutação de estado
     * (`#setStatus()`, `messageQueue.onChanged`, `stop()`). O TTL existe apenas como segurança para edge cases onde a
     * invalidação é perdida. `readState()` usa cache interno (O(1) quando warm).
     *
     * @returns {AgentStatusSnapshot}
     */
    getStatusSnapshot() {
        // Dirty flag: cache não-nulo significa que nenhuma mutação ocorreu desde a última construção.
        // TTL safety net: invalida após AGENT_STATUS_SNAPSHOT_TTL_MS para cenários extremos.
        if (this.#statusSnapshotCache) {
            const age = Date.now() - this.#statusSnapshotCache.at;
            if (age < STATUS_SNAPSHOT_TTL_MS) {
                return this.#statusSnapshotCache.snapshot;
            }
            // TTL expirado — forçar rebuild como safety net
            this.#statusSnapshotCache = null;
        }
        const state = readState();
        const snapshot = buildStatusSnapshot({
            status: this.#status,
            sessionId: this.sessionId,
            model: this.#model,
            reasoningEffort: this.#reasoningEffort,
            queueSize: this.#messageQueue.size,
            queueOldest: this.#messageQueue.oldest,
            pendingQuestion: this.#pendingQuestion,
            isResumed: this.#isResumed,
            resumeCount: state?.resumeCount ?? 0,
            sendCount: this.#sendCount,
            startedAt: state?.startedAt ?? null,
            contextWindow: this.#contextState,
            lastCheckpointPath: this.#lastCheckpointPath,
            permissionMode: this.#permissions.getMode(),
        });
        this.#statusSnapshotCache = { snapshot, at: Date.now() };
        return snapshot;
    }

    /**
     * Retorna contagem de listeners por evento para diagnóstico de leaks.
     *
     * @returns {{ [event: string]: number }} Mapa evento → contagem de listeners
     * @internal Uso exclusivo em NODE_ENV=development e testes. Não expor como API pública de produção.
     */
    listenerDiagnostics() {
        /** @type {{ [event: string]: number }} */
        const result = {};
        for (const evt of AGENT_EVENTS) {
            result[evt] = this.listenerCount(evt);
        }
        return result;
    }

    /**
     * Inicia o "modo diálogo direto" com a LLM. Delega ao DialogLoopManager.
     *
     * @param {string} [bootPrompt] - Prompt de boot personalizado (opcional)
     * @returns {Promise<void>}
     * @throws {Error} Se o agente não estiver no estado 'idle'
     */
    async startDialogLoop(bootPrompt) {
        if (this.#status !== 'idle') {
            throw new SessionError(
                `[AlwaysAlive] startDialogLoop() requer status 'idle'. Status atual: '${this.#status}'`,
                'INVALID_STATE',
            );
        }
        // F44.1 (GAP-SD-08): health check pre-boot — verificar contexto antes de iniciar dialog loop
        if (this.#contextState) {
            const utilization = this.#contextState.utilization ?? 0;
            if (utilization >= CONTEXT_UTIL_BLOCK_THRESHOLD) {
                throw new SessionError(
                    `[AlwaysAlive] startDialogLoop() bloqueado: utilização de contexto em ${Math.round(utilization * 100)}% (≥95%). Solicite compaction antes de iniciar.`,
                    'CONTEXT_EXHAUSTED',
                );
            }
            if (utilization >= CONTEXT_UTIL_WARN_THRESHOLD) {
                log(
                    'WARN',
                    `[AlwaysAlive] F44.1: Utilização de contexto em ${Math.round(utilization * 100)}% — dialog loop prosseguindo com cautela.`,
                );
            }
        }
        this.#ensureDialogLoopAttached();
        // F42.2: pausar keepalive enquanto dialog loop está ativo (o loop mantém a sessão viva)
        this.#keepalive.stop();
        await this.#dialogLoop.start(bootPrompt);
        this.emit('dialog.loop.changed', { active: true, ts: Date.now() });
    }

    /**
     * Envia um turno de diálogo. Delega ao DialogLoopManager.
     *
     * @param {string} message
     * @param {{ timeout?: number; signal?: AbortSignal }} [opts]
     * @returns {Promise<string>}
     */
    sendDialogTurn(message, opts) {
        return this.#dialogLoop.sendTurn(message, opts);
    }

    /**
     * Para o modo diálogo. Delega ao DialogLoopManager.
     *
     * @param {{
     *     authorized?: boolean;
     *     reason?: 'watchdog_restart' | 'authorized_stop';
     *     shutdownTimeoutMs?: number;
     * }} [opts]
     * @returns {Promise<void>}
     */
    async stopDialogLoop(opts) {
        await this.#dialogLoop.stop(opts);
        // F42.2: reiniciar keepalive quando dialog loop para (a sessão precisa de heartbeat novamente)
        if (this.#status !== 'stopped' && this.#session) {
            this.#keepalive.start({
                getSession: () => this.#session,
                getClient: () => this.#client,
                isIdle: () => this.#status === 'idle',
                isDialogLoopActive: () => this.#dialogLoop.active,
                onKeepalive: (ts) => {
                    defaultMetrics.recordKeepalivePing();
                    this.emit('session.keepalive', { ts });
                },
            });
        }
    }

    /**
     * Pausa o dialog loop. Delega ao DialogLoopManager.
     *
     * @returns {Promise<void>}
     */
    async pauseDialogLoop() {
        await this.#dialogLoop.pause(this.sessionId);
    }

    /**
     * Retoma o dialog loop. Delega ao DialogLoopManager.
     *
     * @returns {Promise<void>}
     * @throws {SessionError} Se o agente não estiver no estado 'idle' ou 'waiting_for_input'
     */
    async resumeDialogLoop() {
        if (this.#status !== 'idle' && this.#status !== 'waiting_for_input') {
            throw new SessionError(
                `[AlwaysAlive] resumeDialogLoop() requer status 'idle' ou 'waiting_for_input'. Status atual: '${this.#status}'`,
                'INVALID_STATE',
            );
        }
        await this.#dialogLoop.resume();
    }

    /**
     * Indica se o dialog loop está atualmente pausado.
     *
     * @returns {boolean}
     */
    get dialogPaused() {
        return this.#dialogLoop.paused;
    }

    /**
     * F41: Métricas de consumo de premium requests do dialog loop.
     *
     * @returns {{ boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null}
     */
    get dialogPrMetrics() {
        return this.#dialogLoop.prMetrics ?? null;
    }

    /**
     * Último snapshot de billing do PR consumido. Atualizado quando `assistant.usage` é emitido pelo SDK.
     *
     * @returns {{ model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null}
     */
    get lastPrInfo() {
        // Retorna cópia rasa para evitar mutação externa do estado interno.
        return this.#lastPrInfo ? { ...this.#lastPrInfo } : null;
    }

    // ─────────────── Privados ───────────────

    /**
     * E.1: Garante que o DialogLoopManager está vinculado ao host com a interface AgentHost.
     *
     * G1-BUG-01 (fix): `attach()` é sempre chamado para atualizar host/telemetry (podem mudar após reconexão). O wiring
     * de eventos (listeners) só ocorre uma vez — guard `#dialogLoopAttached` protege apenas essa parte.
     */
    #ensureDialogLoopAttached() {
        /** @type {import('./dialog/loop-manager.js').AgentHost} */
        const host = {
            sendMessage: (msg, opts) => this.sendMessage(msg, opts),
            sendMessageDialogBoot: (msg, opts) => this.sendMessageDialogBoot(msg, opts),
            answerPendingQuestion: (answer) => this.answerPendingQuestion(answer),
            getSessionId: () => this.sessionId,
            getModel: () => this.#model,
            // F41B.2: expor setModel para que o DLM possa efetivamente trocar o modelo no fallback
            setModel: (modelId) => {
                this.#model = modelId;
            },
            getPendingQuestion: () => this.#pendingQuestion,
        };
        // Sempre atualiza host — necessário após reconexão.
        this.#dialogLoop.attach(host);
        // Wiring de eventos: somente na primeira vez (guard de idempotência).
        if (this.#dialogLoopAttached) return;
        this.#dialogLoopAttached = true;
        // G2-ARCH-10: wireDialogLoopEvents() faz removeAllListeners() antes de registrar.
        // É seguro aqui porque o flag #dialogLoopAttached garante execução única por instância.
        wireDialogLoopEvents(this.#dialogLoop, (event, payload) => this.emit(event, payload));

        // F31.3/F31.4: Proxy token_budget_warning → DLM para compaction proativa
        this.on('session.token_budget_warning', (evt) => {
            const ratio = typeof evt?.ratio === 'number' ? evt.ratio : 0;
            const currentTokens = typeof evt?.currentTokens === 'number' ? evt.currentTokens : 0;
            const tokenLimit = typeof evt?.tokenLimit === 'number' ? evt.tokenLimit : 0;
            this.#dialogLoop.handleTokenBudget({ currentTokens, tokenLimit, ratio });
        });

        // F31.3: Reset compaction flag após compaction bem-sucedida
        this.on('session.compaction_complete', (evt) => {
            if (evt?.success) this.#dialogLoop.resetCompactionFlag();
        });

        // F29: agent-event-observer agora é criado no start() (eagerness).
        // Não precisa mais ser criado aqui.
    }

    /**
     * Sincroniza o histórico SDK → ConversationStore (SQLite) após reconexão.
     *
     * Chamado de forma assíncrona (fire-and-forget) no `start()` quando `isResumed=true` para não bloquear o startup.
     * Falhas são logadas como WARN e não propagadas.
     *
     * @param {CopilotSession} session
     * @returns {Promise<void>}
     */
    async #syncSdkHistory(session) {
        try {
            const hubSessionId = getHubSessionId();
            if (!hubSessionId) return;
            const sdkSession = /** @type {{ getMessages?: () => Promise<unknown[]> }} */ (session);
            if (typeof sdkSession.getMessages !== 'function') {
                log(
                    'WARN',
                    '[AlwaysAlive] sdkSession.getMessages() não disponível nesta versão do SDK — histórico não sincronizado.',
                );
                return;
            }
            const messages = await sdkSession.getMessages();
            if (!Array.isArray(messages) || messages.length === 0) return;
            const { synced, skipped } = conversationStore.syncFromSdkHistory(
                hubSessionId,
                session.sessionId,
                /** @type {{ id?: string; type: string; content: string; createdAt?: number }[]} */ (messages),
            );
            if (synced > 0) {
                log(
                    'INFO',
                    `[AlwaysAlive] ${synced} turnos SDK sincronizados com o ConversationStore (${skipped} ignorados).`,
                );
                this.emit('session.history_synced', { hubSessionId, sessionId: session.sessionId, synced, skipped });
            }
        } catch (/** @type {any} */ err) {
            log('WARN', `[AlwaysAlive] syncSdkHistory falhou (não crítico): ${err.message}`);
            // G2-BUG-17: emitir session.history_synced com ok:false para que consumers SSE monitorem falhas
            this.emit('session.history_synced', { ok: false, error: err.message });
        }
    }

    /**
     * @param {AgentStatus} status
     */
    #setStatus(status) {
        this.#status = status;
        this.#statusSnapshotCache = null;
        this.emit('status', status);
    }

    /**
     * Processa a próxima tarefa da fila (se idle e sessão ativa).
     *
     * @returns {void}
     */
    #processQueue() {
        // G1-ARCH-03: bloqueia processamento durante reconexão ativa
        if (this.#isReconnecting || this.#status !== 'idle' || this.#messageQueue.size === 0 || !this.#session) return;
        const session = this.#session;

        const task = this.#messageQueue.shift();
        if (!task) return;

        this.#setStatus('processing');
        this.emit('task.started', { taskId: task.id });

        log('INFO', `[AlwaysAlive] Processando tarefa ${task.id}`);
        this.#sendCount++;
        // F42.2: registrar atividade para reset do timer de idle do keepalive
        this.#keepalive.ping();

        void executeTask(session, task, {
            onDelta: (chunk, taskId) => this.emit('task.delta', { taskId, chunk }),
            setStatus: (s) => this.#setStatus(s),
            emit: (event, payload) => this.emit(event, payload),
            tryReconnect: (e) => this.#tryReconnect(e),
            requeueTask: (t) => this.#messageQueue.unshift(t),
            scheduleNext: () => this.#processQueue(),
        });
    }

    /**
     * Inicializa (ou reinicializa) a sessão SDK: carrega MCP tools, reconstrói o registry, bootstrap das tools, chama
     * `initOrResumeSession` e sincroniza o estado interno.
     *
     * Usado tanto no `start()` inicial quanto em cada tentativa de `#tryReconnect()`.
     *
     * @param {CopilotClient} client - Cliente SDK já instanciado
     * @returns {Promise<{ session: CopilotSession; isResumed: boolean }>}
     */
    async #initSession(client) {
        // G1-API-05 (fix): invalidar cache de mensagens para garantir que chamadas a
        // getSessionMessages() após reconexão não retornem mensagens da sessão anterior.
        this.#messagesCache = null;
        const mcpTools = await buildMcpTools();
        if (mcpTools.length > 0) {
            log('INFO', `[AlwaysAlive] ${mcpTools.length} MCP tools carregadas via bridge.`);
        }
        // Reinicia o registry para evitar duplicação de tools em reconexões consecutivas.
        this.#toolsRegistry = createRegistry();
        const tools = bootstrapTools(this.#toolsRegistry, mcpTools);
        log('INFO', `[AlwaysAlive] ${tools.length} tools registradas (registry + introspection).`);

        // N.2: compor todos os 6 hooks SDK usando o módulo canônico.
        // - lifecycleHooks: onSessionStart (rich additionalContext G4), onSessionEnd, onErrorOccurred
        //   com telemetria, webhooks e fallback model via injeção de dependência.
        // - createHooks: wires onPreToolUse (auditLog) + onPostToolUse (ring buffer via auditLog)
        //   + onUserPromptSubmitted (auditLog) com os overrides de lifecycle acima.
        const lifecycleHooks = createSessionHooks({
            emitWebhook: (event, payload) => this.#webhooks.emit(event, payload),
            getModel: () => this.#model,
            scheduleFallback: (model) => this.#dialogLoop.scheduleFallback(model),
            emit: (event, payload) => this.emit(event, payload),
        });

        const hooks = createHooks({
            auditLog: true,
            onSessionStart: lifecycleHooks.onSessionStart,
            onSessionEnd: lifecycleHooks.onSessionEnd,
            onErrorOccurred: lifecycleHooks.onErrorOccurred,
        });

        // O.1: attachBus wireará o defaultBus singleton como observer de todos os eventos
        //      sem modificar o comportamento dos handlers — todos os listeners SSE (Fase P)
        //      e ring buffer ouvirão via defaultBus.
        const busHooks = attachBus(hooks);

        const { session, isResumed } = await initOrResumeSession(client, {
            model: this.#model,
            onPermissionRequest: this.#permissions.handler,
            onUserInputRequest: (
                /** @type {{ question: string; choices?: string[]; allowFreeform: boolean }} */ input,
            ) =>
                handleUserInputRequest(input, {
                    isDialogLoopActive: () => this.#dialogLoop.active,
                    handleProtocolInput: (q) => this.#dialogLoop.handleProtocolInput(q),
                    setStatus: (s) => this.#setStatus(s),
                    setPendingQuestion: (pq) => {
                        this.#pendingQuestion = pq;
                    },
                    emit: (event, payload) => this.emit(event, payload),
                }),
            hooks: busHooks,
            tools,
            mcpServers: buildMcpConfig(),
            reasoningEffort: this.#reasoningEffort,
            injectHookContext: true,
        });

        this.#session = session;
        this.#isResumed = isResumed;
        setSessionRpc(session.rpc);
        return { session, isResumed };
    }

    /**
     * Tenta reconectar à sessão SDK com backoff exponencial + jitter. Delega para a política centralizada em
     * `lifecycle/reconnect-policy.js`.
     *
     * @param {Error} originalError - Erro original que desencadeou a reconexão
     * @param {{ maxAttempts?: number; baseDelayMs?: number }} [opts]
     * @returns {Promise<boolean>} true se reconexão bem-sucedida, false se esgotado
     */
    async #tryReconnect(originalError, opts = {}) {
        // G1-ARCH-03: sinaliza reconexão ativa para bloquear #processQueue()
        this.#isReconnecting = true;
        try {
            return await tryReconnect(
                originalError,
                /** @type {import('@github/copilot-sdk').CopilotClient} */ (this.#client),
                this.#status,
                {
                    emit: (event, payload) => this.emit(event, payload),
                    initSession: (client) => this.#initSession(client),
                    dialogLoop: this.#dialogLoop,
                    clearSessionEventUnsubs: () => {
                        for (const unsub of this.#sessionEventUnsubscribers) unsub();
                        this.#sessionEventUnsubscribers = [];
                    },
                    // F42.5 (BUG-SD-002 fix): criar novo client a cada tentativa de reconexão
                    createClient: () => {
                        const _otelConfig = buildTelemetryConfig();
                        return new CopilotClient(...(_otelConfig ? [{ telemetry: _otelConfig }] : []));
                    },
                    updateClient: (newClient) => {
                        this.#client = newClient;
                    },
                },
                opts,
            );
        } finally {
            this.#isReconnecting = false;
        }
    }

    /**
     * Retorna o histórico de mensagens da sessão SDK ativa.
     *
     * Útil para debug, auditoria e introspecção do context window. O resultado é cacheado por `#MESSAGES_CACHE_TTL` ms
     * para reduzir chamadas repetidas ao SDK. Retorna array vazio se não houver sessão ativa ou se `getMessages()`
     * lance (sem suporte no SDK).
     *
     * @returns {Promise<unknown[]>}
     */
    async getSessionMessages() {
        if (!this.#session) return [];
        const now = Date.now();
        if (this.#messagesCache !== null && now - this.#messagesCacheAt < AlwaysAliveAgent.#MESSAGES_CACHE_TTL) {
            return this.#messagesCache;
        }
        try {
            const messages = await this.#session.getMessages();
            this.#messagesCache = messages;
            this.#messagesCacheAt = now;
            return messages;
        } catch {
            return [];
        }
    }

    /**
     * Suporte a `await using agent = alwaysAliveAgent` no padrão Explicit Resource Management (TC39 Stage 4).
     *
     * Permite encapsular o ciclo de vida do agente em blocos `await using` de forma determinística.
     *
     * @returns {Promise<void>}
     */
    async [Symbol.asyncDispose]() {
        await this.stop();
    }

    /**
     * UPG-AGENT-005: Suporte a `using agent = alwaysAliveAgent` (sync Explicit Resource Management). Dispara stop() em
     * fire-and-forget; útil em contextos onde `await using` não é possível.
     */
    [Symbol.dispose]() {
        this.stop().catch((/** @type {any} */ e) =>
            log('WARN', `[AlwaysAlive] stop() em Symbol.dispose falhou: ${e.message}`),
        );
    }
}

/**
 * Instância singleton do Always-Alive Agent para este processo.
 *
 * @type {AlwaysAliveAgent}
 */
export const alwaysAliveAgent = new AlwaysAliveAgent();

/**
 * G1-ARCH-01: Accessor lazy do singleton — use este em vez de importar `alwaysAliveAgent` diretamente.
 *
 * Permite que futuramente a instância seja substituída (ex.: por um mock em testes de integração) sem alterar todos os
 * call sites.
 *
 * @returns {AlwaysAliveAgent}
 */
export function getAgent() {
    return alwaysAliveAgent;
}
