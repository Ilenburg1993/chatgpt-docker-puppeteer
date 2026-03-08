# ARQUITETURA DE MISSÕES - Sistema de Orquestração Autônoma de LLMs

## 1. HIERARQUIA CONCEITUAL

O sistema opera em **3 níveis hierárquicos**:

```
MISSÃO (Mission)
   ↓
WORKFLOW (Multi-step execution plan)
   ↓
TASKS (Individual LLM executions)
```

### 1.1 MISSÃO (Mission)

**Definição**: Um objetivo de alto nível que o usuário deseja alcançar, independente da complexidade
ou duração.

**Características**:

- **Objetivo final claro**: "Escrever um livro sobre Rust", "Desenvolver uma API REST", "Pesquisar
  impacto de IA na saúde"
- **Duração indeterminada**: Pode levar horas, dias, semanas
- **Geração automática de tasks**: O sistema decompoõe a missão em centenas/milhares de tasks
- **Supervisão contínua**: Usuário acompanha progresso, dá feedback, ajusta rumos
- **Estado persistente**: Missão pode ser pausada, retomada, ajustada a qualquer momento

**Exemplos**:

- **Missão: "Escrever livro técnico de 300 páginas sobre Advanced Rust Programming"**
  - Gera automaticamente: 1 task de outline → 15 tasks de capítulos → N tasks de revisão → 1 task de
    compilação = ~50-100 tasks

- **Missão: "Desenvolver sistema de e-commerce completo"**
  - Gera automaticamente: arquitetura → backend → frontend → testes → documentação = ~500-1000 tasks

- **Missão: "Pesquisar e escrever relatório sobre IA na medicina"**
  - Gera automaticamente: coleta de fontes → análise → síntese → escrita → fact-check = ~200 tasks

**NÃO é uma missão**:

- ❌ "Gerar uma resposta para este prompt" (isso é uma **task**)
- ❌ "Escrever um parágrafo" (isso é uma **task**)
- ❌ "Validar este código" (isso é uma **task**)

### 1.2 WORKFLOW (Plano de Execução)

**Definição**: A sequência estruturada de steps que o sistema executará para completar a missão.

**Características**:

- **Gerado automaticamente** ou **definido pelo usuário**
- **Estrutura em árvore**: Steps podem ter sub-steps (hierarchical)
- **Dependências explícitas**: Step B só executa após Step A completar
- **Branching condicional**: "Se qualidade < 70, repetir Step X"
- **Looping**: "Repetir até todos testes passarem"
- **Context flow**: Resultados de um step fluem como input do próximo

**Exemplo: Workflow para Missão "Escrever Livro"**:

```
Step 1: Generate Outline
  ├─ Input: Missão description
  └─ Output: Lista de 15 capítulos com tópicos

Step 2-16: Write Chapters (Sequential)
  ├─ Step 2: Write Chapter 1
  │   ├─ Input: Outline + Chapter 1 topics
  │   ├─ Action: ITERATIVE execution (max 3 iterations)
  │   ├─ Validation: LLM-as-judge (coherence, accuracy, code examples)
  │   └─ Output: Chapter 1 text
  │
  ├─ Step 3: Write Chapter 2
  │   ├─ Input: Outline + Chapter 1 (context) + Chapter 2 topics
  │   └─ ... (same structure)
  │
  └─ ... (Chapter 3-15)

Step 17: Cross-Chapter Consistency Check
  ├─ Input: All 15 chapters
  ├─ Action: LLM reviews for contradictions, inconsistencies
  └─ Output: List of issues to fix

Step 18 (conditional): Fix Inconsistencies
  ├─ Condition: If Step 17 found issues
  ├─ Action: For each issue, regenerate affected sections
  └─ Output: Updated chapters

Step 19: Generate Table of Contents
  └─ ...

Step 20: Compile Final Book
  └─ Output: book.md (300 pages)
```

**Cada step gera 1 ou mais TASKS**.

### 1.3 TASK (Execução Individual de LLM)

**Definição**: Uma única chamada à LLM (ou iteração de chamadas) para executar uma ação específica.

**Características**:

- **Atômica**: Faz UMA coisa (gerar texto, validar código, revisar seção)
- **Auto-suficiente**: Tem todos inputs necessários (prompt, context, parameters)
- **Resultado definido**: Produz output mensurável (texto, JSON, código)
- **Duração limitada**: Geralmente minutos (não horas)
- **Pode falhar e retry**: Sistema detecta falhas e tenta novamente

**Exemplos de Tasks**:

```
Task #001: Generate book outline
  - Input: "Topic: Rust, Length: 15 chapters, Audience: experienced devs"
  - Output: JSON com 15 chapter titles e tópicos

Task #002: Write Chapter 1 (iteration 1)
  - Input: Outline + "Write Chapter 1: Introduction to Ownership"
  - Output: Chapter 1 draft (3000 words)

Task #003: Validate Chapter 1 (LLM-as-judge)
  - Input: Chapter 1 draft
  - Output: { quality_score: 65, issues: ["Missing code examples", "Too abstract"] }

Task #004: Write Chapter 1 (iteration 2)
  - Input: Chapter 1 draft + Validation feedback
  - Output: Chapter 1 improved (3500 words, with code examples)

Task #005: Validate Chapter 1 (iteration 2)
  - Input: Chapter 1 improved
  - Output: { quality_score: 85, issues: [] }

Task #006: Write Chapter 2 (iteration 1)
  - Input: Outline + Chapter 1 (context) + "Write Chapter 2: Borrowing Rules"
  - Output: Chapter 2 draft
```

**Uma missão "Escrever livro" gera ~100 tasks**:

- 1 outline task
- 15 chapters × 3 iterations average = 45 writing tasks
- 45 validation tasks
- 1 consistency check task
- N fix tasks (variable)
- 1 compilation task

---

## 2. FLUXO DE EXECUÇÃO COMPLETO

### 2.1 Criação de Missão pelo Usuário

```
Usuário → Dashboard → "Nova Missão"

Formulário:
  - Título: "Livro Técnico: Advanced Rust Programming"
  - Tipo: "Book Writing"
  - Objetivo: "Escrever livro técnico de 300 páginas, 15 capítulos, para devs experientes"
  - Critérios de qualidade:
    - Cada capítulo deve ter exemplos de código
    - Quality score mínimo: 75/100
    - Consistência entre capítulos
  - Budget: $50 USD
  - Prazo estimado: 7 dias

Sistema:
  1. Cria registro de MISSÃO no banco
  2. Gera WORKFLOW automaticamente (ou usuário escolhe template)
  3. Salva workflow como JSON
  4. Inicia execução automática
  5. Emite evento NERV: MISSION_CREATED
```

### 2.2 Geração Automática de Workflow

**Duas opções**:

#### Opção A: Workflow Template (Pré-definido)

- Sistema tem templates para tipos comuns de missões
- Ex: "Book Writing Template", "Software Project Template", "Research Template"
- Usuário escolhe template e preenche parâmetros
- Template expande para workflow completo

#### Opção B: Workflow Generation via LLM

- Sistema usa LLM para gerar workflow customizado
- Prompt: "Given this mission: [description], generate a workflow with steps to accomplish it"
- LLM retorna JSON com steps estruturados
- Sistema valida e carrega workflow

**Exemplo: Template "Book Writing"**:

```json
{
  "template_id": "book-writing-v1",
  "parameters": {
    "num_chapters": 15,
    "target_length_pages": 300,
    "style": "technical",
    "include_code_examples": true
  },
  "workflow": {
    "steps": [
      {
        "id": "outline",
        "action": "generate_outline",
        "prompt_template": "Generate outline for book: {{title}}, {{num_chapters}} chapters, style: {{style}}"
      },
      {
        "id": "chapter_loop",
        "action": "loop",
        "iterations": "{{num_chapters}}",
        "loop_body": {
          "steps": [
            {
              "id": "write_chapter",
              "action": "execute_prompt",
              "prompt_template": "Write Chapter {{chapter_num}}: {{chapter_title}}. Context: {{previous_chapters}}",
              "iterative": true,
              "max_iterations": 3,
              "validation": {
                "type": "llm_judge",
                "criteria": ["coherence", "accuracy", "code_examples_present"],
                "min_score": 75
              }
            }
          ]
        }
      },
      {
        "id": "consistency_check",
        "action": "execute_prompt",
        "dependencies": ["chapter_loop"],
        "prompt_template": "Review all chapters for consistency: {{all_chapters}}"
      }
    ]
  }
}
```

