# WORKSPACE — `src/copilot/mcp` — Arquitetura 2.4 — auditoria, estado-alvo e roadmap de transformação

**Data:** 23 de agosto de 2026 **Escopo auditado:**
`/workspaces/chatgpt-docker-puppeteer/src/copilot/mcp/**` **Arquitetura normativa:**
`WORKSPACE_ARQUITETURA_2_4_PRINCIPIOS_INVARIANTS_ESTADO_ALVO_GOVERNANCA_2026-08-23.md` **Natureza:**
auditoria e planejamento. **Nenhuma transformação de código/config/teste/alias MCP é executada por
este documento.** **Estado Git da auditoria:** a investigação partiu de `main == origin/main`,
snapshot publicado da extinção de Core/Infra 2.1; as únicas alterações autorizadas nesta rodada são
os dois documentos arquiteturais de 23/08/2026.

### Atualização de execução — checkpoint de publicação de 24/08/2026

A baseline e os checkboxes abaixo permanecem deliberadamente como registro do diagnóstico **antes da
primeira mutação**. A campanha executada posteriormente convergiu materialmente para o estado-alvo
e, no checkpoint de publicação, apresenta as seguintes evidências:

- `control-plane/`, os barrels raiz históricos de MCP, `tools`, `scripts`, adapters e Cloudflare
  foram extintos ou substituídos por owners/membranes físicas exatas; o architecture gate proíbe sua
  reintrodução;
- o catálogo wire permanece em **131 tools / 131 nomes únicos**, com baseline descriptor
  machine-readable preservado;
- protocolo MCP `2026-07-28` e SDK v2 estável são o caminho moderno implementado; o package v1 não
  participa mais do source executável MCP, embora a instalação física antiga tenha sido preservada
  temporariamente para não derrubar a geração viva durante a campanha;
- `OperationContext.workspace` e `AbortSignal` percorrem composition → transport → server → registry
  → operações migradas; HTTP/stdio recusam ausência de workspace authority em vez de recorrer a
  locator;
- `ProcessHost`, process supervision, child-environment projection,
  terminal/jobs/maintenance/reload/benchmarks e Model Gateway possuem lifecycle e authority
  explícitos; wire tools não possuem mais `child_process` authority nem paths físicos de launchers;
- auth/OAuth, observability, validation, protocol/catalog, transport stateful, diagnostics,
  indexing, maintenance, workspace repository/git e Cloudflare possuem owners físicos e
  public/testing membranes coerentes;
- o grafo relativo cross-domain MCP está em **zero** para imports estáticos, dinâmicos e type/JSDoc,
  protegido por ratchet executável;
- repository read/write/index, connection, jobs, runtime-health e latency-attribution tiveram
  business logic retirada do exposure plane; `repo-write.js` voltou para baixo do budget
  arquitetural sem elevar o ceiling;
- patch tooling ganhou recovery evidence reutilizável, causal-failure telemetry e validação de JSON
  antes do publish atômico;
- a investigação de latência confirmou que o maior custo percebido entre tools está fora dos
  handlers MCP; internamente, scans serializados de milhares de validator artifacts também foram
  encontrados e corrigidos com IO bounded-concurrent e uma health path barata;
- no checkpoint final, a suíte unitária Copilot passa **7117 testes, 0 falhas, 28 pendentes
  esperados**; TS7 strict, lint, Prettier, docs e architecture são gates obrigatórios de publicação.

Pendências deliberadamente **fora deste commit**: promoção/reload controlado da geração MCP viva,
verificação do connector real após a promoção e remoção física do SDK v1 extraneous somente depois
de comprovar que o replacement path está saudável. Essas pendências não são shims de source nem
dívida arquitetural escondida; são o boundary operacional necessário para não derrubar o próprio
conector usado na transformação.

---

## 0. Conclusão executiva

`src/copilot/mcp` é funcionalmente robusto em várias áreas e arquiteturalmente uma das regiões mais
antigas do Copilot. A pasta acumulou gerações de funcionalidade sob uma topologia que já não
expressa ownership, lifecycle e authority com a precisão exigida pela Arquitetura 2.4.

A conclusão principal permanece:

> **MCP não deve ser reorganizado como `control-plane/` + `tools/` + `adapters/` com barrels
> melhores. O estado-alvo 2.4 decompõe o domínio em owners reais — protocol/catalog, transport,
> auth, workspace operations, process operations, diagnostics, Cloudflare e integrations — ligados
> por public membranes físicas, exact surfaces e composição hierárquica.**

A auditoria cobre os **158 arquivos JavaScript**, aproximadamente **62.490 LOC**, ~2,55 MiB, a ampla
cobertura unitária existente e a surface wire de **131 tools**. No snapshot auditado, `tools/` é a
maior massa (~21,7k LOC), seguida de `control-plane/` (~17k), `cloudflare/` (~9k), `scripts/`
(~6,4k) e adapters (~4,2k). Portanto a campanha não é “quebrar control-plane”; são pelo menos quatro
massas arquiteturais que precisam convergir para owners reais.

A 2.4 adiciona achados que mudam a ordem de execução:

1. o SDK v1 já entrega `RequestHandlerExtra.signal`, `authInfo`, `sessionId`, `_meta` e `requestId`,
   mas o registry atual descarta esse contexto;
2. o timeout de tool é cosmético: responde ao caller sem cancelar necessariamente o trabalho;
3. sessões podem ser marcadas `terminated` antes de `transport.close()`/`server.close()` terminarem,
   e rejections assíncronas de close podem não ser observadas;
4. `terminal_exec` combina execução arbitrária com herança integral de `process.env` por default,
   acoplando process authority a secret authority;
5. tools sem schema específico recebem um `outputSchema` permissivo `object({}).passthrough()`, que
   satisfaz formalmente coverage sem descrever semanticamente `structuredContent`;
6. vários internals MCP importam `#copilot/boot`/`application-infra` para localizar
   DB/workspace/runtime, uma inversão de composição/service location;
7. runtime/startup reutiliza wire tool definitions como API interna;
8. scripts fazem parte do runtime real e precisam primeiro perder business logic antes de virarem
   thin launchers;
9. o owner graph precisa incluir dynamic imports, workers e subprocess entrypoints;
10. testes são um consumer arquitetural relevante e precisam de testing surfaces explícitas.

### 0.1 Decisão de modernização MCP

Em 23/08/2026, a revisão estável mais recente da especificação é **MCP `2026-07-28`**. A linha
estável oficial do TypeScript SDK é **v2.0.0**, com `@modelcontextprotocol/core`,
`@modelcontextprotocol/server`, `@modelcontextprotocol/client` e `@modelcontextprotocol/node` em
`2.0.0`; `@modelcontextprotocol/codemod` também está em `2.0.0`. A upstream declara v2 como stable
release line e a revisão 2026-07-28 como implementada em v2.

**Decisão canônica da campanha:** quando transformações de código forem autorizadas, a primeira
mudança mutante, depois de um checkpoint machine-readable do estado atual, será migrar para a
**versão estável mais recente disponível naquele momento**, não continuar refatorando longamente
sobre SDK v1. No início da execução será obrigatório reconsultar npm/upstream; `2.0.0` é o snapshot
de 23/08/2026, não um pin eterno.

A migração terá dois passos próximos, mas explicitamente distintos:

1. `@modelcontextprotocol/sdk` v1 → packages v2 estáveis;
2. opt-in explícito do wire protocol `2026-07-28`.

A documentação oficial v2 deixa claro que instalar v2, por si só, não coloca bytes 2026 no wire para
um server construído no estilo antigo. Portanto ambos os passos precisam de gates próprios.

### 0.2 ChatGPT/OpenAI é um gate independente

A documentação OpenAI atual ainda exemplifica o package monolítico `@modelcontextprotocol/sdk`,
embora o upstream MCP já declare v2 estável. Isso não prova incompatibilidade com v2; prova que
**upstream stability e ChatGPT host interoperability são contratos diferentes**.

A primeira onda mutante deve, portanto, validar no connector real:

- discovery/handshake ou modern request path aplicável;
- Scan Tools/tool metadata;
- OAuth linking/reauthorização;
- tool calls read/write;
- structured results;
- reconnect/reload;
- Cloudflare path.

Se o host exigir comportamento 2025, será criado um **compatibility adapter estreito e temporário**
na linha v2, com consumer identificado e exit condition. A arquitetura não ficará ancorada em v1.

### 0.3 Disciplina operacional

Durante transformação, validações são focalizadas ao máximo. Suites globais extensas ficam para
phase barriers e grandes commit/push checkpoints. O objetivo é aumentar informação por unidade de
tempo sem sacrificar correctness.

## 1. Método e cobertura da auditoria

A auditoria foi executada contra a gramática Arquitetura 2.4 já escrita antes de iniciar a análise
MCP.

### 1.1 Leitura integral

Foram lidos/parsing AST de todos os 158 módulos JS atuais, coletando por arquivo:

- path físico;
- LOC/bytes;
- imports/reexports;
- exports/functions/classes;
- fan-in interno;
- consumers;
- mutable top-level bindings;
- `process.env` reads;
- Node built-ins;
- external packages;
- top-level side-effect patterns;
- comments/module role.

**Resultado:** 158/158 parseados, zero parse errors.

### 1.2 Análises adicionais

Também foram examinados:

- package aliases MCP;
- first-level dependency graph;
- cross-domain inbound/outbound imports;
- process state/timers/listeners;
- reset/test controls;
- filesystem/process/network access;
- raw `process.env` usage;
- OAuth/auth/security flows;
- tool registry/contracts/authorization;
- sessionful HTTP lifecycle;
- jobs/subprocess supervision;
- Cloudflare owners;
- scripts versus reusable runtime logic;
- suites MCP existentes;
- documentos arquiteturais MCP de junho/agosto de 2026;
- estado atual do protocolo/SDK oficial MCP.

### 1.3 O que não foi feito

Nesta auditoria **não** foram:

- movidos arquivos;
- alterados aliases;
- alteradas tools;
- corrigidos bugs;
- atualizados packages;
- criados public entrypoints MCP;
- alterados tests/contracts;
- reiniciados serviços por mudança de código.

---

## 2. Baseline física atual

### 2.1 Diretórios atuais

```text
mcp/
├─ adapters/           8 arquivos
├─ cloudflare/        31 arquivos
├─ connection/         2 arquivos
├─ control-plane/     37 arquivos
│  └─ persistence/
├─ openai/             3 arquivos
├─ runtime/            1 arquivo
├─ scripts/           19 arquivos
├─ tools/             53 arquivos
│  └─ shared/
├─ cli.js
├─ index.js
├─ registry.js
├─ server.js
├─ tool-surface.js
└─ README.md
```

Não existe atualmente **nenhuma pasta física `public/` dentro de MCP**.

### 2.2 Aliases MCP atuais

```text
#copilot/mcp
#copilot/mcp/adapters
#copilot/mcp/cloudflare
#copilot/mcp/connection
#copilot/mcp/control-plane
#copilot/mcp/openai
#copilot/mcp/scripts
#copilot/mcp/tools
#copilot/mcp/tools/shared
```

Todos são barrels relativamente amplos; não existe namespace de exact public owners.

### 2.3 Uso dos broad aliases dentro do próprio MCP

No snapshot auditado:

- `#copilot/mcp/control-plane`: **68** importers MCP;
- `#copilot/mcp/cloudflare`: **21**;
- `#copilot/mcp/connection`: **7**;
- `#copilot/mcp/tools/shared`: **4**;
- `#copilot/mcp/tools`: **1**.

O domínio internalizou os próprios barrels como mecanismo de arquitetura. A 2.4 precisa inverter
isso: **sibling owner imports passam por public exact surfaces; internals de um owner usam seus
private paths relativos.**

### 2.4 Inbound/outbound em relação ao restante do Copilot

Um fato positivo para a futura transformação:

- **zero production imports encontrados de outros domínios `src/copilot/**` para MCP** no snapshot
  AST auditado;
- MCP possui dezenas de outbound imports para Infra/Boot/SDK/Tools/Model Gateway etc.

Isso torna possível redesenhar profundamente a topologia interna MCP com risco relativamente baixo
de quebrar consumers de código internos. O contrato externo crítico não é o import API atual: é a
**wire surface MCP/OAuth/Cloudflare + 131 tool names/schemas/authority**.

---

## 3. O grafo atual

### 3.1 First-level dependency graph atual

Edges relativos aproximados entre pastas MCP:

```text
ROOT
 ├──> adapters
 ├──> cloudflare
 ├──> connection
 ├──> control-plane
 ├──> openai
 ├──> scripts
 └──> tools

adapters ──28──> control-plane
adapters ──────> runtime / connection / ROOT

control-plane ──12──> ROOT

runtime ──> tools / cloudflare / control-plane

scripts ──> control-plane / ROOT

tools ──66──> ROOT
tools ──15──> control-plane
tools ──────> cloudflare / scripts / runtime
```

O grafo global do repo continua sem cycles no gate 2.1, mas o **ownership graph MCP é semanticamente
invertido**: root e `control-plane` exercem papéis de dependency hub que não correspondem a owners
sólidos.

### 3.2 `control-plane/` como “Core funcional”

O nome sugere um owner, mas a pasta mistura:

- resource-server auth;
- authorization server/dev issuer;
- OAuth persistence/replay;
- jobs/validators;
- terminal process control;
- generic HTTP client;
- metrics;
- latency history/analytics;
- paths;
- MCP 2025 sessions/event replay/streams;
- schema convergence;
- index startup;
- dependency maintenance;
- audit log;
- reload state;
- smoke state;
- TTL cache primitive.

Não existe invariant único capaz de justificar esse conjunto como owner.

**Decisão alvo:** `control-plane/` deve desaparecer, não ganhar `public/`.

### 3.3 `registry.js` como segundo hub

`registry.js` hoje concentra:

- definição do type `McpToolDefinition`;
- montagem do catálogo;
- cache do catálogo;
- surface policy;
- validation;
- descriptor enrichment;
- heurística de risk;
- result size validation;
- rate limiting;
- timeout de handlers;
- OAuth scope enforcement via metadata;
- registration no SDK server;
- manifest/status;
- binding de providers globais para diagnostics.

O fan-in 92 é consequência, não justificativa de ownership.

**Decisão alvo:** `registry.js` será decomposto; o Tool Contract ficará **abaixo** do catálogo e das
tool adapters.

---

## 4. Baseline da surface wire

A surface canônica atual tem **131 tools**.

Após enrichment do registry:

- 93 descriptors `readOnlyHint=true`;
- 8 `destructiveHint=true`;
- scopes expostos:
  - 87 `repo:read`;
  - 9 `repo:validate`;
  - 20 `repo:write`;
  - 13 `repo:admin`;
  - 2 tools públicas OAuth anunciam `noauth` + `repo:read`.

### INV-MCP-01 — wire stability durante transformação

A reorganização física não autoriza mudança acidental de:

- tool name;
- title/description material quando cliente depende;
- input/output schema;
- `_meta`/security schemes;
- scope;
- tool semantics;
- error/result contract;
- resource URI;
- OAuth metadata;
- public MCP URL.

Antes da execução, o descriptor manifest atual deve virar baseline machine-readable. Mudança
intencional exige decisão separada e teste de compatibilidade.

---

## 5. Baseline protocol/SDK e estratégia de migração imediata

### 5.1 Estado atual do repo

O snapshot auditado usa:

- `@modelcontextprotocol/sdk@1.30.0`;
- package monolítico v1;
- wire `2025-11-25`;
- Streamable HTTP sessionful;
- `initialize` / `notifications/initialized`;
- `Mcp-Session-Id`;
- event replay / stream registry;
- schema/list-changed convergence;
- imports diretos do SDK espalhados por múltiplos módulos MCP.

### 5.2 Estado estável oficial em 23/08/2026

- specification: **`2026-07-28`**;
- TypeScript SDK stable line: **v2**;
- npm snapshot confirmado nesta auditoria:
  - `@modelcontextprotocol/core@2.0.0`;
  - `@modelcontextprotocol/server@2.0.0`;
  - `@modelcontextprotocol/client@2.0.0`;
  - `@modelcontextprotocol/node@2.0.0`;
  - `@modelcontextprotocol/codemod@2.0.0`.

Upstream v2 implementa `2026-07-28`, e v1 fica em maintenance/security por janela de transição. A
revisão 2026 traz core stateless, self-describing requests, optional `server/discover`, header-based
routing, cacheable deterministic lists, authorization hardening e extensions framework.

Referências oficiais:

- <https://blog.modelcontextprotocol.io/posts/2026-07-28/>
- <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/ROADMAP.md>
- <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md>
- <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md>
- <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/VERSIONING.md>
- <https://developers.openai.com/plugins/build/mcp-server>
- <https://developers.openai.com/plugins/build/auth>
- <https://developers.openai.com/plugins/deploy/app-review>

### 5.3 Decisão canônica: migrar na primeira onda mutante

Não executar meses de decomposição sobre v1. Ordem:

```text
baseline machine-readable 2025/v1
        ↓
upgrade SDK packages para latest stable v2
        ↓
focused compile/contracts
        ↓
opt-in explícito MCP 2026-07-28
        ↓
ChatGPT/Cloudflare/OAuth interop gate
        ↓
compat-2025 somente se consumer real exigir
        ↓
transformação arquitetural 2.4 já sobre a linha moderna
```

No momento da execução, reconsultar versões (`npm view`/upstream). Se existir v2.x estável posterior
a 2.0.0, adotar o latest stable, salvo incompatibilidade concreta documentada.

### 5.4 Codemod é assistente, não autoridade

A upstream recomenda `@modelcontextprotocol/codemod` para v1→v2. Ele deve ser executado primeiro em
modo de inspeção/dry-run ou branch/checkpoint controlado, com revisão humana/LLM de cada classe de
mudança. Não aceitar mechanical rewrite que viole owner target, aliases, JSDoc ou contracts.

### 5.5 SDK migration e wire migration são distintos, mas consecutivos

O guide oficial afirma que v2 pode continuar servindo 2025 se o código não optar pelo novo handler.
Esse fato é útil para bisectar regressão, **não** para justificar uma longa fase intermediária.

Checkpoint 1 prova package/API v2; checkpoint 2 prova wire 2026. Ambos pertencem à primeira onda.

### 5.6 Compatibilidade 2025

Session runtime/store/event replay/stream registry só permanecem se ChatGPT/outro client suportado
demonstrar necessidade. Se necessário, vivem sob `transport/http/compat-2025/**`, com:

- consumer identificado;
- telemetry/probe de uso;
- zero new feature development;
- no dependency from modern core back to compat;
- exit condition objetiva.

### 5.7 OpenAI plugin contract

OpenAI trata tool names, titles, descriptions, schemas, annotations e resultados estruturados como
comportamento user-facing. Published plugin breaking changes não são suportadas como mutação direta
do mesmo contract. Portanto manter baselines independentes de:

1. MCP wire/protocol;
2. Tool Contract/catalog;
3. OpenAI Scan Tools/metadata snapshot;
4. OAuth/client interoperability.

A migração 2026 não autoriza renomear ou incompatibilizar as 131 tools incidentalmente.

## 6. Achados prioritários: bugs, security gaps e architecture gaps

A prioridade abaixo é de **ordem de correção**, não apenas severidade de vulnerabilidade.

### MCP-P0-01 — registry descarta `RequestHandlerExtra` já disponível no SDK atual

O TypeScript SDK v1 instalado já chama tool callbacks com `args, extra`. `extra` contém ao menos
`signal`, `authInfo`, `sessionId`, `_meta` e `requestId`. O wrapper atual aceita essencialmente
apenas `args`, descartando contexto oficial antes de chegar ao handler.

**Consequência:** cancellation, identidade e correlation disponíveis no protocolo não alcançam as
operations.

**Alvo:** `OperationContext`/`McpToolInvocationContext` deriva diretamente do SDK request context e
é propagado até operações reais.

### MCP-P0-02 — timeout do registry é cosmético

`Promise.race()` retorna timeout sem necessariamente cancelar filesystem, git, network ou subprocess
work. Depois de P0-01, timeout e caller cancellation devem abortar a mesma signal tree.

### MCP-P0-03 — session lifecycle declara termination antes do close real

`session-runtime` remove/incrementa `terminated` e chama close fire-and-forget. Async rejection pode
não ser observada. Há padrão semelhante em cleanup HTTP.

**Alvo:** `active → closing → closed|close_failed`, close awaited/bounded, métricas e resource
drain.

### MCP-P0-04 — terminal authority implica secret inheritance por default

`terminal_exec` é intencionalmente arbitrary execution, mas `inheritEnv=true` combina isso com todo
o ambiente do processo MCP, potencialmente contendo Cloudflare/OAuth/provider tokens.

**Alvo:** separar `ProcessExecutionCapability` de credential/secret capability. Default child env
mínimo/operacional; credentials entram explicitamente quando operação as exige.

### MCP-P0-05 — output schema baseline é semanticamente permissivo

Tools sem schema específico recebem `z.object({}).passthrough()`. Isso cria um contrato formal que
aceita quase qualquer `structuredContent`.

**Alvo:** output schema específico e fiel quando structured data é publicada; ausência explícita de
schema quando não houver contrato estruturado. Coverage numérica nunca substitui truthfulness.

### MCP-P0-06 — internals usam `boot` como service locator

`event-store`, `session-store`, `oauth-replay-store`, analytics/index/artifacts/runtime-health/LLM-B
e outros importam `#copilot/boot`/`application-infra` para localizar DB/workspace/runtime.

**Alvo:** `application boot → mcp/composition → owner dependencies`. Internals recebem
ports/capabilities; não sobem ao boot.

### MCP-P0-07 — wire tools são reutilizadas como APIs internas

Startup/runtime importa tool definitions (`smoke-workspace`, `llm-b-live` etc.) para executar
lógica.

**Alvo:** operation/service é inferior; wire tool e startup chamam a operation. Nunca runtime→tool.

### MCP-P0-08 — OAuth issuer diagnostics possui DNS TOCTOU/SSRF gap

Há path diagnostic que resolve hostname para validar e depois usa fetch que pode resolver novamente.
O endereço validado não fica necessariamente bound ao socket conectado. O próprio dev OAuth já
possui patterns melhores connection-bound.

**Alvo:** outbound diagnostic network capability connection-bound e fail-closed.

### MCP-P1-09 — authority de tool ainda depende parcialmente de heurística metadata/nome

Scopes reais são derivados de annotations/naming em certos caminhos. ToolAnnotations devem ser
projection de internal effects/authority explícitos; heuristic fica lint apenas.

### MCP-P1-10 — OAuth initial scopes defaultam para max-power e diagnostics premiam isso

Per-tool `securitySchemes` é mais estreito, mas initial authorization pede read/write/validate/admin
por default e score de autonomy considera isso superior.

**Alvo:** decidir explicitamente entre minimal initial scopes + step-up/reauthorization e um
compatibility profile max-power se o host exigir. Nunca tratar max-power como good practice
universal.

### MCP-P1-11 — validator jobs não supervisionam process tree de forma completa

SIGTERM no child imediato sem garantia de process-group + forced escalation pode deixar
grandchildren.

### MCP-P1-12 — catalog assembly muta providers globais

`bind*Provider` transforma montagem de catálogo em composition side effect. Catalog deve ser
pure/deterministic para dependencies recebidas.

### MCP-P1-13 — `control-plane/` não é owner

Mistura auth, issuer, jobs, terminal, HTTP, metrics, sessions, persistence, caches e maintenance.
Deve desaparecer por extração, não ganhar `public/`.

### MCP-P1-14 — HTTP common mistura protocolo, security, config e composition

`http-shared.js` permanece um multi-owner collapse. Separar common request/security/timing de era
adapter e server composition.

### MCP-P1-15 — scripts são runtime owners escondidos

Jobs/tools chamam scripts como implementation. Extrair reusable behavior primeiro; scripts terminam
como thin entrypoints.

### MCP-P1-16 — process/env configuration está espalhada

A inspeção encontrou aproximadamente **215 referências textuais a `process.env`** nas subárvores MCP
(74 control-plane, 34 tools, 33 Cloudflare, 32 scripts, 26 adapters, 12 connection, 3 runtime, 1
OpenAI). Nem toda ocorrência é leaf indevido; o volume demonstra ausência de config snapshot
universal.

### MCP-P1-17 — child-process ownership está fragmentado

`spawn`/`execFile` aparecem em control-plane, Cloudflare, scripts e tools. Convergir semantics de
cancellation, output bounds, process-group, escalation e completion sem criar `process-utils` bag.

### MCP-P1-18 — dynamic dependency edges escapam do graph simples

Existem imports construídos dinamicamente e runtime→script entrypoints por string. Owner graph/gates
precisam cobrir esses caminhos.

### MCP-P1-19 — tests ainda dependem de broad/private surfaces

Muitos testes importam `#copilot/mcp/control-plane`, `#copilot/mcp/tools`, broad barrels ou private
relative files. Testing é consumer arquitetural e deve migrar junto com cada owner.

### MCP-P1-20 — SDK imports estão espalhados

A migração v2 deve centralizar SDK concerns em protocol/transport/catalog boundaries sem criar um
novo mega-adapter.

### MCP-P1-21 — `schema-convergence` é compat-era-specific

List-changed/initialize/session assumptions pertencem ao compatibility owner 2025, não ao modern
core.

### MCP-P1-22 — dev OAuth 4,3k LOC mistura state machines

Decompor por transaction/invariant: metadata, authorization/PAR, token/refresh, clients, crypto,
replay/persistence, DPoP/private_key_jwt e HTTP routing. Split só depois de regression contracts.

### MCP-P2-23 — `terminal-control` duplica `maxExecOutputBytes`

Bug estrutural pequeno e objetivo; corrigir junto da reconstrução do process contract.

### MCP-NOT-BUG-01 — HTTP finish/close double registration

Metrics possui guards; não classificar como double-count sem evidência nova.

### MCP-NOT-BUG-02 — CIMD/JWKS robusto em dev OAuth já é connection-bound

Não generalizar o DNS TOCTOU para esse path. O gap está no diagnostic fetch separado.

### MCP-NOT-BUG-03 — OAuth redirect `iss` principal está presente

Sucesso e error redirects validados já incluem `iss`. Manter conformance test para **todas** as
classes de authorization response porque OpenAI exige issuer exact-match inclusive em errors.

## 7. Config, state, composition e lifecycle audit

### 7.1 Mutable/process state

