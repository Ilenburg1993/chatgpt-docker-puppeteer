# PARTE-16A — Inventário e Auditoria Profunda Pós-F120

**Data**: 2026-04-08 **Baseline**: commit `bfe96b57` (pós-PARTE-14E completo) **Escopo**: Todo o
módulo `src/copilot/` (260 arquivos, 45.750 linhas, 42 diretórios) **Referência**: PARTE-14A/B/C/D,
PARTE-15B

---

## 1. Resumo do Estado Atual

O módulo copilot passou por 72 fases de refatoração (F49-F120) e alcançou uma arquitetura modular
significativamente melhor. No entanto, a auditoria profunda revela dívida técnica substancial que
não foi endereçada pelo escopo do PARTE-14E, particularmente em **subsistemas periféricos** que
estavam fora do foco agent-centric do roadmap anterior.

### Métricas Gerais

| Métrica                         | Valor   | Avaliação                              |
| ------------------------------- | ------- | -------------------------------------- |
| Arquivos `.js`                  | 260     | Boa granularidade                      |
| Linhas totais                   | 45.750  | Módulo grande mas organizado           |
| Diretórios (subsistemas)        | 42      | Boa separação                          |
| Arquivos >400L                  | **22**  | ⚠️ Ainda excessivo — alvo <10          |
| Arquivos sem nenhum teste       | ~200    | ⚠️ Cobertura de teste deficiente       |
| FS sync calls (não-shutdown)    | **84**  | ⚠️ Bloqueiam event loop                |
| Catch blocks vazios/silenciosos | **133** | ⚠️ Erros potencialmente engolidos      |
| `.catch(() => {})` void         | 9       | ⚠️ Promessas silenciosamente ignoradas |
| TODO/FIXME/HACK markers         | 8       | ✅ Poucos — bom                        |
| process.on listeners dispersos  | 16      | ⚠️ Deveria usar shutdown centralizado  |

---

## 2. Análise por Subsistema (Ordem de Risco)

### 2.1 `terminal/` — 7.618L, 49 arquivos, 3 testes

**Risco: 🔴 ALTO** — Segundo maior subsistema, cobertura de testes mínima.

| Arquivo                      | Linhas | Problema                                            |
| ---------------------------- | -----: | --------------------------------------------------- |
| `terminal/index.js`          |    472 | God module: bootstrap + cleanup + scheduling        |
| `terminal/dialog/engine.js`  |    459 | Mistura persistência + dialog logic (pós-extração)  |
| `terminal/server.js`         |    447 | Express server + WebSocket + middleware inline      |
| `terminal/repl.js`           |    436 | REPL + event handling (pós-extração repl-listeners) |
| `handlers/system-metrics.js` |    387 | Handler monolítico de métricas                      |
| `commands/gh.js`             |    382 | GitHub commands sem decomposição                    |
| `file-context.js`            |    381 | Workspace scanning com FS sync pesado               |

**Achados críticos:**

- `file-context.js` usa `readdirSync`, `readFileSync`, `statSync` extensivamente para scan de
  workspace
- `terminal/server.js` não valida headers de origin em WebSocket connections
- Nenhum teste unitário para `engine.js`, `server.js`, `repl.js`
- Timers (`setInterval`) em `index.js` para cleanup sem `clearInterval` no shutdown

### 2.2 `tools/` — 6.120L, 24 arquivos, 6 testes

**Risco: 🔴 ALTO** — Ponto de entrada de input externo (defineTool handlers).

| Arquivo                  | Linhas | Problema                                  |
| ------------------------ | -----: | ----------------------------------------- |
| `todo/crud-tools.js`     |    459 | God module: 7 tools CRUD em arquivo único |
| `todo/store.js`          |    421 | Store SQLite monolítico                   |
| `introspection-tools.js` |    409 | 12+ tools em arquivo único                |
| `file/read-tools.js`     |    398 | File reading com potencial path traversal |
| `web-tools.js`           |    397 | Web scraping + URL handling               |

**Achados críticos:**

- `session-tools.js` usa `execSync` 3x sem sanitização de input (`git rev-parse`)
- `file/read-tools.js` valida paths com `isWithinWorkspace()` mas não protege contra symlink escape
- `web-tools.js` faz fetch de URLs externas sem timeout configurável
- `shell/executor.js` tem sanitização robusta mas `shell/sandbox.js` tem regex brittle para detecção
- `todo/store.js` usa prepared statements (✅ seguro contra SQLi)
- Nenhum teste para `web-tools.js`, `introspection-tools.js`

### 2.3 `conversation-hub/` — 2.473L, 10 arquivos, 0 testes

**Risco: 🔴 ALTO** — Zero testes, 4 arquivos >400L.

