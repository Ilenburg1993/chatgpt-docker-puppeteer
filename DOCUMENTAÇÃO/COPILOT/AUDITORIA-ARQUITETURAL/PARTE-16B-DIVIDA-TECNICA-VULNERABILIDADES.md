# PARTE-16B — Análise de Dívida Técnica e Vulnerabilidades

**Data**: 2026-04-08 **Baseline**: commit `bfe96b57` **Referência**: PARTE-16A (inventário),
PARTE-14B (análise original), PARTE-15B (relatório)

---

## 1. Classificação de Dívida Técnica

### 1.1 Categorias

| Categoria      | Código | Descrição                                      | Itens |
| -------------- | ------ | ---------------------------------------------- | ----: |
| Decomposição   | DCM    | God modules >400L que precisam ser partidos    |    22 |
| Confiabilidade | CNF    | Erros engolidos, FS sync, timers sem cleanup   |   306 |
| Segurança      | SEC    | Vetores de ataque e sanitização                |     5 |
| Cobertura      | COV    | Módulos sem testes adequados                   |    12 |
| Padronização   | PAD    | Padrões duplicados não centralizados           |    30 |
| Performance    | PRF    | Hot paths bloqueantes, memory leaks potenciais |    10 |

**Total de itens de dívida técnica identificados: ~385**

---

## 2. Decomposição (DCM) — 22 God Modules

### Tier 1: Prioridade Máxima (600L+)

| ID     | Arquivo           | Linhas | Plano de Decomposição                                  |
| ------ | ----------------- | -----: | ------------------------------------------------------ |
| DCM-01 | `always-alive.js` |    619 | Extrair: health-checker, reconnect-policy, state-sync  |
| DCM-02 | `loop-manager.js` |    597 | Extrair: prompt-builder, turn-reducer, tool-dispatcher |

### Tier 2: Prioridade Alta (450-600L)

| ID     | Arquivo               | Linhas | Plano de Decomposição                                   |
| ------ | --------------------- | -----: | ------------------------------------------------------- |
| DCM-03 | `orchestrator.js`     |    572 | Extrair: model-selector, call-executor, result-merger   |
| DCM-04 | `store.js` (conv-hub) |    561 | Extrair: store-migrations, store-lifecycle              |
| DCM-05 | `client.js` (channel) |    556 | Extrair: client-health, client-batch, client-error      |
| DCM-06 | `pipeline.js`         |    530 | Extrair: phase-runner, report-formatter                 |
| DCM-07 | `terminal/index.js`   |    472 | Extrair: terminal-scheduler, terminal-lifecycle         |
| DCM-08 | `socket-ns.js`        |    467 | Extrair: socket-auth, socket-events, socket-broadcast   |
| DCM-09 | `todo/crud-tools.js`  |    459 | Split: create-tool, update-tool, delete-tool, read-tool |
| DCM-10 | `dialog/engine.js`    |    459 | Extrair: engine-state, engine-transitions               |
| DCM-11 | `terminal/server.js`  |    447 | Extrair: middleware-chain, ws-handler, routes-mount     |
| DCM-12 | `inject.js`           |    451 | Extrair: inject-state, inject-lifecycle                 |

### Tier 3: Prioridade Média (400-450L)

| ID     | Arquivo                   | Linhas | Plano de Decomposição                              |
| ------ | ------------------------- | -----: | -------------------------------------------------- |
| DCM-13 | `terminal/repl.js`        |    436 | Extrair: repl-parser, repl-completions             |
| DCM-14 | `mcp-tool-bridge.js`      |    432 | Extrair: mcp-circuit-breaker, mcp-serializer       |
| DCM-15 | `git-bridge.js`           |    428 | Extrair: git-commands, git-parser                  |
| DCM-16 | `dialog-task-handlers.js` |    424 | Split em handlers individuais por evento           |
| DCM-17 | `todo/store.js`           |    421 | Extrair: todo-migrations, todo-queries-advanced    |
| DCM-18 | `metrics.js`              |    419 | Extrair: metric-collectors, metric-exporters       |
| DCM-19 | `sdk/client.js`           |    413 | Extrair: sdk-streaming, sdk-model-ops              |
| DCM-20 | `introspection-tools.js`  |    409 | Split: system-tools, workspace-tools, debug-tools  |
| DCM-21 | `hooks/factory.js`        |    402 | Extrair: hook-validators, hook-merger              |
| DCM-22 | `file/read-tools.js`      |    398 | Split: read-file-tool, search-file-tool, glob-tool |

