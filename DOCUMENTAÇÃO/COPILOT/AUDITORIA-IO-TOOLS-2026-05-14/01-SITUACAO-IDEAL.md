# Situação Ideal — IO e Tools

## Tese

A LLM-B deve ter liberdade máxima de trabalho, mas essa liberdade deve ser construída por contratos
fortes. Uma LLM eficaz não precisa de `fs` cru nem de `rg` sem timeout; ela precisa de capacidades
amplas, rápidas, paginadas, observáveis, reversíveis e fáceis de compor.

## Princípios

1. Barrel-first: consumidores importam apenas de barrels públicos.
2. Camadas acíclicas: módulo baixo nunca importa facade alta.
3. Path policy no boundary: toda tool que recebe path valida antes de chamar infra.
4. Saída paginada: toda lista/texto grande retorna `truncated`, `nextCursor`, bytes e contagem.
5. Mutação reversível: write/patch/move/delete geram snapshot ou diff reverso quando possível.
6. Índice derivado: cache/parser/index nunca são fonte de verdade; filesystem + VCS + policy são.
7. Trace por operação: toda ação importante tem `traceId`, duração, engine, risco e evidence.
8. Validators first: tools de qualidade refletem os scripts oficiais do projeto.
9. Feedback acionável: toda falha de tool retorna informação suficiente para a LLM corrigir
   parâmetros, escopo, policy, cursor, timeout, lock ou dependência externa sem tentativa cega.

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
    outline-builder.js
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
- arquivos fora de `infra/` não importam módulos internos de `infra`; usam `#copilot/infra` ou
  `#copilot/infra/*` apenas quando o subpath for uma facade pública aprovada.
- `module-map.js` precisa cobrir todas as entradas raiz de `infra/`, classificando papel, tier,
  risco e exposição pública.

## Superfície ideal para LLM-B

### Filesystem

- `fs.read({ path, range, cursor, maxBytes, maxLines, readStrategy, streamHighWaterMark, includeMetadata, includeHash })`
- `fs.readChunks({ path, chunkLines, cursor })`
- `fs.tree({ root, depth, include, exclude, cursor, maxItems })`
- `fs.search({ query, mode, path, maxItems, maxBytes, cursor })`
- `fs.symbols({ query, kind, pathPrefix, cursor })`
- `fs.write({ path, content, expectedHash, snapshot })`
- `fs.patch({ path, oldString|hunks, newString, expectedHash, dryRun, occurrenceIndex, replaceAll, expectedOccurrences })`
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

Defaults podem ser generosos para LLM-B, mas não infinitos nos pontos que chamam subprocessos ou
acumulam strings em memória. O default ideal é "alto e paginado", não "sem limite".

## Política de falha e feedback para LLM-B

Toda tool deve preservar compatibilidade com retornos legados (`success:false`, `ok:false`, `error`,
`reason`), mas também acrescentar um bloco canônico `toolFeedback` quando falhar:

```js
{
  success: false,
  error: 'Mensagem humana curta',
  toolFeedback: {
    version: 1,
    toolName,
    category,
    reason,
    retryable,
    fix,
    expectedParameters,
    receivedParameters,
    details
  }
}
```

Categorias mínimas:

- `invalid-parameters`: schema, tipo, enum, range, campo obrigatório, path vazio, cursor malformado.
- `policy-denied`: operação fora do workspace, comando bloqueado, capability ausente, permissão
  negada.
- `not-found`: arquivo, diretório, branch, sessão, cursor ou recurso inexistente.
- `conflict`: hash esperado divergente, lock ocupado, destino existente, estado stale.
- `timeout`: subprocesso, rede, parser, scan ou operação cancelada por `AbortSignal`.
- `external-service`: HTTP, DNS, rate limit, fetch, webhook ou serviço indisponível.
- `internal-error`: exceção interna capturada com código/nome suficientes para investigação.
- `unknown`: fallback temporário que deve ser reduzido progressivamente.

Requisitos do feedback:

- erros de parâmetro devem indicar o schema esperado em forma resumida e os parâmetros recebidos com
  truncamento e redaction de segredos;
- erros de cursor/paginação devem explicar se a LLM deve reiniciar a busca, reaproveitar
  `nextCursor` ou reduzir `maxBytes`/`maxItems`;
- erros de policy/path devem deixar claro se o problema é forma do path, escopo fora do workspace ou
  capability proibida;
- erros de concorrência/lock/hash devem orientar releitura do estado atual antes de nova mutação;
- tools centrais devem enriquecer falhas específicas do domínio com códigos estáveis, `fix` próprio
  e detalhes úteis para a próxima chamada, em vez de depender apenas de classificação textual
  genérica;
- timeouts e falhas externas devem marcar `retryable:true` somente quando repetir fizer sentido;
- nenhuma falha deve despejar conteúdo grande, tokens, secrets ou payloads integrais no feedback.

## Situação ideal de `tools/`

`tools/` deve continuar como camada de produto, não virar infra paralela. A regra:

