# Auditoria profunda de `src/copilot` — foco em Infra IO, performance, locks e corrupção de arquivos

**Data:** 2026-06-12  
**Escopo primário:** `src/copilot/infra/io/**`  
**Escopo ampliado:** `src/copilot/infra` adjacente, usos diretos de filesystem em `src/copilot`, runtime Node 24.5+  
**Objetivo:** verificar se a infraestrutura de IO faz o que promete sob concorrência, falhas, cache, locks, edge cases e risco de corrupção; propor estado ideal e roadmap faseado.

---

## 1. Sumário executivo

A infra IO de `src/copilot` já é substancialmente superior a um uso ingênuo de `fs/promises`: há fachada pública, locks assíncronos por recurso, escrita por temp+rename, `expectedHash`, cache L1 com fingerprint, L2/índice SQLite preparados, scanner com denylist/gitignore, parser em workers e observabilidade por `diagnostics_channel`.

Ainda assim, para a ambição declarada de ser a camada canônica e segura de mutação do workspace, há lacunas importantes. A maior diferença entre o estado atual e o estado ideal está em **durabilidade de crash**, **garantia multiprocess**, **snapshot consistente**, **bypass de bordas**, e **edge cases de cache/UTF-8**.

Os achados mais críticos desta auditoria são:

1. **Escrita atômica não é crash-durable:** `write-atomic.js` usa `writeFile(tmp)` + `rename`, mas não faz `flush`, `fsync`/`filehandle.sync()` nem sync do diretório.
2. **Locks são apenas intra-processo:** `io-locks.js` serializa chamadas dentro do processo Node atual, mas não impede concorrência de outro processo Node, terminal, editor, Git ou ferramenta externa.
3. **`io-prefetch` pode envenenar cache textual com bytes inválidos:** `warmSinglePath()` usa `Buffer.toString('utf8')` sem validação, enquanto `readText()` valida UTF-8 quando lê do disco. Isso permite que uma leitura textual futura sirva string cacheada com U+FFFD, pulando a barreira binária.
4. **`patchTextLocked` lê com `fs.readFile(..., 'utf8')`:** arquivos binários ou UTF-8 inválidos podem ser decodificados com substituição silenciosa e depois regravados.
5. **Move cross-device (`EXDEV`) é frágil:** fallback `copyFile` + `unlink` não verifica hash/tamanho pós-cópia, não fsynca, e não tem rollback robusto.
6. **TOCTOU em create/copy:** `failIfExists` e `overwrite=false` dependem de `access()` antes de escrever/copiar, sem `O_EXCL`/`COPYFILE_EXCL`; proteção atual é só intra-processo.
7. **Snapshots de leitura misturam `readFile` e `stat` em paralelo:** conteúdo e metadados podem vir de versões diferentes do arquivo.
8. **Há bypasses reais fora da fachada IO:** audit logs, SSE archive, export terminal e store usam `appendFile`, `rename`, `writeFile` ou `readFile` diretamente.
9. **Invalidação derivada pode ser atrasada:** bus debounced pode deixar parser/line-offset/index derivados em janela curta de stale read-after-write.
10. **O rollback de patch é limitado:** snapshot base64 só é retido até orçamento; arquivos grandes ficam sem rollback material completo.

Conclusão: o projeto está em boa posição para evoluir para uma camada IO de alta confiabilidade, mas a situação atual ainda é melhor descrita como **atomicidade lógica intra-processo + cache inteligente**, não como **durabilidade transacional contra crash ou concorrência externa**.

### 1.1 Status de implementação — Faixa 0 aplicada em 2026-06-12

A primeira rodada de implementação da Faixa 0 foi aplicada e validada sobre `src/copilot`.

Mudanças efetivamente incorporadas:

- `io-prefetch` deixou de transformar bytes em texto com `Buffer.toString('utf8')` sem validação; agora reutiliza a validação UTF-8 canônica da infra.
- `patchTextLocked` deixou de ler texto com decodificação substitutiva silenciosa; agora lê bytes crus, valida UTF-8 em runtime real e preserva compatibilidade com mocks legados que retornam `string`.
- `writeAtomicFileUnlocked` recebeu caminho exclusivo baseado em hard link atômico (`link(tmp, target)`) quando disponível e fallback seguro por `writeFile(..., flag: 'wx')` quando `link` não existe; em modo exclusivo ele não faz `rename` destrutivo.
- `writeFileAtomic(..., { failIfExists: true })` voltou a emitir mensagem humana estável para destino existente, mas mantém enforcement real por exclusividade para reduzir TOCTOU.
- `copyFileLocked(..., { overwrite: false })` passou a usar `COPYFILE_EXCL`, tornando a cópia sem overwrite uma operação realmente exclusiva no destino.
- `json-store` passou a usar `writeFileAtomicPortable`, removendo bypass direto de `writeAtomicFileUnlocked` fora da camada de lock portátil.
- `/export` do terminal passou a usar `writeFileAtomicPortable`, removendo `mkdir` + `writeFile` direto e preservando suporte a paths explicitamente externos ao workspace.
- Testes foram atualizados/adicionados para UTF-8 inválido no prefetch, patch binário sem regravação, create exclusivo e contratos de export/copy.
- O scanner `mcp_apps_sdk_readiness` foi ajustado para detectar `search`/`fetch` declarados via constantes, fechando regressão do CDEX-062 que apareceu durante a validação global.

Validação após hardening:

- `typecheck:strict:src.copilot`: **PASS** (`69c181d5-ea28-4efe-9521-15b2b6385754`).
- `lint:copilot`: **PASS** dentro da suíte final.
- `copilot-fast`: **PASS** (`baa77bf3-585f-46e7-a744-e0032ed550e4`).
- Unitários Copilot: **6458 total, 6430 passados, 0 falhas, 28 pending**.

Riscos ainda não encerrados pela Faixa 0:

- A escrita ainda não é crash-durable: faltam `flush`/`FileHandle.sync()` e sync do diretório.
- Os locks continuam intra-processo; ainda não há lockfile multiprocess com stale-lock recovery.
- O fallback `EXDEV` de move ainda precisa verificação pós-cópia por hash/tamanho e rollback mais forte.
- `appendFile`/logs e SSE archive ainda precisam entrar em uma política explícita de append-only, flush e rotação segura.

### 1.2 Status de implementação — Faixa 1 aplicada em 2026-06-12

