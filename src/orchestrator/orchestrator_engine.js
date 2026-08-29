// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as logger from '#core/logger';
import { resilientLock } from '#infra/locks/resilient_lock';
import * as HighLevelNERV from '#nerv/adapters/high_level_adapter';
import { ActionCode, ActorRole, OrchestrationAction } from '#shared/nerv/constants';
import { ContextManager } from './context_manager.js';
import { ValidationService } from './validation/validation_service.js';

/**
 * Opções do construtor do OrchestratorEngine.
 *
 * @typedef {object} OrchestratorEngineOptions
 * @property {any} nerv - Instância do sistema NERV.
 * @property {ContextManager | null} [contextManager] - Gerenciador de contexto opcional.
 */

/**
 * OrchestratorEngine - Motor de orquestração de missões.
 *
 * Suporta 3 estratégias de execução:
 *
 * 1. SINGLE_SHOT: Executa 1x sem validação (comportamento V4)
 * 2. ITERATIVE: Executa → Valida → Retry com feedback (até max_iterations)
 * 3. MULTI_STEP: Executa workflow com múltiplos steps
 *
 * Integração com Kernel:
 *
 * - shouldOrchestrate(task): Verifica se task precisa de orquestração
 * - beforeExecution(task): Prepara task antes da execução
 * - afterExecution(task, result): Processa resultado e decide próxima ação
 */
class OrchestratorEngine {
    /**
     * Cria um motor de orquestração de missões.
     *
     * @param {OrchestratorEngineOptions} options - Opções de configuração.
     */
    constructor({ nerv, contextManager = null }) {
        this.nerv = nerv;
        this.validationService = new ValidationService({ nerv });
        this.contextManager = contextManager || new ContextManager();

        // In-memory state para workflows e iterações
        this.activeWorkflows = new Map(); // workflow_id → WorkflowState
        this.activeIterations = new Map(); // task_id → IterationState

        logger.info('[OrchestratorEngine] Initialized with NERV integration and ContextManager');
    }

    /**
     * Acquire workflow-level lock para prevenir race conditions. ✅ P0-2.4: Garante acesso exclusivo ao workflow state.
     *
     * @private
     * @param {string} workflowId - ID do workflow
     * @returns {Promise<boolean>} True se lock foi adquirido
     */
    async _acquireWorkflowLock(workflowId) {
        return await resilientLock.acquire(
            `workflow:state:${workflowId}`,
            async () => true, // Lock in-memory (sem DB)
            async () => {}, // Release no-op
            { workflowId, ts: Date.now() },
        );
    }

    /**
     * Release workflow-level lock. ✅ P0-2.4: Libera acesso ao workflow state.
     *
     * @private
     * @param {string} workflowId - ID do workflow
     * @returns {Promise<void>}
     */
    async _releaseWorkflowLock(workflowId) {
        await resilientLock.release(`workflow:state:${workflowId}`);
    }

    /**
     * Verifica se task precisa de orquestração especial baseada na estratégia de execução.
     *
     * @param {any} task - Task V5 com spec.execution.strategy.
     * @returns {boolean} True se a estratégia for ITERATIVE ou MULTI_STEP.
     */
    shouldOrchestrate(task) {
        const strategy = task.spec?.execution?.strategy || 'SINGLE_SHOT';
        return strategy !== 'SINGLE_SHOT';
    }

    /**
     * Prepara task antes da execução, inicializando estados específicos da estratégia. ✅ P0-2.4: Agora async para
     * suportar locking em _initializeWorkflowState().
     *
     * Para estratégias ITERATIVE: inicializa iteration state com contador e flags. Para estratégias MULTI_STEP:
     * inicializa workflow state com steps e progresso. Emite evento NERV 'ORCHESTRATION_STARTED' para observabilidade.
     *
     * @param {any} task - Task V5 com spec.execution.strategy
     * @returns {Promise<any>} - Task modificada com estado inicializado (immutable se frozen)
     * @throws {Error} - Se task.spec.execution.strategy for inválido
     * @sideEffects - Emite evento NERV 'ORCHESTRATION_STARTED'
     */
    async beforeExecution(task) {
        const strategy = task.spec?.execution?.strategy || 'SINGLE_SHOT';

        // Emite evento NERV
        await this._emitNervEvent('ORCHESTRATION_STARTED', {
            task_id: task.meta.id,
            strategy,
            workflow_id: task.meta.workflow_id,
            mission_id: task.meta.mission_id,
        });

        // Important: tasks can be frozen snapshots (queue/cache). Treat them as immutable.
        let nextTask = task;

        // Se é ITERATIVE, inicializa iteration state
        if (strategy === 'ITERATIVE') {
            nextTask = this._initializeIterationState(nextTask);
        }

        // ✅ P0-2.4: Se é MULTI_STEP, inicializa workflow state (agora await porque usa lock)
        if (strategy === 'MULTI_STEP') {
            nextTask = await this._initializeWorkflowState(nextTask);
            if (nextTask._lockFailed) {
                logger.error(
                    `[OrchestratorEngine] beforeExecution aborted: workflow lock failed for ${nextTask.meta?.id}`,
                );
                return nextTask;
            }
        }

        return nextTask;
    }