---

## 3. Confiabilidade (CNF) — Matriz de Problemas

### 3.1 Erros Engolidos (CNF-ERR)

133 catch blocks identificados. Classificação:

| ID      | Severidade | Módulo               | Descrição                                           | Ação                   |
| ------- | ---------- | -------------------- | --------------------------------------------------- | ---------------------- |
| CNF-E01 | 🔴 Alta    | `otel.js`            | 4 catch {} vazios em init de providers              | Log com warn           |
| CNF-E02 | 🔴 Alta    | `event-collector.js` | 3 catch {} vazios em parsing de eventos             | Log + metric increment |
| CNF-E03 | 🟡 Média   | `metrics.js`         | catch {} em metric export — silencia falhas de OTEL | Log + fallback counter |
| CNF-E04 | 🟡 Média   | `mcp-tool-bridge.js` | catch sem rethrow em métodos críticos               | Log + optional rethrow |
| CNF-E05 | 🟡 Média   | `socket-ns.js`       | catch silencioso em emit de broadcast               | Log + error count      |
| CNF-E06 | 🟢 Baixa   | `tool-stats.js`      | catch com log mas sem metric                        | Adicionar metric       |
| CNF-E07 | 🟢 Baixa   | Multiple files       | `.catch(() => {})` patterns (9 occurrences)         | `.catch(logSwallowed)` |

### 3.2 FS Síncrono (CNF-FS)

84 chamadas FS sync que devem migrar para async:

| ID      | Prioridade | Arquivo           | Calls | Runtime? | Ação                            |
| ------- | ---------- | ----------------- | ----: | -------- | ------------------------------- |
| CNF-F01 | P0         | `snapshot.js`     |     8 | Sim      | Migrar para writeFile/readFile  |
| CNF-F02 | P0         | `write-tools.js`  |     7 | Sim      | Migrar para fs/promises         |
| CNF-F03 | P0         | `state-io.js`     |     7 | Sim      | Migrar para fs/promises         |
| CNF-F04 | P1         | `file-context.js` |    5+ | Sim      | Migrar scan para async          |
| CNF-F05 | P1         | `alias-store.js`  |     2 | Sim      | Migrar para fs/promises         |
| CNF-F06 | P2         | `tools-state.js`  |     2 | Config   | Migrar ou marcar bootstrap-only |
| CNF-F07 | P2         | `custom-tools.js` |     2 | Config   | Migrar ou marcar bootstrap-only |
| CNF-F08 | P2         | `logger.js`       |     2 | Init     | Manter (init-time aceitável)    |
| CNF-F09 | P2         | `sqlite.js`       |     2 | Init     | Manter (init-time aceitável)    |

### 3.3 Timers sem Cleanup (CNF-TMR)

89 chamadas setTimeout/setInterval:

| ID      | Prioridade | Módulo                 | Problema                                   | Ação                       |
| ------- | ---------- | ---------------------- | ------------------------------------------ | -------------------------- |
| CNF-T01 | P0         | `terminal/index.js`    | setInterval para cleanup sem clearInterval | Registrar no shutdown      |
| CNF-T02 | P0         | `always-alive.js`      | Reconnect timers sem cancelamento          | AbortController + clear    |
| CNF-T03 | P1         | `loop-manager.js`      | Turn timeout sem cleanup no abort          | clearTimeout no finally    |
| CNF-T04 | P1         | `socket-ns.js`         | Heartbeat interval sem cleanup             | Registrar no shutdown      |
| CNF-T05 | P1         | `server.js` (terminal) | HTTP keep-alive timers                     | server.close() no shutdown |
| CNF-T06 | P2         | Multiple files         | setTimeout defensivos (geralmente OK)      | Revisar caso a caso        |

### 3.4 process.on Dispersos (CNF-PRC)

