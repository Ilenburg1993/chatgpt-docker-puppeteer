# PARTE-17A — Análise Arquitetural Profunda: Situação Atual do SDK (rev.5)

**Data**: 2026-10-10 (rev.5 — auditoria pós-conclusão das Faixas 35-42)
**Escopo**: TODO `src/copilot/` (281 arquivos JS, ~51.142 linhas) + suíte de testes (178 specs)
**SDK oficial**: `@github/copilot-sdk@0.2.0` (instalado)
**Autor**: Auditoria automatizada PARTE-17, rev.5
**Base**: Rev.4 + resultados Faixas 35-42 do roadmap SDK Hardening

---

## Sumário Executivo

A rev.5 atualiza os números da rev.4 após a conclusão integral das Faixas 35-42:

| Métrica                      |           Rev.4 |         Rev.5 |        Δ |
| ---------------------------- | --------------: | ------------: | -------: |
| Testes passando              |   **3.053** (✓) | **3.266** (✓) | **+213** |
| Specs em `copilot/`          | **157** (aprox) |       **178** |  **+21** |
| Specs em `sdk/`              |    **39** specs |  **40** specs |   **+1** |
| Typecheck errors             |   **33** (base) |         **0** |  **−33** |
| Bypasses fora de `sdk/`      |         **~20** |       **~20** |        0 |
| God modules >400 linhas      |         **22+** |        **22** |        0 |
| Cobertura `api/express`      |            ~10% |      **~40%** | **+30%** |
| Cobertura `channel/`         |              0% |      **~15%** | **+15%** |
| Cobertura `tools/file/`      |              0% |      **~70%** | **+70%** |
| Cobertura `sdk/custom-tools` | importação ind. |      **~85%** |   direta |

### Principais Conquistas Faixas 35-42

1. **Typecheck baseline → 0 erros absolutamente** (F42)
2. **213 testes novos** distribuídos em 7 specs criados
3. **write-tools.js** coberto pela primeira vez — 6 tools críticas de I/O (F35)
4. **session-tools + shell expanded** — validação de blocklist e segurança (F36)
5. **API Session CRUD + Messaging** — 26 testes com supertest (F37)
6. **API Observability routes** — 24 testes (14 rotas cobertas) (F38)
7. **SDK custom-tools registry** — 28 testes, todas as built-in handlers (F39)
8. **Channel modules** — 19 testes (dialog, history, structured) (F40)
9. **RPC facade edge cases** — 31 testes (assertSession × 18, error propagation) (F41)

---

## §1. Mapa Arquitetural Atualizado de `src/copilot/`

### 1.1 Módulos e Escala (contagem atualizada)

| Módulo                  | Arquivos |   Linhas | # Specs |  # Testes |
| ----------------------- | -------: | -------: | ------: | --------: |
| `sdk/`                  |       32 |   ~6.679 |      40 |    ~1.071 |
| `tools/`                |      ~40 |   ~6.195 |       9 |      ~200 |
| `terminal/`             |      ~50 |   ~5.000 |      10 |      ~150 |
| `agent/`                |       52 |  ~10.200 |      14 |      ~250 |
| `observability/`        |       21 |   ~4.458 |       5 |       ~80 |
| `hooks/`                |       19 |   ~3.499 |       1 |       ~20 |
| `api/`                  |       21 |   ~3.233 |       3 |       ~70 |
| `conversation-hub/`     |       10 |   ~2.487 |       6 |      ~100 |
| `bridges/`              |       10 |   ~2.183 |       4 |       ~60 |
| `channel/`              |        7 |   ~1.497 |       1 |       ~19 |
| `config/`               |        6 |   ~1.415 |       0 |         0 |
| `core/`                 |       14 |   ~1.715 |      10 |      ~150 |
| `audit/`                |        4 |     ~721 |       1 |       ~10 |
| `db/`                   |        3 |     ~411 |       0 |         0 |
| *(nível raiz copilot/)* |        — |        — |      74 |    ~1.086 |
| **TOTAL**               |  **281** | **~51k** | **178** | **3.266** |