A primeira rodada da Faixa 1 foi implementada e validada. O foco foi reduzir risco de perda/corrupção em crash parcial e tornar `move` cross-device verificável.

Mudanças efetivamente incorporadas:

- Novo módulo `src/copilot/infra/io/fs/durability.js` com normalização de durabilidade, `syncFileBestEffort()` e `syncParentDirectoryBestEffort()`.
- `writeAtomicFileUnlocked()` agora aceita `durability: 'none' | 'file' | 'file-and-directory'`, com default `file-and-directory`.
- Escrita atômica passou a gravar temp file com `flag: 'wx'`; quando a durabilidade exige flush, usa `fsPromises.writeFile(..., { flush: true })`.
- Após publicar por `rename` ou `link` exclusivo, o writer tenta sincronizar o diretório pai em modo best-effort, registrando o resultado em vez de falhar quando o filesystem/plataforma não suporta directory sync.
- `moveFileUnlocked()` agora retorna metadados de publicação: `crossDevice`, `duplicatedAfterCrossDeviceMove`, `sourceUnlinkErrorCode`, `destinationHash` e `destinationBytes`.
- O fallback `EXDEV` deixou de ser `copyFile(source, destination) + unlink(source)`; agora copia para temp no diretório destino, valida hash/tamanho da origem e do temp, sincroniza o temp, publica por `rename` ou `link`, sincroniza diretório e só então remove a origem.
- `moveFileLocked()` propaga os metadados EXDEV para `io.advisoryLimits` e para o resultado interno.
- A tool pública `move_file` passou a expor os metadados EXDEV, permitindo que callers saibam quando houve publicação cross-device e se ocorreu duplicação porque a origem não pôde ser removida.
- Testes foram atualizados para o contrato durável do writer (`flag: 'wx'`, `flush: true`) e adicionado cenário EXDEV cobrindo publicação via temp verificado antes da remoção da origem.

Validação após implementação:

- `typecheck:strict:src.copilot`: **PASS** (`13e5a891-bafa-4baa-b4e5-331adc541fb5`).
- `lint:copilot`: **PASS** (`a0844676-5357-45f9-ae40-4ee30260fbeb`).
- `copilot-fast`: **PASS** (`f2c48857-8c99-4854-abf6-b141c2c724a0`).
- Unitários Copilot: **6459 total, 6431 passados, 0 falhas, 28 pending**.

Riscos ainda não encerrados pela Faixa 1:

- Directory sync permanece best-effort porque nem toda plataforma/filesystem permite abrir/sincronizar diretórios de forma uniforme.
- Ainda não há lockfile multiprocess; os locks continuam coordenando apenas concorrência cooperativa dentro do processo Node atual.
- Append-only/audit/SSE ainda precisam wrapper dedicado com framing, flush configurável, rotação sob lock e recovery de linha parcial.
- Ainda faltam testes de chaos/crash-injection reais nos pontos entre write temp, flush, publish e directory sync.

### 1.3 Status de implementação — Faixa 2.1 aplicada em 2026-06-12

A primeira rodada da Faixa 2 foi implementada no escopo **Fase 2.1 — Lockfile opcional**. O objetivo foi preservar o lock L0 em memória, já validado, e adicionar um L1 multiprocess opt-in, ativável por env/option, sem mudar o comportamento default das tools.

Mudanças efetivamente incorporadas:

- Novo módulo `src/copilot/infra/locks/file-resource-lock.js` com lockfile L1 por criação exclusiva `open(lock, 'wx')`.
- O diretório de lock é configurável por `COPILOT_IO_FILE_LOCK_DIR`; quando ausente, usa `src/copilot/.ai/locks` sob o workspace atual.
- A ativação global é opt-in por `COPILOT_IO_FILE_LOCKS_ENABLED=1`; também há caminho por opção explícita `fileLock: true` em `acquireIoResourceLock()`.
- Metadata do lockfile inclui `schemaVersion`, `token`, `pid`, `hostname`, `resourceKey`, `resourceHash`, `operation`, `target`, `startedAt` e `startedAtMs`.
- A aquisição detecta locks stale por metadata inválida, idade máxima (`COPILOT_IO_FILE_LOCK_STALE_MS`) ou PID morto; a recuperação valida o token observado antes de remover o arquivo antigo.
- `io-locks.js` agora integra L0+L1: primeiro passa pela fila in-memory e, quando habilitado, adquire o lockfile antes de liberar a operação protegida.
- `getIoLockStats()` agora reporta também `fileLocks.enabledByEnv`, `fileLocks.activeLeases` e `fileLocks.lockDir`.
- Testes unitários cobrem criação/release de lockfile L1 e recuperação de lock stale por PID morto.
- Durante a validação, foi corrigido um bug de robustez no parser JS/TS: orçamento excedido agora vira `parseError`/telemetria, mas não descarta símbolos quando o AST já foi produzido.

Validação após implementação:

- `typecheck:strict:src.copilot`: **PASS** (`b050a640-ae61-412c-bdfe-32e5553d6036`).
- `lint:copilot`: **PASS** (`615c63e5-27ab-46e7-b29a-6f602d97bb1c`).
- `unit-copilot`: **PASS** (`c42aa252-74cd-40e6-84f0-14a7ec194e99`).
- Unitários Copilot: **6461 total, 6433 passados, 0 falhas, 28 pending**.
- Observação: uma execução agregada `copilot-fast` (`1ea5dffa-db63-48ec-aaed-781693e8874a`) passou por typecheck/lint, mas ficou sem finalizar o trecho unitário dentro da janela operacional e foi cancelada. A validação equivalente por etapas independentes ficou verde.

Riscos ainda não encerrados pela Faixa 2.1:

- O lockfile L1 ainda é opt-in; não foi ligado automaticamente para todos os callsites P0/P1.
- `release()` no lease público continua síncrono para preservar compatibilidade; a remoção do lockfile é disparada em best-effort. Uma API futura `releaseAsync`/`asyncDispose` determinística pode ser necessária para callsites críticos.
- Ainda não há heartbeat periódico para locks longos; a recuperação depende de TTL/PID.
- A divisão `workspaceIo` versus `trustedPortableIo` permanece para a Fase 2.2.
- Observabilidade avançada de p95/histograma de espera de locks permanece para a Fase 2.3.

---

## 2. Evidência de leitura integral

### 2.1 Arquivos lidos integralmente em `src/copilot/infra/io/**`

Foram lidos completamente todos os arquivos diretamente sob a árvore de infra IO:

| Área | Arquivos |
| --- | --- |
| `fs` | `append.js`, `copy.js`, `index.js`, `line-offset-cache.js`, `locked-mutations.js`, `locked-writes.js`, `mkdir.js`, `move.js`, `portable-atomic.js`, `read-bytes.js`, `read-chunks.js`, `read-lines.js`, `read-services.js`, `read-text.js`, `remove.js`, `snapshot.js`, `stat.js`, `write-atomic.js` |
| `invalidation` | `bus.js`, `cache-tiers.js`, `events.js`, `index.js` |
| `patch` | `index.js`, `text-diff-service.js`, `text-diff.js`, `text-patch.js` |
| `search` | `grep-adapter.js`, `index-search.js`, `index.js`, `result-paginator.js`, `subprocess.js`, `symbol-search.js`, `text-search.js` |

### 2.2 Arquivos adjacentes lidos integralmente

Também foram lidos os módulos que efetivamente governam comportamento, política, cache, índice, prefetch, parser, scanner e observabilidade:

- `src/copilot/infra/io-locks.js`
- `src/copilot/infra/io-engine.js`
- `src/copilot/infra/io-cache.js`
- `src/copilot/infra/io-cache-l2-registry.js`
- `src/copilot/infra/io-cache-l2-sqlite.js`
- `src/copilot/infra/io-cache-tiering.js`
- `src/copilot/infra/io-observability.js`
- `src/copilot/infra/io-index-registry.js`
- `src/copilot/infra/io-index-sqlite.js`
- `src/copilot/infra/io-parser.js`
- `src/copilot/infra/io-parser-worker.js`
- `src/copilot/infra/io-prefetch.js`
- `src/copilot/infra/io-scanner.js`
- `src/copilot/infra/io-health.js`
- `src/copilot/infra/io-session-scope.js`
- `src/copilot/infra/policy/path-resource.js`
- `src/copilot/infra/policy/preconditions.js`
- `src/copilot/infra/policy/budgets.js`
- `src/copilot/infra/policy/output-window.js`
- `src/copilot/infra/policy/capabilities.js`
- `src/copilot/infra/policy/risk.js`
- `src/copilot/infra/policy/index.js`
- `src/copilot/infra/shared/buffer.js`
- `src/copilot/infra/shared/fingerprint-match.js`
- `src/copilot/infra/shared/hash.js`
- `src/copilot/infra/shared/env.js`
- `src/copilot/infra/shared/index.js`
- `src/copilot/infra/scan/batching.js`
- `src/copilot/infra/scan/fingerprint.js`
- `src/copilot/infra/scan/gitignore.js`
- `src/copilot/infra/scan/glob.js`
- `src/copilot/infra/scan/index.js`
- `src/copilot/infra/public/io.js`

### 2.3 Busca ampla por bypasses de filesystem

Foi feita busca textual em `src/copilot` por chamadas diretas a `writeFile`, `appendFile`, `rename`, `copyFile`, `unlink`, `rm`, `createReadStream`, `createWriteStream`, `readFile` e `readdir`. Achados relevantes fora da fachada IO:

- `src/copilot/audit/jsonl-writer.js`: `rename`, `appendFile`.
- `src/copilot/audit/pipeline-permission.js`: `rename`, `appendFile`.
- `src/copilot/audit/pipeline-audit-log.js`: `rename`, `appendFile`.
- `src/copilot/terminal/state/sse-event-archive.js`: `appendFile`.
- `src/copilot/terminal/commands/export.js`: `writeFile`.
- `src/copilot/terminal/stores/alias-store.js`: usa `writeFileAtomicPortable`, mas lê com `readFile` direto.
- `src/copilot/infra/storage/json-store.js`: usa `writeAtomicFileUnlocked` diretamente.
- `src/copilot/terminal/commands/byok.js`: `fs.readdir` em helper local.
- `src/copilot/plugins/plugin-registry.js`: `readdir` direto, aceitável para descoberta, mas fora da fachada.

Esse ponto é particularmente importante porque `src/copilot/infra/README.md` orienta que novas leituras/escritas em tools/bordas passem por fachada pública, não por `fs.readFile`/`fs.writeFile` direto.

---

## 3. Documentação oficial Node 24.5+/24.x: implicações para este projeto

### 3.1 Primitivas assíncronas de FS não são sincronizadas

A documentação oficial do Node afirma que as Promise APIs de filesystem usam o threadpool e que essas operações não são sincronizadas nem thread-safe; modificações concorrentes no mesmo arquivo podem causar corrupção de dados.

**Implicação:** a existência de `fsPromises.writeFile`, `rename`, `appendFile` e `copyFile` não elimina a necessidade de locks de aplicação. O projeto já tem locks intra-processo, mas ainda precisa de uma história explícita para concorrência externa/multiprocess.

Referência: https://nodejs.org/docs/latest-v24.x/api/fs.html#threadpool-usage

### 3.2 `fsPromises.writeFile` é conveniência, não primitiva ideal de hot path

A documentação oficial avisa que é inseguro chamar `fsPromises.writeFile()` múltiplas vezes no mesmo arquivo sem aguardar a promise anterior e que `writeFile` executa múltiplas chamadas de write internamente; para código sensível a performance, recomenda stream.

**Implicação:** `write-atomic.js` hoje usa `writeFile(tmp)`. Isso é aceitável para arquivos pequenos/médios e com lock intra-processo, mas a camada ideal deve ter caminho explícito para payloads grandes com `FileHandle`/stream e sync controlado.

Referência: https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromiseswritefilefile-data-options

### 3.3 `flush` existe para `writeFile`, `appendFile` e streams

Em Node 24.x, `writeFile`, `appendFile` e `createWriteStream` suportam opção `flush`. Para `fsPromises.writeFile`, quando `flush: true`, o Node usa `filehandle.sync()` depois de escrever o conteúdo.

**Implicação:** em Node 24.5+ podemos implementar uma primeira camada de durabilidade com `flush: true`, mas a versão ideal para atomic replace ainda deve considerar sync do diretório após `rename`, porque o flush do arquivo temporário não necessariamente persiste a entrada de diretório renomeada.

Referência: https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromiseswritefilefile-data-options

### 3.4 `mkdtempDisposable` existe em Node 24.4+

`fsPromises.mkdtempDisposable()` foi adicionado em Node 24.4.0 e retorna um objeto descartável assíncrono para uso com `await using`.

