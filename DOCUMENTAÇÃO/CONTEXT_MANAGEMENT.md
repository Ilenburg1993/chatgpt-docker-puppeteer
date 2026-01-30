# Context Management System (V2.0)

> **Sistema de Gerenciamento de Contexto para Missões Autônomas**
>
> Permite acumular outputs de steps anteriores, aplicar chunking/summarization, e reutilizar patterns aprendidos via Memory Store.

---

## Visão Geral

O **Context Management System** é responsável por gerenciar o fluxo de contexto entre steps de uma missão, garantindo que informações relevantes de steps anteriores sejam disponibilizadas para steps subsequentes.

### Problema Resolvido

Em missões longas (ex: escrever livro de 300 páginas = 15+ capítulos), steps posteriores precisam de contexto de steps anteriores:

- **Step 1** (Outline): Gera estrutura do livro
- **Step 2** (Capítulo 1): Precisa da outline + nenhum contexto
- **Step 3** (Capítulo 2): Precisa da outline + Capítulo 1
- **Step 10** (Capítulo 9): Precisa da outline + Capítulos 1-8
- **Step 17** (Consistency Check): Precisa de TODOS os capítulos

**Desafios**:
- Context window overflow (100k+ tokens)
- Informações irrelevantes dilui signal
- Memória limitada do LLM

**Solução**: ContextManager com chunking, summarization e memory store.

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                    ContextManager                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐  ┌──────────────────┐              │
│  │  Context Cache   │  │   Memory Store   │              │
│  │  (mission_id →   │  │  (LRU patterns)  │              │
│  │   context)       │  │                  │              │
│  └──────────────────┘  └──────────────────┘              │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Chunking Strategies                                │  │
│  │  - SLIDING_WINDOW: Keep last N steps               │  │
│  │  - HIERARCHICAL: Summary + recent                  │  │
│  │  - TOKEN_LIMIT: Fit in max tokens                  │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Summarization Policies                             │  │
│  │  - DISABLED: Never summarize                       │  │
│  │  - ON_OVERFLOW: Summarize when > maxTokens         │  │
│  │  - PERIODIC: Summarize every N steps               │  │
│  │  - ADAPTIVE: Smart summarization (heuristics)      │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
         ▲                                      ▲
         │                                      │
         │ getContextForStep()                  │ addStepOutput()
         │                                      │
    ┌────┴─────────┐                   ┌───────┴────────┐
    │ MissionManager│                   │ Step Execution │
    │ (prompt gen)  │                   │ (after result) │
    └──────────────┘                   └────────────────┘
```

---

## Componentes Principais

### 1. ContextManager

**Responsabilidade**: Gerenciar contextos de missões ativas.

**API Principal**:

```javascript
const { ContextManager, CHUNKING_STRATEGY, SUMMARIZATION_POLICY } = require('./orchestrator/context_manager');

const contextManager = new ContextManager({
    maxTokens: 100000,                                  // Max tokens no contexto
    chunkingStrategy: CHUNKING_STRATEGY.SLIDING_WINDOW, // Estratégia de chunking
    windowSize: 10,                                     // Para sliding window
    summarizationPolicy: SUMMARIZATION_POLICY.ON_OVERFLOW,
    enableMemory: true,                                 // Habilitar Memory Store
    memoryRetention: 1000                               // Max patterns no memory
});

// Inicializa contexto para uma missão
contextManager.initializeContext('mission-123', {
    metadata: { template: 'book_writing' }
});

// Adiciona output de um step
await contextManager.addStepOutput('mission-123', 'step-1', 'Chapter outline...');

// Obtém contexto para gerar prompt do próximo step
const context = contextManager.getContextForStep('mission-123', 'step-2');
// Returns: { summary, steps: [{ step_id, output, tokens }], metadata }

// Limpa contexto
contextManager.clearContext('mission-123');

