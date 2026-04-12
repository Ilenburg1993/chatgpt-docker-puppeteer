# PRÉ-AUDITORIA ARQUITETURAL PROFUNDA — `src/copilot`

> **Documento**: PARTE-24A-PRE-AUDITORIA-ARQUITETURAL.md
> **Versão**: 1.0
> **Data**: 2026-04-12
> **Escopo**: Planejamento completo da auditoria arquitetural profunda de `src/copilot/`
> **Status**: EM EXECUÇÃO

---

## 1. Objetivo

Realizar uma auditoria arquitetural **profunda e exaustiva** de `src/copilot/`, cobrindo:

1. **Inventário completo** — função de cada pasta, subpasta e arquivo
2. **Grafos de dependência** — inter-módulo, ciclos, violações de camada
3. **Análise de boot** — como o sistema inicia, dependências externas, autonomia
4. **Contratos e tipagem** — cobertura JSDoc, schemas, tipos
5. **Qualidade estrutural** — duplicação, coesão, acoplamento, SRP
6. **Testes** — cobertura por módulo, gaps
7. **Observabilidade** — logs, métricas, traces, dead letters
8. **Segurança** — validação, sanitização, permissões

---

## 2. Inventário Global

| Métrica                | Valor  |
| ---------------------- | ------ |
| Arquivos `.js`         | 345    |
| Linhas de código (LOC) | 57.841 |
| Diretórios             | 52     |
| Barrels (`index.js`)   | 43     |
| Módulos top-level      | 18     |
| Arquivos de teste      | 224    |
| LOC de teste           | 43.474 |
| Ratio teste/prod       | 0.75:1 |

### 2.1. Módulos por tamanho (LOC)

| Módulo           | Arquivos | LOC        | % Total  |
| ---------------- | -------- | ---------- | -------- |
| agent            | 57       | 8.274      | 14.3%    |
| sdk              | 42       | 7.875      | 13.6%    |
| terminal         | 47       | 7.753      | 13.4%    |
| tools            | 28       | 6.352      | 11.0%    |
| observability    | 31       | 5.645      | 9.8%     |
| hooks            | 21       | 3.788      | 6.5%     |
| api              | 21       | 3.348      | 5.8%     |
| core             | 23       | 3.301      | 5.7%     |
| conversation-hub | 12       | 2.589      | 4.5%     |
| bridges          | 12       | 2.142      | 3.7%     |
| events           | 17       | 2.109      | 3.6%     |
| channel          | 7        | 1.416      | 2.4%     |
| config           | 7        | 1.279      | 2.2%     |
| audit            | 8        | 884        | 1.5%     |
| services         | 5        | 537        | 0.9%     |
| db               | 3        | 442        | 0.8%     |
| plugins          | 2        | 257        | 0.4%     |
| types            | 2        | 195        | 0.3%     |
| **TOTAL**        | **345**  | **57.841** | **100%** |

---

## 3. Grafos de Dependência Inter-Módulo

### 3.1. Grafo completo (A → B = A depende de B)

```
agent         → audit, bridges, config, conversation-hub, core, events, hooks, observability, plugins, sdk, tools
api           → bridges, config, core, hooks, observability, services
audit         → core, events, sdk
bridges       → config, core, events, observability, sdk
channel       → *, config, core, events, observability
config        → core, observability, sdk
conversation-hub → channel, config, core, db, events, observability
core          → config, events
db            → core
events        → observability, types
hooks         → audit, config, core, events, observability, sdk, tools
observability → audit, config, core, db, events, hooks, sdk
plugins       → observability
sdk           → core
services      → agent, audit, channel, conversation-hub, core, events, observability, sdk, tools
terminal      → agent, api, audit, bridges, channel, config, conversation-hub, core, events, observability, sdk, services, tools
tools         → audit, config, core, db, observability, sdk
types         → core
```

### 3.2. Dependências Bidirecionais (Ciclos Diretos)