**Implicação:** para planos de patch, testes de crash, snapshots e staged writes, podemos usar diretórios temporários descartáveis sem acumular lixo em `.ai/tmp` ou `os.tmpdir()`. Contudo, para atomic replace final, o temp file deve continuar no mesmo diretório do destino quando a garantia principal for `rename` atômico no mesmo filesystem.

Referência: https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesmkdtempdisposableprefix-options

### 3.5 `statfs` pode apoiar preflight de espaço livre

`fsPromises.statfs()` retorna informações do filesystem de um path.

**Implicação:** antes de mover/copiar/gravar arquivos grandes, a engine pode estimar `bavail * bsize` e bloquear operações com risco de ENOSPC parcial, ou ao menos registrar warning e telemetry.

Referência: https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesstatfspath-options

### 3.6 `fsPromises.glob` está estável em Node 24, mas cuidado com opções pós-24.5

A documentação de Node 24.x marca `fsPromises.glob()` como estável em Node 24.0.0, mas mostra que `followSymlinks` só foi adicionado em Node 24.16.0.

**Implicação:** em runtime alvo 24.5, `glob` já pode substituir parte do scanner em cenários simples, mas não devemos depender de `followSymlinks` se a matriz real for 24.5. Para segurança, a política atual de não seguir symlinks por padrão deve permanecer.

Referência: https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesglobpattern-options

---

## 4. Arquitetura atual da infra IO

### 4.1 Fachada pública

`src/copilot/infra/public/io.js` exporta a superfície pública de IO para consumidores fora de `infra`:

- leitura: `readBytes`, `readText`, `readLines`, `readTextChunks`, `statPath`;
- mutação: `writeFileAtomic`, `createOrReplaceFileAtomic`, `appendTextLocked`, `copyFileLocked`, `moveFileLocked`, `deleteFileLocked`, `removePathLocked`, `patchTextLocked`, `mkdirPathLocked`;
- busca/diff: `diffText`, `searchText`, `searchWorkspaceSymbols`;
- warm/index/scanner: `warmReadThroughContext`, `scanDirectory`;
- saúde: `readIoRuntimeHealthSnapshot`.

Essa separação é correta: torna possível auditar, medir e evoluir a política de IO em um lugar central.

### 4.2 Locks

`io-locks.js` implementa fila por recurso lógico:

- chave normalizada por `path.resolve`/`path.normalize`;
- `Map<string, Promise<void>>` como tail queue;
- reentrância via `AsyncLocalStorage<Set<string>>`;
- múltiplos locks ordenados lexicograficamente para evitar deadlock;
- timeout e abort durante espera.

O desenho é limpo e suficiente para concorrência intra-processo. Não é um lock de sistema operacional.

### 4.3 Escritas e mutações

`locked-writes.js` e `locked-mutations.js` seguram lock por path ou conjunto de paths e chamam primitivas baixas:

- `writeAtomicFileUnlocked`: temp no mesmo diretório + `rename`;
- `patchTextLocked`: lê conteúdo, calcula patch, snapshot de rollback, grava atualizado;
- `moveFileLocked`, `copyFileLocked`, `deleteFileLocked`, `removePathLocked`;
- invalidação de cache após mutação.

Ponto forte: `expectedHash` existe em writes/patches e deve ser elevado a padrão em operações de risco.

### 4.4 Leituras

`read-services.js` implementa leitura com:

- L1 cache verificado por fingerprint;
- L2 cache opcional;
- validação UTF-8 em `readText` quando lê do disco;
- metadados de `io` publicados;
- slicing por line-offset cache.

O principal problema é que a leitura baixa (`readBytesFileSnapshot`, `readTextFileSnapshot`) mistura `readFile` e `stat` em paralelo.

### 4.5 Cache e invalidação

- L1: `lru-cache`, TTL, max bytes, fingerprint mtime+size, revalidação por hash para arquivos pequenos.
- L2: SQLite opcional, disabled por default.
- Invalidação: direta para cache tiers; bus debounced para hooks derivados.
- Line offset cache: acelera slicing por linhas.

A arquitetura é boa, mas precisa fechar normalização de chaves e janelas de read-after-write para caches derivados.

### 4.6 Busca, scanner, index e parser

- Search usa índice FTS quando possível, `rg` como fallback e `grep` como fallback final; subprocessos usam `spawn`, sem shell, timeout e maxBuffer.
- Scanner usa `readdir`, `lstat`, denylist, gitignore e path policy async.
- Index usa SQLite/FTS5, símbolos e imports; build tem lock e dedupe in-flight.
- Parser usa Babel em worker pool, com guardas de bytes/linhas/timeout e cache.

A performance geral é madura. O maior ganho agora é reduzir I/O redundante, usar `Dirent`/`glob` onde seguro, e introduzir provas/fuzz/chaos tests.

---

## 5. Achados detalhados

### Legenda

- **P0:** risco alto de corrupção, inconsistência ou bypass operacional.
- **P1:** risco relevante ou lacuna de confiabilidade/performance.
- **P2:** melhoria arquitetural, governança ou ergonomia.
- **P3:** oportunidade futura.

