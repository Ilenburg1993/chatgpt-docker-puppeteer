// @ts-check - Type checking rigoroso habilitado (arquivo core)
import EventEmitter from 'node:events';
import { log } from '#core/logger';
import { ActionCode } from '#shared/nerv/constants';
import { getActionCode, getPayload, getTaskIdFromPayload } from '#shared/nerv/envelope_reader';

/**
 * Estados unificados para visualização no dashboard.
 * Combina estados do disco (Queue) com estados do Kernel.
 */
const UnifiedStatus = Object.freeze({
    PENDING: 'PENDING',       // Na fila, aguardando execução
    RUNNING: 'RUNNING',       // Em execução pelo Kernel
    PAUSED: 'PAUSED',         // Suspenso temporariamente
    DONE: 'DONE',             // Concluído com sucesso
    FAILED: 'FAILED',         // Falhou após retries
    CANCELLED: 'CANCELLED'    // Cancelado pelo usuário
});

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
            } catch (e) {
                // ignore
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
            // Prefer onEvent (quando disponível e correto); fallback para onReceive.
            const canUseOnEvent = typeof nerv.onEvent === 'function' && nerv.onEvent.length >= 2;
            if (canUseOnEvent) {
                try {
                    const unsub = nerv.onEvent(actionCode, handler);
                    if (typeof unsub === 'function') {
                        this._nervUnsubscribers.push(unsub);
                    }
                    return;
                } catch (err) {
                    // fallback abaixo
                }
            }

            const unsub = nerv.onReceive((envelope) => {
                const envelopeActionCode = getActionCode(envelope);

                if (envelopeActionCode !== actionCode) {
                    return;
                }
                handler(envelope);
            });

            if (typeof unsub === 'function') {
                this._nervUnsubscribers.push(unsub);
            }
        };

        register(ActionCode.DRIVER_TASK_STARTED, (envelope) => {
            const payload = getPayload(envelope);
            const taskId = getTaskIdFromPayload(payload);
            if (!taskId) return;

            this._updateKernelState(taskId, {
                status: UnifiedStatus.RUNNING,
                started_at: Date.now(),
                worker_id: payload.worker_id || payload.workerId || null,
                target: payload.target || null,
                progress_percent: 0
            });
        });

        register(ActionCode.DRIVER_TASK_COMPLETED, (envelope) => {
            const payload = getPayload(envelope);
            const taskId = getTaskIdFromPayload(payload);
            if (!taskId) return;

            const result = payload.result;

            this._updateKernelState(taskId, {
                status: UnifiedStatus.DONE,
                completed_at: Date.now(),
                result_preview: typeof result === 'string'
                    ? result.substring(0, 500)
                    : result
                        ? JSON.stringify(result).substring(0, 500)
                        : null,
                timings: payload.timings || null
            });
        });

        register(ActionCode.DRIVER_TASK_FAILED, (envelope) => {
            const payload = getPayload(envelope);
            const taskId = getTaskIdFromPayload(payload);
            if (!taskId) return;

            const err = payload.error || payload.err || payload.reason || null;
            const errorText = typeof err === 'string'
                ? err
                : err && typeof err.message === 'string'
                    ? err.message
                    : err
                        ? JSON.stringify(err)
                        : 'Unknown error';
            const reason = payload.reason || 'UNKNOWN';
            const nextAction = payload.next_action || null;
            const retryable = Boolean(payload.retryable);

            this._updateKernelState(taskId, {
                status: UnifiedStatus.FAILED,
                failed_at: Date.now(),
                error: errorText.substring(0, 2000),
                reason_code: reason,
                retryable,
                next_action: nextAction
            });
        });

        register(ActionCode.DRIVER_TASK_ABORTED, (envelope) => {
            const payload = getPayload(envelope);
            const taskId = getTaskIdFromPayload(payload);
            if (!taskId) return;

            this._updateKernelState(taskId, {
                status: UnifiedStatus.CANCELLED,
                cancelled_at: Date.now(),
                reason: payload.reason || payload.abortReason || 'USER_ABORT'
            });
        });

        // Kernel/Policy failures that can be surfaced as FAILED
        register(ActionCode.TASK_FAILED, (envelope) => {
            const payload = getPayload(envelope);
            const taskId = getTaskIdFromPayload(payload);
            if (!taskId) return;

            const err = payload.error || payload.err || payload.reason || null;
            const errorText = typeof err === 'string'
                ? err
                : err && typeof err.message === 'string'
                    ? err.message
                    : err
                        ? JSON.stringify(err)
                        : 'Task failed';
            const reason = payload.reason || 'UNKNOWN';
            const nextAction = payload.next_action || null;
            const retryable = Boolean(payload.retryable);

            this._updateKernelState(taskId, {
                status: UnifiedStatus.FAILED,
                failed_at: Date.now(),
                error: errorText.substring(0, 2000),
                reason_code: reason,
                retryable,
                next_action: nextAction
            });
        });

        register(ActionCode.DRIVER_TASK_QUEUED, (envelope) => {
            const payload = getPayload(envelope);
            const taskId = getTaskIdFromPayload(payload);
            if (!taskId) return;

            this._updateKernelState(taskId, {
                status: UnifiedStatus.PENDING,
                queued_at: Date.now(),
                queue_position: payload.queuePosition || null,
                queue_size: payload.queueSize || null,
                active_drivers: payload.activeDrivers || null,
                next_action: payload.next_action || 'RETRY_LATER'
            });
        });

        register(ActionCode.DRIVER_ERROR, (envelope) => {
            const payload = getPayload(envelope);
            const taskId = getTaskIdFromPayload(payload);
            if (!taskId) return;

            const err = payload.error || payload.err || payload.reason || 'Driver error';
            const errorText = typeof err === 'string' ? err : JSON.stringify(err);

            this._updateKernelState(taskId, {
                status: UnifiedStatus.FAILED,
                failed_at: Date.now(),
                error: errorText.substring(0, 2000)
            });
        });

        log('DEBUG', '[TaskSyncBridge] Listeners NERV configurados (ActionCode-based)');
    }

    /**
     * Atualiza o cache de estado do kernel e agenda broadcast.
     *
     * @param {string} taskId - ID da task
     * @param {Object} stateUpdate - Campos a atualizar
     */
    _updateKernelState(taskId, stateUpdate) {
        if (!taskId) return;

        const existing = this.kernelStateCache.get(taskId) || {};
        const updated = {
            ...existing,
            ...stateUpdate,
            updated_at: Date.now()
        };

        this.kernelStateCache.set(taskId, updated);

        // Emite evento local
        this.emit('task:state_changed', { taskId, state: updated });

        // Agenda broadcast debounced
        this._scheduleBroadcast(taskId, updated);
    }

    /**
     * Agenda broadcast para dashboards com debounce de 50ms.
     * Evita flood de mensagens em updates rápidos.
     */
    _scheduleBroadcast(taskId, state) {
        this._pendingBroadcasts.set(taskId, state);

        if (this._broadcastTimer) return;

        this._broadcastTimer = setTimeout(() => {
            this._broadcastTimer = null;
            this._flushBroadcasts();
        }, 50); // 50ms debounce (P9.8)
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
        const diskTasks = _qc
            ? await _qc.getQueue()
            : [];

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
        const diskTasks = _qc2
            ? await _qc2.getQueue()
            : [];

        const diskTask = diskTasks.find(t =>
            t.meta?.id === taskId || t.id === taskId
        );

        if (!diskTask) {
            // Pode existir só no kernel (task em memória)
            const kernelState = this.kernelStateCache.get(taskId);
            if (kernelState) {
                return {
                    meta: { id: taskId },
                    runtime_state: kernelState,
                    unified_status: kernelState.status || UnifiedStatus.RUNNING,
                    source: 'kernel_only'
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
            has_runtime_data: !!kernelState
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
            'PENDING': UnifiedStatus.PENDING,
            'QUEUED': UnifiedStatus.PENDING,
            'RUNNING': UnifiedStatus.RUNNING,
            'ACTIVE': UnifiedStatus.RUNNING,
            'DONE': UnifiedStatus.DONE,
            'COMPLETED': UnifiedStatus.DONE,
            'FAILED': UnifiedStatus.FAILED,
            'ERROR': UnifiedStatus.FAILED,
            'CANCELLED': UnifiedStatus.CANCELLED,
            'PAUSED': UnifiedStatus.PAUSED,
            'SUSPENDED': UnifiedStatus.PAUSED
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
            has_nerv_client: !!this._nervClient
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
                } catch (e) {
                    // ignore
                }
            }
        } catch (e) {
            // ignore
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
export { TaskSyncBridge };
export { UnifiedStatus };
