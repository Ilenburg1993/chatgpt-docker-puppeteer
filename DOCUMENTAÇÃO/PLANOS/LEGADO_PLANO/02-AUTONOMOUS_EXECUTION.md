# EXECUÇÃO AUTÔNOMA - Detalhamento Técnico

## 1. VISÃO GERAL

A execução autônoma é o **coração** do sistema. Permite que uma missão complexa (ex: escrever um
livro de 300 páginas) execute do começo ao fim com **mínima intervenção humana**, gerando
automaticamente centenas de tasks subordinadas.

### Princípios Fundamentais

1. **Decomposição Automática**: Missão → Workflow → Steps → Tasks (hierarquia automática)
2. **Auto-Correção**: Sistema detecta falhas e corrige automaticamente (retry com feedback)
3. **Context Flow**: Resultados de steps anteriores alimentam steps seguintes
4. **Quality Gates**: Cada output validado antes de prosseguir
5. **Checkpoint Persistence**: Estado salvo continuamente (crash recovery)
6. **Human-in-the-Loop**: Usuário pode intervir a qualquer momento

---

## 2. DECOMPOSIÇÃO HIERÁRQUICA

### 2.1 Nível 1: MISSÃO → WORKFLOW

**Input**: Missão definida pelo usuário

**Output**: Workflow estruturado com steps

**Processo**:

#### Opção A: Workflow Template (Recomendado para tipos comuns)

