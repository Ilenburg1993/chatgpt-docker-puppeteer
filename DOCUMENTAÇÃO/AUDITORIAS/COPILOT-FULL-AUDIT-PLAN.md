# Plano de Auditoria Completa — src/copilot

**Versão**: 2.0 **Data**: 2026-07-05 **Escopo**: Todo o diretório `src/copilot/` (160 arquivos JS,
~19.439 LOC, 15 módulos) **Skill guia**: `.github/skills/copilot-full-audit/SKILL.md` **Saída**:
160+ relatórios MD individuais + 15 consolidados de módulo + 7 de integração + 4 globais **Diretório
de saída**: `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-AUDIT-REPORTS/` **Templates**:
`DOCUMENTAÇÃO/AUDITORIAS/COPILOT-AUDIT-REPORTS/templates/`

---

## 1. Objetivos da Auditoria

1. **Detecção de bugs** — bugs lógicos, semânticos, race conditions, leaks, invariantes violados
2. **Análise de integridade** — contratos entre módulos, typedefs, shapes de dados
3. **Avaliação arquitetural** — acoplamento, coesão, camadas, separação de responsabilidades
4. **Integração cross-module** — como os sistemas se conectam (ou faltam conexões)
5. **Segurança** — injection, SSRF, path traversal, permissões, secrets exposure
6. **Performance** — hotspots, allocations desnecessárias, complexidade algorítmica
7. **Dead code** — código não referenciado, exports sem consumidores, shims obsoletos
8. **Cobertura de testes** — gaps de teste, módulos sem spec, cenários edge não cobertos
9. **Oportunidades de upgrade** — padrões melhores, APIs modernas, simplificações
10. **Documentação por arquivo** — cada arquivo gera um MD individual completo
11. **Visão por módulo** — cada módulo gera um MD consolidado
12. **Visão integrada** — fluxos cross-module e visão arquitetural global documentados

---

## 2. Tipologia de Nomenclatura (Padrão Canônico)

Toda questão identificada receberá um ID composto. O formato é `{TIPO}-{MÓDULO}-{SEQ}`.

### 2.1 Tipos de Questão (prefixo)

| Prefixo | Significado                  | Exemplo         |
| ------- | ---------------------------- | --------------- |
| `BUG`   | Bug lógico/semântico         | `BUG-AGENT-001` |
| `RACE`  | Race condition / timing      | `RACE-HOOK-003` |
| `LEAK`  | Memory/resource leak         | `LEAK-OBS-002`  |
| `SEC`   | Vulnerabilidade de segurança | `SEC-TOOLS-001` |
| `PERF`  | Problema de performance      | `PERF-TERM-004` |
| `GAP`   | Funcionalidade ausente/gap   | `GAP-API-002`   |
| `INC`   | Inconsistência de contrato   | `INC-LIB-001`   |
| `DEAD`  | Dead code / unreachable      | `DEAD-HOOK-005` |
| `TYPO`  | Typedef/JSDoc incorreto      | `TYPO-OBS-003`  |
| `ARCH`  | Questão arquitetural         | `ARCH-CHAN-001` |
| `TEST`  | Gap de cobertura de teste    | `TEST-DB-001`   |
| `UPG`   | Proposta de upgrade          | `UPG-AGENT-007` |
| `INTG`  | Integração cross-module      | `INTG-OBS-001`  |

### 2.2 Códigos de Módulo (infixo)

| Código  | Módulo            | Arquivos | LOC  |
| ------- | ----------------- | -------- | ---- |
| `AGENT` | agent/            | 22       | 4914 |
| `API`   | api/              | 6        | 741  |
| `BRDG`  | bridges/          | 10       | 2044 |
| `CHAN`  | channel/          | 3        | 1175 |
| `CONF`  | config/           | 9        | 1540 |
| `CONV`  | conversation-hub/ | 6        | 2206 |
| `CORE`  | core/             | 3        | 162  |
| `DB`    | db/               | 2        | 358  |
| `HOOK`  | hooks/            | 18       | 3334 |
| `LIB`   | lib/              | 12       | 1904 |
| `OBS`   | observability/    | 9        | 3784 |
| `ROUTE` | routes/           | 7        | 1546 |
| `TERM`  | terminal/         | 27       | 4920 |
| `TOOLS` | tools/            | 23       | 5716 |
| `TYPES` | types/            | 3        | 515  |

### 2.3 Severidade

| Nível | Significado                    | Ação              |
| ----- | ------------------------------ | ----------------- |
| `P0`  | Crítico: crash, data loss, sec | Fix imediato      |
| `P1`  | Alto: funcionalidade quebrada  | Fix prioritário   |
| `P2`  | Médio: issue contextual        | Fix programado    |
| `P3`  | Baixo: code smell, melhoria    | Backlog           |
| `P4`  | Info: observação, sugestão     | Documentar apenas |

---

## 3. Mapa Estático do Codebase

### 3.1 Módulos e contagens

| #   | Módulo            | Files   | LOC        | Test Specs | Casos de Teste |
| --- | ----------------- | ------- | ---------- | ---------- | -------------- |
| 1   | agent/            | 22      | 4914       | 7          | ~340           |
| 2   | tools/            | 23      | 5716       | 3          | ~150           |
| 3   | observability/    | 9       | 3784       | 0          | 0              |
| 4   | hooks/            | 18      | 3334       | 2          | ~100           |
| 5   | terminal/         | 27      | 4920       | 6          | ~280           |
| 6   | conversation-hub/ | 6       | 2206       | 2          | ~100           |
| 7   | bridges/          | 10      | 2044       | 5          | ~250           |
| 8   | lib/              | 12      | 1904       | 10         | ~500           |
| 9   | routes/           | 7       | 1546       | 1          | ~50            |
| 10  | config/           | 9       | 1540       | 5          | ~200           |
| 11  | channel/          | 3       | 1175       | 2          | ~80            |
| 12  | api/              | 6       | 741        | 4          | ~180           |
| 13  | core/             | 3       | 162        | 0          | 0              |
| 14  | types/            | 3       | 515        | 2          | ~80            |
| 15  | db/               | 2       | 358        | 1          | ~40            |
|     | **TOTAL**         | **160** | **38.859** | **50**     | **~2350**      |

### 3.2 Grafo de dependências inter-módulo

```
observability/ ← 87 imports de 10+ módulos (god module)
agent/ ↔ hooks/ (dependência circular via session-hooks)
core/constants.js ← re-exports agent/events.js (layer violation)
76 imports diretos de #copilot/observability/logger (barrel bypass)
22 arquivos importam @github/copilot-sdk diretamente (sem façade)
```

### 3.3 Diagnóstico Arquitetural — AS-IS

**Métricas de acoplamento empíricas (MF-I)**:

| Métrica                                 | Valor | Interpretação             |
| --------------------------------------- | ----- | ------------------------- |
| Imports cross-module totais             | 171   | Alto acoplamento          |
| Imports para observability/             | 87    | 51% do total → god module |
| Barrel bypasses (imports diretos)       | ~100  | Barrels subutilizados     |
| `#copilot/observability/logger` diretos | 76    | Logger como utilidade     |
| `@github/copilot-sdk` diretos           | 22    | SDK espalhado             |
| Dependências circulares                 | 1 par | hooks↔agent               |
| Singletons `let` module-level           | ~30   | Sem lifecycle mgmt        |
| Maps/Sets sem TTL                       | ~37   | Potential memory leaks    |
| Sync I/O (readFileSync/writeFileSync)   | 15+   | Blocking em prod          |

### 3.4 Visão Arquitetural — TO-BE

**Modelo de camadas alvo**:

```
Layer 1 — Infrastructure:  db/
Layer 2 — Utilities:       lib/, types/, core/
Layer 3 — Observability:   observability/
Layer 4 — Domain Logic:    hooks/, config/, tools/, bridges/, channel/
Layer 5 — Orchestration:   agent/, conversation-hub/, terminal/
Layer 6 — Interface:       routes/, api/
```

**Princípios arquiteturais (P1-P10)**:

| Code | Princípio               | Descrição curta                        |
| ---- | ----------------------- | -------------------------------------- |
| P1   | Single import path      | Tudo via barrel (`index.js`)           |
| P2   | Observable by default   | Eventos para ações significativas      |
| P3   | Explicit lifecycle      | init/start/stop/dispose em singletons  |
| P4   | Contract-first          | Typedefs antes de implementação        |
| P5   | Test-driven             | 80%+ cobertura, 0 módulos sem spec     |
| P6   | Defense in depth        | Validação em cada boundary             |
| P7   | Fail gracefully         | Degradação > crash                     |
| P8   | Configuration over code | Comportamento via config, não hardcode |
| P9   | Dependency injection    | Injeção > acesso direto a singletons   |
| P10  | Resource bounded        | TTL/eviction em toda coleção           |

**Delta AS-IS → TO-BE (9 transformações)**:

| #   | Transformação                 | Complexidade | Prioridade |
| --- | ----------------------------- | ------------ | ---------- |
| T1  | Logger abstraction layer      | Média        | P1         |
| T2  | SDK accessor centralization   | Alta         | P1         |
| T3  | Event bus unification (NERV)  | Alta         | P2         |
| T4  | Barrel-only imports           | Baixa        | P2         |
| T5  | core/ independence            | Baixa        | P1         |
| T6  | Circular dep resolution       | Média        | P1         |
| T7  | Singleton lifecycle mgmt      | Alta         | P2         |
| T8  | Map TTL/eviction policies     | Média        | P1         |
| T9  | Observability as pure utility | Alta         | P3         |

---

## 4. Metodologia v2.0 — "1 Arquivo Lido → 1 MD Criado"

### 4.1 Mudanças fundamentais em relação ao v1.x

| Aspecto                  | v1.x                           | v2.0                                         |
| ------------------------ | ------------------------------ | -------------------------------------------- |
| Leitura                  | Ler em batches, anotar memória | Ler arquivo → escrever MD imediatamente      |
| Output por arquivo       | Anotação informal              | MD formal com template de 15 seções          |
| Output por módulo        | 1 relatório por macro-fase     | 1 MD consolidado APÓS todos individuais      |
| Output integração        | 4 fluxos                       | 7 fluxos (incluindo segurança, conv-hub)     |
| Output global            | 1 sumário                      | 4 artefatos (sumário, issues, roadmap, arch) |
| Fases MF-II              | 6 fases genéricas              | 13 fases (1 por módulo)                      |
| Fases MF-III             | 4 fases                        | 8 fases (7 fluxos + visão arquitetural)      |
| Total de fases           | 16                             | 31                                           |
| Total artefatos de saída | ~20 MDs                        | ~190 MDs                                     |

### 4.2 Ritmo operacional obrigatório

```
PARA CADA módulo M:
  PARA CADA arquivo A em M:
    1. Ler A integralmente (read_file)
    2. Analisar A usando checklist (seção 5.1)
    3. Escrever MD individual de A (TEMPLATE-ARQUIVO-INDIVIDUAL.md)
  FIM
  4. Escrever MD consolidado de M (TEMPLATE-MODULO-CONSOLIDADO.md)
FIM

PARA CADA fluxo F:
  5. Analisar fluxo cross-module F
  6. Escrever MD de integração de F (TEMPLATE-INTEGRACAO-CROSS-MODULE.md)
FIM

7. Escrever MD de visão arquitetural (TEMPLATE-VISAO-ARQUITETURAL.md)
8. Escrever ISSUES-CONSOLIDATED.md
9. Escrever ROADMAP-FIXES.md
10. Escrever 00-SUMMARY.md
```

### 4.3 Templates disponíveis

| Template                              | Quando usar                         | Seções |
| ------------------------------------- | ----------------------------------- | ------ |
| `TEMPLATE-ARQUIVO-INDIVIDUAL.md`      | Após ler cada arquivo               | 15     |
| `TEMPLATE-MODULO-CONSOLIDADO.md`      | Após todos os MDs de um módulo      | 16     |
| `TEMPLATE-INTEGRACAO-CROSS-MODULE.md` | Para cada fluxo E2E                 | 12     |
| `TEMPLATE-VISAO-ARQUITETURAL.md`      | Após todos os módulos e integrações | 8      |

### 4.4 Estrutura de diretórios de saída

```
DOCUMENTAÇÃO/AUDITORIAS/COPILOT-AUDIT-REPORTS/
├── templates/
│   ├── TEMPLATE-ARQUIVO-INDIVIDUAL.md
│   ├── TEMPLATE-MODULO-CONSOLIDADO.md
│   ├── TEMPLATE-INTEGRACAO-CROSS-MODULE.md
│   └── TEMPLATE-VISAO-ARQUITETURAL.md
├── agent/                               ← 22 MDs individuais
│   ├── always-alive-audit.md
│   ├── dialog-loop-manager-audit.md
│   └── ...
├── tools/                               ← 23 MDs individuais
│   ├── tool-factory-audit.md
│   └── ...
├── observability/                       ← 9 MDs individuais
├── hooks/                               ← 18 MDs individuais
├── terminal/                            ← 27 MDs individuais
├── bridges/                             ← 10 MDs individuais
├── conversation-hub/                    ← 6 MDs individuais
├── config/                              ← 9 MDs individuais
├── lib/                                 ← 12 MDs individuais
├── routes/                              ← 7 MDs individuais
├── channel/                             ← 3 MDs individuais
├── api/                                 ← 6 MDs individuais
├── core/                                ← 3 MDs individuais
├── types/                               ← 3 MDs individuais
├── db/                                  ← 2 MDs individuais
├── 01-agent.md                          ← Consolidado do módulo
├── 02-tools.md
├── 03-observability.md
├── 04-hooks.md
├── 05-terminal.md
├── 06-bridges.md
├── 07-conversation-hub.md
├── 08-config.md
├── 09-lib.md
├── 10-routes.md
├── 11-channel.md
├── 12-api.md
├── 13-core.md
├── 14-types.md
├── 15-db.md
├── INTEGRATION-telemetry.md             ← Fluxos cross-module
├── INTEGRATION-session-lifecycle.md
├── INTEGRATION-tool-pipeline.md
├── INTEGRATION-terminal.md
├── INTEGRATION-conv-hub.md
├── INTEGRATION-security.md
├── ARCHITECTURE-VISION.md               ← Visão arquitetural
├── ISSUES-CONSOLIDATED.md               ← Tabela de todas as questões
├── ROADMAP-FIXES.md                     ← Roadmap priorizado
└── 00-SUMMARY.md                        ← Sumário executivo
```

---

## 5. Checklist de Análise

### 5.1 Checklist por arquivo (aplicar em cada .js lido)

```
□ Contratos de entrada: params validados? defaults seguros?
□ Contratos de saída: return types corretos? errors propagados?
□ Estado interno: Maps/Sets com TTL? Cleanup em destroy/detach?
□ Error handling: catch genérico? finally garante cleanup?
□ Edge cases: null, undefined, empty array, timeout, overflow?
□ Invariantes: precondições verificadas? postcondições garantidas?
□ JSDoc: typedefs corretos? @param/@returns completos?
□ Segurança: injection? path traversal? SSRF? secrets exposure?
□ Concurrency: race conditions? concurrent writes? event ordering?
□ Resources: file handles fechados? timers limpos? listeners removidos?
□ Dead code: exports sem consumidores? imports não usados?
□ Performance: sync I/O? unbounded growth? O(n²)?
□ Arquitetura: violação de camada? barrel bypass? SDK direto?
□ Testes: spec existe? cenários edge cobertos?
```

