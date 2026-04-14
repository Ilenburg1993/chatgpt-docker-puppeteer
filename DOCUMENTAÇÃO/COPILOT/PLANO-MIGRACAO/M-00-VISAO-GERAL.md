# M-00 — Visão Geral: Plano de Migração Arquitetural de src/copilot/

**Data**: 2026-03-21
**Versão**: 1.0
**Autor**: GitHub Copilot Agent (Claude Opus 4.6)
**Escopo**: Migração completa de `src/copilot/` da situação atual para a arquitetura ideal

---

## 1. Propósito

Este documento é o **ponto de entrada** para o plano de migração arquitetural de `src/copilot/`.
Ele substitui o papel do antigo `07-ROADMAP-MASTER.md` como master plan, consolidando
todas as faixas de trabalho em um plano unificado, sequenciado e autocontido.

### Documentos da série

| # | Documento | Descrição |
|---|-----------|-----------|
| **M-00** | Este documento | Visão geral, mapa, sequenciamento, métricas, progresso |
| **M-01** | [M-01-INVENTARIO-SITUACAO-ATUAL.md](./M-01-INVENTARIO-SITUACAO-ATUAL.md) | Inventário completo de 408 arquivos +21 módulos |
| **M-02** | [M-02-FASE-CLEANUP.md](./M-02-FASE-CLEANUP.md) | Fase 1: Limpeza e quick wins |
| **M-03** | [M-03-FASE-AGENT-REFACTOR.md](./M-03-FASE-AGENT-REFACTOR.md) | Fase 2: Refactoring do agent |
| **M-04** | [M-04-FASE-SDK-STATELESS.md](./M-04-FASE-SDK-STATELESS.md) | Fase 3: SDK stateless |
| **M-05** | [M-05-FASE-EVENT-UNIFICATION.md](./M-05-FASE-EVENT-UNIFICATION.md) | Fase 4: Unificação de eventos |
| **M-06** | [M-06-FASE-OBSERVABILITY-ERRORS.md](./M-06-FASE-OBSERVABILITY-ERRORS.md) | Fase 5: Observability + Error pipeline |
| **M-07** | [M-07-FASES-FUTURAS.md](./M-07-FASES-FUTURAS.md) | Fases 6+: Features novas pós-migração |

### Documentos de referência (auditoria original)

Todos em `DOCUMENTAÇÃO/COPILOT/AUDITORIA-SDK-COPILOT/`:

| # | Documento | Papel |
|---|-----------|-------|
| 00-13 | Série de auditoria completa | Análises, gaps, bugs, inventários |
| 12 | Auditoria Profunda | Diagnóstico principal (8 problemas, 7 duplicações) |
| 13 | Arquitetura Ideal Geral | Proposta de consolidação (C1-C11) |
| 14 | Pré-Auditoria de Consolidação | Planejamento desta série M-0x |

---

## 2. Situação Atual (Resumo Executivo)

### Números

| Métrica | Valor |
|---------|-------|
| Arquivos JS | 408 |
| Linhas de código | ~62.000 |
| Módulos toplevel | 21 |
| Event buses paralelos | 3 |
| Níveis de indireção (send message) | 7 |
| Duplicações funcionais | 7 pares |
| Camadas de error handling | 5 sobrepostas |
| DI tokens | 11 (subutilizados) |
| God module (agent/) | 8.620L (14% do total) |

### Top 4 módulos (50% do código)

| Módulo | Linhas | Problema |
|--------|--------|----------|
| `agent/` | 8.620 | God module — absorve hooks, config, observability, events, infra |
| `sdk/` | 8.096 | Stateful — mantém registry de sessões que deveria estar em L4/L5 |
| `terminal/` | 7.111 | Saudável — REPL + commands + dialog, bem organizado |
| `tools/` | 6.928 | Saudável — 14 categorias de custom tools |

### 8 Problemas Arquiteturais (ref: doc 12)

