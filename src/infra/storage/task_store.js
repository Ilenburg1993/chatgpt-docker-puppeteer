/* ==========================================================================
   src/infra/storage/task_store.js
   Audit Level: 700 — Sovereign Task Storage (V5 Auto-Migration Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Persistência física de objetos Task no disco com
                     auto-migration transparente V4 → V5.

   NOVIDADES V5 (Fevereiro 2026):
   - Auto-detect version (V4 vs V5)
   - Auto-migrate V4 → V5 ao carregar (transparent)
   - Salva sempre em V5 (forward-only migration)
   - Backward compatible (V4 clients funcionam via parseTask)

   Sincronizado com: task_schema_v5.js, migrator_v4_to_v5.js
========================================================================== */

const fs = require('fs');

const {
    STATUS_VALUES: STATUS_VALUES
} = require('@core/constants/tasks.js');

const fsp = fs.promises;
const path = require('path');

// [V700] Importação da Bússola Física para quebrar dependências circulares
const PATHS = require('../fs/paths');
const { atomicWrite, safeReadJSON } = require('../fs/fs_core');
const { parseTask } = require('@core/schemas');
const { autoMigrateTask } = require('@core/schemas/migrator_v4_to_v5');
const logger = require('@core/logger');

/**
 * Salva uma tarefa no disco após validação V5.
 *
 * MUDANÇA V5: Sempre salva em formato V5 (auto-upgrade de V4 se necessário).
 *
 * @param {object} task - Objeto da tarefa (V4 ou V5).
 * @returns {Promise<object>} Tarefa validada e persistida (V5).
 */
async function saveTask(task) {
    try {
        // Auto-migration V4 → V5 (transparente)
        let taskV5 = task;
        if (task.meta?.version === '4.0') {
            logger.debug(`[TASK_STORE] Auto-migrating task ${task.meta.id} V4 → V5 before save`);
            taskV5 = autoMigrateTask(task);
        }

        // Valida schema V5 (parseTask já usa V5 se meta.version === '5.0')
        const validatedTask = parseTask(taskV5);
        const filepath = path.join(PATHS.QUEUE, `${validatedTask.meta.id}.json`);

        // ✅ Duplicate ID Detection: Log warning se task já existe
        if (fs.existsSync(filepath)) {
            logger.log('WARN', `[TASK_STORE] Overwriting existing task ${validatedTask.meta.id} (duplicate ID)`);
        }

        // Escrita Atômica: Previne corrupção de JSON em caso de crash
        await atomicWrite(filepath, JSON.stringify(validatedTask, null, 2));

        return validatedTask;
    } catch (e) {
        throw new Error(`[TASK_STORE] Falha ao persistir tarefa: ${e.message}`);
    }
}

/**
 * Lê uma tarefa específica do disco com auto-migration V4 → V5.
 *
 * MUDANÇA V5: Detecta versão e auto-migra V4 → V5 transparentemente.
 * Não reescreve o arquivo (migration lazy, apenas em memória).
 *
 * @param {string} id - ID da tarefa.
 * @returns {Promise<object>} Tarefa (V5 se era V4, V5 nativa se já era V5).
 */
async function loadTask(id) {
    const filepath = path.join(PATHS.QUEUE, `${id}.json`);
    const rawTask = await safeReadJSON(filepath);

    if (!rawTask) {
        return null;
    }

    // Auto-migration V4 → V5 (lazy, apenas em memória)
    if (rawTask.meta?.version === '4.0') {
        logger.debug(`[TASK_STORE] Auto-migrating task ${id} V4 → V5 on load (lazy)`);
        return autoMigrateTask(rawTask);
    }

    // Já é V5 ou sem versão (assume V5)
    return rawTask;
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
    } catch (_) {
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
            if (task && task.state && task.state.status === STATUS_VALUES.RUNNING) {
                preserved++;
                continue;
            }

            await fsp.unlink(filepath);
            deleted++;
        } catch (_) {
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
