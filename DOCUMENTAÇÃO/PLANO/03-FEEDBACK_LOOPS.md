# FEEDBACK LOOPS - Sistema de Feedback Contínuo

## 1. VISÃO GERAL

O sistema de feedback loops é o que torna o sistema verdadeiramente **adaptativo** e **colaborativo**. Permite que:
1. **Usuário** supervisione execução e dê feedback em tempo real
2. **LLM** auto-avalie seus outputs e refine automaticamente
3. **Sistema** aprenda padrões e preferências do usuário

### Tipos de Feedback

```
┌────────────────────────────────────────────────────────────────┐
│                    TIPOS DE FEEDBACK                            │
├────────────────────────────────────────────────────────────────┤
│ 1. FEEDBACK AUTOMÁTICO (LLM→LLM)                               │
│    - LLM-as-judge avalia output                                │
│    - Validation rules (regex, schema)                          │
│    - Iteração automática até atingir qualidade                │
│                                                                 │
│ 2. FEEDBACK DO USUÁRIO (Human→LLM)                             │
│    - Texto livre: "Adicione mais exemplos"                    │
│    - Aprovação/rejeição: thumbs up/down                       │
│    - Edição direta: usuário corrige output                    │
│                                                                 │
│ 3. FEEDBACK ESTRUTURAL (System→LLM)                            │
│    - Testes automatizados (código falha/passa)                │
│    - Métricas de qualidade (readability scores)               │
│    - Budget constraints (custo excedido)                       │
│                                                                 │
│ 4. FEEDBACK CONTEXTUAL (LLM→LLM)                               │
│    - Outputs anteriores informam próximas iterações           │
│    - Padrões detectados ("usuário prefere estilo X")          │
│    - Aprendizado incremental ao longo da missão               │
└────────────────────────────────────────────────────────────────┘
```

---

## 2. FEEDBACK AUTOMÁTICO (LLM→LLM)

### 2.1 LLM-as-Judge Pattern

**Conceito**: Uma LLM avalia o output de outra LLM

```javascript
// src/orchestrator/validation/llm_judge_validator.js

class LLMJudgeValidator {
  async validate(output, criteria) {
    const judgePrompt = this.constructJudgePrompt(output, criteria);

    // Call judge LLM
    const driver = await DriverFactory.createDriver('chatgpt');
    const evaluation = await driver.execute({
      spec: {
        target: 'chatgpt',
        model: 'gpt-4o',  // Use most capable model for judging
        payload: {
          system_message: 'You are an expert evaluator. Provide objective, constructive assessments.',
          user_message: judgePrompt
        },
        parameters: {
          temperature: 0.2,  // Low temp for consistency
          response_format: { type: 'json_object' }
        }
      }
    });

    const result = JSON.parse(evaluation.output);

    return {
      passed: result.overall_score >= criteria.min_score,
      score: result.overall_score,
      criteria_scores: result.criteria_scores,
      strengths: result.strengths,
      weaknesses: result.weaknesses,
      suggestions: result.suggestions,
      feedback: this.generateDetailedFeedback(result)
    };
  }

  constructJudgePrompt(output, criteria) {
    return `
Evaluate the following output against these criteria:

${criteria.criteria.map((c, i) => `${i + 1}. **${c}**: ${criteria.criteria_descriptions?.[c] || 'Evaluate quality'}`).join('\n')}

**Output to evaluate:**
"""
${output}
"""

**Evaluation Instructions:**
- Score each criterion from 0-100
- Provide an overall score (weighted average)
- List 2-3 specific strengths
- List 2-3 specific weaknesses
- Provide 2-3 actionable suggestions for improvement

**Response Format (JSON):**
{
  "overall_score": 0-100,
  "criteria_scores": {
    "${criteria.criteria[0]}": 0-100,
    "${criteria.criteria[1]}": 0-100,
    ...
  },
  "strengths": ["specific strength 1", "specific strength 2"],
  "weaknesses": ["specific weakness 1", "specific weakness 2"],
  "suggestions": ["actionable suggestion 1", "actionable suggestion 2"]
}

