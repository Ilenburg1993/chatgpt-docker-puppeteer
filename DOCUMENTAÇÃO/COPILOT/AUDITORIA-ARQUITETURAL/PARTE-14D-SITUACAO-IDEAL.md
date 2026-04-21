# PARTE 14D — Situação Atual vs. Situação Ideal

**Data**: 2026-03-15 **Baseline**: commit `54c135c4` (pós-F44) **Referência**: PARTE-14A/B/C

---

## 1. Situação Atual — Resumo Executivo

### O que está bom ✅

O módulo `agent/` passou por 48 fases de refatoração (F1–F48) e alcançou uma arquitetura sólida:

1. **Facade genuinamente fina** — `always-alive.js` é pura delegação (621L, sem lógica embutida)
2. **Context Object funcional** — `agent-context.js` eliminou 32+ campos privados dispersos
3. **Separação em subsistemas** — 6 subsistemas com responsabilidades claras
4. **Typedefs centralizados** — Host interfaces em `types.js` (F45)
5. **Segurança robusta** — SSRF prevention, DNS rebinding, payload sanitization, Zod validation
6. **Zero dependências circulares** — hierarquia top-down estrita
7. **46 testes unitários passando** — cobertura da facade + módulos extraídos (F41/F46)
8. **JSDoc limpo** — `@ts-check` em 100% dos arquivos, sem duplicatas (F44)

### O que precisa melhorar ⚠️

| Nº  | Problema                                                                           | Impacto          | Área              |
| --- | ---------------------------------------------------------------------------------- | ---------------- | ----------------- |
| 1   | 3 arquivos monolíticos (>500L): loop-manager, event-wirer, always-alive            | Manutenibilidade | dialog/, session/ |
| 2   | Cobertura de testes de 16% (6/37 arquivos)                                         | Confiabilidade   | Todos             |
| 3   | initializer.js mistura 3 responsabilidades (376L)                                  | Coesão           | session/          |
| 4   | Padrões inconsistentes: sync/async FS, EventEmitter vs callbacks, barrels parciais | Consistência     | Transversal       |
| 5   | AgentContext é God Object mutable sem invariantes                                  | Robustez         | Raiz              |
| 6   | Observabilidade parcial: OTEL apenas em task-executor                              | Operabilidade    | infra/            |
| 7   | messaging/ e state/ com 1 arquivo cada — assimetria                                | Organização      | Raiz              |
| 8   | wireDialogLoopEvents() dentro de loop-manager.js                                   | Coesão           | dialog/           |
| 9   | snapshot.js usa FS síncrono                                                        | Performance      | session/          |
| 10  | Nenhum teste de integração end-to-end no agent/                                    | Confiabilidade   | Testes            |

---

## 2. Situação Ideal — Visão Arquitetural

### 2.1 Princípios da Situação Ideal

1. **Nenhum arquivo > 400L** — decomposição onde necessário
2. **Cobertura de testes ≥ 60%** — todos os módulos com lógica complexa testados
3. **Padrão único de I/O** — 100% async, sem `*Sync` exceto em paths de shutdown
4. **AgentContext com invariantes** — validação de transições de estado
5. **Observabilidade uniforme** — OTEL spans em todos os fluxos críticos
6. **Barrels consistentes** — todos os subsistemas com index.js
7. **Cada módulo ≤ 1 responsabilidade** — SRP estrito
8. **Event wiring separado** — um módulo por domínio de eventos

### 2.2 Árvore Ideal