### 1.2 Grafo de Dependências (sem alterações desde rev.4)

O grafo permanece idêntico — nenhuma refatoração estrutural foi realizada nas faixas 35-42.

---

## §2. Mapa de Cobertura de Testes por Área (NOVA seção)

### 2.1 Áreas COM testes

| Área                | Linhas Src | # Specs | Cobertura Estimada | Observação                          |
| ------------------- | ---------: | ------: | :----------------: | ----------------------------------- |
| `sdk/`              |      6.679 |      40 |      **~65%**      | Maior concentração; faltam models/  |
| `tools/`            |      2.707 |       6 |      **~45%**      | write, shell, file cobertos         |
| `tools/file/`       |        931 |       2 |      **~70%**      | F35 criou write-tools               |
| `tools/shell/`      |        757 |       1 |      **~30%**      | F36 expandiu                        |
| `api/express/`      |      1.942 |       2 |      **~40%**      | F37+F38                             |
| `channel/`          |      1.497 |       1 |      **~15%**      | F40 (dialog, history, structured)   |
| `bridges/`          |      1.425 |       4 |      **~35%**      | mcp-bridge, nerv-bridge             |
| `conversation-hub/` |      2.487 |       6 |      **~50%**      | store, orchestrator, replay         |
| `hooks/`            |      2.621 |       1 |      **~10%**      | Só factory                          |
| `observability/`    |      2.447 |       5 |      **~25%**      | metrics, event-collector parcial    |
| `terminal/`         |      3.012 |      10 |      **~30%**      | REPL, handlers                      |
| `core/`             |      1.715 |      10 |      **~60%**      | abort, retry, circuit-breaker, etc. |
| `audit/`            |        721 |       1 |      **~15%**      | pipeline parcial                    |

### 2.2 Áreas SEM testes (0 specs diretamente no subdiretório)

| Área                            | Linhas | Criticidade | Motivo                                    |
| ------------------------------- | -----: | :---------: | ----------------------------------------- |
| `agent/` (raiz)                 |  1.257 |      🔴      | AlwaysAliveAgent — core do sistema        |
| `agent/dialog/`                 |  1.793 |      🔴      | loop-manager 600L — god module            |
| `agent/infra/`                  |  1.292 |      🟡      | Boot wiring, reconnect, session pool      |
| `agent/lifecycle/`              |  1.140 |      🟡      | Graceful shutdown, health monitor         |
| `agent/session/`                |  1.614 |      🔴      | Session state machine, event handlers     |
| `agent/session/event-handlers/` |    505 |      🟡      | RPC event routing                         |
| `agent/messaging/`              |    168 |      🟢      | Message formatting                        |
| `agent/state/`                  |     80 |      🟢      | State enums                               |
| `api/bridge/`                   |    796 |      🟡      | HTTP→Agent proxy bridge                   |
| `api/sse/`                      |    473 |      🟡      | SSE streaming, replay buffer              |
| `audit/` (completo)             |    721 |      🟡      | JSONL pipeline, ring-buffer writers       |
| `bridges/gh/`                   |    775 |      🟢      | GitHub MCP bridge                         |
| `config/`                       |  1.424 |      🟡      | env SSOT, session-config, system-prompt   |
| `core/` (sublayers)             |  1.715 |      🟡      | Alguns já testados em specs raiz          |
| `db/`                           |    411 |      🟢      | SQLite persistence                        |
| `hooks/presets/`                |    878 |      🟢      | Hook preset definitions                   |
| `observability/collectors/`     |  1.191 |      🟡      | Session, tool, error collectors           |
| `observability/observers/`      |    837 |      🟡      | Dialog-task handlers, streaming observers |
| `sdk/models/`                   |  1.088 |      🟡      | Model registry, fallback, capabilities    |
| `terminal/commands/`            |  2.479 |      🟡      | 23 arquivos de comandos CLI               |
| `terminal/dialog/`              |    889 |      🟡      | Dialog engine 459L                        |
| `terminal/handlers/`            |  1.281 |      🟡      | System metrics, formatters                |
| `tools/git/`                    |    272 |      🟢      | Git tools                                 |
| `tools/todo/`                   |  1.539 |      🟡      | TODO CRUD 459L + store 423L               |