Há múltiplos top-level maps/registries/timers/caches. Classificar cada caso em:

1. immutable/lazy cache seguro;
2. process-owned resource legítimo;
3. bounded diagnostic cache;
4. ambient dependency injection indevida;
5. compatibility transport state;
6. testing control vazando para runtime.

### 7.2 Ambient configuration

As ~215 referências textuais a `process.env` não significam 215 bugs, mas mostram que config
ownership não está consolidado. Composition/config owners devem produzir `McpProcessConfig` e
projections.

### 7.3 Service-location inversion

Imports de `#copilot/boot`/`application-infra` dentro de internals MCP são um blocker independente
da organização de pastas. DB, workspace IO, clock, HTTP/process capabilities e runtime views devem
ser injetados no menor composition root legítimo.

### 7.4 Lifecycle truthfulness

Sessions, jobs, terminals, monitors e background work devem usar estado terminal somente depois de
close/exit/drain observado. `void close()` e `Promise.race` sem cancellation são explicitamente
proibidos no target.

### 7.5 MCP Process Host alvo

```text
McpProcessHost
├─ immutable config snapshot
├─ tool catalog
├─ auth resource server
├─ optional dev issuer
├─ modern transport adapters
├─ temporary compat-2025 adapters, se necessários
├─ owned scheduler/monitors
├─ process/validator/terminal operations
├─ diagnostics views
└─ dispose()/asyncDispose()
```

O host usa ProcessInfra e injected ports; não recria Infra nem é service locator para leaves.

## 8. Tool Contract 2.4 alvo

O contract interno fica **abaixo** de catalog, SDK adapter e wire tool definitions.

Conceitualmente:

```js
{
  name,
  title,
  description,
  inputSchema,
  outputSchema,
  authority: {
    requiredScopes,
    anonymousAllowed,
    credentialNeeds
  },
  effects: {
    workspaceMutation,
    processControl,
    externalNetwork,
    destructive,
    idempotency
  },
  execution: {
    timeoutClass,
    resultBudget,
    concurrencyClass,
    cancellationRequired
  },
  handler(args, operationContext)
}
```

`operationContext` recebe/projeta do SDK:

- `AbortSignal`;
- request ID/correlation;
- authInfo/validated principal;
- session/request metadata quando a era expuser;
- protocol era;
- deadline/budget remanescente;
- result budget;
- explicit capabilities necessárias.

### INV-MCP-03 — authority não vem de descriptor heuristic

ToolAnnotations, OpenAI metadata e `securitySchemes` são projections de effects/authority internos.

### INV-MCP-04 — output schema é verdadeiro

Se a tool publica structuredContent contractual, schema deve modelá-lo. Proibido usar permissive
passthrough apenas para aumentar coverage.

### INV-MCP-05 — catalog build não faz composition

Catalog assembly é pure/deterministic para dependencies/config recebidas. Zero `bindProvider()`.

### INV-MCP-06 — cancellation chega à operação real

SDK request signal, timeout/deadline e explicit cancellation compõem uma única árvore; adapters não
podem descartá-la.

### INV-MCP-07 — wire tool é leaf adapter

Runtime/startup/diagnostics nunca chamam tool definition para reutilizar business logic.

## 9. Public membrane MCP 2.4

### 9.1 Regra

**Mesmo dentro do domínio MCP, siblings owners não fazem deep/private import entre si.**

Exemplo físico:

```text
mcp/
└─ auth/
   └─ resource-server/
      ├─ public/
      │  └─ index.js
      ├─ verification/
      ├─ scopes/
      └─ service.js
```

Alias:

```text
#copilot/mcp/public/auth/resource-server
```

Um sibling `transport/http` usa esse alias. Internals do resource-server usam relative imports
privados.

### 9.2 Public surfaces candidatas

A lista final será consumer-driven, mas o target provavelmente precisará de exact surfaces
semelhantes a:

```text
#copilot/mcp/public/protocol/tools
#copilot/mcp/public/catalog
#copilot/mcp/public/auth/resource-server
#copilot/mcp/public/auth/issuer
#copilot/mcp/public/transport/http
#copilot/mcp/public/operations/validators
#copilot/mcp/public/operations/terminal
#copilot/mcp/public/diagnostics/metrics
#copilot/mcp/public/diagnostics/connection
#copilot/mcp/public/cloudflare/config
#copilot/mcp/public/cloudflare/remote
#copilot/mcp/public/cloudflare/edge
#copilot/mcp/public/integrations/openai
#copilot/mcp/public/workspace/repository
```

**Não criar todos upfront.** Criar quando o primeiro legítimo cross-owner consumer for migrado.

### 9.3 Audiences

Quando necessário:

- runtime;
- composition;
- diagnostic;
- testing.

Resolver injection, reset controls, fake clocks e raw live-session state nunca pertencem à runtime
public membrane.

---

## 10. Estado-alvo físico MCP

A árvore abaixo é uma arquitetura de owner, não uma promessa de que toda pasta deverá existir no
primeiro commit.

```text
mcp/
├─ README.md
├─ composition/
│  ├─ process/
│  │  ├─ config/
│  │  ├─ startup/
│  │  └─ monitors/
│  ├─ server/
│  └─ cli/
├─ protocol/
│  ├─ server/
│  ├─ tools/
│  │  ├─ contracts/
│  │  ├─ annotations/
│  │  ├─ results/
│  │  └─ metadata/
│  └─ resources/
├─ catalog/
│  ├─ public/
│  ├─ assembly/
│  ├─ validation/
│  ├─ execution/
│  ├─ surface-policy/
│  ├─ compat-2025/
│  │  └─ convergence/
│  └─ diagnostics/
├─ transport/
│  ├─ stdio/
│  └─ http/
│     ├─ common/
│     │  ├─ request/
│     │  ├─ security/
│     │  ├─ cors/
│     │  ├─ rate-limit/
│     │  └─ timing/
│     ├─ compat-2025/
│     │  ├─ router/
│     │  └─ session/
│     │     ├─ runtime/
│     │     ├─ store/
│     │     ├─ events/
│     │     └─ streams/
│     └─ modern-2026/
│        ├─ handler/
│        ├─ discovery/
│        ├─ routing/
│        └─ subscriptions/
├─ auth/
│  ├─ resource-server/
│  │  ├─ public/
│  │  ├─ config/
│  │  ├─ verification/
│  │  ├─ scopes/
│  │  ├─ metadata/
│  │  ├─ jwks/
│  │  └─ decision-cache/
│  ├─ issuer/
│  │  ├─ public/
│  │  ├─ http/
│  │  ├─ authorization/
│  │  ├─ token/
│  │  ├─ refresh/
│  │  ├─ clients/
│  │  │  ├─ cimd/
│  │  │  └─ dcr-legacy/
│  │  ├─ crypto/
│  │  ├─ replay/
│  │  ├─ persistence/
│  │  └─ policy/
│  └─ diagnostic/
├─ workspace/
│  ├─ repository/
│  │  ├─ read/
│  │  ├─ write/
│  │  │  ├─ patch/
│  │  │  ├─ batch/
│  │  │  ├─ quarantine/
│  │  │  └─ validation/
│  │  ├─ plan/
│  │  ├─ status/
│  │  ├─ working-set/
│  │  └─ index/
│  ├─ git/
│  └─ artifacts/
├─ operations/
│  ├─ validators/
│  │  └─ jobs/
│  ├─ terminal/
│  ├─ restart/
│  ├─ maintenance/
│  └─ dependencies/
├─ diagnostics/
│  ├─ connection/
│  ├─ latency/
│  ├─ runtime-health/
│  ├─ round-trip/
│  ├─ smoke/
│  ├─ host/
│  ├─ devcontainer/
│  └─ catalog/
├─ cloudflare/
│  ├─ config/
│  ├─ connector/
│  ├─ tunnel/
│  ├─ remote/
│  ├─ edge/
│  │  ├─ policy/
│  │  ├─ audit/
│  │  ├─ snapshot/
│  │  └─ backup/
│  ├─ metrics/
│  └─ transport-benchmark/
├─ integrations/
│  ├─ openai/
│  └─ model-gateway/
├─ tools/
│  ├─ workspace/
│  ├─ git/
│  ├─ operations/
│  ├─ diagnostics/
│  ├─ cloudflare/
│  ├─ integrations/
│  └─ meta/
└─ scripts/
   └─ thin launchers only
```

### 10.1 O destino das pastas atuais

| pasta atual      | avaliação                                                         | destino 2.4                                                                   |
| ---------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| root MCP         | contém server/registry/composition/surface juntos                 | reduzir drasticamente; idealmente README + entry/composition mínimo           |
| `adapters/`      | nome genérico; HTTP common + 2025 stateful + launchers misturados | desaparecer em favor de `transport/` + `composition/`                         |
| `cloudflare/`    | domínio real, mas root muito flat                                 | **preservar domínio**, decompor owners internos + public exact surfaces       |
| `connection/`    | diagnostic/config projection pequena                              | absorver em `diagnostics/connection`                                          |
| `control-plane/` | não é owner; funciona como Core horizontal                        | **desaparecer**                                                               |
| `openai/`        | owner/integration pequeno e coerente                              | mover para `integrations/openai`                                              |
| `runtime/`       | hoje contém apenas startup maintenance                            | absorver em `composition/process`                                             |
| `scripts/`       | mistura launcher e reusable implementation                        | manter somente thin launchers                                                 |
| `tools/`         | 53 arquivos, muitos com business logic                            | manter como **wire exposure plane**, agrupar famílias e tornar adapters finos |
| `tools/shared/`  | shared genérico                                                   | **desaparecer**; git logic vai para owner `workspace/git`                     |

---

## 11. Grafo ideal

```text
                         ┌──────────────────────┐
                         │     composition      │
                         │ process/server/cli   │
                         └──────────┬───────────┘
                                    │ wires
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌──────────────┐           ┌─────────────────┐         ┌─────────────────┐
│  transport   │           │      auth       │         │     catalog     │
│ stdio / http │           │ resource/issuer │         │ tools/resources │
└──────┬───────┘           └────────┬────────┘         └────────┬────────┘
       │ public                     │ public                    │ public
       └──────────────┬─────────────┴──────────────┬────────────┘
                      ▼                            ▼
              ┌──────────────┐             ┌───────────────┐
              │   protocol   │             │     tools     │
              │ contracts    │             │ wire adapters │
              └──────────────┘             └───────┬───────┘
                                                  │ public capabilities
                       ┌──────────────────────────┼──────────────────────────┐
                       ▼                          ▼                          ▼
                 workspace/*                operations/*             diagnostics/*
                       │                          │                          │
                       └──────────────┬───────────┴──────────────┬──────────┘
                                      ▼                          ▼
                                cloudflare/*             integrations/*
                                      │                          │
                                      └─────────────┬────────────┘
                                                    ▼
                                              Infra public APIs
```

Regras:

- siblings só cruzam via `public/`;
- protocol não depende de catalog/transport;
- tool adapter depende de service public, não o contrário;
- composition conhece concrete owners;
- diagnostics não ganha authority de mutation por observar;
- compat-2025 não contamina modern-2026;
- SDK packages ficam nas wire boundaries.

---

## 12. OAuth/auth estado-alvo

### 12.1 Resource server separado do dev issuer

Resource server: protected-resource metadata, bearer verify, issuer/audience/resource/scopes,
JWKS/cache, auth binding e WWW-Authenticate projection.

Issuer: authorization metadata, authorization/PAR, token/refresh, clients, crypto/JWKS,
DPoP/private_key_jwt, replay/persistence e request budgets.

### 12.2 CIMD versus DCR

CIMD é caminho canônico. DCR, se ChatGPT/client real ainda utilizar, fica em explicit compat owner,
com usage evidence e exit condition. OpenAI atualmente informa que ChatGPT prioriza CIMD quando
disponível, mas o plugin builder ainda pode selecionar DCR quando ambos existem.

### 12.3 Initial scopes: decisão explícita, não score de poder

Per-tool `securitySchemes` continuam estreitos. Para initial authorization:

1. preferir minimal scopes + reauthorization/step-up se a UX do host for confiável;
2. se ChatGPT exigir max-power para operação estável, manter um **documented compatibility
   profile**;
3. remover score/health assumption de que max-power é intrinsecamente melhor;
4. testar reauthorization com novos scopes e `id_token_hint` quando OIDC for usado.

### 12.4 RFC 9207 / issuer exactness

Authorization server metadata só anuncia `authorization_response_iss_parameter_supported: true` se
**toda** success/error authorization response relevante inclui `iss` exatamente igual ao issuer.
Regression suite cobre redirect successes e errors.

### 12.5 SSRF/network

Remote metadata/JWKS/diagnostic fetches precisam de connection-bound network policy. Reusar
primitive inferior quando semantics forem iguais; não transformar auth em owner de generic network.

## 13. HTTP transport estado-alvo

### 13.1 Common

Somente concerns realmente comuns:

- authority/host parsing;
- body/result bounds;
- CORS/security headers;
- request correlation;
- rate limit primitive;
- timing;
- auth context projection.

### 13.2 Compat 2025 — somente se requerido por consumer real

- initialize;
- `Mcp-Session-Id`;
- session runtime/store;
- stream/event replay;
- schema convergence/list changed;
- compatibility smoke.

### 13.3 Modern 2026