    /**
     * Retorna uma nova task com `state` atualizado, sem mutar o objeto original. (algumas tasks chegam como snapshots
     * congelados)
     *
     * @param {any} task
     * @param {any} statePatch
     * @returns {any}
     */

    _withState(task, statePatch) {
        // Prefer in-place updates when safe (tests and many callers expect mutation),
        // but fall back to immutable copies for frozen snapshot tasks.
        const canMutateTask = !!(task && typeof task === 'object' && !Object.isFrozen(task));
        if (canMutateTask) {
            const prevStateOk = task.state && typeof task.state === 'object' && task.state !== null;
            const stateFrozen = prevStateOk && Object.isFrozen(task.state);
            if (!prevStateOk || stateFrozen) {
                // Replace state container if missing/frozen (property assignment is allowed if task isn't frozen).
                task.state = prevStateOk && stateFrozen ? { ...task.state } : {};
            }
            Object.assign(task.state, statePatch);
            return task;
        }

        const prevState =
            task && typeof task.state === 'object' && task.state !== null
                ? /** @type {Record<string, unknown>} */ (task.state)
                : {};
        return {
            ...task,
            state: {
                ...prevState,
                ...statePatch,
            },
        };
    }

    /**
     * Processa resultado após execução e decide próxima ação baseada na estratégia.
     *
     * Para SINGLE_SHOT: sempre retorna DONE. Para ITERATIVE: valida resultado e decide se continua iterando. Para
     * MULTI_STEP: executa próximo step do workflow. Estratégias não implementadas caem para SINGLE_SHOT com warning.
     *
     * @param {any} task - Task V5 com estado atualizado
     * @param {any} executionResult - Resultado da execução do Driver (com sucesso/erro)
     * @returns {Promise<any>} - Decision com { action: OrchestrationAction.DONE|'RETRY'|'NEXT_STEP', task, feedback }
     * @throws {Error} - Se estratégia for inválida ou handlers falharem
     * @sideEffects - Emite eventos NERV 'ORCHESTRATION_COMPLETED' ou warnings no log
     */
    async afterExecution(task, executionResult) {
        const strategy = task.spec?.execution?.strategy || 'SINGLE_SHOT';

        // SINGLE_SHOT: Sempre DONE
        if (strategy === 'SINGLE_SHOT') {
            await this._emitNervEvent('ORCHESTRATION_COMPLETED', {
                task_id: task.meta.id,
                strategy: 'SINGLE_SHOT',
                iterations: 1,
            });

            return {
                action: OrchestrationAction.DONE,
                task,
                feedback: null,
            };
        }

        // ITERATIVE: Valida e decide se itera
        if (strategy === 'ITERATIVE') {
            return await this._handleIterativeStrategy(task, executionResult);
        }

        // MULTI_STEP: Executa próximo step
        if (strategy === 'MULTI_STEP') {
            return await this._handleMultiStepStrategy(task, executionResult);
        }

        // Estratégias não implementadas: TREE_OF_THOUGHT, CHAIN_OF_THOUGHT
        logger.warn(`[OrchestratorEngine] Strategy ${strategy} not implemented yet, fallback to SINGLE_SHOT`);
        return {
            action: OrchestrationAction.DONE,
            task,
            feedback: null,
        };
    }

