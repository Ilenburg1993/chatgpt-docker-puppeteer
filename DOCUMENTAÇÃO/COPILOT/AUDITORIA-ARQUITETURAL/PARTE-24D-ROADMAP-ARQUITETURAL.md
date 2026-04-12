# ROADMAP ARQUITETURAL — `src/copilot`

> **Documento**: PARTE-24D-ROADMAP-ARQUITETURAL.md
> **Versão**: 1.0
> **Data**: 2026-04-12
> **Escopo**: Roadmap detalhado de execução para transformar a arquitetura atual em ideal
> **Pré-requisito**: PARTE-24A, 24B, 24C
> **Faixas**: L39–L82 (continuação de L1–L38 do events schema system)

---

## 1. Visão Global

O roadmap está organizado em **6 Ondas** de execução, cada uma com **faixas** (`L39`–`L82`). Ondas são dependentes: cada onda só inicia após a anterior estar ≥80% completa.

```
ONDA 1 — FOUNDATION CLEANUP     (L39–L46)    ~800 LOC alteradas
ONDA 2 — AUTONOMY               (L47–L53)    ~1200 LOC alteradas
ONDA 3 — CYCLE ELIMINATION      (L54–L61)    ~1500 LOC alteradas
ONDA 4 — GOD MODULE DECOMP      (L62–L70)    ~2000 LOC alteradas
ONDA 5 — BOOT & WIRING          (L71–L76)    ~1000 LOC alteradas
ONDA 6 — TEST & POLISH          (L77–L82)    ~2500 LOC alteradas
```

---

## 2. ONDA 1 — Foundation Cleanup

> **Objetivo**: Remover lixo técnico, shims, duplicações e código legado. Base limpa para as ondas seguintes.

### L39 — Remover `core/events.js` (legado)

| Item             | Detalhe                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**        | Eliminar `core/events.js` (204 LOC) — constantes já migradas para `events/`                                                                                                     |
| **Por que**      | Duplicação. Consumidores atuais devem migrar para `events/index.js`                                                                                                             |
| **Subfases**     | 1. Grep por imports de `core/events` ou `#copilot/core/events`<br>2. Redirecionar imports para `#copilot/events`<br>3. Deletar `core/events.js`<br>4. Atualizar `core/index.js` |
| **Acceptance**   | Zero referências a `core/events`. ESLint + tests green                                                                                                                          |
| **Score impact** | core: 7→7.5                                                                                                                                                                     |

### L40 — Remover 5 shims de compatibilidade

| Item             | Detalhe                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**        | Deletar shims que apenas redirecionam via re-export                                                                                          |
| **Arquivos**     | `agent/infra/url-validator.js`, `sdk/url-validator.js`, `sdk/session-lifecycle.js`, `hooks/session-lifecycle.js`, `config/session-config.js` |
| **Subfases**     | 1. Para cada shim: grep consumidores<br>2. Atualizar imports para destino real<br>3. Deletar shim<br>4. Atualizar barrel se necessário       |
| **Acceptance**   | Zero shims restantes. Tests green                                                                                                            |
| **Score impact** | sdk: 8→8.2, hooks: 6→6.2                                                                                                                     |

### L41 — Adicionar JSDoc header a 13 arquivos

| Item             | Detalhe                                                                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**        | Adicionar `@file` JSDoc a arquivos >100 LOC sem descrição                                                                                                                                                        |
| **Arquivos**     | `always-alive.js`, `loop-manager.js`, `turn-executor.js`, `client.js`, `inject.js`, `orchestrator.js`, `socket-ns.js`, `event-collector.js`, `metrics.js`, `repl.js`, `server.js`, `state.js`, `file-context.js` |
| **Subfases**     | 1. Ler cada arquivo para entender responsabilidade<br>2. Escrever @file JSDoc de 2-3 linhas<br>3. Lint check                                                                                                     |
| **Acceptance**   | Todos os 13 arquivos com `@file` tag. Lint green                                                                                                                                                                 |
| **Score impact** | global docs: +0.3                                                                                                                                                                                                |

### L42 — Limpar referências a nerv-bridge.js