### 5.2 Checklist por fluxo cross-module

```
□ Data flow: dados do ponto A ao Z, transformações corretas?
□ Event flow: emissão→consumo completo, deduplicação, ordenação?
□ Error flow: erros no ponto A chegam ao ponto Z?
□ State consistency: estado compartilhado é consistente?
□ Resource lifecycle: abertos no módulo A são fechados no B?
□ Contract alignment: tipos do módulo A casam com expectativas do B?
□ Concurrency: 2 invocações simultâneas do fluxo são seguras?
```

---

## 6. Macro-Fases e Fases Detalhadas

### MACRO-FASE I — Leitura Exploratória (F01-F04) ✅ CONCLUÍDA

> MF-I foi concluída na v1.x. Todos os 160 arquivos foram lidos. Anotações em session memory. A
> partir da v2.0, MF-I serve como referência histórica. O trabalho recomeça na MF-II.

| Fase | Escopo                                                       | Files | Status |
| ---- | ------------------------------------------------------------ | ----- | ------ |
| F01  | agent/ + hooks/                                              | 40    | ✅     |
| F02  | observability/ + bridges/ + api/                             | 25    | ✅     |
| F03  | tools/ + config/ + terminal/                                 | 59    | ✅     |
| F04  | channel/ + conv-hub/ + core/ + db/ + lib/ + types/ + routes/ | 36    | ✅     |

**Deliverable**: 22 achados preliminares documentados na conversa + session memory.

---

### MACRO-FASE II — Leitura Individual + Documentação por Arquivo (F05-F17)

> **Objetivo**: Reler cada arquivo integralmente, aplicar o checklist de análise, e produzir um MD
> individual por arquivo usando o `TEMPLATE-ARQUIVO-INDIVIDUAL.md`. Ao terminar todos os arquivos de
> um módulo, produzir o MD consolidado usando `TEMPLATE-MODULO-CONSOLIDADO.md`.

**Ritmo obrigatório: 1 arquivo lido → 1 MD individual criado → (ao final do módulo) 1 MD
consolidado**

#### Fase F05 — agent/ (22 arquivos → 22 MDs individuais + 1 consolidado)

| Subfase | Arquivo                    | LOC  | Ação                                         |
| ------- | -------------------------- | ---- | -------------------------------------------- |
| F05-01  | `always-alive.js`          | ~650 | Ler + `agent/always-alive-audit.md`          |
| F05-02  | `dialog-loop-manager.js`   | ~380 | Ler + `agent/dialog-loop-manager-audit.md`   |
| F05-03  | `dialog-loop-wirer.js`     | ~120 | Ler + `agent/dialog-loop-wirer-audit.md`     |
| F05-04  | `dialog-protocol.js`       | ~200 | Ler + `agent/dialog-protocol-audit.md`       |
| F05-05  | `dialog-turn-executor.js`  | ~250 | Ler + `agent/dialog-turn-executor-audit.md`  |
| F05-06  | `dialog-watchdog.js`       | ~180 | Ler + `agent/dialog-watchdog-audit.md`       |
| F05-07  | `entry.js`                 | ~400 | Ler + `agent/entry-audit.md`                 |
| F05-08  | `events.js`                | ~150 | Ler + `agent/events-audit.md`                |
| F05-09  | `index.js`                 | ~80  | Ler + `agent/index-audit.md`                 |
| F05-10  | `message-queue.js`         | ~120 | Ler + `agent/message-queue-audit.md`         |
| F05-11  | `mission-agent.js`         | ~300 | Ler + `agent/mission-agent-audit.md`         |
| F05-12  | `permission-controller.js` | ~250 | Ler + `agent/permission-controller-audit.md` |
| F05-13  | `post-process.js`          | ~180 | Ler + `agent/post-process-audit.md`          |
| F05-14  | `reconnect-policy.js`      | ~200 | Ler + `agent/reconnect-policy-audit.md`      |
| F05-15  | `session-initializer.js`   | ~250 | Ler + `agent/session-initializer-audit.md`   |
| F05-16  | `state-io.js`              | ~150 | Ler + `agent/state-io-audit.md`              |
| F05-17  | `status-snapshot.js`       | ~100 | Ler + `agent/status-snapshot-audit.md`       |
| F05-18  | `streaming-handler.js`     | ~180 | Ler + `agent/streaming-handler-audit.md`     |
| F05-19  | `task-executor.js`         | ~350 | Ler + `agent/task-executor-audit.md`         |
| F05-20  | `tool-audit-logger.js`     | ~120 | Ler + `agent/tool-audit-logger-audit.md`     |
| F05-21  | `types.js`                 | ~100 | Ler + `agent/types-audit.md`                 |
| F05-22  | `webhook-manager.js`       | ~200 | Ler + `agent/webhook-manager-audit.md`       |
| F05-23  | — CONSOLIDAÇÃO —           | —    | Escrever `01-agent.md` (consolidado)         |

#### Fase F06 — hooks/ (18 arquivos → 18 MDs individuais + 1 consolidado)

| Subfase | Arquivo                  | LOC  | Ação                                       |
| ------- | ------------------------ | ---- | ------------------------------------------ |
| F06-01  | `audit.js`               | ~200 | Ler + `hooks/audit-audit.md`               |
| F06-02  | `bus.js`                 | ~150 | Ler + `hooks/bus-audit.md`                 |
| F06-03  | `composer.js`            | ~250 | Ler + `hooks/composer-audit.md`            |
| F06-04  | `error-handler.js`       | ~100 | Ler + `hooks/error-handler-audit.md`       |
| F06-05  | `factory.js`             | ~300 | Ler + `hooks/factory-audit.md`             |
| F06-06  | `index.js`               | ~80  | Ler + `hooks/index-audit.md`               |
| F06-07  | `permission-handler.js`  | ~350 | Ler + `hooks/permission-handler-audit.md`  |
| F06-08  | `presets/deny-all.js`    | ~50  | Ler + `hooks/presets-deny-all-audit.md`    |
| F06-09  | `presets/index.js`       | ~80  | Ler + `hooks/presets-index-audit.md`       |
| F06-10  | `presets/interactive.js` | ~150 | Ler + `hooks/presets-interactive-audit.md` |
| F06-11  | `presets/production.js`  | ~200 | Ler + `hooks/presets-production-audit.md`  |
| F06-12  | `presets/safe.js`        | ~120 | Ler + `hooks/presets-safe-audit.md`        |
| F06-13  | `prompt-transformer.js`  | ~250 | Ler + `hooks/prompt-transformer-audit.md`  |
| F06-14  | `registry.js`            | ~180 | Ler + `hooks/registry-audit.md`            |
| F06-15  | `session-lifecycle.js`   | ~300 | Ler + `hooks/session-lifecycle-audit.md`   |
| F06-16  | `tool-interceptor.js`    | ~250 | Ler + `hooks/tool-interceptor-audit.md`    |
| F06-17  | `types.js`               | ~120 | Ler + `hooks/types-audit.md`               |
| F06-18  | `user-input.js`          | ~100 | Ler + `hooks/user-input-audit.md`          |
| F06-19  | — CONSOLIDAÇÃO —         | —    | Escrever `04-hooks.md` (consolidado)       |

#### Fase F07 — tools/ (23 arquivos → 23 MDs individuais + 1 consolidado)