Be specific in your feedback. Instead of "needs improvement", say "Add 2-3 concrete code examples showing X pattern".
`;
  }

  generateDetailedFeedback(evaluation) {
    let feedback = `Quality Score: ${evaluation.overall_score}/100\n\n`;

    feedback += `**Strengths:**\n${evaluation.strengths.map(s => `✓ ${s}`).join('\n')}\n\n`;

    if (evaluation.weaknesses.length > 0) {
      feedback += `**Weaknesses:**\n${evaluation.weaknesses.map(w => `✗ ${w}`).join('\n')}\n\n`;
    }

    if (evaluation.suggestions.length > 0) {
      feedback += `**Suggestions for Improvement:**\n${evaluation.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    }

    return feedback;
  }
}
```

### 2.2 Multi-Stage Validation

```javascript
class ValidationPipeline {
  /**
   * Execute multiple validators in sequence
   * Each validator refines the output before next validator
   */
  async validatePipeline(output, pipelineConfig) {
    let currentOutput = output;
    const pipelineResults = [];

    for (const stage of pipelineConfig.stages) {
      const validator = ValidationService.getValidator(stage.type);
      const result = await validator.validate(currentOutput, stage.config);

      pipelineResults.push({
        stage: stage.name,
        passed: result.passed,
        score: result.score,
        feedback: result.feedback
      });

      // If failed and refinement enabled, refine output
      if (!result.passed && stage.auto_refine) {
        currentOutput = await this.refineOutput(
          currentOutput,
          result.feedback,
          stage.refine_prompt
        );
      } else if (!result.passed) {
        // Fail fast
        break;
      }
    }

    const overallPassed = pipelineResults.every(r => r.passed);
    const avgScore = pipelineResults.reduce((sum, r) => sum + r.score, 0) / pipelineResults.length;

    return {
      passed: overallPassed,
      overall_score: avgScore,
      pipeline_results: pipelineResults,
      final_output: currentOutput
    };
  }

  async refineOutput(output, feedback, refinePrompt) {
    const prompt = refinePrompt
      .replace('{{output}}', output)
      .replace('{{feedback}}', feedback);

    const driver = await DriverFactory.createDriver('chatgpt');
    const result = await driver.execute({
      spec: {
        target: 'chatgpt',
        model: 'gpt-4o',
        payload: { user_message: prompt }
      }
    });

    return result.output;
  }
}
```

**Example Pipeline Config**:
```json
{
  "stages": [
    {
      "name": "syntax_check",
      "type": "regex",
      "config": {
        "pattern": "^Chapter \\d+:",
        "error_message": "Chapter must start with 'Chapter N:'"
      },
      "auto_refine": true,
      "refine_prompt": "Fix the following output to match the required format:\n{{output}}\n\nIssue: {{feedback}}"
    },
    {
      "name": "length_check",
      "type": "length",
      "config": {
        "min_words": 2000,
        "max_words": 4000
      },
      "auto_refine": false
    },
    {
      "name": "quality_check",
      "type": "llm_judge",
      "config": {
        "criteria": ["coherence", "accuracy", "code_examples"],
        "min_score": 75
      },
      "auto_refine": true,
      "refine_prompt": "Improve the following chapter based on this feedback:\n\nChapter:\n{{output}}\n\nFeedback:\n{{feedback}}\n\nProvide improved version."
    }
  ]
}
```

### 2.3 Self-Critique Loop

```javascript
/**
 * LLM critiques its own output, then refines based on self-critique
 */
class SelfCritiqueLoop {
  async executeSelfCritique(initialOutput, critiquePrompt, maxRounds = 2) {
    let currentOutput = initialOutput;
    const history = [{ round: 0, output: initialOutput, critique: null }];

    for (let round = 1; round <= maxRounds; round++) {
      // Step 1: LLM critiques its own output
      const critique = await this.generateCritique(currentOutput, critiquePrompt);

      // Step 2: LLM refines based on critique
      const refined = await this.refineBasedOnCritique(currentOutput, critique);

      history.push({ round, output: refined, critique });

      // Check if quality improved
      const improvement = await this.assessImprovement(currentOutput, refined);

      if (!improvement || improvement.score < 0.05) {
        // No significant improvement, stop
        break;
      }

      currentOutput = refined;
    }

    return {
      final_output: currentOutput,
      history,
      rounds: history.length - 1
    };
  }

