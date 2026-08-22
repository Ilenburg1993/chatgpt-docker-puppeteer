# WORKSPACE — `src/copilot/infra` — Auditoria pós-1.0, arquitetura-alvo 2.0 e roadmap

> **STATUS HISTÓRICO — LEDGER DA ARQUITETURA 2.0.** Este documento preserva diagnóstico, decisões e
> evidências do momento em que foi escrito; não deve ser usado como inventário vivo da árvore, das
> APIs ou dos owners atuais. O estado corrente e o roadmap ativo estão em
> `WORKSPACE_SRC_COPILOT_INFRA_ARQUITETURA_2_1_AUDITORIA_ESTADO_ALVO_ROADMAP_2026-08-21.md`,
> complementados pelos manifests e gates executáveis de `src/copilot/infra/governance/`.

**Data da auditoria:** 21 de agosto de 2026

**Workspace auditado:** `/workspaces/chatgpt-docker-puppeteer`

**Escopo primário:** `src/copilot/infra/**`

**Escopo relacional:** `src/copilot/core`, `src/copilot/types/io-analysis`, `src/copilot/db`,
`src/copilot/boot`, consumidores de `#copilot/infra/public/**`, scripts e contratos arquiteturais
pertinentes.

**Estado Git observado:** `main`, worktree limpo,
`HEAD == origin/main == c3d34aea480843f1ef20a1fd1643040b82d31ef3`, divergência `0/0`.

**Natureza deste documento:** proposta arquitetural e plano de implementação. **Nenhuma alteração
foi executada no repositório durante esta auditoria.**

---

## 0. Sumário executivo

A migração 0.x → 1.0 cumpriu seu objetivo principal: `src/copilot/infra` deixou de ser um conjunto
relativamente plano de helpers e mega-facades para se tornar uma árvore de capabilities com
ownership explícito, dependências acíclicas, barrels puros, separação entre API pública e internals,
testes de governança e uma topologia muito mais coerente.

A conclusão desta auditoria é que a arquitetura 1.0 **deve ser preservada como fundação**, e não
descartada. A ampla maioria dos owners físicos atuais está corretamente posicionada. A arquitetura
2.0 não deve ser uma nova campanha de renames nem uma decomposição motivada por contagem de linhas;
deve resolver limitações que só ficaram visíveis depois que a topologia 1.0 passou a ser
suficientemente limpa para medi-las.

A arquitetura 2.0 proposta muda o eixo de otimização:

1. de **barrel como fronteira de visibilidade** para **entrypoint como fronteira de visibilidade,
   autoridade e custo**;
2. de **singletons processuais distribuídos** para **recursos explicitamente classificados em
   Process / Runtime / Workspace / Operation scopes**;
3. de **trusted I/O genérico** para **capabilities de filesystem com least privilege, roots e
   operações explícitas**;
4. de **minting público de capabilities opacas** para **issuance privada e verificável**;
5. de **health que importa implementações** para **health baseado em probes/snapshots injetados**;
6. de **configuração ambiental lida em vários módulos** para **`InfraConfigSnapshot` imutável por
   runtime**;
7. de **barrels públicos com `export *`** para **surfaces explicitamente enumeradas, classificadas
   por audience/privilege/stability/cost**;
8. de **backend SQLite concreto vazando pelo port** para **contrato estrutural de SQLite**, mantendo
   `better-sqlite3` até benchmark justificar outra decisão;
9. de **best-effort sem convergência explícita** para **retries bounded/degraded-state nos
   workers/schedulers em que perda silenciosa importa**.

Há, além disso, um achado que deve preceder a implementação ampla da 2.0:

> **P0 — integridade da capability de workspace:** os factories `createValidatedReadWorkspacePath` e
> `createValidatedMutableWorkspacePath` são alcançáveis pela API pública. Eles cunham o brand
> privado a partir de `{ realPath, workspaceRoot }` sem executar a policy canônica. Foi comprovado,
> somente em memória, que uma capability pública criada para `/tmp/...` declarando o workspace
> corrente é aceita pelos resolvers read e write. Isso contradiz a promessa documentada de que a
> capability só existe após containment/symlink policy canônica.

Esse achado não significa que uma chamada remota esteja automaticamente explorável; significa que
**a fronteira interna de autoridade não cumpre o contrato que declara cumprir**. A correção deve ser
a primeira faixa da implementação 2.0.

---

## 1. Metodologia e evidências

A auditoria foi executada exclusivamente em modo read-only. Foram usados:

- leitura integral do roadmap canônico da arquitetura 1.0, com 605 linhas;
- inventário físico completo de `src/copilot/infra`;
- leitura do manifest e do module-map de governança;
- leitura integral do charter de infra e da membrane `public`;
- leitura do teste de governance de barrels/arquitetura;
- análise estática de imports/exports via Babel;
- fan-in/fan-out e DAG entre owners;
- inventário de aliases públicos e internos e seus consumers;
- análise de surface width: símbolos exportados vs. símbolos efetivamente usados;
- análise de module-link closure de cada entrypoint público;
- microbenchmark de cold import em processos Node independentes;
- análise de module-scope mutable state, timers, workers e watchers;
- análise de `process.env`, relógio, aleatoriedade, `console` e lifecycle;
- leitura dirigida dos hotspots de cache, invalidation, parser, registry, scopes, trusted/workspace
  filesystem, health, database e boot composition;
- prova em memória do modelo de capability de workspace;
- probe em memória do `node:sqlite` disponível no Node 24.15.0;
- auditoria semântica arquivo a arquivo baseada em docblocks, exports e ownership físico.

### 1.1 Baseline físico

- **378 arquivos totais** em infra: **376 JavaScript + 2 READMEs Markdown**;
- **118 diretórios**, contando o root;
- `filesystem`: 127 arquivos / ~10.926 linhas;
- `indexing`: 102 arquivos / ~8.794 linhas;
- `concurrency`: 20 arquivos / ~1.792 linhas;
- `platform`: 14 arquivos / ~1.337 linhas;
- `cache`: 21 arquivos / ~1.262 linhas;
- demais capabilities são substancialmente menores.

Os maiores arquivos atuais continuam, em sua maioria, coesos: `filesystem/workspace/io.js`, parser
worker runtime, local lock state machine, read caches, L2 SQLite store, scanner service e registry
scheduler. **Não se recomenda decomposição mecânica por LOC.**

### 1.2 Estado de validação herdado da 1.0

A arquitetura publicada em `c3d34aea4` havia fechado com:

- TS7 estrito: verde;
- lint Copilot: verde;
- Prettier global: verde;
- unit suite Copilot: **7.116 testes, 0 falhas, 2.149/2.149 suites**;
- architecture/global/layers: verdes, global strict `hard=0`, `soft=0`;
- public alias matrix: `32/32`;
- filesystem mutation/read/trusted guards: verdes;
- zero stale executable imports para a topologia removida;
- zero `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error` no escopo auditado.

A auditoria 2.0 não invalida esses resultados. Ela identifica limites que os gates 1.0 ainda não
medem.

---

## 2. O que a arquitetura 1.0 acertou e deve permanecer

### 2.1 DAG e ownership físico

A regra de zero circularidade, inclusive em JSDoc/type-only, é correta e deve permanecer hard gate.
A separação física entre platform, concurrency, filesystem, persistence, database, cache,
code-analysis, indexing, operations, telemetry, observability, policy e testing é hoje
semanticamente defensável.

### 2.2 Barrel-first interno

Os barrels internos atuais são explícitos: a auditoria encontrou **zero `export *` nos barrels
internos**. Isso é uma boa disciplina. Same-folder e parent→private-child continuam sendo exceções
razoáveis para evitar indirection inútil.

### 2.3 `public/` como única membrana externa

A quinta regra está conceitualmente correta. Não se recomenda retornar a aliases `#copilot/infra/*`,
wildcard ou mega-barrel root. A 2.0 refina `public/`; não a remove.

### 2.4 Ownership de DB, SSE e webhooks fora de infra

- DB lifecycle/schema em `src/copilot/db`;
- SSE em `presentation/realtime`;
- webhook manager em `agent/infra`.

Essas decisões continuam corretas.

### 2.5 Filesystem transaction/durability

Atomic publish, EXDEV, rollback evidence, mutation-applied state, capacity preflight, locks e
invalidation estão bem separados. A 2.0 deve alterar **como essas capabilities são
concedidas/compostas**, não reescrever os protocolos físicos sem motivo funcional.

---

## 3. Achados críticos e gaps

### 3.1 P0 — minting público rompe a autoridade da capability de workspace

Arquivos centrais:

- `filesystem/workspace/validated-path.js`;
- `filesystem/workspace/index.js`;
- `public/filesystem/workspace/index.js`;
- consumer emissor atual: `src/copilot/tools/file/shared.js`.

O brand usa `Symbol` privado e portanto objetos comuns não conseguem imitá-lo. Porém os próprios
factories que aplicam esse Symbol são públicos por transitividade de `export *`.

O factory:

1. aceita `realPath` e `workspaceRoot` crus;
2. faz apenas `path.resolve`;
3. não exige um `IoPathPolicySuccess` autenticado;
4. não verifica containment;
5. devolve o objeto branded.

O resolver posterior verifica que `capability.workspaceRoot` coincide com o contexto, mas não
revalida que `realPath` esteja contido nesse root. Na prova em memória desta auditoria, uma
capability cujo `realPath` era `/tmp/infra-v2-capability-proof.txt` e cujo `workspaceRoot` era o
workspace real foi aceita para read e write.

**Arquitetura 2.0:**

- remover minting factories de toda surface pública;
- separar **issuer** de **consumer/verifier**;
- issuer recebe resultado de policy canônica, não `{realPath, workspaceRoot}` arbitrários;
- idealmente o issuer é closure/private do `WorkspaceAuthority` instanciado;
- token deve ser ligado à instância/runtime/workspace que o criou;
- API segura oferece `authorizeRead(path)` / `authorizeMutation(path)` que executa policy e retorna
  token opaco;
- nenhum consumer externo precisa conhecer ou importar `createValidated*`;
- criar regression test que tenta produzir um token para path externo sem passar pela policy e
  falha.

### 3.2 P0/P1 — membrane pública projeta autoridade de baixo nível desnecessária

Todos os **32/32** arquivos `public/**/index.js` usam `export *` ou `export * as`.

Consequências:

- adicionar export ao barrel interno pode ampliar API pública sem edição da membrane;
- `public/filesystem/write` projeta `appendFileUnlocked`, `writeAtomicFileUnlocked`,
  `writeFileAtomicPortable`, `deleteFileUnlocked`, `removePathUnlocked`, `moveFileUnlocked`,
  `chmodFileUnlocked` etc.;
- `writeFileAtomicPortable` é documentadamente um writer para paths trusted que **deliberadamente
  pula workspace path policy**;
- `public/database` projeta `getInfraSqliteDatabase`, embora consumers externos usem essencialmente
  o configure no composition root;
- `public/concurrency/locks` projeta acquire/release de baixo nível quando consumers normais usam
  `withIoResourceLock`;
- `public/indexing/storage` projeta o storage SQLite concreto;
- `public/testing` projeta reset/teardown privilegiado sem uma regra de audience aplicada a
  production source.

**Arquitetura 2.0:** nenhum `export *` em `public/**`. Toda surface pública deve enumerar nomes
explicitamente e carregar metadata de audience, privilege, stability e cost tier.

### 3.3 P1 — entrypoints públicos são fronteiras de nome, mas não de custo

Node ESM não faz tree-shaking dos módulos reexportados por barrels. O static link/evaluation closure
medido nesta auditoria mostrou:

| Entrypoint                    | módulos ligados | fonte aprox. | cold import mediano | RSS incremental mediano |
| ----------------------------- | --------------: | -----------: | ------------------: | ----------------------: |
| `public/database`             |               3 |        ~2 KB |               ~2 ms |                ~0,9 MiB |
| `public/concurrency/bulk`     |               3 |        ~9 KB |             ~2,5 ms |                ~0,9 MiB |
| `public/concurrency/locks`    |              41 |      ~119 KB |              ~71 ms |               ~24,8 MiB |
| `public/cache`                |              43 |      ~112 KB |              ~70 ms |               ~24,5 MiB |
| `public/filesystem/read`      |              88 |      ~282 KB |              ~99 ms |               ~36,5 MiB |
| `public/filesystem/write`     |             142 |      ~469 KB |             ~136 ms |                 ~52 MiB |
| `public/filesystem/trusted`   |             164 |      ~559 KB |             ~156 ms |                 ~67 MiB |
| `public/filesystem/skills`    |             166 |      ~563 KB |             ~157 ms |                 ~67 MiB |
| `public/filesystem/workspace` |             166 |      ~577 KB |             ~163 ms |                 ~67 MiB |
| `public/indexing/parser`      |             111 |      ~350 KB |             ~110 ms |               ~39,6 MiB |
| `public/indexing/registry`    |             158 |      ~531 KB |             ~143 ms |               ~55,7 MiB |
| `public/indexing/context`     |             173 |      ~602 KB |             ~161 ms |               ~67,6 MiB |
| `public/indexing`             |             263 |      ~921 KB |             ~206 ms |               ~76,5 MiB |
| `public/indexing/workspace`   |             256 |      ~920 KB |             ~201 ms |               ~76,5 MiB |
| `public/operations`           |             161 |      ~534 KB |             ~152 ms |               ~67,6 MiB |
| `public/observability`        |             260 |      ~935 KB |             ~208 ms |               ~65,4 MiB |
| `public/testing`              |             189 |      ~575 KB |             ~150 ms |               ~52,4 MiB |

A surface de skills é um caso didático: exporta somente uma função útil, mas puxa quase a mesma
closure de filesystem/workspace porque depende do barrel genérico de trusted I/O.

**Arquitetura 2.0:** entrypoint é também **cost boundary**. Barrels públicos runtime devem ser
estreitos; aggregate aliases sem consumers (`public/concurrency`, `public/filesystem`,
`public/persistence`) devem deixar de ser package entrypoints. `public/indexing` também deve ser
fatiado por intenção.

### 3.4 P1 — trusted I/O é uma autoridade genérica e muito ampla

`filesystem/trusted/io.js` é coerente com 1.0: exige `caller` e a política declarativa fail-closed
enumera importers. Porém ele deliberadamente não aplica workspace containment e oferece primitives
genéricas read/write/stat/list/watch/chmod/delete.

Há cerca de **45 production consumers** do alias público trusted. O caller string melhora auditoria,
mas não é uma capability de autoridade: não limita root, operação ou symlink domain em runtime.

**Arquitetura 2.0:** substituir progressivamente `trusted` por **configured filesystem grants**:

```text
ConfiguredFsGrant {
  id
  canonicalRoot | exactPaths
  allowedOperations
  symlinkPolicy
  durabilityPolicy
  runtimeId
  policyVersion
}
```

O grant deve ser criado no composition root a partir de configuração confiável e entregue ao owner
correspondente. Child paths só podem ser derivados dentro do grant. O manifest deixa de ser apenas
“este arquivo pode importar trusted” e passa a descrever grants/authority esperados.

### 3.5 P1 — mutable state process-global está espalhado em múltiplos owners

Exemplos:

- L1/L2 cache singleton;
- database provider singleton;
- invalidation bus singleton;
- cross-process consumer singleton;
- external watcher single-root;
- parser worker pool global;
- index registry singleton;
- index auto-refresh scheduler com um workspace/domain;
- prefetch sessions e scope registry globais;
- métricas e caches de linha globais.

Alguns desses recursos **devem** continuar process-global por semântica (resource locks, compile
cache e possivelmente parser pool). O problema é que a decisão é implícita e distribuída.

**Arquitetura 2.0:** toda mutable stateful capability recebe uma classificação explícita:

- `ProcessInfra`: coordenação realmente process-wide;
- `InfraRuntime`: estado de uma instância do runtime Copilot;
- `WorkspaceInfra`: estado ligado a um workspace/root;
- `OperationContext`: trace/abort/deadline/budget por operação.

### 3.6 P1 — scheduler de índice pode perder convergência após falha

`scheduler.js` remove o batch de `_pendingIndexRefreshPaths` antes de chamar o executor.
`executeIoIndexPathRefresh` contabiliza failures, mas paths que falham não são recolocados na fila.
O comentário do scheduler afirma que falhas “permanecem elegíveis ao retry assíncrono”, mas a
estrutura não preserva essa elegibilidade automaticamente.

**2.0:** estado por path com `attempt`, `nextEligibleAt`, bounded exponential backoff, max
attempts/degraded/dead-letter observável e requeue apenas de failures transitórias.

### 3.7 P1 — `startSessionScope` pode deixar registro ativo após throw

`indexing/context/prefetch/session.js` insere `_scopes.set(sessionId, scope)` antes de
`await warmCacheForPaths`. Se o warm lança (por exemplo AbortSignal), a função não remove/encerra o
scope nesse caminho.

**2.0:** transformar scope em resource handle com lifecycle transacional
(`opening → ready/degraded → closing → closed`) e cleanup garantido; adicionar fault tests.

### 3.8 P1 — read-side pode ativar lifecycle

`indexing/registry/runtime/service.js#getIoIndex()` chama `ensureIndexInvalidationHook()`.
`getIoIndexStats()` chama `getIoIndex()`. Logo uma operação semanticamente de leitura de stats pode
instalar um hook de invalidation e materializar o index singleton.

**2.0:** `start()`/composition instala lifecycle. `snapshot()/stats()` nunca abre DB, cria cache,
registra hook, watcher ou worker.

### 3.9 P1 — audience de `testing`/diagnostics ainda não é enforcement de produção

`#copilot/infra/public/testing` é um alias legítimo e hoje só aparece em tests/scripts, mas a
governance “external imports must be public” também o tornaria sintaticamente aceitável para
production code. O mesmo vale, em grau menor, para `public/indexing/storage`.

**2.0:** public API manifest com audience hard-gated:

- `runtime`;
- `composition`;
- `diagnostic/tooling`;
- `test-only`.

### 3.10 P2 — configuração ambiental distribuída

Foram observadas **54 referências a `process.env`** em infra, inclusive parser config avaliada no
module load, caches, locks, rollback, invalidation e index. Isso dificulta múltiplos runtimes com
configurações diferentes e testes determinísticos.

**2.0:** `readInfraConfig(env)` puro → `InfraConfigSnapshot` frozen por runtime. Reconfiguração
dinâmica, quando necessária, torna-se explícita.

### 3.11 P2 — port SQLite vaza `better-sqlite3`

`database/provider.js` tipa concretamente `better-sqlite3.Database`. O Node 24.15.0 local oferece
`node:sqlite` com `prepare`, `exec`, FTS5, JSON e `RETURNING`, mas não possui helper
`.transaction()`.

**2.0:** definir `SqlitePort` estrutural mínimo e adapter do driver. Manter `better-sqlite3` como
default até benchmark funcional/performance provar vantagem de outra opção. Não trocar driver como
dogma.

### 3.12 P2 — health tem fan-out e custo excessivos

`observability/health.js` importa diretamente cache, locks, read state, workspace path stats, index,
parser, scopes e telemetry. É read-side em comportamento, mas não em dependency cost.

**2.0:** `HealthProbeRegistry` composto no runtime. Cada capability registra/projeta um snapshot
leve; health depende de contratos/probes, não das implementações.

### 3.13 P2 — `#copilot/core` root amplifica o blast radius de infra

Infra usa o root `#copilot/core` sobretudo para `createIoTraceId`, `buildIoMeta`, `toError`,
timer/shutdown e path policy. Cold import medido:

- `#copilot/core`: ~54 ms / +20,8 MiB RSS;
- `#copilot/core/io-contracts`: ~1,7 ms / +1 MiB RSS.

**2.0 relacionada:** criar/usar micro-surfaces semânticas em `core` (`io-contracts`, policy,
lifecycle/timers, error helpers), mantendo ownership em core.

### 3.14 P2 — `export *` público cria API por acidente

O problema não é apenas performance. A membrane 1.0 diz que exposição deve ser deliberada, mas o
mecanismo atual torna a exposição transitiva. A 2.0 deve tornar cada nome público um ato explícito
de design.

### 3.15 P2 — legacy e nomenclatura de teardown

- `concurrency/locks/file/legacy.js` ainda existe como compatibilidade;
- production `shutdownParserWorkerPool` delega a uma função chamada
  `teardownParserWorkerPoolForTest`;
- aggregate aliases públicos não usados permanecem no package map.

Não são bugs graves, mas a 2.0 é a oportunidade para remover dívida semântica depois de confirmar
consumers.

---

## 4. Invariantes propostas para Arquitetura 2.0

As regras 1–5 da arquitetura 1.0 permanecem, com as seguintes extensões.

### Regra 1 — DAG absoluto

Sem ciclos runtime ou JSDoc/type-only. Mantida integralmente.

### Regra 2 — ownership físico

Filho exclusivo vive sob seu owner. Shared capability só sobe quando possui múltiplos consumidores
independentes. Mantida.

### Regra 3 — barrel-first interno

Cross-folder lateral/upward usa barrel. Same-folder e parent→private-child continuam exceções.
Mantida.

### Regra 4 — coerência acima de LOC

Split exige mudança de responsabilidade, lifecycle, estado, consumidor ou direção de dependência.
Mantida.

### Regra 5 — public membrane exclusiva

Todo consumer externo de infra continua entrando por `infra/public/**`. Mantida e fortalecida.

### Regra 6 — entrypoint é cost boundary

Cada entrypoint público/interno hot-path possui budget de static closure. Aggregate barrel sem uso
não é package alias. Cold import é benchmark ratcheted, não gate absoluto dependente de máquina.

### Regra 7 — public exports são nominais

`public/**` não usa `export *` nem namespace-star. Todo símbolo público é enumerado explicitamente.

### Regra 8 — authority constructors são privados

Factories capazes de cunhar capabilities privilegiadas não são runtime-public. Issuance exige
proof/result de policy canônica ou composition authority.

### Regra 9 — least privilege para paths externos

Não existe trusted generic runtime authority entregue em toda parte. Configured paths são grants
limitados por root/path, operações e policy.

### Regra 10 — lifecycle possui owner explícito

Timer, worker, watcher, DB binding, scheduler e long-lived hook pertencem a um resource scope e
possuem `dispose()`/`close()` idempotente.

### Regra 11 — mutable global state requer allowlist semântica

Process globals só permanecem se a coordenação process-wide for parte da semântica. Todo outro
estado migra para Runtime/Workspace instances.

### Regra 12 — read-side purity

`get*Stats`, `read*Snapshot`, `health` e queries não inicializam lifecycle, não registram hooks e
não abrem recursos ocultamente.

### Regra 13 — audience/privilege/stability explícitos

Cada public alias declara `audience`, `privilege`, `stability`, `lifecycle`, `owner`, `costTier`.
Production não importa `test-only`.

### Regra 14 — backend ports não vazam adapters concretos

Contratos de DB/storage são estruturais; driver concreto fica no adapter/composition owner.