1. 🔴 **7 duplicações funcionais** — api/↔server/, sdk/config↔config/session-config, etc.
2. 🔴 **agent/ desproporcional** — absorve 7+ responsabilidades externas
3. 🟠 **7 níveis de indireção** para enviar mensagem
4. 🟠 **sdk/ ↔ agent/ fronteira nebulosa** — session registry em L1
5. 🟠 **observability/ super-engenharia** — 32 arquivos, 5.757L, 3 subsistemas
6. 🟡 **events/ inflado** — 20 arquivos maiormente para constantes
7. 🟡 **services/ sem propósito** — 547L de facades finas
8. 🟡 **api/ obsoleto** — duplica server/

---

## 3. Situação Ideal (Target)

### Métricas-alvo

| Métrica | Atual | Target | Redução |
|---------|-------|--------|---------|
| Arquivos | 408 | ~300 | -25% |
| Linhas | ~62k | ~45k | -27% |
| Módulos | 21 | 14 | -33% |
| agent/ linhas | 8.620 | ~4.000 | -54% |
| sdk/ linhas | 8.096 | ~5.000 | -38% |
| Event buses | 3 | 1 | -67% |
| Send chain | 7 | 4 | -43% |
| Duplicações | 7 | 0 | -100% |

### Arquitetura-alvo (6 camadas, ref: doc 13)

```
L5 PRESENTATION:   server/ + terminal/           (api/ ELIMINADO)
L4 ORCHESTRATION:  agent/ (<4000L) + conv-hub/ + channel/
L3 POLICIES:       hooks/ + tools/ + event-handlers/ (NOVO, vindo de agent/)
L2 CONFIGURATION:  config/ + bridges/
L1 SDK FACADE:     sdk/ (STATELESS, sem registry)
L0 CORE:           core/ + events/ + infra/ + db/ + observability/ (CONSOLIDADO)
```

---

## 4. Sequenciamento das Fases

```
                    ┌──────────────────┐
                    │  M-02: CLEANUP   │  Fase 1 — Quick wins, zero risco
                    │  ~12h            │  Remove api/, services/, dead code
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  M-03: AGENT     │  Fase 2 — Refactoring do agent
                    │  ~59h            │  AgentContext, tests, boot, messaging, events
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  M-04: SDK       │  Fase 3 — SDK stateless
                    │  ~14h            │  Session registry, import cleanup
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  M-05: EVENTS    │  Fase 4 — Unificação de event bus
                    │  ~16h            │  3 buses → 1, bridge automático
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  M-06: OBS+ERR   │  Fase 5 — Observability + error pipeline
                    │  ~12h            │  Pipeline unificado, trim collectors
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  M-07: FUTURO    │  Fases 6+ — Features novas
                    │  ~78h            │  Experimental RPC, TSServer, telemetry
                    └──────────────────┘
```

### Estimativas totais

| Fase | Doc | Horas | Acumulado |
|------|-----|-------|-----------|
| 1: Cleanup | M-02 | ~12h | 12h |
| 2: Agent Refactor | M-03 | ~59h | 71h |
| 3: SDK Stateless | M-04 | ~14h | 85h |
| 4: Event Unification | M-05 | ~16h | 101h |
| 5: Obs + Errors | M-06 | ~12h | 113h |
| 6+: Features futuras | M-07 | ~78h | 191h |
| **Total (migração)** | M-02 a M-06 | **~113h** | |
| **Total (com features)** | M-02 a M-07 | **~191h** | |

---

## 5. Trabalho Já Concluído

As seguintes faixas já foram implementadas, testadas e pushadas:

| Faixa | Descrição | Commit | Horas |
|-------|-----------|--------|-------|
| A | Bug Fixes (BUG-01 a BUG-11) | `3e3379e6` | ~18h |
| A3.2 | Experimental RPC (20 tools) | `f9a2071b` | ~4h |
| I | System Prompt Modular (10 seções) | `713112be` | ~14h |
| B+I2.4 | Event Handlers (22 events) | `5a182a38` | ~32h |
| C | Config Builders (SessionConfig + ClientOptions) | `1340932f` | ~20h |
| E | Hooks Optimization (52 testes) | `6c54c83f` | ~16h |
| **Total concluído** | | | **~104h** |