  async generateCritique(output, critiquePrompt) {
    const prompt = `
${critiquePrompt}

**Output to critique:**
"""
${output}
"""

Provide your critique as JSON:
{
  "overall_assessment": "brief summary",
  "specific_issues": ["issue 1", "issue 2", ...],
  "improvement_opportunities": ["opportunity 1", "opportunity 2", ...]
}
`;

    const driver = await DriverFactory.createDriver('chatgpt');
    const result = await driver.execute({
      spec: {
        target: 'chatgpt',
        model: 'gpt-4o',
        payload: {
          system_message: 'You are a critical but constructive reviewer.',
          user_message: prompt
        },
        parameters: { response_format: { type: 'json_object' } }
      }
    });

    return JSON.parse(result.output);
  }

  async refineBasedOnCritique(output, critique) {
    const prompt = `
Improve the following output based on this critique:

**Original Output:**
"""
${output}
"""

**Critique:**
- Overall: ${critique.overall_assessment}
- Issues: ${critique.specific_issues.join(', ')}
- Opportunities: ${critique.improvement_opportunities.join(', ')}

Provide improved version addressing all critique points.
`;

    const driver = await DriverFactory.createDriver('chatgpt');
    const result = await driver.execute({
      spec: {
        target: 'chatgpt',
        model: 'gpt-4o',
        payload: { user_message: prompt }
      }
    });

    return result.output;
  }
}
```

---

## 3. FEEDBACK DO USUÁRIO (Human→LLM)

### 3.1 Tipos de Feedback do Usuário

#### A. Feedback em Texto Livre

```javascript
// User provides natural language feedback

// API Endpoint
POST /api/missions/:missionId/feedback
{
  "step_id": "step-12",
  "feedback": "This chapter is too abstract. Add 3 concrete code examples showing how to use lifetimes in real-world scenarios. Focus on common mistakes beginners make.",
  "apply_to_future_steps": true,
  "priority": "high"
}

// Backend processes feedback
class FeedbackProcessor {
  async processFeedback(missionId, feedbackData) {
    const mission = await Mission.findById(missionId);

    // Store feedback
    mission.user_feedback.push({
      timestamp: Date.now(),
      step_id: feedbackData.step_id,
      feedback: feedbackData.feedback,
      priority: feedbackData.priority || 'medium',
      applied: false
    });

    await mission.save();

    // If apply_to_future_steps, extract learnable patterns
    if (feedbackData.apply_to_future_steps) {
      const patterns = await this.extractPatterns(feedbackData.feedback);

      // Store patterns in memory
      for (const pattern of patterns) {
        await MemoryStore.storeFact(
          missionId,
          pattern.key,
          pattern.value,
          'user_feedback'
        );
      }
    }

    // Emit feedback event
    this.nerv.emit('USER_FEEDBACK_RECEIVED', {
      mission_id: missionId,
      step_id: feedbackData.step_id,
      feedback_preview: feedbackData.feedback.substring(0, 100)
    });
  }

  async extractPatterns(feedback) {
    // Use LLM to extract actionable patterns
    const prompt = `
Analyze this user feedback and extract any reusable patterns, preferences, or guidelines:

Feedback: "${feedback}"

Extract patterns as JSON:
[
  {
    "key": "preference_examples",
    "value": "User wants 3 concrete code examples per chapter",
    "confidence": 0.9
  },
  {
    "key": "style_focus",
    "value": "Focus on real-world scenarios and common mistakes",
    "confidence": 0.85
  }
]
`;

    const driver = await DriverFactory.createDriver('chatgpt');
    const result = await driver.execute({
      spec: {
        target: 'chatgpt',
        model: 'gpt-4o',
        payload: { user_message: prompt },
        parameters: { response_format: { type: 'json_object' } }
      }
    });

    const patterns = JSON.parse(result.output);
    return patterns.filter(p => p.confidence > 0.7);
  }
}
```

#### B. Aprovação/Rejeição (Thumbs Up/Down)

```javascript
// Dashboard UI
<template>
  <div class="output-viewer">
    <div class="output-content">
      {{ output }}
    </div>

    <div class="feedback-actions">
      <button @click="approve" class="thumbs-up">
        👍 Approve
      </button>
      <button @click="reject" class="thumbs-down">
        👎 Reject & Retry
      </button>
      <button @click="edit" class="edit">
        ✏️ Edit Manually
      </button>
    </div>
  </div>
</template>

