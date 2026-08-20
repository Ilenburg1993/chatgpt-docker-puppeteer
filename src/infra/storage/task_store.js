// @ts-check
import { STATUS_VALUES } from '#core/constants/tasks';
import * as logger from '#core/logger';
import { parseTask } from '#core/schemas';
import { autoMigrateTask } from '#core/schemas/migrator_v4_to_v5';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite, safeReadJSON } from '../fs/fs_core.js';
import * as PATHS from '../fs/paths.js';

const fsp = fs.promises;

/**
 * Salva uma tarefa no disco após validação V5.
 *
 * MUDANÇA V5: Sempre salva em formato V5 (auto-upgrade de V4 se necessário).
 *
 * @param {any} task - Objeto da tarefa (V4 ou V5).
 * @returns {Promise<any>} Tarefa validada e persistida (V5).
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
        const validatedTask = /** @type {any} */ (parseTask(taskV5));
        const filepath = path.join(PATHS.QUEUE, `${validatedTask.meta.id}.json`);

        // ✅ Duplicate ID Detection: Log warning se task já existe
        if (fs.existsSync(filepath)) {
            logger.log('WARN', `[TASK_STORE] Overwriting existing task ${validatedTask.meta.id} (duplicate ID)`);
        }

        // Escrita Atômica: Previne corrupção de JSON em caso de crash
        await atomicWrite(filepath, JSON.stringify(validatedTask, null, 2));

        return validatedTask;
    } catch (/** @type {any} */ e) {
        const _ce = /** @type {any} */ (e);
        throw new Error(`[TASK_STORE] Falha ao persistir tarefa: ${_ce.message}`); // eslint-disable-line preserve-caught-error
    }
}

/**
 * Lê uma tarefa específica do disco com auto-migration V4 → V5.
 *
 * MUDANÇA V5: Detecta versão e auto-migra V4 → V5 transparentemente. Não reescreve o arquivo (migration lazy, apenas em
 * memória).
 *
 * @param {string} id - ID da tarefa.
 * @returns {Promise<any>} Tarefa (V5 se era V4, V5 nativa se já era V5).
 */
async function loadTask(id) {
    const filepath = path.join(PATHS.QUEUE, `${id}.json`);
    const rawTask = /** @type {any} */ (await safeReadJSON(filepath));

    if (!rawTask) {
        return /** @type {any} */ (null);
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
 *
 * @param {string} id - ID da tarefa.
 * @returns {Promise<any>}
 */
async function deleteTask(id) {
    const filepath = path.join(PATHS.QUEUE, `${id}.json`);
    try {
        if (fs.existsSync(filepath)) {
            await fsp.unlink(filepath);
        }
    } catch (/** @type {any} */ e) {
        const _ce = /** @type {any} */ (e);
        throw new Error(`[TASK_STORE] Erro ao remover arquivo: ${_ce.message}`); // eslint-disable-line preserve-caught-error
    }
}

/**
 * Retorna a lista de nomes de arquivos JSON presentes na fila.
 *
 * @returns {string[]}
 */
function listTaskFiles() {
    try {
        return fs.readdirSync(PATHS.QUEUE).filter((f) => f.endsWith('.json'));
    } catch (/** @type {any} */ _) {

        return [];
    }
}

/**
 * Limpeza Cirúrgica da Fila: Remove todas as tarefas, EXCETO as que estão em execução. Garante a continuidade do
 * trabalho do Maestro durante limpezas administrativas.
 *
 * @returns {Promise<any>} Relatório de limpeza { deleted: number, preserved: number }
 */
async function clearQueue() {
    const files = listTaskFiles();
    let deleted = 0;
    let preserved = 0;

    for (const file of files) {
        try {
            const filepath = path.join(PATHS.QUEUE, file);
            const task = /** @type {any} */ (await safeReadJSON(filepath));

            // Proteção de Soberania: Nunca apagar o que o robô está operando agora
            if (task && task.state && task.state.status === STATUS_VALUES.RUNNING) {
                preserved++;
                continue;
            }

            await fsp.unlink(filepath);
            deleted++;
        } catch (/** @type {any} */ _) {

            // Em caso de erro de leitura ou exclusão de um arquivo específico, incrementa preservados
            preserved++;
        }
    }

    return { deleted, preserved };
}

export { clearQueue, deleteTask, listTaskFiles, loadTask, saveTask };
