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
import { defaultMetrics } from '#copilot/observability';
import { log } from '#copilot/observability/logger';
import EventEmitter from 'node:events';

// DialogProtocol agora é usado apenas pelo DialogLoopManager — removido daqui (E.1)
import { AGENT_EVENTS } from '#copilot/core/events';
import { MAX_LISTENERS, STATUS_SNAPSHOT_TTL_MS } from './config.js';
import {
    ensureDialogLoopAttached as dialogEnsureAttached,
    dialogResume,
    dialogStart,
    dialogStop,
} from './dialog/agent-dialog-controller.js';
import { buildStatusSnapshot } from './infra/status-snapshot.js';
import { executeTask } from './infra/task-executor.js';
import { persistState, readState } from './lifecycle/state-io.js';
// G2-ARCH-03: import estático em vez de dinâmico (hook-tools não cria circular dependency)
import { resolveUserInput as hookToolsResolveUserInput } from '../tools/hook-tools.js';
// F35: AgentContext — contexto compartilhado entre módulos internos
import { AgentContext } from './agent-context.js';
// F36: Lifecycle — start, stop, initSession, tryReconnect
import { agentStart, agentStop, agentTryReconnect } from './lifecycle/agent-lifecycle.js';

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
    /**
     * F35: AgentContext — contexto compartilhado com todos os módulos internos.
     *
     * @type {AgentContext}
     */
    ctx;

    /**
     * @param {{ model?: string; reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' }} [options]
     */
    constructor(options = {}) {
        super();
        // Agentes de alta carga acumulam múltiplos listeners por tarefa + SSE + bridge.
        // O padrão de 10 é insuficiente; configurável via AGENT_MAX_LISTENERS (padrão 50).
        this.setMaxListeners(MAX_LISTENERS);
        this.ctx = new AgentContext(this, options);

        // F35: MessageQueue emite __processQueue como evento interno para disparar processamento.
        this.on('__processQueue', () => this.#processQueue());
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
        return this.ctx.permissions.getMode();
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
        this.ctx.permissions.setMode(mode, opts);
    }

    /**
     * Registra uma URL de webhook para notificações de sessão.
     *
     * @param {string} url - URL HTTP(S) que receberá POST com payload de evento
     * @returns {{ id: string; url: string }} Identificador do webhook registrado
     */
    registerWebhook(url) {
        return this.ctx.webhooks.register(url);
    }

    /**
     * Remove um webhook previamente registrado.
     *
     * @param {string} id - ID do webhook a remover
     * @returns {boolean} true se removido, false se não encontrado
     */
    unregisterWebhook(id) {
        return this.ctx.webhooks.unregister(id);
    }

    /**
     * Lista todos os webhooks registrados.
     *
     * @returns {{ id: string; url: string }[]}
     */
    listWebhooks() {
        return this.ctx.webhooks.list();
    }

    /**
     * Retorna o status atual do agente.
     *
     * @returns {AgentStatus}
     */
    get status() {
        return this.ctx.status;
    }

    /**
     * Indica se o modo de diálogo contínuo está ativo (startDialogLoop foi chamado e ainda não foi parado).
     *
     * @returns {boolean}
     */
    get dialogLoopActive() {
        return this.ctx.dialogLoop.active;
    }

    /**
     * F45: Retorna o HandoffManager para uso em rotas HTTP e terminal.
     *
     * @returns {import('./infra/handoff-manager.js').HandoffManager}
     */
    getHandoffManager() {
        return this.ctx.handoff;
    }

    /**
     * Retorna o número atual de tarefas enfileiradas aguardando processamento.
     *
     * @returns {number}
     */
    get queueSize() {
        return this.ctx.messageQueue.size;
    }

    /**
     * Retorna a pergunta pendente (se houver).
     *
     * @returns {PendingQuestion | null}
     */
    get pendingQuestion() {
        return this.ctx.pendingQuestion;
    }

    /**
     * Retorna o sessionId da sessão ativa (ou null).
     *
     * @returns {string | null}
     */
    get sessionId() {
        return this.ctx.session?.sessionId ?? readState()?.sessionId ?? null;
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
        return this.ctx.toolsRegistry;
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
        if (!this.ctx.session || typeof this.ctx.session.abort !== 'function') {
            log('DEBUG', '[AlwaysAlive] abortCurrentMessage(): sem sessão ativa ou abort indisponível.');
            return;
        }
        try {
            await this.ctx.session.abort();
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
        this.ctx.dialogLoop.pingWatchdog();
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
        if (!this.ctx.session || typeof this.ctx.session.log !== 'function') return;
        try {
            await this.ctx.session.log(message, options);
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
        await agentStart(this.ctx, this);
    }

    /**
     * Para o agente graciosamente.
     *
     * @param {{ shutdownTimeoutMs?: number }} [opts]
     * @returns {Promise<void>}
     */
    async stop(opts) {
        await agentStop(this.ctx, this, opts);
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
            if (this.ctx.dialogLoop.active) {
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
        if (!this.ctx.session) {
            throw new SessionError('[AlwaysAlive] steerMessage() requer sessão ativa.', 'NO_SESSION');
        }
        const messageId = await this.ctx.session.send({ prompt, mode: 'immediate' });
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
            this.ctx.messageQueue.enqueue(task, ...(signal ? [{ signal }] : []));
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
        if (!this.ctx.pendingQuestion) {
            // ARCH-N01 (fix): mesmo sem pendingQuestion nativo, pode haver Promise de hook-tools.
            // G2-ARCH-03: resolveUserInput agora é import estático (sem circular dependency).
            if (!hookToolsResolveUserInput(answer)) {
                log('WARN', '[AlwaysAlive] answerPendingQuestion() chamado sem pergunta pendente.');
            }
            return false;
        }
        log('INFO', `[AlwaysAlive] Respondendo pergunta pendente: "${answer.slice(0, 80)}..."`);
        this.ctx.pendingQuestion.resolve(answer);
        this.ctx.pendingQuestion = null;
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
        return this.ctx.model;
    }

    /**
     * Troca o modelo em uso. A mudança é efetiva no próximo `sendMessage()`.
     *
     * @param {string} modelId - ID do modelo (ex. `'gpt-4.1'`, `'claude-sonnet-4-5'`)
     * @returns {void}
     */
    setModel(modelId) {
        this.ctx.model = modelId;
        // G2-BUG-10: setModel() é uma API não documentada do SDK (não consta nos types oficiais).
        // O cast `any` é deliberado e a chamada é protegida por typeof para evitar crash em versões
        // do SDK que não suportem a troca de modelo em runtime.
        const sdkSession = /** @type {{ setModel?: (id: string) => void }} */ (this.ctx.session);
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
        return this.ctx.reasoningEffort;
    }

    /**
     * Troca o nível de raciocínio. A mudança é efetiva no próximo `sendMessage()`.
     *
     * @param {'low' | 'medium' | 'high' | 'xhigh' | undefined} effort - Nível de raciocínio
     * @returns {void}
     */
    setReasoningEffort(effort) {
        this.ctx.reasoningEffort = effort;
    }

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
        if (this.ctx.statusSnapshotCache) {
            const age = Date.now() - this.ctx.statusSnapshotCache.at;
            if (age < STATUS_SNAPSHOT_TTL_MS) {
                return this.ctx.statusSnapshotCache.snapshot;
            }
            // TTL expirado — forçar rebuild como safety net
            this.ctx.statusSnapshotCache = null;
        }
        const state = readState();
        const snapshot = buildStatusSnapshot({
            status: this.ctx.status,
            sessionId: this.sessionId,
            model: this.ctx.model,
            reasoningEffort: this.ctx.reasoningEffort,
            queueSize: this.ctx.messageQueue.size,
            queueOldest: this.ctx.messageQueue.oldest,
            pendingQuestion: this.ctx.pendingQuestion,
            isResumed: this.ctx.isResumed,
            resumeCount: state?.resumeCount ?? 0,
            sendCount: this.ctx.sendCount,
            startedAt: state?.startedAt ?? null,
            contextWindow: this.ctx.contextState,
            lastCheckpointPath: this.ctx.lastCheckpointPath,
            permissionMode: this.ctx.permissions.getMode(),
        });
        this.ctx.statusSnapshotCache = { snapshot, at: Date.now() };
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
        await dialogStart(this.ctx, this, bootPrompt);
    }

    /**
     * Envia um turno de diálogo. Delega ao DialogLoopManager.
     *
     * @param {string} message
     * @param {{ timeout?: number; signal?: AbortSignal }} [opts]
     * @returns {Promise<string>}
     */
    sendDialogTurn(message, opts) {
        return this.ctx.dialogLoop.sendTurn(message, opts);
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
        await dialogStop(this.ctx, this, opts);
    }

    /**
     * Pausa o dialog loop. Delega ao DialogLoopManager.
     *
     * @returns {Promise<void>}
     */
    async pauseDialogLoop() {
        await this.ctx.dialogLoop.pause(this.sessionId);
    }

    /**
     * Retoma o dialog loop. Delega ao DialogLoopManager.
     *
     * @returns {Promise<void>}
     */
    async resumeDialogLoop() {
        await dialogResume(this.ctx);
    }

    /**
     * Indica se o dialog loop está atualmente pausado.
     *
     * @returns {boolean}
     */
    get dialogPaused() {
        return this.ctx.dialogLoop.paused;
    }

    /**
     * F41: Métricas de consumo de premium requests do dialog loop.
     *
     * @returns {{ boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null}
     */
    get dialogPrMetrics() {
        return this.ctx.dialogLoop.prMetrics ?? null;
    }

    /**
     * Último snapshot de billing do PR consumido. Atualizado quando `assistant.usage` é emitido pelo SDK.
     *
     * @returns {{ model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null}
     */
    get lastPrInfo() {
        // Retorna cópia rasa para evitar mutação externa do estado interno.
        return this.ctx.lastPrInfo ? { ...this.ctx.lastPrInfo } : null;
    }

    // ─────────────── Privados ───────────────

    /**
     * E.1: Garante que o DialogLoopManager está vinculado ao host com a interface AgentHost.
     *
     * G1-BUG-01 (fix): `attach()` é sempre chamado para atualizar host/telemetry (podem mudar após reconexão). O wiring
     * de eventos (listeners) só ocorre uma vez — guard `#dialogLoopAttached` protege apenas essa parte.
     */
    ensureDialogLoopAttached() {
        dialogEnsureAttached(this.ctx, this);
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
    /**
     * @param {AgentStatus} status
     */
    #setStatus(status) {
        this.ctx.status = status;
        this.ctx.statusSnapshotCache = null;
        this.emit('status', status);
    }

    /**
     * Processa a próxima tarefa da fila (se idle e sessão ativa).
     *
     * @returns {void}
     */
    #processQueue() {
        // G1-ARCH-03: bloqueia processamento durante reconexão ativa
        if (
            this.ctx.isReconnecting ||
            this.ctx.status !== 'idle' ||
            this.ctx.messageQueue.size === 0 ||
            !this.ctx.session
        )
            return;
        const session = this.ctx.session;

        const task = this.ctx.messageQueue.shift();
        if (!task) return;

        this.#setStatus('processing');
        this.emit('task.started', { taskId: task.id });

        log('INFO', `[AlwaysAlive] Processando tarefa ${task.id}`);
        this.ctx.sendCount++;
        // F42.2: registrar atividade para reset do timer de idle do keepalive
        this.ctx.keepalive.ping();

        void executeTask(session, task, {
            onDelta: (chunk, taskId) => this.emit('task.delta', { taskId, chunk }),
            setStatus: (s) => this.#setStatus(s),
            emit: (event, payload) => this.emit(event, payload),
            tryReconnect: (e) => this.#tryReconnect(e),
            requeueTask: (t) => this.ctx.messageQueue.unshift(t),
            scheduleNext: () => this.#processQueue(),
        });
    }

    /**
     * F36: Tenta reconectar à sessão SDK. Delegado para lifecycle/agent-lifecycle.js.
     *
     * @param {Error} originalError
     * @param {{ maxAttempts?: number; baseDelayMs?: number }} [opts]
     * @returns {Promise<boolean>}
     */
    async #tryReconnect(originalError, opts = {}) {
        return agentTryReconnect(this.ctx, this, originalError, opts);
    }

    /**
     * Retorna o histórico de mensagens da sessão SDK ativa.
     *
     * @returns {Promise<unknown[]>}
     */
    async getSessionMessages() {
        return this.ctx.messagesCache.get(this.ctx.session);
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
