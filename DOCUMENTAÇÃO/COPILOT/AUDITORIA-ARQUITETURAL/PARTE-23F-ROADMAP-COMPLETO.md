# PARTE-23F — Roadmap Completo: Faixas, Fases e Subfases

**Data**: 2026-04-12 | **Status**: Proposta | **Versão**: 1.0
**Scope**: Plano de execução completo para upgrades pós-PARTE-22
**Precedente**: PARTE-23A (diagnóstico), 23B (events), 23C (services), 23D (bugs/features), 23E (grafos)

> **Exclusões explícitas**: God files splitting (apenas via natural refactoring), migração direta para TS

---

## 1. Visão Geral de Faixas

O roadmap é organizado em **5 Faixas** (Tracks), executadas parcialmente em paralelo:

```
Timeline ──→

FAIXA-1 ████████████████████████████████████░░░░░░░░░░░░░░░░
  "Foundation"    Fase 1A-1B-1C

FAIXA-2 ░░░░░░░░████████████████████████████████████████░░░░
  "Events"        Fase 2A-2B-2C

FAIXA-3 ░░░░░░░░░░░░░░░░████████████████████████████████████
  "Services"      Fase 3A-3B-3C

FAIXA-4 ░░░░████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░
  "Core Infra"    Fase 4A-4B

FAIXA-5 ░░░░░░░░░░░░░░░░░░░░░░░░████████████████████████████
  "Quality"       Fase 5A-5B-5C
```

---

## 2. FAIXA-1: Foundation (Preparação e Cleanup)

**Objetivo**: Limpar base para que outras faixas possam executar com segurança

### Fase 1A: Triagem de Testes (~P0)
> Fix das 575 falhas — sem testes, tudo é arriscado

| Sub  | Tarefa                                                            | Esforço | Dependências |
| ---- | ----------------------------------------------------------------- | ------- | ------------ |
| 1A.1 | Diagnosticar causa raiz das 575 falhas (ESM? framework? imports?) | Baixo   | —            |
| 1A.2 | Criar script de triagem: categorizar falhas por tipo              | Baixo   | 1A.1         |
| 1A.3 | Fix de framework/config issue (se systematic)                     | Médio   | 1A.1         |
| 1A.4 | Triage manual: marcar testes irrecuperáveis como `.skip`          | Médio   | 1A.3         |
| 1A.5 | Target: ≥200/423 specs passando (≥47%)                            | Alto    | 1A.3         |

**Critério de saída**: `npm run test:unit` → ≥200 passing, ≤100 skipped

### Fase 1B: Cleanup de Módulos Órfãos
> Eliminar dead code: plugins/, types/events.js, logs/

| Sub  | Tarefa                                                          | Esforço | Dependências |
| ---- | --------------------------------------------------------------- | ------- | ------------ |
| 1B.1 | Verificar se plugins/ tem consumers ocultos (dynamic require?)  | Baixo   | —            |
| 1B.2 | Se órfão confirmado: deprecar plugins/ (move to `_deprecated/`) | Baixo   | 1B.1         |
| 1B.3 | Eliminar `logs/` (diretório vazio)                              | Trivial | —            |
| 1B.4 | Consolidar types/events.js em events/ (preparação para Faixa-2) | Baixo   | —            |

**Critério de saída**: 0 módulos órfãos, 0 diretórios vazios

### Fase 1C: Health-Check Honesto
> Calibrar heuristics para refletir estado real

| Sub  | Tarefa                                                                     | Esforço | Dependências |
| ---- | -------------------------------------------------------------------------- | ------- | ------------ |
| 1C.1 | C2: Contar `extends BaseEmitter` como "emit local" (novo metric)           | Baixo   | —            |
| 1C.2 | C3: Mudar de `@see EventBus` para `getEventBus()` ou `import from events/` | Baixo   | —            |
| 1C.3 | C5: Ajustar regex para capturar multi-segment imports reais                | Baixo   | —            |
| 1C.4 | C7: Adicionar execução real de testes (pass count, não file count)         | Médio   | 1A.5         |
| 1C.5 | C9: Refinar para capturar todos os 25 singletons                           | Baixo   | —            |
| 1C.6 | Rodar health-check: target ≥55/100 (score honesto)                         | —       | 1C.1-1C.5    |