| ID | Prioridade | Área | Achado | Evidência local | Risco | Recomendação |
| --- | --- | --- | --- | --- | --- | --- |
| IO-001 | P0 | Escrita atômica | Atomic replace não é crash-durable | `io/fs/write-atomic.js`: `writeFile(tmp)` + `rename(tmp, filePath)` | Crash/power loss pode deixar tmp, conteúdo antigo, entrada de diretório não persistida ou arquivo não durável | Criar `durableAtomicReplace`: open tmp, write, `filehandle.sync()`/`flush`, close, rename, fsync do diretório quando suportado |
| IO-002 | P0 | Locks | Lock é intra-processo, não multiprocess | `io-locks.js` usa `Map` em memória | Outro processo pode escrever no mesmo arquivo e burlar serialização | Documentar escopo e adicionar camada opcional de lockfile/advisory lock para mutações de alto risco |
| IO-003 | P0 | Prefetch/cache | Prefetch textual não valida UTF-8 | `io-prefetch.js`: `bytesSnapshot.content.toString('utf8')` | Cache L1 pode servir texto inválido sem passar por `bufferIsUtf8` | Usar `decodeUtf8Buffer()` antes de primar text cache; não criar text entry para binário |
| IO-004 | P0 | Patch | Patch textual pode corromper binário/UTF-8 inválido | `locked-mutations.js`: `fs.readFile(filePath, 'utf8')` | Bytes inválidos viram U+FFFD e podem ser regravados | Ler Buffer, validar `bufferIsUtf8`, só então decode; recusar patch em binário |
| IO-005 | P0 | Move | Fallback EXDEV não verifica integridade | `io/fs/move.js`: `copyFile` + `unlink` | Cópia parcial ou divergente pode apagar origem | Copy para temp no destino, hash/size pós-cópia, fsync, rename final, só então unlink origem |
| IO-006 | P0 | Bypass | Bordas usam filesystem direto | audit logs, SSE archive, export terminal, alias store | Mutação sem IO meta, sem lock canônico, sem flush, sem política comum | Migrar para `appendTextLocked`, `writeFileAtomic`, `portable` com política explícita ou criar `logAppendDurable` |
| IO-007 | P1 | Snapshot | `readFile` e `stat` em paralelo não formam snapshot consistente | `read-bytes.js`, `read-text.js` | Cache pode associar conteúdo de uma versão a mtime/size de outra | Abrir FileHandle, `stat/read/stat` e retry se fingerprint muda; ou stat antes/depois |
| IO-008 | P1 | Create/copy | `failIfExists` e `overwrite=false` sofrem TOCTOU externo | `locked-writes.js`, `locked-mutations.js` | Processo externo pode criar destino entre `access` e gravação/cópia | Usar `open('wx')`/`COPYFILE_EXCL` e tratar EEXIST atomicamente |
| IO-009 | P1 | Append | Append de logs não é durável nem framed | `append.js`, bypasses de audit | Crash pode deixar JSONL truncado/torn line | Criar `appendRecordLocked` com newline framing, `flush`, recovery de linha parcial e rotação sob lock |
| IO-010 | P1 | Rollback | Rollback de patch é parcial para arquivos grandes | `snapshot.js` limita base64 a orçamento | Mutação em arquivo grande pode ficar sem rollback material | Salvar rollback em arquivo sidecar sob `.ai/rollback` com hash, ttl e cleanup seguro |
| IO-011 | P1 | Memória | Snapshot de mutação coleta stream inteiro em memória | `snapshot.js`: `Array.fromAsync(stream)` antes de processar | Arquivo grande consome memória desnecessária | Processar `for await` incrementalmente, hash e snapshot budget sem reter todos os chunks |
| IO-012 | P1 | Cache derivado | Invalidação debounced pode atrasar read-after-write de parser/line-offset | `invalidation/bus.js`: debounce 50ms em produção | Leitura derivada logo após mutação pode ver stale | Após mutação canônica, flush hooks críticos ou oferecer `invalidateSync` para line-offset/parser/index |
| IO-013 | P1 | Line offsets | Chave de line-offset não é claramente normalizada | `line-offset-cache.js` usa `filePath` recebido | Mesmo arquivo por path relativo/absoluto pode manter caches distintos | Normalizar path com `normalizeIoCacheKey`/`resolve` antes de keyar e invalidar |
| IO-014 | P1 | Path policy | Engine valida string/null byte, mas não workspace containment | `policy/path-resource.js`: `assertValidIoFilePath` | Chamador interno pode usar engine em path arbitrário | Separar API `trustedPortable` da API workspace-bound; exigir `workspaceRoot`/policy na fachada pública |
| IO-015 | P1 | Search | Total bruto pode vazar contagem de linhas redigidas | `text-search.js`: totalMatchCount de stdout cru | Baixo risco de side-channel sobre secrets | Calcular totais pós-redação ou marcar `rawTotalMayIncludeRedacted=true` |
| IO-016 | P1 | Scanner | `readdir` + `lstat` por entrada é custoso | `io-scanner.js` | Muitos syscalls em árvores grandes | Usar `readdir({ withFileTypes:true })`; avaliar `fsPromises.glob` em Node 24.5 para casos seguros |
| IO-017 | P1 | Index freshness | Índice confia em mtime+size | `io-index-sqlite.js`, `fingerprint-match.js` tolerância 2ms | Mudança externa com mesmo size/mtime pode não reindexar | Para arquivos pequenos/médios, usar hash ou ctime/inode; para hot files, stat-before-after |
| IO-018 | P1 | L2 SQLite | L2 cache opcional sem política clara de enablement | `io-cache-l2-registry.js` disabled default | Restart perde hotset; baixa performance em sessões longas | Ativar experimentalmente por perfil, medir hit ratio, busy timeout, WAL, synchronous |
| IO-019 | P1 | Bypass storage | `storage/json-store.js` usa `writeAtomicFileUnlocked` diretamente | `infra/storage/json-store.js` | Sem lock canônico se chamado em concorrência | Trocar por `writeFileAtomicPortable` ou `withIoResourceLock` explícito |
| IO-020 | P1 | Bypass export | `terminal/commands/export.js` usa `writeFile` direto | Busca de bypass | Export pode sobrescrever sem IO meta/hash | Migrar para `createOrReplaceFileAtomic`/`writeFileAtomic` conforme política |
| IO-021 | P2 | Temp naming | Temp random é 32-bit | `randomBytes(4)` | Colisão improvável, mas barata de melhorar | Usar 96/128 bits e prefixo dot-hidden `.tmp-<pid>-<random>` |
| IO-022 | P2 | Remove recursive | Remoção recursiva invalida, mas não há quarentena por default na engine | `removePathLocked` | Erro humano em caller destrutivo | Preferir quarantine nos tools, exigir confirmação e snapshot de árvore |
| IO-023 | P2 | Parser reset | Reset de workers em teste é assíncrono e chamado com `void` | `io-parser.js` | Testes podem flakear | Exportar/reset async e adaptar testes |
| IO-024 | P2 | Scope readiness | `declareScope` marca ready mesmo em catch | `io-session-scope.js` | Erros silenciosos podem parecer sucesso | Separar `ready` de `degraded`, expor erro resumido |
| IO-025 | P2 | Observability | Lock wait e queue depth ainda pouco visíveis | `getIoLockStats` é básico | Dificulta diagnosticar contenção | Histogramas por lock key prefix, p95 wait, timeout count, active leases |
| IO-026 | P2 | Search subprocess | `rg`/`grep` maxBuffer aborta, mas não oferece stream incremental | `subprocess.js` | Grandes buscas custam memória até limite | Parser incremental de linhas com early stop em `maxResults` |
| IO-027 | P2 | Glob policy | Glob simples próprio diverge de minimatch/Node glob | `scan/glob.js` | Diferenças de include/exclude difíceis de prever | Padronizar em `minimatch`/`fsPromises.glob` com testes de compatibilidade |
| IO-028 | P2 | Statfs | Sem preflight de espaço livre | Não há uso de `statfs` | ENOSPC parcial em copy/write grande | Adicionar preflight opcional para payloads acima de limiar |
| IO-029 | P2 | Durable append | Logs e JSONL não têm recovery de linha parcial | audit/SSE | JSONL pode quebrar parsing | Na leitura, truncar/ignorar última linha inválida; na escrita, flush configurável |
| IO-030 | P3 | L3 cache | L3 reservado, mas sem contrato | `io-cache-tiering.js` | Sem problema atual | Só planejar se houver múltiplos runtimes/processos reais |

