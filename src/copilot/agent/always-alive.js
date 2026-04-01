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

import { MAX_QUEUE_SIZE } from '#copilot/core/constants';
import { SessionError } from '#copilot/core/errors';
import { raceEvents } from '#copilot/lib/event-helpers';
import { createRegistry, createTelemetry, recordSessionEnd, recordSessionStart, startSpan } from '#copilot/lib/index';
import { createAuditOnlyPermission, createPermissionHandler } from '#copilot/lib/permissions';
import { log } from '#core/logger';
import { CopilotClient, approveAll } from '@github/copilot-sdk';
import EventEmitter from 'node:events';
import { buildMcpTools } from '../bridges/mcp-tool-bridge.js';
import { buildMcpConfig } from '../config/mcp-servers.js';
import { conversationStore } from '../conversation-hub/store.js';
import { getHubSessionId } from '../terminal/state.js';
import { DialogLoopManager } from './dialog-loop-manager.js';
// DialogProtocol agora é usado apenas pelo DialogLoopManager — removido daqui (E.1)
import { AGENT_EVENTS } from './events.js';
import { initOrResumeSession, readState, writeStateAsync } from './session-manager.js';
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

    /**
     * E.1: DialogLoopManager — encapsula mutex, watchdog, backpressure, protocolo e pause/resume do dialog loop.
     *
     * @type {DialogLoopManager}
     */
    #dialogLoop = new DialogLoopManager();

    /**
     * Funções de unsubscribe retornadas por `session.on()`. O SDK não expõe um EventEmitter padrão —
     * cada `session.on()` retorna `() => void`. Chamadas em `stop()` e `#tryReconnect()` para prevenir
     * memory leaks entre ciclos de sessão.
     *
     * @type {(() => void)[]}
     */
    #sessionEventUnsubscribers = [];

    /**
     * Contador de mensagens enviadas mantido em memória para evitar I/O síncrono por envio.
     * Inicializado a partir do estado persistido no boot; salvo em disco apenas no `stop()`.
     *
     * @type {number}
     */
    #sendCount = 0;

    /**
     * Último snapshot de billing (model, cost, quotaSnapshots, timestamp). Atualizado pelo listener
     * `assistant.usage` durante o wiring de sessão em `start()`.
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
     * Snapshot de uso de contexto capturado do evento `session.usage_info` do SDK.
     * Atualizado a cada turno; `null` enquanto a sessão não emitir o primeiro evento.
     *
     * @type {{ tokens: number; tokenLimit: number; utilization: number } | null}
     */
    #contextState = null;

    /**
     * Cache de mensagens da sessão SDK para reduzir latência em chamadas repetidas via `getSessionMessages()`.
     * Invalida automaticamente após `#MESSAGES_CACHE_TTL` ou na troca de sessão.
     *
     * @type {any[] | null}
     */
    #messagesCache = null;

    /** @type {number} */
    #messagesCacheAt = 0;

    /**
     * TTL do cache de mensagens em ms. Padrão: 30 segundos.
     *
     * @type {number}
     */
    static #MESSAGES_CACHE_TTL = 30_000;

    /**
     * Último caminho de checkpoint salvo pelo SDK durante compaction de contexto.
     * `null` até a primeira compaction ser concluída.
     *
     * @type {string | null}
     */
    #lastCheckpointPath = null;

    /** @type {WebhookManager} */
    #webhooks = new WebhookManager();

    /** @type {import('@github/copilot-sdk').PermissionHandler} */
    #permissionHandler = approveAll;

    /** @type {'approve_all' | 'audit_only' | 'selective'} */
    #permissionModeLabel = /** @type {'approve_all'} */ ('approve_all');

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
        // O padrão de 10 é insuficiente; configurável via AGENT_MAX_LISTENERS (padrão 50).
        this.setMaxListeners(Number(process.env.AGENT_MAX_LISTENERS ?? 50));
        this.#model = options.model ?? process.env.COPILOT_MODEL ?? 'gpt-4.1';
        this.#reasoningEffort =
            options.reasoningEffort ??
            /** @type {'low' | 'medium' | 'high' | 'xhigh' | undefined} */ (
                process.env.COPILOT_REASONING_EFFORT || undefined
            );
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
        return this.#permissionModeLabel;
    }

    /**
     * Altera o modo de aprovação de tools em runtime — sem reiniciar o agente.
     *
     * A mudança é aplicada na PRÓXIMA reconexão/reinício real de sessão. Para sessões já ativas, apenas novos
     * `initOrResumeSession` usarão o handler atualizado.
     *
     * O dialog loop não é uma tool e não passa por este handler. Não é possível bloquear o encerramento do
     * dialog loop via configuração de permissão.
     *
     * @param {'approve_all' | 'audit_only' | 'selective'} mode - Modo de aprovação
     * @param {{ allowTools?: string[]; denyTools?: string[]; denyShell?: boolean }} [opts] - Opções para modo selective
     * @returns {void}
     */
    setPermissionMode(mode, opts = {}) {
        const { allowTools, denyTools, denyShell } = opts;
        switch (mode) {
            case 'approve_all':
                this.#permissionHandler = approveAll;
                this.#permissionModeLabel = 'approve_all';
                break;
            case 'audit_only':
                this.#permissionHandler = createAuditOnlyPermission();
                this.#permissionModeLabel = 'audit_only';
                break;
            case 'selective': {
                const shellTools = ['run_shell_command', 'run_npm_script', 'run_node_script'];
                /** @type {import('#copilot/lib/permissions').PermissionHandlerConfig} */
                const cfg = {
                    denyTools: [...(denyShell ? shellTools : []), ...(denyTools ?? [])],
                    auditMode: true,
                };
                if (allowTools?.length) cfg.allowTools = allowTools;
                this.#permissionHandler = createPermissionHandler(cfg);
                this.#permissionModeLabel = 'selective';
                break;
            }
            default:
                log('WARN', `[AlwaysAlive] setPermissionMode: modo inválido '${/** @type {any} */ (mode)}'`);
                return;
        }
        log('INFO', `[AlwaysAlive] Modo de permissão alterado para '${mode}'.`);
        this.emit('permission.mode_changed', { mode });
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

            // Inicializa telemetria para esta sessão (registry e MCP tools são criados dentro de #initSession)
            this.#telemetry = createTelemetry();

            const { session, isResumed } = await startSpan('session.boot', { model: this.#model }, () =>
                this.#initSession(client),
            );

            // Wiring de eventos de compaction para observabilidade via SSE/NERV.
            // session.on() retorna () => void (não this) — armazenado para cleanup no stop/reconnect.
            this.#sessionEventUnsubscribers = [];
            this.#wireSessionEvents(session, isResumed);

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

        // Sinaliza shutdown para que consumers externos removam seus próprios listeners
        // antes do dreno da fila, evitando dead callbacks em ciclos stop()/start().
        this.emit('before-stop');
        this.removeAllListeners('before-stop');

        // Garante que o boot não fique suspenso se stop() for chamado durante o start().
        if (this.#status === 'starting') {
            log('INFO', '[AlwaysAlive] stop() durante boot — aguardando conclusão (máx 15s)...');
            await raceEvents(this, ['ready', 'error'], { timeoutMs: 15_000 }).catch(() => {});
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

        if (this.#dialogLoop.active) {
            this.#dialogLoop.forceDeactivate();
            this.emit('dialog.loop.changed', { active: false, ts: Date.now() });
        }

        await writeStateAsync({ sendCount: this.#sendCount }).catch((/** @type {any} */ e) =>
            log('WARN', `[AlwaysAlive] writeState sendCount falhou: ${e.message}`),
        );

        this.#setStatus('stopped');

        // Rejeita todas as tarefas pendentes na fila
        const remainingTasks = this.#queue.splice(0);
        this.#statusSnapshotCache = null;
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
    // Session Event Wiring (extraído de start() para clareza — D.4)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Registra todos os listeners de eventos da sessão SDK e popula `#sessionEventUnsubscribers`. Extraído de `start()`
     * para reduzir a complexidade ciclomática do boot.
     *
     * @param {CopilotSession} session
     * @param {boolean} isResumed
     * @returns {void}
     */
    #wireSessionEvents(session, isResumed) {
        // Compaction start
        this.#sessionEventUnsubscribers.push(
            session.on('session.compaction_start', (/** @type {any} */ evt) => {
                log('INFO', '[AlwaysAlive] Compaction iniciada (sessão infinita).');
                this.emit('session.compaction_start', evt?.data ?? {});
            }),
        );

        // Compaction complete — detecta falha, captura checkpointPath para recovery.
        this.#sessionEventUnsubscribers.push(
            session.on('session.compaction_complete', (/** @type {any} */ evt) => {
                const data = evt?.data ?? {};
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
                if (data.checkpointPath) {
                    this.#lastCheckpointPath = data.checkpointPath;
                }
                this.emit('session.compaction_complete', data);
                const snap = this.getStatusSnapshot();
                this.emit('context:compacted', {
                    sessionId: snap?.sessionId ?? null,
                    ts: Date.now(),
                    checkpoint: data.checkpointPath ?? null,
                });
            }),
        );

        // Reasoning tokens (o3/o4-mini extended thinking)
        this.#sessionEventUnsubscribers.push(
            session.on('assistant.reasoning_delta', (/** @type {any} */ evt) => {
                const chunk = evt?.data?.deltaContent ?? '';
                if (chunk) this.emit('task.reasoning', { chunk, reasoningId: evt?.data?.reasoningId ?? null });
            }),
        );

        // Streaming delta apenas quando dialog loop está ativo (status !== 'processing').
        this.#sessionEventUnsubscribers.push(
            session.on('assistant.message_delta', (/** @type {any} */ evt) => {
                if (this.#status === 'processing') return;
                const chunk = evt?.data?.deltaContent ?? evt?.data?.content ?? '';
                if (chunk) this.emit('task.delta', { taskId: null, chunk });
            }),
        );

        // Token usage e janela de contexto — atualiza contextState e emite avisos.
        let _firstUsageChecked = false;
        this.#sessionEventUnsubscribers.push(
            session.on('session.usage_info', (/** @type {any} */ evt) => {
                const data = evt?.data ?? {};
                this.emit('session.usage', data);
                const { currentTokens, tokenLimit } = data;
                if (tokenLimit > 0) {
                    const ratio = Math.round((currentTokens / tokenLimit) * 100);
                    this.#contextState = {
                        tokens: currentTokens,
                        tokenLimit,
                        utilization: currentTokens / tokenLimit,
                    };
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
                    if (currentTokens / tokenLimit > 0.8) {
                        log(
                            'WARN',
                            `[AlwaysAlive] Token budget em ${ratio}% (${currentTokens}/${tokenLimit}) — emitindo token_budget_warning`,
                        );
                        this.emit('session.token_budget_warning', { currentTokens, tokenLimit, ratio });
                    }
                }
            }),
        );

        // Mudança de modo (plan ↔ act ↔ interactive)
        this.#sessionEventUnsubscribers.push(
            session.on('session.mode_changed', (/** @type {any} */ evt) => {
                log('INFO', `[AlwaysAlive] Modo mudou: ${evt?.data?.previousMode} → ${evt?.data?.newMode}`);
                this.emit('session.mode_changed', evt?.data ?? {});
            }),
        );

        // Catch-all para eventos do SDK não tratados explicitamente + billing (assistant.usage).
        /** @type {Set<string>} */
        const knownEvents = new Set([
            'session.compaction_start',
            'session.compaction_complete',
            'assistant.reasoning_delta',
            'session.usage_info',
            'session.mode_changed',
            'assistant.message_delta',
            'tool.execution_start',
            'tool.execution_complete',
            'assistant.usage',
        ]);
        this.#sessionEventUnsubscribers.push(
            session.on((/** @type {any} */ evt) => {
                const kind = evt?.kind ?? evt?.type ?? 'unknown';
                if (kind === 'assistant.usage') {
                    const data = evt?.data ?? {};
                    const { model, cost, quotaSnapshots } = data;
                    log('INFO', `[AlwaysAlive] PR consumido: model=${model ?? '?'}, cost=${cost ?? '?'}`);
                    this.#lastPrInfo = { model, cost, quotaSnapshots, ts: Date.now() };
                    this.emit('pr.consumed', { model, cost, quotaSnapshots, ts: Date.now() });
                    writeStateAsync({
                        pendingTurnConsumedPR: true,
                        lastPrConsumedAt: Date.now(),
                        lastPrModel: model ?? '',
                        lastPrCost: cost ?? 0,
                        lastQuotaSnapshots: quotaSnapshots ?? null,
                    }).catch((/** @type {any} */ e) =>
                        log('WARN', `[AlwaysAlive] writeState pendingTurnConsumedPR: ${e.message}`),
                    );
                    return;
                }
                if (!knownEvents.has(kind)) {
                    log('DEBUG', `[AlwaysAlive] Evento SDK não tratado: kind=${kind}`);
                }
            }),
        );
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
     *   - `timeoutMs` sobrescreve o timeout padrão de 60 s do SDK para `sendAndWait`. Use um valor grande (ex.:
     *     `24 * 60 * 60 * 1000`) para tarefas de longa duração como o dialog loop, que nunca emitem `session.idle`
     *     organicamente.
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
            // startDialogLoop() chama sendMessage() antes de setar dialogLoopActive=true, portanto
            // o guard usa a heurística de timeoutMs==24h para distinguir a chamada interna.
            if (this.#dialogLoop.active && timeoutMs !== 24 * 60 * 60 * 1000) {
                reject(
                    new SessionError(
                        '[AlwaysAlive] sendMessage() bloqueado: dialog loop ativo. Use sendDialogTurn().',
                        'DIALOG_ACTIVE',
                    ),
                );
                return;
            }
            if (this.#queue.length >= MAX_QUEUE_SIZE) {
                const err = new SessionError(
                    `[AlwaysAlive] Fila cheia (${MAX_QUEUE_SIZE} tarefas). Tente novamente mais tarde.`,
                    'QUEUE_FULL',
                );
                log(
                    'WARN',
                    `[AlwaysAlive] sendMessage rejeitado: fila cheia (${this.#queue.length}/${MAX_QUEUE_SIZE}).`,
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
            // ARCH-N01 (fix): mesmo sem pendingQuestion nativo, pode haver Promise de hook-tools.
            // Tentar resolver via resolveUserInput() exportado de hook-tools.
            import('../tools/hook-tools.js')
                .then(({ resolveUserInput }) => {
                    if (!resolveUserInput(answer)) {
                        log('WARN', '[AlwaysAlive] answerPendingQuestion() chamado sem pergunta pendente.');
                    }
                })
                .catch(() => {
                    log('WARN', '[AlwaysAlive] answerPendingQuestion() chamado sem pergunta pendente.');
                });
            return false;
        }
        log('INFO', `[AlwaysAlive] Respondendo pergunta pendente: "${answer.slice(0, 80)}..."`);
        this.#pendingQuestion.resolve(answer);
        this.#pendingQuestion = null;
        writeStateAsync({ pendingQuestion: null }).catch((/** @type {any} */ e) =>
            log('WARN', `[AlwaysAlive] writeState pendingQuestion=null: ${e.message}`),
        );
        this.emit('question.answered', { answer });
        // ARCH-N01 (fix): também resolver Promise da tool request_user_input se houver uma pendente
        import('../tools/hook-tools.js')
            .then(({ resolveUserInput }) => {
                resolveUserInput(answer);
            })
            .catch(() => {});
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
        // Propaga ao SDK imediatamente se a sessão já está ativa (suporte a runtime model switch).
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
     * Retorna um snapshot do estado atual do agente para a API HTTP.
     *
     * O resultado é cacheado por 500 ms para evitar leituras síncronas de `readState()` em polling rápido.
     * O cache é invalidado automaticamente quando o status muda via `#setStatus()`.
     *
     * @returns {AgentStatusSnapshot}
     */
    getStatusSnapshot() {
        const now = Date.now();
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
            contextWindow: this.#contextState,
            lastCheckpointPath: this.#lastCheckpointPath,
            permissionMode: this.#permissionModeLabel,
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
        this.#ensureDialogLoopAttached();
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
     * @param {{ authorized?: boolean; reason?: 'watchdog_restart' | 'authorized_stop' }} [opts]
     * @returns {Promise<void>}
     */
    async stopDialogLoop(opts) {
        await this.#dialogLoop.stop(opts);
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
     */
    #ensureDialogLoopAttached() {
        /** @type {import('./dialog-loop-manager.js').AgentHost} */
        const host = {
            sendMessage: (msg, opts) => this.sendMessage(msg, opts),
            answerPendingQuestion: (answer) => this.answerPendingQuestion(answer),
            getSessionId: () => this.sessionId,
            getModel: () => this.#model,
            getPendingQuestion: () => this.#pendingQuestion,
        };
        this.#dialogLoop.attach(host, this.#telemetry);
        // Propagar eventos do DialogLoopManager com prefixo dialog. para manter compatibilidade
        this.#dialogLoop.removeAllListeners();
        this.#dialogLoop.on('ready', (/** @type {any} */ evt) => this.emit('dialog.ready', evt));
        this.#dialogLoop.on('reply', (/** @type {any} */ evt) => this.emit('dialog.reply', evt));
        this.#dialogLoop.on('stopped', (/** @type {any} */ evt) => this.emit('dialog.stopped', evt));
        this.#dialogLoop.on('paused', (/** @type {any} */ evt) => this.emit('dialog.paused', evt));
        this.#dialogLoop.on('resumed', (/** @type {any} */ evt) => this.emit('dialog.resumed', evt));
        this.#dialogLoop.on('stalled', (/** @type {any} */ evt) => this.emit('dialog.stalled', evt));
        this.#dialogLoop.on('turn_start', (/** @type {any} */ evt) => this.emit('dialog.turn_start', evt));
        this.#dialogLoop.on('turn_end', (/** @type {any} */ evt) => this.emit('dialog.turn_end', evt));
        this.#dialogLoop.on('changed', (/** @type {any} */ evt) => this.emit('dialog.loop.changed', evt));
        this.#dialogLoop.on('model.fallback', (/** @type {any} */ evt) => this.emit('pr.fallback_model', evt));
    }

    /**
     * Sincroniza o histórico SDK → ConversationStore (SQLite) após reconexão.
     *
     * Chamado de forma assíncrona (fire-and-forget) no `start()` quando `isResumed=true`
     * para não bloquear o startup. Falhas são logadas como WARN e não propagadas.
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
            if (typeof sdkSession.getMessages !== 'function') {
                log(
                    'WARN',
                    '[AlwaysAlive] sdkSession.getMessages() não disponível nesta versão do SDK — histórico não sincronizado.',
                );
                return;
            }
            const messages = await sdkSession.getMessages();
            if (!Array.isArray(messages) || messages.length === 0) return;
            const { synced, skipped } = conversationStore.syncFromSdkHistory(hubSessionId, session.sessionId, messages);
            if (synced > 0) {
                log(
                    'INFO',
                    `[AlwaysAlive] ${synced} turnos SDK sincronizados com o ConversationStore (${skipped} ignorados).`,
                );
                this.emit('session.history_synced', { hubSessionId, sessionId: session.sessionId, synced, skipped });
            }
        } catch (/** @type {any} */ err) {
            log('WARN', `[AlwaysAlive] syncSdkHistory falhou (não crítico): ${err.message}`);
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
        if (this.#status !== 'idle' || this.#queue.length === 0 || !this.#session) return;
        const session = this.#session;

        const task = this.#queue.shift();
        if (!task) return;

        this.#setStatus('processing');
        this.emit('task.started', { taskId: task.id });

        log('INFO', `[AlwaysAlive] Processando tarefa ${task.id}`);
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
     * Inicializa (ou reinicializa) a sessão SDK: carrega MCP tools, reconstrói o registry, bootstrap das tools, chama
     * `initOrResumeSession` e sincroniza o estado interno.
     *
     * Usado tanto no `start()` inicial quanto em cada tentativa de `#tryReconnect()`.
     *
     * @param {any} client - Cliente SDK já instanciado
     * @returns {Promise<{ session: any; isResumed: boolean }>}
     */
    async #initSession(client) {
        const mcpTools = await buildMcpTools();
        if (mcpTools.length > 0) {
            log('INFO', `[AlwaysAlive] ${mcpTools.length} MCP tools carregadas via bridge.`);
        }
        // Reinicia o registry para evitar duplicação de tools em reconexões consecutivas.
        this.#toolsRegistry = createRegistry();
        const tools = bootstrapTools(this.#toolsRegistry, this.#telemetry, mcpTools);
        log('INFO', `[AlwaysAlive] ${tools.length} tools registradas (registry + introspection).`);

        const { session, isResumed } = await initOrResumeSession(client, {
            model: this.#model,
            onPermissionRequest: this.#permissionHandler,
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
        setSessionRpc(session.rpc);
        return { session, isResumed };
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

        for (const unsub of this.#sessionEventUnsubscribers) unsub();
        this.#sessionEventUnsubscribers = [];

        // Aplica fallback de modelo para a nova sessão se previamente agendado por scheduleFallback().
        // Não aplicar aqui (na reconexão in-flight) para evitar consumo duplo de PR: a reconexão já gera 1 PR
        // inevitável; o fallback deve ser aplicado na próxima chamada a startDialogLoop().

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            // Backoff exponencial com jitter: delay = base * 2^(attempt-1) + random(0..base)
            const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * baseDelayMs;
            log('INFO', `[AlwaysAlive] Reconexão tentativa ${attempt}/${maxAttempts} em ${Math.round(delay)}ms...`);
            this.emit('status', `reconnecting:${attempt}/${maxAttempts}`);

            await new Promise((r) => setTimeout(r, delay));

            try {
                const { session, isResumed } = await this.#initSession(this.#client);
                log(
                    'INFO',
                    `[AlwaysAlive] Reconexão bem-sucedida na tentativa ${attempt}. SessionId: ${session.sessionId}`,
                );
                this.emit('ready', { sessionId: session.sessionId, isResumed, reconected: true });

                if (this.#dialogLoop.active) {
                    log(
                        'INFO',
                        '[AlwaysAlive] Reconexão com dialog loop ativo — emitindo dialog.stopped para restart automático.',
                    );
                    this.#dialogLoop.notifyReconnect();
                    this.emit('dialog.stopped', { reason: 'reconnect_restart', authorized: false });
                } else {
                    log(
                        'INFO',
                        '[AlwaysAlive] Reconexão com dialog loop inativo. Aguardando terminal/dialog.js retomar via ensureDialogLoop.',
                    );
                }
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
     * Handler chamado pelo SDK quando o modelo usa a ferramenta `ask_user`.
     *
     * Delega para o handler especializado conforme o modo ativo:
     * - Se dialog loop ativo: intercepta o protocolo READY/REPLY/STOPPED via DLM.
     * - Caso contrário: suspende a execução até `answerPendingQuestion()` ser chamado via API HTTP.
     *
     * @param {{ question: string; choices?: string[]; allowFreeform: boolean }} input
     * @returns {Promise<{ answer: string; wasFreeform: boolean }>}
     */
    async #handleUserInputRequest({ question, choices, allowFreeform }) {
        log('INFO', `[AlwaysAlive] Modelo tem pergunta: "${question.slice(0, 120)}"`);

        if (this.#dialogLoop.active) {
            return this.#handleDialogLoopInput({ question, allowFreeform });
        }
        return this.#handleInteractiveQuestion({ question, ...(choices !== undefined && { choices }), allowFreeform });
    }

    /**
     * Handler de protocolo no modo dialog loop.
     *
     * Propaga a classificação READY/REPLY/STOPPED ao DialogLoopManager e suspende a execução
     * aguardando `answerPendingQuestion()` — necessário para fechar o ciclo `ask_user` do SDK.
     *
     * @param {{ question: string; allowFreeform: boolean }} input
     * @returns {Promise<{ answer: string; wasFreeform: boolean }>}
     */
    #handleDialogLoopInput({ question, allowFreeform }) {
        // Classifica e emite eventos READY/REPLY/STOPPED via DLM — propaga para always-alive via listener
        this.#dialogLoop.handleProtocolInput({ question });
        // Sempre suspende via handleInteractiveQuestion para aguardar answerPendingQuestion()
        return this.#handleInteractiveQuestion({ question, allowFreeform });
    }

    /**
     * Handler para pergunta interativa normal (fora do dialog loop).
     *
     * Suspende a execução até que `answerPendingQuestion()` seja chamado via API HTTP.
     * Define `status='waiting_for_input'` e persiste a pergunta no estado para recovery após restart.
     *
     * @param {{ question: string; choices?: string[]; allowFreeform: boolean }} input
     * @returns {Promise<{ answer: string; wasFreeform: boolean }>}
     */
    #handleInteractiveQuestion({ question, choices, allowFreeform }) {
        this.#setStatus('waiting_for_input');
        writeStateAsync({ pendingQuestion: question }).catch((/** @type {any} */ e) =>
            log('WARN', `[AlwaysAlive] writeState pendingQuestion: ${e.message}`),
        );

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

        // Aciona fallback de modelo se a quota/rate_limit foi atingida e COPILOT_FALLBACK_MODEL está configurado.
        const isRateOrQuotaError = input.errorContext === 'rate_limit' || input.errorContext === 'quota';
        if (isRateOrQuotaError) {
            const fallbackModel = process.env.COPILOT_FALLBACK_MODEL;
            if (fallbackModel && fallbackModel !== this.#model) {
                log(
                    'WARN',
                    `[AlwaysAlive] rate_limit/quota detectado — próxima reconexão usará model fallback: ${fallbackModel}`,
                );
                this.#dialogLoop.scheduleFallback(fallbackModel);
            } else {
                log('WARN', '[AlwaysAlive] rate_limit/quota sem COPILOT_FALLBACK_MODEL configurado.');
            }
        }

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
     * Útil para debug, auditoria e introspecção do context window.
     * O resultado é cacheado por `#MESSAGES_CACHE_TTL` ms para reduzir chamadas repetidas ao SDK.
     * Retorna array vazio se não houver sessão ativa ou se `getMessages()` lance (sem suporte no SDK).
     *
     * @returns {Promise<any[]>}
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
}

/**
 * Instância singleton do Always-Alive Agent para este processo.
 *
 * @type {AlwaysAliveAgent}
 */
export const alwaysAliveAgent = new AlwaysAliveAgent();
