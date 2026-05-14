# Roadmap — Faixas, Fases e Subfases

## Orientação operacional persistida

Esta frente deve prosseguir em ondas contínuas de investigação, transformação, validação, commit/push e nova
investigação, sem tratar commits como ponto final. A prioridade corrente é IO e suas bordas associadas: streams,
buffers, chunks, cache, snapshots, locks, search, patch, cursores, invalidação, backpressure e eficiência para LLM-B em
Node 24+ ESM strict.

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
- Centralizar budgets de search/subprocesso em `policy/budgets.js` e expor `public/policy.js` para tools.

### F0.4 — Frescor do índice

- Usar `symbols?.parseError` em `indexTextFile`.
- Evitar dupla leitura: `indexTextFile` deve chamar `parseFileSymbols(filePath, input.content)`.
- Persistir status `failed` quando parser reportar erro.

### F0.5 — Locks básicos

- Normalizar resource keys para locks intra-processo.
- Centralizar normalização de path/resource em `policy/path-resource.js`.
- Tornar lockfile atomico com `open('wx')`.
- Verificar ownership no release.

### F0.6 — Feedback de falhas para LLM-B

- Criar infra canônica de feedback de falhas em `tools/infra/tool-feedback.js`.
- Enriquecer retornos legados `success:false`/`ok:false` com `toolFeedback` sem quebrar `error`/`reason`.
- Capturar exceções de handlers na `tool-factory` e converter em resposta estruturada.
- Classificar falhas em `invalid-parameters`, `policy-denied`, `not-found`, `conflict`, `timeout`,
  `external-service`, `internal-error` e `unknown`.
- Em erro de parâmetro, retornar schema esperado resumido, parâmetros recebidos truncados e segredos redigidos.
- Em erro de cursor, path, lock, hash, timeout ou serviço externo, orientar a próxima ação da LLM com `fix` e
  `retryable`.
- Evoluir introspection/contract verifier para medir cobertura de schemas e aderência ao feedback canônico.

Status em 2026-05-14: iniciado com `tool-feedback.js`, wrapper na `tool-factory`, export pelo barrel de `tools` e
testes unitários dedicados. Pendência: expandir auditoria de contratos para exigir feedback nas tools registradas e
adicionar fixtures por categoria em file/shell/web/git.

Status complementar:

- `createToolFailureResult` permite que handlers com validação de domínio retornem feedback estruturado antes de chamar
  infra.
- file write tools passaram a enriquecer falhas de path, policy e mutação com `toolFeedback` preservando
  `success:false/error`.
- `patch_file` ganhou códigos estáveis de falha, `fix` específico por caso e detalhes de ocorrência/hash/operação para
  reduzir tentativas cegas da LLM.

## Faixa 1 — Infra barrel-first e acíclica por compatibilidade

Objetivo: iniciar arquitetura 2.0/2.1 sem quebrar consumidores.

Status em 2026-05-14: facades públicas criadas, tools migradas para `#copilot/infra/public/*`, ciclo principal
`index -> engine -> registry` removido, module-map de infra criado, contrato de boundary adicionado e subdomínios
baixos `shared/`, `policy/`, `scan/`, `parse/`, `storage/`, `queue/`, `locks/`, `runtime`, `io/fs/`,
`io/search`, `io/invalidation` e `cache/l1` iniciados.

### F1.1 — Facades públicas

- Criar `infra/public/io.js`, `indexing.js`, `session.js`, `health.js`.
- `infra/index.js` reexporta essas facades e mantém janela de compatibilidade para APIs legadas.
- APIs legadas continuam exportadas por uma janela de compatibilidade.

### F1.2 — Quebra inicial do `io-engine.js`

- Extrair leitura para `io/fs/read-*` (executado para texto, bytes, linhas e chunks de linhas).
- Extrair escrita/mutação para `io/fs/write-*`, `copy`, `move`, `remove` (executado para portas baixas principais).
- Extrair diff/patch para `io/patch` (executado para cálculo textual puro).
- Extrair busca textual/simbólica para `io/search` (executado para índice FTS, grep fallback e padrões simbólicos).
- Extrair invalidação coordenada para `io/invalidation` (executado com bus, eventos e invalidação de tiers L1/L2).
- Manter `io-engine.js` como facade temporária.