```javascript
// src/missions/templates/book_writing.json

{
  "template_id": "book-writing-v1",
  "name": "Book Writing Workflow",
  "description": "Autonomous workflow for writing technical books",

  "parameters": {
    "title": { "type": "string", "required": true },
    "topic": { "type": "string", "required": true },
    "num_chapters": { "type": "integer", "default": 15 },
    "target_audience": { "type": "string", "default": "general" },
    "style": { "type": "enum", "values": ["technical", "narrative", "academic"], "default": "technical" },
    "include_code_examples": { "type": "boolean", "default": false },
    "quality_threshold": { "type": "integer", "min": 0, "max": 100, "default": 75 }
  },

  "workflow": {
    "steps": [
      {
        "id": "outline",
        "name": "Generate Book Outline",
        "action": "execute_prompt",
        "prompt_template": "You are an expert technical writer. Generate a comprehensive outline for a book titled '{{title}}' about {{topic}}. The book should have {{num_chapters}} chapters, targeted at {{target_audience}} readers, with a {{style}} style. {{#if include_code_examples}}Include suggestions for code examples in each chapter.{{/if}}\n\nProvide the outline in JSON format:\n{\n  \"chapters\": [\n    {\n      \"number\": 1,\n      \"title\": \"Chapter Title\",\n      \"topics\": [\"topic1\", \"topic2\", ...],\n      \"estimated_pages\": 20\n    },\n    ...\n  ]\n}",
        "output_format": "json",
        "validation": {
          "type": "schema",
          "schema": {
            "type": "object",
            "properties": {
              "chapters": {
                "type": "array",
                "minItems": "{{num_chapters}}",
                "maxItems": "{{num_chapters}}"
              }
            }
          }
        }
      },

      {
        "id": "chapter_loop",
        "name": "Write All Chapters",
        "action": "loop",
        "iterations": "{{num_chapters}}",
        "loop_variable": "chapter_index",
        "loop_body": [
          {
            "id": "write_chapter_{{chapter_index}}",
            "name": "Write Chapter {{chapter_index}}",
            "action": "execute_prompt",
            "prompt_template": "You are writing Chapter {{chapter_index}} of the book '{{title}}'.\n\nChapter Title: {{outline.chapters[{{chapter_index}}].title}}\nTopics to cover: {{outline.chapters[{{chapter_index}}].topics}}\nTarget length: {{outline.chapters[{{chapter_index}}].estimated_pages}} pages (~{{multiply outline.chapters[{{chapter_index}}].estimated_pages 500}} words)\n\n{{#if gt chapter_index 0}}\nContext from previous chapters:\n{{#each (slice accumulated_results.chapters 0 chapter_index)}}\nChapter {{@index}}: {{this.summary}}\n{{/each}}\n{{/if}}\n\n{{#if user_feedback_for_chapters}}\nUser feedback to incorporate:\n{{user_feedback_for_chapters}}\n{{/if}}\n\nWrite the complete chapter now. {{#if include_code_examples}}Include practical code examples where appropriate.{{/if}} Maintain consistency with previous chapters.",
            "iterative": true,
            "max_iterations": 3,
            "validation": {
              "type": "llm_judge",
              "criteria": [
                "coherence",
                "accuracy",
                "{{#if include_code_examples}}code_examples_present{{/if}}",
                "readability",
                "topic_coverage"
              ],
              "min_score": "{{quality_threshold}}",
              "judge_prompt": "Evaluate this book chapter on the following criteria:\n- Coherence (logical flow, clear structure)\n- Accuracy (technical correctness)\n{{#if include_code_examples}}- Code Examples (practical, working code){{/if}}\n- Readability (clear language, appropriate for {{target_audience}})\n- Topic Coverage (all required topics addressed)\n\nChapter:\n---\n{{output}}\n---\n\nProvide evaluation as JSON:\n{\n  \"overall_score\": 0-100,\n  \"criteria_scores\": {\n    \"coherence\": 0-100,\n    \"accuracy\": 0-100,\n    ...\n  },\n  \"strengths\": [\"list\"],\n  \"weaknesses\": [\"list\"],\n  \"suggestions\": [\"list\"]\n}"
            },
            "on_validation_failure": "retry_with_feedback",
            "output_processing": {
              "save_to": "missions/{{mission_id}}/chapters/chapter-{{chapter_index}}.md",
              "extract_summary": "Use LLM to generate 2-3 sentence summary of this chapter for context in future chapters"
            }
          }
        ]
      },

      {
        "id": "consistency_check",
        "name": "Cross-Chapter Consistency Check",
        "action": "execute_prompt",
        "dependencies": ["chapter_loop"],
        "prompt_template": "You are a technical editor reviewing a book for consistency. Review all {{num_chapters}} chapters of '{{title}}' and identify any inconsistencies, contradictions, or stylistic discrepancies.\n\nChapters:\n{{#each accumulated_results.chapters}}\nChapter {{@index}}: {{this.title}}\n{{this.text}}\n---\n{{/each}}\n\nProvide your analysis as JSON:\n{\n  \"inconsistencies\": [\n    {\n      \"type\": \"contradiction\" | \"style\" | \"terminology\" | \"other\",\n      \"chapters_affected\": [1, 5],\n      \"description\": \"...\",\n      \"suggested_fix\": \"...\"\n    }\n  ],\n  \"overall_consistency_score\": 0-100\n}",
        "output_format": "json"
      },

      {
        "id": "fix_inconsistencies",
        "name": "Fix Identified Inconsistencies",
        "action": "branch",
        "condition": "{{gt consistency_check.inconsistencies.length 0}}",
        "if_true": {
          "action": "loop",
          "iterations": "{{consistency_check.inconsistencies.length}}",
          "loop_variable": "issue_index",
          "loop_body": [
            {
              "id": "fix_issue_{{issue_index}}",
              "action": "execute_prompt",
              "prompt_template": "Fix the following inconsistency in the book:\n\nIssue: {{consistency_check.inconsistencies[{{issue_index}}].description}}\nChapters affected: {{consistency_check.inconsistencies[{{issue_index}}].chapters_affected}}\nSuggested fix: {{consistency_check.inconsistencies[{{issue_index}}].suggested_fix}}\n\nRewrite the affected sections to resolve this inconsistency. Provide only the corrected sections."
            }
          ]
        },
        "if_false": {
          "action": "log",
          "message": "No inconsistencies found, skipping fixes"
        }
      },

      {
        "id": "generate_toc",
        "name": "Generate Table of Contents",
        "action": "execute_prompt",
        "dependencies": ["fix_inconsistencies"],
        "prompt_template": "Generate a professional table of contents for the book '{{title}}'.\n\nChapters:\n{{#each outline.chapters}}\nChapter {{this.number}}: {{this.title}}\n{{/each}}\n\nFormat as markdown with page numbers (estimate 500 words per page)."
      },

      {
        "id": "compile_final_book",
        "name": "Compile Final Book",
        "action": "compile",
        "format": "markdown",
        "sections": [
          "{{generate_toc.output}}",
          "{{#each accumulated_results.chapters}}{{this.text}}\n\n{{/each}}"
        ],
        "output_file": "missions/{{mission_id}}/final-book.md"
      }
    ]
  },

  "post_processing": {
    "generate_summary": true,
    "generate_metadata": true,
    "export_formats": ["markdown", "pdf", "html"]
  }
}
```

