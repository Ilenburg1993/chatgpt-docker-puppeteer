# Auditoria profunda de `src/copilot` — foco em Infra IO, performance, locks e corrupção de arquivos

**Data:** 2026-06-12  
**Baseline reinvestigado:** `main` em `34fd96cc` (`origin/main` sincronizada em 2026-06-12)
**Escopo primário:** `src/copilot/infra/io/**`  
**Escopo ampliado:** `src/copilot/infra` adjacente, usos diretos de filesystem em `src/copilot`, runtime Node 24.5+  
**Objetivo:** verificar se a infraestrutura de IO faz o que promete sob concorrência, falhas, cache, locks, edge cases e risco de corrupção; propor estado ideal e roadmap faseado.

---

## 1. Sumário executivo

A infra IO de `src/copilot` evoluiu materialmente desde a abertura deste documento. Além das Faixas 0, 1 e 2.1, a onda pós-reinvestigação fechou stale recovery inseguro do L1, release assíncrono determinístico, move same-device exclusivo, copy staged, snapshot consistente, snapshot incremental, invalidação derivada imediata e scanner com `Dirent`.

No estado implementado após `7b83becd`, a descrição correta é: **replace/copy/move têm publicação segura e verificação de integridade, snapshots baixos são coerentes e o L1 deixou de ter as corridas críticas identificadas; append/JSONL, policy workspace-bound, consolidação dos lock managers e provas de crash/multiprocess ainda impedem declarar transacionalidade completa**.

Prioridades reais remanescentes:

1. **P1 — append/JSONL foi consolidado no caminho assíncrono principal, mas ainda é parcial:** audit, mutation audit, event collector, MCP e SSE compartilham writer; logger/metrics/transcript síncronos e recovery de linha parcial permanecem.
2. **P1 — política workspace-bound ainda não está na fachada:** a engine pública valida string/null-byte, mas containment e symlink policy continuam responsabilidade dos adapters.
3. **P1 — provas de falha ainda são insuficientes:** faltam dois processos reais e crash injection nos pontos de publish/sync/append.
4. **P1 — freshness do índice ainda depende demais de mtime+size:** mudanças externas same-size/same-mtime podem escapar.
5. **P2 — consolidação de locks concluída, enablement ainda seletivo:** `infra/lockfile.js` virou facade do L1 canônico, mas o lockfile multiprocess continua opt-in nas mutações gerais.
6. **P2 — observabilidade de contenção ainda é parcial:** há contadores de stale recovery e heartbeat failure, mas não p95/histograma e snapshot de leases.

Conclusão atualizada: a infra já não deve ser descrita como “temp+rename sem durabilidade”, “somente lock intra-processo” ou “snapshot por read/stat paralelo”. O risco técnico dominante migrou de corrupção nas primitivas centrais para append fragmentado, writers fora da fachada, freshness externa e ausência de provas de falha reais.

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

### 1.4 Reinvestigação pós-sincronização — baseline `34fd96cc`

Antes desta rodada, toda a situação local foi organizada em cinco commits e publicada diretamente em `origin/main`:

- `92d145b7` — Company Knowledge e Apps SDK widget.
- `883889f7` — atualização da auditoria arquitetural geral.
- `c6be21c1` — parser preserva símbolos quando o orçamento é excedido.
- `eece2e3f` — hardening IO, durabilidade e lockfile L1.
- `34fd96cc` — inclusão desta auditoria.

Inventário objetivo do escopo:

- 1.358 arquivos rastreados em `src/copilot`.
- 1.246 arquivos JS/TS.
- aproximadamente 269 mil linhas JS/TS.
- 116 arquivos sob `src/copilot/infra`.
- 11.219 linhas no núcleo `infra/io`, `io-*`, locks, policy, shared e scan.
- 74 arquivos de teste diretamente relacionados a IO, cache, scanner, parser, locks, filesystem e auditoria foram identificados.

Novas constatações de implementação:

- existem dois gerenciadores de lockfile: `infra/lockfile.js` e `infra/locks/file-resource-lock.js`, com contratos e stale recovery diferentes;
- o L1 novo cria o arquivo com `open('wx')`, mas leitores concorrentes podem observar metadata vazia/parcial e removê-la imediatamente;
- o TTL do L1 prevalece sobre PID vivo, o que torna operações longas inseguras;
- `moveFileUnlocked()` ignora `overwrite=false` no caminho same-device e chama `rename()` diretamente;
- `copyFileLocked(..., { overwrite:true })` captura rollback, mas publica com `copyFile()` direto no destino;
- `syncFileBestEffort()` no caminho `EXDEV` tem o resultado ignorado;
- line-offset cache ainda usa o path recebido como chave, enquanto L1/parser/índice normalizam;
- `invalidateIoCacheTiers()` não força `flushIoInvalidationQueue()`;
- `createAuditLog().flush()` reapenda todo o ring buffer em toda chamada sem cursor de persistência;
- SSE remove o batch da fila antes de confirmar append e não o recoloca quando a escrita falha.

### 1.5 Status de implementação — onda pós-reinvestigação aplicada em 2026-06-12

Mudanças efetivamente implementadas:

- L1 observa metadata e inode/mtime/tamanho antes de recuperar stale; PID local vivo prevalece sobre TTL e metadata inválida recente respeita grace.
- Lockfile retém `FileHandle` para heartbeat por `utimes`; stats expõem `staleRecoveries` e `heartbeatFailures`.
- Leases L0+L1 oferecem `releaseAsync()` idempotente; wrappers, multi-lock e `Symbol.asyncDispose` aguardam cleanup antes de liberar a fila L0.
- `fileLockDir` permite isolamento explícito sem mutar `process.env`.
- Move same-device com `overwrite=false` publica por `link()` exclusivo e só então remove a origem; sync de diretórios foi adicionado e falha real de file sync impede conclusão do caminho `EXDEV`.
- Copy sempre usa temp exclusivo no diretório destino, calcula hash/tamanho incremental da origem e do temp, exige integridade, sincroniza e publica por `link` ou `rename`.
- Snapshot de leitura usa `FileHandle.stat/read/stat`, confirma o path final e faz retry limitado; retorna `dev`, `ino`, `ctimeMs`, `attempts` e `consistent:true`.
- Snapshot de mutação usa `for await` incremental e aceita orçamento `0`, evitando materialização integral na verificação de copy.
- Line-offset normaliza a chave e invalidações canônicas forçam flush do bus antes do retorno.
- Scanner usa `readdir({ withFileTypes:true })` e evita `lstat` para diretórios/symlinks conhecidos.

Evidência de validação desta onda:

- `typecheck:strict:src.copilot`: **PASS**.
- `lint:copilot`: **PASS**.
- Testes focados de engine, snapshot, line-offset e tools: **89 passados, 0 falhas**.
- Unitários Copilot: **6.465 total, 6.437 passados, 0 falhas, 28 pending**.
- Benchmark local do scanner em `src/copilot`, 1.565 entradas: **214 ms cold; 154 ms e 165 ms warm**.
- `typecheck:strict:tests.unit` global continua vermelho por dívida preexistente ampla fora desta onda; nenhum erro foi reportado nos quatro arquivos de teste alterados quando filtrados.

Status dos novos achados:

- **Concluídos:** IO-031, IO-032, IO-033, IO-034, IO-035, IO-036, IO-037 e IO-040.
- **Abertos:** IO-038 e IO-039.

### 1.6 Status de implementação — append/JSONL canônico aplicado em 2026-06-12

Foi criada `infra/io/jsonl-file-writer.js` como primitiva compartilhada para writers JSONL assíncronos:

- apenas um lote fica em voo por writer;
- falha de append recoloca o lote na cabeça da fila, preservando ordem;
- `mkdir`, verificação de tamanho, rotação e append executam sob o mesmo lock por path;
- `flushToDisk` classifica writers duráveis sem impor fsync a telemetria best-effort;
- limites soft/catastrófico, contadores de drop/falha e último erro são observáveis;
- path pode ser dinâmico, preservando archive SSE diário e configuração MCP por env.

Migrações concluídas:

- `audit/jsonl-writer`;
- audit geral e tool execution em `pipeline-audit-log`;
- audit de permissões em modo durável;
- mutation audit da infra em modo durável;
- `observability/event-collector`;
- terminal SSE archive;
- MCP control-plane audit.

Correções comportamentais:

- `createAuditLog().flush()` não reapenda mais todo o ring buffer; cada entrada pendente é persistida uma única vez.
- SSE, event collector, audit e MCP não perdem definitivamente o lote removido da fila quando append falha.
- Rotação e append deixaram de ser operações independentes suscetíveis a interleaving entre writers cooperativos.