    /**
     * Inicializa estado de iteração para task ITERATIVE.
     *
     * Cria estado interno de iteração com contador, histórico e limites. Atualiza task.state apenas se não existir
     * iteration_state. Registra iteração ativa no mapa interno para tracking.
     *
     * @private
     * @param {any} task - Task V5 com spec.execution.iterative_config
     * @returns {any} - Task com iteration_state inicializado (immutable)
     * @sideEffects - Adiciona entrada no activeIterations Map
     */
    _initializeIterationState(task) {
        const iterationState = {
            task_id: task.meta.id,
            current_iteration: 0,
            max_iterations: task.spec.execution.iterative_config?.max_iterations || 3,
            iterations_history: /** @type {any[]} */ ([]),
        };

        this.activeIterations.set(task.meta.id, iterationState);

        // Atualiza task state (imutável)
        if (task?.state?.iteration_state) {
            return task;
        }
        return this._withState(task, {
            iteration_state: {
                current_iteration: 0,
                iterations_history: [],
            },
        });
    }

    /**
     * Inicializa estado de workflow para task MULTI_STEP.
     *
     * Cria estado interno de workflow com steps, progresso e contexto acumulado. Registra workflow ativo no mapa
     * interno e inicializa contexto no ContextManager. Atualiza task.state apenas se não existir workflow_state.
     *
     * @private
     * @param {any} task - Task V5 com spec.execution.workflow_config
     * @returns {Promise<any>} - Task com workflow_state inicializado (immutable)
     * @sideEffects - Adiciona entrada no activeWorkflows Map e inicializa contexto no ContextManager
     */
    async _initializeWorkflowState(task) {
        const workflow_id = task.meta.workflow_id || task.meta.id;

        // ✅ P0-2.4: Acquire workflow lock
        const lockAcquired = await this._acquireWorkflowLock(workflow_id);
        if (!lockAcquired) {
            logger.error(`[OrchestratorEngine] Failed to acquire workflow lock for ${workflow_id}`);
            // Return new object with lock failure flag instead of mutating frozen object
            return { ...task, _lockFailed: true };
        }

        try {
            // Check se já foi inicializado (outro worker pode ter feito)
            if (this.activeWorkflows.has(workflow_id)) {
                logger.debug(`[OrchestratorEngine] Workflow ${workflow_id} already initialized`);
                return task;
            }

            const steps = task.spec.execution.workflow_config?.steps || [];

            const workflowState = {
                workflow_id,
                task_id: task.meta.id,
                steps,
                current_step_index: 0,
                completed_steps: /** @type {any[]} */ ([]),
                failed_steps: /** @type {any[]} */ ([]),
                accumulated_context: {},
            };

            this.activeWorkflows.set(workflow_id, workflowState);

            // Inicializa contexto no ContextManager
            this.contextManager.initializeContext(workflow_id, {
                metadata: {
                    task_id: task.meta.id,
                    mission_id: task.meta.mission_id,
                    total_steps: steps.length,
                },
            });

            // Atualiza task state (imutável)
            if (task?.state?.workflow_state) {
                return task;
            }
            return this._withState(task, {
                workflow_state: {
                    current_step_index: 0,
                    completed_steps: [],
                    failed_steps: [],
                    accumulated_context: {},
                },
            });
        } finally {
            // ✅ P0-2.4: Always release lock
            await this._releaseWorkflowLock(workflow_id);
        }
    }

