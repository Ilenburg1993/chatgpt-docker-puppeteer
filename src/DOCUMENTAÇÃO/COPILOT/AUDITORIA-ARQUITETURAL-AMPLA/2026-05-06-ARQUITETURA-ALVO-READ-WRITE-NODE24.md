# Arquitetura alvo - Read/Write/Search/Scan ultrarrápido em Node 24+

Data: 2026-05-06  
Escopo: `src/copilot/**`  
Estado: proposta arquitetural antes de implementação

## 1. Visão alvo

Criar um subsistema canônico de I/O para `src/copilot` que trate leitura, escrita, busca, diff,
patch, scan, parsing, indexação e fetch externo como variações de um mesmo contrato operacional.

O alvo é que tools, SDK, terminal, presentation, bridges e server routes não implementem política
própria de I/O. Elas devem adaptar entradas e saídas para uma engine comum.

## 2. Princípios

1. Core-first: contratos e políticas moram em `src/copilot/core` e `src/copilot/infra`, não em
   adapters.
2. Segurança por padrão: todo path, URL, payload e output passa por política antes de tocar disco,
   rede ou shell.
3. Performance previsível: cada operação tem limite, timeout, cache, backpressure e SLO.
4. Atomicidade proporcional ao risco: escrita simples é rápida; escrita crítica usa `flush`, `fsync`
   ou durable commit.
5. Observabilidade nativa: cada operação emite metadata, métrica e evento diagnóstico.
6. Fallback explícito: `rg`, SQLite FTS, RAG, shell e Node APIs coexistem com ordem de decisão
   documentada.
7. Rollout progressivo: adapters legados continuam funcionando enquanto são migrados.

## 3. Camadas propostas

### 3.1 `core/io-contracts`

Responsabilidade: definir o idioma comum.

Entidades alvo:

- `IoOperation`: `read`, `write`, `append`, `delete`, `copy`, `move`, `patch`, `diff`, `search`,
  `scan`, `parse`, `index`, `fetch`;
- `IoTarget`: `file`, `directory`, `workspace`, `url`, `sqlite`, `shell`, `git`, `rag`;
- `IoRiskClass`: `low`, `medium`, `high`, `critical`;
- `IoCacheState`: `none`, `l1-hit`, `l1-miss`, `l2-hit`, `l2-miss`, `stale`, `bypass`;
- `IoErrorCode`: `PathDenied`, `UrlDenied`, `PayloadTooLarge`, `Timeout`, `Abort`, `NotFound`,
  `BinaryDenied`, `ParseFailed`, `LockTimeout`, `LockConflict`, `IndexUnavailable`,
  `ExternalToolFailed`, `StorageUnavailable`;
- `IoMeta`: `traceId`, `runtimeId`, `operation`, `target`, `engine`, `bytesRead`, `bytesWritten`,
  `durationMs`, `cache`, `truncated`, `riskClass`, `policyVersion`.

O `core/io-contracts.js` atual deve evoluir, não ser descartado.

### 3.2 `core/io-policy`

Responsabilidade: limites e decisões declarativas.

Políticas alvo:

- limites por operação: bytes, linhas, arquivos, profundidade, matches, duração;
- política de path: containment, symlink, segredos, executáveis, diretórios negados;
- política de URL: SSRF, redirects, esquemas, content-type, max bytes, rate limit;
- política de output: truncamento, sanitização de segredos, UTF-8 seguro;
- política de cache: TTL, max bytes, bypass e invalidação;
- política de risco: quando usar escrita best-effort, atomic rename, `flush`, `fsync` ou transação.

### 3.3 `infra/io-engine`

Responsabilidade: executar I/O local com Node 24+.

Operações:

- `readText()`;
- `readBytes()`;
- `readLines()`;
- `writeAtomic()`;
- `appendBuffered()`;
- `copyFile()`;
- `moveFile()`;
- `deleteFile()`;
- `patchText()`;
- `diffText()`;
- `listDirectory()`;
- `scanWorkspace()`.

Decisões técnicas:

- arquivos pequenos: `fsPromises.readFile`;
- arquivos grandes: `fs.createReadStream` + `stream.pipeline`;
- leitura parcial: `FileHandle.read`, `FileHandle.readLines` ou stream por range;
- escrita padrão: tmp no mesmo diretório + write + rename;
- escrita de maior risco: `writeFile({ flush: true })`, `FileHandle.sync()` ou `datasync()` conforme
  classe;
