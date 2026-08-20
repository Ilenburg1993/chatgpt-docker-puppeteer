# Roadmap - Read/Write/Search/Scan ultrarrápido e canônico

Data base: 2026-05-06 Escopo: `src/copilot/**` Status: investigação concluída; execução autorizada
por continuidade explícita e em convergência incremental

## Objetivo

Migrar as superfícies de leitura, escrita, busca, scan, parsing e indexação de `src/copilot` para
uma arquitetura única, segura, observável e otimizada para Node 24+.

## Organização executiva canônica (leitura obrigatória antes da execução)

Esta seção consolida o estado real e a ordem de ataque atual para evitar execução ad hoc, reduzir
retrabalho e manter convergência arquitetural entre runtime, terminal, SDK e file-tools.

### Estado consolidado por eixo (snapshot 2026-05-07 pós A.13.3)

| Eixo | Status consolidado      | Observação executiva                                                                                         |
| ---- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| R0   | Concluído               | Base de investigação/documentos canônicos estabelecida                                                       |
| R1   | Concluído parcial       | Contrato `io` estabilizado; faltam snapshots semânticos e contrato de cache/index no envelope                |
| R2   | Parcial avançado        | Policy path/url/advisory/sanitização + symlink/denylist central; faltam redirects/cache HTTP e output global |
| R3   | Concluído parcial       | Engine madura; falta formalizar `FileHandle`/chunked read e opções `flush`/durability                        |
| R4   | Concluído parcial       | Locks por recurso funcionam; faltam stress, diretórios recursivos e spike `worker_threads.locks`             |
| R5   | **Concluído técnico**   | `lru-cache@11`, TTL, max bytes, fingerprint mtime/size e invalidação; falta observability/health por tier    |
| R6   | **Iniciado parcial**    | L2 SQLite cache feature-flagged; FTS5 de arquivos, chunks e freshness ainda pendentes                        |
| R7   | Parcial                 | Scanner comum existe com denylist; faltam `.gitignore` via `ignore`, `p-limit`, `fsPromises.glob` e watchers |
| R8   | **Iniciado parcial**    | Parser Babel/JSON/MD existe; faltam streaming JSON/JSONL, TS AST mais profundo e L2 simbólico persistente    |
| R9   | Parcial avançado        | Trace store por `traceId`; faltam prom-client/histogramas formais para I/O/cache/index                       |
| R10  | Parcial                 | Web fetch/search no envelope `io`; falta cache HTTP L1/L2, ETag, cache negativo e provider robusto           |
| R11  | Parcial avançado        | Session FS SDK-first usa provider canônico; faltam abort/timeout uniforme e métricas `io` completas          |
| R12  | Parcial                 | Benchmarks Node/hyperfine existem; faltam JSON grande, FTS real, L2 soak e gates CI obrigatórios             |
| R13  | Concluído parcial       | SDK↔FS bidirecional; falta stream/paginação progressiva, conflict UI e histórico persistente exposto         |
| R14  | Parcial avançado        | Terminal mostra lifecycle, I/O real e `/live`; falta agrupamento por `traceId/toolCallId`                    |
| R15  | **Novo eixo ativo**     | Scope LLM-B e prefetch existem; faltam política sem bloqueio, HTTP/terminal UX e integração no auto-briefing |
| R16  | **Novo eixo ativo**     | Cache tiers L1/L2/L3 planejados; falta control plane e health por tier                                       |
| R17  | **Novo eixo planejado** | Indexação textual/simbólica persistente precisa unificar FTS5, parser, hashes e scanner                      |
| R18  | **Novo eixo planejado** | Grandes arquivos precisam `FileHandle`, streaming, chunking, JSONL e backpressure                            |

### Documentos de governança 2026-05-07

Este roadmap permanece como trilha histórica e backlog vivo. A avaliação atual foi separada em três
documentos menores para reduzir ambiguidade antes da próxima rodada de implementação:

- `2026-05-07-AS-IS-IO-READ-WRITE-SCOPE-CACHE.md` — situação atual real por superfície.
- `2026-05-07-ARQUITETURA-ALVO-IO-INTELIGENTE-L1-L2-L3.md` — target-state completo para I/O, cache,
  indexação, parsing, scope e observability.
- `2026-05-07-ROADMAP-IO-INTELIGENTE-COMPLETO.md` — ordem de execução recomendada, gates e critérios
  de pronto.

Leitura executiva: não iniciar novas transformações amplas sem antes usar esses três documentos como
base de decisão.

### Próxima ordem de execução canônica (A.16 → A.23)

1. **A.16/P0 — limpar e fechar contratos do que já existe**: remover limites bloqueantes de
   `scope-tools`, corrigir docs/typedefs divergentes, expor cache tier stats em health e travar
   typecheck/testes do corte atual.
2. **A.17/P0 — scanner canônico 2.0**: `.gitignore` com `ignore`, concorrência com `p-limit`,
   baseline `fsPromises.glob`, fallback `opendir/readdir`, fingerprints rápidos com `xxhash-wasm`.
3. **A.18/P0/P1 — observability de cache/index**: `diagnostics_channel` por tier, métricas
   `prom-client`, `/observability/health` com L1/L2/parser/scope/index e `/live` com cache/index.
4. **A.19/P1 — L2 soak e schema de índice**: medir `IO_L2_CACHE_ENABLED=1`, separar cache blob de
   índice textual, criar tabelas `files/chunks/symbols/fts`.
5. **A.20/P1 — FTS5 + fallback `rg`**: FTS para busca textual comum quando índice fresco; `rg` segue
   canônico para regex complexa e fallback.
6. **A.21/P1 — scope LLM-B integrado**: declarar/refresh/context/find-symbol via terminal, HTTP e
   auto-briefing, sem criar arquitetura paralela.
7. **A.22/P1/P2 — grandes arquivos e parsing streaming**: `FileHandle.readLines`,
   `readableWebStream`, JSONL/stream JSON, thresholds e backpressure.
8. **A.23/P2 — watcher strategy**: `fsPromises.watch` com debounce/batch e fallback; avaliar
   `@parcel/watcher`/`chokidar` somente se Node puro falhar por evidência.

### Ordem de execução canônica (A9 → A13)

> Histórico preservado para rastreabilidade. A ordem executiva viva a partir de 2026-05-07 é **A.16
> → A.23**, definida acima e detalhada em `2026-05-07-ROADMAP-IO-INTELIGENTE-COMPLETO.md`.

> Regra: cada corte só inicia se os critérios de saída do corte anterior estiverem cumpridos.

#### Corte A.9 — Governança de erro e orientação contextual automática (P0)

Objetivo: fechar o loop de guidance para LLM-B/usuário durante falhas operacionais.

Escopo:

1. Propagar `auto-briefing` para mensagens de erro de `/workspace` e `/fs`.
2. Sugerir próximo comando orientado pelo último evento de `/activity`.
3. Expor severidade estruturada do guidance em payload consumível.

Critério de saída:

- erro operacional sempre retorna orientação acionável;
- guidance de continuidade não depende de memória implícita do operador/modelo.

#### Corte A.10 — R2 de verdade: policy transversal única (P0)

Objetivo: remover definitivamente divergência entre adapters de I/O.

Escopo:

1. Extrair policy compartilhada canônica (`path`, `symlink`, `denylist`, `limites`, `sanitização`).
2. Aplicar policy em file-tools, runtime-file-context, Session FS e convergência SDK↔FS.
3. Definir contrato de URL policy no mesmo namespace conceitual.

Critério de saída:

- nenhuma borda de leitura/escrita/scan/fetch aplica política própria divergente.

#### Corte A.11 — Convergência reversa `fs->sdk` com auditoria (P1)

Objetivo: completar bidirecionalidade controlada entre domínios.

Escopo:

1. Endpoint/control plane para promoção `fs->sdk` com política de conflito explícita.
2. Correlação por `traceId` nas duas direções (`sdk->fs` e `fs->sdk`).
3. Auditoria de overwrite/conflict com motivo e ação tomada.

Critério de saída:

- sincronização bidirecional disponível sem bypass de policy e sem engine paralela.

#### Corte A.12 — Observabilidade unificada e endpoint analítico (P1)

Objetivo: tornar convergência e I/O auditáveis por operação, fase e latência.

Escopo:

1. Endpoint dedicado `/observability/convergence` (agregação por `traceId`).
2. Métricas por fase/item com contadores/histogramas (`prom-client`).
3. Projeções de saúde com severidade operacional e degradação explícita.

Critério de saída:

- possível responder, com evidência, "onde falhou", "quanto custou" e "qual fase degradou".

#### Corte A.13 — Performance e indexação orientadas por evidência (P1/P2)

Objetivo: ativar R5/R6/R7/R12 sem suposição.

Escopo:

1. Benchmarks formais (`readFile` vs stream, L1 strategy, scan frio/quente, rg vs FTS).
2. Critérios de adoção para L1 e L2 com rollback definido.
3. Planejamento de paginação/stream em mirror para workspaces grandes.

Critério de saída:

- decisões de arquitetura de performance passam a ser justificadas por números versionáveis.

### Backlog consolidado único (ativo)

Este backlog substitui o uso de múltiplos backlogs dispersos por corte para planejamento corrente.

1. **A.9/P0** — Guidance de erro acionável em `/workspace` e `/fs` + próximo comando recomendado.
2. **A.10/P0** — Policy única de I/O (R2) aplicada em todas as bordas.
3. **A.11/P1** — Fluxo reverso `fs->sdk` com conflito auditável e correlação `traceId`.
4. **A.12/P1** — Endpoint analítico `/observability/convergence` + métricas com histogramas.
5. **A.13/P1/P2** — Benchmarks e thresholds para liberar L1/L2/watcher sem "escuro".
6. **A.14/P0/P1** — Visibilidade live plena no terminal: tool, I/O real, arquivos lidos/editados,
   SSE e `/activity`.

### Regras de execução para evitar "no escuro"

1. Nenhuma nova dependência entra sem benchmark e critério de rollback.
2. Nenhuma borda nova de I/O nasce fora de `io-engine` + adapters canônicos.
3. Todo corte novo deve declarar entrada, saída e impacto em R2/R9/R13.
4. Toda mudança de UX operacional precisa reduzir ambiguidade para LLM-B e operador humano.
5. Backlogs por corte antigos permanecem como histórico; o planejamento vivo é o backlog consolidado
   acima.

## R0 - Investigação e planejamento

Status: concluído neste corte documental.

- [x] Ler integralmente `.devcontainer/Dockerfile`.
- [x] Inventariar tools de arquivo, web, shell, git, session, todo, hub e presentation.
- [x] Avaliar `src/copilot/core/io-contracts.js` existente.
- [x] Avaliar caches atuais em `core/cache`, `runtime-file-context` e RAG.
- [x] Avaliar SQLite/FTS5 do Conversation Hub.
- [x] Avaliar RAG scan/fingerprint/indexação.
- [x] Consultar documentação oficial Node 24.15.0 para FS, streams, buffer, perf hooks, diagnostics,
      worker threads e sqlite.
- [x] Atualizar os três documentos canônicos deste corte:
  - AS-IS;
  - arquitetura alvo;
  - roadmap.

Entregáveis:

- `2026-05-06-AUDITORIA-READ-WRITE-AS-IS-SRC-COPILOT.md`;
- `2026-05-06-ARQUITETURA-ALVO-READ-WRITE-NODE24.md`;
- `2026-05-06-ROADMAP-READ-WRITE-ULTRAFAST.md`.

## R1 - Contratos canônicos de I/O

Prioridade: P0 Risco: baixo/médio Objetivo: transformar `core/io-contracts.js` de metadata mínima em
contrato transversal.

Tarefas:

- [x] Expandir `IoOperation` para incluir `append`, `scan` e `fetch`.
- [x] Criar `IoTarget`, `IoRiskClass`, `IoErrorCode`, `IoResult` e `IoFailure`.
- [x] Adicionar `traceId`, `runtimeId`, `durationMs`, `policyVersion` e `cacheState` ao envelope.
- [x] Criar helpers para erro canônico: `ioOk()`, `ioFail()`, `toIoError()`.
- [x] Preservar compatibilidade com payloads legados das tools.
- [~] Criar testes unitários de contrato e snapshots semânticos. - 2026-05-06: cobertura inicial em
  `tests/unit/copilot/contracts/test_io_contracts.spec.js` e
  `tests/unit/copilot/infra/test_io_engine.spec.js`; snapshots semânticos seguem pendentes.

Critério de pronto:

- todas as novas APIs de I/O retornam envelope canônico;
- tools legadas continuam com shape compatível;
- erros passam a ter códigos estáveis.

## R2 - Policy unificada de path, URL, limites e output

Prioridade: P0 Risco: médio Objetivo: impedir que adapters diferentes apliquem políticas diferentes.
OBS: os limites devem ser informativos, NUNCA bloqueantes. Deve auxiliar a LLM e informá-la para que
tome a melhor decisão possível, mas nunca ser bloqueante.

Tarefas:

- [x] Extrair regras de `validatePath()` para `core/io-policy` ou `infra/io-policy`.
- [x] Compartilhar denylist de segredos, executáveis, diretórios e symlinks.
- [x] Definir limites por operação em configuração central.
- [~] Unificar truncamento por bytes e UTF-8 safe. - limites são advisory; truncamento bloqueante
  foi removido.
- [x] Unificar sanitização de output sensível.
- [~] Incluir URL policy do `web-tools` na mesma família conceitual. - fetch/search usam envelope
  `io`; faltam redirects/cache.
- [x] Criar testes de path traversal, symlink, byte nulo e arquivo bloqueado.

Critério de pronto:

- file-tools, runtime-file-context e Session FS não possuem regras divergentes para path;
- SSRF/web policy segue documentada e testada;
- limites são auditáveis em um lugar.

## R3 - Engine local de arquivo

Prioridade: P0 Risco: médio Objetivo: centralizar leitura/escrita/listagem/diff/patch em
`infra/io-engine`.

Tarefas:

