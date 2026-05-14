# Roadmap — Faixas, Fases e Subfases

## Faixa 0 — Estabilização crítica

Objetivo: remover riscos que podem vazar escopo, travar execução, inflar memória ou corromper frescor semântico.

Status em 2026-05-14: executada em primeira onda para boundary de tools, validators, search budget, frescor de índice,
locks e regressões principais.

### F0.1 — Boundary de tools

- Validar `workspace_index_build.directory` contra workspace.
- Validar `workspace_scope_declare.directory`.
- Validar `workspace_scope_refresh.modifiedPaths`.
- Trocar imports diretos de `infra` em file tools por barrel público quando o barrel já exportar a API necessária.
- Adicionar testes de paths fora do workspace para index/scope.

### F0.2 — Validators oficiais

- Atualizar `codeTools`:
  - `run_tests.fast/unit` -> `test:copilot:unit`;
  - `integration` -> `test:copilot:integration`;
  - `all` -> `test:copilot`;
  - `typecheck` -> `typecheck:strict:src.copilot`.
- Atualizar `shell/sandbox.js` allowlist para os scripts copilot oficiais.
- Reduzir `safeExec`/`safeGitArgs` de 1 GiB para limite seguro e timeout real.

### F0.3 — Search budget

- Definir timeout real para `rg`/`grep`.
- Reduzir `maxBuffer`.
- Aplicar `maxResults` na engine, mesmo antes de cursor completo.
- Retornar `truncated`/`configuredLimit` no metadata.

### F0.4 — Frescor do índice

- Usar `symbols?.parseError` em `indexTextFile`.
- Evitar dupla leitura: `indexTextFile` deve chamar `parseFileSymbols(filePath, input.content)`.
- Persistir status `failed` quando parser reportar erro.

### F0.5 — Locks básicos

- Normalizar resource keys para locks intra-processo.
- Tornar lockfile atomico com `open('wx')`.
- Verificar ownership no release.

## Faixa 1 — Infra barrel-first e acíclica por compatibilidade

Objetivo: iniciar arquitetura 2.0/2.1 sem quebrar consumidores.

Status em 2026-05-14: facades públicas criadas, tools migradas para `#copilot/infra/public/*`, ciclo principal
`index -> engine -> registry` removido, module-map de infra criado, contrato de boundary adicionado e subdomínios
baixos `shared/`, `policy/`, `scan/`, `parse/`, `storage/`, `queue/`, `locks/`, `runtime/` e `io/fs/` iniciados.

### F1.1 — Facades públicas

- Criar `infra/public/io.js`, `indexing.js`, `session.js`, `health.js`.
- `infra/index.js` reexporta essas facades e mantém janela de compatibilidade para APIs legadas.
- APIs legadas continuam exportadas por uma janela de compatibilidade.

### F1.2 — Quebra inicial do `io-engine.js`

- Extrair leitura para `io/fs/read-*` (iniciado com `io/fs/read-text.js`).
- Extrair escrita/mutação para `io/fs/write-*`, `copy`, `move`, `remove`.
- Extrair diff/patch para `io/patch`.
- Manter `io-engine.js` como facade temporária.

### F1.3 — Parser puro

- Criar `parse/` puro (executado para JSON, Markdown, comentários e outline textual).
- Mover cache/leitura para `session/symbol-cache.js` ou `prefetch/symbol-cache.js`.
- Corrigir JSON array multi-linha, JSONL e Markdown com linha real.

### F1.4 — Index-store

- Separar `index-store/sqlite`.
- Indexador recebe `readText`/parser por injeção ou importa módulo baixo (iniciado com `readTextFileSnapshot`).
- Busca FTS filtra `pathPrefix` no SQL (executado).

### F1.5 — Governança executável

- Criar `infra/module-map.js` com papel, tier e risco de cada entrada raiz.
- Exportar o module-map pelo barrel raiz.
- Adicionar contrato que garante cobertura completa do module-map.
- Adicionar contrato que impede tools de importarem `src/copilot/infra` fora de `#copilot/infra/public/*`.