- streaming com abort: `stream.pipeline(..., { signal })`;
- validação texto/binário: `buffer.isUtf8()` e heurística complementar para byte nulo;
- timeout: `AbortController` ou `AbortSignal.timeout()` quando aplicável.

### 3.4 `infra/io-locks`

Responsabilidade: serializar mutações por recurso.

Modelo alvo:

- lock por `resourceKey`, normalmente path real normalizado;
- modo `shared` para leituras de alto risco quando necessário;
- modo `exclusive` para write/delete/move/patch;
- timeout e abort para lock pendente;
- métrica `lock.waitMs` e `lock.conflicts`.

Estratégia:

- implementar primeiro com fila Map/Promise estável e testável;
- avaliar `worker_threads.locks` apenas como etapa experimental futura, pois em Node 24.15.0 a API
  ainda é experimental;
- não depender de lock experimental para segurança de arquivo neste momento.

### 3.5 `infra/io-cache`

Responsabilidade: cache L1 e invalidação.

L1 alvo:

- LRU por bytes, não apenas por número de entradas;
- TTL por operação;
- key inclui path real, operação, opções relevantes, size, mtimeNs ou mtimeMs, hash parcial quando
  necessário;
- evita guardar payloads acima de limite;
- expõe `getStats()`, `clear()`, `invalidatePath()`, `invalidatePrefix()`.

Decisão de dependência:

- a implementação caseira atual serve para objetos pequenos;
- para L1 por bytes e TTL robusto, promover `lru-cache` a dependência direta deve ser avaliado em
  benchmark;
- não importar `lru-cache` transiente do lockfile.

### 3.6 `infra/io-index`

Responsabilidade: índice persistente L2 e busca textual incremental.

Banco recomendado inicial: `better-sqlite3`, usando o `copilot.sqlite` ou um arquivo isolado
`copilot-io.sqlite` se os benchmarks mostrarem contenção.

Tabelas alvo:

- `copilot_io_files`: path, realpath, ext, language, size, mtime_ms, ctime_ms, inode/dev quando
  disponível, hash_fast, hash_sha256 opcional, indexed_at;
- `copilot_io_file_chunks`: file_id, ordinal, start_line, end_line, start_byte, end_byte, text;
- `copilot_io_fts`: FTS5 sobre path, basename, language e chunk text;
- `copilot_io_cache`: key, value_blob/value_text, metadata, expires_at, file_version;
- `copilot_io_events`: eventos de invalidation opcional para diagnóstico.

Estratégia de índice:

- índice textual incremental para `search_in_files`;
- `rg` permanece fallback e motor para busca ad hoc sem índice;
- FTS5 acelera queries recorrentes, histórico de workspace e busca em subset indexado;
- RAG/LanceDB permanece busca semântica, não substitui FTS.

### 3.7 `infra/io-scanner`

Responsabilidade: varrer workspace de forma segura e incremental.

Regras:

- usar policy comum de denylist/allowlist;
- respeitar `.gitignore`;
- ignorar symlinks por padrão;
- limitar profundidade, arquivos, bytes e concorrência;
- produzir eventos de mudança: created, modified, deleted, renamed;
- separar scan frio de reindex incremental.

Ferramentas candidatas:

- Node 24 `fsPromises.glob` para globbing sem nova dependência;
- `fsPromises.opendir` para walk streaming e menos pressão de memória;
- `watchman` ou `inotify-tools` como ferramenta operacional externa no Dockerfile;
- `fsPromises.watch` para fallback Node;
- `@parcel/watcher` ou `chokidar` somente se os benchmarks e portabilidade justificarem.

### 3.8 `infra/io-parse`

Responsabilidade: parsing seguro por tipo e tamanho.

Estratégias:

- JSON pequeno: `safeJsonParse`;
- JSON grande/JSONL: parser streaming;
- JS/TS symbols: `@babel/parser` quando precisão for necessária;
- busca de símbolos rápida: `rg` enquanto índice AST não existir;
- YAML: `js-yaml` com limite de bytes;
- Markdown: chunking inspirado em `tools/rag/lib/chunking/chunk_md.mjs`;
- HTML: `node-html-parser` ou `turndown` conforme destino.

