# `src/copilot/infra`

**Status:** charter arquitetural canônico

**Runtime:** Node.js 24+ / ESM / `@ts-check` / TypeScript 7 strict

**Data-base desta revisão:** 22 de agosto de 2026

`src/copilot/infra` é o package interno de capabilities técnicas compartilhadas do Copilot. Ele
possui duas faces deliberadamente distintas:

1. **owners internos**, que implementam e compõem as capabilities;
2. **`public/`**, uma membrana exclusivamente exportadora que é a única superfície permitida para
   consumidores externos a `infra`.

A arquitetura não possui mega-barrel `src/copilot/infra/index.js` nem
`src/copilot/infra/public/index.js`. O objetivo é obter encapsulamento forte sem transformar a API
externa em uma dependency bag global.

---

## 1. Invariantes arquiteturais

As regras abaixo são hard constraints de `src/copilot/infra` e possuem enforcement automático.

### Regra 1 — dependências unidirecionais

Toda dependência entre arquivos e entre capabilities deve formar um DAG. Circularidades são
proibidas, inclusive quando a aresta existe apenas em JSDoc/type imports.

São verificados dois grafos:

- grafo completo de arquivos;
- grafo entre owners/barrels de capability.

Ambos devem permanecer com **zero SCCs não triviais**.

### Regra 2 — ownership físico acompanha ownership lógico

Quando um componente existe exclusivamente para servir a um owner, ele deve viver sob uma subpasta
desse owner. Quando é usado por múltiplos owners independentes, deve receber um owner compartilhado
no nível mais baixo que preserve uma direção limpa de dependências.

Exemplos atuais:

- `filesystem/write/atomic/*` pertence a `write`;
- `filesystem/write/payload/*` é compartilhado por mais de um protocolo de escrita;
- `concurrency/locks/local/*` depende de `locks/file/*`, pois o lock local pode escalar para
  coordenação multiprocess;
- `indexing/context/scope/*` depende de `context/prefetch/*`, nunca o contrário.

A árvore não deve ser reorganizada apenas para ficar visualmente simétrica.

### Regra 3 — barrel-first entre diretórios

Imports relativos diretos são admitidos quando:

- origem e destino estão na mesma pasta; ou
- um owner acessa uma implementação situada em sua própria subpasta privada.

Travessias laterais ou ascendentes entre diretórios passam por `index.js`.

A única exceção deliberada de test-control é `infra/testing/index.js`, que pode agregar folhas
`test-control.js` sem poluir barrels runtime.

### Regra 4 — coesão, não tamanho

Número de linhas é apenas um indicador de inspeção. Um arquivo é refatorado quando mistura
responsabilidades, estados, lifecycles ou policies que podem possuir fronteiras melhores.

Por isso arquivos como `filesystem/workspace/io.js`, `concurrency/locks/local/resource-lock.js`,
`indexing/scanner/service.js` e `indexing/registry/refresh/scheduler.js` podem permanecer
relativamente grandes quando representam uma única máquina ou composition root coerente.

### Regra 5 — membrana pública única

Todo consumo de `infra` originado fora de `src/copilot/infra` passa por
`src/copilot/infra/public/**` e por aliases `#copilot/infra/public/...`.

Fluxo esperado:

```text
consumer externo
    ↓
#copilot/infra/public/<capability>
    ↓
infra/public/<capability>/index.js
    ↓
barrel interno da capability
    ↓
owner / implementação
```

Internamente o fluxo é diferente:

```text
owner interno
    ↓
#copilot/infra/internal/<capability>
    ↓
barrel interno
    ↓
owner dependido
```

Invariantes adicionais da membrana:

- código interno de `infra` **nunca** importa de `infra/public`;
- código de produção fora de `infra` **nunca** importa `#copilot/infra/internal/*`;
- não existem aliases legados `#copilot/infra/<capability>`;
- não existe wildcard `#copilot/infra/*`;
- `public/` não contém implementação nem lifecycle;
- `public/**/index.js` existe somente para entrypoints declarados em `package.json#imports`;
  namespace/marker barrels são proibidos;