### 2.3 Execução Automática do Workflow

**Orchestrator Engine** é responsável:

```javascript
// Pseudo-código do fluxo de execução

async function executeMission(mission) {
  const workflow = mission.workflow;
  const missionState = initializeMissionState(mission);

  for (const step of workflow.steps) {
    // Check if user paused mission
    if (missionState.status === 'PAUSED') {
      await waitForResume();
    }

    // Check if user modified workflow
    if (missionState.workflow_modified) {
      workflow = reloadWorkflow(mission.id);
    }

    // Execute step
    const stepResult = await executeStep(step, missionState);

    // Update mission state
    missionState.completed_steps.push(step.id);
    missionState.accumulated_results[step.id] = stepResult.output;
    missionState.progress_percent = calculateProgress(missionState);

    // Save state to disk (persistent)
    await saveMissionState(missionState);

    // Emit progress event to dashboard
    nerv.emit('MISSION_PROGRESS', {
      mission_id: mission.id,
      step_id: step.id,
      progress_percent: missionState.progress_percent,
      current_step_name: step.name,
    });

    // Check if user provided feedback
    const userFeedback = await checkUserFeedback(mission.id);
    if (userFeedback) {
      // Adjust next steps based on feedback
      adjustWorkflow(workflow, userFeedback);
    }

    // Check quality thresholds
    if (stepResult.quality_score < mission.quality_threshold) {
      // Alert user
      nerv.emit('MISSION_QUALITY_ALERT', {
        mission_id: mission.id,
        step_id: step.id,
        quality_score: stepResult.quality_score,
        threshold: mission.quality_threshold,
      });

      // Wait for user decision (auto-retry or manual review)
      if (mission.auto_retry_on_quality_failure) {
        // Retry step
        continue;
      } else {
        await waitForUserDecision(mission.id, step.id);
      }
    }
  }

  // Mission completed
  missionState.status = 'COMPLETED';
  missionState.completed_at = Date.now();
  await saveMissionState(missionState);

  nerv.emit('MISSION_COMPLETED', {
    mission_id: mission.id,
    total_duration_ms: missionState.completed_at - missionState.started_at,
    total_cost_usd: missionState.total_cost_usd,
    total_tasks: missionState.task_count,
  });
}
```

### 2.4 Decomposição de Steps em Tasks

**Cada step do workflow pode gerar 1 ou mais tasks**:

```javascript
async function executeStep(step, missionState) {
  switch (step.action) {
    case 'execute_prompt':
      // Gera 1 task (ou N se iterative)
      if (step.iterative) {
        return await executeIterativeStep(step, missionState);
      } else {
        return await executeSingleTask(step, missionState);
      }

    case 'loop':
      // Gera N tasks (N = iterations)
      const results = [];
      for (let i = 0; i < step.iterations; i++) {
        const loopStepResult = await executeStep(step.loop_body.steps[0], {
          ...missionState,
          loop_index: i,
        });
        results.push(loopStepResult);
      }
      return { outputs: results };

    case 'branch':
      // Gera tasks condicionalmente
      const condition = evaluateCondition(step.condition, missionState);
      if (condition) {
        return await executeStep(step.if_true, missionState);
      } else {
        return await executeStep(step.if_false, missionState);
      }

    case 'spawn_subtasks':
      // Gera N tasks em paralelo
      const subtasks = step.subtasks.map((subtask) => executeSingleTask(subtask, missionState));
      return await Promise.all(subtasks);
  }
}

async function executeIterativeStep(step, missionState) {
  let iteration = 0;
  let bestResult = null;
  let bestScore = 0;

  while (iteration < step.max_iterations) {
    iteration++;

    // Cria e executa task
    const task = createTaskFromStep(step, missionState, iteration);
    const taskResult = await executeTask(task); // Chama LLM

    // Valida resultado
    const validationResult = await validateTaskResult(taskResult.output, step.validation);

    // Atualiza melhor resultado
    if (validationResult.score > bestScore) {
      bestResult = taskResult;
      bestScore = validationResult.score;
    }

    // Se passou, retorna
    if (validationResult.passed && validationResult.score >= step.validation.min_score) {
      return bestResult;
    }

    // Adiciona feedback para próxima iteração
    step.prompt_template += `\n\n[Feedback from iteration ${iteration}]: ${validationResult.feedback}`;
  }

  // Atingiu max iterations, retorna melhor
  return bestResult;
}
```

