# WORKSPACE — `src/copilot/core` — auditoria de extinção, estado-alvo e roadmap pós-Arquiteturas 1.0/2.0/2.1

**Data da auditoria:** 22 de agosto de 2026

**Workspace auditado:** `/workspaces/chatgpt-docker-puppeteer`

**Escopo primário:** `src/copilot/core/**`

**Escopo relacional:** `src/copilot/**`, `src/server/**`, `tests/**`, `scripts/**`, `tools/**`,
`package.json`, `config/architecture/**` e os documentos canônicos das Arquiteturas 1.0, 2.0 e 2.1.

**Estado Git antes da criação deste documento:** `main`, worktree limpo,
`HEAD = 6d8913e6498977b1f64022b7137ac6436297eee9`.

**Natureza original deste documento:** auditoria, arquitetura-alvo e plano de execução. A primeira
edição foi produzida antes da campanha de transformação e, por isso, preserva abaixo o diagnóstico
pré-execução como ledger histórico.

**Estado atual:** campanha executada e **FECHADA em 23 de agosto de 2026**. Os checkboxes
representam o estado pós-execução validado; o texto histórico não foi reescrito para fingir que Core
nunca existiu.

**Objetivo final obrigatório:** `src/copilot/core` deixa de existir fisicamente. O resultado não
pode ser um rename para `common`, `shared`, `foundation`, `kernel`, `core2` ou um novo mega-owner
horizontal. Cada responsabilidade deve ser absorvida, reescrita ou eliminada no owner semântico
correto.

---

## 0. Conclusão executiva

A auditoria confirma a premissa: `src/copilot/core` está **arquiteturalmente defasado em relação ao
restante do workspace** e, mais importante, a própria categoria “Core” perdeu utilidade como owner
físico.

A pasta não representa hoje uma camada L0 coerente. Ela reúne, no mesmo namespace:

- service locator e DI global;
- estado processual e de sessão;
- shutdown e timers;
- event bus;
- contratos de I/O;
- segurança de URL e redaction;
- retry/circuit breaker/mutex/cache;
- schemas de múltiplos domínios;
- contratos e políticas específicas de SDK e tools;
- protocolo de mensagens de channel/conversation;
- política de apresentação;
- introspecção de telemetria;
- classes de erro de múltiplos domínios.

A consequência é um **hub horizontal de dependências** que encobre ownership. A superfície
`#copilot/core` ainda é consumida amplamente, enquanto dezenas de consumidores atravessam
diretamente para `../core/...`, contornando inclusive a governança nominal dos aliases exatos.

A extinção, contudo, **não deve ser uma migração em massa de arquivos**. Vários componentes não
merecem sobreviver na forma atual. Há quatro classes distintas de trabalho:

1. **eliminar** primitives duplicadas ou sem owner real (`cache`, `mutex`, aliases de
   compatibilidade etc.);
2. **absorver** primitives válidas por owners já maduros (`io-contracts`, process policy, lifecycle,
   event runtime etc.);
3. **reescrever** componentes cuja semântica atual possui bugs ou viola os invariants 2.1 (DI,
   timers/shutdown, SSRF, redaction, tool permissions, shared state);
4. **decompor por domínio** arquivos-bag (`errors.js`, `schemas.js`, `interfaces.js`) sem criar
   outro arquivo-bag em destino diferente.

O roadmap proposto é, portanto, uma **campanha de extinção por ownership e correção semântica**, não
uma campanha de paths.

### 0.1 Achados de maior prioridade

Durante a auditoria foram causalmente demonstrados problemas que devem ser corrigidos durante a
extinção, e não apenas transportados:

- **CORE-P0-001 — permission fail-open:** decisão de tool desconhecida é normalizada como `allow`.
- **CORE-P0-002 — user-input policy adulterada:** `allowFreeform:false` é normalizado para `true`.
- **CORE-P0/P1-003 — SSRF fail-open:** falha de DNS em `checkResolvedIp()` retorna sem bloquear; a
  validação também não fixa a resolução usada pela conexão, preservando uma janela de DNS
  rebinding/TOCTOU.
- **CORE-P1-004 — timer registry inconsistente:** timeout já disparado continua listado como ativo.
- **CORE-P1-005 — Promise permanentemente pendente:** `cancelAll()` pode cancelar o timer interno de
  `sleepMs()` sem resolver/rejeitar a Promise.
- **CORE-P1-006 — shutdown não encerra trabalho expirado:** handler que estoura timeout continua
  executando depois de `runShutdown()` concluir.
- **CORE-P1-007 — DI scoped quebrado:** registro `scoped` no parent não é cacheado no child; duas
  resoluções no mesmo child produziram duas instâncias.
- **CORE-P1-008 — redaction não bounded:** objeto cíclico produz
  `RangeError: Maximum call stack size exceeded`.
- **CORE-P1/P2-009 — retry listener leak:** listeners de abort permanecem anexados após delays
  concluídos.
- **CORE-P2-010 — safe JSON viola contrato:** `safeJsonStringify(undefined)` retorna `undefined`
  apesar de declarar `string`.
- **CORE-P1/P2-011 — elicitation validation inconsistente:** `oneOf` é tratado como `anyOf`; default
  inválido pode escapar quando não há content; `2026-02-31` é aceito como `date`.

Esses achados são detalhados adiante com evidência, impacto, owner proposto e gate de correção.

---

## 1. Metodologia

A auditoria foi executada com o repositório limpo e sem alterações de código.

### 1.1 Leitura integral

Foram lidos integralmente **todos os 34 itens físicos** de `src/copilot/core`:

- **33 arquivos JavaScript**;
- **1 README**;
- aproximadamente **6.073 linhas JavaScript**;
- aproximadamente **212 KiB de fonte JavaScript**.

Não houve amostragem de Core.

### 1.2 Evidência relacional

Além da leitura integral, foram executados:

- inventário de `package.json#imports` relacionado a Core;
- leitura de `config/architecture/copilot-core-import-boundaries.json`;
- análise parser-based de usos `#copilot/core*` em `src`, `tests`, `scripts` e `tools`;
- inventário de imports relativos que atravessam diretamente para `core`;
- fan-in por domínio de produção;
- inventário de símbolos importados do mega-root `#copilot/core`;
- leitura dos owners candidatos já existentes em Infra, Events, SDK, Tools e Presentation;
- leitura dos documentos canônicos das Arquiteturas 1.0, 2.0 e 2.1;
- probes causais, somente em memória/processo, para bugs cuja confirmação era barata e segura.

### 1.3 Regra metodológica

O documento separa:

- **DEMONSTRADO** — comportamento reproduzido causalmente;
- **ESTÁTICO** — defeito/risco comprovável por leitura do contrato e fluxo;
- **HIPÓTESE FORTE** — risco plausível que exige teste dirigido durante a fase de implementação.

Uma suspeita falsificada não é mantida como bug. Exemplo: a hipótese inicial de que todo default
inválido de elicitation escaparia foi refinada; o escape existe especificamente no caminho sem
`content`, enquanto o caminho com objeto presente revalida o default.

---

## 2. Invariants herdados das Arquiteturas 1.0, 2.0 e 2.1

A extinção de Core não autoriza regressão dos invariants já conquistados.

### 2.1 Fundação 1.0

A Arquitetura 1.0 consolidou cinco regras que permanecem mandatórias:

1. **unidirecionalidade absoluta:** dependências constituem DAG; JSDoc/type-only também conta como
   aresta;
2. **ownership físico:** componente privado vive sob seu owner real;
3. **barrel/entrypoint como fronteira deliberada:** cross-folder não atravessa implementação
   arbitrária;
4. **coesão acima de tamanho:** LOC é sinal, não justificativa automática de split;
5. **membrane pública explícita para Infra:** external consumers não atravessam internals.

### 2.2 Refinamentos 2.0

A 2.0 elevou a exigência:

- entrypoint é fronteira de **visibilidade, autoridade e custo**;
- lifecycle deve ser classificado em **Process / Runtime / Workspace / Operation**;
- authority deve ser capability verificável, não convenção de caller;
- estado ambiental deve virar snapshot de config no owner correto;
- health deve consumir snapshots/probes, não importar arbitrariamente implementações;
- global mutable state deve ter owner e rationale explícitos;
- persistence/filesystem devem obedecer least privilege.

### 2.3 Fechamentos 2.1

A 2.1 tornou esses princípios mais rígidos:

- ProcessInfra real no composition root;
- config hierarchy fechada;
- rollback provenance autenticada;
- observability scoped;
- exact semantic package entrypoints;
- audiences runtime/composition/diagnostic/test separadas;
- sem marker barrels e aliases “para algum dia”;
- package map sem wildcards;
- dependency graph sem ciclos/unresolved;
- public APIs governadas por authority/cost/lifecycle/stability;
- nenhuma dívida de compatibilidade deve sobreviver sem necessidade explícita e documentada.

### 2.4 Consequência para Core

O objetivo **não** é fazer `core/* → infra/*`.

A regra é:

> cada símbolo de Core deve provar seu owner semântico, seu scope e sua necessidade de existência.
> Se não provar, desaparece.

E:

> nenhum novo namespace horizontal pode assumir o papel de Core.

---

## 3. Baseline quantitativo e grafo atual

### 3.1 Superfície física

| métrica                                            |         estado auditado |
| -------------------------------------------------- | ----------------------: |
| itens físicos em `src/copilot/core`                |                      34 |
| JavaScript                                         |                      33 |
| README                                             |                       1 |
| linhas JS                                          |                  ~6.073 |
| bytes JS                                           |                ~212.133 |
| aliases `#copilot/core*` declarados                |                      19 |
| usos `#copilot/core*` em `src/tests/scripts/tools` |                     337 |
| aliases Core usados no inventário parser-based     |                      19 |
| arquivos que usam o mega-root `#copilot/core`      | 147 no inventário amplo |
| arquivos com static import do mega-root            |                     119 |

### 3.2 Fan-in por domínio de produção

A análise de imports estáticos para Core, incluindo aliases e traversals relativos, encontrou:

| domínio             | imports para Core | arquivos consumidores |
| ------------------- | ----------------: | --------------------: |
| `agent`             |                52 |                    51 |
| `terminal`          |                51 |                    38 |
| `infra`             |                36 |                    35 |
| `sdk`               |                31 |                    22 |
| `observability`     |                26 |                    16 |
| `tools`             |                24 |                    24 |
| `server`            |                23 |                    19 |
| `presentation`      |                17 |                    17 |
| `conversation-hub`  |                 9 |                     7 |
| `bridges`           |                 6 |                     6 |
| `channel`           |                 6 |                     4 |
| `audit`             |                 5 |                     4 |
| `boot`              |                 4 |                     3 |
| `types`             |                 4 |                     1 |
| `config`            |                 3 |                     3 |
| `hooks`             |                 3 |                     3 |
| `model-gateway`     |                 3 |                     3 |
| `runtime-wiring.js` |                 3 |                     1 |
| `event-handlers`    |                 1 |                     1 |
| `plugins`           |                 1 |                     1 |