    /**
     * Estratégia ITERATIVE: Executa → Valida → Retry com feedback.
     *
     * Incrementa contador de iteração, valida output usando ValidationService, registra no histórico e decide: DONE
     * (passou validação), RETRY (continua), ou DONE (máx iterações). Emite eventos NERV para observabilidade e limpa
     * estado quando finaliza.
     *
     * @private
     * @param {any} task - Task V5 com estado de iteração
     * @param {any} executionResult - Resultado da execução com output para validação
     * @returns {Promise<any>} - Decision { action: OrchestrationAction.DONE|'RETRY', task, feedback }
     * @throws {Error} - Se iteration state não for encontrado
     * @sideEffects - Emite eventos NERV, atualiza activeIterations Map, chama ValidationService
     */
    async _handleIterativeStrategy(task, executionResult) {
        const iterationState = this.activeIterations.get(task.meta.id);
        if (!iterationState) {
            logger.error(`[OrchestratorEngine] Iteration state not found for task ${task.meta.id}`);
            return { action: OrchestrationAction.DONE, task, feedback: null };
        }

        iterationState.current_iteration++;

        // Emite evento de iteração
        await this._emitNervEvent('ITERATION_STARTED', {
            task_id: task.meta.id,
            iteration: iterationState.current_iteration,
            max_iterations: iterationState.max_iterations,
        });

        // Extrai output do executionResult
        const output = executionResult.output || executionResult.raw_output_preview || '';

        // Valida output
        const validators = task.spec.validation?.validators || [];
        const validationCriteria = task.spec.execution.iterative_config?.validation_criteria || {};

        const validationResult = await this.validationService.validate(output, {
            validators,
            criteria: validationCriteria,
        });

        // Registra iteração no histórico
        iterationState.iterations_history.push({
            iteration: iterationState.current_iteration,
            output,
            quality_score: validationResult.overall_score,
            validation_result: validationResult,
        });

        const nextTask = this._withState(task, {
            iteration_state: {
                current_iteration: iterationState.current_iteration,
                iterations_history: iterationState.iterations_history,
            },
            quality_metrics: {
                overall_score: validationResult.overall_score,
                validation_passed: validationResult.passed,
            },
        });

        // Emite evento de iteração completada
        await this._emitNervEvent('ITERATION_COMPLETED', {
            task_id: task.meta.id,
            iteration: iterationState.current_iteration,
            quality_score: validationResult.overall_score,
            validation_passed: validationResult.passed,
        });

        // Decisão: Passou validação?
        if (validationResult.passed) {
            logger.info(
                `[OrchestratorEngine] Task ${task.meta.id} passed validation on iteration ${iterationState.current_iteration}`,
            );

            // Limpa state
            this.activeIterations.delete(task.meta.id);

            await this._emitNervEvent('ORCHESTRATION_COMPLETED', {
                task_id: task.meta.id,
                strategy: 'ITERATIVE',
                iterations: iterationState.current_iteration,
                final_score: validationResult.overall_score,
            });

            return {
                action: OrchestrationAction.DONE,
                task: nextTask,
                feedback: validationResult.feedback,
            };
        }

        // Não passou: Verificar se pode iterar
        if (iterationState.current_iteration >= iterationState.max_iterations) {
            logger.warn(
                `[OrchestratorEngine] Task ${task.meta.id} reached max iterations (${iterationState.max_iterations}), stopping with best result`,
            );

            // Limpa state
            this.activeIterations.delete(task.meta.id);

            await this._emitNervEvent('ORCHESTRATION_COMPLETED', {
                task_id: task.meta.id,
                strategy: 'ITERATIVE',
                iterations: iterationState.current_iteration,
                final_score: validationResult.overall_score,
                converged: false,
            });

            return {
                action: OrchestrationAction.DONE,
                task: nextTask,
                feedback: `Max iterations reached. Best score: ${validationResult.overall_score}/100`,
            };
        }

        // Pode iterar: Injeta feedback no prompt
        logger.info(
            `[OrchestratorEngine] Task ${task.meta.id} failed validation (score: ${validationResult.overall_score}), retrying (iteration ${iterationState.current_iteration + 1}/${iterationState.max_iterations})`,
        );

        // Prepara feedback para próxima iteração
        const feedbackPrompt = this._buildIterationFeedback(iterationState, validationResult);

        return {
            action: OrchestrationAction.RETRY,
            task: nextTask,
            feedback: feedbackPrompt,
        };
    }

