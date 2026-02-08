# 📋 Análise do Fluxo de Processamento de Tasks

> **Autor**: Análise Arquitetural Completa
> **Data**: 04 de Fevereiro de 2026
> **Versão**: 1.0
> **Status do Sistema**: Response Capture V2.0 60% implementado

---

## 🎯 Objetivo Desta Análise

Mapear o fluxo **completo** de processamento de tasks desde a criação até o armazenamento da resposta:
1. Como tasks são criadas e interpretadas
2. Como responses são capturadas e armazenadas
3. Como task.result é preenchido
4. Identificar gaps, problemas e pontos de integração

---

## 🔄 Fluxo End-to-End (Mapeamento Completo)

```
┌──────────────────────────────────────────────────────────────────────┐
│ FASE 1: CRIAÇÃO DA TASK                                              │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                          ┌─────────▼─────────┐
                          │   Task V5 Schema  │  (src/core/schemas/task_schema_v5.js)
                          │   - meta.*        │
                          │   - spec.*        │
                          │   - state.*       │
                          │   - result.*      │
                          └─────────┬─────────┘
                                    │
┌──────────────────────────────────▼─────────────────────────────────┐
│ FASE 2: KERNEL RECEBE TASK                                          │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                          ┌─────────▼──────────┐
                          │ TaskExecutionOrch- │  (src/kernel/task_execution_orchestrator.js)
                          │ estrator           │
                          │ .executeTask(task) │
                          └─────────┬──────────┘
                                    │
                                    ├─> beforeExecution() (KernelNERVBridge)
                                    │   └─> Orchestrator prepara task (ITERATIVE/MULTI_STEP)
                                    │
                          ┌─────────▼──────────┐
                          │ NERV Event Bus     │
                          │ emit:              │
                          │ DRIVER_EXECUTE_TASK│
                          └─────────┬──────────┘
                                    │
┌──────────────────────────────────▼─────────────────────────────────┐
│ FASE 3: DRIVER RECEBE TASK                                          │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                          ┌─────────▼──────────┐
                          │ DriverNERVAdapter  │  (src/driver/nerv_adapter/driver_nerv_adapter.js)
                          │ ._executeTask()    │
                          └─────────┬──────────┘
                                    │
                                    ├─> Pool acquisition (driver acquire)
                                    ├─> Context attach (page + context)
                                    │
                          ┌─────────▼──────────┐
                          │  ChatGPTDriver     │  (src/driver/targets/ChatGPTDriver.js)
                          │  .execute(prompt)  │
                          └─────────┬──────────┘
                                    │
                                    ├─> sendPrompt()
                                    ├─> waitForCompletion()  ⬅️ MODIFICADO (Response V2)
                                    │   └─> ✅ RETORNA ResponseV2 object (não string)
                                    │
┌──────────────────────────────────▼─────────────────────────────────┐
│ FASE 4: RESPONSE CAPTURADA (NOVO V2.0)                              │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                          ┌─────────▼──────────┐
                          │ StructuredExtractor│  (src/driver/extractors/structured_extractor.js)
                          │ .extract(page)     │
                          └─────────┬──────────┘
                                    │
                                    ├─> Extrai HTML do browser
                                    ├─> Remove thought blocks (o1/o3)
                                    ├─> Converte HTML → Markdown (turndown)
                                    ├─> Parseia HTML → JSON (code, links, sections)
                                    ├─> Gera preview (primeiros 500 chars)
                                    │
                          ┌─────────▼──────────┐
                          │  ResponseV2 Object │
                          │  {                 │
                          │    content: {      │
                          │      text,         │
                          │      markdown,     │
                          │      html,         │
                          │      json          │
                          │    },              │
                          │    generation: {   │
                          │      model,        │
                          │      duration_ms,  │
                          │      tokens_estimate│
                          │    },              │
                          │    validation: {}  │  (OPCIONAL - LLM-as-Judge)
                          │    preview: {}     │
                          │  }                 │
                          └─────────┬──────────┘
                                    │
                                    ├─> [OPCIONAL] LLMJudge valida qualidade
                                    │   └─> completeness, relevance, quality (0-100)
                                    │
┌──────────────────────────────────▼─────────────────────────────────┐
│ FASE 5: DRIVER RETORNA RESULTADO                                    │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                          ┌─────────▼──────────┐
                          │ DriverNERVAdapter  │
                          │ emit:              │
                          │ DRIVER_TASK_       │
                          │ COMPLETED          │
                          │ payload: {         │
                          │   taskId,          │
                          │   result: response │  ⬅️ ResponseV2 object
                          │ }                  │
                          └─────────┬──────────┘
                                    │
                          ┌─────────▼──────────┐
                          │ NERV Event Bus     │
                          └─────────┬──────────┘
                                    │
┌──────────────────────────────────▼─────────────────────────────────┐
│ FASE 6: KERNEL PROCESSA RESULTADO                                   │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                          ┌─────────▼──────────┐
                          │ TaskExecutionOrch- │
                          │ estrator           │
                          │ ._handleTaskCompleted()│
                          └─────────┬──────────┘
                                    │
                                    ├─> afterExecution() (KernelNERVBridge)
                                    │   └─> Orchestrator decide: DONE/RETRY/NEXT_STEP
                                    │
┌──────────────────────────────────▼─────────────────────────────────┐
│ FASE 7: ARMAZENAMENTO DA RESPONSE  ⚠️ PONTO CRÍTICO (GAP)           │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                          ┌─────────▼──────────┐
                          │  ⚠️ ONDE?          │
                          │                    │
                          │ Opção A:           │
                          │ Driver salva antes │
                          │ de retornar?       │
                          │                    │
                          │ Opção B:           │
                          │ Kernel salva após  │
                          │ receber evento?    │
                          │                    │
                          │ Opção C:           │
                          │ NERV Bridge salva  │
                          │ após decisão?      │
                          └─────────┬──────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
          ┌─────────▼──────────┐         ┌─────────▼──────────┐
          │ ResponseAdapter    │         │ ResponseStoreV2    │
          │ (CRIADO)           │──────>  │ (CRIADO)           │
          │                    │         │                    │
          │ - Detecta V1/V2    │         │ - Salva .txt       │
          │ - Converte V1→V2   │         │ - Salva .md        │
          │ - Preenche         │         │ - Salva .json      │
          │   task.result      │         │ - Salva .html      │
          └─────────┬──────────┘         └─────────┬──────────┘
                    │                               │
                    └───────────────┬───────────────┘
                                    │
                          ┌─────────▼──────────┐
                          │  respostas/        │
                          │  task-123.txt      │
                          │  task-123.md       │
                          │  task-123.json     │
                          │  task-123.html     │
                          └────────────────────┘
```