- aliases públicos e projection barrels formam uma bijeção verificável;
- não existe `public/index.js` root;
- controles `*ForTest` só são projetados pelo entrypoint deliberado `#copilot/infra/public/testing`.

---

## 2. Estrutura canônica

```text
infra/
├── public/                 # API membrane; declared projection entrypoints only
├── governance/             # manifests e verificadores arquiteturais
├── platform/               # primitives técnicas/Node
├── concurrency/            # bulk, queue, locks
├── filesystem/             # I/O, transactions, coherence, containment
├── persistence/            # JSON/JSONL
├── database/               # composition port para SQLite compartilhado
├── cache/                  # L1/L2/tiering
├── code-analysis/          # parsing estrutural puro
├── indexing/               # scanner/parser/index/search/context/workspace
├── operations/             # mutation transaction/audit/rollback
├── telemetry/              # producer-side metrics/events
├── observability/          # read-side health/alerts
├── policy/                 # policies realmente transversais
├── testing/                # agregação privilegiada de test-control
└── README.md
```

`governance/architecture-manifest.js` é a fonte de verdade semântica para a raiz. O filesystem é a
fonte de verdade física.

---

## 3. API pública

A documentação específica da membrana está em [`public/README.md`](./public/README.md), e o
inventário nominal/custo/autoridade é gerado em
[`public/API_REFERENCE.md`](./public/API_REFERENCE.md).

A API não possui lista manual paralela. Há três projeções deliberadamente distintas:

1. `package.json#imports` — fonte de verdade para resolução de aliases;
2. `governance/public-api-manifest.js` — fonte de verdade semântica para audience, privilege,
   lifecycle, stability, cost tier e exports aprovados;
3. `public/API_REFERENCE.md` — projeção humana determinística do manifest + closure estática atual,
   regenerada por `npm run copilot:infra:public-api-docs` e verificada por
   `copilot:architecture:check`.

Surfaces diagnósticas são nomeadas explicitamente sob `public/diagnostic/**`; por exemplo,
`diagnostic/indexing/storage` existe para benchmark/auditoria da implementação persistente e não é
uma rota runtime alternativa ao owner de indexing.

---

## 4. Capabilities internas

### 4.1 `platform/`

Primitives sem semântica de domínio:

- Buffer/views e UTF-8;
- hash/fingerprints;
- linhas físicas;
- parsing bounded de HTTP/process output;
- env/config helpers;
- `platform/node/compile-cache`;
- `platform/node/filesystem` para durability/fsync primitives.

Deve permanecer na base do grafo e evitar dependência de cache, indexing ou filesystem de alto
nível.

A projeção runtime de `platform/network` é **fail-closed por construção**: ela não exporta resolver
DNS injetável, `allowPrivate`, localhost/private-network bypass nem configuração equivalente. O
resolver injetável existe somente no owner interno para testes white-box da policy connection-bound;
consumidores de produção recebem apenas a façade pública segura.

### 4.2 `concurrency/`

- `bulk/`: execução bounded em lote;
- `queue/`: fila assíncrona de baixo nível;
- `locks/metrics/`: histogramas bounded compartilhados;
- `locks/file/`: coordenação L1 multiprocess por lockfile;
- `locks/local/`: serialização L0 no processo, com escala opcional para `file/`.

Direção central:

```text
metrics ← file
metrics ← local → file
```

O lockfile físico não pode depender do lock lógico local.

### 4.3 `filesystem/read/`

Organizado por responsabilidade:

- `snapshot/`: snapshots crus de bytes/text/stat/directory e consistência;
- `line-index/`: índice byte → linha;
- `chunks/`: leitura por ranges/streaming;
- `cache/`: L1/L2 read-through, hash policy e line-offset cache;
- `fresh/`: façades frescas de dados/metadata.