// Cleanup no shutdown
contextManager.cleanup();
```

**Context Object Structure**:

```javascript
{
    mission_id: 'mission-123',
    steps: [
        {
            step_id: 'step-1',
            output: 'Chapter outline: Introduction, Chapter 1, ...',
            timestamp: 1706499123456,
            tokens: 50
        },
        // ... mais steps
    ],
    summary: 'Previous steps: Outline created, Chapter 1 written...',
    metadata: {
        template: 'book_writing',
        total_steps: 15
    },
    created_at: 1706499000000,
    updated_at: 1706499123456,
    token_count: 2500
}
```

---

### 2. Chunking Strategies

Controla **quais steps** são incluídos no contexto retornado.

#### SLIDING_WINDOW (Janela Deslizante)

**Descrição**: Mantém apenas os últimos N steps.

**Quando usar**: Missões sequenciais onde steps recentes são mais relevantes.

**Configuração**:
```javascript
new ContextManager({
    chunkingStrategy: CHUNKING_STRATEGY.SLIDING_WINDOW,
    windowSize: 10  // Últimos 10 steps
});
```

**Exemplo**:
```
Steps disponíveis: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
windowSize: 5
Retorna: [8, 9, 10, 11, 12]
```

---

#### HIERARCHICAL (Hierárquico)

**Descrição**: Summary dos steps antigos + steps recentes completos.

**Quando usar**: Missões onde context histórico importa mas pode ser resumido.

**Configuração**:
```javascript
new ContextManager({
    chunkingStrategy: CHUNKING_STRATEGY.HIERARCHICAL,
    windowSize: 5
});
```

**Exemplo**:
```
Steps disponíveis: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
windowSize: 3
Retorna:
  - summary: "Steps 1-7 created outline, wrote chapters 1-6..."
  - steps: [8, 9, 10]
```

---

#### TOKEN_LIMIT (Limite de Tokens)

**Descrição**: Retorna steps até atingir maxTokens.

**Quando usar**: Controle estrito de context window.

**Configuração**:
```javascript
new ContextManager({
    chunkingStrategy: CHUNKING_STRATEGY.TOKEN_LIMIT,
    maxTokens: 50000  // Max 50k tokens
});
```

**Exemplo**:
```
Steps: [1: 10k tokens, 2: 15k tokens, 3: 20k tokens, 4: 25k tokens]
maxTokens: 50000
Retorna: [3, 4]  (total: 45k tokens)
```

---

#### NONE (Sem Chunking)

**Descrição**: Retorna TODOS os steps (perigoso para missões longas).

**Quando usar**: Missões curtas (< 5 steps) ou debugging.

**Configuração**:
```javascript
new ContextManager({
    chunkingStrategy: CHUNKING_STRATEGY.NONE
});
```

---

### 3. Summarization Policies

Controla **quando** resumir contexto antigo.

#### DISABLED

**Descrição**: Nunca resume. Contexto cresce indefinidamente.

**Quando usar**: Debugging ou missões muito curtas.

---

#### ON_OVERFLOW

**Descrição**: Resume apenas quando `token_count > maxTokens`.

**Quando usar**: Missões normais com controle de custo.

**Funcionamento**:
```
Steps adicionados: 1, 2, 3, 4, 5, ...
Quando token_count > maxTokens:
  1. Pega steps antigos (exceto últimos windowSize)
  2. Resume via LLM (ou concatenação simples)
  3. Armazena em context.summary
  4. Remove steps antigos do array
```

---

#### PERIODIC

**Descrição**: Resume a cada N steps.

**Quando usar**: Missões previsíveis (ex: 100 capítulos).

**Configuração**:
```javascript
new ContextManager({
    summarizationPolicy: SUMMARIZATION_POLICY.PERIODIC,
    summarizationInterval: 10  // Resume a cada 10 steps
});
```

---

#### ADAPTIVE

**Descrição**: Resume quando atinge 80% do maxTokens.

**Quando usar**: Balance entre overflow e performance.

---

### 4. Memory Store

**Responsabilidade**: Armazenar patterns aprendidos (feedbacks, sucessos, erros) para reutilização.

**Pattern Types**:
- `FEEDBACK`: Feedback do usuário
- `VALIDATION`: Resultados de validação (scores)
- `ERROR`: Erros encontrados
- `SUCCESS`: Boas práticas identificadas
- `CUSTOM`: Pattern customizado

**API**:

```javascript
// Adiciona pattern
contextManager.addPattern({
    type: 'FEEDBACK',
    content: 'Add more code examples',
    metadata: { mission: 'mission-123', step: 'step-5' }
});