---

## 6. Situação atual: avaliação por dimensão

### 6.1 Segurança contra corrupção

**Bom:**

- Mutação canônica usa locks intra-processo.
- Patch e write podem usar `expectedHash`.
- Rename no mesmo diretório evita estados parcialmente escritos em muitos cenários normais.
- Cache é invalidado após mutações canônicas.

**Insuficiente:**

- Não há garantia de durabilidade em crash/power loss.
- Não há lock multiprocess.
- Alguns call sites burlam a fachada.
- Reads podem misturar conteúdo e stat de versões diferentes.
- Prefetch textual pode burlar validação UTF-8.

**Diagnóstico:** a camada atual protege bem contra concorrência cooperativa dentro do mesmo processo. Não deve ser vendida como transacional ou crash-safe.

### 6.2 Locks e concorrência

O design de `io-locks.js` é correto para single-process async concurrency. A reentrância com `AsyncLocalStorage` evita deadlocks quando um fluxo já protegido chama outra função protegida do mesmo recurso. Multi-lock ordenado lexicograficamente é boa prática.

Limite estrutural: `Map` em memória não coordena com outro processo. Em devcontainer isso importa, porque o mesmo workspace pode ser alterado por:

- VS Code/editor;
- Git;
- terminal humano;
- outro Node process;
- validações/testes;
- ferramentas externas de format/lint.

Estado ideal: manter o lock atual como L0 rápido e adicionar L1 opcional de lockfile para mutações de alto risco.

### 6.3 Atomicidade e durabilidade

Temp+rename resolve atomicidade de troca visível, mas não resolve persistência. A sequência ideal para arquivo crítico é:

1. abrir tmp no mesmo diretório com flags exclusivas;
2. escrever payload completo;
3. `filehandle.sync()` ou `writeFile(..., { flush: true })`;
4. fechar handle;
5. `rename(tmp, target)`;
6. abrir diretório e `sync()` quando plataforma suportar;
7. invalidar caches e publicar evento.

Para append, a sequência ideal depende do tipo:

- JSONL/audit: append record framed, newline, flush opcional, recovery de última linha.
- Logs de baixa criticidade: append buffered sem flush, mas explicitamente classificado como best-effort.

### 6.4 Cache e invalidação

L1 é bem pensado: TTL, max bytes, mtime+size, hash revalidation para arquivos pequenos. O problema é que a correção depende de snapshot inicial consistente e de invalidação total de caches derivados.

A prioridade é corrigir:

- prefetch textual sem UTF-8 validation;
- line-offset key normalizada;
- flush da invalidation queue após mutações críticas;
- read snapshot com retry.

### 6.5 Scanner, busca e index

O scanner é seguro, mas ainda custa mais syscalls do que precisa. `readdir({ withFileTypes: true })` elimina muitos `lstat` para tipo básico. `fsPromises.glob` está estável em Node 24, mas precisa cuidado com opções que só existem depois de 24.5.

A busca está bem protegida contra shell injection: usa `spawn` com args array e maxBuffer/timeout. O índice FTS é boa oportunidade de performance. O maior risco é stale index por writes fora da fachada.

---

## 7. Situação ideal proposta

A situação ideal é uma infra IO em camadas:

### Camada A — Policy-bound public facade

- Toda chamada fora de `infra` usa `src/copilot/infra/public/io.js`.
- API workspace-bound exige `workspaceRoot` ou contexto explícito.
- API portable/trusted fica separada, com nome ruidoso e allowlist de callsites.
- ESLint rule bloqueia `node:fs/promises` direto em tools/bordas, exceto allowlist.

### Camada B — Locks em dois níveis

- L0: lock async em memória atual, rápido.
- L1: lockfile opcional para mutações P0/P1, com:
  - `open(lock, 'wx')`;
  - metadata `{ pid, startedAt, hostname, operation, targetHash }`;
  - stale detection;
  - heartbeat opcional;
  - cleanup seguro.

### Camada C — Escrita durável configurável

- `writeFileAtomic` vira política configurável:
  - `durability: 'none' | 'file' | 'file-and-directory'`;
  - default `file` para arquivos críticos, `none` para cache/logs best-effort;
  - `flush: true` ou `FileHandle.sync()`;
  - directory fsync quando suportado.

### Camada D — Snapshot consistente

- Leituras canônicas retornam `(content, statBefore, statAfter, consistent)`.
- Se `statBefore` e `statAfter` divergem, retry limitado.
- Cache só é populado com snapshot consistente.

### Camada E — Cache derivado coerente

- L1/L2/line-offset/parser/index usam path normalizado único.
- Mutação canônica invalida todos os derivados antes de retornar ou retorna `invalidationFlushed=true`.
- Writes fora da fachada são bloqueados por lint ou explicitamente marcados como best-effort.

### Camada F — Testes de falha e fuzz

- Fuzz para patch/line endings/UTF-8.
- Testes de concorrência intra-processo e multiprocess.
- Simulações de crash em cada ponto da escrita.
- Testes de EXDEV com mock/fixture.
- Testes de cache stale por mudança externa.

---

## 8. Roadmap por faixas, fases e subfases

### Faixa 0 — Contenção imediata de riscos P0

#### Fase 0.1 — UTF-8 e patch seguro

- [ ] Em `io-prefetch.js`, trocar `Buffer.toString('utf8')` por `decodeUtf8Buffer()`.
- [ ] Se bytes não forem UTF-8, primar apenas bytes cache, nunca text cache.
- [ ] Em `patchTextLocked`, ler Buffer, validar UTF-8, só então `toString('utf8')`.
- [ ] Adicionar testes com bytes inválidos e garantir que `readText`/`patchText` recusam binário.