| Par                      | Gravidade |
| ------------------------ | --------- |
| `config ↔ core`          | 🔴 ALTA    |
| `config ↔ observability` | 🔴 ALTA    |
| `events ↔ observability` | 🟡 MÉDIA   |
| `hooks ↔ observability`  | 🟡 MÉDIA   |

### 3.3. Ciclos Transitivos Principais

```
core → config → observability → events → types → core          (5 nós)
core → config → sdk → core                                     (3 nós)
observability → hooks → tools → observability                   (3 nós)
audit → core → config → observability → hooks → tools → audit  (6 nós)
```

### 3.4. Análise de Camadas (Layer Model)

```
L4 (Presentation)  : api, terminal
L3 (Application)   : agent, conversation-hub, tools, services
L2 (Domain)        : sdk, bridges, channel, hooks, plugins
L1 (Infrastructure): db, config, audit, observability
L0 (Foundation)    : types, events, core
```

#### Violações de camada detectadas:

| Módulo (camada)      | Depende de (camada)  | Violação |
| -------------------- | -------------------- | -------- |
| `core` (L0)          | `config` (L1)        | L0→L1    |
| `events` (L0)        | `observability` (L1) | L0→L1    |
| `config` (L1)        | `sdk` (L2)           | L1→L2    |
| `audit` (L1)         | `sdk` (L2)           | L1→L2    |
| `observability` (L1) | `sdk` (L2)           | L1→L2    |
| `observability` (L1) | `hooks` (L2)         | L1→L2    |
| `hooks` (L2)         | `tools` (L3)         | L2→L3    |

**Total: 7 violações de camada.**

---

## 4. Dependências Externas ao `src/copilot`

### 4.1. Imports de fora do workspace copilot

| Arquivo                         | Import             | Peso   |
| ------------------------------- | ------------------ | ------ |
| `conversation-hub/socket-ns.js` | `#core/jwt_config` | 🔴 ALTO |
| `db/sqlite.js`                  | `#core/config`     | 🔴 ALTO |

### 4.2. Quem importa `src/copilot` de fora

| Arquivo externo                        | Import                                    | Tipo       |
| -------------------------------------- | ----------------------------------------- | ---------- |
| `src/server/api/router.js`             | `../../copilot/api/bridge/index.js`       | Relative   |
| `src/server/api/router.js`             | `../../copilot/api/express/index.js`      | Relative   |
| `src/server/api/copilot-hub-router.js` | `#copilot/conversation-hub/hub`           | Alias      |
| `src/server/controllers/health.js`     | `#copilot/core`                           | Alias      |
| `src/server/main.js`                   | `#copilot/bridges`, `#copilot/core`, etc. | Alias (5+) |

**Conclusão**: `src/copilot` **NÃO é autônomo** — depende de `#core/jwt_config` e `#core/config` do workspace pai. E o workspace pai depende fortemente de `src/copilot`.

---

## 5. Análise de Boot

### 5.1. Caminho do Terminal (standalone)

```
npm run terminal:llm-b
  └→ node --strip-types src/copilot/terminal/bootstrap.js   ⚠️ ARQUIVO NÃO EXISTE!
```

**ACHADO CRÍTICO**: O npm script `terminal:llm-b` referencia `src/copilot/terminal/bootstrap.js` que **não existe no filesystem**. Isso significa que o terminal LLM-B **não pode ser iniciado via este script**.

### 5.2. Caminho via Server

```
src/server/main.js
  └→ await import('#copilot/core')               // DI container + EventBus
  └→ await import('#copilot/bridges/...')         // NervEventBusAdapter
  └→ await import('#copilot/events')              // Schema registration
  └→ await import('#copilot/agent/always-alive')  // Agent singleton
  └→ await import('#copilot/conversation-hub/hub') // Hub
```

### 5.3. Sequência de inicialização em `terminal/index.js`