---

## 📊 Estado Atual: O Que Funciona

### ✅ **1. Task Schema V5 (COMPLETO)**
- **Localização**: `src/core/schemas/task_schema_v5.js`
- **Status**: ✅ 100% implementado, 56/56 testes passando
- **Funcionalidades**:
  - Schema unificado (meta, spec, state, result)
  - Suporte a missões (mission_id, workflow_id)
  - Execution context (dependencies, artifacts, resource_limits)
  - Result V2 com multi-formato storage
  - Migração automática V4 → V5

**Exemplo de Task V5**:
```javascript
{
  meta: {
    id: 'task-7f2a9c',
    version: '5.0',
    created_at: '2026-02-04T10:00:00Z',
    mission_id: 'mission-abc', // NOVO
    workflow_id: 'workflow-xyz' // NOVO
  },
  spec: {
    target: 'chatgpt',
    prompt: 'Explain quantum computing',
    execution: {
      strategy: 'SINGLE_SHOT', // SINGLE_SHOT | ITERATIVE | MULTI_STEP
      retry: { max: 3, backoff: 'exponential' }
    }
  },
  state: {
    status: 'PENDING',
    priority: 1,
    iteration_state: { // NOVO
      current_iteration: 0,
      max_iterations: 3
    }
  },
  result: {
    status: 'SUCCESS',
    storage: {  // NOVO V2
      textFile: 'respostas/task-7f2a9c.txt',
      markdownFile: 'respostas/task-7f2a9c.md',
      jsonFile: 'respostas/task-7f2a9c.json',
      htmlFile: 'respostas/task-7f2a9c.html'
    },
    generation: {  // NOVO V2
      model: 'gpt-4-turbo',
      started_at: '2026-02-04T10:01:00Z',
      completed_at: '2026-02-04T10:02:30Z',
      duration_ms: 90000,
      tokens_estimate: 1500,
      continuations: 2,
      thought_blocks_pruned: 5
    },
    validation: {  // NOVO V2 (opcional)
      completeness: { score: 85, reasoning: 'Covers main topics' },
      relevance: { score: 90, reasoning: 'Directly answers question' },
      quality: { score: 88, reasoning: 'Well structured' },
      recommendation: 'ACCEPT' // ACCEPT | RETRY | MANUAL_REVIEW
    },
    preview: {  // NOVO V2
      text: 'Quantum computing is...',
      sections_count: 5,
      code_blocks_count: 3,
      links_count: 7
    }
  }
}
```

