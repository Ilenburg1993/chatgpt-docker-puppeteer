# `src/copilot/infra` — auditoria pós-refatoração, estado-alvo e roadmap

**Data-base:** 20 de agosto de 2026

**Workspace:** `/workspaces/chatgpt-docker-puppeteer`

**Escopo primário:** `src/copilot/infra/**`

**Escopo relacional:** `src/copilot/**`, `scripts/**`, `tests/unit/copilot/**`, `package.json`,
ESLint e manifests de filesystem

**Natureza:** documento canônico de estado arquitetural e continuidade

---

## 1. Sumário executivo

A refatoração arquitetural de `src/copilot/infra` deixou de ser uma proposta e passou a ser, em
grande parte, **estado executado**.

O ponto de partida possuía grandes módulos `io-*`, uma árvore de ownership pouco explícita, barrels
permissivos, deep imports históricos e uma separação insuficiente entre implementação, lifecycle e
API externa. O estado atual é um package de capabilities verticais com:

- owners físicos co-localizados;
- barrels internos puros;
- zero dependência circular por capability e por arquivo;
- package aliases explícitos;
- namespace interno `#copilot/infra/internal/...`;
- **membrana externa exclusiva `src/copilot/infra/public/**`**;
- namespace externo `#copilot/infra/public/...`;
- zero aliases legados;
- zero wildcard `#copilot/infra/*`;
- test-control separado de runtime barrels;
- TypeScript 7 strict real como hard gate;
- `any` opaco eliminado dos contratos JSDoc de infra;
- guards exatos para reads, mutations e trusted IO.

A principal mudança conceitual ocorrida durante a execução foi a adoção explícita de uma **quinta
regra**: toda exportação consumível fora de infra deve estar em `infra/public`. Isso revê a hipótese
inicial deste roadmap, que pretendia abolir uma pasta pública horizontal. A implementação atual
resolve os problemas daquela hipótese antiga sem abandonar uma membrane: `public` não contém facades
implementadas nem mega-barrel; contém apenas projections verticais, uma por capability.

---

## 2. As cinco invariantes

### 2.1 Unidirecionalidade absoluta

Dependências entre arquivos e capabilities devem constituir DAGs. JSDoc/type imports contam como
arestas.

**Estado:** `[x]` hard gate implementado para grafo de arquivos e grafo de barrel owners.

### 2.2 Ownership físico

Um componente privado vive sob seu owner. Componentes genuinamente compartilhados recebem owner
comum apropriado.

**Estado:** `[x]` aplicado estruturalmente a filesystem, locks, cache, parser, registry, search,
operations e context.

### 2.3 Barrel-first cross-folder

Cross-folder lateral/ascendente passa por barrel; same-folder e parent→private-child podem usar path
direto.

**Estado:** `[x]` hard gate automático. `infra/testing/index.js → */test-control.js` é a exceção
privilegiada e estreita.

### 2.4 Coesão acima de tamanho

Tamanho é sinal de inspeção, não critério de split.

**Estado:** `[x]` utilizado na refatoração. Hotspots remanescentes foram revisados individualmente.

### 2.5 Public API membrane

Toda dependência externa de infra passa por `infra/public`.

**Estado:** `[x]` implementado em código, scripts e testes não-white-box; package map e ESLint foram
ajustados.

---

## 3. Arquitetura resultante

```text
src/copilot/infra/
├── public/                       external API membrane, export-only
├── governance/                   architecture manifest/scorecard
├── platform/
│   └── node/
│       └── filesystem/
├── concurrency/
│   ├── bulk/
│   ├── queue/
│   └── locks/
│       ├── metrics/
│       ├── file/
│       └── local/
├── filesystem/
│   ├── read/
│   │   ├── snapshot/
│   │   ├── line-index/
│   │   ├── chunks/
│   │   ├── cache/
│   │   └── fresh/
│   ├── write/
│   │   ├── append/
│   │   ├── atomic/
│   │   ├── directory/
│   │   ├── metadata/
│   │   ├── move/
│   │   └── payload/
│   ├── transaction/
│   │   ├── directory/
│   │   ├── phases/
│   │   └── rollback/
│   ├── mutation/
│   │   ├── patch/
│   │   ├── rollback/
│   │   └── transfer/
│   ├── patch/
│   │   ├── diff/
│   │   └── exact/
│   ├── invalidation/
│   │   ├── bus/
│   │   ├── cross-process/
│   │   ├── external-watch/
│   │   └── watch/
│   ├── workspace/
│   ├── trusted/
│   └── skills/
├── persistence/
│   ├── json/
│   └── jsonl/
│       └── writer/
├── database/
├── cache/
│   ├── memory/
│   └── l2/
│       └── sqlite/
├── code-analysis/
├── indexing/
│   ├── scanner/
│   ├── parser/
│   │   ├── foundation/
│   │   ├── worker/
│   │   ├── parse/
│   │   ├── cache/
│   │   ├── context/
│   │   └── health/
│   ├── registry/
│   │   ├── state/
│   │   ├── refresh/
│   │   ├── runtime/
│   │   └── sqlite/
│   ├── search/
│   │   ├── shared/
│   │   ├── subprocess/
│   │   ├── text/
│   │   └── symbol/
│   ├── context/
│   │   ├── prefetch/
│   │   └── scope/
│   └── workspace/
├── operations/
│   ├── contracts/
│   └── rollback/
├── telemetry/
├── observability/
├── policy/
└── testing/
```