---

## 6. Relação com Faixas do Roadmap Original (07)

O roadmap original (07) tinha 12 faixas (A-L). Esta nova série consolida assim:

| Faixa Original | Status | Onde ficou |
|---------------|--------|------------|
| A (Bug Fixes) | ✅ Concluída | Referência histórica em M-00 §5 |
| B (Event Handlers) | ✅ Concluída | Referência histórica em M-00 §5 |
| C (Config Builders) | ✅ Concluída | Referência histórica em M-00 §5 |
| D (Experimental RPC) | Pendente | **M-07** (features futuras) |
| E (Hooks Optimization) | ✅ Concluída | Referência histórica em M-00 §5 |
| F (Observabilidade SDK) | Pendente | **M-06** (parcial) + **M-07** (telemetry) |
| G (Arch Refactoring) | Pendente | **G1→M-03**, G2→M-07, **G3→M-05**, **G4→M-02** |
| H (TSServer) | Pendente | **M-07** (features futuras) |
| I (System Prompt) | ✅ Concluída | Referência histórica em M-00 §5 |
| J (SDK Gateway) | Pendente | **J1→M-04**, **J2→M-02**, J3→M-07 |
| K (Agent Refactoring) | Pendente | **M-03** (integral) |
| L (Consolidação Arch) | Pendente | **M-02** (L1) + **M-03** (L2) + **M-04** (L3) + **M-05** (L4) + **M-06** (L5) |

---

## 7. Métricas de Aceitação Global

### Por fase

| Fase | Critério de conclusão |
|------|----------------------|
| 1 (Cleanup) | `api/` e `services/` removidos. agent/config.js movido. 0 faixas A-E com regressão |
| 2 (Agent) | agent/ < 5000L, AgentContext particionado, 30+ testes, boot pipeline modular |
| 3 (SDK) | sdk/ stateless (0 estado mutable), 0 imports de @github/copilot-sdk fora de sdk/ |
| 4 (Events) | 1 event bus (EventBus), 0 bridges manuais, 0 HookBus |
| 5 (Obs+Err) | error pipeline unificado, observability/ < 4000L |

### Validação contínua (a cada passo)

```bash
npm run lint
npm run format:check
npm run test:unit
# Se alterar driver/kernel/server:
npm run test:integration
```

---

## 8. Tracker de Progresso

| # | Fase | Doc | Status | Início | Conclusão |
|---|------|-----|--------|--------|-----------|
| 1 | Cleanup | M-02 | ⬜ Não iniciado | — | — |
| 2 | Agent Refactor | M-03 | ⬜ Não iniciado | — | — |
| 3 | SDK Stateless | M-04 | ⬜ Não iniciado | — | — |
| 4 | Event Unification | M-05 | ⬜ Não iniciado | — | — |
| 5 | Obs + Errors | M-06 | ⬜ Não iniciado | — | — |
| 6+ | Features Futuras | M-07 | ⬜ Não iniciado | — | — |

---

## 9. Convenções do Projeto (Referência Rápida)

| Aspecto | Convenção |
|---------|-----------|
| Runtime | Node.js ≥ 24, ESM (`import`/`export`) |
| TypeScript | `// @ts-check` + JSDoc (sem .ts) |
| Estilo | 4 espaços, 120 colunas, aspas simples, ponto-e-vírgula |
| Imports | Aliases `#core/*`, `#infra/*`, `#copilot/*` |
| Testes | Vitest 4.1.1, `globals: true` |
| SDK | `@github/copilot-sdk` ≥ 0.2.0 |
| Commits | `git commit --no-verify -m "tipo: descrição"` |
| Push | `git push origin main` |
| Documentação | pt-BR |
| JSDoc | Obrigatório em APIs públicas (`@param`, `@returns`, `@throws`) |