// Busca patterns relevantes
const patterns = contextManager.getRelevantPatterns('code examples', 5);
// Returns: [{ id, type, content, metadata, created_at, access_count }, ...]

// Stats
const stats = contextManager.getStats();
// Returns: { active_missions, total_tokens, memory_store: { total_patterns, ... } }
```

**Search Scoring**:
```javascript
score = (keyword_matches * 1.0)
      + (pattern < 7 days old ? 0.5 : 0)
      + (access_count > 5 ? 0.3 : 0)
```

**LRU Eviction**: Quando `patterns.length > maxSize`, remove 10% dos menos usados.

---

## Integração com MissionManager

O **MissionManager** usa o ContextManager em 4 pontos:

### 1. Inicialização (createMission)

```javascript
async createMission({ title, templateId, params }) {
    // ... cria missão

    // Inicializa contexto
    this.contextManager.initializeContext(missionId, {
        metadata: { template: templateId, params }
    });

    return state;
}
```

---

### 2. Geração de Prompt (_generateTaskV5FromStep)

```javascript
_generateTaskV5FromStep(step, missionState) {
    let prompt = step.prompt_template;

    // Obtém contexto acumulado
    const context = this.contextManager.getContextForStep(
        missionState.id,
        step.id
    );

    // Injeta summary
    if (context && context.summary) {
        prompt += `\n\n[CONTEXT SUMMARY]:\n${context.summary}`;
    }

    // Injeta steps recentes
    if (context && context.steps.length > 0) {
        const recent = context.steps
            .map(s => `Step ${s.step_id}: ${s.output.substring(0, 300)}...`)
            .join('\n');
        prompt += `\n\n[RECENT STEPS]:\n${recent}`;
    }

    return taskV5;
}
```

**Exemplo de Prompt Gerado**:

```
Write Chapter 5 about Advanced Rust Patterns.

[CONTEXT SUMMARY]:
Steps 1-3: Created outline, wrote Chapter 1 (Introduction to Rust), Chapter 2 (Ownership)...

[RECENT STEPS]:
Step step-2-chapter-3: Chapter 3: Lifetimes in Rust. This chapter explains how Rust's lifetime system...
Step step-2-chapter-4: Chapter 4: Traits and Generics. Traits allow for polymorphism in Rust...

[FEEDBACK]: Add more code examples
```

---

### 3. Após Step Completo (_handleTaskCompleted)

```javascript
async _handleTaskCompleted(missionId, stepIndex, taskId, result) {
    // Salva output
    await this.stateManager.saveOutput(missionId, step.id, result.output);

    // Adiciona ao contexto
    await this.contextManager.addStepOutput(
        missionId,
        step.id,
        result.output
    );

    // ... atualiza progresso e executa próximo step
}
```

---

### 4. Cleanup (completeMission / failMission)

```javascript
async _completeMission(missionId) {
    // ... atualiza status

    // Limpa contexto (mas mantém memory store)
    this.contextManager.clearContext(missionId);
}