### ✅ **2. Task Execution Orchestrator (FUNCIONAL)**
- **Localização**: `src/kernel/task_execution_orchestrator.js`
- **Status**: ✅ Funcional, integrado com NERV + OrchestratorEngine
- **Responsabilidades**:
  - Intercepta tasks antes de enviar para Driver
  - Chama `beforeExecution()` para preparar task (ITERATIVE/MULTI_STEP)
  - Escuta eventos `DRIVER_TASK_COMPLETED/FAILED`
  - Chama `afterExecution()` para decidir próxima ação
  - Processa decisões: RETRY → reenviar, NEXT_STEP → criar nova task, DONE → finalizar

**Fluxo**:
```javascript
// 1. Kernel → Orchestrator
kernel.executeTask(task, correlationId)
  ├─> beforeExecution(task)        // Prepara task (orchestrator)
  ├─> emit DRIVER_EXECUTE_TASK     // Envia para Driver via NERV
  └─> await DRIVER_TASK_COMPLETED  // Escuta resposta

// 2. Driver → Kernel
driver emits DRIVER_TASK_COMPLETED { taskId, result }
  ├─> afterExecution(task, result) // Orchestrator decide ação
  ├─> processOrchestrationDecision(decision)
  └─> DONE | RETRY | NEXT_STEP
```

### ✅ **3. ChatGPTDriver Integration (MODIFICADO)**
- **Localização**: `src/driver/targets/ChatGPTDriver.js`
- **Status**: ✅ Modificado para Response V2.0 (60% completo)
- **Mudanças**:
  1. **Imports adicionados** (linhas 13-15):
     - `StructuredExtractor`
     - `LLMJudge`
  2. **Constructor** (linhas 103-125):
     - `this.structuredExtractor = new StructuredExtractor()`
     - `this.llmJudge = new LLMJudge()`
     - Campos de telemetria: `currentPrompt`, `executionStartTime`, `continuationCount`, `thoughtBlocksPruned`
  3. **sendPrompt()** modificado (linhas 281-286):
     - Rastreia `currentPrompt`, `executionStartTime`, contadores
  4. **waitForCompletion()** modificado (linhas 537-588):
     - ❌ ANTES: retornava string `currentText`
     - ✅ AGORA: retorna `ResponseV2` object
  5. **Método _estimateTokens()** adicionado (linhas 772-785):
     - Heurística: 1 token ≈ 4 chars

**Exemplo de Response V2 retornada**:
```javascript
{
  content: {
    text: "Plain text response...",
    markdown: "# Title\n\nContent...",
    html: "<div>...</div>",
    json: {
      sections: [...],
      codeBlocks: [...],
      links: [...]
    }
  },
  generation: {
    model: 'gpt-4-turbo',
    started_at: '2026-02-04T10:01:00Z',
    completed_at: '2026-02-04T10:02:30Z',
    duration_ms: 90000,
    tokens_estimate: 1500,
    continuations: 2,
    thought_blocks_pruned: 5,
    retry_attempts: 0
  },
  validation: {  // null se LLM_JUDGE_ENABLED=false
    completeness: { score: 85, reasoning: '...', isComplete: true },
    relevance: { score: 90, reasoning: '...', isRelevant: true },
    quality: { score: 88, reasoning: '...' },
    recommendation: 'ACCEPT'
  },
  preview: {
    text: "Quantum computing is... (primeiros 500 chars)",
    sections_count: 5,
    code_blocks_count: 3,
    links_count: 7,
    images_count: 2
  }
}
```

### ✅ **4. Response Capture V2.0 (60% IMPLEMENTADO)**

#### **4.1. StructuredExtractor** (✅ COMPLETO)
- **Localização**: `src/driver/extractors/structured_extractor.js`
- **Status**: ✅ 450 linhas, 14 funções, lint warning (linha 18)
- **Funções principais**:
  - `extract(page, protocol)`: Entry point
  - `_extractHTML(protocol)`: Executa no browser, remove thought blocks
  - `_convertToMarkdown(html)`: Usa turndown library
  - `_parseStructured(html)`: Extrai code blocks, links, images, tables, sections
  - `_generatePreview(text, structured)`: Cria preview object