- [x] Implementar `readText`, `readBytes`, `readLines`.
- [x] Implementar `writeAtomic` com classe de risco.
- [x] Implementar `appendText` com lock e metadata; opção durable/buffered segue backlog.
- [x] Implementar `copyFile`, `moveFile`, `deleteFile`.
- [x] Implementar `patchText` com validação de ocorrências.
- [x] Implementar `diffText` com fallback seguro.
- [ ] Definir thresholds entre `readFile`, stream e `FileHandle`.
- [x] Migrar `read_file_content` e `list_directory` primeiro.
- [x] Migrar `write_file_content`, `create_file`, `patch_file` em seguida.

Critério de pronto:

- file-tools são adapters finos;
- engine concentra timeout, abort, bytes, truncamento e metadata;
- testes antigos continuam passando.

## R4 - Locks por recurso e concorrência

Prioridade: P0 Risco: alto Objetivo: evitar corrida e corrupção em writes simultâneos.

Tarefas:

- [x] Criar `infra/io-locks` com fila por `resourceKey`.
- [x] Implementar lock exclusive para write/delete/move/patch.
- [x] Medir `lock.waitMs`.
- [x] Adicionar timeout e abort de lock pendente.
- [x] Criar testes de duas escritas simultâneas no mesmo arquivo.
- [x] Criar testes de write versus move/delete.
- [ ] Avaliar `worker_threads.locks` apenas como spike futuro.

Critério de pronto:

- mutações concorrentes no mesmo path são serializadas;
- conflito é observável;
- lock não fica preso após erro.

## R5 - Cache L1 por bytes e invalidação

Prioridade: P1 Risco: médio Objetivo: reduzir leituras repetidas sem entregar conteúdo stale.

Tarefas:

- [~] Definir cache key com realpath, operação, opções, size e mtime. - 2026-05-07: chave atual usa
  path normalizado + operação/range; `size/mtime` seguem pendentes.
- [x] Implementar L1 por bytes e TTL.
- [x] Invalidar por path em write/delete/move/patch.
- [x] Adicionar stats: hits, misses, evictions, stale, bytes.
- [x] Migrar `runtime-file-context` para o cache comum. - 2026-05-07: fluxo já usa
      `ioEngine.readText()`, herdando L1 sem bypass.
- [ ] Benchmark da implementação caseira versus `lru-cache`.
- [ ] Promover `lru-cache` a dependência direta apenas se vencer em simplicidade/performance.

Critério de pronto:

- cache hit aparece em `io.cache`;
- write invalida read;
- testes provam ausência de stale.

## R6 - Índice L2 SQLite e FTS5 para arquivos

Prioridade: P1 Risco: alto Objetivo: criar busca textual incremental para workspace.

Tarefas:

- [~] Definir schema `copilot_io_files`, `copilot_io_file_chunks`, `copilot_io_fts`. - 2026-05-07:
  preparado schema inicial de `copilot_io_cache_l2` (migração v9) para fase L2; FTS ainda pendente.
- [ ] Escolher `copilot.sqlite` versus `copilot-io.sqlite` após benchmark de contenção.
- [ ] Implementar scan frio de `src/copilot`.
- [ ] Implementar reindex incremental por mtime/size/hash rápido.
- [ ] Integrar `search_in_files` com FTS quando índice fresco.
- [ ] Manter `rg` como fallback para regex complexa e índice indisponível.
- [ ] Expor health do índice: fresh/stale/scanning/error.

Critério de pronto:

- busca textual comum usa FTS com fallback explícito;
- índice é invalidado em mutações locais;
- rebuild não bloqueia loop principal de diálogo.

## R7 - Scanner incremental e watchers

Prioridade: P1/P2 Risco: médio Objetivo: manter índice atualizado com custo baixo.

Tarefas:

- [~] Criar `infra/io-scanner` com `.gitignore`, denylist e include/exclude. - 2026-05-06: scanner
  comum existe com depth, hidden, filtro simples, metadata `io` e denylist central; `.gitignore`
  segue para R7.
- [ ] Usar `fsPromises.opendir` ou `fsPromises.glob` de Node 24 como baseline.
- [ ] Limitar concorrência com `p-limit`.
- [ ] Avaliar `watchman`, `fsPromises.watch`, `inotify-tools` e watcher Node puro.
- [ ] Registrar eventos created/modified/deleted/renamed.
- [ ] Debounce e batch de reindex.
- [ ] Testar rename/delete/symlink e diretórios grandes.

Critério de pronto:

- scan sem mudanças é rápido;
- mudança em arquivo único reindexa só o necessário;
- watcher tem fallback quando indisponível.

## R8 - Parsing e serialização de alto desempenho

Prioridade: P2 Risco: médio Objetivo: processar JSON, JSONL, JS/TS e Markdown grandes sem explosão
de memória.

Tarefas:

- [ ] Definir thresholds de parse direto versus streaming.
- [ ] Consolidar `safe-json` como parse JSON pequeno.
- [ ] Fazer spike com `stream-json` para JSON grande/JSONL.
- [ ] Avaliar `fast-json-stringify` para respostas de shape estável.
- [ ] Usar `@babel/parser` para symbols de maior precisão quando necessário.
- [ ] Reutilizar ideias de chunking de `tools/rag/lib/chunking`.
- [ ] Criar testes com payload grande, inválido e truncado.

Critério de pronto:

- parse grande não trava o processo;
- erro de parse é canônico;
- dependências novas entram somente com benchmark.

## R9 - Observabilidade e SLO

Prioridade: P0/P1 Risco: médio Objetivo: provar performance e detectar regressões.

Tarefas:

- [ ] Criar canais `diagnostics_channel` para I/O.
- [ ] Usar `perf_hooks` para duração.
- [ ] Emitir métricas com `prom-client`.
- [ ] Integrar com `emitSdkOperationMetric()`.
- [ ] Criar histogramas por operation/engine.
- [ ] Expor endpoint/route de health para cache e índice.
- [ ] Adicionar log estruturado pino para erros e degradações.

Critério de pronto:

- é possível responder: qual operação ficou lenta, por qual engine e por quê;
- SLOs têm números reais;
- regressão de cache/index aparece nos testes ou métricas.

## R10 - Web fetch/search robusto

Prioridade: P2 Risco: médio Objetivo: alinhar web read/search ao contrato de I/O.

Tarefas:

- [ ] Migrar `web_fetch_local` para envelope `io`.
- [ ] Migrar `web_search` para envelope `io`.
- [ ] Rate-limit por sessão/agente além de processo.
- [ ] Cache HTTP opcional com TTL, ETag e cache negativo.
- [ ] Melhorar parsing de resultados DDG ou trocar por provider canônico quando houver.
- [ ] Criar testes de redirect SSRF, content-type inválido, timeout e maxBytes.

Critério de pronto:

- web tools têm mesma observabilidade de I/O;
- SSRF e redirect seguem cobertos;
- falha de busca não derruba fluxo de agente.

## R11 - Session FS e adapters de presentation/terminal

Prioridade: P1 Risco: médio Objetivo: eliminar bypass de policy.

Tarefas:

- [x] Migrar `runtime-file-context` para `ioEngine.readText`. - 2026-05-06: attachments e diretórios
      passam pela engine canônica de leitura.
- [x] Migrar `readDirectoryContext` para scanner/listagem comum.
- [x] Migrar `createLocalSessionFsProvider` para engine ou adapter de policy equivalente. -
      2026-05-06: `writeFile`, `appendFile`, `rename`, `rm`, `readFile`, `stat` e `readdir` usam
      engine/scanner/policy; `mkdir` também passa por engine dedicada com lock e observability.
- [x] Adicionar atomic write ao Session FS.
- [~] Adicionar limites e lock ao Session FS. - 2026-05-06: writes/appends/renames/mkdir/rm têm
  locks e metadata; faltam timeout/abort padronizados em todas as operações compostas.
- [ ] Unificar métricas SDK com metadata `io`.

Critério de pronto:

- attachments, terminal e SDK leem/escrevem com a mesma política;
- cache de file-context é versionado;
- path traversal e symlink têm comportamento igual nas bordas.

## R12 - Benchmark, gates e Dockerfile

Prioridade: P1 contínuo Risco: baixo/médio Objetivo: transformar escolhas em evidência.

Tarefas:

- [~] Criar benchmark com `hyperfine` para `rg`, FTS, scan frio e scan quente. - 2026-05-07: `rg` e
  scan (`scanDirectory` com `showHidden` on/off) medidos e versionados em
  `benchmarks/hyperfine-rg-a13.json` e `benchmarks/hyperfine-scan-a13.json`; FTS segue pendente.
- [x] Criar benchmark Node com `perf_hooks` ou `tinybench` se promovido. - 2026-05-07:
      `benchmarks/io-read-benchmark.mjs` com `tinybench`.
- [x] Medir `readFile` versus stream por tamanho. - 2026-05-07: medido para 4KB/256KB/2MB.
- [x] Medir LRU caseira versus `lru-cache`. - 2026-05-07: benchmark opcional adicionado em
      `benchmarks/io-read-benchmark.mjs` (detecção dinâmica); microbench de `get` coletado em
      `benchmarks/io-read-benchmark-results.with-lru.json`; - **2026-05-07 Corte A.13 ousado**:
      `lru-cache@11` **promovido a dependência real**; `io-cache.js` refatorado para `LRUCache`;
      cache L1 hot 58x mais rápido que cold (`0.008ms` p50 vs `0.681ms`).
- [x] Só então alterar `package.json` — **feito**: `lru-cache` em `dependencies`.
- [ ] Rodar gates:
  - `npm run test:copilot:unit`;
  - `npm run typecheck:strict:src.copilot`;
  - `npm run check:dockerfile:lint` se Dockerfile mudar.

Critério de pronto:

- nenhuma dependência nova entra sem medida;
- Dockerfile só muda se ferramenta operacional externa for realmente necessária;
- resultados ficam anexados à documentação ou a logs de benchmark versionáveis.

## Priorização recomendada

### Corte A - Fundação segura

- R1 Contratos;
- R2 Policy;
- R3 Engine parcial;
- R4 Locks básicos;
- R9 métricas mínimas.

### Corte B - Performance local

- R5 L1 cache;
- R6 schema inicial L2;
- R7 scanner frio/incremental;
- benchmarks de thresholds.

### Corte C - Busca/indexação

- FTS5 para arquivos;
- integração de `search_in_files`;
- fallback `rg`;
- health de índice.

### Corte D - Bordas e parsing

- Session FS;
- runtime-file-context;
- web tools;
- parsing JSON grande;
- refinamento de deps.

## Atualização 2026-05-06 - Corte A aplicado parcialmente

Correções e upgrades executados:

- `io-engine.readText()` passou a publicar leitura textual diretamente, com metadata `engine`
  correta e range consistente quando `startLine` passa do fim do arquivo.
- `create_file` agora retorna `bytesWritten` reais em UTF-8, corrigindo divergência com caracteres
  multibyte.
- `copyFileLocked()` e `moveFileLocked()` agora validam overwrite também quando chamados diretamente
  pela engine, não apenas pelos adapters.
- `copyFileLocked()` passou a segurar lock no source e no destination, evitando corrida com
  move/delete/write concorrente no arquivo de origem.
- `writeFileAtomic()` e `appendTextLocked()` preservam `mode` quando chamado pelo Session FS.
- `createLocalSessionFsProvider.writeFile()`, `appendFile()` e `rename()` foram migrados para
  primitives canônicos com atomicidade/locks.
- `runtime-file-context` passou a usar `ioEngine.readText()` em leitura de arquivo e diretório.
- Gap transversal encontrado pela suíte completa: `dialogTurn()` voltou a aplicar timeout default
  canônico e `/copilot-api/dialog/turn` voltou a serializar concorrência por `runtimeId` via
  `server/runtime-state/copilot-api-dialog.js`, sem `Map` local process-wide.

Validação focada:

- `npm exec vitest -- run --config vitest.copilot.config.js tests/unit/copilot/infra/test_io_engine.spec.js tests/unit/copilot/sdk/test_sdk_session_fs.spec.js tests/unit/copilot/terminal/test_file_context.spec.js tests/unit/copilot/tools/file/test_read_tools.spec.js tests/unit/copilot/tools/file/test_write_tools.spec.js`
- Resultado: verde (`5` arquivos, `86` testes).
- `npm run typecheck:strict:src.copilot`: verde.
- `npm run lint`: verde.
- `npm run check:copilot:guardrails`: verde.
- Reteste dos contratos transversais afetados:
  `tests/unit/copilot/contracts/test_runtime_state_registry_inventory.spec.js`,
  `tests/unit/copilot/contracts/test_runtime_state_governance.spec.js`,
  `tests/unit/copilot/contracts/test_arch_contracts.spec.js` e
  `tests/unit/copilot/channel/test_channel_modules.spec.js`: verde (`4` arquivos, `99` testes).
- `npm run test:copilot:unit`: verde (`147` arquivos, `2.435` testes).

Backlog imediato daquele corte, antes do Corte A.2:

1. Implementar `toIoError()` e propagar erros canônicos sem quebrar payload legado. Resolvido no
   Corte A.2.
2. Criar timeout/abort para `withIoResourceLock()`. Resolvido no Corte A.2.
3. Migrar `readDirectoryContext()` para scanner comum quando `infra/io-scanner` existir. Resolvido
   no Corte A.2.
4. Cobrir write-vs-write e write-vs-move/delete com testes concorrentes.
5. Definir thresholds `readFile` vs stream antes de introduzir cache L1.

## Atualização 2026-05-06 - Corte A.2 aplicado

Correções e upgrades executados neste corte:

- `core/io-contracts.toIoError()` foi implementado e passou a normalizar erros nativos, parsing,
  binário, abort e timeout de lock para códigos estáveis.
- `withIoResourceLock()` e `withIoResourceLocks()` agora aceitam timeout e `AbortSignal` para lock
  pendente, liberando corretamente a fila quando a aquisição falha antes da operação protegida.
