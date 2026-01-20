/* ==========================================================================
   src/infra/queue/task_loader.js
   Audit Level: 700 — Sovereign Task Loader (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Orquestrar a ingestão de tarefas, realizar a auto-cura de
                     processos zumbis e gerenciar transições de estado em lote.
   Sincronizado com: cache.js V700, task_store.js V700, scheduler.js V100.
========================================================================== */

const cache = require('./cache');
const { getNextEligible } = require('./scheduler');
const { saveTask } = require('../storage/task_store');
const CONFIG = require('../../core/config');
const { log } = require('../../core/logger');

/**
 * Analisa o snapshot da fila, recupera inconsistências e retorna a próxima
 * tarefa elegível para o motor de execução.
 *
 * @param {string|null} targetFilter - Filtro de IA alvo (ex: 'chatgpt').
 * @returns {Promise<object|null>}
 */
async function loadNextTask(targetFilter = null) {
    // 1. Aquisição de Snapshot Estável (RAM)
    const allTasks = await cache.getQueue();
    const now = Date.now();

    if (!allTasks || allTasks.length === 0) {return null;}

    // [OPTIMIZATION] Indexação O(N) para resolução rápida de dependências
    const taskMap = new Map();
    for (const t of allTasks) {
        if (t?.meta?.id) {taskMap.set(t.meta.id, t);}
    }

    let queueWasMutated = false;

    // 2. CICLO DE HIGIENE E CURA
    for (const originalTask of allTasks) {
        let task = originalTask;
        let isModified = false;

        // A. Auto-Cura de Zumbis (Tarefas presas em RUNNING por crash do sistema)
        if (task.state.status === 'RUNNING' && task.state.started_at) {
            const startedAt = Date.parse(task.state.started_at);
            const recoveryThreshold = CONFIG.RUNNING_RECOVERY_MS || 600000; // Default 10min

            if (!isNaN(startedAt) && (now - startedAt > recoveryThreshold)) {
                // Clone-on-Write: Isolamento para não sujar o cache prematuramente
                task = JSON.parse(JSON.stringify(originalTask));

                task.state.status = 'FAILED';
                task.state.last_error = 'RECOVERY_TRIGGERED: Timeout de execução (Zumbi)';
                task.state.completed_at = new Date().toISOString();
                task.state.history.push({
                    ts: new Date().toISOString(),
                    event: 'SYSTEM_RECOVERY',
                    msg: 'Agente zumbi detectado e movido para FAILED.'
                });

                isModified = true;
                log('WARN', `[LOADER] Zumbi resgatado: ${task.meta.id}`);
            }
        }

        // B. Anulação em Cascata (Se o pai falhou/foi pulado, o filho é SKIPPED)
        if (task.state.status === 'PENDING' && task.policy.dependencies?.length > 0) {
            const hasFailedParent = task.policy.dependencies.some(depId => {
                const parent = taskMap.get(depId);
                return parent && (parent.state.status === 'FAILED' || parent.state.status === 'SKIPPED');
            });

            if (hasFailedParent) {
                if (!isModified) {task = JSON.parse(JSON.stringify(originalTask));}

                task.state.status = 'SKIPPED';
                task.state.last_error = 'CASCADE_FAILURE: Dependência falhou ou foi anulada.';
                task.state.completed_at = new Date().toISOString();

                isModified = true;
                log('DEBUG', `[LOADER] Tarefa ${task.meta.id} marcada como SKIPPED por dependência.`);
            }
        }

        // 3. Persistência de Mudanças Lógicas
        if (isModified) {
            try {
                await saveTask(task);
                queueWasMutated = true;
            } catch (err) {
                log('ERROR', `[LOADER] Falha ao persistir cura da tarefa ${task.meta.id}: ${err.message}`);
            }
        }
    }

    // Se houve curas ou anulações, invalidamos o cache para o próximo ciclo
    if (queueWasMutated) {
        cache.markDirty();
    }

    // 4. SELEÇÃO ALGORÍTMICA
    // Delega ao Scheduler a decisão final baseada em prioridade e agendamento
    const eligibleQueue = getNextEligible(allTasks, targetFilter);
    return eligibleQueue[0] || null;
}

/**
 * Operação Administrativa: Reinicia em lote todas as tarefas que falharam.
 * @returns {Promise<number>} Total de tarefas movidas para PENDING.
 */
async function bulkRetryFailed() {
    const allTasks = await cache.getQueue();
    const failedTasks = allTasks.filter(t => t?.state?.status === 'FAILED');

    if (failedTasks.length === 0) {return 0;}

    log('INFO', `[LOADER] Iniciando Bulk Retry para ${failedTasks.length} tarefas.`);

    let count = 0;
    for (const originalTask of failedTasks) {
        try {
            const task = JSON.parse(JSON.stringify(originalTask));

            task.state.status = 'PENDING';
            task.state.last_error = null;
            task.state.history.push({
                ts: new Date().toISOString(),
                event: 'BULK_RETRY',
                msg: 'Tarefa reiniciada via comando administrativo.'
            });

            await saveTask(task);
            count++;
        } catch (err) {
            log('ERROR', `[LOADER] Erro no retry da tarefa ${originalTask.meta.id}: ${err.message}`);
        }
    }

    if (count > 0) {cache.markDirty();}
    return count;
}

module.exports = {
    loadNextTask,
    bulkRetryFailed
};