#### Opção B: LLM-Generated Workflow (Para missões customizadas)

```javascript
// src/missions/workflow_generator.js

class WorkflowGenerator {
  async generateWorkflow(mission) {
    const prompt = `
You are an expert AI orchestration planner. Given a mission description, generate a detailed workflow with steps to accomplish it.

Mission:
Title: ${mission.title}
Type: ${mission.type}
Description: ${mission.description}
Quality Criteria: ${JSON.stringify(mission.quality_criteria)}
Budget: $${mission.budget.limit_usd}

Generate a workflow as JSON with this structure:
{
  "steps": [
    {
      "id": "unique-step-id",
      "name": "Human-readable step name",
      "action": "execute_prompt" | "loop" | "branch" | "validate",
      "prompt_template": "Prompt template with {{placeholders}}",
      "dependencies": ["step-id-1", "step-id-2"],
      "iterative": boolean,
      "max_iterations": number,
      "validation": {
        "type": "llm_judge",
        "criteria": ["criterion1", "criterion2"],
        "min_score": 70
      },
      "on_failure": "retry" | "skip" | "abort"
    }
  ]
}

Important:
- Break down the mission into logical, sequential steps
- Each step should be atomic (do ONE thing)
- Use iterative execution for steps that may need refinement
- Add validation for quality-critical steps
- Use dependencies to enforce execution order
- Use loops for repetitive tasks (e.g., writing multiple chapters)
- Use branches for conditional logic
`;

    const driver = await DriverFactory.createDriver('chatgpt');
    const result = await driver.execute({
      spec: {
        target: 'chatgpt',
        model: 'gpt-4o',
        payload: {
          system_message: 'You are an expert workflow designer',
          user_message: prompt,
        },
        parameters: {
          temperature: 0.3, // Lower temp for consistent structure
          response_format: { type: 'json_object' },
        },
      },
    });

    const workflow = JSON.parse(result.output);

    // Validate workflow structure
    await this.validateWorkflow(workflow);

    return workflow;
  }

  async validateWorkflow(workflow) {
    // Check all steps have required fields
    // Check dependencies are valid (no cycles)
    // Check prompt templates have valid placeholders
    // Check validation configs are correct
    // etc.
  }
}
```

### 2.2 Nível 2: WORKFLOW → STEPS

**Input**: Workflow estruturado

**Output**: Lista de steps com dependências resolvidas

**Processo**:

```javascript
// src/missions/mission_executor.js

class MissionExecutor {
  async executeWorkflow(mission, workflow) {
    const missionState = await this.initializeMissionState(mission);

    // Build dependency graph
    const stepGraph = this.buildDependencyGraph(workflow.steps);

    // Execute steps in topological order
    const executionOrder = this.topologicalSort(stepGraph);

    for (const stepId of executionOrder) {
      const step = workflow.steps.find(s => s.id === stepId);

      // Check if user paused
      if (await this.checkPaused(mission.id)) {
        await this.waitForResume(mission.id);
      }

      // Check if user modified workflow
      if (await this.checkWorkflowModified(mission.id)) {
        workflow = await this.reloadWorkflow(mission.id);
        // Recalculate execution order
        // ...
      }

      // Execute step
      const stepResult = await this.executeStep(step, missionState);

      // Update mission state
      missionState.completed_steps.push(stepId);
      missionState.accumulated_results[stepId] = stepResult;
      missionState.progress_percent = this.calculateProgress(missionState);

      // Save checkpoint
      await this.saveCheckpoint(mission.id, missionState);

      // Emit progress event
      this.nerv.emit('MISSION_PROGRESS', {
        mission_id: mission.id,
        step_id: stepId,
        step_name: step.name,
        progress_percent: missionState.progress_percent,
      });

      // Check user feedback
      const feedback = await this.checkUserFeedback(mission.id);
      if (feedback) {
        await this.applyFeedback(feedback, missionState);
      }
    }

    // Mission completed
    await this.finalizeMission(mission.id, missionState);
  }

  buildDependencyGraph(steps) {
    const graph = new Map();

    steps.forEach(step => {
      graph.set(step.id, {
        step,
        dependencies: step.dependencies || [],
        dependents: [],
      });
    });

    // Build reverse edges (dependents)
    steps.forEach(step => {
      (step.dependencies || []).forEach(depId => {
        if (graph.has(depId)) {
          graph.get(depId).dependents.push(step.id);
        }
      });
    });

    return graph;
  }

  topologicalSort(graph) {
    // Kahn's algorithm for topological sorting
    const inDegree = new Map();
    const queue = [];
    const result = [];

    // Calculate in-degrees
    graph.forEach((node, id) => {
      inDegree.set(id, node.dependencies.length);
      if (node.dependencies.length === 0) {
        queue.push(id);
      }
    });

    while (queue.length > 0) {
      const current = queue.shift();
      result.push(current);

      const currentNode = graph.get(current);
      currentNode.dependents.forEach(dependent => {
        inDegree.set(dependent, inDegree.get(dependent) - 1);
        if (inDegree.get(dependent) === 0) {
          queue.push(dependent);
        }
      });
    }

    // Check for cycles
    if (result.length !== graph.size) {
      throw new Error('Workflow contains cycles (circular dependencies)');
    }

    return result;
  }
}
```