- stateless request handling;
- request `_meta` context;
- `server/discover`;
- `Mcp-Method/Mcp-Name` routing;
- cache hints;
- modern subscriptions;
- MRTR quando realmente necessário.

### 13.4 No new dependency on deprecated features

Roots/sampling/logging não devem ganhar novos owners/capabilities sem necessidade concreta enquanto
a spec 2026 os mantém deprecated.

---

## 14. Workspace/repository tools

### 14.1 `repo-write`

Decomposição por invariants, não por LOC:

- target resolution/authority;
- diff preview;
- patch plan;
- patch batch execution;
- file batch preflight;
- quarantine metadata/store;
- quarantine restore/remove;
- post-patch validators;
- result compaction.

Quarantine é um child owner do repository write lifecycle, não uma generic MCP persistence feature.

### 14.2 `repo-read`

Separar:

- read/file stats;
- search;
- bulk orchestration;
- result budgeting;
- cache/working set quando lifecycle distinto.

### 14.3 Tools wire

`repo_*` tool files finais só definem schemas/descriptors e chamam
`workspace/repository/public/...`.

---

## 15. Jobs e terminal

### 15.1 Owner comum apenas se provado

Jobs e terminal possuem semelhança em process control, mas lifecycle/user interaction/log semantics
são diferentes. Não criar `process-utils` automaticamente.

Um owner inferior de `owned-process` só é legítimo se puder fornecer:

- spawn;
- stdout/stderr bounded capture;
- AbortSignal;
- process-group kill;
- grace→SIGKILL escalation;
- exit promise;
- resource snapshot hooks;

sem saber “validator” ou “terminal”.

### 15.2 Terminal

Terminal sessions continuam process resources com:

- max sessions;
- bounded event buffer;
- explicit close/forget;
- process tree control;
- PTY optional adapter;
- lifecycle host.

Test-only node-pty injection/lazy controls devem ficar testing-only.

---

## 16. Cloudflare

Cloudflare é um domínio legítimo e não deve ser fragmentado para fora de MCP apenas porque possui 31
arquivos. O problema é o root flat.

Target owners:

- config;
- connector smoke;
- tunnel process/runtime/origin;
- remote API client;
- edge routes/policy/audit/snapshot/backup/skip;
- metrics/analytics;
- transport benchmark.

Cloudflare writes devem permanecer explicitamente plan/diff/apply com backup/provenance, preservando
a arquitetura já robusta.

---

## 17. Diagnostics

### 17.1 Latency

Hoje a lógica está espalhada entre:

- control-plane metrics/history/round-trip;
- tools latency attribution/dashboard/client evidence;
- scripts benchmark;
- Cloudflare analytics;
- OpenAI status/latency.

Target:

```text
diagnostics/latency/
├─ metrics/
├─ attribution/
├─ history/
├─ benchmark/
├─ client-evidence/
└─ public/
```

External status providers ficam adapters/integrations, não dentro do attribution kernel.

### 17.2 Era-awareness

Métricas como “initialize per tool call” são úteis para 2025, mas não existem na era 2026.
Labels/classifiers devem declarar protocol era para evitar conclusions erradas.

---

## 18. Node 24+ oportunidades MCP

O baseline declarado do workspace é Node **>=24.15.0**. Isso importa: features posteriores ao mínimo
não podem ser assumidas sem elevar o engine.

### 18.1 Cancellation/process

- `AbortSignal.timeout`/composition onde semantics forem corretas;
- `child_process.spawn` signal quando útil;
- process-group + escalation explícitos para grandchildren;
- não usar timeout cosmético.

### 18.2 HTTP lifecycle

`server.keepAliveTimeoutBuffer` existe desde Node 24.6 e pode ser usado no baseline atual para
reduzir race de keep-alive quando fizer sentido. Features introduzidas após 24.15, como APIs novas
de request signal, só entram após engine bump ou feature detection.

### 18.3 Async context

`AsyncLocalStorage` somente para correlation (request/tool/protocol/trace), nunca como hidden
authority ou service locator.

### 18.4 Explicit disposal

Avaliar `Symbol.asyncDispose`/`await using` em server/session/process-owned resources quando
simplificar lifecycle sem esconder ownership.

### 18.5 Diagnostics channel

Útil apenas quando fornecer downward-safe observability seam melhor que callback/port explícito.

### 18.6 Streams/backpressure e bounded data

Evitar materialização irrestrita; manter result/body/event budgets mesmo quando streaming for usado.

### 18.7 Permission Model

Pode ser defense-in-depth para runners/CLIs, não sandbox nem substituto de repo/process
capabilities.

### 18.8 Built-ins antes de wrappers por legado

Avaliar `fs.glob`, WebCrypto, fetch/URL/streams e outras APIs Node 24 por semantics, benchmark e
stability — sem dogma.

## 19. Test architecture alvo

A cobertura atual é um ativo e será migrada como consumer arquitetural.

### 19.1 Estado atual

Há dezenas de suites MCP, algumas monolíticas, e muitos imports por broad barrels/private paths.

### 19.2 Estado-alvo

- tool descriptor/OpenAI contract tests separados de operation tests;
- owner-unit tests por owner semântico;
- 2026 modern conformance tests;
- compat-2025 tests somente enquanto adapter existir;
- auth issuer/resource-server tests separados;
- black-box public/wire behavior preferido quando suficiente;
- white-box somente via testing surface explícita;
- zero broad root/control-plane/tool-barrel imports no target;
- descriptor baseline das 131 tools;
- output schema/structuredContent parity tests;
- cancellation/deadline/close-failure regressions;
- child-process leak regressions;
- secret-inheritance tests para process capabilities.

### 19.3 Testing surface

`#copilot/testing/mcp/**` deve ser exact e consumer-driven, não wildcard conceitual para qualquer
internal. Quando owner migra, seus testes e testing controls migram no mesmo checkpoint.

### 19.4 Conformance e host tests

Separar:

1. MCP SDK/spec conformance;
2. OpenAI plugin metadata/Scan Tools snapshot;
3. OAuth flow conformance;
4. real ChatGPT connector smoke;
5. Cloudflare transport/path smoke.

Isso evita concluir “MCP verde” com apenas um dos contratos.

## 20. Cost governance MCP

### INV-MCP-05 — exact public surfaces terão ratchets

Após criar uma surface MCP pública:

- AST closure modules;
- source bytes;
- external packages;
- cold import time;
- RSS;
- import side effects.

Broad barrels atuais não serão “rebaselined como padrão”; eles são baseline histórica de dívida.

### 20.1 Primeiras metas

Não impor números arbitrários antes da decomposição. Contudo:

- contract/protocol surfaces devem tender a `micro`;
- diagnostic pure kernels devem evitar carregar full catalog/server;
- Cloudflare config/route readers não devem carregar LLM-B/Repo/SDK stack;
- tool adapter family não deve importar todas as 131 tools.

---

## 21. Regras específicas da futura execução

1. **Latest-stable first:** depois do baseline, primeira mutação migra SDK v1→latest stable v2.
2. **2026 immediately after package migration:** opt-in wire `2026-07-28` na mesma onda inicial.
3. **Recheck versions at execution time:** `2.0.0` é snapshot de 23/08/2026.
4. **ChatGPT is an independent gate:** upstream green não substitui connector real.
5. **Compat-2025 only by evidence:** consumer, owner, telemetry e exit condition obrigatórios.
6. **Target-first:** criar owner correto antes de mover consumers.
7. **No compatibility barrel:** broad alias morre quando último consumer sai.
8. **No `control-plane2`, `shared`, `common` bags.**
9. **Wire tool is leaf adapter:** business logic vive abaixo.
10. **No auth scope inference silenciosa.**
11. **No permissive fake output schema.**
12. **No timeout without cancellation plan.**
13. **No terminal state before observed close/exit.**
14. **No process execution ⇒ all secrets by default.**
15. **No DCR/2025 removal sem client evidence; no indefinite retention sem usage evidence.**
16. **No mass move sem responsibility split.**
17. **No speculative public/alias.**
18. **No performance rebaseline antes de explicar closure.**
19. **Focused validations durante trabalho; global suites raramente, em checkpoint.**

## 22. Roadmap de execução 2.4

Os checkboxes são ledger operacional. Novos itens podem ser adicionados quando a implementação
revelar gaps; nenhum item é removido apenas para “fechar a faixa”.

## Faixa 0 — baseline imutável e preflight da campanha

### 0.1 Evidência já concluída nesta auditoria

- [x] ler os dois documentos arquiteturais-base integralmente;
- [x] inventariar 158 módulos JS MCP e massas principais;
- [x] identificar 131 tools wire atuais;
- [x] confirmar versão atual do repo (`@modelcontextprotocol/sdk@1.30.0`, wire 2025);
- [x] confirmar MCP stable `2026-07-28` e SDK v2 stable;
- [x] confirmar npm snapshot v2.0.0 dos packages oficiais em 23/08/2026;
- [x] auditar OpenAI docs atuais como contrato separado de upstream MCP;
- [x] identificar cancellation/lifecycle/secret/schema/composition gaps adicionais.

### 0.2 Antes da primeira mutação

- [ ] gerar descriptor/OpenAI metadata baseline machine-readable das 131 tools;
- [ ] snapshot de input/output schemas, annotations, securitySchemes, `_meta`, resources e
      instructions;
- [ ] snapshot OAuth metadata/challenges/issuer behavior;
- [ ] snapshot connector/Cloudflare URL readiness;
- [ ] owner/dependency graph baseline incluindo dynamic/subprocess edges conhecidos;
- [ ] registrar exact installed dependency/lock state;
- [ ] reconsultar npm/upstream para **latest stable naquele momento**;
- [ ] definir focused smoke mínimo para bisect da migração.

**Gate 0:** baseline suficiente para detectar regressão sem rodar suite global a cada patch.

---

## Faixa 1 — primeira mutação: SDK v2 stable + MCP 2026-07-28

### 1.1 Package migration

- [ ] executar/revisar `@modelcontextprotocol/codemod@latest` como assistente;
- [ ] substituir package monolítico v1 pelos packages v2 necessários;
- [ ] usar latest stable v2.x confirmado, não hard-code histórico 2.0.0 se já houver patch/minor
      estável;
- [ ] remover imports v1 conforme migração;
- [ ] corrigir type/import surfaces sem introduzir mega-adapter;
- [ ] focused typecheck/test apenas dos módulos MCP tocados.

### 1.2 Preservar contexto oficial do SDK

- [ ] callback adapters recebem `extra`/request context integral;
- [ ] `AbortSignal` é carregado para `OperationContext` desde o primeiro checkpoint v2;
- [ ] auth/request/session metadata relevante não é descartada;
- [ ] request IDs/correlation usam source oficial quando disponível.

### 1.3 Opt-in protocol 2026

- [ ] usar server/handler v2 recomendado para servir `2026-07-28` explicitamente;
- [ ] implementar/requestState onde substituir session assumptions;
- [ ] adotar modern request metadata/header semantics aplicáveis;
- [ ] implementar discovery/list/cache semantics necessárias;
- [ ] manter 131-tool contract parity;
- [ ] focused 2026 conformance smoke.

### 1.4 ChatGPT interoperability gate

- [ ] reconnect/refresh connector real;
- [ ] Scan Tools/metadata parity;
- [ ] read-only tool call;
- [ ] bounded write/plan/apply tool call;
- [ ] structuredContent/outputSchema parity;
- [ ] OAuth link/reauthorization;
- [ ] Cloudflare route/tunnel smoke;
- [ ] reconnect/reload smoke.

### 1.5 Compat-2025 somente se necessário

- [ ] se ChatGPT/client suportado falhar por era, criar adapter `compat-2025` **sobre v2**;
- [ ] registrar consumer e motivo concreto;
- [ ] impedir new features no compat owner;
- [ ] instrumentar uso;
- [ ] registrar exit condition.

**Gate 1:** repo opera sobre latest stable SDK v2; 2026 é caminho primário; v1 package não
permanece.

---

## Faixa 2 — OperationContext, cancellation e lifecycle truthfulness

- [ ] formalizar `OperationContext`/deadline budget;
- [ ] remover `Promise.race` timeout cosmético;
- [ ] compor caller cancellation + deadline;
- [ ] propagar signal para network/process/long IO;
- [ ] states `active→closing→closed|failed` para sessions/resources;
- [ ] await/observe transport/server close;
- [ ] background tasks registradas e drained;
- [ ] regressions para “response timed out but mutation kept running”;
- [ ] regressions para async close rejection;
- [ ] retries declaram idempotency/budget.

**Gate 2:** nenhum resource crítico é logicamente finalizado antes do lifecycle real.

---

## Faixa 3 — process authority, secret isolation e supervision

- [ ] separar process execution capability de credentials;
- [ ] child env default explicit/minimal;
- [ ] credential injection por operação;
- [ ] process-group ownership em jobs/terminal/runners;
- [ ] graceful SIGTERM → bounded grace → SIGKILL escalation;
- [ ] completion promise/event em vez de polling quando possível;
- [ ] stdout/stderr/event budgets coerentes;
- [ ] corrigir duplicate `maxExecOutputBytes`;
- [ ] leak tests de grandchildren;
- [ ] avaliar Node Permission Model apenas como defense-in-depth.

**Gate 3:** executar processo não concede automaticamente todos os secrets nem deixa process tree
órfã.

---

## Faixa 4 — composition/config inversion e MCP Process Host

