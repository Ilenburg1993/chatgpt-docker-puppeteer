# Situação Ideal — IO e Tools

## Tese

A LLM-B deve ter liberdade máxima de trabalho, mas essa liberdade deve ser construída por contratos fortes. Uma LLM
eficaz não precisa de `fs` cru nem de `rg` sem timeout; ela precisa de capacidades amplas, rápidas, paginadas,
observáveis, reversíveis e fáceis de compor.

## Princípios

1. Barrel-first: consumidores importam apenas de barrels públicos.
2. Camadas acíclicas: módulo baixo nunca importa facade alta.
3. Path policy no boundary: toda tool que recebe path valida antes de chamar infra.
4. Saída paginada: toda lista/texto grande retorna `truncated`, `nextCursor`, bytes e contagem.
5. Mutação reversível: write/patch/move/delete geram snapshot ou diff reverso quando possível.
6. Índice derivado: cache/parser/index nunca são fonte de verdade; filesystem + VCS + policy são.
7. Trace por operação: toda ação importante tem `traceId`, duração, engine, risco e evidence.
8. Validators first: tools de qualidade refletem os scripts oficiais do projeto.

## Arquitetura alvo de `src/copilot/infra`

```txt
src/copilot/infra/
  index.js
  README.md
  module-map.js

  public/
    io.js
    cache.js
    indexing.js
    session.js
    events.js
    health.js
    testing.js

  shared/
    env.js
    index.js
    errors.js
    result.js
    time.js

  policy/
    capabilities.js
    budgets.js
    output-window.js
    path-resource.js
    risk.js

  locks/
    async-resource-lock.js
    file-lock.js
    lock-registry.js
    index.js

  queue/
    async-queue.js
    index.js

  storage/
    atomic-file.js
    json-store.js
    index.js

  io/
    fs/
      read-bytes.js
      read-text.js
      read-lines.js
      read-chunks.js
      stat.js
      write-atomic.js
      append.js
      mkdir.js
      remove.js
      copy.js
      move.js
      index.js
    patch/
      text-patch.js
      text-diff.js
      index.js
    search/
      text-search.js
      symbol-search.js
      rg-adapter.js
      grep-adapter.js
      result-paginator.js
      index.js
    invalidation/
      bus.js
      events.js
      index.js

  cache/
    l1/
    l2/
    tiering/
    index.js

  scan/
    scanner.js
    gitignore.js
    glob.js
    fingerprint.js
    batching.js
    index.js

  parse/
    js-ts-parser.js
    json-outline.js
    markdown-outline.js
    comments.js
    index.js

  index-store/
    sqlite/
    indexer.js
    search.js
    freshness.js
    registry.js
    index.js

  prefetch/
    warm-cache.js
    read-through-context.js
    import-resolver.js
    index.js

  session/
    scope-registry.js
    declare-scope.js
    refresh-scope.js
    context-snapshot.js
    symbol-cache.js
    index.js

  runtime/
    operation.js
    transaction.js
    rollback.js
    audit-log.js
    index.js

  events/
    fanout/
    sse/
    webhooks/
    index.js
```

## Regras de dependência

```txt
shared
  -> policy + observability + locks + queue + storage
  -> io/fs + scan + parse
  -> cache + index-store
  -> prefetch + session + io/search
  -> runtime
  -> events + public
```

Proibições:

- `parse/` não importa `io/`, `cache/`, `index-store/` ou `session/`.
- `io/fs/` não importa `index-store/`, `session/`, `runtime` ou `events/`.
- `index-store/` não importa `public/` nem `io/search/`.
- `public/` não contém lógica de negócio.
- arquivos fora de `infra/` não importam módulos internos de `infra`; usam `#copilot/infra` ou `#copilot/infra/*`
  apenas quando o subpath for uma facade pública aprovada.
- `module-map.js` precisa cobrir todas as entradas raiz de `infra/`, classificando papel, tier, risco e exposição
  pública.

## Superfície ideal para LLM-B

### Filesystem

- `fs.read({ path, range, cursor, maxBytes })`
- `fs.readChunks({ path, chunkLines, cursor })`
- `fs.tree({ root, depth, include, exclude, cursor, maxItems })`
- `fs.search({ query, mode, path, maxItems, maxBytes, cursor })`
- `fs.symbols({ query, kind, pathPrefix, cursor })`
- `fs.write({ path, content, expectedHash, snapshot })`
- `fs.patch({ path, hunks, expectedHash, dryRun })`
- `fs.move/copy/delete({ source, destination, dryRun, snapshot })`

### Code

- `code.outline(path)`
- `code.findReferences(symbol)`
- `code.findDefinitions(symbol)`
- `code.dependencyGraph(path|workspace)`
- `code.testImpact(changedFiles)`
- `code.validate({ target: 'copilot', suites: [...] })`

### Execução e qualidade

- `npm.script({ script, timeout, maxOutputBytes })`
- `validator.run({ name: 'typecheck:strict:src.copilot' })`
- `validator.run({ name: 'test:copilot:unit' })`
- `validator.run({ name: 'lint:src', args: ['src/copilot'] })`

### Planejamento/runtime

- `operation.plan`
- `operation.apply`
- `operation.rollback`
- `workspace.index.status/build/search`
- `workspace.scope.declare/context/refresh`

## Política de retorno

Todo retorno potencialmente grande deve aceitar:

```js
{
  maxBytes,
  maxItems,
  cursor,
  timeoutMs,
  signal
}
```

E retornar:

```js
{
  items,
  text,
  bytesReturned,
  truncated,
  nextCursor,
  elapsedMs
}
```

Defaults podem ser generosos para LLM-B, mas não infinitos nos pontos que chamam subprocessos ou acumulam strings em
memória. O default ideal é "alto e paginado", não "sem limite".

## Situação ideal de `tools/`

`tools/` deve continuar como camada de produto, não virar infra paralela. A regra:

- tools validam input e policy;
- tools chamam facades públicas de `infra`;
- tools formatam output para LLM-B;
- tools não conhecem detalhes internos de cache, parser, scanner ou SQLite.

Subdomínios recomendados:

- `file/`: leitura, escrita, search, index, scope.
- `code/`: validadores oficiais e análise de impacto.
- `shell/`: execução sandboxada com scripts allowlisted.
- `git/`: VCS com output window.
- `introspection/`: registry, contratos e capabilities.
- `runtime/` futuro: operação, plano, rollback, evidence.

## End-state

O end-state aceitável é:

- zero ciclos em `src/copilot/infra`;
- barrel raiz e facades públicas documentadas;
- nenhuma tool chamando helper interno de infra;
- index/scope/file tools com path policy uniforme;
- search e diff com orçamento real e cursor;
- mutations com lock canonico e rollback metadata;
- code/shell tools alinhadas aos validadores oficiais;
- testes cobrindo locks, parser, index, budgets, scope invalidation e tool boundaries.