Validação desta onda:

- `typecheck:strict:src.copilot`: **PASS**.
- `lint:copilot`: **PASS**.
- Testes focados e contratos arquiteturais: **187 passados, 0 falhas**.
- Provas novas: requeue após falha e dois flushes consecutivos sem duplicação do audit ring.

Limites remanescentes de IO-038:

- `observability/logger.js`, `observability/metrics.js` e transcript archive ainda usam append síncrono/direto.
- Recovery/truncamento explícito da última linha JSONL parcial ainda não é uma primitiva compartilhada.
- Ainda faltam crash injection e prova multiprocess durante rotate+append.

### 1.7 Status de implementação — lockfile SSOT e recovery JSONL aplicados em 2026-06-12

Consolidação de lock managers:

- `infra/lockfile.js` deixou de manter implementação própria de metadata, stale recovery e aquisição.
- A facade legado preserva `acquireLock(): Promise<boolean>`, `releaseLock()` e `releaseLockAsync()`, mas adquire lease no `file-resource-lock.js`.
- O L1 canônico agora aceita `lockPath` físico explícito, preservando callers que tratam o argumento como arquivo de lock.
- O path legado é normalizado antes de armazenar lease; release relativo/absoluto não deixa heartbeat órfão.
- Symlinks continuam recusados antes de adquirir ou recuperar stale.

Recovery de leitura JSONL:

- Nova primitiva `infra/io/jsonl-reader.js` lê cauda por blocos, preserva UTF-8 em fronteiras de bloco e parseia registros completos.
- Cauda parcial inválida é ignorada e reportada por `trailingPartialIgnored`.
- Audit summary e terminal SSE tail deixaram de duplicar leitura/parse tolerante.

Validação desta onda:

- `typecheck:strict:src.copilot`: **PASS**.
- `lint:copilot`: **PASS**.
- Testes focados e contratos: **206 passados, 0 falhas**.
- Provas novas: metadata L1 na facade legado, recusa de symlink, cauda parcial ignorada e último JSON válido sem newline aceito.

Status:

- **IO-039 concluído:** há um SSOT de lockfile; a API legado é somente facade de compatibilidade.
- **IO-038 permanece parcial:** escrita assíncrona e leitura tolerante estão centralizadas, mas writers síncronos e truncamento físico opcional ainda não.

### 1.8 Status de implementação — provas multiprocess reais aplicadas em 2026-06-12

Foi adicionado um harness que executa módulos de produção em processos Node independentes, com L1 habilitado e verificação do estado final no filesystem.

Provas cobertas:

- dois processos tentando create exclusivo: exatamente um vence, o outro recebe `EEXIST`;
- dois processos copiando origens diferentes para o mesmo destino exclusivo: exatamente um vence e o destino contém uma versão completa;
- dois processos movendo origens diferentes para o mesmo destino exclusivo: exatamente um vence e a origem perdedora permanece intacta;
- dois processos escrevendo payloads grandes no mesmo destino: ambos concluem serializados e o arquivo final é uma das versões completas;
- processo holder morto por `SIGKILL`: o próximo processo recupera o L1 órfão e remove o lock ao concluir.

Achado adicional fechado durante a prova:

- **IO-041 P0 — timer aguardado com `unref()` encerrava processo durante contenção.**
- O polling L1 e o timeout L0 usavam timers sem referência; um processo cuja única atividade era aguardar o lock podia encerrar com top-level await pendente e código 13.
- Os timers de espera aguardada agora mantêm o processo vivo; heartbeat continua `unref()`, pois não deve impedir shutdown.

Validação:

- prova multiprocess: **2 testes passados, 0 falhas**;
- `typecheck:strict:src.copilot`: **PASS**;
- `lint:copilot`: **PASS**;
- testes de locks/engine após a correção: **39 passados, 0 falhas**.

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

Na reinvestigação, a busca foi refeita sobre todos os 1.246 arquivos JS/TS. Além dos callsites acima, há writers diretos relevantes em:

- `src/copilot/observability/event-collector.js`;
- `src/copilot/observability/metrics.js`;
- `src/copilot/mcp/control-plane/audit.js`;
- `src/copilot/mcp/control-plane/jobs.js`;
- `src/copilot/mcp/control-plane/dev-oauth.js`;
- `src/copilot/config/declarative-runtime-config.js`;
- `src/copilot/terminal/commands/byok.js`;
- stores e snapshots de agent/session.

