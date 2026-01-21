/* ==========================================================================
   src/kernel/state/task_store.js
   Audit Level: 820 — Long-Term Working Memory
   Status: CONSOLIDATED (Protocol 11)
   Responsabilidade:
     - Manter a "Verdade Única" sobre a tarefa ativa.
     - Rastrear contadores de falha para decisão de política.
     - Permitir hidratação (recovery) pós-crash.
========================================================================== */

const fs = require('fs');

const { STATUS_VALUES: STATUS_VALUES } = require('../../core/constants/tasks.js');

const path = require('path');

// Caminho padrão para recuperação de estado (Legado compatível)
const STATE_FILE_PATH = path.resolve(process.cwd(), 'estado.json');

class TaskStore {
    constructor() {
        // [P3.1 DEPRECATION WARNING]
        console.warn('[DEPRECATED] TaskStore is deprecated. Use TaskRuntime (src/kernel/task_runtime/) instead.');
        console.warn('[DEPRECATED] This class will be removed in a future version.');

        // O Estado Mutável do Kernel
        this.activeTask = null; // null ou Objeto de Tarefa
        this.failureCount = 0;
        this.lastError = null;
        this.status = STATUS_VALUES.IDLE; // IDLE, RUNNING, PAUSED, FAILED
    }

    /**
     * Tenta recuperar a memória de uma sessão anterior (Crash Recovery).
     * Lê o arquivo estado.json de forma síncrona (apenas no boot) para
     * garantir que o Kernel nasça sabendo quem é.
     */
    hydrate() {
        try {
            if (fs.existsSync(STATE_FILE_PATH)) {
                const raw = fs.readFileSync(STATE_FILE_PATH, 'utf8');
                const state = JSON.parse(raw);

                // Validação mínima para evitar carregar lixo
                if (state && state.meta && state.meta.id) {
                    this.activeTask = state;
                    this.status = state.state ? state.state.status : STATUS_VALUES.IDLE;
                    console.log(`[KERNEL MEMORY] Memória recuperada: Tarefa ${state.meta.id} em estado ${this.status}`);
                }
            }
        } catch (err) {
            console.warn('[KERNEL MEMORY] Falha ao hidratar memória (iniciando limpo):', err.message);
            // Inicia tabula rasa em caso de erro de disco
            this.clearActive();
        }
    }

    /**
     * Prepara uma nova tarefa proposta pelo servidor.
     * Reinicia contadores de falha.
     */
    stageNewTask(taskPayload) {
        this.activeTask = {
            ...taskPayload,
            // Garante estrutura de estado interna se não vier do payload
            state: taskPayload.state || {
                status: STATUS_VALUES.PENDING,
                progress: 0,
                step: 0,
                history: []
            }
        };

        this.failureCount = 0;
        this.lastError = null;
        this.status = STATUS_VALUES.RUNNING; // Assume intenção de rodar

        console.log(`[KERNEL MEMORY] Nova tarefa estagiada: ${this.activeTask.meta.id}`);
    }

    /**
     * Registra uma falha operacional reportada pelo Driver.
     * Incrementa o contador para que a PolicyEngine possa decidir se aborta.
     */
    recordFailure(errorPayload) {
        this.failureCount++;
        this.lastError = errorPayload;

        // Atualiza histórico interno da tarefa
        if (this.activeTask && this.activeTask.state) {
            this.activeTask.state.last_error = errorPayload;
            this.activeTask.state.retry_count = this.failureCount;
        }

        console.log(
            `[KERNEL MEMORY] Falha registrada #${this.failureCount}: ${errorPayload.msg || 'Erro desconhecido'}`
        );
    }

    /**
     * Verifica se existe uma missão em curso.
     * @returns {boolean}
     */
    hasActiveTask() {
        return this.activeTask !== null && this.status !== 'COMPLETED';
    }

    /**
     * Limpa a memória de trabalho (ex: tarefa concluída ou abortada).
     */
    clearActive() {
        this.activeTask = null;
        this.failureCount = 0;
        this.status = STATUS_VALUES.IDLE;
    }

    /**
     * Retorna o snapshot completo do estado para avaliação de políticas.
     * @returns {object} Read-only view
     */
    getState() {
        return {
            task: this.activeTask,
            failures: this.failureCount,
            status: this.status,
            is_idle: this.activeTask === null
        };
    }
}

module.exports = TaskStore;