    /**
     * Estratégia MULTI_STEP: Executa workflow com múltiplos steps.
     *
     * Marca step atual como completo, armazena output no contexto acumulado, atualiza progresso e decide: DONE (último
     * step) ou NEXT_STEP (continua workflow). Usa ContextManager para contexto avançado e emite eventos NERV.
     *
     * @private
     * @param {any} task - Task V5 com estado de workflow
     * @param {any} executionResult - Resultado da execução do step atual
     * @returns {Promise<any>} - Decision { action: OrchestrationAction.DONE|'NEXT_STEP', task, feedback, nextStep? }
     * @throws {Error} - Se workflow state não for encontrado
     * @sideEffects - Atualiza activeWorkflows Map, chama ContextManager, emite eventos NERV
     */
    async _handleMultiStepStrategy(task, executionResult) {
        const workflow_id = task.meta.workflow_id || task.meta.id;

        // ✅ P0-2.4: Acquire workflow lock ANTES de acessar state
        const lockAcquired = await this._acquireWorkflowLock(workflow_id);
        if (!lockAcquired) {
            logger.error(`[OrchestratorEngine] Failed to acquire workflow lock for ${workflow_id}`);
            return { action: OrchestrationAction.DONE, task, feedback: null, error: 'LOCK_ACQUISITION_FAILED' };
        }

        try {
            const workflowState = this.activeWorkflows.get(workflow_id);

            if (!workflowState) {
                logger.error(`[OrchestratorEngine] Workflow state not found for ${workflow_id}`);
                return { action: OrchestrationAction.DONE, task, feedback: null };
            }

            const currentStepIndex = workflowState.current_step_index;
            const currentStep = workflowState.steps[currentStepIndex];

            // ✅ P0-2.4: SEÇÃO CRÍTICA protegida por lock
            // Marca step como completo
            workflowState.completed_steps.push(currentStep.id);

            // Armazena resultado no accumulated_context (local - backward compatible)
            const output = executionResult.output || executionResult.raw_output_preview || '';
            workflowState.accumulated_context[currentStep.id] = output;

            // Adiciona output ao ContextManager (para contexto avançado)
            await this.contextManager.addStepOutput(workflow_id, currentStep.id, output);

            const nextTask = this._withState(task, {
                workflow_state: {
                    current_step_index: currentStepIndex + 1,
                    completed_steps: workflowState.completed_steps,
                    failed_steps: workflowState.failed_steps,
                    accumulated_context: workflowState.accumulated_context,
                },
            });

            await this._emitNervEvent('WORKFLOW_STEP_COMPLETED', {
                workflow_id,
                step_id: currentStep.id,
                step_index: currentStepIndex,
                total_steps: workflowState.steps.length,
            });

            // Verifica se tem próximo step
            const nextStepIndex = currentStepIndex + 1;
            if (nextStepIndex >= workflowState.steps.length) {
                // Workflow completo
                logger.info(
                    `[OrchestratorEngine] Workflow ${workflow_id} completed (${workflowState.steps.length} steps)`,
                );

                this.activeWorkflows.delete(workflow_id);

                // Limpa contexto do workflow
                this.contextManager.clearContext(workflow_id);

                await this._emitNervEvent('ORCHESTRATION_COMPLETED', {
                    task_id: task.meta.id,
                    workflow_id,
                    strategy: 'MULTI_STEP',
                    total_steps: workflowState.steps.length,
                });

                return {
                    action: OrchestrationAction.DONE,
                    task: nextTask,
                    feedback: `Workflow completed: ${workflowState.completed_steps.length} steps`,
                };
            }

            // Tem próximo step: Prepara next step task
            workflowState.current_step_index = nextStepIndex;
            const nextStep = workflowState.steps[nextStepIndex];

            logger.info(
                `[OrchestratorEngine] Workflow ${workflow_id} moving to step ${nextStepIndex + 1}/${workflowState.steps.length}: ${nextStep.name}`,
            );

            await this._emitNervEvent('WORKFLOW_STEP_STARTED', {
                workflow_id,
                step_id: nextStep.id,
                step_index: nextStepIndex,
                total_steps: workflowState.steps.length,
            });

            // Prepara prompt do próximo step (injeta contexto acumulado + RAG auto-injection)
            const nextStepPrompt = await this._buildStepPrompt(
                nextStep,
                workflowState.accumulated_context,
                workflow_id,
            );

            return {
                action: OrchestrationAction.NEXT_STEP,
                task: nextTask,
                feedback: nextStepPrompt,
                nextStep,
            };
        } finally {
            // ✅ P0-2.4: SEMPRE libera lock (mesmo se erro)
            await this._releaseWorkflowLock(workflow_id);
        }
    }

    /**
     * Constrói feedback para próxima iteração.
     */
    /**
     * Constrói feedback textual para próxima iteração baseado na validação.
     *
     * Formata score, issues e sugestões dos validadores em prompt estruturado para guiar a próxima tentativa do modelo.
     *
     * @private
     * @param {any} iterationState - Estado da iteração atual
     * @param {any} validationResult - Resultado da validação com score e issues
     * @returns {string} - Prompt de feedback formatado para injeção
     */
    _buildIterationFeedback(iterationState, validationResult) {
        const feedbackParts = [
            `\n\n[Iteration ${iterationState.current_iteration} Feedback]`,
            `Quality Score: ${validationResult.overall_score.toFixed(1)}/100`,
            `Issues: ${validationResult.issues.join('; ')}`,
            '',
        ];

        // Adiciona sugestões dos validadores
        for (const result of validationResult.validation_results) {
            if (result.suggestions && result.suggestions.length > 0) {
                feedbackParts.push(`Suggestions from ${result.validator_type}:`);
                feedbackParts.push(...result.suggestions.map((/** @type {any} */ s) => `  - ${s}`));
            }
        }

        feedbackParts.push('\nPlease improve your response addressing these issues.');

        return feedbackParts.join('\n');
    }