**Total sem cobertura direta**: ~22.827 linhas (~45% do código fonte)

---

## §3. Problemas Arquiteturais (atualização da rev.4)

### 3.1 Problemas RESOLVIDOS pelas Faixas 35-42

| ID  | Status    | Resolução                                                                                      |
| --- | --------- | ---------------------------------------------------------------------------------------------- |
| P11 | ⚠️ Parcial | 17 subsistemas RPC agora expostos via `sdk/rpc.js` — testes em F41 confirmam contrato completo |
| —   | ✅ Novo    | Typecheck baseline eliminado (33 → 0 erros)                                                    |
| —   | ✅ Novo    | write-tools.js 100% testado — path traversal validado                                          |
| —   | ✅ Novo    | API routes session-crud e observability testadas                                               |

### 3.2 Problemas que PERMANECEM (da rev.4)

| ID  | Severidade | Status   | Achado                                              |
| --- | :--------: | -------- | --------------------------------------------------- |
| P1  | 🔴 CRÍTICO  | Pendente | Dois caminhos de config: buildSessionConfig vs init |
| P2  | 🔴 CRÍTICO  | Pendente | Dois registros de sessão: Map vs stateless          |
| P3  |   🔴 ALTO   | Pendente | Config barrel importa de sdk/ — violação boundaries |
| P4  |   🔴 ALTO   | Pendente | Tipos hooks paralelos a SDK types                   |
| P12 |   🔴 ALTO   | Pendente | 70+ event types sem tipagem forte nos payloads      |
| P5  |  🟡 MÉDIO   | Pendente | `defineTool` bypass em 11 arquivos                  |
| P6  |  🟡 MÉDIO   | Pendente | `approveAll` bypass em 5 arquivos                   |
| P7  |  🟡 MÉDIO   | Pendente | `CopilotClient` fora do wrapper em 2 arquivos       |
| P8  |  🟡 MÉDIO   | Pendente | API routes usam SDK features não-wrapped            |
| P13 |  🟡 MÉDIO   | Pendente | SystemMessage `customize` mode não usado            |
| P14 |  🟡 MÉDIO   | Pendente | Nenhum health check do CLI server                   |
| P15 |  🟡 MÉDIO   | Pendente | Sem verificação autenticação no boot                |
| P16 |  🟡 MÉDIO   | Pendente | Account quota não monitorada                        |
| P9  |  🟢 BAIXO   | Pendente | `SYSTEM_PROMPT_SECTIONS` importado diretamente      |
| P10 |  🟢 BAIXO   | Pendente | `core/sdk-types.js` duplica hooks/types.js          |
| P17 |  🟢 BAIXO   | Pendente | `session.abort()` não exposto                       |
| P18 |  🟢 BAIXO   | Pendente | `joinSession()` extension API ignorada              |

---

## §4. God Modules >400 linhas (inventário atualizado)

