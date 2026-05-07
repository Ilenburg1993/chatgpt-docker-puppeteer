# Roadmap completo 2026-05-07 — I/O inteligente, cache, scope e indexação

Escopo: `src/copilot/**`  
Regra: este roadmap deve ser executado antes de novas expansões paralelas de read/write/search/scan.

## Ordem executiva

## Linha clara de responsabilidades L1/L2/L3

### L1 — memória quente do processo

Função: reduzir latência de leituras repetidas dentro do processo atual.

- Dono: `io-cache.js`.
- Conteúdo: bytes/text/ranges recentes, com TTL, `maxSize`, fingerprint `mtime/size` e invalidação
  ativa.
- Não deve: ser fonte durável, índice pesquisável, FTS, catálogo de símbolos ou histórico entre
  restarts.
- Consumidores: `io-engine`, file-tools, prefetch e scope.

### L2 — persistência local do workspace

Função: sobreviver a restart e materializar dados consultáveis localmente.

- L2 cache blob: `io-cache-l2-sqlite.js`.
  - Conteúdo: payloads de leitura (`bytes/text/json`) com TTL e prune.
  - Uso: reduzir cold reads quando `IO_L2_CACHE_ENABLED=1`.
- L2 índice: `io-index-sqlite.js`.
  - Conteúdo: metadados completos de arquivos, FTS textual, símbolos Babel e edges de imports.
  - Uso: responder busca, disponibilidade de índice, navegação simbólica e freshness sem reler o
    workspace inteiro.
- Regra: cache blob e índice compartilham SQLite por ora, mas têm tabelas e contratos separados. A
  decisão futura de mover para `copilot-io.sqlite` deve ser baseada em soak/contensão.

### L3 — compartilhamento/distribuição

Função: compartilhar cache/índice entre runtimes, containers ou agentes.

- Status atual: reservado, desligado.
- Candidatos futuros: storage remoto, snapshot exportável, servidor de índice, ou artifact cache.
- Não deve ser ativado antes de evidência de múltiplos runtimes ou cold-start caro.

## Sistema de indexação automática

Contrato de disponibilidade:

- O índice existe como L2 local lazy: se `IO_INDEX_ENABLED` não for `0`, o registry prepara a
  estrutura no `copilot.sqlite`.
- `workspace_index_build` constrói/atualiza índice explicitamente para um diretório.
- `workspace_scope_declare` em diretório dispara indexação automática por padrão
  (`indexMode: auto`), junto do prefetch/parser do scope.
- Escritas/invalidações via `io-engine` invalidam o índice por path através dos hooks de
  invalidação.
- `/status`, `/live` e `/observability/health` expõem disponibilidade (`available`), contagem de
  arquivos, símbolos e estado básico.

Metadados persistidos por arquivo:

- `workspace_root`, `relative_path`, `file_name`, `extension`, `content_kind`;
- `size_bytes`, `mtime_ms`, `ctime_ms`, `content_hash`, `line_count`;
- `symbol_count`, `import_count`, `status`, `parse_error`;
- `indexed_at_ms`, `refreshed_at_ms`, `metadata_json` com fingerprint e trace de scan/index.

Superfícies canônicas:

- Infra:
  - `createIoIndexSqlite`;
  - `getIoIndex`, `getIoIndexStats`;
  - `buildIoIndexForDirectory`;
  - `searchIoIndex`, `findIoIndexSymbol`, `invalidateIoIndexPath`.
- Tools:
  - `workspace_index_build`;
  - `workspace_index_status`;
  - `workspace_index_search`;
- `workspace_index_find_symbol`.

## Integração LLM-B — read-through, buffer e base única

Decisão arquitetural consolidada nesta rodada:

- A LLM-B continua enxergando tools SDK-first em `src/copilot/tools/file`.
- As tools não fazem I/O direto: leitura e escrita convergem para `infra/io-engine`.
- `read_file_content` passa a operar em modo read-through:
  - lê via `readText`;
  - usa uma chave L1 de texto completo, mesmo quando a chamada pediu range;
  - respeita o range no retorno para a LLM-B;
  - materializa/atualiza o índice L2 do arquivo lido;
  - pré-aquece imports relativos diretos quando o arquivo é JS/TS e o parser consegue descobri-los.
- O buffer L1 não é fonte de verdade: ele reduz latência e é validado por fingerprint
  `mtime + size`.