---

## 3. SUPERVISÃO CONTÍNUA DO USUÁRIO

### 3.1 Dashboard de Missão (Real-time)

**Componente Vue**: `MissionMonitor.vue`

**Exibe**:

```
┌─────────────────────────────────────────────────────────────────┐
│ MISSÃO: Livro Técnico - Advanced Rust Programming              │
│ Status: 🟢 EM EXECUÇÃO                                          │
│ Progresso: ████████████░░░░░░░░ 65% (11/17 steps)             │
│ Tempo decorrido: 3h 25min                                       │
│ Tempo estimado restante: 2h 10min                              │
│ Custo até agora: $18.50 / $50.00 budget                        │
├─────────────────────────────────────────────────────────────────┤
│ WORKFLOW ATUAL:                                                 │
│                                                                 │
│ [✓] Step 1: Generate Outline (completed)                       │
│ [✓] Step 2: Write Chapter 1 (quality: 85/100)                  │
│ [✓] Step 3: Write Chapter 2 (quality: 78/100)                  │
│ [✓] Step 4: Write Chapter 3 (quality: 92/100)                  │
│ [✓] Step 5: Write Chapter 4 (quality: 81/100)                  │
│ [✓] Step 6: Write Chapter 5 (quality: 88/100)                  │
│ [✓] Step 7: Write Chapter 6 (quality: 76/100)                  │
│ [✓] Step 8: Write Chapter 7 (quality: 83/100)                  │
│ [✓] Step 9: Write Chapter 8 (quality: 90/100)                  │
│ [✓] Step 10: Write Chapter 9 (quality: 79/100)                 │
│ [✓] Step 11: Write Chapter 10 (quality: 86/100)                │
│ [🔄] Step 12: Write Chapter 11 (iteration 2/3, current: 68/100)│
│     └─ ⚠ Quality below threshold (75), retrying...             │
│ [⏳] Step 13: Write Chapter 12 (pending)                        │
│ [⏳] Step 14: Write Chapter 13 (pending)                        │
│ [⏳] Step 15: Write Chapter 14 (pending)                        │
│ [⏳] Step 16: Write Chapter 15 (pending)                        │
│ [⏳] Step 17: Consistency Check (pending)                       │
├─────────────────────────────────────────────────────────────────┤
│ CONTROLES:                                                      │
│ [⏸ Pausar] [📝 Dar Feedback] [🔧 Ajustar Workflow]            │
│ [📊 Ver Tasks Detalhadas] [💬 Ver Outputs]                     │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Intervenções do Usuário

#### A. Pausar Missão

```
Usuário clica "Pausar"
  ↓
Dashboard → POST /api/missions/:id/pause
  ↓
Backend atualiza mission.status = 'PAUSED'
  ↓
Orchestrator detecta pause no próximo step
  ↓
Workflow para, estado salvo
  ↓
Usuário pode retomar depois
```

#### B. Dar Feedback em Step Específico

```
Usuário clica "Ver Outputs" → Seleciona Chapter 11
  ↓
Dashboard exibe output do Chapter 11 (iteration 2)
  ↓
Usuário vê: "Esse capítulo está muito teórico, precisa de mais exemplos práticos"
  ↓
Usuário clica "Dar Feedback"
  ↓
Modal abre:
  ┌────────────────────────────────────────────┐
  │ Feedback para: Step 12 - Write Chapter 11 │
  │                                            │
  │ [Textarea]                                 │
  │ "Adicione 3 exemplos práticos de código   │
  │  mostrando uso de lifetimes em structs.   │
  │  Foque em casos reais de desenvolvimento."│
  │                                            │
  │ [Checkbox] Aplicar a todos capítulos      │
  │            restantes                       │
  │                                            │
  │ [Cancelar] [Enviar Feedback]               │
  └────────────────────────────────────────────┘
  ↓
