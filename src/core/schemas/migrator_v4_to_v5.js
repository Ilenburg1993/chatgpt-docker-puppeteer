// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as logger from '../logger.js';
import { TaskSchemaV5 } from './task_schema_v5.js';

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
        const taskV5 = structuredClone(taskV4);

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
            strategy: 'SINGLE_SHOT', // Comportamento V4: executa 1x sem iteração
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
        // 3.5. EXECUTION: Adiciona execution context (NOVO - Unified V5)
        // ==========================================
        taskV5.execution = {
            driver: {
                type: 'Unknown',
                version: '1.0',
                connection_mode: 'auto',
                browser_pool_health: 'unknown',
            },
            environment: {
                platform: process.platform,
                node_version: process.version,
                container: false,
                chrome_version: 'unknown',
            },
            retry: {
                tactical_attempts: 0,
                strategic_attempts: taskV4.state?.attempts || 0, // Migra attempts V4
                errors_recovered: [],
                total_backoff_ms: 0,
            },
        };

        // ==========================================
        // 3.6. MISSION: Adiciona mission context (NOVO - Unified V5)
        // ==========================================
        taskV5.mission = {
            mission_id: taskV4.meta?.mission_id || null, // Preserva se existir
            step_id: null,
            step_index: 0,
            step_dependencies: [],
            mission_context: {},
            is_checkpoint: false,
        };

        // ==========================================
        // 4. STATE: Adiciona novos campos + expande metrics/history
        // ==========================================
        taskV5.state.paused_at = null;
        taskV5.state.workflow_state = undefined;
        taskV5.state.iteration_state = undefined;
        taskV5.state.quality_metrics = undefined;
        taskV5.state.cost_tracking = undefined;

        // Expande metrics (V4 + phases + perception)
        taskV5.state.metrics = {
            ...(taskV4.state?.metrics || {}),
            phases: {
                preparation_ms: 0,
                execution_ms: taskV4.state?.metrics?.duration_ms || 0, // Migra duration V4
                validation_ms: 0,
                storage_ms: 0,
            },
            perception: {
                cycles: 0,
                stable_cycles: 0,
                continuations: 0,
                thought_blocks_pruned: 0,
            },
        };

        // Estrutura history (V4 array → V5 object com summary)
        taskV5.state.history = {
            events: taskV4.state?.history || [],
            summary: {
                total_events: (taskV4.state?.history || []).length,
                errors_count: 0,
                warnings_count: 0,
                retry_count: taskV4.state?.attempts || 0,
                phase_durations: {},
            },
        };

        // ==========================================
        // 5. RESULT: Migra para Result V2 (multi-formato + metadata + validation)
        // ==========================================

        // Multi-format storage (migra file_path V4 → storage V5)
        taskV5.result.storage = {
            text_file: taskV4.result?.file_path || null,
            markdown_file: taskV4.result?.file_path?.replace('.txt', '.md') || null,
            json_file: taskV4.result?.file_path?.replace('.txt', '.json') || null,
            html_file: taskV4.result?.file_path?.replace('.txt', '.html') || null,
        };

        // Generation metadata (reconstrói de state V4)
        taskV5.result.generation = {
            model: taskV4.spec?.model || 'unknown',
            started_at: taskV4.state?.started_at || null,
            completed_at: taskV4.state?.completed_at || null,
            duration_ms: taskV4.state?.metrics?.duration_ms || 0,
            tokens_estimate: taskV4.state?.metrics?.token_estimate || 0,
            continuations: 0,
            thought_blocks_pruned: 0,
            retry_attempts: 0,
        };

        // Validation (null = não executada, fase posterior)
        taskV5.result.validation = null;

        // Preview estruturado (migra raw_output_preview V4)
        taskV5.result.preview = {
            text: taskV4.result?.raw_output_preview || '',
            sections_count: 0,
            code_blocks_count: 0,
            links_count: 0,
            images_count: 0,
        };

        // Mantém campos V4 para compatibilidade (DEPRECATED mas preservados)
        taskV5.result.file_path = taskV4.result?.file_path || null;
        taskV5.result.session_url = taskV4.result?.session_url || null;
        taskV5.result.finish_reason = taskV4.result?.finish_reason || 'unknown';
        taskV5.result.raw_output_preview = taskV4.result?.raw_output_preview || undefined;

        // Mission System fields (mantém vazios se não existirem em V4)
        taskV5.result.subtask_results = [];
        taskV5.result.validation_results = [];

        // Valida task V5 com schema
        const validatedTask = TaskSchemaV5.parse(taskV5);

        logger.info(`Task ${taskV4.meta.id} migrada com sucesso para V5`);
        return validatedTask;
    } catch (error) {
        logger.error(`Falha ao migrar task ${taskV4?.meta?.id || 'unknown'} para V5: ${error.message}`, {
            error,
            taskV4,
        });
        throw new Error(`Schema migration failed for task ${taskV4?.meta?.id}: ${error.message}`, { cause: error });
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
        failed: [],
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
                error: error.message,
            });
        }
    }

    logger.info(`Migração batch concluída:`, {
        total: tasksV4.length,
        migrated: results.migrated.length,
        alreadyV5: results.alreadyV5.length,
        failed: results.failed.length,
    });

    if (results.failed.length > 0) {
        logger.error(`${results.failed.length} tasks falharam na migração:`, results.failed);
        throw new Error(`Batch migration failed for ${results.failed.length} tasks. See logs for details.`);
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
 * ATENÇÃO: Perde informações de missões/workflows/execution context/result V2!
 *
 * @param {object} taskV5 - Task V5 object
 * @returns {object} - Task V4 object
 */
function downgradeV5toV4(taskV5) {
    logger.warn(
        `Downgrade V5 → V4 para task ${taskV5.meta.id}. ATENÇÃO: Perda de dados de execution/mission/result V2!`
    );

    const taskV4 = structuredClone(taskV5);

    // Remove campos V5 do META
    taskV4.meta.version = '4.0';
    delete taskV4.meta.workflow_id;
    delete taskV4.meta.mission_id;

    // Remove campos V5 do SPEC
    delete taskV4.spec.execution;
    delete taskV4.spec.context_config;

    // Simplifica validation (mantém apenas campos V4)
    if (taskV4.spec.validation) {
        delete taskV4.spec.validation.validators;
        delete taskV4.spec.validation.on_validation_failure;
    }

    // Remove campos V5 do POLICY
    delete taskV4.policy.workflow_policy;

    // Remove EXECUTION context (NOVO - Unified V5)
    delete taskV4.execution;

    // Remove MISSION context (NOVO - Unified V5)
    delete taskV4.mission;

    // Downgrade STATE (V5 → V4)
    delete taskV4.state.paused_at;
    delete taskV4.state.workflow_state;
    delete taskV4.state.iteration_state;
    delete taskV4.state.quality_metrics;
    delete taskV4.state.cost_tracking;

    // Downgrade metrics (remove phases e perception)
    if (taskV4.state.metrics) {
        delete taskV4.state.metrics.phases;
        delete taskV4.state.metrics.perception;
    }

    // Downgrade history (object → array)
    if (taskV4.state.history && taskV4.state.history.events) {
        taskV4.state.history = taskV4.state.history.events; // Mantém apenas array
    }

    // Downgrade RESULT (V2 → V4)
    delete taskV4.result.storage; // Remove multi-format
    delete taskV4.result.generation; // Remove metadata
    delete taskV4.result.validation; // Remove LLM-judge
    delete taskV4.result.preview; // Remove preview estruturado
    delete taskV4.result.subtask_results;
    delete taskV4.result.validation_results;

    // Mantém apenas campos V4 (file_path, session_url, finish_reason, raw_output_preview)
    // Já estão preservados no downgrade

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

export { autoMigrateTask, downgradeV5toV4, isV4Task, isV5Task, migrateBatchV4toV5, migrateTaskV4toV5, validateV5Task };