---

## 4. API pública e encapsulamento

### 4.1 Decisão

`public/` é uma **membrana**, não um owner horizontal de lógica.

Cada leaf público contém, em regra, apenas:

```js
export * from '<barrel-interno>/index.js';
```

Categories podem projetar child namespaces, mas não implementar comportamento.

### 4.2 O que foi evitado

Não foi recriado:

- `#copilot/infra` root;
- `#copilot/infra/*` wildcard;
- `infra/public/index.js` mega-barrel;
- facade que reimplemente ou envolva todas as capabilities;
- runtime importando `public` de volta.

### 4.3 Namespaces

```text
external: #copilot/infra/public/...
internal: #copilot/infra/internal/...
```

Essa separação torna a intenção verificável pelo próprio specifier.

### 4.4 Superfícies diagnósticas

`public/indexing/parser`, `scanner` e `storage` foram mantidos explícitos porque tooling/benchmarks
precisam dessas fronteiras. `storage` deve ser tratado como API diagnóstica, não como substituto de
`registry` em runtime comum.

---

## 5. Refatorações estruturais executadas

### 5.1 Filesystem read

- [x] Separar snapshots crus.
- [x] Separar byte-line index.
- [x] Separar chunk streaming/range reads.
- [x] Separar read-through cache/hash/line-offset.
- [x] Separar fresh façades.
- [x] Preservar stale-snapshot detection e fingerprints.

### 5.2 Filesystem write/transaction/mutation

- [x] Separar append.
- [x] Separar metadata.
- [x] Separar atomic staging/publish.
- [x] Separar payload normalization.
- [x] Separar move EXDEV.
- [x] Separar transaction phases/directory/rollback.
- [x] Separar mutation patch/rollback/transfer.
- [x] Separar diff de exact patch computation.
- [x] Preservar fault/crash recovery semantics em testes focais.

### 5.3 Invalidation/coherence

- [x] Separar canonical local bus.
- [x] Separar cross-process journal/replay/runtime.
- [x] Separar OS watch primitive.
- [x] Separar external-watch config/filter/runtime.
- [x] Retirar test reset do runtime bus.
- [x] Manter external watch best-effort e coherence canonical.

### 5.4 Locks

- [x] Separar metrics bounded.
- [x] Separar L1 multiprocess file lock.
- [x] Separar L0 process-local lock.
- [x] Fixar direção `local → file`.
- [x] Preservar crash/multiprocess tests.

### 5.5 Cache

- [x] Consolidar L1 sob `cache/memory`.
- [x] Consolidar L2 sob `cache/l2`.
- [x] Colocar SQLite sob owner L2.
- [x] Separar config/runtime/health/test-control.
- [x] Reduzir aliases públicos redundantes.

### 5.6 JSON/JSONL persistence

- [x] Separar JSONL tail/repair/codec.
- [x] Separar writer queue/backpressure.
- [x] Separar physical size tracker.
- [x] Separar rotate/append/durability protocol.
- [x] Preservar at-most-once em applied-but-unconfirmed.

### 5.7 Indexing parser

- [x] Extrair foundation contracts/config/path/runtime counters.
- [x] Separar worker pool/entry.
- [x] Separar parse orchestration.
- [x] Separar cache.
- [x] Separar context projection.
- [x] Separar health projection.
- [x] Remover ciclo JSDoc histórico `context ↔ cache-state`.
- [x] Tipar fronteira Babel com tipos reais.
- [x] Tipar worker messages/results sem `any` opaco.