- [ ] definir immutable `McpProcessConfig` + projections;
- [ ] classificar ~215 env references;
- [ ] mover env reads para config/composition boundaries;
- [ ] eliminar internal imports de `#copilot/boot` como locator;
- [ ] injetar DB/workspace/http/process/clock capabilities;
- [ ] criar `McpProcessHost` owned/disposable;
- [ ] migrar startup/JWKS/endpoint/round-trip monitors para host;
- [ ] retirar process hooks de leaves;
- [ ] separar testing controls da runtime API.

**Gate 4:** leaf MCP não busca dependency/config globalmente.

---

## Faixa 5 — truthful Tool Contract e catalog inversion

- [ ] extrair Tool Contract abaixo do catalog;
- [ ] explicit authority/effects/idempotency/credential needs;
- [ ] specific truthful output schemas;
- [ ] remover passthrough baseline artificial;
- [ ] ToolAnnotations/securitySchemes derivados de policy interna;
- [ ] decidir initial OAuth scopes policy sem max-power scoring;
- [ ] catalog assembly pura;
- [ ] validation/surface/execution separados;
- [ ] remover `bind*Provider` globals;
- [ ] runtime/startup deixam de chamar wire tools;
- [ ] decompor/eliminar `registry.js` hub.

**Gate 5:** tool leaves dependem de contracts/operations inferiores; catalog não compõe globals.

---

## Faixa 6 — auth/resource server + issuer + network hardening

- [ ] resource server: config/scopes/metadata/verification/JWKS/binding;
- [ ] issuer split por state machine/invariant;
- [ ] CIMD canonical;
- [ ] DCR apenas compat se usado;
- [ ] RFC 9207 success/error conformance;
- [ ] corrigir diagnostic DNS TOCTOU com connection-bound policy;
- [ ] eliminar duplicated private-IP semantics quando equivalentes;
- [ ] decision/replay caches instance-owned;
- [ ] preserve PRM/WWW-Authenticate/tool-level OAuth metadata;
- [ ] minimal-scope versus compatibility-profile decision baseada em ChatGPT evidence.

**Gate 6:** auth authority é explícita, connection-bound e independentemente testável.

---

## Faixa 7 — transport owners e retirement de session assumptions

- [ ] decompor `http-shared`;
- [ ] common request/body/security/CORS/rate-limit/timing owners/components;
- [ ] stdio owner independente;
- [ ] 2026 modern handler é canonical;
- [ ] `server/discover`, request metadata, routing/cache semantics completos conforme necessidade;
- [ ] compat session/store/event/stream/convergence isolados sob `compat-2025` se ainda existirem;
- [ ] diagnostic views não expõem live resources;
- [ ] remove compat 2025 imediatamente quando usage evidence zerar.

**Gate 7:** modern transport não depende de stateful assumptions.

---

## Faixa 8 — workspace repository/git/artifacts operations

- [ ] repo read split por invariants;
- [ ] repo write split por patch/batch/preflight/quarantine;
- [ ] working-set/cache/index ownership;
- [ ] git operation owner;
- [ ] artifacts owner;
- [ ] preserve atomicity/preflight/round-trip gains;
- [ ] wire `repo_*` tools ficam finas;
- [ ] post-write validators recebem OperationContext/cancellation.

**Gate 8:** filesystem/git business logic não vive no exposure plane.

---

## Faixa 9 — diagnostics, Cloudflare, integrations e scripts

### 9.1 Diagnostics

- [ ] latency/metrics/history/round-trip/client evidence owners;
- [ ] runtime/connection/host/devcontainer diagnostics;
- [ ] protocol-era labels;
- [ ] diagnostics read-only não recebem mutation authority.

### 9.2 Cloudflare

- [ ] config/connector/tunnel/remote/edge/metrics/benchmark owner tree;
- [ ] process/network capabilities explícitas;
- [ ] preserve plan/diff/apply/backup provenance;
- [ ] exact public surfaces consumer-driven.

### 9.3 Integrations

- [ ] OpenAI owner/diagnostics/secure tunnel;
- [ ] Model Gateway/LLM-B business logic fora de tool adapter;
- [ ] no deep integration imports.

### 9.4 Scripts

- [ ] OAuth smoke implementation extraída;
- [ ] benchmark services extraídos;
- [ ] scheduled/validation/dependency runners thin;
- [ ] no runtime→scripts business dependency;
- [ ] remove `scripts/index` broad barrel.

**Gate 9:** diagnostics/integrations/scripts têm ownership real sem bags horizontais.

---

## Faixa 10 — public/testing membranes, aliases e dynamic graph

- [ ] classificar owner versus internal taxonomy antes de criar `public/`;
- [ ] owner manifest com ownerId/parent;
- [ ] exact public surfaces apenas para cross-owner consumers;
- [ ] testing surfaces exatas;
- [ ] migrar tests com cada owner;
- [ ] impedir cross-owner private/JSDoc imports;
- [ ] manifestar computed imports/workers/subprocess entrypoints;
- [ ] remover `#copilot/mcp/control-plane`;
- [ ] remover broad tools/adapters/cloudflare/scripts aliases;
- [ ] root `#copilot/mcp` deixa de ser default;
- [ ] zero speculative aliases/public folders.

**Gate 10:** physical membrane 2.4 é universal entre owners reais.

---

## Faixa 11 — cost/performance e legacy extinction

- [ ] AST static closure ratchets por exact surface;
- [ ] cold import/RSS measurements isoladas;
- [ ] import-purity checks;
- [ ] Node 24 `keepAliveTimeoutBuffer`/built-ins avaliados onde cabível;
- [ ] descriptor/tool list deterministic/cache behavior avaliado;
- [ ] protocol/client usage evidence para compat owners;
- [ ] remover DCR/2025/env/store/router/smokes órfãos;
- [ ] zero compatibility shim residual sem consumer.

**Gate 11:** não carregamos dívida histórica como “segurança” depois de seus consumers sumirem.

---

## Faixa 12 — fechamento e validação ampla de checkpoint

Somente depois de muitas horas/ondas de trabalho coeso:

- [ ] focused owner suites verdes durante cada faixa;
- [ ] TS7 strict global;
- [ ] lint global;
- [ ] prettier/format;
- [ ] zero suppressions;
- [ ] MCP/Copilot unit/integration/regression relevantes;
- [ ] MCP 2026 conformance;
- [ ] descriptor/OpenAI metadata parity ou versioned intentional diffs;
- [ ] connector real end-to-end;
- [ ] OAuth/CIMD/reauthorization;
- [ ] Cloudflare readiness;
- [ ] LLM-B readiness;
- [ ] owner/static/dynamic graph 0 cycles/unresolved/unknown edges;
- [ ] cost ratchets verdes;
- [ ] docs/README/API reference atualizados;
- [ ] grande commit/push somente após esse checkpoint.

**Gate 12:** MCP 2.4 pronto para publicação sem exceptions não justificadas.

## 23. Ordem recomendada das ondas

### Onda 0 — proof before mutation

Faixa 0.

### Onda 1 — modernização imediata de plataforma MCP

Faixa 1.

**Esta é a primeira transformação de código autorizável:** latest stable v2 + wire 2026, seguida de
interop real. Não adiar para depois da reorganização arquitetural.

### Onda 2 — tornar execução/lifecycle/authority verdadeiros

Faixas 2 → 3 → 4 → 5.

### Onda 3 — decompor security/transport já sobre a linha moderna

Faixas 6 → 7.

### Onda 4 — extrair application owners

Faixas 8 → 9.

### Onda 5 — fechar membranes/topologia e apagar legado

Faixas 10 → 11.

### Onda 6 — checkpoint global

Faixa 12.

## 24. Gates operacionais e economia de validação

### 24.1 Invariants que não podem regredir

- connector URL saudável;
- OAuth metadata/challenge/issuer coerentes;
- 131 tool names/schemas/metadata preservados salvo mudança versionada;
- no secret leakage;
- repo authority/preflight/atomicity preservadas;
- Cloudflare named tunnel saudável;
- process/session cleanup observável;
- protocol era explicitada;
- modern 2026 é o caminho primário após Faixa 1.

### 24.2 Validação por informação marginal

Durante patches locais, usar unit/contract/type/lint do owner ou arquivos afetados. Não rodar suite
Copilot/global após cada pequeno move. Expandir apenas quando:

- uma public/wire contract mudou;
- uma phase boundary foi atingida;
- dependency graph amplo foi alterado;
- preparemos grande commit/push.

Reload/reconnect também é gate de boundary, não ritual após qualquer edição que hot reload já cubra.

## 25. Definition of Done MCP Arquitetura 2.4

- [ ] latest stable TypeScript SDK v2.x está em uso; package v1 removido;
- [ ] MCP `2026-07-28` é o protocol path primário;
- [ ] compat-2025, se existir, tem consumer/telemetry/exit condition e não recebe new features;
- [ ] OpenAI/ChatGPT real interop comprovado;
- [ ] `RequestHandlerExtra`/modern request context não é descartado;
- [ ] timeouts/cancellation alcançam trabalho real;
- [ ] resource terminal states seguem observed close/exit;
- [ ] process execution não herda secrets desnecessários;
- [ ] process trees são supervisionadas e bounded;
- [ ] output schemas são semanticamente verdadeiros;
- [ ] Tool Contract authority/effects/idempotency são explicit/fail-closed;
- [ ] initial OAuth scope policy é deliberada, não max-power score;
- [ ] resource server e issuer são owners distintos;
- [ ] CIMD canonical; DCR somente compat evidence-based;
- [ ] OAuth diagnostic SSRF TOCTOU corrigido;
- [ ] `control-plane/` não existe;
- [ ] generic `adapters/` e `tools/shared/` não existem;
- [ ] wire tools são leaf adapters;
- [ ] runtime/startup não chama tool definition;
- [ ] scripts são thin launchers;
- [ ] internals não usam `boot` como locator;
- [ ] raw env reads estão em config/composition boundaries;
- [ ] every cross-owner dependency passa por physical `public/`;
- [ ] owner versus taxonomy distinction está manifestada;
- [ ] zero cross-owner private/JSDoc bypass;
- [ ] dynamic/workers/subprocess edges estão no graph/manifest;
- [ ] testing surfaces são exact e produção não as consome;
- [ ] Cloudflare possui owner tree/exact surfaces;
- [ ] broad MCP aliases antigos foram removidos;
- [ ] 131-tool/OpenAI metadata compatibility gate verde ou intentional versioned diffs;
- [ ] static/cold cost ratchets verdes;
- [ ] graph 0 cycles/unresolved/unknown dynamic edges;
- [ ] TS7 strict/lint/format/zero suppressions;
- [ ] focused tests acompanharam cada faixa;
- [ ] final unit/integration/regression/conformance/connector checkpoint verde;
- [ ] documentação live/API reference coerentes;
- [ ] roadmap fechado com evidência real.

## 26. Decisões arquiteturais MCP canônicas

### DEC-MCP-01 — latest stable v2 + 2026 são a primeira modernização mutante

Não refatorar longamente sobre SDK v1.

### DEC-MCP-02 — upstream MCP e ChatGPT host são gates independentes

Interop real decide compat adapter, não suposição.

### DEC-MCP-03 — compat-2025 é temporário e roda sobre v2

Nunca manter package v1 por causa de um client legado.

### DEC-MCP-04 — `control-plane` será extinto

Não representa owner sólido.

### DEC-MCP-05 — `tools` é exposure plane

Business logic migra para semantic owners.

### DEC-MCP-06 — Tool Contract é inferior ao catalog

Catalog nunca é type owner das leaves que agrega.

### DEC-MCP-07 — authority e output contracts são explícitos

Heuristics/passthrough não substituem contracts verdadeiros.

### DEC-MCP-08 — request context/cancellation não pode ser descartado

SDK signal/auth/request metadata alimentam OperationContext.

### DEC-MCP-09 — lifecycle terminal state precisa ser observado

No fake timeout/close.

### DEC-MCP-10 — process authority e secret authority são separadas

### DEC-MCP-11 — public membrane vale entre owners, não entre toda pasta

Owner/taxonomy distinction segue a Arquitetura 2.4 geral.

### DEC-MCP-12 — process/config dependencies são injetadas

Leaf não importa boot para encontrar runtime/DB/workspace.

### DEC-MCP-13 — wire tool é leaf adapter

### DEC-MCP-14 — dynamic loading faz parte do graph

### DEC-MCP-15 — current 131-tool/OpenAI contract é baseline

Reorganização/migração protocolar não renomeia tools implicitamente.

### DEC-MCP-16 — validation é focused-by-default

Global suites são checkpoint de grande fase/commit.

## 27. Riscos da futura execução