- `writeFileAtomic()` e `appendTextLocked()` passaram a aceitar `lockTimeoutMs`/`signal`, preparando
  as bordas para abort cooperativo sem abrir um segundo mecanismo de concorrência.
- `infra/io-scanner` foi criado como scanner comum observável para diretórios, com
  `io.operation=scan`, depth, hidden, filtro simples e contagem de entradas escaneadas.
- `list_directory` foi convertido em adapter fino sobre `scanDirectory()`, preservando o shape
  legado `file`/`dir` e adicionando metadata canônica.
- `runtime-file-context.readDirectoryContext()` deixou de chamar `readdir/stat` diretamente e passou
  a consumir `scanDirectory()` + `readText()`, eliminando a listagem paralela no fluxo de
  attachments/diretórios.
- Novos testes cobrem contrato de erro, timeout/abort de lock e scanner comum.

Validação executada antes de commit/push:

- Teste focado:
  `npm exec vitest -- run --config vitest.copilot.config.js tests/unit/copilot/contracts/test_io_contracts.spec.js tests/unit/copilot/infra/test_io_engine.spec.js tests/unit/copilot/sdk/test_sdk_session_fs.spec.js tests/unit/copilot/terminal/test_file_context.spec.js tests/unit/copilot/tools/file/test_read_tools.spec.js tests/unit/copilot/tools/file/test_write_tools.spec.js`
  - Resultado: verde (`6` arquivos, `92` testes).
- `npm run typecheck:strict:src.copilot`: verde.
- `npm run lint`: verde.
- `npm run check:copilot:guardrails`: verde.
- `npm run test:copilot:unit`: verde (`148` arquivos, `2.441` testes).

Backlog reordenado após este corte:

1. R2: extrair policy compartilhada de path/denylist/symlink para remover divergência restante.
2. R4: ampliar concorrência destrutiva com write-vs-write e write-vs-move/delete.
3. R7: evoluir scanner para `.gitignore`, denylist e include/exclude canônicos.
4. R5/R6: só iniciar cache L1/FTS depois dos gates verdes e dos benchmarks mínimos.

## Atualização 2026-05-06 - Corte A.3 gap live FS local versus workspace virtual

Gap tratado:

- O reteste live mostrou que `/workspace write/read/list` opera no workspace virtual do SDK e não
  materializa arquivos no filesystem real visível por `bash`, `grep` ou pelas file-tools locais.
- O mesmo reteste mostrou que a LLM-B, ao receber uma tarefa natural de read/write/search/scan,
  escolheu `bash`/`grep` em vez das file-tools semânticas, reabrindo um caminho paralelo
  operacional.

Transformações aplicadas:

- Novo comando terminal `/fs` com aliases `/files`, operando exclusivamente sobre o FS local
  canônico por meio das file-tools:
  - `/fs list|scan [path] [--recursive] [--hidden] [--depth n]` usa `list_directory` e
    `infra/io-scanner`;
  - `/fs read <path>` usa `read_file_content` e `io-engine.readText`;
  - `/fs search <pattern> [path]` usa `search_in_files`;
  - `/fs create <path> <content>` usa `create_file`;
  - `/fs write <path> <content>` usa `write_file_content`.
- Banner e `/help` agora exibem `/fs` ao lado de `/workspace`, deixando as duas superfícies
  separadas: SDK virtual versus filesystem local.
- `config/system-prompt/sections/tool-instructions.js` passou a instruir a LLM-B a preferir
  `list_directory`, `read_file_content`, `search_in_files`, `create_file`, `write_file_content` e
  `patch_file` para operações de arquivo, usando `bash`/`grep` apenas quando a operação for
  realmente shell ou quando a tool semântica estiver indisponível.
- A documentação live foi atualizada para reclassificar o gap e registrar o tratamento.

Validação executada:

- `npm exec vitest -- run --config vitest.copilot.config.js tests/unit/copilot/terminal/test_commands_fs.spec.js tests/unit/copilot/terminal/test_commands_sdk.spec.js`:
  verde (`2` arquivos, `24` testes).
- `npm run typecheck:strict:src.copilot`: verde.
- `npm run lint`: verde.

Reteste live executado:

- `npm run terminal:llm-b`;
- `/fs create tmp/copilot-live-fs-canonical.md LIVE_FS_CANONICAL`;
- `/fs read tmp/copilot-live-fs-canonical.md`;
- `/fs list tmp --recursive --depth 1`;
- `/fs search LIVE_FS_CANONICAL tmp`;
- turno natural pedindo leitura semântica sem `bash/cat`;
- `/activity 5`;
- `/tools`.

Resultado do reteste:

- `/fs` criou, leu, listou e buscou no filesystem real do workspace, com metadata observável:
  `io=write · engine=io-engine.atomic-write`, `io=read · engine=io-engine.fs.readFile.text`,
  `io=scan · engine=io-scanner.fs.readdir` e `io=search · engine=rg`;
- no turno natural, a LLM-B não usou `bash`/`cat`; usou a leitura semântica exposta pelo runtime
  como `view`, tocando o mesmo arquivo local e retornando `LIVE_FS_CANONICAL`;
- `/activity` mostrou o evento vivo `view · read · ... · completed`;
- `/tools` já refletia as operações `/fs` via métricas `io.*`, mas ainda não refletia o `view`
  conversacional.

Transformação adicional aplicada:

- `terminal/agent-runtime-events.js` agora registra `tool.execution_complete` em `tool-stats` como
  `sdk.<toolName>`, preservando duração e sucesso;
- com isso, `/tools` passa a consolidar tanto métricas locais de I/O (`io.*`) quanto tools vivas do
  turno conversacional (`sdk.view`, `sdk.bash`, `sdk.grep`, etc.);
- eventos genéricos sem `toolName`/`name` e sem entrada ativa não são registrados como `sdk.tool`,
  evitando métricas placeholder sem valor operacional;
- a UX textual de `/tools` foi ajustada de "registradas" para "observadas", pois a projeção agora é
  métrica consolidada, não apenas catálogo/registry;
- o teste de `terminal/agent-runtime-events` foi ampliado para travar esse contrato.

Backlog remanescente específico:

1. Investigar affordances/descriptions/allowlist se algum modelo voltar a preferir shell para
   read/write/search/scan sem pedido explícito do usuário.
2. Normalizar a apresentação de quota semanal versus `/sdk quota`.

## Atualização 2026-05-06 - Corte A.4 integração SDK↔FS e prova de boot/load

Diagnóstico aprofundado executado:

- A distinção entre `/workspace` (SDK virtual) e FS local não é bug acidental; é separação de
  domínios da própria sessão SDK versus filesystem do processo local.
- O risco operacional não está na distinção em si, e sim na ausência de telemetria/UX explícita que
  force decisão canônica de roteamento (`local-fs-primary` versus fallback).
- Mesmo com instruções no system prompt, sem evidência visível de carga de tools/instruções o modelo
  pode cair em heurística de shell (`bash/grep`) em tarefas naturais de arquivo.

Transformações aplicadas neste corte:

- `/status` passou a expor três linhas canônicas novas:
  - `tools load`: total de tools registradas e prontidão de file-tools locais;
  - `instr. load`: mecanismo efetivo de reload + cobertura de arquivos de seção/append;
  - `sdk↔fs route`: modo operacional calculado (`local-fs-primary`, `sdk-workspace-only`,
    `degraded`) e motivo.
- `readTerminalStatusProjection()` agora agrega snapshot de carga real de tools via introspecção e
  status síncrono do system prompt para validar instruções efetivamente carregadas no boot/load.
- `introspection-tools` ganhou snapshot público canônico de registro
  (`readIntrospectionRegistrySnapshot`) para evitar diagnóstico por inferência indireta.
- `cmdSdk` recebeu `doctor` para orientar o operador e o runtime sobre qual superfície usar,
  reduzindo ambiguidades da LLM-B ao alternar entre workspace SDK e FS local.
- `cmdWorkspace` foi saneado (texto/encoding e mensagens) para explicitar materialização `SDK→FS` e
  remover ruído de UX durante incidentes.

Situação ideal formalizada (target-state):

1. A distinção SDK virtual vs FS local permanece explícita (não fundir superfícies fisicamente).
2. A decisão de roteamento passa a ser canônica e observável em runtime (`sdkFsRouting.mode`).
3. File-tools locais são o caminho padrão para operações em repositório real.
4. Workspace SDK vira superfície auxiliar (plano/scratch/contexto), com ponte explícita de
   materialização.
5. Em degradação, fallback para SDK workspace é permitido, porém sinalizado como exceção
   operacional.

Backlog incremental pós A.4 (nova onda de ataque):

1. Evoluir `sdkFsRouting` para política compartilhada em `core/io-policy` (R2), removendo lógica
   duplicada de roteamento entre comandos.
2. Integrar decisão de roteamento com allowlist/affordance de tools para reduzir ainda mais fallback
   indevido para shell em turnos naturais.
3. Expor esse diagnóstico também em `/diagnose` e endpoint operacional de health para monitoramento
   contínuo.
4. Criar testes de regressão para cenário degradado (`sdk-workspace-only` e `degraded`) com mocks de
   carga parcial de tools.
5. Conectar validação de carga no boot phase para emitir alerta early quando file-tools canônicas
   não registrarem.

## Análise profunda 2026-05-06 - relação SDK workspace virtual vs FS local

Diagnóstico causal consolidado (estado atual):

- A superfície `workspace.*` do SDK (RPC `workspaces`/`workspace`) foi desenhada para estado de
  sessão e colaboração runtime-level, não para persistência obrigatória no filesystem do
  repositório.
- O comando `/workspace` no terminal opera sobre essa API virtual por design, enquanto `/fs` opera
  via file-tools canônicas (`read_file_content`, `list_directory`, `create_file`,
  `write_file_content`, `patch_file`) e `io-engine` local.
- Essa distinção trouxe isolamento útil, porém criou duas consequências:
  1. risco de expectativa incorreta de materialização automática no FS local;
  2. risco de bifurcação operacional (fluxo SDK virtual separado do fluxo canônico de I/O local).

Conclusão arquitetural:

- A distinção é tecnicamente válida e deve ser preservada como fronteira de domínio.
- O problema real não é existir fronteira; é faltar um caminho canônico de convergência entre os
  dois domínios.

Situação ideal (alvo):

- Manter os dois domínios explicitamente separados:
  - `SDK Workspace Domain`: efêmero/virtual/session-scoped;
  - `Local FS Domain`: persistente/repositório/guardrails de I/O.
- Introduzir uma ponte canônica e observável de convergência `sdk->fs`, sem bypass de policy:
  - leitura na borda SDK via `workspace.readFile`;
  - escrita no FS local exclusivamente via file-tools/`io-engine`;
  - telemetria e UX explicitando quando ocorreu materialização.
- No médio prazo, estender para fluxo bidirecional seguro (`fs->sdk`) com política explícita de
  conflito/overwrite.

## R13 - Convergência canônica SDK ↔ FS (novo eixo)

Prioridade: P0/P1 Risco: médio Objetivo: convergir os domínios sem criar engine paralela.

Tarefas:

- [x] Adicionar materialização canônica `sdk->fs` no comando `/workspace`:
  - `/workspace sync <sdkPath> [--to <localPath>] [--overwrite]`;
  - `/workspace mirror [--to <localDir>] [--overwrite]`.
- [x] Garantir que materialização use apenas file-tools canônicas
      (`create_file`/`write_file_content`).
- [x] Atualizar banner/help para explicitar operações virtuais versus operações materializadas.
- [x] Cobrir com testes unitários de comandos SDK.
- [x] Adicionar endpoint HTTP de convergência (`/sessions/:id/workspace/materialize`) com envelope
      `io`.
- [x] Adicionar fluxo reverso opcional `fs->sdk` com política de conflito explícita e auditoria.
- [x] Unificar métricas de convergência em `emitSdkOperationMetric()` + `io.*` com correlação por
      traceId.

Critério de pronto:

- Usuário consegue promover estado do workspace virtual para FS local sem shell ad-hoc;
- promoção passa pelas mesmas políticas de I/O local;
- não há nova engine paralela de escrita/leitura fora de `io-engine` + adapters.

## R14 - Visibilidade operacional live no terminal

Prioridade: P0/P1 Risco: médio Objetivo: tornar cada tool e cada operação real de I/O visível ao
operador humano e à LLM-B, sem criar painel paralelo.

Diagnóstico:

- O terminal já tinha lifecycle de tools via eventos normalizados do agent
  (`tool.execution_start/progress/complete`), com narrativa em stdout, SSE e `turn-trace-state`.
- A engine de I/O (`io-engine`, `io-scanner`, `web-tools`, search tools) publicava
  `copilot.io.operation` via `diagnostics_channel`, mas esse sinal ficava restrito a
  metrics/observability; o terminal não via necessariamente o arquivo realmente
  lido/escrito/escaneado.
- Isso criava uma lacuna UX: a tool podia ser exibida, mas o caminho real tocado pela engine não
  aparecia sempre em `/activity` ou na timeline live.

Tarefas:

- [x] Criar adapter canônico `terminal/io-activity-events.js` para consumir `copilot.io.operation`.
- [x] Registrar operações reais em `activity-state` com `source=io`.
- [x] Registrar arquivos tocados em `turn-trace-state` com `source=io`.
- [x] Emitir SSE `io.operation` para clientes live.
- [x] Mostrar linha terminal compacta/detalhada quando `showToolActivity` está ativo.
- [~] Deduplicar narrativas tool-vs-I/O quando o mesmo arquivo aparece nos dois sinais. - iniciado
  via source distinta; resta UX de agrupamento por `toolCallId`/`traceId`.
- [ ] Correlacionar `io.traceId` com `toolCallId` quando o SDK expuser essa amarra no payload local.
- [x] Expor seção dedicada em `/activity` para "I/O real recente" separada de "tools declaradas".
- [x] Criar `/live` como projeção curta do fluxo contínuo: loop, streaming, SSE, tools, arquivos,
      timeline e I/O real.

Critério de pronto:

- operador vê em tempo real qual tool iniciou, qual operação real de I/O ocorreu e qual arquivo/URL
  foi tocado;
- SSE e `/activity` carregam a mesma verdade operacional;
- a visibilidade vem de signals canônicos (`tool.*`, `copilot.io.operation`, `turn-trace-state`),
  não de parsing de stdout ou heurística ad hoc.

## Atualização 2026-05-06 - Corte A.4 aplicado (convergência SDK->FS no terminal)

Transformações aplicadas:

- `terminal/commands/sdk.js` recebeu ponte canônica de convergência:
  - novo `/workspace sync` para materializar um arquivo do workspace virtual no FS local;
  - novo `/workspace mirror` para materializar lote de arquivos do workspace virtual em diretório
    local.
- A ponte usa somente file-tools canônicas de escrita (`create_file`/`write_file_content`), mantendo
  políticas e observabilidade do `io-engine` local.
- `/workspace` passou a comunicar explicitamente o contrato:
  - `list/read/write` permanecem virtuais;
  - `sync/mirror` materializam no FS local.
- `terminal/commands/help.js` e `terminal/repl-banner.js` foram atualizados para refletir os novos
  subcomandos.
- `tests/unit/copilot/terminal/test_commands_sdk.spec.js` foi ampliado com cobertura de:
  - materialização unitária (`sync`);
  - materialização em lote (`mirror`) e modo `--overwrite`.

Backlog imediato pós A.4:

1. Expor convergência SDK↔FS também na borda HTTP (routes SDK), não só no terminal.
2. Introduzir correlação de métricas entre operação SDK de leitura e operação local `io.write`.
3. Definir política oficial de resolução de conflito para futura convergência `fs->sdk`.

## Atualização 2026-05-06 - Corte A.5 policy compartilhada + convergência HTTP SDK->FS

Transformações aplicadas:

- A decisão de roteamento SDK↔FS foi extraída para policy compartilhada em `core/sdk-fs-routing.js`,
  com:
  - `CANONICAL_LOCAL_FS_TOOL_NAMES` (fonte única do contrato mínimo de FS local);
  - `hasCanonicalLocalFsTools()` para avaliação determinística da superfície local;
  - `decideSdkFsRouting()` para decisão canônica (`local-fs-primary`, `sdk-workspace-only`,
    `degraded`).
- `terminal/frontend/projections/status.js` e `terminal/commands/sdk.js` passaram a consumir a
  policy comum, removendo decisões duplicadas e reduzindo risco de drift entre `/status` e
  `/sdk doctor`.
- A borda HTTP ganhou convergência explícita com novo endpoint:
  - `POST /sdk/sessions/:id/workspace/materialize`;
  - lê arquivo no workspace virtual via `workspaceReadFile`;
  - materializa no FS local exclusivamente via file-tools canônicas (`create_file` ou
    `write_file_content`).
- Novo schema HTTP `WorkspaceMaterializeBodySchema` em `session-schemas.js` com validação de payload
  canônico.
- Cobertura de regressão adicionada em
  `tests/unit/copilot/test_sdk_workspace_materialize_route.spec.js` para:
  - materialização com `overwrite=false` (create);
  - materialização com `overwrite=true` (write);
  - rejeição de path inválido no domínio SDK.

Impacto arquitetural do corte:

1. Terminal e API HTTP passam a compartilhar o mesmo princípio de roteamento, sem heurísticas locais
   conflitantes.
2. A convergência SDK->FS deixa de ser exclusiva do REPL e passa a existir na borda HTTP oficial.
3. Continua sem engine paralela: escrita local permanece restrita a adapters/file-tools canônicas.

Backlog pós A.5:

1. Expor `sdkFsRouting` também no `/diagnose` e em endpoint HTTP de health para monitoramento
   contínuo.
2. Evoluir endpoint de convergência para lote (`mirror`) no plano HTTP com envelope `io` por item.
3. Implementar fluxo reverso controlado (`fs->sdk`) com política explícita de conflito/auditoria.
4. Correlacionar leitura SDK + escrita local com `traceId` único em métricas
   `emitSdkOperationMetric()` + `io.*`.

## Atualização 2026-05-06 - Corte A.6 diagnose/health + convergência HTTP em lote

Transformações aplicadas:

- `POST /sdk/sessions/:id/workspace/mirror` adicionado em `session-workspace-routes.js` para
  materialização em lote SDK→FS:
  - lista paths no workspace virtual via `workspaceListFiles`;
  - lê conteúdo por item via `workspaceReadFile`;
  - escreve no FS local exclusivamente com file-tools canônicas (`create_file` /
    `write_file_content`);
  - retorna envelope por item (`ok|failed|skipped`) com `io` e sumário agregado.
- `readTerminalDiagnoseProjection()` passou a incluir `sdkFsRouting` derivado de policy canônica e
  snapshot de boot/load de tools.
- `/diagnose` agora exibe linha explícita `sdk↔fs route` com modo e razão de roteamento.
- `/observability/health` passou a expor `sdkFsRouting`, consolidando monitoramento contínuo da
  fronteira SDK virtual vs FS local na borda HTTP.
- `WorkspaceMirrorBodySchema` foi adicionado para formalizar payload da convergência em lote.

Cobertura adicionada:

- `tests/unit/copilot/test_sdk_workspace_materialize_route.spec.js` expandido com:
  - sucesso de `workspace/mirror`;
  - caso `skipped` para conteúdo não textual.
- `tests/unit/copilot/terminal/test_commands_diagnose.spec.js` reforçado para validar presença de
  `sdk↔fs route` no output.
- Novo: `tests/unit/copilot/test_observability_sdk_fs_routing.spec.js` para contrato de
  `sdkFsRouting` em `/observability/health`.

Backlog pós A.6:

1. Correlacionar `workspaceReadFile` e `io.write` por `traceId` único no caminho mirror/materialize.
2. Implementar fluxo reverso opcional `fs->sdk` com política explícita de conflito/auditoria.
3. Expor métricas de convergência por item (latência, bytes, erro) em `emitSdkOperationMetric()`.
4. Evoluir mirror HTTP para paginação/stream para workspaces virtuais muito grandes.

## Atualização 2026-05-06 - Corte A.7 correlação por traceId + métricas por fase/item

Transformações aplicadas:

- `session-workspace-routes.js` passou a gerar `traceId` canônico por item de convergência SDK→FS:
  - `materialize`: `traceId` único por operação;
  - `mirror`: `traceId` único por arquivo processado.
- Foram adicionadas emissões explícitas de `emitSdkOperationMetric()` na borda HTTP para cada fase:
  - `phase=read_sdk` (leitura no workspace virtual);
  - `phase=write_local` (escrita no FS local via file-tools canônicas).
- Cada fase agora emite `started/succeeded/failed` com atributos de correlação (`traceId`,
  `sdkPath`, `localPath`, `overwrite`, `bytes`, `destinationRoot` quando aplicável).
- O payload de resposta da convergência passou a carregar `traceId`:
  - `materialize.result.traceId`;
  - `mirror.result.items[].traceId`.

Cobertura adicionada:

- `tests/unit/copilot/test_sdk_workspace_materialize_route.spec.js` reforçado para validar:
  - presença de `traceId` em `materialize` e `mirror`;
  - emissão de métricas de convergência via `emitSdkOperationMetric` durante execução.

Impacto arquitetural do corte:

1. A convergência SDK→FS deixa de ser “caixa-preta” e passa a ser rastreável por item/fase.
2. A correlação entre leitura virtual e escrita local fica observável em métricas de SDK sem nova
   engine.
3. O sistema passa a suportar debugging operacional de gargalo/falha por arquivo com identificador
   estável.

Backlog pós A.7:

1. Persistir/agrupar métricas de convergência por `traceId` em endpoint analítico dedicado
   (`/observability/convergence`).
2. Adicionar paginação/stream em `workspace/mirror` para workspaces muito grandes com emissão
   progressiva.
3. Evoluir convergência reversa `fs->sdk` mantendo o mesmo contrato de correlação `traceId`.
4. Integrar contadores/histogramas (`prom-client`) para SLO de convergência por fase
   (`read_sdk`/`write_local`).

## Atualização 2026-05-06 - Corte A.8 auto-briefing operacional para LLM-B

Transformações aplicadas:

- Foi criado um módulo canônico de guidance em `terminal/auto-briefing.js`, com contrato único para
  orientar:
  - domínio primário de operação (`local-fs-primary`, `sdk-workspace-only`, `degraded`);
  - caminho de coleta de contexto operacional mínimo;
  - alertas de degradação de tools/instruções carregadas.
- `repl-lifecycle` passou a emitir auto-briefing no boot do terminal:
  - mostra rota operacional ativa;
  - mostra domínio recomendado (`/fs` vs `/workspace` + materialização);
  - mostra fluxo de descoberta de contexto
    (`/status -> /sdk doctor -> /tools -> /activity 5 -> /workspace list -> /fs list`).
- `/status` passou a exibir guidance operacional explícito e persistente:
  - `guia operação`;
  - `domínio ativo`;
  - `coleta ctx`;
  - `atenção boot` quando houver sinais de carga incompleta.
- `/sdk doctor` foi alinhado ao mesmo guidance canônico, reduzindo drift textual e instruções
  conflitantes.

Cobertura adicionada:

- Novo teste unitário `tests/unit/copilot/terminal/test_auto_briefing.spec.js` para contrato do
  helper em cenários nominal e degradado.
- `tests/unit/copilot/terminal/test_commands_session.spec.js` ampliado para garantir presença de
  guidance de coleta de contexto no `/status`.
- `tests/unit/copilot/terminal/test_commands_sdk.spec.js` ampliado para garantir hint de contexto no
  `/sdk doctor`.

Impacto arquitetural do corte:

1. A LLM-B passa a receber instrução operacional mínima automaticamente no boot (sem depender de
   memória implícita).
2. Operador, runtime e modelo convergem para a mesma orientação de domínio e troubleshooting.
3. A coleta de contexto necessária deixa de ser tácita e vira contrato explícito e recorrente.

Backlog pós A.8:

1. Propagar o mesmo guidance para respostas de erro de comandos `/workspace` e `/fs` (mensagens
   acionáveis por falha).
2. Expor severidade estruturada do `auto-briefing` em endpoint HTTP para consumo por painel externo.
3. Conectar `auto-briefing` com métricas de adesão (quantas sessões seguiram rota canônica sem
   fallback shell).
4. Evoluir o bloco de contexto para sugerir próximos comandos com base no erro mais recente
   (`/activity`).

## Atualização 2026-05-06 - Corte A.9 guidance acionável em falhas de comando

Transformações aplicadas:

- `/workspace sync` e erros gerais de `/workspace` passaram a emitir guidance de recuperação
  automático, reutilizando o contrato canônico de `auto-briefing` (`buildFailureRecoveryLines`).
- `/fs` passou a anexar guidance operacional em falhas de tool e exceções de execução, incluindo
  trilha mínima de coleta de contexto (`/status -> /sdk doctor -> /tools -> /activity 5`).
- O guidance agora explicita domínio ativo (`local-fs` vs `sdk-workspace`) durante incidentes,
  reduzindo ambiguidade para LLM-B e operador humano.

Cobertura adicionada:

- `tests/unit/copilot/terminal/test_commands_sdk.spec.js`:
  - novo caso para `workspace sync` com conteúdo não textual, validando presença de
    `Próximos passos`.
- `tests/unit/copilot/terminal/test_commands_fs.spec.js`:
  - novo caso de falha em `/fs read`, validando guidance acionável no erro.

Impacto arquitetural do corte:

1. O guidance de recuperação deixa de ser apenas de boot/status/doctor e passa a existir no ponto de
   falha real.
2. A LLM-B recebe automaticamente orientação suficiente para continuar coleta de contexto sem
   tentativa "no escuro".
3. O operador humano mantém previsibilidade de troubleshooting com a mesma linguagem operacional
   canônica.

Backlog pós A.9:

1. Expor severidade estruturada do guidance em endpoint HTTP de observabilidade.
2. Conectar guidance com eventos recentes (`/activity`) para recomendação contextual de próximo
   comando.
3. Instrumentar métrica de adesão à rota canônica (evitar fallback shell indevido).
4. Iniciar execução do corte A.10 (R2): policy transversal única de path/url/limites/sanitização.

## Atualização 2026-05-06 - Corte A.10.1 policy transversal + fim de exclusão default de tools

Transformações aplicadas:

- Foi criado `core/io-policy.js` como base canônica de policy de path, com contrato unificado
  (`evaluateIoPathPolicy`) e versionamento explícito de policy (`IO_POLICY_VERSION`).
- `tools/file/shared.js` passou a usar `evaluateIoPathPolicy` no fluxo de validação de path,
  preservando os checks complementares já existentes (symlink, protected files e byte nulo),
  reduzindo divergência entre adapters.
- `sdk/session/session-fs.js` passou a consumir a mesma policy canônica para resolução de paths,
  removendo parte da validação local ad hoc e convergindo Session FS com file-tools.
- As exclusões default de tools foram removidas das configurações canônicas:
  - `config/defaults.js`: `DEFAULT_EXCLUDED_TOOLS = []`;
  - `config/index.js`: `DEFAULT_EXCLUDED_TOOLS = []`.
- Contrato operacional alinhado: nenhuma tool é excluída a priori; exclusão passa a ser decisão
  dinâmica de runtime (usuário/operador/LLM-B), conforme solicitado.

Cobertura atualizada:

- Ajustes em testes de contrato estrutural para refletir `DEFAULT_EXCLUDED_TOOLS` vazio.

Impacto arquitetural:

1. Redução de drift de policy entre file-tools e Session FS.
2. Maior previsibilidade para a LLM-B: disponibilidade máxima de tools por default.
3. Denylist deixa de ser viés de boot e vira decisão explícita em runtime.

Backlog pós A.10.1:

1. Expandir `core/io-policy` para URL policy e limites/sanitização de output (convergência total de
   R2).