Nem todo acesso direto é um defeito: bootstrap, configuração, SQLite, descoberta e readers especializados podem justificar portas baixas. O problema atual é a ausência de uma allowlist formal que diferencie exceção intencional de bypass acidental.

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
| IO-031 | P0 | Lock L1 | **Concluído:** PID local vivo prevalece sobre TTL | `file-resource-lock.js:isStaleLock` usa hostname/PID e heartbeat por mtime | Evita roubo de lease local longo | Manter prova multiprocess na Faixa 5 |
| IO-032 | P0 | Lock L1 | **Concluído:** metadata parcial respeita idade do inode | `observeLock()` combina metadata e `stat`; reclaim confirma a mesma observação | Fecha janela entre `open('wx')` e metadata | Adicionar crash injection durante criação |
| IO-033 | P1 | Lock release | **Concluído:** release determinístico | `releaseAsync()` idempotente em lease simples/múltiplo e wrappers | Cleanup L1 termina antes de liberar L0 | Manter `release()` apenas como compatibilidade |
| IO-034 | P0 | Move | **Concluído:** `overwrite=false` exclusivo same-device | `link(source,destination)` + sync + `unlink(source)` | Não sobrescreve destino criado em corrida | Provar com dois processos reais |
| IO-035 | P0 | Copy | **Concluído:** copy staged e verificado | temp exclusivo, hash/tamanho incremental, sync, `link`/`rename` | Preserva destino anterior até publish | Adicionar crash injection e ENOSPC real |
| IO-036 | P1 | Snapshot | **Concluído:** snapshot baixo consistente | `FileHandle.stat/read/stat`, confirmação do path e retry | Cache recebe bytes e metadata do mesmo inode/versão | Testar modificação externa durante read |
| IO-037 | P1 | Invalidation | **Concluído:** derivados são drenados antes do retorno | `invalidateIoCacheTiers*()` chama `flushIoInvalidationQueue()` | Read-after-write não espera debounce | Medir custo sob bursts de mutação |
| IO-038 | P1 | JSONL | **Parcial:** writer canônico cobre audit, event collector, SSE e MCP | `infra/io/jsonl-file-writer.js`; cursor/requeue corrigidos | Writers síncronos e linha parcial ainda têm semântica própria | Migrar logger/metrics/transcript e centralizar recovery de última linha |
| IO-039 | P2 | Lock governance | **Concluído:** `file-resource-lock.js` é SSOT | `infra/lockfile.js` delega aquisição ao L1 canônico e preserva API legado | Remove semânticas concorrentes | Manter facade até callers antigos desaparecerem |
| IO-040 | P2 | Scanner | **Concluído:** tipo básico vem de `Dirent` | `readdir({ withFileTypes:true })`; `lstat` só para arquivo/ambíguo | Reduz syscalls de classificação | Preservar benchmark e testar DT_UNKNOWN |
| IO-041 | P0 | Lock wait | **Concluído:** timer aguardado não usa `unref()` | prova multiprocess reproduziu exit 13 durante espera L1 | Processo podia encerrar antes de adquirir/rejeitar lock | Manter `unref()` apenas em heartbeat/background |

### 5.1 Reclassificação dos achados originais no baseline atual

| Estado | IDs |
| --- | --- |
| Concluído | IO-003, IO-004, IO-007, IO-008, IO-011, IO-012, IO-013, IO-016, IO-019, IO-020, IO-031, IO-032, IO-033, IO-034, IO-035, IO-036, IO-037, IO-039, IO-040, IO-041 |
| Concluído com limite documentado | IO-001, IO-005 |
| Parcial | IO-002, IO-006, IO-009, IO-023, IO-025, IO-038 |
| Aberto | IO-010, IO-014, IO-015, IO-017, IO-018, IO-021, IO-022, IO-024, IO-026, IO-027, IO-028, IO-029, IO-030 |

---

## 6. Situação atual: avaliação por dimensão

### 6.1 Segurança contra corrupção

**Bom:**