| Subfase | Arquivo                  | LOC  | Ação                                       |
| ------- | ------------------------ | ---- | ------------------------------------------ |
| F07-01  | `tool-factory.js`        | ~300 | Ler + `tools/tool-factory-audit.md`        |
| F07-02  | `index.js`               | ~120 | Ler + `tools/index-audit.md`               |
| F07-03  | `code-tools.js`          | ~200 | Ler + `tools/code-tools-audit.md`          |
| F07-04  | `file/index.js`          | ~80  | Ler + `tools/file-index-audit.md`          |
| F07-05  | `file/read-tools.js`     | ~350 | Ler + `tools/file-read-tools-audit.md`     |
| F07-06  | `file/shared.js`         | ~150 | Ler + `tools/file-shared-audit.md`         |
| F07-07  | `file/write-tools.js`    | ~400 | Ler + `tools/file-write-tools-audit.md`    |
| F07-08  | `git/index.js`           | ~80  | Ler + `tools/git-index-audit.md`           |
| F07-09  | `git-tools.js`           | ~400 | Ler + `tools/git-tools-audit.md`           |
| F07-10  | `hook-tools.js`          | ~150 | Ler + `tools/hook-tools-audit.md`          |
| F07-11  | `hub-tools.js`           | ~200 | Ler + `tools/hub-tools-audit.md`           |
| F07-12  | `introspection-tools.js` | ~150 | Ler + `tools/introspection-tools-audit.md` |
| F07-13  | `permission-tools.js`    | ~100 | Ler + `tools/permission-tools-audit.md`    |
| F07-14  | `session-rpc-tools.js`   | ~200 | Ler + `tools/session-rpc-tools-audit.md`   |
| F07-15  | `session-tools.js`       | ~180 | Ler + `tools/session-tools-audit.md`       |
| F07-16  | `shell/index.js`         | ~350 | Ler + `tools/shell-index-audit.md`         |
| F07-17  | `task-tools.js`          | ~200 | Ler + `tools/task-tools-audit.md`          |
| F07-18  | `todo/bulk-tools.js`     | ~200 | Ler + `tools/todo-bulk-tools-audit.md`     |
| F07-19  | `todo/crud-tools.js`     | ~250 | Ler + `tools/todo-crud-tools-audit.md`     |
| F07-20  | `todo/index.js`          | ~80  | Ler + `tools/todo-index-audit.md`          |
| F07-21  | `todo/query-tools.js`    | ~150 | Ler + `tools/todo-query-tools-audit.md`    |
| F07-22  | `todo/store.js`          | ~350 | Ler + `tools/todo-store-audit.md`          |
| F07-23  | `web-tools.js`           | ~200 | Ler + `tools/web-tools-audit.md`           |
| F07-24  | — CONSOLIDAÇÃO —         | —    | Escrever `02-tools.md` (consolidado)       |

#### Fase F08 — observability/ (9 arquivos → 9 MDs individuais + 1 consolidado)

| Subfase | Arquivo                   | LOC  | Ação                                                |
| ------- | ------------------------- | ---- | --------------------------------------------------- |
| F08-01  | `event-collector.js`      | ~800 | Ler + `observability/event-collector-audit.md`      |
| F08-02  | `agent-event-observer.js` | ~600 | Ler + `observability/agent-event-observer-audit.md` |
| F08-03  | `metrics.js`              | ~500 | Ler + `observability/metrics-audit.md`              |
| F08-04  | `audit-log.js`            | ~400 | Ler + `observability/audit-log-audit.md`            |
| F08-05  | `otel.js`                 | ~350 | Ler + `observability/otel-audit.md`                 |
| F08-06  | `error-tracker.js`        | ~300 | Ler + `observability/error-tracker-audit.md`        |
| F08-07  | `logger.js`               | ~400 | Ler + `observability/logger-audit.md`               |
| F08-08  | `hooks-audit-preset.js`   | ~250 | Ler + `observability/hooks-audit-preset-audit.md`   |
| F08-09  | `index.js`                | ~150 | Ler + `observability/index-audit.md`                |
| F08-10  | — CONSOLIDAÇÃO —          | —    | Escrever `03-observability.md` (consolidado)        |

#### Fase F09 — terminal/ (27 arquivos → 27 MDs individuais + 1 consolidado)

| Subfase | Arquivo                | LOC  | Ação                                        |
| ------- | ---------------------- | ---- | ------------------------------------------- |
| F09-01  | `bootstrap.js`         | ~250 | Ler + `terminal/bootstrap-audit.md`         |
| F09-02  | `server.js`            | ~300 | Ler + `terminal/server-audit.md`            |
| F09-03  | `repl.js`              | ~350 | Ler + `terminal/repl-audit.md`              |
| F09-04  | `dialog.js`            | ~400 | Ler + `terminal/dialog-audit.md`            |
| F09-05  | `state.js`             | ~200 | Ler + `terminal/state-audit.md`             |
| F09-06  | `index.js`             | ~100 | Ler + `terminal/index-audit.md`             |
| F09-07  | `handlers-agent.js`    | ~200 | Ler + `terminal/handlers-agent-audit.md`    |
| F09-08  | `handlers-dialog.js`   | ~200 | Ler + `terminal/handlers-dialog-audit.md`   |
| F09-09  | `handlers-shared.js`   | ~150 | Ler + `terminal/handlers-shared-audit.md`   |
| F09-10  | `handlers-system.js`   | ~180 | Ler + `terminal/handlers-system-audit.md`   |
| F09-11  | `http-handlers.js`     | ~300 | Ler + `terminal/http-handlers-audit.md`     |
| F09-12  | `route-table.js`       | ~100 | Ler + `terminal/route-table-audit.md`       |
| F09-13  | `file-context.js`      | ~150 | Ler + `terminal/file-context-audit.md`      |
| F09-14  | `workspace-context.js` | ~200 | Ler + `terminal/workspace-context-audit.md` |
| F09-15  | `commands/index.js`    | ~80  | Ler + `terminal/commands-index-audit.md`    |
| F09-16  | `commands/alias.js`    | ~80  | Ler + `terminal/commands-alias-audit.md`    |
| F09-17  | `commands/attach.js`   | ~100 | Ler + `terminal/commands-attach-audit.md`   |
| F09-18  | `commands/config.js`   | ~80  | Ler + `terminal/commands-config-audit.md`   |
| F09-19  | `commands/context.js`  | ~100 | Ler + `terminal/commands-context-audit.md`  |
| F09-20  | `commands/gh.js`       | ~120 | Ler + `terminal/commands-gh-audit.md`       |
| F09-21  | `commands/git.js`      | ~120 | Ler + `terminal/commands-git-audit.md`      |
| F09-22  | `commands/help.js`     | ~80  | Ler + `terminal/commands-help-audit.md`     |
| F09-23  | `commands/memory.js`   | ~120 | Ler + `terminal/commands-memory-audit.md`   |
| F09-24  | `commands/plan.js`     | ~100 | Ler + `terminal/commands-plan-audit.md`     |
| F09-25  | `commands/resume.js`   | ~80  | Ler + `terminal/commands-resume-audit.md`   |
| F09-26  | `commands/session.js`  | ~120 | Ler + `terminal/commands-session-audit.md`  |
| F09-27  | `commands/skills.js`   | ~80  | Ler + `terminal/commands-skills-audit.md`   |
| F09-28  | — CONSOLIDAÇÃO —       | —    | Escrever `05-terminal.md` (consolidado)     |

#### Fase F10 — bridges/ (10 arquivos → 10 MDs individuais + 1 consolidado)