async _failMission(missionId, reason) {
    // ... atualiza status

    // Limpa contexto
    this.contextManager.clearContext(missionId);
}
```

---

## Integração com OrchestratorEngine

O **OrchestratorEngine** usa ContextManager para workflows **MULTI_STEP**.

### Inicialização (_initializeWorkflowState)

```javascript
_initializeWorkflowState(task) {
    const workflow_id = task.meta.workflow_id;

    // Inicializa contexto
    this.contextManager.initializeContext(workflow_id, {
        metadata: {
            task_id: task.meta.id,
            total_steps: steps.length
        }
    });
}
```

### Adicionar Output (_handleMultiStepStrategy)

```javascript
async _handleMultiStepStrategy(task, executionResult) {
    const output = executionResult.output || '';

    // Adiciona ao contexto
    await this.contextManager.addStepOutput(workflow_id, currentStep.id, output);

    // ... próximo step
}
```

### Gerar Prompt (_buildStepPrompt)

```javascript
_buildStepPrompt(step, accumulated_context, workflow_id) {
    let prompt = step.config.prompt;

    // Usa ContextManager se workflow_id fornecido
    if (workflow_id) {
        const context = this.contextManager.getContextForStep(workflow_id, step.id);

        if (context && context.summary) {
            prompt += `\n\n[CONTEXT SUMMARY]:\n${context.summary}`;
        }
    }

    return prompt;
}
```

---

## Configuração Recomendada por Caso de Uso

### Missão: Escrever Livro (15 capítulos)

```javascript
new ContextManager({
    chunkingStrategy: CHUNKING_STRATEGY.HIERARCHICAL,
    windowSize: 3,  // Últimos 3 capítulos completos
    summarizationPolicy: SUMMARIZATION_POLICY.ON_OVERFLOW,
    maxTokens: 50000,
    enableMemory: true
});
```

**Resultado**: Capítulos 1-12 resumidos, Capítulos 13-15 completos.

---

### Missão: Code Review (100 arquivos)

```javascript
new ContextManager({
    chunkingStrategy: CHUNKING_STRATEGY.SLIDING_WINDOW,
    windowSize: 5,  // Últimos 5 arquivos
    summarizationPolicy: SUMMARIZATION_POLICY.DISABLED,  // Não precisa resumir
    enableMemory: true  // Aprende patterns de code smells
});
```

---

### Missão: Research Paper (30 seções)

```javascript
new ContextManager({
    chunkingStrategy: CHUNKING_STRATEGY.TOKEN_LIMIT,
    maxTokens: 80000,  // Fit em GPT-4 Turbo (128k)
    summarizationPolicy: SUMMARIZATION_POLICY.ADAPTIVE,
    enableMemory: true
});
```

---

## Performance & Custos

### Token Estimation

**Estimativa**: 1 token ≈ 4 caracteres

```javascript
_estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
```

### Memory Usage

**Per Context**:
- 1 step output (~1KB) × windowSize (10) = ~10KB
- Summary (~500 bytes)
- Metadata (~100 bytes)

**Total**: ~11KB per active mission

**Example**: 10 missões ativas = ~110KB RAM

### Memory Store

**Per Pattern**: ~200 bytes
**Max Patterns**: 1000 (default)
**Total**: ~200KB RAM

---

## Troubleshooting

### Problema: Context window overflow mesmo com chunking

**Sintoma**: LLM retorna erro "context too long"

**Solução**:
1. Reduzir `windowSize`
2. Usar `TOKEN_LIMIT` strategy
3. Ativar `summarizationPolicy: ON_OVERFLOW`

---

### Problema: Steps perdem contexto importante

**Sintoma**: Step 10 não sabe o que aconteceu no Step 2

**Solução**:
1. Aumentar `windowSize`
2. Usar `HIERARCHICAL` strategy (summary + recent)
3. Verificar se summary está sendo gerado corretamente

---

### Problema: Memory leaks em missões longas

**Sintoma**: RAM cresce indefinidamente

**Solução**:
1. Verificar se `clearContext()` é chamado no complete/fail
2. Reduzir `memoryRetention` do Memory Store
3. Ativar summarization mais agressiva (`PERIODIC`)

---

## Testes

### Unit Tests

Localização: `tests/unit/orchestrator/test_context_manager.spec.js`

**Cobertura**:
- Context initialization ✅
- Adding step outputs ✅
- Chunking strategies (SLIDING_WINDOW, TOKEN_LIMIT, HIERARCHICAL) ✅
- Summarization policies (DISABLED, ON_OVERFLOW) ✅
- Memory Store (add, search, LRU eviction) ✅
- Cleanup ✅

**Run**: `npm test tests/unit/orchestrator/test_context_manager.spec.js`

---

### Integration Tests

Localização: `tests/integration/test_context_flow.spec.js`

**Cobertura**:
- Context initialization on mission creation ✅
- Context accumulation during execution ✅
- Context in task prompt generation ✅
- Context cleanup on complete/fail ✅
- Memory Store integration ✅
- Context statistics ✅

**Run**: `npm test tests/integration/test_context_flow.spec.js`

---

## Roadmap

### V2.1 (Próxima Release)

- [ ] LLM-based summarization (atualmente usa concatenação simples)
- [ ] Persist Memory Store to disk (atualmente apenas RAM)
- [ ] Context diff tracking (detecta contradições entre steps)
- [ ] Semantic search no Memory Store (embeddings)

### V2.2 (Futuro)

- [ ] Multi-level summarization (recursive)
- [ ] Context branching (A/B testing de contextos)
- [ ] Context compression via embeddings
- [ ] Cross-mission pattern transfer

---

## Referências

- **Código**: `src/orchestrator/context_manager.js`
- **Memory Store**: `src/orchestrator/memory_store.js`
- **MissionManager Integration**: `src/missions/mission_manager.js` (linhas 107, 348, 407, 447, 457)
- **OrchestratorEngine Integration**: `src/orchestrator/orchestrator_engine.js` (linhas 169, 325, 346, 418)
- **Tests**: `tests/unit/orchestrator/test_context_manager.spec.js`, `tests/integration/test_context_flow.spec.js`

---

## Exemplo Completo

```javascript
// 1. Setup
const { ContextManager, CHUNKING_STRATEGY, SUMMARIZATION_POLICY } = require('./orchestrator/context_manager');

