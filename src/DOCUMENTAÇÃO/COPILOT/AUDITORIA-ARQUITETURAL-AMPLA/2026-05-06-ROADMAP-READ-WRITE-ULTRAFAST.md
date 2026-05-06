# Roadmap - Read/Write/Search/Scan ultrarrápido e canônico

Data base: 2026-05-06 Escopo: `src/copilot/**` Status: investigação concluída; execução autorizada
por continuidade explícita e em convergência incremental

## Objetivo

Migrar as superfícies de leitura, escrita, busca, scan, parsing e indexação de `src/copilot` para
uma arquitetura única, segura, observável e otimizada para Node 24+.

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

- [ ] Extrair regras de `validatePath()` para `core/io-policy` ou `infra/io-policy`.
- [ ] Compartilhar denylist de segredos, executáveis, diretórios e symlinks.
- [ ] Definir limites por operação em configuração central.
- [ ] Unificar truncamento por bytes e UTF-8 safe.
- [ ] Unificar sanitização de output sensível.
- [ ] Incluir URL policy do `web-tools` na mesma família conceitual.
- [ ] Criar testes de path traversal, symlink, byte nulo e arquivo bloqueado.

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
- [~] Criar testes de duas escritas simultâneas no mesmo arquivo. - 2026-05-06: testes novos cobrem
  copy aguardando lock ativo no source e lock pendente com timeout/abort; ainda falta bateria
  específica write vs write.
- [ ] Criar testes de write versus move/delete.
- [ ] Avaliar `worker_threads.locks` apenas como spike futuro.

Critério de pronto:

- mutações concorrentes no mesmo path são serializadas;
- conflito é observável;
- lock não fica preso após erro.

## R5 - Cache L1 por bytes e invalidação

Prioridade: P1 Risco: médio Objetivo: reduzir leituras repetidas sem entregar conteúdo stale.

Tarefas:

- [ ] Definir cache key com realpath, operação, opções, size e mtime.
- [ ] Implementar L1 por bytes e TTL.
- [ ] Invalidar por path em write/delete/move/patch.
- [ ] Adicionar stats: hits, misses, evictions, stale, bytes.
- [ ] Migrar `runtime-file-context` para o cache comum.
- [ ] Benchmark da implementação caseira versus `lru-cache`.
- [ ] Promover `lru-cache` a dependência direta apenas se vencer em simplicidade/performance.

Critério de pronto:

- cache hit aparece em `io.cache`;
- write invalida read;
- testes provam ausência de stale.

## R6 - Índice L2 SQLite e FTS5 para arquivos

Prioridade: P1 Risco: alto Objetivo: criar busca textual incremental para workspace.

Tarefas:

- [ ] Definir schema `copilot_io_files`, `copilot_io_file_chunks`, `copilot_io_fts`.
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
  comum existe com depth, hidden, filtro simples e metadata `io`; `.gitignore`/denylist seguem para
  R2/R7.
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
- [~] Migrar `createLocalSessionFsProvider` para engine ou adapter de policy equivalente. -
  2026-05-06: `writeFile`, `appendFile` e `rename` usam engine/locks; `rm`, `readFile`, `stat` e
  `readdir` ainda usam FS direto por compatibilidade.
- [x] Adicionar atomic write ao Session FS.
- [~] Adicionar limites e lock ao Session FS. - 2026-05-06: writes/appends/renames têm locks e
  metadata; faltam timeout/abort e lock para remoção recursiva.
- [ ] Unificar métricas SDK com metadata `io`.

Critério de pronto:

- attachments, terminal e SDK leem/escrevem com a mesma política;
- cache de file-context é versionado;
- path traversal e symlink têm comportamento igual nas bordas.

## R12 - Benchmark, gates e Dockerfile

Prioridade: P1 contínuo Risco: baixo/médio Objetivo: transformar escolhas em evidência.

Tarefas:

- [ ] Criar benchmark com `hyperfine` para `rg`, FTS, scan frio e scan quente.
- [ ] Criar benchmark Node com `perf_hooks` ou `tinybench` se promovido.
- [ ] Medir `readFile` versus stream por tamanho.
- [ ] Medir LRU caseira versus `lru-cache`.
- [ ] Medir JSON.parse versus `stream-json` em payloads grandes.
- [ ] Só então alterar `package.json` e, se necessário, Dockerfile.
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

## Dependências candidatas por decisão

| Dependência           | Decisão atual       | Condição para entrada                             |
| --------------------- | ------------------- | ------------------------------------------------- |
| `lru-cache`           | Não adicionar ainda | Benchmark ou complexidade justificar L1 por bytes |
| `stream-json`         | Candidata forte     | JSON/JSONL grande virar caso real de runtime      |
| `fast-json-stringify` | Candidata moderada  | Respostas estáveis aparecerem como gargalo        |
| `@parcel/watcher`     | Candidata futura    | Watchman/fs.watch falharem em portabilidade       |
| `chokidar`            | Candidata futura    | Necessidade de watcher JS multiplataforma         |
| `tinybench`           | Candidata dev       | Benchmarks JS virarem gate permanente             |

## Critério de pronto final

- `src/copilot` tem um contrato único de I/O.
- File-tools são adapters, não engines.
- Session FS, terminal e presentation compartilham policy.
- Writes destrutivos têm lock por recurso.
- Cache L1 é seguro contra stale.
- Índice L2 acelera busca textual comum.
- RAG permanece busca semântica complementar.
- Observabilidade mostra latência, engine, cache, lock, truncamento e erro.
- Dockerfile e dependências refletem evidência, não intenção.

## Referências consultadas

- Node.js v24.15.0 File System API: https://nodejs.org/docs/latest-v24.x/api/fs.html
- Node.js v24.15.0 Stream API: https://nodejs.org/docs/latest-v24.x/api/stream.html
- Node.js v24.15.0 Buffer API: https://nodejs.org/docs/latest-v24.x/api/buffer.html
- Node.js v24.15.0 Performance Hooks: https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html
- Node.js v24.15.0 Worker Threads: https://nodejs.org/docs/latest-v24.x/api/worker_threads.html
- Node.js v24.15.0 Diagnostics Channel:
  https://nodejs.org/docs/latest-v24.x/api/diagnostics_channel.html
- Node.js v24.15.0 SQLite: https://nodejs.org/docs/latest-v24.x/api/sqlite.html
