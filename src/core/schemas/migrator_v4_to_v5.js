/* ==========================================================================
   src/core/schemas/migrator_v4_to_v5.js
   Audit Level: 100 — Schema Migration Engine
   Status: PRODUCTION READY
   Responsabilidade: Migração automática e transparente de Tasks V4 → V5.
                     Garante backward compatibility e zero downtime.

   Strategy:
   1. Detecta versão da task (meta.version)
   2. Se V4: adiciona campos novos com valores default (SINGLE_SHOT behavior)
   3. Se V5: valida e retorna como está
   4. Se desconhecida: migração conservadora + logging

   Usage:
   const { migrateTaskV4toV5 } = require('./migrator_v4_to_v5');
   const taskV5 = migrateTaskV4toV5(taskV4);
========================================================================== */

const { TaskSchemaV5 } = require('./task_schema_v5');
const logger = require('../logger');

/**
 * Detecta se task é V4 baseado na versão.
 * @param {object} task - Task object
 * @returns {boolean} - true se V4, false caso contrário
 */
function isV4Task(task) {
    return task?.meta?.version === '4.0';
}

/**
 * Detecta se task é V5 baseado na versão.
 * @param {object} task - Task object
 * @returns {boolean} - true se V5, false caso contrário
 */
function isV5Task(task) {
    return task?.meta?.version === '5.0';
}

/**
 * Migra task individual de V4 para V5.
 *
 * Estratégia de migração:
 * - meta.version: 4.0 → 5.0
 * - meta.workflow_id: undefined (task standalone)
 * - meta.mission_id: undefined (task standalone)
 * - spec.execution: { strategy: 'SINGLE_SHOT' } (comportamento V4)
 * - spec.validation.validators: [] (sem validação extra)
 * - spec.context_config: undefined (sem context flow)
 * - policy.workflow_policy: undefined (sem políticas de workflow)
 * - state.workflow_state: undefined
 * - state.iteration_state: undefined
 * - state.quality_metrics: undefined
 * - state.cost_tracking: undefined
 * - state.paused_at: null
 * - result.subtask_results: []
 * - result.validation_results: []
 *
 * @param {object} taskV4 - Task V4 object
 * @returns {object} - Task V5 object
 * @throws {Error} - Se migração falhar
 */
function migrateTaskV4toV5(taskV4) {
    try {
        // Se já é V5, valida e retorna
        if (isV5Task(taskV4)) {
            logger.debug(`Task ${taskV4.meta.id} já é V5, validando...`);
            return TaskSchemaV5.parse(taskV4);
        }

        // Se não é V4, assume que é V4 sem versão explícita (legacy)
        if (!isV4Task(taskV4) && !taskV4.meta?.version) {
            logger.warn(
                `Task ${taskV4.meta?.id || 'unknown'} sem versão explícita, assumindo V4 para migração conservadora`
            );
        }

        logger.info(`Migrando task ${taskV4.meta.id} de V4 → V5...`);

        // Cria task V5 base clonando V4
        const taskV5 = JSON.parse(JSON.stringify(taskV4));

        // ==========================================
        // 1. META: Atualiza versão + adiciona novos campos
        // ==========================================
        taskV5.meta.version = '5.0';
        taskV5.meta.workflow_id = undefined; // Task standalone (não parte de workflow)
        taskV5.meta.mission_id = undefined; // Task standalone (não parte de missão)

        // ==========================================
        // 2. SPEC: Adiciona execution config (SINGLE_SHOT)
        // ==========================================
        taskV5.spec.execution = {
            strategy: 'SINGLE_SHOT' // Comportamento V4: executa 1x sem iteração
        };

        // Atualiza validation (mantém campos V4, adiciona validators array vazia)
        if (!taskV5.spec.validation) {
            taskV5.spec.validation = {};
        }
        taskV5.spec.validation.validators = [];
        taskV5.spec.validation.on_validation_failure = 'retry';

        // Context config: undefined (sem context flow)
        taskV5.spec.context_config = undefined;

        // ==========================================
        // 3. POLICY: Adiciona workflow_policy
        // ==========================================
        taskV5.policy.workflow_policy = undefined; // Sem políticas de workflow

        // ==========================================
        // 4. STATE: Adiciona novos campos
        // ==========================================
        taskV5.state.paused_at = null;
        taskV5.state.workflow_state = undefined;
        taskV5.state.iteration_state = undefined;
        taskV5.state.quality_metrics = undefined;
        taskV5.state.cost_tracking = undefined;

        // ==========================================
        // 5. RESULT: Adiciona novos campos
        // ==========================================
        taskV5.result.subtask_results = [];
        taskV5.result.validation_results = [];

        // Valida task V5 com schema
        const validatedTask = TaskSchemaV5.parse(taskV5);

        logger.info(`Task ${taskV4.meta.id} migrada com sucesso para V5`);
        return validatedTask;
    } catch (error) {
        logger.error(`Falha ao migrar task ${taskV4?.meta?.id || 'unknown'} para V5: ${error.message}`, {
            error,
            taskV4
        });
        throw new Error(`Schema migration failed for task ${taskV4?.meta?.id}: ${error.message}`);
    }
}