| Subfase | Arquivo              | LOC  | Ação                                     |
| ------- | -------------------- | ---- | ---------------------------------------- |
| F10-01  | `git-bridge.js`      | ~350 | Ler + `bridges/git-bridge-audit.md`      |
| F10-02  | `gh-bridge.js`       | ~300 | Ler + `bridges/gh-bridge-audit.md`       |
| F10-03  | `gh/ci.js`           | ~180 | Ler + `bridges/gh-ci-audit.md`           |
| F10-04  | `gh/issues.js`       | ~200 | Ler + `bridges/gh-issues-audit.md`       |
| F10-05  | `gh/pr.js`           | ~250 | Ler + `bridges/gh-pr-audit.md`           |
| F10-06  | `gh/utils.js`        | ~100 | Ler + `bridges/gh-utils-audit.md`        |
| F10-07  | `nerv-bridge.js`     | ~250 | Ler + `bridges/nerv-bridge-audit.md`     |
| F10-08  | `mcp-tool-bridge.js` | ~180 | Ler + `bridges/mcp-tool-bridge-audit.md` |
| F10-09  | `alias-store.js`     | ~120 | Ler + `bridges/alias-store-audit.md`     |
| F10-10  | `index.js`           | ~100 | Ler + `bridges/index-audit.md`           |
| F10-11  | — CONSOLIDAÇÃO —     | —    | Escrever `06-bridges.md` (consolidado)   |

#### Fase F11 — conversation-hub/ (6 arquivos → 6 MDs individuais + 1 consolidado)

| Subfase | Arquivo            | LOC  | Ação                                            |
| ------- | ------------------ | ---- | ----------------------------------------------- |
| F11-01  | `hub.js`           | ~500 | Ler + `conversation-hub/hub-audit.md`           |
| F11-02  | `orchestrator.js`  | ~450 | Ler + `conversation-hub/orchestrator-audit.md`  |
| F11-03  | `store.js`         | ~500 | Ler + `conversation-hub/store-audit.md`         |
| F11-04  | `store-helpers.js` | ~300 | Ler + `conversation-hub/store-helpers-audit.md` |
| F11-05  | `socket-ns.js`     | ~300 | Ler + `conversation-hub/socket-ns-audit.md`     |
| F11-06  | `index.js`         | ~150 | Ler + `conversation-hub/index-audit.md`         |
| F11-07  | — CONSOLIDAÇÃO —   | —    | Escrever `07-conversation-hub.md` (consolidado) |

#### Fase F12 — config/ (9 arquivos → 9 MDs individuais + 1 consolidado)

| Subfase | Arquivo                  | LOC  | Ação                                        |
| ------- | ------------------------ | ---- | ------------------------------------------- |
| F12-01  | `session-config.js`      | ~300 | Ler + `config/session-config-audit.md`      |
| F12-02  | `system-prompt.js`       | ~250 | Ler + `config/system-prompt-audit.md`       |
| F12-03  | `custom-agents.js`       | ~150 | Ler + `config/custom-agents-audit.md`       |
| F12-04  | `mcp-servers.js`         | ~200 | Ler + `config/mcp-servers-audit.md`         |
| F12-05  | `pinned-files-loader.js` | ~120 | Ler + `config/pinned-files-loader-audit.md` |
| F12-06  | `tools/sdk-tools.js`     | ~200 | Ler + `config/tools-sdk-tools-audit.md`     |
| F12-07  | `tools/custom-tools.js`  | ~150 | Ler + `config/tools-custom-tools-audit.md`  |
| F12-08  | `tools/index.js`         | ~80  | Ler + `config/tools-index-audit.md`         |
| F12-09  | `index.js`               | ~100 | Ler + `config/index-audit.md`               |
| F12-10  | — CONSOLIDAÇÃO —         | —    | Escrever `08-config.md` (consolidado)       |

#### Fase F13 — lib/ (12 arquivos → 12 MDs individuais + 1 consolidado)

| Subfase | Arquivo             | LOC  | Ação                                |
| ------- | ------------------- | ---- | ----------------------------------- |
| F13-01  | `sdk-client.js`     | ~350 | Ler + `lib/sdk-client-audit.md`     |
| F13-02  | `session.js`        | ~300 | Ler + `lib/session-audit.md`        |
| F13-03  | `tools-registry.js` | ~261 | Ler + `lib/tools-registry-audit.md` |
| F13-04  | `models.js`         | ~253 | Ler + `lib/models-audit.md`         |
| F13-05  | `agents.js`         | ~173 | Ler + `lib/agents-audit.md`         |
| F13-06  | `event-helpers.js`  | ~140 | Ler + `lib/event-helpers-audit.md`  |
| F13-07  | `url-validator.js`  | ~88  | Ler + `lib/url-validator-audit.md`  |
| F13-08  | `http-request.js`   | ~61  | Ler + `lib/http-request-audit.md`   |
| F13-09  | `utils.js`          | ~37  | Ler + `lib/utils-audit.md`          |
| F13-10  | `hooks.js`          | ~19  | Ler + `lib/hooks-audit.md`          |
| F13-11  | `permissions.js`    | ~17  | Ler + `lib/permissions-audit.md`    |
| F13-12  | `index.js`          | ~120 | Ler + `lib/index-audit.md`          |
| F13-13  | — CONSOLIDAÇÃO —    | —    | Escrever `09-lib.md` (consolidado)  |

#### Fase F14 — routes/ (7 arquivos → 7 MDs individuais + 1 consolidado)

| Subfase | Arquivo            | LOC  | Ação                                  |
| ------- | ------------------ | ---- | ------------------------------------- |
| F14-01  | `sessions.js`      | ~661 | Ler + `routes/sessions-audit.md`      |
| F14-02  | `agent.js`         | ~222 | Ler + `routes/agent-audit.md`         |
| F14-03  | `client.js`        | ~205 | Ler + `routes/client-audit.md`        |
| F14-04  | `observability.js` | ~208 | Ler + `routes/observability-audit.md` |
| F14-05  | `hooks.js`         | ~134 | Ler + `routes/hooks-audit.md`         |
| F14-06  | `webhooks.js`      | ~86  | Ler + `routes/webhooks-audit.md`      |
| F14-07  | `middleware.js`    | ~30  | Ler + `routes/middleware-audit.md`    |
| F14-08  | — CONSOLIDAÇÃO —   | —    | Escrever `10-routes.md` (consolidado) |

#### Fase F15 — channel/ (3 arquivos → 3 MDs individuais + 1 consolidado)

| Subfase | Arquivo          | LOC  | Ação                                   |
| ------- | ---------------- | ---- | -------------------------------------- |
| F15-01  | `client.js`      | ~600 | Ler + `channel/client-audit.md`        |
| F15-02  | `inject.js`      | ~450 | Ler + `channel/inject-audit.md`        |
| F15-03  | `index.js`       | ~120 | Ler + `channel/index-audit.md`         |
| F15-04  | — CONSOLIDAÇÃO — | —    | Escrever `11-channel.md` (consolidado) |

#### Fase F16 — api/ (6 arquivos → 6 MDs individuais + 1 consolidado)

| Subfase | Arquivo             | LOC  | Ação                                |
| ------- | ------------------- | ---- | ----------------------------------- |
| F16-01  | `http-bridge.js`    | ~200 | Ler + `api/http-bridge-audit.md`    |
| F16-02  | `sdk-api.js`        | ~150 | Ler + `api/sdk-api-audit.md`        |
| F16-03  | `bridge-control.js` | ~120 | Ler + `api/bridge-control-audit.md` |
| F16-04  | `bridge-dialog.js`  | ~100 | Ler + `api/bridge-dialog-audit.md`  |
| F16-05  | `bridge-stream.js`  | ~100 | Ler + `api/bridge-stream-audit.md`  |
| F16-06  | `bridge-tasks.js`   | ~80  | Ler + `api/bridge-tasks-audit.md`   |
| F16-07  | — CONSOLIDAÇÃO —    | —    | Escrever `12-api.md` (consolidado)  |

#### Fase F17 — core/ + db/ + types/ (8 arquivos → 8 MDs individuais + 3 consolidados)