- Mutação canônica usa locks intra-processo e pode compor lockfile L1 opt-in.
- Patch e write podem usar `expectedHash`.
- Atomic replace usa temp exclusivo, `flush:true`, rename/link e directory sync best-effort.
- Move `EXDEV` verifica hash/tamanho antes de publicar e remover a origem.
- Create, copy e move sem overwrite têm exclusividade real.
- Copy com overwrite é staged e só substitui o destino após verificação e sync.
- Snapshot baixo confirma inode/fingerprint antes de alimentar cache.
- Cache é invalidado após mutações canônicas.

**Insuficiente:**

- Muitos callsites de append e alguns writers de configuração burlam a fachada.
- Ainda faltam provas multiprocess/crash-injection das invariantes implementadas.
- Índice pode perder mudança externa same-size/same-mtime.
- Lockfile legado ainda não compartilha a mesma semântica do L1 canônico.

**Diagnóstico:** as primitivas canônicas agora protegem bem replace, copy, move, snapshot e concorrência cooperativa/multiprocess opt-in. Ainda não deve ser vendida como transacional enquanto append, bypass governance e provas de crash/multiprocess estiverem abertos.

### 6.2 Locks e concorrência

O design L0 de `io-locks.js` continua correto para single-process async concurrency. A reentrância com `AsyncLocalStorage` evita deadlocks e multi-lock ordenado lexicograficamente evita inversão.

O L1 coordena processos cooperativos por `open('wx')`, heartbeat e stale recovery conservador. Release determinístico já compõe L1 antes de liberar L0. A promoção a default ainda depende de prova multiprocess e consolidação com o lockfile legado. Em devcontainer, concorrência externa continua incluindo:

- VS Code/editor;
- Git;
- terminal humano;
- outro Node process;
- validações/testes;
- ferramentas externas de format/lint.

Estado ideal: manter L0 rápido, consolidar o lockfile legado e então ativar L1 por perfil para mutações P0/P1.

### 6.3 Atomicidade e durabilidade

O writer atual já executa a maior parte da sequência durável para replace. O que falta é propagar o resultado da durabilidade, tratar falhas de sync conforme política e aplicar publicação staged às outras mutações. A sequência de referência permanece:

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

L1 é bem pensado: TTL, max bytes, mtime+size, hash revalidation para arquivos pequenos. Snapshot inicial consistente, line-offset normalizado e flush derivado já foram incorporados.

A prioridade remanescente é:

- freshness do índice para mudanças externas same-size.
- medição do custo do flush imediato sob bursts.
- governança para writers que ainda não publicam invalidação.

### 6.5 Scanner, busca e index

O scanner usa `readdir({ withFileTypes: true })` e evita `lstat` para diretórios e symlinks reconhecidos. O benchmark local ficou entre 154 e 214 ms para 1.565 entradas de `src/copilot`; ainda falta benchmark comparativo automatizado e cobertura de filesystems que retornam tipo desconhecido.

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

## 8. Roadmap revisado por estado e ordem de execução

### Faixa 0 — Contenção original

#### Fase 0.1 — UTF-8 e patch seguro

- [x] Prefetch usa validação UTF-8 canônica.
- [x] Cache textual não é primado com bytes inválidos.
- [x] Patch lê bytes e recusa UTF-8 inválido.
- [x] Testes cobrem prefetch e patch binário.

#### Fase 0.2 — Bypass governance

- [ ] Criar regra de governança/allowlist para writers diretos.
- [x] Migrar `/export` para atomic portable.
- [ ] Migrar audit/SSE/observability para append canônico.
- [x] Migrar `storage/json-store.js` para atomic portable.

#### Fase 0.3 — Exclusividade básica

- [x] Copy sem overwrite usa `COPYFILE_EXCL`.
- [x] Create exclusivo usa `link`/`wx`.
- [x] Move sem overwrite é exclusivo também no caminho same-device.
- [x] Adicionar prova multiprocess real de create/copy/move.

### Faixa 1 — Durabilidade e publicação segura

#### Fase 1.1 — Writer durável

- [x] Temp exclusivo com random de 96 bits.
- [x] `flush:true` configurável por modo de durabilidade.
- [x] Rename/link final e cleanup de temp.
- [x] Directory sync best-effort.
- [ ] Propagar metadata de durabilidade para resultados públicos/health.

#### Fase 1.2 — Move seguro