**Critério de saída**: Health-check reflete estado real; score honesto conhecido

---

## 3. FAIXA-2: Events Unification

**Objetivo**: Consolidar 4 sistemas de eventos em 1 SSOT + bridges para EventBus
**Depende de**: Fase 1B.4 (types/events.js consolidado)

### Fase 2A: Expandir events/ como SSOT
> Consolidar todas as constantes de evento num único módulo

| Sub  | Tarefa                                                               | Esforço | Dependências |
| ---- | -------------------------------------------------------------------- | ------- | ------------ |
| 2A.1 | Criar `events/agent-events.js` (5 consts migradas de core/events.js) | Baixo   | —            |
| 2A.2 | Criar `events/dialog-events.js` (6 consts novas)                     | Baixo   | —            |
| 2A.3 | Criar `events/session-events.js` (6 consts migradas de hub/events)   | Baixo   | —            |
| 2A.4 | Criar `events/hook-events.js` (5 consts migradas de types/events)    | Baixo   | —            |
| 2A.5 | Criar `events/terminal-events.js` (2 consts novas)                   | Baixo   | —            |
| 2A.6 | Criar `events/system-events.js` (1 const + futuras)                  | Baixo   | —            |
| 2A.7 | Criar `events/socket-events.js` (mapeamento socket.io-only)          | Baixo   | —            |
| 2A.8 | Atualizar `events/index.js` barrel — re-export todos os sub-módulos  | Baixo   | 2A.1-2A.7    |
| 2A.9 | TypeCheck + lint                                                     | —       | 2A.8         |

**Critério de saída**: events/ tem ~45 constantes organizadas em 7 arquivos + barrel

### Fase 2B: Migrar Importadores
> Todos os arquivos que usam event strings devem importar de `#copilot/events`

| Sub  | Tarefa                                                                  | Esforço | Dependências |
| ---- | ----------------------------------------------------------------------- | ------- | ------------ |
| 2B.1 | `core/events.js` → thin re-export de `events/agent-events.js`           | Baixo   | 2A.1         |
| 2B.2 | `core/constants.js` → re-export de `#copilot/events`                    | Baixo   | 2A.8         |
| 2B.3 | `conversation-hub/events.js` → split: negócio→events/, socket→interno   | Médio   | 2A.3, 2A.7   |
| 2B.4 | Migrar 6 importadores de `HUB_EVENTS` → `import from '#copilot/events'` | Médio   | 2B.3         |
| 2B.5 | Migrar importadores de `AGENT_EVENTS` de core → events                  | Médio   | 2B.1         |
| 2B.6 | Deprecar `types/events.js` (apenas re-exports)                          | Baixo   | 2A.4         |
| 2B.7 | Validar: grep -r para event strings literais fora de events/            | Baixo   | 2B.1-2B.6    |
| 2B.8 | TypeCheck + lint + tests                                                | —       | 2B.7         |

**Critério de saída**: 0 event string definitions fora de `events/`; ≥25 arquivos importam events/

### Fase 2C: Bridges EventBus
> Emissores locais (BaseEmitter) publicam cross-module via EventBus bridge

| Sub  | Tarefa                                                                           | Esforço | Dependências |
| ---- | -------------------------------------------------------------------------------- | ------- | ------------ |
| 2C.1 | Criar `core/event-bus-bridge.js` — helper genérico                               | Baixo   | —            |
| 2C.2 | Bridge always-alive.js → EventBus (agent:*)                                      | Baixo   | 2C.1         |
| 2C.3 | Bridge loop-manager.js → EventBus (dialog:*)                                     | Baixo   | 2C.1         |
| 2C.4 | Bridge orchestrator.js → EventBus (session:*)                                    | Baixo   | 2C.1         |
| 2C.5 | Bridge hooks/bus.js → EventBus (hook:*)                                          | Baixo   | 2C.1         |
| 2C.6 | Bridge state.js → EventBus (terminal:*)                                          | Baixo   | 2C.1         |
| 2C.7 | Migrar subscribers: observability/ → usar EventBus.on() em vez de `.on()` direto | Médio   | 2C.2-2C.6    |
| 2C.8 | ESLint rule: warn on direct `.on()` de BaseEmitter em cross-module               | Baixo   | 2C.7         |
| 2C.9 | TypeCheck + lint + tests                                                         | —       | 2C.8         |