| Subfase | Arquivo                       | LOC  | Ação                                      |
| ------- | ----------------------------- | ---- | ----------------------------------------- |
| F17-01  | `core/constants.js`           | ~80  | Ler + `core/constants-audit.md`           |
| F17-02  | `core/errors.js`              | ~60  | Ler + `core/errors-audit.md`              |
| F17-03  | `core/index.js`               | ~22  | Ler + `core/index-audit.md`               |
| F17-04  | — CONSOLIDAÇÃO core/ —        | —    | Escrever `13-core.md` (consolidado)       |
| F17-05  | `db/sqlite.js`                | ~250 | Ler + `db/sqlite-audit.md`                |
| F17-06  | `db/migrations.js`            | ~108 | Ler + `db/migrations-audit.md`            |
| F17-07  | — CONSOLIDAÇÃO db/ —          | —    | Escrever `15-db.md` (consolidado)         |
| F17-08  | `types/structured-message.js` | ~380 | Ler + `types/structured-message-audit.md` |
| F17-09  | `types/sdk.js`                | ~112 | Ler + `types/sdk-audit.md`                |
| F17-10  | `types/index.js`              | ~23  | Ler + `types/index-audit.md`              |
| F17-11  | — CONSOLIDAÇÃO types/ —       | —    | Escrever `14-types.md` (consolidado)      |

---

### MACRO-FASE III — Análise de Integração Cross-Module + Visão Arquitetural (F18-F25)

> **Objetivo**: Analisar fluxos end-to-end que cruzam múltiplos módulos, utilizando os MDs
> individuais e consolidados como referência. Produzir MDs de integração (template
> `TEMPLATE-INTEGRACAO-CROSS-MODULE.md`) e visão arquitetural global (template
> `TEMPLATE-VISAO-ARQUITETURAL.md`).

#### Fase F18 — Integração: Telemetria End-to-End

| Subfase | Foco                                                                   |
| ------- | ---------------------------------------------------------------------- |
| F18-01  | Fluxo completo: SDK event → collector → observer → metrics → REST      |
| F18-02  | Deduplicação: mesmos eventos processados por collector E observer?     |
| F18-03  | OTEL span propagation: traces conectados entre task→tool→turn?         |
| F18-04  | Audit log: tool-execution vs tool-permissions — consumidores corretos? |
| F18-05  | Métricas expostas: tudo que o MetricsStore coleta chega no REST?       |
| F18-06  | Error tracking: erros capturados → errorTracker → REST → dashboard     |
| F18-07  | Escrever `INTEGRATION-telemetry.md`                                    |

#### Fase F19 — Integração: Session Lifecycle

| Subfase | Foco                                                                  |
| ------- | --------------------------------------------------------------------- |
| F19-01  | Boot sequence: config → hooks → agent → session → dialog              |
| F19-02  | Reconnect flow: error → teardown → reconnect → re-init → resume       |
| F19-03  | Shutdown flow: stop → cleanup → timers → handlers → state persistence |
| F19-04  | Multi-session: conversation-hub isolation, resource sharing           |
| F19-05  | Escrever `INTEGRATION-session-lifecycle.md`                           |

#### Fase F20 — Integração: Tool Execution Pipeline

| Subfase | Foco                                                        |
| ------- | ----------------------------------------------------------- |
| F20-01  | Tool registration: factory → config → SDK hooks             |
| F20-02  | Permission flow: request → controller → preset → allow/deny |
| F20-03  | Execution flow: task-executor → tool call → result → audit  |
| F20-04  | Error propagation: tool error → agent → observer → user     |
| F20-05  | Escrever `INTEGRATION-tool-pipeline.md`                     |

#### Fase F21 — Integração: Terminal LLM-B

| Subfase | Foco                                                      |
| ------- | --------------------------------------------------------- |
| F21-01  | Bootstrap: server + REPL + agent connection               |
| F21-02  | Command routing: input → route-table → handler → response |
| F21-03  | Dialog flow: terminal → agent → SDK → response → terminal |
| F21-04  | State sync: terminal state vs agent state consistency     |
| F21-05  | Escrever `INTEGRATION-terminal.md`                        |

#### Fase F22 — Integração: Conversation Hub End-to-End

| Subfase | Foco                                                          |
| ------- | ------------------------------------------------------------- |
| F22-01  | Multi-session orchestration: create → manage → switch → close |
| F22-02  | Store consistency: SQLite + in-memory state                   |
| F22-03  | Socket.io namespace: events, reconnection, broadcast          |
| F22-04  | Hub ↔ Agent ↔ SDK: contract alignment                         |
| F22-05  | Escrever `INTEGRATION-conv-hub.md`                            |

#### Fase F23 — Integração: Segurança Transversal

| Subfase | Foco                                                          |
| ------- | ------------------------------------------------------------- |
| F23-01  | SSRF: url-validator → web-tools → http-request → bridges      |
| F23-02  | Injection: shell tools → terminal commands → git tools        |
| F23-03  | Path traversal: file tools → workspace context → pinned files |
| F23-04  | Auth: SDK_API_TOKEN → routes middleware → session             |
| F23-05  | Secrets: env vars, config, logs — exposure surface            |
| F23-06  | Prompt injection: user input → prompt transformer → LLM       |
| F23-07  | Escrever `INTEGRATION-security.md`                            |

#### Fase F24 — Visão Arquitetural Consolidada

| Subfase | Foco                                                         |
| ------- | ------------------------------------------------------------ |
| F24-01  | Compilar health scores de todos os 15 módulos                |
| F24-02  | Compilar grafo de acoplamento atualizado (com dados dos MDs) |
| F24-03  | Avaliar conformidade com modelo TO-BE (por módulo)           |
| F24-04  | Avaliar princípios P1-P10 (conformidade global)              |
| F24-05  | Compilar top-10 achados mais críticos do sistema             |
| F24-06  | Escrever `ARCHITECTURE-VISION.md`                            |

#### Fase F25 — Relatórios Consolidados Globais

| Subfase | Ação                                                   |
| ------- | ------------------------------------------------------ |
| F25-01  | Compilar `ISSUES-CONSOLIDATED.md` (todas as questões)  |
| F25-02  | Compilar `ROADMAP-FIXES.md` (priorização de correções) |
| F25-03  | Escrever `00-SUMMARY.md` (sumário executivo)           |

---

### MACRO-FASE IV — Execução de Correções e Upgrades (F26-F31)

> **Objetivo**: Implementar correções priorizadas com quality gates entre cada batch.

#### Fase F26 — Correções P0 (Críticas)

| Subfase | Ação                                          |
| ------- | --------------------------------------------- |
| F26-01  | Implementar cada correção P0 identificada     |
| F26-02  | `npm run test:unit` após cada correção        |
| F26-03  | Commit incremental por batch de 3-5 correções |

#### Fase F27 — Correções P1 (Altas)

| Subfase | Ação                                           |
| ------- | ---------------------------------------------- |
| F27-01  | Implementar cada correção P1 identificada      |
| F27-02  | `npm run test:unit` após cada correção         |
| F27-03  | Commit incremental por batch de 5-10 correções |

#### Fase F28 — Correções P2 (Médias)

| Subfase | Ação                                      |
| ------- | ----------------------------------------- |
| F28-01  | Implementar cada correção P2 identificada |
| F28-02  | `npm run test:unit` após cada batch       |
| F28-03  | Commit incremental                        |

#### Fase F29 — Upgrades Priorizados

| Subfase | Ação                                 |
| ------- | ------------------------------------ |
| F29-01  | Implementar upgradesP1 selecionados  |
| F29-02  | Implementar upgrades P2 selecionados |
| F29-03  | `npm run test:unit` + `npm run lint` |

#### Fase F30 — Transformações Arquiteturais