- [x] `EXDEV` copia para temp, verifica hash/tamanho e publica antes de unlink.
- [x] Duplication state é exposto quando unlink da origem falha.
- [x] Same-device `overwrite=false` usa publicação exclusiva.
- [x] Falha real de `syncFileBestEffort` impede remoção da origem quando a durabilidade foi exigida.
- [x] Sync dos diretórios source/destination no caminho same-device.

#### Fase 1.3 — Copy staged

- [x] Copy com overwrite copia para temp no destino.
- [x] Verifica hash/tamanho incremental da origem e do temp.
- [x] Flush e rename/link final.
- [x] Preserva destino anterior quando copy/verify falha.

#### Fase 1.4 — Append confiável

- [x] Criar wrapper canônico de append/rotate sob o mesmo lock.
- [x] Suportar `flush` explícito e classificação `best-effort`/`durable`.
- [x] Corrigir cursor de persistência do audit ring buffer.
- [x] Reenfileirar lote SSE/audit/MCP/event collector em falha recuperável.
- [x] Leitura compartilhada ignora e sinaliza última linha JSONL parcial.
- [ ] Truncamento físico opcional da última linha parcial sob lock.
- [ ] Migrar logger/metrics/transcript síncronos ou formalizar allowlist best-effort.

### Faixa 2 — Lock multiprocess correto

#### Fase 2.1 — Lockfile opcional

- [x] `open('wx')`, metadata, timeout e abort.
- [x] Integração L0+L1 e ativação por env/opção.
- [x] PID local vivo prevalece sobre TTL.
- [x] Metadata inválida recente não é recuperada imediatamente.
- [x] Heartbeat/mtime para locks em filesystem compartilhado.
- [x] `releaseAsync` determinístico e `asyncDispose` real.
- [x] Diretório L1 pode ser fornecido explicitamente por lease.

#### Fase 2.2 — Consolidação de lock managers

- [x] Definir `file-resource-lock.js` como SSOT.
- [x] Adaptar `infra/lockfile.js` como compat facade.
- [x] Unificar symlink policy, metadata e stale recovery.

#### Fase 2.3 — Workspace-bound IO

- [ ] Dividir fachada em `workspaceIo` e `trustedPortableIo`.
- [ ] `workspaceIo` exige `workspaceRoot` e policy async.
- [ ] `trustedPortableIo` exige root/caller explícito.
- [ ] Testar traversal, symlink externo, absoluto externo e null-byte.

#### Fase 2.4 — Observabilidade

- [ ] Histograma/p95 de espera L0 e L1.
- [ ] Contadores de timeout e abort.
- [x] Contadores de stale recovery e heartbeat failure.
- [ ] Snapshot de leases com idade e operação, sem vazar path sensível.

### Faixa 3 — Snapshot e coerência derivada

#### Fase 3.1 — Snapshot consistente

- [x] `open` + `stat/read/stat` + verificação do path.
- [x] Retry limitado quando inode/fingerprint muda.
- [x] Retorna `dev`, `ino`, `ctimeMs`, tentativas e `consistent`.
- [x] Cacheia somente snapshot consistente.

#### Fase 3.2 — Snapshot de mutação incremental

- [x] Remover `Array.fromAsync(stream)`.
- [x] Hash e orçamento de rollback em `for await`.
- [ ] Adicionar teste de arquivo grande sem retenção integral.

#### Fase 3.3 — Invalidação read-after-write

- [x] Normalizar line-offset keys.
- [x] Forçar flush dos hooks derivados antes de retornar mutação canônica.
- [x] Testar equivalência de path relativo/absoluto.
- [ ] Testar mudança same-size/same-length.

#### Fase 3.4 — L2 e índice

- [ ] Perfil experimental L2 em CI.
- [ ] Auditar WAL, `busy_timeout` e `synchronous`.
- [ ] Hash/ctime/inode para freshness de arquivos pequenos.
- [ ] Medir hit ratio e cold/warm.

### Faixa 4 — Performance

#### Fase 4.1 — Scanner com Dirent

- [x] `readdir({ withFileTypes:true })`.
- [x] `lstat` apenas para arquivo/fingerprint ou caso ambíguo.
- [x] Benchmark em `src/copilot` completo.

#### Fase 4.2 — Search streaming

- [ ] Parser incremental de stdout.
- [ ] Early stop real em `maxResults`.
- [ ] Totais calculados pós-redação ou marcados como raw.

#### Fase 4.3 — Parser workers