Isso elimina a possibilidade de uma remoção “big bang” segura do root. É necessário reduzir fan-in
semanticamente por ondas.

### 3.3 Símbolos mais consumidos do mega-root

Entre imports estáticos de `#copilot/core`:

| símbolo                         | arquivos aproximados |
| ------------------------------- | -------------------: |
| `toError`                       |                   47 |
| `container`                     |                   23 |
| `SessionError`                  |                   17 |
| `logSwallowed`                  |                   13 |
| `registerInterval`              |                   13 |
| `cancelTimer`                   |                   12 |
| `sleepMs`                       |                   11 |
| `redactSecretRecord`            |                   10 |
| `redactSecretText`              |                   10 |
| `ConfigError`                   |                    7 |
| `resolveModelSelectionMismatch` |                    7 |
| `EVENT_BUS`                     |                    6 |
| `bridgeEmitter`                 |                    5 |
| `getSharedSdkSessionId`         |                    5 |
| `registerShutdownHandler`       |                    5 |
| `SHUTDOWN_PRIORITY`             |                    5 |
| `withIoMeta`                    |                    5 |

O root não é só conveniência nominal: ele é uma dependência transversal real.

### 3.4 Aliases declarados

O package map contém hoje:

```text
#copilot/core
#copilot/core/circuit-breaker
#copilot/core/di
#copilot/core/di-tokens
#copilot/core/elicitation-schema
#copilot/core/error-codes
#copilot/core/error-handlers
#copilot/core/errors
#copilot/core/event-bus
#copilot/core/interfaces
#copilot/core/io-contracts
#copilot/core/io-policy
#copilot/core/process-policy
#copilot/core/safe-json
#copilot/core/schemas
#copilot/core/security/url-validator
#copilot/core/shutdown
#copilot/core/structured-message
#copilot/core/tool-contracts
```

`config/architecture/copilot-core-import-boundaries.json` governa parte dessa superfície. Porém, a
governança é incompleta enquanto consumers puderem fazer traversals relativos para `../core/...`.

### 3.5 Grafo conceitual atual

```mermaid
graph TD
    A[Agent] --> C[Core mega-root / leaves]
    T[Terminal] --> C
    I[Infra] --> C
    S[SDK] --> C
    O[Observability] --> C
    TL[Tools] --> C
    SV[Server] --> C
    P[Presentation] --> C
    H[Conversation Hub] --> C
    B[Bridges] --> C
    CH[Channel] --> C
    AU[Audit] --> C
    BOOT[Boot] --> C

    C --> DI[DI + service locator]
    C --> ERR[Errors + error handlers]
    C --> LIFE[Shutdown + timers + retry]
    C --> EVT[Event bus]
    C --> IO[I/O contracts + policy]
    C --> SEC[URL security + redaction]
    C --> SDKP[SDK/model/elicitation/fs routing]
    C --> TOOLP[Tool contracts/name/target introspection]
    C --> PROTO[Structured message + schemas/interfaces]
    C --> STATE[Shared session state]
```

### 3.6 Por que Core não é L0

O próprio código ainda se descreve em pontos como “[L0]”. Isso já não é verdadeiro em sentido
arquitetural forte:

- `elicitation-schema.js` referencia tipos de `presentation/contracts`;
- `interfaces.js` referencia tipos de Agent, Events, Hooks e Observability;
- Infra depende de Core para I/O contracts, errors e process policy;
- SDK depende de Core para taxonomia que semanticamente pertence ao próprio SDK;
- Presentation contém wrappers cuja única função é apontar de volta para Core;
- `src/copilot/types/index.js` reexporta elementos de Core;
- state/process lifecycle estão misturados no mesmo namespace horizontal.

Uma camada “fundamental” que conhece semanticamente ou tipa as camadas que deveriam depender dela
não é um fundamento; é um hub.

---

## 4. Matriz integral — arquivo por arquivo

A disposição abaixo é **estado-alvo proposto**, não uma ordem mecânica de moves. Paths finais podem
ser refinados durante a fase correspondente desde que o owner e os invariants sejam preservados.

| arquivo atual                  | responsabilidade atual                      | diagnóstico                                                                         | disposição proposta          | owner-alvo provável                                                           |
| ------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| `cache.js`                     | TTL/LRU cache genérico                      | duplicado por Infra cache; baixo valor como Core primitive                          | **DELETE/REPLACE**           | `infra/cache/**`                                                              |
| `circuit-breaker.js`           | circuit breaker                             | único consumer produtivo relevante no SDK session; semântica de recovery específica | **MOVE/REWRITE**             | `sdk/session/resilience` ou Infra resilience se surgir uso realmente genérico |
| `di-container.js`              | singleton global do container               | service locator process-global                                                      | **DELETE** após decomposição | composition roots/ports explícitos                                            |
| `di-tokens.js`                 | tokens globais EVENT_BUS/LOGGER             | ownership histórico; DB logger já perdeu sentido                                    | **DELETE/SPLIT**             | owner de cada capability                                                      |
| `di.js`                        | container DI genérico                       | scoped quebrado, sync dispose, service-locator architecture                         | **DECOMMISSION**             | composição explícita; sem substituto horizontal                               |
| `dialog-timeout-policy.js`     | timeouts adaptativos                        | semântica de apresentação/transporte                                                | **ABSORB**                   | `presentation/dialog-timeout-policy` + policy de transport se necessário      |
| `elicitation-schema.js`        | validação/normalização elicitation          | SDK-specific, bugs de schema                                                        | **REWRITE/ABSORB**           | `sdk/session/elicitation`/contracts                                           |
| `error-codes.js`               | códigos de erro gerais                      | bag de domínios; baixa coesão                                                       | **SPLIT/DELETE**             | owners de erro por domínio                                                    |
| `error-handlers.js`            | `toError`, classificação, logging injetável | 70+ consumers leaf; mutable global deps                                             | **SPLIT/REWRITE**            | primitive de normalização em Infra + observability/domain policies            |
| `errors.js`                    | classes de erro multi-domínio               | mistura HTTP/session/tool/bridge/config                                             | **SPLIT**                    | Config/Agent-SDK/Tools/Bridges/Presentation/Infra                             |
| `event-bus.js`                 | bus cross-module                            | owner natural já existe em `events`; bridge global                                  | **REBUILD/ABSORB**           | `events/runtime`                                                              |
| `index.js`                     | mega-barrel                                 | principal amplificador de acoplamento                                               | **DELETE POR ÚLTIMO**        | nenhum substituto                                                             |
| `interfaces.js`                | typedefs/interfaces umbrella                | type hub ascendente, arquitetura 1.0-era                                            | **DECOMPOSE/DELETE**         | owner-local ports/types                                                       |
| `io-contracts.js`              | result/meta/trace I/O                       | semanticamente Infra; version drift                                                 | **ABSORB**                   | `infra/operations/contracts`/telemetry                                        |
| `io-policy.js`                 | advisory/output/URL policy                  | semanticamente Infra; options ignoradas                                             | **SPLIT/ABSORB**             | `infra/policy`, output-window, network security                               |
| `model-selection.js`           | auto-model helpers                          | SDK/Model Gateway semantics                                                         | **ABSORB**                   | `sdk/models` e/ou Model Gateway selection                                     |
| `mutex.js`                     | mutex/pool genérico                         | duplicado por locks Infra; release não idempotente                                  | **DELETE/REPLACE**           | `infra/concurrency/locks`                                                     |
| `process-policy.js`            | Core process policy snapshot                | process state fora de ProcessInfra                                                  | **ABSORB**                   | `infra/composition/process/config`                                            |
| `retry.js`                     | retry/backoff/timeout                       | listener leak; policy genérica sem owner                                            | **REWRITE/ABSORB**           | Infra resilience/timing ou owner específico                                   |
| `safe-json.js`                 | JSON parse/stringify tolerante              | contrato inválido; persistence JSON já existe                                       | **DELETE/SPLIT**             | `infra/persistence/json` ou owner-specific parsing                            |
| `schemas.js`                   | schemas Zod multi-domínio                   | schema bag + closure Zod ampla                                                      | **DECOMPOSE**                | schemas junto de Agent/Config/SDK/Channel/etc.                                |
| `sdk-error-taxonomy.js`        | classificação SDK                           | já há `sdk/errors.js` wrapper                                                       | **ABSORB**                   | `sdk/errors.js`; harmonizar com Model Gateway health                          |
| `sdk-fs-routing.js`            | routing workspace SDK/local FS              | Presentation já possui projection; possui alias compat                              | **ABSORB/SPLIT**             | `presentation/files` + SDK tools policy                                       |
| `security/redaction.js`        | redaction genérica                          | recursão não bounded/cycle unsafe                                                   | **REWRITE/ABSORB**           | Infra policy/observability redaction                                          |
| `security/url-validator.js`    | anti-SSRF                                   | fail-open DNS, TOCTOU, credentials                                                  | **REWRITE**                  | Infra network/security capability ligada ao HTTP client                       |
| `shared-state.js`              | IDs globais de Hub/SDK session              | cross-runtime contamination por design                                              | **DELETE após migração**     | runtime/session-scoped owner                                                  |
| `shutdown-priorities.js`       | prioridades globais de teardown             | policy processual/domain names                                                      | **ABSORB**                   | process lifecycle/composition                                                 |
| `shutdown.js`                  | registry global de teardown                 | timeout não cancela; global state                                                   | **REWRITE**                  | `infra/composition/lifecycle` + Process/Application host                      |
| `structured-message.js`        | protocolo LLM structured message            | Channel/Conversation semantics                                                      | **ABSORB**                   | `channel/protocol` ou contract dedicado de conversation/channel               |
| `timer-registry.js`            | timers globais + sleep                      | leaks semânticos e hang                                                             | **REWRITE/DELETE**           | lifecycle/scheduler instance-owned ou disposers locais                        |
| `tool-contracts.js`            | contracts de tool/permission/input          | fail-open e duplicação de validator                                                 | **REWRITE/ABSORB**           | `tools/contracts` + SDK tool surface                                          |
| `tool-name-policy.js`          | regex/sanitize nome de tool                 | tool-specific                                                                       | **ABSORB**                   | `tools/contracts`/SDK tools                                                   |
| `tool-target-introspection.js` | heurística de targets                       | observability-specific, privacy/perf risks                                          | **REWRITE/ABSORB**           | `observability/tool-targets` com extractors tipados                           |
| `README.md`                    | documentação do Core                        | ficará obsoleta                                                                     | **DELETE por último**        | docs canônicos por owner                                                      |

