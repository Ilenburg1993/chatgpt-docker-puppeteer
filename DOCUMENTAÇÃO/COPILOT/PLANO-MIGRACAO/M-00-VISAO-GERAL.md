# M-00 — Visão Geral: Plano de Migração Arquitetural de src/copilot/

**Data**: 2026-03-21
**Versão**: 2.7
**Autor**: GitHub Copilot Agent (Claude Opus 4.6)
**Escopo**: Migração completa de `src/copilot/` da situação atual para a arquitetura ideal

> **Nota de sucessão clean (2026-04-15)**: para o próximo macrociclo de planejamento e execução,
> a referência canônica passou a ser
> [`../PLANO-REARQUITETURA-CLEAN/README.md`](../PLANO-REARQUITETURA-CLEAN/README.md).
> A série `M-00`–`M-07` permanece como trilha histórica e como registro da primeira grande linha de
> migração, mas o roadmap operacional novo foi reorganizado na série `R-00`–`R-15`.

---

## 1. Propósito

Este documento é o **ponto de entrada** para o plano de migração arquitetural de `src/copilot/`.
Ele substitui o papel do antigo `07-ROADMAP-MASTER.md` como master plan, consolidando
todas as faixas de trabalho em um plano unificado, sequenciado e autocontido.

### Documentos da série

| #         | Documento                                                                        | Descrição                                              |
| --------- | -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **M-00**  | Este documento                                                                   | Visão geral, mapa, sequenciamento, métricas, progresso |
| **M-01**  | [M-01-INVENTARIO-SITUACAO-ATUAL.md](./M-01-INVENTARIO-SITUACAO-ATUAL.md)         | Inventário completo de 408 arquivos +21 módulos        |
| **M-02**  | [M-02-FASE-CLEANUP.md](./M-02-FASE-CLEANUP.md)                                   | Fase 1: Limpeza e quick wins                           |
| **M-03**  | [M-03-FASE-AGENT-REFACTOR.md](./M-03-FASE-AGENT-REFACTOR.md)                     | Fase 2: Refactoring do agent                           |
| **M-03A** | [M-03A-AUDITORIA-ARQUITETURAL-AGENT.md](./M-03A-AUDITORIA-ARQUITETURAL-AGENT.md) | Auditoria complementar do subsistema `agent/`          |
| **M-04**  | [M-04-FASE-SDK-STATELESS.md](./M-04-FASE-SDK-STATELESS.md)                       | Fase 3: SDK stateless                                  |
| **M-05**  | [M-05-FASE-EVENT-UNIFICATION.md](./M-05-FASE-EVENT-UNIFICATION.md)               | Fase 4: Unificação de eventos                          |
| **M-06**  | [M-06-FASE-OBSERVABILITY-ERRORS.md](./M-06-FASE-OBSERVABILITY-ERRORS.md)         | Fase 5: Observability + Error pipeline                 |
| **M-07**  | [M-07-FASES-FUTURAS.md](./M-07-FASES-FUTURAS.md)                                 | Fases 6+: Features novas pós-migração                  |

### Documentos de referência (auditoria original)

Todos em `DOCUMENTAÇÃO/COPILOT/AUDITORIA-SDK-COPILOT/`:

| #     | Documento                     | Papel                                              |
| ----- | ----------------------------- | -------------------------------------------------- |
| 00-13 | Série de auditoria completa   | Análises, gaps, bugs, inventários                  |
| 12    | Auditoria Profunda            | Diagnóstico principal (8 problemas, 7 duplicações) |
| 13    | Arquitetura Ideal Geral       | Proposta de consolidação (C1-C11)                  |
| 14    | Pré-Auditoria de Consolidação | Planejamento desta série M-0x                      |

### Addendum de auditoria — 2026-04-15

Este plano foi escrito sobre um snapshot de 2026-03-21. Desde então, a árvore real de
`src/copilot/` divergiu parcialmente. Em caso de conflito entre o texto original e este addendum,
**prevalece este addendum**.