### F1.3 — Parser puro

- Criar `parse/` puro (executado para JSON, Markdown, comentários e outline textual).
- Mover cache/leitura para `session/symbol-cache.js` ou `prefetch/symbol-cache.js`.
- Corrigir JSON array multi-linha, JSONL e Markdown com linha real.

### F1.4 — Index-store

- Separar `index-store/sqlite` (iniciado com schema, paths, query e helpers de conteúdo/chunks).
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
- Falhas por janela/cursor devem retornar `toolFeedback.category='invalid-parameters'` ou `conflict`, explicando se a
  LLM deve reutilizar `nextCursor`, reiniciar a consulta, ou reduzir `maxBytes`/`maxItems`.
- `read_file_content` deve expor cursor textual por linha, cursor base64 por byte, `maxLines`, `maxBytes`, metadados e
  estratégia explícita `cached|stream`.
- Status inicial: `policy/output-window.js` criado com `maxResults`/janela de linhas e aplicado em `io-engine` e
  índice SQLite.
- `policy/budgets.js` criado para normalização defensiva de timeout e `maxBuffer` em search e subprocessos.
- `policy/path-resource.js` criado para normalização de resource keys, raiz/candidato de workspace e byte nulo.
- `list_directory` já aceita `maxEntries` + `cursor` e retorna `nextCursor`.
- `search_in_files` e `workspace_symbol_search` aceitam `cursor` e retornam `nextCursor`, `cursorOffset` e
  `totalMatches`.
- `io/search/result-paginator.js` centraliza normalização de `cursor`/`maxResults`, lookahead de comando e paginação
  textual/de itens para search.

Status complementar:

- `read_file_content` ganhou leitura incremental por cursor, metadados ricos, hashes opcionais e `readStrategy`.
- O default `readStrategy='cached'` preserva a policy de formar cache full-file quando a LLM lê arquivo; chamadas
  posteriores com ranges/cursors reutilizam L1/L2 quando o fingerprint continua fresco.
- `readStrategy='stream'` usa leitura incremental por linhas para arquivos grandes, explicitando `cache='stream-bypass'`
  nos metadados.
- O modo stream de `read_file_content` aceita `streamHighWaterMark`, propagado para a porta baixa de leitura para
  controle de throughput/backpressure.
- A implementação de `read_file_content` foi extraída para `tools/file/read/` com barrel interno, separando handler,
  janela/cursor e metadados canônicos, enquanto `read-tools.js` permanece como facade pública única de read tools.
- L1 passou a armazenar `contentHash` e a revalidar por hash quando `mtime` diverge mas `size` segue igual dentro de
  `IO_L1_HASH_REVALIDATE_MAX_BYTES`, evitando invalidação falsa.
- L2 passou a persistir `contentHash` em `metaJson` para hidratar L1 e retornos de leitura sem recalcular hash quando o
  payload já veio cacheado.
- `io/fs/read-chunks.js` passou a usar stream binário + `StringDecoder`, `addAbortSignal`, `highWaterMark` opcional e
  contagem real de bytes lidos, separando bytes lidos de bytes retornados.
- `io/fs/snapshot.js` introduziu snapshot binário streamado para mutações: SHA-256 incremental e snapshot base64 apenas
  quando couber no budget de rollback.
- `infra/shared/buffer.js` centraliza conversões seguras de `Buffer`/`ArrayBuffer`/`TypedArray`/`DataView`, valida
  limites `Buffer.constants.*`, expõe `isUtf8/isAscii` modernos e valida base64/base64url para tools via
  `infra/public/buffer.js`.
- `write_file_content` passou a rejeitar base64 malformado antes de mutar o filesystem, com `toolFeedback` acionável.
- `io/search/subprocess.js` passou a concentrar execução de `rg`/`grep` e cache de disponibilidade de `rg`, removendo
  `child_process` direto da `io-engine` e preparando parsing incremental/telemetria de subprocessos em um único ponto.

### F2.2 — `rg --json`

- Trocar stdout bruto por parsing incremental.
- Suportar cursor por arquivo/linha (iniciado com cursor por linha de saída em `rg`/`grep`; parsing incremental ainda
  pendente).
- Unificar fallback `grep` com mesma janela de output.