### 4.1 Inventário funcional — exports e fan-in por arquivo físico

A tabela abaixo complementa a matriz de disposição. `consumer files` representa fan-in semântico de
imports runtime/static resolvidos para o arquivo físico, incluindo imports pelo root quando o
símbolo pode ser atribuído ao leaf de origem. JSDoc/type-only é auditado separadamente pelo graph
gate e pode elevar a dependência total. Amostras servem para orientar a primeira onda de consumers;
não são allowlists.

| arquivo                        | exports runtime principais                                                                                                                      |                                           consumer files | exemplos de consumers atuais                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------: | -------------------------------------------------------------------------- |
| `cache.js`                     | `createCache`                                                                                                                                   |                                                    **0** | nenhum consumer import estático encontrado                                 |
| `circuit-breaker.js`           | `CircuitBreaker`, `CircuitOpenError`                                                                                                            |                                                    **2** | `sdk/session/client.js`; teste dedicado                                    |
| `di-container.js`              | `container`                                                                                                                                     |                                                   **30** | Agent dialog/lifecycle, Conversation Hub, Observability, Terminal          |
| `di-tokens.js`                 | `DB_LOGGER`, `EVENT_BUS`, `SHUTDOWN_LOGGER`                                                                                                     |                                                    **6** | Agent entry, Boot, Hub, Observability, Terminal                            |
| `di.js`                        | `createContainer`, `createToken`                                                                                                                |                                                    **9** | token modules de Agent/Audit/Bridges/Hub/SDK/Tools + `types/index.js`      |
| `dialog-timeout-policy.js`     | `computeAdaptiveDialogTimeout`, `computeAdaptiveTransportTimeout`, `resolveOptionalDialogTimeout`, `resolveOptionalTransportTimeout`            |                                                    **2** | Channel inject; Presentation compat barrel                                 |
| `elicitation-schema.js`        | `isRuntimeElicitationFieldValue`, `isRuntimeElicitationSchema`, `normalizeElicitationContentWithSchema`, `normalizeElicitationResultWithSchema` |                                                    **3** | SDK elicitation, Server tasks, Terminal SDK command                        |
| `error-codes.js`               | 14 constants de código                                                                                                                          |                                                    **1** | apenas teste SDK no inventário runtime/static                              |
| `error-handlers.js`            | `toError`, `toExecError`, `logSwallowed`, `wrapAsync`, `isFatalError`, `isTransientError`, deps registry                                        |                                                  **149** | praticamente todos os domínios; maior fan-in do package                    |
| `errors.js`                    | 9 classes (`ConfigError`, `SessionError`, `ToolError`, `BridgeError`, etc.)                                                                     |                                                   **34** | Agent, SDK, Tools, Bridges, Config e outros                                |
| `event-bus.js`                 | `EventBus`, `createEventBus`, `bridgeEmitter`                                                                                                   |                                                   **12** | Agent, Hub, Observability, Server health, Terminal, Types                  |
| `index.js`                     | mega-surface com mais de uma centena de reexports                                                                                               | **147 arquivos usam a surface root no inventário amplo** | Agent, SDK, Terminal, Infra, Server, Tools e tests                         |
| `interfaces.js`                | sem runtime exports; typedef/interface umbrella                                                                                                 |                                                type-only | SDK registry e diversos JSDoc consumers históricos                         |
| `io-contracts.js`              | `ioOk`, `ioFail`, `toIoError`, `buildIoMeta`, `withIoMeta`, `createIoTraceId`, version                                                          |                                                   **27** | principalmente Infra filesystem/indexing/operations                        |
| `io-policy.js`                 | advisory limits, URL/output policy, version                                                                                                     |                                                    **4** | Infra search output, file reads, web tools, teste Core                     |
| `model-selection.js`           | `isAutoModelSelector`, `resolveModelSelectionMismatch`                                                                                          |                                                    **8** | Agent model config, SDK errors, Server, Terminal, usage classifier         |
| `mutex.js`                     | `createMutex`, `createMutexPool`, `withMutex`                                                                                                   |                                                    **0** | nenhum consumer import estático encontrado                                 |
| `process-policy.js`            | activate/read/get process policy                                                                                                                |                                                    **4** | ProcessInfra config/service, Infra process observability, teste ownership  |
| `retry.js`                     | `withRetry`, `withTimeout`                                                                                                                      |                                                    **4** | Agent lifecycle, MCP bridge e testes dedicados                             |
| `safe-json.js`                 | `parseJsonOrThrow`, `safeJsonParse`, `safeJsonStringify`                                                                                        |                                                    **8** | Agent state/context, Config, SDK tools, Terminal alias store               |
| `schemas.js`                   | 16 schemas Zod multi-domínio                                                                                                                    |                                                    **7** | Agent, Channel inject, SDK tools, Terminal store                           |
| `sdk-error-taxonomy.js`        | `classifySdkError`, `classifySdkRateLimitScope`, `getSdkErrorFingerprint`                                                                       |                                                    **2** | `sdk/errors.js`, Presentation recovery policy                              |
| `sdk-fs-routing.js`            | routing decision + canonical/legacy tool-name sets                                                                                              |                                                    **6** | Agent setup, Presentation files, Server SDK observability, Terminal        |
| `security/redaction.js`        | `redactSecretRecord`, `redactSecretText`                                                                                                        |                                                   **26** | Audit, Model Gateway, Observability, Terminal e outros                     |
| `security/url-validator.js`    | validate/check URL/IP + `dnsResolver`                                                                                                           |                                                    **5** | webhook manager, Server webhook routes, security/config tests              |
| `shared-state.js`              | shared Hub/SDK session getters/setters/clear                                                                                                    |                                                    **9** | Hub, Presentation, Terminal frontend/boot e route tests                    |
| `shutdown-priorities.js`       | `SHUTDOWN_PRIORITY`                                                                                                                             |                                                    **9** | Agent process host, Audit, Hub, Observability, runtime wiring              |
| `shutdown.js`                  | register/run/state/report/logger/event APIs + priorities                                                                                        |                                                   **19** | Agent host, AppInfraHost, Hub, Infra invalidation, Observability, Terminal |
| `structured-message.js`        | schema, builders, parser, serializer, protocol constants                                                                                        |                                                    **2** | Channel structured client e teste protocolar                               |
| `timer-registry.js`            | register/cancel/list/sleep/active count                                                                                                         |                                                   **27** | Agent watchdog/session, Bridges, Channel, Terminal e outros                |
| `tool-contracts.js`            | tool definition/telemetry/permission/user-input normalizers                                                                                     |                                                    **2** | SDK tool registry; hook tools                                              |
| `tool-name-policy.js`          | `TOOL_NAME_RE`, `sanitizeToolNames`                                                                                                             |                                                    **1** | Server copilot-api control                                                 |
| `tool-target-introspection.js` | `introspectToolTargets`                                                                                                                         |                                                    **3** | Observability collector, Terminal presenter, teste dedicado                |

### 4.2 Interpretação do fan-in

Há quatro classes de migração claramente distintas:

1. **zero/near-zero fan-in** — `cache`, `mutex`, `error-codes`: candidatos a remoção precoce;
2. **leaf owner claro** — circuit breaker, elicitation, model selection, structured message,
   tool-name policy: migrações pequenas, mas devem corrigir semantics no mesmo passo;
3. **cross-cutting com owner maduro** — I/O contracts, process policy, EventBus, redaction/security:
   requerem absorção por Infra/Events sem criar novo hub;
4. **high-fan-in/global state** — error handlers, errors, DI container, timers, shutdown: exigem
   transição target-first e não devem ser atacados por codemod de path.

O fato de `error-handlers.js` possuir 149 consumer files é especialmente relevante: `toError` e
`logSwallowed` devem ser separados antes de qualquer tentativa de eliminar o arquivo. Caso
contrário, um simples move criaria imediatamente um novo mega-root de errors.

---

---

## 5. Achados técnicos — bugs, gaps e riscos

### 5.1 Segurança e fail-closed

#### CORE-P0-001 — permission decision desconhecida vira `allow` — DEMONSTRADO

Arquivo: `tool-contracts.js`.

Probe:

```text
input decision='???'
=> { decision: 'allow', reason: 'unspecified' }
```

A policy é fail-open. Uma decisão fora do enum não pode adquirir permissão por normalização.

**Estado-alvo:** parsing/normalização deve rejeitar valor inválido ou convertê-lo explicitamente
para `deny`, conforme contrato do owner. A regra final deve ser causalmente testada no boundary de
permissão real, não apenas na função pura.

#### CORE-P0-002 — `allowFreeform:false` é ignorado — DEMONSTRADO

Arquivo: `tool-contracts.js`.

Probe:

```text
{ allowFreeform:false } => { allowFreeform:true }
```

Isso altera política explícita do caller e é especialmente perigoso porque a 2.1 acabou de criar um
port estreito para user-input policy.

**Estado-alvo:** o contract deve viver com a policy real de user input e preservar a intenção
explicitamente validada.

#### CORE-P0/P1-003 — anti-SSRF falha aberta em erro DNS — DEMONSTRADO

Arquivo: `security/url-validator.js`.

`checkResolvedIp()` captura qualquer falha do resolver e retorna, deixando o fetch prosseguir.

Probe com resolver injetado que lança:

```text
dnsFailureBehavior = returned
```

Isso contradiz uma boundary de segurança fail-closed.

**Estado-alvo:** a capability de network decide explicitamente se DNS failure é blocker; para
destinos governados por anti-SSRF, o default deve ser deny/failure.

#### CORE-P0/P1-004 — DNS rebinding/TOCTOU não é fechado — ESTÁTICO

Resolver o hostname antes do fetch não garante que a conexão subsequente use o mesmo IP. O HTTP
client pode resolver novamente.

**Estado-alvo:** resolução validada precisa estar ligada à conexão — dispatcher/agent/resolver
governado, address pinning seguro ou outra primitive que garanta que o socket usa um endereço
previamente autorizado. Não basta mover `checkResolvedIp()`.

#### CORE-P1-005 — URL com credentials é aceita — DEMONSTRADO

`https://user:secret@example.com/path` retorna `{safe:true}`.

Mesmo quando o destino é público, credentials embutidas ampliam risco de leak em logs, redirects e
tooling.

**Estado-alvo:** network policy deve decidir explicitamente sobre `username/password`, normalmente
rejeitando-os para webhooks/fetches governados.

#### CORE-P1-006 — classificação de IP é regex-based e incompleta como modelo de rede — HIPÓTESE FORTE

