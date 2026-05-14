# tools/file/

**Propósito**: expor para a LLM-B as custom tools canônicas de arquivo, busca, índice e scope.
**Status documental**: Canônico ativo.
**Público**: mantenedores das tools SDK-first e das integrações de leitura/escrita da LLM-B.
**Última atualização**: 14 de maio de 2026.

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

## Operação pela LLM-B

A LLM-B deve preferir as tools canônicas quando quiser atualizar ou consultar o índice:

- `workspace_index_status`: verificar se o índice está disponível/fresco.
- `workspace_index_build`: atualizar uma árvore, normalmente `src/copilot`, com `respectGitignore`
  ativo e `pruneMissing` automático.
- `workspace_index_search`: busca textual FTS5.
- `workspace_index_find_symbol`: busca simbólica persistida.

Para operação humana no REPL, a superfície equivalente é `/index status|build|search|symbol|clear`.
Para automação shell, use `npm run copilot:index -- ...`.

## Entradas principais

- `index.js`: barrel e composição final de `fileTools`.
- `read-tools.js`: superfície canônica unificada de leitura (`read_file_content`, `list_directory`,
  `search_in_files`, `diff_files`, `workspace_symbol_search`).
- `read/`: subdomínio interno barrel-first para implementação de tools de leitura grandes. Hoje contém a cadeia
  especializada de `read_file_content`, separando handler, janela/cursor, metadados canônicos e controle de stream.
- `write-tools.js`: facade pública das mutações de arquivo com locks, rollback e atomicidade.
- `write/`: subdomínio interno barrel-first para implementações e helpers grandes de mutação. Hoje contém
  `patch_file`, feedback de patch e helpers transacionais compartilhados.
- `index-tools.js`: ferramentas explícitas do índice L2.
- `scope-tools.js`: ferramentas explícitas de scope LLM-B.

### Nota de arquitetura

Até maio/2026 havia uma divisão histórica entre `read-tools-io.js`, `read-tools-search.js` e
`symbol-search-tool.js`. Essa fragmentação foi removida para evitar múltiplos “planos de leitura”
paralelos. Agora existe **uma única superfície canônica de read tools** em `read-tools.js`, com
metadados de I/O uniformes. Implementações que crescerem para uma cadeia própria podem ser extraídas para subdomínios
internos barrel-first, desde que `read-tools.js` continue sendo a facade pública de composição.

## Links relacionados

- Hub de tools: `../README.md`.
- Infra de I/O: `../../infra/README.md`.
- Roadmap ativo:
  `../../../DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/2026-05-07-ROADMAP-IO-INTELIGENTE-COMPLETO.md`.
