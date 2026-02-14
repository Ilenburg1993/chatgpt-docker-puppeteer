// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';
import { ActionCode } from '#shared/nerv/constants';
import { getActionCode, getCorrelationId, getPayload, getTaskIdFromPayload } from '#shared/nerv/envelope_reader';
import EventEmitter from 'node:events';

/**
 * Estados unificados para visualização no dashboard.
 * Combina estados do disco (Queue) com estados do Kernel.
 */
const UnifiedStatus = Object.freeze({
    PENDING: 'PENDING', // Na fila, aguardando execução
    RUNNING: 'RUNNING', // Em execução pelo Kernel
    PAUSED: 'PAUSED', // Suspenso temporariamente
    DONE: 'DONE', // Concluído com sucesso
    FAILED: 'FAILED', // Falhou após retries
    CANCELLED: 'CANCELLED', // Cancelado pelo usuário
});

/** Debounce de broadcast para atualização de dashboard (ms). */
const BROADCAST_DEBOUNCE_MS = 50;

/**
 * @typedef {{
 *   status?: string,
 *   worker_id?: string|null,
 *   started_at?: number,
 *   updated_at?: number,
 *   progress_percent?: number,
 *   completed_at?: number,
 *   failed_at?: number,
 *   cancelled_at?: number,
 *   error?: string,
 *   reason_code?: string,
 *   retryable?: boolean,
 *   next_action?: string|null,
 *   queue_position?: number|null,
 *   queue_size?: number|null,
 *   active_drivers?: number|null,
 *   event_timestamp?: number,
 *   last_correlation_id?: string|null,
 *   [key: string]: unknown
 * }} KernelRuntimeState
 */

/**
 * TaskSyncBridge - Ponte de Sincronização de Tasks
 *
 * Unifica duas fontes de verdade:
 * 1. Queue Cache (disco): Tarefas persistidas em arquivos JSON
 * 2. Kernel Runtime (memória): Estado de execução em tempo real
 *
 * Arquitetura:
 * - Singleton pattern para acesso global
 * - Event-driven para updates em tempo real
 * - Cache local para performance
 */
class TaskSyncBridge extends EventEmitter {
    constructor() {
        super();

        /**
         * Cache de estado runtime do Kernel.
         * Map: taskId → { status, worker_id, started_at, progress, ... }
         */
        /** @type {Map<string, KernelRuntimeState>} */
        this.kernelStateCache = new Map();

        /**
         * Referência ao Socket.io Hub (injetada posteriormente)
         */
        this.socketHub = null;

        /**
         * Referência ao Queue Cache (lazy loaded)
         */
        this._queueCache = null;

        /**
         * Referência ao IO facade (lazy loaded) para persistência de estado unificado.
         */
        this._io = null;

        /**
         * Referência ao NERV client (lazy loaded)
         */
        this._nervClient = null;

        /**
         * Unsubscribers NERV (para cleanup/robustez em testes).
         * @type {Array<Function>}
         */
        this._nervUnsubscribers = [];

        /**
         * Flag de inicialização
         */
        this._initialized = false;

        /**
         * Debounce timer para broadcast
         */
        this._broadcastTimer = null;
        this._pendingBroadcasts = new Map();

        log('INFO', '[TaskSyncBridge] Instância criada');
    }

    /**
     * Inicializa o bridge com dependências.
     * Deve ser chamado após boot do sistema.
     *
     * @param {Object} [options]
     * @param {Object} [options.socketHub] - Socket.io Hub para notificações
     * @param {Object} [options.nervClient] - Cliente NERV para eventos
     * @param {boolean} [options.force=false] - Força reinicialização se já inicializado
     */
    initialize(options = {}) {
        const { socketHub, nervClient, force = false } = options;
        if (this._initialized) {
            if (!force) {
                log('WARN', '[TaskSyncBridge] Já inicializado, ignorando');
                return;
            }

            // Force re-init (useful for controlled test environments)
            try {
                this.clearAll();
            } catch (clearError) {
                log(
                    'WARN',
                    `[TaskSyncBridge] Falha em clearAll durante force initialize: ${clearError?.message || String(clearError)}`
                );
            }
            this._initialized = false;
        }

        this.socketHub = socketHub;
        this._nervClient = nervClient;

        // Setup event listeners se NERV disponível
        if (this._nervClient) {
            this._setupNervListeners();
        }

        this._initialized = true;
        log('INFO', '[TaskSyncBridge] Inicializado com sucesso');
    }