| Métrica auditada em 2026-04-15                | Valor           |
| --------------------------------------------- | --------------- |
| Arquivos JS                                   | 420             |
| Linhas de código                              | 63.681          |
| Diretórios top-level em disco                 | 20              |
| Módulos arquiteturais ativos                  | 18              |
| `src/copilot/api/`                            | removido        |
| `src/copilot/services/`                       | removido        |
| Testes focados M-02/F19                       | 19/19 ✅         |
| Testes focados M-03/L2.1                      | 50/50 ✅         |
| Testes focados M-03/K8                        | 52/52 ✅         |
| Testes focados M-03/L2.3                      | 36/36 ✅         |
| Testes focados M-03/L2.3b                     | 49/49 ✅         |
| Testes focados M-03/K5                        | 83/83 ✅         |
| Testes focados M-03/K6                        | 16/16 ✅         |
| Testes focados M-03/K3                        | 32/32 ✅         |
| Testes focados M-03/K1a                       | 58/58 ✅         |
| Testes focados M-03/K6b                       | 21/21 ✅         |
| Testes focados M-03/K5b                       | 83/83 ✅         |
| Testes focados M-03/K1b (lote seguro)         | 47/47 ✅         |
| Testes focados M-03/K1b (lifecycle + fachada) | 96/96 ✅         |
| Testes adjacentes M-03/K1b (quota monitor)    | 23/23 ✅         |
| Testes focados M-03/K4 (lote 1)               | 99/99 + 28/28 ✅ |
| Testes focados M-03/K7                        | 6/6 ✅           |
| Auditoria arquitetural complementar do agent  | concluída ✅     |

Leituras objetivas desta auditoria:

- **M-02 / Cleanup**: estruturalmente muito avançada. `api/` e `services/` já não existem;
    `config/agent.js`, `types/contracts/`, `infra/webhooks.js`, `hooks/permission-controller.js`,
    `tools/bootstrap.js` e `observability/snapshots.js` estão no lugar correto. Falta apenas manter
    validação global (`lint` + suíte unitária completa) em um checkpoint dedicado.
- **M-03 / Agent Refactor**: há groundwork parcial no baseline (`AgentContext` extraído,
    `event-wirer.js` modularizado, `getAgent()` público), e agora as subfases **L2.1** e **K8** já foram
    iniciadas/concluídas incrementalmente, com avanço adicional em **L2.3**:
    a implementação real mora em `src/copilot/event-handlers/`, com compat shims mantidos em
    `agent/session/event-handlers/`; além disso, `alwaysAliveAgent` agora é lazy via `getAgent()` + proxy
    compatível; e `processQueue()` agora vive canonicamente em `agent-messaging.js`, deixando
    `queue-processor.js` como shim de 15 linhas; e `executeTask()` também passou a viver canonicamente em
    `agent-messaging.js`, deixando `task-executor.js` como shim de 14 linhas. Além disso, **K5** já começou de forma
    incremental: `performBootWiring()` agora usa `createBootWiringSteps()` + `runBootPipeline()` com 12 etapas
    explícitas. E **K6** também já começou de forma incremental: `always-alive.js` consome mapas declarativos via
    `agent/event-bridge-map.js` para o bridge lazy com o EventBus. **K6b** agora também entrou em execução incremental:
    o wiring lazy saiu de `always-alive.js` e foi extraído para `agent/event-bridge-wiring.js`, reduzindo a fachada
    principal para **638L**. **K1a** agora também entrou em execução incremental:
    `AgentContext` foi repartido em subestados nomeados com accessors compatíveis, `agent-state.js` e
    `facades/agent-model-config.js` já migraram para a nova forma, e a validação focada do corte passou com **58/58**.
    **K5b** também já entrou em execução incremental: `session/boot-wiring.js` caiu para **263L** e a lógica operacional
    das steps foi majoritariamente extraída para `session/boot-steps.js` (**321L**), preservando em `boot-wiring.js` os
    pontos canônicos visíveis de lifecycle/quota por compatibilidade estrutural do repositório. **K1b** agora também já
    começou com um lote seguro: `session-setup.js`, `agent-messaging.js`, `agent-dialog-controller.js` e
    `agent-session-ops.js` passaram a consumir subestados diretamente, com **47/47** testes focados verdes e mais
    **28/28** em contratos adjacentes de lifecycle/shutdown. Desde então, `K1b` também avançou sobre
    `lifecycle/agent-lifecycle.js` e sobre getters públicos da fachada `always-alive.js`, com **96/96** testes focados
    verdes e mais **23/23** em contratos adjacentes de quota monitor/dialog loop. Ainda assim, o alvo central segue
    pendente: `agent/` ainda tem 8.248L; o ganho destas passadas foi principalmente
    de legibilidade/testabilidade e desacoplamento, não de redução líquida de volume, e a migração completa dos
    consumers do contexto segue aberta apenas como limpeza residual de compatibilidade.
