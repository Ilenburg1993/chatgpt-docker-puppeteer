# PARTE-23D — Bugs, Dívida Técnica, Features e Melhorias

**Data**: 2026-04-12 | **Status**: Levantamento | **Versão**: 1.0 **Scope**: Inventário completo de
bugs reais, dívida técnica, features ausentes **Precedente**: PARTE-23A (diagnóstico), PARTE-22C
(roadmap parcial)

---

## 1. Bugs Reais (Run-time ou Lógica)

### BUG-1: Suite de Testes 100% Quebrada

- **Severidade**: 🔴 Crítica
- **Evidência**: `npm run test:unit` → 575/575 failures, 0 passing
- **Causa provável**: Migração ESM + mudança de framework de testes (mocha→node:test) sem atualizar
  specs
- **Impacto**: Zero cobertura de teste executável. Regressões passam invisíveis
- **Ação**: Triagem dos 423 spec files — identificar padrão de falha, corrigir framework issue

### BUG-2: BaseEmitter é Alias Puro (Falsa Migração C2)

- **Severidade**: 🟡 Arquitetural
- **Evidência**: `core/create-emitter.js` → `export const BaseEmitter = NodeEventEmitter`
- **Impacto**: Health-check C2 mostra 0 EventEmitter direto, mas na prática 8 classes emitem
  localmente sem EventBus
- **Ação**: Ver PARTE-23B §3.3 (Bridge pattern)

### BUG-3: EventBus C3 Heuristic Inflado

- **Severidade**: 🟡 Métricas
- **Evidência**: C3 conta `@see EventBus` annotations → 320/320 = "100% adoption"
- **Realidade**: Apenas 5 arquivos realmente importam de `events/`; 0 emitem via EventBus
  cross-module
- **Impacto**: Score C3=10/10 não reflete adoção real do EventBus
- **Ação**: Redefinir heuristic para contar `getEventBus()` calls reais

### BUG-4: Health-Check C7 Não Executa Testes

- **Severidade**: 🟡 Métricas
- **Evidência**: C7 conta existência de spec files, não execução. Com 575 falhas, coverage real = 0%
- **Impacto**: Score C7=15/15 com zero testes passando
- **Ação**: C7 deveria executar `npm run test:unit --silent` e contar pass rate

### BUG-5: 4 Deep Imports Invisíveis

- **Severidade**: 🟢 Menor
- **Evidência**: `#copilot/sdk/tools`, `#copilot/sdk/client-facade`, `#copilot/sdk/agents`,
  `#copilot/hooks/presets/minimal.js`
- **Impacto**: C5=5/5 com 4 deep imports reais. Regex do arch-health não captura estes
- **Ação**: Corrigir regex ou migrar para barrel imports

---

## 2. Dívida Técnica — Inventário Categorizado

### 2.1 Dívida de Acoplamento (Fan-in/Fan-out)

| Item                                                    | Status | Impacto                               |
| ------------------------------------------------------- | ------ | ------------------------------------- |
| DT-01: terminal/ fan-out = 8 (no limite)                | 🟡     | Uma nova dependência viola C8         |
| DT-02: services/ fan-out = 8 (no limite)                | 🟡     | Idem                                  |
| DT-03: api/ importa 6 módulos (incluindo agent/ bypass) | 🟡     | Deveria só importar services/ e core/ |
| DT-04: bridges/ têm 3 singletons desnecessários         | 🟡     | Converter para DI                     |
| DT-05: 25 singletons restantes (excl. DI tokens)        | 🟡     | Meta: ≤10                             |

### 2.2 Dívida de Código (Complexidade)