<script>
export default {
  methods: {
    async approve() {
      await api.post(`/missions/${this.missionId}/steps/${this.stepId}/approve`);
      // Mission continues
    },

    async reject() {
      const reason = prompt('Why reject? (optional feedback)');
      await api.post(`/missions/${this.missionId}/steps/${this.stepId}/reject`, {
        reason: reason
      });
      // System retries step
    },

    async edit() {
      // Open editor
      this.showEditor = true;
    }
  }
};
</script>

// Backend
POST /api/missions/:missionId/steps/:stepId/approve
→ Mark step as approved, continue mission

POST /api/missions/:missionId/steps/:stepId/reject
{
  "reason": "Optional text feedback"
}
→ Retry step with rejection feedback
```

#### C. Edição Direta

```javascript
// User directly edits LLM output

// Dashboard UI
<template>
  <div class="output-editor">
    <div class="editor-toolbar">
      <button @click="save">Save Changes</button>
      <button @click="cancel">Cancel</button>
      <button @click="compareVersions">Compare with Original</button>
    </div>

    <textarea
      v-model="editedOutput"
      rows="30"
      class="editor"
    ></textarea>

    <div class="diff-viewer" v-if="showDiff">
      <diff-component :original="originalOutput" :edited="editedOutput" />
    </div>
  </div>
</template>

// Backend
PUT /api/missions/:missionId/steps/:stepId/output
{
  "output": "User-edited output text...",
  "edit_type": "manual",
  "changes_summary": "Added more code examples, fixed typos"
}

// System
class OutputEditor {
  async saveEditedOutput(missionId, stepId, editedOutput) {
    const mission = await Mission.findById(missionId);
    const step = mission.workflow.steps.find(s => s.id === stepId);

    // Store original + edited versions
    await this.storeVersion(missionId, stepId, 'llm_original', step.result.output);
    await this.storeVersion(missionId, stepId, 'user_edited', editedOutput);

    // Update current result
    step.result.output = editedOutput;
    step.result.edited_by_user = true;
    step.result.edited_at = Date.now();

    await mission.save();

    // Extract what user changed (learning opportunity)
    const diff = await this.analyzeDiff(step.result.output, editedOutput);
    await this.learnFromEdit(missionId, diff);

    // Emit event
    this.nerv.emit('OUTPUT_EDITED_BY_USER', {
      mission_id: missionId,
      step_id: stepId,
      changes_count: diff.changes.length
    });
  }

  async analyzeDiff(original, edited) {
    // Use LLM to understand what changed and why
    const prompt = `
Analyze the differences between these two versions and identify what the user changed and likely why:

**Original:**
"""
${original}
"""

**Edited:**
"""
${edited}
"""

Provide analysis as JSON:
{
  "changes": [
    {
      "type": "addition" | "deletion" | "modification",
      "location": "Chapter 3, paragraph 2",
      "what_changed": "Added code example showing lifetime elision",
      "likely_reason": "Original lacked concrete examples"
    }
  ],
  "learnings": [
    {
      "pattern": "User prefers more code examples",
      "confidence": 0.9
    }
  ]
}
`;

    const driver = await DriverFactory.createDriver('chatgpt');
    const result = await driver.execute({
      spec: {
        target: 'chatgpt',
        model: 'gpt-4o',
        payload: { user_message: prompt },
        parameters: { response_format: { type: 'json_object' } }
      }
    });

    return JSON.parse(result.output);
  }

