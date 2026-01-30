# 🚀 Plano: Sistema de Orquestração Autônoma v2.0

**Status**: 📋 Planejado - Implementação iniciará em 28/01/2026
**Versão**: 2.0.0
**Duração Estimada**: 8-10 semanas
**Última Atualização**: 28/01/2026

---

## 📖 Visão Executiva

Transformar o **chatgpt-docker-puppeteer** de um executor de tasks simples em uma **plataforma de orquestração autônoma** capaz de executar missões complexas de longa duração com **mínima intervenção humana**.

### Objetivo Principal

**AUTONOMIA > CONCORRÊNCIA**

Não se trata de executar 100 tasks simultaneamente. Trata-se de executar **UMA MISSÃO INTEIRA** (ex: escrever um livro de 300 páginas) do início ao fim automaticamente, com o sistema:
- ✅ Decompondo automaticamente em steps
- ✅ Executando cada step com validação automática
- ✅ Auto-refinando outputs até atingir qualidade desejada
- ✅ Gerenciando contexto entre steps
- ✅ Permitindo supervisão humana opcional

---

## 🎯 Conceitos Centrais

### Nova Hierarquia: Missão → Workflow → Tasks

```
┌────────────────────────────────────────────────────────┐
│ MISSÃO: "Escrever livro técnico de 300 páginas"       │
│ Objetivo de alto nível com critérios de qualidade      │
└────────────────────────────────────────────────────────┘
                        ↓
┌────────────────────────────────────────────────────────┐
│ WORKFLOW: Plano estruturado (17 steps)                │
│   Step 1: Generate Outline (1 task)                   │
│   Step 2-16: Write 15 Chapters (45 tasks)             │
│   Step 17: Consistency Check (1 task)                 │
└────────────────────────────────────────────────────────┘
                        ↓
┌────────────────────────────────────────────────────────┐
│ TASKS: Execuções individuais (~87 tasks geradas)      │
│   - Cada task pode iterar até 3× (auto-refinamento)   │
│   - Validação automática (LLM-as-judge)               │
│   - Context flow (output N → input N+1)               │
└────────────────────────────────────────────────────────┘
```

### Execução Iterativa Automática

```javascript
// Estratégia: ITERATIVE
iteration = 1
while (iteration <= 3) {
  output = LLM.execute(prompt)
  validation = LLMJudge.validate(output, criteria)

  if (validation.score >= 75) break;  // Passou!

  // Retry com feedback
  prompt += `\nFeedback (iteration ${iteration}): ${validation.issues}`
  iteration++
}
```

### LLM-as-Judge (Validação Automática)

Uma LLM (judge) avalia a qualidade do output de outra LLM (worker):

```javascript
judgePrompt = `
Avalie este capítulo nos critérios:
- Coerência (0-100)
- Precisão técnica (0-100)
- Exemplos de código (0-100)

Capítulo: ${output}

Retorne JSON: { overall_score, strengths[], weaknesses[], suggestions[] }
`
evaluation = await ChatGPT.execute(judgePrompt)
// { overall_score: 82, suggestions: ["Adicione mais exemplos"] }
```

**Trade-off**: +50% custo, +30s latência, mas **+40% qualidade final**

### Context Flow

Resultados de steps anteriores alimentam próximos steps:

```
Step 1: Outline → output: { chapters: [ch1, ch2, ch3, ...] }
Step 2: Chapter 1 → input: outline + (contexto vazio)
                    output: "Chapter 1: ..."
Step 3: Chapter 2 → input: outline + chapter 1
                    output: "Chapter 2: ..."
Step 4: Chapter 3 → input: outline + chapter 1 + chapter 2
                    output: "Chapter 3: ..."
```

---

## 🏗️ Novos Componentes

### 1. OrchestratorEngine - Motor de Execução

**Localização**: `src/orchestrator/orchestrator_engine.js`

**Estratégias de Execução**:
- **SINGLE_SHOT** (atual): Execute once
- **ITERATIVE** (novo): Execute → Validate → Retry até qualidade OK
- **MULTI_STEP** (novo): Workflow com N steps sequenciais
- **TREE_OF_THOUGHT** (futuro): Gera múltiplas soluções, escolhe melhor
- **CHAIN_OF_THOUGHT** (futuro): Reasoning step-by-step

**Integração**: Via NERV (zero coupling)

### 2. ValidationService - Qualidade Automática

**Localização**: `src/orchestrator/validation/validation_service.js`

