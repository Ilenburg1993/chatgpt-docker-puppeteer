// src/orchestrator/orchestrator_engine.js

class OrchestratorEngine {
  constructor({ kernel, nervBridge, contextManager, validationService, costTracker }) {
    this.kernel = kernel;
    this.nerv = nervBridge;
    this.contextManager = contextManager;
    this.validationService = validationService;
    this.costTracker = costTracker;

    // In-memory workflow states
    this.workflowStates = new Map(); // workflow_id → WorkflowState

    // Strategy handlers
    this.strategyHandlers = {
      SINGLE_SHOT: this._handleSingleShot.bind(this),
      ITERATIVE: this._handleIterative.bind(this),
      MULTI_STEP: this._handleMultiStep.bind(this),
      TREE_OF_THOUGHT: this._handleTreeOfThought.bind(this),
      CHAIN_OF_THOUGHT: this._handleChainOfThought.bind(this)
    };
  }

  /**
   * Execute task based on strategy
   */
  async execute(task) {
    const strategy = task.spec.execution.strategy;
    const handler = this.strategyHandlers[strategy];

    if (!handler) {
      throw new Error(`Unknown execution strategy: ${strategy}`);
    }

    // Emit orchestration start
    this.nerv.emitEvent({
      actionCode: 'ORCHESTRATION_STARTED',
      payload: {
        task_id: task.meta.id,
        strategy,
        workflow_id: task.meta.workflow_id
      }
    });

    try {
      const result = await handler(task);

      // Track cost
      await this.costTracker.record(task.meta.id, result.cost_tracking);

      // Emit orchestration complete
      this.nerv.emitEvent({
        actionCode: 'ORCHESTRATION_COMPLETED',
        payload: {
          task_id: task.meta.id,
          result_preview: result.output.substring(0, 200),
          quality_score: result.quality_score
        }
      });

      return result;
    } catch (error) {
      this.nerv.emitEvent({
        actionCode: 'ORCHESTRATION_FAILED',
        payload: {
          task_id: task.meta.id,
          error: error.message
        }
      });
      throw error;
    }
  }

  /**
   * SINGLE_SHOT: Execute once, no validation
   */
  async _handleSingleShot(task) {
    const driver = await this._getDriver(task.spec.target);
    const result = await driver.execute(task);

    return {
      output: result.output,
      cost_tracking: result.cost_tracking,
      quality_score: null  // No validation
    };
  }

  /**
   * ITERATIVE: Execute → Validate → Refine → Repeat
   */
  async _handleIterative(task) {
    const config = task.spec.execution.iterative_config;
    const maxIterations = config.max_iterations || 3;

    let currentIteration = 0;
    let bestResult = null;
    let bestScore = 0;

    while (currentIteration < maxIterations) {
      currentIteration++;

      // Emit iteration start
      this.nerv.emitEvent({
        actionCode: 'ITERATION_STARTED',
        payload: {
          task_id: task.meta.id,
          iteration: currentIteration,
          max_iterations: maxIterations
        }
      });

      // Execute LLM
      const driver = await this._getDriver(task.spec.target);
      const result = await driver.execute(task);

      // Validate
      const validationResult = await this.validationService.validate(result.output, {
        validators: config.validation_criteria.validators,
        criteria: config.validation_criteria
      });

      const qualityScore = validationResult.overall_score;

      // Emit iteration complete
      this.nerv.emitEvent({
        actionCode: 'ITERATION_COMPLETED',
        payload: {
          task_id: task.meta.id,
          iteration: currentIteration,
          quality_score: qualityScore,
          validation_passed: validationResult.passed
        }
      });

      // Track best result
      if (qualityScore > bestScore) {
        bestResult = result;
        bestScore = qualityScore;
      }

      // Check if passed
      if (validationResult.passed && qualityScore >= config.validation_criteria.min_quality_score) {
        return {
          output: result.output,
          cost_tracking: result.cost_tracking,
          quality_score: qualityScore,
          iterations: currentIteration
        };
      }

      // Prepare feedback for next iteration
      if (currentIteration < maxIterations) {
        task.spec.payload.context = {
          previous_attempts: currentIteration,
          previous_output: result.output,
          validation_feedback: validationResult.feedback,
          issues: validationResult.issues
        };

        task.spec.payload.user_message += `\n\n[Feedback from iteration ${currentIteration}]: ${validationResult.feedback}`;
      }
    }

    // Max iterations reached, return best
    return {
      output: bestResult.output,
      cost_tracking: bestResult.cost_tracking,
      quality_score: bestScore,
      iterations: currentIteration,
      converged: false
    };
  }