O barrel `read/index.js` é composition root; não contém implementação.

### 4.4 `filesystem/write/`

- `append/`: append unlocked, detached sink e façade locked;
- `atomic/`: protocolo de staged atomic publish;
- `directory/`: mkdir locked;
- `metadata/`: chmod unlocked/locked;
- `move/`: same-device e EXDEV staged move;
- `payload/`: normalização compartilhada de payload;
- `copy.js` e `remove.js`: primitives coesas de operação única.

### 4.5 `filesystem/transaction/`

Primitives transacionais compartilhadas:

- capacity preflight;
- file-handle lifecycle;
- temp paths;
- snapshots;
- `phases/` para mutation phase events;
- `directory/` para mkdir unlocked;
- `rollback/` para sidecar/policy/storage/inventory/maintenance.

### 4.6 `filesystem/mutation/`

Orquestra mutações com locks, preconditions, rollback evidence, durability e invalidation:

- delete;
- `patch/` single/batch/preview/errors;
- `rollback/` mutation snapshots/preconditions;
- `transfer/` copy/move locked workflows.

### 4.7 `filesystem/patch/`

- `diff/`: geração/apresentação de diff;
- `exact/`: cálculo de patch exato e recovery evidence apenas diagnóstico.

Recovery evidence não autoriza mutação.

### 4.8 `filesystem/invalidation/`

Plano de coerência dividido em:

- `bus/`: dispatch canônico local e queue;
- `cross-process/`: journal/replay multiprocess;
- `watch/`: primitive do OS;
- `external-watch/`: policy/filter/debounce de hints externos;
- `coherence.js`: comandos semânticos de invalidation.

`external-watch` depende de `bus + watch`; as primitives inferiores não dependem do scheduler
externo.

### 4.9 `filesystem/workspace/`

Composition root de I/O workspace-bound:

- canonical path policy;
- opaque validated read/mutable capabilities;
- binders string e validated fast-path;
- operações simples e de pares de paths.

É intencionalmente um composition module relativamente grande; o critério é manter uma única
autoridade de containment/policy.

### 4.10 filesystem configurado e `skills/`

A antiga capability genérica `filesystem/trusted` foi eliminada. Estado externo ao workspace deve
ser vinculado previamente por um owner com `ConfiguredFsGrant`; paths escolhidos pelo operador
passam por `WorkspacePathAuthority`; recursos de sistema operacional que não são arquivos de
workspace exigem primitives de domínio estreitas, sem aceitar paths arbitrários.

`skills` fornece uma capability estreita de catálogo e não recebe authority genérica de filesystem.

### 4.11 `database/`

`infra/database` é o **owner único dos mecanismos SQLite** e da abstração estrutural usada pelo
restante do Copilot. A antiga árvore `src/copilot/db` foi removida integralmente; não existe barrel,
shim ou alias de compatibilidade.

A separação de responsabilidades é deliberada:

- `database/port/contract.js` define o port estrutural driver-agnostic;
- `database/provider/service.js` mantém apenas o binding de capability já composta;
- `database/transaction/{atomic,optional,required}/service.js` concentra a política transacional
  portável;
- `database/sqlite/better-sqlite3/` contém o adapter/runtime concreto default, sempre como
  **resource instance-owned**;
- `database/sqlite/node-sqlite/` contém o adapter experimental opt-in;
- `database/sqlite/application/` contém migration runner e schema/migrations físicos compartilhados
  da aplicação;
- `indexing/registry/sqlite/schema/service.js` é o owner do schema específico do IO Index.

O **path canônico da aplicação, preparação do diretório e lifecycle da instância** pertencem ao
composition root `boot/ApplicationInfraHost`, não ao driver. O host cria a resource concreta, injeta
apenas o port estrutural em `InfraRuntime.database`, revoga o provider durante teardown e então
dispõe a conexão. Disposal é terminal: uma resource fechada não pode ser reaberta por uma referência
antiga.