    /**
     * Getter lazy para Queue Cache.
     * Evita dependência circular no boot.
     */
    async getQueueCache() {
        if (!this._queueCache) {
            try {
                this._queueCache = await import('#infra/queue/cache');
            } catch (err) {
                log('WARN', `[TaskSyncBridge] Queue cache não disponível: ${err.message}`);
                return null;
            }
        }
        return this._queueCache;
    }

    /**
     * Getter lazy para IO facade.
     * Usado para persistir snapshots runtime no estado de task em disco.
     */
    async getIo() {
        if (!this._io) {
            try {
                this._io = await import('#infra/io');
            } catch (err) {
                log('WARN', `[TaskSyncBridge] IO facade não disponível: ${err.message}`);
                return null;
            }
        }
        return this._io;
    }

    /**
     * Extrai contexto normalizado de envelope NERV.
     * @param {Object} envelope
     * @returns {{payload: Record<string, unknown>, taskId: string|null, correlationId: string|null, eventTimestamp: number}}
     */
    _extractEnvelopeContext(envelope) {
        const payload = /** @type {Record<string, unknown>} */ (getPayload(envelope));
        const taskId = getTaskIdFromPayload(payload);
        const correlationId =
            getCorrelationId(envelope) ||
            (typeof payload.correlationId === 'string' ? payload.correlationId : null) ||
            (typeof payload.correlation_id === 'string' ? payload.correlation_id : null) ||
            null;
        const rawTimestamp = envelope?.protocol?.timestamp;
        const parsedTimestamp = Number(rawTimestamp);
        const eventTimestamp = Number.isFinite(parsedTimestamp) && parsedTimestamp > 0 ? parsedTimestamp : Date.now();

        return { payload, taskId, correlationId, eventTimestamp };
    }