  async learnFromEdit(missionId, diff) {
    // Store learnings in memory
    for (const learning of diff.learnings) {
      if (learning.confidence > 0.7) {
        await MemoryStore.storeFact(
          missionId,
          learning.pattern,
          learning.value,
          'user_edit_analysis'
        );
      }
    }
  }
}
```

### 3.2 Feedback Injection Strategy

```javascript
class FeedbackInjector {
  /**
   * Inject feedback into prompts for future steps
   */
  injectFeedback(basePrompt, missionState, stepConfig) {
    let enhancedPrompt = basePrompt;

    // 1. Inject relevant user feedback
    const relevantFeedback = this.getRelevantFeedback(
      missionState.user_feedback,
      stepConfig
    );

    if (relevantFeedback.length > 0) {
      enhancedPrompt += `\n\n---\n**User Feedback to Incorporate:**\n`;
      relevantFeedback.forEach((fb, i) => {
        enhancedPrompt += `${i + 1}. ${fb.feedback}\n`;
      });
    }

    // 2. Inject learned patterns from memory
    const learnedPatterns = MemoryStore.retrieveFacts(
      missionState.mission_id,
      ['preferences', 'style_guide', 'examples_policy']
    );

    if (Object.keys(learnedPatterns).length > 0) {
      enhancedPrompt += `\n\n---\n**Learned Preferences:**\n`;
      Object.entries(learnedPatterns).forEach(([key, value]) => {
        enhancedPrompt += `- ${key}: ${value}\n`;
      });
    }

    // 3. Inject context from previous iterations (if iterative step)
    if (stepConfig.iterative && missionState.iteration_contexts[stepConfig.id]) {
      const iterCtx = missionState.iteration_contexts[stepConfig.id];
      if (iterCtx.previous_attempts > 0) {
        enhancedPrompt += `\n\n---\n**Previous Attempts (${iterCtx.previous_attempts}):**\n`;
        enhancedPrompt += `Issues identified: ${iterCtx.issues.join(', ')}\n`;
        enhancedPrompt += `Please address these issues in your response.\n`;
      }
    }

    return enhancedPrompt;
  }

  getRelevantFeedback(allFeedback, stepConfig) {
    // Filter feedback relevant to this step
    return allFeedback.filter(fb => {
      // Feedback explicitly for this step
      if (fb.step_id === stepConfig.id) return true;

      // Feedback marked as "apply to future steps"
      if (fb.apply_to_all_future) return true;

      // Feedback for same type of step (e.g., all "write chapter" steps)
      if (fb.step_type === stepConfig.action) return true;

      return false;
    });
  }
}
```

---

## 4. FEEDBACK ESTRUTURAL (System→LLM)

### 4.1 Test-Driven Feedback Loop

**Use Case**: Code generation where tests validate correctness

```javascript
class TestDrivenLoop {
  async generateCodeWithTests(spec, tests) {
    let iteration = 0;
    const maxIterations = 5;

    while (iteration < maxIterations) {
      iteration++;

      // Generate code
      const code = await this.generateCode(spec, iteration > 1 ? tests.lastFailures : null);

      // Run tests
      const testResults = await this.runTests(code, tests);

      // Emit results
      this.nerv.emit('CODE_TESTS_RUN', {
        iteration,
        passed: testResults.passed,
        total: testResults.total,
        failures: testResults.failures
      });

      // Check if all tests passed
      if (testResults.all_passed) {
        return {
          code,
          iterations: iteration,
          test_results: testResults,
          converged: true
        };
      }

      // Prepare feedback for next iteration
      tests.lastFailures = testResults.failures;
      spec.context = {
        ...spec.context,
        previous_code: code,
        test_failures: testResults.failures.map(f => ({
          test: f.name,
          error: f.error,
          expected: f.expected,
          actual: f.actual
        }))
      };
    }

    // Max iterations reached
    return {
      code: null,
      iterations: maxIterations,
      test_results: tests.lastResults,
      converged: false,
      error: 'Could not generate code that passes all tests'
    };
  }

  async generateCode(spec, previousFailures) {
    let prompt = `Generate code for: ${spec.description}\n\nRequirements:\n${spec.requirements.join('\n')}\n`;

    if (previousFailures) {
      prompt += `\n\n**Previous attempt failed tests:**\n`;
      previousFailures.forEach(f => {
        prompt += `- Test "${f.name}" failed: ${f.error}\n`;
        prompt += `  Expected: ${f.expected}\n`;
        prompt += `  Actual: ${f.actual}\n`;
      });
      prompt += `\nFix these issues in your code.`;
    }

    const driver = await DriverFactory.createDriver('chatgpt');
    const result = await driver.execute({
      spec: {
        target: 'chatgpt',
        model: 'gpt-4o',
        payload: { user_message: prompt }
      }
    });

    return this.extractCode(result.output);
  }