**Critério de saída**: ≥6 bridges ativas; observability/ consome via EventBus; 0 cross-module `.on()` direto

---

## 4. FAIXA-3: Services Expansion

**Objetivo**: De 4 para 10 services com facades completas
**Depende de**: Fase 2C parcial (para event emission nos services)

### Fase 3A: Core Services (Agent + Dialog + Health)

| Sub  | Tarefa                                                 | Esforço | Dependências     |
| ---- | ------------------------------------------------------ | ------- | ---------------- |
| 3A.1 | Criar `services/agent-service.js` (~150 LoC)           | Médio   | —                |
| 3A.2 | Criar `services/dialog-service.js` (~120 LoC)          | Médio   | —                |
| 3A.3 | Criar `services/health-service.js` (~180 LoC)          | Médio   | —                |
| 3A.4 | Atualizar `services/index.js` — remover re-exports raw | Baixo   | 3A.1-3A.3        |
| 3A.5 | Migrar terminal/commands → agent-service (5+ arquivos) | Médio   | 3A.1, 3A.4       |
| 3A.6 | Migrar api/routes → agent-service + health-service     | Médio   | 3A.1, 3A.3, 3A.4 |
| 3A.7 | Expor `GET /health` endpoint via health-service        | Baixo   | 3A.3             |
| 3A.8 | TypeCheck + lint + tests                               | —       | 3A.7             |

**Critério de saída**: 7 services; 0 re-exports raw; `/health` endpoint funcional

### Fase 3B: Auxiliary Services

| Sub  | Tarefa                                         | Esforço | Dependências |
| ---- | ---------------------------------------------- | ------- | ------------ |
| 3B.1 | Criar `services/config-service.js` (~100 LoC)  | Baixo   | —            |
| 3B.2 | Criar `services/metrics-service.js` (~100 LoC) | Baixo   | —            |
| 3B.3 | Criar `services/bridge-service.js` (~80 LoC)   | Baixo   | —            |
| 3B.4 | Migrar terminal/commands → config-service      | Baixo   | 3B.1         |
| 3B.5 | Migrar api/routes → metrics-service            | Baixo   | 3B.2         |
| 3B.6 | TypeCheck + lint + tests                       | —       | 3B.5         |

**Critério de saída**: 10 services; terminal/ e api/ fan-out reduzido

### Fase 3C: Enforcement

| Sub  | Tarefa                                                                         | Esforço | Dependências |
| ---- | ------------------------------------------------------------------------------ | ------- | ------------ |
| 3C.1 | ESLint: proibir terminal/ e api/ de importar agent/, conv-hub/, observability/ | Baixo   | 3B.6         |
| 3C.2 | Exceções documentadas: services/index.js, core/                                | Baixo   | 3C.1         |
| 3C.3 | Atualizar arch-health.mjs — C10 real (não heurístico)                          | Baixo   | 3C.1         |
| 3C.4 | Validar fan-out: terminal/ ≤6, api/ ≤5                                         | —       | 3C.3         |

**Critério de saída**: ESLint bloqueia bypasses; fan-out terminal/ ≤6

---

## 5. FAIXA-4: Core Infrastructure

**Objetivo**: Sistemas missing do core/ que estabilizam a runtime
**Pode iniciar em paralelo com Faixa-2**

### Fase 4A: Request Context + Rate Limiter