| Item                           | Arquivo       | LoC | Problema                                               |
| ------------------------------ | ------------- | --- | ------------------------------------------------------ |
| DT-10: always-alive.js         | agent/        | 585 | State machine + queue + events + lifecycle num arquivo |
| DT-11: loop-manager.js         | agent/dialog/ | 582 | Turn queue + watchdog + protocol + mutex               |
| DT-12: store.js                | conv-hub/     | 562 | CRUD + queries + subscriptions num arquivo             |
| DT-13: client.js               | channel/      | 487 | Transport + dialog + reconnect                         |
| DT-14: socket-ns.js            | conv-hub/     | 443 | Auth + handlers + broadcasts                           |
| DT-15: nerv-bridge.js          | bridges/      | 435 | State + events + retry + probe                         |
| DT-16: mcp-tool-bridge.js      | bridges/      | 432 | CB + health + retry + boot                             |
| DT-17: dialog-task-handlers.js | observ/       | 426 | 15+ event handlers num arquivo                         |
| DT-18: factory.js              | hooks/        | 417 | Factory + validation + 6 slot types                    |
| DT-19: repl.js                 | terminal/     | 415 | Loop + dispatch + inline handlers                      |

### 2.3 Dívida de Eventos (ver PARTE-23B)

| Item                                                  | Problema                                       |
| ----------------------------------------------------- | ---------------------------------------------- |
| DT-30: 4 fontes paralelas de event strings            | events/, types/events, core/events, hub/events |
| DT-31: 0 eventos publicados via EventBus cross-module | Todos emitem localmente via BaseEmitter        |
| DT-32: events/index.js só tem 5 consumidores          | SSOT sem adoção                                |
| DT-33: Strings duplicadas entre módulos               | agent:ready definido em 3 lugares              |

### 2.4 Dívida de Infraestrutura

| Item                                            | Problema                                    |
| ----------------------------------------------- | ------------------------------------------- |
| DT-40: Sem request context propagation          | Logs não correlacionam entre módulos        |
| DT-41: Sem rate limiter centralizado            | Throttle ad-hoc em 3+ lugares               |
| DT-42: Retry logic duplicada em 5+ arquivos     | Sem composição com circuit breaker          |
| DT-43: Shutdown cleanup não tem prioridades     | Handlers registrados em ordem arbitrária    |
| DT-44: Nenhum feature flag runtime              | Tudo hardcoded em config.json               |
| DT-45: Zero validação de layer boundaries em CI | Violações só detectadas em auditoria manual |

### 2.5 Dívida de Módulos (#orphans)

| Item            | Módulo                                             | Problema |
| --------------- | -------------------------------------------------- | -------- |
| DT-50: plugins/ | 0 import externo, plugin-registry.js nunca chamado |
| DT-51: types/   | Só referenciado internamente por events/index.js   |
| DT-52: logs/    | Diretório vazio                                    |

---

## 3. Features Faltantes — Prioridade por Impacto

### 3.1 Alta Prioridade (Impacto direto na operação)

#### FEAT-01: Health Endpoint

- **O que**: `GET /health` e `GET /health/deep` na API HTTP
- **Por que**: Sem health check, não há como monitorar a aplicação em produção
- **Depend**: health-service.js (PARTE-23C §2.1.S3)

#### FEAT-02: Graceful Shutdown com Prioridades

- **O que**: ShutdownRegistry que fecha em ordem: sessions → agent → bridges → DB → EventBus
- **Por que**: Shutdown atual perde dados em queue e sessions não-fechadas
- **Depend**: core/shutdown.js upgrade

#### FEAT-03: Request ID Cross-Module

- **O que**: AsyncLocalStorage propagando requestId de api/→services/→agent/→sdk/
- **Por que**: Logs atuais não correlacionam entre módulos. Debugging em produção é impossível
- **Depend**: core/context.js (PARTE-23C §3.1)

#### FEAT-04: Fix Test Suite

- **O que**: Testes executáveis — target ≥50% pass rate initial
- **Por que**: 575 falhas = zero safety net. Qualquer mudança pode quebrar sem detecção
- **Depend**: Triagem de framework issue (ESM/import?)

### 3.2 Média Prioridade (Qualidade arquitetural)

#### FEAT-10: EventBus Cross-Module (Bridges)

- **O que**: 8 BaseEmitter classes publicam no EventBus via bridge
- **Por que**: Observability fica cego. Sem EventBus, métricas e auditoria são ad-hoc
- **Depend**: PARTE-23B fases E1-E3

#### FEAT-11: Services Completo (Agent + Dialog + Health)