| risco                                          | impacto    | mitigação                                                       |
| ---------------------------------------------- | ---------- | --------------------------------------------------------------- |
| migration v2+2026 quebrar connector real       | crítico    | baseline + focused interop + compat-2025 sobre v2 se necessário |
| permanecer em v1 por medo do host              | alto       | latest-stable-first decision + independent OpenAI gate          |
| timeout continuar trabalho mutante             | crítico    | OperationContext/AbortSignal + regression                       |
| session/process aparecer closed antes do close | alto       | async lifecycle state machine                                   |
| terminal/subprocess receber secrets indevidos  | crítico    | explicit child env/credential capability                        |
| outputSchema mentir sobre structured result    | alto       | truthful contract + parity tests                                |
| service locator espalhar-se após mover files   | alto       | composition inversion antes de mass moves                       |
| reintroduzir Core como `control-plane2/shared` | alto       | owner manifest + semantic ownership                             |
| under/over-scope tool após refactor            | crítico    | explicit authority baseline + OAuth tests                       |
| max-power OAuth piorar least privilege         | alto       | deliberate scope profile + reauth tests                         |
| DCR/2025 removido cedo                         | alto       | client evidence/compat owner                                    |
| compat 2025 nunca morrer                       | alto       | usage telemetry + exit condition                                |
| dynamic imports escaparem architecture checker | alto       | manifest static/dynamic graph                                   |
| tests preservarem arquitetura privada antiga   | médio      | testing surfaces + migrate tests with owner                     |
| performance piorar por public mega-barrels     | alto       | static/cold ratchets                                            |
| OAuth state split quebrar atomic invariants    | crítico    | state-machine regressions antes do split                        |
| validação exaustiva consumir a campanha        | médio/alto | focused-by-default; global only checkpoints                     |

## 28. Inventário arquivo por arquivo

A tabela a seguir cobre **todos os 158 arquivos JS** lidos na auditoria. `Destino/owner` é direção
arquitetural alvo; arquivos `SPLIT` exigem decomposição antes de move, e não um rename mecânico.

