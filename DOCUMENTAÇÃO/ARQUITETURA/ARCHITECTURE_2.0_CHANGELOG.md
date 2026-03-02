# Architecture 2.0 — Changelog Completo

> **Início**: 2 de março de 2026
> **Status**: Em andamento
> **Sessões**: 2 (sessão anterior + sessão atual)

---

## Índice

1. [Bugs Encontrados e Corrigidos](#bugs-encontrados-e-corrigidos)
2. [Aprimoramentos Sugeridos e Implementados](#aprimoramentos-sugeridos-e-implementados)
3. [Upgrades Sugeridos e Implementados](#upgrades-sugeridos-e-implementados)
4. [Análise NERV](#análise-nerv)
5. [Métricas de Progresso](#métricas-de-progresso)

---

## Bugs Encontrados e Corrigidos

### Sessão 1 — 21 Bugs Corrigidos

| # | Severidade | Módulo | Arquivo | Bug | Status |
|---|-----------|--------|---------|-----|--------|
| 1 | P0 | NERV | nerv.js | shutdown() limpava apenas 3/7 subsistemas | ✅ Corrigido |
| 2 | P0 | Infra | task_repo.js | JSON.parse em catch block silencioso | ✅ Corrigido |
| 3 | P0 | Server | dashboard_events.js | JSON.parse em catch block silencioso | ✅ Corrigido |
| 4 | P0 | Server | dashboard_missions.js | JSON.parse em catch block silencioso | ✅ Corrigido |
| 5 | P0 | Server | dashboard_tasks.js | JSON.parse em catch block silencioso | ✅ Corrigido |
| 6 | P1 | NERV | health.js | Sem limite de listeners — memory leak potencial | ✅ Corrigido |
| 7 | P1 | Kernel | policy_engine.js | Date.now() em vez do parâmetro `at` determinístico | ✅ Corrigido |
| 8 | P1 | Infra | mission_repo.js | TOCTOU race no updateMission (optimistic lock) | ✅ Corrigido |
| 9 | P1 | Logic | adaptive.js | Dados perdidos no shutdown (debounce sem flush) | ✅ Corrigido |
| 10 | P1 | Validation | llm_judge.js | Score string "75" rejeitado como NaN | ✅ Corrigido |
| 11 | P1 | Infra | events_repo.js | Tabela de eventos cresce sem limite (sem TTL) | ✅ Corrigido |
| 12 | P1 | Orchestrator | orchestrator_engine.js | Lock failure retornava silenciosamente | ✅ Corrigido |
| 13 | P1 | Orchestrator | context_manager.js | Token estimation chars/4 imprecisa + summary ilimitado | ✅ Corrigido |
| 14 | P1 | Orchestrator | checkpoint_manager.js | Write não-atômico + sem validação no load | ✅ Corrigido |
| 15 | P1 | Orchestrator | validation_service.js | null score inflava resultado para 100 | ✅ Corrigido |
| 16 | P1 | Agent | mission_planner_processor.js | Budget check sem transação (race condition) | ✅ Corrigido |
| 17 | P1 | Agent | attempt_watchdog.js | False positive — heartbeat NULL = stale imediato | ✅ Corrigido |
| 18 | P2 | Agent | queue_worker.js | 3 catch blocks silenciosos sem logging | ✅ Corrigido |
| 19 | P2 | Missions | workflow_generator.js | structuredClone sem error handling + placeholders | ✅ Corrigido |
| 20 | P2 | Integration | error-classifier.mjs | Case sensitivity no model fallback lookup | ✅ Corrigido |
| 21 | P2 | Missions | mission_manager.js | Sem error handling transacional na criação | ✅ Corrigido |

### Sessão 1 — NERV Audit Fix

| # | Severidade | Módulo | Arquivo | Bug | Status |
|---|-----------|--------|---------|-----|--------|
| 22 | P1 | Server | control.js | Mutations RBAC/preferences sem event emission | ✅ Corrigido |

### Sessão 2 — Bugs Novos Encontrados

| # | Severidade | Módulo | Arquivo | Bug | Status |
|---|-----------|--------|---------|-----|--------|
| 23 | P0 | Kernel | kernel.js | NERV instance não validada em createSsotGatewayKernel | 🔲 Pendente |
| 24 | P0 | Driver | factory.js | Temporary drivers nunca destruídos (resource leak) | 🔲 Pendente |
| 25 | P1 | Agent | agent_loop.js | Race condition: step() sem await, múltiplas execuções | 🔲 Pendente |
| 26 | P1 | Agent | agent_loop.js | _running flag nunca resetado se step() hang | 🔲 Pendente |
| 27 | P1 | Kernel | execution_engine.js | Error swallowing em evaluate() sem try-catch | 🔲 Pendente |
| 28 | P1 | Kernel | execution_engine.js | Métodos assess/interpret/synthesize sem error handling | 🔲 Pendente |
| 29 | P1 | Driver | factory.js | Missing null check no entry após pool.find() | 🔲 Pendente |
| 30 | P2 | Kernel | kernel.js | Hardcoded drain limits (100) sem configuração | 🔲 Pendente |
| 31 | P2 | Kernel | kernel.js | Hardcoded retention (1000) no telemetry | 🔲 Pendente |
| 32 | P2 | Driver | factory.js | temporaryDriversCreated sem counterpart destroyed | 🔲 Pendente |

---

## Aprimoramentos Sugeridos e Implementados

| # | Categoria | Descrição | Status |
|---|----------|-----------|--------|
| A1 | NERV | Shutdown lifecycle completo (7/7 subsistemas) | ✅ Implementado |
| A2 | NERV | Health listener limit (max 50 + warning) | ✅ Implementado |
| A3 | NERV | Event emission para mutations silenciosas | ✅ Implementado |
| A4 | Cleanup | Remoção do módulo morto src/state/ | ✅ Implementado |
| A5 | Infra | Função pruneEvents com TTL configurável | ✅ Implementado |
| A6 | Observability | Logging em catch blocks silenciosos | ✅ Implementado |

---

## Upgrades Sugeridos e Implementados

| # | Categoria | Descrição | Status |
|---|----------|-----------|--------|
| U1 | NERV-Only | Migrar mutations silenciosas para emitir eventos | 🔲 Em progresso |
| U2 | Kernel | Configuração externalizável de drain/retention | 🔲 Pendente |
| U3 | Agent | Timeout guard em agent_loop para step() | 🔲 Pendente |
| U4 | Driver | Auto-destruction timer para temporary drivers | 🔲 Pendente |

---

## Análise NERV

### Estado Atual

- **56 ActionCodes** definidos no sistema
- **13 arquivos** importam de #nerv/ (uso correto)
- **34 arquivos** importam de #infra/db/ (bypass direto)
- **29 operações** de escrita direta no DB em agent/

### Avaliação: NERV-Only vs Realidade

O princípio arquitetural é "zero-coupling via NERV", mas na prática:
- **73% dos acessos ao DB** ignoram NERV completamente
- Agent workers escrevem diretamente no DB + emitem recordEvent() (parcial)
- Server controllers faziam mutations silenciosas (corrigido sessão 1)
- Kernel bridge importa diretamente de agent/ (cross-domain violation)

### Caminho Recomendado

Migração gradual, não big-bang:
1. ✅ Fase 1: Event emission em mutations silenciosas (feito)
2. 🔲 Fase 2: Extrair cross-domain import kernel→agent
3. 🔲 Fase 3: Adicionar NERV event emission nos agent workers que escrevem no DB
4. 🔲 Fase 4: Criar mediators para operações DB críticas

---

## Métricas de Progresso

| Métrica | Sessão 1 | Sessão 2 | Meta |
|---------|----------|----------|------|
| Bugs corrigidos | 22 | 22+ | 35+ |
| Lint errors | 0 | 0 | 0 |
| Test pass rate | 798/800 | 798/800 | 798/800 |
| Silent catch blocks | 0 (era 6+) | 0 | 0 |
| NERV subsystems cleaned | 7/7 | 7/7 | 7/7 |
| Silent DB mutations | 0 (era 2+) | 0 | 0 |

---

*Atualizado em: 2 de março de 2026*