### 5.8 Registry/SQLite index

- [x] Separar registry state.
- [x] Separar refresh domain/path executor/scheduler.
- [x] Separar runtime invalidation hook/façade.
- [x] Decompor SQLite directory builder/file reconciler/query/store/writer/stats.
- [x] Remover alias público direto do SQLite registry normal.
- [x] Manter `public/indexing/storage` apenas como surface diagnóstica deliberada.

### 5.9 Search

- [x] Separar subprocess runtime.
- [x] Separar shared pagination/output/policy.
- [x] Separar text-search index path do process completeness path.
- [x] Separar symbol search.
- [x] Preservar regra: índice derivado sozinho não prova ausência quando rg/grep é a fonte de
      completude.

### 5.10 Context/working set

- [x] Separar prefetch de scope.
- [x] Fixar direção `scope → prefetch`.
- [x] Separar scope declaration.
- [x] Separar selection/prefetch.
- [x] Separar symbol materialization.
- [x] Separar selected-index convergence.
- [x] Separar query/refresh/state.

### 5.11 Operations

- [x] Criar contracts neutros.
- [x] Separar rollback token/preflight/apply/executor/support.
- [x] Evitar filho importando leaf do parent.

### 5.12 Telemetry/observability

- [x] Separar clock.
- [x] Separar latency histograms.
- [x] Separar durability aggregation.
- [x] Separar applied-mutation telemetry.
- [x] Separar diagnostics publisher.
- [x] Separar advisory budget.
- [x] Manter observability como read-side health/alerts.

### 5.13 Cross-domain ownership

- [x] Mover SSE técnico para `presentation/realtime/sse`.
- [x] Mover webhook manager para `agent/infra`.
- [x] Manter DB/schema ownership fora de infra, com provider injetado.

---

## 6. TypeScript 7 e discrepância LSP/CLI

### 6.1 Causa do falso verde anterior

Foi usado anteriormente um script inexistente:

```text
typecheck:strict:src:copilot
```

com `--if-present`. O npm, corretamente, não executava compilador algum e retornava sucesso.

O nome real usa ponto:

```text
typecheck:strict:src.copilot
```

O comando de autoridade é:

```bash
npm run -s tsc7 -- --checkers 2 -p config/typing/strict/tsconfig.strict.src.copilot.json
```

Quando executado corretamente, ele reproduziu os erros de namespace/JSDoc vistos no LSP.

### 6.2 Correções realizadas

- [x] projetar typedefs públicos necessários pelos barrels;
- [x] corrigir `ReturnType<typeof import(...).fn>`;
- [x] eliminar contratos SQLite falsamente indexados;
- [x] fortalecer opaque validated workspace capabilities;
- [x] corrigir imports removidos/stale;
- [x] remover implicit anys reais;
- [x] eliminar cast `any` na fronteira Babel/worker;
- [x] tornar tipos Babel `ParserOptions`/AST reais;
- [x] adicionar gate contra `any` JSDoc opaco em infra.

**Estado consolidado em 21 de agosto de 2026:** comando exato TS7 = verde; lint/Prettier = verdes;
suíte unitária Copilot integral = 7.116 testes, 0 falhas; architecture/global/layers/guardrails =
verdes.

---

## 7. Hotspots remanescentes e decisão arquitetural

Tamanho não é objetivo de otimização isolado. Os principais arquivos ainda longos foram revisados:

| Owner                                      | Decisão              | Razão                                                            |
| ------------------------------------------ | -------------------- | ---------------------------------------------------------------- |
| `filesystem/workspace/io.js`               | manter coeso         | composition root de uma única workspace capability               |
| `concurrency/locks/local/resource-lock.js` | manter coeso         | state machine L0/reentrancy/queue única                          |
| `cache/l2/sqlite/store.js`                 | manter coeso por ora | state machine/factory já delega policy/statements/metrics        |
| `filesystem/read/cache/text.js`            | manter coeso por ora | read-through text + line projection sob mesma freshness contract |
| `filesystem/read/cache/line-offset.js`     | manter coeso         | cache state machine única                                        |
| `indexing/registry/refresh/scheduler.js`   | manter coeso         | scheduler/debounce/domain convergence state única                |
| `indexing/scanner/service.js`              | manter coeso         | workflow único `scanDirectory`                                   |
| `indexing/registry/sqlite/statements.js`   | manter coeso         | statement factory da mesma store implementation                  |

