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
 * @module copilot/always-alive
 */

import { SessionError } from '#copilot/core/errors';
import { createRegistry, createTelemetry, recordSessionEnd, recordSessionStart, startSpan } from '#copilot/lib/index';
import { log } from '#core/logger';
import { CopilotClient, approveAll } from '@github/copilot-sdk';
import EventEmitter from 'node:events';
import { buildMcpTools } from '../bridges/mcp-tool-bridge.js';
import { buildMcpConfig } from '../config/mcp-servers.js';
import { conversationStore } from '../conversation-hub/store.js';
import { getHubSessionId } from '../terminal/state.js';
import { DialogWatchdog } from './dialog-watchdog.js';
import { AGENT_EVENTS } from './events.js';
import { initOrResumeSession, readState, writeState } from './session-manager.js';
import { executeTask } from './task-executor.js';
import { bootstrapTools, setSessionRpc } from './tools-bootstrap.js';
import { WebhookManager } from './webhook-manager.js';

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

    /** @type {PendingQuestion | null} */
    #pendingQuestion = null;

    /** @type {AgentTask[]} */
    #queue = [];

    /** @type {boolean} */
    #dialogLoopActive = false;

    /**
     * Mutex para serializar chamadas a sendDialogTurn(). Garante que apenas um turno executa no dialog loop por vez,
     * evitando race conditions no #pendingQuestion compartilhado.
     *
     * @type {Promise<void>}
     */
    #dialogTurnMutex = Promise.resolve();

    /** @type {DialogWatchdog | null} */
    #watchdog = null;

    /**
     * PERF-01 (fix): contador de mensagens em memória para evitar readState()+writeState() síncrono a cada envio.
     * Inicializado a partir do estado persistido no boot; persiste ao atingir 'stopped'.
     *
     * @type {number}
     */
    #sendCount = 0;

    /**
     * Intervalo do watchdog (ms). Controlado por `LLM_B_WATCHDOG_MS`. Padrão: 5 minutos.
     *
     * @type {number}
     */
    static #WATCHDOG_INTERVAL_MS = Number(process.env.LLM_B_WATCHDOG_MS ?? 5 * 60 * 1_000);

    /**
     * Limiar de inatividade (ms) para emitir 'dialog.stalled'. Controlado por `LLM_B_WATCHDOG_STALL_MS`. Padrão: 15
     * minutos.
     *
     * @type {number}
     */
    static #WATCHDOG_STALL_MS = Number(process.env.LLM_B_WATCHDOG_STALL_MS ?? 15 * 60 * 1_000);

    /**
     * Tamanho máximo da fila de tarefas. Evita crescimento ilimitado de memória em cenários de sobrecarga.
     *
     * @type {number}
     */
    static MAX_QUEUE_SIZE = 100;

    /** @type {string} */
    #model;

    /** @type {'low' | 'medium' | 'high' | 'xhigh' | undefined} */
    #reasoningEffort;

    /** @type {boolean} */
    #isResumed = false;

    /**
     * AA.1 — Dados reais de uso de contexto capturados do evento `session.usage_info` do SDK. Atualizado a cada turno.
     * null enquanto a sessão não emitir o primeiro evento.
     *
     * @type {{ tokens: number; tokenLimit: number; utilization: number } | null}
     */
    #contextState = null;

    /**
     * AC.3 — Último caminho de checkpoint salvo pelo SDK durante compaction. null até a primeira compaction concluída.
     *
     * @type {string | null}
     */
    #lastCheckpointPath = null;

    /** @type {WebhookManager} */
    #webhooks = new WebhookManager();

    /** @type {import('#copilot/lib/telemetry').TelemetryStore} */
    #telemetry = createTelemetry();

    /** @type {import('#copilot/lib/tools-registry').ToolRegistry} */
    #toolsRegistry = createRegistry();

    /**
     * @param {{ model?: string; reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' }} [options]
     */
    constructor(options = {}) {
        super();
        // Agentes de alta carga acumulam múltiplos listeners por tarefa + SSE + bridge.
        // O padrão de 10 é insuficiente; 50 cobre cenários de carga real sem suprimir warnings.
        this.setMaxListeners(50);
        this.#model = options.model ?? process.env.COPILOT_MODEL ?? 'gpt-4.1';
        this.#reasoningEffort =
            options.reasoningEffort ??
            /** @type {'low' | 'medium' | 'high' | 'xhigh' | undefined} */ (
                process.env.COPILOT_REASONING_EFFORT || undefined
            );
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
        return this.#dialogLoopActive;
    }

    /**
     * Retorna o número atual de tarefas enfileiradas aguardando processamento.
     *
     * @returns {number}
     */
    get queueSize() {
        return this.#queue.length;
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
     * Retorna o store de telemetria da sessão atual.
     *
     * @returns {import('#copilot/lib/telemetry').TelemetryStore}
     */
    get telemetry() {
        return this.#telemetry;
    }

    /**
     * Retorna o registry de tools da sessão atual.
     *
     * @returns {import('#copilot/lib/tools-registry').ToolRegistry}
     */
    get toolsRegistry() {
        return this.#toolsRegistry;
    }

    /**
     * Inicializa o agente: conecta ao CLI e cria/retoma sessão.
     *
     * @returns {Promise<void>}
     */
    async start() {
        if (this.#status !== 'stopped') {
            log('WARN', '[AlwaysAlive] start() chamado com agente já ativo.');
            return;
        }

        this.#setStatus('starting');
        log('INFO', '[AlwaysAlive] Iniciando agente...');

        try {
            const client = new CopilotClient();
            this.#client = client;

            const mcpTools = await buildMcpTools();
            if (mcpTools.length > 0) {
                log('INFO', `[AlwaysAlive] ${mcpTools.length} MCP tools carregadas via bridge.`);
            }

            // Inicializa telemetria e registry para esta sessão
            this.#telemetry = createTelemetry();
            this.#toolsRegistry = createRegistry();

            // Registra tools por categoria e expõe para introspecção
            const tools = bootstrapTools(this.#toolsRegistry, this.#telemetry, mcpTools);
            log('INFO', `[AlwaysAlive] ${tools.length} tools registradas (registry + introspection).`);

            // AI.3: span OTEL para metrificar duração do boot de sessão
            const { session, isResumed } = await startSpan('session.boot', { model: this.#model }, () =>
                initOrResumeSession(client, {
                    model: this.#model,
                    onPermissionRequest: approveAll,
                    onUserInputRequest: this.#handleUserInputRequest.bind(this),
                    hooks: {
                        onSessionStart: this.#onSessionStart.bind(this),
                        onSessionEnd: this.#onSessionEnd.bind(this),
                        onErrorOccurred: this.#onErrorOccurred.bind(this),
                    },
                    tools,
                    mcpServers: buildMcpConfig(),
                    reasoningEffort: this.#reasoningEffort,
                    injectHookContext: true,
                }),
            );

            this.#session = session;
            this.#isResumed = isResumed;
            // L4: injetar RPC da sessão nas session-rpc-tools para exposição via tools
            setSessionRpc(session.rpc);

            // Wiring de eventos de compaction para observabilidade via SSE/NERV
            session.on('session.compaction_start', (/** @type {any} */ evt) => {
                log('INFO', '[AlwaysAlive] Compaction iniciada (sessão infinita).');
                this.emit('session.compaction_start', evt?.data ?? {});
            });
            session.on('session.compaction_complete', (/** @type {any} */ evt) => {
                const data = evt?.data ?? {};
                // AC.2: detectar falha de compaction e logar instrução de recovery com checkpointPath
                if (data.success === false) {
                    log('ERROR', '[AlwaysAlive] Compaction falhou. Sessão pode estar instável.');
                    if (data.checkpointPath) {
                        log(
                            'WARN',
                            `[AlwaysAlive] Checkpoint disponível: ${data.checkpointPath}. Para recovery manual, restaure esse arquivo e reinicie.`,
                        );
                    }
                } else {
                    log('INFO', '[AlwaysAlive] Compaction concluída.');
                }
                // AC.3: armazenar info de checkpoint no estado para exposição via getStatusSnapshot()
                if (data.checkpointPath) {
                    this.#lastCheckpointPath = data.checkpointPath;
                }
                this.emit('session.compaction_complete', data);
            });

            // Reasoning tokens (o3/o4-mini extended thinking) — forwarded via task.reasoning
            session.on('assistant.reasoning_delta', (/** @type {any} */ evt) => {
                const chunk = evt?.data?.deltaContent ?? '';
                if (chunk) this.emit('task.reasoning', { chunk, reasoningId: evt?.data?.reasoningId ?? null });
            });

            // Uso de tokens e contexto da sessão — forwarded via session.usage
            // MELHORIA-02: emite session.token_budget_warning quando uso > 80%
            // MELHORIA-05: na 1ª leitura após retomada, alerta se uso já > 70% (contexto pesado)
            // AA.1: armazena em #contextState para exposição via getStatusSnapshot() e /context
            let _firstUsageChecked = false;
            session.on('session.usage_info', (/** @type {any} */ evt) => {
                const data = evt?.data ?? {};
                this.emit('session.usage', data);
                const { currentTokens, tokenLimit } = data;
                if (tokenLimit > 0) {
                    const ratio = Math.round((currentTokens / tokenLimit) * 100);
                    // AA.1: atualizar estado de contexto com dados reais do SDK
                    this.#contextState = {
                        tokens: currentTokens,
                        tokenLimit,
                        utilization: currentTokens / tokenLimit,
                    };
                    // MELHORIA-05: alerta proativo na 1ª leitura se sessão retomada com contexto pesado
                    if (!_firstUsageChecked && isResumed && currentTokens / tokenLimit > 0.7) {
                        log(
                            'WARN',
                            `[AlwaysAlive] Sessão retomada com contexto pesado (${ratio}% — ${currentTokens}/${tokenLimit}). Compaction automática pode ocorrer em breve.`,
                        );
                        this.emit('session.token_budget_warning', {
                            currentTokens,
                            tokenLimit,
                            ratio,
                            reason: 'startup_heavy',
                        });
                    }
                    _firstUsageChecked = true;
                    // MELHORIA-02: warning contínuo quando uso > 80%
                    if (currentTokens / tokenLimit > 0.8) {
                        log(
                            'WARN',
                            `[AlwaysAlive] Token budget em ${ratio}% (${currentTokens}/${tokenLimit}) — emitindo token_budget_warning`,
                        );
                        this.emit('session.token_budget_warning', { currentTokens, tokenLimit, ratio });
                    }
                }
            });

            // Mudança de modo (plan ↔ act ↔ interactive) — forwarded via session.mode_changed
            session.on('session.mode_changed', (/** @type {any} */ evt) => {
                log('INFO', `[AlwaysAlive] Modo mudou: ${evt?.data?.previousMode} → ${evt?.data?.newMode}`);
                this.emit('session.mode_changed', evt?.data ?? {});
            });

            // MELHORIA-02 (fix): catch-all para eventos do SDK não tratados explicitamente
            // Permite observabilidade de novos eventos adicionados em versões futuras do SDK
            if (typeof (/** @type {any} */ (session).onEvent) === 'function') {
                /** @type {any} */ (session).onEvent((/** @type {any} */ evt) => {
                    const kind = evt?.kind ?? evt?.type ?? 'unknown';
                    const knownEvents = new Set([
                        'session.compaction_start',
                        'session.compaction_complete',
                        'assistant.reasoning_delta',
                        'session.usage_info',
                        'session.mode_changed',
                        'assistant.message_delta',
                        'tool.execution_start',
                        'tool.execution_complete',
                    ]);
                    if (!knownEvents.has(kind)) {
                        log('DEBUG', `[AlwaysAlive] Evento SDK não tratado: kind=${kind}`);
                    }
                });
            }

            this.#setStatus('idle');
            // PERF-01 (fix): inicializar contador em memória a partir do estado persistido
            this.#sendCount = readState()?.sendCount ?? 0;
            log(
                'INFO',
                `[AlwaysAlive] Agente pronto. SessionId: ${session.sessionId} (${isResumed ? 'retomada' : 'nova'})`,
            );

            // AI.4: sincronizar histórico SDK → SQLite após reconexão com sessão existente
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
     * Para o agente graciosamente (preserva sessão em disco via disconnect).
     *
     * @returns {Promise<void>}
     */
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
    async stop({ shutdownTimeoutMs = 10_000 } = {}) {
        // Idempotente: se já está parado, retorna sem ação
        if (this.#status === 'stopped') return;

        log('INFO', '[AlwaysAlive] Parando agente...');

        // BUG-02 (fix): emitir 'before-stop' para que consumers externos removam seus próprios listeners
        // antes do shutdown, evitando acúmulo de dead callbacks a cada ciclo stop()/start()
        this.emit('before-stop');
        this.removeAllListeners('before-stop');

        // BUG-07 (fix): aguardar conclusão do boot antes de parar
        if (this.#status === 'starting') {
            log('INFO', '[AlwaysAlive] stop() durante boot — aguardando conclusão (máx 15s)...');
            await Promise.race([
                new Promise((r) => this.once('ready', r)),
                new Promise((r) => this.once('error', r)),
                new Promise((r) => setTimeout(r, 15_000)),
            ]);
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

        // BUG-01 (fix): parar o watchdog e o dialog loop antes de setar status stopped
        if (this.#dialogLoopActive) {
            this.#dialogLoopActive = false;
            this.#watchdog?.stop();
        }

        // PERF-01 (fix): persistir contador em disco apenas no shutdown, não a cada mensagem
        writeState({ sendCount: this.#sendCount });

        this.#setStatus('stopped');

        // Rejeita todas as tarefas pendentes na fila
        const remainingTasks = this.#queue.splice(0);
        if (remainingTasks.length > 0) {
            log('WARN', `[AlwaysAlive] Rejeitando ${remainingTasks.length} tarefa(s) pendente(s) no shutdown.`);
            const shutdownError = new SessionError(
                '[AlwaysAlive] Agente parado durante shutdown gracioso.',
                'AGENT_STOPPED',
            );
            for (const task of remainingTasks) {
                task.reject(shutdownError);
            }
        }

        if (this.#session) {
            try {
                await this.#session.disconnect();
            } catch (/** @type {any} */ e) {
                log('WARN', `[AlwaysAlive] Erro ao desconectar sessão: ${e.message}`);
            }
            this.#session = null;
            setSessionRpc(null);
        }
        this.emit('stopped');
    }

    /**
     * Enfileira uma mensagem para ser enviada ao modelo.
     *
     * @param {string} message - Mensagem a enviar
     * @param {{
     *     timeoutMs?: number;
     *     attachments?: import('@github/copilot-sdk').MessageOptions['attachments'];
     *     signal?: AbortSignal;
     * }} [opts]
     *   - Opções. `timeoutMs` sobrescreve o timeout padrão de 60s do SDK para `sendAndWait`. Use um valor grande (ex.: `24
     *
     *       - 60 * 60 * 1000`) para tarefas de longa duração como o dialog loop, que nunca emitem `session.idle`
     *               organicamente.`attachments`permite enviar arquivos, imagens ou referências de contexto junto com a
     *               mensagem.`signal` permite cancelar a tarefa via AbortSignal (MELHORIA-13).
     *
     * @returns {Promise<string>} Resposta completa do modelo
     */
    sendMessage(message, { timeoutMs, attachments, signal } = {}) {
        return new Promise((resolve, reject) => {
            // MELHORIA-13 (fix): suporte a AbortSignal para cancelamento externo da tarefa
            if (signal?.aborted) {
                reject(new DOMException('AbortError: sendMessage cancelado antes de enfileirar.', 'AbortError'));
                return;
            }
            if (this.#queue.length >= AlwaysAliveAgent.MAX_QUEUE_SIZE) {
                const err = new SessionError(
                    `[AlwaysAlive] Fila cheia (${AlwaysAliveAgent.MAX_QUEUE_SIZE} tarefas). Tente novamente mais tarde.`,
                    'QUEUE_FULL',
                );
                log(
                    'WARN',
                    `[AlwaysAlive] sendMessage rejeitado: fila cheia (${this.#queue.length}/${AlwaysAliveAgent.MAX_QUEUE_SIZE}).`,
                );
                reject(err);
                return;
            }
            const task = /** @type {AgentTask} */ ({
                id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                message,
                resolve,
                reject,
                enqueuedAt: Date.now(),
                ...(timeoutMs !== undefined ? { timeoutMs } : {}),
                ...(attachments !== undefined ? { attachments } : {}),
            });
            // MELHORIA-13 (fix): cancelar tarefa na fila se o AbortSignal disparar antes de executar
            if (signal) {
                signal.addEventListener(
                    'abort',
                    () => {
                        const idx = this.#queue.indexOf(task);
                        if (idx !== -1) {
                            this.#queue.splice(idx, 1);
                            log('INFO', `[AlwaysAlive] Tarefa ${task.id} cancelada via AbortSignal na fila.`);
                        }
                        reject(new DOMException('Tarefa cancelada pelo AbortSignal.', 'AbortError'));
                    },
                    { once: true },
                );
            }
            this.#queue.push(task);
            // GAP-Q08 fix: invalidar cache de status ao enfileirar para manter queueSize atualizado
            this.#statusSnapshotCache = null;
            log('INFO', `[AlwaysAlive] Tarefa enfileirada: ${task.id}`);
            this.emit('task.queued', { taskId: task.id, message });
            this.#processQueue();
        });
    }

    /**
     * Responde a uma pergunta pendente do modelo.
     *
     * @param {string} answer - Resposta do usuário
     * @returns {boolean} True se havia pergunta pendente e foi respondida
     */
    answerPendingQuestion(answer) {
        if (!this.#pendingQuestion) {
            log('WARN', '[AlwaysAlive] answerPendingQuestion() chamado sem pergunta pendente.');
            return false;
        }
        log('INFO', `[AlwaysAlive] Respondendo pergunta pendente: "${answer.slice(0, 80)}..."`);
        this.#pendingQuestion.resolve(answer);
        this.#pendingQuestion = null;
        writeState({ pendingQuestion: null });
        this.emit('question.answered', { answer });
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
        // MELHORIA-08 (fix): propagar ao SDK imediatamente se sessão ativa
        if (this.#session && typeof (/** @type {any} */ (this.#session).setModel) === 'function') {
            try {
                /** @type {any} */ (this.#session).setModel(modelId);
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
     * Retorna um snapshot do estado atual para a API HTTP.
     *
     * PERF-02 (fix): resultado cacheado por 500ms para evitar I/O síncrono em readState() por chamada. O cache é
     * invalidado automaticamente quando status muda.
     *
     * @returns {AgentStatusSnapshot}
     */
    getStatusSnapshot() {
        const now = Date.now();
        // Cache válido por 500ms para evitar leituras síncrona por polling rápido
        if (this.#statusSnapshotCache && now - this.#statusSnapshotCache.at < 500) {
            return this.#statusSnapshotCache.snapshot;
        }
        const state = readState();
        const STARVATION_THRESHOLD_MS = 60_000;
        const first = this.#queue[0];
        const oldestWaitMs = first !== undefined ? now - first.enqueuedAt : 0;
        const snapshot = {
            status: this.#status,
            sessionId: this.sessionId,
            model: this.#model,
            reasoningEffort: this.#reasoningEffort,
            queueSize: this.#queue.length,
            oldestTaskWaitMs: oldestWaitMs,
            starvationAlert: oldestWaitMs >= STARVATION_THRESHOLD_MS,
            pendingQuestion: this.#pendingQuestion
                ? {
                      question: this.#pendingQuestion.question,
                      choices: this.#pendingQuestion.choices,
                      allowFreeform: this.#pendingQuestion.allowFreeform,
                      askedAt: this.#pendingQuestion.askedAt,
                  }
                : null,
            isResumed: this.#isResumed,
            resumeCount: state?.resumeCount ?? 0,
            sendCount: this.#sendCount,
            startedAt: state?.startedAt ?? null,
            // AA.2: dados reais de contexto do SDK (null enquanto a sessão não emitiu usage_info)
            contextWindow: this.#contextState,
            // AC.3: último checkpoint da compaction (null até a primeira compaction)
            lastCheckpointPath: this.#lastCheckpointPath,
        };
        this.#statusSnapshotCache = { snapshot, at: now };
        return snapshot;
    }

    /**
     * Retorna contagem de listeners por evento para diagnóstico de leaks.
     *
     * @returns {{ [event: string]: number }} Mapa evento → contagem de listeners
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
     * Inicia o "modo diálogo direto" com a LLM: envia um meta-prompt de boot que instrui o modelo a usar `ask_user` em
     * loop.
     *
     * Neste modo, cada chamada a `sendDialogTurn(text)` alimenta o próximo `ask_user` do modelo **sem consumir novo
     * PR**. Toda a conversa ocorre dentro de um único `sendMessage()` (1 PR total), usando o canal `onUserInputRequest`
     * como transporte bidirecional.
     *
     * Fluxo:
     *
     *     startDialogLoop(bootPrompt)  ← 1 PR (sendMessage)
     *       modelo: ask_user("READY:") ← suspende (0 PR)
     *       sendDialogTurn("Olá")      ← responde via ask_user (0 PR)
     *       modelo: ask_user("REPLY: resposta") ← suspende (0 PR)
     *       sendDialogTurn("continua") ← responde (0 PR)
     *       ...N turnos, tudo 1 PR...
     *
     * @param {string} [bootPrompt] - Prompt de boot personalizado (opcional)
     * @returns {Promise<void>} Resolve quando o loop estiver pronto para receber turnos
     * @throws {Error} Se o agente não estiver no estado 'idle'
     */
    async startDialogLoop(bootPrompt) {
        if (this.#status !== 'idle') {
            throw new SessionError(
                `[AlwaysAlive] startDialogLoop() requer status 'idle'. Status atual: '${this.#status}'`,
                'INVALID_STATE',
            );
        }

        if (this.#dialogLoopActive) {
            throw new SessionError(
                '[AlwaysAlive] Modo diálogo já está ativo. Chame stopDialogLoop() primeiro.',
                'DIALOG_ALREADY_ACTIVE',
            );
        }

        this.#dialogLoopActive = true;

        const metaPrompt =
            bootPrompt ??
            `Você é um agente de diálogo contínuo.

Protocolo OBRIGATÓRIO:
1. Chame ask_user("READY: aguardando próxima mensagem") para sinalizar prontidão.
2. Ao receber uma mensagem, processe-a e formule uma resposta.
3. Chame ask_user("REPLY: " + sua_resposta) para enviar a resposta.
4. Retorne ao passo 1.

IMPORTANTE: NUNCA encerre o loop. Não use ask_user("STOPPED") nem qualquer forma de
encerramento — o loop é eterno por design (DL-PERM). O sistema reiniciará automaticamente
qualquer tentativa de encerramento não autorizado.`;

        // Boot: 1 PR — resolve quando o modelo emite o primeiro ask_user("READY:")
        const bootPromise = new Promise((resolve) => {
            this.once('dialog.ready', resolve);
        });

        // Inicia watchdog: detecta se o dialog loop ficar inativo por muito tempo
        this.#watchdog = new DialogWatchdog({
            intervalMs: AlwaysAliveAgent.#WATCHDOG_INTERVAL_MS,
            stallMs: AlwaysAliveAgent.#WATCHDOG_STALL_MS,
            onStall: (stalledMs) => this.emit('dialog.stalled', { stalledMs }),
        });
        this.#watchdog.start();

        // sendMessage dispara o loop em background — não aguardamos a conclusão.
        // Timeout de 24h: o dialog loop é infinito e session.idle nunca dispara durante ask_user,
        // portanto o timeout padrão de 60s do SDK causaria reconexões desnecessárias a cada minuto.
        this.sendMessage(metaPrompt, { timeoutMs: 24 * 60 * 60 * 1000 }).catch((/** @type {any} */ e) => {
            if (this.#dialogLoopActive) {
                log('WARN', `[AlwaysAlive] Dialog loop encerrado: ${e.message}`);
                this.#dialogLoopActive = false;
                this.emit('dialog.stopped', { reason: e.message });
            }
        });

        await bootPromise;
        log('INFO', '[AlwaysAlive] Modo diálogo iniciado. Use sendDialogTurn() para interagir.');
    }

    /**
     * Envia um turno de diálogo para o modelo suspenso no loop ask_user. Deve ser chamado após `startDialogLoop()` e
     * quando o evento `dialog.ready` for emitido (indicando que o modelo está aguardando).
     *
     * Chamadas concorrentes são **serializadas automaticamente** via #dialogTurnMutex — nunca executam em paralelo.
     * Isso garante que apenas um turno altera o #pendingQuestion por vez.
     *
     * @param {string} message - Mensagem a enviar ao modelo
     * @param {{ timeout?: number; signal?: AbortSignal }} [opts] - timeout (padrão 60s) e AbortSignal opcional (UPG-01)
     * @returns {Promise<string>} A resposta do modelo (extraída do "REPLY: ...")
     * @throws {Error} Se o modo diálogo não estiver ativo
     */
    sendDialogTurn(message, { timeout = 60_000, signal } = {}) {
        if (!this.#dialogLoopActive) {
            return Promise.reject(
                new SessionError(
                    '[AlwaysAlive] Modo diálogo não está ativo. Chame startDialogLoop() primeiro.',
                    'DIALOG_NOT_ACTIVE',
                ),
            );
        }

        // UPG-01: suporte a AbortSignal externo
        if (signal?.aborted) {
            return Promise.reject(new DOMException('[AlwaysAlive] sendDialogTurn abortado.', 'AbortError'));
        }

        // DL-PERM-04: registrar atividade no watchdog logo ao enviar o turno —
        // assim o watchdog não dispara stall durante processamentos longos do modelo.
        this.#watchdog?.ping();

        // Serializa via mutex: encadeia na cauda do turno atual
        const prev = this.#dialogTurnMutex;
        /** @type {Promise<string>} */
        const next = prev.then(() =>
            this.#executeDialogTurn(message, { timeout, ...(signal !== undefined && { signal }) }),
        );
        // Atualiza a cauda — o .catch(() => {}) evita UnhandledRejection interna
        this.#dialogTurnMutex = next.then(() => {}).catch(() => {});
        return next;
    }

    /**
     * Implementação interna de sendDialogTurn — executada de forma serializada pelo #dialogTurnMutex.
     *
     * DL-PERM-05: se `dialog.stopped` disparar com `authorized: false` (restart automático), aguarda `dialog.ready` por
     * até `timeout` ms e reenvia a mensagem uma vez. Isso garante que turnos que estavam em flight durante um restart
     * automático do loop não são perdidos silenciosamente.
     *
     * Se `dialog.stopped` disparar com `authorized: true`, rejeita imediatamente (encerramento definitivo).
     *
     * @param {string} message
     * @param {{ timeout: number; signal?: AbortSignal }} opts
     * @returns {Promise<string>}
     */
    #executeDialogTurn(message, { timeout, signal }) {
        // AI.3: instrumentar com span OTEL
        return startSpan(
            'dialog.send_turn',
            { sessionId: this.sessionId ?? '', actor: 'user' },
            () =>
                new Promise((resolve, reject) => {
                    const timeoutHandle = setTimeout(() => {
                        reject(
                            new SessionError(
                                `[AlwaysAlive] sendDialogTurn timeout após ${timeout}ms`,
                                'DIALOG_TIMEOUT',
                            ),
                        );
                    }, timeout);

                    // NEW-01 (fix): cross-cleanup entre os dois listeners para evitar orphan listener
                    const onReplyOuter = (/** @type {{ reply: string }} */ evt) => {
                        clearTimeout(timeoutHandle);
                        this.off('dialog.stopped', onStopOuter);
                        resolve(evt.reply);
                    };
                    const onStopOuter = (/** @type {{ authorized?: boolean; reason?: string }} */ stopEvt) => {
                        clearTimeout(timeoutHandle);
                        this.off('dialog.reply', onReplyOuter);
                        if (stopEvt?.authorized) {
                            // Encerramento definitivo — rejeitar imediatamente
                            reject(
                                new SessionError('[AlwaysAlive] Diálogo encerrado definitivamente.', 'DIALOG_ENDED'),
                            );
                        } else {
                            // DL-PERM-05: restart automático — aguarda dialog.ready e reenvia a mensagem
                            log(
                                'INFO',
                                `[AlwaysAlive] DL-PERM-05: dialog.stopped (${stopEvt?.reason ?? 'unknown'}) durante turno — aguardando restart para reenviar.`,
                            );
                            const retryTimeout = setTimeout(() => {
                                this.off('dialog.ready', onRetryReady);
                                reject(
                                    new SessionError(
                                        `[AlwaysAlive] sendDialogTurn: timeout aguardando restart após dialog.stopped (${stopEvt?.reason})`,
                                        'DIALOG_RESTART_TIMEOUT',
                                    ),
                                );
                            }, timeout);
                            const onRetryReady = () => {
                                clearTimeout(retryTimeout);
                                // Loop reiniciado — reenviar a mensagem uma vez
                                if (this.#pendingQuestion) {
                                    this.answerPendingQuestion(message);
                                    this.once('dialog.reply', (/** @type {{ reply: string }} */ retryEvt) => {
                                        resolve(retryEvt.reply);
                                    });
                                } else {
                                    this.once('question.pending', () => {
                                        this.answerPendingQuestion(message);
                                        this.once('dialog.reply', (/** @type {{ reply: string }} */ retryEvt) => {
                                            resolve(retryEvt.reply);
                                        });
                                    });
                                }
                            };
                            this.once('dialog.ready', onRetryReady);
                        }
                    };

                    // UPG-01: cancelar via AbortSignal externo
                    if (signal) {
                        signal.addEventListener(
                            'abort',
                            () => {
                                clearTimeout(timeoutHandle);
                                this.off('dialog.reply', onReplyOuter);
                                this.off('dialog.stopped', onStopOuter);
                                reject(new DOMException('[AlwaysAlive] sendDialogTurn abortado.', 'AbortError'));
                            },
                            { once: true },
                        );
                    }

                    this.once('dialog.reply', onReplyOuter);
                    this.once('dialog.stopped', onStopOuter);

                    // Alimenta o ask_user pendente com a mensagem do usuário
                    if (this.#pendingQuestion) {
                        this.answerPendingQuestion(message);
                    } else {
                        // Modelo ainda não chegou ao ask_user — aguarda 'question.pending' uma vez
                        // BUG-02 (fix): registrar onStop dentro do onPending também, para limpar newTimeout
                        // e o listener interno de dialog.reply se dialog.stopped disparar antes da resposta
                        const onPending = (/** @type {unknown} */ _) => {
                            clearTimeout(timeoutHandle);
                            const newTimeout = setTimeout(() => {
                                this.off('dialog.reply', onReply);
                                this.off('dialog.stopped', onStop);
                                reject(
                                    new SessionError(
                                        `[AlwaysAlive] sendDialogTurn timeout após ${timeout}ms`,
                                        'DIALOG_TIMEOUT',
                                    ),
                                );
                            }, timeout);
                            const onReply = (/** @type {{ reply: string }} */ evt) => {
                                clearTimeout(newTimeout);
                                this.off('dialog.stopped', onStop);
                                resolve(evt.reply);
                            };
                            const onStop = (/** @type {{ authorized?: boolean; reason?: string }} */ stopEvt2) => {
                                clearTimeout(newTimeout);
                                this.off('dialog.reply', onReply);
                                if (stopEvt2?.authorized) {
                                    reject(
                                        new SessionError(
                                            '[AlwaysAlive] Diálogo encerrado definitivamente.',
                                            'DIALOG_ENDED',
                                        ),
                                    );
                                } else {
                                    // DL-PERM-05: restart — aguardar dialog.ready e reenviar
                                    const retryTimeout2 = setTimeout(() => {
                                        this.off('dialog.ready', onRetryReady2);
                                        reject(
                                            new SessionError(
                                                `[AlwaysAlive] sendDialogTurn: timeout aguardando restart (${stopEvt2?.reason})`,
                                                'DIALOG_RESTART_TIMEOUT',
                                            ),
                                        );
                                    }, timeout);
                                    const onRetryReady2 = () => {
                                        clearTimeout(retryTimeout2);
                                        if (this.#pendingQuestion) {
                                            this.answerPendingQuestion(message);
                                            this.once('dialog.reply', (/** @type {{ reply: string }} */ retryEvt2) => {
                                                resolve(retryEvt2.reply);
                                            });
                                        } else {
                                            this.once('question.pending', () => {
                                                this.answerPendingQuestion(message);
                                                this.once(
                                                    'dialog.reply',
                                                    (/** @type {{ reply: string }} */ retryEvt3) => {
                                                        resolve(retryEvt3.reply);
                                                    },
                                                );
                                            });
                                        }
                                    };
                                    this.once('dialog.ready', onRetryReady2);
                                }
                            };
                            this.once('dialog.reply', onReply);
                            this.once('dialog.stopped', onStop);
                            this.answerPendingQuestion(message);
                        };
                        this.once('question.pending', onPending);
                    }
                }),
        );
    }

    /**
     * Para o modo diálogo, sinalizando ao modelo para encerrar o loop.
     *
     * DL-PERM: por padrão o encerramento é recusado para preservar o dialog loop permanente. Apenas quando `authorized:
     * true` é passado o loop é efetivamente encerrado. Sem autorização, emite um aviso e retorna sem ação. Use
     * `authorized: true` para:
     *
     * - Restart automático pelo watchdog (ação legítima de saúde do sistema)
     * - Encerramento explicitamente autorizado pelo usuário via API
     *
     * O campo `reason` diferencia o tipo de encerramento:
     *
     * - `'watchdog_restart'` — restart automático do sistema (não-definitivo, loop será reiniciado)
     * - `'authorized_stop'` — encerramento permanente autorizado pelo usuário
     *
     * O restart automático em caso de encerramento pelo modelo é responsabilidade de `terminal/index.js`.
     *
     * @param {{ authorized?: boolean; reason?: 'watchdog_restart' | 'authorized_stop' }} [opts]
     * @returns {Promise<void>}
     */
    async stopDialogLoop({ authorized = false, reason = 'authorized_stop' } = {}) {
        if (!this.#dialogLoopActive) return;
        if (!authorized) {
            log(
                'WARN',
                '[AlwaysAlive] stopDialogLoop() chamado sem autorização — ignorado (DL-PERM). ' +
                    'Use stopDialogLoop({ authorized: true }) para encerrar o loop.',
            );
            return;
        }
        if (this.#pendingQuestion) {
            this.answerPendingQuestion('STOP_DIALOG');
        }
        this.#dialogLoopActive = false;
        this.#watchdog?.stop();
        this.emit('dialog.stopped', { reason, authorized: true });
    }

    // ─────────────── Privados ───────────────

    /**
     * AI.4 — Sincroniza o histórico SDK → ConversationStore (SQLite) após reconexão. Chamado de forma assíncrona
     * (fire-and-forget) para não bloquear o startup.
     *
     * @param {CopilotSession} session
     * @returns {Promise<void>}
     */
    async #syncSdkHistory(session) {
        try {
            const hubSessionId = getHubSessionId();
            if (!hubSessionId) return;
            /** @type {any} */
            const sdkSession = session;
            // SDK-NC01 (fix): método correto é getMessages(), não getHistory()
            if (typeof sdkSession.getMessages !== 'function') return;
            const messages = await sdkSession.getMessages();
            if (!Array.isArray(messages) || messages.length === 0) return;
            const { synced, skipped } = conversationStore.syncFromSdkHistory(hubSessionId, session.sessionId, messages);
            if (synced > 0) {
                log(
                    'INFO',
                    `[AlwaysAlive] AI.4: ${synced} turnos SDK sincronizados com o ConversationStore (${skipped} ignorados).`,
                );
                this.emit('session.history_synced', { hubSessionId, sessionId: session.sessionId, synced, skipped });
            }
        } catch (/** @type {any} */ err) {
            log('WARN', `[AlwaysAlive] AI.4: syncSdkHistory falhou (não crítico): ${err.message}`);
        }
    }

    /**
     * @param {AgentStatus} status
     */
    #setStatus(status) {
        this.#status = status;
        this.#statusSnapshotCache = null; // PERF-02: invalidar cache ao mudar status
        this.emit('status', status);
    }

    /**
     * Processa a próxima tarefa da fila (se idle e sessão ativa).
     *
     * @returns {void}
     */
    #processQueue() {
        // BUG-04 (fix): guard de reentrância — scheduleNext() é chamado no finally de executeTask,
        // o que pode disparar uma segunda entrada em #processQueue antes de setStatus('processing')
        // ter efeito via emit assíncrono. O status 'processing' ainda é o guard primário, mas o
        // estágio de shift() da fila pode ocorrer duas vezes se dois scheduleNext() dispararem
        // sequencialmente no mesmo tick. Este flag síncrono protege esse gap.
        if (this.#status !== 'idle' || this.#queue.length === 0 || !this.#session) return;
        const session = this.#session;

        const task = this.#queue.shift();
        if (!task) return;

        this.#setStatus('processing');
        this.emit('task.started', { taskId: task.id });

        log('INFO', `[AlwaysAlive] Processando tarefa ${task.id}`);
        // PERF-01 (fix): incremento em memória — persiste no disco apenas no shutdown
        this.#sendCount++;

        void executeTask(session, task, {
            onDelta: (chunk, taskId) => this.emit('task.delta', { taskId, chunk }),
            setStatus: (s) => this.#setStatus(s),
            emit: (event, payload) => this.emit(event, payload),
            tryReconnect: (e) => this.#tryReconnect(e),
            requeueTask: (t) => this.#queue.unshift(t),
            scheduleNext: () => this.#processQueue(),
        });
    }

    /**
     * Tenta reconectar a sessão SDK com backoff exponencial e jitter.
     *
     * Chamado quando `session.sendAndWait` falha, para determinar se o erro é recuperável (rede/sessão) e reestabelecer
     * a conexão antes de rejeitar a tarefa.
     *
     * @param {Error} originalError - Erro original que desencadeou a reconexão
     * @param {{ maxAttempts?: number; baseDelayMs?: number }} [opts]
     * @returns {Promise<boolean>} true se reconexão bem-sucedida, false se esgotado
     */
    async #tryReconnect(originalError, opts = {}) {
        const { maxAttempts = 5, baseDelayMs = 1_000 } = opts;

        // Só tenta reconectar se o cliente ainda existe e o agente não foi parado
        if (!this.#client || this.#status === 'stopped') return false;

        log('WARN', `[AlwaysAlive] Erro de sessão detectado: ${originalError.message}. Iniciando reconexão...`);

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            // Backoff exponencial com jitter: delay = base * 2^(attempt-1) + random(0..base)
            const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * baseDelayMs;
            log('INFO', `[AlwaysAlive] Reconexão tentativa ${attempt}/${maxAttempts} em ${Math.round(delay)}ms...`);
            this.emit('status', `reconnecting:${attempt}/${maxAttempts}`);

            await new Promise((r) => setTimeout(r, delay));

            try {
                const mcpTools = await buildMcpTools();
                // BUG-C03 (fix): resetar registry antes de bootstrapTools para evitar duplicação de tools
                this.#toolsRegistry = createRegistry();
                const tools = bootstrapTools(this.#toolsRegistry, this.#telemetry, mcpTools);
                const { session, isResumed } = await initOrResumeSession(this.#client, {
                    model: this.#model,
                    onPermissionRequest: approveAll,
                    onUserInputRequest: this.#handleUserInputRequest.bind(this),
                    hooks: {
                        onSessionStart: this.#onSessionStart.bind(this),
                        onSessionEnd: this.#onSessionEnd.bind(this),
                        onErrorOccurred: this.#onErrorOccurred.bind(this),
                    },
                    tools,
                    mcpServers: buildMcpConfig(),
                    reasoningEffort: this.#reasoningEffort,
                    injectHookContext: true,
                });
                this.#session = session;
                this.#isResumed = isResumed;
                // L4: atualizar RPC nas session-rpc-tools após reconexão
                setSessionRpc(session.rpc);
                log(
                    'INFO',
                    `[AlwaysAlive] Reconexão bem-sucedida na tentativa ${attempt}. SessionId: ${session.sessionId}`,
                );
                this.emit('ready', { sessionId: session.sessionId, isResumed, reconected: true });
                return true;
            } catch (/** @type {any} */ reconnectError) {
                log('WARN', `[AlwaysAlive] Tentativa ${attempt} falhou: ${reconnectError.message}`);
            }
        }

        log('ERROR', `[AlwaysAlive] Reconexão esgotada após ${maxAttempts} tentativas. Emitindo session.fatal.`);
        this.emit('session.fatal', { originalError: originalError.message, attempts: maxAttempts });
        return false;
    }

    /**
     * Handler chamado pelo SDK quando o modelo usa a ferramenta ask_user.
     *
     * @param {{ question: string; choices?: string[]; allowFreeform: boolean }} input
     * @returns {Promise<{ answer: string; wasFreeform: boolean }>}
     */
    async #handleUserInputRequest({ question, choices, allowFreeform }) {
        log('INFO', `[AlwaysAlive] Modelo tem pergunta: "${question.slice(0, 120)}"`);

        // ── Interceptação do dialog loop ────────────────────────────────────
        // No modo diálogo, o modelo usa ask_user com prefixos especiais.
        if (this.#dialogLoopActive) {
            const trimmed = question.trim();

            if (trimmed.startsWith('READY:') || trimmed === 'READY') {
                // Modelo sinaliza prontidão — emite evento para sendDialogTurn()
                this.#watchdog?.ping();
                this.emit('dialog.ready', {});
                // Aguarda a resposta via question.pending normal
                // (sendDialogTurn chamará answerPendingQuestion com a mensagem do usuário)
            } else if (trimmed.startsWith('REPLY:') || trimmed.startsWith('DONE:')) {
                // Modelo enviou uma resposta — extrai o conteúdo
                this.#watchdog?.ping();
                const reply = trimmed.replace(/^(REPLY:|DONE:)\s*/i, '').trim();
                this.emit('dialog.reply', { reply });
                // Aguarda o próximo turno via question.pending
            } else if (trimmed.startsWith('STOPPED') || trimmed === 'STOP_DIALOG') {
                // DL-PERM: o modelo tentou encerrar o loop. Não encerramos imediatamente — emitimos o evento
                // 'dialog.stopped' para que o listener em terminal/index.js possa reiniciar automaticamente.
                // O #dialogLoopActive NÃO é setado para false aqui — o restart via ensureDialogLoop() irá
                // reativar o loop sem interrupção do protocolo ask_user.
                log('WARN', '[AlwaysAlive] Modelo emitiu STOPPED — emitindo dialog.stopped para restart automático.');
                this.emit('dialog.stopped', { reason: 'model_stopped', authorized: false });
            }
        }
        // ── Fim da interceptação ─────────────────────────────────────────────

        this.#setStatus('waiting_for_input');
        writeState({ pendingQuestion: question });

        return new Promise((resolve) => {
            /** @type {PendingQuestion} */
            const pq = /** @type {any} */ ({ question, allowFreeform, askedAt: Date.now() });
            if (choices !== undefined) pq.choices = choices;
            pq.resolve = (/** @type {string} */ answer) => {
                this.#setStatus('processing');
                resolve({ answer, wasFreeform: true });
            };
            this.#pendingQuestion = pq;
            this.emit('question.pending', { question, choices, allowFreeform });
        });
    }

    /**
     * Emite um evento de webhook para todas as URLs registradas.
     *
     * @param {string} event - Nome do evento (ex: 'session.start', 'session.end')
     * @param {object} payload - Dados do evento
     * @returns {Promise<void>}
     */
    async #emitWebhook(event, payload) {
        return this.#webhooks.emit(event, payload);
    }

    /**
     * @param {{ sessionId: string }} _input
     */
    async #onSessionStart(_input) {
        log('INFO', `[AlwaysAlive] SessionStart hook: ${_input.sessionId}`);
        recordSessionStart(this.#telemetry, _input.sessionId);
        await this.#emitWebhook('session.start', { sessionId: _input.sessionId });
        return {};
    }

    /**
     * @param {{ sessionId: string }} _input
     */
    async #onSessionEnd(_input) {
        log('INFO', `[AlwaysAlive] SessionEnd hook: ${_input.sessionId}`);
        recordSessionEnd(this.#telemetry, _input.sessionId);
        await this.#emitWebhook('session.end', { sessionId: _input.sessionId });
    }

    /**
     * Hook `onErrorOccurred` do SDK — emite evento no agente para observabilidade via SSE/NERV.
     *
     * @param {{ error: string; errorContext: string; recoverable: boolean }} input
     * @param {{ sessionId: string }} invocation
     * @returns {void}
     */
    #onErrorOccurred(input, invocation) {
        log(
            'WARN',
            `[AlwaysAlive] SDK errorOccurred [${input.errorContext}]: ${input.error} (recuperável: ${input.recoverable})`,
        );
        this.emit('error', {
            hookType: 'errorOccurred',
            errorMessage: input.error,
            errorContext: input.errorContext,
            recoverable: input.recoverable,
            sessionId: invocation.sessionId,
        });
    }

    /**
     * Retorna o histórico de mensagens da sessão SDK ativa.
     *
     * Útil para debug, auditoria e introspecção do context window. Retorna array vazio se não houver sessão ativa.
     *
     * @returns {Promise<any[]>}
     */
    async getSessionMessages() {
        if (!this.#session) return [];
        try {
            return await this.#session.getMessages();
        } catch {
            return [];
        }
    }

    /**
     * MELHORIA-07 (fix): suporte a `await using agent = alwaysAliveAgent` no padrão Explicit Resource Management
     * (ECMAScript TC39 Stage 4).
     *
     * Permite encapsular o ciclo de vida do agente em blocos `await using` de forma determinística.
     *
     * @returns {Promise<void>}
     */
    async [Symbol.asyncDispose]() {
        await this.stop();
    }
}

/**
 * Instância singleton do Always-Alive Agent para este processo.
 *
 * @type {AlwaysAliveAgent}
 */
export const alwaysAliveAgent = new AlwaysAliveAgent();