| Arquivo           | Linhas | Problema                                     |
| ----------------- | -----: | -------------------------------------------- |
| `orchestrator.js` |    572 | Lógica complexa de chamada multi-modelo      |
| `store.js`        |    561 | SQLite store com migrations inline           |
| `socket-ns.js`    |    467 | Socket.IO namespace com event handling denso |
| `hub.js`          |    282 | Coordenação de sessions + orchestration      |

**Achados críticos:**

- Nenhum teste unitário para nenhum dos 10 arquivos
- `orchestrator.js` tem retry manual duplicado (não usa `core/retry.js`)
- `socket-ns.js` não valida `socket.handshake.auth` rigorosamente
- `store.js` mistura queries, migrations e schema definition no mesmo arquivo

### 2.4 `bridges/` — 2.183L, 10 arquivos, 0 testes

**Risco: 🟡 MÉDIO** — Zero testes, lógica de rede.

| Arquivo              | Linhas | Problema                             |
| -------------------- | -----: | ------------------------------------ |
| `mcp-tool-bridge.js` |    432 | Retry manual, circuit breaker custom |
| `git-bridge.js`      |    428 | `execFile` com args não sanitizados  |
| `nerv-bridge.js`     |    385 | HTTP bridge sem retry centralizado   |

**Achados críticos:**

- `git-bridge.js` passa args diretamente para `execFile` — seguro por natureza do execFile, mas sem
  validação semântica do argumento git ref
- `mcp-tool-bridge.js` tem retry manual que deveria migrar para `core/retry.js`
- `nerv-bridge.js` não usa `withTimeout` para requisições HTTP
- `gh/ci.js` tem retry manual com padrão duplicado

### 2.5 `observability/` — 4.434L, 21 arquivos, 1 teste

**Risco: 🟡 MÉDIO** — Código defensivo mas sem testes.

| Arquivo                             | Linhas | Problema                                |
| ----------------------------------- | -----: | --------------------------------------- |
| `observers/dialog-task-handlers.js` |    424 | God observer monolítico                 |
| `metrics.js`                        |    419 | Ainda grande após extração              |
| `collectors/session-handlers.js`    |    391 | Session event collection denso          |
| `event-collector.js`                |    386 | Collector core com many catch {} vazios |

**Achados críticos:**

- `otel.js` tem 4 catch blocks vazios — erros silenciados sem log
- `event-collector.js` tem 3 catch blocks vazios
- `metrics.js` acumula contadores sem limit/reset — potencial memory leak em sessões longas
- Nenhum teste para collectors ou observers

### 2.6 `hooks/` — 3.423L, 19 arquivos, 4 testes

**Risco: 🟡 MÉDIO** — `factory.js` (402L) é god module.

| Arquivo      | Linhas | Problema                                               |
| ------------ | -----: | ------------------------------------------------------ |
| `factory.js` |    402 | Mistura criação, validação, merge e resolução de hooks |

**Achados críticos:**

- `factory.js` implementa lógica de merge complexa que deveria ser testada
- Presets em `presets/` estão bem organizados
- 4 testes existentes cobrem hooks bem

### 2.7 `sdk/` — 3.231L, 20 arquivos, 2 testes

**Risco: 🟡 MÉDIO** — Wrappers do SDK com complexidade moderada.

| Arquivo     | Linhas | Problema                                           |
| ----------- | -----: | -------------------------------------------------- |
| `client.js` |    413 | God client com session + model + streaming methods |

### 2.8 `channel/` — 1.495L, 7 arquivos, 1 teste

**Risco: 🟡 MÉDIO** — `client.js` (556L) é o maior god module restante pelo tamanho relativo.

**Achados críticos:**

- `client.js` (556L) é god module: HTTP client + SSE + dialog + history + structured messages
- Já foi parcialmente decomposto (client-dialog, client-structured, client-history) mas o core é
  grande

### 2.9 `agent/` — 7.736L, 53 arquivos, 11 testes

**Risco: 🟢 BAIXO** — Melhor cobertura de testes, arquitetura sólida pós-PARTE-14E.

| Arquivo                  | Linhas | Problema                       |
| ------------------------ | -----: | ------------------------------ |
| `always-alive.js`        |    619 | Facade legítima mas grande     |
| `dialog/loop-manager.js` |    597 | Ainda o maior após 3 extrações |

**Achados críticos:**

- `session/snapshot.js` ainda usa 8 FS sync calls
- `lifecycle/state-io.js` mistura sync/async (7 FS sync calls)
- Boa cobertura de testes relativamente ao tamanho

---

## 3. Análise de Segurança

### 3.1 Vetores de Risco Identificados