| Sub  | Tarefa                                                       | Esforço | Dependências |
| ---- | ------------------------------------------------------------ | ------- | ------------ |
| 4A.1 | Criar `core/context.js` — AsyncLocalStorage wrapper          | Baixo   | —            |
| 4A.2 | Integrar context em `api/middleware` (requestId, sessionId)  | Médio   | 4A.1         |
| 4A.3 | Integrar context em `services/*` (propagação para agent/)    | Médio   | 4A.2         |
| 4A.4 | Criar `core/rate-limiter.js` — token bucket, per-key         | Baixo   | —            |
| 4A.5 | DI token: `RATE_LIMITER` em di-tokens.js                     | Trivial | 4A.4         |
| 4A.6 | Substituir throttle ad-hoc em inject.js → rate-limiter       | Baixo   | 4A.4         |
| 4A.7 | Substituir throttle ad-hoc em orchestrator.js → rate-limiter | Baixo   | 4A.4         |
| 4A.8 | TypeCheck + lint + tests                                     | —       | 4A.7         |

**Critério de saída**: requestId propagado api/→services/→agent/; rate limiter centralizado

### Fase 4B: Retry Policy + Shutdown Upgrade

| Sub  | Tarefa                                                                              | Esforço | Dependências |
| ---- | ----------------------------------------------------------------------------------- | ------- | ------------ |
| 4B.1 | Criar `core/retry-policy.js` — exponential backoff + jitter, composável com CB      | Baixo   | —            |
| 4B.2 | DI token: `RETRY_POLICY`                                                            | Trivial | 4B.1         |
| 4B.3 | Migrar sdk/client.js retry → retry-policy                                           | Médio   | 4B.1         |
| 4B.4 | Migrar bridges/nerv-bridge.js retry → retry-policy                                  | Médio   | 4B.1         |
| 4B.5 | Migrar bridges/mcp-tool-bridge.js retry → retry-policy                              | Médio   | 4B.1         |
| 4B.6 | Upgrade `core/shutdown.js` → ShutdownRegistry com prioridades                       | Médio   | —            |
| 4B.7 | Registrar handlers com prioridades: sessions(P1) → agent(P2) → bridges(P3) → DB(P4) | Baixo   | 4B.6         |
| 4B.8 | TypeCheck + lint + tests                                                            | —       | 4B.7         |

**Critério de saída**: 0 retry ad-hoc; shutdown com prioridades documentadas

---

## 6. FAIXA-5: Quality Assurance

**Objetivo**: Métricas reais, CI gates, cobertura
**Depende de**: Fase 1A (testes), Fase 1C (health honesto)

### Fase 5A: DI Adoption Real

| Sub  | Tarefa                                                                | Esforço | Dependências |
| ---- | --------------------------------------------------------------------- | ------- | ------------ |
| 5A.1 | Inventariar: 12 tokens existentes sem usage via `container.resolve()` | Baixo   | —            |
| 5A.2 | Converter 6 singletons de maior impacto → DI resolve                  | Médio   | 5A.1         |
| 5A.3 | Meta: singletons ≤15 (de 25)                                          | —       | 5A.2         |

### Fase 5B: Layer Validator CI

| Sub  | Tarefa                                                                      | Esforço | Dependências |
| ---- | --------------------------------------------------------------------------- | ------- | ------------ |
| 5B.1 | Criar `scripts/validate-layers.mjs` — parseia imports, valida contra regras | Médio   | —            |
| 5B.2 | Definir `layer-rules.json` — módulo → allowed imports                       | Baixo   | —            |
| 5B.3 | Integrar no pre-commit hook (informacional)                                 | Baixo   | 5B.1         |
| 5B.4 | Integrar no health-check como C13                                           | Baixo   | 5B.1         |

### Fase 5C: Ciclo Killer + Orphan Cleanup

