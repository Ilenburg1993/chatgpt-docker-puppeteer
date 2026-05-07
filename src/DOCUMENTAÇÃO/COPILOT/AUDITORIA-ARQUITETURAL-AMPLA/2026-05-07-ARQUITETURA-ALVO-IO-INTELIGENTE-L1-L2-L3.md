# Arquitetura alvo 2026-05-07 — I/O inteligente L1/L2/L3

Escopo: `src/copilot/**`  
Objetivo: definir o estado ideal completo para leitura, escrita, busca, scan, scope, parsing,
indexação, cache, buffer e observability sem criar fluxos paralelos ao SDK.

## Princípio central

Toda operação de arquivo, URL, workspace virtual, scope, busca ou índice deve atravessar uma das
superfícies canônicas:

1. **SDK-first** para domínio SDK: sessão, workspaces RPC, tool invocation, Session FS provider.
2. **I/O engine-first** para filesystem local: `io-policy` → `io-engine`/`io-scanner` →
   `io-observability`.
3. **Index-first somente como aceleração**: índice nunca é fonte autoritativa quando há dúvida de
   freshness; cai para `rg`/FS e marca degradação.

## Camadas-alvo

```text
LLM-B / operador / terminal / HTTP
  -> file-tools + scope-tools + workspace convergence tools
  -> io-policy + sdk-fs-routing
  -> io-engine / io-scanner / web-tools
  -> cache tiering + parser + index registry
  -> observability + health + live projections
  -> Node 24 FS / SQLite / SDK RPC
```

## I/O local

Estado ideal:

- `io-engine` é a única engine local de read/write/append/patch/copy/move/delete/stat/mkdir/rm.
- Toda mutação destrutiva usa lock, classifica risco, invalida L1/L2/parser/index e publica evento.
- Toda leitura retorna envelope `io` com `traceId`, `engine`, `cache`, `bytes`, `durationMs`,
  `policyVersion`, `advisoryLimits` e `freshness`.
- `readText` suporta três estratégias:
  - `readFile` para pequeno/médio;
  - `FileHandle.readLines` para range/linhas grandes;
  - `FileHandle.readableWebStream` ou stream Node para payload grande/chunked.
- Writes têm modo de durability:
  - `buffered` default;
  - `flush`/`fsync` opcional para arquivos críticos;
  - custo de durability explícito em metrics.

## Policy

Estado ideal:

- `io-policy` cobre path, URL, symlink, denylist, allowlist operacional, output redaction e limites
  advisory.
- Nenhum limite de volume bloqueia a LLM-B por default; limites viram `advisoryLimits`.
- Bloqueios reais ficam restritos a segurança: path traversal, byte nulo, symlink fora do root,
  SSRF, segredos/protected paths e operações destrutivas não autorizadas.
- Toda decisão de policy é observável: `decision`, `reason`, `policyVersion`, `riskClass`.

## Cache tiering

### L1 — processo

Uso:

- hot reads, turn-local, parser cache, repeated context reads.

Contrato:

- `lru-cache@11`;
- TTL, max bytes, stale probe `mtime/size`;
- invalidation hooks;
- metrics: hit/miss/stale/eviction/bytes/hit-ratio;
- visível em `/observability/health`, `/status`, `/live`.

### L2 — SQLite local

Uso:

- restart resilience, hotset persistente por workspace, payload blob e metadados.

Contrato:

- feature-flag inicial, depois habilitação por evidência;
- TTL, prune, max entries/bytes;
- fingerprints `path + mtime + size + hash`;
- tabelas separadas para:
  - cache blob (`copilot_io_cache_l2`);
  - files (`copilot_io_files`);
  - chunks (`copilot_io_file_chunks`);
  - symbols (`copilot_io_symbols`);
  - FTS (`copilot_io_fts`).

### L3 — compartilhado/futuro

Uso:

- multi-runtime, multi-agent, cold-start distribuído.

Contrato:

- não implementar antes de necessidade real;
- pode ser armazenamento local compartilhado, Redis, LanceDB ou outro backend, mas apenas atrás de
  interface `io-cache-tiering`;
- nunca substitui L1/L2 para correctness; apenas acelera.

## Scanner e freshness

Estado ideal:

- scanner 2.0 usa `.gitignore` via `ignore`, denylist central e include/exclude advisory.
- traversal tem concorrência com `p-limit`.
- baseline comparado:
  - `fsPromises.glob` para padrões simples;
  - `opendir/readdir` para traversal controlado;
  - `rg --files` como fallback operacional benchmarkado.
- cada arquivo gera fingerprint:
  - `realpath`;
  - `mtimeMs`;
  - `size`;
  - hash rápido (`xxhash-wasm`) quando necessário.
