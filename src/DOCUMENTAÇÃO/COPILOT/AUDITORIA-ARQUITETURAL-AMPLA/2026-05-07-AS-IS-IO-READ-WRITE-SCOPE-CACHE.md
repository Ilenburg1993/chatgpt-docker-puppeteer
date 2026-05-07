# AS-IS 2026-05-07 — I/O, tools, scope, cache e indexação

Escopo: `src/copilot/**`  
Base: revisão do roadmap `2026-05-06-ROADMAP-READ-WRITE-ULTRAFAST.md`, código atual e dependências
presentes no workspace.

## Sumário executivo

O sistema já saiu da fase preliminar. Existe uma fundação real e relativamente madura para leitura,
escrita, busca, scan, policy, locks, observability, cache L1, L2 SQLite experimental, parser e scope
da LLM-B. O risco atual não é ausência de componentes; é a existência de componentes parciais que
precisam ser fechados como fluxo único antes de novas expansões.

O estado atual é bom para operações locais em `src/copilot`, mas ainda não é o sistema ideal
ultrarrápido, inteligente e persistente. Faltam scanner 2.0, índice FTS5 de arquivos, freshness,
health por tier, integração plena de scope na UX/HTTP/auto-briefing, parsing streaming e gates CI
obrigatórios.

## Superfícies já canônicas

| Superfície        | Estado atual         | Evidência local                                                    | Gap principal                                             |
| ----------------- | -------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| Contrato `io`     | Parcial avançado     | `core/io-contracts.js`                                             | snapshots semânticos e cache/index metadata completa      |
| Policy path/url   | Parcial avançado     | `core/io-policy.js`, `tools/file/shared.js`, Session FS, web-tools | redaction global e cache HTTP                             |
| Engine local      | Forte                | `infra/io-engine.js`                                               | `FileHandle`, chunked read, durability/flush              |
| Locks             | Forte intra-processo | `infra/io-locks.js`                                                | stress, diretórios, spike `worker_threads.locks`          |
| Observability I/O | Parcial avançado     | `infra/io-observability.js`, terminal live, metrics bridge         | SLO/prom-client por operação/tier                         |
| File-tools        | Bons adapters        | `read-tools-io.js`, `write-tools.js`, `read-tools-search.js`       | scope-tools com limites bloqueantes                       |
| Session FS SDK    | Parcial avançado     | `sdk/session/session-fs.js`                                        | timeout/abort uniforme e métricas completas               |
| Terminal UX       | Parcial avançado     | `/fs`, `/workspace`, `/activity`, `/live`                          | agrupamento por `traceId/toolCallId` e cache/index health |

## Leitura

Estado real:

- `read_file_content` valida path via policy comum, lê por `io-engine.readText/readBytes`, sanitiza
  texto e retorna envelope `io`.
- `io-engine.readBytes` e `readText` usam L1 e podem ler L2 quando `IO_L2_CACHE_ENABLED=1`.
- `readText` detecta binário com `Buffer.isUtf8` antes de retornar conteúdo textual.
- `runtime-file-context` e Session FS já convergem para `io-engine`/scanner.

Gaps:

- `readText` ainda usa `fs.readFile` como default para arquivo inteiro; o threshold de `FileHandle`,
  `readLines`, `readableWebStream` e chunked read ainda não foi formalizado.
- O cache textual ainda pode ser refinado para chave única de arquivo completo com slicing derivado,
  evitando range keys que armazenam conteúdo completo em mais de uma chave.
- Não há API de leitura paginada/chunked canônica para payloads muito grandes.

## Escrita

Estado real:

- `write_file_content`, `create_file`, `patch_file`, `copy_file`, `move_file` e `delete_file`
  convergem para primitives de `io-engine`.
- Writes usam lock por recurso e invalidação L1/L2.
- `writeFileAtomic` usa arquivo temporário no mesmo diretório e rename.
- Limites de tamanho aparecem como advisory metadata, não como bloqueio no engine.

Gaps:

- `create_file` ainda cria parent dirs com `fs.mkdir` diretamente antes do write; ideal é usar
  `mkdirPathLocked` também nessa borda.
- Falta política explícita de durability: buffered default, `flush`/`fsync` opcional para writes
  críticos, e telemetria de custo.
- Faltam cenários de stress com diretórios, deletes recursivos e multi-operação longa.

## Busca textual e simbólica

Estado real:

- `search_in_files` usa `rg` como engine primária, `grep` como fallback.
- `workspace_symbol_search` usa `rg` com padrões heurísticos.
- `scope-tools` adicionam busca simbólica em escopo via `io-session-scope` e `io-parser`.
- Sanitização textual já passa por `sanitizeIoTextOutput`.

Gaps:

- Não há FTS5 para arquivos do workspace.
- Não há schema persistente `files/chunks/fts/symbols`.
- Não há health `fresh/stale/scanning/error` para índice.
- Busca simbólica global ainda é heurística `rg`; o parser simbólico existe, mas não substitui o
  índice persistente.

## Scanner

Estado real:

- `io-scanner` centraliza listagem/scan e publica envelope `io`.
- Respeita denylist central mesmo com `showHidden=true`.
- Usa `readdir`/`lstat`, ordena entradas e suporta depth/filter simples.

Gaps:

- Não lê `.gitignore`.
- Não usa a dependência `ignore`, já disponível.
- Não limita concorrência com `p-limit`.
- Não usa `fsPromises.glob`/`opendir` como alternativas benchmarkadas.
- Não registra fingerprints `mtime/size/hash` para freshness incremental.
- Não existe watcher strategy.

## Cache L1

Estado real:

- `io-cache.js` usa `lru-cache@11`.
- Configura TTL, max entries, max bytes e stale probe.
- Armazena fingerprint `mtime/size`.
- Invalida por path e propaga hooks para parser.
- `readBytes/readText` publicam `cache=l1-hit/l1-miss`.

Gaps:

- Health de L1 ainda não aparece de forma canônica em `/observability/health`, `/status` e `/live`.
- Falta métrica formal `hit_ratio`, `stale_hits`, `bytes_stored`, `evictions` por runtime/session.
- A relação entre range read e cache full-file deve ser simplificada.

## Cache L2

Estado real:

- `io-cache-l2-sqlite.js` implementa cache SQLite de payload com TTL, max entries, prune,
  invalidation e stats.
- `io-cache-l2-registry.js` ativa L2 por `IO_L2_CACHE_ENABLED=1`.
- `io-engine` faz read-through/write-through opcional.
- Migração `copilot_io_cache_l2` existe.

Gaps:

- L2 não está ligado por default.
- Falta soak test real com workspace grande.
- L2 cache blob não deve ser confundido com índice textual/FTS.
- Falta backup/prune operacional, métrica por tier e endpoint de stats.

## Parser e scope LLM-B

Estado real:

- `io-parser` usa `@babel/parser` para JS/TS, JSON schema simples e Markdown outline.
- Parser tem LRU próprio e hook de invalidação.
- `io-session-scope` declara escopos, faz prefetch, parseia símbolos e permite `findSymbol`.
- `scope-tools` expõem `workspace_scope_declare`, `refresh`, `context` e `find_symbol`.

Gaps:

- `scope-tools` ainda impõem limites Zod bloqueantes (`maxFiles`, `concurrency`, `modifiedPaths`,
  arrays include/exclude). Pela regra do projeto, esses limites devem virar advisory, não bloqueio.
- `include/exclude/recursive` estão no schema mas não são todos aplicados no handler.
- O scope ainda não aparece no auto-briefing nem no terminal como comando dedicado.
- Parser não usa `@babel/traverse` apesar da dependência existir; hoje só percorre top-level.
- JSON/JSONL grande ainda usa parse direto/fatiado; falta streaming.

## Observability

Estado real:

- I/O publica `copilot.io.operation` via `diagnostics_channel`.
- Terminal consome operações reais em `/activity` e `/live`.
- Métricas internas registram duração, bytes e lock wait.
- Convergência SDK↔FS tem trace store em memória e persistência SQLite para eventos.

Gaps:

- `prom-client` está disponível, mas ainda não há métricas formais de I/O/cache/index.
- Falta `diagnostics_channel.tracingChannel` para fases start/end/error de operações compostas.
- Falta endpoint analítico de cache/index/scope.
- Falta correlação completa `toolCallId` ↔ `traceId` ↔ arquivo/URL/cache tier.

## Dependências e Dockerfile

Disponíveis no projeto:

- `lru-cache`, `@babel/parser`, `@babel/traverse`, `ignore`, `p-limit`, `prom-client`,
  `xxhash-wasm`, `better-sqlite3`.

Disponíveis no Dockerfile/sistema:

- Node 24, `rg`, `sqlite3`, toolchain nativa, profiling/diagnóstico.

Decisão AS-IS:

- não há necessidade imediata de adicionar libs antes de fechar os contratos existentes;
- próximas integrações devem consumir primeiro as dependências já presentes;
- `stream-json`, `@parcel/watcher` e `chokidar` continuam candidatos condicionais, não próximos
  passos automáticos.

## Conclusão

O sistema atual está em um ponto bom para endurecimento. A prioridade não é adicionar mais peças, e
sim conectar as peças atuais: scanner com `.gitignore`/fingerprint, L2 com health/soak, parser com
índice persistente, scope com UX e observability, e busca com fallback FTS/rg baseado em freshness.