16 `process.on` / `process.once` listeners espalhados:

| ID      | Arquivo                | Signal             | Ação                                     |
| ------- | ---------------------- | ------------------ | ---------------------------------------- |
| CNF-P01 | `entry.js`             | SIGTERM, SIGINT    | ✅ Já usa `core/shutdown.js`             |
| CNF-P02 | `sqlite.js`            | exit               | ✅ Já usa `registerShutdownHandler`      |
| CNF-P03 | `always-alive.js`      | unhandledRejection | ⚠️ Deveria delegar para shutdown         |
| CNF-P04 | `server.js` (terminal) | exit               | ⚠️ Migrar para `registerShutdownHandler` |
| CNF-P05 | `inject.js`            | exit               | ⚠️ Migrar para `registerShutdownHandler` |
| CNF-P06 | Outros (~11)           | Diversos           | ⚠️ Auditar e migrar                      |

---

## 4. Segurança (SEC)

### 4.1 Vetor: Execução de Comandos

| ID     | Severidade | Arquivo               | Padrão           | Risco                                        |
| ------ | ---------- | --------------------- | ---------------- | -------------------------------------------- |
| SEC-01 | 🟡 Média   | `session-tools.js`    | `execSync(cmd)`  | Shell injection se CWD contém metacaracteres |
| SEC-02 | 🟢 Baixa   | `tools/git/index.js`  | `execFile(git)`  | Seguro — execFile não usa shell              |
| SEC-03 | 🟢 Baixa   | `tools/code-tools.js` | `execFile(node)` | Seguro — args controlados                    |
| SEC-04 | 🟢 Baixa   | `shell/executor.js`   | `execFile`       | Sandbox com deny-list robusto                |
| SEC-05 | 🟢 Baixa   | `hook-tools.js`       | `execFile`       | Args controlados pelo sistema                |

**Plano**: Migrar SEC-01 de `execSync` para `execFile`, sem shell.

### 4.2 Vetor: Input Não Validado

| ID     | Severidade | Arquivo              | Input               | Risco                             |
| ------ | ---------- | -------------------- | ------------------- | --------------------------------- |
| SEC-06 | 🟡 Média   | `socket-ns.js`       | `socket.handshake`  | Auth bypass se token não validado |
| SEC-07 | 🟡 Média   | `terminal/server.js` | HTTP request origin | CSRF/WebSocket origin spoofing    |
| SEC-08 | 🟢 Baixa   | `file/read-tools.js` | File path args      | Symlink escape (mitigado)         |
| SEC-09 | 🟢 Baixa   | `web-tools.js`       | URL args            | SSRF lento (sem timeout ceiling)  |

### 4.3 Vetor: Information Disclosure

| ID     | Severidade | Arquivo                | Problema                          | Ação                       |
| ------ | ---------- | ---------------------- | --------------------------------- | -------------------------- |
| SEC-10 | 🟢 Baixa   | `server.js` (terminal) | Stack traces em error responses   | Filtrar em production      |
| SEC-11 | 🟢 Baixa   | `error-handler.js`     | Error messages com paths internos | Sanitizar em API responses |

---

## 5. Padronização (PAD)

### 5.1 Retry Duplicado

| ID     | Arquivo              | Padrão Atual                  | Migração Para                  |
| ------ | -------------------- | ----------------------------- | ------------------------------ |
| PAD-01 | `mcp-tool-bridge.js` | for-loop com delay custom     | `withRetry` (com shouldRetry)  |
| PAD-02 | `gh/ci.js`           | Manual retry com backoff      | `withRetry`                    |
| PAD-03 | `orchestrator.js`    | Retry por modelo (específico) | `withRetry` (com custom logic) |
| PAD-04 | `nerv-bridge.js`     | Sem retry (deveria ter)       | Adicionar `withRetry`          |

### 5.2 Timeout Duplicado

| ID     | Arquivo              | Padrão Atual               | Migração Para           |
| ------ | -------------------- | -------------------------- | ----------------------- |
| PAD-05 | `mcp-tool-bridge.js` | Promise.race inline        | `withTimeout`           |
| PAD-06 | `orchestrator.js`    | AbortController manual     | `withTimeout`           |
| PAD-07 | `channel/client.js`  | setTimeout + reject inline | `withTimeout`           |
| PAD-08 | `nerv-bridge.js`     | Sem timeout (deveria ter)  | Adicionar `withTimeout` |