O código cobre várias classes privadas importantes, mas segurança de rede deveria trabalhar com
endereços normalizados/CIDRs e incluir explicitamente ranges não-globais relevantes, IPv4-mapped
IPv6 e regras de redirects.

**Gate futuro:** suíte table-driven sobre IPv4/IPv6 global, loopback, unspecified, link-local, ULA,
multicast/documentation ranges conforme a policy do produto.

### 5.2 Lifecycle, cancellation e concorrência

#### CORE-P1-007 — timeout concluído permanece “ativo” — DEMONSTRADO

Arquivo: `timer-registry.js`.

Após registrar timeout de 5 ms, aguardar 25 ms e consultar `listActiveTimers()`, o ID ainda estava
presente.

Consequências:

- métricas falsas;
- crescimento de registry;
- `cancelTimer()` opera sobre handle já concluído;
- observability de timer perde significado.

#### CORE-P1-008 — `cancelAll()` pode deixar `sleepMs()` pendente para sempre — DEMONSTRADO

Após `sleepMs(10000)` + `cancelAll()`, a Promise não havia resolvido nem rejeitado após janela de
observação.

Isso é uma violação grave de cancellation contract.

**Estado-alvo:** sleeps devem ser AbortSignal-aware e toda cancellation deve **settle** a Promise.

#### CORE-P1-009 — shutdown reporta conclusão enquanto handler expirado continua rodando — DEMONSTRADO

Probe:

```text
handler timeout = 10 ms
handler work    = 60 ms
runShutdown() conclui com timeout
immediatelyAfterShutdown = false
laterAfterShutdown       = true
```

O handler mutou estado depois de o shutdown ter sido declarado concluído.

**Estado-alvo:** handler recebe AbortSignal/cancellation capability; timeout inicia cancelamento e o
process lifecycle define política explícita para trabalhos que não cooperam. “Timeout” não pode ser
confundido com “trabalho terminou”.

#### CORE-P1-010 — DI `scoped` não cumpre o contrato — DEMONSTRADO

Registro `scoped` no root + duas resoluções no mesmo child:

```text
same=false
ids=1,2
expectedSame=true
```

A delegação `child.resolve() → parent.resolve()` faz a factory rodar no root, onde scoped é tratado
como transient.

**Decisão proposta:** não investir em tornar esse container um framework DI melhor antes de provar
que ele deve sobreviver. A direção arquitetural preferida é sua extinção por explicit composition.

#### CORE-P1/P2-011 — DI não possui lifecycle assíncrono adequado — ESTÁTICO

`dispose()` é síncrono, procura `dispose/close/destroy`, engole erros e não suporta
`Symbol.asyncDispose`/promises de teardown como contrato de ownership.

A 2.1 já possui `createInfraLifecycle()` async, idempotente e agregador de falhas. O generic
container não deve competir com esse owner.

#### CORE-P1/P2-012 — retry acumula abort listeners — DEMONSTRADO

Em três backoffs bem-sucedidos:

```text
abortListenerAdds=3
abortListenerRemoves=0
```

Listeners `{once:true}` só se removem ao abortar; se o sinal nunca aborta, permanecem associados.

**Estado-alvo:** listener removido no settle de cada delay, timers `unref` quando apropriado e
clock/randomness injetáveis para testes determinísticos se a primitive for mantida.

#### CORE-P2-013 — mutex release não é explicitamente idempotente — ESTÁTICO

Uma segunda chamada ao release pode alterar `_locked` quando outro waiter já foi promovido. Como
Infra já possui locks maduros, a opção preferida é eliminar a primitive em vez de fortalecê-la
isoladamente.

### 5.3 State ownership e isolamento

#### CORE-P1-014 — `shared-state.js` é singleton de sessão — ESTÁTICO

`_hubSessionId` e `_sdkSessionId` são module globals compartilhados pelo processo.

Isso conflita diretamente com 2.0/2.1:

- múltiplos runtimes podem coexistir;
- state deve pertencer a owner explícito;
- tests não devem depender de reset global para isolamento.

**Estado-alvo:** session/runtime bindings residem em objeto de runtime/session e são
injetados/consultados por capability explícita.

#### CORE-P1-015 — `error-handlers.js` possui dependency registry global — ESTÁTICO

`_deps` recebe logger/observer por setter global. Isso é outra forma de service locator.

**Estado-alvo:** `toError` permanece uma pure primitive estreita em owner neutro;
logging/observability é injetado nos boundaries que realmente precisam dele.

#### CORE-P1/P2-016 — shutdown/timer registries são process singletons fora de ProcessInfra — ESTÁTICO

A 2.1 tornou ProcessInfra real. Manter lifecycle processual paralelo em Core contradiz o novo
ownership.

### 5.4 Contratos, parsing e tipos

#### CORE-P2-017 — `safeJsonStringify(undefined)` não retorna string — DEMONSTRADO

Probe:

```text
type = undefined
```

O JSDoc promete `string`.

Além disso, cair silenciosamente para `'{}'` após erro de stringify pode mascarar perda de dados.

**Estado-alvo:** separar JSON persistence strict de “best-effort display serialization”; não manter
uma função que mistura ambos.

#### CORE-P1/P2-018 — `oneOf` é implementado como `anyOf` — DEMONSTRADO

Valor `2` satisfaz `{type:number}` e `{type:integer}` simultaneamente e foi aceito por `oneOf`.

JSON Schema `oneOf` exige exatamente uma alternativa válida.

#### CORE-P1/P2-019 — default inválido escapa no caminho sem content — DEMONSTRADO

Schema de `integer` com default `'not-int'` e `content=undefined` retornou `ok:true` com a string
inválida.

O caminho com content presente revalida defaults, portanto há comportamento bifurcado.

#### CORE-P1/P2-020 — validação `date` aceita data de calendário impossível — DEMONSTRADO

`2026-02-31` foi aceita porque `Date.parse` normaliza a data.

**Estado-alvo:** parser estrito de calendário/ISO conforme subset declarado.

#### CORE-P2-021 — tipos desconhecidos em elicitation são permissivos — ESTÁTICO

`matchesSchemaType()` retorna `true` para type não reconhecido. Se o subset é deliberadamente
limitado, schema fora do subset deve falhar na validação do schema, não ser aceito.

#### CORE-P2-022 — `objectOrNull` de algumas APIs aceita arrays como record — ESTÁTICO

Há helpers que checam apenas `typeof === 'object'`. Cada target owner deve padronizar `isRecord`
estrito.

### 5.5 Observability, privacy e data boundaries

#### CORE-P1/P2-023 — redaction recursiva não suporta ciclos — DEMONSTRADO

Objeto `{ self: obj }` causa:

```text
RangeError: Maximum call stack size exceeded
```

Além de crash/logging failure, profundidade ou breadth adversarial pode consumir CPU/stack.

**Estado-alvo:** traversal bounded por depth/nodes/array length, `WeakSet` para ciclos e policy
explícita para truncation.

#### CORE-P1/P2-024 — tool target introspection pode capturar conteúdo sensível demais — ESTÁTICO

`tool-target-introspection.js` usa heurísticas amplas para `query`, URLs, search terms e chaves como
`source`.

Riscos:

- termos de busca podem conter segredos ou dados do usuário;
- URL query strings podem conter tokens;
- `source` pode virar falso positivo de arquivo;
- payloads muito largos podem consumir CPU apesar dos caps de output.

**Estado-alvo:** registry de extractors por família de tool, com tipos conhecidos, traversal budget
e redaction **antes** de persistência/telemetria.

### 5.6 Error architecture

#### CORE-P1/P2-025 — `errors.js` mistura domínios e transporte — ESTÁTICO

Exemplos:

- `NotFoundError` conhece HTTP status;
- `SessionError` é Agent/SDK domain;
- `ToolError` pertence a Tools;
- `BridgeError` pertence a Bridges;
- `ConfigError` pertence a Config;
- `TimeoutError` pode ser primitive neutra.

Isso transforma Core em namespace obrigatório para erros sem owner.

#### CORE-P2-026 — classificação transitória/fatal é excessivamente genérica — ESTÁTICO

`error-handlers.js` trata categorias por classe de maneira ampla. Exemplo: `CircuitOpenError` como
fatal e `BridgeError` genericamente transient podem não refletir o contexto real.

**Estado-alvo:** normalização mecânica de `unknown → Error` separada de policy de recovery por
domínio.

#### CORE-P2-027 — taxonomias SDK duplicadas — ESTÁTICO

`sdk/errors.js` declara ser a camada canônica de semântica SDK, mas delega `classifySdkError`,
rate-limit scope e fingerprint ao Core.

Model Gateway possui ainda sua taxonomia de provider failure.

**Estado-alvo:** SDK owns SDK error taxonomy; Model Gateway owns provider/BYOK taxonomy;
compartilhar apenas primitives de leitura de error shape quando realmente neutras.

### 5.7 Event architecture

#### CORE-P1/P2-028 — EventBus está fora do owner `events` — ESTÁTICO

`src/copilot/events` já é SSOT de nomes, middleware e schemas, mas o runtime bus vive em Core. O
próprio middleware tipa `../../core/event-bus.js`.

**Estado-alvo:** `events/runtime` possui `EventBus/createEventBus`; composition injeta
policy/config; consumers usam event port/owner.

#### CORE-P1/P2-029 — `bridgeEmitter` é singleton global — ESTÁTICO

Um emitter global transversal reintroduz bypass entre runtimes e deve ser removido ou bound ao
runtime/bridge owner.

#### CORE-P2-030 — `emit()` síncrono com handlers/middleware assíncronos merece contrato explícito — HIPÓTESE FORTE

O desenho precisa distinguir claramente fire-and-forget, serial async emit e sync emit. A migração
deve testar ordering, failure containment e mutation during dispatch antes de preservar a API atual.

### 5.8 I/O architecture

#### CORE-P1/P2-031 — Infra ainda depende de Core para seus próprios contracts — ESTÁTICO

`infra/operations/contracts/types.js` importa `IoRiskClass` de `#copilot/core/io-contracts`.

Isso é dívida de ownership clara.

#### CORE-P2-032 — `IO_POLICY_VERSION` possui duas fontes — ESTÁTICO

`io-contracts.js` e `io-policy.js` expõem versões/políticas relacionadas, permitindo drift
semântico.

#### CORE-P2-033 — `evaluateIoUrlPolicy` possui options aparentes sem efeito — ESTÁTICO

A API aceita opções como private-network/localhost policy mas o fluxo atual não implementa
integralmente a semântica anunciada. A extinção deve remover options mentirosas ou implementá-las no
network owner.

### 5.9 Tool architecture

