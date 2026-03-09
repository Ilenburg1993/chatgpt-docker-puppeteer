// @ts-check
import { STATUS_VALUES } from '#core/constants/tasks';
import * as cache from './cache.js';

/**
 * Filtra e ordena as tarefas concluídas de um projeto específico.
 *
 * @param {string} projectId - Identificador do projeto.
 * @returns {Promise<object[]>} Lista ordenada (Mais recente primeiro).
 */
async function getProjectContext(projectId) {
    // Adquire snapshot estável e imutável
    const allTasks = Object.freeze(await cache.getQueue());
    const safeProjectId = projectId || 'default';

    return allTasks
        .filter((/** @type {any} */ task) => {
            // [V700] Blindagem contra tarefas malformadas ou parciais
            const isMatch = task?.meta?.project_id === safeProjectId;
            const isDone = task?.state?.status === STATUS_VALUES.DONE;
            return isMatch && isDone;
        })
        .sort((/** @type {any} */ a, /** @type {any} */ b) => {
            // Ordenação cronológica reversa baseada no término da tarefa
            const dateA = a?.state?.completed_at || '';
            const dateB = b?.state?.completed_at || '';
            if (dateB < dateA) {
                return -1;
            }
            if (dateB > dateA) {
                return 1;
            }
            return 0;
        });
}

/**
 * Localiza uma tarefa específica pelo seu Identificador Único (UUID).
 *
 * @param {string} taskId - ID da tarefa.
 * @returns {Promise<object[]>}
 */
async function findById(taskId) {
    if (!taskId) {
        return /** @type {any} */ (null);
    }

    const allTasks = await cache.getQueue();
    // Busca linear O(N) sobre o snapshot de RAM
    return allTasks.find((/** @type {any} */ task) => task?.meta?.id === taskId) || null;
}

/**
 * Localiza a última tarefa concluída com sucesso em um projeto.
 *
 * @param {any} projectId
 * @returns {Promise<object[]>}
 */
async function findLast(projectId) {
    const context = await getProjectContext(projectId);
    return /** @type {any} */ (context[0] || null);
}

/**
 * Localiza a última tarefa concluída que possui uma tag específica.
 *
 * @param {any} projectId
 * @param {any} tag
 * @returns {Promise<any>}
 */
async function findLastByTag(projectId, tag) {
    if (!tag) {
        return /** @type {any} */ (null);
    }
    const context = await getProjectContext(projectId);

    // Assegura que a busca respeite a coleção de tags da tarefa
    return (
        context.find((/** @type {any} */ task) => Array.isArray(task?.meta?.tags) && task.meta.tags.includes(tag)) ||
        null
    );
}

/**
 * Localiza a primeira tarefa (mais antiga) concluída com uma tag específica.
 *
 * @param {any} projectId
 * @param {any} tag
 * @returns {Promise<any>}
 */
async function findFirstByTag(projectId, tag) {
    if (!tag) {
        return /** @type {any} */ (null);
    }
    const context = await getProjectContext(projectId);

    // Inverte a cronologia do contexto para encontrar a semente do projeto
    return (
        [...context]
            .reverse()
            .find((/** @type {any} */ task) => Array.isArray(task?.meta?.tags) && task.meta.tags.includes(tag)) || null
    );
}

export { findById, findFirstByTag, findLast, findLastByTag };