### 2.3 Nível 3: STEPS → TASKS

**Input**: Step individual

**Output**: 1 ou mais tasks

**Processo**:

```javascript
async executeStep(step, missionState) {
  switch (step.action) {
    case 'execute_prompt':
      return await this.executePromptStep(step, missionState);

    case 'loop':
      return await this.executeLoopStep(step, missionState);

    case 'branch':
      return await this.executeBranchStep(step, missionState);

    case 'validate':
      return await this.executeValidateStep(step, missionState);

    case 'compile':
      return await this.executeCompileStep(step, missionState);

    default:
      throw new Error(`Unknown step action: ${step.action}`);
  }
}

async executePromptStep(step, missionState) {
  // Render prompt template with current context
  const prompt = this.renderTemplate(step.prompt_template, {
    ...missionState.accumulated_results,
    mission_id: missionState.mission_id,
    user_feedback: missionState.user_feedback
  });

  // Create task
  const task = this.createTask({
    mission_id: missionState.mission_id,
    step_id: step.id,
    prompt: prompt,
    iterative: step.iterative,
    max_iterations: step.max_iterations,
    validation: step.validation,
    output_format: step.output_format
  });

  // Execute task
  let result;
  if (step.iterative) {
    result = await this.executeIterativeTask(task);
  } else {
    result = await this.executeSingleTask(task);
  }

  // Post-processing
  if (step.output_processing) {
    result = await this.postProcessOutput(result, step.output_processing, missionState);
  }

  return result;
}

async executeLoopStep(step, missionState) {
  const results = [];
  const iterations = this.evaluateExpression(step.iterations, missionState.accumulated_results);

  for (let i = 0; i < iterations; i++) {
    // Create loop context
    const loopContext = {
      ...missionState,
      [step.loop_variable]: i
    };

    // Execute loop body steps
    for (const bodyStep of step.loop_body) {
      const stepResult = await this.executeStep(bodyStep, loopContext);
      results.push(stepResult);

      // Update loop context with result
      loopContext.accumulated_results[bodyStep.id] = stepResult;
    }

    // Emit loop progress
    this.nerv.emit('MISSION_LOOP_PROGRESS', {
      mission_id: missionState.mission_id,
      step_id: step.id,
      iteration: i + 1,
      total_iterations: iterations
    });
  }

  return { results, total_iterations: iterations };
}
```

---

## 3. AUTO-CORREÇÃO E ITERAÇÃO

### 3.1 Iterative Execution Pattern