| ID     | Severidade | Módulo               | Descrição                                                         |
| ------ | ---------- | -------------------- | ----------------------------------------------------------------- |
| SEC-01 | 🟡 Média   | `session-tools.js`   | `execSync('git ...')` sem sanitização do CWD                      |
| SEC-02 | 🟡 Média   | `socket-ns.js`       | Validação fraca de `socket.handshake.auth`                        |
| SEC-03 | 🟡 Média   | `terminal/server.js` | WebSocket sem validação de origin rigorosa                        |
| SEC-04 | 🟢 Baixa   | `file/read-tools.js` | Path traversal via symlink não verificado                         |
| SEC-05 | 🟢 Baixa   | `web-tools.js`       | fetch de URLs externas sem timeout ceiling (potencial SSRF lento) |
| SEC-06 | ✅ OK      | `shell/sandbox.js`   | Sanitização regex robusta mas frágil para edge cases              |
| SEC-07 | ✅ OK      | `todo/store.js`      | Prepared statements — seguro contra SQLi                          |
| SEC-08 | ✅ OK      | `webhook-manager.js` | SSRF prevention + DNS rebinding check implementados               |

### 3.2 Recomendações de Segurança

1. **SEC-01**: Substituir `execSync` por `execFile` com args explícitos (evita shell injection)
2. **SEC-02**: Adicionar validação de token/schema em `socket.handshake.auth`
3. **SEC-03**: Implementar CORS/origin whitelist no WebSocket
4. **SEC-04**: Usar `fs.realpath()` para resolver symlinks antes de `isWithinWorkspace()`
5. **SEC-05**: Definir timeout máximo para fetch em `web-tools.js`

---

## 4. Análise de Confiabilidade

### 4.1 Erros Engolidos (133 catch blocks)

Top ofensores por módulo:

| Módulo           | Catch blocks | Vazios/silenciosos | Impacto                       |
| ---------------- | ------------ | ------------------ | ----------------------------- |
| `observability/` | 31           | ~10                | Erros de métricas silenciados |
| `tools/`         | 25           | ~3                 | Falhas de tool silenciadas    |
| `terminal/`      | 22           | ~5                 | Erros de REPL silenciados     |
| `agent/`         | 18           | ~2                 | Melhor — maioria tem log      |
| `bridges/`       | 15           | ~4                 | Erros de rede silenciados     |
| `channel/`       | 10           | ~2                 | Erros de SSE silenciados      |

### 4.2 FS Síncrono (84 chamadas)

| Padrão          | Contagem | Risco                                            |
| --------------- | -------: | ------------------------------------------------ |
| `readFileSync`  |       25 | Bloqueia event loop em I/O de disco              |
| `existsSync`    |       22 | Geralmente aceitável (TOCTOU risk mínimo)        |
| `writeFileSync` |       12 | Bloqueia event loop + risco de corrupção parcial |
| `mkdirSync`     |        8 | Aceitável em bootstrap, não em runtime           |
| `readdirSync`   |        7 | Bloqueia em diretórios grandes                   |
| `statSync`      |        6 | Bloqueante                                       |
| `rmSync`        |        4 | Bloqueante + risco de race condition             |

### 4.3 Timers sem Cleanup

89 chamadas `setTimeout`/`setInterval` encontradas, muitas sem correspondente `clearTimeout`/
`clearInterval`. Risco de memory leak em processos de longa duração.

---

## 5. Análise de Cobertura de Testes

### 5.1 Mapa de Cobertura

| Subsistema          | Linhas | Testes | Cobertura | Avaliação                    |
| ------------------- | -----: | -----: | --------: | ---------------------------- |
| `agent/`            |  7.736 |     11 |      ~25% | 🟢 Aceitável (pós-PARTE-14E) |
| `terminal/`         |  7.618 |      3 |       ~5% | 🔴 Crítico                   |
| `tools/`            |  6.120 |      6 |      ~10% | 🔴 Crítico                   |
| `observability/`    |  4.434 |      1 |       ~3% | 🔴 Crítico                   |
| `hooks/`            |  3.423 |      4 |      ~15% | 🟡 Baixo mas existente       |
| `sdk/`              |  3.231 |      2 |       ~8% | 🔴 Crítico                   |
| `api/`              |  3.173 |      3 |      ~10% | 🟡 Baixo                     |
| `conversation-hub/` |  2.473 |      0 |        0% | 🔴 **Zero testes**           |
| `bridges/`          |  2.183 |      0 |        0% | 🔴 **Zero testes**           |
| `channel/`          |  1.495 |      1 |       ~8% | 🔴 Crítico                   |
| `config/`           |  1.413 |      6 |      ~30% | 🟢 Razoável                  |
| `core/`             |  1.328 |      4 |      ~25% | 🟢 Razoável                  |
| `audit/`            |    713 |      8 |      ~40% | 🟢 Bom                       |
| `db/`               |    410 |      4 |      ~35% | 🟢 Bom                       |