**Validadores**:
- **RegexValidator**: Padrões regex
- **SchemaValidator**: JSON schema
- **LengthValidator**: Word/character count
- **LLMJudgeValidator**: LLM-as-judge (crítico!)

### 3. MissionManager - CRUD de Missões

**Localização**: `src/missions/mission_manager.js`

**API**:
- `createMission(params)` → Gera workflow, inicia execução
- `pauseMission(id)` → Pausa temporariamente
- `resumeMission(id)` → Retoma de checkpoint
- `feedbackMission(id, text)` → Injeta feedback humano
- `getMissionProgress(id)` → Status em tempo real

**Persistência** (filesystem):
```
missions/
├── mission-001/
│   ├── state.json           # metadata + workflow + progress
│   ├── outputs/             # resultados de cada step
│   ├── checkpoints/         # crash recovery
│   └── logs/                # execution log
```

### 4. ContextManager - Gestão de Contexto

**Localização**: `src/orchestrator/context_manager.js`

**Features**:
- **Accumulation**: Guardar resultados entre steps
- **Chunking**: Split contexto grande (> token limit)
- **Summarization**: Comprimir mantendo info crítica
- **Memory**: Aprender patterns durante execução

### 5. CheckpointManager - Crash Recovery

**Localização**: `src/orchestrator/checkpoint_manager.js`

**Checkpoints salvos**:
- A cada step completado
- Antes de operações críticas
- Periodicamente (a cada 5 minutos)

**Recovery**: Se crash, retoma do último checkpoint (<5min atrás)

---

## 📊 Exemplo Prático: Missão "Escrever Livro"

### Entrada

```json
{
  "mission_type": "book_writing",
  "parameters": {
    "topic": "Advanced Rust Programming",
    "num_chapters": 15,
    "target_pages": 300,
    "quality_threshold": 75
  }
}
```

### Workflow Gerado (17 steps)

1. Generate Outline → 1 task
2-16. Write 15 Chapters → 15 tasks (cada um até 3 iterações)
17. Consistency Check → 1 task

### Execução (~25 horas)

- **Tasks totais**: 87 (45 iterações de chapters + outros steps)
- **Retries**: 12 (quality < 75, então retry com feedback)
- **Feedback humano**: 1 no meio (opcional)
- **Custo**: ~$42 (de $50 budget)
- **Intervenção humana**: 5 minutos (dar feedback)

### Resultado

`missions/mission-001/rust-advanced-book.pdf` (312 páginas)

**Tempo sem o sistema**: ~200 horas de trabalho manual
**Tempo com o sistema**: ~25 horas (automático) + 5 min (supervisão)
**Economia**: **99.6% de tempo humano**

---

## 🛣️ Roadmap de Implementação

### Fase 1: Fundações Críticas (Semanas 1-2)

**Objetivo**: Permitir primeira missão simples (3-5 steps) executar

**Tarefas**:
1. **Schema V5** (3 dias)
   - Criar `task_schema_v5.js` com suporte a missions/workflows
   - Criar `migrator_v4_to_v5.js` para backward compatibility

2. **OrchestratorEngine Base** (5 dias)
   - Implementar 3 estratégias: SINGLE_SHOT, ITERATIVE, MULTI_STEP
   - Integrar com Kernel Loop via NERV

3. **ValidationService** (3 dias)
   - Implementar 4 validadores básicos
   - Foco em LLMJudgeValidator

4. **MissionManager CRUD** (4 dias)
   - Criar/ler/pausar/resumir missões
   - Persistência em filesystem

**Saída**: Primeira missão "Book Writing" (5 capítulos) pode executar

### Fase 2: Completude Backend (Semanas 3-4)

**Objetivo**: Todas funcionalidades backend operacionais

**Tarefas**:
1. **ContextManager** (5 dias) - Accumulation, chunking, summarization
2. **FeedbackProcessor** (3 dias) - Processar feedback, extrair patterns
3. **CheckpointManager** (2 dias) - Save/load checkpoints
4. **Extended NERV Constants** (1 dia) - 30+ novos ActionCodes
5. **API Controllers /missions** (4 dias) - REST API

**Saída**: Missões com 100+ steps podem executar

### Fase 3: Frontend Essencial (Semanas 5-6)

**Objetivo**: Dashboard permite criar/monitorar missões

**Tarefas**:
1. **Mission Store** (2 dias) - Pinia store
2. **Mission Views** (8 dias) - List, Create, Monitor, Detail
3. **Socket.io Real-time** (2 dias) - Eventos: MISSION_PROGRESS, MISSION_COMPLETED
4. **Feedback UI** (3 dias) - FeedbackModal, OutputViewer