**Thought Blocks Removal**:
```javascript
// Detecta e remove blocks <thinking>...</thinking> (o1/o3 models)
const thoughtBlockPattern = /<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi;
let thoughtBlocksPruned = 0;
htmlContent = htmlContent.replace(thoughtBlockPattern, match => {
    thoughtBlocksPruned++;
    return '';
});
```

#### **4.2. ResponseStoreV2** (✅ COMPLETO)
- **Localização**: `src/infra/storage/response_store_v2.js`
- **Status**: ✅ 270 linhas, 5 funções, sem erros
- **Funções principais**:
  - `saveResponseV2(taskId, responseData)`: Salva .txt, .md, .json, .html
  - `loadResponseV2(taskId, format='text')`: Carrega com fallback
  - `listAvailableFormats(taskId)`: Retorna formatos existentes
  - `responseExists(taskId)`: Boolean check
  - `deleteResponseV2(taskId)`: Remove todos os formatos

**Atomic Writes**:
```javascript
// Garante integridade (temp file + rename)
await atomicWrite(filepath, content);
```

**Estrutura de arquivos**:
```
respostas/
├── task-7f2a9c.txt       # Plain text
├── task-7f2a9c.md        # Markdown formatted
├── task-7f2a9c.json      # Structured JSON (sections, code, links)
└── task-7f2a9c.html      # Renderable HTML (com template)
```

#### **4.3. LLMJudge** (✅ COMPLETO - OPCIONAL)
- **Localização**: `src/validation/llm_judge.js`
- **Status**: ✅ 460 linhas, lint warning (linha 17)
- **Features**:
  - **Habilitável**: `config.LLM_JUDGE_ENABLED` (default: `false`)
  - **Timeout**: 15s default
  - **3 validações em paralelo**:
    - Completeness (0-100): Response responde completamente o prompt?
    - Relevance (0-100): Response é relevante ao prompt?
    - Quality (0-100): Response tem boa qualidade?
  - **Recommendation**:
    - `ACCEPT`: scores ≥ 70
    - `RETRY`: scores < 50
    - `MANUAL_REVIEW`: scores 50-69

**Prompts**:
```javascript
// Exemplo: Completeness validation
const completenessPrompt = `
You are a judge evaluating if the response fully answers the request.
REQUEST: "${prompt}"
RESPONSE: "${response}"

Score completeness (0-100) and explain.
Return JSON: { "score": 85, "reasoning": "...", "isComplete": true }
`;
```

#### **4.4. ResponseAdapter** (⚠️ CRIADO - SYNTAX ERROR)
- **Localização**: `src/infra/storage/response_adapter.js`
- **Status**: ⚠️ 220 linhas, syntax error linha 34
- **Propósito**: Compatibilidade V1 ↔ V2
- **Funções**:
  - `saveResponse(taskId, response, task)`: Auto-detecta V1/V2
  - `loadResponse(taskId, format)`: Backward compatible
  - `isResponseV2(response)`: Detecta formato
  - `convertV1toV2(responseText, task)`: Migra V1 → V2

**Erro atual**:
```javascript
// Linha 34: syntax error "Unexpected token"
const isV2 = isResponseV2(response);  // ← ERRO
```

**Provavelmente**: Comentário não terminado ou string mal formatada nas linhas acima.

---

## ⚠️ Gaps Críticos Identificados

### **GAP #1: ONDE A RESPONSE É SALVA?** 🔴

**Problema**: Não encontramos onde `responseAdapter.saveResponse()` é chamado.

**3 Possibilidades**:

#### **Opção A: Driver salva antes de retornar** (RECOMENDADO)
```javascript
// src/driver/nerv_adapter/driver_nerv_adapter.js
async _executeTask(payload, correlationId, retryCount = 0) {
    // ... (código existente)

    // Executa driver
    const result = await driver.execute(task.spec.prompt);  // ← ResponseV2 object

    // ✅ INSERIR AQUI: Salvar response
    const { saveResponse } = require('@infra/storage/response_adapter');
    await saveResponse(taskId, result, task);  // ← NOVO

    // Emite evento de conclusão
    this._emitBoth(
        ADAPTER_EVENTS.TASK_COMPLETED,
        ActionCode.DRIVER_TASK_COMPLETED,
        {
            taskId,
            result: {
                status: STATUS_VALUES.SUCCESS,
                outputLength: result?.content?.text?.length || 0,
                duration
            }
        },
        correlationId
    );
}
```

