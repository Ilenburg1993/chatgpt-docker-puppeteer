// @ts-check - Type checking rigoroso habilitado (arquivo core)
import EventEmitter from 'node:events';

/* ===========================
   Estados lógicos de tarefa
=========================== */

/** Constante/valor exportado: TaskState. */
const TaskState = Object.freeze({
    CREATED: 'CREATED',
    ACTIVE: 'ACTIVE',
    SUSPENDED: 'SUSPENDED',
    TERMINATED: 'TERMINATED',
});

/**
 * @typedef {(typeof TaskState)[keyof typeof TaskState]} TaskStateValue
 */

/* ===========================
   Transições permitidas
=========================== */

const ALLOWED_TRANSITIONS = Object.freeze({
    [TaskState.CREATED]: [TaskState.ACTIVE, TaskState.TERMINATED],
    [TaskState.ACTIVE]: [TaskState.SUSPENDED, TaskState.TERMINATED],
    [TaskState.SUSPENDED]: [TaskState.ACTIVE, TaskState.TERMINATED],
    [TaskState.TERMINATED]: [],
});

/* ===========================
   Fábrica do TaskRuntime
=========================== */

/**
 * Runtime lógico de tarefas do kernel com FSM de estados e trilha de telemetria.
 */
class TaskRuntime extends EventEmitter {
    /**
     * @param {object} params
     * @param {any} params.telemetry
     * Canal de telemetria do Kernel.
     */
    constructor({ telemetry }) {
        super();

        if (!telemetry || typeof telemetry.emit !== 'function') {
            throw new Error('TaskRuntime requer telemetria válida');
        }

        this.telemetry = telemetry;

        /**
         * Armazenamento interno de tarefas.
         * taskId -> estrutura da tarefa
         */
        this.tasks = new Map();
    }

    /* ===========================
     CRIAÇÃO DE TAREFA
  =========================== */

    /**
     * Cria uma nova tarefa lógica.
     *
     * @param {object} params
     * @param {string} params.taskId
     * Identificador único da tarefa.
     *
     * @param {object} [params.metadata]
     * Metadados iniciais (livre, não interpretado pelo TaskRuntime).
     *
     * @returns {object}
     * Snapshot imutável da tarefa criada.
     */
    createTask({ taskId, metadata = {} }) {
        if (!taskId || typeof taskId !== 'string') {
            throw new Error('createTask requer taskId válido');
        }

        if (this.tasks.has(taskId)) {
            throw new Error(`Tarefa ${taskId} já existe`);
        }

        const now = Date.now();

        const task = {
            taskId,
            state: TaskState.CREATED,
            createdAt: now,
            updatedAt: now,

            /**
             * Histórico interno da tarefa.
             * Lista de eventos técnicos (não semânticos).
             */
            history: [],

            /**
             * [P2.2 FIX] Contador de ciclos sem progresso.
             * Usado pelo PolicyEngine para detecção de estagnação.
             */
            stalledCycleCount: 0,

            /**
             * Metadados livres.
             * Definidos externamente, nunca interpretados aqui.
             */
            metadata: { ...metadata },
        };

        this.tasks.set(taskId, task);

        this._recordHistory(task, {
            type: 'TASK_CREATED',
            at: now,
        });

        this.telemetry.info('task_runtime_task_created', {
            taskId,
            state: task.state,
            at: now,
        });

        // Emite evento para observadores externos
        this.emit('task_created', this._snapshot(task));

        return this._snapshot(task);
    }

    /**
     * Remove completamente uma task do runtime (esquecimento).
     * Útil para permitir re-execução pós-terminal quando o SSOT (DB)
     * decide rearmar a mesma taskId.
     *
     * @param {string} taskId
     * @returns {boolean} true se removeu
     */
    forgetTask(taskId) {
        if (!taskId || typeof taskId !== 'string') {
            throw new Error('forgetTask requer taskId válido');
        }
        const existed = this.tasks.delete(taskId);
        if (existed) {
            this.telemetry.info('task_runtime_task_forgotten', { taskId, at: Date.now() });
            this.emit('task_forgotten', { taskId });
        }
        return existed;
    }

    /* ===========================
     TRANSIÇÕES DE ESTADO
  =========================== */

    /**
     * Aplica transição de estado explícita.
     *
     * @param {object} params
     * @param {string} params.taskId
     * @param {TaskStateValue} params.newState
     * Estado alvo.
     *
     * @param {string} params.reason
     * Descrição da decisão que motivou a transição.
     *
     * @returns {object}
     * Snapshot atualizado da tarefa.
     */
    applyStateTransition({ taskId, newState, reason }) {
        const task = this._getTaskOrThrow(taskId);

        // [P5.1 FIX] Optimistic locking - captura estado esperado ANTES da validação
        const expectedState = task.state;

        if (!Object.values(TaskState).includes(newState)) {
            throw new Error(`Estado inválido: ${newState}`);
        }

        if (expectedState === TaskState.TERMINATED) {
            throw new Error(`Tarefa ${taskId} já está TERMINATED e não pode mudar de estado`);
        }

        if (!this._isTransitionAllowed(expectedState, newState)) {
            throw new Error(`Transição não permitida: ${expectedState} → ${newState}`);
        }

        // [P5.1 FIX] Verifica se state mudou durante validação (race detection)
        if (task.state !== expectedState) {
            throw new Error(`[RACE] State changed during transition (expected ${expectedState}, found ${task.state})`);
        }

        const now = Date.now();

        task.state = newState;
        task.updatedAt = now;

        this._recordHistory(task, {
            type: 'STATE_TRANSITION',
            from: expectedState,
            to: newState,
            reason,
            at: now,
        });

        this.telemetry.info('task_runtime_state_changed', {
            taskId,
            from: expectedState,
            to: newState,
            reason,
            at: now,
        });

        // Emite evento para observadores
        this.emit('task_state_changed', {
            taskId,
            from: expectedState,
            to: newState,
            reason,
            snapshot: this._snapshot(task),
        });

        return this._snapshot(task);
    }