```javascript
async executeIterativeTask(task) {
  let iteration = 0;
  let bestResult = null;
  let bestScore = 0;
  const history = [];

  while (iteration < task.max_iterations) {
    iteration++;

    // Emit iteration start
    this.nerv.emit('ITERATION_STARTED', {
      mission_id: task.mission_id,
      step_id: task.step_id,
      iteration,
      max_iterations: task.max_iterations
    });

    // Execute LLM call
    const driver = await DriverFactory.createDriver(task.target || 'chatgpt');
    const result = await driver.execute({
      spec: {
        target: task.target || 'chatgpt',
        model: task.model || 'gpt-4o',
        payload: {
          user_message: task.prompt,
          context: task.context
        },
        parameters: task.parameters || {}
      }
    });

    // Validate output
    const validation = await this.validateOutput(result.output, task.validation);

    // Save to history
    history.push({
      iteration,
      output: result.output,
      quality_score: validation.overall_score,
      validation_passed: validation.passed,
      issues: validation.issues
    });

    // Emit iteration complete
    this.nerv.emit('ITERATION_COMPLETED', {
      mission_id: task.mission_id,
      step_id: task.step_id,
      iteration,
      quality_score: validation.overall_score,
      validation_passed: validation.passed
    });

    // Track best result
    if (validation.overall_score > bestScore) {
      bestResult = result;
      bestScore = validation.overall_score;
    }

    // Check if passed
    if (validation.passed && validation.overall_score >= (task.validation.min_score || 70)) {
      // Success!
      return {
        output: result.output,
        quality_score: validation.overall_score,
        iterations: iteration,
        converged: true,
        history
      };
    }

    // Prepare feedback for next iteration
    if (iteration < task.max_iterations) {
      // Inject feedback into prompt
      task.prompt += `\n\n---\n[Feedback from iteration ${iteration}]:\nQuality Score: ${validation.overall_score}/100\n\nIssues identified:\n${validation.issues.map(i => `- ${i}`).join('\n')}\n\nSuggestions:\n${validation.suggestions.map(s => `- ${s}`).join('\n')}\n\nPlease improve your response addressing these issues.`;

      // Also update context
      task.context = {
        ...task.context,
        previous_attempt: result.output,
        previous_score: validation.overall_score,
        issues: validation.issues
      };
    }
  }

  // Max iterations reached, return best attempt
  this.nerv.emit('ITERATION_EXHAUSTED', {
    mission_id: task.mission_id,
    step_id: task.step_id,
    max_iterations: task.max_iterations,
    best_score: bestScore
  });

  return {
    output: bestResult.output,
    quality_score: bestScore,
    iterations: task.max_iterations,
    converged: false,
    history
  };
}
```

### 3.2 Validation System

```javascript
async validateOutput(output, validationConfig) {
  if (!validationConfig) {
    return { passed: true, overall_score: 100, issues: [], suggestions: [] };
  }

  const validators = validationConfig.type === 'multiple'
    ? validationConfig.validators
    : [{ type: validationConfig.type, config: validationConfig }];

  const results = [];

  for (const validatorConfig of validators) {
    const validator = ValidationService.getValidator(validatorConfig.type);
    const result = await validator.validate(output, validatorConfig.config || validatorConfig);
    results.push(result);
  }

  // Aggregate results
  const overallScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  const allPassed = results.every(r => r.passed);
  const passed = allPassed && overallScore >= (validationConfig.min_score || 70);

  const issues = results
    .filter(r => !r.passed)
    .flatMap(r => r.issues || [r.feedback]);

  const suggestions = results
    .flatMap(r => r.suggestions || []);

  return {
    passed,
    overall_score: overallScore,
    results,
    issues,
    suggestions,
    feedback: this.generateFeedback(results, overallScore)
  };
}

generateFeedback(results, overallScore) {
  if (results.every(r => r.passed)) {
    return `Excellent! All validation criteria met. Overall score: ${overallScore}/100`;
  }

  const failed = results.filter(r => !r.passed);
  return `Quality score: ${overallScore}/100. ${failed.length} criteria failed:\n${failed.map(r => `- ${r.feedback}`).join('\n')}`;
}
```

---

## 4. CONTEXT MANAGEMENT

### 4.1 Context Accumulation