### Regra 15 — best-effort relevante precisa de convergência observável

Quando uma tarefa derivada pode ser perdida (refresh/index/replay), failure precisa de
retry/degraded state ou justificativa explícita de eventual recuperação independente.

### Regra 16 — configuração stateful é snapshotada

Stateful services não leem `process.env` arbitrariamente no hot path. Boot cria um snapshot frozen e
injeta configuração.

### Regra 17 — observabilidade não domina o grafo

Health/metrics dependem de probes/contracts. Implementações não são importadas apenas para ler
estado.

### Regra 18 — governance representa a API real

Manifest de API pública e package aliases têm paridade exata, assim como audience/cost gates e docs.
Nenhuma regra essencial depende apenas de convenção textual.

---

## 5. Modelo de lifecycle 2.0

### 5.1 `ProcessInfra`

Recursos cuja semântica é realmente process-wide:

- resource locks locais/multiprocess, porque devem coordenar todos os runtimes do processo;
- Node compile cache;
- diagnostics channels;
- parser worker pool, **se** benchmark confirmar que compartilhar pool é superior a particionar;
- clocks/entropy providers leves.

### 5.2 `InfraRuntime`

Um runtime Copilot isolável:

- `SqlitePort` binding;
- L1/L2 cache namespace;
- invalidation bus + journal consumer;
- runtime telemetry state;
- index registry instance;
- registry health probes;
- lifecycle registry e `dispose()`.

### 5.3 `WorkspaceInfra`

Estado ligado a `workspaceRoot`:

- workspace authorization issuer/verifier;
- read/write/mutation facade estreita;
- external watcher daquele root;
- index auto-refresh scheduler/domain;
- workspace indexing/search facade;
- working-set/scope registry;
- configured grants derivados para paths específicos quando necessário.

### 5.4 `OperationContext`

Estado por operação:

- `traceId`;
- `runtimeId`/`workspaceId`;
- `AbortSignal`;
- deadline/budget;
- caller identity;
- optional AsyncLocalStorage **somente para correlação/telemetria**, nunca como fonte de
  autorização.

---

## 6. Árvore-alvo 2.0

A árvore proposta preserva a maior parte da 1.0. Novos elementos são principalmente
composition/authorization/contracts.

```text
src/copilot/infra/
├── README.md
├── governance/
│   ├── architecture-manifest.js
│   ├── public-api-manifest.js          # novo: alias + audience + privilege + stability + cost tier
│   ├── cost-manifest.js                # opcional: baseline/ratchet determinístico
│   └── module-map.js
├── composition/                        # novo: sink do DAG; nenhuma capability importa de volta
│   ├── process/
│   ├── runtime/
│   ├── workspace/
│   └── operation/
├── platform/                           # preservar owners puros/Node-specific
├── concurrency/                        # preservar; classificar process-scoped
├── filesystem/
│   ├── authorization/                  # novo owner da authority
│   │   ├── workspace/                  # issuer/verifier privado por WorkspaceInfra
│   │   └── configured/                 # grants least-privilege para paths externos
│   ├── read/                           # preservar kernels
│   ├── write/                          # preservar kernels; *Unlocked nunca public runtime
│   ├── mutation/                       # preservar kernels
│   ├── transaction/                    # preservar
│   ├── invalidation/                   # converter runtime globals em instances
│   ├── patch/                          # preservar pure algorithms/services
│   ├── skills/                         # migrar para configured grant estreito
│   └── workspace/                      # virar facade/adapter instanciado; sem minting cru
├── persistence/                        # preservar; grants para paths configured
├── database/
│   ├── contracts/                      # novo SqlitePort estrutural
│   └── adapter/                        # binding do provider/runtime
├── cache/                              # preservar kernels; state instanciado
├── code-analysis/                      # preservar praticamente intacto
├── indexing/
│   ├── scanner/                        # preservar
│   ├── parser/                         # ProcessInfra pool + runtime caches explícitos
│   ├── registry/                       # instance + scheduler por workspace
│   ├── search/                         # preservar kernels
│   ├── context/                        # resource handles para scopes
│   └── workspace/                      # facade instanciada
├── operations/                         # preservar; contracts e rollback
├── telemetry/                          # snapshots por runtime; diagnostics channels leves
├── observability/                      # probe registry; sem import das implementações
├── policy/                             # preservar policies puras; config state sai daqui
├── testing/                            # test-control composition; audience test-only
└── public/
    ├── composition/...                 # composition-only
    ├── platform/<micro-surface>/...
    ├── concurrency/bulk/...
    ├── concurrency/locks/...           # apenas high-level with-lock API
    ├── filesystem/workspace/...        # safe workspace-bound API
    ├── filesystem/configured/...       # somente grant-bound APIs apropriadas
    ├── indexing/query|build|context|workspace/...
    ├── operations/rollback|audit/...   # surfaces por intenção
    ├── observability/health/...
    ├── diagnostics/...                 # tooling-only
    └── testing/...                     # test-only
```

### 6.1 O que não deve acontecer

- não criar `infra/index.js`;
- não criar `public/index.js`;
- não voltar a `#copilot/infra/*`;
- não criar um “Infra God Object” com centenas de métodos;
- não envolver toda função pura em classe/DI;
- não mover parser/scanner/locks apenas para reduzir linhas;
- não trocar `better-sqlite3` sem benchmark;
- não fazer dynamic import indiscriminadamente para esconder arquitetura ruim.

---

## 7. API pública 2.0

### 7.1 Manifest por entrypoint

Exemplo conceitual:

```js
{
  specifier: '#copilot/infra/public/filesystem/workspace',
  target: 'src/copilot/infra/public/filesystem/workspace/index.js',
  owner: 'filesystem/workspace',
  audience: 'runtime',
  privilege: 'workspace-bounded',
  stability: 'stable',
  lifecycle: 'workspace-instance',
  costTier: 'hot'
}
```

### 7.2 Audiences

- **runtime:** importável por production code comum;
- **composition:** somente boot/process host/composition roots;
- **diagnostic/tooling:** scripts, MCP diagnostics e benchmarks explicitamente autorizados;
- **test-only:** somente `tests/**` e tooling de teste.

### 7.3 Public barrel rule

Permitido:

```js
export { createWorkspaceFs } from '../../../composition/workspace/index.js';
```

Proibido:

```js
export * from '../../../filesystem/workspace/index.js';
```

### 7.4 Surfaces a retirar ou fatiar

- remover package aliases agregadores sem consumers: `public/concurrency`, `public/filesystem`,
  `public/persistence`;
- retirar `public/indexing` como mega-entrypoint runtime; substituir por intenção;
- `public/platform` deve ser fatiado em micro-surfaces onde o custo justificar;
- `public/database` torna-se composition-only e não expõe raw getter normal;
- `public/indexing/storage` migra para diagnostics/tooling;
- `public/testing` recebe gate de audience;
- `public/filesystem/write` deixa de projetar unlocked/portable internals.

---

## 8. Filesystem authorization 2.0

### 8.1 Workspace authority

A policy canônica deve morar no fluxo de autorização, não em tools.

```text
request path
  → WorkspaceAuthority.authorize(mode, path)
  → evaluateIoPathPolicyAsync
  → canonical policy result
  → private issuer
  → opaque token bound to WorkspaceInfra instance
  → read/write/indexing consumer
```

O token não precisa expor factory nem brand. Consumers de alto nível recebem o token e o passam a
methods validados.

### 8.2 Configured filesystem authority

Substitui o trusted genérico:

```text
trusted boot config
  → composition grant declaration
  → canonicalize root/exact path
  → immutable ConfiguredFsGrant
  → owner-specific adapter
```

O grant deve limitar:

- roots/exact files;
- operations;
- symlink behavior;
- mutation durability;
- runtime/workspace identity;
- optional file-name/pattern policy.

### 8.3 Low-level primitives

`read/snapshot`, `write/*Unlocked`, transaction primitives e raw watchers permanecem internal. API
pública normal opera sobre workspace/configured instances, não paths arbitrários.

---

## 9. Cost architecture 2.0

### 9.1 Gates determinísticos

Para cada entrypoint runtime:

- número de módulos na static closure;
- bytes de source na closure;
- lista de heavy dependencies carregadas;
- proibição de dependência em aggregate aliases sem justificativa.

### 9.2 Tiers propostos

Valores iniciais devem ser calibrados e ratcheted após a primeira migração; não devem virar números
mágicos. Referência inicial:

- **hot:** objetivo ≤ 25 módulos / ≤ 150 KB de closure;
- **service:** objetivo ≤ 60 módulos / ≤ 350 KB;
- **composition:** pode exceder service, mas não é usado em hot paths;
- **diagnostic/test:** medido, sem bloquear runtime startup.

Cold import ms/RSS permanece benchmark comparativo, porque varia por máquina e cache.

### 9.3 Dependência de `core`

Criar micro-surfaces em `core` para impedir que `createIoTraceId/buildIoMeta` puxem todo o root. A
regra barrel-first continua, mas o barrel deve corresponder à capability (`core/io`,
`core/lifecycle`, `core/errors`) em vez de mega-root.

---

## 10. Database/SQLite 2.0

### 10.1 `SqlitePort`

Contrato mínimo deve modelar apenas o realmente usado:

- `prepare()` → statement `run/get/all`;
- `exec()`;
- transaction wrapper no adapter;
- `close/open` quando o owner necessita;
- metadados necessários a health.

### 10.2 Backend default

`better-sqlite3` continua default até prova contrária.

### 10.3 Experimentação Node 24

Probe local confirmou que `node:sqlite` possui FTS5/JSON/RETURNING e primitives síncronas, mas não
`.transaction()`. Uma fase futura pode implementar adapter e benchmarkar:

- throughput de prepared statements;
- FTS query/build;
- WAL/concurrency;
- startup/native addon cost;
- transaction semantics;
- memória;
- compatibilidade com schema/migrations.

A troca só acontece se o conjunto for superior ou operacionalmente mais simples.

---

## 11. Indexing 2.0

### 11.1 Registry instance

`getIoIndex()` deixa de ser singleton implícito e passa a vir de `InfraRuntime`/`WorkspaceInfra`.

### 11.2 Side-effect-free stats

`index.snapshot()` não registra hooks. Hooks são instalados em `runtime.start()`/constructor
composition controlado.

### 11.3 Scheduler confiável

Cada path pending deve possuir estado de tentativa. Failure transitória volta à fila com backoff e
jitter bounded. Failure permanente vira degraded evidence. Counters distinguem:

- queued/coalesced;
- attempted;
- succeeded;
- transientFailed;
- permanentFailed;
- retried;
- exhausted;
- pending age/high-water.

### 11.4 Scopes como resources

`openScope()` retorna handle com `awaitReady`, query methods e `dispose`. Abertura falha não deixa
registro órfão. Workspace/runtime id entra na identidade do scope.

### 11.5 Parser pool

Preservar worker threads, mas transformar lifecycle em ProcessInfra explícito. Separar
`disposeParserWorkerPool` de test reset. Quotas por runtime podem ser adicionadas sem pools
duplicados.

---

## 12. Observability e telemetry 2.0

### 12.1 Probe registry

Cada capability stateful oferece uma função leve `snapshot()` ou registra probe durante composition.
Health agrega probes.

### 12.2 Sem activation por observabilidade

Probe não cria L2, DB, worker, watcher, index ou hook. Ausência de recurso é estado observável
legítimo.

### 12.2.1 Estado de telemetria runtime-owned — implementado em 2026-08-21

A telemetria operacional de I/O foi convertida de estado mutável module-scope para quatro facets
independentes de instância — advisory budget, latency, durability e mutation-state — agregadas por
um `IoTelemetryRuntime` possuído por `InfraRuntime`. A composição propaga a instância por
`InfraRuntime → WorkspaceInfra → WorkspaceReadIo/WorkspaceMutationIo` e pelo registry de índice. O
transporte até as primitives de I/O usa um `Symbol` privado no publisher; ele é uma seam interna,
não integra a membrana pública e não depende de `AsyncLocalStorage`.

Uma regressão multi-runtime sobre o mesmo `workspaceRoot` prova isolamento de leitura, escrita,
histogramas de latência, durability, advisory budget e applied-but-unconfirmed mutation state. Os
quatro antigos migration targets de telemetria foram removidos do state-scope manifest depois de o
detector confirmar `stale` para todos e `undeclared = 0`. As facades default permanecem apenas como
compatibilidade process-local para callers raw ainda não compostos; o caminho
application/MCP/file-tools usa ownership de `InfraRuntime`.

O custo estático adicional foi reduzido até desaparecer dos entrypoints de filesystem/read/write: a
seam foi incorporada ao `publisher.js`, módulo que já pertencia à closure. Somente
`composition/runtime` e `composition/process` ganharam um módulo — o owner agregado
`telemetry/runtime/service.js` — decisão intencional para preservar coesão em vez de inflar o
composition root.

### 12.2.2 Mutation audit runtime-owned e activation lazy — implementado em 2026-08-21

O registry process-global de `JsonlFileWriter` de `operations/audit-log.js` foi eliminado. A
capability `createIoMutationAuditRuntime` possui um único writer lazy por instância e oferece
`record/flush/snapshot/dispose`; o adapter histórico `recordIoMutationAudit` tornou-se one-shot e
sem estado global. O caminho de produção das file-tools usa
`APPLICATION_INFRA_RUNTIME.mutationAudit`, portanto não consulta `process.env` nem escolhe writer a
cada mutação.

Para impedir que a composição fria carregue a árvore pesada de JSONL/persistence, `InfraRuntime`
possui um `mutation-audit-owner` leve. Ele captura `COPILOT_IO_MUTATION_AUDIT_LOG_PATH` exatamente
uma vez na criação do runtime e usa `import()` dinâmico somente no primeiro `record()`.
`snapshot()`, `flush()` de owner ainda ocioso e `dispose()` de owner nunca materializado não ativam
persistence nem tocam filesystem. Testes comprovam captura de configuração, dispose idempotente,
ausência de arquivo antes da primeira gravação e isolamento entre dois runtimes com sinks
diferentes.

O primeiro desenho com import estático acrescentava 49 módulos aos entrypoints de composição e foi
rejeitado. O owner lazy reduz o delta frio a um único módulo leve em `composition/runtime` e
`composition/process`, sem alterar a superfície pública nominal. Após o detector confirmar
`operations/audit-log.js` como `stale` e `undeclared = 0`, seu migration target foi removido do
state-scope manifest.

### 12.2.3 L1 runtime-owned, compatibility boundary e detector de stateful factories — implementado em 2026-08-21

O antigo `cache/memory/cache.js` deixou de possuir o singleton L1 e tornou-se uma facade stateless.
O caminho normal da aplicação usa `InfraRuntime.coherence.l1`; reads, prefetch, diff, index/context
e file-tools recebem essa instância por composição. Os poucos callers raw que ainda exigem semântica
histórica usam um owner explicitamente denominado `cache/memory/process-compat.js`. O fallback de
reads/prefetch é carregado por `import()` dinâmico, portanto o compatibility cache não participa da
closure fria do `InfraRuntime`.

O default invalidation bus compartilha o mesmo L1 de compatibilidade, preservando coerência para
callers raw. Em paralelo, tools de hook/task/session/search, hook context, BYOK e MCP reload-state
deixaram de criar `WorkspaceIo/WorkspaceIndexing` locais e passaram a reutilizar o
`APPLICATION_INFRA_RUNTIME`. O `diffText` workspace-bound também passou a executar suas leituras
internas com o mesmo cache/read/telemetry runtime do facade que o autorizou.

A auditoria também revelou uma limitação do detector anterior:
`const DEFAULT_X = createFooRuntime()` não era classificado como state module quando a mutação
acontecia através da referência retornada. O detector passou a tratar factories stateful
(`create*Runtime/Registry/Cache/Store/Bus/Watcher/Writer`) em module scope como ownership de estado.
A mudança tornou visíveis doze defaults de compatibilidade já existentes (L2, invalidation,
read-derived caches, parser, index registry e telemetria). Todos receberam decisão explícita
`process/allowed-global`, com o owner application/runtime correspondente registrado na rationale.

Após essa auditoria ampliada, o ratchet de estado fica em `migrationTargets = []`,
`undeclared = []`, `stale = []`: não há mais estado module-scope classificado como
RuntimeInfra/WorkspaceInfra aguardando migração. Os globals process-wide restantes são coordenação
intrinsecamente processual ou compatibility surfaces explicitamente catalogadas; novos stateful
runtimes module-scope passam a falhar governance se não forem classificados.

### 12.3 Logging

Os três `console.*` residuais do L2 runtime devem migrar para diagnostics/observability injetável ou
diagnostics_channel. Infra não precisa importar o logger global apenas para isso.

---

## 13. Configuração 2.0

`readInfraConfig(env)` produz estrutura frozen contendo seções de cache, parser, invalidation,
locks, rollback, read indexes, index refresh e diagnostics.

Policies puras continuam aceitando override explícito para testes. O runtime não consulta
`process.env` repetidamente.

Benefícios:

- múltiplos runtimes com configurações distintas;
- testes determinísticos;
- documentação automática de config efetiva;
- health pode mostrar config snapshot sem reavaliar ambiente;
- hot paths deixam de fazer parsing ambiental.

### 13.1 Estado implementado do snapshot/configuração — 2026-08-21

O `InfraRuntime` passou a projetar uma configuração frozen uma única vez na criação e a injetá-la
nos owners de L1, L2, invalidation/cross-process, read-derived state, parser cache, index
registry/SQLite, external watch, telemetry, mutation audit, rollback e capacity preflight. Alterar
`process.env` depois da criação não reconfigura uma instância viva; um novo runtime captura o novo
snapshot.

Rollback deixou de ser uma decisão ambiental escondida nas primitives. A policy imutável do runtime
contém `enabled/directory/ttlMs/maxEntries/maxBytes`; raw write/delete/patch/copy/move obedecem
somente a opções explícitas, enquanto `WorkspaceInfra` injeta a policy da composição. Storage,
retention, inventory, cleanup e executor recebem o mesmo contexto explicitamente. Os getters
ambientais legados e `getIoMutationAuditLogPath` foram removidos da surface pública. Paths internos
de rollback permanecem redigidos das respostas públicas.

O capacity preflight segue a mesma regra: `IO_CAPACITY_PREFLIGHT_*` é projetado uma vez por runtime.
O cache de `statfs`, por representar o filesystem físico comum aos runtimes, permanece
deliberadamente process-wide e bounded (256 chaves), com TTL configurável e documentado em
`.env.expert.example`/`.env.schema.json`.

File locks também são uma exceção processual explícita: o perfil multiprocess, stale timeout,
acquire timeout e lock directory são capturados uma vez no bootstrap do processo. Um perfil inválido
falha de forma segura para `off` nas ativações automáticas, preserva o erro para diagnostics e não
bloqueia um override explícito. Testes multiprocess continuam provando exclusividade e stale-lock
recovery entre processos reais.

Governance agora mantém uma allowlist **exata** dos arquivos autorizados a tocar `process.env` e
distingue config resolvers/factories de direct bootstrap touchpoints. Uma nova leitura ambiental —
ou uma exceção que fica obsoleta — produz drift. Isso transforma a Regra 5 em invariável executável,
não apenas convenção.

---

## 14. Governança 2.0

Novos hard gates propostos:

1. zero cycles — manter;
2. barrel puro — manter;
3. external-only-through-public — manter;
4. **zero `export *` em public**;
5. public alias set == public API manifest;
6. audience import policy;
7. privilege policy: low-level/unlocked/issuer symbols não entram em runtime-public;
8. authority issuer files não têm caminho de import a partir de public runtime;
9. static closure budgets por cost tier;
10. process-global state allowlist + rationale;
11. query/read-side purity tests para recursos stateful;
12. lifecycle dispose idempotence tests;
13. configured grant containment/operation tests;
14. scheduler retry/convergence fault tests;
15. public symbol snapshot para detectar API growth acidental;
16. ambient `process.env` permitido somente em config/composition leaves allowlisted;
17. concrete DB package import restrito ao DB adapter owner;
18. docs/manifests/package imports em paridade.

---

## 15. Questões indiretas fora de infra

### 15.1 `src/copilot/core`

Criar micro-surfaces semânticas para I/O/lifecycle/error helpers. Não mover ownership para infra.

### 15.2 `src/copilot/types/io-analysis`

Está corretamente modelado como contratos puros, zero runtime. Preservar.

### 15.3 `src/copilot/db`

Permanece owner do lifecycle/schema/migrations. Pode fornecer adapter `SqlitePort` ao `InfraRuntime`
em vez de provider global.

### 15.4 `src/copilot/boot`

Deve se tornar o composition root explícito:

```text
boot config + DB owner + process services
→ createInfraRuntime(...)
→ create WorkspaceInfra(root)
→ registrar lifecycle
→ entregar capabilities públicas às bordas
```

### 15.5 MCP/terminal/agent/config consumers

Consumers de generic trusted I/O devem migrar por clusters de autoridade, não arquivo a arquivo
aleatório:

- MCP control-plane state;
- MCP Cloudflare/tunnel state;
- agent/session state;
- model-gateway configured storage;
- SDK state;
- terminal operator state;
- observability state;
- configured skills.

---

## 16. Roadmap completo para implementação 2.0

Os checkboxes abaixo passaram a registrar também a **implementação efetivamente comprovada após a
auditoria**. Itens `[x]` possuem implementação e evidência focada no worktree atual; itens `[ ]`
permanecem pendentes ou exigem gate mais amplo antes de serem declarados concluídos.

### Faixa 0 — segurança/capability integrity

- [x] Criar teste de regressão que demonstra que public runtime não pode cunhar token para path
      externo.
- [x] Criar issuer privado de workspace capability que exige resultado canônico de policy.
- [x] Migrar `tools/file/shared` para API segura `authorize*`.
- [x] Remover `createValidated*` das surfaces públicas.
- [x] Garantir binding token ↔ workspace/runtime instance.
- [x] Auditar todos os public exports de primitives que pulam containment.
- [x] Retirar `*Unlocked`/portable/raw authority da API runtime.
- [ ] TS7/lint/unit/security gates verdes antes de prosseguir.

### Faixa A — public API manifest 2.0

- [x] Introduzir metadata `audience/privilege/stability/lifecycle/costTier` por alias.
- [x] Proibir `export *` e namespace-star em `public/**`.
- [x] Converter todos os public barrels para exports nominais.
- [x] Remover package aliases agregadores sem consumers.
- [x] Separar runtime/composition/diagnostic/test-only surfaces.
- [x] Gate production → test-only = hard error.
- [x] Gate production → diagnostic = hard error salvo allowlist explícita.
- [x] Snapshot de símbolos públicos e review de qualquer crescimento.

### Faixa B — cost boundaries

> Política vigente: custo continua mensurado como valor observado, enquanto o hard limit versionado
> usa aproximadamente **1,5×** esse baseline para module count/source bytes. O objetivo é detectar
> explosões acidentais e novas dependências pesadas, não impor um teto estreito à evolução
> arquitetural.