  async runTests(code, tests) {
    // Actually execute tests
    // This depends on language/framework
    // Example for Node.js:

    const tempFile = `/tmp/test-${Date.now()}.js`;
    await fs.writeFile(tempFile, code);

    try {
      const testProcess = spawn('node', [tests.testFile, tempFile]);
      const output = await this.collectOutput(testProcess);

      const results = this.parseTestOutput(output);

      return {
        passed: results.passed,
        total: results.total,
        all_passed: results.passed === results.total,
        failures: results.failures
      };
    } catch (error) {
      return {
        passed: 0,
        total: tests.count,
        all_passed: false,
        failures: [{ name: 'execution_error', error: error.message }]
      };
    }
  }
}
```

### 4.2 Linting Feedback Loop

```javascript
class LintingLoop {
  async generateCodeWithLinting(spec, lintConfig) {
    let iteration = 0;
    const maxIterations = 3;

    while (iteration < maxIterations) {
      iteration++;

      // Generate code
      const code = await this.generateCode(spec);

      // Run linter
      const lintResults = await this.runLinter(code, lintConfig);

      if (lintResults.errors.length === 0) {
        // No errors, code is clean
        return {
          code,
          iterations: iteration,
          lint_results: lintResults
        };
      }

      // Fix linting errors
      const fixed = await this.fixLintingErrors(code, lintResults.errors);

      if (fixed.success) {
        return {
          code: fixed.code,
          iterations: iteration,
          lint_results: { errors: [], warnings: [] }
        };
      }

      // Prepare for next iteration
      spec.context = {
        ...spec.context,
        previous_code: code,
        lint_errors: lintResults.errors
      };
    }

    // Give up, return best effort
    return {
      code,
      iterations: maxIterations,
      lint_results: lintResults,
      warning: 'Code has unresolved linting errors'
    };
  }

  async runLinter(code, lintConfig) {
    // Run ESLint, Pylint, etc.
    const { exec } = require('child_process');

    return new Promise((resolve) => {
      exec(`eslint --format json`, { input: code }, (error, stdout) => {
        const results = JSON.parse(stdout);
        resolve({
          errors: results.filter(r => r.severity === 2),
          warnings: results.filter(r => r.severity === 1)
        });
      });
    });
  }

  async fixLintingErrors(code, errors) {
    const prompt = `Fix the following linting errors in this code:\n\n**Code:**\n\`\`\`\n${code}\n\`\`\`\n\n**Errors:**\n${errors.map(e => `- Line ${e.line}: ${e.message}`).join('\n')}\n\nProvide corrected code.`;

    const driver = await DriverFactory.createDriver('chatgpt');
    const result = await driver.execute({
      spec: {
        target: 'chatgpt',
        model: 'gpt-4o',
        payload: { user_message: prompt }
      }
    });

    return {
      success: true,
      code: this.extractCode(result.output)
    };
  }
}
```

---

## 5. FEEDBACK CONTEXTUAL (LLM→LLM)

### 5.1 Aprendizado ao Longo da Missão

```javascript
class MissionLearner {
  /**
   * Analyze mission history to detect patterns and adapt
   */
  async analyzeAndAdapt(missionId) {
    const mission = await Mission.findById(missionId);
    const history = mission.state.accumulated_results;

    // Analyze quality trends
    const qualityTrend = this.analyzeQualityTrend(history);

    if (qualityTrend.improving) {
      // System is learning, continue current approach
      console.log('[LEARNER] Quality improving, maintaining current approach');
    } else if (qualityTrend.declining) {
      // Quality declining, investigate
      console.log('[LEARNER] Quality declining, analyzing causes...');

      const causes = await this.identifyCauses(history, qualityTrend);

      // Adapt approach
      await this.adaptStrategy(missionId, causes);
    }

    // Analyze iteration patterns
    const iterationPatterns = this.analyzeIterationPatterns(history);

    if (iterationPatterns.high_retry_rate) {
      // Many retries, validation criteria may be too strict
      console.log('[LEARNER] High retry rate detected, consider adjusting validation criteria');

      await this.suggestValidationAdjustment(missionId, iterationPatterns);
    }

    // Analyze user feedback patterns
    const feedbackPatterns = this.analyzeFeedbackPatterns(mission.user_feedback);

    if (feedbackPatterns.common_themes.length > 0) {
      // Extract actionable patterns
      for (const theme of feedbackPatterns.common_themes) {
        await MemoryStore.storeFact(
          missionId,
          `learned_pattern_${theme.key}`,
          theme.value,
          'mission_analysis'
        );
      }
    }
  }