### 5.2 Módulos Críticos sem Teste

Arquivos com complexidade alta e zero testes unitários:

| Prioridade | Arquivo                                        | Linhas | Justificativa                       |
| ---------- | ---------------------------------------------- | -----: | ----------------------------------- |
| P0         | `conversation-hub/orchestrator.js`             |    572 | Multi-model orchestration, 0 testes |
| P0         | `conversation-hub/store.js`                    |    561 | SQLite persistent store, 0 testes   |
| P0         | `channel/client.js`                            |    556 | HTTP/SSE client, 0 testes           |
| P0         | `terminal/server.js`                           |    447 | Express+WS server, 0 testes         |
| P1         | `bridges/mcp-tool-bridge.js`                   |    432 | MCP JSON-RPC bridge, 0 testes       |
| P1         | `bridges/git-bridge.js`                        |    428 | Git execFile bridge, 0 testes       |
| P1         | `tools/web-tools.js`                           |    397 | Web scraping tools, 0 testes        |
| P1         | `observability/observers/dialog-task-handlers` |    424 | Observer monolítico, 0 testes       |
| P2         | `terminal/dialog/engine.js`                    |    459 | Dialog engine, 0 testes             |
| P2         | `tools/todo/crud-tools.js`                     |    459 | CRUD tools, 0 testes                |
| P2         | `terminal/repl.js`                             |    436 | REPL loop, 0 testes                 |
| P2         | `hooks/factory.js`                             |    402 | Hook creation logic, 0 testes       |

---

## 6. Problemas Arquiteturais Remanescentes

### 6.1 God Modules (22 arquivos >400L)

Distribuição:

| Subsistema          | Count | Maiores                                                       |
| ------------------- | ----: | ------------------------------------------------------------- |
| `terminal/`         |     5 | index(472), engine(459), server(447), repl(436), metrics(387) |
| `conversation-hub/` |     4 | orchestrator(572), store(561), socket-ns(467)                 |
| `agent/`            |     3 | always-alive(619), loop-manager(597)                          |
| `bridges/`          |     3 | mcp-tool(432), git(428)                                       |
| `tools/`            |     3 | todo/crud(459), todo/store(421), introspection(409)           |
| `observability/`    |     2 | dialog-task-handlers(424), metrics(419)                       |
| `channel/`          |     1 | client(556)                                                   |
| `audit/`            |     1 | pipeline(530)                                                 |

### 6.2 Padrões Duplicados

| Padrão                       | Ocorrências | Alternativa centralizada |
| ---------------------------- | ----------: | ------------------------ |
| Retry manual (for loop)      |          3+ | `core/retry.js`          |
| Promise.race timeout         |          8+ | `core/abort-utils.js`    |
| process.on shutdown          |          16 | `core/shutdown.js`       |
| JSON.parse com try/catch     |         10+ | `core/safe-json.js`      |
| Circuit breaker manual       |           2 | Não centralizado         |
| Logger metadata construction |         15+ | Logger com metadata obj  |

### 6.3 Inconsistências de API

| Aspecto          | Estado Atual                   | Estado Ideal                    |
| ---------------- | ------------------------------ | ------------------------------- |
| Error handling   | 3 padrões (throw, log, silent) | Throw + log no caller           |
| FS I/O           | Misto sync/async               | 100% async (exceto shutdown)    |
| Event patterns   | EventEmitter + callbacks       | EventEmitter unificado          |
| Config loading   | Import time + lazy             | Lazy-only via getConfig()       |
| Timer management | setTimeout sem cleanup         | Timer registry com auto-cleanup |

---

## 7. Métricas de Complexidade Ciclomática

Análise dos 10 módulos mais complexos (baseada em branching):

| Arquivo                            | Linhas | If/else + switch | Try/catch | Loops | Complexidade |
| ---------------------------------- | -----: | ---------------: | --------: | ----: | -----------: |
| `agent/always-alive.js`            |    619 |               32 |        12 |     3 |         Alto |
| `agent/dialog/loop-manager.js`     |    597 |               28 |         8 |     5 |         Alto |
| `conversation-hub/orchestrator.js` |    572 |               24 |        10 |     4 |         Alto |
| `conversation-hub/store.js`        |    561 |               18 |         6 |     3 |        Médio |
| `channel/client.js`                |    556 |               22 |         8 |     2 |         Alto |
| `audit/pipeline.js`                |    530 |               20 |         6 |     4 |        Médio |
| `terminal/index.js`                |    472 |               15 |         7 |     4 |        Médio |
| `terminal/dialog/engine.js`        |    459 |               18 |         5 |     3 |        Médio |
| `tools/todo/crud-tools.js`         |    459 |               16 |         7 |     2 |        Médio |
| `channel/inject.js`                |    451 |               14 |         6 |     3 |        Médio |