- freshness do índice:
  - `fresh`;
  - `stale`;
  - `scanning`;
  - `partial`;
  - `error`.

## Watcher

Estado ideal:

- watcher é otimização, não requisito de correctness.
- primeira fase: `fsPromises.watch`/`fs.watch` com debounce, batch e fallback para re-scan.
- eventos alimentam:
  - invalidação L1/L2/parser;
  - reindex incremental;
  - terminal live;
  - health.
- `@parcel/watcher` ou `chokidar` só entram se Node puro falhar por benchmark/portabilidade.

## Indexação textual

Estado ideal:

- FTS5 para busca textual comum quando índice estiver fresco.
- `rg` permanece:
  - fallback quando índice indisponível/stale;
  - engine primária para regex complexa;
  - ferramenta de validação de benchmark.
- `search_in_files` decide engine por policy:
  - `fts-hit`;
  - `rg-fallback`;
  - `grep-fallback`;
  - `index-stale`.
- resposta inclui `engine`, `freshness`, `indexedAt`, `fallbackReason` e `traceId`.

## Parser e índice simbólico

Estado ideal:

- `@babel/parser` para AST JS/TS.
- `@babel/traverse` se e somente se precisarmos de símbolos profundos além de top-level.
- Markdown outline e JSON schema pequeno continuam leves.
- JSON/JSONL grande usa parser streaming se benchmark justificar.
- símbolos persistem em L2:
  - file path;
  - symbol name/kind/exported;
  - line/column;
  - import/export edges;
  - fingerprint.

## Scope LLM-B

Estado ideal:

- LLM-B pode declarar escopo sem bloquear operação por limite artificial.
- `workspace_scope_declare` retorna imediatamente com `ready=false`, `traceId`, `advisoryLimits` e
  job/status.
- `workspace_scope_context` retorna resumo de hot files, símbolos, imports, exports, stale paths e
  próximos comandos.
- Terminal expõe `/scope declare|context|find|refresh|close`.
- Auto-briefing recomenda scope quando o usuário pedir trabalho amplo em diretório/feature.
- HTTP expõe APIs equivalentes para UI externa.

## Web fetch/search

Estado ideal:

- URL policy comum, redirect manual, SSRF em cada hop.
- cache HTTP opcional:
  - L1 in-process;
  - L2 SQLite com TTL/ETag/cache negativo;
  - stale-while-revalidate futuro.
- resultado web usa o mesmo envelope `io`.

## Observability e UX

Estado ideal:

- todo I/O publica `copilot.io.operation`;
- operações compostas usam `diagnostics_channel.tracingChannel` para start/end/error/fase;
- `prom-client` expõe contadores/histogramas:
  - `copilot_io_operation_duration_ms`;
  - `copilot_io_cache_hit_total`;
  - `copilot_io_cache_bytes`;
  - `copilot_io_index_freshness`;
  - `copilot_io_lock_wait_ms`.
- `/live` mostra:
  - tool atual;
  - arquivo/URL tocado;
  - cache tier;
  - index freshness;
  - scope ativo;
  - SSE clients;
  - timeline.

## Node 24+ utilizado no alvo

- `fsPromises.glob` como candidato de scanner/pattern baseline.
- `fsPromises.opendir`/`readdir` para traversal controlado.
- `FileHandle.readLines`, `readableWebStream`, `readv` e `createReadStream` para grandes arquivos.
- `AbortSignal` em leituras e locks onde suportado.
- `worker_threads.locks` apenas como spike experimental para coordenação multi-thread.
- `node:sqlite` como candidato futuro; manter `better-sqlite3` enquanto a base já usa esse driver e
  enquanto o módulo nativo do Node 24 ainda exige avaliação de maturidade/contenção.
- `diagnostics_channel` e `perf_hooks` para baixo overhead de observability.

## Critério de pronto da arquitetura

O sistema estará completo quando uma tarefa ampla da LLM-B puder:

1. declarar escopo;
2. aquecer cache;
3. escanear com `.gitignore`;
4. consultar símbolos/FTS;
5. ler/escrever via engine canônica;
6. invalidar cache/índice automaticamente;
7. mostrar tudo em `/live`;
8. recuperar-se de falha com guidance contextual;
9. provar performance por benchmark e métricas.

## Referências oficiais

- Node.js v24.15.0 File System API: https://nodejs.org/docs/latest-v24.x/api/fs.html
- Node.js v24.15.0 SQLite API: https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
- Node.js v24.15.0 Worker Threads API:
  https://nodejs.org/download/release/latest-v24.x/docs/api/worker_threads.html
- Node.js v24.15.0 Diagnostics Channel API:
  https://nodejs.org/download/release/latest-v24.x/docs/api/diagnostics_channel.html