- tools validam input e policy;
- tools chamam facades públicas de `infra`;
- tools formatam output para LLM-B;
- tools enriquecem falhas com `toolFeedback` canônico via factory/infra de tools;
- tools não conhecem detalhes internos de cache, parser, scanner ou SQLite;
- tools grandes devem separar implementação em subdomínios internos com barrel próprio, preservando
  a superfície pública estável do domínio.

Contrato ideal específico de `read_file_content`:

- modo básico continua sendo `path + encoding`, retornando `content`;
- modo incremental deve aceitar `cursor`, `maxLines` e `maxBytes`;
- cursor textual é linha 1-based; cursor binário/base64 é offset em bytes;
- default textual deve ser `readStrategy='cached'`, formando/reusando cache full-file L1/L2 para
  ranges e páginas subsequentes;
- `readStrategy='stream'` deve existir para arquivos grandes quando a LLM quiser evitar hidratar
  cache full-file;
- quando `readStrategy='stream'`, a LLM pode ajustar `streamHighWaterMark` para balancear
  throughput, memória, latência e backpressure em leituras grandes;
- retornos devem expor `metadata` com stat, bytes, linhas, cache, cursor, truncamento, sanitização e
  hashes opcionais;
- leituras repetidas por range/cursor devem aproveitar cache quando o fingerprint mtime+size
  continuar válido;
- cache L1/L2 deve armazenar `contentHash` junto do payload quando conhecido;
- se `mtime` divergir mas `size` continuar igual, L1 pode revalidar por hash para arquivos dentro de
  budget, preservando a entrada quando o conteúdo real for idêntico;
- metadata deve indicar a estratégia efetiva de fingerprint/cache (`fs-read`, `mtime-size`,
  `mtime-size-hash`, `l2-mtime-size`, `stream-bypass`).
- por ser tool central e complexa, a implementação de `read_file_content` deve viver em subdomínio
  dedicado (`tools/file/read/*`), enquanto `read-tools.js` permanece como facade de composição das
  read tools.

Contrato ideal específico de `patch_file`:

- deve viver em subdomínio dedicado (`tools/file/write/*`), separado de `write-tools.js`;
- deve manter feedback próprio por código estável de erro, com `fix` específico para match ausente,
  match ambíguo, conflito de modo, hash stale, no-op e ocorrência fora do intervalo;
- deve retornar metadados de edição úteis para a LLM-B: ocorrências, ocorrência substituída, linhas
  do match, delta de bytes/linhas, hashes, `dryRun`, `noop`, preview de diff e truncamento;
- deve compartilhar helpers transacionais, rollback, auditoria e path feedback com as demais file
  write tools sem criar acoplamento circular;
- `write-tools.js` deve permanecer como facade pública/composição, não como depósito monolítico de
  toda lógica de mutação.

Contrato ideal de streams e snapshots de IO:

- leituras incrementais devem usar streams com cancelamento real por `AbortSignal`;
- decodificação textual streamada deve respeitar fronteiras multibyte e normalizar `CRLF`/`LF`/`CR`
  sem depender de acumular o arquivo inteiro;
- metadados de stream devem distinguir bytes lidos do filesystem e bytes retornados à LLM;
- snapshots de rollback/hash para mutações devem ser streamados: hash incremental sempre, snapshot
  em memória apenas até budget configurado;
- APIs internas devem aceitar `highWaterMark` onde isso ajudar a controlar throughput/backpressure,
  sem expor detalhes baixos para callers que não precisam.

Contrato ideal de Buffer/bytes:

- qualquer conversão `ArrayBuffer`/`TypedArray`/`DataView` para `Buffer` deve respeitar `byteOffset`
  e `byteLength`;
- payloads destinados a escrita devem virar Buffer próprio, sem compartilhar memória mutável com o
  caller;
- limites `Buffer.constants.MAX_LENGTH` e `Buffer.constants.MAX_STRING_LENGTH` devem ser validados
  em pontos de entrada relevantes;
- validação UTF-8/ASCII deve usar APIs modernas (`buffer.isUtf8`, `buffer.isAscii`) em vez de
  heurísticas textuais;
- base64/base64url recebido de tools deve ser validado explicitamente antes de virar bytes,
  retornando `toolFeedback.category='invalid-parameters'` quando malformado;
- helpers de Buffer devem viver em `infra/shared/buffer.js` e ser expostos para tools apenas por
  facade pública.

Subdomínios recomendados:

- `file/`: leitura, escrita, search, index, scope.
- `code/`: validadores oficiais e análise de impacto.
- `shell/`: execução sandboxada com scripts allowlisted.
- `git/`: VCS com output window.
- `introspection/`: registry, contratos e capabilities.
- `runtime/` futuro: operação, plano, rollback, evidence.

Infra interna recomendada de `tools/`:

- `infra/tool-factory.js`: único ponto de criação de tools de produção.
- `infra/tool-feedback.js`: classificação, redaction, schema summary e envelope de falhas.
- `introspection/tool-contract-verifier.js`: deve evoluir para auditar presença de schemas e
  compatibilidade do feedback.

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
