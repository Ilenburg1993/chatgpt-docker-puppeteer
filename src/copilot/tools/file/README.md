# tools/file/

**Propósito**: expor para a LLM-B as custom tools canônicas de arquivo, busca, índice e scope.  
**Status documental**: Canônico ativo.  
**Público**: mantenedores das tools SDK-first e das integrações de leitura/escrita da LLM-B.  
**Última atualização**: 7 de maio de 2026.

## O que esta pasta contém

- Tools de leitura: `read_file_content`, `list_directory`, `search_in_files`, `diff_files`.
- Tools de escrita: `write_file_content`, `create_file`, `delete_file`, `copy_file`, `move_file`,
  `patch_file`.
- Tools de índice: `workspace_index_build`, `workspace_index_status`, `workspace_index_search`,
  `workspace_index_find_symbol`.
- Tools de scope: `workspace_scope_declare`, `workspace_scope_context`,
  `workspace_scope_find_symbol`, `workspace_scope_refresh`, `workspace_scope_list`,
  `workspace_scope_close`.
- Helpers de validação de path e adaptação para o SDK.

## O que não deve ficar aqui

- I/O direto em baixo nível. Use `infra/io-engine.js`.
- Cache, scanner, parser ou índice persistente. Eles pertencem a `infra/`.
- Projeções de UX do terminal ou HTTP. Elas pertencem a `terminal/` e `presentation/`.
- Reimplementações de capabilities vanilla do SDK. As tools locais ampliam a superfície do SDK, não
  a substituem.

## Bases compartilhadas

Todas as tools desta pasta devem convergir para as mesmas bases:

- Segurança de path: `shared.js` + `core/io-policy`.
- Leitura/escrita: `infra/io-engine.js`.
- Buffer/cache quente: L1 em `infra/io-cache.js`.
- Persistência local: L2 blob em `infra/io-cache-l2-sqlite.js`.
- Busca/símbolos: índice L2 em `infra/io-index-sqlite.js`.
- Scope LLM-B: `infra/io-session-scope.js`, com prefetch e parser canônicos.

## Regras de manutenção

- `read_file_content` deve fazer read-through: ler via `io-engine`, aquecer L1 texto/bytes,
  atualizar índice L2 do arquivo e pré-aquecer imports relativos diretos quando aplicável.
- `search_in_files` pode usar FTS5 quando o índice está disponível e a query é simples; regex,
  filtros complexos ou miss do índice caem para `rg`/`grep`.
- Escritas nunca atualizam cache/índice por fora; elas chamam `io-engine`, que coordena locks e
  invalidação.
- Novas tools devem ser exportadas em `index.js` e cobertas por testes unitários.
- Limites de volume expostos à LLM-B devem permanecer informativos.

## Entradas principais

- `index.js`: barrel e composição final de `fileTools`.
- `read-tools-io.js`: leitura e listagem via infra canônica.
- `read-tools-search.js`: busca textual com seletor índice/rg.
- `write-tools.js`: mutações de arquivo com locks e atomicidade.
- `index-tools.js`: ferramentas explícitas do índice L2.
- `scope-tools.js`: ferramentas explícitas de scope LLM-B.
- `symbol-search-tool.js`: busca simbólica compatível com fluxos existentes.

## Links relacionados

- Hub de tools: `../README.md`.
- Infra de I/O: `../../infra/README.md`.
- Roadmap ativo:
  `../../../DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/2026-05-07-ROADMAP-IO-INTELIGENTE-COMPLETO.md`.