- [x] Implementar analisador de static import closure por entrypoint.
- [x] Registrar baseline de module count/source bytes/heavy deps.
- [x] Definir cost tiers e ratchet com headroom operacional de ~1,5× sobre o baseline observado.
- [x] Fatiar `public/indexing` por intenção.
- [x] Fatiar `public/platform` onde o ganho for material.
- [x] Fatiar workspace dependencies para evitar carregar write/indexing desnecessariamente;
      `trusted` permanece alvo da Faixa E.
- [x] Remover aliases root `concurrency/filesystem/persistence` sem consumers.
- [ ] Criar cold import benchmark advisory no CI/perf harness.

### Faixa C — composition scopes

- [x] Criar `composition/process` sem implementar God Object.
- [x] Classificar explicitamente todos os current globals como Process/Runtime/Workspace.
- [x] Criar `InfraRuntime` com lifecycle idempotente.
- [x] Criar `WorkspaceInfra` por root.
- [x] Definir `OperationContext` e política de AsyncLocalStorage somente para correlação.
- [x] Criar `dispose()`/`close()` idempotente e aggregation de erros de teardown.
- [x] Garantir que imports não iniciam recursos.

### Faixa D — config snapshot

- [x] Criar parser puro `readInfraConfig(env)` separado de lifecycle/composition runtime.
- [x] Congelar `InfraConfigSnapshot` por runtime.
- [x] Migrar parser process config para `readParserProcessConfig(env, parallelism)` + snapshot único
      de bootstrap.
- [x] Migrar cache/invalidation/locks/rollback/read-index/capacity config conforme lifecycle; locks
      multiprocess ficam process-bootstrap.
- [x] Manter apenas env readers/config resolvers explicitamente allowlisted e protegidos por
      governance.
- [x] Documentar política: RuntimeInfra captura config na criação; ProcessInfra captura no
      bootstrap; reconfiguração exige nova instância/processo ou override explícito.

### Faixa E — configured filesystem grants

> **Consumidor de referência desta faixa:** o MCP server exposto via Cloudflare e usado por
> ChatGPT/Claude para operar este workspace. Segurança de authority, estabilidade do conector,
> latência/round-trip e ergonomia das tools são critérios arquiteturais de primeira ordem. Migrações
> que apenas troquem `trusted(path)` por `grant({ path recebido do caller })` são proibidas:
> authority deve ser fixada por bootstrap/configuração/owner antes do uso operacional.

#### E.0 — critérios executáveis e ledger da onda corrente

- [x] Definir least-privilege como `path domain + operations + symlink policy + durability`, não
      apenas caller string.
- [x] Criar policy fail-closed de owners autorizados a cunhar grants.
- [x] Evoluir a policy para schema v2 e ratchet da **forma efetiva da authority** (`pathMode`,
      operações, symlink, durability), impedindo ampliação silenciosa sob o mesmo grant id.
- [x] Proibir grants com identidade dinâmica ou campos de authority desconhecidos pelo checker AST.
- [x] Estabelecer regra: não cunhar grant a partir de `filePath`/`directory` arbitrário recebido
      pela operação.
- [x] Preservar `trusted` somente enquanto um owner ainda não puder ser bound corretamente; não
      criar shims legados apenas para facilitar a migração.
- [x] Fechar a onda corrente em **8 configured owners / 36 trusted owners** com ambos os manifests
      sem drift — comprovado em 2026-08-21: configured `8/8`, trusted `36/36`, zero drift.
- [x] Manter `check:copilot:configured-fs-grants` verde após o cluster corrente
      (`8 owners / 8 policy entries / 8 grant calls`).
- [x] Manter `check:copilot:trusted-io-boundaries` verde após o cluster corrente
      (`36 importers / 36 policy entries / 108 trusted calls`).
- [x] Manter TS7 strict de `src/copilot` verde após a onda corrente
      (`npm run -s typecheck:strict:src.copilot` → `tsc7 --checkers 2`).
- [ ] Manter testes focados dos owners migrados verdes.
- [ ] Manter testes MCP críticos (`state`, startup maintenance, connector smoke, tool surface)
      verdes.
- [x] Executar `mcp_smoke_workspace` após estabilizar a onda: todos os checks críticos verdes;
      status global `degraded` somente por `WORKSPACE_DIRTY`, sem `critical`.
- [x] Executar readiness/health do conector Cloudflare como baseline da próxima subonda:
      `ready=true`, zero blockers, named-permanent tunnel em `https://mcp.aurelin.org/mcp`,
      OAuth/HTTP2+ coerentes.
- [ ] Atualizar este ledger antes e depois de cada nova subonda, evitando depender de memória de
      conversa.

#### E.1 — kernel e governança

- [x] Projetar e implementar `ConfiguredFsGrant` com roots/exact paths/ops/symlink
      policy/durability.
- [x] Manter brand e matcher internos privados; grant forjado deve ser rejeitado.
- [x] Expor minting apenas pela surface de composition e governar importadores/owners
      explicitamente.
- [x] Criar adapter IO bound ao grant sem escape raw.
- [x] Cobrir traversal, sibling-prefix, exact isolation, unauthorized op/durability e symlink
      ancestral/final.
- [ ] Adicionar runtime/workspace identity ao contrato quando a authority for
      workspace/runtime-scoped.
- [ ] Criar derivação segura e governada de child paths/grants sem permitir widening de authority.
- [ ] Adicionar filename/pattern policy somente onde houver caso real e ganho de segurança, sem
      complexidade cosmética.

#### E.2 — migrações já comprovadas

- [x] Migrar skills como piloto root-bound (`list/stat/read`).
- [x] Migrar agent lifecycle state para exact paths (`mkdir/stat/read/write/delete`).
- [x] Transformar `mcp/cloudflare/state.js` em store criado com `stateFile/smokeStateFile` bound na
      construção.
- [x] Remover a API Cloudflare state path-based em vez de manter shim de compatibilidade.
- [x] Migrar consumidores de Cloudflare state para o store bound.
- [x] Remover as entradas obsoletas correspondentes do trusted manifest.
- [x] Regenerar public API manifest/cost baseline após introdução da surface configured.
- [x] Corrigir testes antigos para mockarem ports/owners atuais em vez de deep mocks de arquitetura
      anterior.

#### E.3 — onda corrente: fixed-path owners

- [x] Migrar `mcp/cloudflare/transport-benchmark-state.js` para exact-path `read/stat`
      (implementação aplicada).
- [x] Migrar `mcp/control-plane/io-cache-benchmark-state.js` para exact-path `read/stat`
      (implementação aplicada).
- [x] Migrar `sdk/tools/state.js` para exact-path `read/write` (implementação aplicada).
- [x] Migrar `sdk/tools/custom.js` para exact-path `read/write` (implementação aplicada).
- [x] Migrar `terminal/stores/alias-store.js` para exact-path `read/write` (implementação aplicada).
- [x] Registrar os cinco novos owners no grant manifest v2.
- [x] Remover os cinco owners do trusted manifest.
- [x] Atualizar os unit tests desses owners para mockarem `ConfiguredFsIo`, sem caller-string
      legado.
- [x] Provar contagem final desta onda: **8 grant owners**, **36 trusted importers**, zero policy
      drift.
- [x] Rodar testes focados dos owners com mocks migrados: SDK tools state, custom tools e terminal
      alias-store verdes; benchmark-state é read-only e segue para a bateria MCP da subonda
      seguinte.

#### E.4 — expansão posterior, somente após E.3 verde

##### E.4.1 — Cloudflare managed-process control plane (onda ativa)

**Objetivo:** remover filesystem authority genérica do supervisor de `mcp-http/cloudflared` e da
tool de status sem mudar o protocolo MCP, o hostname público, a semântica de restart ou os formatos
de PID/metadata/log.

- [x] Auditar `cli-process`, `cli-runtime`, `cli-commands` e `tunnel-status` e mapear todos os
      callers.
- [x] Identificar duplicação de `readPidFileStatus` entre supervisor e tool.
- [x] Definir que os paths devem nascer de `CloudflareTunnelConfig` + nomes de log canônicos, nunca
      de input da tool.
- [x] Adicionar operação `move` ao kernel `ConfiguredFsGrant`, autorizando source **e** destination
      antes da mutação; teste causal prova que destination fora do grant não move nem remove o
      source.
- [x] Criar `CloudflareManagedProcessController` bound aos dois PID files, metadata files, log
      files, parent dirs e rotated logs; paths são resolvidos eagerly e operações posteriores não
      recebem path.
- [x] Remover `stateWriter(filePath, ...)` path-based de produção; fault injection agora é
      `beforePidPublish()` pathless, executado após metadata durável e antes do PID readiness
      marker.
- [x] Fazer `cli-runtime` criar/usar o controller por config para start/stop; restart reutiliza o
      mesmo controller na sequência stop→start.
- [x] Fazer `cli-commands` usar o mesmo controller para status e executar os dois status + runtime
      origin em paralelo, removendo acesso direto a PID file.
- [x] Fazer `tunnel-status` usar o controller para PID status e tail físico bounded do cloudflared
      log, removendo seu import `trusted` e a implementação duplicada de PID parsing.
- [x] Preservar a regra crítica de restart: metadata durável antes do PID readiness marker e
      rollback/terminate em falha; teste injeta falha exatamente entre os dois eventos.
- [x] Preservar log rotation antes de abrir novo detached sink e cobrir `.1` pelo mesmo exact-path
      grant.
- [x] Migrar `.env.local` de `mcp/cloudflare/remote-api.js` para exact-path configured read como
      owner separado, sem acoplá-lo ao process controller.
- [x] Meta de governança atingida: **10 configured owners / 33 trusted importers**, zero drift;
      trusted calls caíram para 95.
- [x] Testes focados verdes: process supervision `3/3`, Cloudflare remote API e
      `test_mcp_tools.spec.js` (incluindo `mcp_tunnel_status`).
- [x] TS7 strict + configured/trusted governance verdes após a transformação (`10/10` grants;
      `33/33` trusted).
- [x] `mcp_smoke_workspace` sem novo critical e `mcp_connection_readiness.ready=true` após
      estabilização pré-restart; smoke local ficou apenas `degraded` por `WORKSPACE_DIRTY`, sem
      critical operacional.

##### E.4.2 — configured runtime backend realmente leve (nova prioridade antes de ampliar owners)

**Evidência empírica 2026-08-21 — baseline anterior (5 runs, hyperfine, processo Node frio):**

- `#copilot/infra/public/composition/filesystem/configured`: **216,6 ms ± 8,3 ms**;
- `#copilot/infra/public/filesystem/trusted`: **212,5 ms ± 17,5 ms**;
- `#copilot/infra/public/platform/buffer`: **50,1 ms ± 2,3 ms**.

**Evidência após backend físico especializado (10 runs, 2026-08-21):**

- `#copilot/infra/public/composition/filesystem/configured`: **69,3 ms ± 4,1 ms**;
- `physical.js`: **71,8 ms ± 24,8 ms** (um outlier; mínimo 55,4 ms);
- `#copilot/infra/public/filesystem/trusted`: **219,7 ms ± 7,7 ms**;
- ganho do facade configured contra trusted no mesmo batch: **~3,17x**;
- processo isolado: import `8,61 ms`; primeira mutation `38,05 ms` (carregamento lazy da file-lock
  policy), segunda mutation `5,45 ms`; primeiro read `3,53 ms`; RSS observado ~64,7 MiB.

A segmentação estática e o runtime agora convergem: `configured/service.js` não importa mais
`filesystem/trusted`. O facade mantém authority no service e delega mecânica física a
`filesystem/configured/physical.js`; locking process-local fica em
`concurrency/locks/configured/service.js`, com file-lock multiprocess canônico carregado
dinamicamente pelo barrel `concurrency/locks/file/index.js` somente quando uma mutation precisa
consultar/aplicar a policy.

- [x] Detectar via benchmark que `ConfiguredFsIo` herdava praticamente todo o cold-import de
      `trusted`.
- [x] Confirmar que o primeiro `moveFileLocked` piorava também a closure estática para 154
      módulos/647 KiB; rejeitar esse desenho.
- [x] Substituir o move de workspace-mutation por physical move + lock conjunto, restaurando
      governance 25/25 sem rebaseline.
- [x] Medir imports isolados: Node/fs e watch ~49-50 ms; durability ~54 ms; file-lock
      policy/resource ~62-67 ms; lock geral ~140 ms; read fresh geral ~132 ms; writes/move/remove
      gerais ~174-179 ms.
- [x] Projetar e implementar backend físico `configured` sem import de `filesystem/trusted`,
      workspace mutation, invalidation ou telemetry global pesada.
- [x] Separar authority (`configured/service.js`) de mecânica física (`configured/physical.js`) e
      lock (`concurrency/locks/configured/service.js`).
- [x] Preservar fresh snapshot consistente com retry before/after/path-after, bounded range físico e
      metadata `io` local compatível.
- [x] Preservar atomic write: parent durable → revalidação de authority/symlink → temp inode
      same-dir → mode apply/preserve → fsync → rename → parent fsync.
- [x] Preservar delete/mkdir/detached append durability e symlink rejection em parents
      criados/raced.
- [x] Preservar move crash-safe: source+destination locks; destination publish+fsync antes de source
      unlink em non-overwrite/cross-device; overwrite por rename atômico; parents revalidados antes
      da publicação.
- [x] Preservar file-lock multiprocess por policy canônica sem carregar seu grafo no cold import;
      perfil atual medido `off`, mas suporte permanece.
- [x] Evitar duplicar workspace containment/rollback/invalidation: o backend configured não
      implementa semântica de workspace que não lhe pertence.
- [x] Critério <=100 ms atingido: facade configured **69,3 ms ± 4,1 ms**, sem rebaselinear limites
      para aceitar regressão.
- [x] Revalidar owners: agent state, skills/hook-context, Cloudflare state/process/remote API, SDK
      tools state/custom e terminal alias-store verdes; `test_mcp_tools.spec.js` verde.
- [x] TS7 strict, configured grant governance, trusted boundary governance e infra architecture
      governance verdes após ajuste do alias/barrel interno.
- [x] Adicionar teste causal específico de fila/reentrância do configured lock e
      mode-preserving/range metadata do backend físico: fila serializa contendedores, é reentrante,
      libera após exceção; atomic replace preserva mode; bounded range preserva metadata/engine.
- [x] Provar também o caminho multiprocess real em processo isolado com
      `COPILOT_IO_FILE_LOCKS_ENABLED=mutations`: `attempts=1`, `acquired=1`, `activeLeases=0` e zero
      lock files residuais.
- [ ] Adicionar benchmark ratcheted automatizado de **cold ESM import real**, separado da static
      public closure governance; calibrar margem contra ruído de CI/WSL sem transformar benchmark em
      gate frágil.
- [x] Rodar `mcp-fast`, lint e smoke/readiness pré-restart: TS7 strict verde; lint canônico verde;
      `mcp-fast` verde em ~61,9 s; smoke local sem critical;
      `mcp_connection_readiness.ready=true`/`blockers=[]`.
- [x] Provar recovery/startup com processo Node novo, eliminando cache de import-map do MCP antigo:
      connector smoke `131 local = 131 remote`, registry match, OAuth, SSE e runtime health todos
      verdes; smoke persistido ~5,18 s.
- [x] Passar gate Cloudflare pré-restart: `critical=[]`, smoke fresco, 4 HA connections, QUIC
      presente/RTT ~21 ms, RPC p95 ~1,29 s; `requestErrorRate` cumulativo ~0,24 corretamente
      classificado como warning histórico pela policy existente.
- [x] Capturar baseline de latência do processo MCP antigo **PID 15263**: `repo_read_file` 36
      calls/~6 ms handler médio; `repo_apply_patch` 11/~42 ms; `repo_search_text` 42/~51 ms;
      `repo_bulk_inspect` 25/~60 ms. `repo_apply_patch_batch` ~2245 ms médio é contaminado por
      batches grandes/post-validation e não deve ser comparado como patch simples.
- [x] Reiniciar MCP/Cloudflare somente após gate explícito de recuperação: reload governado
      `current→quic` concluído com `exitCode=0`; MCP **PID 362872**, cloudflared **PID 362880**;
      local/public health 200; smoke pós-reload reconciliado; 131↔131 tools, OAuth/SSE/runtime
      health verdes; `postRestartReadiness.ready=true`.
- [x] Passar gates Cloudflare pós-restart: `critical=[]`, 4 HA connections, QUIC presente/RTT ~34
      ms, RPC p95 ~435 ms; error-rate cumulativo histórico tratado apenas como warning.
- [x] Repetir amostra controlada de latência no novo runtime: `repo_read_file` 5 calls/~3 ms handler
      médio; `repo_search_text` 5/~17 ms; `repo_bulk_inspect` 4/~22 ms; `repo_apply_patch` dry-run
      5/~5 ms. Frente ao baseline agregado antigo (6/51/60/42 ms), melhora indicativa de
      ~50%/~67%/~63%/~88%; workloads não são idênticos, portanto usar como direção, não causalidade
      isolada.
- [x] Confirmar que o gargalo interativo remanescente não está nos handlers locais: authorization
      ~0–1 ms, pre-handler ~6 ms, enquanto o origin ainda observa silent external gap p50 ~7,1 s/p95
      ~15,8 s no curto período pós-restart.
- [x] Liberar continuidade da expansão de configured grants somente após o restart e a comparação
      pós-restart ficarem verdes.

##### E.4.3 — demais owners

**Marco pós-restart — expansão de authority configurada:**

- [x] Primeira subonda fixed/config-bound pós-restart: session snapshot store, `skills.json`
      declarativo, SDK-default snapshot, reload-state runner e TODO legacy migration migrados sem
      grant-from-input.
- [x] Governança após a subonda: **15 configured owners / 15 grants** e **28 trusted importers / 85
      trusted calls**, com TS7 e testes focados verdes.
- [x] `stateful-env` redesenhado em vez de apenas trocar imports: path agora deve ser repo-relative
      e permanecer dentro de `src/copilot/.ai/mcp/`; absolute path, traversal e symlink são
      rejeitados causalmente.
- [x] Separar authority de `stateful-env` em dois grants exatos: parent `mkdir` somente e file
      `chmod/read/stat/write`; remover reads/stats síncronos do fluxo operacional e tornar
      `buildStatefulProcessEnv` assíncrono.
- [x] Provar CLI novo em processo isolado: `status`/`print-source` verdes, arquivo canônico 0600,
      segredo apenas em preview; governança em **16 configured owners / 17 grants** e **27 trusted
      importers / 81 calls**.
- [x] Criar `ConfiguredFsIo.appendText` one-shot distinto do detached append sink: resource lock
      cobre append + file fsync + parent sync; teste causal preserva 12 linhas concorrentes e
      mode 0600.
- [x] Adicionar `ConfiguredFsIo.withPathLock` para composição transacional sem expor raw FS; nested
      IO continua reautorizando path/op/durability e o lock configurado permanece
      reentrante/multiprocess-capable.
- [x] Criar kernel MCP `control-plane/persistence` para JSONL bound: helper não minta grants, recebe
      path resolvido + IO já autorizado, mantém append→read→trim/rewrite na mesma seção crítica e
      faz tail bounded sem fragmento inicial parcial.
- [x] Provar o kernel JSONL com 24 appends concorrentes sem perda, trim exato e tolerância a linha
      inválida; TS7 e lint dirigido verdes.
- [x] Migrar `client-latency-evidence` e `openai-endpoint-latency`: remover `filePath` por operação,
      resolver identidade uma vez no owner e usar grants exact `append/read/write` + store bound.
- [x] Classificar `audit.js` somente pelo fato comprovado atual: bounded read usa grant exact/read
      bootstrap-bound; writer genérico permanece dívida explícita e não deve ser declarado como
      migrated por inferência.
- [x] Governança após esta subonda: **19 configured owners / 20 grants** e **24 trusted importers /
      76 trusted calls**; configured/trusted manifests sem drift; 7 testes focados + TS7 + lint
      dirigido verdes.
- [x] Redesenhar `latency-history` para o mesmo kernel JSONL bound: produção fixa um exact path; a
      factory de teste recebe IO já autorizado e não minta grants; operação pública não aceita
      `filePath`.
- [x] Redesenhar `edge-backup` para o caso complementar de filenames dinâmicos: um grant `roots` é
      bound uma vez ao diretório canônico; `dir` deixa de existir nas APIs operacionais e a factory
      recebe IO já autorizado.
- [x] Provar `edge-backup` contra symlink `.json` dentro do root: candidate é rejeitado pela
      capability e ignorado sem leitura/falha global; 66 testes MCP/Cloudflare, TS7 e lint dirigidos
      verdes.
- [x] Governança após exact-history + root-backup: **21 configured owners / 22 grants** e **22
      trusted importers / 71 trusted calls**, manifests sem drift.
- [x] Migrar TLS material do HTTP/2 permanente para grant exact/read bound ao bootstrap policy
      (`mcp.adapters.http2.tls-material`); governança passou a **22 configured owners / 23 grants**
      e **21 trusted importers / 69 calls**; servidor HTTP/2 real abriu/validou cert+key+hostname e
      fechou normalmente.
- [x] Corrigir race de lifecycle no startup MCP: `notifyMcpHttpStarted()` agora aguarda o watcher
      owned antes de devolver HTTP/1 ou HTTP/2; start→close→dispose não tenta mais registrar
      external-watch após `WorkspaceInfra.dispose()`.
- [x] Investigar falsos diagnósticos de “arquivo mudou durante batch”: causa confirmada em
      `patchTextBatchLocked` — `currentHash/currentBytes` de falha intermediária descreviam o
      **estado virtual em memória**, enquanto o disco permanecia byte-identical até publish atômico.
- [x] Tornar a evidência causal inequívoca: falhas de patch agora expõem `currentStateKind`;
      same-file batch usa `virtual-batch` + `diskBaselineHash/diskBaselineBytes`, single patch usa
      `locked-file`; `ERR_PATCH_NOT_FOUND` virtual deixa de ser `stale-context/caller-refresh` e
      passa a `virtual-batch-context/manual-decision`, sem recovery/reread do disco.
- [x] Provar a semântica nova: kernel patch 5/5, MCP tools 61/61 e TS7 verde; teste MCP confirma
      hash virtual diferente do baseline enquanto o arquivo físico permanece exatamente intacto.
- [x] Redesenhar `ai-artifacts` como runtime bound: produção fixa workspace/rollback roots uma vez;
      factory recebe `ConfiguredFsIo` já autorizado e possui cache próprio; APIs operacionais deixam
      de aceitar `workspaceRoot`/`rollbackPolicy` por chamada.
- [x] Preservar separação de authority no cleanup: grant `mcp.control-plane.ai-artifacts` possui
      apenas `roots/list/stat`; deleção de jobs continua no mutation owner e purge de rollback
      continua no rollback owner — nenhum super-grant foi criado.
