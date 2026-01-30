/* ==========================================================================
   src/orchestrator/orchestrator_engine.js
   Audit Level: 100 — Orchestrator Engine (Mission Orchestration Platform V2.0)
   Status: PRODUCTION READY
   Responsabilidade: Motor central de orquestração de missões autônomas.
                     Implementa estratégias: SINGLE_SHOT, ITERATIVE, MULTI_STEP.

   NERV Integration: Totalmente integrado com NERV bus para zero-coupling.

   Architecture:
   - Recebe tasks V5 com execution strategies
   - Gerencia iterações, validação e workflows
   - Emite eventos NERV para observabilidade
   - Integra com ValidationService para quality control
========================================================================== */

const { ValidationService } = require('./validation/validation_service');
const { ContextManager } = require('./context_manager');
const logger = require('@core/logger');

/**
 * OrchestratorEngine - Motor de orquestração de missões.
 *
 * Suporta 3 estratégias de execução:
 * 1. SINGLE_SHOT: Executa 1x sem validação (comportamento V4)
 * 2. ITERATIVE: Executa → Valida → Retry com feedback (até max_iterations)
 * 3. MULTI_STEP: Executa workflow com múltiplos steps
 *
 * Integração com Kernel:
 * - shouldOrchestrate(task): Verifica se task precisa de orquestração
 * - beforeExecution(task): Prepara task antes da execução
 * - afterExecution(task, result): Processa resultado e decide próxima ação
 */
class OrchestratorEngine {
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
     * Verifica se task precisa de orquestração especial.
     * @param {object} task - Task V5
     * @returns {boolean} - true se precisa de orquestração
     */
    shouldOrchestrate(task) {
        const strategy = task.spec?.execution?.strategy || 'SINGLE_SHOT';
        return strategy !== 'SINGLE_SHOT';
    }

    /**
     * Prepara task antes da execução.
     * @param {object} task - Task V5
     * @returns {object} - Task modificada
     */
    beforeExecution(task) {
        const strategy = task.spec?.execution?.strategy || 'SINGLE_SHOT';

        // Emite evento NERV
        this._emitNervEvent('ORCHESTRATION_STARTED', {
            task_id: task.meta.id,
            strategy,
            workflow_id: task.meta.workflow_id,
            mission_id: task.meta.mission_id
        });

        // Se é ITERATIVE, inicializa iteration state
        if (strategy === 'ITERATIVE') {
            this._initializeIterationState(task);
        }

        // Se é MULTI_STEP, inicializa workflow state
        if (strategy === 'MULTI_STEP') {
            this._initializeWorkflowState(task);
        }

        return task;
    }