| Subfase | Ação                                                           |
| ------- | -------------------------------------------------------------- |
| F30-01  | T5: core/ independence (resolver re-export de agent/events.js) |
| F30-02  | T6: Resolver circular hooks↔agent                              |
| F30-03  | T4: Barrel-only imports (eliminar bypasses mais críticos)      |
| F30-04  | T8: Map TTL/eviction em coleções de maior risco                |
| F30-05  | T1: Logger abstraction layer (se aprovado)                     |
| F30-06  | Quality gates após cada transformação                          |

#### Fase F31 — Quality Gates Finais

| Subfase | Ação                                                  |
| ------- | ----------------------------------------------------- |
| F31-01  | `npm run test:unit` — DEVE SER green                  |
| F31-02  | `npm run lint` — DEVE SER green                       |
| F31-03  | `npm run format:check` — DEVE SER green               |
| F31-04  | Verificar que todos os MDs estão escritos             |
| F31-05  | Atualizar `00-SUMMARY.md` com resultado das correções |
| F31-06  | Commit final + push                                   |

---

## 7. Estimativa de Escopo

| Macro-fase      | Fases  | Subfases | Artefatos MD gerados                      |
| --------------- | ------ | -------- | ----------------------------------------- |
| I: Leitura      | 4      | 61       | 0 (anotações internas) ✅ CONCLUÍDA       |
| II: Individual  | 13     | 176      | 160 MDs individuais + 15 consolidados     |
| III: Integração | 8      | 36       | 7 integrações + 1 arquitetura + 3 globais |
| IV: Correções   | 6      | 21       | Updates nos MDs existentes                |
| **TOTAL**       | **31** | **294**  | **~186 MDs**                              |

---

## 8. Ordem de Execução (Prioridade de Risco)

Na Macro-Fase II, os módulos são analisados na ordem de risco ponderado:

| Prioridade | Fase | Módulo            | LOC  | Risco | Justificativa                                  |
| ---------- | ---- | ----------------- | ---- | ----- | ---------------------------------------------- |
| 🔴 1       | F07  | tools/            | 5716 | Alto  | Maior LOC, shell/file/web sec surface, 3 specs |
| 🔴 2       | F05  | agent/            | 4914 | Alto  | State machine, concurrency, lifecycle          |
| 🔴 3       | F08  | observability/    | 3784 | Alto  | 0 specs, god module, Maps com leaks            |
| 🟠 4       | F06  | hooks/            | 3334 | Médio | Permission handling, prompt injection          |
| 🟠 5       | F09  | terminal/         | 4920 | Médio | HTTP handlers, commands, 27 arquivos           |
| 🟠 6       | F11  | conversation-hub/ | 2206 | Médio | Multi-session isolation, store                 |
| 🟡 7       | F10  | bridges/          | 2044 | Médio | External API calls, error handling             |
| 🟡 8       | F12  | config/           | 1540 | Baixo | Validation, defaults                           |
| 🟡 9       | F13  | lib/              | 1904 | Baixo | Utilities, boa cobertura (10 specs)            |
| 🟡 10      | F14  | routes/           | 1546 | Médio | HTTP middleware, auth, 1 spec                  |
| 🟢 11      | F15  | channel/          | 1175 | Baixo | SSE client, relativamente isolado              |
| 🟢 12      | F16  | api/              | 741  | Baixo | HTTP bridge, 4 specs                           |
| 🟢 13      | F17  | core/db/types     | 1035 | Médio | Constants, DB/SQL, type definitions            |

**Nota**: A execução segue a numeração das fases (F05-F17) que foi organizada por afinidade lógica
(agent+hooks primeiro, tools depois), mas o agente pode consultar esta tabela para priorizar módulos
de maior risco quando houver opções.

---

## 9. Regras de Execução

### R1 — Leitura integral obrigatória

Cada arquivo deve ser lido **por completo** antes de gerar o MD individual. Não auditar com base em
grep ou leitura parcial.

### R2 — MD imediato após leitura

Após ler um arquivo, o MD individual DEVE ser criado imediatamente, antes de ler o próximo arquivo.
Ritmo: `read → write → read → write → ...`

### R3 — Consolidação ao final do módulo

O MD consolidado do módulo é escrito APENAS após TODOS os MDs individuais do módulo estarem prontos.

### R4 — Tipologia estrita

Todo achado DEVE usar o formato `{TIPO}-{MOD}-{SEQ}`. Sem exceções.

### R5 — Evidência antes de conclusão

Todo achado deve apontar arquivo, linhas e cenário de manifestação.

### R6 — Testes intactos entre macro-fases

Rodar `npm run test:unit` ao final de cada macro-fase e antes de qualquer correção.

### R7 — Commit incremental em MF-IV

Não acumular centenas de linhas sem commit durante correções.

### R8 — Sem ferramentas automáticas para achados

ESLint, TypeScript, Prettier NÃO são fontes de achados. São quality gates. A análise é manual e
semântica.

### R9 — Template de progresso em session memory

Manter arquivo de progresso em `/memories/session/` com estado de cada fase/subfase.

### R10 — Análise arquitetural em cada arquivo

Todo arquivo analisado deve ser avaliado sob a lente do diagnóstico arquitetural (seção 3.3-3.4).

### R11 — Pontuação obrigatória

Todo MD individual deve incluir a seção "Pontuação de Saúde" (6 dimensões + média ponderada).

### R12 — Releitura completa

Mesmo que o arquivo já tenha sido lido na MF-I, ele DEVE ser relido integralmente na MF-II. A MF-I
serve como briefing, não como substituto.

---

## 10. Protocolo de Retomada

Em caso de interrupção (token limit, crash, nova sessão):

1. **Ler** `/memories/session/copilot-audit-progress.md` (se existir)
2. **Ler** este plano: `COPILOT-FULL-AUDIT-PLAN.md`
3. **Ler** skill guia: `.github/skills/copilot-full-audit/SKILL.md`
4. **Identificar** última subfase concluída (verificar MDs já criados)
5. **Retomar** da próxima subfase pendente
6. **Verificar** MDs já escritos estão corretos e completos
7. **Rodar** `npm run test:unit` para garantir baseline intacto

### Template de progresso (session memory)

```markdown
# Copilot Full Audit — Progresso

## Última atualização: {timestamp}

## Fase atual: {FXX-YY}

### Macro-Fase II: Leitura + Documentação

- [x] F05-01 always-alive.js → agent/always-alive-audit.md ✅
- [x] F05-02 dialog-loop-manager.js → agent/dialog-loop-manager-audit.md ✅
- [ ] F05-03 dialog-loop-wirer.js (em progresso)
- ...
- [ ] F05-23 — CONSOLIDAÇÃO → 01-agent.md

### Macro-Fase III: Integração

- [ ] F18-01 ...

### Achados por módulo

| Módulo | BUG | RACE | LEAK | SEC | PERF | ARCH | Total |
| ------ | --- | ---- | ---- | --- | ---- | ---- | ----- |
| agent/ |     |      |      |     |      |      |       |
```

---

## 11. Riscos e Mitigações

| Risco                                | Mitigação                                      |
| ------------------------------------ | ---------------------------------------------- |
| Volume de MDs (190+)                 | Templates padronizados + ritmo disciplinado    |
| Interrupção de context (token limit) | Session memory com progresso por subfase (R9)  |
| Regression após correções            | `npm run test:unit` após cada batch (R6)       |
| Achados duplicados entre módulos     | Tipologia com ID único + ISSUES-CONSOLIDATED   |
| Análise superficial por volume       | Leitura integral obrigatória (R1) + checklist  |
| Perda de rastreabilidade             | IDs tipados + referência a arquivo#linhas (R5) |
| Inconsistência entre MDs             | Template fixo + pontuação obrigatória (R11)    |
| Falso positivo                       | Cenário de manifestação obrigatório (R5)       |

---

## 12. Lista Completa de Arquivos por Módulo

### agent/ (22 arquivos)