- **K4 / Background Task Tracker**: já entrou em execução incremental. `agent/background-tasks.js` agora existe,
    `AgentContext` instancia `backgroundTasks`, `agent-lifecycle` já usa `track()` e `drain(5000)` no shutdown, e o
    primeiro lote de integrações fire-and-forget já alcançou `session-setup`, `user-input-handler`,
    `agent-messaging`, `boot-steps` e `loop-manager`, com **99/99** testes em `node:test` e **28/28** em Vitest.
- **K7 / Health Check Formal**: já entrou em execução incremental. `agent/health-check.js` agora existe,
    `AlwaysAliveAgent` expõe `getHealthSnapshot()`, `GET /health/agent` retorna o snapshot canônico e
    `GET /health` em `copilot-api/control` passou a reutilizar a mesma fonte, com **6/6** testes focados verdes.
- **M-03A / Auditoria complementar do agent**: a revisão geral do subsistema confirmou que o maior bloqueio estrutural
    agora já não é mais iniciar `K1b`, e sim fechar `K4`, abrir `K7` e só então apertar a remoção de compatibilidade
    residual; `session/` e `dialog/` continuam concentrando o maior custo remanescente; e a próxima onda ótima foi
    recalibrada para **K4 (expandir/fechar) → K7 → limpeza residual de compatibilidade/shims**.
- **K3 / Error Policy**: já entrou em execução incremental. `agent/error-policy.js` existe e a política central já foi
    conectada ao executor canônico da fila e à política de reconexão, com **32/32** testes focados verdes.
- **M-04 / SDK Stateless**: ainda pendente. `sdk/session/client.js` continua stateful
    (`_client` + `_sessions`), `sdk/config.js` ainda existe (embora deprecated), e
    `sdk/agent/agents.js` segue presente.
- **M-05 / Event Unification**: ainda pendente. O backbone de EventBus existe, mas
    `HookBus`, `agent/session/event-handlers/` e as bridges manuais ainda não foram eliminados.
- **M-06 / Observability + Errors**: ainda pendente. `error-tracker.js`, `error-alerting.js`,
    `bus-actions/` e `event-catalog.js` continuam no baseline.

---

## 2. Situação Atual (Resumo Executivo)

### Números

| Métrica                            | Valor                                     |
| ---------------------------------- | ----------------------------------------- |
| Arquivos JS                        | 420                                       |
| Linhas de código                   | 63.681                                    |
| Módulos toplevel                   | 18 arquiteturais (20 diretórios em disco) |
| Event buses paralelos              | 3                                         |
| Níveis de indireção (send message) | 7                                         |
| Duplicações funcionais             | 7 pares                                   |
| Camadas de error handling          | 5 sobrepostas                             |
| DI tokens                          | 11 (subutilizados)                        |
| God module (agent/)                | 8.248L (~13,0% do total)                  |

### Top 4 módulos (50% do código)