| Item           | Detalhe                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Remover menções a `nerv-bridge.js` de comentários e docs                                                                                            |
| **Subfases**   | 1. Grep por `nerv-bridge` excluindo PARTE-23L e PARTE-24*<br>2. Atualizar comentários referentes<br>3. Atualizar `nerv-event-bus-adapter.js` header |
| **Acceptance** | Zero menções a nerv-bridge em src/                                                                                                                  |

### L43 — Consolidar `core/constants.js` + `core/shared-state.js`

| Item           | Detalhe                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | `constants.js` (15 LOC) é trivial. `shared-state.js` (43 LOC) deve migrar para DI                                                                                                 |
| **Subfases**   | 1. Mover constantes de `constants.js` para `config/env.js` ou inline<br>2. Migrar `shared-state.js` para DI token (SHARED_STATE)<br>3. Atualizar consumidores<br>4. Deletar ambos |
| **Acceptance** | Zero imports de `core/constants` ou `core/shared-state`                                                                                                                           |

### L44 — Merge `core/abort-utils.js` em `core/retry.js`

| Item           | Detalhe                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | `abort-utils.js` (43 LOC) é utilitário de timeout. Pertence conceitualmente a `retry.js`                                           |
| **Subfases**   | 1. Copiar export de `abort-utils.js` para `retry.js`<br>2. Atualizar imports<br>3. Deletar `abort-utils.js`<br>4. Atualizar barrel |
| **Acceptance** | Zero imports de `core/abort-utils`. Tests green                                                                                    |

### L45 — Mover `core/create-emitter.js` para `events/`