    /**
     * Configura listeners para eventos NERV relevantes.
     * Atualiza cache local e notifica dashboards.
     */
    _setupNervListeners() {
        const nerv = this._nervClient;

        if (!nerv || typeof nerv.onReceive !== 'function') {
            log('WARN', '[TaskSyncBridge] NERV client inválido (onReceive ausente), realtime desativado');
            return;
        }

        const register = (actionCode, handler) => {
            const wrappedHandler = envelope => {
                try {
                    handler(envelope);
                } catch (handlerError) {
                    log(
                        'ERROR',
                        `[TaskSyncBridge] Handler NERV falhou para ${actionCode}: ${handlerError?.message || String(handlerError)}`
                    );
                }
            };

            // Prefer onEvent; fallback para onReceive.
            if (typeof nerv.onEvent === 'function') {
                try {
                    const unsub = nerv.onEvent(actionCode, wrappedHandler);
                    if (typeof unsub === 'function') {
                        this._nervUnsubscribers.push(unsub);
                    }
                    return;
                } catch (onEventError) {
                    log(
                        'DEBUG',
                        `[TaskSyncBridge] onEvent indisponível para ${actionCode}, usando onReceive fallback: ${onEventError?.message || String(onEventError)}`
                    );
                }
            }

            const unsub = nerv.onReceive(envelope => {
                const envelopeActionCode = getActionCode(envelope);

                if (envelopeActionCode !== actionCode) {
                    return;
                }
                wrappedHandler(envelope);
            });

            if (typeof unsub === 'function') {
                this._nervUnsubscribers.push(unsub);
            }
        };

        register(ActionCode.DRIVER_TASK_STARTED, envelope => {
            const { payload, taskId, correlationId, eventTimestamp } = this._extractEnvelopeContext(envelope);
            if (!taskId) return;

            void this._updateKernelState(taskId, {
                status: UnifiedStatus.RUNNING,
                started_at: Date.now(),
                worker_id: /** @type {string} */ (payload.worker_id || payload.workerId) || null,
                target: /** @type {string} */ (payload.target) || null,
                progress_percent: 0,
                last_correlation_id: correlationId,
                event_timestamp: eventTimestamp,
            });
        });

        register(ActionCode.DRIVER_TASK_COMPLETED, envelope => {
            const { payload, taskId, correlationId, eventTimestamp } = this._extractEnvelopeContext(envelope);
            if (!taskId) return;

            const result = payload.result;

            void this._updateKernelState(taskId, {
                status: UnifiedStatus.DONE,
                completed_at: Date.now(),
                result_preview:
                    typeof result === 'string'
                        ? result.substring(0, 500)
                        : result
                          ? JSON.stringify(result).substring(0, 500)
                          : null,
                timings: payload.timings || null,
                last_correlation_id: correlationId,
                event_timestamp: eventTimestamp,
            });
        });

        register(ActionCode.DRIVER_TASK_FAILED, envelope => {
            const { payload, taskId, correlationId, eventTimestamp } = this._extractEnvelopeContext(envelope);
            if (!taskId) return;

            const err = payload.error || payload.reason || payload.err || null;
            const errorText =
                typeof err === 'string'
                    ? err
                    : err &&
                        typeof err === 'object' &&
                        err !== null &&
                        typeof (/** @type {any} */ (err).message) === 'string'
                      ? /** @type {any} */ (err).message
                      : err
                        ? JSON.stringify(err)
                        : 'Unknown error';
            const reason = /** @type {string} */ (payload.reason) || 'UNKNOWN';
            const nextAction = /** @type {string} */ (payload.next_action) || null;
            const retryable = Boolean(payload.retryable);

            void this._updateKernelState(taskId, {
                status: UnifiedStatus.FAILED,
                failed_at: Date.now(),
                error: errorText.substring(0, 2000),
                reason_code: reason,
                retryable,
                next_action: nextAction,
                last_correlation_id: correlationId,
                event_timestamp: eventTimestamp,
            });
        });

        register(ActionCode.DRIVER_TASK_ABORTED, envelope => {
            const { payload, taskId, correlationId, eventTimestamp } = this._extractEnvelopeContext(envelope);
            if (!taskId) return;

            void this._updateKernelState(taskId, {
                status: UnifiedStatus.CANCELLED,
                cancelled_at: Date.now(),
                reason: payload.reason || payload.abortReason || 'USER_ABORT',
                last_correlation_id: correlationId,
                event_timestamp: eventTimestamp,
            });
        });

        // Kernel/Policy failures that can be surfaced as FAILED
        register(ActionCode.TASK_FAILED, envelope => {
            const { payload, taskId, correlationId, eventTimestamp } = this._extractEnvelopeContext(envelope);
            if (!taskId) return;

            const err = payload.error || payload.reason || payload.err || null;
            const errorText =
                typeof err === 'string'
                    ? err
                    : err &&
                        typeof err === 'object' &&
                        err !== null &&
                        typeof (/** @type {any} */ (err).message) === 'string'
                      ? /** @type {any} */ (err).message
                      : err
                        ? JSON.stringify(err)
                        : 'Task failed';
            const reason = /** @type {string} */ (payload.reason) || 'UNKNOWN';
            const nextAction = /** @type {string} */ (payload.next_action) || null;
            const retryable = Boolean(payload.retryable);

            void this._updateKernelState(taskId, {
                status: UnifiedStatus.FAILED,
                failed_at: Date.now(),
                error: errorText.substring(0, 2000),
                reason_code: reason,
                retryable,
                next_action: nextAction,
                last_correlation_id: correlationId,
                event_timestamp: eventTimestamp,
            });
        });

        register(ActionCode.DRIVER_TASK_QUEUED, envelope => {
            const { payload, taskId, correlationId, eventTimestamp } = this._extractEnvelopeContext(envelope);
            if (!taskId) return;

            void this._updateKernelState(taskId, {
                status: UnifiedStatus.PENDING,
                queued_at: Date.now(),
                queue_position: /** @type {number} */ (payload.queuePosition) || null,
                queue_size: /** @type {number} */ (payload.queueSize) || null,
                active_drivers: /** @type {number} */ (payload.activeDrivers) || null,
                next_action: /** @type {string} */ (payload.next_action) || 'RETRY_LATER',
                last_correlation_id: correlationId,
                event_timestamp: eventTimestamp,
            });
        });

        register(ActionCode.DRIVER_ERROR, envelope => {
            const { payload, taskId, correlationId, eventTimestamp } = this._extractEnvelopeContext(envelope);
            if (!taskId) return;

            const err = payload.error || payload.reason || payload.err || 'Driver error';
            const errorText = typeof err === 'string' ? err : JSON.stringify(err);

            void this._updateKernelState(taskId, {
                status: UnifiedStatus.FAILED,
                failed_at: Date.now(),
                error: errorText.substring(0, 2000),
                last_correlation_id: correlationId,
                event_timestamp: eventTimestamp,
            });
        });

        log('DEBUG', '[TaskSyncBridge] Listeners NERV configurados (ActionCode-based)');
    }