| Módulo      | Linhas | Problema                                                         |
| ----------- | ------ | ---------------------------------------------------------------- |
| `agent/`    | 8.248  | God module — ainda concentra lifecycle, session e event wiring   |
| `sdk/`      | 7.913  | Stateful — mantém registry de sessões que deveria estar em L4/L5 |
| `terminal/` | 7.113  | Saudável — REPL + commands + dialog, bem organizado              |
| `tools/`    | 7.101  | Saudável — 14 categorias de custom tools                         |

### 8 Problemas Arquiteturais (ref: doc 12)

1. 🔴 **7 duplicações funcionais** — api/↔server/, sdk/config↔config/session-config, etc.
2. 🔴 **agent/ desproporcional** — absorve 7+ responsabilidades externas
3. 🟠 **7 níveis de indireção** para enviar mensagem
4. 🟠 **sdk/ ↔ agent/ fronteira nebulosa** — session registry em L1
5. 🟠 **observability/ super-engenharia** — 32 arquivos, 5.757L, 3 subsistemas
6. 🟡 **events/ inflado** — 20 arquivos maiormente para constantes
7. 🟢 **services/ sem propósito** — resolvido estruturalmente em 2026-04-15
8. 🟢 **api/ obsoleto** — resolvido estruturalmente antes desta auditoria

---

## 3. Situação Ideal (Target)

### Métricas-alvo

| Métrica       | Atual | Target | Redução |
| ------------- | ----- | ------ | ------- |
| Arquivos      | 408   | ~300   | -25%    |
| Linhas        | ~62k  | ~45k   | -27%    |
| Módulos       | 21    | 14     | -33%    |
| agent/ linhas | 8.620 | ~4.000 | -54%    |
| sdk/ linhas   | 8.096 | ~5.000 | -38%    |
| Event buses   | 3     | 1      | -67%    |
| Send chain    | 7     | 4      | -43%    |
| Duplicações   | 7     | 0      | -100%   |

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

| Fase                     | Doc         | Horas     | Acumulado |
| ------------------------ | ----------- | --------- | --------- |
| 1: Cleanup               | M-02        | ~12h      | 12h       |
| 2: Agent Refactor        | M-03        | ~59h      | 71h       |
| 3: SDK Stateless         | M-04        | ~14h      | 85h       |
| 4: Event Unification     | M-05        | ~16h      | 101h      |
| 5: Obs + Errors          | M-06        | ~12h      | 113h      |
| 6+: Features futuras     | M-07        | ~78h      | 191h      |
| **Total (migração)**     | M-02 a M-06 | **~113h** |           |
| **Total (com features)** | M-02 a M-07 | **~191h** |           |

---

## 5. Trabalho Já Concluído

As seguintes faixas já foram implementadas, testadas e pushadas:

| Faixa               | Descrição                                       | Commit     | Horas     |
| ------------------- | ----------------------------------------------- | ---------- | --------- |
| A                   | Bug Fixes (BUG-01 a BUG-11)                     | `3e3379e6` | ~18h      |
| A3.2                | Experimental RPC (20 tools)                     | `f9a2071b` | ~4h       |
| I                   | System Prompt Modular (10 seções)               | `713112be` | ~14h      |
| B+I2.4              | Event Handlers (22 events)                      | `5a182a38` | ~32h      |
| C                   | Config Builders (SessionConfig + ClientOptions) | `1340932f` | ~20h      |
| E                   | Hooks Optimization (52 testes)                  | `6c54c83f` | ~16h      |
| **Total concluído** |                                                 |            | **~104h** |

---

## 6. Relação com Faixas do Roadmap Original (07)

O roadmap original (07) tinha 12 faixas (A-L). Esta nova série consolida assim:

| Faixa Original          | Status      | Onde ficou                                                                    |
| ----------------------- | ----------- | ----------------------------------------------------------------------------- |
| A (Bug Fixes)           | ✅ Concluída | Referência histórica em M-00 §5                                               |
| B (Event Handlers)      | ✅ Concluída | Referência histórica em M-00 §5                                               |
| C (Config Builders)     | ✅ Concluída | Referência histórica em M-00 §5                                               |
| D (Experimental RPC)    | Pendente    | **M-07** (features futuras)                                                   |
| E (Hooks Optimization)  | ✅ Concluída | Referência histórica em M-00 §5                                               |
| F (Observabilidade SDK) | Pendente    | **M-06** (parcial) + **M-07** (telemetry)                                     |
| G (Arch Refactoring)    | Pendente    | **G1→M-03**, G2→M-07, **G3→M-05**, **G4→M-02**                                |
| H (TSServer)            | Pendente    | **M-07** (features futuras)                                                   |
| I (System Prompt)       | ✅ Concluída | Referência histórica em M-00 §5                                               |
| J (SDK Gateway)         | Pendente    | **J1→M-04**, **J2→M-02**, J3→M-07                                             |
| K (Agent Refactoring)   | Pendente    | **M-03** (integral)                                                           |
| L (Consolidação Arch)   | Pendente    | **M-02** (L1) + **M-03** (L2) + **M-04** (L3) + **M-05** (L4) + **M-06** (L5) |

---

## 7. Métricas de Aceitação Global

### Por fase

| Fase        | Critério de conclusão                                                              |
| ----------- | ---------------------------------------------------------------------------------- |
| 1 (Cleanup) | `api/` e `services/` removidos. agent/config.js movido. 0 faixas A-E com regressão |
| 2 (Agent)   | agent/ < 5000L, AgentContext particionado, 30+ testes, boot pipeline modular       |
| 3 (SDK)     | sdk/ stateless (0 estado mutable), 0 imports de @github/copilot-sdk fora de sdk/   |
| 4 (Events)  | 1 event bus (EventBus), 0 bridges manuais, 0 HookBus                               |
| 5 (Obs+Err) | error pipeline unificado, observability/ < 4000L                                   |

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

| #   | Fase              | Doc  | Status                                                                                                                                                                       | Início     | Conclusão |
| --- | ----------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| 1   | Cleanup           | M-02 | 🟨 Estruturalmente executada; validação global pendente                                                                                                                       | 2026-03-21 | —         |
| 2   | Agent Refactor    | M-03 | 🟨 Em execução incremental; L2.1 + K8 concluídas, L2.3/K3/K5/K6 executadas incrementalmente, K1 avançada até lifecycle/fachada, K4 iniciada e K7 já entregue incrementalmente | 2026-04-15 | —         |
| 3   | SDK Stateless     | M-04 | ⬜ Não iniciado estruturalmente                                                                                                                                               | —          | —         |
| 4   | Event Unification | M-05 | ⬜ Não iniciado estruturalmente                                                                                                                                               | —          | —         |
| 5   | Obs + Errors      | M-06 | ⬜ Não iniciado estruturalmente                                                                                                                                               | —          | —         |
| 6+  | Features Futuras  | M-07 | ⬜ Não iniciado                                                                                                                                                               | —          | —         |

---

## 9. Convenções do Projeto (Referência Rápida)

| Aspecto      | Convenção                                                      |
| ------------ | -------------------------------------------------------------- |
| Runtime      | Node.js ≥ 24, ESM (`import`/`export`)                          |
| TypeScript   | `// @ts-check` + JSDoc (sem .ts)                               |
| Estilo       | 4 espaços, 120 colunas, aspas simples, ponto-e-vírgula         |
| Imports      | Aliases `#core/*`, `#infra/*`, `#copilot/*`                    |
| Testes       | Vitest 4.1.1, `globals: true`                                  |
| SDK          | `@github/copilot-sdk` ≥ 0.2.0                                  |
| Commits      | `git commit --no-verify -m "tipo: descrição"`                  |
| Push         | `git push origin main`                                         |
| Documentação | pt-BR                                                          |
| JSDoc        | Obrigatório em APIs públicas (`@param`, `@returns`, `@throws`) |