    /* ===========================
     REGISTROS HISTÓRICOS
  =========================== */

    /**
     * Registra referência histórica a uma intenção (COMMAND emitido).
     * NÃO cria expectativa semântica.
     *
     * @param {object} params
     * @param {string} params.taskId
     * @param {any} params.intent
     * Descrição da intenção registrada.
     */
    recordIntentReference({ taskId, intent }) {
        const task = this._getTaskOrThrow(taskId);

        this._recordHistory(task, {
            type: 'INTENT_REFERENCED',
            intent,
            at: Date.now(),
        });

        this.telemetry.info('task_runtime_intent_referenced', {
            taskId,
            intent: intent?.kind ?? 'unknown',
        });
    }

    /**
     * Registra referência histórica a uma observação (EVENT considerado).
     * NÃO interpreta o EVENT.
     *
     * @param {object} params
     * @param {string} params.taskId
     * @param {any} params.observation
     * Referência à observação.
     */
    recordObservationReference({ taskId, observation }) {
        const task = this._getTaskOrThrow(taskId);

        this._recordHistory(task, {
            type: 'OBSERVATION_REFERENCED',
            observation: observation?.msgId ?? 'unknown',
            at: Date.now(),
        });

        this.telemetry.info('task_runtime_observation_referenced', {
            taskId,
            observationId: observation?.msgId ?? 'unknown',
        });
    }

    /**
     * Atualiza metadados de uma tarefa.
     *
     * @param {object} params
     * @param {string} params.taskId
     * @param {object} params.metadata
     * Novos metadados (merge com existentes).
     */
    updateMetadata({ taskId, metadata }) {
        const task = this._getTaskOrThrow(taskId);

        Object.assign(task.metadata, metadata);
        task.updatedAt = Date.now();

        this._recordHistory(task, {
            type: 'METADATA_UPDATED',
            at: task.updatedAt,
        });

        this.telemetry.info('task_runtime_metadata_updated', {
            taskId,
            at: task.updatedAt,
        });
    }

    /* ===========================
     CONSULTAS (SOMENTE LEITURA)
  =========================== */

    /**
     * Retorna snapshot imutável de uma tarefa.
     *
     * @param {string} taskId
     * @returns {object|null}
     */
    getTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) {
            return null;
        }
        return this._snapshot(task);
    }

    /**
     * Lista todas as tarefas existentes.
     *
     * @returns {any[]}
     */
    listTasks() {
        return Array.from(this.tasks.values()).map(t => this._snapshot(t));
    }

    /**
     * Filtra tarefas por estado.
     *
     * @param {string} state
     * @returns {Array<object>}
     */
    listTasksByState(state) {
        return this.listTasks().filter(t => t.state === state);
    }

    /**
     * Retorna estatísticas técnicas.
     *
     * @returns {object}
     */
    getStats() {
        const byState = /** @type {Record<string, number>} */ ({});

        for (const state of Object.values(TaskState)) {
            byState[state] = 0;
        }

        for (const task of this.tasks.values()) {
            byState[task.state]++;
        }

        return Object.freeze({
            total: this.tasks.size,
            byState,
        });
    }

    /* ===========================
     FUNÇÕES INTERNAS
  =========================== */

    /**
     * Recupera tarefa ou lança erro.
     * @param {any} taskId
     * @returns {any}
     */
    _getTaskOrThrow(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error(`Tarefa ${taskId} não encontrada`);
        }
        return task;
    }

    /**
     * Verifica se transição é permitida.
     * @param {any} from
     * @param {any} to
     * @returns {boolean}
     */
    _isTransitionAllowed(from, to) {
        return /** @type {any} */ (ALLOWED_TRANSITIONS)[from]?.includes(to) ?? false;
    }

    /**
     * Registra entrada no histórico interno.
     * @param {any} task
     * @param {any} entry
     */
    _recordHistory(task, entry) {
        task.history.push(Object.freeze(entry));
    }

    /**
     * Produz snapshot imutável da tarefa.
     * Protege contra mutação externa.
     * @param {any} task
     * @returns {object}
     */
    _snapshot(task) {
        return Object.freeze({
            taskId: task.taskId,
            state: task.state,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            metadata: Object.freeze({ ...task.metadata }),
            history: Object.freeze([...task.history]),
        });
    }
}

export { TaskRuntime, TaskState };
