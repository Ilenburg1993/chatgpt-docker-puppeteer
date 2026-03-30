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
import {
    createRegistry,
    createTelemetry,
    recordSessionEnd,
    recordSessionStart,
    recordToolCall,
    startSpan,
} from '#copilot/lib/index';
import { createAuditOnlyPermission, createPermissionHandler } from '#copilot/lib/permissions';
import { log } from '#core/logger';
import { CopilotClient, approveAll } from '@github/copilot-sdk';
import EventEmitter from 'node:events';
import { buildMcpTools } from '../bridges/mcp-tool-bridge.js';
import { buildMcpConfig } from '../config/mcp-servers.js';
import { conversationStore } from '../conversation-hub/store.js';
import { getHubSessionId } from '../terminal/state.js';
import { DialogProtocol } from './dialog-protocol.js';
import { DialogWatchdog } from './dialog-watchdog.js';
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
 * IMPROVE-AA-01: Constantes do protocolo importadas de dialog-protocol.js (RF-D01). Centralizadas lá para testabilidade
 * isolada; re-exportadas implicitamente pelo import acima.
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

    /**
     * BUG-AA-04 (fix): contador de profundidade da fila do dialog turn mutex. Permite resetar a Promise-chain quando a
     * fila zera, prevenindo crescimento indefinido.
     *
     * @type {number}
     */
    #dialogTurnQueueDepth = 0;

    /**
     * BUG-AA-02 (fix): sinaliza que stopDialogLoop está em execução. Evita race condition entre stopDialogLoop e
     * #handleUserInputRequest.
     *
     * @type {boolean}
     */
    #dialogLoopStopping = false;

    /**
     * BUG-AA-03 (fix): armazena as funções de unsubscribe retornadas por session.on(). O SDK não é um EventEmitter —
     * session.on() retorna () => void, não this. Essas referências são chamadas no stop() / #tryReconnect() para evitar
     * memory leak.
     *
     * @type {(() => void)[]}
     */
    #sessionEventUnsubscribers = [];

    /**
     * MR-02 (fix): tamanho máximo da fila de turnos do dialog loop (backpressure). Configurável via
     * LLM_B_DIALOG_QUEUE_MAX.
     *
     * @type {number}
     */
    static #MAX_DIALOG_TURN_QUEUE_SIZE = Number(process.env.LLM_B_DIALOG_QUEUE_MAX ?? 10);

    /**
     * IMPROVE-AA-02: timeout para aguardar `dialog.ready` durante startDialogLoop(). Controlado por
     * `LLM_B_BOOT_TIMEOUT_MS`. Padrão: 30 segundos.
     *
     * @type {number}
     */
    static #DIALOG_BOOT_TIMEOUT_MS = Number(process.env.LLM_B_BOOT_TIMEOUT_MS ?? 30_000);

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
     * RF-PR-04: último dados de billing PR (model, cost, quotaSnapshots, ts). Atualizado pelo listener assistant.usage
     * em start().
     *
     * @type {{ model?: string; cost?: number; quotaSnapshots?: any; ts: number } | null}
     */
    #lastPrInfo = null;

    /**
     * RF-PR-05: Se true, a próxima reconexão tentará com o modelo alternativo `COPILOT_FALLBACK_MODEL`.
     *
     * @type {boolean}
     */
    #pendingModelFallback = false;

    /**
     * RF-PR-05: Modelo original antes de aplicar o fallback (para restaurar se necessário).
     *
     * @type {string | null}
     */
    #originalModel = null;

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
     * UPG-PROP-04 (fix): cache de mensagens da sessão SDK para reduzir latência em chamadas repetidas. Invalida
     * automaticamente após TTL ou troca de sessão.
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
     * AC.3 — Último caminho de checkpoint salvo pelo SDK durante compaction. null até a primeira compaction concluída.
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
     * DL-PERM: o dialog loop não é uma tool e não passa por este handler. Não é possível bloquear o encerramento do
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

            // Inicializa telemetria para esta sessão (registry e MCP tools são criados dentro de #initSession)
            this.#telemetry = createTelemetry();

            // AI.3: span OTEL para metrificar duração do boot de sessão
            const { session, isResumed } = await startSpan('session.boot', { model: this.#model }, () =>
                this.#initSession(client),
            );

            // Wiring de eventos de compaction para observabilidade via SSE/NERV
            // BUG-AA-03 (fix): session.on() retorna () => void (não this) — armazenar para cleanup no stop/reconnect.
            this.#sessionEventUnsubscribers = [];
            this.#sessionEventUnsubscribers.push(
                session.on('session.compaction_start', (/** @type {any} */ evt) => {
                    log('INFO', '[AlwaysAlive] Compaction iniciada (sessão infinita).');
                    this.emit('session.compaction_start', evt?.data ?? {});
                }),
            );
            this.#sessionEventUnsubscribers.push(
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
                    // UPG-N15 (fix): emitir evento canônico 'context:compacted' para observabilidade externa
                    const snap = this.getStatusSnapshot();
                    this.emit('context:compacted', {
                        sessionId: snap?.sessionId ?? null,
                        ts: Date.now(),
                        checkpoint: data.checkpointPath ?? null,
                    });
                }),
            );

            // Reasoning tokens (o3/o4-mini extended thinking) — forwarded via task.reasoning
            this.#sessionEventUnsubscribers.push(
                session.on('assistant.reasoning_delta', (/** @type {any} */ evt) => {
                    const chunk = evt?.data?.deltaContent ?? '';
                    if (chunk) this.emit('task.reasoning', { chunk, reasoningId: evt?.data?.reasoningId ?? null });
                }),
            );

            // BUG-HIGH-03 (fix): streaming de delta também no modo dialog loop
            // Emitir task.delta para cada chunk de resposta do assistente, independente do modo de execução
            this.#sessionEventUnsubscribers.push(
                session.on('assistant.message_delta', (/** @type {any} */ evt) => {
                    const chunk = evt?.data?.deltaContent ?? evt?.data?.content ?? '';
                    if (chunk) this.emit('task.delta', { taskId: null, chunk });
                }),
            );

            // Uso de tokens e contexto da sessão — forwarded via session.usage
            // MELHORIA-02: emite session.token_budget_warning quando uso > 80%
            // MELHORIA-05: na 1ª leitura após retomada, alerta se uso já > 70% (contexto pesado)
            // AA.1: armazena em #contextState para exposição via getStatusSnapshot() e /context
            let _firstUsageChecked = false;
            this.#sessionEventUnsubscribers.push(
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
                }),
            );

            // Mudança de modo (plan ↔ act ↔ interactive) — forwarded via session.mode_changed
            this.#sessionEventUnsubscribers.push(
                session.on('session.mode_changed', (/** @type {any} */ evt) => {
                    log('INFO', `[AlwaysAlive] Modo mudou: ${evt?.data?.previousMode} → ${evt?.data?.newMode}`);
                    this.emit('session.mode_changed', evt?.data ?? {});
                }),
            );

            // BUG-AA-11 (fix): substituir session.onEvent() (privado/não-documentado) por session.on(handler)
            // que é a API pública do SDK 0.2.0. Retorna () => void → armazenar para cleanup.
            this.#sessionEventUnsubscribers.push(
                session.on((/** @type {any} */ evt) => {
                    const kind = evt?.kind ?? evt?.type ?? 'unknown';

                    // RF-PR-03: detectar assistant.usage para billing real-time
                    if (kind === 'assistant.usage') {
                        const data = evt?.data ?? {};
                        const { model, cost, quotaSnapshots } = data;
                        log('INFO', `[AlwaysAlive] PR consumido: model=${model ?? '?'}, cost=${cost ?? '?'}`);
                        // RF-PR-04: persistir em memória para GET /quota
                        this.#lastPrInfo = { model, cost, quotaSnapshots, ts: Date.now() };
                        this.emit('pr.consumed', { model, cost, quotaSnapshots, ts: Date.now() });
                        // RF-PR-02: marcar que o PR foi consumido para o turno pendente
                        // RF-PR-04: persistir dados de quota para o endpoint GET /quota
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
                    if (!knownEvents.has(kind)) {
                        log('DEBUG', `[AlwaysAlive] Evento SDK não tratado: kind=${kind}`);
                    }
                }),
            );

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
        // SYNC-SM-01 (fix): usar writeStateAsync para não bloquear o event loop durante shutdown
        await writeStateAsync({ sendCount: this.#sendCount }).catch((/** @type {any} */ e) =>
            log('WARN', `[AlwaysAlive] writeState sendCount falhou: ${e.message}`),
        );

        this.#setStatus('stopped');

        // Rejeita todas as tarefas pendentes na fila
        const remainingTasks = this.#queue.splice(0);
        // BUG-MED-03 (fix): invalidar cache após splice para garantir queueSize=0 no próximo snapshot
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

        // BUG-AA-03 (fix): cancelar todos os listeners session.on() antes de desconectar
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
            // GAP-AA-01 (fix): bloquear sendMessage() externo enquanto dialog loop estiver ativo.
            // startDialogLoop() chama sendMessage() antes de setar dialogLoopActive=true, portanto
            // o guard usa a heurística de timeoutMs==24h para distinguir a chamada interna.
            if (this.#dialogLoopActive && timeoutMs !== 24 * 60 * 60 * 1000) {
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
            // PERM-01: modo de aprovação ativo
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
        // MR-08: persistir dialogLoopActive em disco para diagnóstico após PM2 crash/restart
        writeStateAsync({ dialogLoopActive: true }).catch((/** @type {any} */ e) =>
            log('WARN', `[AlwaysAlive] writeState dialogLoopActive=true: ${e.message}`),
        );

        // RF-D04: boot prompt centralizado em DialogProtocol.buildBootPrompt() para DRY entre always-alive.js e dialog.js
        const metaPrompt = bootPrompt ?? DialogProtocol.buildBootPrompt();

        // Boot: 1 PR — resolve quando o modelo emite o primeiro ask_user("READY:"), com timeout (IMPROVE-AA-02)
        const bootPromise = new Promise((resolve, reject) => {
            const bootTimeout = setTimeout(() => {
                this.off('dialog.ready', onBootReady);
                reject(
                    new SessionError(
                        `[AlwaysAlive] startDialogLoop boot timeout após ${AlwaysAliveAgent.#DIALOG_BOOT_TIMEOUT_MS}ms`,
                        'BOOT_TIMEOUT',
                    ),
                );
            }, AlwaysAliveAgent.#DIALOG_BOOT_TIMEOUT_MS);
            /** @type {() => void} */
            const onBootReady = () => {
                clearTimeout(bootTimeout);
                resolve(undefined);
            };
            this.once('dialog.ready', onBootReady);
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

        // MR-02 (fix): backpressure — rejeitar se a fila já atingiu o máximo
        if (this.#dialogTurnQueueDepth >= AlwaysAliveAgent.#MAX_DIALOG_TURN_QUEUE_SIZE) {
            return Promise.reject(
                new SessionError(
                    `[AlwaysAlive] Fila de diálogo cheia (${this.#dialogTurnQueueDepth}/${AlwaysAliveAgent.#MAX_DIALOG_TURN_QUEUE_SIZE} turnos pendentes).`,
                    'DIALOG_QUEUE_FULL',
                ),
            );
        }

        // DL-PERM-04: registrar atividade no watchdog logo ao enviar o turno —
        // assim o watchdog não dispara stall durante processamentos longos do modelo.
        this.#watchdog?.ping();

        // Serializa via mutex: encadeia na cauda do turno atual
        this.#dialogTurnQueueDepth++;
        const prev = this.#dialogTurnMutex;
        /** @type {Promise<string>} */
        const next = prev.then(() =>
            this.#executeDialogTurn(message, { timeout, ...(signal !== undefined && { signal }) }),
        );
        // Atualiza a cauda — o .catch(() => {}) evita UnhandledRejection interna
        this.#dialogTurnMutex = next.then(() => {}).catch(() => {});
        // BUG-AA-04 (fix): resetar a cadeia do mutex quando a fila zerar, prevenindo crescimento
        // indefinido de Promise-chain em sessões de longa duração com milhares de turnos.
        void next.finally(() => {
            this.#dialogTurnQueueDepth--;
            if (this.#dialogTurnQueueDepth === 0) {
                this.#dialogTurnMutex = Promise.resolve();
            }
        });
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
        // MR-03: emitir turn_start para observabilidade
        const turnStart = Date.now();
        this.emit('dialog.turn_start', { message: message.slice(0, 120), ts: turnStart });
        // RF-PR-02: persistir mensagem pendente antes de enviar (para retry após restart sem PR)
        writeStateAsync({
            pendingTurnMessage: message,
            pendingTurnTs: turnStart,
            pendingTurnConsumedPR: false,
        }).catch((/** @type {any} */ e) => log('WARN', `[AlwaysAlive] writeState pendingTurn: ${e.message}`));
        // AI.3: instrumentar com span OTEL
        return startSpan(
            'dialog.send_turn',
            // RF-D05: enriquecer span com turnNumber e modelo para detectar regressões de performance
            {
                sessionId: this.sessionId ?? '',
                actor: 'user',
                model: this.#model,
                extra: { turnNumber: this.#sendCount },
            },
            () =>
                new Promise((resolve, reject) => {
                    // BUG-AA-01 (fix): referência ao listener onPending — necessária para remoção no timeout.
                    // Sem isso, timeoutHandle pode disparar e deixar onPending orfão nos ouvintes do EventEmitter.
                    /** @type {((arg: unknown) => void) | null} */
                    let pendingListener = null;

                    const timeoutHandle = setTimeout(() => {
                        // BUG-AA-01 (fix): remover listener orfão antes de rejeitar
                        if (pendingListener) {
                            this.off('question.pending', pendingListener);
                            pendingListener = null;
                        }
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
                        // MR-03: emitir turn_end com latência para observabilidade
                        const durationMs = Date.now() - turnStart;
                        this.emit('dialog.turn_end', { reply: evt.reply.slice(0, 120), durationMs });
                        // MR-04: registrar latência no store de telemetria para detectar regressões de performance
                        recordToolCall(this.#telemetry, 'dialog.turn', {
                            durationMs,
                            success: true,
                            sessionId: this.sessionId ?? undefined,
                        });
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
                            this.#waitForDialogRestartAndReply(message, timeout, stopEvt?.reason)
                                .then(resolve)
                                .catch(reject);
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
                            pendingListener = null; // BUG-AA-01: foi disparado, não é mais orfão
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
                                    this.#waitForDialogRestartAndReply(message, timeout, stopEvt2?.reason)
                                        .then(resolve)
                                        .catch(reject);
                                }
                            };
                            this.once('dialog.reply', onReply);
                            this.once('dialog.stopped', onStop);
                            this.answerPendingQuestion(message);
                        };
                        // BUG-AA-01 (fix): guardar referência para remoção caso o timeout dispare antes
                        pendingListener = onPending;
                        this.once('question.pending', onPending);
                        // BUG-AA-05 (fix): #pendingQuestion pode ter sido preenchido entre a verificação
                        // inicial (this.#pendingQuestion === null) e o registro do once — checar novamente.
                        if (this.#pendingQuestion) {
                            this.off('question.pending', onPending);
                            pendingListener = null;
                            onPending(undefined);
                        }
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
        // BUG-AA-02 (fix): evitar double-stop se stopDialogLoop() for chamado concorrentemente
        if (this.#dialogLoopStopping) return;
        this.#dialogLoopStopping = true;
        if (this.#pendingQuestion) {
            this.answerPendingQuestion('STOP_DIALOG');
        }
        this.#dialogLoopActive = false;
        this.#dialogLoopStopping = false;
        // MR-08: persistir dialogLoopActive=false em disco para diagnóstico após PM2 crash/restart
        writeStateAsync({ dialogLoopActive: false }).catch((/** @type {any} */ e) =>
            log('WARN', `[AlwaysAlive] writeState dialogLoopActive=false: ${e.message}`),
        );
        this.#watchdog?.stop();
        this.emit('dialog.stopped', { reason, authorized: true });
    }

    /**
     * NEW-PAUSE-02: Pausa o dialog loop sem desconectar a sessão nem encerrar o agentic turn.
     *
     * O modelo permanece aguardando em `ask_user` enquanto a sessão CLI estiver ativa. O estado é serializado em disco
     * para que um restart posterior possa retomar sem novo PR (zero-cost resume).
     *
     * Diferença de `stopDialogLoop()`:
     *
     * - `stopDialogLoop()` envia `STOP_DIALOG` ao modelo — encerra o agentic turn, 0 PR novo mas loop precisa reiniciar
     * - `pauseDialogLoop()` **não** envia nada — preserva o estado `ask_user` no servidor CLI
     *
     * @returns {Promise<void>}
     */
    async pauseDialogLoop() {
        if (!this.#dialogLoopActive) {
            log('WARN', '[AlwaysAlive] pauseDialogLoop() chamado com loop inativo — ignorado.');
            return;
        }
        const sid = this.sessionId;
        // NEW-PAUSE-01: persistir estado pausado
        await writeStateAsync({ dialogPaused: true, pausedAt: Date.now(), dialogLoopActive: true }).catch(
            (/** @type {any} */ e) => log('WARN', `[AlwaysAlive] writeState dialogPaused: ${e.message}`),
        );
        log('INFO', `[AlwaysAlive] Dialog loop pausado. SessionId: ${sid}. Reinicie e use resumeDialogLoop().`);
        this.emit('dialog.paused', { sessionId: sid, pausedAt: Date.now() });
    }

    /**
     * NEW-PAUSE-03: Retoma o dialog loop após um `pauseDialogLoop()`.
     *
     * Estratégia híbrida (zero-PR quando possível):
     *
     * - **Estratégia A** (0 PR): aguarda `question.pending` por 5 segundos — se o servidor CLI preservou o estado
     *   `ask_user`, o modelo responde imediatamente sem novo envio.
     * - **Estratégia B** (1 PR): se nenhum `ask_user` chegar, reenvia o boot prompt para reinicializar o loop.
     *
     * @returns {Promise<void>}
     * @throws {Error} Se o agente não estiver no estado 'idle'
     */
    async resumeDialogLoop() {
        const state = readState();
        if (!state?.dialogPaused) {
            log('WARN', '[AlwaysAlive] resumeDialogLoop() chamado sem dialogPaused=true — ignorado.');
            return;
        }
        if (this.#status !== 'idle' && this.#status !== 'waiting_for_input') {
            throw new SessionError(
                `[AlwaysAlive] resumeDialogLoop() requer status 'idle' ou 'waiting_for_input'. Status atual: '${this.#status}'`,
                'INVALID_STATE',
            );
        }

        // Limpa o estado de pause imediatamente para evitar loops duplos
        await writeStateAsync({ dialogPaused: false }).catch((/** @type {any} */ e) =>
            log('WARN', `[AlwaysAlive] writeState dialogPaused=false: ${e.message}`),
        );

        // Estratégia A: aguardar ask_user preservado no servidor CLI (0 PR)
        const preserved = await Promise.race([
            new Promise((resolve) => this.once('question.pending', () => resolve(true))),
            new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
        ]);

        if (preserved) {
            log('INFO', '[AlwaysAlive] resumeDialogLoop: ask_user preservado no CLI — retomada zero-PR.');
            this.emit('dialog.resumed', { prConsumed: false });
            return;
        }

        // Estratégia B: reenviar boot prompt (1 PR de retomada)
        log('INFO', '[AlwaysAlive] resumeDialogLoop: ask_user não encontrado — reenviando boot prompt (1 PR).');
        this.#dialogLoopActive = false; // reset para que startDialogLoop() aceite
        await writeStateAsync({ dialogLoopActive: false }).catch(() => {});

        await this.startDialogLoop();
        this.emit('dialog.resumed', { prConsumed: true });
    }

    /**
     * Indica se o dialog loop está atualmente pausado via `pauseDialogLoop()`.
     *
     * @returns {boolean}
     */
    get dialogPaused() {
        return readState()?.dialogPaused ?? false;
    }

    /**
     * RF-PR-04: Retorna os últimos dados de billing do PR consumido. Atualizado quando `assistant.usage` é emitido pelo
     * SDK.
     *
     * @returns {{ model?: string; cost?: number; quotaSnapshots?: any; ts: number } | null}
     */
    get lastPrInfo() {
        return this.#lastPrInfo;
    }

    // ─────────────── Privados ───────────────

    /**
     * DL-PERM-05 — Aguarda `dialog.ready` (após um restart automático não-autorizado) e reenvia `message` uma vez.
     *
     * Encapsula o padrão repetido em `#executeDialogTurn`: timeout de restart + onRetryReady + send + reply.
     *
     * @param {string} message - Mensagem original a reenviar após o restart
     * @param {number} timeout - Timeout em ms para aguardar `dialog.ready`
     * @param {string} [stopReason] - `reason` do evento `dialog.stopped` (para o log de erro de timeout)
     * @returns {Promise<string>} reply recebida após o reenvio
     */
    #waitForDialogRestartAndReply(message, timeout, stopReason) {
        return new Promise((resolve, reject) => {
            const retryTimeout = setTimeout(() => {
                this.off('dialog.ready', onRetryReady);
                reject(
                    new SessionError(
                        `[AlwaysAlive] sendDialogTurn: timeout aguardando restart após dialog.stopped (${stopReason ?? 'unknown'})`,
                        'DIALOG_RESTART_TIMEOUT',
                    ),
                );
            }, timeout);
            const onRetryReady = () => {
                clearTimeout(retryTimeout);
                const sendAndListen = () => {
                    this.answerPendingQuestion(message);
                    // BUG-AA-06 (fix): guardar listener de dialog.stopped secundário para rejeitar se o loop
                    // reiniciado parar novamente antes de emitir dialog.reply
                    const onRetryStopped = (/** @type {{ reason?: string }} */ stoppedEvt) => {
                        this.off('dialog.reply', onRetryReply);
                        reject(
                            new SessionError(
                                `[AlwaysAlive] sendDialogTurn: dialog.stopped durante retry (${stoppedEvt?.reason ?? 'unknown'})`,
                                'DIALOG_STOPPED_DURING_RETRY',
                            ),
                        );
                    };
                    /** @type {(evt: { reply: string }) => void} */
                    const onRetryReply = (retryEvt) => {
                        this.off('dialog.stopped', onRetryStopped);
                        resolve(retryEvt.reply);
                    };
                    this.once('dialog.reply', onRetryReply);
                    this.once('dialog.stopped', onRetryStopped);
                };
                if (this.#pendingQuestion) {
                    sendAndListen();
                } else {
                    this.once('question.pending', sendAndListen);
                }
            };
            this.once('dialog.ready', onRetryReady);
        });
    }

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
            // GAP-SDK-02 (fix): logar WARN para diagnóstico de incompatibilidade de versão do SDK
            if (typeof sdkSession.getMessages !== 'function') {
                log(
                    'WARN',
                    '[AlwaysAlive] AI.4: sdkSession.getMessages() não disponível nesta versão do SDK — histórico não sincronizado.',
                );
                return;
            }
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
        // BUG-C03 (fix): resetar registry antes de bootstrapTools para evitar duplicação de tools
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

        // BUG-AA-03 (fix): cancelar listeners da sessão anterior antes de reconectar
        for (const unsub of this.#sessionEventUnsubscribers) unsub();
        this.#sessionEventUnsubscribers = [];

        // RF-PR-05: se há sinal de rate_limit/quota, aplicar fallback de modelo antes de reconectar
        if (this.#pendingModelFallback) {
            const fallbackModel = process.env.COPILOT_FALLBACK_MODEL;
            if (fallbackModel && fallbackModel !== this.#model) {
                log('WARN', `[AlwaysAlive] RF-PR-05: aplicando model fallback: ${this.#model} → ${fallbackModel}`);
                this.#model = fallbackModel;
                this.emit('pr.fallback_model', { previousModel: this.#originalModel, fallbackModel, ts: Date.now() });
            }
            this.#pendingModelFallback = false;
        }

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

                // BUG-HIGH-04 (fix): se dialog loop estava ativo, emitir dialog.stopped autorizado=false
                // para que sendDialogTurn (DL-PERM-05) detecte o restart e reenvie a mensagem pendente
                if (this.#dialogLoopActive) {
                    log(
                        'INFO',
                        '[AlwaysAlive] Reconexão: dialog loop ativo, emitindo dialog.stopped para restart via DL-PERM-05.',
                    );
                    this.#dialogLoopActive = false;
                    this.emit('dialog.stopped', { reason: 'reconnect_restart', authorized: false });
                } else {
                    // BUG-AA-10 (fix): log explícito para diagnóstico quando loop estava idle entre turnos
                    log(
                        'INFO',
                        '[AlwaysAlive] Reconexão: dialog loop estava inativo. Aguardando terminal/dialog.js retomar via ensureDialogLoop...',
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
     * Handler chamado pelo SDK quando o modelo usa a ferramenta ask_user.
     *
     * RF-D03: delega para handler especializado conforme modo ativo.
     *
     * @param {{ question: string; choices?: string[]; allowFreeform: boolean }} input
     * @returns {Promise<{ answer: string; wasFreeform: boolean }>}
     */
    async #handleUserInputRequest({ question, choices, allowFreeform }) {
        log('INFO', `[AlwaysAlive] Modelo tem pergunta: "${question.slice(0, 120)}"`);

        if (this.#dialogLoopActive) {
            return this.#handleDialogLoopInput({ question, allowFreeform });
        }
        return this.#handleInteractiveQuestion({ question, ...(choices !== undefined && { choices }), allowFreeform });
    }

    /**
     * RF-D03: Handler de protocolo no modo dialog loop. Intercepta mensagens READY/REPLY/DONE/STOPPED e emite os
     * eventos correspondentes.
     *
     * @param {{ question: string; allowFreeform: boolean }} input
     * @returns {Promise<{ answer: string; wasFreeform: boolean }>}
     */
    #handleDialogLoopInput({ question, allowFreeform }) {
        // ── Interceptação do dialog loop ────────────────────────────────────
        // No modo diálogo, o modelo usa ask_user com prefixos especiais (RF-D01: DialogProtocol).
        const kind = DialogProtocol.classify(question);

        if (kind === 'ready') {
            // Modelo sinaliza prontidão — emite evento para sendDialogTurn()
            this.#watchdog?.ping();
            this.emit('dialog.ready', {});
            // Aguarda a resposta via question.pending normal
            // (sendDialogTurn chamará answerPendingQuestion com a mensagem do usuário)
        } else if (kind === 'reply') {
            // Modelo enviou uma resposta — extrai o conteúdo
            this.#watchdog?.ping();
            const reply = DialogProtocol.extractReply(question);
            this.emit('dialog.reply', { reply });
            // Aguarda o próximo turno via question.pending
        } else if (kind === 'stopped') {
            // DL-PERM: o modelo tentou encerrar o loop. Não encerramos imediatamente — emitimos o evento
            // 'dialog.stopped' para que o listener em terminal/index.js possa reiniciar automaticamente.
            // O #dialogLoopActive NÃO é setado para false aqui — o restart via ensureDialogLoop() irá
            // reativar o loop sem interrupção do protocolo ask_user.
            log('WARN', '[AlwaysAlive] Modelo emitiu STOPPED — emitindo dialog.stopped para restart automático.');
            this.emit('dialog.stopped', { reason: 'model_stopped', authorized: false });
        }
        // ── Fim da interceptação ─────────────────────────────────────────────
        return this.#handleInteractiveQuestion({ question, allowFreeform });
    }

    /**
     * RF-D03: Handler para pergunta interativa normal (fora do dialog loop). Suspende execução até que
     * answerPendingQuestion() seja chamado via API HTTP.
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

        // RF-PR-05: sinalizar fallback de modelo quando a quota/rate_limit for atingida
        const isRateOrQuotaError = input.errorContext === 'rate_limit' || input.errorContext === 'quota';
        if (isRateOrQuotaError) {
            const fallbackModel = process.env.COPILOT_FALLBACK_MODEL;
            if (fallbackModel && fallbackModel !== this.#model) {
                log(
                    'WARN',
                    `[AlwaysAlive] RF-PR-05: rate_limit/quota detectado — próxima reconexão usará model fallback: ${fallbackModel}`,
                );
                this.#pendingModelFallback = true;
                this.#originalModel = this.#model;
            } else {
                log('WARN', '[AlwaysAlive] RF-PR-05: rate_limit/quota mas nenhum COPILOT_FALLBACK_MODEL configurado.');
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
     * Útil para debug, auditoria e introspecção do context window. Retorna array vazio se não houver sessão ativa.
     * UPG-PROP-04 (fix): resultado em cache por até {@link AlwaysAliveAgent.#MESSAGES_CACHE_TTL} ms para reduzir
     * chamadas repetidas ao SDK em fluxos de introspection.
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