  analyzeQualityTrend(history) {
    const scores = Object.values(history)
      .filter(r => r.quality_score !== undefined)
      .map(r => r.quality_score);

    if (scores.length < 3) {
      return { improving: false, declining: false, stable: true };
    }

    // Simple linear regression
    const trend = this.linearRegression(scores);

    return {
      improving: trend.slope > 2,  // Improving if slope > 2 points per step
      declining: trend.slope < -2,
      stable: Math.abs(trend.slope) <= 2,
      slope: trend.slope,
      avg_score: scores.reduce((sum, s) => sum + s, 0) / scores.length
    };
  }

  async identifyCauses(history, trend) {
    // Use LLM to analyze why quality is declining
    const prompt = `
Analyze this mission execution history and identify why quality scores are declining:

**Quality Trend:** Declining (slope: ${trend.slope})

**Recent Steps:**
${Object.entries(history).slice(-5).map(([id, result]) => `
- Step: ${id}
  Quality Score: ${result.quality_score}
  Issues: ${result.validation_issues?.join(', ') || 'none'}
`).join('\n')}

Provide analysis as JSON:
{
  "likely_causes": ["cause 1", "cause 2"],
  "recommendations": ["recommendation 1", "recommendation 2"]
}
`;

    const driver = await DriverFactory.createDriver('chatgpt');
    const result = await driver.execute({
      spec: {
        target: 'chatgpt',
        model: 'gpt-4o',
        payload: { user_message: prompt },
        parameters: { response_format: { type: 'json_object' } }
      }
    });

    return JSON.parse(result.output);
  }

  async adaptStrategy(missionId, causes) {
    // Implement adaptations based on identified causes
    // Examples:
    // - Adjust validation criteria
    // - Change prompt templates
    // - Switch LLM model
    // - Increase context injection

    console.log(`[LEARNER] Adapting strategy based on causes: ${causes.likely_causes.join(', ')}`);

    // Store adaptation in mission state
    const mission = await Mission.findById(missionId);
    mission.adaptations = mission.adaptations || [];
    mission.adaptations.push({
      timestamp: Date.now(),
      causes: causes.likely_causes,
      recommendations: causes.recommendations,
      actions_taken: []
    });

    await mission.save();
  }
}
```

### 5.2 Style Consistency Learning

```javascript
class StyleLearner {
  /**
   * Learn writing style from approved outputs
   */
  async learnStyleFromApprovedOutputs(missionId) {
    const mission = await Mission.findById(missionId);

    // Collect approved outputs
    const approvedOutputs = Object.values(mission.state.accumulated_results)
      .filter(r => r.user_approved || r.quality_score >= 85)
      .map(r => r.output);

    if (approvedOutputs.length < 3) {
      // Not enough data to learn style
      return null;
    }

    // Analyze style characteristics
    const styleAnalysis = await this.analyzeStyle(approvedOutputs);

    // Store style guide in memory
    await MemoryStore.storeFact(
      missionId,
      'learned_style_guide',
      styleAnalysis,
      'approved_outputs_analysis'
    );

    return styleAnalysis;
  }

  async analyzeStyle(outputs) {
    const prompt = `
Analyze these approved text outputs and extract the writing style characteristics:

${outputs.map((o, i) => `**Output ${i + 1}:**\n${o}\n---\n`).join('\n')}

Extract style guide as JSON:
{
  "tone": "formal" | "casual" | "technical",
  "sentence_structure": "short" | "medium" | "long" | "varied",
  "vocabulary_level": "simple" | "intermediate" | "advanced",
  "use_of_examples": "frequent" | "moderate" | "rare",
  "code_style": {
    "language": "...",
    "naming_convention": "snake_case" | "camelCase",
    "comment_style": "..."
  },
  "formatting_preferences": {
    "headings": "...",
    "lists": "...",
    "emphasis": "..."
  }
}
`;

    const driver = await DriverFactory.createDriver('chatgpt');
    const result = await driver.execute({
      spec: {
        target: 'chatgpt',
        model: 'gpt-4o',
        payload: { user_message: prompt },
        parameters: { response_format: { type: 'json_object' } }
      }
    });

    return JSON.parse(result.output);
  }
}
```

---

## 6. DASHBOARD DE FEEDBACK

### 6.1 Real-time Feedback Interface

```vue
<!-- src/dashboard-ui/src/components/mission/FeedbackPanel.vue -->