| arquivo atual                                     |  LOC | fan-in | disposição         | destino/owner 2.4                                                                         | papel/razão                                                                                            |
| ------------------------------------------------- | ---: | -----: | ------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `adapters/http-body.js`                           |  206 |      3 | **MOVE/SPLIT**     | `transport/http/compat-2025/request + common body bounds`                                 | Módulo adapters/http-body.js — initialize/session semantics misturadas com body.                       |
| `adapters/http-protocol.js`                       |  392 |      5 | **MOVE/REWRITE**   | `transport/http/common/protocol`                                                          | Módulo adapters/http-protocol.js — protocol/timing boundary.                                           |
| `adapters/http-shared.js`                         | 1593 |      3 | **SPLIT**          | `transport/http/common/{request,security,cors,rate-limit,timing} + legacy adapter`        | Módulo adapters/http-shared.js — 1,5k LOC e múltiplos invariants.                                      |
| `adapters/http-stateful-router.js`                |  571 |      2 | **MOVE/REWRITE**   | `transport/http/compat-2025/router`                                                       | Módulo adapters/http-stateful-router.js — semantics sessionful específicas de era.                     |
| `adapters/http.js`                                |  562 |      1 | **SPLIT/THIN**     | `composition/server/http + transport/http`                                                | Módulo adapters/http.js — server launch/composition versus transport behavior.                         |
| `adapters/http2.js`                               |  878 |      1 | **SPLIT/THIN**     | `composition/server/http + transport/http`                                                | Módulo adapters/http2.js — server launch/composition versus transport behavior.                        |
| `adapters/index.js`                               |   28 |      1 | **DELETE**         | `transport exact public surfaces`                                                         | Módulo adapters/index.js — broad barrel.                                                               |
| `adapters/stdio.js`                               |   21 |      1 | **MOVE/REWRITE**   | `transport/stdio`                                                                         | Módulo adapters/stdio.js — transport owner claro.                                                      |
| `cli.js`                                          |  202 |      0 | **THIN**           | `composition/cli`                                                                         | Módulo cli.js — launcher/wiring somente.                                                               |
| `cloudflare/cli-commands.js`                      |  370 |      1 | **MOVE/SPLIT**     | `cloudflare/composition/cli/commands`                                                     | Módulo cloudflare/cli-commands.js — command dispatch + many owner deps.                                |
| `cloudflare/cli-probe.js`                         |  320 |      3 | **MOVE/REWRITE**   | `cloudflare/connector/probe`                                                              | Módulo cloudflare/cli-probe.js — connector HTTP probes.                                                |
| `cloudflare/cli-process.js`                       |  540 |      3 | **MOVE/REWRITE**   | `cloudflare/tunnel/process`                                                               | Módulo cloudflare/cli-process.js — cloudflared process lifecycle.                                      |
| `cloudflare/cli-runtime.js`                       |  218 |      1 | **MOVE/SPLIT**     | `cloudflare/tunnel/runtime`                                                               | Módulo cloudflare/cli-runtime.js — managed stack orchestration.                                        |
| `cloudflare/cli-smoke.js`                         |  244 |      2 | **MOVE/REWRITE**   | `cloudflare/connector/smoke`                                                              | Módulo cloudflare/cli-smoke.js — connector smoke.                                                      |
| `cloudflare/cli.js`                               |   25 |      0 | **THIN**           | `cloudflare/composition/cli`                                                              | Módulo cloudflare/cli.js — launcher.                                                                   |
| `cloudflare/config-audit.js`                      |  763 |      5 | **MOVE/REWRITE**   | `cloudflare/config/audit`                                                                 | Módulo cloudflare/config-audit.js — config diagnostics.                                                |
| `cloudflare/config.js`                            |  604 |     34 | **SPLIT**          | `cloudflare/config/{schema,policy,service}`                                               | Módulo cloudflare/config.js — 604 LOC config/env concerns.                                             |
| `cloudflare/connector-smoke.js`                   |  204 |      4 | **MOVE/REWRITE**   | `cloudflare/connector/smoke`                                                              | Módulo cloudflare/connector-smoke.js — connector smoke.                                                |
| `cloudflare/edge-audit.js`                        |  577 |      6 | **MOVE/REWRITE**   | `cloudflare/edge/audit`                                                                   | Módulo cloudflare/edge-audit.js — edge audit.                                                          |
| `cloudflare/edge-backup.js`                       |  325 |      4 | **MOVE/REWRITE**   | `cloudflare/edge/backup`                                                                  | Módulo cloudflare/edge-backup.js — edge backup store.                                                  |
| `cloudflare/edge-policy-apply.js`                 |  402 |      2 | **MOVE/REWRITE**   | `cloudflare/edge/policy/apply`                                                            | Módulo cloudflare/edge-policy-apply.js — edge policy owner.                                            |
| `cloudflare/edge-policy-diff.js`                  |  246 |      4 | **MOVE/REWRITE**   | `cloudflare/edge/policy/diff`                                                             | Módulo cloudflare/edge-policy-diff.js — edge policy owner.                                             |
| `cloudflare/edge-policy-plan.js`                  |  141 |      3 | **MOVE/REWRITE**   | `cloudflare/edge/policy/plan`                                                             | Módulo cloudflare/edge-policy-plan.js — edge policy owner.                                             |
| `cloudflare/edge-snapshot.js`                     |  107 |      3 | **MOVE/REWRITE**   | `cloudflare/edge/snapshot`                                                                | Módulo cloudflare/edge-snapshot.js — snapshot/cache.                                                   |
| `cloudflare/error-taxonomy.js`                    |   35 |      1 | **MOVE/REWRITE**   | `cloudflare/diagnostics/errors`                                                           | Módulo cloudflare/error-taxonomy.js — cloudflared log taxonomy.                                        |
| `cloudflare/http-latency-analytics.js`            |  309 |      1 | **MOVE/REWRITE**   | `cloudflare/metrics`                                                                      | Módulo cloudflare/http-latency-analytics.js — metrics/analytics.                                       |
| `cloudflare/index.js`                             |   29 |      1 | **DELETE**         | `cloudflare exact public surfaces`                                                        | Módulo cloudflare/index.js — mega-barrel.                                                              |
| `cloudflare/mcp-passthrough-plan.js`              |  422 |      2 | **MOVE/REWRITE**   | `cloudflare/edge/passthrough`                                                             | Módulo cloudflare/mcp-passthrough-plan.js — MCP passthrough plan/apply.                                |
| `cloudflare/metrics-histograms.js`                |  169 |      2 | **MOVE/REWRITE**   | `cloudflare/metrics`                                                                      | Módulo cloudflare/metrics-histograms.js — metrics/analytics.                                           |
| `cloudflare/metrics.js`                           |  201 |      1 | **MOVE/REWRITE**   | `cloudflare/metrics`                                                                      | Módulo cloudflare/metrics.js — metrics/analytics.                                                      |
| `cloudflare/origin-request-profile.js`            |  477 |      3 | **MOVE/REWRITE**   | `cloudflare/tunnel/origin`                                                                | Módulo cloudflare/origin-request-profile.js — origin policy/plan.                                      |
| `cloudflare/plan-capabilities-audit.js`           |   98 |      2 | **MOVE/REWRITE**   | `cloudflare/config/audit`                                                                 | Módulo cloudflare/plan-capabilities-audit.js — config diagnostics.                                     |
| `cloudflare/remote-api.js`                        |  668 |     19 | **SPLIT**          | `cloudflare/remote/{config,client,audit}`                                                 | Módulo cloudflare/remote-api.js — remote config/client/cache.                                          |
| `cloudflare/routes.js`                            |  145 |      3 | **MOVE/REWRITE**   | `cloudflare/edge/routes`                                                                  | Módulo cloudflare/routes.js — route expressions/protocol.                                              |
| `cloudflare/ruleset-snapshot.js`                  |  116 |      3 | **MOVE/REWRITE**   | `cloudflare/edge/snapshot`                                                                | Módulo cloudflare/ruleset-snapshot.js — snapshot/cache.                                                |
| `cloudflare/skip-audit.js`                        |  580 |      2 | **MOVE/REWRITE**   | `cloudflare/edge/audit`                                                                   | Módulo cloudflare/skip-audit.js — edge audit.                                                          |
| `cloudflare/state.js`                             |  381 |      7 | **MOVE/REWRITE**   | `cloudflare/tunnel/state`                                                                 | Módulo cloudflare/state.js — runtime/smoke state.                                                      |
| `cloudflare/transport-benchmark-state.js`         |   62 |      1 | **MOVE/REWRITE**   | `cloudflare/transport-benchmark/state`                                                    | Módulo cloudflare/transport-benchmark-state.js — benchmark state.                                      |
| `cloudflare/tunnel-origin-plan.js`                |  306 |      2 | **MOVE/REWRITE**   | `cloudflare/tunnel/origin`                                                                | Módulo cloudflare/tunnel-origin-plan.js — origin policy/plan.                                          |
| `connection/index.js`                             |    9 |      1 | **DELETE**         | `diagnostics/connection/public`                                                           | Módulo connection/index.js — broad mini-barrel substituído por exact public.                           |
| `connection/profile.js`                           |  844 |      2 | **MOVE/REWRITE**   | `diagnostics/connection/profile`                                                          | Módulo connection/profile.js — diagnostic projection/config.                                           |
| `control-plane/ai-artifacts.js`                   |  469 |      1 | **MOVE/REWRITE**   | `workspace/artifacts`                                                                     | Módulo control-plane/ai-artifacts.js — workspace artifact maintenance.                                 |
| `control-plane/annotations.js`                    |   92 |      1 | **MOVE/REWRITE**   | `protocol/tools/annotations`                                                              | Módulo control-plane/annotations.js — tool protocol contract.                                          |
| `control-plane/audit.js`                          |  350 |      8 | **MOVE/REWRITE**   | `audit/runtime`                                                                           | Módulo control-plane/audit.js — audit store lifecycle.                                                 |
| `control-plane/auth-decision-cache.js`            |  207 |      1 | **MOVE/REWRITE**   | `auth/resource-server/decision-cache`                                                     | Módulo control-plane/auth-decision-cache.js — auth cache.                                              |
| `control-plane/auth-jwks-warmup.js`               |  172 |      2 | **MOVE/REWRITE**   | `auth/resource-server/jwks/warmup`                                                        | Módulo control-plane/auth-jwks-warmup.js — monitor lifecycle.                                          |
| `control-plane/auth.js`                           | 1626 |     52 | **SPLIT**          | `auth/resource-server/{config,metadata,scopes,verification,binding}`                      | Módulo control-plane/auth.js — 1,6k LOC + authority hub.                                               |
| `control-plane/client-latency-evidence.js`        |  349 |      1 | **MOVE/REWRITE**   | `diagnostics/latency`                                                                     | Módulo control-plane/client-latency-evidence.js — latency evidence/history.                            |
| `control-plane/dependency-maintenance.js`         |  721 |      2 | **MOVE/REWRITE**   | `operations/dependencies`                                                                 | Módulo control-plane/dependency-maintenance.js — dependency operation.                                 |
| `control-plane/dev-oauth.js`                      | 4368 |      2 | **SPLIT**          | `auth/issuer/{http,authorization,token,refresh,clients,crypto,replay,persistence,policy}` | Módulo control-plane/dev-oauth.js — 4,3k LOC state machines.                                           |
| `control-plane/event-store.js`                    |  291 |      4 | **MOVE/REWRITE**   | `transport/http/compat-2025/session/events`                                               | Módulo control-plane/event-store.js — legacy event replay.                                             |
| `control-plane/http-client.js`                    |  152 |      1 | **ABSORB/REPLACE** | `diagnostics/network + Infra public network`                                              | Módulo control-plane/http-client.js — generic fetch wrapper has weaker security.                       |
| `control-plane/index-auto-build-checkpoint.js`    |  371 |      1 | **MOVE/REWRITE**   | `workspace/repository/index`                                                              | Módulo control-plane/index-auto-build-checkpoint.js — index lifecycle/checkpoint.                      |
| `control-plane/index-auto-build.js`               |  495 |      2 | **MOVE/REWRITE**   | `workspace/repository/index`                                                              | Módulo control-plane/index-auto-build.js — index lifecycle/checkpoint.                                 |
| `control-plane/index.js`                          |   60 |      1 | **DELETE**         | `exact public owners`                                                                     | Módulo control-plane/index.js — control-plane mega-barrel.                                             |
| `control-plane/io-cache-benchmark-state.js`       |   59 |      1 | **MOVE/REWRITE**   | `diagnostics/io-cache/state`                                                              | Módulo control-plane/io-cache-benchmark-state.js — benchmark state.                                    |
| `control-plane/jobs.js`                           |  773 |      9 | **SPLIT/REWRITE**  | `operations/validators/jobs`                                                              | Módulo control-plane/jobs.js — process supervisor + persistence + validation.                          |
| `control-plane/latency-history.js`                |  293 |      2 | **MOVE/REWRITE**   | `diagnostics/latency`                                                                     | Módulo control-plane/latency-history.js — latency evidence/history.                                    |
| `control-plane/metrics.js`                        | 1256 |      2 | **SPLIT**          | `diagnostics/metrics`                                                                     | Módulo control-plane/metrics.js — large metrics owner.                                                 |
| `control-plane/oauth-replay-store.js`             |  221 |      3 | **MOVE/ABSORB**    | `auth/issuer/replay/store`                                                                | Módulo control-plane/oauth-replay-store.js — issuer replay persistence.                                |
| `control-plane/openai-endpoint-latency.js`        |  533 |      3 | **MOVE/REWRITE**   | `integrations/openai/diagnostics`                                                         | Módulo control-plane/openai-endpoint-latency.js — OpenAI-specific diagnostic.                          |
| `control-plane/openai-endpoint-monitor.js`        |  233 |      2 | **MOVE/REWRITE**   | `integrations/openai/diagnostics`                                                         | Módulo control-plane/openai-endpoint-monitor.js — OpenAI-specific diagnostic.                          |
| `control-plane/paths.js`                          |  196 |     12 | **SPLIT/ABSORB**   | `composition/process/config + owning services`                                            | Módulo control-plane/paths.js — path/config bag should dissolve.                                       |
| `control-plane/persistence/index.js`              |    5 |      3 | **DELETE**         | `owning stores / Infra persistence`                                                       | Módulo control-plane/persistence/index.js — generic MCP persistence bag.                               |
| `control-plane/persistence/jsonl-store.js`        |   99 |      1 | **ABSORB**         | `owning stores / Infra persistence`                                                       | Módulo control-plane/persistence/jsonl-store.js — generic MCP persistence bag.                         |
| `control-plane/reload-state.js`                   |   95 |      1 | **MOVE/REWRITE**   | `operations/restart/state`                                                                | Módulo control-plane/reload-state.js — reload lifecycle state.                                         |
| `control-plane/result.js`                         |  238 |      5 | **MOVE/REWRITE**   | `protocol/tools/results`                                                                  | Módulo control-plane/result.js — tool result protocol.                                                 |
| `control-plane/round-trip-analytics-monitor.js`   |  215 |      2 | **MOVE/REWRITE**   | `diagnostics/round-trip`                                                                  | Módulo control-plane/round-trip-analytics-monitor.js — round-trip owner/lifecycle.                     |
| `control-plane/round-trip-analytics.js`           |  654 |      2 | **MOVE/REWRITE**   | `diagnostics/round-trip`                                                                  | Módulo control-plane/round-trip-analytics.js — round-trip owner/lifecycle.                             |
| `control-plane/schema-convergence.js`             |  250 |      3 | **MOVE/REWRITE**   | `catalog/compat-2025/convergence`                                                         | Módulo control-plane/schema-convergence.js — sendToolListChanged era-specific.                         |
| `control-plane/session-runtime.js`                |  518 |      8 | **MOVE/REWRITE**   | `transport/http/compat-2025/session/runtime`                                              | Módulo control-plane/session-runtime.js — legacy session live resources.                               |
| `control-plane/session-store.js`                  |  215 |      3 | **MOVE/REWRITE**   | `transport/http/compat-2025/session/store`                                                | Módulo control-plane/session-store.js — legacy session metadata.                                       |
| `control-plane/smoke-state.js`                    |   45 |      1 | **MOVE/REWRITE**   | `diagnostics/smoke/state`                                                                 | Módulo control-plane/smoke-state.js — smoke evidence state.                                            |
| `control-plane/stream-registry.js`                |  146 |      3 | **MOVE/REWRITE**   | `transport/http/compat-2025/session/streams`                                              | Módulo control-plane/stream-registry.js — legacy stream lifecycle.                                     |
| `control-plane/terminal-control.js`               |  778 |      1 | **SPLIT/REWRITE**  | `operations/terminal`                                                                     | Módulo control-plane/terminal-control.js — session/process owner.                                      |
| `control-plane/tool-capabilities.js`              |   54 |      2 | **MOVE/REWRITE**   | `protocol/tools/capabilities`                                                             | Módulo control-plane/tool-capabilities.js — capability descriptors.                                    |
| `control-plane/tool-metadata.js`                  |  168 |      1 | **MOVE/REWRITE**   | `protocol/tools/metadata`                                                                 | Módulo control-plane/tool-metadata.js — wire metadata projection.                                      |
| `control-plane/ttl-cache.js`                      |  251 |      3 | **ABSORB/DELETE**  | `owner-local cache or Infra cache`                                                        | Módulo control-plane/ttl-cache.js — generic MCP primitive.                                             |
| `index.js`                                        |   19 |      0 | **DELETE**         | `composition/public exact surfaces`                                                       | Módulo index.js — root barrel amplo sem owner próprio.                                                 |
| `openai/index.js`                                 |    9 |      1 | **DELETE**         | `integrations/openai exact surfaces`                                                      | Módulo openai/index.js — broad barrel.                                                                 |
| `openai/secure-tunnel-cli.js`                     |    9 |      0 | **THIN/MOVE**      | `integrations/openai/secure-tunnel/cli`                                                   | Módulo openai/secure-tunnel-cli.js — CLI adapter.                                                      |
| `openai/secure-tunnel-readiness.js`               |  170 |      2 | **MOVE/REWRITE**   | `integrations/openai/secure-tunnel`                                                       | Módulo openai/secure-tunnel-readiness.js — integration owner.                                          |
| `registry.js`                                     | 1517 |     92 | **SPLIT**          | `protocol/tools + catalog/{assembly,validation,execution,diagnostics}`                    | Módulo registry.js — hub de contracts/catalog/execution/DI.                                            |
| `runtime/startup-maintenance.js`                  |  224 |      2 | **MOVE/REWRITE**   | `composition/process/startup`                                                             | Módulo runtime/startup-maintenance.js — process startup lifecycle.                                     |
| `scripts/architecture-contract-check.js`          |  236 |      0 | **KEEP/THIN**      | `scripts/contract launcher or diagnostics owner`                                          | Módulo scripts/architecture-contract-check.js — verify remains thin; extract reusable logic if needed. |
| `scripts/dependency-maintenance-runner.js`        |   23 |      0 | **THIN/MOVE**      | `operations/dependencies/diagnostic + script launcher`                                    | Módulo scripts/dependency-maintenance-runner.js — operation runner.                                    |
| `scripts/dependency-native-smoke.js`              |  164 |      1 | **THIN/MOVE**      | `operations/dependencies/diagnostic + script launcher`                                    | Módulo scripts/dependency-native-smoke.js — operation runner.                                          |
| `scripts/docs-contract-check.js`                  |  124 |      0 | **KEEP/THIN**      | `scripts/contract launcher or diagnostics owner`                                          | Módulo scripts/docs-contract-check.js — verify remains thin; extract reusable logic if needed.         |
| `scripts/index.js`                                |   18 |      1 | **DELETE**         | `exact script entrypoints`                                                                | Módulo scripts/index.js — broad script barrel.                                                         |
| `scripts/io-cache-benchmark-worker.js`            |  166 |      0 | **MOVE/THIN**      | `diagnostics/io-cache/worker + launcher`                                                  | Módulo scripts/io-cache-benchmark-worker.js — worker behavior.                                         |
| `scripts/latency-benchmark.js`                    |  490 |      1 | **EXTRACT+THIN**   | `diagnostics/latency/benchmark + thin launcher`                                           | Módulo scripts/latency-benchmark.js — benchmark implementation.                                        |
| `scripts/network-summary-contracts.js`            |  449 |      0 | **KEEP/THIN**      | `scripts/contract launcher or diagnostics owner`                                          | Módulo scripts/network-summary-contracts.js — verify remains thin; extract reusable logic if needed.   |
| `scripts/oauth-smoke-cli.js`                      |   12 |      0 | **THIN**           | `scripts/oauth-smoke`                                                                     | Módulo scripts/oauth-smoke-cli.js — CLI only.                                                          |
| `scripts/oauth-smoke.js`                          | 2395 |      3 | **EXTRACT+THIN**   | `diagnostics/auth/smoke + scripts/oauth-smoke launcher`                                   | Módulo scripts/oauth-smoke.js — 2,4k reusable implementation.                                          |
| `scripts/run-safe-validation-suite.js`            |  226 |      1 | **THIN/MOVE**      | `operations/validators/composition`                                                       | Módulo scripts/run-safe-validation-suite.js — validation launcher.                                     |
| `scripts/scheduled-io-cache-benchmark-runner.js`  |  351 |      0 | **THIN**           | `scripts/scheduled launcher → owning operation`                                           | Módulo scripts/scheduled-io-cache-benchmark-runner.js — scheduler launcher.                            |
| `scripts/scheduled-restart-runner.js`             |  146 |      0 | **THIN**           | `scripts/scheduled launcher → owning operation`                                           | Módulo scripts/scheduled-restart-runner.js — scheduler launcher.                                       |
| `scripts/scheduled-transport-benchmark-runner.js` |  545 |      0 | **THIN**           | `scripts/scheduled launcher → owning operation`                                           | Módulo scripts/scheduled-transport-benchmark-runner.js — scheduler launcher.                           |
| `scripts/smoke-http.js`                           |  218 |      1 | **EXTRACT+THIN**   | `diagnostics/smoke/http`                                                                  | Módulo scripts/smoke-http.js — smoke implementation.                                                   |
| `scripts/stateful-env.js`                         |  339 |      0 | **MOVE/LEGACY**    | `transport/http/compat-2025/composition`                                                  | Módulo scripts/stateful-env.js — legacy environment launcher.                                          |
| `scripts/tool-payload-audit-cli.js`               |    8 |      0 | **THIN**           | `scripts/tool-payload-audit`                                                              | Módulo scripts/tool-payload-audit-cli.js — CLI only.                                                   |
| `scripts/tool-payload-audit.js`                   |  277 |      4 | **EXTRACT+THIN**   | `diagnostics/catalog/payload-audit`                                                       | Módulo scripts/tool-payload-audit.js — audit implementation.                                           |
| `scripts/validate-devcontainer-shell.js`          |  190 |      0 | **KEEP/THIN**      | `scripts/contract launcher or diagnostics owner`                                          | Módulo scripts/validate-devcontainer-shell.js — verify remains thin; extract reusable logic if needed. |
| `server.js`                                       |  848 |      4 | **SPLIT**          | `composition/server + protocol/server + SDK adapter`                                      | Módulo server.js — factory, profile, validation e SDK misturados.                                      |
| `tool-surface.js`                                 |  318 |      6 | **MOVE/REWRITE**   | `catalog/surface-policy`                                                                  | Módulo tool-surface.js — policy de catálogo coesa.                                                     |
| `tools/apps-sdk-readiness.js`                     |  211 |      1 | **MOVE+THIN**      | `tools/integrations/apps-sdk`                                                             | Módulo tools/apps-sdk-readiness.js — wire adapter; extract non-wire business logic.                    |
| `tools/apps-sdk-resources.js`                     |  247 |      3 | **MOVE+THIN**      | `protocol/resources/apps-sdk`                                                             | Módulo tools/apps-sdk-resources.js — wire adapter; extract non-wire business logic.                    |
| `tools/client-latency-evidence.js`                |  160 |      1 | **MOVE+THIN**      | `tools/diagnostics`                                                                       | Módulo tools/client-latency-evidence.js — wire adapter; extract non-wire business logic.               |
| `tools/cloudflare-config.js`                      |   54 |      1 | **MOVE+THIN**      | `tools/cloudflare`                                                                        | Módulo tools/cloudflare-config.js — wire adapter; extract non-wire business logic.                     |
| `tools/cloudflare-edge-apply.js`                  |   46 |      1 | **MOVE+THIN**      | `tools/cloudflare`                                                                        | Módulo tools/cloudflare-edge-apply.js — wire adapter; extract non-wire business logic.                 |
| `tools/cloudflare-edge-backup.js`                 |   50 |      1 | **MOVE+THIN**      | `tools/cloudflare`                                                                        | Módulo tools/cloudflare-edge-backup.js — wire adapter; extract non-wire business logic.                |
| `tools/cloudflare-edge-diff.js`                   |   23 |      1 | **MOVE+THIN**      | `tools/cloudflare`                                                                        | Módulo tools/cloudflare-edge-diff.js — wire adapter; extract non-wire business logic.                  |
| `tools/cloudflare-edge-policy.js`                 |   23 |      1 | **MOVE+THIN**      | `tools/cloudflare`                                                                        | Módulo tools/cloudflare-edge-policy.js — wire adapter; extract non-wire business logic.                |
| `tools/cloudflare-edge-snapshot.js`               |   23 |      1 | **MOVE+THIN**      | `tools/cloudflare`                                                                        | Módulo tools/cloudflare-edge-snapshot.js — wire adapter; extract non-wire business logic.              |
| `tools/cloudflare-edge.js`                        |   38 |      1 | **MOVE+THIN**      | `tools/cloudflare`                                                                        | Módulo tools/cloudflare-edge.js — wire adapter; extract non-wire business logic.                       |
| `tools/cloudflare-metrics.js`                     |   38 |      1 | **MOVE+THIN**      | `tools/cloudflare`                                                                        | Módulo tools/cloudflare-metrics.js — wire adapter; extract non-wire business logic.                    |
| `tools/cloudflare-passthrough.js`                 |   60 |      1 | **MOVE+THIN**      | `tools/cloudflare`                                                                        | Módulo tools/cloudflare-passthrough.js — wire adapter; extract non-wire business logic.                |
| `tools/cloudflare-post-change-gates.js`           |  318 |      1 | **MOVE+THIN**      | `tools/cloudflare`                                                                        | Módulo tools/cloudflare-post-change-gates.js — wire adapter; extract non-wire business logic.          |
| `tools/cloudflare-remote.js`                      |  145 |      1 | **MOVE+THIN**      | `tools/cloudflare`                                                                        | Módulo tools/cloudflare-remote.js — wire adapter; extract non-wire business logic.                     |
| `tools/cloudflare-skip.js`                        |   23 |      1 | **MOVE+THIN**      | `tools/cloudflare`                                                                        | Módulo tools/cloudflare-skip.js — wire adapter; extract non-wire business logic.                       |
| `tools/cloudflare-transport-benchmark.js`         |  271 |      1 | **MOVE+THIN**      | `tools/cloudflare`                                                                        | Módulo tools/cloudflare-transport-benchmark.js — wire adapter; extract non-wire business logic.        |
| `tools/company-knowledge.js`                      |  559 |      3 | **SPLIT+THIN**     | `tools/workspace/company-knowledge`                                                       | Módulo tools/company-knowledge.js — wire adapter; extract non-wire business logic.                     |
| `tools/connection.js`                             | 1235 |      1 | **SPLIT+THIN**     | `tools/diagnostics`                                                                       | Módulo tools/connection.js — wire adapter; extract non-wire business logic.                            |
| `tools/copilot-session.js`                        |   71 |      1 | **MOVE+THIN**      | `tools/integrations`                                                                      | Módulo tools/copilot-session.js — wire adapter; extract non-wire business logic.                       |
| `tools/delegation-runner.js`                      |  319 |      1 | **SPLIT+THIN**     | `tools/operations`                                                                        | Módulo tools/delegation-runner.js — wire adapter; extract non-wire business logic.                     |
| `tools/devcontainer-network-posture.js`           |  454 |      1 | **MOVE+THIN**      | `tools/diagnostics`                                                                       | Módulo tools/devcontainer-network-posture.js — wire adapter; extract non-wire business logic.          |
| `tools/git-read.js`                               |  103 |      1 | **MOVE+THIN**      | `tools/git`                                                                               | Módulo tools/git-read.js — wire adapter; extract non-wire business logic.                              |
| `tools/git-write.js`                              |  763 |      1 | **MOVE+THIN**      | `tools/git`                                                                               | Módulo tools/git-write.js — wire adapter; extract non-wire business logic.                             |
| `tools/golden-prompts.js`                         |  116 |      1 | **MOVE+THIN**      | `tools/meta`                                                                              | Módulo tools/golden-prompts.js — wire adapter; extract non-wire business logic.                        |
| `tools/host-blocks.js`                            |  352 |      1 | **MOVE+THIN**      | `tools/diagnostics`                                                                       | Módulo tools/host-blocks.js — wire adapter; extract non-wire business logic.                           |
| `tools/index.js`                                  |   58 |      1 | **DELETE**         | `grouped tool adapters`                                                                   | Módulo tools/index.js — mega tool barrel.                                                              |
| `tools/jobs.js`                                   |  876 |      1 | **SPLIT+THIN**     | `tools/operations`                                                                        | Módulo tools/jobs.js — wire adapter; extract non-wire business logic.                                  |
| `tools/latency-attribution.js`                    | 1769 |      1 | **SPLIT+THIN**     | `tools/diagnostics`                                                                       | Módulo tools/latency-attribution.js — wire adapter; extract non-wire business logic.                   |
| `tools/latency-dashboard.js`                      |  952 |      1 | **SPLIT+THIN**     | `tools/diagnostics`                                                                       | Módulo tools/latency-dashboard.js — wire adapter; extract non-wire business logic.                     |
| `tools/llm-b-live.js`                             | 1062 |      2 | **SPLIT+THIN**     | `tools/integrations`                                                                      | Módulo tools/llm-b-live.js — wire adapter; extract non-wire business logic.                            |
| `tools/maintenance.js`                            |  334 |      1 | **SPLIT+THIN**     | `tools/operations`                                                                        | Módulo tools/maintenance.js — wire adapter; extract non-wire business logic.                           |
| `tools/meta.js`                                   |  378 |      3 | **MOVE+THIN**      | `tools/meta`                                                                              | Módulo tools/meta.js — wire adapter; extract non-wire business logic.                                  |
| `tools/oauth-friction-audit.js`                   |  258 |      1 | **SPLIT+THIN**     | `tools/diagnostics`                                                                       | Módulo tools/oauth-friction-audit.js — wire adapter; extract non-wire business logic.                  |
| `tools/openai-endpoint-latency.js`                |   97 |      1 | **MOVE+THIN**      | `tools/diagnostics`                                                                       | Módulo tools/openai-endpoint-latency.js — wire adapter; extract non-wire business logic.               |
| `tools/project-doctor.js`                         |   65 |      3 | **MOVE+THIN**      | `tools/git`                                                                               | Módulo tools/project-doctor.js — wire adapter; extract non-wire business logic.                        |
| `tools/repo-index.js`                             |  875 |      1 | **SPLIT+THIN**     | `tools/workspace/repository`                                                              | Módulo tools/repo-index.js — wire adapter; extract non-wire business logic.                            |
| `tools/repo-plan.js`                              |  447 |      1 | **MOVE+THIN**      | `tools/workspace/repository`                                                              | Módulo tools/repo-plan.js — wire adapter; extract non-wire business logic.                             |
| `tools/repo-read-cache.js`                        |  630 |      3 | **SPLIT+THIN**     | `tools/workspace/repository`                                                              | Módulo tools/repo-read-cache.js — wire adapter; extract non-wire business logic.                       |
| `tools/repo-read.js`                              | 1346 |      1 | **SPLIT+THIN**     | `tools/workspace/repository`                                                              | Módulo tools/repo-read.js — wire adapter; extract non-wire business logic.                             |
| `tools/repo-status.js`                            |   39 |      6 | **MOVE+THIN**      | `tools/workspace/repository`                                                              | Módulo tools/repo-status.js — wire adapter; extract non-wire business logic.                           |
| `tools/repo-working-set.js`                       |  348 |      1 | **MOVE+THIN**      | `tools/workspace/repository`                                                              | Módulo tools/repo-working-set.js — wire adapter; extract non-wire business logic.                      |
| `tools/repo-write.js`                             | 3692 |      1 | **SPLIT+THIN**     | `tools/workspace/repository`                                                              | Módulo tools/repo-write.js — wire adapter; extract non-wire business logic.                            |
| `tools/restart-control.js`                        |  180 |      1 | **SPLIT+THIN**     | `tools/operations`                                                                        | Módulo tools/restart-control.js — wire adapter; extract non-wire business logic.                       |
| `tools/round-trip-analytics.js`                   |   86 |      1 | **MOVE+THIN**      | `tools/diagnostics`                                                                       | Módulo tools/round-trip-analytics.js — wire adapter; extract non-wire business logic.                  |
| `tools/runtime-health.js`                         |  866 |      1 | **SPLIT+THIN**     | `tools/diagnostics`                                                                       | Módulo tools/runtime-health.js — wire adapter; extract non-wire business logic.                        |
| `tools/session-profile.js`                        |   98 |      1 | **MOVE+THIN**      | `tools/diagnostics`                                                                       | Módulo tools/session-profile.js — wire adapter; extract non-wire business logic.                       |
| `tools/shared/git.js`                             |   39 |      1 | **ABSORB**         | `workspace/git`                                                                           | Módulo tools/shared/git.js — shared git business primitive.                                            |
| `tools/shared/index.js`                           |    9 |      1 | **DELETE**         | `no shared bag`                                                                           | Módulo tools/shared/index.js — generic shared barrel.                                                  |
| `tools/smoke-workspace.js`                        |  210 |      4 | **MOVE+THIN**      | `tools/diagnostics`                                                                       | Módulo tools/smoke-workspace.js — wire adapter; extract non-wire business logic.                       |
| `tools/terminal.js`                               |  311 |      1 | **MOVE+THIN**      | `tools/operations`                                                                        | Módulo tools/terminal.js — wire adapter; extract non-wire business logic.                              |
| `tools/tool-payload-audit.js`                     |   47 |      1 | **SPLIT+THIN**     | `tools/diagnostics`                                                                       | Módulo tools/tool-payload-audit.js — wire adapter; extract non-wire business logic.                    |
| `tools/tools-status.js`                           |  364 |      1 | **SPLIT+THIN**     | `tools/diagnostics`                                                                       | Módulo tools/tools-status.js — wire adapter; extract non-wire business logic.                          |
| `tools/tunnel-status.js`                          |  611 |      2 | **SPLIT+THIN**     | `tools/cloudflare`                                                                        | Módulo tools/tunnel-status.js — wire adapter; extract non-wire business logic.                         |