Usuário clica "Enviar Feedback"
  ↓
POST /api/missions/:id/feedback
{
  "step_id": "step-12",
  "feedback": "Adicione 3 exemplos práticos...",
  "apply_to_future_steps": true
}
  ↓
Backend salva feedback
  ↓
Orchestrator no próximo step:
  - Lê feedback pendente
  - Injeta no prompt: "User feedback: [feedback]"
  - Executa step com feedback incorporado
```

#### C. Ajustar Workflow em Tempo Real

```
Usuário clica "Ajustar Workflow"
  ↓
Dashboard abre Workflow Editor
  ↓
Usuário vê workflow visual (Cytoscape.js)
  ↓
Usuário:
  - Remove Step 17 (Consistency Check)
  - Adiciona novo Step: "Generate code examples for each chapter"
  - Reordena steps
  ↓
Usuário clica "Salvar Alterações"
  ↓
PUT /api/missions/:id/workflow
{
  "steps": [updated workflow]
}
  ↓
Backend valida workflow
  ↓
Backend atualiza mission.workflow
  ↓
Backend seta flag: mission.workflow_modified = true
  ↓
Orchestrator no próximo loop:
  - Detecta workflow_modified
  - Recarrega workflow do banco
  - Continua execução com novo workflow
```

#### D. Aprovar/Rejeitar Output Manualmente

```
Sistema detecta quality_score < threshold
  ↓
Emite evento: MISSION_QUALITY_ALERT
  ↓
Dashboard exibe notificação:
  ┌────────────────────────────────────────────┐
  │ ⚠ Quality Alert                            │
  │                                            │
  │ Step 12: Write Chapter 11                  │
  │ Quality Score: 68/100 (threshold: 75)     │
  │                                            │
  │ Issues:                                    │
  │ - Missing code examples                    │
  │ - Too abstract                             │
  │                                            │
  │ [Ver Output] [Aprovar Mesmo Assim]         │
  │ [Retry Automaticamente] [Editar Manualmente]│
  └────────────────────────────────────────────┘
  ↓
Opções:
  1. "Ver Output" → Dashboard exibe texto completo
  2. "Aprovar Mesmo Assim" → Sistema aceita output e continua
  3. "Retry Automaticamente" → Sistema tenta novamente (iteration 3)
  4. "Editar Manualmente" → Modal abre com editor de texto, usuário corrige, salva
```

### 3.3 Comunicação Bidirecional (Human-in-the-Loop)

**NERV Events para Dashboard**:

```javascript
// Progresso
'MISSION_PROGRESS' → { mission_id, step_id, progress_percent }

// Alertas
'MISSION_QUALITY_ALERT' → { mission_id, step_id, quality_score }
'MISSION_BUDGET_WARNING' → { mission_id, current_cost, budget }
'MISSION_STALLED' → { mission_id, reason }

// Solicitações de aprovação
'MISSION_APPROVAL_REQUIRED' → { mission_id, step_id, reason, output }

// Milestones
'MISSION_MILESTONE' → { mission_id, milestone, description }
  // Ex: "Chapter 5/15 completed", "50% done", "Quality average: 85/100"
```

**User Actions para Backend**:

```javascript
// Controles
POST /api/missions/:id/pause
POST /api/missions/:id/resume
POST /api/missions/:id/cancel

// Feedback
POST /api/missions/:id/feedback
{
  step_id: "step-12",
  feedback: "texto do feedback",
  apply_to_future_steps: boolean
}

// Aprovações
POST /api/missions/:id/steps/:stepId/approve
POST /api/missions/:id/steps/:stepId/reject
POST /api/missions/:id/steps/:stepId/retry

// Workflow modifications
PUT /api/missions/:id/workflow
{ steps: [updated steps] }