#### CORE-P1/P2-034 — validação de tool duplicada — ESTÁTICO

`tool-contracts.js` e `tools/infra/tool-factory.js` mantêm validators mínimos distintos; o segundo
justifica a duplicação por ciclo/TDZ.

Isso é sinal de boundary incorreto.

**Estado-alvo:** contract de definição de tool vive abaixo de registry/factory, em owner Tools/SDK
apropriado, sem ciclo e sem duas implementações.

#### CORE-P2-035 — tool-name policy está sem owner — ESTÁTICO

Regex/sanitização de nome de tool é contract de Tools/SDK, não primitive universal.

### 5.10 Protocols e schemas

#### CORE-P2-036 — `schemas.js` é um schema bag — ESTÁTICO

Schemas de Agent, config, tools e snapshots estão centralizados em um arquivo, criando acoplamento
semântico e closure Zod ampla.

**Estado-alvo:** schema acompanha o objeto/protocolo cujo invariants valida.

#### CORE-P2-037 — `interfaces.js` é um type hub ascendente — ESTÁTICO

O arquivo agrega contracts de domínios diversos e referencia tipos superiores. Isso viola o ideal
DAG mesmo quando não há runtime import.

**Estado-alvo:** ports/types locais a cada owner.

#### CORE-P2-038 — `structured-message.js` pertence ao protocolo Channel/Conversation — ESTÁTICO

Não há razão para Channel protocol depender de um Core genérico. O arquivo deve ir para um owner de
protocolo e manter custo/versionamento próprios.

#### CORE-P2-039 — fallback de embedded JSON pode perder JSON válido — ESTÁTICO

O parser parte do primeiro `{` e move apenas o closing brace. Se houver uma chave literal inválida
antes de um JSON válido posterior, o segundo objeto pode nunca ser encontrado.

### 5.11 Package/import governance

#### CORE-P1/P2-040 — exact aliases não governam relative bypasses para Core — ESTÁTICO

Há muitos consumers como:

```text
../core/error-handlers.js
../../core/security/redaction.js
./core/di-container.js
```

Logo, `copilot-core-import-boundaries.json` não é suficiente para demonstrar o uso exclusivo dos
seams declarados.

**Estado-alvo:** durante a campanha, criar ratchet parser-based para:

- impedir **novos** imports Core desde o início;
- medir e reduzir os existentes por owner;
- no fechamento, exigir zero alias, zero import relativo, zero JSDoc e zero path textual executável
  para Core.

#### CORE-P1/P2-041 — mega-root ainda tem fan-in excessivo — ESTÁTICO

`#copilot/core` é usado por ~147 arquivos no inventário amplo. A extinção do root deve ser
consequência de migrations owner-by-owner, não um reexport temporário para um novo mega-root.

### 5.12 Cobertura e test architecture

#### CORE-P2-042 — suíte dedicada não acompanha a criticidade do package — ESTÁTICO

`tests/unit/copilot/core` contém apenas quatro arquivos dedicados, embora existam muitos testes
indiretos em outros domínios.

**Regra de execução:** antes de remover um arquivo Core, os invariants que precisam sobreviver devem
existir em testes do **owner de destino**, e os bugs identificados nesta auditoria devem receber
regressions causais.

---

## 6. O que NÃO deve ser movido para Infra

Infra será um destino importante, mas não um depósito substituto.

Itens que **não** devem ir para Infra como regra:

- `structured-message` → Channel/Conversation protocol;
- SDK error taxonomy → SDK;
- model selection semantics → SDK/Model Gateway;
- elicitation schema → SDK session elicitation;
- tool definition/name/permission contracts → Tools/SDK tools;
- dialog timeout UX policy → Presentation;
- SDK-vs-local filesystem routing → Presentation/SDK tooling;
- EventBus runtime → Events;
- SessionError/shared session state → Agent/SDK/session owner;
- BridgeError → Bridges;
- ToolError → Tools;
- domain schemas → seus respectivos domínios.

Infra só deve absorver primitives cujo significado seja realmente infraestrutura compartilhada e
cujo lifecycle/authority possa ser modelado por seus owners existentes.

---

## 7. Arquitetura-alvo

### 7.1 Princípio central

O estado-alvo não possui “Core”. Possui owners verticais com dependências explícitas.

```mermaid
graph TD
    BOOT[Boot / Application composition] --> PI[ProcessInfra / RuntimeInfra]
    BOOT --> ER[Events Runtime]
    BOOT --> AR[Agent / Session Runtime]
    BOOT --> SDK[SDK]

    PI --> L[Lifecycle / scheduler / cancellation]
    PI --> RES[Resilience / retry primitives]
    PI --> IOP[I/O contracts + policy]
    PI --> NET[Network security]
    PI --> RED[Bounded redaction]

    ER --> EVN[Event names / schemas / middleware]
    AR --> PORTS[Agent ports]
    SDK --> ELI[Elicitation]
    SDK --> SDKE[SDK errors + model semantics]

    TOOLS[Tools] --> TC[Tool contracts + names]
    PRES[Presentation] --> DP[Dialog / file routing policy]
    CHANNEL[Channel] --> PROTO[Structured message protocol]
    OBS[Observability] --> TARGETS[Typed tool target extractors]

    AR --> ER
    PRES --> AR
    OBS --> ER
    TOOLS --> IOP
```

Nenhuma dessas setas passa por um namespace horizontal genérico.

### 7.2 Topologia-alvo conceitual

```text
src/copilot/
├── agent/
│   ├── ports/
│   └── runtime/session state owners
├── boot/
├── events/
│   ├── runtime/
│   ├── middleware/
│   └── schemas/
├── infra/
│   ├── composition/
│   │   ├── process/
│   │   ├── runtime/
│   │   └── lifecycle/
│   ├── concurrency/
│   ├── operations/contracts/
│   ├── persistence/json/
│   ├── platform/network/        (nome final a decidir por owner)
│   ├── policy/
│   └── observability/
├── sdk/
│   ├── errors.js
│   ├── models/
│   └── session/elicitation...
├── tools/
│   └── contracts/               (seams mínimos, sem mega-barrel)
├── presentation/
│   ├── dialog-timeout-policy.js
│   └── files/routing.js
├── channel/
│   └── protocol/structured-message...
└── observability/
    └── tool-targets/...

# não existe src/copilot/core/
```

### 7.3 Nenhum “Core 2”

É explicitamente proibido resolver o problema criando:

```text
src/copilot/common/
src/copilot/shared/
src/copilot/foundation/
src/copilot/kernel/
src/copilot/base/
src/copilot/core2/
```

como novo owner transversal.

Um helper só pode ser compartilhado se houver um owner semântico defensável. “Muitos lugares usam”
não é owner.

---

## 8. Estratégia de extinção

### 8.1 Migração por símbolo/owner, não por arquivo

Arquivos-bag devem ser desmontados símbolo por símbolo. Exemplo:

```text
errors.js
  ConfigError          -> config
  SessionError         -> agent/sdk session
  ToolError            -> tools
  BridgeError          -> bridges
  HTTP mapping         -> presentation/server
  generic toError      -> narrow Infra/platform primitive
```

### 8.2 Sem shims prolongados

Quando o último consumer de um símbolo antigo for migrado:

1. remover o export Core na mesma onda;
2. remover alias correspondente se ficar vazio;
3. remover testes que só protegem o path antigo;
4. não deixar reexport “deprecated” para depois.

### 8.3 Sem false abstraction

Não criar uma interface só para preservar uma abstração antiga. Exemplo: o objetivo do DI não é
trocar `core/container` por `infra/container`; é eliminar service location onde explicit composition
já é suficiente.

### 8.4 Fix while moving

Bug causal identificado neste documento deve ser corrigido **na mesma faixa em que a
responsabilidade muda de owner**. Não transportar comportamento defeituoso e abrir issue futura.

### 8.5 Target-first

Para componentes de alto fan-in:

1. definir owner alvo;
2. criar primitive/port real no destino;
3. testar semantics e lifecycle;
4. migrar consumers em lotes coerentes;
5. remover surface Core imediatamente ao zerar fan-in.

### 8.6 Custo também é arquitetura

Toda nova surface pública de Infra deve entrar em:

- manifest de audience/privilege/lifecycle/stability/cost;
- static closure ratchet;
- cold-import baseline se hot runtime/composition.

Não promover um helper pequeno via um barrel pesado só para simplificar imports.

---

## 9. Roadmap de execução

Os checkboxes abaixo constituem o ledger para a campanha futura. Eles não estão marcados nesta
auditoria porque nenhuma implementação foi feita.

---

## Faixa A — governança da própria campanha

### A.1 — baseline executável

- [x] congelar inventário inicial: 34 itens / 33 JS / 6.073 linhas;
- [x] gerar mapa parser-based `consumer → Core specifier/path → symbols`;
- [x] separar runtime, JSDoc/type, mock e test-only usages;
- [x] registrar fan-in por owner e por símbolo;
- [x] guardar baseline versionada ou teste determinístico, evitando snapshot manual que possa ficar
      stale.

### A.2 — ratchet “no new Core dependency”

- [x] adicionar gate que proíbe aumento do conjunto de imports para Core;
- [x] detectar `#copilot/core*` e traversals relativos;
- [x] incluir JSDoc/import types;
- [x] incluir `src/**`, `scripts/**`, `tools/**` e tests conforme audience;
- [x] fazer o gate reportar baseline remanescente por owner para permitir redução monotônica.

### A.3 — target-owner manifest

- [x] manter mapa machine-readable ou contract test com cada módulo/símbolo Core e sua disposição
      final;
- [x] nenhum item pode terminar como “TBD” ao entrar na fase de remoção;
- [x] owners novos devem justificar scope, audience e authority.

**Gate A:** nenhuma nova dependência de Core pode ser introduzida enquanto a campanha ocorre.

---

## Faixa B — primitives mortas, duplicadas ou inferiores às atuais

### B.1 — cache

- [x] provar fan-in real de `createCache`;
- [x] migrar qualquer uso legítimo para `infra/cache` apropriado — fan-in executável era zero;
- [x] comparar semantics TTL/LRU necessárias — nenhuma semantic ativa dependia da primitive morta;
- [x] remover `core/cache.js` sem reexport.

### B.2 — mutex

- [x] localizar todos os usos reais;
- [x] migrar para `infra/concurrency/locks`/queue apropriado — fan-in executável era zero;
- [x] criar regression se algum caller dependia de ordering específico — não aplicável após prova de
      zero consumer;
- [x] remover `core/mutex.js`.

### B.3 — safe-json