    /**
     * Processa resultado após execução e decide próxima ação.
     *
     * @param {object} task - Task V5
     * @param {object} executionResult - Resultado da execução (do Driver)
     * @returns {Promise<object>} - Decision { action: 'DONE'|'RETRY'|'NEXT_STEP', task, feedback }
     */
    async afterExecution(task, executionResult) {
        const strategy = task.spec?.execution?.strategy || 'SINGLE_SHOT';

        // SINGLE_SHOT: Sempre DONE
        if (strategy === 'SINGLE_SHOT') {
            this._emitNervEvent('ORCHESTRATION_COMPLETED', {
                task_id: task.meta.id,
                strategy: 'SINGLE_SHOT',
                iterations: 1
            });

            return {
                action: 'DONE',
                task,
                feedback: null
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
        logger.warn(
            `[OrchestratorEngine] Strategy ${strategy} not implemented yet, fallback to SINGLE_SHOT`
        );
        return {
            action: 'DONE',
            task,
            feedback: null
        };
    }

    /**
     * Inicializa estado de iteração para task ITERATIVE.
     */
    _initializeIterationState(task) {
        const iterationState = {
            task_id: task.meta.id,
            current_iteration: 0,
            max_iterations: task.spec.execution.iterative_config?.max_iterations || 3,
            iterations_history: []
        };

        this.activeIterations.set(task.meta.id, iterationState);

        // Atualiza task state
        if (!task.state.iteration_state) {
            task.state.iteration_state = {
                current_iteration: 0,
                iterations_history: []
            };
        }
    }

    /**
     * Inicializa estado de workflow para task MULTI_STEP.
     */
    _initializeWorkflowState(task) {
        const workflow_id = task.meta.workflow_id || task.meta.id;
        const steps = task.spec.execution.workflow_config?.steps || [];

        const workflowState = {
            workflow_id,
            task_id: task.meta.id,
            steps,
            current_step_index: 0,
            completed_steps: [],
            failed_steps: [],
            accumulated_context: {}
        };

        this.activeWorkflows.set(workflow_id, workflowState);

        // Inicializa contexto no ContextManager
        this.contextManager.initializeContext(workflow_id, {
            metadata: {
                task_id: task.meta.id,
                mission_id: task.meta.mission_id,
                total_steps: steps.length
            }
        });

        // Atualiza task state
        if (!task.state.workflow_state) {
            task.state.workflow_state = {
                current_step_index: 0,
                completed_steps: [],
                failed_steps: [],
                accumulated_context: {}
            };
        }
    }

    /**
     * Estratégia ITERATIVE: Executa → Valida → Retry com feedback.
     */
    async _handleIterativeStrategy(task, executionResult) {
        const iterationState = this.activeIterations.get(task.meta.id);
        if (!iterationState) {
            logger.error(`[OrchestratorEngine] Iteration state not found for task ${task.meta.id}`);
            return { action: 'DONE', task, feedback: null };
        }

        iterationState.current_iteration++;

        // Emite evento de iteração
        this._emitNervEvent('ITERATION_STARTED', {
            task_id: task.meta.id,
            iteration: iterationState.current_iteration,
            max_iterations: iterationState.max_iterations
        });

        // Extrai output do executionResult
        const output = executionResult.output || executionResult.raw_output_preview || '';

        // Valida output
        const validators = task.spec.validation?.validators || [];
        const validationCriteria = task.spec.execution.iterative_config?.validation_criteria || {};

        const validationResult = await this.validationService.validate(output, {
            validators,
            criteria: validationCriteria
        });

        // Registra iteração no histórico
        iterationState.iterations_history.push({
            iteration: iterationState.current_iteration,
            output,
            quality_score: validationResult.overall_score,
            validation_result: validationResult
        });

        // Atualiza task state
        task.state.iteration_state = {
            current_iteration: iterationState.current_iteration,
            iterations_history: iterationState.iterations_history
        };

        task.state.quality_metrics = {
            overall_score: validationResult.overall_score,
            validation_passed: validationResult.passed
        };

        // Emite evento de iteração completada
        this._emitNervEvent('ITERATION_COMPLETED', {
            task_id: task.meta.id,
            iteration: iterationState.current_iteration,
            quality_score: validationResult.overall_score,
            validation_passed: validationResult.passed
        });

        // Decisão: Passou validação?
        if (validationResult.passed) {
            logger.info(
                `[OrchestratorEngine] Task ${task.meta.id} passed validation on iteration ${iterationState.current_iteration}`
            );

            // Limpa state
            this.activeIterations.delete(task.meta.id);

            this._emitNervEvent('ORCHESTRATION_COMPLETED', {
                task_id: task.meta.id,
                strategy: 'ITERATIVE',
                iterations: iterationState.current_iteration,
                final_score: validationResult.overall_score
            });

            return {
                action: 'DONE',
                task,
                feedback: validationResult.feedback
            };
        }

        // Não passou: Verificar se pode iterar
        if (iterationState.current_iteration >= iterationState.max_iterations) {
            logger.warn(
                `[OrchestratorEngine] Task ${task.meta.id} reached max iterations (${iterationState.max_iterations}), stopping with best result`
            );

            // Limpa state
            this.activeIterations.delete(task.meta.id);

            this._emitNervEvent('ORCHESTRATION_COMPLETED', {
                task_id: task.meta.id,
                strategy: 'ITERATIVE',
                iterations: iterationState.current_iteration,
                final_score: validationResult.overall_score,
                converged: false
            });

            return {
                action: 'DONE',
                task,
                feedback: `Max iterations reached. Best score: ${validationResult.overall_score}/100`
            };
        }

        // Pode iterar: Injeta feedback no prompt
        logger.info(
            `[OrchestratorEngine] Task ${task.meta.id} failed validation (score: ${validationResult.overall_score}), retrying (iteration ${iterationState.current_iteration + 1}/${iterationState.max_iterations})`
        );

        // Prepara feedback para próxima iteração
        const feedbackPrompt = this._buildIterationFeedback(iterationState, validationResult);

        return {
            action: 'RETRY',
            task,
            feedback: feedbackPrompt
        };
    }

    /**
     * Estratégia MULTI_STEP: Executa workflow com múltiplos steps.
     */
    async _handleMultiStepStrategy(task, executionResult) {
        const workflow_id = task.meta.workflow_id || task.meta.id;
        const workflowState = this.activeWorkflows.get(workflow_id);

        if (!workflowState) {
            logger.error(`[OrchestratorEngine] Workflow state not found for ${workflow_id}`);
            return { action: 'DONE', task, feedback: null };
        }

        const currentStepIndex = workflowState.current_step_index;
        const currentStep = workflowState.steps[currentStepIndex];

        // Marca step como completo
        workflowState.completed_steps.push(currentStep.id);

        // Armazena resultado no accumulated_context (local - backward compatible)
        const output = executionResult.output || executionResult.raw_output_preview || '';
        workflowState.accumulated_context[currentStep.id] = output;

        // Adiciona output ao ContextManager (para contexto avançado)
        await this.contextManager.addStepOutput(workflow_id, currentStep.id, output);

        // Atualiza task state
        task.state.workflow_state = {
            current_step_index: currentStepIndex + 1,
            completed_steps: workflowState.completed_steps,
            failed_steps: workflowState.failed_steps,
            accumulated_context: workflowState.accumulated_context
        };

        this._emitNervEvent('WORKFLOW_STEP_COMPLETED', {
            workflow_id,
            step_id: currentStep.id,
            step_index: currentStepIndex,
            total_steps: workflowState.steps.length
        });

        // Verifica se tem próximo step
        const nextStepIndex = currentStepIndex + 1;
        if (nextStepIndex >= workflowState.steps.length) {
            // Workflow completo
            logger.info(`[OrchestratorEngine] Workflow ${workflow_id} completed (${workflowState.steps.length} steps)`);

            this.activeWorkflows.delete(workflow_id);

            // Limpa contexto do workflow
            this.contextManager.clearContext(workflow_id);

            this._emitNervEvent('ORCHESTRATION_COMPLETED', {
                task_id: task.meta.id,
                workflow_id,
                strategy: 'MULTI_STEP',
                total_steps: workflowState.steps.length
            });

            return {
                action: 'DONE',
                task,
                feedback: `Workflow completed: ${workflowState.completed_steps.length} steps`
            };
        }

        // Tem próximo step: Prepara next step task
        workflowState.current_step_index = nextStepIndex;
        const nextStep = workflowState.steps[nextStepIndex];

        logger.info(
            `[OrchestratorEngine] Workflow ${workflow_id} moving to step ${nextStepIndex + 1}/${workflowState.steps.length}: ${nextStep.name}`
        );

        this._emitNervEvent('WORKFLOW_STEP_STARTED', {
            workflow_id,
            step_id: nextStep.id,
            step_index: nextStepIndex,
            total_steps: workflowState.steps.length
        });

        // Prepara prompt do próximo step (injeta contexto acumulado)
        const nextStepPrompt = this._buildStepPrompt(nextStep, workflowState.accumulated_context, workflow_id);

        return {
            action: 'NEXT_STEP',
            task,
            feedback: nextStepPrompt,
            nextStep
        };
    }

    /**
     * Constrói feedback para próxima iteração.
     */
    _buildIterationFeedback(iterationState, validationResult) {
        const feedbackParts = [
            `\n\n[Iteration ${iterationState.current_iteration} Feedback]`,
            `Quality Score: ${validationResult.overall_score.toFixed(1)}/100`,
            `Issues: ${validationResult.issues.join('; ')}`,
            ''
        ];

        // Adiciona sugestões dos validadores
        for (const result of validationResult.validation_results) {
            if (result.suggestions && result.suggestions.length > 0) {
                feedbackParts.push(`Suggestions from ${result.validator_type}:`);
                feedbackParts.push(...result.suggestions.map(s => `  - ${s}`));
            }
        }

        feedbackParts.push('\nPlease improve your response addressing these issues.');

        return feedbackParts.join('\n');
    }

    /**
     * Constrói prompt para step de workflow.
     */
    _buildStepPrompt(step, accumulated_context, workflow_id = null) {
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
                    .map((s) => `Step ${s.step_id}: ${s.output.substring(0, 200)}...`)
                    .join('\n');
                prompt += `\n\n[RECENT STEPS]:\n${recentOutputs}`;
            }
        }

        return prompt;
    }

    /**
     * Emite evento NERV.
     */
    _emitNervEvent(actionCode, payload) {
        if (this.nerv) {
            this.nerv.emit(actionCode, payload);
        }
    }

    /**
     * Limpa state (cleanup)
     */
    cleanup() {
        this.activeWorkflows.clear();
        this.activeIterations.clear();
        this.contextManager.cleanup();
        logger.info('[OrchestratorEngine] Cleanup completed');
    }
}

module.exports = { OrchestratorEngine };