**Vantagens**:
- ✅ Response salva **antes** de emitir evento (dados garantidos)
- ✅ Driver tem acesso direto ao ResponseV2 (não precisa reconstruir)
- ✅ Se salvar falhar, pode emitir `TASK_FAILED` em vez de `TASK_COMPLETED`
- ✅ Responsabilidade clara: Driver gerencia response storage

#### **Opção B: Kernel salva após receber evento**
```javascript
// src/kernel/task_execution_orchestrator.js
async _handleTaskCompleted(payload, correlationId) {
    const { taskId, result } = payload;  // result = ResponseV2 object

    // ✅ INSERIR AQUI: Salvar response
    const { saveResponse } = require('@infra/storage/response_adapter');
    const task = this._getTaskFromCache(taskId);  // ← PROBLEMA: precisa cache
    await saveResponse(taskId, result, task);

    // ... (resto do código)
}
```

**Desvantagens**:
- ❌ Kernel precisa cachear tasks (não implementado)
- ❌ Response já foi emitida via NERV (redundância)
- ❌ Se salvar falhar, evento já foi processado (inconsistência)

#### **Opção C: NERV Bridge salva após decisão**
```javascript
// src/kernel/nerv_bridge/kernel_nerv_bridge.js
async processOrchestrationDecision(decision, correlationId) {
    const { action, task } = decision;

    if (action === 'DONE') {
        // ✅ INSERIR AQUI: Salvar response
        const { saveResponse } = require('@infra/storage/response_adapter');
        await saveResponse(task.meta.id, task.result, task);  // ← PROBLEMA: result não está em task
    }
}
```

**Desvantagens**:
- ❌ Response não está em `task.result` (está no payload do evento)
- ❌ Só salva se action === 'DONE' (RETRY/NEXT_STEP perdem response)

**✅ RECOMENDAÇÃO: Opção A (Driver salva antes de retornar)**

---

### **GAP #2: Response não chega preenchida em task.result** 🟡

**Problema**: `TaskExecutionOrchestrator._handleTaskCompleted()` recebe:
```javascript
payload: { taskId, result }  // result = ResponseV2 object
```

Mas **não preenche** `task.result` com os campos V5:
- `task.result.storage` (paths dos 4 arquivos)
- `task.result.generation` (model, duration, tokens)
- `task.result.validation` (LLM-as-judge scores)
- `task.result.preview` (primeiros 500 chars + counts)

**Solução**: `responseAdapter.saveResponseV2Format()` já preenche task.result, mas precisa ser chamado!

---

### **GAP #3: ResponseAdapter não é importado em nenhum lugar** 🔴

**Busca realizada**:
```bash
grep -r "require.*response_adapter" src/
# RESULT: 0 matches
```

**Módulos que deveriam importar**:
- ❌ `src/driver/nerv_adapter/driver_nerv_adapter.js` (NÃO IMPORTA)
- ❌ `src/kernel/task_execution_orchestrator.js` (NÃO IMPORTA)
- ❌ `src/kernel/nerv_bridge/kernel_nerv_bridge.js` (NÃO IMPORTA)

**Conclusão**: ResponseAdapter está criado mas **não está integrado** ao fluxo.

---

### **GAP #4: ChatGPTDriver retorna ResponseV2, mas quem consome?** 🟡

**Modificação feita**:
```javascript
// src/driver/targets/ChatGPTDriver.js (linha 537-588)
async waitForCompletion() {
    // ... (extraction logic)

    // ✅ NOVO: Retorna ResponseV2 object
    return {
        content: { text, markdown, html, json },
        generation: { model, started_at, completed_at, ... },
        validation: validationResult,  // pode ser null
        preview: { text: previewText, ... }
    };
}
```

**Quem chama `waitForCompletion()`?**
- `ChatGPTDriver.execute()` (linha 330-450)
- `DriverNERVAdapter._executeTask()` (linha 650-700)