1. `loadAliasesAsync()` — aliases customizados
2. `configureHookTools({ broadcastSse })` — injeção de dependência manual
3. DI container registration — HUB, PERMISSION_AGENT, etc.
4. `wireLegacySetters()` — setters legados para compat
5. `PinnedFilesLoader` — hot-reload de skills/instruções
6. `conversationHub.initStandalone()` — hub session
7. `registerAgentEventListeners()` — listeners
8. `startReflectionLoop()` — reflection periódica
9. `startTodoCleanupJob()` — limpeza de TODOs
10. Shutdown handlers — timers + inject server
11. `startRepl()` — REPL readline

---

## 6. Achados Críticos (Pré-Auditoria)

| #   | Achado                                           | Gravidade | Módulo          |
| --- | ------------------------------------------------ | --------- | --------------- |
| A1  | `bootstrap.js` faltando → terminal não inicia    | 🔴 CRÍTICO | terminal        |
| A2  | 4 ciclos bidirecionais de dependência            | 🔴 CRÍTICO | core/config/obs |
| A3  | 7 violações de camada (L0→L1, L1→L2, L2→L3)      | 🔴 ALTO    | cross-module    |
| A4  | 2 imports externos (`#core/*`) quebram autonomia | 🔴 ALTO    | db, conv-hub    |
| A5  | `.github/hooks/state/` dentro de src/copilot     | 🟡 MÉDIO   | .github         |
| A6  | `services/` re-exporta de `conversation-hub/`    | 🟡 MÉDIO   | services        |
| A7  | `channel/index.js` vazio (barrel sem exports)    | 🟡 MÉDIO   | channel         |
| A8  | `tools/index.js` sem exports explícitas          | 🟡 MÉDIO   | tools           |
| A9  | `agent` depende de 10 outros módulos             | 🟡 MÉDIO   | agent           |
| A10 | `terminal` depende de 13 módulos (quase todos)   | 🟡 MÉDIO   | terminal        |

---

## 7. Etapas da Auditoria

### Fase A — PRÉ-AUDITORIA (este documento) ✅
- Inventário global, grafos, achados iniciais
- Planejamento das próximas fases

### Fase B — ANÁLISE ATUAL (próximo documento)
**Arquivo**: `PARTE-24B-SITUACAO-ATUAL.md`

Conteúdo obrigatório:
1. **Mapa de cada módulo** — propósito, responsabilidades, arquivos, API pública
2. **Função de cada arquivo** — descrição em 1 linha de cada um dos 345 arquivos
3. **Contratos inter-módulo** — quais exports cada módulo expõe e quem consome
4. **Fluxos de dados** — request→response, emitter→bus, agent→sdk→api
5. **State management** — singletons, shared state, DI tokens
6. **Error handling** — padrões, propagação, tratamento
7. **Observabilidade** — logging, métricas, traces, dead letters
8. **Segurança** — URL validation, permissions, sanitização
9. **Score por módulo** — nota individual de cada módulo (1-10)

### Fase C — SITUAÇÃO IDEAL (documento separado)
**Arquivo**: `PARTE-24C-SITUACAO-IDEAL.md`

Conteúdo obrigatório:
1. **Arquitetura alvo** — camadas, módulos, fronteiras
2. **Eliminação de ciclos** — estratégia para cada ciclo
3. **Autonomia completa** — `src/copilot` como módulo auto-contido
4. **Boot system próprio** — bootstrap, lifecycle, health checks
5. **Contract-first design** — interfaces, schemas, tipos
6. **Observabilidade madura** — OpenTelemetry-like, structured logging
7. **Plugin architecture** — extensibilidade sem acoplamento
8. **Test architecture** — test pyramid, coverage targets
9. **Migration path** — como chegar do ATUAL ao IDEAL
10. **API pública estável** — versionamento, breaking changes

### Fase D — ROADMAP COMPLETO
**Arquivo**: `PARTE-24D-ROADMAP-ARQUITETURAL.md`