| #   | Arquivo                                           | Linhas |         Estado          |
| --- | ------------------------------------------------- | -----: | :---------------------: |
| 1   | `agent/always-alive.js`                           |    620 |       Sem testes        |
| 2   | `agent/dialog/loop-manager.js`                    |    600 |       Sem testes        |
| 3   | `conversation-hub/orchestrator.js`                |    573 |         Parcial         |
| 4   | `sdk/types.js`                                    |    569 |       N/A (tipos)       |
| 5   | `conversation-hub/store.js`                       |    562 |         Parcial         |
| 6   | `channel/client.js`                               |    557 |       Sem testes        |
| 7   | `audit/pipeline.js`                               |    537 |         Parcial         |
| 8   | `terminal/index.js`                               |    494 |         Parcial         |
| 9   | `sdk/rpc.js`                                      |    484 | **Coberto** (99 testes) |
| 10  | `conversation-hub/socket-ns.js`                   |    478 |       Sem testes        |
| 11  | `tools/todo/crud-tools.js`                        |    459 |       Sem testes        |
| 12  | `terminal/dialog/engine.js`                       |    459 |       Sem testes        |
| 13  | `terminal/server.js`                              |    452 |       Sem testes        |
| 14  | `channel/inject.js`                               |    451 |         Parcial         |
| 15  | `terminal/repl.js`                                |    437 |       Sem testes        |
| 16  | `bridges/mcp-tool-bridge.js`                      |    432 |         Parcial         |
| 17  | `bridges/git-bridge.js`                           |    428 |       Sem testes        |
| 18  | `observability/metrics.js`                        |    426 |         Parcial         |
| 19  | `observability/observers/dialog-task-handlers.js` |    424 |       Sem testes        |
| 20  | `tools/todo/store.js`                             |    423 |       Sem testes        |
| 21  | `sdk/client.js`                                   |    417 |         Parcial         |
| 22  | `hooks/factory.js`                                |    416 |         Parcial         |

**Resumo**: 22 god modules, dos quais:
- **1 coberto** (rpc.js — 99 testes)
- **7 parcialmente cobertos** (orchestrator, store, pipeline, terminal/index, inject, mcp-bridge, metrics, client, factory)
- **14 sem testes diretos**

---

## §5. Conclusão e Recomendação (rev.5)

### O que foi alcançado

As Faixas 35-42 resolveram as **lacunas mais urgentes** do rev.4 — particularmente write-tools
(risco de segurança), API routes (alta visibilidade), e typecheck baseline. O total de testes subiu
de 3.053 para 3.266 (+7%) e o typecheck chegou a zero.

### O que ainda falta

1. **~45% do código fonte** (22.827L) permanece sem testes diretos
2. **14 god modules** continuam sem cobertura
3. **Problemas arquiteturais P1–P18** da rev.4 permanecem abertos (são de refatoração, não de testes)
4. Áreas críticas sem teste: `agent/` (AlwaysAliveAgent, dialog loop, session lifecycle)
5. `config/`, `db/`, `hooks/presets/` completamente sem cobertura

### Priorização para próximas faixas

| Prioridade | Área                        | Linhas | Justificativa                           |
| :--------: | --------------------------- | -----: | --------------------------------------- |
|    🔴 1     | `agent/` + `agent/dialog/`  |  3.050 | Core do sistema, crítico em produção    |
|    🔴 2     | `agent/session/`            |  2.119 | State machine + event handlers          |
|    🟡 3     | `tools/todo/`               |  1.539 | God modules (crud-tools + store)        |
|    🟡 4     | `config/`                   |  1.424 | env SSOT, session-config críticos       |
|    🟡 5     | `observability/collectors/` |  1.191 | Collectors e observers                  |
|    🟡 6     | `terminal/commands/`        |  2.479 | CLI commands (volume alto, risco baixo) |
|    🟢 7     | `api/bridge/` + `api/sse/`  |  1.269 | Bridge HTTP→Agent                       |
|    🟢 8     | `bridges/gh/`               |    775 | GitHub MCP (externo, risco baixo)       |

---

*Documento gerado pela auditoria PARTE-17, rev.5. Base: 281 arquivos JS em `src/copilot/`,
178 specs, 3.266 testes passando, 0 erros de typecheck.
Revisões anteriores: .rev2.md, .rev3.md, .rev4.md.*