- **O que**: 6 novos services com facades completas
- **Por que**: Sem facade, terminal/ e api/ acoplam direto com internals do agent/
- **Depend**: PARTE-23C fases S1-S4

#### FEAT-12: Retry Composable com Circuit Breaker

- **O que**: `core/retry-policy.js` que compõe com CircuitBreaker existente
- **Por que**: 5+ implementações de retry com lógica incompatível
- **Depend**: PARTE-23C CORE2

#### FEAT-13: Rate Limiter Centralizado

- **O que**: `core/rate-limiter.js` — token bucket, per-key
- **Por que**: inject.js e orchestrator.js têm throttle ad-hoc incompatível
- **Depend**: PARTE-23C CORE1

### 3.3 Baixa Prioridade (Nice to have)

#### FEAT-20: Feature Flags Runtime

- **O que**: Toggle de features sem restart
- **Depend**: core/feature-flags.js

#### FEAT-21: Layer Boundary Validator em CI

- **O que**: Script que parseia imports e bloqueia violações de layer
- **Depend**: scripts/validate-layers.mjs

#### FEAT-22: Plugin System Funcional

- **O que**: Reviver plugins/ com discover/load/unload lifecycle
- **Depend**: plugin-service.js

#### FEAT-23: OpenTelemetry / Structured Logging

- **O que**: Export de traces e logs em formato OTLP
- **Depend**: observability/ upgrade

---

## 4. Análise de Risco — Impacto vs Probabilidade

```
Impacto
Alto   │  BUG-1(testes)    FEAT-01(health)    DT-30(events)
       │  BUG-3(C3 score)  FEAT-02(shutdown)   DT-10(god files)
       │
Médio  │  BUG-2(BaseEmit)  FEAT-10(EventBus)  DT-40(context)
       │  BUG-5(deep imp)  FEAT-11(services)   DT-41(rate limit)
       │
Baixo  │  DT-50(plugins)   FEAT-20(flags)      DT-52(logs/)
       │  DT-51(types)     FEAT-23(otel)
       │___________________________________________________
              Alta          Média               Baixa        Probabilidade de
                                                             causar incidente
```

---

## 5. TODOs/FIXMEs no Código (scan completo)

| Tipo         | Count | Localização                                               |
| ------------ | ----- | --------------------------------------------------------- |
| `TODO` real  | 1     | `tools/introspection-tools.js:72` — implementação parcial |
| `FIXME`      | 0     | —                                                         |
| `HACK`       | 0     | —                                                         |
| `BUG` marker | 0     | —                                                         |
| `DEPRECATED` | 0     | Nenhum módulo marcado                                     |

**O código está limpo de markers, mas os problemas reais estão na arquitetura, não em linhas
específicas.**

---

## 6. Priorização Consolidada

| Prioridade | Item                        | Effort  | Impacto  | ROI          |
| ---------- | --------------------------- | ------- | -------- | ------------ |
| P0         | BUG-1: Fix test suite       | Alto    | Crítico  | 🔴 Must-do   |
| P0         | FEAT-01: Health endpoint    | Baixo   | Alto     | 🟢 Quick win |
| P1         | FEAT-02: Graceful shutdown  | Médio   | Alto     | 🟢 Alto      |
| P1         | FEAT-03: Request context    | Médio   | Alto     | 🟢 Alto      |
| P1         | DT-30/31: Unificar eventos  | Alto    | Alto     | 🟡 Médio     |
| P2         | FEAT-11: Services expansion | Médio   | Médio    | 🟡 Médio     |
| P2         | FEAT-12: Retry composable   | Baixo   | Médio    | 🟢 Quick win |
| P2         | FEAT-13: Rate limiter       | Baixo   | Médio    | 🟢 Quick win |
| P3         | DT-10..19: God file splits  | Alto    | Médio    | 🟡 Baixo     |
| P3         | BUG-3/4: Fix heuristics     | Baixo   | Métricas | 🟢 Quick win |
| P4         | FEAT-20..23: Nice to have   | Variado | Baixo    | 🟡 Futuro    |
