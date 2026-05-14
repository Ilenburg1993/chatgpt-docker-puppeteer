# Status de Execução Inicial

Data: 2026-05-14

## Transformações executadas

### Boundary de tools

- `workspace_index_build` agora valida `directory` via policy de workspace antes de chamar o indexador.
- `workspace_scope_declare` valida `directory`.
- `workspace_scope_refresh` valida cada item de `modifiedPaths`.
- Foram adicionadas regressões para rejeitar paths fora do workspace.

### Barrel-first inicial de infra

Foram criadas facades públicas:

- `src/copilot/infra/public/io.js`
- `src/copilot/infra/public/indexing.js`
- `src/copilot/infra/public/session.js`
- `src/copilot/infra/public/events.js`
- `src/copilot/infra/public/health.js`

As file/web tools passaram a consumir essas facades em vez de módulos internos como `io-engine.js`,
`io-scanner.js`, `io-prefetch.js`, `io-session-scope.js` e `io-observability.js`.

### Validators e execução

- `codeTools.run_tests` agora aponta para scripts reais:
  - `fast`/`unit` -> `test:copilot:unit`;
  - `integration` -> `test:copilot:integration`;
  - `all` -> `test:copilot`.
- `codeTools.typecheck` agora roda `typecheck:strict:src.copilot`.
- `lint_check` usa cache ESLint.
- `safeExec` de code-tools passou a ter timeout real e `maxBuffer` menor.
- `safeGitArgs` passou a ter timeout real e `maxBuffer` menor.
- `shell` allowlist passou a incluir validadores Copilot oficiais.

### Search e índice

- `searchText` e `searchWorkspaceSymbols` agora têm timeout default e `maxBuffer` menor.
- `maxResults` passou a ser aplicado como janela inicial de saída.
- `io-index-sqlite` deixou de reler o arquivo via parser/cache durante `indexTextFile`; agora parseia o snapshot
  recebido.
- `parseError` retornado pelo parser passa a marcar o arquivo como `failed`.

### Cache, parser e invalidação

- L2 normaliza timestamps para milissegundos inteiros e mantém compatibilidade com entradas fracionárias existentes.
- Parser cache usa path normalizado.
- JSON array multi-linha é suportado em `extractJsonSchema`.
- Markdown preserva linha real dos headings ao virar símbolo.
- Invalidação de cache ganhou evento compatível com `{ recursive }`.
- Session scope invalida filhos quando recebe invalidação recursiva.

### Locks e queue

- `lockfile` usa criação atômica com `open('wx')`.
- `releaseLock` não remove lock de outro processo.
- `withIoResourceLock(s)` normaliza resource keys para reduzir bypass por path relativo/absoluto.
- `AsyncQueue` tem regressões de concorrência inválida e `clear()`.

## Validadores executados

```bash
npm run typecheck:strict:src.copilot
npm run test:copilot:unit
npm run lint -- src/copilot
```

Resultado:

- Typecheck strict: passou.
- Unit Copilot: `2626` testes passaram, `891` suites passaram.
- Lint Copilot: passou.

Também foram executadas rodadas Vitest focadas em:

- infra queue/locks/parser/session/index/cache/engine;
- tools file read/write/index/scope;
- tools web/code/git/shell.

## Ponto ainda pendente

Resolvido na onda seguinte: a análise de ciclos que antes mostrava o ciclo estrutural abaixo agora retorna `cycles 0`.

O ciclo removido era:

```txt
io-index-registry.js -> io-index-sqlite.js -> io-engine.js -> io-index-registry.js
```

Transformações aplicadas:

- `src/copilot/infra/io/fs/read-text.js` foi criado como porta baixa para leitura textual.
- `io-parser.js` deixou de importar `io-engine.js` para leitura de símbolos.
- `io-index-sqlite.js` deixou de importar `io-engine.js` durante indexação e passou a usar snapshot textual baixo.
- `io-index-sqlite.search()` aplica `pathPrefix` no SQL/FTS em vez de filtrar em memória depois.
- `io-scanner.js` ganhou `IO_SCAN_BATCH_SIZE`/`batchSize` para evitar fan-out massivo de promessas.
- `shared/env.js`, `policy/output-window.js` e `scan/*` foram extraídos como subdomínios internos baixos.
- `parse/*` passou a concentrar parsers puros de JSON, Markdown, comentários e outline.
- `storage/*` passou a concentrar JSON store baixo; `storage.js` virou facade sem depender de `io-engine.js`.
- `queue/*`, `locks/*` e `runtime/*` foram iniciados como domínios internos barrel-first.
- `io/fs/*` foi expandido com portas baixas para bytes, stat, mkdir, append, remove, copy e move.
- `io/patch/*` foi criado com patch e diff textual puros.
- `io/search/*` foi criado com helpers puros para índice FTS, grep fallback e busca simbólica.
- `workspace_index_search` e `workspace_index_find_symbol` passaram a aceitar `maxResults`, aplicado no SQLite.
- `list_directory` passou a aceitar `maxEntries` e `cursor`, retornando `nextCursor`.
- Mutações de file tools passaram a retornar envelope `operation` com `operationId`, capability, risco, status, duração e
  evidence.
- `public/cache.js` e `public/testing.js` foram adicionados como facades públicas explícitas.
- Tools de file/web consomem infra via `#copilot/infra/public/*`.
- `src/copilot/infra/module-map.js` foi criado e exportado pelo barrel raiz para governança 2.0/2.1.
- Contratos unitários passaram a impedir deep imports de tools para internals de infra.

Evidência local:

```txt
src/copilot/infra: files 76 cycles 0
tools -> infra internals: 0 ocorrências
```
