// src/core/schemas/task_schema_v5.js

const TaskSchemaV5 = z.object({
  meta: z.object({
    id: z.string().uuid(),
    project_id: z.string().default('default'),
    parent_id: z.string().uuid().optional(),       // Hierarchical tasks
    workflow_id: z.string().uuid().optional(),     // Workflow grouping
    correlation_id: z.string().uuid().optional(),
    version: z.literal('5.0'),
    created_at: z.string().datetime(),
    priority: z.number().int().min(0).max(100).default(50),
    source: z.string().default('system'),
    tags: z.array(z.string()).default([])
  }),

  spec: z.object({
    target: z.enum(['chatgpt', 'gemini', 'claude', 'ollama', 'auto']),
    model: z.string().default('AUTO'),
    payload: z.object({
      system_message: z.string().optional(),
      user_message: z.string(),
      context: z.any().optional()              // Previous results, external data
    }),
    parameters: z.object({
      temperature: z.number().min(0).max(2).default(0.7),
      max_tokens: z.number().int().positive().optional(),
      top_p: z.number().min(0).max(1).optional(),
      frequency_penalty: z.number().min(-2).max(2).optional(),
      presence_penalty: z.number().min(-2).max(2).optional(),
      stop_sequences: z.array(z.string()).optional()
    }).optional(),

    // NOVO: Execution configuration
    execution: z.object({
      strategy: z.enum(['SINGLE_SHOT', 'ITERATIVE', 'MULTI_STEP', 'TREE_OF_THOUGHT', 'CHAIN_OF_THOUGHT']).default('SINGLE_SHOT'),

      // For ITERATIVE strategy
      iterative_config: z.object({
        max_iterations: z.number().int().positive().default(3),
        validation_criteria: z.object({
          validators: z.array(z.string()),      // ['regex', 'schema', 'llm_judge']
          min_quality_score: z.number().min(0).max(100).default(70),
          custom_validator: z.any().optional()
        }).optional(),
        convergence_detection: z.boolean().default(true)
      }).optional(),

      // For MULTI_STEP strategy
      workflow_config: z.object({
        steps: z.array(z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().optional(),
          action: z.enum(['execute_prompt', 'validate', 'branch', 'loop', 'spawn_subtask']),
          config: z.any(),                     // Step-specific config
          dependencies: z.array(z.string()).default([]),  // Step IDs that must complete first
          on_failure: z.enum(['retry', 'skip', 'abort']).default('abort')
        })),
        max_subtasks: z.number().int().positive().default(50),
        subtask_concurrency: z.number().int().positive().default(3)
      }).optional(),

      // For TREE_OF_THOUGHT strategy
      tree_config: z.object({
        num_branches: z.number().int().min(2).max(10).default(3),
        evaluation_criteria: z.string(),
        selection_strategy: z.enum(['best', 'combine', 'vote']).default('best')
      }).optional()
    }).default({ strategy: 'SINGLE_SHOT' }),

    // NOVO: Validation rules
    validation: z.object({
      validators: z.array(z.object({
        type: z.enum(['regex', 'schema', 'length', 'format', 'llm_judge', 'custom']),
        config: z.any()
      })).default([]),
      on_validation_failure: z.enum(['retry', 'abort', 'manual_review']).default('retry')
    }).optional(),

    // NOVO: Context management
    context_config: z.object({
      inject_previous_results: z.boolean().default(false),
      context_window_strategy: z.enum(['full', 'chunked', 'summarized']).default('full'),
      max_context_tokens: z.number().int().positive().optional(),
      memory_keys: z.array(z.string()).default([])  // Keys to fetch from long-term memory
    }).optional(),

    // Existing fields (mantidos)
    config: z.object({
      reset_context: z.boolean().default(false),
      require_history: z.boolean().default(false),
      output_format: z.enum(['text', 'json', 'markdown']).default('text')
    }).default({})
  }),

  policy: z.object({
    max_attempts: z.number().int().positive().default(3),
    timeout_ms: z.number().int().positive().optional(),
    dependencies: z.array(z.string().uuid()).default([]),
    execute_after: z.string().datetime().nullable().default(null),
    priority_weight: z.number().default(1.0),

    // NOVO: Workflow policies
    workflow_policy: z.object({
      max_execution_time_ms: z.number().int().positive().optional(),
      budget_limit_usd: z.number().positive().optional(),
      quality_threshold: z.number().min(0).max(100).optional()
    }).optional()
  }),

  state: z.object({
    status: z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED', 'PAUSED']),
    progress_estimate: z.number().min(0).max(100).default(0),
    worker_id: z.string().optional(),
    attempts: z.number().int().nonnegative().default(0),
    started_at: z.string().datetime().nullable().default(null),
    completed_at: z.string().datetime().nullable().default(null),
    paused_at: z.string().datetime().nullable().optional(),
    last_error: z.string().optional(),

    // NOVO: Workflow state
    workflow_state: z.object({
      current_step_index: z.number().int().nonnegative().default(0),
      completed_steps: z.array(z.string()).default([]),
      failed_steps: z.array(z.string()).default([]),
      accumulated_context: z.any().optional()     // Results from previous steps
    }).optional(),

    // NOVO: Iteration state
    iteration_state: z.object({
      current_iteration: z.number().int().nonnegative().default(0),
      iterations_history: z.array(z.object({
        iteration: z.number(),
        output: z.string(),
        quality_score: z.number().optional(),
        validation_result: z.any().optional()
      })).default([])
    }).optional(),

    // NOVO: Quality metrics
    quality_metrics: z.object({
      overall_score: z.number().min(0).max(100).optional(),
      coherence_score: z.number().min(0).max(100).optional(),
      accuracy_score: z.number().min(0).max(100).optional(),
      goal_alignment_score: z.number().min(0).max(100).optional(),
      validation_passed: z.boolean().optional()
    }).optional(),

    // NOVO: Cost tracking
    cost_tracking: z.object({
      input_tokens: z.number().int().nonnegative().default(0),
      output_tokens: z.number().int().nonnegative().default(0),
      total_tokens: z.number().int().nonnegative().default(0),
      cost_usd: z.number().nonnegative().default(0),
      model_used: z.string().optional()
    }).optional(),

    metrics: z.object({
      duration_ms: z.number().int().nonnegative().optional(),
      token_estimate: z.number().int().nonnegative().optional(),
      event_loop_lag_ms: z.number().nonnegative().optional()
    }).default({}),
    history: z.array(z.object({
      type: z.string(),
      at: z.string().datetime(),
      data: z.any().optional(),
      evidence: z.string().optional()
    })).default([])
  }),

  result: z.object({
    file_path: z.string().optional(),
    session_url: z.string().url().optional(),
    finish_reason: z.enum(['stop', 'length', 'content_filter', 'error', 'manual', 'unknown']).default('unknown'),
    raw_output_preview: z.string().optional(),

    // NOVO: Subtask results
    subtask_results: z.array(z.object({
      subtask_id: z.string().uuid(),
      status: z.string(),
      output: z.string().optional(),
      quality_score: z.number().optional()
    })).default([]),

    // NOVO: Validation results
    validation_results: z.array(z.object({
      validator_type: z.string(),
      passed: z.boolean(),
      score: z.number().optional(),
      feedback: z.string().optional()
    })).default([])
  })
});