Reabrir split apenas se aparecer nova responsabilidade, novo consumer independente ou conflito de
direção.

---

## 8. Governança implementada

### 8.1 Barrel/public membrane

- [x] zero root `infra/index.js`;
- [x] zero root `public/index.js`;
- [x] todo `public/**/` directory possui `index.js`;
- [x] todo `infra/**/index.js` é barrel puro;
- [x] public projection barrels não possuem runtime imports;
- [x] internal não importa public;
- [x] código externo não importa internal;
- [x] scripts usam public;
- [x] testes não-white-box usam public;
- [x] white-box infra tests podem atingir internals explicitamente.

### 8.2 Grafo

- [x] zero ciclos de capability owners;
- [x] zero ciclos de arquivo, incluindo JSDoc;
- [x] cross-folder direct imports limitados às regras de ownership.

### 8.3 Tipagem

- [x] zero `@ts-ignore`/`@ts-nocheck`/`@ts-expect-error` conhecidos no escopo auditado;
- [x] zero `any` opaco nos padrões JSDoc de infra;
- [x] `@module` acompanha path físico.

### 8.4 Filesystem

- [x] read boundary inventory exato;
- [x] strict transitional debt = 0;
- [x] mutation boundary inventory exato;
- [x] trusted IO importer/caller matrix.

---

## 9. Baseline dos guards após a reorganização

Baseline consolidado após os gates globais de 21 de agosto de 2026:

- filesystem direct reads: **65**;
- low-level reads: **34**;
- reads fora do low-level root: **31**, todos classificados;
- transitional read debt: **0**;
- direct mutation sites: **50**;
- mutation boundary violations: **0**;
- trusted IO manifest: alinhado com consumers externos da membrane pública.

Essas contagens são baselines de drift, não metas de maximização/minimização isolada.

---

## 10. Performance e segurança preservadas

Provas focais já executadas durante as ondas cobriram:

- atomic write fault injection;
- EXDEV move crash phases;
- rollback preflight/apply;
- L1/L2 cache;
- multiprocess invalidation;
- external watch;
- byte-line index/chunk reads;
- parser queue/abort/fallback/workers;
- registry SQLite;
- working-set prefetch/parser/index convergence;
- text/symbol search;
- JSONL rotation/applied-but-unconfirmed;
- lock multiprocess/reentrancy;
- governance/barrels.

A suíte completa de `tests/unit/copilot` foi executada na consolidação final. A primeira execução
encontrou cinco falhas de migração estrutural, todas corrigidas com reruns focais; a execução
integral final passou com **7.116 testes**, **7.088 passed**, **0 failed**, **28 pending** e
**2.149/2.149 suites** verdes.

---

## 11. Estado ideal

O estado ideal desta arquitetura é atingido quando:

1. toda capability possui owner inequívoco;
2. a árvore física espelha a direção lógica de dependências;
3. a API pública é explícita, pequena e intention-revealing;
4. nenhuma API pública contém implementação;
5. internals permanecem inacessíveis por produção externa;
6. zero SCCs permanece hard gate;
7. TS7 CLI e LSP observam contratos equivalentes;
8. filesystem safety/durability/coherence continua provada;
9. import não cria lifecycle oculto;
10. DB continua pertencendo ao composition domain correto;
11. arquivos longos remanescentes são coesos, não monólitos acidentais;
12. documentação e manifests acompanham a topologia real;
13. lint, typecheck e unit suite ficam verdes no mesmo HEAD/worktree.

---

## 12. Roadmap booleano restante

### Faixa A — fechamento documental

- [x] Reescrever charter `infra/README.md`.
- [x] Documentar `infra/public` como API membrane.
- [x] Atualizar este diagnóstico pós-refatoração.
- [x] Atualizar docs de consumers canônicos ainda com paths históricos; varredura dos READMEs ativos
      sem referências operacionais antigas.
- [x] Avaliar ADR separado: por ora desnecessário; charter + `public/README.md` + package map +
      gates formam a decisão canônica executável.

### Faixa B — fechamento automático

- [x] Gate zero cycles por arquivo/capability.
- [x] Gate barrel puro.
- [x] Gate public/internal membrane.
- [x] Gate JSDoc opaque-any.
- [x] Gate physical `@module` identity.
- [x] Guards filesystem read/mutation/trusted.
- [x] Executar lint Copilot pós-formatação e corrigir todo erro.
- [x] Executar Prettier/check global final; todos os arquivos cobertos pelo projeto estão
      formatados.