- [x] Fechar `ai-artifacts`: 5/5 testes focados + lint + TS7 verdes; governança em **23 configured
      owners / 24 grants** e **20 trusted importers / 66 trusted calls**.
- [x] Estender o configured physical write com `failIfExists` sem reintroduzir o graph de workspace
      mutation: exclusive publish por hard-link do temp para destino, EEXIST preserva destino; teste
      causal cobre create + não-overwrite.
- [x] Migrar `mcp/control-plane/jobs.js` integralmente para configured IO e remover também
      `public/filesystem/write`: job artifacts usam root-bound `append/list/mkdir/read/stat/write`;
      cgroup usa 3 exact reads; focused tests usam root stat-only.
- [x] Preservar invariantes do job manager: UUID-derived artifact paths, log initial create
      exclusivo 0600, manifest atomic 0600, bounded tail read, cgroup fail-soft e focused-test
      lexical/read-path validation.
- [x] Fechar jobs/configured wave: infra governance 25/25, focused stack 90/90, lint e TS7 verdes;
      governança em **24 configured owners / 27 grants** e **19 trusted importers / 60 trusted
      calls**.
- [x] Extrair `persistence/jsonl/queue` como kernel puro de
      batching/backpressure/retry/at-most-once, sem filesystem authority; `createJsonlFileWriter`
      passa a compor essa fila com o backend físico legado apenas onde rotação/durability física são
      realmente necessárias.
- [x] Provar que a extração da fila preserva o writer físico: **23/23** fault/runtime-audit tests
      verdes, incluindo retry pré-append, mutation-applied pós-append, rotação e durability.
- [x] Migrar o writer de `audit.js` para a fila pura + `ConfiguredFsIo.appendText` bound ao exact
      audit file; enqueue continua sem IO, batching/flush/beforeExit são preservados e durability de
      append permanece explicitamente `none`, equivalente à semântica anterior.
- [x] Medir o efeito no cold path real: `public/persistence/jsonl` ≈ **186,9 ms**, nova
      `public/persistence/jsonl/queue` ≈ **49,5 ms** e `mcp/control-plane/audit.js` cai de ≈ **154,5
      ms para 57,5 ms** (~**2,7×** mais rápido); 26/26 audit+fault tests verdes.
- [x] Registrar a nova queue surface como `runtime/lifecycle/experimental/micro`: **3 módulos / 5,2
      KiB / zero external packages**; rebaseline aceito somente após dry-run mostrar o novo alias +
      crescimento funcional de ~625 B da surface configured, com `infra_barrel_governance` 25/25
      verde.
- [x] Fechar o cluster de configuração/prompt sem `trusted`: `PinnedFilesLoader` recebe IO já
      autorizado do terminal boot; `live-loader`/`status` ficam restritos aos section files
      internos; `user-config` vincula config source + append-file capability ao snapshot resolvido
      por `WeakMap`, impedindo config object forjado de adquirir authority.
- [x] Provar cluster config/prompt: 19/19 testes, lint e TS7 verdes; governança avançou para **28
      configured owners / 32 grants** e **15 trusted importers / 44 calls**.
- [x] Migrar nova subonda fixed/config-bound: logger retention bound a `LOG_DIR`, BYOK `.env.local`
      exact read/write 0600, SessionFs state root stat-only, dev-watch restrito ao `src/copilot`
      module root e DevContainer network posture dividido entre artefatos fixos/canonical script e
      exact env-configured script snapshot.
- [x] Remover `watchPath` da API pública de `dev-watch` e tornar startup do watcher
      assíncrono/awaited; runtime não pode mais retargetar hot-reload para um path arbitrário.
- [x] Corrigir o seam do teste BYOK para o composition boundary real `application-infra`: o fixture
      deixa de depender de `createWorkspaceReadIo`, detalhe interno que a Infra 2.0 não promete;
      BYOK fecha em **120/120**.
- [x] Expandir a taxonomia configured com `observability-state` em vez de falsamente classificar
      logger como runtime-config/infra-owner; manifest permanece semanticamente fiel.
- [x] Fechar a subonda em **33 configured owners / 38 grants** e **10 trusted importers / 31 trusted
      calls**, com configured/trusted governance e TS7 verdes.
- [x] Redesenhar `model-gateway/automation/policy` como store bound: produção fixa o policy file;
      operações públicas deixam de aceitar `filePath`; testes compõem store alternativo com IO já
      autorizado. Contrato Model Gateway **229/229** + lint verdes.
- [x] Redesenhar `sdk/models/persistent-cache` como store por binding imutável:
      env/workspace/primary+legacy paths são capturados uma vez; mutation queue passa de
      process-global para por-store; primary recebe `read/write/delete/stat`, legacy apenas
      `read/delete`. Cache tests **16/16**, lint e TS7 verdes.
- [x] Separar persistência de `model-gateway/health/provider-health` do ledger process-global:
      hydrate/flush usam persistence store bootstrap-bound e deixam de reler env/path por operação;
      testes rebindam apenas o store autorizado. Health tests **7/7**, lint e TS7 verdes.
- [x] Redesenhar `model-gateway/routing/selection-trace` como root-bound store: queue por instância,
      filenames normalizados sem componentes de path, `persist/read/list/retention` confinados à
      capability; remover `directory/filePath` operacionais e recusar `--trace-dir` no terminal em
      vez de mintar authority de input.
- [x] Provar selection-trace/store + CLI: Model Gateway **229/229**, BYOK **121/121**, infra
      governance **25/25**, lint e TS7 verdes; governança alcança **37 configured owners / 43
      grants** e apenas **6 trusted importers / 17 calls**.

- [x] Migrar os 3 MCP control-plane boundaries restantes (`dev-oauth`, `llm-b-live`, `repo-write`)
      por ownership explícito, sem grants cunhados de input operacional.
- [x] `dev-oauth`: separar ES256/RS256 keys, refresh-token ledger e DCR clients em storage binding
      configuracional exact-bound; filas de persistência capturam o store no enqueue, de modo que
      alteração posterior de `process.env` não retargete escrita pendente. Prova operacional do
      profile OAuth: **13/13**.
- [x] `repo-write`: mover metadata/range/hash para `WorkspacePathAuthority` e preservar
      mutações/quarantine na façade workspace existente, sem grant configured adicional. A migração
      expôs e corrigiu um bug estrutural de `lstat`: a policy agora suporta `preserveFinalSymlink`,
      mantém ancestrais canonicalizados/contained e preserva lexicalmente o último componente;
      `lstatPathValidated`, sem consumidor e semanticamente incapaz de representar isso, foi
      removido. Repo-write + registry **45/45**; policy/workspace IO **36/36**.
- [x] `llm-b-live`: artifacts/manifests/logs usam workspace authority; `provider-health` expõe seu
      próprio persistence fingerprint e recebeu apenas `stat` no grant já owner;
      `/proc/<pid>/cmdline` deixou de passar por filesystem authority e virou introspecção
      PID-only/bounded (`readLinuxProcessArgv(pid)`), fail-closed em truncation.
- [x] Adicionar `workspace.mutationIo.openDetachedAppendSink` para descriptor append herdável por
      child somente após policy workspace, reutilizando o primitive locked existente em vez de
      escapar para façade genérica.
- [x] Eliminar os três terminal trusted boundaries sem configured grant: `/scope` e `/attach` usam
      `workspace.readIo`; `/export` usa `workspace.mutationIo`. Paths escolhidos pelo operador
      passam pela `WorkspacePathAuthority`, inclusive rejeição natural fora do workspace.
- [x] Migrar fixtures terminal para o composition boundary real, removendo mocks globais de
      `node:fs/promises`/trusted: attach **5/5**, export **8/8**, scope **2/2**, timeline
      consistency **2/2**, lint e TS7 verdes.
- [x] Migrar terminal state restante quando a authority deriva da workspace/path policy; nenhum
      configured grant foi criado a partir de path escolhido pelo operador.
- [x] Migrar SDK/model-gateway state fixed/config-bound pelo padrão de stores para
      policy/cache/provider-health/selection-trace.
- [x] Refatorar APIs path-based de `selection-trace` e `latency-history` para owner/store bound
      antes de retirar `trusted`; nenhuma migração cosmética/grant-from-input.
- [x] Fechar generic trusted IO em **0 importers / 0 calls**; configured permanece em **38 owners /
      44 grants**, todos com policy entry correspondente.
- [x] Remover fisicamente `infra/filesystem/trusted`, o barrel público, aliases internal/public,
      public API manifest/cost baseline da surface, teste dedicado, manifest de allowlist e checker
      antigo; não manter deprecated shim/compatibility layer.
- [x] Substituir o allowlist permissivo por invariant negativo `check:copilot:no-trusted-io`: falha
      se reaparecer alias, implementation path ou import source; prova atual: **1668 source files**,
      **0 references / 0 aliases / 0 implementation paths**.
- [x] Provar o fechamento pós-remoção: configured governance **38/38 owners, 44 calls**,
      architecture contracts **107/107**, BYOK **121/121**, TS7 strict verde.
- [x] Consolidar a implementação transversal da Infra Arquitetura 2.0 em commit atômico
      `fc54aef0f570644ba285845befab9994f4ad3a12`
      (`refactor(copilot): complete infra architecture 2.0 migration`), preservando este ledger fora
      do commit estrutural para revisão histórica independente.
- [x] Executar, de forma excepcional e única nesta etapa, `test:copilot:unit`: **638 arquivos
      selecionados / 7163 testes**, com **11 assertions falhando** em 9 specs após a grande
      migração. A execução ampla não foi repetida por política de custo/tempo; cada falha foi triada
      causalmente e corrigida.
- [x] Corrigir integralmente os 9 specs reportados pela suíte ampla: imports físicos antigos de
      `buffer/http-response/process-output`, canonical HTTP-response allowlist movida para
      `http-response/service.js`, public workspace contract atualizado para
      `composition/workspace/*`, fixture de Session Tools migrada para `boot/application-infra`,
      `write_file_content` alinhado ao erro Node `ENOENT`, deep-import `#copilot/core/io-contracts`
      removido e expectativa do patch-batch atualizada para
      `virtual-batch-context/manual-decision/recoveryRequired=false`.
- [x] Revalidar **somente o escopo afetado** após as correções: **9 files / 110 tests / 110
      passed**, lint dirigido verde; TS7 strict permaneceu verde após os patches. Não rerodar a
      suíte Copilot completa.
- [ ] Medir impacto da nova composition surface no cold import do caminho crítico MCP e fatiar se
      necessário.

### Faixa F — cache e invalidation instances

- [x] Instanciar L1/L2 por InfraRuntime ou definir shared cache contract explicitamente.
- [x] Instanciar invalidation bus/journal por runtime.
- [x] External watcher por WorkspaceInfra, suportando múltiplos roots simultâneos.
- [x] Separar start/stop de query/stat APIs.
- [x] Garantir teardown e no-timer/no-watcher leaks.
- [x] Preservar cross-process recovery semantics.

### Faixa G — indexing runtime 2.0

**Marco 2026-08-21 — bootstrap MCP + ownership do parser worker runtime:**

- [x] Diagnosticar `INDEX_UNAVAILABLE` pós-restart como falha de composition root, não do indexer:
      MCP HTTP standalone iniciava auto-build sem configurar `ApplicationInfraRuntime.database`,
      enquanto o terminal fazia binding separadamente.
- [x] Centralizar `bootstrapApplicationInfraSqliteProvider()` em `boot/application-infra`: import
      dinâmico de SQLite, `ensureCopilotDbDir()`, provider canônico, materialização fail-fast e
      coalescing de bootstrap concorrente sem cachear resultado concluído.
- [x] Fazer terminal e MCP HTTP/1.1/HTTP2 compartilharem o mesmo bootstrap; MCP prepara application
      infra **antes de `listen()`** e só então dispara watcher/index/monitors, mantendo startup
      degradável se SQLite realmente falhar.
- [x] Provar bootstrap com 12 chamadas concorrentes em uma única revision, uso real de `SELECT 1` e
      rebind após reset explícito.
- [x] Provar index materializado em processo limpo após o novo bootstrap: schema v2, **38 arquivos /
      985 símbolos / 140 imports**, `available=true`, `failed=0`.
- [x] Diagnosticar lifecycle leak independente: após `InfraRuntime.dispose()` permaneciam **4
      MessagePorts** do parser worker pool global; `shutdownParserWorkerPool()` externo era
      necessário para o processo encerrar.
- [x] Eliminar o singleton implícito do parser worker: `createParserWorkerRuntime()` agora possui
      pool/fila/in-flight/backoff/restart/dispose por instância; parsing stateless sem runtime não
      cria Workers.
- [x] Fazer `InfraRuntime` possuir `parserWorkers`, injetá-lo no `ParserCacheRuntime` e no index
      registry, e terminá-lo no dispose; remover `shutdownParserWorkerPool` da API diagnóstica e
      remover a classificação process-global stale do state-scope manifest.
- [x] Provar isolamento causal: dois `InfraRuntime`s mantêm pools independentes; descartar um zera
      apenas seu pool e o segundo continua parseando. Parser/prefetch/working-set: **72/72** testes
      verdes; HTTP/connection bootstrap: **18/18** verdes.
- [x] Provar teardown fresh-process: index build inicializa pool size 4; após
      `disposeApplicationInfra()`, status fica `disposed=true`, `poolSize=0` e
      `process.getActiveResourcesInfo()` contém apenas os `PipeWrap` de stdio — nenhum `MessagePort`
      residual.
- [x] Executar `mcp-fast` final após bootstrap/parser refactor: verde em **54,349 s**, seguido de
      restart controlado do origin+tunnel no perfil QUIC atual.
- [x] Reconciliar o novo processo MCP após restart: origin PID **393428**, cloudflared PID
      **393436**, local/public health 200, OAuth/SSE verdes, **131/131 tools** remotas=locais e
      post-restart `ready=true`.
- [x] Provar o índice no **próprio conector reiniciado**, não apenas em harness isolado:
      `available=true`, schema v2, **2.684 arquivos / 13.163 símbolos / 6.045 imports / 4.230
      chunks**, zero stale/failed; auto-build full-reconcile concluído sem falhas.

- [ ] Registry instance em vez de process singleton implícito.
- [ ] Scheduler por workspace/domain.
- [ ] Implementar retry bounded/degraded state para refresh failures.
- [ ] Corrigir comentário/semântica de eligibility de retry.
- [ ] Transformar prefetch/session scope em resource handle seguro.
- [ ] Fault test para abort/throw durante abertura de scope.
- [ ] Tornar stats/health side-effect-free.
- [x] Parser pool explícito e instance-owned em `InfraRuntime` (equivalente ao ProcessInfra atual
      para esse recurso); nenhum pool global implícito permanece no caminho de produção.
- [x] Separar production dispose de test reset para parser workers: production encerra a instância
      dona; testes criam/descartam runtimes explícitos, sem cleanup global.
- [ ] Preservar scanner/search pure/service kernels atuais.

### Faixa H — observability 2.0

- [ ] Definir `HealthProbe` contract.
- [ ] Implementar registry de probes no runtime composition.
- [ ] Migrar cache/locks/fs/index/parser/scope/durability probes.
- [ ] Remover imports diretos de implementações de `observability/health.js`.
- [ ] Garantir que health de runtime não materializa recursos ausentes.
- [ ] Migrar console residual de L2 para diagnostics/telemetry.

### Faixa I — SQLite port e Node 24 evaluation

- [ ] Definir `SqlitePort` estrutural mínimo.
- [ ] Implementar adapter `better-sqlite3` sem mudar comportamento.
- [ ] Remover concrete driver types dos owners de infra.
- [ ] Criar adapter experimental `node:sqlite` apenas em branch/fase controlada.
- [ ] Implementar transaction wrapper explícito para driver sem `.transaction()`.
- [ ] Benchmark FTS/build/query/WAL/startup/memory.
- [ ] Decidir driver por evidência; manter `better-sqlite3` se superior.

### Faixa J — core/boot boundaries

- [ ] Criar micro-surfaces de `core` para IO contracts/policy/lifecycle/errors.
- [ ] Migrar infra do mega-barrel `#copilot/core` para surfaces semânticas.
- [ ] Medir redução de cold import.
- [ ] Fazer boot criar/injetar `InfraRuntime` explicitamente.
- [ ] Remover provider global após migração completa.

### Faixa K — public consumer migration

- [ ] Migrar consumers por capability/audience, não por grep cego.
- [ ] Remover public symbols não usados após cada cluster.
- [ ] Proibir novo import de surface deprecated durante migração.
- [ ] Atualizar READMEs e examples em cada etapa estabilizada.

### Faixa L — testes de isolamento/lifecycle

- [ ] Dois InfraRuntime independentes no mesmo processo em todas as capabilities; **parser worker
      ownership já provado isoladamente com dois runtimes simultâneos**.
- [ ] Dois WorkspaceInfra simultâneos com roots distintos.
- [ ] Watchers simultâneos sem stop recíproco.
- [ ] DB/cache/index isolation conforme escopo definido.
- [ ] Dispose repetido idempotente.
- [ ] Shutdown parcial com falhas isoladas.
- [ ] Zero timers/workers/watchers após dispose.
- [ ] Capability tokens rejeitados entre workspaces/runtimes.

### Faixa M — performance

- [x] Static closure gates verdes com baseline observado + headroom de crescimento ~1,5×.
- [ ] Cold import benchmarks comparados ao baseline desta auditoria.
- [ ] Startup MCP/terminal comparado antes/depois.
- [ ] RSS após import e após runtime start comparado.
- [ ] Read/write/search/index workloads sem regressão material.
- [ ] L2/parser/index concurrency benchmarks.

### Faixa N — cleanup/deprecations

- [ ] Remover `concurrency/locks/file/legacy.js` se consumers permitirem.
- [x] Remover aggregate public aliases sem uso.
- [ ] Remover generic trusted surface após grants.
- [ ] Remover provider/singleton shims temporários.
- [ ] Remover public storage diagnostic antigo ou classificá-lo definitivamente como tooling.
- [x] Eliminar nomes `ForTest` usados por lifecycle de produção nos clusters migrados.

### Faixa O — gates finais

- [ ] TS7 strict exato verde.
- [ ] lint verde.
- [ ] Prettier verde.
- [ ] unit Copilot completa verde.
- [x] zero cycles runtime/JSDoc no governance focado.
- [x] zero public `export *`.
- [x] zero unauthorized audience imports.
- [x] zero public authority constructors em runtime audience.
- [x] public alias/cost manifest verde, com headroom ~1,5×.
- [ ] filesystem guards verdes.
- [ ] global architecture hard=0 soft=0.
- [ ] multi-runtime/workspace isolation verde.
- [ ] docs/roadmap atualizados.
- [ ] revisão Git/commit/push somente após todos os gates.

---

## 17. Critérios de sucesso da arquitetura 2.0

A arquitetura 2.0 estará concluída quando:

1. a topologia 1.0 continuar acíclica e semanticamente coerente;
2. public API growth for sempre explícito e classificado;
3. nenhuma API runtime permitir minting/bypass de authority;
4. configured paths forem least-privilege grants;
5. dois runtimes/workspaces puderem coexistir sem singleton collision indevida;
6. todos os recursos long-lived tiverem lifecycle/disposal owner;
7. health/stats forem side-effect-free;
8. index refresh failures tiverem convergência/retry observável;
9. import de uma capability estreita não carregar centenas de módulos não relacionados;
10. backend SQLite estiver atrás de port sem regressão funcional;
11. config efetiva for snapshotada/determinística;
12. a suíte e os guardrails atuais continuarem verdes ou mais estritos.

---

## 18. Matriz de funções de diretórios e subdiretórios — estado 1.0 → ação 2.0

A tabela seguinte cobre **todos os diretórios existentes** em `src/copilot/infra` no commit
auditado.