| Sub  | Tarefa                                                       | Esforço | Dependências |
| ---- | ------------------------------------------------------------ | ------- | ------------ |
| 5C.1 | Quebrar ciclo config/ ↔ observability/ (via DI ou interface) | Médio   | —            |
| 5C.2 | Verificar ciclo tools/ ↔ bridges/ (indirect)                 | Baixo   | —            |
| 5C.3 | Verificar ciclo hooks/ ↔ tools/ (indirect)                   | Baixo   | —            |
| 5C.4 | Cleanup final: remover `_deprecated/` se não referenciado    | Baixo   | —            |

---

## 7. Matriz de Dependência entre Faixas

```
              F1-Found  F2-Events  F3-Services  F4-Core  F5-Quality
F1-Found        —         ←          ←            ←         ←
F2-Events     1B.4→       —          →             ∅        →
F3-Services    ∅        2C→          —             ∅        →
F4-Core        ∅          ∅           ∅            —        →
F5-Quality   1A,1C→     2C→        3C→           4B→       —
```

**Legenda**: ← depende de; → precede; ∅ independente

**Ordem de execução recomendada**:
1. **1A** (testes) — paralelizável com **4A** (context + rate limiter)
2. **1B + 1C** (cleanup + health honesto) — paralelizável com **4B** (retry + shutdown)
3. **2A** (expand events/) — paralelizável com **3A** (core services)
4. **2B** (migrate importers) — precisa de 2A
5. **2C** (bridges) — precisa de 2B
6. **3B** (aux services) — precisa de 3A
7. **3C** (enforcement) — precisa de 3B + 2C parcial
8. **5A + 5B + 5C** (quality) — após tudo estabilizado

---

## 8. Estimativa de Esforço Relativo

| Faixa                | Sub-tasks        | Esforço                  |
| -------------------- | ---------------- | ------------------------ |
| FAIXA-1 (Foundation) | 14 sub-tasks     | ████████████████         |
| FAIXA-2 (Events)     | 26 sub-tasks     | ████████████████████████ |
| FAIXA-3 (Services)   | 18 sub-tasks     | ██████████████████       |
| FAIXA-4 (Core Infra) | 16 sub-tasks     | ████████████████         |
| FAIXA-5 (Quality)    | 11 sub-tasks     | ████████████             |
| **TOTAL**            | **85 sub-tasks** |                          |

---

## 9. Critérios de Sucesso Globais

| Métrica                      | Atual  | Pós FAIXA-1 | Pós F1-F4       | Target Final |
| ---------------------------- | ------ | ----------- | --------------- | ------------ |
| Testes passando              | 0/423  | ≥200/423    | ≥250/423        | ≥300/423     |
| Health-check (honesto)       | ~35-40 | ≥55         | ≥75             | ≥85/100      |
| Event sources                | 4      | 3           | 1               | 1            |
| BaseEmitter→EventBus bridges | 0      | 0           | ≥6              | 8            |
| Services count               | 4      | 4           | 8               | 10           |
| Services LoC                 | 529    | 529         | ~1.100          | ~1.400       |
| Singletons                   | 25     | 25          | ≤18             | ≤10          |
| Fan-out max                  | 8      | 8           | ≤7              | ≤6           |
| Ciclos de dependência        | 1 real | 1           | 0               | 0            |
| Módulos órfãos               | 3      | 0           | 0               | 0            |
| Deep imports reais           | 4      | 4           | 0               | 0            |
| Rate limiters centralizados  | 0      | 0           | 1               | 1            |
| Request context propagation  | 0%     | 0%          | 50%             | 100%         |
| Health endpoint              | ❌      | ❌           | ✅ basic         | ✅ deep       |
| Layer validator CI           | ❌      | ❌           | ✅ informacional | ✅ blocking   |

---

## 10. Próximos Passos Imediatos (TOP 5)

1. **1A.1**: Diagnosticar causa raiz de 575 test failures
2. **4A.1**: Criar `core/context.js` (AsyncLocalStorage) — quick win independente
3. **2A.1-2A.7**: Expandir events/ com sub-módulos por namespace
4. **3A.1-3A.3**: Criar agent-service, dialog-service, health-service
5. **1C.1-1C.5**: Calibrar health-check para score honesto
