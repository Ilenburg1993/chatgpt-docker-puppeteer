/* ==========================================================================
   src/kernel/task_runtime/task_runtime.js
   Subsistema: KERNEL — Núcleo Soberano de Decisão
   Módulo: task_runtime/
   Arquivo: task_runtime.js

   Papel:
   - Manter a existência lógica contínua das tarefas
   - Registrar transições de estado por decisão explícita
   - Preservar histórico interno imutável
   - Fornecer snapshots thread-safe

   IMPORTANTE:
   - NÃO decide (apenas registra decisões)
   - NÃO executa (apenas mantém estado lógico)
   - NÃO observa EVENTs (isso é papel do ObservationStore)
   - NÃO interpreta silêncio ou timeout
   - NÃO comunica via IPC

   Toda mutação ocorre SOMENTE por ordem explícita do ExecutionEngine.

   Linguagem: JavaScript (Node.js)
========================================================================== */

const EventEmitter = require('events');

/* ===========================
   Estados lógicos de tarefa
=========================== */

const TaskState = Object.freeze({
    CREATED: 'CREATED',
    ACTIVE: 'ACTIVE',
    SUSPENDED: 'SUSPENDED',
    TERMINATED: 'TERMINATED'
});

/* ===========================
   Transições permitidas
=========================== */

const ALLOWED_TRANSITIONS = Object.freeze({
    [TaskState.CREATED]: [TaskState.ACTIVE, TaskState.TERMINATED],
    [TaskState.ACTIVE]: [TaskState.SUSPENDED, TaskState.TERMINATED],
    [TaskState.SUSPENDED]: [TaskState.ACTIVE, TaskState.TERMINATED],
    [TaskState.TERMINATED]: []
});

/* ===========================
   Fábrica do TaskRuntime
=========================== */

class TaskRuntime extends EventEmitter {
    /**
     * @param {Object} params
     * @param {Object} params.telemetry
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
     * @param {Object} params
     * @param {string} params.taskId
     * Identificador único da tarefa.
     *
     * @param {Object} [params.metadata]
     * Metadados iniciais (livre, não interpretado pelo TaskRuntime).
     *
     * @returns {Object}
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
            metadata: { ...metadata }
        };

        this.tasks.set(taskId, task);

        this._recordHistory(task, {
            type: 'TASK_CREATED',
            at: now
        });

        this.telemetry.info('task_runtime_task_created', {
            taskId,
            state: task.state,
            at: now
        });

        // Emite evento para observadores externos
        this.emit('task_created', this._snapshot(task));

        return this._snapshot(task);
    }

    /* ===========================
     TRANSIÇÕES DE ESTADO
  =========================== */

    /**
     * Aplica transição de estado explícita.
     *
     * @param {Object} params
     * @param {string} params.taskId
     * @param {string} params.newState
     * Estado alvo.
     *
     * @param {string} params.reason
     * Descrição da decisão que motivou a transição.
     *
     * @returns {Object}
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
            at: now
        });

        this.telemetry.info('task_runtime_state_changed', {
            taskId,
            from: expectedState,
            to: newState,
            reason,
            at: now
        });

        // Emite evento para observadores
        this.emit('task_state_changed', {
            taskId,
            from: expectedState,
            to: newState,
            reason,
            snapshot: this._snapshot(task)
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
     * @param {Object} params
     * @param {string} params.taskId
     * @param {Object} params.intent
     * Descrição da intenção registrada.
     */
    recordIntentReference({ taskId, intent }) {
        const task = this._getTaskOrThrow(taskId);

        this._recordHistory(task, {
            type: 'INTENT_REFERENCED',
            intent,
            at: Date.now()
        });

        this.telemetry.info('task_runtime_intent_referenced', {
            taskId,
            intent: intent?.kind ?? 'unknown'
        });
    }

    /**
     * Registra referência histórica a uma observação (EVENT considerado).
     * NÃO interpreta o EVENT.
     *
     * @param {Object} params
     * @param {string} params.taskId
     * @param {Object} params.observation
     * Referência à observação.
     */
    recordObservationReference({ taskId, observation }) {
        const task = this._getTaskOrThrow(taskId);

        this._recordHistory(task, {
            type: 'OBSERVATION_REFERENCED',
            observation: observation?.msgId ?? 'unknown',
            at: Date.now()
        });

        this.telemetry.info('task_runtime_observation_referenced', {
            taskId,
            observationId: observation?.msgId ?? 'unknown'
        });
    }

    /**
     * Atualiza metadados de uma tarefa.
     *
     * @param {Object} params
     * @param {string} params.taskId
     * @param {Object} params.metadata
     * Novos metadados (merge com existentes).
     */
    updateMetadata({ taskId, metadata }) {
        const task = this._getTaskOrThrow(taskId);

        Object.assign(task.metadata, metadata);
        task.updatedAt = Date.now();

        this._recordHistory(task, {
            type: 'METADATA_UPDATED',
            at: task.updatedAt
        });

        this.telemetry.info('task_runtime_metadata_updated', {
            taskId,
            at: task.updatedAt
        });
    }

    /* ===========================
     CONSULTAS (SOMENTE LEITURA)
  =========================== */

    /**
     * Retorna snapshot imutável de uma tarefa.
     *
     * @param {string} taskId
     * @returns {Object|null}
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
     * @returns {Array<Object>}
     */
    listTasks() {
        return Array.from(this.tasks.values()).map(t => this._snapshot(t));
    }

    /**
     * Filtra tarefas por estado.
     *
     * @param {string} state
     * @returns {Array<Object>}
     */
    listTasksByState(state) {
        return this.listTasks().filter(t => t.state === state);
    }

    /**
     * Retorna estatísticas técnicas.
     *
     * @returns {Object}
     */
    getStats() {
        const byState = {};

        for (const state of Object.values(TaskState)) {
            byState[state] = 0;
        }

        for (const task of this.tasks.values()) {
            byState[task.state]++;
        }

        return Object.freeze({
            total: this.tasks.size,
            byState
        });
    }

    /* ===========================
     FUNÇÕES INTERNAS
  =========================== */

    /**
     * Recupera tarefa ou lança erro.
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
     */
    _isTransitionAllowed(from, to) {
        return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
    }

    /**
     * Registra entrada no histórico interno.
     */
    _recordHistory(task, entry) {
        task.history.push(Object.freeze(entry));
    }

    /**
     * Produz snapshot imutável da tarefa.
     * Protege contra mutação externa.
     */
    _snapshot(task) {
        return Object.freeze({
            taskId: task.taskId,
            state: task.state,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            metadata: Object.freeze({ ...task.metadata }),
            history: Object.freeze([...task.history])
        });
    }
}

module.exports = {
    TaskRuntime,
    TaskState
};
