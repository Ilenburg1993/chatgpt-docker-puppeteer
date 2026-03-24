// @ts-check
/**
 * src/copilot/always-alive.js
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

import {
    createRegistry,
    createTelemetry,
    recordSessionEnd,
    recordSessionStart,
    registerTools,
} from '#copilot/lib/index';
import { log } from '#core/logger';
import { CopilotClient, approveAll } from '@github/copilot-sdk';
import EventEmitter from 'node:events';
import { buildMcpConfig } from './config/mcp-servers.js';
import { buildMcpTools } from './mcp-tool-bridge.js';
import { initOrResumeSession, readState, writeState } from './session-manager.js';
import {
    allTools,
    codeTools,
    fileReadTools,
    fileWriteTools,
    gitTools,
    hookTools,
    hubTools,
    introspectionTools,
    registerForIntrospection,
    sessionTools,
    setTelemetryStore,
    shellTools,
    taskTools,
} from './tools/index.js';

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
 */

/**
 * @typedef {'idle' | 'processing' | 'waiting_for_input' | 'starting' | 'stopped'} AgentStatus
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
     * Tamanho máximo da fila de tarefas. Evita crescimento ilimitado de memória em cenários de sobrecarga.
     *
     * @type {number}
     */
    static MAX_QUEUE_SIZE = 100;

    /** @type {string} */
    #model;

    /** @type {boolean} */
    #isResumed = false;

    /** @type {Map<string, string>} Map de id → URL de webhook registrado */
    #webhookUrls = new Map();

    /** @type {import('#copilot/lib/telemetry').TelemetryStore} */
    #telemetry = createTelemetry();

    /** @type {import('#copilot/lib/tools-registry').ToolRegistry} */
    #toolsRegistry = createRegistry();

    /**
     * @param {{ model?: string }} [options]
     */
    constructor(options = {}) {
        super();
        // Agentes de alta carga acumulam múltiplos listeners por tarefa + SSE + bridge.
        // O padrão de 10 é insuficiente; 50 cobre cenários de carga real sem suprimir warnings.
        this.setMaxListeners(50);
        this.#model = options.model ?? process.env.COPILOT_MODEL ?? 'gpt-4.1';
    }

    /**
     * Registra uma URL de webhook para notificações de sessão.
     *
     * @param {string} url - URL HTTP(S) que receberá POST com payload de evento
     * @returns {{ id: string; url: string }} Identificador do webhook registrado
     */
    registerWebhook(url) {
        const id = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        this.#webhookUrls.set(id, url);
        log('INFO', `[AlwaysAlive] Webhook registrado: ${id} → ${url}`);
        return { id, url };
    }

    /**
     * Remove um webhook previamente registrado.
     *
     * @param {string} id - ID do webhook a remover
     * @returns {boolean} true se removido, false se não encontrado
     */
    unregisterWebhook(id) {
        const removed = this.#webhookUrls.delete(id);
        if (removed) log('INFO', `[AlwaysAlive] Webhook removido: ${id}`);
        return removed;
    }

    /**
     * Lista todos os webhooks registrados.
     *
     * @returns {{ id: string; url: string }[]}
     */
    listWebhooks() {
        return [...this.#webhookUrls.entries()].map(([id, url]) => ({ id, url }));
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
            this.#client = new CopilotClient();

            const mcpTools = await buildMcpTools();
            const tools = [...allTools, ...mcpTools];
            if (mcpTools.length > 0) {
                log('INFO', `[AlwaysAlive] ${mcpTools.length} MCP tools carregadas via bridge.`);
            }

            // Inicializa telemetria e registry para esta sessão
            this.#telemetry = createTelemetry();
            this.#toolsRegistry = createRegistry();

            // Registra cada grupo de tools com sua própria categoria e tags para filtragem granular
            registerTools(this.#toolsRegistry, taskTools, { category: 'task', tags: ['queue', 'state'] });
            registerTools(this.#toolsRegistry, codeTools, {
                category: 'code',
                tags: ['lint', 'test', 'typecheck'],
                readOnly: true,
            });
            registerTools(this.#toolsRegistry, gitTools, { category: 'git', tags: ['vcs', 'diff', 'commit'] });
            registerTools(this.#toolsRegistry, sessionTools, { category: 'session', tags: ['hooks', 'briefing'] });
            registerTools(this.#toolsRegistry, hookTools, { category: 'hook', tags: ['audit', 'input', 'hooks'] });
            registerTools(this.#toolsRegistry, hubTools, {
                category: 'hub',
                tags: ['conversation', 'llm-b', 'dialog', 'persistent'],
            });
            registerTools(this.#toolsRegistry, introspectionTools, {
                category: 'introspection',
                tags: ['meta', 'telemetry'],
                readOnly: true,
            });
            registerTools(this.#toolsRegistry, fileReadTools, {
                category: 'file',
                tags: ['filesystem', 'io', 'read'],
                readOnly: true,
            });
            registerTools(this.#toolsRegistry, fileWriteTools, {
                category: 'file',
                tags: ['filesystem', 'io', 'write'],
            });
            registerTools(this.#toolsRegistry, shellTools, {
                category: 'shell',
                tags: ['exec', 'system', 'npm', 'node'],
            });
            // MCP tools registradas sem categoria específica pois são dinâmicas
            if (mcpTools.length > 0) {
                registerTools(this.#toolsRegistry, mcpTools, { category: 'mcp', tags: ['mcp', 'external'] });
            }

            // Expõe registry/telemetria para introspection tools
            registerForIntrospection(tools);
            setTelemetryStore(this.#telemetry);

            log('INFO', `[AlwaysAlive] ${tools.length} tools registradas (registry + introspection).`);

            const { session, isResumed } = await initOrResumeSession(this.#client, {
                model: this.#model,
                onPermissionRequest: approveAll,
                onUserInputRequest: this.#handleUserInputRequest.bind(this),
                hooks: {
                    onSessionStart: this.#onSessionStart.bind(this),
                    onSessionEnd: this.#onSessionEnd.bind(this),
                },
                tools,
                mcpServers: buildMcpConfig(),
                injectHookContext: true,
            });

            this.#session = session;
            this.#isResumed = isResumed;

            // Wiring de eventos de compaction para observabilidade via SSE/NERV
            session.on('session.compaction_start', (/** @type {any} */ evt) => {
                log('INFO', '[AlwaysAlive] Compaction iniciada (sessão infinita).');
                this.emit('session.compaction_start', evt?.data ?? {});
            });
            session.on('session.compaction_complete', (/** @type {any} */ evt) => {
                log('INFO', '[AlwaysAlive] Compaction concluída.');
                this.emit('session.compaction_complete', evt?.data ?? {});
            });

            this.#setStatus('idle');
            log(
                'INFO',
                `[AlwaysAlive] Agente pronto. SessionId: ${session.sessionId} (${isResumed ? 'retomada' : 'nova'})`,
            );
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

        this.#setStatus('stopped');

        // Rejeita todas as tarefas pendentes na fila
        const remainingTasks = this.#queue.splice(0);
        if (remainingTasks.length > 0) {
            log('WARN', `[AlwaysAlive] Rejeitando ${remainingTasks.length} tarefa(s) pendente(s) no shutdown.`);
            const shutdownError = new Error('[AlwaysAlive] Agente parado durante shutdown gracioso.');
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
        }
        this.emit('stopped');
    }

    /**
     * Enfileira uma mensagem para ser enviada ao modelo.
     *
     * @param {string} message - Mensagem a enviar
     * @returns {Promise<string>} Resposta completa do modelo
     */
    sendMessage(message) {
        return new Promise((resolve, reject) => {
            if (this.#queue.length >= AlwaysAliveAgent.MAX_QUEUE_SIZE) {
                const err = new Error(
                    `[AlwaysAlive] Fila cheia (${AlwaysAliveAgent.MAX_QUEUE_SIZE} tarefas). Tente novamente mais tarde.`,
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
            });
            this.#queue.push(task);
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

    /**
     * Retorna um snapshot do estado atual para a API HTTP.
     *
     * @returns {object}
     */
    getStatusSnapshot() {
        const state = readState();
        const now = Date.now();
        const STARVATION_THRESHOLD_MS = 60_000;
        const first = this.#queue[0];
        const oldestWaitMs = first !== undefined ? now - first.enqueuedAt : 0;
        return {
            status: this.#status,
            sessionId: this.sessionId,
            model: this.#model,
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
            sendCount: state?.sendCount ?? 0,
            startedAt: state?.startedAt ?? null,
        };
    }

    /**
     * Retorna contagem de listeners por evento para diagnóstico de leaks.
     *
     * @returns {{ [event: string]: number }} Mapa evento → contagem de listeners
     */
    listenerDiagnostics() {
        const events = [
            'task.queued',
            'task.started',
            'task.completed',
            'task.error',
            'task.delta',
            'question.pending',
            'question.answered',
            'status',
            'stopped',
            'ready',
            'session.compaction_start',
            'session.compaction_complete',
        ];
        /** @type {{ [event: string]: number }} */
        const result = {};
        for (const evt of events) {
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
            throw new Error(`[AlwaysAlive] startDialogLoop() requer status 'idle'. Status atual: '${this.#status}'`);
        }

        if (this.#dialogLoopActive) {
            throw new Error('[AlwaysAlive] Modo diálogo já está ativo. Chame stopDialogLoop() primeiro.');
        }

        this.#dialogLoopActive = true;

        const metaPrompt =
            bootPrompt ??
            `Você é um agente de diálogo contínuo.

Protocolo OBRIGATÓRIO:
1. Chame ask_user("READY: aguardando próxima mensagem") para sinalizar prontidão.
2. Ao receber uma mensagem, processe-a e formule uma resposta.
3. Chame ask_user("REPLY: " + sua_resposta) para enviar a resposta.
4. Retorne ao passo 1. NUNCA encerre o loop. Sempre use ask_user para comunicar.

Se receber "STOP_DIALOG", responda com ask_user("STOPPED") e então pode encerrar.`;

        // Boot: 1 PR — resolve quando o modelo emite o primeiro ask_user("READY:")
        const bootPromise = new Promise((resolve) => {
            this.once('dialog.ready', resolve);
        });

        // sendMessage dispara o loop em background — não aguardamos a conclusão
        this.sendMessage(metaPrompt).catch((/** @type {any} */ e) => {
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
     * @param {string} message - Mensagem a enviar ao modelo
     * @param {{ timeout?: number }} [opts] - Opção de timeout (padrão 60s)
     * @returns {Promise<string>} A resposta do modelo (extraída do "REPLY: ...")
     * @throws {Error} Se o modo diálogo não estiver ativo
     */
    sendDialogTurn(message, { timeout = 60_000 } = {}) {
        if (!this.#dialogLoopActive) {
            return Promise.reject(
                new Error('[AlwaysAlive] Modo diálogo não está ativo. Chame startDialogLoop() primeiro.'),
            );
        }

        return new Promise((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                reject(new Error(`[AlwaysAlive] sendDialogTurn timeout após ${timeout}ms`));
            }, timeout);

            this.once('dialog.reply', (/** @type {{ reply: string }} */ evt) => {
                clearTimeout(timeoutHandle);
                resolve(evt.reply);
            });

            this.once('dialog.stopped', () => {
                clearTimeout(timeoutHandle);
                reject(new Error('[AlwaysAlive] Diálogo encerrado pelo modelo.'));
            });

            // Alimenta o ask_user pendente com a mensagem do usuário
            if (this.#pendingQuestion) {
                this.answerPendingQuestion(message);
            } else {
                // Modelo ainda não chegou ao ask_user — aguarda 'question.pending' uma vez
                const onPending = (/** @type {unknown} */ _) => {
                    clearTimeout(timeoutHandle);
                    const newTimeout = setTimeout(() => {
                        reject(new Error(`[AlwaysAlive] sendDialogTurn timeout após ${timeout}ms`));
                    }, timeout);
                    this.once('dialog.reply', (/** @type {{ reply: string }} */ evt) => {
                        clearTimeout(newTimeout);
                        resolve(evt.reply);
                    });
                    this.answerPendingQuestion(message);
                };
                this.once('question.pending', onPending);
            }
        });
    }

    /**
     * Para o modo diálogo, sinalizando ao modelo para encerrar o loop.
     *
     * @returns {Promise<void>}
     */
    async stopDialogLoop() {
        if (!this.#dialogLoopActive) return;
        if (this.#pendingQuestion) {
            this.answerPendingQuestion('STOP_DIALOG');
        }
        this.#dialogLoopActive = false;
    }

    // ─────────────── Privados ───────────────

    /**
     * @param {AgentStatus} status
     */
    #setStatus(status) {
        this.#status = status;
        this.emit('status', status);
    }

    /**
     * Processa a próxima tarefa da fila (se idle e sessão ativa).
     *
     * @returns {void}
     */
    #processQueue() {
        if (this.#status !== 'idle' || this.#queue.length === 0 || !this.#session) return;
        const session = this.#session;

        const task = this.#queue.shift();
        if (!task) return;

        this.#setStatus('processing');
        this.emit('task.started', { taskId: task.id });

        log('INFO', `[AlwaysAlive] Processando tarefa ${task.id}`);
        const state = readState();
        writeState({ sendCount: (state?.sendCount ?? 0) + 1 });

        void (async () => {
            // Subscreve ao streaming de tokens enquanto a tarefa está em andamento
            const unsubDelta = session.on('assistant.message_delta', (/** @type {any} */ event) => {
                const chunk = event?.data?.deltaContent ?? '';
                if (chunk) this.emit('task.delta', { taskId: task.id, chunk });
            });

            try {
                const event = await session.sendAndWait({ prompt: task.message });
                unsubDelta();
                const text = event?.data?.content ?? '';
                this.#setStatus('idle');
                this.emit('task.completed', { taskId: task.id, response: text, responseLen: text.length });
                task.resolve(text);
            } catch (/** @type {any} */ e) {
                unsubDelta();
                // Tenta reconectar com backoff exponencial se parecer erro de rede/sessão
                const recovered = await this.#tryReconnect(e);
                if (recovered) {
                    // Sessão restaurada: reenfileira a tarefa para nova tentativa
                    log('INFO', `[AlwaysAlive] Sessão restaurada. Reenfileirando tarefa ${task.id}.`);
                    this.#queue.unshift(task);
                    this.#setStatus('idle');
                } else {
                    log('ERROR', `[AlwaysAlive] Erro ao processar tarefa ${task.id}: ${e.message}`);
                    this.#setStatus('idle');
                    this.emit('task.error', { taskId: task.id, error: e.message });
                    task.reject(e);
                }
            } finally {
                this.#processQueue();
            }
        })();
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
                const tools = [...allTools, ...mcpTools];
                const { session, isResumed } = await initOrResumeSession(this.#client, {
                    model: this.#model,
                    onPermissionRequest: approveAll,
                    onUserInputRequest: this.#handleUserInputRequest.bind(this),
                    hooks: {
                        onSessionStart: this.#onSessionStart.bind(this),
                        onSessionEnd: this.#onSessionEnd.bind(this),
                    },
                    tools,
                    mcpServers: buildMcpConfig(),
                    injectHookContext: true,
                });
                this.#session = session;
                this.#isResumed = isResumed;
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
                this.emit('dialog.ready', {});
                // Aguarda a resposta via question.pending normal
                // (sendDialogTurn chamará answerPendingQuestion com a mensagem do usuário)
            } else if (trimmed.startsWith('REPLY:') || trimmed.startsWith('DONE:')) {
                // Modelo enviou uma resposta — extrai o conteúdo
                const reply = trimmed.replace(/^(REPLY:|DONE:)\s*/i, '').trim();
                this.emit('dialog.reply', { reply });
                // Aguarda o próximo turno via question.pending
            } else if (trimmed.startsWith('STOPPED') || trimmed === 'STOP_DIALOG') {
                this.#dialogLoopActive = false;
                this.emit('dialog.stopped', { reason: 'model_stopped' });
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
        if (this.#webhookUrls.size === 0) return;

        const body = JSON.stringify({ event, payload, timestamp: Date.now() });

        await Promise.allSettled(
            [...this.#webhookUrls.entries()].map(async ([id, url]) => {
                try {
                    const { default: https } = await import('node:https');
                    const { default: http } = await import('node:http');
                    const parsed = new URL(url);
                    const lib = parsed.protocol === 'https:' ? https : http;
                    await new Promise((resolve, reject) => {
                        const req = lib.request(
                            url,
                            { method: 'POST', headers: { 'Content-Type': 'application/json' } },
                            (res) => {
                                res.resume();
                                res.on('end', resolve);
                            },
                        );
                        req.on('error', reject);
                        req.end(body);
                    });
                } catch (/** @type {any} */ e) {
                    log('WARN', `[AlwaysAlive] Webhook ${id} falhou ao notificar ${url}: ${e.message}`);
                }
            }),
        );
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
}

/**
 * Instância singleton do Always-Alive Agent para este processo.
 *
 * @type {AlwaysAliveAgent}
 */
export const alwaysAliveAgent = new AlwaysAliveAgent();