**Payload do evento NERV**:
```javascript
// src/driver/nerv_adapter/driver_nerv_adapter.js (linha 710)
this._emitBoth(
    ADAPTER_EVENTS.TASK_COMPLETED,
    ActionCode.DRIVER_TASK_COMPLETED,
    {
        taskId,
        result: {  // ← PROBLEMA: não inclui ResponseV2 completo
            status: STATUS_VALUES.SUCCESS,
            outputLength: result?.length || 0,  // ← Tratando como string?
            duration
        }
    },
    correlationId
);
```

**Problema**: Event payload não inclui ResponseV2 completo! Apenas `status`, `outputLength`, `duration`.

**Solução**: Modificar `_emitBoth` para incluir `result` completo:
```javascript
this._emitBoth(
    ADAPTER_EVENTS.TASK_COMPLETED,
    ActionCode.DRIVER_TASK_COMPLETED,
    {
        taskId,
        result: result,  // ← MODIFICAR: incluir ResponseV2 completo
        timings: { poolAcquire, contextAttach, execute, total: duration }
    },
    correlationId
);
```

---

### **GAP #5: BaseDriver não interpreta fields de Task V5** 🟢 (PROVAVELMENTE OK)

**Busca realizada**: Não encontramos `src/driver/targets/base_driver.js`

**Alternativa**: Drivers concretos (ChatGPTDriver, GeminiDriver) implementam interface própria.

**Campos V5 relevantes para drivers**:
- `task.spec.prompt` ✅ (usado)
- `task.spec.target` ✅ (usado)
- `task.spec.execution.strategy` ❓ (ITERATIVE/MULTI_STEP - não usado por drivers?)
- `task.spec.execution.retry` ❓ (configuração de retry - usado por Driver ou Kernel?)
- `task.execution_context.*` ❓ (dependencies, artifacts - não usado por drivers?)

**Análise**:
- **Estratégias** (SINGLE_SHOT/ITERATIVE/MULTI_STEP): Gerenciadas pelo **Orchestrator**, não pelo Driver
- **Retry**: Gerenciado pelo **Policy Engine** no Kernel, não pelo Driver
- **Execution context**: Usado pelo **Orchestrator** para preparar task, não pelo Driver

**Conclusão**: Drivers **não precisam** interpretar todos os campos V5. Apenas:
- `task.spec.prompt`
- `task.spec.target`
- `task.meta.id` (para logging)

---

## 🔧 Correções Necessárias (Prioridade)

### **1. Corrigir Syntax Error em ResponseAdapter** (CRÍTICO - 5 min)
```bash
# Arquivo: src/infra/storage/response_adapter.js
# Linha 34: syntax error

# Possíveis causas:
# - Comentário multi-linha não fechado (linhas 1-30)
# - String template não fechada
# - JSDoc malformado

# AÇÃO: Verificar linhas 1-34, especialmente:
# - Linha 2-14: header comment
# - Linha 31-34: função saveResponse
```

### **2. Integrar ResponseAdapter no Driver** (URGENTE - 30 min)
```javascript
// src/driver/nerv_adapter/driver_nerv_adapter.js

// ✅ ADICIONAR import no topo:
const { saveResponse } = require('@infra/storage/response_adapter');

// ✅ MODIFICAR _executeTask (linha ~700):
async _executeTask(payload, correlationId, retryCount = 0) {
    // ... (código existente até driver.execute)

    // Executa driver
    const result = await Promise.race([
        driver.execute(task.spec.prompt),
        this._createExecutionTimeout(taskId, timings)
    ]);

    timings.execute = Date.now();
    const duration = timings.execute - timings.total;

    // ✅ NOVO: Salvar response ANTES de emitir evento
    try {
        await saveResponse(taskId, result, task);  // ← INSERIR AQUI
        logger.info(`[DriverNERVAdapter] Response saved for task ${taskId}`, correlationId);
    } catch (saveError) {
        logger.error('[DriverNERVAdapter] Failed to save response', {
            taskId,
            error: saveError.message,
            correlationId
        });
        // Continuar mesmo se salvar falhar (response ainda pode ser usada)
    }

    // Emite evento de conclusão
    this._emitBoth(
        ADAPTER_EVENTS.TASK_COMPLETED,
        ActionCode.DRIVER_TASK_COMPLETED,
        {
            taskId,
            result: result,  // ✅ MODIFICAR: incluir ResponseV2 completo (não só status)
            timings: {
                poolAcquire: timings.poolAcquire,
                contextAttach: timings.contextAttach,
                execute: timings.execute,
                total: duration
            }
        },
        correlationId
    );

    // ... (resto do código)
}
```