A direção conceitual é:

```text
boot/ApplicationInfraHost
    → #copilot/infra/public/composition/database/sqlite
        → infra/composition/database/sqlite/service
            → infra/database/sqlite/better-sqlite3  (lazy default driver)
    → InfraRuntime.database                         (injeção do port)

domains/runtime consumers
    → #copilot/infra/public/database/sqlite         (atomic transaction + structural types; sem raw-path)

infra owners
    → infra/internal/database/port
    → infra/internal/database/provider
    → infra/internal/database/transaction/{atomic|optional|required}

diagnostic tooling → #copilot/infra/public/diagnostic/database/sqlite
tests fora de infra → #copilot/infra/public/testing/database/sqlite
```

Regras:

- nenhum domínio runtime abre SQLite por path;
- nenhum domínio de produção importa `better-sqlite3` ou `node:sqlite` diretamente;
- a surface runtime de database não exporta driver, factory de conexão ou raw-path authority;
- a surface de composition aceita `dbPath` deliberadamente como authority `configured-bound`; o
  driver concreto permanece lazy e interno;
- concrete adapters/runtimes públicos existem somente nas audiences `diagnostic` (`diagnostic-only`)
  e `test` (`test-only`), e governance proíbe seu consumo por produção;
- não reintroduzir aggregate/marker barrels `infra/database/index.js` ou
  `infra/database/transaction/index.js`; consumers usam seams semânticos exatos;
- não reintroduzir service locator global (`getCopilotDb`, `configureCopilotSqliteRuntime`,
  equivalentes);
- não criar dependência ascendente
  `infra/database → model-gateway|mcp|tools|conversation-hub|observability`.

### 4.12 `cache/`

- `memory/`: L1;
- `l2/`: config/runtime/health;
- `l2/sqlite/`: store persistente;
- `tiering.js`: composição/métricas de tiers.

Cache é estado derivado. Fingerprints/invalidation protegem freshness; cache nunca substitui
autorização de filesystem.

### 4.13 `code-analysis/`

Análise estrutural pura:

- policy Babel 8 / TS7;
- symbols/imports/exports;
- comments;
- JSON/Markdown outlines;
- outline builder.

A fronteira Babel usa tipos reais de `@babel/parser`/`@babel/types`; contratos JSDoc opacos `any`
são proibidos em infra.

### 4.14 `indexing/parser/`

Camadas unidirecionais:

```text
foundation
   ↓
worker
   ↓
parse
   ↓
cache
   ↓
context

health → foundation + cache + worker
```

- `foundation/`: config/path/contracts/runtime counters;
- `worker/`: worker pool e entry;
- `parse/`: parse orchestration;
- `cache/`: symbol/context caches;
- `context/`: shaping/windowing;
- `health/`: read projection.

### 4.15 `indexing/registry/`

- `state/`: singleton e builds in-flight;
- `refresh/`: domain policy, explicit refresh e debounce scheduler;
- `runtime/`: invalidation hook e façade runtime;
- `sqlite/`: materialização persistente/query;
- `build.js` e `query.js`: composition roots.

Direção essencial: `state → refresh → runtime`, com sqlite como implementação persistente do
registry.

### 4.16 `indexing/search/`

```text
shared      subprocess
   ↑          ↑
   ├── text ──┘
   └── symbol
```

- `shared/`: pagination/output/policy;
- `subprocess/`: exec/stream/ripgrep runtime;
- `text/`: index acceleration + rg/grep completeness path;
- `symbol/`: symbol pattern/query orchestration.

Ausência em estado derivado não é automaticamente prova de ausência no filesystem quando a semântica
exige completude.

### 4.17 `indexing/context/`

- `prefetch/`: cache warming, directory selection, read-through, lightweight session prefetch;
- `scope/`: lifecycle de working-set.