---

## 29. Observações sobre o inventário arquivo por arquivo

A tabela não autoriza mover cada linha diretamente para o path indicado. O target owner é uma
**hipótese arquitetural forte**, derivada da leitura atual; durante execução:

- `SPLIT` precede move;
- state machine invariants ganham regression antes da decomposição;
- public surface só nasce quando existe cross-owner consumer;
- target path pode ser refinado para um child owner mais estreito;
- nenhum item pode ser enviado para `shared/common` apenas porque dois consumers existem.

---

## 30. Documentos históricos que devem permanecer como ledger

Não apagar nem reescrever como se o caminho nunca tivesse existido:

- `MCP_CANONICAL_ARCHITECTURE_2026-06-01.md`;
- `MCP_AI_BARREL_ARCHITECTURE_AUDIT_ROADMAP_2026-06-01.md`;
- `WORKSPACE_MCP_IO_LATENCIA_LIBERDADE_DIAGNOSTICO_ESTADO_ALVO_ROADMAP_2026-08-17.md`;
- `WORKSPACE_MCP_ROUND_TRIP_PREFLIGHT_RECOVERY_AUTONOMY_DIAGNOSTICO_ESTADO_ALVO_ROADMAP_2026-08-18.md`;
- demais roadmaps especializados Cloudflare/OAuth/latency.

Eles explicam por que certos mecanismos existem e quais regressões já foram resolvidas. A 2.4
**supersede a topologia**, não a evidência histórica.

---

## 31. Próxima ação recomendada

Quando transformação de código for autorizada, **não começar movendo `control-plane`**.

Sequência imediata:

1. concluir os itens ainda abertos da Faixa 0 — baselines machine-readable e focused smoke;
2. reconsultar npm/upstream para confirmar latest stable naquele momento;
3. iniciar a **Faixa 1 como primeira mutação**: SDK v1→v2 stable;
4. preservar/pass-through request context oficial e AbortSignal durante essa migração;
5. optar explicitamente por MCP `2026-07-28`;
6. executar focused conformance e connector real ChatGPT/Cloudflare/OAuth;
7. somente se houver incompatibilidade concreta criar `compat-2025` sobre v2;
8. seguir Faixas 2–5 para lifecycle/authority/composition/Tool Contract antes dos mass moves.

Essa ordem coloca toda a campanha arquitetural sobre a plataforma atual, evita construir novos
owners em torno de APIs já legadas e ainda preserva uma estratégia segura de bisect/compatibilidade.

## 32. Encerramento da auditoria

A pasta MCP não precisa de limpeza de diretórios; precisa de **modernização de plataforma + mudança
de modelo arquitetural**.

A Arquitetura 2.4 corrige a ontologia de owner, torna lifecycle e authority verificáveis, separa
process execution de secret authority, elimina service location, transforma wire tools em leaf
adapters e coloca a migração para **latest stable SDK v2 / MCP 2026-07-28 no início da execução**,
não no fim.

Os assets atuais — workspace tools, batch/preflight, OAuth, Cloudflare, readiness, LLM-B e
diagnostics — devem sobreviver. O que deve desaparecer é a topologia e os contratos fictícios que os
fazem coexistir em hubs sem ownership claro.

Este documento é o ledger operacional da futura campanha. Checkboxes são preenchidos apenas com
evidência; novos gaps podem acrescentar itens; compatibilidade só permanece com consumer real e exit
condition; validação global é reservada a checkpoints relevantes.