/**
 * Migra batch de tasks V4 para V5.
 * @param {object[]} tasksV4 - Array de tasks V4
 * @returns {object[]} - Array de tasks V5
 * @throws {Error} - Se alguma migração falhar
 */
function migrateBatchV4toV5(tasksV4) {
    logger.info(`Iniciando migração batch de ${tasksV4.length} tasks V4 → V5...`);

    const results = {
        migrated: [],
        alreadyV5: [],
        failed: []
    };

    for (const taskV4 of tasksV4) {
        try {
            if (isV5Task(taskV4)) {
                results.alreadyV5.push(taskV4);
            } else {
                const taskV5 = migrateTaskV4toV5(taskV4);
                results.migrated.push(taskV5);
            }
        } catch (error) {
            results.failed.push({
                task_id: taskV4?.meta?.id || 'unknown',
                error: error.message
            });
        }
    }

    logger.info(`Migração batch concluída:`, {
        total: tasksV4.length,
        migrated: results.migrated.length,
        alreadyV5: results.alreadyV5.length,
        failed: results.failed.length
    });

    if (results.failed.length > 0) {
        logger.error(`${results.failed.length} tasks falharam na migração:`, results.failed);
        throw new Error(
            `Batch migration failed for ${results.failed.length} tasks. See logs for details.`
        );
    }

    return [...results.migrated, ...results.alreadyV5];
}

/**
 * Valida se task está em formato V5 válido.
 * @param {object} task - Task object
 * @returns {boolean} - true se válido, false caso contrário
 */
function validateV5Task(task) {
    try {
        TaskSchemaV5.parse(task);
        return true;
    } catch (error) {
        logger.error(`Task ${task?.meta?.id} não é V5 válida: ${error.message}`);
        return false;
    }
}

/**
 * Converte task V5 de volta para V4 (downgrade).
 * ATENÇÃO: Perde informações de missões/workflows!
 *
 * @param {object} taskV5 - Task V5 object
 * @returns {object} - Task V4 object
 */
function downgradeV5toV4(taskV5) {
    logger.warn(
        `Downgrade V5 → V4 para task ${taskV5.meta.id}. ATENÇÃO: Perda de dados de missões/workflows!`
    );

    const taskV4 = JSON.parse(JSON.stringify(taskV5));

    // Remove campos V5
    taskV4.meta.version = '4.0';
    delete taskV4.meta.workflow_id;
    delete taskV4.meta.mission_id;

    delete taskV4.spec.execution;
    delete taskV4.spec.context_config;

    // Simplifica validation (mantém apenas campos V4)
    if (taskV4.spec.validation) {
        delete taskV4.spec.validation.validators;
        delete taskV4.spec.validation.on_validation_failure;
    }

    delete taskV4.policy.workflow_policy;

    delete taskV4.state.paused_at;
    delete taskV4.state.workflow_state;
    delete taskV4.state.iteration_state;
    delete taskV4.state.quality_metrics;
    delete taskV4.state.cost_tracking;

    delete taskV4.result.subtask_results;
    delete taskV4.result.validation_results;

    logger.info(`Task ${taskV5.meta.id} downgraded para V4 (com perda de dados)`);
    return taskV4;
}

/**
 * Migra automaticamente task, detectando versão.
 * @param {object} task - Task de qualquer versão
 * @returns {object} - Task V5
 */
function autoMigrateTask(task) {
    if (!task) {
        throw new Error('Cannot migrate null or undefined task');
    }

    if (isV5Task(task)) {
        return TaskSchemaV5.parse(task);
    }

    if (isV4Task(task) || !task.meta?.version) {
        return migrateTaskV4toV5(task);
    }

    logger.error(`Task version ${task.meta.version} não reconhecida, tentando migração conservadora...`);
    return migrateTaskV4toV5(task);
}

module.exports = {
    isV4Task,
    isV5Task,
    migrateTaskV4toV5,
    migrateBatchV4toV5,
    validateV5Task,
    downgradeV5toV4,
    autoMigrateTask
};