- [x] separar strict persistence parsing de display/best-effort serialization;
- [x] corrigir contrato `undefined`;
- [x] não preservar fallback silencioso `'{}'` onde perda de dados importa;
- [x] migrar consumers para owner puro `infra/platform/json` (sem authority de filesystem);
- [x] remover `core/safe-json.js`.

### B.4 — error codes mortos/duplicados

- [x] mapear cada code a owner;
- [x] remover códigos sem consumers;
- [x] não criar novo catálogo global sem necessidade.

**Gate B:** primitives duplicadas não sobrevivem apenas por compatibilidade.

---

## Faixa C — I/O contracts, policy e ownership Infra

### C.1 — `io-contracts`

- [x] mover tipos/result/meta realmente usados para `infra/operations/contracts` ou owner mais
      estreito;
- [x] remover `IoRiskClass` dependency `Infra → Core`;
- [x] unificar trace/meta contract sem duplicar OperationEnvelope;
- [x] decidir owner único de `IO_POLICY_VERSION` (`infra/operations/contracts/index.js`).

### C.2 — `io-policy`

- [x] decompor advisory limits, output sanitization e URL policy;
- [x] integrar limits com `infra/policy/budgets`/output-window quando semanticamente equivalentes;
- [x] remover opções aceitas mas ignoradas;
- [x] garantir que network policy não dependa de string options sem capability.

### C.3 — boundary cost

- [x] criar/ajustar micro-entrypoints públicos apenas se consumers externos precisarem;
- [x] medir closure estática;
- [x] medir cold import de runtime/composition surfaces;
- [x] não ampliar existing heavy barrels.

**Gate C:** `infra/**` possui zero dependência de `src/copilot/core` para I/O semantics.

---

## Faixa D — network security e redaction

### D.1 — anti-SSRF owner

- [x] definir owner sob Infra platform/network sem criar generic security bag;
- [x] rejeitar credentials em URLs governadas;
- [x] transformar DNS failure em decisão fail-closed para fetch governado;
- [x] substituir regex-only classification por address/CIDR normalization robusta;
- [x] cobrir IPv4, IPv6, mapped IPv6, loopback, link-local, ULA, unspecified e demais classes
      relevantes;
- [x] governar redirects sob a mesma policy.

### D.2 — fechar DNS rebinding TOCTOU

- [x] desenhar resolver/socket lookup que conecte ao IP efetivamente validado;
- [x] provar causalmente que resolução subsequente não pode trocar para endereço privado;
- [x] impedir fallback silencioso para resolver default após validation;
- [x] resolver injection/test-control permanece somente no owner interno white-box de
      `infra/platform/network`; a surface runtime pública não exporta resolver, `allowPrivate` nem
      qualquer override de private-network authority.

### D.3 — redaction bounded

- [x] mover para owner Infra/observability apropriado;
- [x] adicionar `WeakSet`/cycle handling;
- [x] adicionar depth/node/array/string budgets;
- [x] definir truncation marker estável;
- [x] testar record cíclico, deep tree e large arrays;
- [x] reconciliar regexes/policies duplicadas de sanitization.

**Gate D:** nenhum security bug identificado é carregado intacto para o novo owner.

### Checkpoint de execução — 2026-08-22 — Faixas A–D

- ratchet parser-based inicial: **523 dependências Core classificadas**; estado após A–D: **424**,
  sem adições;
- removidos fisicamente: `cache.js`, `mutex.js`, `safe-json.js`, `error-codes.js`,
  `io-contracts.js`, `io-policy.js`, `security/redaction.js`, `security/url-validator.js`;
- micro-surfaces novas: `infra/public/platform/json`, `infra/public/operations/contracts`,
  `infra/public/observability/redaction`, `infra/public/platform/network`;
- anti-SSRF agora é fail-closed e o DNS validado é o próprio `lookup` do socket HTTP(S), eliminando
  o segundo resolve independente; URLs com credentials são rejeitadas;
- redaction é cycle-safe e bounded; JSON strict sempre retorna string ou lança;
- evidência dirigida mais recente: **64/64 testes pass** em network/redaction/IO/Webhook/Web tools;
- `typecheck:strict:src.copilot`: **verde**;
- fechamento C/D em 2026-08-23: static/cold ratchets verdes; a surface runtime de network passou a
  ser fail-closed por construção, sem resolver injection nem private-network override, enquanto o
  seam injetável permanece exclusivamente interno para white-box tests.

---

## Faixa E — process lifecycle, shutdown, timers e retry

### E.1 — consolidar sobre `createInfraLifecycle`

- [x] revisar capabilities atuais de `infra/composition/lifecycle`;
- [x] separar generic disposer registry de process shutdown orchestration;
- [x] owner de process shutdown deve ser ProcessInfra/Application composition, não module singleton;
- [x] registration retorna unregister/disposable token;
- [x] registration após disposal deve falhar.

### E.2 — shutdown cancelável

- [x] mudar handler contract para receber AbortSignal/cancellation context quando necessário;
- [x] timeout deve abortar trabalho cooperativo;
- [x] relatório deve distinguir `timed-out-and-aborted`, `timed-out-still-running` se inevitável, e
      `failed`;
- [x] logger/event emission devem ser failure-contained;
- [x] teardown ordering deve ser explícito por phases/ownership, não números globais espalhados.

### E.3 — timers/sleep

- [x] eliminar registry global;
- [x] timers owned por runtime/resource ou scheduler process-owned;
- [x] timeout concluído auto-remove;
- [x] cancel always settles waiting promise;
- [x] IDs não colidem entre runtimes;
- [x] preferir AbortSignal/AbortSignal.timeout quando semântica permitir;
- [x] timers background devem `unref` quando apropriado.

### E.4 — retry

- [x] remover abort listener após cada settle;
- [x] validar `maxAttempts/delays`;
- [x] definir clock/randomness injection se testes exigirem determinismo;
- [x] separar generic retry primitive de domain retry policy;
- [x] não fundir retry com Model Gateway/SDK recovery policy.

### E.5 — process policy

- [x] absorver `core/process-policy` em ProcessInfra config;
- [x] nenhuma segunda fonte process-global de policy;
- [x] URL/event defaults recebem config pelo owner.

**Gate E:** ✅ zero imports de `core/shutdown`, `timer-registry`, `retry`, `process-policy`.

### Checkpoint de execução — 2026-08-22 — Faixa E

- `ProcessInfra` passou a possuir `shutdown` e `scheduler` **instance-owned**;
  `createInfraLifecycle` permanece o disposer hierárquico genérico, sem ser transformado em process
  orchestrator;
- shutdown usa fases semânticas, unregister token e `AbortSignal`; timeout diferencia
  `timed-out-and-aborted` de `timed-out-still-running`, com observability failure-contained;
- scheduler process-owned auto-remove timeouts e resolve sleeps em cancel/dispose; waits finitos
  puros usam `infra/concurrency/resilience.sleep`, sem registry global;
- retry foi movido para `infra/concurrency/resilience`, valida configuração, injeta
  randomness/timers para determinismo e remove abort listeners após settle;
- `core/process-policy.js` foi eliminado; a policy é snapshot imutável de `ProcessInfra`; EventBus
  recebe policy explícita do owner e a network runtime pública é fail-closed por construção, sem
  configuração de bypass privado;
- removidos fisicamente `core/shutdown.js`, `core/shutdown-priorities.js`, `core/timer-registry.js`,
  `core/retry.js` e `core/process-policy.js`; sem shim/reexport;
- boot surface deixou de tratar lifecycle/timers como Core e agora valida
  `#copilot/boot/process-runtime`;
- evidência: `typecheck:strict:src.copilot` **verde**; lifecycle directed **35/35 pass**; último
  ajuste scheduler/resilience/L2/metrics **38/38 pass**; lint focado da nova fronteira **verde**;
- ratchet Core após remoção física: **372 dependências remanescentes**, sem adições (baseline
  inicial 523).

---

## Faixa F — erradicação de DI/service locator

### F.1 — inventário do container global

- [x] mapear os 23+ consumers estáticos de `container`;
- [x] classificar cada token por owner e lifecycle;
- [x] identificar registrations/resolve em bootstrap vs runtime hot path.

### F.2 — substituir por composição explícita

- [x] ApplicationInfraHost/boot recebem e propagam capabilities explicitamente;
- [x] Agent recebe ports/runtime object;
- [x] Events recebe bus instance;
- [x] Observability recebe deps explícitas;
- [x] Conversation Hub/Terminal deixam de consultar service locator.

### F.3 — tokens

- [x] eliminar `DB_LOGGER` se realmente obsoleto após SQLite 2.1;
- [x] EVENT_BUS deixa de ser token global quando bus tiver owner;
- [x] SHUTDOWN_LOGGER deixa de ser setter/token global;
- [x] tokens domain-specific que ainda fizerem sentido vivem no composition owner.

### F.4 — container implementation

- [x] não corrigir `scoped` apenas para eternizar o container;
- [x] se algum uso temporário exigir correção, adicionar regression causal sem ampliar API;
- [x] remover `di-container.js`;
- [x] remover `di-tokens.js`;
- [x] remover `di.js` quando último consumer sair.

**Gate F:** não existe service locator global equivalente em outro path.

---

## Faixa G — state de sessão/runtime

### G.1 — `shared-state.js`

- [x] mapear writers/readers de Hub/SDK session IDs;
- [x] definir source of truth de cada ID;
- [x] colocar bindings em runtime/session owner;
- [x] provar dois runtimes coexistentes sem contaminação;
- [x] provar teardown de um runtime sem limpar estado do outro;
- [x] remover setters/getters globais.

### G.2 — consumers

- [x] Agent/session usa port/runtime;
- [x] Terminal usa projection do runtime ativo;
- [x] Server/Conversation Hub usam seus contextos;
- [x] nenhum consumer recupera “current session” de module singleton oculto.

**Gate G:** zero module-global session identity compartilhada.

---

## Faixa H — EventBus para `events/runtime`

### H.1 — ownership

- [x] mover/reconstruir EventBus sob `events`;
- [x] eliminar dependency de middleware para `core/event-bus`;
- [x] policy de listener/middleware caps vem de runtime config/ProcessInfra, não Core process
      policy.

### H.2 — semantics

- [x] definir APIs distintas se necessário para sync vs async/fire-and-forget;
- [x] testar ordering;
- [x] testar listener mutation durante dispatch;
- [x] testar middleware failure containment;
- [x] não mutar caller event sem contrato explícito.

### H.3 — global emitter

- [x] remover `bridgeEmitter` global ou bind por runtime/bridge owner;
- [x] migrar consumers para port/capability.

### H.4 — surface

- [x] expor micro-entrypoint real se necessário;
- [x] não ampliar `#copilot/events` indiscriminadamente com runtime pesado se nomes de eventos são
      hot/light.