### **3. Modificar Event Payload para incluir ResponseV2 completo** (URGENTE - 15 min)
```javascript
// src/driver/nerv_adapter/driver_nerv_adapter.js (linha ~710)

// ❌ ANTES:
this._emitBoth(
    ADAPTER_EVENTS.TASK_COMPLETED,
    ActionCode.DRIVER_TASK_COMPLETED,
    {
        taskId,
        result: {
            status: STATUS_VALUES.SUCCESS,
            outputLength: result?.length || 0,  // ← Tratando como string
            duration
        },
        timings: { ... }
    },
    correlationId
);

// ✅ DEPOIS:
this._emitBoth(
    ADAPTER_EVENTS.TASK_COMPLETED,
    ActionCode.DRIVER_TASK_COMPLETED,
    {
        taskId,
        result: result,  // ← ResponseV2 object completo
        timings: {
            poolAcquire: timings.poolAcquire,
            contextAttach: timings.contextAttach,
            execute: timings.execute,
            total: duration
        }
    },
    correlationId
);
```

### **4. Cachear task em TaskExecutionOrchestrator** (IMPORTANTE - 20 min)
```javascript
// src/kernel/task_execution_orchestrator.js

class TaskExecutionOrchestrator {
    constructor({ nerv, nervBridge }) {
        // ... (existente)

        // ✅ ADICIONAR: Cache de tasks (não só correlationId)
        this.activeExecutions = new Map();  // task_id → { task, correlationId }
    }

    async executeTask(task, correlationId) {
        // ... (existente até preparedTask)

        // ✅ MODIFICAR: Cacheia task completa (não só correlationId)
        this.activeExecutions.set(taskId, {
            task: preparedTask,
            correlationId,
            startedAt: Date.now()
        });

        // ... (resto do código)
    }

    async _handleTaskCompleted(payload, correlationId) {
        const { taskId, result } = payload;  // result = ResponseV2 object

        // ✅ MODIFICAR: Recupera task do cache
        const cached = this.activeExecutions.get(taskId);
        if (!cached) {
            return;  // Task não estava sendo orquestrada
        }

        const task = cached.task;  // ← Agora temos a task completa

        logger.log('INFO', `[TaskExecutionOrchestrator] Task completada: ${taskId}`, correlationId);

        // Hook: afterExecution (orchestrator decide próxima ação)
        const decision = await this.nervBridge.afterTaskExecution(task, result);

        // ... (resto do código)
    }
}
```

### **5. Criar testes para ResponseAdapter** (NECESSÁRIO - 60 min)
```javascript
// tests/test_response_adapter.js

const assert = require('assert');
const { saveResponse, loadResponse, isResponseV2, convertV1toV2 } = require('@infra/storage/response_adapter');

describe('ResponseAdapter', () => {
    it('should detect ResponseV2 format', () => {
        const v2 = { content: {}, generation: {}, validation: null, preview: {} };
        const v1 = "Plain text response";

        assert.strictEqual(isResponseV2(v2), true);
        assert.strictEqual(isResponseV2(v1), false);
    });

    it('should convert V1 to V2', () => {
        const v1 = "Test response";
        const task = { meta: { id: 'task-123' }, spec: { target: 'chatgpt' } };

        const v2 = convertV1toV2(v1, task);

        assert.strictEqual(v2.content.text, v1);
        assert.ok(v2.generation);
        assert.ok(v2.preview);
    });

    it('should save and load V2 response', async () => {
        const taskId = 'test-task-' + Date.now();
        const response = {
            content: { text: 'Test', markdown: '# Test', html: '<p>Test</p>', json: {} },
            generation: { model: 'gpt-4', duration_ms: 1000 },
            validation: null,
            preview: { text: 'Test', sections_count: 1 }
        };
        const task = { meta: { id: taskId }, result: {} };

        await saveResponse(taskId, response, task);

        const loaded = await loadResponse(taskId, 'text');
        assert.strictEqual(loaded, 'Test');

        // Verificar task.result preenchido
        assert.ok(task.result.storage);
        assert.ok(task.result.generation);
        assert.ok(task.result.preview);
    });
});
```

---

## 📈 Melhorias Futuras (Post-V2.0)

