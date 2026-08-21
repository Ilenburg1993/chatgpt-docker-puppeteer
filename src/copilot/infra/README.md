# `src/copilot/infra`

**Status:** charter arquitetural canônico

**Runtime:** Node.js 24+ / ESM / `@ts-check` / TypeScript 7 strict

**Data-base desta revisão:** 20 de agosto de 2026

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
- todo diretório abaixo de `public/` possui `index.js`;
- não existe `public/index.js` root;
- controles `*ForTest` só são projetados pelo entrypoint deliberado `#copilot/infra/public/testing`.

---

## 2. Estrutura canônica

```text
infra/
├── public/                 # API membrane; projection barrels only
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

A documentação específica da membrana está em [`public/README.md`](./public/README.md).

Principais famílias externas:

```text
#copilot/infra/public/platform
#copilot/infra/public/platform/node
#copilot/infra/public/platform/node/filesystem
#copilot/infra/public/concurrency/bulk
#copilot/infra/public/concurrency/locks
#copilot/infra/public/filesystem/read
#copilot/infra/public/filesystem/write
#copilot/infra/public/filesystem/mutation
#copilot/infra/public/filesystem/invalidation
#copilot/infra/public/filesystem/workspace
#copilot/infra/public/filesystem/trusted
#copilot/infra/public/filesystem/skills
#copilot/infra/public/persistence/json
#copilot/infra/public/persistence/jsonl
#copilot/infra/public/database
#copilot/infra/public/cache
#copilot/infra/public/code-analysis
#copilot/infra/public/indexing
#copilot/infra/public/indexing/context
#copilot/infra/public/indexing/parser
#copilot/infra/public/indexing/registry
#copilot/infra/public/indexing/scanner
#copilot/infra/public/indexing/storage
#copilot/infra/public/indexing/workspace
#copilot/infra/public/operations
#copilot/infra/public/telemetry
#copilot/infra/public/observability
#copilot/infra/public/policy
#copilot/infra/public/testing
```

A lista efetiva é definida por `package.json#imports`. Não duplicar uma nova lista manual em código
de governança.

`indexing/storage` é deliberadamente mais estreito em intenção: existe para benchmark/auditoria da
implementação SQLite do índice. Runtime comum deve preferir `public/indexing` ou
`public/indexing/registry`.

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

### 4.10 `filesystem/trusted/` e `skills/`

`trusted` é uma capability privilegiada para paths explicitamente configurados fora do containment
comum. Seu uso externo é auditado por manifesto/CI.

`skills` fornece uma capability estreita de catálogo; consumers de skills não recebem generic
trusted filesystem.

### 4.11 `database/`

É um **composition port**, não o owner do banco compartilhado. `src/copilot/db` continua responsável
por:

- path do banco;
- abertura/fechamento;
- migration ordering;
- schema do índice.

O boot injeta o provider em infra. A direção conceitual é:

```text
boot → db
boot → infra/database.configure(provider)
infra consumers → infra/database
```

Não criar `infra → db` para conveniência.

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
- trusted IO permanece explicitamente auditado;
- leituras/writers low-level fora do owner esperado são inventariados por CI.

---

## 7. Governança automática

Principais gates:

```bash
npm run -s tsc7 -- --checkers 2 -p config/typing/strict/tsconfig.strict.src.copilot.json
npx vitest run tests/unit/copilot/contracts/test_infra_barrel_governance.spec.js
npm run -s check:copilot:fs-read-boundaries:strict
npm run -s check:copilot:fs-mutation-boundaries
npm run -s check:copilot:trusted-io-boundaries
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