**Saída**: Usuário cria missão via dashboard, monitora em tempo real

### Fase 4: Features Avançadas (Semanas 7-8)

**Objetivo**: Power user features

**Tarefas**:
1. **Workflow Editor** (8 dias) - DAG visual com Cytoscape.js
2. **Quality Dashboard** (3 dias) - Quality scores, validation pass rate
3. **Cost Dashboard** (3 dias) - Cost tracking, budget alerts
4. **Multi-Driver V2** (5 dias) - BaseDriverV2, auto-selection, fallback

**Saída**: Sistema completo, pronto para produção

### Fase 5: Polish & Deploy (Semanas 9-10)

**Objetivo**: v2.0.0 production-ready

**Tarefas**:
1. **Performance Testing** (3 dias) - 100+ concurrent missions
2. **E2E Tests** (4 dias) - Criar missão → executar → feedback → completar
3. **Documentation** (3 dias) - User guide, API reference
4. **Deploy** (5 dias) - Production deployment, monitoring

**Saída**: v2.0.0 em produção

---

## 📐 Arquitetura NERV-Centric

**Princípio Fundamental**: Todos os componentes comunicam via NERV (zero coupling direto)

```
OrchestratorEngine → NERV → Driver
                  ← NERV ← Driver (result)
                  → NERV → ValidationService
                  ← NERV ← ValidationService (quality_score)
                  → NERV → MissionManager
                  ← NERV ← MissionManager (state)
```

**Exemplo**:
```javascript
// OrchestratorEngine NUNCA chama Driver diretamente
orchestrator.execute(task) {
  // Emite comando via NERV
  nerv.emit({
    actionCode: 'ORCHESTRATION_EXECUTE_TASK',
    payload: { task }
  })

  // Aguarda resultado via NERV
  return new Promise(resolve => {
    nerv.once('DRIVER_RESULT', envelope => {
      resolve(envelope.payload)
    })
  })
}
```

---

## 🆕 Novos Eventos NERV (30+)

**Orquestração**:
- `ORCHESTRATION_STARTED`, `ORCHESTRATION_COMPLETED`, `ORCHESTRATION_FAILED`

**Iteração**:
- `ITERATION_STARTED`, `ITERATION_COMPLETED`, `ITERATION_CONVERGED`

**Validação**:
- `VALIDATION_PASSED`, `VALIDATION_FAILED`, `VALIDATION_RETRY`

**Qualidade**:
- `QUALITY_ASSESSED`, `QUALITY_IMPROVED`, `QUALITY_THRESHOLD_MET`

**Missões**:
- `MISSION_CREATED`, `MISSION_STARTED`, `MISSION_PAUSED`, `MISSION_RESUMED`, `MISSION_COMPLETED`

**Workflow**:
- `WORKFLOW_STEP_STARTED`, `WORKFLOW_STEP_COMPLETED`, `WORKFLOW_STEP_FAILED`

**Custo**:
- `TOKEN_USAGE_RECORDED`, `COST_CALCULATED`, `BUDGET_WARNING`, `BUDGET_EXCEEDED`

---

## 🎨 Dashboard v2.0 - Novas Views

### Mission Control Dashboard

- **MissionList.vue**: Lista todas missões (ativas, pausadas, completas)
- **MissionCreate.vue**: Criar nova missão (templates ou custom)
- **MissionMonitor.vue**: Progresso em tempo real (Step 12/17, 65%)
- **MissionDetail.vue**: Histórico completo de execução
- **WorkflowEditor.vue**: Editor visual de workflows (DAG com Cytoscape.js)

### Quality & Cost Dashboards

- **QualityDashboard.vue**: Quality scores, validation pass rate, iteration stats
- **CostDashboard.vue**: Cost tracking, budget alerts, projeções

### Real-time Updates (Socket.io)

```javascript
socket.on('mission:progress', ({ missionId, step, progress }) => {
  // Atualizar UI em tempo real
})

socket.on('mission:completed', ({ missionId, totalSteps, duration }) => {
  // Notificar usuário
})
```

---

## 📏 Métricas de Sucesso

### Launch Criteria v2.0

**Backend**:
- [ ] Missão "Escrever Livro" (15 cap) executa do início ao fim automaticamente
- [ ] Iteração automática funciona (até 3 retries)
- [ ] LLM-as-judge scoring consistente (±5 pontos)
- [ ] Context flow preserva info entre steps
- [ ] Checkpoint recovery < 5min
- [ ] Cost tracking com precisão 99%+