2. Integrar a policy canônica também em runtime-file-context e bordas HTTP de convergência SDK↔FS.
3. Adicionar testes dedicados de path traversal/symlink/byte nulo em `core/io-policy`.
4. Adicionar telemetria de decisão de policy (`policyVersion`, `decision`, `reason`) em
   métricas/diagnostics.

## Atualização 2026-05-06 - Corte A.10.2 policy URL + limites advisory + sanitização canônica

Transformações aplicadas:

- `core/io-policy.js` foi expandido para cobrir o núcleo transversal restante do R2:
  - `evaluateIoUrlPolicy()` para validação canônica de URL (reuso de `security/url-validator`);
  - `resolveIoAdvisoryLimits()` para limites por operação em modo informativo (`advisory=true`, não
    bloqueante);
  - `sanitizeIoTextOutput()` para sanitização de saída sensível em contrato único.
- `core/index.js` passou a exportar os novos contratos de policy, evitando imports paralelos ad hoc.
- `tools/web-tools.js` migrou validação de URL para `evaluateIoUrlPolicy()`, incluindo verificação
  de redirect com a mesma policy canônica.
- `server/routes/sdk/session-workspace-routes.js` foi consolidado com as rotas de convergência
  (`materialize`/`mirror`) e passou a aplicar `evaluateIoPathPolicy()` para destino local, com
  metadata de policy no envelope `io`.
- `tests/unit/copilot/core/test_io_policy.spec.js` foi ampliado para cobrir URL policy, limites
  advisory e sanitização.

Impacto arquitetural:

1. R2 deixa de estar restrito a path-only e passa a ter núcleo canônico para URL + limites +
   sanitização.
2. Web e convergência SDK↔FS passam a compartilhar a mesma família de policy (`io-policy`) em vez de
   validações isoladas.
3. O contrato de limites permanece pró-LLM (informativo), preservando liberdade operacional sem
   bloqueio artificial.

Backlog pós A.10.2:

1. Propagar `sanitizeIoTextOutput()` para todas as bordas textuais de saída sensível
   (file-tools/read/search/attachments).
2. Expor `policyVersion/decision/reason` em diagnósticos e observabilidade HTTP de forma
   padronizada.
3. Concluir bateria dedicada de concorrência destrutiva (R4: write-vs-write e write-vs-move/delete).
4. Evoluir para A.11 (`fs->sdk`) mantendo o mesmo contrato de policy + `traceId` bidirecional.

## Atualização 2026-05-06 - Corte A.10.3 consolidação de gates, SDK e observability

Transformações aplicadas:

- `session-workspace-routes.js` foi reestruturado para o fluxo HTTP real da aplicação, preservando a
  borda Express-like existente e evitando bypass de arquitetura via imports diretos do SDK:
  - dependências de rota entram por `resolveSdkRouteSharedDeps()`;
  - leitura/listagem do workspace SDK usam helpers oficiais da sessão;
  - escrita local continua passando exclusivamente por file-tools canônicas
    (`create_file`/`write_file_content`);
  - métricas de convergência são emitidas por dependência de telemetry
    (`sdkTelemetry.emitOperationMetric`).
- A decisão `sdk↔fs` foi exposta para presentation por um adapter dedicado
  (`presentation/files/routing.js`), removendo acoplamento indevido de frontend terminal com `core`.
- `session-setup.js` passou a aplicar policy dinâmica de tool em runtime mesmo quando denylist,
  allowlist e exclusões default estão vazias. Isso mantém a regra operacional: **nenhum
  limite/default bloqueia a LLM-B**, mas o operador ainda pode desabilitar tools dinamicamente.
- `sdk-introspection.js` foi tornado tolerante a mocks parciais do SDK, com introspecção defensiva
  por export opcional. O objetivo é compatibilidade real com o SDK sem fragilizar os testes quando o
  provider é parcial.
- `todo_list` manteve `limit` como recorte informativo e corrigiu `has_more` por total real,
  evitando semântica bloqueante disfarçada.
- Module maps e contratos de governança foram atualizados para reconhecer:
  - `sdk/session-workspace-routes.js` como hotspot oficial de convergência SDK↔FS;
  - `terminal/auto-briefing.js` como superfície frontend estável.

Validação executada:

- `npm run typecheck:strict:src.copilot`: passou.
- `npm run lint`: passou.
- `npm run test:copilot`: passou com `341` arquivos de teste executados, `20` ignorados, `4634`
  testes aprovados e `33` ignorados.
- Validações focadas adicionais:
  - contratos de module layout;
  - fronteira frontend terminal;
  - rotas de materialização/mirror SDK→FS;
  - dependências de presentation runtime;
  - regressões de timeout/limites não bloqueantes da LLM-B.

Impacto arquitetural:

1. O corte A.10 deixa de ser apenas policy declarada e passa a atravessar boot, terminal, HTTP, SDK
   deps, presentation e testes de contrato.
2. A convergência SDK→FS permanece canônica: SDK lê/lista; file-tools escrevem no FS; telemetry
   correlaciona.
3. A remoção de limites bloqueantes foi estabilizada nos testes: timeouts, tamanho de resposta,
   pipeline shell e wait defaults deixam de interromper a operação por regra artificial.
4. A próxima frente natural é A.11 (`fs->sdk`) com a mesma disciplina: conflito explícito,
   auditoria, `traceId` bidirecional e zero arquitetura paralela.

## Atualização 2026-05-06 - Corte A.11 fluxo reverso FS→SDK + A.12 analítico inicial

Transformações aplicadas:

- A borda HTTP ganhou o fluxo reverso `POST /sdk/sessions/:id/workspace/promote`:
  - lê arquivo do FS local exclusivamente via file-tool canônica `read_file_content`;
  - valida o path local por `evaluateIoPathPolicy()`;
  - valida o destino no domínio SDK por `validateWorkspacePath()`;
  - escreve no workspace virtual via `workspaceCreateFile()`;
  - mantém `overwrite=false` como política `fail-if-exists` com resposta `409` auditável;
  - mantém `overwrite=true` como ação explícita `overwritten`.
- O terminal ganhou `/workspace promote <localPath> [--to <sdkPath>] [--overwrite]`, fechando a
  bidirecionalidade operacional ao lado de `/workspace sync` e `/workspace mirror`.
- A auditoria do reverso inclui `direction=fs->sdk`, política solicitada, ação tomada, conflito e
  `traceId`.
- Métricas SDK passaram a materializar atributos de convergência em counters/gauges:
  - `phase` (`read_local`, `conflict_check`, `write_sdk`, além das fases SDK→FS já existentes);
  - `bytes_total` e `last_bytes`.
- Foi adicionado o endpoint inicial `GET /sdk/observability/convergence`, que agrega counters/gauges
  de `workspace.materialize`, `workspace.mirror` e `workspace.promote` por operação, status, fase e
  bytes.
- UX operacional atualizada:
  - `/help`;
  - banner do REPL;
  - `auto-briefing` de domínio/convergência.
- `WorkspaceMirrorBodySchema.maxFiles` deixou de impor teto bloqueante; permanece apenas como
  parâmetro positivo informativo/advisory quando a paginação/stream futura for implementada.

Validação executada:

- `npm exec vitest -- run --config vitest.copilot.config.js tests/unit/copilot/test_sdk_workspace_materialize_route.spec.js tests/unit/copilot/terminal/test_commands_sdk.spec.js tests/unit/copilot/test_observability_sdk_fs_routing.spec.js tests/unit/copilot/observability/test_sdk_metric_bridge.spec.js tests/unit/copilot/terminal/test_auto_briefing.spec.js`:
  `5` arquivos, `42` testes aprovados.
- `npm run typecheck:strict:src.copilot`: passou.

Impacto arquitetural:

1. R13 agora tem bidirecionalidade real sem engine paralela: local lê via file-tools, SDK escreve
   via RPC oficial.
2. Conflito deixa de ser comportamento implícito do SDK e passa a ser contrato HTTP/terminal
   auditável.
3. R9/A.12 avança de health routing para análise consultável por operação/fase, ainda sem
   prom-client/histogramas formais.
4. A disciplina pró-LLM permanece: parâmetros de volume são informativos; não há teto artificial
   novo bloqueando a operação.

Backlog pós A.11:

1. Adicionar paginação/stream real para `workspace/mirror` e futura promoção em lote, mantendo
   `maxFiles` advisory.
2. Persistir/agrupar eventos por `traceId` além dos counters agregados. Resolvido em memória no
   corte A.12.1; persistência em disco/SQLite segue pendente.
3. Adicionar histogramas/SLO por fase de convergência. Parcial em A.12.1 com histograma por fase no
   trace store; SLO formal/persistente segue pendente.
4. Expandir sanitização canônica para payloads textuais de leitura/busca onde ainda houver retorno
   bruto. Parcial em A.10.4 para read/search/symbol/web.

## Atualização 2026-05-06 - Corte A.12.1 trace store, health e paginação de mirror

Transformações aplicadas:

- Foi criado `observability/convergence-trace-store.js`, store em memória para eventos de
  convergência SDK↔FS:
  - agrega por `traceId`;
  - preserva timeline por fase;
  - calcula status operacional (`running`, `succeeded`, `failed`, `mixed`);
  - agrega bytes e histogramas por fase com `metrics-histogram`;
  - mantém ring buffer limitado por traces/eventos para não crescer indefinidamente.
- `sdk-metric-bridge` passou a alimentar o trace store além dos counters/gauges existentes.
- `bootstrapObservability()` registra `CONVERGENCE_TRACE_STORE` no DI e injeta o store na ponte SDK.
- `GET /sdk/observability/convergence` agora expõe:
  - agregação por operação/fase/counter legado;
  - snapshot do trace store;
  - filtros `traceId`, `operation` e `limit`.
- `GET /sdk/observability/health` ganhou componente `convergence`, degradando health quando há
  traces recentes `failed` ou `mixed`.
- `POST /sdk/sessions/:id/workspace/mirror` ganhou paginação explícita:
  - `pageSize` + `cursor`;
  - `nextCursor`;
  - `totalFiles`, `returnedFiles`, `offset`;
  - `maxFiles` permanece apenas advisory/informativo, sem teto oculto.

Validação executada:

- `npm exec vitest -- run --config vitest.copilot.config.js tests/unit/copilot/observability/test_convergence_trace_store.spec.js tests/unit/copilot/observability/test_sdk_metric_bridge.spec.js tests/unit/copilot/test_observability_sdk_fs_routing.spec.js`:
  `3` arquivos, `7` testes aprovados.
- `npm exec vitest -- run --config vitest.copilot.config.js tests/unit/copilot/test_sdk_workspace_materialize_route.spec.js tests/unit/copilot/test_observability_sdk_fs_routing.spec.js tests/unit/copilot/observability/test_convergence_trace_store.spec.js tests/unit/copilot/observability/test_sdk_metric_bridge.spec.js`:
  `4` arquivos, `18` testes aprovados.
- `npm run typecheck:strict:src.copilot`: passou.

Impacto arquitetural:

1. A.12 deixa de depender apenas de counters globais; agora existe timeline consultável por
   `traceId`.
2. Health passa a refletir degradação real de convergência, não só disponibilidade estática de
   rotas/tools.
3. Mirror HTTP deixa de ser uma operação indivisível para workspaces grandes e passa a suportar
   paginação explícita.
4. Não houve nova dependência: histogramas usam a infraestrutura interna existente.

## Atualização 2026-05-06 - Corte A.10.4 sanitização textual + R10 web no envelope `io`

Transformações aplicadas:

- `read_file_content` passou a aplicar `sanitizeIoTextOutput()` em conteúdo UTF-8.
- `search_in_files` passou a combinar filtro legado de linhas sensíveis com sanitização canônica.
- `workspace_symbol_search` passou a sanitizar output textual do `rg`.
- `web_fetch_local` passou a retornar envelope `io` (`operation=fetch`, `targetKind=url`,
  `engine=fetch`) e conteúdo sanitizado.
- `web_search` passou a retornar envelope `io` (`operation=search`, `targetKind=url`, engine DDG
  JSON/HTML) e sanitizar títulos/snippets.
- Payloads passaram a expor `sanitized` e `redactions` quando aplicável.

Validação executada:

- `npm exec vitest -- run --config vitest.copilot.config.js tests/unit/copilot/tools/file/test_read_tools.spec.js tests/unit/copilot/tools/test_web_tools.spec.js`:
  `2` arquivos, `43` testes aprovados.
- `npm run typecheck:strict:src.copilot`: passou.

Impacto arquitetural:

1. R2 avança para a borda de output, não apenas input policy.
2. R10 deixa de estar fora do contrato `io` nas respostas bem-sucedidas.
3. A LLM-B recebe conteúdo útil sem bloquear a operação e com redaction explícita quando necessário.

## Atualização 2026-05-06 - Corte R4 bateria destrutiva principal

Transformações aplicadas:

- `tests/unit/copilot/infra/test_io_engine.spec.js` passou a cobrir:
  - `writeFileAtomic` aguardando lock ativo no mesmo arquivo;
  - `moveFileLocked` aguardando lock ativo no source;
  - `deleteFileLocked` aguardando lock ativo no arquivo.
- A bateria complementa os cenários já existentes de `copyFileLocked`, timeout e abort de lock.

Validação executada:

- `npm exec vitest -- run --config vitest.copilot.config.js tests/unit/copilot/infra/test_io_engine.spec.js tests/unit/copilot/core/test_io_policy.spec.js tests/unit/copilot/tools/file/test_read_tools.spec.js tests/unit/copilot/tools/test_web_tools.spec.js`:
  `4` arquivos, `62` testes aprovados.
- `npm run typecheck:strict:src.copilot`: passou.

Impacto arquitetural:

1. A serialização por recurso passa a estar provada nos conflitos destrutivos mais importantes.
2. Ainda ficam para uma rodada futura cenários de diretórios/remoções recursivas e stress de alta
   concorrência.

## Atualização 2026-05-06 - Corte A.10.5 hardening R2 + R11 Session FS sem bypass

Transformações aplicadas:

- `core/io-policy.js` ganhou a variante assíncrona `evaluateIoPathPolicyAsync()`:
  - resolve `realpath` do alvo ou do diretório pai para cobrir symlink em arquivo existente e
    criação de path novo;
  - bloqueia symlink que resolve fora do workspace/root isolado;
  - centraliza padrões sensíveis de leitura e padrões extras de escrita (`.sh`, `.exe`, bibliotecas
    nativas etc.);
  - adiciona modo por operação (`read`, `write`, `append`, `delete`, `move`, `copy`, `patch`,
    `mkdir`, `stat`);
  - retorna `realPath` e `symlinkResolved` para adapters usarem a mesma chave operacional.
- `tools/file/shared.validatePath()` deixou de manter regras próprias de realpath/regex e passou a
  delegar para a policy central.
- `presentation/runtime-file-context` passou a validar attachments e diretórios com a policy
  assíncrona, usando `realPath` antes de chamar `io-engine.readText()` ou `io-scanner`.
- `session-workspace-routes` passou a validar materialize/mirror/promote com policy assíncrona,
  separando modo de leitura (`promote` local) e escrita (`materialize`/`mirror` local).
- `io-scanner` passou a respeitar a denylist central mesmo com `showHidden=true`, evitando scan
  acidental de `.git` e `node_modules` quando o operador pede arquivos ocultos.
- `io-engine` ganhou:
  - `statPath()` com `operation=stat`;
  - `mkdirPathLocked()` para criação de diretório com lock e metadata `io`;
  - `removePathLocked()` para remoção de arquivo/diretório com lock e metadata `io`.
- `createLocalSessionFsProvider` agora usa:
  - `readText()` para `readFile`;
  - `statPath()` para `exists` e `stat`;
  - `scanDirectory()` para `readdir` e `readdirWithTypes`;
  - `mkdirPathLocked()` para `appendFile` criar parent directories e para `mkdir`;
  - `removePathLocked()` para `rm`;
  - preservando o contrato nativo `SessionFsProvider` do SDK; o SDK continua dono do adapter RPC via
    `createSessionFsAdapter()`.
- Auditoria SDK-first local confirmou:
  - `CopilotClientOptions.sessionFs` e `createSessionFsHandler(session)` são o ponto canônico para
    Session FS;
  - Workspaces RPC oficial cobre `listFiles`, `readFile` e `createFile`; mirror/materialize/promote
    seguem como extensão local apenas para convergência e conflito, não como substituto do SDK;
  - tools continuam registradas via `defineTool()` pela wrapper local, mantendo
    `ToolInvocation`/trace do SDK.

Validação executada:

- `npm run typecheck:strict:src.copilot`: passou antes e depois do corte.
- `npm exec vitest -- run --config vitest.copilot.config.js tests/unit/copilot/core/test_io_policy.spec.js tests/unit/copilot/infra/test_io_engine.spec.js tests/unit/copilot/sdk/test_sdk_session_fs.spec.js tests/unit/copilot/terminal/test_file_context.spec.js tests/unit/copilot/test_sdk_workspace_materialize_route.spec.js`:
  `5` arquivos, `57` testes aprovados.
- `npm exec vitest -- run --config vitest.copilot.config.js tests/unit/copilot/sdk/test_sdk_session_fs.spec.js tests/unit/copilot/infra/test_io_engine.spec.js`:
  `2` arquivos, `16` testes aprovados.

Impacto arquitetural:

1. R2 deixa de depender de duplicação em file-tools; symlink, denylist e padrões sensíveis passam a
   morar no core.
2. R7 herda a mesma denylist durante scan, preparando `.gitignore` sem reimplementar regras de
   proteção.
3. R11 fica muito mais próximo do pronto: Session FS lê, lista, faz stat e remove pelo mesmo eixo
   observável do FS local.
4. Ainda ficam como próximos alvos naturais:
   - `.gitignore` canônico no scanner;
   - timeout/abort uniforme nas operações compostas da engine;
   - cache HTTP/redirect SSRF em R10;
   - benchmarks A.13 para liberar L1/L2.

## Atualização 2026-05-06 - Corte A.10.6 compatibilidade SDK-first SessionFs

Transformações aplicadas:

- `mkdirPathLocked()` foi promovido para a engine canônica, com `operation=mkdir`, lock por path e
  metadata informativa (`recursive`, `lockWaitMs`, `source`).
- `createLocalSessionFsProvider.appendFile()` deixou de chamar `node:fs/promises.mkdir` diretamente
  para parent directory e passou a usar `mkdirPathLocked()`.
- `createLocalSessionFsProvider.mkdir()` passou a usar `mkdirPathLocked()` mantendo a assinatura
  esperada pelo `SessionFsProvider` do SDK (`path`, `recursive`, `mode`).
- `createLocalSessionFsProvider.exists()` agora retorna `false` somente para `ENOENT`/`ENOTDIR`;
  erros de policy, symlink e segurança são propagados no provider, enquanto o adapter oficial do SDK
  preserva seu contrato `exists=false`.
- `readdirWithTypes()` não converte mais `symlink`/`other` em `file`; só expõe `file` e `directory`,
  que são os únicos tipos declarados no RPC gerado do SDK.

Critério arquitetural:

- SDK-first mantido: implementamos um `SessionFsProvider` robusto e deixamos o SDK adaptar esse
  provider para RPC.
- Não foi criada rota paralela para Session FS; a ampliação está no provider local, nas policies e
  na engine.
- Divergências conhecidas do SDK foram documentadas em teste: `createSessionFsAdapter().exists()`
  engole erros do provider e retorna `false`, por contrato do vendor.

## Atualização 2026-05-06 - Corte A.14.1 visibilidade live de I/O real no terminal

Transformações aplicadas:

- Novo adapter `terminal/io-activity-events.js` consome o canal `diagnostics_channel`
  `copilot.io.operation`.
- A fase `runTerminalPinnedContextPhase()` conecta esse adapter junto do bridge canônico de
  `activity.changed`, e o rollback o desinscreve para evitar subscriber global vazando.
- Cada operação real da engine passa a:
  - atualizar `activity-state` com `source=io`;
  - alimentar `turn-trace-state` com arquivos tocados;
  - emitir SSE `io.operation`;
  - imprimir narrativa terminal `[IO]` quando a preferência `showToolActivity` está ativa.
- `/activity` ganhou seção "I/O real recente", exibindo operação, alvo, bytes, duração e engine,
  além de mostrar `source` nos resumos de tools/arquivos do turno.
- O módulo respeita o fluxo canônico: não executa I/O, não substitui lifecycle do SDK/agent e não
  cria painel paralelo.

Impacto arquitetural:

1. Tool lifecycle e engine lifecycle deixam de estar parcialmente desacoplados na UX.
2. `/activity` passa a refletir arquivos realmente lidos/escritos pela engine, inclusive quando a
   tool declarada não carregava path suficiente no payload.
3. R9/R14 ficam alinhados: diagnostics_channel continua sendo a fonte técnica; terminal vira
   consumidor de projeção.

Validação associada:

- `tests/unit/copilot/terminal/test_io_activity_events.spec.js` cobre projeção para activity/turn
  trace/stdout/SSE e cleanup do subscriber.

## Atualização 2026-05-06 - Corte A.14.2 fluxo live contínuo do terminal

Diagnóstico tratado:

- O terminal já tinha peças maduras de UX live (`/status`, `/now`, `/activity`, streaming, thinking,
  SSE e trace de turno), mas a leitura operacional exigia correlacionar manualmente várias
  superfícies.
- Isso deixava o fluxo de "session eternal" menos fluido para operador humano e para LLM-B: era
  possível ver cada parte, mas não havia uma visão curta única de loop, streaming, sessão, SSE,
  timeline, tools, arquivos e I/O real.

Transformações aplicadas:

- Foi criada a projeção `terminal/frontend/projections/live.js`, que compõe apenas fontes canônicas
  existentes: `readTerminalStatusProjection`, `readTerminalActivityProjection`,
  `readTerminalTimelineProjection`, `readTerminalIoActivityProjection`, display policy e estado SSE.
- Novo comando `/live [n]`:
  - mostra estado do loop (`ready`, `active-turn`, `waiting-human`, `paused`, `offline`,
    `recovering`);
  - exibe runtime, SDK/session, permission mode, toggles de streaming/thinking/tools/intent/usage;
  - mostra clientes SSE, replay buffer, reconciliação da timeline, tools/arquivos do turno e I/O
    real recente;
  - lista eventos recentes para debugging fluido sem sair do terminal.
- `/now` passou a carregar `live=<estado>` e contagem resumida de clientes SSE.
- Banner e `/help` passaram a divulgar `/live`.

Impacto arquitetural:

1. R14 avança de "eventos visíveis" para "fluxo contínuo legível".
2. Nenhum fluxo paralelo foi criado: `/live` é uma projeção, não uma nova engine.
3. A UX passa a ter uma superfície curta para acompanhar session eternal/dialog loop/streaming antes
   de recorrer ao `/status` detalhado ou ao `/activity`.

Validação associada:

- `tests/unit/copilot/terminal/test_commands_session.spec.js` cobre `/live` e o enriquecimento de
  `/now`.

## Dependências candidatas por decisão

| Dependência           | Decisão atual                          | Condição operacional                                                                |
| --------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| `lru-cache`           | **Promovida**                          | Já é L1 canônico; manter gates de hit/miss, TTL, max bytes e stale probe            |
| `@babel/parser`       | **Promovida**                          | Parser simbólico JS/TS canônico; avaliar `@babel/traverse` só se traversal profundo |
| `ignore`              | **Disponível, pendente de integração** | Usar no scanner A.17 para `.gitignore`/ignore files reais                           |
| `p-limit`             | **Disponível, pendente de integração** | Usar no scanner/prefetch para concorrência explícita e observável                   |
| `prom-client`         | **Disponível, pendente de integração** | Promover métricas formais de I/O/cache/index quando nomes/SLOs estabilizarem        |
| `xxhash-wasm`         | **Disponível, pendente de integração** | Fingerprint rápido para índice incremental; benchmark antes de tornar obrigatório   |
| `stream-json`         | Candidata forte                        | JSON/JSONL > 1MB ou payload streaming virar caso real medido                        |
| `fast-json-stringify` | Candidata moderada                     | Só entra se serialização de respostas estáveis aparecer como gargalo em benchmark   |
| `@parcel/watcher`     | Candidata futura                       | Entra apenas se `fsPromises.watch`/Node puro falhar em portabilidade/latência       |
| `chokidar`            | Candidata futura                       | Alternativa JS apenas se watcher nativo + `@parcel/watcher` não atenderem           |
| `tinybench`           | Promovida de fato em benchmark         | Consolidar script/gate CI se benchmarks virarem obrigatórios                        |

## Atualização 2026-05-07 - Corte A.9 aplicado — auto-briefing contextual

Diagnóstico tratado:

- O guidance de falha em `/fs` era estático (`FS_FAILURE_GUIDANCE`), incapaz de adaptar
  recomendações ao que acabou de acontecer (ex.: leitura falha vs escrita ok).
- `TerminalOperationalGuidance` não tinha `severity` nem `nextCommand`, forçando o consumidor a
  inferir prioridade e próxima ação de forma manual.

Transformações aplicadas:

- `src/copilot/terminal/auto-briefing.js`:
  - Adicionado campo `severity: 'info' | 'warn' | 'error'` ao typedef `TerminalOperationalGuidance`.
  - Adicionado campo `nextCommand: string | null` — sugestão de próxima ação operacional.
  - Nova função exportada `buildActivityAwareGuidance({ mode, warnings?, lastIoEntry? })`: lê o
    último evento de I/O real e deriva `nextCommand` contextual (falha de leitura →
    `/status → /fs read <target>`; escrita ok → `/fs read <target>`; ausência de histórico →
    `/activity 5 → /fs list → /status`).
  - Função interna `deriveNextCommand(mode, lastEntry)` encapsula toda a lógica de decisão.
  - `buildTerminalOperationalGuidance` passa a retornar `severity` e `nextCommand` em todos os
    modos.
  - `buildFailureRecoveryLines` emite linha `Próximo: <cmd>` quando `guidance.nextCommand` existe.

- `src/copilot/terminal/commands/fs.js`:
  - Removida constante estática `FS_FAILURE_GUIDANCE`.
  - Adicionada função `buildFsDynamicGuidance()` que lê último evento via
    `readTerminalIoActivityProjection(1)` e delega a `buildActivityAwareGuidance`.
  - `printFailure` e bloco `catch` de `cmdFs` agora mostram `guidance.nextCommand` com cor amarela
    antes das linhas de recovery.

- `src/copilot/terminal/commands/sdk.js`:
  - `renderCommandFailureGuidance` atualizado para usar `buildActivityAwareGuidance` com o
    `lastIoEntry` mais recente.
  - `guidance.nextCommand` exibido antes das linhas de recovery.

Testes adicionados:

- `tests/unit/copilot/terminal/test_auto_briefing.spec.js`: 9 novos casos cobrindo: severity
  info/warn/error por modo e warnings, nextCommand por modo, `buildActivityAwareGuidance` sem e com
  lastIoEntry, escalonamento por warnings, degraded sempre severity error, e linha `Próximo:` em
  buildFailureRecoveryLines.

Validação:

- Todos os 12 testes de test_auto_briefing.spec.js passando.
- Zero erros de typecheck nos arquivos modificados.

---

## Atualização 2026-05-07 - Corte A.10 aplicado — URL policy maxRedirects + redirect manual

Diagnóstico tratado:

- `web_fetch_local` usava `fetch(url, { redirect: 'follow' })` sem limite de hops. Apenas a URL
  final era verificada por `evaluateIoUrlPolicy`, deixando URLs intermediárias sem validação SSRF e
  sem controle de profundidade de cadeia de redirects.
- `evaluateIoUrlPolicy` não retornava `maxRedirects`, tornando a política de redirects implícita e
  não transportável entre camadas.

Transformações aplicadas:

- `src/copilot/core/io-policy.js`:
  - Exportada constante `IO_URL_MAX_REDIRECTS = 5` como valor canônico da política.
  - `evaluateIoUrlPolicy` aceita parâmetro opcional `maxRedirects` e retorna `maxRedirects` no
    resultado `ok: true` (default: `IO_URL_MAX_REDIRECTS`; `0` desabilita redirects).

- `src/copilot/core/index.js`:
  - `IO_URL_MAX_REDIRECTS` adicionado ao barrel do core para importação via `#copilot/core`.

- `src/copilot/tools/web-tools.js`:
  - Nova função interna `fetchWithRedirectPolicy(startUrl, maxRedirects)`: segue cada redirect
    individualmente com `redirect: 'manual'`, valida cada URL intermediária com
    `evaluateIoUrlPolicy` e lança erro ao exceder o limite.
  - `web_fetch_local` substitui `redirect: 'follow'` por `fetchWithRedirectPolicy`.
  - `redirectCount` e `maxRedirects` incluídos no retorno e no payload `buildIoMeta`.

Testes adicionados:

- `tests/unit/copilot/core/test_io_policy.spec.js`: 5 novos casos: `IO_URL_MAX_REDIRECTS` é número
  positivo, resultado ok inclui `maxRedirects` canônico, aceita `maxRedirects` personalizado, aceita
  `maxRedirects=0`, resultado blocked não expõe `maxRedirects`.

Validação:

- 29/29 testes passando (17 em test_io_policy + 12 em test_auto_briefing).
- Zero erros de typecheck em io-policy.js, web-tools.js e core/index.js.

---

## Atualização 2026-05-07 - Corte A.15 — Persistência SQLite do trace-store de convergência

Diagnóstico tratado:

- O `convergence-trace-store.js` operava exclusivamente com um ring-buffer in-memory
  (`maxTraces=500`). Após restart ou rotação do buffer, eventos históricos de convergência SDK↔FS
  eram perdidos.
- O backlog pós A.11 registrava explicitamente: "Persistir/agrupar eventos por `traceId` além dos
  counters agregados. Resolvido em memória no corte A.12.1; persistência em disco/SQLite segue
  pendente."

Transformações aplicadas:

- `src/copilot/db/migrations.js`:
  - Migração v8 `create_convergence_trace_events` cria tabela `copilot_convergence_trace_events` com
    campos: `trace_id`, `operation`, `phase`, `direction`, `status`, `bytes_read`, `bytes_written`,
    `duration_ms`, `error_msg`, `created_at_ms`.
  - Índices em `trace_id`, `created_at_ms DESC` e `(operation, status)` para queries analíticas.

- `src/copilot/observability/convergence-trace-store.js`:
  - Módulo-level `_persistenceDb` — nulo por padrão; ativado por
    `initConvergenceTracePersistence(db)`.
  - `initConvergenceTracePersistence(db)`: idempotente, conecta SQLite como L2 durável.
  - `persistEvent(traceId, event)`: persiste cada evento no SQLite após gravação no ring-buffer L1.
    Falha de escrita é não-fatal — ring-buffer continua sem interrupção.
  - `getPersistedSnapshot(options)`: query histórica no SQLite com filtros `traceId`, `operation`,
    `status`, `offsetMs` e `limit`. Retorna `null` quando persistência não está inicializada.
  - `recordMetric()` chama `persistEvent` após cada evento gravado no ring-buffer.

- `src/copilot/observability/bootstrap.js`:
  - `bootstrapConvergencePersistence(db)`: novo export que delega para
    `initConvergenceTracePersistence`.
  - `bootstrapObservability` fase `observability` agora chama
    `bootstrapConvergencePersistence(getCopilotDb())` via import dinâmico. Falha SQLite não bloqueia
    o boot.

- `src/copilot/observability/index.js`:
  - Novos exports: `initConvergenceTracePersistence`, `getPersistedSnapshot`,
    `bootstrapConvergencePersistence`.

Testes adicionados:

- `tests/unit/copilot/observability/test_convergence_trace_store.spec.js`: 4 novos casos cobrindo:
  null quando não inicializado, persistência ativada com banco em memória, filtro por operation, e
  respeito ao `limit` com `total` correto.

Validação:

- 176/176 testes passando (suite completa de observabilidade + core policy + terminal briefing).
- Zero erros de typecheck nos arquivos modificados.

Impacto arquitetural:

1. Ring-buffer in-memory permanece L1 — acesso rápido para queries recentes e aggregation.
2. SQLite é L2 durável — eventos sobrevivem a restarts; histórico consultável por `traceId`
   ilimitado.
3. Falha de persistência é não-fatal: degradação silenciosa sem interromper o fluxo crítico.
4. `getPersistedSnapshot` complementa `getSnapshot` para queries analíticas além do janela do
   ring-buffer.

---

## Critério de pronto final

---

## Atualização 2026-05-07 — Corte R5 — Cache L1 para io-engine

### Contexto

R5 implementa o cache L1 em memória para todas as operações de leitura do `io-engine`, com
invalidação automática em qualquer escrita destrutiva. Objetivo: eliminar releituras redundantes de
arquivos que não mudaram, reduzindo latência e pressão no fs do Node.js.

### Arquivos criados/modificados

- **`src/copilot/infra/io-cache.js`** (NOVO — ~240 linhas):
  - Singleton `getIoL1Cache()` com `Map` próprio para suportar iteração de prefixo na invalidação.
  - TTL por entrada: `IO_L1_CACHE_TTL_MS` (default 60s via env). LRU eviction com
    `IO_L1_CACHE_MAX_ENTRIES` (default 2000).
  - Chaves: `{normalized}::read:bytes`, `{normalized}::read:text`,
    `{normalized}::read:text:{s}:{e}`.
  - `invalidate(filePath)`: itera `Map.entries()` removendo todas as chaves com prefixo
    `{normalized}::`.
  - Stats: `{ hits, misses, evictions, invalidations, size, bytesStored, ttlMs }`.
  - `resetIoL1CacheForTest()`: destrói singleton para isolamento de testes.

- **`src/copilot/infra/io-engine.js`** (MODIFICADO):
  - `readBytes`: hit retorna buffer com `cache: 'l1-hit'`; miss armazena e retorna
    `cache: 'l1-miss'`.
  - `readText`: armazena texto COMPLETO no cache; hit reaplica slice. Ranges distintos compartilham
    a mesma entrada.
  - `writeFileAtomic`, `appendTextLocked`, `deleteFileLocked`, `patchTextLocked`:
    `invalidateIoCachePath(filePath)` antes do `publishAndReturn`.
  - `copyFileLocked`: invalida `destination`. `moveFileLocked`: invalida `source` e `destination`.

- **`src/copilot/infra/index.js`**: novos exports `getIoCacheStats`, `getIoL1Cache`,
  `invalidateIoCachePath`, `makeBytesKey`, `makeTextKey`, `normalizeIoCacheKey`,
  `resetIoL1CacheForTest`.

### Testes adicionados

- `tests/unit/copilot/infra/test_io_cache.spec.js` (NOVO — 15 testes): normalizeIoCacheKey,
  makeBytesKey/makeTextKey, hit/miss/stats, invalidação isolada, getIoCacheStats, TTL/LRU
  accounting.

### Validação

- 26/26 testes passando em `tests/unit/copilot/infra/` (15 novos + 11 existentes).

### Invariantes de cache

1. Apenas leituras populam o cache — operações destrutivas nunca armazenam.
2. Toda escrita invalida o cache do path afetado antes de completar.
3. `moveFileLocked` invalida source E destination.
4. TTL e LRU são configuráveis por env sem code change.
5. Falha de cache nunca propaga exceção para o caller.

- `src/copilot` tem um contrato único de I/O.
- File-tools são adapters, não engines.
- Session FS, terminal e presentation compartilham policy.
- Writes destrutivos têm lock por recurso.
- Cache L1 é seguro contra stale.
- Índice L2 acelera busca textual comum.
- RAG permanece busca semântica complementar.
- Observabilidade mostra latência, engine, cache, lock, truncamento e erro.
- Dockerfile e dependências refletem evidência, não intenção.

## Atualização 2026-05-07 — Corte A.13 — Performance orientada por evidência

Transformações aplicadas:

- Benchmark formal de leitura criado em `benchmarks/io-read-benchmark.mjs` cobrindo:
  - `fs.readFile` vs `stream.ReadStream`;
  - `io-engine.readBytes` miss (cold) vs hit (warm);
  - acesso direto ao L1 (`l1-cache.get`) com medição dedicada.
- Resultados versionáveis persistidos em `benchmarks/io-read-benchmark-results.json`.
- Documento de decisão arquitetural criado em `benchmarks/A13-io-performance-decisions.md`, com:
  - gates quantitativos de adoção/rollback para R5;
  - threshold operacional para stream;
  - critérios de ativação para R6/R7;
  - plano de paginação/stream para mirror em workspaces grandes.

Resumo dos resultados (Node 24, devcontainer Debian 12):

- `io-engine.readBytes` hit ficou entre ~350K e ~370K op/s;
- speedup L1 vs `fs.readFile` entre **1452x** e **5773x**;
- ratio hit/miss do `io-engine` entre **126x** e **408x**.

Decisões consolidadas:

1. **R5 adotado** com base em evidência quantitativa (ganho >100x em hit/miss).
2. **Stream não promovido por padrão** para arquivos pequenos/médios; manter `readFile` default.
3. **R6/R7 permanecem condicionais** a evidência de latência/frequência em produção.
4. **R12 avançou para parcial** com gates iniciais já definidos e artefatos versionados.

Backlog pós A.13:

1. Benchmark comparativo da LRU caseira versus `lru-cache`.
2. Benchmark com `hyperfine` para `rg`/scan frio-quente e base de decisão de FTS.
3. Formalização de threshold `FileHandle/chunked read` para payloads >10MB.
4. Fechar pendência de cache key com `size/mtime` no R5.

## Atualização 2026-05-07 — Corte A.13.1 — Testes contínuos (hyperfine + LRU opcional)

Transformações aplicadas:

- `benchmarks/io-read-benchmark.mjs` passou a suportar `--out=<path>` para persistência versionável
  dos resultados e comparação opcional com `lru-cache` via detecção dinâmica (sem dependência
  obrigatória no projeto).
- Nova rodada de benchmark `io-read` executada e persistida em:
  - `benchmarks/io-read-benchmark-results.json`;
  - `benchmarks/io-read-benchmark-results.with-lru.json`.
- Benchmarks `hyperfine` adicionados para R12:
  - `benchmarks/hyperfine-rg-a13.json` (`rg` em `src/copilot`);
  - `benchmarks/hyperfine-scan-a13.json` (`scanDirectory` recursivo com `showHidden` off/on).

Resultados consolidados da rodada contínua:

- `rg` ficou na faixa de ~9–10ms para padrões testados em `src/copilot` (bem abaixo do gatilho atual
  de adoção de FTS para R6).
- `scanDirectory` em `src/copilot` (depth=3) ficou em ~0.28s (`showHidden=false`) e ~0.36s
  (`showHidden=true`), sem evidência de necessidade imediata de watcher no estado atual.
- Microbench opcional de cache apontou `lru-cache.get` acima da LRU atual (Map) em lookup isolado;
  decisão de dependência permanece condicionada ao benchmark de integração end-to-end (R5/R12), não
  apenas microbench de `get`.

Validação executada:

- `node benchmarks/io-read-benchmark.mjs --out=benchmarks/io-read-benchmark-results.json`.
- `npm exec --yes --package=lru-cache@11 -- node benchmarks/io-read-benchmark.mjs --out=benchmarks/io-read-benchmark-results.with-lru.json`.
- `hyperfine --warmup 3 --runs 10 --export-json benchmarks/hyperfine-rg-a13.json ...`.
- `hyperfine --warmup 3 --runs 10 --export-json benchmarks/hyperfine-scan-a13.json ...`.
- `npm exec eslint benchmarks/io-read-benchmark.mjs`.
- `npm run typecheck:strict:src.copilot`.

Backlog incremental pós A.13.1:

1. Medir benchmark de integração de LRU (hit/miss/eviction/invalidation) antes de promover
   `lru-cache` para dependência direta. **[CONCLUÍDO — Corte A.13 ousado, veja abaixo]**
2. Adicionar benchmark `hyperfine` para cenário FTS real (quando schema R6 existir).
3. Formalizar threshold de `FileHandle/chunked read` para arquivos >10MB em workload real.
4. Fechar chave de cache com `mtime/size` para reduzir risco residual de stale em edge cases.

---

## Atualização 2026-05-07 — Corte A.13 ousado: LRU real + Babel parser + Session Scope LLM-B

**Motivação**: A LLM-B precisa de sistema de I/O inteligente para declarar escopos de trabalho,
pré-aquecer cache e navegar símbolos sem ler todos os arquivos no contexto.

### Módulos entregues

| Módulo                                  | Status        | Descrição                                                                        |
| --------------------------------------- | ------------- | -------------------------------------------------------------------------------- |
| `src/copilot/infra/io-cache.js`         | ✅ Refatorado | `LRUCache` do lru-cache@11; `maxSize` em bytes; TTL; evictions contadas          |
| `src/copilot/infra/io-prefetch.js`      | ✅ Novo       | Prefetch paralelo com concorrência; session scopes nomeados; `warmFromDirectory` |
| `src/copilot/infra/io-parser.js`        | ✅ Novo       | @babel/parser; extrai símbolos/imports/exports JS/TS; JSON schema; MD outline    |
| `src/copilot/infra/io-session-scope.js` | ✅ Novo       | API LLM-B: `declareScope`, `findSymbol`, `getScopeContext`, `refreshScope`       |
| `src/copilot/infra/index.js`            | ✅ Atualizado | Barrel exports com 20+ novos símbolos                                            |
| `benchmarks/ci-gate.mjs`                | ✅ Novo       | Gate de regressão CI/CD com thresholds configuráveis (padrão 20%)                |

### Testes