1. `always-alive.js` 2. `dialog-loop-manager.js` 3. `dialog-loop-wirer.js`
2. `dialog-protocol.js` 5. `dialog-turn-executor.js` 6. `dialog-watchdog.js`
3. `entry.js` 8. `events.js` 9. `index.js` 10. `message-queue.js`
4. `mission-agent.js` 12. `permission-controller.js` 13. `post-process.js`
5. `reconnect-policy.js` 15. `session-initializer.js` 16. `state-io.js`
6. `status-snapshot.js` 18. `streaming-handler.js` 19. `task-executor.js`
7. `tool-audit-logger.js` 21. `types.js` 22. `webhook-manager.js`

### tools/ (23 arquivos)

1. `code-tools.js` 2. `file/index.js` 3. `file/read-tools.js` 4. `file/shared.js`
2. `file/write-tools.js` 6. `git/index.js` 7. `git-tools.js` 8. `hook-tools.js`
3. `hub-tools.js` 10. `index.js` 11. `introspection-tools.js` 12. `permission-tools.js`
4. `session-rpc-tools.js` 14. `session-tools.js` 15. `shell/index.js` 16. `task-tools.js`
5. `todo/bulk-tools.js` 18. `todo/crud-tools.js` 19. `todo/index.js`
6. `todo/query-tools.js` 21. `todo/store.js` 22. `tool-factory.js` 23. `web-tools.js`

### observability/ (9 arquivos)

1. `agent-event-observer.js` 2. `audit-log.js` 3. `error-tracker.js`
2. `event-collector.js` 5. `hooks-audit-preset.js` 6. `index.js`
3. `logger.js` 8. `metrics.js` 9. `otel.js`

### hooks/ (18 arquivos)

1. `audit.js` 2. `bus.js` 3. `composer.js` 4. `error-handler.js`
2. `factory.js` 6. `index.js` 7. `permission-handler.js`
3. `presets/deny-all.js` 9. `presets/index.js` 10. `presets/interactive.js`
4. `presets/production.js` 12. `presets/safe.js` 13. `prompt-transformer.js`
5. `registry.js` 15. `session-lifecycle.js` 16. `tool-interceptor.js`
6. `types.js` 18. `user-input.js`

### terminal/ (27 arquivos)

1. `bootstrap.js` 2. `commands/alias.js` 3. `commands/attach.js`
2. `commands/config.js` 5. `commands/context.js` 6. `commands/gh.js`
3. `commands/git.js` 8. `commands/help.js` 9. `commands/index.js`
4. `commands/memory.js` 11. `commands/plan.js` 12. `commands/resume.js`
5. `commands/session.js` 14. `commands/skills.js` 15. `dialog.js`
6. `file-context.js` 17. `handlers-agent.js` 18. `handlers-dialog.js`
7. `handlers-shared.js` 20. `handlers-system.js` 21. `http-handlers.js`
8. `index.js` 23. `repl.js` 24. `route-table.js` 25. `server.js`
9. `state.js` 27. `workspace-context.js`

### conversation-hub/ (6 arquivos)

1. `hub.js` 2. `index.js` 3. `orchestrator.js`
2. `socket-ns.js` 5. `store.js` 6. `store-helpers.js`

### bridges/ (10 arquivos)

1. `alias-store.js` 2. `gh-bridge.js` 3. `gh/ci.js` 4. `gh/issues.js`
2. `gh/pr.js` 6. `gh/utils.js` 7. `git-bridge.js` 8. `index.js`
3. `mcp-tool-bridge.js` 10. `nerv-bridge.js`

### lib/ (12 arquivos)

1. `agents.js` 2. `event-helpers.js` 3. `hooks.js` 4. `http-request.js`
2. `index.js` 6. `models.js` 7. `permissions.js` 8. `sdk-client.js`
3. `session.js` 10. `tools-registry.js` 11. `url-validator.js` 12. `utils.js`

### routes/ (7 arquivos)

1. `agent.js` 2. `client.js` 3. `hooks.js` 4. `middleware.js`
2. `observability.js` 6. `sessions.js` 7. `webhooks.js`

### config/ (9 arquivos)

1. `custom-agents.js` 2. `index.js` 3. `mcp-servers.js`
2. `pinned-files-loader.js` 5. `session-config.js` 6. `system-prompt.js`
3. `tools/custom-tools.js` 8. `tools/index.js` 9. `tools/sdk-tools.js`

### channel/ (3 arquivos)

1. `client.js` 2. `index.js` 3. `inject.js`

### api/ (6 arquivos)

1. `bridge-control.js` 2. `bridge-dialog.js` 3. `bridge-stream.js`
2. `bridge-tasks.js` 5. `http-bridge.js` 6. `sdk-api.js`

### core/ (3 arquivos)

1. `constants.js` 2. `errors.js` 3. `index.js`

### types/ (3 arquivos)

1. `index.js` 2. `sdk.js` 3. `structured-message.js`

### db/ (2 arquivos)

1. `migrations.js` 2. `sqlite.js`

---

## 13. Critérios de Conclusão

A auditoria v2.0 está concluída quando:

- [ ] Todos os 160 arquivos relidos integralmente (MF-II)
- [ ] 160 MDs individuais gerados (1 por arquivo)
- [ ] 15 MDs consolidados gerados (1 por módulo)
- [ ] 7 MDs de integração cross-module gerados
- [ ] 1 MD de visão arquitetural global gerado
- [ ] `ISSUES-CONSOLIDATED.md` com todas as questões
- [ ] `ROADMAP-FIXES.md` priorizado
- [ ] `00-SUMMARY.md` atualizado
- [ ] Correções P0 implementadas e testadas
- [ ] Quality gates green após correções
- [ ] Commits incrementais para cada batch

---

## 14. Histórico de Versões

| Versão  | Data           | Mudanças                                                                                                                                                                                                                                                       |
| ------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-07-04     | Versão inicial — plano completo de auditoria                                                                                                                                                                                                                   |
| 1.1     | 2026-07-04     | Revisão crítica: fix counts, specs mapeados, seções 9-12                                                                                                                                                                                                       |
| 1.2     | 2026-07-04     | Visão arquitetural AS-IS/TO-BE (seções 3.5-3.6), delta de transformação                                                                                                                                                                                        |
| **2.0** | **2026-07-05** | **Reestruturação completa**: MDs por arquivo, templates exaustivos, MF-II com 13 fases (1/módulo), MF-III com 8 fases (7 fluxos + arquitetura), MF-IV com 6 fases, 31 fases totais, 294 subfases, ~186 artefatos MD. Metodologia "1 file read → 1 MD" adotada. |

**Changelog v2.0**:

- **Novidade**: Metodologia "1 arquivo lido → 1 MD criado" (seção 4)
- **Novidade**: 4 templates exaustivos padronizados (arquivo, módulo, integração, arquitetura)
- **Novidade**: MF-II expandida de 6 para 13 fases (1 fase por módulo)
- **Novidade**: MF-III expandida de 4 para 8 fases (7 fluxos + visão arquitetural)
- **Novidade**: MF-IV expandida de 2 para 6 fases (P0, P1, P2, upgrades, arch, quality gates)
- **Novidade**: Seção 4.4 com estrutura completa de diretórios de saída
- **Novidade**: R2 (MD imediato), R11 (pontuação obrigatória), R12 (releitura completa)
- **Novidade**: 2 novos fluxos de integração: Conversation Hub E2E, Segurança Transversal
- **Expandido**: Tabela de subfases com nome exato do MD gerado em cada subfase
- **Expandido**: Seção 7 (estimativa) atualizada para 31 fases, 294 subfases, ~186 MDs
- **Removido**: Seções 5-6 do v1.x (movidas e expandidas para dentro de cada fase)
- **Preservado**: Seções 1-3 (objetivos, tipologia, mapa estático, diagnóstico arquitetural)