  /**
   * MULTI_STEP: Execute workflow with multiple steps
   */
  async _handleMultiStep(task) {
    const workflowConfig = task.spec.execution.workflow_config;
    const steps = workflowConfig.steps;

    // Initialize workflow state
    const workflowState = {
      workflow_id: task.meta.workflow_id,
      task_id: task.meta.id,
      steps: steps,
      current_step_index: 0,
      completed_steps: [],
      failed_steps: [],
      accumulated_context: {},
      results: []
    };

    this.workflowStates.set(task.meta.workflow_id, workflowState);

    // Execute steps
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      workflowState.current_step_index = i;

      // Check dependencies
      const dependenciesMet = step.dependencies.every(depId =>
        workflowState.completed_steps.includes(depId)
      );

      if (!dependenciesMet) {
        throw new Error(`Step ${step.id} dependencies not met: ${step.dependencies.join(', ')}`);
      }

      // Emit step start
      this.nerv.emitEvent({
        actionCode: 'WORKFLOW_STEP_STARTED',
        payload: {
          workflow_id: task.meta.workflow_id,
          step_id: step.id,
          step_index: i,
          total_steps: steps.length
        }
      });

      try {
        // Execute step based on action type
        let stepResult;
        switch (step.action) {
          case 'execute_prompt':
            stepResult = await this._executeStepPrompt(step, workflowState, task);
            break;
          case 'validate':
            stepResult = await this._executeStepValidate(step, workflowState);
            break;
          case 'branch':
            stepResult = await this._executeStepBranch(step, workflowState);
            break;
          case 'spawn_subtask':
            stepResult = await this._executeStepSpawnSubtask(step, workflowState, task);
            break;
          default:
            throw new Error(`Unknown step action: ${step.action}`);
        }

        // Store result in accumulated context
        workflowState.accumulated_context[step.id] = stepResult.output;
        workflowState.results.push(stepResult);
        workflowState.completed_steps.push(step.id);

        // Emit step complete
        this.nerv.emitEvent({
          actionCode: 'WORKFLOW_STEP_COMPLETED',
          payload: {
            workflow_id: task.meta.workflow_id,
            step_id: step.id,
            result_preview: stepResult.output?.substring(0, 200),
            quality_score: stepResult.quality_score
          }
        });

      } catch (error) {
        workflowState.failed_steps.push(step.id);

        // Emit step failed
        this.nerv.emitEvent({
          actionCode: 'WORKFLOW_STEP_FAILED',
          payload: {
            workflow_id: task.meta.workflow_id,
            step_id: step.id,
            error: error.message
          }
        });

        // Handle failure based on policy
        if (step.on_failure === 'abort') {
          throw error;
        } else if (step.on_failure === 'skip') {
          continue;
        } else if (step.on_failure === 'retry') {
          // Retry logic (implement if needed)
        }
      }
    }

    // Aggregate results
    const finalOutput = this._aggregateWorkflowResults(workflowState);
    const totalCost = workflowState.results.reduce((sum, r) => sum + (r.cost_tracking?.cost_usd || 0), 0);
    const avgQualityScore = workflowState.results.reduce((sum, r) => sum + (r.quality_score || 0), 0) / workflowState.results.length;

    return {
      output: finalOutput,
      cost_tracking: {
        cost_usd: totalCost,
        total_tokens: workflowState.results.reduce((sum, r) => sum + (r.cost_tracking?.total_tokens || 0), 0)
      },
      quality_score: avgQualityScore,
      workflow_state: workflowState
    };
  }

  /**
   * Execute step: execute_prompt
   */
  async _executeStepPrompt(step, workflowState, parentTask) {
    // Inject context from previous steps
    let prompt = step.config.prompt;

    // Replace placeholders with accumulated context
    Object.keys(workflowState.accumulated_context).forEach(key => {
      const value = workflowState.accumulated_context[key];
      prompt = prompt.replace(`{${key}}`, value);
    });

    // Create subtask
    const subtask = {
      ...parentTask,
      meta: {
        ...parentTask.meta,
        id: `${parentTask.meta.id}-${step.id}`,
        parent_id: parentTask.meta.id
      },
      spec: {
        ...parentTask.spec,
        payload: {
          user_message: prompt,
          context: workflowState.accumulated_context
        }
      }
    };

    // Execute
    if (step.config.iterative) {
      subtask.spec.execution = {
        strategy: 'ITERATIVE',
        iterative_config: {
          max_iterations: step.config.max_iterations || 3,
          validation_criteria: step.config.validation || {}
        }
      };
    } else {
      subtask.spec.execution = { strategy: 'SINGLE_SHOT' };
    }

    return await this.execute(subtask);
  }

  /**
   * Get driver instance based on target
   */
  async _getDriver(target) {
    const driverFactory = require('../driver/factory');
    return await driverFactory.createDriver(target);
  }

  /**
   * Aggregate workflow results into final output
   */
  _aggregateWorkflowResults(workflowState) {
    // Simple concatenation for now
    // Could be more sophisticated (e.g., structured JSON, markdown sections)
    return workflowState.results.map(r => r.output).join('\n\n---\n\n');
  }

  /**
   * Get workflow state (for dashboard queries)
   */
  getWorkflowState(workflowId) {
    return this.workflowStates.get(workflowId);
  }
}

module.exports = { OrchestratorEngine };
