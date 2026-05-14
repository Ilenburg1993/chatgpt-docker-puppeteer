# Validadores e Evidências

## Validadores oficiais desta trilha

O escopo informado é `src/copilot`, com Node 24+ ESM e typecheck strict. Os validadores a preservar são:

```bash
npm run typecheck:strict:src.copilot
npm run test:copilot:unit
npm run lint -- src/copilot
```

Todos já usam ou podem usar cache:

- TypeScript strict usa `tsBuildInfoFile` em `/home/node/.cache/typescript/`.
- Vitest Copilot usa `NODE_COMPILE_CACHE`.
- ESLint usa `--cache --cache-location /home/node/.cache/eslint/.eslintcache`.

## Scripts relevantes confirmados

- `test:copilot`
- `test:copilot:unit`
- `test:copilot:integration`
- `test:copilot:regression`
- `typecheck:strict:src.copilot`
- `typecheck:strict:tools.workspace`
- `lint`
- `lint:src`
- `check:copilot:guardrails`
- `copilot:index:build`
- `copilot:index:status`

Scripts mencionados por tools mas ausentes:

- `test:fast`
- `test:all`

## Hotspots de tamanho

`src/copilot/infra`:

- `io-engine.js`: 1855 linhas.
- `io-index-sqlite.js`: 776 linhas.
- `io-parser.js`: 558 linhas.
- `io-prefetch.js`: 510 linhas.
- `io-session-scope.js`: 459 linhas.
- `io-cache.js`: 366 linhas.
- `io-cache-l2-sqlite.js`: 334 linhas.

`src/copilot/tools`:

- `introspection-tools.js`: 655 linhas.
- `web-tools.js`: 573 linhas.
- `read-tools.js`: 510 linhas.
- `shell-tools.js`: 455 linhas.
- `hook-tools.js`: 441 linhas.
- `session-rpc-tools.js`: 381 linhas.
- `hub-tools.js`: 374 linhas.
- `tool-factory.js`: 350 linhas.
- `store.js`: 346 linhas.
- `write-tools.js`: 328 linhas.

## Ciclo confirmado

Estado original da auditoria:

```txt
src/copilot/infra/io-index-registry.js
  -> src/copilot/infra/io-index-sqlite.js
  -> src/copilot/infra/io-engine.js
  -> src/copilot/infra/io-index-registry.js
```

Acoplamento adicional:

```txt
io-parser.js -> io-engine.js
io-index-sqlite.js -> io-parser.js
```

Mesmo quando o ciclo não quebra hoje, ele reduz previsibilidade de ESM, testes e refactors.

Estado após transformações em andamento:

```txt
src/copilot/infra: files 84 cycles 0
```

O ciclo foi removido extraindo leitura textual baixa para `src/copilot/infra/io/fs/read-text.js` e fazendo parser/index
dependerem dessa porta baixa em vez de `io-engine.js`.

## Imports diretos de tools para infra interna

Estado original da auditoria:

Confirmados:

```txt
src/copilot/tools/file/read-tools.js -> ../../infra/io-engine.js
src/copilot/tools/file/read-tools.js -> ../../infra/io-prefetch.js
src/copilot/tools/file/read-tools.js -> ../../infra/io-scanner.js
src/copilot/tools/file/write-tools.js -> ../../infra/io-engine.js
src/copilot/tools/file/scope-tools.js -> #copilot/infra/io-session-scope
src/copilot/tools/web/web-tools.js -> ../../infra/io-observability.js
```

`src/copilot/tools/file/index-tools.js` já usa `../../infra/index.js`, que é melhor, mas ainda depende de um barrel
de infra largo e flat.

Estado após transformações iniciais:

```txt
src/copilot/tools/web/web-tools.js -> #copilot/infra/public/events
src/copilot/tools/file/read-tools.js -> #copilot/infra/public/io
src/copilot/tools/file/write-tools.js -> #copilot/infra/public/io
src/copilot/tools/file/index-tools.js -> #copilot/infra/public/indexing
src/copilot/tools/file/scope-tools.js -> #copilot/infra/public/session
```

Foi adicionado contrato unitário para impedir retorno de imports diretos para internals de infra.

## Testes existentes úteis

Infra:

- `tests/unit/copilot/infra/test_io_engine.spec.js`
- `tests/unit/copilot/infra/test_io_parser.spec.js`
- `tests/unit/copilot/infra/test_io_index_sqlite.spec.js`
- `tests/unit/copilot/infra/test_io_session_scope.spec.js`
- `tests/unit/copilot/infra/test_io_prefetch.spec.js`
- `tests/unit/copilot/infra/test_io_scanner.spec.js`
- `tests/unit/copilot/infra/test_io_cache*.spec.js`

Tools:

- `tests/unit/copilot/tools/file/test_read_tools.spec.js`
- `tests/unit/copilot/tools/file/test_write_tools.spec.js`
- `tests/unit/copilot/tools/file/test_index_tools.spec.js`
- `tests/unit/copilot/tools/file/test_scope_tools.spec.js`
- `tests/unit/copilot/tools/shell/test_shell_tools_expanded.spec.js`
- `tests/unit/copilot/tools/test_git_tools.spec.js`
- `tests/unit/copilot/tools/test_code_permission_tools.spec.js`

## Lacunas de teste prioritárias

- index/scope rejeitando paths fora do workspace: coberto.
- `workspace_scope_refresh.modifiedPaths` fora do workspace: coberto.
- `searchText` respeitando `maxResults`: coberto em engine.
- `searchWorkspaceSymbols` respeitando `maxResults`: coberto em engine.
- `lockfile` concorrente e release com ownership: coberto.
- parser JSON array multi-linha: coberto.
- parser markdown com linha real: coberto.
- index status `failed` quando `parseError` vem no objeto: coberto.
- code-tools usando scripts existentes: coberto.
- git diff/output com maxBuffer seguro: coberto.
- scanner com batch configurável: coberto.
- boundary tools -> infra public facades: coberto.
- module-map de infra completo: coberto.
- facades públicas cache/testing: coberto.
- índice FTS/symbol com `maxResults`: coberto.
- subdomínios baixos `shared/`, `policy/`, `scan/`: cobertos por typecheck, testes focados e module-map.
- `list_directory` com cursor: coberto.
- `storage/` sem dependência de `io-engine`: coberto.
- `parse/` sem dependências altas de IO/cache/session: coberto.
- operation envelope em write tools: coberto.
- `io/fs` expandido para bytes/stat/mkdir/append/remove/copy/move: coberto por testes focados de engine/write/storage e
  typecheck strict.
- `io/patch` com patch/diff textual puro: coberto por `test_io_patch.spec.js`.
- `io/search` com helpers de índice, grep fallback e busca simbólica: coberto por `test_io_search.spec.js`.
- `index-store/sqlite` com schema, paths, query e chunks puros: coberto por `test_index_store_sqlite.spec.js`.
- `expectedHash` SHA-256 em write/patch: coberto por `test_io_engine.spec.js` e contrato de tools.