### F2.3 — Context packs

- `scope.context({ budget: 'small'|'medium'|'deep' })`.
- Ranking por path, imports, símbolos exportados e recência.

### F2.4 — Cache modular

- Extrair chaves L1 para `cache/l1` (executado).
- Extrair implementação L1/L2/tiering para `cache/l1`, `cache/l2`, `cache/tiering` mantendo facades legadas.

## Faixa 3 — Operações agentic

Objetivo: transformar primitives em ações rastreáveis.

### F3.1 — Operation envelope

- `operationId`, `traceId`, capability, risk, preconditions, apply, result, evidence.
- Falhas do envelope devem propagar `traceId`/`operationId` em `toolFeedback.details` quando disponíveis.
- `policy/capabilities.js` e `policy/risk.js` centralizam capabilities e risco de mutações.
- Status inicial: `runtime/operation.js` criado e file write tools retornam envelope `operation` em mutações.
- `write_file_content` e `patch_file` aceitam `expectedHash` SHA-256 e retornam `previousHash`/`contentHash`.
- `patch_file` aceita `dryRun` e retorna operação com status `dry-run`, sem tocar no disco.
- `patch_file` suporta `occurrence_index`, `replace_all`, `expected_occurrences`, `allowNoop` e `diffPreview`
  paginado/truncado para edição cirúrgica de arquivos com matches repetidos.
- `patch_file` foi extraída para `tools/file/write/patch-file.js`; feedback específico foi isolado em
  `write/patch-feedback.js` e helpers transacionais comuns em `write/mutation-helpers.js`, reduzindo `write-tools.js`
  para facade de composição das mutações restantes.

### F3.2 — Transactions

- `beginChangeSet`.
- snapshots/diffs antes de write/patch/move/delete.
- Precondição otimista por hash iniciada em write/patch; dry-run de patch executado; delete/copy/move retornam hashes
  e bytes de snapshot para auditoria; rollback token e changeset continuam pendentes.
- rollback token.

Status em 2026-05-14 (execução complementar):

- `runtime/transaction.js` criado com lifecycle de change set (`begin`, `append entry`, `apply`, `fail`, `abort`,
  `rollback` lógico).
- `runtime/rollback.js` criado com plano reverso, token serializável (`base64url`) e validação de integridade por
  digest SHA-256.
- `public/runtime.js` e `runtime/index.js` expõem APIs transacionais para uso progressivo pelas tools.
- testes unitários adicionados em `tests/unit/copilot/infra/test_runtime_transaction_rollback.spec.js`.
- `io-engine` agora expõe snapshot de pré-mutação (base64 quando <= 256 KiB) para `delete`, `copy(overwrite)`,
  `move(overwrite)` e `patch`, com metadados de truncamento para rollback determinístico.
- `write-tools` consomem snapshots para rollback enriquecido, incluindo restauração de destino em `copy/move`
  com overwrite quando snapshot está disponível.
- `patch_file` em `dryRun` passa a marcar `changeSet` como `aborted` (sem falso estado de aplicação).

### F3.3 — Audit log

- JSONL append-only para mutações.
- Integração com `defaultAuditLog` onde fizer sentido.
- Status inicial: `runtime/audit-log.js` criado com JSONL opt-in via `COPILOT_IO_MUTATION_AUDIT_LOG_PATH`; file write
  tools registram envelopes concluídos/falhos quando habilitado.

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
6. PR Tool Failure Feedback: `toolFeedback`, classificação e testes por categoria.
7. PR Public Facades: `infra/public/*` e imports barrel-first.
8. PR Parser Pure: remover dependência `parse -> io-engine`.
9. PR Index-store: remover ciclo `index -> engine -> registry`.
10. PR Scanner Budget: batching configurável para diretórios grandes.
11. PR Infra Governance: module-map e contratos de boundary.
12. PR Low-level Subdomains: `shared/`, `policy/`, `scan/`, `io/fs/`.
13. PR Output Window: cursor e truncamento estruturado.
14. PR Runtime Agentic: operation/transaction/rollback.
15. PR Parse Pure: mover parsers auxiliares para `parse/` sem dependências altas.
16. PR Storage Queue Locks: iniciar domínios internos `storage/`, `queue/`, `locks/`.