**Frontend**:
- [ ] Dashboard mostra progresso em tempo real
- [ ] Usuário pode criar missão em < 2min
- [ ] Feedback do usuário injetado em < 10s
- [ ] Workflow editor permite criar custom workflows
- [ ] Quality/Cost dashboards com gráficos

**Performance**:
- [ ] 10+ missões simultâneas sem degradação
- [ ] Missão "Book Writing" (15 cap) completa em < 48h
- [ ] Memory usage < 1GB (10 missões)
- [ ] CPU < 60% (carga pesada)

---

## ⚙️ Decisões de Design

### 1. Por que Filesystem (não Database)?

**Razões**:
- ✅ Sistema atual já usa com sucesso (fila/*.json)
- ✅ Simplicidade (sem dependency externa)
- ✅ Fácil debugging (`cat missions/mission-123/state.json`)
- ✅ Checkpoint recovery trivial
- ❌ Não escala para 10k+ missões simultâneas (mas não é o caso de uso)

### 2. Quando Usar LLM-as-Judge?

**Usar para**:
- ✅ Escrever capítulo de livro
- ✅ Gerar documentação técnica
- ✅ Traduzir conteúdo
- ✅ Refatorar código

**NÃO usar para**:
- ❌ Validar JSON schema (use SchemaValidator)
- ❌ Checar regex pattern (use RegexValidator)
- ❌ Contar palavras (use LengthValidator)

### 3. Estratégias de Execução - Trade-offs

| Estratégia | Overhead | Quando Usar |
|-----------|----------|-------------|
| SINGLE_SHOT | 0% | Task simples, não crítica |
| ITERATIVE | +100-200% | Qualidade importa, até 3 tentativas |
| MULTI_STEP | +5-10% | Missões complexas (5-100 steps) |
| TREE_OF_THOUGHT | +300-500% | Múltiplas soluções, escolher melhor |
| CHAIN_OF_THOUGHT | +50-100% | Reasoning explícito necessário |

---

## 🎁 Casos de Uso

### 1. Escrever Livro Técnico
- **Complexidade**: 300 páginas, 15 capítulos
- **Duration**: ~25 horas
- **Tasks**: 87
- **Cost**: ~$42

### 2. Desenvolver API REST Completa
- **Complexidade**: 11 features, testes automatizados
- **Duration**: ~11 horas
- **Tasks**: 33
- **Cost**: ~$25

### 3. Research Report
- **Complexidade**: 20 páginas, 28 sources, 38 citations
- **Duration**: ~8 horas
- **Tasks**: 15
- **Cost**: ~$29

### 4. Tradução Multi-idioma
- **Complexidade**: 12k palavras → 5 idiomas
- **Duration**: ~6 horas
- **Tasks**: 10
- **Cost**: ~$18

### 5. Refatoração de Codebase
- **Complexidade**: 15k linhas jQuery → React
- **Duration**: ~12 horas
- **Tasks**: 48
- **Cost**: ~$32

---

## 📚 Documentação Adicional

### Plano Detalhado (PLANO/)

1. **01-MISSION_ARCHITECTURE.md** - Arquitetura de missões
2. **02-AUTONOMOUS_EXECUTION.md** - Execução autônoma
3. **03-FEEDBACK_LOOPS.md** - Loops de feedback
4. **04-MISSION_EXAMPLES.md** - 5 exemplos práticos completos
5. **05-IMPLEMENTATION_ROADMAP.md** - Roadmap de 17 semanas (detalhado)

### Arquitetura

- **ARCHITECTURE.md** - Seção "Evolução Planejada: v2.0" adicionada

---

## 🚦 Status Atual

**Data de Início**: 28/01/2026
**Fase Atual**: Fase 1 - Fundações Críticas
**Progresso**: 0% (iniciando)

**Primeira Tarefa**: Implementar Task Schema V5

---

## 👥 Equipe

**Arquitetura**: AI Architect + Core Team
**Desenvolvimento Backend**: 2 desenvolvedores full-stack
**Desenvolvimento Frontend**: 1 desenvolvedor Vue.js
**QA**: 1 QA engineer
**DevOps**: 1 DevOps engineer

---

## 📞 Contato

Para dúvidas sobre o plano v2.0:
- **Issues**: GitHub Issues com label `v2.0-mission-orchestration`
- **Discussions**: GitHub Discussions

---

**Última Atualização**: 28/01/2026
**Próxima Revisão**: Semanal (toda segunda-feira)
**Status**: ✅ Aprovado para implementação