| Suite                           | Testes    | Status |
| ------------------------------- | --------- | ------ |
| `test_io_cache.spec.js`         | 15/15     | ✅     |
| `test_io_parser.spec.js`        | 15/15     | ✅     |
| `test_io_prefetch.spec.js`      | 9/9       | ✅     |
| `test_io_session_scope.spec.js` | 11/11     | ✅     |
| `test_io_engine.spec.js`        | 11/11     | ✅     |
| **Total**                       | **61/61** | ✅     |

### Benchmarks CI Gate (iterações=50)

| Métrica                      | p50     | p95     | ops/s     |
| ---------------------------- | ------- | ------- | --------- |
| readBytes:small:cold         | 0.681ms | 1.748ms | 1.164     |
| readBytes:small:hot (L1 hit) | 0.008ms | 0.050ms | 67.517    |
| readText:medium:hot          | 0.125ms | 0.310ms | 3.921     |
| parseSymbols:small:hot       | 0.001ms | 0.001ms | 1.048.130 |

**L1 cache hit: 58x mais rápido que cold read.** **Parser LRU hit: ~1M ops/s (sub-microsegundo).**

### Próximos passos recomendados

1. Fechar chave de cache com `mtime/size` (reduz stale em edge cases de escrita concorrente).
2. Medir JSON.parse vs `stream-json` para payloads >1MB (R8 passo 2).
3. Implementar watcher strategy (R7) para invalidação automática de L1 + parser cache via
   `fs.watch`.
4. Implementar L2 cache (SQLite ou memória persistida) para símbolos entre restarts (R6).
5. Integrar `io-session-scope` com LLM-B API endpoint para declaração via HTTP.

## Atualização 2026-05-07 — Corte A.13.2 — benchmark contínuo e robustez de evidência

Transformações aplicadas:

- `benchmarks/io-read-benchmark.mjs` recebeu cenário adicional `map.get baseline [size]` para
  comparação explícita entre:
  - lookup do L1 canônico (`l1-cache.get`),
  - baseline de `Map#get` puro,
  - `lru-cache.get` em instância sintética.
- Nova rodada formal de benchmark Node executada com saída versionada em
  `benchmarks/io-read-benchmark-results.json`.
- Nova rodada `hyperfine` executada para R12:
  - `benchmarks/hyperfine-rg-a13.json`;
  - `benchmarks/hyperfine-scan-a13.json`.

Resultados consolidados da rodada:

- `l1-cache.get` entre ~7.4M e ~8.3M op/s;
- `map.get baseline` entre ~13.7M e ~14.8M op/s;
- `lru-cache.get` sintético entre ~17.0M e ~17.7M op/s;
- `rg "io-engine" src/copilot/` em ~11ms mean;
- `scanDirectory` depth=3 em ~270ms mean (`showHidden` off/on).

Leitura executiva:

1. O hot path de cache permanece em ordem de milhões de op/s; não há sinal de gargalo crítico no
   lookup do L1 canônico.
2. R6 segue **não liberado por latência** nesta rodada (busca textual `rg` muito abaixo do gatilho
   atual).
3. R7 segue **não liberado por custo de scan** nesta rodada; watcher continua condicionado à
   frequência de re-scan por path.
4. A decisão de arquitetura permanece evidência-first, sem ativação prematura de complexidade.

## Atualização 2026-05-07 — Corte A.13.3 — preparação L2/L3 + integração de tools para LLM-B

Transformações aplicadas:

- Fundação de cache L2 (SQLite) adicionada de forma **gradual e feature-flagged**:
  - `src/copilot/infra/io-cache-l2-sqlite.js` com TTL, `maxEntries`, invalidação por path e stats;
  - `src/copilot/infra/io-cache-l2-registry.js` com ativação por `IO_L2_CACHE_ENABLED=1`;
  - migração DB v9 `create_io_cache_l2_entries` em `src/copilot/db/migrations.js`.
- `io-engine` recebeu preparação para tiered cache sem quebrar fluxo atual:
  - read-through opcional em L2 após miss de L1;
  - write-through para L2 em leituras bem-sucedidas quando L2 ativo;
  - invalidação destrutiva unificada L1+L2 (`invalidateIoCacheTiers`).
- Planejamento canônico de tiers criado em `src/copilot/infra/io-cache-tiering.js`:
  - plano `l1/l2/l3` com recomendações por contexto;
  - agregação de stats cross-tier para observabilidade futura.
- Integração de tools para continuidade operacional da LLM-B:
  - novo módulo `src/copilot/tools/file/scope-tools.js` com:
    - `workspace_scope_declare`;
    - `workspace_scope_refresh`;
    - `workspace_scope_context`;
    - `workspace_scope_find_symbol`.
  - `src/copilot/tools/file/index.js` atualizado para publicar e registrar essas tools no conjunto
    canônico de file-tools.

Validação incremental prevista/executada no corte:

- testes unitários de `io-cache-l2-sqlite`, `io-cache-tiering`, `scope-tools`;
- reteste de `io-engine` e `io-cache` para preservar contrato de cache hit/miss;
- `npm run typecheck:strict:src.copilot` após integração.

Backlog incremental pós A.13.3:

1. Expor stats L2/L3 no `/observability/health` em formato canônico por tier.
2. Rodar soak test com `IO_L2_CACHE_ENABLED=1` e medir hit-ratio real por workspace.
3. Definir contrato de invalidação distribuída para L3 apenas após evidência de necessidade.
4. Integrar sugestões automáticas de `/workspace_scope_context` no guidance da LLM-B
   (auto-briefing).

## Atualização 2026-05-07 — Revisão documental profunda AS-IS/TO-BE/roadmap

Objetivo deste corte documental:

- estabilizar a visão corrente antes de novas transformações amplas;
- distinguir o que já existe, o que está parcial e o que ainda é alvo ideal;
- explicitar a ordem canônica para leitura, escrita, busca, scope, parsing, indexação, cache
  L1/L2/L3, buffer, watcher, observability e UX da LLM-B.

Diagnóstico consolidado:

1. O núcleo de I/O local já é real: `io-engine`, `io-policy`, `io-locks`, `io-scanner`,
   `io-observability`, file-tools e Session FS convergem para uma superfície comum.
2. O cache L1 deixou de ser intenção e virou componente técnico relevante: `lru-cache@11`, max
   bytes, TTL, stale probe por `mtime/size`, hooks de invalidação e integração com
   `readBytes/readText`.
3. O L2 SQLite existe como cache feature-flagged (`IO_L2_CACHE_ENABLED=1`), mas ainda não é índice
   textual/simbólico nem surface de observability completa.
4. O parser Babel e o scope LLM-B existem, mas ainda precisam endurecer contratos: limites devem ser
   informativos, `scope-tools` precisam abandonar tetos Zod bloqueantes, e o scope precisa aparecer
   em terminal/HTTP/auto-briefing.
5. O scanner ainda é a peça mais importante para fechar R6/R7/R17: falta `.gitignore`, concorrência,
   fingerprints, freshness e watcher strategy.
6. A busca ainda é `rg`/`grep` sem índice de arquivos. Isso é aceitável pelos benchmarks atuais, mas
   não é o estado ideal para workspaces grandes e sessões longas.
7. A UX live do terminal já mostra tool/I/O real, mas ainda não agrupa por `traceId`/`toolCallId`
   nem mostra saúde de cache/index/scope no mesmo plano.

Documentos gerados neste corte:

- `2026-05-07-AS-IS-IO-READ-WRITE-SCOPE-CACHE.md`;
- `2026-05-07-ARQUITETURA-ALVO-IO-INTELIGENTE-L1-L2-L3.md`;
- `2026-05-07-ROADMAP-IO-INTELIGENTE-COMPLETO.md`.

Decisão executiva:

- próxima implementação deve começar por A.16, não por FTS/watcher diretamente;
- A.16 deve limpar contratos existentes, remover limites bloqueantes restantes, expor health/stats e
  rodar gates;
- apenas depois o scanner 2.0 e o índice L2/FTS devem ser promovidos.

## Atualização 2026-05-07 — Corte A.16/A.17/A.21 — scope visível, scanner 2.0 parcial e invalidação automática

Transformações aplicadas:

- A.16 avançou para estado operacional:
  - `scope-tools` deixou de impor tetos bloqueantes para `maxFiles`, `concurrency`, `include`,
    `exclude` e `modifiedPaths`;
  - limites passaram a ser `advisoryLimits` informativos;
  - `workspace_scope_declare` aplica `include`, `exclude` e `recursive` de fato;
  - `io-health` consolida L1/L2/L3, parser e scopes ativos;
  - `/status`, `/live` e `/observability/health` mostram saúde básica de cache/scope/parser.
- A.17 recebeu scanner 2.0 parcial:
  - `ignore` + `.gitignore` sob opção explícita;
  - `p-limit` para concorrência de `lstat`;
  - filtros `include/exclude`;
  - fingerprint inicial `mtimeMs + size`;
  - `maxFiles` permanece advisory e não corta escopo.
- A.21 recebeu UX terminal e simetria de tools:
  - novo `/scope list|declare|context|find|refresh|close`;
  - `/help` e banner do REPL atualizados;
  - tools novas `workspace_scope_list` e `workspace_scope_close`;
  - invalidação automática: escrita/invalidação pela `io-engine` remove símbolo stale dos escopos
    afetados e marca `invalidated`, permitindo `refreshScope` reindexar a versão nova.
- A.24 recebeu correção oportunista de segurança:
  - `web_fetch_local` passou a seguir redirects manualmente com `redirect: 'manual'`;
  - cada `Location` intermediário é validado por `evaluateIoUrlPolicy`;
  - `response.url` final também é validado, cobrindo runtimes/mocks que entregam URL final privada
    mesmo sem status 3xx.

Validação executada nesta rodada:

- `npm run typecheck:strict:src.copilot`;
- `npx vitest run tests/unit/copilot/infra/test_io_engine.spec.js tests/unit/copilot/tools/file/test_read_tools.spec.js tests/unit/copilot/infra/test_io_prefetch.spec.js tests/unit/copilot/infra/test_io_session_scope.spec.js tests/unit/copilot/tools/file/test_scope_tools.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/test_observability_sdk_fs_routing.spec.js --reporter=dot`;
- `npx vitest run tests/unit/copilot/terminal/test_commands_scope.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/infra/test_io_engine.spec.js tests/unit/copilot/infra/test_io_session_scope.spec.js tests/unit/copilot/infra/test_io_prefetch.spec.js tests/unit/copilot/tools/file/test_scope_tools.spec.js --reporter=dot`;
- `npx vitest run tests/unit/copilot/tools/file/test_scope_tools.spec.js tests/unit/copilot/terminal/test_commands_scope.spec.js tests/unit/copilot/infra/test_io_session_scope.spec.js --reporter=dot`.
- `npm run test:copilot:unit`.
- `npm run lint`.
- `npm run format:check`.

Pendências remanescentes:

1. A.17: completar `realpath`/symlink, hash opcional e eventos `scan.start/progress/complete/error`.
2. A.18: criar canais próprios `copilot.io.cache`, `copilot.io.index`, `copilot.io.scope` e métricas
   `prom-client`.
3. A.19/A.20: separar schema de cache blob versus índice e decidir FTS por benchmark.
4. A.21: persistir símbolos em L2 e integrar recomendações de scope no auto-briefing.
5. A.22/A.23: formalizar grandes arquivos/chunking e watcher strategy.

## Atualização 2026-05-07 — Corte A.20/A.21 — índice L2 local com metadados, FTS e símbolos

Transformações aplicadas:

- Separação explícita de funções:
  - L1 = cache quente em memória do processo;
  - L2 cache blob = payloads persistidos para reduzir cold reads;
  - L2 índice = metadados pesquisáveis, FTS textual, símbolos Babel e imports;
  - L3 = camada futura para compartilhamento/distribuição multi-runtime.
- Novo índice persistente:
  - `src/copilot/infra/io-index-sqlite.js`;
  - `src/copilot/infra/io-index-registry.js`;
  - migration v10 `create_io_index_l2`.
- Metadados persistidos por arquivo:
  - workspace root, path relativo, nome, extensão, content kind;
  - size/mtime/ctime, SHA-256, linhas, contagem de símbolos/imports;
  - status, parse error, timestamps e `metadata_json` com fingerprint/trace.
- Superfícies canônicas novas:
  - infra: `buildIoIndexForDirectory`, `getIoIndexStats`, `searchIoIndex`, `findIoIndexSymbol`,
    `invalidateIoIndexPath`;
  - tools: `workspace_index_build`, `workspace_index_status`, `workspace_index_search`,
    `workspace_index_find_symbol`.
- Integração automática:
  - `workspace_scope_declare`/`declareScope` em diretório constroem índice por padrão
    (`indexMode: auto`);
  - hooks de invalidação da `io-engine` removem índice stale por path.
- Observability:
  - `/observability/health`, `/status` e `/live` passam a expor disponibilidade/contagem do índice.

Pendências remanescentes:

1. Comparação incremental por fingerprint antes de reindexar.
2. Chunks persistentes para arquivos grandes e busca paginável.
3. Engine selector de `search_in_files`: FTS quando fresco, `rg` quando regex/fallback.
4. Benchmarks FTS vs `rg` em `src/copilot` e workloads grandes.
5. Canais dedicados `copilot.io.index` e métricas `prom-client`.

## Referências consultadas

- Node.js v24.15.0 File System API: https://nodejs.org/docs/latest-v24.x/api/fs.html
- Node.js v24.15.0 Stream API: https://nodejs.org/docs/latest-v24.x/api/stream.html
- Node.js v24.15.0 Buffer API: https://nodejs.org/docs/latest-v24.x/api/buffer.html
- Node.js v24.15.0 Performance Hooks: https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html
- Node.js v24.15.0 Worker Threads: https://nodejs.org/docs/latest-v24.x/api/worker_threads.html
- Node.js v24.15.0 Diagnostics Channel:
  https://nodejs.org/docs/latest-v24.x/api/diagnostics_channel.html
- Node.js v24.15.0 SQLite: https://nodejs.org/docs/latest-v24.x/api/sqlite.html