```javascript
class ContextManager {
  constructor() {
    this.contexts = new Map(); // mission_id → context
  }

  initializeContext(missionId) {
    this.contexts.set(missionId, {
      mission_id: missionId,
      accumulated_results: {},
      user_feedback: [],
      iteration_contexts: {},
      memory: {},
    });
  }

  addStepResult(missionId, stepId, result) {
    const context = this.contexts.get(missionId);
    context.accumulated_results[stepId] = result;

    // Extract key information for future steps
    if (result.summary) {
      context.accumulated_results[`${stepId}_summary`] = result.summary;
    }
  }

  addUserFeedback(missionId, stepId, feedback) {
    const context = this.contexts.get(missionId);
    context.user_feedback.push({
      step_id: stepId,
      feedback: feedback,
      timestamp: Date.now(),
    });
  }

  getContextForStep(missionId, stepId, stepConfig) {
    const context = this.contexts.get(missionId);

    // Build context based on step dependencies
    const relevantContext = {};

    if (stepConfig.dependencies) {
      stepConfig.dependencies.forEach(depId => {
        if (context.accumulated_results[depId]) {
          relevantContext[depId] = context.accumulated_results[depId];
        }
      });
    }

    // Add user feedback if applicable
    const relevantFeedback = context.user_feedback.filter(
      f => !stepConfig.dependencies || stepConfig.dependencies.includes(f.step_id)
    );

    return {
      ...relevantContext,
      user_feedback: relevantFeedback,
      mission_id: missionId,
    };
  }

  /**
   * Context Chunking (for large contexts that exceed token limits)
   */
  async chunkContext(context, maxTokens = 8000) {
    const chunks = [];
    let currentChunk = {};
    let currentTokens = 0;

    for (const [key, value] of Object.entries(context)) {
      const valueTokens = this.estimateTokens(JSON.stringify(value));

      if (currentTokens + valueTokens > maxTokens) {
        // Start new chunk
        chunks.push(currentChunk);
        currentChunk = {};
        currentTokens = 0;
      }

      currentChunk[key] = value;
      currentTokens += valueTokens;
    }

    if (Object.keys(currentChunk).length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * Context Summarization (reduce context size while preserving key info)
   */
  async summarizeContext(context, targetTokens = 2000) {
    const prompt = `Summarize the following context, preserving the most important information:\n\n${JSON.stringify(context, null, 2)}\n\nTarget length: ~${targetTokens} tokens. Focus on key facts, decisions, and outcomes.`;

    const driver = await DriverFactory.createDriver('chatgpt');
    const result = await driver.execute({
      spec: {
        target: 'chatgpt',
        model: 'gpt-4o',
        payload: { user_message: prompt },
        parameters: { max_tokens: targetTokens },
      },
    });

    return result.output;
  }

  estimateTokens(text) {
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }
}
```

### 4.2 Long-Term Memory

```javascript
class MemoryStore {
  /**
   * Store facts learned during mission execution
   * Ex: "User prefers concise explanations", "Code style: snake_case"
   */
  async storeFact(missionId, key, value, source) {
    const fact = {
      mission_id: missionId,
      key: key,
      value: value,
      source: source, // 'user_feedback', 'llm_observation', 'validation_result'
      stored_at: Date.now(),
    };

    await this.saveToDisk(`memory/${missionId}/${key}.json`, fact);

    // Also keep in memory for fast access
    this.memoryCache.set(`${missionId}:${key}`, fact);
  }

  async retrieveFacts(missionId, keys) {
    const facts = {};

    for (const key of keys) {
      const fact = this.memoryCache.get(`${missionId}:${key}`);
      if (fact) {
        facts[key] = fact.value;
      } else {
        // Load from disk if not in cache
        const fact = await this.loadFromDisk(`memory/${missionId}/${key}.json`);
        if (fact) {
          facts[key] = fact.value;
          this.memoryCache.set(`${missionId}:${key}`, fact);
        }
      }
    }

    return facts;
  }

  /**
   * Extract learnable facts from user feedback
   */
  async extractFactsFromFeedback(feedback) {
    const prompt = `Analyze the following user feedback and extract any facts, preferences, or style guidelines that should be remembered for future steps:\n\nFeedback: "${feedback}"\n\nExtract facts as JSON array:\n[\n  { "key": "preference_code_style", "value": "snake_case", "confidence": 0.9 },\n  { "key": "tone", "value": "concise", "confidence": 0.8 },\n  ...\n]`;

    const driver = await DriverFactory.createDriver('chatgpt');
    const result = await driver.execute({
      spec: {
        target: 'chatgpt',
        model: 'gpt-4o',
        payload: { user_message: prompt },
        parameters: { response_format: { type: 'json_object' } },
      },
    });

    const facts = JSON.parse(result.output);

    return facts.filter(f => f.confidence > 0.7); // Only high-confidence facts
  }
}
```