- [x] Reset async interno existe e shutdown público aguarda.
- [ ] Backpressure/limite de fila.
- [ ] Queue length e timeout por arquivo no health.

### Faixa 5 — Provas

- [ ] Fuzz textual e binário.
- [ ] Crash injection em write, rename, directory sync, EXDEV e append.
- [x] Dois processos concorrendo por create/copy/move/write.
- [x] Crash de holder L1 seguido de stale recovery real.
- [ ] Modificação externa durante snapshot e index.
- [ ] Git checkout/editor save durante patch.

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

## 10. Ondas de implementação

### 10.1 Onda pós-reinvestigação — concluída

Foram concluídos stale recovery/release do L1, move exclusivo, copy staged, snapshot coerente e incremental, invalidação imediata e scanner com `Dirent`. O escopo fechou IO-031 a IO-037 e IO-040.

### 10.2 Onda de append canônico — parcial aplicada

1. [x] criar append canônico com framing, flush configurável e lock único;
2. [x] corrigir cursor de persistência do audit ring buffer;
3. [x] reenfileirar lotes SSE/observability/MCP em falha recuperável;
4. [x] adicionar leitura tolerante/recovery lógico de última linha JSONL parcial;
5. [ ] adicionar truncamento físico opcional da cauda parcial;
6. [ ] migrar ou allowlistar writers síncronos restantes;
7. [x] consolidar `infra/lockfile.js` sobre o L1 canônico;
8. [x] executar provas multiprocess de create/copy/move/write e crash de holder L1;
9. [ ] executar crash injection nos pontos de publish/sync e rotate+append.

---

## 11. Notas específicas sobre arquivos centrais

### `io/fs/write-atomic.js`

É a primitiva baixa canônica de replace e já possui estratégia de durabilidade. Falta expor o resultado de file flush/directory sync aos callers e decidir quando uma falha best-effort deve virar erro.

### `io/fs/locked-writes.js`

Bom encapsulamento. `expectedHash` e create exclusivo estão no lugar certo. Deve aguardar release L1 determinístico, propagar durabilidade e evoluir append para flush/rotação canônicos.

### `io/fs/locked-mutations.js`

Patch já valida UTF-8. Permanecem copy staged, move exclusivo same-device, release determinístico e rollback sidecar para arquivos grandes.

### `io/fs/move.js`

O fallback EXDEV e o caminho same-device foram endurecidos. Sem overwrite, a publicação é exclusiva por `link`; falha ao remover origem é reportada como duplicação.

### `io/fs/snapshot.js`

O snapshot de mutação agora é incremental e aceita orçamento zero. O próximo passo é teste de arquivo grande e alteração externa durante leitura.

### `io-prefetch.js`

Agora respeita a validação UTF-8 de `readText`. O risco remanescente vem do snapshot baixo inconsistente e da invalidação derivada atrasada.

### `io-cache.js`

Boa engenharia. O hash revalidation é uma proteção pragmática contra drift de mtime. Depois de snapshot consistente e path normalization universal, torna-se bastante confiável.

### `io-scanner.js`

Usa `Dirent` para classificação básica e mantém a política de não seguir symlink por padrão. Falta benchmark automatizado comparativo e caso DT_UNKNOWN.

### `io-index-sqlite.js`

Boa base de navegação e performance. A fragilidade é derivada: se qualquer writer burlar a fachada, índice e cache podem divergir.

### `io-locks.js`

Sólido no L0 e composto com L1 conservador. Release é determinístico; a próxima evolução é consolidar o lockfile legado, ampliar observabilidade e provar concorrência entre processos.

---

## 12. Critérios de aceite para declarar a infra IO “confiável”

A infra IO só deve ser considerada plenamente confiável quando:

- toda escrita fora de `infra` passar pela fachada pública ou por allowlist formal;
- `readText`, `prefetch`, `patch` e `index` compartilharem a mesma validação UTF-8;
- create/copy/move sem overwrite usarem exclusividade real;
- atomic write tiver modo durável com sync de arquivo e diretório;
- move EXDEV tiver verificação de integridade;
- snapshots de leitura forem consistentes ou falharem sem popular cache;
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

## 14. Próxima ação executável

Implementar crash injection nos pontos de publish/sync e rotate+append. Em paralelo, decidir explicitamente entre migração e allowlist best-effort para logger/metrics/transcript síncronos.