Conteúdo obrigatório:
1. **Ondas de execução** (4-6 ondas, cada uma com faixas)
2. **Faixas detalhadas** (L39+, cada uma com subfases)
3. **Dependências entre faixas**
4. **Critérios de aceitação** por faixa
5. **Priorização por risco/impacto**
6. **Score estimado por onda**
7. **Mapa de breaking changes**

---

## 8. Escopo de Análise por Módulo

### 8.1. Módulos a analisar em profundidade (Fase B)

| Módulo             | Prioridade | Razão                                     |
| ------------------ | ---------- | ----------------------------------------- |
| `core`             | P0         | Foundation layer, ciclo com config        |
| `events`           | P0         | Foundation layer, ciclo com observability |
| `types`            | P0         | Foundation layer, deps de core            |
| `config`           | P0         | Ciclos bidirecionais com core/obs         |
| `observability`    | P0         | Ciclos com events/hooks/config            |
| `agent`            | P1         | Maior módulo, 10 deps                     |
| `sdk`              | P1         | 7875 LOC, interface com LLMs              |
| `terminal`         | P1         | 13 deps, boot faltando                    |
| `tools`            | P1         | 6352 LOC, barrel vazio                    |
| `hooks`            | P1         | Ciclo com observability + tools           |
| `audit`            | P2         | Pequeno mas com dep de sdk                |
| `bridges`          | P2         | Interface com MCP, git, GH                |
| `channel`          | P2         | Barrel vazio                              |
| `conversation-hub` | P2         | Dep externa de `#core/jwt_config`         |
| `api`              | P2         | Presentation layer                        |
| `services`         | P2         | Re-exports questionáveis                  |
| `db`               | P3         | Dep externa de `#core/config`             |
| `plugins`          | P3         | Mínimo (257 LOC)                          |

---

## 9. Análise Profunda dos Grafos

### 9.1. Fan-out (módulos com mais dependências de saída)

```
terminal         → 13 módulos (87% do sistema)
agent            → 10 módulos (67%)
services         → 9 módulos (60%)
observability    → 7 módulos (47%)
hooks            → 7 módulos (47%)
conversation-hub → 6 módulos (40%)
tools            → 6 módulos (40%)
api              → 6 módulos (40%)
bridges          → 5 módulos (33%)
config           → 3 módulos (20%)
channel          → 4 módulos (27%)
core             → 2 módulos (13%)
events           → 2 módulos (13%)
audit            → 3 módulos (20%)
types            → 1 módulo  (7%)
sdk              → 1 módulo  (7%)
db               → 1 módulo  (7%)
plugins          → 1 módulo  (7%)
```

### 9.2. Fan-in (módulos mais usados/dependidos)

```
core             ← 14 módulos (93% do sistema depende dele)
events           ← 11 módulos (73%)
observability    ← 11 módulos (73%)
config           ← 8 módulos (53%)
sdk              ← 7 módulos (47%)
audit            ← 5 módulos (33%)
tools            ← 4 módulos (27%)
channel          ← 3 módulos (20%)
db               ← 3 módulos (20%)
bridges          ← 3 módulos (20%)
conversation-hub ← 3 módulos (20%)
hooks            ← 3 módulos (20%)
agent            ← 3 módulos (20%)
services         ← 2 módulos (13%)
types            ← 2 módulos (13%)
api              ← 2 módulos (13%)
plugins          ← 1 módulo  (7%)
```

### 9.3. Instabilidade Métrica (Fan-out / (Fan-in + Fan-out))