    /**
     * Atualiza o cache de estado do kernel e agenda broadcast.
     *
     * @param {string} taskId - ID da task
     * @param {KernelRuntimeState} stateUpdate - Campos a atualizar
     */
    async _updateKernelState(taskId, stateUpdate) {
        if (!taskId) return;

        const existing = this.kernelStateCache.get(taskId) || {};

        const existingEventTimestamp = Number(existing.event_timestamp || 0);
        const incomingEventTimestamp = Number(stateUpdate.event_timestamp || 0);
        if (
            existingEventTimestamp > 0 &&
            incomingEventTimestamp > 0 &&
            incomingEventTimestamp < existingEventTimestamp
        ) {
            log(
                'DEBUG',
                `[TaskSyncBridge] Evento stale ignorado para ${taskId} (incoming=${incomingEventTimestamp}, current=${existingEventTimestamp})`
            );
            return;
        }

        const updated = {
            ...existing,
            ...stateUpdate,
            updated_at: Date.now(),
        };

        this.kernelStateCache.set(taskId, updated);

        await this._persistRuntimeState(taskId, updated);

        // Emite evento local
        this.emit('task:state_changed', { taskId, state: updated });

        // Agenda broadcast debounced
        this._scheduleBroadcast(taskId, updated);
    }

    /**
     * Persiste runtime_state no registro de task em disco (best-effort).
     * Não lança exceção para não quebrar fluxo realtime.
     *
     * @param {string} taskId
     * @param {Object} runtimeState
     */
    async _persistRuntimeState(taskId, runtimeState) {
        try {
            const io = await this.getIo();
            if (!io || typeof io.getQueue !== 'function' || typeof io.saveTask !== 'function') {
                return;
            }

            const queue = await io.getQueue();
            const task = /** @type {any} */ (
                queue.find(t => /** @type {any} */ (t)?.meta?.id === taskId || /** @type {any} */ (t)?.id === taskId)
            );
            if (!task) {
                return;
            }

            const persistedTask = {
                ...task,
                runtime_state: {
                    .../** @type {any} */ ((task).runtime_state || {}),
                    ...runtimeState,
                },
                state: {
                    .../** @type {any} */ ((task).state || {}),
                    status:
                        runtimeState.status ||
                        /** @type {any} */ (task).state?.status ||
                        /** @type {any} */ (task).status ||
                        UnifiedStatus.PENDING,
                    updated_at: Date.now(),
                },
            };

            await io.saveTask(persistedTask);
        } catch (err) {
            log('DEBUG', `[TaskSyncBridge] Persistência runtime ignorada para ${taskId}: ${err.message}`);
        }
    }

    /**
     * Agenda broadcast para dashboards com debounce configurável.
     * Evita flood de mensagens em updates rápidos.
     */
    _scheduleBroadcast(taskId, state) {
        this._pendingBroadcasts.set(taskId, state);

        if (this._broadcastTimer) return;

        this._broadcastTimer = setTimeout(() => {
            this._broadcastTimer = null;
            this._flushBroadcasts();
        }, BROADCAST_DEBOUNCE_MS);
    }

    /**
     * Envia broadcasts pendentes para dashboards.
     */
    _flushBroadcasts() {
        if (!this.socketHub || this._pendingBroadcasts.size === 0) {
            this._pendingBroadcasts.clear();
            return;
        }

        // Broadcast cada task atualizada
        for (const [taskId, state] of this._pendingBroadcasts) {
            try {
                if (typeof this.socketHub.broadcastTaskUpdate === 'function') {
                    this.socketHub.broadcastTaskUpdate(taskId, state);
                } else if (typeof this.socketHub.notify === 'function') {
                    this.socketHub.notify('task:updated', { taskId, state });
                }
            } catch (err) {
                log('ERROR', `[TaskSyncBridge] Erro ao broadcast task ${taskId}: ${err.message}`);
            }
        }

        this._pendingBroadcasts.clear();
    }

    /**
     * Retorna lista unificada de todas as tasks.
     * Combina dados do disco com estado do kernel.
     *
     * @returns {Promise<Array>} Lista de tasks unificadas
     */
    async getUnifiedTasks() {
        // Busca tasks do disco
        const _qc = await this.getQueueCache();
        const diskTasks = _qc ? await _qc.getQueue() : [];

        // Unifica com estado do kernel
        return diskTasks.map(diskTask => this._unifyTask(diskTask));
    }