#### Fase 0.2 — Bypass governance

- [ ] Criar lint rule/local script: proibir `fs.writeFile`, `appendFile`, `rename`, `unlink`, `rm`, `copyFile` fora de allowlist.
- [ ] Migrar `terminal/commands/export.js` para fachada pública.
- [ ] Migrar audit/SSE append para wrapper canônico de append/log.
- [ ] Revisar `storage/json-store.js` para não chamar `writeAtomicFileUnlocked` direto sem lock.

#### Fase 0.3 — TOCTOU básico

- [ ] `copyFileLocked` com `overwrite=false` deve usar `COPYFILE_EXCL`.
- [ ] `writeFileAtomic` com `failIfExists` deve usar criação exclusiva ou rename condicionado.
- [ ] Adicionar testes com concorrência externa simulada.

### Faixa 1 — Durabilidade de escrita e move seguro

#### Fase 1.1 — Writer durável

- [ ] Implementar `writeAtomicFileUnlockedDurable(filePath, payload, { mode, durability })`.
- [ ] Usar `fsPromises.open(tmp, 'wx')` para evitar colisão.
- [ ] Escrever payload via FileHandle.
- [ ] Executar `filehandle.sync()` ou `writeFile(..., { flush:true })`.
- [ ] Fechar handle antes de rename.
- [ ] Renomear tmp para destino.
- [ ] Tentar fsync do diretório quando suportado.
- [ ] Garantir cleanup de tmp em erro.

#### Fase 1.2 — Move EXDEV transacional

- [ ] Para `EXDEV`, copiar origem para temp no diretório destino.
- [ ] Calcular hash/tamanho da origem antes/depois.
- [ ] Verificar destino temp.
- [ ] Flush/sync temp.
- [ ] Rename temp para destino.
- [ ] Só então unlink origem.
- [ ] Se unlink origem falhar, reportar `duplicatedAfterCrossDeviceMove=true`.

#### Fase 1.3 — Append confiável

- [ ] Criar `appendRecordLocked(file, record, { format:'jsonl', flush })`.
- [ ] Rotação sob o mesmo lock.
- [ ] Recovery de última linha inválida em leitura.
- [ ] Classificar audit logs como `best-effort` ou `durable`.

### Faixa 2 — Locks multiprocess e política de path

#### Fase 2.1 — Lockfile opcional

- [ ] Criar `infra/locks/file-resource-lock.js` com `open('wx')`.
- [ ] Metadata do lock com PID, hostname, operação, target, startedAt.
- [ ] Stale detection por PID/process alive e idade máxima.
- [ ] Timeout e abort integrados.
- [ ] Ativar por env para mutações P0/P1.

#### Fase 2.2 — Workspace-bound IO

- [ ] Dividir fachada em `workspaceIo` e `trustedPortableIo`.
- [ ] `workspaceIo` exige `workspaceRoot` e chama `isPathInsideWorkspace`.
- [ ] `trustedPortableIo` exige allowlist de caller ou root configurado.
- [ ] Adicionar testes de `../`, symlink, path absoluto fora do workspace e null byte.

#### Fase 2.3 — Observabilidade de locks

- [ ] Histograma de `lockWaitMs` por prefixo de recurso.
- [ ] Contador de timeouts/aborts.
- [ ] Snapshot de active leases.
- [ ] Alertas quando p95 de lock > limiar.

### Faixa 3 — Snapshot, cache e index coerentes

#### Fase 3.1 — Snapshot consistente

- [ ] Reimplementar `readBytesFileSnapshot` com `open` + `stat/read/stat` + retry.
- [ ] Retornar `ino`, `dev`, `mtimeNs` quando possível.
- [ ] Só popular cache com snapshot consistente.
- [ ] Testar mudança externa durante read.

#### Fase 3.2 — Normalização universal de cache keys

- [ ] Line-offset cache deve normalizar paths.
- [ ] Parser cache deve usar a mesma normalização da L1.
- [ ] Invalidação recursive deve apagar entradas relativas/absolutas equivalentes.
- [ ] Teste: ler mesmo arquivo via path relativo e absoluto, escrever por um deles, garantir invalidação dos dois.

#### Fase 3.3 — L2 e índice

- [ ] Definir perfil experimental `IO_L2_CACHE_ENABLED=1` em CI opcional.
- [ ] Auditar config SQLite: WAL, busy_timeout, synchronous.
- [ ] Medir hit ratio e latência cold/warm.
- [ ] Para índice, usar hash em arquivos pequenos para evitar stale por mtime+size.

### Faixa 4 — Performance de scan/search/parser

#### Fase 4.1 — Scanner com Dirent

- [ ] Trocar `readdir(dir)` + `lstat` por `readdir(dir, { withFileTypes:true })` quando possível.
- [ ] Lstat apenas quando fingerprint/symlink/policy exigir.
- [ ] Medir antes/depois em `src/copilot` completo.

#### Fase 4.2 — Glob Node 24.5-safe

- [ ] Avaliar `fsPromises.glob` para include/exclude simples.
- [ ] Não depender de `followSymlinks`, pois opção é posterior a 24.5.
- [ ] Comparar resultados com scanner atual em fixtures.

#### Fase 4.3 — Search streaming

- [ ] Parsear stdout de `rg` incrementalmente e abortar ao atingir `maxResults`.
- [ ] Reduzir `maxBuffer` default depois de streaming.
- [ ] Evitar contagem bruta de matches em linhas redigidas.

#### Fase 4.4 — Parser workers

- [ ] Transformar reset de workers em operação async explícita nos testes.
- [ ] Adicionar backpressure para fila de parse.
- [ ] Expor queue length e timeout por arquivo.

### Faixa 5 — Provas, fuzz e chaos engineering

#### Fase 5.1 — Fuzz textual

- [ ] Patch com CRLF/LF misto.
- [ ] Unicode multibyte e surrogate pairs.
- [ ] Arquivos sem newline final.
- [ ] Arquivos vazios.
- [ ] `oldString` com múltiplas ocorrências.

#### Fase 5.2 — Fuzz binário

- [ ] Bytes inválidos UTF-8.
- [ ] Arquivos muito grandes.
- [ ] NUL no conteúdo e no path.
- [ ] Snapshot truncado.

#### Fase 5.3 — Crash injection

- [ ] Falhar entre write tmp e sync.
- [ ] Falhar entre sync e rename.
- [ ] Falhar após rename antes de directory fsync.
- [ ] Falhar durante EXDEV copy.
- [ ] Falhar durante append de JSONL.