---

## 5. CHECKPOINT & CRASH RECOVERY

### 5.1 Checkpoint System

```javascript
class CheckpointManager {
  async saveCheckpoint(missionId, missionState) {
    const checkpoint = {
      mission_id: missionId,
      timestamp: Date.now(),
      state: missionState,
      checkpoint_version: '1.0',
    };

    // Save to disk (atomic write)
    const checkpointPath = `missions/${missionId}/checkpoints/checkpoint-${Date.now()}.json`;
    await this.atomicWrite(checkpointPath, checkpoint);

    // Also update "latest" checkpoint
    await this.atomicWrite(`missions/${missionId}/checkpoint-latest.json`, checkpoint);

    // Emit checkpoint event
    this.nerv.emit('MISSION_CHECKPOINT_SAVED', {
      mission_id: missionId,
      checkpoint_path: checkpointPath,
      progress_percent: missionState.progress_percent,
    });

    // Cleanup old checkpoints (keep last 10)
    await this.cleanupOldCheckpoints(missionId, 10);
  }

  async loadLatestCheckpoint(missionId) {
    const checkpointPath = `missions/${missionId}/checkpoint-latest.json`;

    if (await this.fileExists(checkpointPath)) {
      const checkpoint = await this.loadFromDisk(checkpointPath);
      return checkpoint.state;
    }

    return null;
  }

  async recoverFromCrash(missionId) {
    console.log(`[RECOVERY] Attempting to recover mission ${missionId} from crash...`);

    // Load latest checkpoint
    const state = await this.loadLatestCheckpoint(missionId);

    if (!state) {
      console.error(`[RECOVERY] No checkpoint found for mission ${missionId}`);
      return null;
    }

    console.log(`[RECOVERY] Checkpoint found at ${state.progress_percent}% progress`);

    // Verify checkpoint integrity
    const isValid = await this.verifyCheckpoint(state);
    if (!isValid) {
      console.error(`[RECOVERY] Checkpoint corrupted, cannot recover`);
      return null;
    }

    // Reload mission from database
    const mission = await Mission.findById(missionId);

    // Resume from checkpoint
    mission.status = 'RUNNING';
    mission.resumed_at = Date.now();
    mission.recovery_count = (mission.recovery_count || 0) + 1;
    await mission.save();

    // Emit recovery event
    this.nerv.emit('MISSION_RECOVERED', {
      mission_id: missionId,
      recovery_point: state.current_step_id,
      progress_percent: state.progress_percent,
    });

    // Resume execution
    await this.missionExecutor.resumeExecution(mission, state);

    return state;
  }

  async verifyCheckpoint(state) {
    // Check required fields exist
    if (!state.mission_id || !state.current_step_index || !state.accumulated_results) {
      return false;
    }

    // Check accumulated results are valid
    for (const [stepId, result] of Object.entries(state.accumulated_results)) {
      if (!result || !result.output) {
        console.warn(`[RECOVERY] Result for step ${stepId} is incomplete`);
        // Could attempt to regenerate missing results
      }
    }

    return true;
  }
}
```

### 5.2 Resume from Checkpoint

```javascript
async resumeExecution(mission, checkpointState) {
  console.log(`[RESUME] Resuming mission ${mission.id} from step ${checkpointState.current_step_index}`);

  // Reload workflow
  const workflow = mission.workflow;

  // Skip already completed steps
  const remainingSteps = workflow.steps.slice(checkpointState.current_step_index);

  // Continue execution
  for (const step of remainingSteps) {
    // Same execution logic as executeWorkflow()
    // ...
  }
}
```

---

## 6. QUALITY GATES & APPROVAL FLOW

### 6.1 Quality Threshold Enforcement