**Gate H:** `events` é owner integral de event protocol/runtime; Core não participa.

**Checkpoint F/G/H — 2026-08-22:**

- source tree sem `container.resolve/register/has/validateRequired`, `createContainer` ou tokens DI
  globais;
- `di.js`, `di-container.js`, `di-tokens.js` e token bags domain-specific removidos fisicamente;
- `AgentSessionBindingRuntime` é instance-owned por `AgentContext`; `core/shared-state.js` removido;
- regression causal de dois `AlwaysAliveAgent` simultâneos confirmou bindings independentes (2/2);
- `events/runtime` é owner do EventBus; application bus é composto em `boot/application-events.js`;
- EventBus regression cobre ordering, listener mutation snapshot, middleware failure containment e
  non-mutation do caller event;
- `typecheck:strict:src.copilot` verde após a migração de G;
- ratchet Core: 285 dependências remanescentes, zero adições.

---

## Faixa I — errors por owner

### I.1 — normalização neutra

- [x] extrair somente primitives realmente universais (`toError`, eventualmente `toExecError`) para
      owner estreito;
- [x] primitive não conhece logger, event bus nem recovery policy;
- [x] `logSwallowed` vira observability policy/injected utility.

### I.2 — classes por domínio

- [x] `ConfigError` → Config;
- [x] `SessionError` → Agent/SDK session;
- [x] `ToolError` → Tools;
- [x] `BridgeError` → Bridges;
- [x] HTTP status mapping → Presentation/Server;
- [x] Timeout generic só permanece neutro se vários owners realmente precisarem.

### I.3 — recovery policies

- [x] SDK recovery em SDK;
- [x] Model Gateway provider failure em Model Gateway;
- [x] filesystem/infra errors em Infra;
- [x] eliminar generic `isFatalError/isTransientError` se a classificação depender de contexto.

### I.4 — mega fan-in

- [x] migrar `toError` em lotes por owner;
- [x] não criar `#copilot/errors` mega-root como substituição direta.

**Gate I:** `errors.js`, `error-codes.js` e `error-handlers.js` removidos sem novo error bag
horizontal.

---

## Faixa J — SDK-owned concerns

### J.1 — SDK error taxonomy

- [x] mover implementação de `sdk-error-taxonomy` para `sdk/errors` ou child owner;
- [x] eliminar delegação `sdk/errors → #copilot/core`;
- [x] revisar matching amplo de mensagens/status;
- [x] harmonizar, sem fundir indevidamente, com Model Gateway provider taxonomy.

### J.2 — circuit breaker

- [x] confirmar se o uso continua exclusivo/majoritário de SDK session;
- [x] testar half-open concurrency e generation semantics;
- [x] decidir SDK owner ou Infra generic resilience baseado em fan-in real;
- [x] não exportar generic breaker publicamente sem necessidade.

### J.3 — model selection

- [x] mover `isAutoModelSelector` e mismatch semantics para `sdk/models`/Model Gateway apropriado;
- [x] manter uma única definição de selector `auto`.

### J.4 — elicitation

- [x] tornar `sdk/session/elicitation` owner real, não wrapper de Core;
- [x] corrigir `oneOf` exact-one;
- [x] validar defaults em todos os paths;
- [x] validar schema subset antes de validar valores;
- [x] implementar calendar date estrito;
- [x] modelar unknown/additional fields conscientemente;
- [x] preservar queue semantics e testar limits/cancellation.

### J.5 — SDK filesystem routing

- [x] decompor decisão entre Presentation e SDK tooling;
- [x] eliminar alias compat `buildCanonicalLocalFsExcludedTools` se sem consumer legítimo;
- [x] remover wrappers que só apontam para Core.

**Gate J:** SDK não importa Core, nem por alias, nem relativo, nem JSDoc.

---

## Faixa K — Tools-owned concerns

### K.1 — canonical tool definition contract

- [x] escolher owner abaixo de registry/factory que não gere ciclo;
- [x] unificar `validateToolDefinitionContract` e validator local da factory;
- [x] incluir name policy no mesmo contract owner se coeso;
- [x] alinhar com tipos oficiais do Copilot SDK.

### K.2 — permission contract

- [x] decisão inválida deve falhar closed;
- [x] `toolName/reason` validados;
- [x] testar unknown/missing/malformed payloads;
- [x] não misturar permission policy com telemetry normalization.

### K.3 — user input

- [x] integrar com `agent/ports/user-input-policy-port.js`/SDK session policy apropriada;
- [x] `allowFreeform:false` deve permanecer false;
- [x] remover essa responsabilidade do generic tool contract se ela pertencer ao dialog/user-input
      domain.

### K.4 — tool target introspection

- [x] mover para Observability owner;
- [x] criar extractors por tool family/contract;
- [x] traversal budgets;
- [x] redaction antes da persistence;
- [x] não tratar generic `source` como path sem contexto;
- [x] testar URLs com secrets/query params.

**Gate K:** Tools/Observability não dependem de `core/tool-*`.

---

## Faixa L — Presentation, Channel e protocolos

### L.1 — dialog timeout policy

- [x] `presentation/dialog-timeout-policy.js` deixa de ser compat barrel;
- [x] absorver implementation e separar transport timeout se ele não for Presentation concern;
- [x] revisar clock/bounds e defaults pelo runtime config apropriado.

### L.2 — file routing

- [x] `presentation/files/routing.js` deixa de importar Core;
- [x] owner da decisão SDK/local filesystem explicitado;
- [x] sem compatibility aliases antigos.

### L.3 — structured message

- [x] mover para `channel/protocol` ou owner equivalente;
- [x] preservar versioning explícito;
- [x] corrigir fallback de embedded JSON para procurar candidatos completos, não fixar o primeiro
      `{`;
- [x] testar preambles com braces, multiple JSON objects e malformed trailing text;
- [x] medir custo Zod do entrypoint.

**Gate L:** Presentation e Channel possuem zero import Core.

---

## Faixa M — decomposição de `schemas.js` e `interfaces.js`

### M.1 — schema ownership

- [x] inventariar cada schema exportado e consumers;
- [x] Agent schemas → Agent;
- [x] Config schemas → Config;
- [x] Tool schemas → SDK/Tools;
- [x] Channel/protocol schemas → Channel;
- [x] snapshots → owner do snapshot;
- [x] remover schemas mortos;
- [x] nenhum novo `schemas.js` global.

### M.2 — interface ownership

- [x] inventariar cada typedef/interface;
- [x] contratos runtime externos viram ports do owner;
- [x] types de Hooks/Observability/Events ficam com esses owners;
- [x] remover adapters OOP puramente históricos se função real já for suficiente;
- [x] JSDoc graph final deve permanecer DAG.

### M.3 — Zod cost

- [x] evitar que uma surface leve importe todos os schemas;
- [x] static/cold closure ratchet para novas APIs públicas relevantes.

**Gate M:** `schemas.js` e `interfaces.js` não existem; não há type hub substituto.

---

## Faixa N — dissolução do mega-root e extinção física de Core

### N.1 — redução monotônica do root

- [x] root fan-in por símbolo chega a zero;
- [x] remover exports do root assim que seu fan-in zerar;
- [x] nenhum alias novo aponta para `core/index.js`;
- [x] não criar reexport root em outro domínio.

### N.2 — aliases

- [x] apagar cada `#copilot/core/<leaf>` no mesmo commit em que seu último consumer sair;
- [x] apagar `#copilot/core` quando root zerar;
- [x] apagar `config/architecture/copilot-core-import-boundaries.json` quando não houver mais Core
      para governar;
- [x] atualizar package-import gate para exigir Core inexistente.

### N.3 — traversals relativos

- [x] zero `../core/`;
- [x] zero `../../core/` e demais variantes;
- [x] zero JSDoc `core/...` executável/type;
- [x] zero `src/copilot/core` em scripts/configs vivos, exceto documentação histórica explicitamente
      marcada.

### N.4 — remoção física

- [x] remover `core/index.js`;
- [x] remover `core/README.md`;
- [x] remover último arquivo restante;
- [x] `src/copilot/core` não existe no filesystem;
- [x] nenhum diretório vazio/shim/redirect permanece.

**Gate N:** `test -e src/copilot/core` falha porque o path não existe.

---

## Faixa O — fechamento global pós-extinção

### O.1 — arquitetura

- [x] package import governance 100% exact;
- [x] zero wildcards novos;
- [x] zero stale aliases;
- [x] zero cycles/unresolved/parse errors;
- [x] architecture health não depende de exceção Core;
- [x] layer checks removem qualquer conceito histórico de Core L0.

### O.2 — TS/quality

- [x] TypeScript 7 strict global verde;
- [x] lint Copilot verde;
- [x] Prettier global verde;
- [x] zero `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`;
- [x] `git diff --check` verde.

### O.3 — testes

- [x] regressions causais de todos os bugs CORE-P0/P1 verdes;
- [x] focused suites dos owners migrados verdes;
- [x] unit suite Copilot global verde apenas no checkpoint final;
- [x] integration/standalone afetados por lifecycle/events/SDK verdes.

### O.4 — performance

- [x] static closure ratchets verdes;
- [x] cold-import ratchets verdes para novas/mudadas public Infra APIs;
- [x] comparar custo do antigo `#copilot/core` com seams finais apenas como evidência histórica, não
      como novo baseline agregado.

### O.5 — runtime operacional

- [x] MCP workspace smoke verde;
- [x] connector readiness verde se lifecycle/process/event changes exigirem restart;
- [x] LLM-B/Model Gateway readiness verde se SDK/model selection/error changes forem materiais;
- [x] dois runtimes/sessions simultâneos provam isolation de state/event/lifecycle.

### O.6 — documentação

- [x] atualizar READMEs vivos;
- [x] marcar este roadmap como fechado com evidência real;
- [x] preservar documentos 1.0/2.0/2.1 como ledger histórico;
- [x] não reescrever história para fingir que Core nunca existiu.

**Gate O:** Definition of Done integral e snapshot apto a commit/push.

### Checkpoint final de execução — 2026-08-23 — campanha FECHADA

- **Extinção física:** `src/copilot/core` e `src/copilot/db` estão ausentes; package-map contém zero
  aliases `#copilot/core*` e zero aliases `#copilot/db*`; o antigo
  `config/architecture/copilot-core-import-boundaries.json` foi removido por ter se tornado
  desnecessário.
- **Owners finais:** neutral error primitive em `infra/platform/error`; erros/recovery por Config,
  Agent/SDK, Tools, Bridges, Presentation/Server, Model Gateway e Infra; circuit breaker,
  elicitation e model-selection no SDK; tool contracts em SDK/Tools; timeout em `dialog/`;
  structured protocol em `channel/protocol`; target extraction em Observability; schemas/types
  decompostos por owner, sem novo type/schema mega-hub.