| Item           | Detalhe                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Factory de emitters pertence ao módulo de eventos, não a core                                                                    |
| **Subfases**   | 1. Mover arquivo<br>2. Atualizar imports (#copilot/core/create-emitter → #copilot/events/create-emitter)<br>3. Atualizar barrels |
| **Acceptance** | Arquivo em events/. Zero imports da localização antiga                                                                           |

### L46 — Enxugar `di-tokens.js` (L0-only)

| Item             | Detalhe                                                                                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**        | Manter em `core/di-tokens.js` apenas tokens L0 (EVENT_BUS, LOGGER, CONFIG, SHUTDOWN). Tokens de L2+ migram para seus módulos                                                                                               |
| **Subfases**     | 1. Categorizar cada token por camada<br>2. Criar `sdk/di-tokens.js`, `hooks/di-tokens.js`, `agent/di-tokens.js`, etc.<br>3. Cada módulo importa e re-exporta seus tokens<br>4. `core/di-tokens.js` reduzido de 344→~50 LOC |
| **Acceptance**   | `core/di-tokens.js` <60 LOC. Cada módulo com seus tokens. Tests green                                                                                                                                                      |
| **Score impact** | core: 7.5→8                                                                                                                                                                                                                |

**Onda 1 — Critérios de conclusão**:
- Zero código legado/shims
- core/ sem deps de camadas superiores no token file
- All tests green + lint clean

---

## 3. ONDA 2 — Autonomy

> **Objetivo**: Eliminar as 2 dependências externas e garantir que src/copilot funcione como pacote autônomo.

### L47 — Internalizar JWT config

| Item           | Detalhe                                                                                                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Criar `config/auth.js` com JWT defaults. Eliminar import de `#core/jwt_config`                                                                                                                                                               |
| **Subfases**   | 1. Analisar o que `#core/jwt_config` exporta<br>2. Criar `config/auth.js` com defaults equivalentes<br>3. Registrar via DI token JWT_CONFIG<br>4. Atualizar `conversation-hub/socket-ns.js`<br>5. Permitir override via DI no boot do server |
| **Acceptance** | Zero imports de `#core/jwt_config` em src/copilot/. Tests green                                                                                                                                                                              |

### L48 — Internalizar DB path config

| Item           | Detalhe                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Eliminar import de `#core/config` em `db/sqlite.js`                                                                                                                       |
| **Subfases**   | 1. Adicionar `COPILOT_DB_PATH` a `config/env.js` com default<br>2. Atualizar `db/sqlite.js` para usar `config/env.js`<br>3. Verificar que default produz path equivalente |
| **Acceptance** | Zero imports de `#core/config` em src/copilot/. Tests green                                                                                                               |

### L49 — Criar `copilot/bootstrap.js` (entry point canônico)

| Item           | Detalhe                                                                                                                                                                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Entry point que inicializa DI, registra módulos, e inicia modo (terminal/server)                                                                                                                                                                                                                           |
| **Subfases**   | 1. Criar `src/copilot/bootstrap.js` com `bootCopilot({ mode })` export<br>2. Implementar `initContainer()` + registro sequential por camada<br>3. Implementar modo 'terminal' (invoca `terminal/index.js`)<br>4. Implementar modo 'server' (retorna bridge para Express)<br>5. Registrar graceful shutdown |
| **Acceptance** | `node --strip-types src/copilot/bootstrap.js` inicia terminal. Tests green                                                                                                                                                                                                                                 |

### L50 — Criar `terminal/bootstrap.js` (standalone)

| Item           | Detalhe                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **O que**      | Entry point minimal que chama `copilot/bootstrap.js` com mode='terminal'                                                                                                                         |
| **Subfases**   | 1. Criar arquivo com import de `../bootstrap.js`<br>2. `await bootCopilot({ mode: 'terminal' })`<br>3. Testar que `npm run terminal:llm-b` funciona<br>4. Atualizar `package.json` se necessário |
| **Acceptance** | `npm run terminal:llm-b` funciona end-to-end                                                                                                                                                     |

### L51 — Adaptar `server/main.js` para usar bootstrap

| Item           | Detalhe                                                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Server não importa módulos copilot diretamente — usa `bootCopilot({ mode: 'server' })`                                                                                              |
| **Subfases**   | 1. Substituir 5+ dynamic imports por `bootCopilot({ mode: 'server', express: app })`<br>2. Bridge retorna handlers registrados no DI<br>3. Manter backward compat durante transição |
| **Acceptance** | Server inicia normalmente. Rotas /api/copilot/* functam. Tests green                                                                                                                |

### L52 — Mover package.json imports para src/copilot

| Item           | Detalhe                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Validar que todos os `#copilot/*` aliases apontam corretamente dentro de `src/copilot/`                                                                                         |
| **Subfases**   | 1. Listar todos os subpath imports com `#copilot/` em `package.json`<br>2. Verificar que cada alias resolve para `src/copilot/...`<br>3. Adicionar aliases faltando (se houver) |
| **Acceptance** | Todos os `#copilot/*` aliases consistentes                                                                                                                                      |

### L53 — Smoke test de autonomia

| Item             | Detalhe                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **O que**        | Criar teste de integração que verifica zero imports externos                                                                                                       |
| **Subfases**     | 1. Script que analisa `import` statements em src/copilot/<br>2. Rejeita qualquer import que não seja: node built-in, npm dep, ou `#copilot/*`<br>3. Integrar no CI |
| **Acceptance**   | Script retorna exit 0. Nenhum import externo detectado                                                                                                             |
| **Score impact** | db: 5→7, conversation-hub: 5→6.5                                                                                                                                   |

**Onda 2 — Critérios de conclusão**:
- Zero dependências externas
- Boot standalone funcional (terminal e server)
- Teste de autonomia no CI

---

## 4. ONDA 3 — Cycle Elimination

> **Objetivo**: Eliminar os 4 ciclos bidirecionais e todas as violações de camada.

### L54 — Quebrar ciclo `core ↔ config` via DI

| Item           | Detalhe                                                                                                                                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | `core/` define IConfigProvider interface. `config/` implementa e registra via DI                                                                                                                                                                                      |
| **Subfases**   | 1. Criar `types/config.js` com IConfigProvider typedef<br>2. Criar DI token CONFIG_PROVIDER em `core/di-tokens.js`<br>3. `config/module.js` registra implementation<br>4. Remover import direto core→config<br>5. Substituir por `container.resolve(CONFIG_PROVIDER)` |
| **Acceptance** | `core/` não importa `config/`. Nenhum ciclo resta neste par. Tests green                                                                                                                                                                                              |

### L55 — Quebrar ciclo `config ↔ observability` via EventBus

| Item           | Detalhe                                                                                                                                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Config não importa logger diretamente — usa DI ou EventBus                                                                                                                                                                                                                  |
| **Subfases**   | 1. Logger injetado via DI token LOGGER<br>2. `config/env.js` resolve LOGGER do container (não import direto)<br>3. `observability/bootstrap.js` registra LOGGER no container, não importa config diretamente<br>4. Config carregado ANTES de observability no boot sequence |
| **Acceptance** | Nenhum import config→observability ou observability→config fora do boot sequence                                                                                                                                                                                            |

### L56 — Quebrar ciclo `events ↔ observability` via extração dead-letter

| Item           | Detalhe                                                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Mover dead-letter tracking de `observability/event-catalog.js` para `events/dead-letter.js`                                                                                                                                   |
| **Subfases**   | 1. Criar `events/dead-letter.js` com `trackUnregistered()` e `getDeadLetters()`<br>2. EventBus chama dead-letter internamente<br>3. Remover import events→observability<br>4. Atualizar event-catalog para consumir de events |
| **Acceptance** | Zero imports events→observability. Tests green                                                                                                                                                                                |

### L57 — Quebrar ciclo `hooks ↔ observability` via DI

| Item           | Detalhe                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **O que**      | OTel facade via DI token. Hook bus consumido via EventBus                                                                                                                                                    |
| **Subfases**   | 1. Criar DI token OTEL_TRACER<br>2. `hooks/factory.js` resolve via DI, não import direto<br>3. `observability/` consome HookBus events via EventBus (HOOK_*)<br>4. Remover import direto observability→hooks |
| **Acceptance** | Zero ciclos bidirecionais no sistema. Verificar com cycle-analysis.mjs                                                                                                                                       |

### L58 — Eliminar violação `config → sdk` (L1→L2)

| Item           | Detalhe                                                                                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | `config/env.js` importa `sdk/constants.js` para model defaults                                                                                                                                  |
| **Subfases**   | 1. Extrair MODEL_DEFAULTS de sdk/constants para `config/defaults.js`<br>2. sdk/constants importa de config/defaults (L2→L1: válido)<br>3. config/env.js importa config/defaults (L1→L1: válido) |
| **Acceptance** | config/ não importa de sdk/                                                                                                                                                                     |

### L59 — Eliminar violação `audit → sdk` (L1→L2)

| Item           | Detalhe                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Promover audit para L2 (ou extrair tipo usado de sdk)                                                                                   |
| **Subfases**   | 1. Verificar o que audit importa de sdk<br>2. Se tipo: mover typedef para types/<br>3. Se implementação: usar DI ou mover audit para L2 |
| **Acceptance** | audit/ em L2 sem violação de camada                                                                                                     |

### L60 — Eliminar violação `observability → sdk/hooks` (L1→L2)

| Item           | Detalhe                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Já resolvido parcialmente em L55/L57. Confirmar que observability (agora L2) não viola camada                                                        |
| **Subfases**   | 1. Validar model de camada atualizado<br>2. Confirmar obs em L2 com deps apenas L0/L1<br>3. Se obs usa hooks (L2 peer): aceitar como peer dependency |
| **Acceptance** | Obs deps apenas de L0+L1 ou peers L2                                                                                                                 |

### L61 — Eliminar violação `hooks → tools` (L2→L3)

| Item             | Detalhe                                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**        | hooks/ depende de tools/ para inspeção de ferramentas                                                                                                           |
| **Subfases**     | 1. Verificar imports hooks→tools<br>2. Extrair interface IToolInspector para types/<br>3. tools/ implementa e registra via DI<br>4. hooks/ resolve via DI token |
| **Acceptance**   | hooks/ não importa de tools/. Layer model clean                                                                                                                 |
| **Score impact** | hooks: 6.2→7.5                                                                                                                                                  |

**Onda 3 — Critérios de conclusão**:
- Zero ciclos bidirecionais (verificado por script)
- Zero violações de camada
- Layer model de 6 camadas enforced

---

## 5. ONDA 4 — God Module Decomposition

> **Objetivo**: Decompor os 12 God Modules (>400 LOC com responsabilidade mista) em módulos coesos.

### L62 — Decompor `agent/always-alive.js` (745 LOC)

| Item           | Detalhe                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **O que**      | Quebrar em `agent-core.js`, `agent-bus.js`, `agent-state.js`                                                                                                                                                 |
| **Subfases**   | 1. Extrair bus wiring → `agent-bus.js`<br>2. Extrair state management → `agent-state.js`<br>3. Core mantém: constructor, sendMessage, pause/resume<br>4. always-alive.js torna-se barrel que re-exporta os 3 |
| **Acceptance** | Nenhum arquivo >350 LOC. Tests green                                                                                                                                                                         |

### L63 — Decompor `conversation-hub/store.js` (563 LOC)

| Item           | Detalhe                                                                                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Extrair CRUD base para `store-core.js`                                                                                                                                                                                     |
| **Subfases**   | 1. Mover init/close/ensureTable para `store-core.js`<br>2. Mover write ops para `store-writes.js` (novo)<br>3. `store.js` torna-se facade que compõe os sub-módulos<br>4. Testar que ConversationHub não percebe a mudança |
| **Acceptance** | store.js <200 LOC. Tests green                                                                                                                                                                                             |

### L64 — Decompor `channel/client.js` (508 LOC)

| Item           | Detalhe                                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Já parcialmente extraído (client-dialog, client-structured, client-history)                                                                     |
| **Subfases**   | 1. Extrair config/state → `client-state.js`<br>2. Extrair bridge logic → `client-bridge.js`<br>3. `client.js` mantém: connect, disconnect, send |
| **Acceptance** | client.js <250 LOC                                                                                                                              |

### L65 — Decompor `conversation-hub/socket-ns.js` (444 LOC)

| Item           | Detalhe                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Separar room management de broadcast e auth                                                                                                                |
| **Subfases**   | 1. Extrair auth/middleware → `socket-auth.js`<br>2. Extrair room management → `socket-rooms.js`<br>3. socket-ns.js mantém namespace setup + event handlers |
| **Acceptance** | socket-ns.js <200 LOC                                                                                                                                      |

### L66 — Decompor `bridges/mcp-tool-bridge.js` (428 LOC)

| Item           | Detalhe                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Separar registro de tools, auto-reconnect, e status                                                                                                        |
| **Subfases**   | 1. Extrair reconnect logic → `mcp-reconnect.js`<br>2. Extrair tool conversion → `mcp-tool-converter.js`<br>3. Bridge mantém: connect, register, disconnect |
| **Acceptance** | mcp-tool-bridge.js <200 LOC                                                                                                                                |

### L67 — Decompor `hooks/factory.js` (418 LOC)

| Item           | Detalhe                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------- |
| **O que**      | Factory de 6 hooks: cada hook slot em arquivo próprio                                             |
| **Subfases**   | 1. Criar `factory/permission.js`, `factory/tool-use.js`, etc.<br>2. `factory.js` importa e compõe |
| **Acceptance** | factory.js <150 LOC                                                                               |

### L68 — Decompor `terminal/repl.js` (422 LOC) + `server.js` (396 LOC)

| Item           | Detalhe                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | REPL: separar input loop de rendering. Server: separar criação de middleware                                                      |
| **Subfases**   | 1. `repl.js` → `repl-core.js` + `repl-renderer.js`<br>2. `server.js` → `http-server.js` + `middleware.js`<br>3. Atualizar imports |
| **Acceptance** | Nenhum arquivo >250 LOC                                                                                                           |

### L69 — Decompor `conversation-hub/orchestrator.js` (410 LOC) e `channel/inject.js` (402 LOC)

| Item           | Detalhe                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Orchestrator: separar routing de execution. Inject: separar parsing de dispatch                                                              |
| **Subfases**   | 1. orchestrator: `orch-router.js` + `orch-executor.js`<br>2. inject: `inject-parser.js` + `inject-dispatch.js`<br>3. Testar flows end-to-end |
| **Acceptance** | Nenhum arquivo >250 LOC                                                                                                                      |

### L70 — Barrels e sdk/index.js cleanup

| Item             | Detalhe                                                                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**        | Reescrever barrels problemáticos (tools, channel, services, sdk)                                                                                                                                                            |
| **Subfases**     | 1. `tools/index.js`: definir API pública clara<br>2. `channel/index.js`: remover dynamic import hack<br>3. `services/index.js`: remover re-exports de outros módulos<br>4. `sdk/index.js`: organizar em seções com comments |
| **Acceptance**   | Todos barrels com exports claros e documentados                                                                                                                                                                             |
| **Score impact** | global: +0.5                                                                                                                                                                                                                |

**Onda 4 — Critérios de conclusão**:
- Zero God Modules (>400 LOC com múltiplas responsabilidades)
- Todos barrels limpos
- Tests green em todos os módulos afetados

---

## 6. ONDA 5 — Boot & Wiring

> **Objetivo**: Implementar DI Module pattern e boot sequence canônico.

### L71 — Implementar DI Module pattern

| Item           | Detalhe                                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Cada módulo L1+ ganha `module.js` com `registerXxxModule(container)`                                                                                                 |
| **Subfases**   | 1. Criar pattern base (template)<br>2. Implementar para L1: config, db<br>3. Implementar para L2: sdk, hooks, observability, audit<br>4. Testar registro e resolução |
| **Acceptance** | Cada módulo registrável isoladamente. Tests green                                                                                                                    |

### L72 — Wire bootstrap.js com Module pattern

| Item           | Detalhe                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | `bootstrap.js` chama registerXxxModule em sequência de camada                                                                                                  |
| **Subfases**   | 1. Atualizar bootstrap.js para usar Module pattern<br>2. Garantir ordem: L0→L1→L2→L3→L4→L5<br>3. Lazy resolution (factory executadas no resolve, não registro) |
| **Acceptance** | Boot funcional via bootstrap.js                                                                                                                                |

### L73 — Migrar `observability/bootstrap.js` para Module pattern

| Item           | Detalhe                                                                                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Eliminar o hack de injeção via setters que obs/bootstrap.js faz em core/                                                                                                                                          |
| **Subfases**   | 1. `registerObservabilityModule()` registra LOGGER, METRICS, ERROR_TRACKER via DI<br>2. Consumidores resolvem via `container.resolve()`<br>3. Deletar `observability/bootstrap.js`<br>4. Deletar setters em core/ |
| **Acceptance** | obs/bootstrap.js removido. Injeção 100% via DI                                                                                                                                                                    |

### L74 — Consolidar `observability/bus-actions/` + `event-bus-observers.js`

| Item           | Detalhe                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **O que**      | `event-bus-observers.js` (224 LOC) duplica funcionalidade de `bus-actions/`                                                                                                          |
| **Subfases**   | 1. Comparar subscribers: identificar duplicação<br>2. Mover funcionalidade única para bus-actions/<br>3. Deletar event-bus-observers.js<br>4. Renomear pasta para `bus-subscribers/` |
| **Acceptance** | Zero duplicação. Pasta renomeada                                                                                                                                                     |

### L75 — Mover `observability/observers/` para `agent/observers/`

| Item           | Detalhe                                                                           |
| -------------- | --------------------------------------------------------------------------------- |
| **O que**      | Handlers de eventos do agent pertencem ao módulo agent, não observability         |
| **Subfases**   | 1. Mover 5 arquivos<br>2. Atualizar imports<br>3. Atualizar agent/index.js barrel |
| **Acceptance** | observability/ sem pasta observers/. agent/ com observers/ integrada              |

### L76 — Smoke test do boot sequence

| Item             | Detalhe                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**        | Teste de integração que verifica boot→ready em <5s                                                                                                                                    |
| **Subfases**     | 1. Criar test que invoca `bootCopilot({ mode: 'test' })`<br>2. Verificar que todos DI tokens resolvem<br>3. Verificar que EventBus está operacional<br>4. Verificar graceful shutdown |
| **Acceptance**   | Teste passa em CI. Boot <5s                                                                                                                                                           |
| **Score impact** | global: +0.8                                                                                                                                                                          |

**Onda 5 — Critérios de conclusão**:
- DI Module pattern em todos os módulos L1+
- Bootstrap sequence funcional e testada
- Zero hacks de injeção (setters eliminados)

---

## 7. ONDA 6 — Test & Polish

> **Objetivo**: Garantir cobertura de testes mínima, types conformance, e documentação.

### L77 — Testes para `services/` (0→6 testes)

| Item           | Detalhe                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| **O que**      | Criar testes unitários para session-service, audit-service, conversation-service, tool-service                    |
| **Subfases**   | 1. Mock DI container<br>2. Testar cada facade isoladamente<br>3. Mínimo 6 testes cobrindo happy path + error path |
| **Acceptance** | 6+ testes. Coverage >70% do módulo                                                                                |

### L78 — Testes para `plugins/` (0→4 testes)

| Item           | Detalhe                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Testar plugin-registry: register, discover, activate, deactivate                                                                 |
| **Subfases**   | 1. Mock plugin interface<br>2. Test register + discover cycle<br>3. Test activate + deactivate<br>4. Test duplicate registration |
| **Acceptance** | 4+ testes. Coverage >80%                                                                                                         |

### L79 — Testes para `types/` (0→3 testes)

| Item           | Detalhe                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------- |
| **O que**      | Testar que re-exports estão acessíveis e tipos são válidos                                  |
| **Subfases**   | 1. Test import de cada export<br>2. Test BaseEvent schema<br>3. Test DI primitives exported |
| **Acceptance** | 3+ testes. Imports verificados                                                              |

### L80 — Aumentar cobertura `agent/` (2→15 testes)

| Item           | Detalhe                                                                                                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Após decomposição (L62), testar agent-core, agent-bus, agent-state, dialog, lifecycle                                                                                                                                                        |
| **Subfases**   | 1. Tests para agent-core: sendMessage, pause, resume<br>2. Tests para agent-bus: event emission<br>3. Tests para agent-state: snapshot, restore<br>4. Tests para dialog: loop-manager, turn-executor<br>5. Tests para lifecycle: start, stop |
| **Acceptance** | 15+ testes. Coverage >65%                                                                                                                                                                                                                    |

### L81 — TypeCheck strict em todos os módulos

| Item           | Detalhe                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | `npx tsc --project tsconfig.strict.json` com 0 errors                                                                        |
| **Subfases**   | 1. Rodar typecheck strict<br>2. Corrigir erros por módulo (prioridade P0→P3)<br>3. Garantir `@ts-check` em 100% dos arquivos |
| **Acceptance** | 0 errors em strict mode                                                                                                      |

### L82 — Score final e relatório

| Item           | Detalhe                                                                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O que**      | Recalcular scores, gerar relatório final, atualizar docs                                                                                                                                                 |
| **Subfases**   | 1. Re-executar cycle-analysis.mjs → 0 ciclos<br>2. Re-executar dep-graph.mjs → grafo acíclico<br>3. Recalcular score por módulo<br>4. Gerar PARTE-24E-RELATORIO-FINAL.md<br>5. Atualizar ARCHITECTURE.md |
| **Acceptance** | Score global ≥8.5. Zero ciclos. Zero deps externas                                                                                                                                                       |

**Onda 6 — Critérios de conclusão**:
- Nenhum módulo com 0 testes
- TypeCheck strict 0 erros
- Score global ≥8.5/10

---

## 8. Tabela Resumo de Faixas

| Faixa | Nome                                 | Onda | Prioridade | Módulos Afetados              |
| ----- | ------------------------------------ | ---- | ---------- | ----------------------------- |
| L39   | Remover core/events.js legado        | 1    | P0         | core, events                  |
| L40   | Remover 5 shims de compat            | 1    | P1         | agent, sdk, hooks, config     |
| L41   | JSDoc em 13 arquivos                 | 1    | P2         | multi                         |
| L42   | Limpar refs nerv-bridge              | 1    | P2         | bridges                       |
| L43   | Consolidar constants + shared-state  | 1    | P1         | core, config                  |
| L44   | Merge abort-utils em retry           | 1    | P2         | core                          |
| L45   | Mover create-emitter para events/    | 1    | P2         | core, events                  |
| L46   | Enxugar di-tokens (L0-only)          | 1    | P0         | core, sdk, hooks, agent       |
| L47   | Internalizar JWT config              | 2    | P0         | config, conversation-hub      |
| L48   | Internalizar DB path config          | 2    | P0         | config, db                    |
| L49   | Criar bootstrap.js canônico          | 2    | P0         | copilot root                  |
| L50   | Criar terminal/bootstrap.js          | 2    | P0         | terminal                      |
| L51   | Adaptar server para bootstrap        | 2    | P1         | server                        |
| L52   | Validar aliases #copilot/*           | 2    | P1         | package.json                  |
| L53   | Smoke test de autonomia              | 2    | P0         | tests/                        |
| L54   | Quebrar ciclo core↔config            | 3    | P0         | core, config, types           |
| L55   | Quebrar ciclo config↔observability   | 3    | P0         | config, observability         |
| L56   | Quebrar ciclo events↔observability   | 3    | P0         | events, observability         |
| L57   | Quebrar ciclo hooks↔observability    | 3    | P0         | hooks, observability          |
| L58   | Eliminar violação config→sdk         | 3    | P1         | config, sdk                   |
| L59   | Eliminar violação audit→sdk          | 3    | P1         | audit, types                  |
| L60   | Confirmar obs em L2                  | 3    | P2         | observability                 |
| L61   | Eliminar violação hooks→tools        | 3    | P1         | hooks, tools, types           |
| L62   | Decompor always-alive.js             | 4    | P0         | agent                         |
| L63   | Decompor store.js                    | 4    | P1         | conversation-hub              |
| L64   | Decompor client.js                   | 4    | P1         | channel                       |
| L65   | Decompor socket-ns.js                | 4    | P1         | conversation-hub              |
| L66   | Decompor mcp-tool-bridge.js          | 4    | P1         | bridges                       |
| L67   | Decompor factory.js                  | 4    | P1         | hooks                         |
| L68   | Decompor repl.js + server.js         | 4    | P1         | terminal                      |
| L69   | Decompor orchestrator.js + inject.js | 4    | P2         | conversation-hub, channel     |
| L70   | Barrel cleanup                       | 4    | P2         | tools, channel, services, sdk |
| L71   | DI Module pattern                    | 5    | P0         | multi                         |
| L72   | Wire bootstrap com Modules           | 5    | P0         | bootstrap                     |
| L73   | Migrar obs/bootstrap.js              | 5    | P0         | observability, core           |
| L74   | Consolidar bus-actions               | 5    | P1         | observability                 |
| L75   | Mover observers para agent           | 5    | P1         | observability, agent          |
| L76   | Smoke test boot sequence             | 5    | P0         | tests/                        |
| L77   | Testes services/                     | 6    | P1         | services                      |
| L78   | Testes plugins/                      | 6    | P1         | plugins                       |
| L79   | Testes types/                        | 6    | P2         | types                         |
| L80   | Testes agent/ (15+)                  | 6    | P0         | agent                         |
| L81   | TypeCheck strict 0 erros             | 6    | P0         | multi                         |
| L82   | Score final + relatório              | 6    | P0         | docs                          |

---

## 9. Diagrama de Dependências entre Ondas

```
ONDA 1: Foundation Cleanup
    │
    ▼
ONDA 2: Autonomy
    │
    ▼
ONDA 3: Cycle Elimination
    │
    ├──────────────────┐
    ▼                  ▼
ONDA 4: God Modules   ONDA 5: Boot & Wiring
    │                  │
    └────────┬─────────┘
             ▼
      ONDA 6: Test & Polish
```

> Ondas 4 e 5 podem ser parcialmente paralelas. Onda 6 depende de ambas.

---

## 10. Score Projetado por Onda

| Métrica                   | Atual | Pós-O1 | Pós-O2 | Pós-O3 | Pós-O4 | Pós-O5 | Pós-O6  |
| ------------------------- | ----- | ------ | ------ | ------ | ------ | ------ | ------- |
| Ciclos bidirecionais      | 4     | 4      | 4      | **0**  | 0      | 0      | 0       |
| Violações de camada       | 7     | 7      | 5      | **0**  | 0      | 0      | 0       |
| Deps externas             | 2     | 2      | **0**  | 0      | 0      | 0      | 0       |
| God Modules (>400 LOC)    | 12    | 11     | 11     | 11     | **0**  | 0      | 0       |
| Módulos com 0 testes      | 3     | 3      | 3      | 3      | 3      | 3      | **0**   |
| Shims sem deadline        | 5     | **0**  | 0      | 0      | 0      | 0      | 0       |
| Arquivos sem JSDoc (>100) | 13    | **0**  | 0      | 0      | 0      | 0      | 0       |
| Boot standalone           | ❌     | ❌      | **✅**  | ✅      | ✅      | ✅      | ✅       |
| **Score Global**          | 5.9   | 6.3    | 6.8    | 7.5    | 7.9    | 8.2    | **8.7** |

---

## 11. Changelog

| Versão | Data       | Mudanças                              |
| ------ | ---------- | ------------------------------------- |
| 1.0    | 2026-04-12 | Roadmap completo — 6 ondas, 44 faixas |
