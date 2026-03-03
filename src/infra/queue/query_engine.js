// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as cache from './cache.js';
import { STATUS_VALUES } from '#core/constants/tasks';

/**
 * Filtra e ordena as tarefas concluídas de um projeto específico.
 * @param {string} projectId - Identificador do projeto.
 * @returns {Promise<Array<object>>} Lista ordenada (Mais recente primeiro).
 */
async function getProjectContext(projectId) {
    // Adquire snapshot estável e imutável
    const allTasks = Object.freeze(await cache.getQueue());
    const safeProjectId = projectId || 'default';

    return allTasks
        .filter(task => {
            // [V700] Blindagem contra tarefas malformadas ou parciais
            const isMatch = task?.meta?.project_id === safeProjectId;
            const isDone = task?.state?.status === STATUS_VALUES.DONE;
            return isMatch && isDone;
        })
        .sort((a, b) => {
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
 * @param {string} taskId - ID da tarefa.
  * @returns {Promise<object[]>}
 */
async function findById(taskId) {
    if (!taskId) {
        return null;
    }

    const allTasks = await cache.getQueue();
    // Busca linear O(N) sobre o snapshot de RAM
    return allTasks.find(task => task?.meta?.id === taskId) || null;
}

/**
 * Localiza a última tarefa concluída com sucesso em um projeto.
  * @returns {Promise<object[]>}
 */
async function findLast(projectId) {
    const context = await getProjectContext(projectId);
    return context[0] || null;
}

/**
 * Localiza a última tarefa concluída que possui uma tag específica.
  * @returns {Promise<object[]>}
 */
async function findLastByTag(projectId, tag) {
    if (!tag) {
        return null;
    }
    const context = await getProjectContext(projectId);

    // Assegura que a busca respeite a coleção de tags da tarefa
    return context.find(task => Array.isArray(task?.meta?.tags) && task.meta.tags.includes(tag)) || null;
}

/**
 * Localiza a primeira tarefa (mais antiga) concluída com uma tag específica.
  * @returns {Promise<object[]>}
 */
async function findFirstByTag(projectId, tag) {
    if (!tag) {
        return null;
    }
    const context = await getProjectContext(projectId);

    // Inverte a cronologia do contexto para encontrar a semente do projeto
    return [...context].reverse().find(task => Array.isArray(task?.meta?.tags) && task.meta.tags.includes(tag)) || null;
}

export { findById, findLast, findLastByTag, findFirstByTag };