| Módulo          | Fan-in | Fan-out | Instabilidade | Categoria  |
| --------------- | ------ | ------- | ------------- | ---------- |
| `sdk`           | 7      | 1       | 0.13          | Estável ✅  |
| `core`          | 14     | 2       | 0.13          | Estável ✅  |
| `events`        | 11     | 2       | 0.15          | Estável ✅  |
| `db`            | 3      | 1       | 0.25          | Estável ✅  |
| `plugins`       | 1      | 1       | 0.50          | Neutro ⚠️   |
| `config`        | 8      | 3       | 0.27          | Estável ✅  |
| `observability` | 11     | 7       | 0.39          | Neutro ⚠️   |
| `audit`         | 5      | 3       | 0.38          | Neutro ⚠️   |
| `hooks`         | 3      | 7       | 0.70          | Instável 🔴 |
| `tools`         | 4      | 6       | 0.60          | Instável ⚠️ |
| `bridges`       | 3      | 5       | 0.63          | Instável ⚠️ |
| `terminal`      | 0      | 13      | 1.00          | Instável 🔴 |
| `services`      | 2      | 9       | 0.82          | Instável 🔴 |
| `agent`         | 3      | 10      | 0.77          | Instável 🔴 |

> Módulos L3/L4 (terminal, services, agent) DEVEM ser instáveis (dependem de muitos, poucos dependem deles) — isso é correto. O problema é quando módulos L0/L1/L2 são instáveis.

---

## 10. Testes — Cobertura por Módulo

| Módulo           | Arquivos Fonte | Testes Dedicados | Ratio | Score |
| ---------------- | -------------- | ---------------- | ----- | ----- |
| sdk              | 42             | 39               | 0.93  | ✅     |
| terminal         | 47             | 10               | 0.21  | 🔴     |
| observability    | 31             | 8                | 0.26  | 🟡     |
| tools            | 28             | 10               | 0.36  | 🟡     |
| conversation-hub | 12             | 6                | 0.50  | 🟡     |
| hooks            | 21             | 2                | 0.10  | 🔴     |
| bridges          | 12             | 4                | 0.33  | 🟡     |
| api              | 21             | 4                | 0.19  | 🔴     |
| events           | 17             | 2                | 0.12  | 🔴     |
| agent            | 57             | 2+~20*           | 0.39  | 🟡     |
| core             | 23             | ~10*             | 0.43  | 🟡     |
| config           | 7              | 1                | 0.14  | 🔴     |
| channel          | 7              | 2                | 0.29  | 🟡     |
| audit            | 8              | 1                | 0.13  | 🔴     |
| services         | 5              | 0                | 0.00  | 🔴     |
| db               | 3              | 1                | 0.33  | 🟡     |
| plugins          | 2              | 0                | 0.00  | 🔴     |
| types            | 2              | 0                | 0.00  | 🔴     |

> \* Vários testes de agent e core estão no nível raiz de tests/unit/copilot/ (não em pastas dedicadas)

---

## 11. Critérios de Avaliação para Fase B

Cada módulo receberá uma nota de 1-10 nos seguintes critérios:

| Critério           | Peso | Descrição                             |
| ------------------ | ---- | ------------------------------------- |
| **Coesão**         | 20%  | Responsabilidade única, foco claro    |
| **Acoplamento**    | 20%  | Fan-out controlado, deps mínimas      |
| **Tipagem**        | 15%  | JSDoc completo, tipos corretos        |
| **Testes**         | 15%  | Cobertura, robustez                   |
| **API Surface**    | 10%  | Barrel limpo, exports intencionais    |
| **Error Handling** | 10%  | Tratamento adequado, propagação clara |
| **Documentação**   | 5%   | README, JSDoc, inline comments        |
| **Segurança**      | 5%   | Validação de input, sanitização       |

---

## 12. Próximos Passos

```
AGORA  → Gerar PARTE-24B-SITUACAO-ATUAL.md (análise profunda, mapa de todos os 345 arquivos)
DEPOIS → Gerar PARTE-24C-SITUACAO-IDEAL.md (arquitetura alvo, mudanças radicais)
DEPOIS → Gerar PARTE-24D-ROADMAP-ARQUITETURAL.md (faixas L39+, ondas, subfases)
```

---

## 13. Changelog

| Versão | Data       | Mudanças                       |
| ------ | ---------- | ------------------------------ |
| 1.0    | 2026-04-12 | Pré-auditoria completa, grafos |