| Diretório                                | Função atual                                                                                                | Estado 1.0                    | Ação 2.0                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| `.`                                      | Root de capabilities técnicas compartilhadas do Copilot; não é uma API importável diretamente.              | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `cache`                                  | Caches L1/L2, policies de tiering e lifecycle de cache.                                                     | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `cache/l2`                               | Cache L2 stateful, configuração, health e adapter SQLite.                                                   | ✅ 1.0; ⚠ singleton/lifecycle | Converter estado apropriado para Process/Runtime/Workspace resource.                  |
| `cache/l2/sqlite`                        | Implementação SQLite do cache L2: schema/statements/policy/store/metrics.                                   | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `cache/memory`                           | Cache L1 em memória, keys, freshness verification e reset.                                                  | ✅ 1.0; ⚠ singleton/lifecycle | Converter estado apropriado para Process/Runtime/Workspace resource.                  |
| `code-analysis`                          | Análise sintática pura/leve (Babel, JSON, Markdown, comments, outline).                                     | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `concurrency`                            | Primitivas de concorrência, bulk execution, filas e locks.                                                  | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `concurrency/bulk`                       | Executor bounded de batches independente de protocolo.                                                      | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `concurrency/locks`                      | Coordenação de locks local + multiprocess e métricas.                                                       | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `concurrency/locks/file`                 | Lockfile multiprocess, lease/metadata/policy/heartbeat.                                                     | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `concurrency/locks/local`                | Fila/state machine de resource locks dentro do processo.                                                    | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `concurrency/locks/metrics`              | Métricas bounded compartilhadas por locks.                                                                  | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `concurrency/queue`                      | Fila assíncrona genérica com concorrência limitada.                                                         | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `database`                               | Port de composição do SQLite usado por infra; lifecycle/schema pertencem a src/copilot/db.                  | ✅ 1.0; ⚠ singleton/lifecycle | Converter estado apropriado para Process/Runtime/Workspace resource.                  |
| `filesystem`                             | Primitivas e serviços de filesystem, transações, autorização de workspace e invalidação.                    | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/invalidation`                | Plano de coherence: bus, cross-process journal e external watch.                                            | ✅ 1.0; ⚠ singleton/lifecycle | Converter estado apropriado para Process/Runtime/Workspace resource.                  |
| `filesystem/invalidation/bus`            | Bus local de invalidação e hooks derivados.                                                                 | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/invalidation/cross-process`  | Journal SQLite e consumer/publisher entre processos.                                                        | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/invalidation/external-watch` | Hints de fs.watch para alterações externas aos writers canônicos.                                           | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/invalidation/watch`          | Primitive baixa de filesystem watch.                                                                        | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/mutation`                    | Mutações locked de alto nível: patch/delete/copy/move.                                                      | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/mutation/patch`              | Orquestração locked de patches exatos.                                                                      | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/mutation/rollback`           | Helpers de snapshot/rollback usados por mutações.                                                           | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/mutation/transfer`           | Copy/move locked de alto nível.                                                                             | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/patch`                       | Algoritmos/serviços de diff e exact patch computation.                                                      | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/patch/diff`                  | Algoritmo puro e serviço observável de diff.                                                                | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/patch/exact`                 | Compute/occurrence/evidence para exact patch.                                                               | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/read`                        | Plano de leitura: snapshots, cache, chunks, fresh I/O e byte-line index.                                    | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/read/cache`                  | L1/L2 read services, text/bytes, hash e line-offset cache.                                                  | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/read/chunks`                 | Leitura bounded/chunked/streaming e byte-seek.                                                              | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/read/fresh`                  | I/O físico intencionalmente sem L1/L2.                                                                      | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/read/line-index`             | Índice progressivo byte→line e seu estado/policy.                                                           | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/read/snapshot`               | Snapshots físicos low-level, sem cache.                                                                     | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/skills`                      | Capability estreita de descoberta/leitura de skills configuradas.                                           | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/transaction`                 | Primitivas transacionais de baixo nível para writes/mutations.                                              | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/transaction/directory`       | mkdir low-level com durability.                                                                             | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/transaction/phases`          | Eventos de fases de mutação/fault injection.                                                                | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/transaction/rollback`        | Policy/storage/inventory/maintenance dos rollback sidecars.                                                 | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/trusted`                     | I/O explicitamente trusted para configured paths fora do workspace.                                         | ✅ 1.0; ⚠ least-privilege 2.0 | Migrar para configured grants e reduzir/remover authority genérica.                   |
| `filesystem/workspace`                   | Boundary/facade de I/O bounded pelo workspace e tokens validados.                                           | ❌ Gap de authority atual     | Privatizar issuance e redesenhar WorkspaceAuthority.                                  |
| `filesystem/write`                       | Writers físicos/locked, atomic publish, append, metadata, move e payload.                                   | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/write/append`                | Append unlocked/locked e detached sink.                                                                     | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/write/atomic`                | Protocolo atomic publish unlocked/locked/portable.                                                          | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/write/directory`             | mkdir locked.                                                                                               | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/write/metadata`              | chmod/metadata writes.                                                                                      | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/write/move`                  | Same-device e EXDEV move protocols.                                                                         | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `filesystem/write/payload`               | Normalização/cópia de payload de escrita.                                                                   | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `governance`                             | Manifest, module map e queries de governança arquitetural.                                                  | ✅ 1.0                        | Adicionar public API/audience/cost/authority manifests e gates.                       |
| `indexing`                               | Scanner, parser, registry persistente, busca e working-set/context indexing.                                | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `indexing/context`                       | Prefetch e session working-set/scope context.                                                               | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `indexing/context/prefetch`              | Warm L1/parser/index context e sessões leves de prefetch.                                                   | ✅ estrutura; ⚠ gap lifecycle | Scope handle transacional e cleanup garantido em throw/abort.                         |
| `indexing/context/scope`                 | Lifecycle/state/query/refresh de working-set scopes.                                                        | ✅ 1.0; ⚠ singleton/lifecycle | Converter estado apropriado para Process/Runtime/Workspace resource.                  |
| `indexing/parser`                        | Parser/cache/context/worker/health orchestration.                                                           | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `indexing/parser/cache`                  | Caches de símbolos/context e invalidation.                                                                  | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `indexing/parser/context`                | File-context projection/windowing.                                                                          | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `indexing/parser/foundation`             | Config, paths, types e mutable parser counters compartilhados.                                              | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `indexing/parser/health`                 | Snapshot operacional do parser.                                                                             | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `indexing/parser/parse`                  | Execução do parser por tipo de arquivo.                                                                     | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `indexing/parser/worker`                 | Worker thread pool e entrypoint de parsing.                                                                 | ✅ 1.0; ⚠ singleton/lifecycle | Converter estado apropriado para Process/Runtime/Workspace resource.                  |
| `indexing/registry`                      | Índice persistente, query/build/runtime/refresh e state.                                                    | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `indexing/registry/refresh`              | Domain, executor e scheduler de refresh/convergência.                                                       | ✅ estrutura; ⚠ gap funcional | Scheduler por workspace com retry bounded/degraded state.                             |
| `indexing/registry/runtime`              | Facade runtime do índice e wiring de invalidation.                                                          | ✅ 1.0; ⚠ singleton/lifecycle | Converter estado apropriado para Process/Runtime/Workspace resource.                  |
| `indexing/registry/sqlite`               | Storage/query/writer/statements do índice persistente SQLite.                                               | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `indexing/registry/state`                | Instance/coalescing state do registry.                                                                      | ✅ 1.0; ⚠ singleton/lifecycle | Converter estado apropriado para Process/Runtime/Workspace resource.                  |
| `indexing/scanner`                       | Traversal, gitignore, glob, batching e fingerprints.                                                        | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `indexing/search`                        | Busca textual/simbólica via index e subprocess fallback.                                                    | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `indexing/search/shared`                 | Policy/output/pagination compartilhados por search.                                                         | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `indexing/search/subprocess`             | Exec/stream/ripgrep support bounded.                                                                        | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `indexing/search/symbol`                 | Pattern + service de busca simbólica.                                                                       | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `indexing/search/text`                   | Index acceleration, grep/process fallback e orchestration.                                                  | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `indexing/workspace`                     | Adapter que compõe workspace path authorization com indexing/search/context.                                | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `observability`                          | Projeções read-side/health sobre estado de infra.                                                           | ✅ 1.0; ⚠ custo/acoplamento   | Probe registry + snapshots injetados.                                                 |
| `operations`                             | Envelopes de operações, audit, change sets e rollback agentic.                                              | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `operations/contracts`                   | Contratos JSDoc imutáveis de operation/change-set/rollback.                                                 | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `operations/rollback`                    | Token, preflight e application de rollback.                                                                 | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `persistence`                            | Stores JSON/JSONL e writer protocols.                                                                       | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `persistence/json`                       | JSON store simples.                                                                                         | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `persistence/jsonl`                      | Reader/repair/trusted/writer JSONL.                                                                         | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `persistence/jsonl/writer`               | Queue, persistence, size tracking e contracts do writer.                                                    | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `platform`                               | Primitivas técnicas transversais, incluindo Node-specific adapters.                                         | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `platform/node`                          | Primitivas específicas do Node e compile cache.                                                             | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `platform/node/filesystem`               | Durability/fsync primitives Node-specific.                                                                  | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `policy`                                 | Policies puras transversais: budgets, paths, risk, preconditions, mutation state.                           | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `public`                                 | Membrana externa exclusiva de infra; somente projections/barrels.                                           | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/cache`                           | Membrana pública/projection para a capability `cache`; não possui implementação própria.                    | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/code-analysis`                   | Membrana pública/projection para a capability `code-analysis`; não possui implementação própria.            | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/concurrency`                     | Membrana pública/projection para a capability `concurrency`; não possui implementação própria.              | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/concurrency/bulk`                | Membrana pública/projection para a capability `concurrency/bulk`; não possui implementação própria.         | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/concurrency/locks`               | Membrana pública/projection para a capability `concurrency/locks`; não possui implementação própria.        | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/database`                        | Membrana pública/projection para a capability `database`; não possui implementação própria.                 | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/filesystem`                      | Membrana pública/projection para a capability `filesystem`; não possui implementação própria.               | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/filesystem/invalidation`         | Membrana pública/projection para a capability `filesystem/invalidation`; não possui implementação própria.  | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/filesystem/mutation`             | Membrana pública/projection para a capability `filesystem/mutation`; não possui implementação própria.      | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/filesystem/read`                 | Membrana pública/projection para a capability `filesystem/read`; não possui implementação própria.          | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/filesystem/skills`               | Membrana pública/projection para a capability `filesystem/skills`; não possui implementação própria.        | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/filesystem/trusted`              | Membrana pública/projection para a capability `filesystem/trusted`; não possui implementação própria.       | ✅ 1.0; ⚠ least-privilege 2.0 | Migrar para configured grants e reduzir/remover authority genérica.                   |
| `public/filesystem/workspace`            | Membrana pública/projection para a capability `filesystem/workspace`; não possui implementação própria.     | ❌ Gap de authority atual     | Privatizar issuance e redesenhar WorkspaceAuthority.                                  |
| `public/filesystem/write`                | Membrana pública/projection para a capability `filesystem/write`; não possui implementação própria.         | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/indexing`                        | Membrana pública/projection para a capability `indexing`; não possui implementação própria.                 | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/indexing/context`                | Membrana pública/projection para a capability `indexing/context`; não possui implementação própria.         | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/indexing/parser`                 | Membrana pública/projection para a capability `indexing/parser`; não possui implementação própria.          | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/indexing/registry`               | Membrana pública/projection para a capability `indexing/registry`; não possui implementação própria.        | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/indexing/scanner`                | Membrana pública/projection para a capability `indexing/scanner`; não possui implementação própria.         | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/indexing/storage`                | Membrana pública/projection para a capability `indexing/storage`; não possui implementação própria.         | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/indexing/workspace`              | Membrana pública/projection para a capability `indexing/workspace`; não possui implementação própria.       | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/observability`                   | Membrana pública/projection para a capability `observability`; não possui implementação própria.            | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/operations`                      | Membrana pública/projection para a capability `operations`; não possui implementação própria.               | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/persistence`                     | Membrana pública/projection para a capability `persistence`; não possui implementação própria.              | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/persistence/json`                | Membrana pública/projection para a capability `persistence/json`; não possui implementação própria.         | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/persistence/jsonl`               | Membrana pública/projection para a capability `persistence/jsonl`; não possui implementação própria.        | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/platform`                        | Membrana pública/projection para a capability `platform`; não possui implementação própria.                 | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/platform/node`                   | Membrana pública/projection para a capability `platform/node`; não possui implementação própria.            | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/platform/node/filesystem`        | Membrana pública/projection para a capability `platform/node/filesystem`; não possui implementação própria. | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/policy`                          | Membrana pública/projection para a capability `policy`; não possui implementação própria.                   | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/telemetry`                       | Membrana pública/projection para a capability `telemetry`; não possui implementação própria.                | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `public/testing`                         | Membrana pública/projection para a capability `testing`; não possui implementação própria.                  | ✅ 1.0; ⚠ surface 2.0         | Exports nominais, audience/privilege/cost; remover aggregate aliases inúteis.         |
| `telemetry`                              | Métricas, diagnostics_channel e timing de I/O.                                                              | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |
| `testing`                                | Composition root de resets/test-controls privilegiados.                                                     | ✅ 1.0                        | Preservar owner; adaptar apenas se necessário a instance/config/capability contracts. |

---

## 19. Matriz arquivo a arquivo — função, conformidade 1.0 e ação 2.0

A matriz cobre **todos os 378 arquivos existentes** no commit auditado: **376 arquivos JavaScript e
2 READMEs Markdown**.

### 19.0 Charters Markdown

| Arquivo            | Linhas | Função atual                                                                                                                 | Estado 1.0       | Ação 2.0                                                                                                                         |
| ------------------ | -----: | ---------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`        |    547 | Charter arquitetural canônico de `src/copilot/infra`: ownership, regras 1–5, namespaces public/internal, hierarquia e gates. | ✅               | Atualizar ao final da implementação 2.0 com authority, lifecycle scopes, cost boundaries, config snapshot e novos gates.         |
| `public/README.md` |     76 | Charter da membrane pública: única API externa, sem mega-barrel root, categorias e exemplos de consumo.                      | ✅/⚠ Surface 2.0 | Atualizar para exports nominais, audiences, privilege/stability/cost tiers e separação runtime/composition/diagnostic/test-only. |

**Legenda de conformidade:**

- `✅` — owner/topologia está coerente com a arquitetura 1.0;
- `✅/⚠` — topologia está correta, mas o arquivo participa de uma dívida/gap transversal que a 2.0
  deve resolver;
- `❌` — comportamento/surface contradiz uma garantia declarada e deve ser corrigido
  prioritariamente.

A tabela é agrupada por capability root. `index.js` é descrito como barrel quando seu docblock não
contém uma descrição própria.

### 19.1 `cache/`

| Arquivo                         | Linhas | Função atual                                                                                                                                                                                                                                                                                   | Estado 1.0         | Ação 2.0                                                                                        |
| ------------------------------- | -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------- |
| `cache/index.js`                |     26 | Barrel puro de `cache`; projeta aggregateIoCacheTierStats, buildIoCacheTierPlan, createIoL2SqliteCache, getIoCacheStats, getIoL1Cache, getIoL2Cache, getIoL2CacheConfiguration, getIoL2CacheHealth, getIoL2CacheStats, getVerifiedIoL1Entry, invalidateIoCachePath, invalidateIoCacheSubtree…. | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `cache/l2/config.js`            |     67 | Declarative L2 cache profile/configuration policy.                                                                                                                                                                                                                                             | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `cache/l2/health.js`            |     86 | Read-side L2 cache health/stats projection.                                                                                                                                                                                                                                                    | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `cache/l2/index.js`             |      8 | Barrel puro de `cache/l2`; projeta createIoL2SqliteCache, getIoL2Cache, getIoL2CacheConfiguration, getIoL2CacheHealth, getIoL2CacheStats, isIoL2Cache.                                                                                                                                         | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `cache/l2/runtime.js`           |    137 | L2 cache singleton lifecycle, prune timer and initialization circuit breaker.                                                                                                                                                                                                                  | ✅/⚠ Estado global | Classificar/migrar estado para ProcessInfra, InfraRuntime ou WorkspaceInfra; dispose explícito. |
| `cache/l2/sqlite/index.js`      |      5 | Barrel puro de `cache/l2/sqlite`; projeta createIoL2SqliteCache, isIoL2Cache.                                                                                                                                                                                                                  | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `cache/l2/sqlite/metrics.js`    |     51 | Process-local operation counters/latency for one SQLite L2 cache instance.                                                                                                                                                                                                                     | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `cache/l2/sqlite/policy.js`     |     53 | Configuration/admission/path policy for the SQLite L2 cache.                                                                                                                                                                                                                                   | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `cache/l2/sqlite/statements.js` |     51 | Schema ownership and prepared statements for the SQLite L2 cache.                                                                                                                                                                                                                              | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `cache/l2/sqlite/store.js`      |    327 | SQLite L2 cache state machine: read/admit/batch/invalidate/prune over prepared storage.                                                                                                                                                                                                        | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `cache/l2/sqlite/types.js`      |     20 | JSDoc-only contracts for the SQLite L2 cache.                                                                                                                                                                                                                                                  | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `cache/l2/test-control.js`      |      7 | Private L2 cache reset control.                                                                                                                                                                                                                                                                | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `cache/memory/cache-types.js`   |     21 | JSDoc-only contracts for the in-memory L1 cache.                                                                                                                                                                                                                                               | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `cache/memory/cache.js`         |    142 | Stateless compatibility facade; L1 application state is owned by `InfraRuntime.coherence.l1`, with a separately named process-compat owner for raw callers.                                                                                                                                    | ✅ 2.0             | Manter stateless; impedir reintrodução de singleton runtime neste facade.                       |
| `cache/memory/index.js`         |     14 | Barrel puro de `cache/memory`; projeta getIoCacheStats, getIoL1Cache, getVerifiedIoL1Entry, invalidateIoCachePath, invalidateIoCacheSubtree, makeBytesKey, makeTextKey, normalizeIoCacheKey.                                                                                                   | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `cache/memory/keys.js`          |     40 | Chaves canônicas do cache L1 de I/O.                                                                                                                                                                                                                                                           | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `cache/memory/l1-policy.js`     |      9 | Process-level L1 capacity/TTL/stale verification policy.                                                                                                                                                                                                                                       | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `cache/memory/l1-verifier.js`   |     77 | Rich fingerprint/hash verification of one L1 cache entry against current filesystem state.                                                                                                                                                                                                     | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `cache/memory/test-control.js`  |      4 | Privileged L1 reset composition.                                                                                                                                                                                                                                                               | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `cache/test-control.js`         |      5 | Private cache reset composition. Runtime cache barrels never reexport this surface.                                                                                                                                                                                                            | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `cache/tiering.js`              |    112 | Implementação `tiering` pertencente a `cache`.                                                                                                                                                                                                                                                 | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |

### 19.2 `code-analysis/`

| Arquivo                             | Linhas | Função atual                                                                                                                                                                                                                                                                                                                                                                                                    | Estado 1.0 | Ação 2.0                                                                            |
| ----------------------------------- | -----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `code-analysis/babel-policy.js`     |     95 | Policy canônica de configuração e erros do @babel/parser. Babel 8 é o plano sintático leve das tools internas. TypeScript 7 continua sendo a autoridade semântica/projetual; esta policy deliberadamente evita transform plugins/presets e mantém a gramática alinhada às extensões que o TS7 interpreta. Perfis distinguem consumidores que precisam de comentários daqueles que só precisam da estrutura AST. | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `code-analysis/babel-symbols.js`    |    265 | Canonical symbol/import/export extraction from the Babel AST.                                                                                                                                                                                                                                                                                                                                                   | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `code-analysis/comments.js`         |     51 | Parser puro de comentários iniciais.                                                                                                                                                                                                                                                                                                                                                                            | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `code-analysis/index.js`            |     10 | Barrel puro de `code-analysis`; projeta BABEL_PARSER_POLICY_VERSION, buildOutline, extractBabelFileSymbols, extractJsonSchema, extractMarkdownOutline, extractMarkdownOutlineWithLines, extractTopComments, formatBabelParserError, parseJsonOrJsonlSample, resolveBabelParserOptions.                                                                                                                          | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `code-analysis/json-outline.js`     |     51 | Parser puro de shape JSON/JSONL.                                                                                                                                                                                                                                                                                                                                                                                | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `code-analysis/markdown-outline.js` |     42 | Parser puro de outline Markdown.                                                                                                                                                                                                                                                                                                                                                                                | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `code-analysis/outline-builder.js`  |     55 | Builder puro de outline textual a partir de símbolos.                                                                                                                                                                                                                                                                                                                                                           | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |

### 19.3 `concurrency/`

| Arquivo                                    | Linhas | Função atual                                                                                                                                                                                                                                                                                                                              | Estado 1.0           | Ação 2.0                                                                            |
| ------------------------------------------ | -----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| `concurrency/bulk/executor.js`             |    249 | Shared bounded bulk execution primitive. This module is intentionally protocol-agnostic: MCP and the local LLM-B tool surface can reuse the same scheduler without sharing tool schemas, authorization or presentation contracts.                                                                                                         | ✅                   | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `concurrency/bulk/index.js`                |     11 | Barrel puro de `concurrency/bulk`; projeta DEFAULT_BULK_CONCURRENCY, DEFAULT_BULK_MAX_ITEMS, HARD_BULK_MAX_ITEMS, MAX_BULK_CONCURRENCY, runBoundedOperationBatch.                                                                                                                                                                         | ✅                   | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `concurrency/locks/file/index.js`          |     15 | Barrel puro de `concurrency/locks/file`; projeta acquireFileResourceLock, acquireLock, getFileResourceLockDir, getFileResourceLockPath, getFileResourceLockProfile, getFileResourceLockStats, hashFileResourceLockKey, isFileResourceLockEnabledByEnv, releaseLock, releaseLockAsync, shouldAcquireFileResourceLock.                      | ✅                   | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `concurrency/locks/file/legacy.js`         |    115 | Facade de compatibilidade para o lockfile L1 canônico.                                                                                                                                                                                                                                                                                    | ✅/⚠ Compatibilidade | Remover após confirmar zero consumers; não expandir API.                            |
| `concurrency/locks/file/metadata.js`       |    151 | Lockfile metadata parsing, observation, stale recovery, heartbeat and owned release.                                                                                                                                                                                                                                                      | ✅                   | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `concurrency/locks/file/policy.js`         |     74 | Configuration and deterministic path policy for multiprocess resource locks.                                                                                                                                                                                                                                                              | ✅                   | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `concurrency/locks/file/resource-lock.js`  |    162 | Multiprocess file-lock acquisition protocol and idempotent lease release.                                                                                                                                                                                                                                                                 | ✅                   | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `concurrency/locks/file/state.js`          |    109 | Metrics and active-lease projection for multiprocess resource locks.                                                                                                                                                                                                                                                                      | ✅                   | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `concurrency/locks/file/types.js`          |     38 | JSDoc-only contracts for the optional multiprocess resource lock.                                                                                                                                                                                                                                                                         | ✅                   | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `concurrency/locks/file/wait.js`           |     50 | Abort/timeout primitives for lockfile acquisition waits.                                                                                                                                                                                                                                                                                  | ✅                   | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `concurrency/locks/index.js`               |     25 | Barrel puro de `concurrency/locks`; projeta acquireFileResourceLock, acquireIoResourceLock, acquireIoResourceLocks, acquireLock, getFileResourceLockDir, getFileResourceLockPath, getFileResourceLockProfile, getFileResourceLockStats, getIoLockStats, hashFileResourceLockKey, isFileResourceLockEnabledByEnv, normalizeIoResourceKey…. | ✅                   | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `concurrency/locks/local/index.js`         |     12 | Barrel puro de `concurrency/locks/local`; projeta acquireIoResourceLock, acquireIoResourceLocks, getIoLockStats, normalizeIoResourceKey, withIoResourceLock, withIoResourceLocks.                                                                                                                                                         | ✅                   | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `concurrency/locks/local/observability.js` |    120 | Metrics, active-lease registry and health projection for process-local resource locks.                                                                                                                                                                                                                                                    | ✅                   | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `concurrency/locks/local/resource-lock.js` |    345 | Process-local resource lock queue with optional multiprocess lock composition.                                                                                                                                                                                                                                                            | ✅                   | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `concurrency/locks/local/types.js`         |     24 | JSDoc-only contracts for process-local resource locks.                                                                                                                                                                                                                                                                                    | ✅                   | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `concurrency/locks/local/wait.js`          |     71 | Timeout/abort/error normalization for process-local lock queues.                                                                                                                                                                                                                                                                          | ✅                   | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `concurrency/locks/metrics/index.js`       |      5 | Barrel puro de `concurrency/locks/metrics`; projeta createBoundedLockWaitMetrics, sanitizeLockOperation.                                                                                                                                                                                                                                  | ✅                   | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `concurrency/locks/metrics/wait.js`        |     95 | Métricas bounded compartilhadas pelos locks L0 e L1.                                                                                                                                                                                                                                                                                      | ✅                   | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `concurrency/queue/async-queue.js`         |    116 | Fila assíncrona com concorrência limitada.                                                                                                                                                                                                                                                                                                | ✅                   | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `concurrency/queue/index.js`               |      5 | Barrel puro de `concurrency/queue`; projeta AsyncQueue.                                                                                                                                                                                                                                                                                   | ✅                   | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |

### 19.4 `database/`

| Arquivo                    | Linhas | Função atual                                                                                                                                                                                                                                                                                                                                                                                                            | Estado 1.0             | Ação 2.0                                                                            |
| -------------------------- | -----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| `database/index.js`        |     15 | Composition port for SQLite-backed infra capabilities. Infra owns cache/index/journal behavior but not the process-wide database lifecycle. A composition root provides the database accessor explicitly; schema and migrations remain owned by `src/copilot/db`. Test-only lifecycle controls intentionally do not belong to this runtime entrypoint. They are exposed only through `#copilot/infra/internal/testing`. | ✅                     | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `database/provider.js`     |     43 | Process-local provider state for SQLite-backed infra capabilities. This leaf owns only composition state. Database lifecycle, schema and migrations remain outside infra.                                                                                                                                                                                                                                               | ✅/⚠ Singleton/backend | Runtime-scoped SqlitePort; remover better-sqlite3 do contrato.                      |
| `database/test-control.js` |      4 | Private database composition-port reset.                                                                                                                                                                                                                                                                                                                                                                                | ✅                     | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |

### 19.5 `filesystem/`

| Arquivo                                                  | Linhas | Função atual                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Estado 1.0            | Ação 2.0                                                                                                   |
| -------------------------------------------------------- | -----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `filesystem/invalidation/bus/events.js`                  |     25 | Tipos e normalização de eventos de invalidação de I/O.                                                                                                                                                                                                                                                                                                                                                                                                                                    | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/invalidation/bus/index.js`                   |     12 | Barrel puro de `filesystem/invalidation/bus`; projeta flushIoInvalidationQueue, getIoInvalidationBusStats, getRecentIoInvalidation, normalizeIoInvalidationEvent, publishIoInvalidation, registerIoInvalidationHook.                                                                                                                                                                                                                                                                      | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/invalidation/bus/runtime.js`                 |    241 | Bus síncrono e best-effort para invalidações derivadas de mutações de I/O.                                                                                                                                                                                                                                                                                                                                                                                                                | ✅/⚠ Estado global    | Classificar/migrar estado para ProcessInfra, InfraRuntime ou WorkspaceInfra; dispose explícito.            |
| `filesystem/invalidation/bus/test-control.js`            |      4 | Private canonical invalidation-bus reset control.                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/invalidation/coherence.js`                   |     35 | Canonical coherence commands for workspace I/O. This module is intentionally tiny: the invalidation bus is the single owner of local cache/policy invalidation, derived-state notification and cross-process replication. Callers publish semantic change events here instead of reaching into individual cache tiers.                                                                                                                                                                    | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/invalidation/cross-process/config.js`        |     40 | Cross-process invalidation runtime configuration.                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/invalidation/cross-process/index.js`         |     17 | Barrel puro de `filesystem/invalidation/cross-process`; projeta createCrossProcessInvalidationJournal, getCrossProcessInvalidationStats, publishCrossProcessInvalidation, readCrossProcessInvalidationConfig, readCrossProcessInvalidationReplay, startCrossProcessInvalidationConsumer, stopCrossProcessInvalidationConsumer.                                                                                                                                                            | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/invalidation/cross-process/replay.js`        |    109 | Bounded transactionally-consistent startup replay over the invalidation journal.                                                                                                                                                                                                                                                                                                                                                                                                          | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/invalidation/cross-process/runtime.js`       |    145 | Retryable runtime composition of provider-backed cross-process publisher and poll consumer.                                                                                                                                                                                                                                                                                                                                                                                               | ✅/⚠ Estado global    | Classificar/migrar estado para ProcessInfra, InfraRuntime ou WorkspaceInfra; dispose explícito.            |
| `filesystem/invalidation/cross-process/store.js`         |    219 | Isolated SQLite journal instance: publish/poll cursor, bounded retention and metrics.                                                                                                                                                                                                                                                                                                                                                                                                     | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/invalidation/cross-process/test-control.js`  |      4 | Private cross-process invalidation reset control.                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/invalidation/cross-process/types.js`         |     11 | JSDoc-only contracts for cross-process invalidation.                                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/invalidation/cross-process/utils.js`         |     37 | Shared scalar/path normalization for cross-process journal and replay.                                                                                                                                                                                                                                                                                                                                                                                                                    | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/invalidation/external-watch/config.js`       |     53 | Bounded configuration policy for the best-effort external filesystem watcher.                                                                                                                                                                                                                                                                                                                                                                                                             | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/invalidation/external-watch/filter.js`       |     19 | Path-domain filtering for external filesystem watch hints.                                                                                                                                                                                                                                                                                                                                                                                                                                | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/invalidation/external-watch/index.js`        |     11 | Barrel puro de `filesystem/invalidation/external-watch`; projeta flushIoExternalWatchHints, getIoExternalWatchStats, readIoExternalWatchConfig, startIoExternalWatch, stopIoExternalWatch.                                                                                                                                                                                                                                                                                                | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/invalidation/external-watch/runtime.js`      |    245 | Best-effort external filesystem coherence plane. The watcher only emits invalidation hints for edits performed outside canonical Copilot writers (editor, Git, auxiliary processes). Correctness never depends on fs.watch: rich fingerprints and the cross-process journal remain authoritative fallbacks.                                                                                                                                                                               | ✅/⚠ Estado global    | Classificar/migrar estado para ProcessInfra, InfraRuntime ou WorkspaceInfra; dispose explícito.            |
| `filesystem/invalidation/external-watch/test-control.js` |      4 | Private external-watch reset control.                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/invalidation/index.js`                       |     25 | Barrel puro de `filesystem/invalidation`; projeta createCrossProcessInvalidationJournal, flushIoInvalidationQueue, getIoExternalWatchStats, getIoInvalidationBusStats, getRecentIoInvalidation, invalidateIoCoherencePath, invalidateIoCoherenceSubtree, normalizeIoInvalidationEvent, publishIoInvalidation, readCrossProcessInvalidationConfig, readCrossProcessInvalidationReplay, readIoExternalWatchConfig….                                                                         | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/invalidation/test-control.js`                |      6 | Private reset composition for filesystem/invalidation.                                                                                                                                                                                                                                                                                                                                                                                                                                    | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/invalidation/watch/index.js`                 |      5 | Barrel puro de `filesystem/invalidation/watch`; projeta watchPath.                                                                                                                                                                                                                                                                                                                                                                                                                        | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/invalidation/watch/primitive.js`             |     20 | Low-level filesystem watch primitive. High-level consumers must enter through an explicit public facade or invalidation service; direct node:fs watch calls outside this root are prohibited by architecture guards.                                                                                                                                                                                                                                                                      | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/mutation/delete.js`                          |    212 | Locked delete/remove operations.                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/mutation/index.js`                           |      7 | Barrel puro de `filesystem/mutation`; projeta copyFileLocked, deleteFileLocked, moveFileLocked, patchTextBatchLocked, patchTextLocked, removePathLocked.                                                                                                                                                                                                                                                                                                                                  | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/mutation/patch/batch.js`                     |    241 | Atomic same-file exact-text patch batches under one lock/read/write cycle.                                                                                                                                                                                                                                                                                                                                                                                                                | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/mutation/patch/errors.js`                    |     42 | Failure annotation without rereading mutable filesystem state.                                                                                                                                                                                                                                                                                                                                                                                                                            | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/mutation/patch/index.js`                     |      6 | Barrel puro de `filesystem/mutation/patch`; projeta patchTextBatchLocked, patchTextLocked.                                                                                                                                                                                                                                                                                                                                                                                                | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/mutation/patch/preview.js`                   |     31 | Bounded textual diff preview policy shared by locked patch variants.                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/mutation/patch/single.js`                    |    212 | Single exact-text locked patch with atomic publish, preview and rollback evidence.                                                                                                                                                                                                                                                                                                                                                                                                        | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/mutation/rollback/index.js`                  |     12 | Barrel puro de `filesystem/mutation/rollback`; projeta assertDestinationWritable, buildRollbackSnapshot, discardRollbackSidecar, isUnpublishedSnapshotConflict, readMutationSnapshot, readOptionalMutationSnapshot.                                                                                                                                                                                                                                                                       | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/mutation/rollback/support.js`                |    109 | Shared rollback/snapshot protocol for locked filesystem mutations.                                                                                                                                                                                                                                                                                                                                                                                                                        | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/mutation/transfer/copy.js`                   |    154 | Copia arquivo com lock no destino.                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/mutation/transfer/index.js`                  |      6 | Barrel puro de `filesystem/mutation/transfer`; projeta copyFileLocked, moveFileLocked.                                                                                                                                                                                                                                                                                                                                                                                                    | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/mutation/transfer/move.js`                   |    158 | Move/rename com locks no source e destination.                                                                                                                                                                                                                                                                                                                                                                                                                                            | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/patch/diff/algorithm.js`                     |    141 | Diff textual simples e puro.                                                                                                                                                                                                                                                                                                                                                                                                                                                              | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/patch/diff/index.js`                         |      6 | Barrel puro de `filesystem/patch/diff`; projeta buildSimpleTextDiff, buildSimpleTextDiffAroundLineRange, diffText, diffTextWithReader.                                                                                                                                                                                                                                                                                                                                                    | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/patch/diff/service.js`                       |    101 | Serviço de diff textual com observabilidade canônica.                                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/patch/exact/compute.js`                      |    173 | Patch textual puro.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/patch/exact/index.js`                        |      5 | Barrel puro de `filesystem/patch/exact`; projeta computeTextPatch.                                                                                                                                                                                                                                                                                                                                                                                                                        | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/patch/exact/occurrences.js`                  |     39 | Exact-string occurrence scanning and bounded line evidence.                                                                                                                                                                                                                                                                                                                                                                                                                               | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/patch/exact/recovery-evidence.js`            |    202 | Bounded diagnostic evidence for exact patch misses; never authorizes a mutation.                                                                                                                                                                                                                                                                                                                                                                                                          | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/patch/index.js`                              |      6 | Barrel puro de `filesystem/patch`; projeta buildSimpleTextDiff, buildSimpleTextDiffAroundLineRange, computeTextPatch, diffText, diffTextWithReader.                                                                                                                                                                                                                                                                                                                                       | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/cache/bytes.js`                         |    205 | Cached L1/L2 byte read service.                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/cache/entry.js`                         |     60 | Serialization and physical-fingerprint checks for read-cache entries.                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/cache/hash-policy.js`                   |     77 | Text hashing policy and observable digest-cost counters.                                                                                                                                                                                                                                                                                                                                                                                                                                  | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/cache/index.js`                         |      8 | Barrel puro de `filesystem/read/cache`; projeta getIoReadHashStats, getLineOffsetCacheStats, readBytes, readLines, readText, sliceTextByCachedLineOffsets.                                                                                                                                                                                                                                                                                                                                | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/cache/line-offset.js`                   |    316 | Line-offset cache for UTF-8 text snapshots. This cache sits below MCP and above full-text window shaping. It does not cache file contents; it caches newline-derived character offsets for already validated text snapshots so repeated `readText(..., { startLine, endLine })` calls avoid `text.split('\n')` over the whole file.                                                                                                                                                       | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/cache/test-control.js`                  |      5 | Private cached-read reset composition.                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/cache/text.js`                          |    341 | Cached L1/L2 UTF-8 text read service and line projection.                                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/chunks/byte-seek.js`                    |    280 | Materialized bounded line windows resolved through the progressive byte-line index.                                                                                                                                                                                                                                                                                                                                                                                                       | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/chunks/codec.js`                        |     48 | Abort and fatal UTF-8 decoding primitives for chunked reads.                                                                                                                                                                                                                                                                                                                                                                                                                              | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/chunks/index.js`                        |      8 | Barrel puro de `filesystem/read/chunks`; projeta readTextChunks, readTextChunksStream, readTextLineChunks, readTextLineChunksStream.                                                                                                                                                                                                                                                                                                                                                      | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/chunks/lines.js`                        |    181 | Low-level public line-chunk API: retry orchestration plus Web ReadableStream delivery.                                                                                                                                                                                                                                                                                                                                                                                                    | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/chunks/service.js`                      |    116 | Observable chunked/streaming text read adapters.                                                                                                                                                                                                                                                                                                                                                                                                                                          | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/chunks/stream.js`                       |    234 | Consistent one-pass physical stream iterator with opportunistic byte-line seed capture.                                                                                                                                                                                                                                                                                                                                                                                                   | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/chunks/types.js`                        |     14 | JSDoc-only contracts for line chunk delivery.                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/fresh/data.js`                          |    163 | Physical snapshot reads that intentionally bypass L1/L2 caches.                                                                                                                                                                                                                                                                                                                                                                                                                           | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/fresh/index.js`                         |      6 | Barrel puro de `filesystem/read/fresh`; projeta listDirectoryNamesFresh, lstatPath, readBytesFresh, readBytesRangeFresh, readTextFresh, statPath.                                                                                                                                                                                                                                                                                                                                         | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/fresh/metadata.js`                      |    150 | Observable physical directory/stat adapters.                                                                                                                                                                                                                                                                                                                                                                                                                                              | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/index.js`                               |     31 | Barrel puro de `filesystem/read`; projeta createStaleSnapshotError, getByteLineIndexStats, getIoReadHashStats, getLineOffsetCacheStats, invalidateByteLineIndexPath, invalidateByteLineIndexSubtree, listDirectoryNamesFresh, lstatPath, lstatPathSnapshot, readBytes, readBytesFileRangeSnapshot, readBytesFileSnapshot….                                                                                                                                                                | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/line-index/builder.js`                  |    195 | Progressive byte-line index builder; owns no cache or invalidation state.                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/line-index/index.js`                    |     20 | Barrel puro de `filesystem/read/line-index`; projeta appendPhysicalLineStartsFromBuffer, discardStaleByteLineIndex, ensureByteLineIndexInvalidationHook, getByteLineIndex, getByteLineIndexStats, invalidateByteLineIndexPath, invalidateByteLineIndexSubtree, recordByteLineIndexCapturedRangeReuse, recordByteLineIndexRangeRead, rememberByteLineIndexStreamSeed, resolveByteLineSeedStreamHighWaterMark, scanPhysicalLineStartsFromBuffer.                                            | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/line-index/policy.js`                   |     58 | Memory/line limits and adaptive read sizing for the progressive byte-line index.                                                                                                                                                                                                                                                                                                                                                                                                          | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/line-index/scanner.js`                  |     92 | Physical CR/LF/CRLF byte scanner shared by streaming reads and progressive indexes.                                                                                                                                                                                                                                                                                                                                                                                                       | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/line-index/state.js`                    |    280 | Cache, LRU, invalidation and metrics for the progressive byte-line index.                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/line-index/test-control.js`             |      4 | Private byte-line-index reset control.                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/line-index/types.js`                    |     29 | JSDoc-only contracts for the progressive byte-line index.                                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/snapshot/bytes.js`                      |    230 | Leitura binária baixa, sem cache.                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/snapshot/consistency.js`                |     81 | Shared snapshot/fingerprint primitives for consistent chunk reads and the progressive byte-line index.                                                                                                                                                                                                                                                                                                                                                                                    | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/snapshot/directory.js`                  |     20 | Directory reads low-level, deliberately cache-free. Higher layers add observability and intent-specific policy.                                                                                                                                                                                                                                                                                                                                                                           | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/snapshot/index.js`                      |     23 | Barrel puro de `filesystem/read/snapshot`; projeta buildSnapshotVersion, chunkSnapshotMatchesStats, createStaleChunkSnapshotError, createStaleSnapshotError, fingerprintFromStats, isStaleChunkSnapshotError, lstatPathSnapshot, readBytesFileRangeSnapshot, readBytesFileSnapshot, readDirectoryNamesSnapshot, readTextFileSnapshot, readTextLinesSnapshot….                                                                                                                             | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/snapshot/lines.js`                      |     25 | Leitura textual baixa em linhas.                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/snapshot/stat.js`                       |     19 | Stat baixo de filesystem.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/snapshot/text.js`                       |     51 | Leitura textual baixa, acíclica e sem cache. Esta porta existe para módulos internos como parser e index-store que precisam ler um snapshot textual sem depender da facade `io-engine`, que por sua vez consulta índice/cache e participa de orquestração superior.                                                                                                                                                                                                                       | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/read/test-control.js`                        |      5 | Private filesystem/read reset composition.                                                                                                                                                                                                                                                                                                                                                                                                                                                | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/skills/catalog.js`                           |     93 | Narrow filesystem capability for configured Copilot skills. Skill roots come from boot configuration and may intentionally be absolute paths outside the workspace. Consumers do not receive generic trusted filesystem primitives; they can only discover directory-backed skills and optionally load the canonical `SKILL.md` for a name that was actually discovered under one of those roots.                                                                                         | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/skills/index.js`                             |      8 | Barrel puro de `filesystem/skills`; projeta readConfiguredSkillCatalog.                                                                                                                                                                                                                                                                                                                                                                                                                   | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/test-control.js`                             |     18 | Private filesystem test-control aggregator. Runtime filesystem barrels never reexport this surface.                                                                                                                                                                                                                                                                                                                                                                                       | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/transaction/capacity-preflight.js`           |    207 | Preflight advisory de capacidade para mutações que precisam materializar um payload no destino. `statfs` não reserva espaço e portanto não elimina corridas externas. A checagem falha aberta quando a plataforma não oferece informação confiável, mas falha cedo com ENOSPC quando a insuficiência já é observável.                                                                                                                                                                     | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/transaction/directory/index.js`              |      5 | Barrel puro de `filesystem/transaction/directory`; projeta mkdirPathUnlocked.                                                                                                                                                                                                                                                                                                                                                                                                             | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/transaction/directory/mkdir.js`              |    114 | mkdir baixo de filesystem com durability explícita do namespace criado.                                                                                                                                                                                                                                                                                                                                                                                                                   | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/transaction/file-handle-lifecycle.js`        |     67 | Canonical lifecycle for one already-open filesystem handle. The operation result is not published until close succeeds. When both the operation and close fail, the operation error remains primary and the close failure is attached as suppressed diagnostic context. Mutation-applied metadata is preserved or added according to the caller-provided state probe.                                                                                                                     | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/transaction/index.js`                        |     38 | Low-level transactional filesystem primitives shared by write and mutation orchestration. This capability never imports `filesystem/write` or `filesystem/mutation`; those layers depend on it in one direction.                                                                                                                                                                                                                                                                          | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/transaction/phases/emit.js`                  |     17 | Fases observáveis de mutações baixas para telemetria e fault injection determinístico.                                                                                                                                                                                                                                                                                                                                                                                                    | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/transaction/phases/index.js`                 |      5 | Barrel puro de `filesystem/transaction/phases`; projeta emitMutationPhase.                                                                                                                                                                                                                                                                                                                                                                                                                | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/transaction/rollback/format.js`              |      5 | Canonical rollback/pending filename grammar.                                                                                                                                                                                                                                                                                                                                                                                                                                              | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/transaction/rollback/index.js`               |     18 | Barrel puro de `filesystem/transaction/rollback`; projeta cleanupExpiredRollbackSidecars, cleanupRollbackSidecars, createRollbackSidecarWriter, getIoRollbackPolicy, getRollbackSidecarDirectory, getRollbackSidecarMaxBytes, getRollbackSidecarMaxEntries, getRollbackSidecarTtlMs, isIoRollbackEnabled, listRollbackSidecars, persistRollbackSidecar, readVerifiedRollbackSidecar….                                                                                                     | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/transaction/rollback/inventory.js`           |     75 | Read-only rollback sidecar inventory projection.                                                                                                                                                                                                                                                                                                                                                                                                                                          | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/transaction/rollback/maintenance.js`         |    199 | Retention, expiration, quota enforcement and purge lifecycle for rollback sidecars.                                                                                                                                                                                                                                                                                                                                                                                                       | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/transaction/rollback/policy.js`              |     40 | Rollback opt-in, retention quotas, TTL and storage-directory policy.                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/transaction/rollback/storage.js`             |    240 | Durable rollback sidecar publication and verified read.                                                                                                                                                                                                                                                                                                                                                                                                                                   | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/transaction/rollback/types.js`               |     13 | JSDoc-only rollback sidecar descriptor contract.                                                                                                                                                                                                                                                                                                                                                                                                                                          | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/transaction/snapshot.js`                     |    136 | Snapshots binários streamados para mutações.                                                                                                                                                                                                                                                                                                                                                                                                                                              | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/transaction/temp-path.js`                    |    220 | Nomes temporários irmãos para publicação atômica no mesmo filesystem.                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/transaction/test-control.js`                 |      5 | Private reset composition for filesystem/transaction.                                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/trusted/index.js`                            |     18 | **REMOVIDO em 2026-08-21.** Barrel da antiga façade genérica trusted, mantido nesta linha apenas como evidência histórica do inventário inicial.                                                                                                                                                                                                                                                                                                                                          | ✅ removido           | Substituído por workspace authority, configured grants/store ownership e primitives processuais estreitas. |
| `filesystem/trusted/io.js`                               |    246 | **REMOVIDO em 2026-08-21.** A façade sem workspace containment chegou a `0 importers / 0 calls` e foi eliminada fisicamente, sem shim/deprecated compatibility layer.                                                                                                                                                                                                                                                                                                                     | ✅ removido           | Reintrodução é proibida por `check:copilot:no-trusted-io`.                                                 |
| `filesystem/workspace/index.js`                          |     18 | Barrel puro de `filesystem/workspace`; projeta assertWorkspaceIoContext, createValidatedMutableWorkspacePath, createValidatedReadWorkspacePath, createWorkspaceIo, getValidatedMutableWorkspacePathStats, getValidatedReadWorkspacePathStats, requireValidatedWorkspaceReadPath, resolveValidatedMutableWorkspacePath, resolveValidatedReadWorkspacePath, resolveWorkspacePath.                                                                                                           | ❌ Authority contract | P0: remover minting cru da API; issuer privado exige policy proof e binding de instância.                  |
| `filesystem/workspace/io.js`                             |    363 | Workspace-bound IO capability. Normal string paths are evaluated by the async canonical policy immediately before the underlying IO operation. Internal callers may reuse opaque capabilities emitted by that same policy result, avoiding a duplicate realpath walk while preserving workspace/mode/policy-version checks. Mutable fast paths are separate methods and intentionally limited to single-target write/patch operations; string APIs always keep full canonical validation. | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/workspace/path-boundary.js`                  |     74 | Canonical workspace path authorization boundary shared by workspace-scoped capabilities. This module owns policy evaluation and opaque validated-read capability consumption. It deliberately does not perform filesystem or indexing operations; higher capabilities compose their own operations on top of these resolved paths.                                                                                                                                                        | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/workspace/test-control.js`                   |      7 | Private reset composition for filesystem/workspace.                                                                                                                                                                                                                                                                                                                                                                                                                                       | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/workspace/validated-path.js`                 |    212 | Opaque read-only workspace-path capability. The capability is issued only after the canonical async path policy has already resolved symlinks and verified containment. Workspace-bound read/search/stat adapters can consume it without repeating the same realpath walk. Plain objects cannot forge the module-private brand. Mutable modes never accept this capability.                                                                                                               | ❌ Authority contract | P0: remover minting cru da API; issuer privado exige policy proof e binding de instância.                  |
| `filesystem/write/append/index.js`                       |      7 | Barrel puro de `filesystem/write/append`; projeta appendFileUnlocked, appendTextLocked, openDetachedAppendSinkLocked, openDetachedAppendSinkUnlocked.                                                                                                                                                                                                                                                                                                                                     | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/append/locked.js`                      |    175 | Locked append operations, including detached inherited append descriptors.                                                                                                                                                                                                                                                                                                                                                                                                                | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/append/sink.js`                        |     67 | Append sink primitive for file descriptors intentionally inherited by detached child processes. The IO engine cannot serialize writes performed by the child after spawn, but it can make creation of the pathname explicit and durable. Exclusive create first distinguishes a newly published directory entry without a TOCTOU stat. Existing files are reopened in append mode without changing their namespace.                                                                       | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/append/unlocked.js`                    |     99 | Append baixo de filesystem com durability explícita.                                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/atomic/index.js`                       |     10 | Barrel puro de `filesystem/write/atomic`; projeta createOrReplaceFileAtomic, writeAtomicFileUnlocked, writeFileAtomic, writeFileAtomicPortable.                                                                                                                                                                                                                                                                                                                                           | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/atomic/locked.js`                      |    215 | Locked atomic write/create-replace orchestration with rollback evidence.                                                                                                                                                                                                                                                                                                                                                                                                                  | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/atomic/portable.js`                    |     43 | Atomic writer for trusted, explicitly configured paths that may live outside the workspace. Unlike `writeFileAtomic`, this function deliberately skips workspace path policy. It still serializes by normalized resource key and uses a same-directory temp file followed by rename.                                                                                                                                                                                                      | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/atomic/stage.js`                       |    140 | Staging inode, mode preservation and directory-sync support for atomic publish.                                                                                                                                                                                                                                                                                                                                                                                                           | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/atomic/types.js`                       |     27 | JSDoc-only contracts for low-level atomic writes.                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/atomic/unlocked.js`                    |    198 | Low-level atomic publish protocol; caller owns locking/cache/observability.                                                                                                                                                                                                                                                                                                                                                                                                               | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/copy.js`                               |    135 | Cópia baixa de filesystem.                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/directory/index.js`                    |      5 | Barrel puro de `filesystem/write/directory`; projeta mkdirPathLocked.                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/directory/locked.js`                   |    104 | Locked directory creation and namespace-durability orchestration.                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/index.js`                              |     22 | Barrel puro de `filesystem/write`; projeta appendFileUnlocked, appendTextLocked, assertRecursiveRemovalConfirmed, chmodFileLocked, chmodFileUnlocked, copyFileUnlocked, createOrReplaceFileAtomic, deleteFileUnlocked, mkdirPathLocked, moveFileUnlocked, normalizeWritePayload, openDetachedAppendSinkLocked….                                                                                                                                                                           | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/metadata/index.js`                     |      6 | Barrel puro de `filesystem/write/metadata`; projeta chmodFileLocked, chmodFileUnlocked.                                                                                                                                                                                                                                                                                                                                                                                                   | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/metadata/locked.js`                    |     92 | Locked metadata-only filesystem writes.                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/metadata/unlocked.js`                  |    119 | Metadata-only filesystem mutations with explicit durability semantics. Unlike atomic content replacement, chmod mutates the currently referenced inode in place. Once `FileHandle.chmod()` succeeds the mutation is physically applied; any later sync/hook/close failure therefore has to carry `mutationApplied=true` so callers inspect state before retrying.                                                                                                                         | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/move/cross-device.js`                  |    133 | Staged copy/verify/fsync/publish/unlink protocol for EXDEV file moves.                                                                                                                                                                                                                                                                                                                                                                                                                    | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/move/index.js`                         |      8 | Barrel puro de `filesystem/write/move`; projeta moveFileUnlocked.                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/move/service.js`                       |    114 | Same-device link/rename move protocol with EXDEV delegation.                                                                                                                                                                                                                                                                                                                                                                                                                              | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/move/support.js`                       |     48 | Integrity and durability helpers shared by same-device and cross-device move protocols.                                                                                                                                                                                                                                                                                                                                                                                                   | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/move/types.js`                         |     27 | JSDoc-only contracts for low-level file move protocols.                                                                                                                                                                                                                                                                                                                                                                                                                                   | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/payload/index.js`                      |      5 | Barrel puro de `filesystem/write/payload`; projeta normalizeWritePayload, toWriteBuffer.                                                                                                                                                                                                                                                                                                                                                                                                  | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/payload/normalize.js`                  |     21 | Owned payload normalization shared by locked append/write orchestration.                                                                                                                                                                                                                                                                                                                                                                                                                  | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |
| `filesystem/write/remove.js`                             |    120 | Remoção baixa de filesystem com durability explícita do namespace.                                                                                                                                                                                                                                                                                                                                                                                                                        | ✅                    | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.                        |