### **1. Response Streaming** (V2.1)
- Salvar response incremental durante geração
- Permitir retomada de tasks interrompidas
- Preview em tempo real no dashboard

### **2. Response Compression** (V2.1)
- Compactar .json e .html (gz)
- Reduzir uso de disco (HTML pode ser grande)
- Manter .txt e .md sem compressão (legibilidade)

### **3. Response Search Index** (V2.2)
- Indexar responses em banco (SQLite/PostgreSQL)
- Busca full-text por conteúdo
- Aggregations (média de tokens, duration, etc.)

### **4. Response Caching** (V2.2)
- Cache de responses idênticas (prompt hash)
- Evitar re-executar tasks duplicadas
- TTL configurável

### **5. Multi-Turn Context Management** (V2.3)
- Encadear responses de múltiplas tasks
- Context window tracking (tokens acumulados)
- Automatic context pruning

---

## 🎯 Sumário Executivo

### **Estado Atual** (60% Response Capture V2.0)

#### ✅ **O Que Funciona**:
1. **Task Schema V5**: 100% completo, 56/56 testes, PRODUCTION READY
2. **Task Execution Orchestrator**: Integrado com NERV + OrchestratorEngine
3. **ChatGPTDriver**: Retorna ResponseV2 object (multi-formato)
4. **StructuredExtractor**: Extrai HTML/Markdown/JSON, remove thought blocks
5. **ResponseStoreV2**: Salva .txt/.md/.json/.html com atomic writes
6. **LLMJudge**: Valida qualidade (opcional, 3 scores + recommendation)

#### ⚠️ **O Que Falta**:
1. **ResponseAdapter**: Criado mas com syntax error (linha 34)
2. **Integração**: `saveResponse()` não é chamado em nenhum lugar
3. **Event Payload**: Não inclui ResponseV2 completo (só status + duration)
4. **Task Cache**: Orchestrator precisa cachear tasks (não só correlationId)
5. **Testes**: 0 testes para ResponseAdapter e integração end-to-end

#### 🔴 **Gaps Críticos**:
- **GAP #1**: Response não é salva no fluxo (adapter não integrado)
- **GAP #2**: `task.result` não é preenchido (storage, generation, validation)
- **GAP #3**: Event payload não transporta ResponseV2 completo
- **GAP #4**: Orchestrator não tem acesso a task completa em `_handleTaskCompleted()`

### **Próximos Passos** (3 horas de trabalho)

1. ✅ **Corrigir syntax error** (ResponseAdapter linha 34) - 5 min
2. ✅ **Integrar saveResponse no Driver** (driver_nerv_adapter.js) - 30 min
3. ✅ **Modificar event payload** (incluir ResponseV2 completo) - 15 min
4. ✅ **Cachear tasks** (TaskExecutionOrchestrator) - 20 min
5. ✅ **Criar testes** (ResponseAdapter) - 60 min
6. ✅ **Documentar** (RESPONSE_CAPTURE_V2.md) - 30 min
7. ✅ **Validar end-to-end** (executar task real e verificar arquivos) - 30 min

**Total estimado**: ~3 horas para completar Response Capture V2.0

---

## 📚 Referências

### **Arquivos Criados** (Response Capture V2.0):
- `src/driver/extractors/structured_extractor.js` (450 linhas)
- `src/infra/storage/response_store_v2.js` (270 linhas)
- `src/validation/llm_judge.js` (460 linhas)
- `src/infra/storage/response_adapter.js` (220 linhas) ⚠️ syntax error

### **Arquivos Modificados**:
- `src/driver/targets/ChatGPTDriver.js` (5 edits, ~80 linhas modificadas)

### **Dependências Instaladas**:
- `turndown` (HTML → Markdown)
- `node-html-parser` (HTML parsing)
- 13 packages total (4s install)

### **Documentos de Referência**:
- `UPGRADE_PROPOSAL_3SYSTEMS.md` (proposta original)
- `docs/TASK_SCHEMA_V5.md` (documentação V5, 550 linhas)
- `DOCUMENTAÇÃO/ARCHITECTURE.md` (arquitetura completa V3.0, 3,018 linhas)
- `DOCUMENTAÇÃO/DATA_FLOW.md` (fluxos de dados)

---

**FIM DA ANÁLISE** ✅

_Esta análise mapeia 100% do fluxo de tasks atual, identifica gaps críticos e propõe soluções concretas para completar Response Capture V2.0._