const contextManager = new ContextManager({
    chunkingStrategy: CHUNKING_STRATEGY.HIERARCHICAL,
    windowSize: 3,
    summarizationPolicy: SUMMARIZATION_POLICY.ON_OVERFLOW,
    maxTokens: 50000,
    enableMemory: true,
    memoryRetention: 1000
});

// 2. Inicializa missão
contextManager.initializeContext('mission-book-writing', {
    metadata: { template: 'book_writing', chapters: 15 }
});

// 3. Simula execução de steps
await contextManager.addStepOutput('mission-book-writing', 'step-1',
    'Outline: Introduction, Chapter 1: Basics, Chapter 2: Advanced...');

await contextManager.addStepOutput('mission-book-writing', 'step-2',
    'Chapter 1: Rust Basics. Rust is a systems programming language...');

await contextManager.addStepOutput('mission-book-writing', 'step-3',
    'Chapter 2: Ownership. The ownership system is Rust\'s most unique feature...');

// 4. Gera prompt para próximo step
const context = contextManager.getContextForStep('mission-book-writing', 'step-4');

const prompt = `Write Chapter 3 about Borrowing.

[CONTEXT SUMMARY]:
${context.summary || 'No summary yet'}

[RECENT STEPS]:
${context.steps.map(s => `${s.step_id}: ${s.output.substring(0, 200)}...`).join('\n')}
`;

// 5. Adiciona pattern ao memory store
contextManager.addPattern({
    type: 'FEEDBACK',
    content: 'Always include code examples in technical chapters',
    metadata: { mission: 'mission-book-writing' }
});

// 6. Busca patterns relevantes
const patterns = contextManager.getRelevantPatterns('code examples', 3);

// 7. Stats
const stats = contextManager.getStats();
console.log(stats);
// {
//   active_missions: 1,
//   total_tokens: 5234,
//   memory_store: { total_patterns: 1, ... },
//   config: { ... }
// }

// 8. Cleanup
contextManager.clearContext('mission-book-writing');
```

---

**Last Updated**: 2026-01-28
**Version**: 2.0
**Status**: Production Ready ✅