```javascript
async enforceQualityGate(stepResult, qualityThreshold) {
  if (stepResult.quality_score < qualityThreshold) {
    // Emit quality alert
    this.nerv.emit('MISSION_QUALITY_ALERT', {
      mission_id: stepResult.mission_id,
      step_id: stepResult.step_id,
      quality_score: stepResult.quality_score,
      threshold: qualityThreshold,
      issues: stepResult.validation_issues
    });

    // Check mission policy
    const mission = await Mission.findById(stepResult.mission_id);

    if (mission.quality_policy.auto_retry) {
      // Auto-retry
      console.log(`[QUALITY] Auto-retrying step ${stepResult.step_id} due to low quality (${stepResult.quality_score}/${qualityThreshold})`);
      return { action: 'retry', reason: 'quality_below_threshold' };
    }

    if (mission.quality_policy.require_approval) {
      // Require user approval
      console.log(`[QUALITY] Requesting user approval for step ${stepResult.step_id}`);

      // Emit approval request
      this.nerv.emit('MISSION_APPROVAL_REQUIRED', {
        mission_id: stepResult.mission_id,
        step_id: stepResult.step_id,
        reason: 'quality_below_threshold',
        quality_score: stepResult.quality_score,
        threshold: qualityThreshold,
        output_preview: stepResult.output.substring(0, 500)
      });

      // Wait for user decision
      const decision = await this.waitForUserDecision(stepResult.mission_id, stepResult.step_id);

      return decision; // { action: 'approve' | 'reject' | 'retry' | 'edit' }
    }

    // Default: accept output despite low quality
    console.warn(`[QUALITY] Accepting low-quality output for step ${stepResult.step_id} (no retry policy)`);
    return { action: 'accept', reason: 'no_retry_policy' };
  }

  // Quality passed
  return { action: 'accept', reason: 'quality_passed' };
}
```

---

## 7. COST TRACKING & BUDGET MANAGEMENT

```javascript
class CostController {
  async checkBudget(missionId, estimatedCost) {
    const mission = await Mission.findById(missionId);
    const currentSpend = mission.metrics.total_cost_usd;
    const budgetLimit = mission.budget.limit_usd;

    const projectedSpend = currentSpend + estimatedCost;

    if (projectedSpend > budgetLimit) {
      // Budget exceeded
      this.nerv.emit('MISSION_BUDGET_EXCEEDED', {
        mission_id: missionId,
        current_spend: currentSpend,
        estimated_cost: estimatedCost,
        projected_spend: projectedSpend,
        budget_limit: budgetLimit,
      });

      // Pause mission
      await this.pauseMission(missionId, 'budget_exceeded');

      return false; // Do not proceed
    }

    if (projectedSpend > budgetLimit * 0.8) {
      // Warning threshold (80%)
      this.nerv.emit('MISSION_BUDGET_WARNING', {
        mission_id: missionId,
        current_spend: currentSpend,
        budget_limit: budgetLimit,
        percent_used: (projectedSpend / budgetLimit) * 100,
      });
    }

    return true; // OK to proceed
  }

  async recordCost(missionId, stepId, cost) {
    const mission = await Mission.findById(missionId);

    mission.metrics.total_cost_usd += cost.cost_usd;
    mission.metrics.total_tokens += cost.total_tokens;

    // Save cost breakdown per step
    if (!mission.cost_breakdown) {
      mission.cost_breakdown = {};
    }
    mission.cost_breakdown[stepId] = cost;

    await mission.save();

    // Emit cost event
    this.nerv.emit('TOKEN_USAGE_RECORDED', {
      mission_id: missionId,
      step_id: stepId,
      input_tokens: cost.input_tokens,
      output_tokens: cost.output_tokens,
      cost_usd: cost.cost_usd,
      model: cost.model,
    });
  }
}
```

---

## 8. ARQUIVOS CRÍTICOS

### Backend

```
src/missions/
├── mission_executor.js          # Executa workflows (CORE)
├── step_executor.js             # Executa steps individuais
├── task_generator.js            # Decompõe steps em tasks
├── checkpoint_manager.js        # Checkpoint & recovery
├── context_manager.js           # Context accumulation & chunking
├── memory_store.js              # Long-term memory
├── cost_controller.js           # Budget tracking & enforcement
└── workflow_generator.js        # LLM-powered workflow generation

src/missions/templates/
├── book_writing.json
├── software_development.json
├── research_report.json
└── code_refactoring.json
```

---

**Próximo documento**: `03-FEEDBACK_LOOPS.md` - Sistema de feedback contínuo entre usuário e LLM