// Manual edits
PUT /api/missions/:id/steps/:stepId/output
{ output: "edited text" }
```

---

## 4. PERSISTÊNCIA E ESTADO

### 4.1 Mission State Schema

```javascript
{
  "mission_id": "mission-uuid",
  "user_id": "user-123",
  "title": "Livro Técnico: Advanced Rust Programming",
  "type": "book_writing",
  "description": "Escrever livro técnico de 300 páginas...",

  "status": "RUNNING", // CREATED, RUNNING, PAUSED, COMPLETED, FAILED, CANCELLED

  "created_at": "2026-01-27T10:00:00Z",
  "started_at": "2026-01-27T10:05:00Z",
  "completed_at": null,
  "paused_at": null,

  "workflow": {
    "template_id": "book-writing-v1",
    "steps": [ /* array of steps */ ],
    "total_steps": 17,
    "modified": false,
    "modified_at": null
  },

  "state": {
    "current_step_index": 11,
    "current_step_id": "step-12",
    "completed_steps": ["step-1", "step-2", ..., "step-11"],
    "failed_steps": [],
    "accumulated_results": {
      "step-1": { output: "outline text...", quality_score: 90 },
      "step-2": { output: "chapter 1 text...", quality_score: 85 },
      // ...
    },
    "progress_percent": 65,
    "estimated_completion_time": "2026-01-27T14:30:00Z"
  },

  "metrics": {
    "total_tasks_executed": 45,
    "total_tasks_failed": 3,
    "total_tasks_retried": 8,
    "avg_quality_score": 83.5,
    "min_quality_score": 68,
    "max_quality_score": 92,
    "total_tokens": 850000,
    "total_cost_usd": 18.50,
    "duration_ms": 12300000  // 3h 25min
  },

  "quality_criteria": {
    "min_score": 75,
    "required_elements": ["code_examples", "practical_applications"],
    "auto_retry_on_failure": true,
    "max_retries_per_step": 3
  },

  "budget": {
    "limit_usd": 50,
    "warning_threshold": 40,  // Alert at 80%
    "current_spend_usd": 18.50
  },

  "user_feedback": [
    {
      "timestamp": "2026-01-27T12:30:00Z",
      "step_id": "step-12",
      "feedback": "Adicione mais exemplos práticos",
      "applied": true,
      "applied_to_steps": ["step-12", "step-13", "step-14", "step-15", "step-16"]
    }
  ],

  "alerts": [
    {
      "timestamp": "2026-01-27T12:25:00Z",
      "type": "QUALITY_ALERT",
      "severity": "warning",
      "step_id": "step-12",
      "message": "Quality score 68/100 below threshold 75",
      "resolved": true,
      "resolution": "User provided feedback, retry successful"
    }
  ],

  "artifacts": {
    "outline": "missions/mission-uuid/outline.txt",
    "chapters": [
      "missions/mission-uuid/chapter-01.txt",
      "missions/mission-uuid/chapter-02.txt",
      // ...
    ],
    "final_output": "missions/mission-uuid/final-book.md",
    "logs": "missions/mission-uuid/execution.log"
  }
}
```

### 4.2 Armazenamento

**Opções de Storage**:

1. **File System** (atual):
   - `missions/{mission_id}/state.json` - Mission state completo
   - `missions/{mission_id}/outputs/` - Outputs de cada step
   - `missions/{mission_id}/logs/` - Logs de execução

2. **Database** (PostgreSQL/MongoDB - futuro):
   - Tabela `missions` - Metadata da missão
   - Tabela `mission_steps` - Estado de cada step
   - Tabela `mission_outputs` - Outputs (com versioning)
   - Tabela `mission_feedback` - Feedback do usuário
   - Tabela `mission_events` - Event log completo

**Persistence Strategy**:

- **Checkpoint após cada step**: Estado salvo no disco
- **Incremental saves**: Apenas diffs salvos (não reescreve tudo)
- **Crash recovery**: Se sistema cair, pode retomar do último checkpoint
- **History tracking**: Mantém versões de outputs (rollback possível)

---

## 5. TIPOS DE MISSÕES

### 5.1 Missão: Book Writing

**Input**:

- Topic, target audience, length (pages/chapters), style (technical, narrative, etc.)

**Workflow**:

1. Generate outline
2. For each chapter: write → validate → refine
3. Cross-chapter consistency check
4. Generate ToC, compile

**Outputs**:

- Final book (markdown/PDF)
- Individual chapters (for review)

**Métricas**:

- Chapters completed
- Avg quality score per chapter
- Total word count
- Reading level (Flesch-Kincaid)

### 5.2 Missão: Software Development

**Input**:

- Project description, tech stack, features list

**Workflow**:

1. Generate project architecture
2. For each module: design → implement → test → refine
3. Integration tests
4. Generate documentation

**Outputs**:

- Complete codebase (multi-file)
- Test suite
- README, API docs

**Métricas**:

- Files created
- Test coverage %
- Linting errors
- Build success rate

### 5.3 Missão: Research & Report

**Input**:

- Research topic, sources (URLs, papers, APIs), output format

**Workflow**:

1. Fetch and parse sources
2. Extract key information per source
3. Synthesize findings
4. Write report sections
5. Fact-check (cross-reference)
6. Compile final report

**Outputs**:

- Research report (with citations)
- Source summary table
- Key findings list

**Métricas**:

- Sources processed
- Citations count
- Findings extracted
- Confidence scores

### 5.4 Missão: Code Refactoring

**Input**:

- Existing codebase, refactoring goals (reduce complexity, improve performance, etc.)

**Workflow**:

1. Analyze codebase structure
2. Identify refactoring opportunities
3. For each file: refactor → test → verify
4. Update documentation

**Outputs**:

- Refactored codebase
- Refactoring report (what changed, why)
- Updated tests

**Métricas**:

- Files refactored
- Complexity reduction (cyclomatic complexity)
- Performance improvement %
- Test pass rate

### 5.5 Missão: Content Translation

**Input**:

- Source content (book, documentation, website), target language(s)

**Workflow**:

1. Split content into chunks (context-aware)
2. For each chunk: translate → validate (fluency, accuracy) → refine
3. Consistency check (terminology, style)
4. Compile translated content

**Outputs**:

- Translated content
- Glossary (term mappings)

**Métricas**:

- Chunks translated
- Avg fluency score
- Terminology consistency %

### 5.6 Missão: Custom (User-Defined)

**Input**:

- Mission description (free text)
- Workflow (user defines steps manually or via LLM generation)

**Workflow**:

- User-defined or LLM-generated

**Outputs**:

- Variable (depends on mission)

---

## 6. ARQUIVOS CRÍTICOS

### Backend (Orchestration)

```
src/missions/
├── mission_manager.js          # CRUD de missões
├── mission_executor.js         # Executa workflow
├── mission_state_manager.js    # Persiste e recupera estado
├── workflow_generator.js       # Gera workflows automaticamente
├── feedback_processor.js       # Processa feedback do usuário
└── templates/
    ├── book_writing.json
    ├── software_development.json
    ├── research_report.json
    └── custom.json