    /**
     * Constrói prompt para step de workflow com contexto acumulado e RAG.
     *
     * Substitui placeholders {step-id} com outputs anteriores, adiciona contexto do ContextManager, e auto-injeta
     * código relevante via RAG se detectar keywords técnicos. Usa hybrid search com reranking e MMR para contexto
     * relevante.
     *
     * @private
     * @param {any} step - Step configuration com prompt e config
     * @param {any} accumulated_context - Map de step_id -> output acumulado
     * @param {string | null} workflow_id - ID do workflow para contexto avançado
     * @returns {Promise<string>} - Prompt enriquecido com contexto
     * @throws {Error} - Se RAG falhar (graceful degradation)
     * @sideEffects - Pode chamar RAG search e ContextManager
     */
    async _buildStepPrompt(step, accumulated_context, workflow_id = null) {
        let prompt = step.config.prompt || step.description || '';

        // Substitui placeholders {step-id} com outputs anteriores (backward compatible)
        Object.keys(accumulated_context).forEach((stepId) => {
            const value = accumulated_context[stepId];
            prompt = prompt.replace(new RegExp(`\\{${stepId}\\}`, 'g'), value);
        });

        // Se workflow_id fornecido, usa ContextManager para contexto avançado
        if (workflow_id && this.contextManager) {
            const context = this.contextManager.getContextForStep(workflow_id, step.id);

            // Adiciona summary de contexto (se houver)
            if (context && context.summary) {
                prompt += `\n\n[CONTEXT SUMMARY]:\n${context.summary}`;
            }

            // Adiciona outputs recentes (se houver e diferentes do accumulated_context)
            if (context && context.steps && context.steps.length > 0) {
                const recentOutputs = context.steps
                    .map((/** @type {any} */ s) => `Step ${s.step_id}: ${s.output.substring(0, 200)}...`)
                    .join('\n');
                prompt += `\n\n[RECENT STEPS]:\n${recentOutputs}`;
            }
        }

        // AUTO-RAG: Auto-inject código relevante se task mencionar keywords
        const ragQuery = this._extractRagQuery(prompt);
        if (ragQuery) {
            try {
                // Lazy import para evitar circular dependency
                const { ragHybridSearch } = await import('../../tools/rag/lib/facade.mjs');

                logger.debug(`[OrchestratorEngine] Auto-injecting RAG context for query: "${ragQuery}"`);

                // Buscar contexto (hybrid search com reranking + MMR)
                const ragResult = /** @type {any} */ (
                    await ragHybridSearch({
                        query: ragQuery,
                        topK: 3, // Limit to 3 chunks to avoid token bloat
                        rerank: true,
                        mmr: true,
                        mmrLambda: 0.7,
                    })
                );

                if (ragResult.results && ragResult.results.length > 0) {
                    // Formatar contexto como markdown
                    const contextMd = ragResult.results
                        .map((/** @type {any} */ r, /** @type {any} */ i) => {
                            const preview = r.text.length > 400 ? r.text.substring(0, 400) + '...' : r.text;
                            return `### [${i + 1}] ${r.path}:${r.start_line}-${r.end_line}\n\`\`\`${r.language || 'text'}\n${preview}\n\`\`\``;
                        })
                        .join('\n\n');

                    // Injetar no início do prompt
                    prompt = `[Auto-injected RAG Context - ${ragResult.results.length} relevant code chunks]\n\n${contextMd}\n\n---\n\n${prompt}`;

                    logger.info(`[OrchestratorEngine] ✓ RAG context injected (${ragResult.results.length} chunks)`);
                }
            } catch (/** @type {any} */ err) {
                const _err = /** @type {any} */ (err);
                logger.warn(`[OrchestratorEngine] RAG auto-injection failed: ${_err.message}`);
                // Continuar sem RAG se falhar (graceful degradation)
            }
        }

        return prompt;
    }