#### Fase 5.4 — Multiprocess

- [ ] Dois processos escrevendo mesmo arquivo.
- [ ] Processo externo modificando arquivo durante read.
- [ ] Git checkout enquanto índice roda.
- [ ] Editor salvando arquivo enquanto patch aplica.

---

## 9. Matriz de testes recomendada

| Domínio | Caso | Resultado esperado |
| --- | --- | --- |
| UTF-8 | Prefetch de arquivo binário | Não cria text cache; `readText` continua recusando |
| Patch | Patch em UTF-8 inválido | Erro `BinaryFileError`; nenhum write |
| Atomic write | Abort durante espera de lock | Nenhum tmp órfão relevante; lock liberado |
| Atomic write | Crash antes de rename | Destino intacto; tmp detectável/limpável |
| Atomic write | Crash após rename | Destino íntegro; diretório persistido no modo durable |
| Create | Dois processos criando mesmo arquivo | Um vence; outro recebe EEXIST sem sobrescrever |
| Copy | `overwrite=false` com corrida externa | Não sobrescreve destino externo |
| Move | EXDEV com copy parcial | Origem preservada; destino final não publicado |
| Cache | Read relativo + read absoluto + write | Todas as entradas equivalentes invalidam |
| Snapshot | Arquivo muda durante read | Retry ou `consistent=false`; não popular cache ruim |
| Append | JSONL truncado por crash | Recovery ignora/trunca última linha inválida |
| Scanner | Symlink para fora do workspace | Não atravessa por padrão; path redigido/bloqueado |
| Search | Resultado enorme | Early stop sem estourar buffer |
| Index | Mudança externa same-size | Hash/ctime detecta ou marca stale |
| Lock | Multiprocess lockfile stale | Segundo processo detecta stale só quando seguro |

---

## 10. Recomendação de implementação inicial

A primeira onda deve ser pequena e cirúrgica:

1. **Corrigir UTF-8 cache poisoning** em `io-prefetch.js`.
2. **Corrigir patch binário** em `locked-mutations.js`.
3. **Trocar `copyFile` sem exclusividade** por `COPYFILE_EXCL` quando `overwrite=false`.
4. **Criar writer durável experimental** sem trocar todos os callsites ainda.
5. **Migrar bypasses evidentes** (`export.js`, audit append, SSE archive) para wrappers canônicos.
6. **Adicionar testes de edge cases** antes de ativar durabilidade global.

Essa onda reduz risco real sem reescrever toda a arquitetura.

---

## 11. Notas específicas sobre arquivos centrais

### `io/fs/write-atomic.js`

Bom ponto de centralização. Deve virar a única primitiva baixa de replace, mas precisa receber estratégia de durabilidade. O nome atual promete atomicidade; deve documentar que hoje é atomicidade por rename, não durabilidade contra crash.

### `io/fs/locked-writes.js`

Bom encapsulamento. `expectedHash` está no lugar certo. Deve chamar writer durável e corrigir `failIfExists` para semântica exclusiva real.

### `io/fs/locked-mutations.js`

Deve validar UTF-8 antes de patch. Também deve elevar rollback para arquivos grandes via sidecar.

### `io/fs/move.js`

É o ponto mais frágil de mutação não-trivial. O fallback EXDEV atual deve ser considerado best-effort, não seguro.

### `io/fs/snapshot.js`

A intenção é excelente, mas a implementação precisa ser incremental. `Array.fromAsync(stream)` contradiz o objetivo de snapshot orçamentado.

### `io-prefetch.js`

Grande oportunidade de performance, mas precisa respeitar exatamente as mesmas invariantes de `readText`. Prefetch não pode ser uma via lateral que cria estados impossíveis pela API normal.

### `io-cache.js`

Boa engenharia. O hash revalidation é uma proteção pragmática contra drift de mtime. Depois de snapshot consistente e path normalization universal, torna-se bastante confiável.

### `io-scanner.js`

Seguro, mas otimização com `Dirent` deve trazer ganho simples. Manter política de não seguir symlink por padrão.

### `io-index-sqlite.js`

Boa base de navegação e performance. A fragilidade é derivada: se qualquer writer burlar a fachada, índice e cache podem divergir.

### `io-locks.js`

Sólido para processo único. A documentação do módulo deveria dizer explicitamente: “não é lock interprocesso”. A evolução correta é compor com lockfile, não substituir.

---

## 12. Critérios de aceite para declarar a infra IO “confiável”

A infra IO só deve ser considerada plenamente confiável quando:

- toda escrita fora de `infra` passar pela fachada pública ou por allowlist formal;
- `readText`, `prefetch`, `patch` e `index` compartilharem a mesma validação UTF-8;
- create/copy sem overwrite usarem exclusividade real;
- atomic write tiver modo durável com sync de arquivo e diretório;
- move EXDEV tiver verificação de integridade;
- snapshots de leitura forem consistentes ou marcados como inconsistentes;
- cache derivado for invalidado antes de retorno de mutação crítica;
- houver testes multiprocess e crash-injection;
- lock semantics estiverem documentadas por nível: intra-processo, lockfile, best-effort.

---

## 13. Referências oficiais

- Node.js v24.5.0 release: https://nodejs.org/en/blog/release/v24.5.0
- Node.js v24.x File System API: https://nodejs.org/docs/latest-v24.x/api/fs.html
- `fsPromises.writeFile`: https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromiseswritefilefile-data-options
- `fsPromises.appendFile`: https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesappendfilepath-data-options
- `fsPromises.mkdtempDisposable`: https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesmkdtempdisposableprefix-options
- `fsPromises.glob`: https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesglobpattern-options
- `fsPromises.statfs`: https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesstatfspath-options
- Node FS threadpool usage: https://nodejs.org/docs/latest-v24.x/api/fs.html#threadpool-usage

---

## 14. Próxima ação recomendada

Abrir uma sequência de patches pequena, nesta ordem:

1. `io-prefetch` UTF-8 safety.
2. `patchTextLocked` binary safety.
3. `snapshot.js` streaming incremental.
4. `copyFileLocked`/`failIfExists` exclusividade real.
5. `write-atomic` durable mode atrás de flag.
6. migração dos bypasses de `appendFile`/`writeFile` diretos.

Essa sequência entrega redução de risco sem depender de uma reescrita ampla e cria base para ativar durabilidade progressiva por tipo de arquivo.