src/orchestrator/
├── orchestrator_engine.js      # Executa steps (existente, estender)
├── step_executor.js            # Executa individual steps
├── task_generator.js           # Decompõe steps em tasks
└── checkpoint_manager.js       # Salva checkpoints

src/server/api/controllers/
└── missions.js                 # API REST para missões
```

### Frontend (Dashboard)

```
src/dashboard-ui/src/
├── stores/
│   └── missions.js             # Pinia store para missões
├── views/
│   ├── MissionList.vue         # Lista todas missões
│   ├── MissionCreate.vue       # Criar nova missão
│   ├── MissionMonitor.vue      # Monitorar missão em execução
│   ├── MissionDetails.vue      # Detalhes e histórico
│   └── MissionWorkflowEditor.vue  # Editar workflow
└── components/
    └── mission/
        ├── MissionCard.vue
        ├── MissionProgress.vue
        ├── MissionTimeline.vue
        ├── MissionFeedbackModal.vue
        └── MissionOutputViewer.vue
```

---

## 7. PRÓXIMOS PASSOS

1. **Implementar Mission Manager** (CRUD de missões)
2. **Implementar Workflow Templates** (book writing, software dev, research)
3. **Estender Orchestrator Engine** para executar workflows de missões
4. **Implementar Checkpoint System** para crash recovery
5. **Implementar Feedback Processor** para injetar feedback do usuário
6. **Criar Dashboard de Missões** (Vue components)
7. **Testes E2E** (criar missão, executar, pausar, dar feedback, retomar, completar)

---

**Próximo documento**: `02-AUTONOMOUS_EXECUTION.md` - Detalhamento técnico de como o sistema executa
missões autonomamente