    /**
     * Extrai query RAG do prompt usando heurística de keywords.
     *
     * Detecta necessidade de contexto de código baseado em keywords técnicos, extrai nomes específicos (funções,
     * classes, constantes) e constrói query. Retorna null se não detectar keywords relevantes.
     *
     * @private
     * @param {string} prompt - Prompt do step para análise
     * @returns {string | null} - Query RAG ou null se não precisar
     */
    _extractRagQuery(prompt) {
        // Keywords que indicam necessidade de contexto de código
        const CODE_KEYWORDS = [
            'função',
            'function',
            'classe',
            'class',
            'método',
            'method',
            'arquivo',
            'file',
            'código',
            'code',
            'implementação',
            'implementation',
            'CHROME_PROXY',
            'kernel',
            'driver',
            'adaptive',
            'config',
            'orchestrator',
            'NERV',
            'context',
            'error',
            'handler',
            'module',
            'import',
            'export',
            'interface',
            'type',
        ];

        const promptLower = prompt.toLowerCase();

        // Verifica se contém alguma keyword
        const hasCodeKeyword = CODE_KEYWORDS.some((kw) => promptLower.includes(kw.toLowerCase()));

        if (!hasCodeKeyword) {
            return null; // Não precisa de RAG
        }

        // Extrair query: procura por nomes específicos após keywords
        const patterns = [
            /(?:função|function|class|classe|method|método|arquivo|file)\s+(\w+)/gi,
            /(?:implementa(?:r|ção)?|code|código)\s+(?:de|do|da)?\s*(\w+)/gi,
            /(CHROME_\w+|[A-Z_]{5,})/g, // UPPERCASE constants
            /(\w+(?:Engine|Manager|Service|Controller|Driver|Handler))/gi, // Class patterns
        ];

        const matches = new Set();
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(prompt)) !== null) {
                if (match[1] && match[1].length > 3) {
                    matches.add(match[1]);
                }
            }
        }

        if (matches.size > 0) {
            // Retorna primeiros 3 matches como query
            return Array.from(matches).slice(0, 3).join(' ');
        }

        // Fallback: primeiros 80 chars do prompt (limpo)
        const fallback = prompt
            .replace(/\{[^}]+\}/g, '') // Remove placeholders
            .replace(/\[.*?\]/g, '') // Remove markdown links
            .substring(0, 80)
            .trim();

        return fallback.length > 15 ? fallback : null;
    }

    /**
     * Emite evento NERV com suporte a diferentes APIs.
     *
     * ✅ P1-4: Agora async para aguardar emissão e propagar erros corretamente. Suporta API simples (nerv.emit) para
     * testes e API canônica (nerv.emitEvent) para produção. Usa HighLevelNERV para envelopes padronizados.
     *
     * @private
     * @param {string} actionCode - Código da ação (ex: 'ORCHESTRATION_STARTED')
     * @param {any} payload - Dados do evento
     * @returns {Promise<void>}
     * @sideEffects - Emite evento via NERV system
     */
    async _emitNervEvent(actionCode, payload) {
        if (!this.nerv) return;

        // Unit tests and some adapters use a simple `nerv.emit(event, payload)` API.
        if (typeof this.nerv.emit === 'function') {
            // Simple API - may or may not be async, handle both
            const result = this.nerv.emit(actionCode, payload);
            if (result && typeof result.then === 'function') {
                await result;
            }
            return;
        }

        // Production adapters: emit canonical envelopes.
        if (typeof this.nerv.emitEvent === 'function') {
            try {
                const code = /** @type {any} */ (ActionCode)[actionCode] || actionCode;
                // oxlint-disable-next-line typescript/await-thenable
                await HighLevelNERV.sendEvent(this.nerv, ActorRole.OBSERVER, code, payload); // ✅ P1-4: Added await
            } catch (/** @type {any} */ e) {
                const _e = /** @type {any} */ (e);
                logger.error('[OrchestratorEngine] Falha ao emitir evento NERV:', _e.message);
                // ✅ P1-4: Re-throw para que caller saiba da falha
                throw _e;
            }
        }
    }

    /**
     * Limpa state interno e recursos (cleanup).
     *
     * Remove todos os workflows e iterações ativas, limpa ContextManager. Chamado quando o engine é destruído ou
     * reiniciado.
     *
     * @sideEffects - Limpa activeWorkflows, activeIterations Maps e ContextManager
     */
    cleanup() {
        this.activeWorkflows.clear();
        this.activeIterations.clear();
        this.contextManager.cleanup();
        logger.info('[OrchestratorEngine] Cleanup completed');
    }
}

export { OrchestratorEngine };