- **Security:** outbound HTTP público usa `infra/platform/network/runtime` fail-closed e
  connection-bound. A membrana `#copilot/infra/public/platform/network` não exporta
  `resolvePublicAddresses`, resolver injection, `allowPrivate` ou equivalente; o antigo
  `WEBHOOK_ALLOW_PRIVATE_HOSTS` foi eliminado por ser authority órfã. White-box DNS policy tests
  usam apenas o owner interno. Closure final: **10 módulos / 21.838 bytes**, teto ratcheted **15 /
  32.757**.
- **Arquitetura:** `copilot:architecture:check` verde; package-map **234 aliases Copilot / 45
  testing / 16 SDK**, sem broken/wildcard/stale leaks; grafo `src`: **2.031 arquivos / 5.654 edges /
  0 cycles / 0 unresolved / 0 parse errors**.
- **Qualidade:** TypeScript 7 strict global, lint Copilot, Prettier e `git diff --check` verdes; **0
  suppressions TS em 3.301 arquivos ativos**; configured-FS e no-trusted-I/O verdes.
- **Testes:** unit Copilot **7.061 total / 7.033 pass / 0 fail / 28 pending**, `2.170/2.170` suites,
  artifact `artifacts/test-runs/copilot/2026-08-23T04-16-11-466Z/summary.md`; integration Copilot
  **17 total / 12 pass / 0 fail / 5 pending**; regression Copilot **31/31**. Os três WARNs da suíte
  unitária são a falha sintética deliberada do detached LLM-B reaper.
- **Performance:** **38/38** public hot aliases verdes, 5 samples + 1 warmup. A network pública
  final mediu **22,140 ms import / 77,559 ms wall / 62,047 MiB RSS**, abaixo do ratchet existente; a
  cold baseline não precisou ser relaxada.
- **Runtime operacional:** workspace MCP com 13/13 checks funcionais; connector smoke OAuth/health,
  **131/131 tools** e SSE/reconnect verdes; Cloudflare post-change `ok=true`, 4 HA, QUIC, RTT 20 ms,
  RPC p95 1.170 ms; request-error agregado permaneceu warning histórico. Model Gateway/LLM-B
  readiness `ok=true`, catalog/SQLite parity/redaction verdes, 7/7 perfis, runtime selector 7/7 e
  terminal selector 3/3.
- **História preservada:** documentos 1.0/2.0/2.1 e o diagnóstico pré-execução deste arquivo
  permanecem como ledger; nenhuma compat layer, shim ou substituto `shared/common/foundation/core2`
  foi criado para simular a extinção.

---

## 10. Ordem recomendada das faixas

A sequência proposta minimiza compat layers e ciclos transitórios:

1. **A — governance da campanha**: impede nova dívida enquanto o trabalho acontece.
2. **B — mortos/duplicados**: reduz superfície antes de mover o que realmente importa.
3. **C/D — Infra I/O + security**: fecha dependencies `Infra → Core` e bugs de segurança cedo.
4. **E — lifecycle/process**: estabelece owner correto antes de desmontar global state.
5. **F/G — DI + shared state**: maior transformação de ownership e isolamento.
6. **H — Events**: move runtime de eventos para owner natural sem depender de service locator.
7. **I — errors**: pode então injetar observability/lifecycle sem globals.
8. **J/K/L — SDK, Tools, Presentation, Channel**: absorvem concerns de domínio.
9. **M — schemas/interfaces**: desmonta type/schema hub já com owners maduros.
10. **N — root/aliases/path deletion**: consequência, não começo.
11. **O — fechamento global**.

Algumas subfaixas podem rodar em paralelo quando não compartilham consumers, mas **F/G/H/I** exigem
coordenação porque container, event bus, errors e state são fortemente interligados.

---

## 11. Grafo de transição recomendado

### Estado 0 — atual

```text
many domains ───────────────► CORE ◄──────────── Infra
                                 │
                                 ├─ globals
                                 ├─ policy
                                 ├─ protocols
                                 ├─ SDK semantics
                                 └─ tool/presentation semantics
```

### Estado 1 — owners de destino criados/fortalecidos

```text
Core ainda existe, mas:

Infra ◄── io/network/lifecycle primitives
Events ◄── EventBus runtime
SDK ◄── elicitation/error/model
Tools ◄── tool contracts
Presentation ◄── timeout/routing
Channel ◄── structured protocol
Observability ◄── target extraction

new Core imports = forbidden
```

### Estado 2 — globals extintos

```text
Application/Process/Runtime composition
   ├─ owns lifecycle
   ├─ owns event bus instance
   ├─ owns session/runtime state
   └─ injects ports/capabilities

Core já não contém DI/shared-state/timers/shutdown.
```

### Estado 3 — Core reduzido a folhas sem fan-in

```text
#copilot/core root = 0 consumers
leaf aliases removed as they hit 0
relative Core traversal = 0
```

### Estado 4 — final

```text
src/copilot/core = ABSENT
package aliases  = ABSENT
Core manifest    = ABSENT
replacement hub  = ABSENT
DAG              = GREEN
```

---

## 12. Matriz de risco da execução

| risco                                         | probabilidade             | impacto    | mitigação                                      |
| --------------------------------------------- | ------------------------- | ---------- | ---------------------------------------------- |
| criar `core2/shared/common` por conveniência  | média                     | alto       | invariant explícito + architecture contract    |
| mover globals para Infra sem mudar lifecycle  | alta se migração mecânica | crítico    | instance/process ownership antes do move       |
| quebrar ordering de shutdown/events           | média                     | alto       | regressions causais + state-machine tests      |
| criar ciclos Agent ↔ SDK ↔ Events             | média                     | alto       | graph gate por onda, JSDoc incluído            |
| aumentar cold closure por novos barrels       | média                     | médio/alto | micro-entrypoints + cost ratchet               |
| preservar compat aliases indefinidamente      | alta                      | médio      | deletar alias ao zerar último consumer         |
| corrigir SSRF só no validator e manter TOCTOU | média                     | crítico    | connection-bound resolution test               |
| substituir `toError` root por outro mega-root | alta                      | médio      | owner-local imports + no horizontal errors bag |
| perder semantics de testes indiretos          | média                     | médio      | test-before-delete no owner alvo               |
| service locator reaparecer com outro nome     | média                     | alto       | explicit composition contract                  |

---

## 13. Definition of Done da extinção de Core

A campanha só está concluída quando **todos** os itens abaixo forem verdadeiros simultaneamente:

- [x] `src/copilot/core` não existe fisicamente;
- [x] zero aliases `#copilot/core*` em `package.json`;
- [x] `copilot-core-import-boundaries.json` removido porque se tornou desnecessário;
- [x] zero imports relativos para Core;
- [x] zero JSDoc/type imports para Core;
- [x] zero runtime/service locator/global state relocado sem owner;
- [x] nenhum `shared/common/foundation/kernel/core2` criado como substituto horizontal;
- [x] DI global extinto;
- [x] shared session state global extinto;
- [x] timer/shutdown lifecycle instance/process-owned e cancellation-safe;
- [x] SSRF policy fail-closed e connection-bound;
- [x] redaction cycle/depth/breadth-safe;
- [x] tool permission unknown não pode produzir allow;
- [x] user-input policy preserva explicit false;
- [x] elicitation `oneOf`, defaults e dates corrigidos;
- [x] SDK error/model/elicitation semantics owned pelo SDK/Model Gateway adequados;
- [x] EventBus owned por Events e bound ao runtime;
- [x] I/O contracts/policy owned por Infra;
- [x] schemas/interfaces decompostos por owner;
- [x] structured message owned por Channel/protocol;
- [x] tool target extraction owned por Observability com privacy budgets;
- [x] package-map exactness verde;
- [x] dependency graph 0 cycles / 0 unresolved / 0 parse errors;
- [x] TS7 strict global verde;
- [x] lint/format verdes;
- [x] zero TS suppressions;
- [x] architecture gates verdes;
- [x] focused regressions dos bugs deste documento verdes;
- [x] unit suite Copilot completa verde;
- [x] performance ratchets verdes;
- [x] MCP/runtime readiness verde quando aplicável;
- [x] roadmap atualizado com evidência final;
- [x] working tree final pronta para commit/push coerente.

---

## 14. Decisões arquiteturais recomendadas

### DEC-CORE-01 — Core não será substituído

A extinção é uma decomposição por ownership, não rename.

### DEC-CORE-02 — explicit composition vence generic DI

O default arquitetural é objeto/port/capability explicitamente entregue ao consumer. Container
genérico precisa provar necessidade, não o contrário.

### DEC-CORE-03 — lifecycle é capability owned

Timers, shutdown, retries processuais e resources devem ter owner e cancellation contract. Module
singleton não é lifecycle.

### DEC-CORE-04 — pure primitive e policy não são a mesma coisa

`toError` pode ser neutro; “é fatal?”, “reconnect?”, “trip circuit?” pertencem ao domínio.

### DEC-CORE-05 — security validation precisa controlar a operação real

Anti-SSRF não termina em `URL.safe === true`; a conexão deve obedecer a resolução/policy autorizada.

### DEC-CORE-06 — contracts acompanham seus protocolos

Tool contracts ficam com Tools/SDK, elicitation com SDK session, structured messages com Channel,
I/O com Infra.

### DEC-CORE-07 — tests migram com ownership

Teste que protege comportamento útil vai para o owner destino. Teste que só protege path/compat
antigo é removido junto com o path.

### DEC-CORE-08 — exact entrypoints não justificam leaf explosion

Criar alias para cada arquivo seria outra forma de arquitetura path-based. Entry point só existe
para seam semântico real.

---

## 15. Próxima ação recomendada

A próxima sessão de implementação deve começar pela **Faixa A**, criando o ratchet de não
crescimento e o mapa executável de consumidores, e então entrar nas faixas de menor risco/maior
clareza (**B/C**) antes de tocar DI/lifecycle global.

Não se recomenda iniciar pela exclusão de `core/index.js`, pelo rename da pasta ou por codemod
massivo de imports. Isso apenas deslocaria a dívida e destruiria a oportunidade de corrigir
ownership e bugs durante a campanha.

O indicador correto de progresso será:

```text
Core fan-in ↓
Core symbols ↓
Core files ↓
Core aliases ↓
module-global authority ↓
cycles/unresolved = 0 sempre
owner-local tests ↑
public closure dentro dos ratchets
```

Quando todos os vetores chegarem ao estado-alvo, a remoção física da pasta será uma consequência
pequena de uma transformação arquitetural já concluída.