- O cache L2 blob guarda payloads; o índice L2 guarda descoberta, FTS, símbolos e imports.
- `search_in_files` usa seletor:
  - FTS5 quando o índice está disponível e a query é texto simples;
  - `rg`/`grep` quando a query é regex, case-sensitive, usa filtros complexos ou quando o índice não
    tem resultado.
- Escritas, deletes, moves e remoções recursivas invalidam L1, L2 blob, índice L2 e scopes pelo
  mesmo hook.

README locais criados/atualizados:

- `src/copilot/infra/README.md`;
- `src/copilot/tools/file/README.md`;
- `src/copilot/README.md` agora registra `infra/` como camada canônica.

## Corte 2026-05-07 — Incrementalidade, chunks e diagnostics

Objetivo do corte: sair do build frio puro e preparar o sistema para workloads grandes e
observáveis.

Implementado:

- `io-scanner` agora inclui fingerprint `realpath + mtimeMs + size` para arquivos.
- `io-scanner` publica eventos `scan.start`, `scan.progress`, `scan.complete` e `scan.error` via
  `diagnostics_channel` em `copilot.io.scan`.
- `io-observability` expõe canais específicos:
  - `copilot.io.cache`;
  - `copilot.io.index`;
  - `copilot.io.scope`;
  - `copilot.io.scan`.
- `io-index-sqlite` agora faz reindex incremental por `mtimeMs + size` quando o registro existente
  está `fresh`.
- `io-index-sqlite` cria e preenche `copilot_io_index_chunks`, com chunks textuais por linhas, hash
  por chunk e metadados de linha.
- `io-engine` expõe `readTextChunks`, API canônica para leitura paginada/streamável em linhas.

Decisão: chunks e incrementalidade pertencem ao L2 índice, não ao L2 blob cache. O cache blob
continua otimizando payloads; o índice materializa consulta, navegação e decomposição.

### A.16 — Fechamento do corte atual

Prioridade: P0  
Objetivo: estabilizar os componentes já criados antes de adicionar complexidade.

Tarefas:

- [x] Rodar `npm run typecheck:strict:src.copilot`.
- [ ] Rodar testes focados de `io-cache`, `io-cache-l2`, `io-engine`, `io-parser`, `io-prefetch`,
      `io-session-scope`, `scope-tools`, web-tools e terminal live. Parcial executado nesta rodada:
      `io-engine`, `io-prefetch`, `io-session-scope`, `scope-tools`, terminal `/scope`, terminal
      `/session`, observability SDK/FS.
- [x] Remover limites bloqueantes restantes de `scope-tools`:
  - `maxFiles.max(10000)`;
  - `concurrency.max(64)`;
  - `modifiedPaths.max(10000)`;
  - `include/exclude.max(64)`.
- [x] Transformar esses limites em `advisoryLimits`.
- [x] Aplicar `include`, `exclude` e `recursive` realmente em `workspace_scope_declare`.
- [x] Corrigir docs/typedefs divergentes em `io-cache` e `io-prefetch`.
- [x] Expor `getIoL2CacheStats` e `aggregateIoCacheTierStats` em health inicial.
- [x] Atualizar `/live` ou `/status` com snapshot de cache/scope básico.

Critério de pronto:

- nenhum limite operacional bloqueia LLM-B por volume;
- typecheck/testes focados passam;
- health mostra L1/L2 pelo menos como `enabled/disabled/stats`.

### A.17 — Scanner canônico 2.0

Prioridade: P0/P1  
Objetivo: criar base confiável para indexação incremental.

Tarefas:

- [x] Integrar `ignore` para `.gitignore` e arquivos ignore adicionais.
- [x] Integrar `p-limit` para controlar concorrência de `lstat`/hash.
- [x] Adicionar fingerprint `realpath + mtimeMs + size`.
- [ ] Adicionar hash `xxhash-wasm` sob opção/threshold.
- [ ] Benchmarkar `readdir/lstat` atual vs `fsPromises.glob` vs `rg --files`.
- [x] Publicar eventos `scan.start`, `scan.progress`, `scan.complete`, `scan.error`.
- [ ] Adicionar testes:
  - `.gitignore`;
  - denylist;
  - [x] symlink;
  - rename/delete;
  - diretório grande sintético.

Critério de pronto:

- scanner entrega entradas + fingerprints + freshness input;
- scan respeita `.gitignore` sem perder denylist central;
- escolha de engine é documentada por benchmark.

### A.18 — Observability de cache, scanner e índice

Prioridade: P1  
Objetivo: tornar performance auditável.

Tarefas:

- [x] Criar canais `diagnostics_channel` para cache/index/scope/scan:
  - `copilot.io.cache`;
  - `copilot.io.index`;
  - `copilot.io.scope`;
  - `copilot.io.scan`.
- [ ] Adotar `tracingChannel` para operações compostas longas.
- [ ] Expor métricas `prom-client` para:
  - duração por operação;
  - hit/miss por tier;
  - lock wait;
  - freshness de índice;
  - scan duration.
- [x] Adicionar `/sdk/observability/io` ou expandir `/observability/health`.
- [x] Mostrar cache/index/scope em `/live`.
- [x] Documentar localmente a superfície `infra/` e `tools/file/` para reduzir drift entre runtime,
      tools e roadmap.

Critério de pronto:

- possível responder "qual tier serviu este read" e "por que busca caiu para rg";
- regressões aparecem em métricas e testes.

### A.19 — L2 soak e separação cache vs índice

Prioridade: P1  
Objetivo: decidir ativação real de L2 por evidência.

Tarefas:

- [ ] Rodar soak com `IO_L2_CACHE_ENABLED=1`.
- [ ] Medir hit-ratio, latência, DB size, prune e contenção.
- [ ] Separar schema:
  - [x] cache blob;
  - [x] files;
  - [x] chunks;
  - [x] symbols;
  - [x] FTS.
- [ ] Definir política de prune/backup para `copilot.sqlite`.
- [ ] Decidir se cache/índice ficam no mesmo `copilot.sqlite` ou em `copilot-io.sqlite`.

Critério de pronto:

- L2 tem decisão objetiva: default off, default on ou on-by-size/workspace;
- índice não fica acoplado ao cache blob.

### A.20 — Índice FTS5 de arquivos

Prioridade: P1/P2  
Objetivo: acelerar busca textual comum sem perder fallback `rg`.

Tarefas:

- [x] Criar tabelas equivalentes `copilot_io_index_files`, `copilot_io_index_symbols`,
      `copilot_io_index_imports`, `copilot_io_index_fts`.
- [x] Implementar build frio de diretório via `buildIoIndexForDirectory`/`workspace_index_build`.
- [x] Implementar reindex incremental por fingerprint `mtime/size` para registros `fresh`.
- [ ] Evoluir incrementalidade para hash rápido opcional sob threshold (`xxhash-wasm`) quando
      `mtime/size` não forem suficientes.
- [ ] Integrar `search_in_files` com engine selector:
  - [x] FTS quando índice fresco/disponível e query simples;
  - [x] `rg`/`grep` quando regex complexa, filtros/case-sensitive, índice vazio ou fallback
        necessário.
  - [ ] Adicionar ranking híbrido com linhas reais e score por recência/símbolos.
- [ ] Expor `fresh/stale/scanning/error`. Parcial atual: stats possuem `freshFiles`, `staleFiles`,
      `failedFiles`, `available` e `freshness`.
- [ ] Benchmark `FTS` vs `rg` com hyperfine e workload real.

Critério de pronto:

- busca comum usa FTS só quando isso é comprovadamente correto e rápido;
- `rg` continua fallback explícito e observável.

### A.21 — Índice simbólico persistente e scope LLM-B

Prioridade: P1  
Objetivo: transformar scope em ferramenta cotidiana da LLM-B.

Tarefas:

- [x] Persistir símbolos Babel em L2.
- [x] Adicionar imports edges. Export metadata fica disponível por símbolo `exported`; falta tabela
      dedicada de export edges se benchmarks justificarem.
- [ ] Avaliar `@babel/traverse` para símbolos profundos.
- [x] Expor `/scope declare|context|find|refresh|close`.
- [x] Expor tools simétricas `workspace_scope_list` e `workspace_scope_close`.
- [x] Invalidar índice simbólico de escopos automaticamente quando `io-engine` escreve/invalida
      path.
- [ ] Expor HTTP equivalente.
- [ ] Integrar scope no auto-briefing:
  - trabalho amplo em diretório recomenda scope;
  - falha de busca recomenda scope/context;
  - edição recomenda refresh.
- [ ] Adicionar aging/TTL e cleanup de scopes.

