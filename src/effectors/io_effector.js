/* ==========================================================================
   src/effectors/io_effector.js
   Audit Level: 900 — Persistence Muscle
   Status: CONSOLIDATED (Protocol 11)
   Responsabilidade:
     - Executar ordens de persistência do Kernel.
     - Isolar o Kernel de erros de I/O (Disco cheio, permissão).
     - Garantir atomicidade na escrita do estado.
========================================================================== */

// Importa o IO legado (A ponte com o sistema de arquivos existente)
// Nota: Ajuste o caminho conforme sua estrutura real. Assumindo que io.js está em src/infra/
const io = require('../infra/io');

class IOEffector {
    /**
     * @param {object} config - Configurações de throttle e caminhos.
     */
    constructor(config = {}) {
        this.config = config;
        this.lastSaveTimestamp = 0;
        this.saveInterval = config.MIN_SAVE_INTERVAL || 2000; // Proteção contra fritar o disco
        this.isSaving = false;
    }

    /**
     * Executa a ordem de salvamento.
     * @param {object} stateSnapshot - O estado completo do TaskStore.
     * @param {boolean} force - Se true, ignora o throttle de tempo.
     */
    async save(stateSnapshot, force = false) {
        const now = Date.now();

        // 1. Proteção de Throttle (Não salvar a cada milissegundo)
        if (!force && (now - this.lastSaveTimestamp < this.saveInterval)) {
            return; // Ignora silenciosamente
        }

        // 2. Proteção de Concorrência (Não salvar se já estiver salvando)
        if (this.isSaving) {
            console.warn('[IO EFFECTOR] Salvamento ignorado: Operação de I/O anterior ainda em andamento.');
            return;
        }

        try {
            this.isSaving = true;

            // Extrai apenas a tarefa ativa para compatibilidade com o io.js legado
            // O io.legacy espera um objeto de tarefa, não o state completo do Kernel
            const taskPayload = stateSnapshot.task;

            if (taskPayload) {
                // Atualiza metadados de sistema antes de salvar
                taskPayload.system_meta = {
                    saved_at: new Date().toISOString(),
                    failures: stateSnapshot.failures,
                    status: stateSnapshot.status
                };

                // Chama o infra/io.js existente (que já tem atomic write)
                await io.saveTask(taskPayload);

                this.lastSaveTimestamp = now;
                console.log(`[IO EFFECTOR] Estado persistido com sucesso. Task ID: ${taskPayload.meta.id}`);
            } else {
                // Se não tem tarefa, talvez queiramos limpar o estado.json ou salvar um estado "IDLE"
                // Por enquanto, não fazemos nada para preservar o último estado válido em disco.
            }

        } catch (err) {
            console.error('[IO EFFECTOR] Falha crítica ao persistir estado:', err.message);
            // Aqui poderíamos emitir uma Observação 'IO_ERROR' de volta para o Kernel,
            // mas cuidado com loops infinitos (Erro -> Salvar Erro -> Erro).
        } finally {
            this.isSaving = false;
        }
    }

    /**
     * Recupera a identidade do robô (Leitura).
     * Usado no boot.
     */
    async loadIdentity() {
        try {
            return await io.getIdentity();
        } catch (err) {
            console.error('[IO EFFECTOR] Não foi possível ler a identidade:', err.message);
            return null;
        }
    }
}

module.exports = IOEffector;