```
src/copilot/agent/
├── always-alive.js          ~500L   Facade (menor após extrações)
├── agent-context.js         ~250L   Context + validação de invariantes
├── config.js                ~180L   Sem mudança
├── types.js                 ~200L   + novos typedefs para sub-módulos
├── index.js                  ~25L   + messaging/ e state/ barrels
│
├── dialog/
│   ├── loop-manager.js      ~350L   Apenas mutex + loop principal
│   ├── turn-executor.js     ~360L   Sem mudança
│   ├── backpressure.js      ~100L   [NOVO] Extraído de loop-manager
│   ├── model-fallback.js    ~80L    [NOVO] Extraído de loop-manager
│   ├── event-wiring.js      ~120L   [NOVO] wireDialogLoopEvents()
│   ├── agent-dialog-controller.js ~150L  Sem mudança
│   ├── watchdog.js          ~190L   + thresholds de config.js
│   ├── protocol.js          ~120L   + enum de tipos
│   ├── user-input-handler.js ~110L  Sem mudança
│   └── index.js              ~25L   Atualizado
│
├── lifecycle/
│   ├── agent-lifecycle.js   ~280L   initSession decomposta
│   ├── session-setup.js     ~120L   [NOVO] Extraído de initSession steps
│   ├── entry.js             ~165L   + retry de config.js
│   ├── reconnect-policy.js  ~135L   + JSDoc melhorado
│   ├── state-io.js          ~220L   Deprecar writeState sync
│   └── index.js               9L   Sem mudança
│
├── session/
│   ├── initializer.js       ~200L   Apenas init/resume
│   ├── hook-context.js      ~180L   [NOVO] buildHookSystemContext extraído
│   ├── event-handlers/            [NOVO] Diretório de handlers por domínio
│   │   ├── compaction.js    ~60L
│   │   ├── streaming.js     ~80L
│   │   ├── token-budget.js  ~50L
│   │   ├── mode-and-tools.js ~40L
│   │   ├── system-notifications.js ~80L
│   │   ├── sdk-responses.js ~60L
│   │   ├── usage.js         ~30L
│   │   ├── catch-all.js     ~40L
│   │   └── index.js         ~20L
│   ├── event-wirer.js       ~150L   Orquestra handlers (delegação)
│   ├── boot-wiring.js       ~225L   Sem mudança (aceitar)
│   ├── snapshot.js          ~215L   Migrar para async FS
│   ├── keepalive.js         ~155L   Sem mudança
│   ├── history-sync.js      ~110L   Sem mudança
│   ├── cleanup.js           ~100L   + Promise.allSettled
│   ├── rotation.js           ~90L   + métricas
│   └── index.js              ~25L   Atualizado
│
├── infra/
│   ├── webhook-manager.js   ~250L   URL validation extraída
│   ├── url-validator.js     ~80L    [NOVO] Segurança reutilizável
│   ├── message-queue.js     ~215L   Sem mudança
│   ├── task-executor.js     ~180L   + OTEL via wrapper
│   ├── permission-controller.js ~155L  Sem mudança
│   ├── handoff-manager.js   ~160L   Sem mudança
│   ├── tools-bootstrap.js   ~135L   Sem mudança
│   ├── status-snapshot.js   ~105L   Sem mudança
│   └── index.js              ~20L   + url-validator
│
├── messaging/
│   ├── agent-messaging.js   ~250L   Sem mudança
│   └── index.js              ~10L   [NOVO] Barrel
│
└── state/
    ├── agent-state.js         ~75L   Sem mudança
    └── index.js               ~10L   [NOVO] Barrel
```

### 2.3 Mudanças Quantitativas

| Métrica              | Atual    | Ideal        | Delta          |
| -------------------- | -------- | ------------ | -------------- |
| Arquivos (.js)       | 37       | 50           | +13 novos      |
| Maior arquivo        | 661L     | ~360L        | -45%           |
| Linhas totais        | ~7.200L  | ~7.600L      | +5% (+ testes) |
| Testes unitários     | 46       | ~140         | +200%          |
| Cobertura (arquivos) | 16%      | ~65%         | +49pp          |
| Barrels              | 5        | 7            | +2             |
| FS sync calls        | 8        | 1 (shutdown) | -87%           |
| OTEL spans           | 1 módulo | 5+ módulos   | +400%          |

---

## 3. Gap Analysis — Atual → Ideal

### 3.1 Gaps Estruturais

| Gap ID | Descrição                                                          | Esforço | Risco  |
| ------ | ------------------------------------------------------------------ | ------- | ------ |
| GAP-S1 | loop-manager.js split (backpressure, model-fallback, event-wiring) | Alto    | Médio  |
| GAP-S2 | event-wirer.js decomposição em event-handlers/                     | Alto    | Baixo  |
| GAP-S3 | initializer.js split (hook-context.js)                             | Médio   | Baixo  |
| GAP-S4 | Barrels para messaging/ e state/                                   | Baixo   | Nenhum |
| GAP-S5 | session-setup.js extraído de agent-lifecycle.js                    | Médio   | Baixo  |

### 3.2 Gaps de Qualidade