Critério de pronto:

- LLM-B consegue navegar uma feature inteira sem reler tudo no contexto;
- scope não cria engine paralela e não bloqueia por limites artificiais.

### A.22 — Grandes arquivos, buffer e parsing streaming

Prioridade: P1/P2  
Objetivo: manter o loop responsivo com payloads grandes.

Tarefas:

- [x] Corrigir L1 text cache para usar conteúdo completo como base única e aplicar ranges apenas na
      resposta.
- [x] Corrigir prefetch para aquecer texto mesmo quando bytes já estavam quentes.
- [x] Criar read-through warmup para arquivo lido pela LLM-B e imports relativos diretos.
- [ ] Formalizar thresholds:
  - readFile;
  - FileHandle;
  - stream;
  - chunked line read.
- [x] Implementar API `readTextChunks` canônica em `io-engine`.
- [ ] Benchmark JSON.parse vs `stream-json` para >1MB, >10MB e JSONL.
- [ ] Adicionar parser JSONL incremental.
- [ ] Definir `Buffer` reuse/pooling somente se benchmark justificar.
- [ ] Garantir backpressure em terminal/SSE/HTTP.

Critério de pronto:

- leitura/parsing grande não congela session eternal;
- resposta é paginável/streamável e visível em `/live`.

### A.23 — Watcher strategy

Prioridade: P2  
Objetivo: manter cache/índice fresco com baixo custo.

Tarefas:

- [ ] Implementar watcher Node puro (`fsPromises.watch`/`fs.watch`) com debounce.
- [ ] Batch de eventos para invalidation/reindex.
- [ ] Fallback para re-scan quando watcher falhar.
- [ ] Expor watcher health.
- [ ] Avaliar `@parcel/watcher` e `chokidar` somente se o Node puro falhar.

Critério de pronto:

- edição de arquivo invalida L1/L2/parser/index;
- watcher nunca é requisito de correctness;
- falhas degradam para re-scan, não para estado incorreto.

### A.24 — Web cache e provider search robusto

Prioridade: P2  
Objetivo: alinhar web read/search ao mesmo padrão.

Tarefas:

- [ ] Cache HTTP L1/L2 com TTL.
- [ ] ETag/Last-Modified quando disponível.
- [ ] Cache negativo para falhas temporárias.
- [ ] Provider search robusto ou contrato de fallback para DDG.
- [x] Hardening inicial de redirect SSRF em `web_fetch_local`: redirects manuais e validação de
      `response.url` final.
- [ ] Testes de redirect SSRF, timeout, content-type, cache stale. Parcial atual: redirect SSRF,
      timeout informativo e content-type cobertos em unit tests.

Critério de pronto:

- web tools têm policy/cache/observability equivalentes às file-tools.

## Gates mínimos por corte

Antes de encerrar qualquer corte:

- `npm run typecheck:strict:src.copilot`;
- testes unitários focados no corte;
- `npm run lint` quando houver alteração JS ampla;
- `npm run format:check` quando houver alteração documental ampla;
- benchmark versionado quando a decisão for performance/dependência.

## Backlog de bugs/gaps encontrados na revisão

- `scope-tools` contém limites Zod bloqueantes e precisa virar advisory.
- `scope-tools` recebe `include/exclude/recursive`, mas handler ainda não aplica todos.
- `io-cache` ainda deve expor stats em health/live.
- `io-cache-l2` precisa métrica/health e soak com flag ativa.
- `io-scanner` precisa `.gitignore`, `ignore`, `p-limit`, fingerprints e benchmark de engine.
- `search_in_files` precisa seletor FTS/rg quando FTS existir.
- `workspace_symbol_search` deve eventualmente consumir índice simbólico quando fresco.
- `readText` precisa estratégia formal para grandes arquivos e range reads.
- `create_file` deve evitar mkdir direto fora da engine quando possível.
- `/live` deve agrupar tool/I/O/cache/index por `traceId`.

## Ordem recomendada para a próxima implementação

1. A.16 completo.
2. A.17 scanner 2.0.
3. A.18 health/observability de cache/index.
4. A.19 L2 soak/schema.
5. A.21 scope UX, se a LLM-B precisar navegar trabalhos amplos imediatamente.
6. A.20 FTS, somente depois de scanner/freshness.
7. A.22/A.23 conforme evidência de payload grande ou churn de arquivos.