`scope` é dividido em declaration, selection, materialization, index-convergence, state, query e
refresh. Direção `scope → prefetch`, nunca o inverso.

### 4.18 `operations/`

- operation envelope;
- transaction/change-set contracts;
- audit log;
- `rollback/`: token, preflight, apply e executor.

Rollback continua sujeito a autorização, locks, preconditions e durability.

### 4.19 `telemetry/` e `observability/`

`telemetry` é write-side:

- clock;
- latency;
- durability;
- mutation-state;
- diagnostics-channel publisher;
- advisory budget.

`observability` é read-side:

- health aggregate;
- alerts;
- coherence health;
- safe-call boundaries.

Producers não dependem do health aggregator.

### 4.20 `policy/`

Somente contracts realmente transversais: budgets, capabilities/risk, mutation applied-state, output
windows, path-resource e preconditions.

Policy específica deve permanecer com seu owner.

### 4.21 `testing/`

Composition boundary privilegiada para resets. Runtime barrels não devem exportar `*ForTest` apenas
para facilitar testes.

---

## 5. Lifecycle

Importar um módulo não deve iniciar implicitamente:

- worker pool;
- filesystem watcher;
- polling timer;
- DB connection;
- invalidation consumer;
- global scope/session;
- outro recurso long-lived.

Recursos lazy devem possuir owner e teardown/reset claro. Signal ownership pertence ao process
host/composition root.

---

## 6. Invariantes de filesystem

Preservar sempre:

```text
lock
→ final precondition
→ mutation
→ durability barrier
→ invalidation/coherence
→ telemetry/result
```

Além disso:

- writes atômicos preservam sibling-temp/publish semantics;
- move EXDEV usa protocolo staged recuperável;
- rollback snapshots/sidecars são bounded;
- applied-but-unconfirmed não deve provocar reexecução que duplique mutation;
- fingerprints ricos são safety net contra invalidação perdida;
- generic trusted IO não existe; sua reintrodução é bloqueada por invariant negativo de CI;
- leituras/writers low-level fora do owner esperado são inventariados por CI.

---

## 7. Governança automática

Principais gates:

```bash
npm run -s tsc7 -- --checkers 2 -p config/typing/strict/tsconfig.strict.src.copilot.json
npx vitest run tests/unit/copilot/contracts/test_infra_barrel_governance.spec.js
npm run -s check:copilot:fs-read-boundaries:strict
npm run -s check:copilot:fs-mutation-boundaries
npm run -s check:copilot:no-trusted-io
npm run -s lint:copilot
npm run -s test:copilot:unit
```

O contrato de barrels verifica, entre outras coisas:

- zero ciclos por arquivo/capability;
- barrel puro em todo `index.js` de infra;
- API externa somente por `public`;
- internal nunca depende de public;
- todos os diretórios `public/**` possuem barrel;
- nenhum root mega-barrel público;
- package aliases sem wildcard/legado;
- travessias cross-folder respeitam barrel/ownership;
- nenhum `any` opaco em contratos JSDoc de infra;
- identidade `@module` acompanha o owner físico;
- test-control não vaza por entrypoints operacionais.

---

## 8. Critério para novas refatorações

Antes de dividir um arquivo, responder:

1. Há mais de uma responsabilidade que possa ter lifecycle/estado independente?
2. Há um subconjunto de helpers consumido por owners diferentes?
3. O arquivo cria dependências em direções conflitantes?
4. A separação reduz conhecimento entre módulos sem produzir pass-through excessivo?
5. O novo diretório representa uma capability/subcapability real?

Se a resposta for majoritariamente “não”, tamanho sozinho não justifica split.

---

## 9. Referência de execução

Estado atual, decisões, histórico resumido e roadmap restante:

`src/copilot/docs/WORKSPACE_SRC_COPILOT_INFRA_AUDITORIA_ARQUITETURAL_REFACTOR_ROADMAP_2026-08-20.md`