<template>
  <div class="feedback-panel">
    <h3>Provide Feedback</h3>

    <!-- Quick Actions -->
    <div class="quick-actions">
      <button @click="approve" class="btn-approve">
        👍 Approve
      </button>
      <button @click="requestRevision" class="btn-revision">
        🔄 Request Revision
      </button>
      <button @click="reject" class="btn-reject">
        👎 Reject
      </button>
    </div>

    <!-- Detailed Feedback Form -->
    <div class="feedback-form" v-if="showDetailedForm">
      <label>What needs improvement?</label>
      <textarea
        v-model="feedbackText"
        rows="4"
        placeholder="Be specific about what to improve..."
      ></textarea>

      <div class="feedback-options">
        <label>
          <input type="checkbox" v-model="applyToFuture" />
          Apply to all future steps
        </label>

        <label>
          <input type="checkbox" v-model="isPriority" />
          High priority
        </label>
      </div>

      <div class="form-actions">
        <button @click="submitFeedback" class="btn-primary">
          Submit Feedback
        </button>
        <button @click="cancel" class="btn-secondary">
          Cancel
        </button>
      </div>
    </div>

    <!-- Feedback History -->
    <div class="feedback-history">
      <h4>Your Feedback History</h4>
      <div
        v-for="fb in feedbackHistory"
        :key="fb.timestamp"
        class="feedback-item"
      >
        <div class="feedback-meta">
          <span class="timestamp">{{ formatTime(fb.timestamp) }}</span>
          <span class="step-id">Step: {{ fb.step_id }}</span>
        </div>
        <div class="feedback-content">{{ fb.feedback }}</div>
        <div class="feedback-status">
          <span v-if="fb.applied" class="status-applied">✓ Applied</span>
          <span v-else class="status-pending">⏳ Pending</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  props: ['missionId', 'stepId', 'output'],

  data() {
    return {
      showDetailedForm: false,
      feedbackText: '',
      applyToFuture: false,
      isPriority: false,
      feedbackHistory: []
    };
  },

  methods: {
    approve() {
      this.$emit('approve');
      api.post(`/missions/${this.missionId}/steps/${this.stepId}/approve`);
    },

    requestRevision() {
      this.showDetailedForm = true;
    },

    reject() {
      const reason = prompt('Why reject this output?');
      if (reason) {
        api.post(`/missions/${this.missionId}/steps/${this.stepId}/reject`, {
          reason
        });
      }
    },

    async submitFeedback() {
      await api.post(`/missions/${this.missionId}/feedback`, {
        step_id: this.stepId,
        feedback: this.feedbackText,
        apply_to_future_steps: this.applyToFuture,
        priority: this.isPriority ? 'high' : 'medium'
      });

      this.feedbackText = '';
      this.showDetailedForm = false;
      this.loadFeedbackHistory();
    },

    async loadFeedbackHistory() {
      const response = await api.get(`/missions/${this.missionId}/feedback`);
      this.feedbackHistory = response.data;
    }
  },

  mounted() {
    this.loadFeedbackHistory();
  }
};
</script>
```

---

## 7. MÉTRICAS DE FEEDBACK

```javascript
class FeedbackMetrics {
  async calculateMetrics(missionId) {
    const mission = await Mission.findById(missionId);

    return {
      // Feedback responsiveness
      avg_time_to_feedback: this.calculateAvgTimeToFeedback(mission),
      feedback_count: mission.user_feedback.length,

      // Feedback effectiveness
      quality_improvement_after_feedback: this.calculateQualityImprovement(mission),
      retry_rate_reduction: this.calculateRetryRateReduction(mission),

      // Approval rates
      approval_rate: this.calculateApprovalRate(mission),
      rejection_rate: this.calculateRejectionRate(mission),

      // Learning effectiveness
      patterns_learned: MemoryStore.countFacts(missionId),
      pattern_reuse_count: this.calculatePatternReuse(mission)
    };
  }

  calculateQualityImprovement(mission) {
    const feedbackSteps = mission.user_feedback.map(fb => fb.step_id);
    const results = mission.state.accumulated_results;

    const avgBefore = this.avgQualityBefore(results, feedbackSteps);
    const avgAfter = this.avgQualityAfter(results, feedbackSteps);

    return avgAfter - avgBefore;
  }

  // ... other metric calculations
}
```

---

**Próximo documento**: `04-MISSION_EXAMPLES.md` - Exemplos práticos completos de missões