    /**
     * Retorna uma task unificada por ID.
     *
     * @param {string} taskId - ID da task
     * @returns {Promise<Object|null>} Task unificada ou null
     */
    async getUnifiedTask(taskId) {
        if (!taskId) return null;

        // Busca do disco
        const _qc2 = await this.getQueueCache();
        const diskTasks = _qc2 ? await _qc2.getQueue() : [];

        const diskTask = diskTasks.find(t => t.meta?.id === taskId || t.id === taskId);

        if (!diskTask) {
            // Pode existir só no kernel (task em memória)
            const kernelState = this.kernelStateCache.get(taskId);
            if (kernelState) {
                return {
                    meta: { id: taskId },
                    runtime_state: kernelState,
                    unified_status: kernelState.status || UnifiedStatus.RUNNING,
                    source: 'kernel_only',
                };
            }
            return null;
        }

        return this._unifyTask(diskTask);
    }

    /**
     * Combina task do disco com estado do kernel.
     *
     * @param {Object} diskTask - Task do Queue Cache
     * @returns {Object} Task unificada
     */
    _unifyTask(diskTask) {
        const taskId = diskTask.meta?.id || diskTask.id;
        const kernelState = this.kernelStateCache.get(taskId);

        // Determina status unificado
        const unifiedStatus = this._computeUnifiedStatus(diskTask, kernelState);

        return {
            ...diskTask,
            runtime_state: kernelState || null,
            unified_status: unifiedStatus,
            has_runtime_data: !!kernelState,
        };
    }

    /**
     * Computa o status unificado baseado nas duas fontes.
     * Kernel state tem precedência para tasks ativas.
     */
    _computeUnifiedStatus(diskTask, kernelState) {
        // Se tem estado no kernel, ele prevalece
        if (kernelState?.status) {
            return kernelState.status;
        }

        // Fallback para estado do disco
        const diskStatus = diskTask.state?.status || diskTask.status;

        // Mapeia estados do disco para UnifiedStatus
        const statusMap = {
            PENDING: UnifiedStatus.PENDING,
            QUEUED: UnifiedStatus.PENDING,
            RUNNING: UnifiedStatus.RUNNING,
            ACTIVE: UnifiedStatus.RUNNING,
            DONE: UnifiedStatus.DONE,
            COMPLETED: UnifiedStatus.DONE,
            FAILED: UnifiedStatus.FAILED,
            ERROR: UnifiedStatus.FAILED,
            CANCELLED: UnifiedStatus.CANCELLED,
            PAUSED: UnifiedStatus.PAUSED,
            SUSPENDED: UnifiedStatus.PAUSED,
        };

        return statusMap[diskStatus] || UnifiedStatus.PENDING;
    }

    /**
     * Retorna métricas do bridge para observabilidade.
     */
    getMetrics() {
        return {
            kernel_cache_size: this.kernelStateCache.size,
            initialized: this._initialized,
            pending_broadcasts: this._pendingBroadcasts.size,
            has_socket_hub: !!this.socketHub,
            has_nerv_client: !!this._nervClient,
        };
    }

    /**
     * Limpa estado de uma task do cache.
     * Usado quando task é removida do sistema.
     */
    clearTaskState(taskId) {
        if (this.kernelStateCache.has(taskId)) {
            this.kernelStateCache.delete(taskId);
            log('DEBUG', `[TaskSyncBridge] Estado da task ${taskId} removido do cache`);
        }
    }

    /**
     * Limpa todo o cache de estado do kernel.
     * Usado em shutdown ou reset.
     */
    clearAll() {
        // Cleanup listeners NERV (se presentes)
        try {
            for (const unsub of this._nervUnsubscribers) {
                try {
                    unsub();
                } catch (unsubscribeError) {
                    log(
                        'WARN',
                        `[TaskSyncBridge] Falha ao executar unsubscribe NERV: ${unsubscribeError?.message || String(unsubscribeError)}`
                    );
                }
            }
        } catch (unsubscribeBatchError) {
            log(
                'WARN',
                `[TaskSyncBridge] Falha ao limpar subscribers NERV: ${unsubscribeBatchError?.message || String(unsubscribeBatchError)}`
            );
        }
        this._nervUnsubscribers = [];

        this.kernelStateCache.clear();
        this._pendingBroadcasts.clear();
        if (this._broadcastTimer) {
            clearTimeout(this._broadcastTimer);
            this._broadcastTimer = null;
        }
        this.socketHub = null;
        this._nervClient = null;
        this._initialized = false;
        log('INFO', '[TaskSyncBridge] Cache limpo');
    }
}

// Singleton instance
const taskSyncBridge = new TaskSyncBridge();

export default taskSyncBridge;
export { TaskSyncBridge, UnifiedStatus };