### 5.3 Shutdown Disperso

| ID     | Arquivo              | Padrão Atual               | Migração Para             |
| ------ | -------------------- | -------------------------- | ------------------------- |
| PAD-09 | `terminal/server.js` | process.on('exit')         | `registerShutdownHandler` |
| PAD-10 | `inject.js`          | process.on('exit')         | `registerShutdownHandler` |
| PAD-11 | `socket-ns.js`       | Manual cleanup inline      | `registerShutdownHandler` |
| PAD-12 | `always-alive.js`    | Partial — mistura patterns | Completar migração        |

### 5.4 JSON.parse Defensivo

| ID     | Arquivo      | Padrão Atual                | Migração Para             |
| ------ | ------------ | --------------------------- | ------------------------- |
| PAD-13 | 10+ arquivos | try { JSON.parse } catch {} | Criar `core/safe-json.js` |

---

## 6. Performance (PRF)

| ID     | Severidade | Módulo                | Problema                                           | Impacto                |
| ------ | ---------- | --------------------- | -------------------------------------------------- | ---------------------- |
| PRF-01 | 🔴 Alta    | `snapshot.js`         | 8x readFileSync em hot path                        | Bloqueia event loop    |
| PRF-02 | 🔴 Alta    | `file-context.js`     | readdirSync recursivo em workspace scan            | Bloqueia 100ms+        |
| PRF-03 | 🟡 Média   | `metrics.js`          | Contadores crescem indefinidamente                 | Memory leak lento      |
| PRF-04 | 🟡 Média   | `store.js` (conv-hub) | Queries sem índice em tabelas de conversação       | Lento com muitos dados |
| PRF-05 | 🟡 Média   | `write-tools.js`      | 7x writeFileSync em operações de tool              | Bloqueia event loop    |
| PRF-06 | 🟢 Baixa   | `state-io.js`         | 7x sync — mas alguns são shutdown-only (aceitável) | Parcial                |
| PRF-07 | 🟢 Baixa   | `event-collector.js`  | Array unbounded para eventos coletados             | Memory em sessão longa |
| PRF-08 | 🟢 Baixa   | `logger.js`           | Buffer de log sem flush periódico                  | Memory marginal        |

---

## 7. Sumário Executivo da Dívida

### Por Impacto vs Esforço

```
        Alta Impacto  │  Médio Impacto     │  Baixo Impacto
                      │                     │
Alto    DCM-01..02    │  PAD-01..04         │  DCM-20..22
Esforço SEC-06..07    │  PRF-03..04         │  PAD-13
        COV-01..03    │  CNF-T01..02        │  CNF-E06..07
                      │                     │
Médio   DCM-03..08    │  CNF-F01..03        │  DCM-13..19
Esforço SEC-01        │  CNF-E01..02        │  SEC-10..11
        COV-04..06    │  PAD-09..12         │
                      │                     │
Baixo   CNF-P03..06   │  CNF-E03..05        │  PRF-07..08
Esforço PAD-05..08    │  CNF-F04..09        │  SEC-04..05
```

### Top-10 Itens de Ação por ROI

1. **CNF-F01..03**: Migrar FS sync em snapshot, write-tools, state-io (impacto imediato)
2. **COV-hub**: Adicionar testes para conversation-hub (2473L, 0 testes)
3. **COV-bridges**: Adicionar testes para bridges (2183L, 0 testes)
4. **CNF-E01..02**: Corrigir catch {} vazios em otel + event-collector
5. **PAD-01..04**: Migrar retry manual para `core/retry.js`
6. **SEC-01**: Migrar `execSync` para `execFile` em session-tools
7. **DCM-03..04**: Decompor orchestrator + store (conv-hub)
8. **CNF-T01..04**: Registrar timers no shutdown centralizado
9. **PAD-09..12**: Migrar process.on handlers para shutdown centralizado
10. **SEC-06..07**: Hardening de auth em socket-ns e WebSocket