### 19.6 `governance/`

| Arquivo                               | Linhas | Função atual                                                                                                                                                                                                                                                                                                                 | Estado 1.0 | Ação 2.0                                                                            |
| ------------------------------------- | -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `governance/architecture-manifest.js` |    212 | Declarative architecture manifest for `src/copilot/infra`. The manifest describes capability ownership only. Leaf-file inventory is intentionally derived from the filesystem by governance tooling instead of being duplicated as a second source of truth.                                                                 | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `governance/index.js`                 |     17 | Barrel puro de `governance`; projeta INFRA_ARCHITECTURE_MANIFEST, INFRA_LEGACY_ROOT_PATHS, INFRA_MODULE_LAYOUT, INFRA_PRIMARY_CAPABILITY_PATHS, INFRA_PUBLIC_ENTRY_PATHS, buildInfraModuleScorecard, getInfraModuleDescriptor, listInfraModulesByRisk, listInfraModulesByRole.                                               | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `governance/module-map.js`            |    132 | Query surface for infra architecture metadata. The semantic source of truth lives in `architecture-manifest.js`. This module intentionally contains no second hand-maintained topology; it only exposes the historical query API and compares the manifest with the real top-level filesystem when a scorecard is requested. | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |

### 19.7 `indexing/`

| Arquivo                                         | Linhas | Função atual                                                                                                                                                                                                                                                                                                                                                                                                                | Estado 1.0          | Ação 2.0                                                                                        |
| ----------------------------------------------- | -----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------- |
| `indexing/context/index.js`                     |     29 | Barrel puro de `indexing/context`; projeta closeScope, declareScope, endSessionScope, findSymbol, getScopeContext, getScopeStats, getScopeSymbolIndex, getSessionScopeStats, invalidateScopePath, listScopes, listSessionScopes, refreshScope….                                                                                                                                                                             | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/context/prefetch/cache-warm.js`       |    274 | L1 prefetch primitives and bounded concurrent path warming.                                                                                                                                                                                                                                                                                                                                                                 | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/context/prefetch/directory.js`        |    227 | Directory scan, deterministic bounded working-set selection and warming.                                                                                                                                                                                                                                                                                                                                                    | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/context/prefetch/index.js`            |     11 | Barrel puro de `indexing/context/prefetch`; projeta endSessionScope, getSessionScopeStats, listSessionScopes, startSessionScope, warmCacheForPaths, warmFromDirectory, warmReadThroughContext, warmRecentPaths, warmTextSnapshotsForPaths.                                                                                                                                                                                  | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/context/prefetch/read-through.js`     |    216 | Read-through context warm-up with parser/index reuse and relative-import expansion.                                                                                                                                                                                                                                                                                                                                         | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/context/prefetch/session.js`          |     96 | Lightweight registry for explicit prefetch sessions.                                                                                                                                                                                                                                                                                                                                                                        | ✅/⚠ Lifecycle      | Cleanup transacional em throw/abort; migrar para scope resource handle.                         |
| `indexing/context/prefetch/types.js`            |     40 | Shared JSDoc contracts for context prefetch.                                                                                                                                                                                                                                                                                                                                                                                | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/context/scope/declaration.js`         |     97 | Scope allocation, bounded-registry eviction and initial state construction.                                                                                                                                                                                                                                                                                                                                                 | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/context/scope/index-convergence.js`   |     49 | Selected-path convergence from a scope working set into the global derived index.                                                                                                                                                                                                                                                                                                                                           | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/context/scope/index.js`               |     10 | Barrel puro de `indexing/context/scope`; projeta closeScope, declareScope, findSymbol, getScopeContext, getScopeStats, getScopeSymbolIndex, invalidateScopePath, listScopes, refreshScope.                                                                                                                                                                                                                                  | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/context/scope/lifecycle.js`           |    100 | Scope declaration orchestration across bounded selection, parsing and selected-index convergence.                                                                                                                                                                                                                                                                                                                           | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/context/scope/materialization.js`     |     41 | Symbol materialization stage for a selected scope working set.                                                                                                                                                                                                                                                                                                                                                              | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/context/scope/query.js`               |    200 | Read-only projections over active session-scope state.                                                                                                                                                                                                                                                                                                                                                                      | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/context/scope/refresh.js`             |    181 | Invalidation, delta refresh and scope shutdown lifecycle.                                                                                                                                                                                                                                                                                                                                                                   | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/context/scope/selection.js`           |    116 | Bounded working-set selection and snapshot-prefetch stage for scope opening.                                                                                                                                                                                                                                                                                                                                                | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/context/scope/state.js`               |    222 | Registry, bounded state and invariants for session scopes. No lifecycle orchestration lives here.                                                                                                                                                                                                                                                                                                                           | ✅/⚠ Estado global  | Classificar/migrar estado para ProcessInfra, InfraRuntime ou WorkspaceInfra; dispose explícito. |
| `indexing/context/scope/types.js`               |    132 | Shared JSDoc-only contracts for session scopes.                                                                                                                                                                                                                                                                                                                                                                             | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/index.js`                             |     33 | Barrel puro de `indexing`; projeta buildIoIndexForDirectory, filterIndexRowsByGlob, filterIoIndexRefreshDomainPaths, findIoIndexImports, findIoIndexImportsByPath, findIoIndexSymbol, flushIoIndexAutoRefresh, formatIndexImportRows, formatIndexSearchRows, formatIndexSymbolRows, getIoIndex, getIoIndexAutoRefreshStats….                                                                                                | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/cache/index.js`                |     13 | Barrel puro de `indexing/parser/cache`; projeta ensureParserInvalidationHook, fileContextCache, fileContextCacheStats, invalidateParserCache, isFileContextCacheEnabled, parseAndCacheSymbols, symbolCache.                                                                                                                                                                                                                 | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/cache/state.js`                |    123 | Bounded parser caches and invalidation ownership.                                                                                                                                                                                                                                                                                                                                                                           | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/cache/symbols.js`              |    122 | Snapshot-aware symbol cache orchestration.                                                                                                                                                                                                                                                                                                                                                                                  | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/cache/test-control.js`         |      4 | Private parser-cache reset control.                                                                                                                                                                                                                                                                                                                                                                                         | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/context/index.js`              |      5 | Barrel puro de `indexing/parser/context`; projeta parseFileForContext, windowFileContext.                                                                                                                                                                                                                                                                                                                                   | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/context/service.js`            |    120 | File-context projection, bounded windowing and content-addressed context cache.                                                                                                                                                                                                                                                                                                                                             | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/foundation/config.js`          |     71 | Parser runtime/cache configuration and adaptive worker policies.                                                                                                                                                                                                                                                                                                                                                            | ✅/⚠ Ambient config | Converter module-eval process.env em parser config snapshot/factory.                            |
| `indexing/parser/foundation/index.js`           |     32 | Barrel puro de `indexing/parser/foundation`; projeta FILE_CONTEXT_CACHE_DISABLED_VALUES, FILE_CONTEXT_CACHE_MAX_BYTES, FILE_CONTEXT_CACHE_MAX_ENTRIES, FILE_CONTEXT_CACHE_TTL_MS, MAX_PARSE_BYTES, MAX_PARSE_DURATION_MS, MAX_PARSE_LINE_GUARD, PARSER_MAIN_THREAD_FALLBACK_MAX_BYTES, PARSER_WORKER_ENABLED, PARSER_WORKER_POOL_POLICY, PARSER_WORKER_POOL_SIZE, PARSER_WORKER_QUEUE_MAX….                                 | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/foundation/path.js`            |     20 | Implementação `path` pertencente a `indexing/parser/foundation`.                                                                                                                                                                                                                                                                                                                                                            | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/foundation/runtime-state.js`   |     35 | Mutable parser counters shared by sibling parser components.                                                                                                                                                                                                                                                                                                                                                                | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/foundation/test-control.js`    |      4 | Private parser-foundation reset control.                                                                                                                                                                                                                                                                                                                                                                                    | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/foundation/types.js`           |     38 | Shared parser contracts with no runtime ownership. Runtime parser/cache/context modules depend on these contracts in one direction. Keeping the contracts here avoids type-only back-edges such as cache-state -> context -> cache-state.                                                                                                                                                                                   | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/health/index.js`               |      5 | Barrel puro de `indexing/parser/health`; projeta getParserCacheStats.                                                                                                                                                                                                                                                                                                                                                       | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/health/service.js`             |     61 | Operational parser health projection.                                                                                                                                                                                                                                                                                                                                                                                       | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/index.js`                      |     21 | Barrel puro de `indexing/parser`; projeta buildOutline, extractJsonSchema, extractMarkdownOutline, extractTopComments, getParserCacheStats, invalidateParserCache, parseAndCacheSymbols, parseFileForContext, parseFileSymbols, resolveParserWorkerPoolPolicy, resolveParserWorkerQueuePolicy, shutdownParserWorkerPool….                                                                                                   | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/parse/index.js`                |      5 | Barrel puro de `indexing/parser/parse`; projeta parseFileSymbols.                                                                                                                                                                                                                                                                                                                                                           | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/parse/service.js`              |    187 | Core parser execution for JS/TS/JSON/Markdown. This module owns parsing only. Worker lifecycle, caches, context projection and health live in sibling modules and are composed by `index.js`.                                                                                                                                                                                                                               | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/test-control.js`               |     13 | Privileged parser test-control surface. Not re-exported by the runtime parser barrel.                                                                                                                                                                                                                                                                                                                                       | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/worker/entry.js`               |     94 | Worker de parsing JS/TS para reduzir bloqueio do event loop principal.                                                                                                                                                                                                                                                                                                                                                      | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/worker/index.js`               |     10 | Barrel puro de `indexing/parser/worker`; projeta getParserWorkerRuntimeErrorCode, getParserWorkerRuntimeStatus, parseSymbolsInWorker, shutdownParserWorkerPool.                                                                                                                                                                                                                                                             | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/parser/worker/runtime.js`             |    359 | Worker-pool lifecycle and backpressure for parser execution.                                                                                                                                                                                                                                                                                                                                                                | ✅/⚠ Estado global  | Classificar/migrar estado para ProcessInfra, InfraRuntime ou WorkspaceInfra; dispose explícito. |
| `indexing/parser/worker/test-control.js`        |      4 | Private parser-worker reset control.                                                                                                                                                                                                                                                                                                                                                                                        | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/build.js`                    |     67 | Coalesced directory index build orchestration.                                                                                                                                                                                                                                                                                                                                                                              | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/index.js`                    |     21 | Barrel puro de `indexing/registry`; projeta buildIoIndexForDirectory, filterIoIndexRefreshDomainPaths, findIoIndexImports, findIoIndexImportsByPath, findIoIndexSymbol, flushIoIndexAutoRefresh, getIoIndex, getIoIndexAutoRefreshStats, getIoIndexStats, invalidateIoIndexPath, readIoIndexAutoRefreshConfig, reconcileIoIndexAutoRefreshDomain….                                                                          | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/query.js`                    |     52 | Thin query/invalidation facade over the lazy index runtime.                                                                                                                                                                                                                                                                                                                                                                 | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/refresh/domain.js`           |    109 | Semantic domain policy for explicit and automatic index refresh.                                                                                                                                                                                                                                                                                                                                                            | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/refresh/index.js`            |     22 | Barrel puro de `indexing/registry/refresh`; projeta adoptIoIndexAutoRefreshDomain, createIndexAutoRefreshDomain, executeIoIndexPathRefresh, filterIoIndexRefreshDomainPaths, flushIoIndexAutoRefresh, getIoIndexAutoRefreshStats, isIndexRefreshDomainCandidate, readIoIndexAutoRefreshConfig, reconcileIoIndexAutoRefreshDomain, refreshIoIndexPathsScheduled, requestIoIndexAutoRefreshDrain, scheduleIoIndexAutoRefresh. | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/refresh/paths.js`            |    197 | Explicit-path refresh executor. Scheduler state is injected by the caller.                                                                                                                                                                                                                                                                                                                                                  | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/refresh/scheduler.js`        |    302 | Invalidation-driven index refresh domain, debounce queue and convergence scheduler.                                                                                                                                                                                                                                                                                                                                         | ✅/⚠ Convergência   | Requeue/retry bounded por path; corrigir comentário/estado de failures.                         |
| `indexing/registry/refresh/test-control.js`     |      4 | Private registry-refresh reset control.                                                                                                                                                                                                                                                                                                                                                                                     | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/runtime/index.js`            |      5 | Barrel puro de `indexing/registry/runtime`; projeta getIoIndex, getIoIndexStats, refreshIoIndexPaths.                                                                                                                                                                                                                                                                                                                       | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/runtime/service.js`          |     52 | Public persistent-index runtime façade and invalidation-hook composition.                                                                                                                                                                                                                                                                                                                                                   | ✅/⚠ Lazy lifecycle | Instanciar registry; separar activation de stats/query.                                         |
| `indexing/registry/runtime/test-control.js`     |      4 | Private registry-runtime hook reset control.                                                                                                                                                                                                                                                                                                                                                                                | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/sqlite/content.js`           |    114 | Helpers puros de conteúdo para o index-store SQLite.                                                                                                                                                                                                                                                                                                                                                                        | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/sqlite/directory-builder.js` |    191 | Directory scan/limit/prune/concurrency orchestration for the persistent index registry.                                                                                                                                                                                                                                                                                                                                     | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/sqlite/file-reconciler.js`   |    226 | Per-file freshness/hash/snapshot reconciliation for directory index builds.                                                                                                                                                                                                                                                                                                                                                 | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/sqlite/index.js`             |     27 | Internal SQLite indexing primitives.                                                                                                                                                                                                                                                                                                                                                                                        | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/sqlite/metadata.js`          |     61 | Metadata projection policy for persistent index rows.                                                                                                                                                                                                                                                                                                                                                                       | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/sqlite/paths.js`             |     79 | Normalização de paths e filtros do index-store SQLite.                                                                                                                                                                                                                                                                                                                                                                      | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/sqlite/query-api.js`         |    166 | Read/query projection over the persistent index registry. This module owns query semantics only. It receives already prepared statements and the connection for the one dynamic symbol query; it does not own schema lifecycle, index builds, mutations or filesystem access.                                                                                                                                               | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/sqlite/query.js`             |     33 | Helpers de consulta do index-store SQLite.                                                                                                                                                                                                                                                                                                                                                                                  | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/sqlite/snapshot-verifier.js` |     59 | Snapshot validation boundary for index commits.                                                                                                                                                                                                                                                                                                                                                                             | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/sqlite/statements.js`        |    300 | Prepared SQLite statements owned by the persistent index registry. Statement preparation is isolated from orchestration so the store facade owns lifecycle and transactions while this module owns only connection-bound SQL primitives.                                                                                                                                                                                    | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/sqlite/stats.js`             |     47 | Health/statistics projection for the persistent index registry.                                                                                                                                                                                                                                                                                                                                                             | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/sqlite/store.js`             |    236 | Índice persistente L2 de I/O local. Diferente de `io-cache-l2-sqlite`, que guarda payloads de leitura para acelerar cache misses, este módulo guarda metadados pesquisáveis: arquivos, FTS textual, símbolos Babel e edges de imports. O scanner e o parser continuam sendo as fontes canônicas; o índice apenas materializa uma visão consultável e fresca.                                                                | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/sqlite/types.js`             |     23 | Shared JSDoc-only contracts for the SQLite index registry.                                                                                                                                                                                                                                                                                                                                                                  | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/sqlite/writer.js`            |    242 | Transactional writer for the persistent index registry. Owns row replacement, pruning, parser projection and explicit invalidation. It receives prepared statements and policies from the store composition root; it does not own directory scanning or query semantics.                                                                                                                                                    | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/state/builds.js`             |      6 | Shared coalescing state for index directory builds.                                                                                                                                                                                                                                                                                                                                                                         | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/state/index.js`              |      6 | Barrel puro de `indexing/registry/state`; projeta getIoIndexInstance, inflightIndexBuilds, isIoIndexDisabled.                                                                                                                                                                                                                                                                                                               | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/state/instance.js`           |     28 | Lazy process-local index instance backed by the injected infra SQLite provider.                                                                                                                                                                                                                                                                                                                                             | ✅/⚠ Lazy lifecycle | Instanciar registry; separar activation de stats/query.                                         |
| `indexing/registry/state/test-control.js`       |      9 | Private registry-state reset composition.                                                                                                                                                                                                                                                                                                                                                                                   | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/registry/test-control.js`             |     11 | Test-only lifecycle reset for registry internals.                                                                                                                                                                                                                                                                                                                                                                           | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/scanner/batching.js`                  |     34 | Primitivas de batching para scans de diretório.                                                                                                                                                                                                                                                                                                                                                                             | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/scanner/fingerprint.js`               |     49 | Helpers de tipo e fingerprint para entradas de scan.                                                                                                                                                                                                                                                                                                                                                                        | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/scanner/gitignore.js`                 |     25 | Loader de .gitignore para scanner.                                                                                                                                                                                                                                                                                                                                                                                          | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/scanner/glob.js`                      |     97 | Política glob canônica usada por scan, prefetch e pós-filtro do índice.                                                                                                                                                                                                                                                                                                                                                     | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/scanner/index.js`                     |     18 | Barrel puro de `indexing/scanner`; projeta IO_GLOB_ENGINE, buildFileFingerprint, classifyStats, getIoScanBasename, loadGitignoreMatcher, mapInBatches, matchesAnyPattern, matchesFilter, matchesGlobPattern, matchesPlainPathPattern, normalizeBatchSize, scanDirectory….                                                                                                                                                   | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/scanner/service.js`                   |    305 | Scanner canônico de diretórios para I/O local. Mantém listagem e scan em uma única superfície observável, sem indexação persistente. O índice L2/FTS deve consumir esta engine depois, em vez de reimplementar traversal próprio.                                                                                                                                                                                           | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/index.js`                      |     22 | Barrel puro de `indexing/search`; projeta buildGrepArgs, buildSymbolPattern, canUseIndexSearch, escapeRegex, execSearchFile, filterIndexRowsByGlob, formatIndexImportRows, formatIndexSearchRows, formatIndexSymbolRows, formatLiteralIndexSearchRows, isRipgrepAvailable, kindToGlobs….                                                                                                                                    | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/shared/index.js`               |     12 | Barrel puro de `indexing/search/shared`; projeta assertValidTargetPath, countSearchMatchLines, countSearchOutputLines, createStreamingSearchCollector, getIoSearchBudget, normalizeSearchWindow, paginateSearchItems, paginateSearchText, sanitizeSearchOutput.                                                                                                                                                             | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/shared/output.js`              |    133 | Sanitization, redaction and streaming-output collection shared by search operations.                                                                                                                                                                                                                                                                                                                                        | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/shared/pagination.js`          |     71 | Paginação estruturada para resultados de busca.                                                                                                                                                                                                                                                                                                                                                                             | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/shared/policy.js`              |     29 | Search budget and validated target-path policy.                                                                                                                                                                                                                                                                                                                                                                             | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/subprocess/exec.js`            |    161 | Bounded buffered subprocess execution for local search adapters.                                                                                                                                                                                                                                                                                                                                                            | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/subprocess/index.js`           |     10 | Barrel puro de `indexing/search/subprocess`; projeta execSearchFile, isRipgrepAvailable, streamSearchFile.                                                                                                                                                                                                                                                                                                                  | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/subprocess/ripgrep.js`         |     29 | Process-local ripgrep availability probe/cache.                                                                                                                                                                                                                                                                                                                                                                             | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/subprocess/stream.js`          |    221 | Bounded line-streaming subprocess execution with early-stop support.                                                                                                                                                                                                                                                                                                                                                        | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/subprocess/support.js`         |    144 | Validation, errors and child termination policy shared by search subprocess modes.                                                                                                                                                                                                                                                                                                                                          | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/subprocess/test-control.js`    |      4 | Private search-subprocess reset control.                                                                                                                                                                                                                                                                                                                                                                                    | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/subprocess/types.js`           |     16 | JSDoc-only contracts for bounded local search subprocesses.                                                                                                                                                                                                                                                                                                                                                                 | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/symbol/index.js`               |      6 | Barrel puro de `indexing/search/symbol`; projeta buildSymbolPattern, escapeRegex, formatIndexSymbolRows, kindToGlobs, searchWorkspaceSymbols.                                                                                                                                                                                                                                                                               | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/symbol/pattern.js`             |     93 | Helpers puros para busca simbólica textual.                                                                                                                                                                                                                                                                                                                                                                                 | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/symbol/service.js`             |    238 | Workspace symbol search via registry index with ripgrep fallback.                                                                                                                                                                                                                                                                                                                                                           | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/test-control.js`               |      7 | Private search test-control composition.                                                                                                                                                                                                                                                                                                                                                                                    | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/text/grep.js`                  |     54 | Adapter de argumentos para grep fallback.                                                                                                                                                                                                                                                                                                                                                                                   | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/text/index.js`                 |     16 | Barrel puro de `indexing/search/text`; projeta buildGrepArgs, canUseIndexSearch, filterIndexRowsByGlob, formatIndexImportRows, formatIndexSearchRows, formatLiteralIndexSearchRows, searchText.                                                                                                                                                                                                                             | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/text/indexed-format.js`        |    148 | Helpers puros para busca via índice FTS5.                                                                                                                                                                                                                                                                                                                                                                                   | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/text/indexed.js`               |    284 | Derived-index acceleration/fallback decision for completeness-oriented text search.                                                                                                                                                                                                                                                                                                                                         | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/text/process.js`               |    219 | ripgrep/grep execution path for completeness-oriented text search.                                                                                                                                                                                                                                                                                                                                                          | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/text/service.js`               |     90 | Completeness-oriented text/regex search orchestration.                                                                                                                                                                                                                                                                                                                                                                      | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/search/text/types.js`                 |     41 | JSDoc-only contracts for completeness-oriented text search orchestration.                                                                                                                                                                                                                                                                                                                                                   | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/test-control.js`                      |      6 | Private indexing test-control aggregator.                                                                                                                                                                                                                                                                                                                                                                                   | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/workspace/index.js`                   |      5 | Barrel puro de `indexing/workspace`; projeta createWorkspaceIndexing.                                                                                                                                                                                                                                                                                                                                                       | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |
| `indexing/workspace/service.js`                 |     88 | Workspace-scoped indexing/search composition. Filesystem owns path authorization. Indexing owns scan/search/context behavior. This adapter composes the two without making `filesystem/workspace` depend on indexing implementations.                                                                                                                                                                                       | ✅                  | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0.             |

### 19.8 `observability/`

| Arquivo                             | Linhas | Função atual                                                                                                                                                                | Estado 1.0         | Ação 2.0                                                                            |
| ----------------------------------- | -----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------- |
| `observability/alerts.js`           |    104 | Pure alert derivation from already-collected IO runtime health snapshots.                                                                                                   | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `observability/coherence-health.js` |     59 | Read-side coherence/invalidation health projection with bounded fail-closed fallback.                                                                                       | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `observability/health.js`           |    288 | Snapshot operacional de I/O local: cache tiers, parser e scopes ativos. Este módulo só projeta estado; não executa leitura/escrita e não altera o funcionamento dos caches. | ✅/⚠ Fan-out/custo | Substituir imports concretos por HealthProbeRegistry/snapshots.                     |
| `observability/index.js`            |      5 | Barrel puro de `observability`; projeta readIoRuntimeHealthSnapshot.                                                                                                        | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `observability/safe-call.js`        |     27 | Failure-contained read-side calls for observability projections.                                                                                                            | ✅                 | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |

### 19.9 `operations/`

| Arquivo                            | Linhas | Função atual                                                                                                                                                                                                                                                                                                          | Estado 1.0 | Ação 2.0                                                                            |
| ---------------------------------- | -----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `operations/audit-log.js`          |    112 | Mutation audit runtime-owned; writer JSONL lazy, facade legacy stateless e lifecycle explícito.                                                                                                                                                                                                                       | ✅ 2.0     | Preservar factory de instância; produção entra via `InfraRuntime.mutationAudit`.    |
| `operations/contracts/index.js`    |     13 | Barrel puro de `operations/contracts`; projeta contratos/type-only.                                                                                                                                                                                                                                                   | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `operations/contracts/types.js`    |     51 | Shared immutable type contracts for operation/change-set/rollback orchestration.                                                                                                                                                                                                                                      | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `operations/index.js`              |     29 | Barrel puro de `operations`; projeta abortIoChangeSet, appendIoChangeSetEntry, applyIoChangeSet, beginIoChangeSet, buildIoMutationAuditRecord, buildIoRollbackPlan, cleanupRollbackSidecars, completeIoOperationEnvelope, createIoOperationEnvelope, createIoRollbackToken, executeIoRollbackToken, failIoChangeSet…. | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `operations/operation.js`          |     76 | Envelope de operação agentic para ações rastreáveis.                                                                                                                                                                                                                                                                  | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `operations/rollback/apply.js`     |     99 | Physical rollback application after virtual preflight succeeds under held resource locks.                                                                                                                                                                                                                             | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `operations/rollback/executor.js`  |     99 | Parse, authorize, lock, preflight and apply signed I/O rollback tokens.                                                                                                                                                                                                                                               | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `operations/rollback/index.js`     |     16 | Barrel puro de `operations/rollback`; projeta buildIoRollbackPlan, createIoRollbackToken, executeIoRollbackToken, parseIoRollbackToken, serializeIoRollbackToken, verifyIoRollbackToken.                                                                                                                              | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `operations/rollback/preflight.js` |     75 | Virtual-state rollback preflight performed while all affected resource locks are held.                                                                                                                                                                                                                                | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `operations/rollback/support.js`   |     73 | Snapshot loading, path expansion and exact state preconditions for rollback execution.                                                                                                                                                                                                                                | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `operations/rollback/token.js`     |    155 | Planejamento e serialização de rollback para change sets de I/O.                                                                                                                                                                                                                                                      | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `operations/rollback/types.js`     |     10 | JSDoc-only contracts for rollback execution.                                                                                                                                                                                                                                                                          | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `operations/transaction.js`        |    165 | Primitivas de transação para mutações de I/O. Esta camada cria um `changeSet` rastreável que agrega operações mutáveis (write/patch/move/delete/copy) com evidências suficientes para planejamento de rollback posterior.                                                                                             | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |

### 19.10 `persistence/`

| Arquivo                                    | Linhas | Função atual                                                                                                                                                                                                                       | Estado 1.0 | Ação 2.0                                                                            |
| ------------------------------------------ | -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `persistence/json/index.js`                |      5 | Barrel puro de `persistence/json`; projeta fileExists, readJson, writeJson.                                                                                                                                                        | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `persistence/json/store.js`                |     49 | JSON store baixo baseado em filesystem.                                                                                                                                                                                            | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `persistence/jsonl/codec.js`               |     33 | Strict UTF-8 decoding and bounded numeric normalization for JSONL readers.                                                                                                                                                         | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `persistence/jsonl/index.js`               |      8 | Barrel puro de `persistence/jsonl`; projeta createJsonlFileWriter, readJsonlTail, readJsonlTailTrusted, repairJsonlTrailingPartial.                                                                                                | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `persistence/jsonl/repair.js`              |    164 | Locked repair of one invalid trailing JSONL partial record.                                                                                                                                                                        | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `persistence/jsonl/tail.js`                |    167 | Bounded reverse tail reader for JSONL, optionally repairing one trailing partial record first.                                                                                                                                     | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `persistence/jsonl/trusted.js`             |     31 | Trusted runtime boundary for JSONL persistence reads. Caller identity is validated here while parsing, UTF-8 validation, partial-line handling and byte budgets remain owned by the canonical JSONL reader in the same capability. | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `persistence/jsonl/writer/index.js`        |      7 | Barrel puro de `persistence/jsonl/writer`; projeta createJsonlFileWriter.                                                                                                                                                          | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `persistence/jsonl/writer/persistence.js`  |     96 | Locked JSONL rotate/append/durability protocol, independent from queue/backpressure state.                                                                                                                                         | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `persistence/jsonl/writer/service.js`      |    166 | Serialized JSONL writer queue with bounded backpressure and at-most-once handling after applied mutations.                                                                                                                         | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `persistence/jsonl/writer/size-tracker.js` |     88 | Bounded per-path physical-size cache with non-sliding revalidation timestamps.                                                                                                                                                     | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `persistence/jsonl/writer/types.js`        |     24 | JSDoc-only contracts for the JSONL writer subcapability.                                                                                                                                                                           | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |

### 19.11 `platform/`

| Arquivo                                  | Linhas | Função atual                                                                                                                                                                                                                                                                                                                                                                  | Estado 1.0 | Ação 2.0                                                                            |
| ---------------------------------------- | -----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `platform/buffer.js`                     |    232 | Utilitários canônicos de Buffer/ArrayBuffer para IO.                                                                                                                                                                                                                                                                                                                          | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `platform/config-values.js`              |     58 | Pure coercion helpers for bounded runtime configuration values. This module does not read process.env; environment lookup belongs to `env.js`. Keeping coercion separate lets option objects, persisted settings and env-backed configuration share identical semantics without duplicating parsers.                                                                          | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `platform/env.js`                        |     66 | Environment lookup helpers for infra configuration. Value coercion itself lives in `config-values.js` so option objects and environment-backed settings share semantics.                                                                                                                                                                                                      | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `platform/fingerprint.js`                |     53 | Helpers compartilhados para comparação de fingerprint de arquivo.                                                                                                                                                                                                                                                                                                             | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `platform/hash.js`                       |     17 | Hashes determinísticos usados por preconditions, índice e evidência de mutação.                                                                                                                                                                                                                                                                                               | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `platform/http-response.js`              |    145 | Leitura bounded de corpos HTTP recebidos pelo runtime.                                                                                                                                                                                                                                                                                                                        | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `platform/index.js`                      |     47 | Barrel puro de `platform`; projeta BUFFER_MAX_LENGTH, BUFFER_MAX_STRING_LENGTH, BoundedProcessOutputCapture, DEFAULT_HTTP_RESPONSE_MAX_BYTES, DEFAULT_PROCESS_OUTPUT_MAX_BYTES, MAX_HTTP_RESPONSE_MAX_BYTES, MAX_PROCESS_OUTPUT_MAX_BYTES, assertBufferByteLengthWithinNodeLimit, assertStringByteLengthWithinNodeLimit, assertUtf8Buffer, booleanValueOr, boundedIntegerOr…. | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `platform/node/compile-cache.js`         |    210 | Node 24 module compile-cache foundation shared by MCP, terminal/LLM-B and child-process launchers. Compile cache is strictly an optimization: enable/flush failures never affect runtime correctness.                                                                                                                                                                         | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `platform/node/filesystem/durability.js` |    155 | Best-effort durability helpers for low-level filesystem mutations. Node can flush file descriptors through `FileHandle.sync()`, but directory fsync is platform/filesystem dependent. These helpers deliberately treat unsupported directory sync as a reported best-effort miss rather than a hard failure.                                                                  | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `platform/node/filesystem/index.js`      |     19 | Node filesystem primitives that are lower-level than infra capabilities.                                                                                                                                                                                                                                                                                                      | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `platform/node/index.js`                 |     10 | Barrel puro de `platform/node`; projeta enableCopilotNodeCompileCache, flushCopilotNodeCompileCache, getCopilotNodeCompileCacheHealth, withCopilotNodeCompileCacheEnv.                                                                                                                                                                                                        | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `platform/node/test-control.js`          |      4 | Private Node-platform reset composition.                                                                                                                                                                                                                                                                                                                                      | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `platform/process-output.js`             |    163 | Captura binária bounded para stdout/stderr e outros streams de subprocesso.                                                                                                                                                                                                                                                                                                   | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `platform/text-lines.js`                 |    158 | Iteração lazy de linhas físicas para consumidores textuais.                                                                                                                                                                                                                                                                                                                   | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |

### 19.12 `policy/`

| Arquivo                    | Linhas | Função atual                                                                                                                                                                                                                    | Estado 1.0 | Ação 2.0                                                                            |
| -------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `policy/budgets.js`        |     89 | Policies de budgets para operações de I/O com potencial de crescer em tempo, memória ou saída.                                                                                                                                  | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `policy/capabilities.js`   |     25 | Capabilities canônicas para envelopes agentic e auditabilidade de tools.                                                                                                                                                        | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `policy/index.js`          |     45 | Barrel de policies internas de infra.                                                                                                                                                                                           | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `policy/mutation-state.js` |     89 | Canonical metadata for filesystem mutations that were physically applied before a later confirmation/durability step failed. Callers must distinguish this state from a mutation that never reached its publish/write boundary. | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `policy/output-window.js`  |    163 | Helpers de janela de saída para operações com retorno potencialmente grande.                                                                                                                                                    | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `policy/path-resource.js`  |     74 | Policies puras para paths e chaves de recurso.                                                                                                                                                                                  | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `policy/preconditions.js`  |     36 | Preconditions reutilizáveis para mutações de I/O.                                                                                                                                                                               | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `policy/risk.js`           |     30 | Classificação padronizada de risco para operações Copilot IO/tools.                                                                                                                                                             | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |

### 19.13 `public/`

| Arquivo                                    | Linhas | Função atual                                                 | Estado 1.0              | Ação 2.0                                                                                                             |
| ------------------------------------------ | -----: | ------------------------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `public/cache/index.js`                    |      5 | Barrel puro de `public/cache`; projeta *.                    | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/code-analysis/index.js`            |      5 | Barrel puro de `public/code-analysis`; projeta *.            | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/concurrency/bulk/index.js`         |      5 | Barrel puro de `public/concurrency/bulk`; projeta *.         | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/concurrency/index.js`              |      6 | Barrel puro de `public/concurrency`; projeta *.              | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/concurrency/locks/index.js`        |      5 | Barrel puro de `public/concurrency/locks`; projeta *.        | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost. Projetar somente high-level lock API.  |
| `public/database/index.js`                 |      5 | Barrel puro de `public/database`; projeta *.                 | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost. Não projetar raw DB getter em runtime. |
| `public/filesystem/index.js`               |     11 | Barrel puro de `public/filesystem`; projeta *.               | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/filesystem/invalidation/index.js`  |      5 | Barrel puro de `public/filesystem/invalidation`; projeta *.  | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/filesystem/mutation/index.js`      |      5 | Barrel puro de `public/filesystem/mutation`; projeta *.      | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/filesystem/read/index.js`          |      5 | Barrel puro de `public/filesystem/read`; projeta *.          | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/filesystem/skills/index.js`        |      5 | Barrel puro de `public/filesystem/skills`; projeta *.        | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/filesystem/trusted/index.js`       |      5 | Barrel puro de `public/filesystem/trusted`; projeta *.       | ✅/⚠ Authority ampla    | Migrar para ConfiguredFsGrant least-privilege.                                                                       |
| `public/filesystem/workspace/index.js`     |      5 | Barrel puro de `public/filesystem/workspace`; projeta *.     | ❌ Authority contract   | P0: remover minting cru da API; issuer privado exige policy proof e binding de instância.                            |
| `public/filesystem/write/index.js`         |      5 | Barrel puro de `public/filesystem/write`; projeta *.         | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost. Retirar unlocked/portable raw writers. |
| `public/indexing/context/index.js`         |      5 | Barrel puro de `public/indexing/context`; projeta *.         | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/indexing/index.js`                 |     11 | Barrel puro de `public/indexing`; projeta *.                 | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/indexing/parser/index.js`          |      5 | Barrel puro de `public/indexing/parser`; projeta *.          | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/indexing/registry/index.js`        |      5 | Barrel puro de `public/indexing/registry`; projeta *.        | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/indexing/scanner/index.js`         |      5 | Barrel puro de `public/indexing/scanner`; projeta *.         | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/indexing/storage/index.js`         |      5 | Barrel puro de `public/indexing/storage`; projeta *.         | ✅/⚠ Diagnostic surface | Classificar tooling-only; exports nominais; impedir production import.                                               |
| `public/indexing/workspace/index.js`       |      5 | Barrel puro de `public/indexing/workspace`; projeta *.       | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/observability/index.js`            |      5 | Barrel puro de `public/observability`; projeta *.            | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/operations/index.js`               |      5 | Barrel puro de `public/operations`; projeta *.               | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/persistence/index.js`              |      6 | Barrel puro de `public/persistence`; projeta *.              | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/persistence/json/index.js`         |      5 | Barrel puro de `public/persistence/json`; projeta *.         | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/persistence/jsonl/index.js`        |      5 | Barrel puro de `public/persistence/jsonl`; projeta *.        | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/platform/index.js`                 |      6 | Barrel puro de `public/platform`; projeta *.                 | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/platform/node/filesystem/index.js` |      5 | Barrel puro de `public/platform/node/filesystem`; projeta *. | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/platform/node/index.js`            |      6 | Barrel puro de `public/platform/node`; projeta *.            | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/policy/index.js`                   |      5 | Barrel puro de `public/policy`; projeta *.                   | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/telemetry/index.js`                |      5 | Barrel puro de `public/telemetry`; projeta *.                | ✅/⚠ Public surface     | Eliminar `export *`; enumerar símbolos e metadata de audience/privilege/cost.                                        |
| `public/testing/index.js`                  |      5 | Barrel puro de `public/testing`; projeta *.                  | ✅/⚠ Audience           | Manter apenas test-only/tooling com hard audience gate e exports nominais.                                           |

### 19.14 `telemetry/`

| Arquivo                        | Linhas | Função atual                                                                                                                                                                                                                                                         | Estado 1.0 | Ação 2.0                                                                            |
| ------------------------------ | -----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `telemetry/advisory-budget.js` |    114 | Orçamento advisory de I/O local. Mede pressão recente de operações mutáveis e builds de índice sem bloquear, atrasar ou rejeitar trabalho.                                                                                                                           | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `telemetry/clock.js`           |     13 | Monotonic timing helpers shared by IO telemetry producers.                                                                                                                                                                                                           | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `telemetry/durability.js`      |    132 | Durability/sync/atomic-publish telemetry aggregation.                                                                                                                                                                                                                | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `telemetry/index.js`           |     10 | Barrel puro de `telemetry`; projeta beginIoAdvisoryBudget, elapsedIoMs, getIoAdvisoryBudgetStats, getIoDurabilityStats, getIoLatencyStats, getIoMutationStateStats, nowIoMs, publishIoLifecycleEvent, publishIoOperation, publishIoOperationResult, recordIoLatency. | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `telemetry/latency.js`         |     44 | Bounded per-operation latency histograms.                                                                                                                                                                                                                            | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `telemetry/mutation-state.js`  |     34 | Applied-but-unconfirmed mutation telemetry projection.                                                                                                                                                                                                               | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `telemetry/publisher.js`       |     63 | diagnostics_channel publication for IO operations and lifecycle events.                                                                                                                                                                                              | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |
| `telemetry/test-control.js`    |      4 | Private telemetry reset composition.                                                                                                                                                                                                                                 | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |

### 19.15 `testing/`

| Arquivo            | Linhas | Função atual                                                                                                                                                                                                                                                                   | Estado 1.0 | Ação 2.0                                                                            |
| ------------------ | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------- |
| `testing/index.js` |     32 | Test-control boundary for infra stateful capabilities. Runtime barrels intentionally do not expose reset/test helpers. This is the only cross-capability composition root allowed to bypass runtime barrels, and it may target only capability-local `test-control.js` leaves. | ✅         | Preservar owner; somente adaptar interfaces/lifecycle se atingido pelas faixas 2.0. |

---

## 20. Priorização recomendada

### Prioridade imediata

1. corrigir authority/minting da workspace capability;
2. converter membrane pública para exports nominais e retirar raw privileged exports;
3. adicionar audience gate para testing/diagnostics.

### Prioridade estrutural seguinte

4. introduzir composition scopes sem mover pure kernels;
5. configured filesystem grants;
6. registry/scheduler/scopes instanciados e lifecycle explícito;
7. probe-based observability;
8. config snapshot.

### Prioridade de performance

9. cost-boundary gates e fatiamento dos entrypoints;
10. micro-surfaces de `core`;
11. benchmark startup/RSS/import closure.

### Prioridade opcional/experimental

12. SQLite port + comparação controlada com `node:sqlite`;
13. remoção de legacy compatibility e aliases diagnósticos redundantes.

---

## 21. Recomendação final

A arquitetura 1.0 atingiu a organização física que faltava. A arquitetura 2.0 deve evitar o erro
clássico de interpretar “evolução arquitetural” como “mais pastas”. O ganho agora está em tornar
**explícito aquilo que ainda é implícito**:

- quem pode cunhar autoridade;
- qual root/operação uma capability pode tocar;
- quem é dono de cada recurso long-lived;
- qual é o escopo de cada estado mutável;
- qual audience pode importar cada surface;
- quanto custa carregar um entrypoint;
- quando uma query é realmente read-only;
- como trabalho best-effort converge depois de falhar;
- onde termina um contrato e começa um adapter concreto.

Se implementada nessa ordem, a 2.0 não substitui a 1.0: **ela transforma a disciplina estrutural da
1.0 em disciplina de autoridade, lifecycle, isolamento e performance.**

Até que a Faixa 0 seja implementada, o achado de minting público deve ser tratado como dívida
prioritária. Fora isso, não há evidência de que seja necessária outra reorganização massiva dos 378
arquivos; a maior parte deve continuar no owner atual, com mudanças concentradas nas boundaries e
nos stateful composition points.
