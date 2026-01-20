/* ==========================================================================
   src/infra/storage/task_store.js
   Audit Level: 700 — Sovereign Task Storage (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Persistência física de objetos Task no disco e operações
                     de manutenção de integridade da fila.
   Sincronizado com: paths.js V700, fs_core.js V700, schemas.js V500.
========================================================================== */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// [V700] Importação da Bússola Física para quebrar dependências circulares
const PATHS = require('../fs/paths');
const { atomicWrite, safeReadJSON } = require('../fs/fs_core');
const { parseTask } = require('../../core/schemas');

/**
 * Salva uma tarefa no disco após validação estrita do Schema V4 Gold.
 * @param {object} task - Objeto da tarefa (bruto ou parcial).
 * @returns {Promise<object>} Tarefa validada e persistida.
 */
async function saveTask(task) {
    try {
        // Cura automática de dados antes da escrita
        const validatedTask = parseTask(task);
        const filepath = path.join(PATHS.QUEUE, `${validatedTask.meta.id}.json`);

        // Escrita Atômica: Previne corrupção de JSON em caso de crash
        await atomicWrite(filepath, JSON.stringify(validatedTask, null, 2));

        return validatedTask;
    } catch (e) {
        throw new Error(`[TASK_STORE] Falha ao persistir tarefa: ${e.message}`);
    }
}

/**
 * Lê uma tarefa específica do disco pelo seu identificador único.
 * @param {string} id - ID da tarefa.
 */
async function loadTask(id) {
    const filepath = path.join(PATHS.QUEUE, `${id}.json`);
    return await safeReadJSON(filepath);
}

/**
 * Deleta uma tarefa específica do disco.
 * @param {string} id - ID da tarefa.
 */
async function deleteTask(id) {
    const filepath = path.join(PATHS.QUEUE, `${id}.json`);
    try {
        if (fs.existsSync(filepath)) {
            await fsp.unlink(filepath);
        }
    } catch (e) {
        throw new Error(`[TASK_STORE] Erro ao remover arquivo: ${e.message}`);
    }
}

/**
 * Retorna a lista de nomes de arquivos JSON presentes na fila.
 * @returns {string[]}
 */
function listTaskFiles() {
    try {
        return fs.readdirSync(PATHS.QUEUE).filter(f => f.endsWith('.json'));
    } catch (e) {
        return [];
    }
}

/**
 * Limpeza Cirúrgica da Fila: Remove todas as tarefas, EXCETO as que estão em execução.
 * Garante a continuidade do trabalho do Maestro durante limpezas administrativas.
 *
 * @returns {Promise<object>} Relatório de limpeza { deleted: number, preserved: number }
 */
async function clearQueue() {
    const files = listTaskFiles();
    let deleted = 0;
    let preserved = 0;

    for (const file of files) {
        try {
            const filepath = path.join(PATHS.QUEUE, file);
            const task = await safeReadJSON(filepath);

            // Proteção de Soberania: Nunca apagar o que o robô está operando agora
            if (task && task.state && task.state.status === 'RUNNING') {
                preserved++;
                continue;
            }

            await fsp.unlink(filepath);
            deleted++;
        } catch (e) {
            // Em caso de erro de leitura ou exclusão de um arquivo específico, incrementa preservados
            preserved++;
        }
    }

    return { deleted, preserved };
}

module.exports = {
    saveTask,
    loadTask,
    deleteTask,
    listTaskFiles,
    clearQueue
};