Dependências candidatas:

- `stream-json` para ingestão JSON grande;
- `fast-json-stringify` apenas para respostas estáveis e muito frequentes;
- `@babel/parser` já existe e deve ser preferido antes de regex AST-like.

### 3.9 `infra/io-observability`

Responsabilidade: métrica e tracing de baixo overhead.

Eventos alvo:

- `copilot.io.start`;
- `copilot.io.end`;
- `copilot.io.error`;
- `copilot.io.cache`;
- `copilot.io.lock`;
- `copilot.io.index`;
- `copilot.io.truncate`.

Tecnologias:

- `perf_hooks.performance.mark()` e `performance.measure()` para spans locais;
- `diagnostics_channel` com canais criados uma vez por módulo;
- `prom-client` para histogramas;
- `pino` para logs estruturados;
- ponte com `emitSdkOperationMetric()` para não criar métrica paralela no SDK.

Métricas mínimas:

- latency p50/p95/p99 por operation/engine;
- bytes read/write por operation;
- cache hit/miss/stale;
- index hit/fallback;
- lock wait/conflict;
- truncation count;
- parse failures;
- denied by policy.

## 4. Fluxo alvo por operação

### 4.1 Leitura de arquivo

1. Adapter chama `ioEngine.readText()`.
2. Policy resolve path, symlink e limites.
3. Cache L1 é consultado por version key.
4. Se miss, engine escolhe `readFile` ou stream por threshold.
5. Texto é validado com `buffer.isUtf8`.
6. Resultado é truncado de forma UTF-8 safe se necessário.
7. Métricas e `io` metadata são anexadas.

### 4.2 Escrita de arquivo

1. Adapter chama `ioEngine.writeAtomic()`.
2. Policy valida path, bloqueios e tamanho.
3. Lock exclusive por path real é adquirido.
4. Conteúdo é codificado em Buffer.
5. Tmp é escrito no mesmo diretório.
6. Classe de risco decide `flush`/`sync`.
7. `rename` conclui a troca atômica.
8. Cache e índice são invalidados.
9. Métricas e `io` metadata são emitidas.

### 4.3 Busca textual

1. Adapter chama `ioSearch.searchText()`.
2. Policy valida pattern, regex, path e limites.
3. Índice FTS é usado se cobertura estiver fresca.
4. `rg` é fallback ou motor preferido para regex complexa.
5. Resultados passam por sanitização comum.
6. Output tem limite por bytes e por matches.
7. Resultado informa `engine: sqlite-fts`, `rg` ou `grep`.

### 4.4 Scan/indexação

1. Scanner recebe escopo.
2. Resolve include/exclude com policy comum.
3. Caminha com concorrência limitada.
4. Para cada arquivo, compara mtime/size/hash rápido.
5. Apenas mudanças geram parse/chunk/index.
6. Indexação pesada pode ir para worker/queue.
7. Estado do índice fica consultável e observável.

### 4.5 Web fetch/search

1. Adapter chama `ioFetch.fetchText()` ou `ioFetch.searchWeb()`.
2. URL policy aplica SSRF, redirects e egress.
3. Rate limit por agente/sessão/processo é avaliado.
4. Cache HTTP opcional usa URL normalizada, ETag e TTL.
5. Conteúdo é streamado com byte limit.
6. Resultado inclui `io` metadata.

## 5. Thresholds iniciais propostos

Estes valores devem ser confirmados por benchmark local antes de congelar:

| Operação                    |          Threshold inicial | Estratégia                       |
| --------------------------- | -------------------------: | -------------------------------- |
| `readText`                  |                 até 256 KB | `fsPromises.readFile`            |
| `readText`                  |              256 KB a 8 MB | stream + concat limitado         |
| `readLines`                 |    qualquer arquivo grande | stream/line iterator             |
| `writeAtomic`               |                   até 2 MB | tmp + write + rename             |
| `writeAtomic` crítico       | qualquer tamanho permitido | tmp + flush/sync + rename        |
| `patchText`                 |                   até 2 MB | read + replace + atomic write    |
| `searchText`                |              índice fresco | SQLite FTS5                      |
| `searchText` regex complexa |                   qualquer | `rg`                             |
| `jsonParse`                 |                   até 1 MB | `JSON.parse` via `safeJsonParse` |
| `jsonParse`                 |              acima de 1 MB | streaming parser se aprovado     |