## Faixa 2 — Output windows e contexto eficiente

Objetivo: liberdade alta com retorno controlado.

### F2.1 — `policy/output-window.js`

- Helpers para `maxBytes`, `maxItems`, `cursor`.
- Uso em search, symbol search, list directory, index search, git diff, shell output.
- Status inicial: `policy/output-window.js` criado com `maxResults`/janela de linhas e aplicado em `io-engine` e
  índice SQLite.
- `list_directory` já aceita `maxEntries` + `cursor` e retorna `nextCursor`.

### F2.2 — `rg --json`

- Trocar stdout bruto por parsing incremental.
- Suportar cursor por arquivo/linha.
- Unificar fallback `grep` com mesma janela de output.

### F2.3 — Context packs

- `scope.context({ budget: 'small'|'medium'|'deep' })`.
- Ranking por path, imports, símbolos exportados e recência.

## Faixa 3 — Operações agentic

Objetivo: transformar primitives em ações rastreáveis.

### F3.1 — Operation envelope

- `operationId`, `traceId`, capability, risk, preconditions, apply, result, evidence.
- Status inicial: `runtime/operation.js` criado e file write tools retornam envelope `operation` em mutações.

### F3.2 — Transactions

- `beginChangeSet`.
- snapshots/diffs antes de write/patch/move/delete.
- rollback token.

### F3.3 — Audit log

- JSONL append-only para mutações.
- Integração com `defaultAuditLog` onde fizer sentido.

## Faixa 4 — Eventos e bordas

Objetivo: endurecer integrações externas.

### F4.1 — Webhooks

- Sanitização profunda.
- HMAC.
- Delivery idempotente.
- Payload max bytes.

### F4.2 — SSE/fanout

- Validar tamanhos de replay buffer.
- Preparar transport plugável.

## Faixa 5 — Remoção de legado

Objetivo: concluir 2.0/2.1.

- `io-engine.js` removido ou facade mínima.
- Imports diretos antigos proibidos em CI.
- `madge`/analisador de ciclos em gate.
- READMEs por domínio atualizados.
- `infra/README.md` vira mapa de arquitetura e regras de importação.

## Gates validadores

Rodar sempre com cache:

```bash
npm run typecheck:strict:src.copilot
npm run test:copilot:unit
npm run lint -- src/copilot
```

Quando a mudança tocar scripts de tools/shell:

```bash
npm run test:copilot:unit -- tests/unit/copilot/tools/**/*.spec.js
```

Quando tocar index/parser/cache/scope:

```bash
npm run test:copilot:unit -- tests/unit/copilot/infra/**/*.spec.js tests/unit/copilot/tools/file/**/*.spec.js
```

## Ordem prática recomendada de PRs

1. PR Safety Tools Boundary: index/scope path validation + tests.
2. PR Validators: code-tools/shell allowlist alinhados aos validadores oficiais.
3. PR Search Budget: timeout/maxBuffer/maxResults.
4. PR Index Correctness: parseError e snapshot parse.
5. PR Locks: resource key canonico + file lock atomico.
6. PR Public Facades: `infra/public/*` e imports barrel-first.
7. PR Parser Pure: remover dependência `parse -> io-engine`.
8. PR Index-store: remover ciclo `index -> engine -> registry`.
9. PR Scanner Budget: batching configurável para diretórios grandes.
10. PR Infra Governance: module-map e contratos de boundary.
11. PR Low-level Subdomains: `shared/`, `policy/`, `scan/`, `io/fs/`.
12. PR Output Window: cursor e truncamento estruturado.
13. PR Runtime Agentic: operation/transaction/rollback.
14. PR Parse Pure: mover parsers auxiliares para `parse/` sem dependências altas.
15. PR Storage Queue Locks: iniciar domínios internos `storage/`, `queue/`, `locks/`.