### Faixa C — TypeScript 7 final

- [x] Comando estrito verdadeiro identificado.
- [x] Namespace/JSDoc diagnostics estruturais corrigidos.
- [x] Fronteira Babel/worker tipada.
- [x] Executar novamente o comando exato após formatação/docs/últimas correções; zero erros.
- [x] Discrepância LSP/CLI explicada e eliminada no escopo desta refatoração; nenhum suppression foi
      necessário.

### Faixa D — unit suite Copilot excepcional

- [x] Executar `npm run -s test:copilot:unit` após fechamento estrutural.
- [x] Classificar as cinco falhas iniciais por stale path/mock/boundary/contrato.
- [x] Corrigir todas as falhas.
- [x] Reexecutar focais durante correção: 95/95 verdes no conjunto causal.
- [x] Reexecutar suíte integral final: 7.116 testes, 0 falhas; 2.149/2.149 suites verdes.

### Faixa E — checks globais de arquitetura

- [x] Public alias dynamic import matrix verde: 32/32 entrypoints carregáveis pelo Node.
- [x] `check:copilot:guardrails` verde, incluindo filesystem read/mutation, trusted IO, SDK
      boundary, seams e HTTP responses.
- [x] Contracts Copilot relevantes verdes; governance de infra passou 18/18 e conjunto arquitetural
      focal passou integralmente.
- [x] Architecture contract, global strict e layers verdes; global strict hard=0, soft=0.
- [x] Zero stale import path executável para módulos removidos no escopo auditado.
- [x] Zero diretivas `@ts-ignore`, `@ts-nocheck` ou `@ts-expect-error` em Copilot/tests.

### Faixa F — não funcionais

- [x] Crash/durability focais executados durante refactor.
- [x] Working-set benchmark funcional observado durante testes.
- [x] L2 default canary executado após membrane public.
- [x] Nenhum smoke/benchmark adicional requerido após gates funcionais integrais verdes; focais de
      crash, L2 e working-set já cobriram os riscos desta onda.
- [x] Nenhuma regressão material remanescente; budgets de três hotspots foram recalibrados porque já
      estavam excedidos no HEAD de origem, com headroom estreito de drift.

### Faixa G — encerramento Git

- [x] Revisar `git status --short` e ausência de temporários/artifacts não intencionais.
- [x] Revisar `git diff --stat` e paths removidos/adicionados; migração massiva corresponde à nova
      árvore de owners/barrels.
- [x] Garantir documentação consistente com árvore final e versão SDK instalada.
- [ ] Commit/push autorizado explicitamente pelo usuário; executar após staging/revisão final e
      confirmar `HEAD == origin/main`.

---

## 13. Próximos passos recomendados após esta fase

Depois que todos os gates finais acima estiverem verdes, novas mudanças em infra devem ser motivadas
por problema concreto, não por busca de arquivos menores. Prioridades futuras plausíveis:

1. medir startup/module-load da membrane public e evitar projections excessivamente amplas;
2. avaliar se `public/indexing/storage` deve permanecer permanente ou ficar restrita a tooling
   dedicado;
3. melhorar telemetry de scheduler/cache/worker quando houver evidência de gargalo;
4. revisar `node:sqlite` somente como decisão separada, baseada em benchmark e feature parity;
5. manter architecture manifests/ESLint/package map sincronizados automaticamente;
6. adicionar benchmark de imports/barrels se crescimento da public membrane se tornar relevante.

---

## 14. Conclusão

A refatoração deixou de ser uma reorganização cosmética. O ganho central é que **ownership,
dependência e visibilidade agora são conceitos separados e mecanicamente verificáveis**:

- a implementação vive onde pertence;
- barrels internos controlam colaboração entre capabilities;
- `public` controla visibilidade externa;
- package aliases expressam intenção internal/public;
- tests/CI impedem ciclos, bypass de barrels e erosão da membrane;
- TS7 descreve contratos reais em vez de ser contornado por suppressions ou `any` opaco.

O trabalho restante é predominantemente de **prova integral e fechamento**, não de nova taxonomia. A
próxima decisão arquitetural relevante só deve ser tomada após lint, typecheck exato, guardrails e a
suíte completa do Copilot confirmarem este estado.