| Gap ID  | Descrição                                           | Esforço | Risco  |
| ------- | --------------------------------------------------- | ------- | ------ |
| GAP-Q1  | Testes para loop-manager.js (mutex, backpressure)   | Alto    | Médio  |
| GAP-Q2  | Testes para turn-executor.js (race conditions)      | Alto    | Médio  |
| GAP-Q3  | Testes para initializer.js (Zod, rotation, resume)  | Médio   | Baixo  |
| GAP-Q4  | Testes para event-wirer.js (event routing)          | Médio   | Baixo  |
| GAP-Q5  | Testes para message-queue.js (AbortSignal, drain)   | Médio   | Baixo  |
| GAP-Q6  | Testes para task-executor.js (streaming, retry)     | Médio   | Médio  |
| GAP-Q7  | Testes para webhook-manager.js (SSRF, retry)        | Médio   | Baixo  |
| GAP-Q8  | Testes para protocol.js, rotation.js, watchdog.js   | Baixo   | Nenhum |
| GAP-Q9  | Testes para cleanup.js, keepalive.js, snapshot.js   | Baixo   | Nenhum |
| GAP-Q10 | Teste de integração end-to-end agent boot/send/stop | Alto    | Médio  |

### 3.3 Gaps de Consistência

| Gap ID | Descrição                                        | Esforço | Risco  |
| ------ | ------------------------------------------------ | ------- | ------ |
| GAP-C1 | Migrar snapshot.js para async FS                 | Baixo   | Nenhum |
| GAP-C2 | Deprecar writeState() sync em state-io.js        | Baixo   | Nenhum |
| GAP-C3 | cleanup.js: for...of → Promise.allSettled        | Baixo   | Nenhum |
| GAP-C4 | Watchdog thresholds de config.js (não hardcoded) | Baixo   | Nenhum |
| GAP-C5 | entry.js: retry count de config.js               | Baixo   | Nenhum |

### 3.4 Gaps de Observabilidade

| Gap ID | Descrição                                      | Esforço | Risco  |
| ------ | ---------------------------------------------- | ------- | ------ |
| GAP-O1 | OTEL spans em dialog loop (turn start/end)     | Médio   | Nenhum |
| GAP-O2 | OTEL spans em reconnect (attempt/success/fail) | Baixo   | Nenhum |
| GAP-O3 | OTEL spans em session init/resume              | Baixo   | Nenhum |
| GAP-O4 | Métricas em rotation.js quando decide rotar    | Baixo   | Nenhum |
| GAP-O5 | Health endpoint dedicado no agent              | Médio   | Nenhum |

### 3.5 Gaps de Robustez

| Gap ID | Descrição                                                       | Esforço | Risco  |
| ------ | --------------------------------------------------------------- | ------- | ------ |
| GAP-R1 | AgentContext: validação de transições de status                 | Médio   | Baixo  |
| GAP-R2 | boot-wiring.js: rollback parcial se etapa falha                 | Alto    | Médio  |
| GAP-R3 | URL validation extraída de webhook-manager.js                   | Baixo   | Nenhum |
| GAP-R4 | HandoffManager: usar callbacks em vez de EventEmitter           | Baixo   | Nenhum |
| GAP-R5 | answerPendingQuestion: fix duplicação hookToolsResolveUserInput | Baixo   | Nenhum |

---

## 4. Priorização de Trabalho (MoSCoW)

### Must Have (obrigatório para próxima release)

- GAP-Q1: Testes loop-manager.js
- GAP-Q2: Testes turn-executor.js
- GAP-Q3: Testes initializer.js
- GAP-S4: Barrels para messaging/ e state/
- GAP-R5: Fix duplicação answerPendingQuestion

### Should Have (alta prioridade)

- GAP-S1: Split loop-manager.js
- GAP-S3: Split initializer.js → hook-context.js
- GAP-Q5: Testes message-queue.js
- GAP-Q6: Testes task-executor.js
- GAP-C1: snapshot.js async
- GAP-C2: Deprecar writeState sync
- GAP-O1: OTEL dialog loop

### Could Have (boa prática)

- GAP-S2: Decomposição event-wirer.js
- GAP-S5: session-setup.js
- GAP-Q4/Q7/Q8/Q9: Mais testes unitários
- GAP-C3/C4/C5: Consistência
- GAP-O2/O3/O4/O5: Observabilidade
- GAP-R1: Context invariantes
- GAP-R3: URL validator reutilizável

### Won't Have (não planejado)

- GAP-R2: Rollback transacional em boot-wiring (complexidade desproporcional)
- GAP-R4: Migrar HandoffManager de EventEmitter para callbacks (baixo ROI)