## 6. Ferramentas e libs recomendadas

### 6.1 Usar imediatamente, já disponíveis

- Node 24 `fs/promises`, `FileHandle`, streams, `AbortSignal`, `buffer.isUtf8`;
- `better-sqlite3`;
- `p-limit`;
- `xxhash-wasm`;
- `ignore`;
- `@babel/parser`;
- `pino`;
- `prom-client`;
- `rg`, `fd`, `watchman`, `inotify-tools`, `hyperfine`, `sqlite3`.

### 6.2 Promover ou adicionar após benchmark

- `lru-cache`: L1 por bytes/TTL, se a implementação caseira ficar insuficiente;
- `stream-json`: JSON grande e JSONL robusto;
- `fast-json-stringify`: respostas repetidas e schemas estáveis;
- `@parcel/watcher` ou `chokidar`: watcher multiplataforma, se Node/watchman não bastarem;
- `tinybench`: benchmark JS micro, se for promovido a devDependency direta.

### 6.3 Não priorizar agora

- `node:sqlite` como substituto imediato de `better-sqlite3`, porque ainda está em active
  development e o projeto já tem pragmas/migrations maduras em `better-sqlite3`;
- worker pool para tudo, porque I/O local é majoritariamente libuv/OS e worker só ajuda em parse,
  hashing pesado, chunking e indexação CPU-bound;
- `worker_threads.locks` como lock principal, por estar experimental.

## 7. Dockerfile alvo

O Dockerfile atual já contém as ferramentas essenciais para a fase de investigação e benchmark. Não
há necessidade de mudança imediata antes dos benchmarks.

Possíveis adições futuras ao Dockerfile:

- nenhuma obrigatória para R1/R2;
- avaliar ferramentas externas apenas se o roadmap comprovar necessidade operacional.

O foco de dependências Node deve ficar em `package.json`, não em instalações globais, quando a lib
for parte do runtime da aplicação.

## 8. SLOs alvo

SLOs iniciais a medir em devcontainer:

- read texto até 256 KB: p95 abaixo de 50 ms em cache miss local;
- read texto cache hit: p95 abaixo de 10 ms;
- write arquivo pequeno: p95 abaixo de 80 ms sem flush forte;
- write crítico com flush: p95 abaixo de 200 ms;
- search indexado: p95 abaixo de 100 ms para workspace aquecido;
- search fallback `rg`: p95 abaixo de 500 ms em `src/copilot`;
- scan incremental sem mudanças: p95 abaixo de 1 s;
- erro interno de I/O: abaixo de 0,5%;
- cache stale observado: 0 em testes de invalidação.

## 9. Critério de pronto da arquitetura

A arquitetura estará pronta quando:

- todas as file-tools passarem pela engine comum;
- Session FS usar a mesma policy/metadata ou um adapter formal equivalente;
- runtime-file-context não bypassar policy de workspace;
- busca textual tiver decisão explícita entre FTS e `rg`;
- cache L1 tiver limite por bytes e invalidação por versão de arquivo;
- índice L2 tiver schema e reindex incremental;
- writes destrutivos tiverem lock por path;
- métricas de I/O forem visíveis;
- testes cobrirem path traversal, symlink, concorrência, truncamento, cache stale e fallback.

## 10. Referências consultadas

- Node.js v24.15.0 File System API: https://nodejs.org/docs/latest-v24.x/api/fs.html
- Node.js v24.15.0 Stream API: https://nodejs.org/docs/latest-v24.x/api/stream.html
- Node.js v24.15.0 Buffer API: https://nodejs.org/docs/latest-v24.x/api/buffer.html
- Node.js v24.15.0 Performance Hooks: https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html
- Node.js v24.15.0 Worker Threads: https://nodejs.org/docs/latest-v24.x/api/worker_threads.html
- Node.js v24.15.0 Diagnostics Channel:
  https://nodejs.org/docs/latest-v24.x/api/diagnostics_channel.html
- Node.js v24.15.0 SQLite: https://nodejs.org/docs/latest-v24.x/api/sqlite.html
