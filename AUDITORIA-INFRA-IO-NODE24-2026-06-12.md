# Auditoria profunda de `src/copilot` — foco em Infra IO, performance, locks e corrupção de arquivos

**Data:** 2026-06-12  
**Baseline reinvestigado:** `main` sincronizada até `f58d8f03`, seguida da onda de fuzz determinístico
**Escopo primário:** `src/copilot/infra/io/**`  
**Escopo ampliado:** `src/copilot/infra` adjacente, usos diretos de filesystem em `src/copilot`, runtime Node 24.5+  
**Objetivo:** verificar se a infraestrutura de IO faz o que promete sob concorrência, falhas, cache, locks, edge cases e risco de corrupção; propor estado ideal e roadmap faseado.

---

## 1. Sumário executivo

A infra IO de `src/copilot` evoluiu materialmente desde a abertura deste documento. As ondas implementadas fecharam
stale recovery inseguro do L1, release determinístico, publicação exclusiva/verificada, snapshots coerentes,
invalidação derivada imediata, append/repair JSONL canônico, governança dos writers, metadata/health de durabilidade e
provas multiprocess/fault-injection.

No estado atual, a descrição correta é: **as primitivas centrais de mutação, append e rollback material têm contratos
fortes e provas reais, as superfícies externas de path estão vinculadas a policy async, o índice detecta mudanças
externas metadata-preserving e a contenção L0/L1 é observável sem expor paths; o L1 multiprocess agora possui perfis
explícitos por risco, remove recursivo exige confirmação exata e a raiz workspace-bound é protegida; L2 possui perfil
experimental fail-closed, custo observável, touch de recência throttled e sets persistidos em lotes transacionais;
mutações que materializam payload grande agora falham cedo quando a
insuficiência de espaço já é observável; scopes distinguem warming/ready/stale/degraded sem vazar paths; scanner,
prefetch e busca FTS compartilham uma política glob sem abrir mão da enumeração protegida; temporários de publicação
são irmãos ocultos, exclusivos e usam token de 128 bits; snapshot de rollback, L1 e índice agora recusam versões
obsoletas sob replace externo coordenado; leitura em chunks possui versão/abort explícitos; patch e write com
precondição reconfirmam a versão no último ponto portátil antes do publish; o risco dominante migrou para cobertura
por fuzz e decisões de promoção baseadas em workload**.

Prioridade arquitetural remanescente:

1. **P3 — L3 continua reservado sem demanda real:** não deve ser implementado antes de múltiplos runtimes justificarem.
   Fuzz determinístico passa a ser uma prova recorrente, não um projeto aberto.

O L2 encerrou sua fase de promoção técnica: workload, batching, crash, contenção e soak passaram. A decisão operacional
é manter `off` como default heterogêneo e usar `experimental` em runtimes long-lived que comprovadamente reutilizam o
corpus pelo menos 3–4 vezes dentro do TTL.

Conclusão atualizada: a infra já não deve ser descrita como “temp+rename sem durabilidade”, “somente lock
intra-processo”, “snapshot por read/stat paralelo”, “append fragmentado sem recovery”, “rollback grande sem
material” ou “índice pode publicar livremente após parse obsoleto”. O risco técnico dominante migrou de corrupção
nas primitivas centrais para gaps operacionais avançados.

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

Status dos novos achados naquele ponto:

- **Concluídos:** IO-031, IO-032, IO-033, IO-034, IO-035, IO-036, IO-037 e IO-040.
- **Abertos naquele ponto:** IO-038 e IO-039; ambos foram tratados nas ondas posteriores.

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

Limites remanescentes de IO-038 naquele ponto:

- `observability/logger.js` ainda usa append/rotate síncrono como fallback de emergência reentrante; a exceção agora é
  formal e protegida por contrato.
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
- **IO-038 permanecia parcial naquele ponto:** escrita assíncrona e leitura tolerante estavam centralizadas; a onda
  1.12 adicionou o truncamento físico opcional.

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

### 1.9 Status de implementação — fault injection determinístico aplicado em 2026-06-12

As primitivas baixas de write/copy/move e o writer JSONL agora aceitam callback interno opcional de fase. Callers normais não mudam; testes podem lançar falhas em pontos exatos sem depender de timing ou mocks de módulos inteiros.

Fases e invariantes provadas:

- write antes de publish: destino antigo permanece e temp é removido;
- write depois de publish: destino novo já está aplicado, mesmo quando a operação rejeita;
- copy staged antes de publish: destino anterior permanece e temp é removido;
- move depois de publish e antes de remover origem: estado de duplicação é retornado e ambos os arquivos permanecem íntegros;
- JSONL depois de rotate e antes de append: lote volta à fila, archive `.1` preserva conteúdo antigo e retry publica o lote novo.

Validação inicial:

- `typecheck:strict:src.copilot`: **PASS**.
- Testes focados de fault injection, multiprocess, engine, tools e JSONL: **96 passados, 0 falhas**.

Limites:

- Ainda falta forçar o caminho `EXDEV` real em processo isolado.
- Directory sync é best-effort por desenho; falta uma política explícita para promover falha suportada a erro em perfis duráveis estritos.
- Fault injection é determinístico por callback; kill real já está coberto para holder L1, mas não em cada fase de publish.

### 1.10 Status de implementação — governança de writers síncronos aplicada em 2026-06-12

Classificação e mudanças:

- `terminal/state/transcript-archive.js` deixou de executar `mkdirSync`/`appendFileSync` no hot path do feed. Agora
  enfileira no writer JSONL canônico, expõe queue depth/drop count e é drenado pelo shutdown do terminal.
- `observability/metrics.js` deixou de usar `mkdir`/`appendFile` direto. Cada ciclo periódico usa writer canônico e o
  singleton é drenado por handler explícito de shutdown.
- `observability/logger.js` permanece síncrono intencionalmente: sua API pública é síncrona, é usada durante falhas e
  shutdown, e não pode depender de uma fila assíncrona que também precise reportar a própria falha.
- Um contrato arquitetural bloqueia novos `appendFileSync`, `writeFileSync` e `renameSync` em produção fora de duas
  exceções justificadas: logger de emergência e gerador build-time de snapshot.

Validação:

- `typecheck:strict:src.copilot`: **PASS**.
- `lint:copilot`: **PASS**.
- Testes focados de contratos, métricas, transcript, shutdown e frontend terminal: **110 passados, 0 falhas**.
- Prova nova persiste o transcript apenas no flush explícito, sem writer síncrono no caminho de append.

### 1.11 Status de implementação — política de sync e EXDEV aplicada em 2026-06-12

Mudanças:

- Falhas reais de file/directory sync agora são promovidas a `EFILESYNC`/`EDIRECTORYSYNC`; casos explicitamente
  classificados como unsupported continuam best-effort.
- Write atômico e copy staged expõem fases antes/depois de directory sync e rejeitam falha real após publish sem
  ocultar que o conteúdo novo já pode estar aplicado.
- Move exclusivo same-device e move `EXDEV` sincronizam o diretório destino antes de remover a origem. Se esse sync
  falha, ambos os arquivos permanecem e o resultado reporta duplicação com `EDIRECTORYSYNC`.
- Sync do diretório de origem foi separado do `unlink`: uma falha após remoção da origem não é mais falsamente
  reportada como duplicação.
- Hooks internos injetáveis de sync permitem fault injection determinístico sem mocks globais de filesystem.

Validação:

- `typecheck:strict:src.copilot`: **PASS**.
- Lint focado dos arquivos alterados: **PASS**.
- Testes focados de fault injection, engine, multiprocess e file tools: **86 passados, 0 falhas**.
- Prova `EXDEV` real executada entre `/tmp` e `/dev/shm`: destino íntegro e origem removida somente após publicação e
  sync.

### 1.12 Status de implementação — recovery físico JSONL aplicado em 2026-06-12

Foi adicionada `repairJsonlTrailingPartial()` como mutação explicitamente opt-in:

- adquire o mesmo lock canônico por path usado pelos writers;
- abre o arquivo em `r+`, inspeciona apenas a última linha dentro de orçamento bounded e só trunca se o JSON final for
  inválido;
- preserva um último registro JSON válido mesmo sem newline;
- recusa truncamento quando a última linha excede o orçamento sem boundary conhecido;
- sincroniza o filehandle após truncate por default;
- expõe resultado detalhado (`reason`, bytes anteriores/finais/truncados);
- `readJsonlTail(..., { repairTrailingPartial:true })` permite repair seguido de leitura, sem mudar o default tolerante.

Validação:

- `typecheck:strict:src.copilot`: **PASS**.
- `lint:copilot`: **PASS**.
- Testes focados de reader, fault injection, multiprocess, contracts, audit e SSE: **98 passados, 0 falhas**.
- Provas novas cobrem truncamento físico, preservação de JSON válido sem newline, orçamento excedido e falha antes do
  truncate.

### 1.13 Status de implementação — metadata pública de durabilidade aplicada em 2026-06-12

Write/copy/move deixaram de descartar os resultados das primitivas de sync:

- `writeFileAtomic()` retorna o objeto `durability` com modo, file flush solicitado e resultado de directory sync;
- `copyFileLocked()` retorna `fileSync` e `destinationDirectorySync`;
- `moveFileLocked()` retorna `fileSync`, `destinationDirectorySync` e `sourceDirectorySync`, usando `null` quando a
  etapa não se aplica;
- os mesmos campos são publicados em `io.advisoryLimits`, permitindo projeção em health/telemetria sem reler o
  filesystem;
- erros promovidos por sync carregam o resultado baixo que causou `EFILESYNC`/`EDIRECTORYSYNC`.

Validação:

- `typecheck:strict:src.copilot`: **PASS**.
- `lint:copilot`: **PASS**.
- Testes focados de engine, fault injection, multiprocess, JSONL, file tools e contracts: **170 passados, 0 falhas**.
- Contratos novos confirmam metadata pública e metadata publicada no evento de IO.

### 1.14 Status de implementação — governança de writers assíncronos aplicada em 2026-06-12

A varredura de writers fora de `infra` encontrou quatro bypasses operacionais, todos migrados:

- `config/declarative-runtime-config.js`: skills config usa `writeFileAtomicPortable`;
- `mcp/control-plane/dev-oauth.js`: refresh tokens e clients usam `writeFileAtomicPortable`;
- `mcp/control-plane/jobs.js`: log inicial usa `writeFileAtomic` e chunks usam `appendTextLocked`;
- `terminal/commands/byok.js`: `.env.local` usa `writeFileAtomicPortable`.

Um contrato arquitetural agora analisa imports nomeados, default e namespace de `node:fs/promises` e rejeita
`appendFile`, `copyFile`, `link`, `rename`, `symlink`, `truncate` e `writeFile` fora de `infra`. Remoções/cleanup e
`mkdir` continuam classificados separadamente, pois têm semântica diferente de writer/publication.

Validação:

- `typecheck:strict:src.copilot`: **PASS**.
- `lint:copilot`: **PASS**.
- Testes focados de contracts, jobs MCP, OAuth, BYOK e config: **321 passados, 0 falhas**.

### 1.15 Status de implementação — agregados de durabilidade no health aplicados em 2026-06-12

`io-observability.js` agora agrega, com cardinalidade fixa:

- operações observadas e operações com metadata de durabilidade;
- modos solicitados e file flush solicitado;
- file/directory sync tentado, confirmado, skipped unsupported e falho;
- última falha real com kind, operação, código e timestamp.

`readIoRuntimeHealthSnapshot()` expõe o snapshot em `durability` e emite alerta
`IO_DURABILITY_SYNC_FAILED` quando uma falha real foi observada. Paths e códigos arbitrários não viram séries
dinâmicas.

Validação:

- `typecheck:strict:src.copilot`: **PASS**.
- `lint:copilot`: **PASS**.
- Testes focados de observabilidade, engine, fault injection, multiprocess, contracts e métricas: **125 passados, 0
  falhas**.

### 1.16 Status de implementação — matriz de cleanup/mkdir aplicada em 2026-06-12

Os mutators diretos restantes fora de `infra` foram classificados:

- `mkdir`: preparação de diretório para DB, PID/log, jobs, latency history, quarantine metadata e estado do agent;
- `rm`/`unlink`: cleanup de estado/PID/cache e retenção bounded/validada de snapshots, jobs e selection traces.

Um `mkdir` redundante do snapshot store foi removido, pois `writeFileAtomicPortable` já cria o diretório pai. Um contrato
arquitetural exige correspondência exata entre os calls encontrados e uma matriz por arquivo/operação; ele reconhece
imports nomeados, namespace/default de `node:fs/promises` e `import { promises as fs } from 'node:fs'`.

Validação:

- `typecheck:strict:src.copilot`: **PASS**.
- Lint focado: **PASS**.
- Contrato arquitetural e snapshot store: **92 passados, 0 falhas**.

### 1.17 Status de implementação — capability trusted/portable separada em 2026-06-12

A escrita portable deixou de sair pela mesma fachada da API workspace-facing:

- `infra/public/io.js` não exporta mais `writeFileAtomicPortable`;
- a nova capability `infra/public/trusted-io.js` exporta `writeFileAtomicTrusted()` e exige `caller` não vazio antes
  de acessar o filesystem;
- os 16 owners externos foram migrados para a nova fachada, incluindo o deep import de `/export`;
- a primitiva `writeFileAtomicPortable` permanece interna a `infra`, onde pode compor stores baixos;
- contrato arquitetural exige correspondência exata entre importer e caller trusted e rejeita vazamento da primitiva
  portable para fora de `infra`;
- teste da fachada comprova fail-fast sem caller e publicação quando a confiança é declarada.

Esta onda fecha a mistura de capabilities, mas **não** declara a API comum workspace-bound: `infra/public/io.js`
continua workspace-facing e depende da validação feita pelos adapters. O passo restante de IO-014 é aplicar
`workspaceRoot` e policy async na própria fronteira sem quebrar os consumidores de runtime trusted.

Validação:

- `typecheck:strict:src.copilot`: **PASS**.
- `lint:copilot`: **PASS**.
- Testes focados de contracts, fachada trusted e consumidores migrados: **299 passados, 0 falhas**.
- `typecheck:strict` global parou em dívida preexistente de `terminal/capabilities/structured-preview.js`:
  `js-yaml.dump` ausente no tipo resolvido.

### 1.18 Status de implementação — capability workspace-bound aplicada em 2026-06-12

IO-014 foi concluído nas superfícies que recebem paths externos:

- `infra/public/workspace-io.js` cria uma capability vinculada a `workspaceRoot` explícito;
- todas as operações de um path ou source/destination executam `evaluateIoPathPolicyAsync()` imediatamente antes da
  primitiva, usando o `realPath` validado;
- scan/search recebem o workspace root vinculado, sem aceitar que o caller amplie containment por options;
- file/search/session/hook/task tools, MCP repo read/write/index/plan/smoke, presentation file context e SDK SessionFs
  foram migrados;
- health saiu da facade operacional e usa sua facade nomeada;
- o diagnóstico de storage configurado do SessionFs, legitimamente portable, usa `statPathTrusted()` com caller
  allowlistado;
- contrato arquitetural rejeita qualquer retorno de tools, MCP tools e bordas externas conhecidas à facade
  operacional irrestrita;
- testes cobrem workspace root ausente, traversal, null-byte, absoluto externo, symlink externo e leitura/escrita
  interna.

`infra/public/io.js` permanece como facade operacional baixa para composição interna e adapters não orientados por
entrada externa; sua documentação agora declara explicitamente que ela não oferece containment.

Validação:

- `typecheck:strict:src.copilot`: **PASS**.
- `lint:copilot`: **PASS**.
- Rodadas verdes focadas: tools/contracts **368 passados**; MCP/contracts **94 passados**; capabilities, SDK SessionFs
  e presentation **194 passados**, todas com **0 falhas**.
- Uma rodada mais ampla teve **582 passados** e cinco falhas não relacionadas: quatro imports de módulos
  Cloudflare/CLI ausentes no checkout e timeout de import em `test_code_permission_tools.spec.js`.

### 1.19 Status de implementação — freshness forte do índice aplicada em 2026-06-12

IO-017 deixou de depender somente de `mtime+size`:

- fingerprints do scanner incluem `ctimeMs`, `dev` e `ino`, além de `mtimeMs`, size e realpath;
- o schema do índice ganhou colunas `dev/ino`, com migração idempotente via `PRAGMA table_info` para bancos existentes;
- o fast path exige igualdade de `mtime+size+ctime+dev+ino`;
- arquivos até `IO_INDEX_HASH_VERIFY_MAX_BYTES` (default `1 MiB`) recebem renovação periódica por hash após
  `IO_INDEX_HASH_VERIFY_INTERVAL_MS` (default `30 s`), cobrindo filesystems com metadata pouco granular;
- metadata divergente com hash idêntico atualiza somente fingerprint/refreshed time, sem refazer FTS, chunks ou parser;
- hash divergente reutiliza o snapshot já lido para reindexação, evitando segunda leitura;
- stats e resultado de build expõem verificações/hits/misses e a freshness policy efetiva;
- metadata persistida usa `indexVersion: 2`.

Provas adicionadas:

- mudança externa same-size com mtime restaurado é detectada por ctime/identidade e substitui o conteúdo FTS;
- metadata simuladamente indistinguível é desmascarada pela verificação periódica de hash;
- hash hit renova freshness sem reindexar;
- schema legado é migrado preservando a tabela existente.

Validação:

- `typecheck:strict:src.copilot`: **PASS**.
- `lint:copilot`: **PASS**.
- Testes focados de índice/scanner/store: **29 passados, 0 falhas**.
- Validação ampliada de consumidores MCP/tools/contracts: **88 passados, 0 falhas**.

### 1.20 Status de implementação — rollback sidecar durável aplicado em 2026-06-12

IO-010 foi fechado para delete, patch e restauração de destino em copy/move:

- `rollback-sidecar.js` grava conteúdo excedente em `.ai/rollback` somente após o snapshot ultrapassar o orçamento
  em memória;
- a publicação usa temp exclusivo, modo `0600`, escrita completa por `FileHandle`, `sync()` do arquivo, rename e sync
  do diretório;
- o nome final codifica expiração, SHA-256 e UUID; o descritor registra version, path, hash, bytes, criação e TTL;
- o hash fornecido por callers materializados é verificado contra os bytes antes da persistência;
- cleanup bounded remove somente nomes do schema expirados, incluindo `.pending` órfãos, sob lock L0+L1;
- `dry-run` de patch grande continua sem efeitos colaterais e não cria sidecar;
- delete e destinos sobrescritos de copy/move propagam sidecar; snapshots de origem usados apenas para integridade não
  geram artefatos desnecessários;
- plano/token de rollback passou a version 2 e inclui `snapshotSidecar`, mantendo verificação e parse de tokens v1;
- tools e MCP consideram base64 ou sidecar como material de restauração disponível.

Provas adicionadas:

- snapshot streamado grande preserva bytes exatos, hash, tamanho, TTL e modo `0600`;
- cleanup remove sidecar final e `.pending` expirados sem tocar nome desconhecido ou sidecar ativo;
- hash divergente é recusado;
- delete e patch grandes preservam conteúdo anterior materialmente; patch dry-run não cria artefato;
- token v2 faz round-trip com sidecar e token v1 legado continua verificável.

Validação:

- `typecheck:strict:src.copilot`: **PASS**.
- `lint:copilot`: **PASS**.
- rodada focada infra/runtime: **49 passados, 0 falhas**.
- rodada ampliada infra/tools/MCP: **115 passados, 0 falhas**.

### 1.21 Status de implementação — contagens pós-sanitização aplicadas em 2026-06-12

IO-015 foi fechado em todas as engines de busca textual e simbólica:

- rg, grep, FTS textual, alternation FTS e busca de símbolos sanitizam o conjunto capturado antes da paginação;
- linhas integralmente bloqueadas não consomem `maxResults`, não avançam cursor e não entram em totals;
- linhas preservadas com substituições visíveis como `[redacted]` continuam contando normalmente;
- filtros integrais de PEM/JWT agora marcam `sanitized=true` e incrementam `redactions`;
- `matchCount`, `returnedMatchCount`, `returnedLineCount`, `totalMatches`, `totalMatchCount` e `totalLineCount` derivam
  somente da visão sanitizada;
- o contrato público explicita `countsPostSanitization: true` em engine, tools e MCP.

Prova regressiva:

- a primeira ocorrência de uma página contém JWT-like e é removida;
- a ocorrência segura seguinte ocupa a página;
- totals, cursor e truncation reportam apenas a visão retornável.

Validação:

- `typecheck:strict:src.copilot`: **PASS**.
- lint dos arquivos tocados: **PASS**.
- infra/search, engine, tools e MCP: **98 passados, 0 falhas**.

### 1.22 Status de implementação — observabilidade bounded de locks aplicada em 2026-06-12

IO-025 foi fechado para L0 e L1:

- `lock-observability.js` centraliza histogramas Node de espera geral e por operação sanitizada;
- a cardinalidade por operação é limitada a 32, com eviction da série mais antiga;
- L0 expõe attempts, acquisitions, contenções, reentrâncias, timeout, abort, falhas, waiters atuais e high-water real
  da fila;
- L1 expõe os mesmos outcomes relevantes, além dos contadores existentes de stale recovery e heartbeat failure;
- p50/p95/p99, mean, max e count são projetados separadamente para L0 e L1;
- snapshots públicos limitam leases ativos a 32 entradas, com hash do recurso, operação sanitizada, idade e espera;
- `resources`, `lockDir`, target, token e paths absolutos deixaram de aparecer nos stats públicos;
- o health de IO inclui `locks` e emite `IO_LOCK_TIMEOUT_OBSERVED` após timeout L0/L1;
- a métrica antiga de último `lockWaitMs` permanece compatível, mas o health passa a oferecer distribuição cumulativa.

Provas adicionadas:

- contenção e timeout L0 incrementam os contadores corretos;
- timeout L1 é observado independentemente do L0;
- abort pré-aquisição é contado nos dois níveis;
- snapshots ativos permitem correlação por SHA-256 sem conter path do recurso ou diretório de locks;
- cardinalidade e amostras públicas permanecem bounded.

Validação:

- `typecheck:strict:src.copilot`: **PASS**.
- lint focado dos arquivos alterados: **PASS**.
- locks, health e engine: **49 passados, 0 falhas**.

### 1.23 Status de implementação — perfis L1 por risco aplicados em 2026-06-12

IO-002 saiu do estado “só L0 intra-processo” para um modelo operacional opt-in e explícito:

- `COPILOT_IO_FILE_LOCKS_ENABLED` passou a aceitar `off`, `high-risk`, `mutations` e `all`;
- compatibilidade preservada: `1/true/yes/on` equivalem a `all`, `0/false/no/off` equivalem a `off`;
- `high-risk` ativa L1 para `high`/`critical`, cobrindo delete, remove, move, patch não dry-run, copy overwrite,
  repair JSONL e transações de quarentena;
- `mutations` ativa L1 para `medium+`, incluindo write, append, mkdir, JSONL append e writes trusted;
- `all` mantém o comportamento booleano antigo de ligar L1 para todos os locks, inclusive low-risk;
- `fileLock:true` continua sendo override explícito para casos especiais como cleanup de sidecar;
- `getIoLockStats().fileLocks` agora expõe `profile` e `configurationValid`;
- perfil inválido falha acquisition com `ERR_IO_FILE_LOCK_PROFILE` e aparece no health como
  `IO_LOCK_PROFILE_INVALID`, sem derrubar a leitura do snapshot;
- mutators e transações read-modify-write propagam `operation`, `target` e `riskClass` ao resolver o L1;
- env governance foi alinhada em `.env.schema.json`, `.env.expert.example` e
  `DOCUMENTAÇÃO/REFERENCIA/ENV_VARIABLES_GUIDE.md`;
- a lacuna preexistente `TERMINAL_DISPLAY_PRESET` também foi coberta no schema/template para deixar o audit de env
  limpo.

Validação:

- `typecheck:strict:src.copilot`: **PASS**.
- lint focado dos arquivos alterados: **PASS**.
- env: `audit-env-surface`, `validate-env` e `check-env-local`: **PASS**.
- locks, engine, health, MCP repo-write e state IO: **85 passados, 0 falhas**.

### 1.24 Status de implementação — search streaming aplicado em 2026-06-12

IO-026 saiu do modelo de `execFile` com stdout materializado até `maxBuffer` para parser incremental por linha nos caminhos
textuais baseados em `rg`/`grep`.

Mudanças efetivamente incorporadas:

- `subprocess.js` ganhou `streamSearchFile()`, preservando `execSearchFile()` para callers legados;
- o streaming processa stdout por linha e permite que o callback interrompa a busca retornando `false`;
- interrupção voluntária envia `SIGTERM` ao subprocesso e resolve com `stoppedEarly:true`, sem transformar early stop em erro;
- o limite de buffer continua existindo como proteção contra linhas/chunks anômalos, mas não é mais a estratégia normal de
  paginação;
- `searchText` via `rg`/`grep` passou a sanitizar cada linha antes de contar/paginar e interrompe após a janela
  `cursorOffset + maxResults + 1`;
- `searchWorkspaceSymbols` via `rg` também passou a usar coletor incremental com early stop real;
- resultados textuais e de símbolos expõem `io.advisoryLimits.streamStoppedEarly` quando a busca foi encerrada por janela;
- FTS/index permanecem fora desse caminho por já operarem sobre dados indexados em memória/SQLite, não stdout de subprocesso;
- a semântica pós-sanitização foi preservada: linhas filtradas por política sensível não entram no cursor, total parcial ou
  lookahead.

Validação:

- `typecheck:strict:src.copilot`: **PASS**.
- lint focado dos arquivos alterados: **PASS**.
- search subprocess, search infra, engine e MCP tools: **89 passados, 0 falhas**.

### 1.25 Status de implementação — parser worker backpressure aplicado em 2026-06-12

A Fase 4.3 deixou de depender de uma fila in-memory ilimitada para parser workers.

Mudanças efetivamente incorporadas:

- `IO_PARSER_WORKER_QUEUE_MAX` foi introduzido como knob especializado, com default adaptativo
  `max(16, workerPoolSize * 32)`;
- valores inválidos recuperam para o default adaptativo; valores válidos são limitados a `0..10000`;
- `queueMax=0` permite dispatch imediato quando há worker livre, mas rejeita backlog;
- requests na fila têm timeout end-to-end: o orçamento começa enquanto o arquivo ainda aguarda worker;
- rejeição por fila cheia, timeout de fila e timeout de worker retornam `parseError` parcial em vez de cair para parse
  síncrono e aumentar pressão no event loop;
- workers ficam `unref()` quando ociosos e `ref()` apenas durante uma task ativa;
- `resetParserCacheForTest()` passou a ser awaitable, e teardown de workers ficou explícito por opção;
- `getParserCacheStats()` e o health de IO agora expõem `workerQueueMax`, `workerQueueLength`,
  `workerQueueHighWater`, `workerQueueRejected`, `workerQueueTimeouts`, `workerQueueWaitMsLast` e
  `workerQueueWaitMsMax`;
- `.env.expert.example`, `.env.schema.json` e `ENV_VARIABLES_GUIDE.md` foram alinhados com o novo knob.

Limite observado:

- Node 24 ainda pode manter um `MessagePort` vivo depois de um ciclo artificial de worker em subprocesso curto; o teste de
  backpressure força `process.exit(0)` após imprimir o resultado isolado. O contrato de fila/health não depende desse
  detalhe, mas a investigação de handles pode ser retomada se CLIs reais voltarem a prender processo.

Validação:

- `typecheck:strict:src.copilot`: **PASS**.
- lint focado dos arquivos alterados: **PASS**.
- env: `audit-env-surface`, `validate-env` e `check-env-local`: **PASS**.
- parser e IO observability: **28 passados, 0 falhas**.

### 1.26 Investigação transversal — seleção e troca funcional de modelo em 2026-06-14

A investigação adicional solicitada sobre `model-gateway` encontrou dois problemas funcionais e dois falsos negativos
do harness live:

- `autoStandby` e `operatorReady` usavam implicitamente `metadata_first`; a mesma rota que `liveReadiness` reconhecia
  como provada aparecia como `needsProbe:true`;
- a automação confundia `routeProfile/taskProfile` (`repo_agent`) com o perfil BYOK vivo (`kilo`), exigindo nova sessão
  mesmo quando preset e modelo já estavam alinhados;
- o harness aguardava indefinidamente um novo prompt após `LLM-B pronta`, embora o terminal já aceitasse comandos;
- critérios live dependiam de títulos antigos e da janela truncada de `/events --raw`, em vez do SSE coletado.

Transformações aplicadas em `b80a85a8`:

- standby/operator-ready passaram a preferir rotas provadas por default;
- cada rota expõe `recommendedAction` e `recommendedCommand`: sonda para rota sem prova, `/byok model` para mesma
  fronteira e handoff explícito para novo provedor;
- a superfície terminal mostra `Recomendado`;
- a decisão automática separa perfil de tarefa da fronteira BYOK real;
- o harness live inicia a sequência após prontidão mesmo quando o prompt não é redesenhado e valida confirmação de
  modelo pelo SSE coletado.

Provas live executadas:

- fixture BYOK: **PASS**, incluindo `byok-fixture-model-switch`, em
  `artifacts/terminal-live/2026-06-14T05-52-13-315Z/summary.md`;
- troca SDK viva `/model gpt-4.1-mini`: **PASS**, confirmada por `session.model_changed`, em
  `artifacts/terminal-live/2026-06-14T05-57-05-435Z/summary.md`;
- automação LLM-B/operator-ready/standby/apply: **PASS**, com rota alinhada classificada como `keep_current`, em
  `artifacts/terminal-live/2026-06-14T05-59-33-180Z/summary.md`.

Resultado operacional: operador e LLM-B agora recebem uma ação direta priorizada a partir de rotas provadas, a troca
viva SDK foi confirmada end-to-end e a automação não exige novo boot por conflito falso entre perfis de naturezas
diferentes.

### 1.27 Status de implementação — confirmação forte de remove recursivo aplicada em 2026-06-14

IO-022 foi fechado por confirmação reforçada intrínseca, preservando o sistema de quarentena reversível existente no
MCP sem criar uma segunda implementação concorrente na engine baixa.

Mudanças efetivamente incorporadas:

- `removePathUnlocked` e `removePathLocked` recusam `recursive:true` sem `recursiveConfirmation` exatamente igual ao
  path resolvido do alvo, com erro `ERECURSIVEREMOVECONFIRMATION`;
- `workspaceIo.removePathLocked` traduz uma confirmação relativa que coincide com o input para o path real validado
  pela policy async;
- a capability workspace-bound recusa remover recursivamente a própria raiz, com
  `ERECURSIVEWORKSPACEROOT`;
- `SessionFsProvider.rm` continua compatível, mas só confirma depois de resolver containment dentro da raiz isolada;
- metadata de IO registra `recursiveConfirmed:true` quando a remoção destrutiva foi autorizada corretamente.

Limite consciente: a engine continua removendo de forma destrutiva após confirmação; árvore inteira não é copiada para
snapshot/quarentena por default. Para fluxos humanos reversíveis, `repo_quarantine_file` continua sendo a superfície
preferida. O risco acidental foi reduzido sem transformar `rm` em uma operação de cópia potencialmente ilimitada.

Validação focada:

- IO engine, workspace IO e SessionFS: **57 passados, 0 falhas**;
- typecheck strict e lint focado: **PASS** após ajuste de `exactOptionalPropertyTypes`.

### 1.28 Status de implementação — perfil experimental e telemetria L2 aplicados em 2026-06-14

IO-018 deixou de ser uma ativação booleana opaca. O cache L2 SQLite agora possui política operacional explícita,
compatibilidade legada e telemetria suficiente para decidir promoção sem adivinhação.

Mudanças efetivamente incorporadas:

- `IO_L2_CACHE_PROFILE=off|experimental|on` é o contrato preferido; valor inválido falha fechado e gera alerta
  `IO_L2_PROFILE_INVALID`;
- `experimental` usa TTL/pruning de 60 segundos e até 10.000 entradas; `on` preserva TTL/pruning de 5 minutos e até
  100.000 entradas; overrides especializados continuam disponíveis;
- `IO_L2_CACHE_ENABLED` permanece como compatibilidade apenas quando o perfil explícito está ausente;
- stats/health expõem perfil, origem, validade e latência bounded de `get`, `set`, `invalidate`, `prune` e `clear`;
- schema, catálogo expert e guia canônico de ENV foram alinhados;
- a auditoria confirmou que o DB Copilot já usa `WAL`, `synchronous=NORMAL`, `busy_timeout=5000`,
  `wal_autocheckpoint=1000` e cache SQLite de 16 MiB.

Prova live com dois processos Node separados e banco isolado:

- primeiro processo: `l1-miss`, um miss L2 e um set de payload textual de 91.562 bytes;
- processos seguintes: `l2-hit` real com fingerprint `l2-mtime-size`;
- primeiro hit persistido por processo custou entre **9,053 ms e 13,941 ms** nessa amostra;
- steady-state direto de 101 gets: média **0,147 ms**, máximo **0,384 ms**; set: **1,076 ms**.

Conclusão operacional: o perfil experimental funciona e preserva hotset após restart, mas permanece `off` por default.
O custo cold-start observado impede promover `on` globalmente sem hit ratio e distribuição de payloads do workload
real. IO-018 está concluído com esse limite documentado.

### 1.29 Status de implementação — preflight de capacidade aplicado em 2026-06-14

IO-028 foi fechado nas mutações que realmente precisam materializar um payload completo no destino:

- atomic write, copy staged e move cross-device consultam `statfs` antes de criar o temporário;
- move same-device não paga a checagem, pois `rename`/hard link não copiam o payload;
- o default checa payloads a partir de 64 MiB e exige 64 MiB adicionais de headroom;
- `IO_CAPACITY_PREFLIGHT_MIN_BYTES=0` desabilita; `IO_CAPACITY_PREFLIGHT_RESERVE_BYTES` ajusta a reserva advisory;
- insuficiência observável falha cedo com `ENOSPC` e relatório estruturado;
- `statfs` ausente/unsupported falha aberto para preservar portabilidade;
- resultados são propagados em metadata das mutações canônicas.

Limite consciente: `statfs` não reserva blocos. Outra operação ainda pode consumir espaço entre preflight e escrita,
portanto o relatório reduz falhas parciais previsíveis sem prometer ausência de `ENOSPC`.

Provas:

- teste live real em `/tmp`: relatório `checked:true`, `sufficient:true`, com bytes disponíveis/headroom;
- unitários cobrem disabled/below-threshold/sufficient/insufficient/unsupported e provam que atomic write/copy não
  criam temp nem substituem destino quando o preflight rejeita;
- IO engine + fault injection + capacidade: **60 passados, 0 falhas**;
- typecheck strict e lint focado: **PASS**.

### 1.30 Status de implementação — readiness explícita de scopes aplicada em 2026-06-14

IO-024 foi fechado sem quebrar o contrato não-rejeitante de `awaitReady()`:

- scopes expõem `status: warming|ready|stale|degraded`, além de `ready` e `degraded` explícitos;
- erro de warm/parse/index/refresh é resumido por fase, código, nome e resumo estável, sem path ou mensagem crua;
- warm-up parcial/falho nunca mais define `ready:true`;
- invalidação é `stale`; refresh bem-sucedido recupera `ready`; refresh falho permanece `degraded`;
- cleanup de redeclaração só remove o `AbortController` que ainda possui, evitando apagar o controller do scope novo;
- health agrega contagens por estado e emite `IO_SCOPE_DEGRADED`;
- terminal mostra `degradado`/`desatualizado` e um resumo sanitizado quando necessário.

Prova live isolada:

- path ausente resolveu com `ready:false`, `degraded:true`, `status:"degraded"` e `failed:1`;
- health mostrou `degraded:1` e alerta `IO_SCOPE_DEGRADED`;
- busca explícita no JSON de stats/health confirmou `leaksPath:false`.

Validação focada: scopes, health e comando terminal: **20 passados, 0 falhas**; typecheck strict e lint: **PASS**.

### 1.31 Status de implementação — política glob canônica aplicada em 2026-06-14

IO-027 foi fechado consolidando matching, sem substituir o scanner seguro por enumeração crua:

- `scan/glob.js` usa `minimatch` v10 como autoridade para brace expansion, globstar, extglob, classes, dotfiles e
  separadores Windows;
- padrões sem barra mantêm basename matching; padrões simples como `node_modules` e `src/copilot` continuam
  representando segmentos/subtrees;
- scanner, prefetch e pós-filtro FTS compartilham a mesma função;
- `!` e `#` são literais, pois include/exclude já são campos separados e negation implícita seria perigosa;
- metadata informa `globEngine:"minimatch-v10"`;
- a enumeração permanece em `io-scanner`, preservando denylist, policy async, gitignore e não-follow de symlink.

Prova live em `src/copilot` com `**/*.{js,ts}` e exclude simples `docs`:

- scanner canônico: **1.259 arquivos**;
- `fsPromises.glob`: **1.264 arquivos**;
- os cinco extras do glob cru estavam em `model-gateway/secrets`, corretamente removidos pela policy do scanner;
- nenhum arquivo de `docs/` atravessou o exclude.

Validação focada de glob/scanner/prefetch/search/index: **50 passados, 0 falhas**; typecheck strict e lint: **PASS**.

### 1.32 Status de implementação — temporários canônicos aplicados em 2026-06-14

IO-021 foi fechado após varredura dos geradores reais de temporários e artefatos de recuperação em `src/copilot`:

- `write-atomic`, copy staged e move cross-device agora usam `createSiblingTempPath()` como autoridade única;
- o formato original desta onda era `.<basename>.<pid>.<token-128-bit>.<role>.tmp`, no mesmo diretório do destino;
- o nome da entrada é limitado a 240 bytes, truncando o basename em fronteira UTF-8 para preservar destinos longos;
- `writeFile(..., flag:'wx')` e `COPYFILE_EXCL` continuam sendo a autoridade contra colisão;
- o sidecar de rollback já era conforme: `.pending`, `open('wx')`, PID e UUID, com schema especializado para cleanup;
- backups de restore da quarentena não são temporários descartáveis: são material de recuperação referenciado pelo
  journal e já usam UUID integral.

A busca completa não encontrou o `randomBytes(4)` citado pelo achado original. Antes desta onda, write/copy/move já
usavam 96 bits; o débito real era o atomic write não oculto e três convenções artesanais divergentes.

Prova live com falha injetada antes do publish:

- write, copy e move produziram nomes ocultos com exatamente 32 dígitos hexadecimais;
- write/copy removeram o temporário no caminho de erro;
- o diretório terminou apenas com `source.txt` e `target.txt`;
- maior nome observado: 60 bytes.

Validação focada: **65 passados, 0 falhas**; typecheck strict de `src/copilot` e lint dos arquivos tocados: **PASS**.

### 1.33 Status de implementação — canário CI do L2 experimental aplicado em 2026-06-14

A pendência de execução recorrente do perfil `experimental` foi fechada sem alterar o default:

- `scripts/ci/check-copilot-io-l2.mjs` cria um banco SQLite efêmero fora do workspace;
- um subprocesso prova que ausência de configuração continua resolvendo para `off`;
- um segundo subprocesso inicializa `experimental`, valida defaults conservadores e persiste payload de 65.557 bytes;
- um terceiro subprocesso abre o mesmo banco, confirma hash/metadata e contabiliza hit real;
- o banco, WAL/SHM e diretório temporário são removidos ao final;
- o step roda antes da validação global de workflows no job `validate` de todo push/PR;
- `validate-workflows.mjs` exige a presença do script e do comando no workflow, evitando remoção silenciosa;
- `GITHUB_STEP_SUMMARY` recebe perfil, persistência, bytes e latências observadas.

Prova local repetida:

- default: `off`, `enabled:false`;
- experimental: TTL 60 s, máximo 10.000 entradas e prune de 60 s;
- persistência multiprocess: `true`, zero erros e hash SHA-256 idêntico;
- amostras cold do primeiro get no processo leitor: 34,296 ms, 16,188 ms e 8,054 ms;
- set observado entre 0,314 ms e 1,072 ms.

Validação: canário **PASS**, lint focado **PASS**, typecheck strict de `scripts/ci` **PASS**, parse YAML/actionlint
**PASS**. O validador global continua encontrando uma dívida preexistente e externa à onda:
`main_chatgpt-docker-puppeteer.yml` não possui `permissions` top-level. O canário foi ordenado antes desse check para
continuar produzindo evidência recorrente sem mascarar a falha existente.

### 1.34 Status de implementação — workload longo e touch L2 throttled aplicados em 2026-06-14

O harness `scripts/analysis/copilot-io-l2-workload.mjs` passou a comparar três processos sobre o mesmo manifesto
protegido do scanner:

1. seed com perfil `experimental`;
2. baseline com L2 `off` e filesystem já aquecido;
3. read em novo processo com perfil `experimental`.

Ele mede hit ratio, distribuição de payloads, percentis, throughput, overhead do seed, economia por reuse e quantidade
de reusos necessária para break-even. O banco e o manifesto são efêmeros; o source é somente leitura.

A primeira rodada sobre 1.246 arquivos JS/TS/MJS/CJS reais de `src/copilot` revelou uma regressão estrutural:

- 10,51 MB totais; 613 arquivos abaixo de 4 KiB e 472 entre 4–16 KiB;
- hit ratio de 100%, mas L2 levou 952–1.042 ms contra 423–427 ms do filesystem quente;
- cada `get` executava `UPDATE last_accessed_ms`, convertendo hit em escrita WAL;
- máximos de get chegaram a 251–261 ms por checkpoint/write amplification.

`io-cache-l2-sqlite.js` agora atualiza recência no máximo uma vez por janela bounded: mínimo 1 s, `TTL/4` e máximo
30 s. O timestamp continua governando evicção LRU, mas hits próximos apenas incrementam `touchSkips`; `touchWrites`,
`touchSkips` e `touchIntervalMs` entram nos stats.

Após o hardening, três amostras completas mostraram:

- concorrência 8: read L2 em 152–157 ms contra filesystem quente em 390–406 ms, ganho de 2,57x–2,63x;
- serial: read L2 em 267 ms contra filesystem quente em 900 ms, ganho de 3,37x;
- média interna de get caiu de 0,67–0,72 ms para 0,045–0,055 ms;
- máximo de get caiu de 244–261 ms para 0,60–0,99 ms;
- 1.246 `touchSkips`, zero `touchWrites` no reuse imediato;
- seed ainda levou 2,40–2,65 s em concorrência 8, cerca de 5,9x–6,6x o baseline;
- amostra final calculou premium de seed de 2.000 ms, economia de 248 ms por reuse e break-even em **nove reusos**.

Decisão: manter `IO_L2_CACHE_PROFILE=off` como default. O reuse agora é materialmente melhor, mas a promoção global
continua injustificada para processos curtos. A próxima hipótese a medir é admissão por tamanho e/ou batching de sets.

Validação: cache SQLite/registry/engine **57 passados, 0 falhas**; lint focado e typecheck strict de `src/copilot` e
`scripts/analysis`: **PASS**.

### 1.35 Status de implementação — matriz de admissão L2 aplicada em 2026-06-14

Foi adicionado o knob expert `IO_L2_CACHE_MIN_BYTES`, com schema, template, guia e stats `admissionSkips`/`minBytes`.
Zero admite todos os payloads. O harness aceita `--min-bytes` e mede o workload completo, incluindo arquivos recusados
que fazem fallback para filesystem.

Matriz sobre os mesmos 1.246 arquivos, concorrência 8:

| Limiar | Entradas persistidas | Bytes persistidos | Seed | Reuse | FS quente | Break-even |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 1.246 | 10,51 MB | 2.406 ms | 157 ms | 406 ms | 9 reusos |
| 4 KiB | 633 | 9,54 MB | 1.610 ms | 315 ms | 414 ms | 13 reusos |
| 16 KiB | 161 | 5,43 MB | 1.005 ms | 416 ms | 443 ms | 22 reusos |
| 64 KiB | 14 | 1,68 MB | 454 ms | 426 ms | 411 ms | não alcança |

Conclusão: admissão por tamanho reduz seed, mas também perde economia de reuse e continua pagando lookup SQLite nos
misses. Nenhum limiar melhorou o break-even. `experimental`, `on` e compatibilidade legado permanecem com
`minBytes=0` por default; o knob fica disponível apenas para workloads especializados. A próxima hipótese válida é
batching de sets.

Validação após a superfície de env: cache/registry/engine **58 passados, 0 falhas**; canário **PASS**; lint e
typechecks strict **PASS**; `validate-env`, `check-env-local` e `audit-env-surface`: **PASS**.

### 1.36 Status de implementação — batching write-behind L2 aplicado em 2026-06-14

IO-045 foi fechado com um buffer write-behind bounded em `io-cache-l2-sqlite.js`:

- `set()` normaliza e mantém a linha imediatamente visível para `get()`, sem esperar SQLite;
- a persistência usa uma transação por lote, janela padrão de 25 ms e limite de 256 chaves;
- uma chave repetida antes do flush mantém apenas a versão mais recente no `Map` pendente;
- atingir o limite, `flushPending()`, observação de stats, reset, mudança/desativação de perfil drenam o lote;
- invalidate, prune e clear também atuam sobre as linhas pendentes;
- falha transacional recoloca linhas no buffer, preservando leitura local e permitindo retry;
- stats distinguem enfileiramento (`set`) de persistência (`flush`) e expõem `batchFlushes`, `batchedRows`,
  `batchFailures`, `pendingSets` e tamanho médio do lote.

O harness foi corrigido para executar `flushPending()` **antes** de encerrar o cronômetro do seed. Assim, a economia
não esconde escrita no teardown. Duas amostras concorrentes e uma serial sobre os mesmos 1.246 arquivos mostraram:

| Perfil | Seed | FS quente | Reuse L2 | Transações | Lote médio | Hit ratio | Break-even |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| concorrência 8, run 1 | 1.089 ms | 387 ms | 169 ms | 19 | 65,6 | 100% | 4 |
| concorrência 8, run 2 | 1.084 ms | 400 ms | 152 ms | 19 | 65,6 | 100% | 3 |
| serial | 1.466 ms | 715 ms | 271 ms | 35 | 35,6 | 100% | 2 |

Comparado ao seed sem batching de 2,40–2,65 s, o seed concorrente caiu aproximadamente 55%–59%; o break-even caiu
de nove para 3–4 reusos. A leitura cross-process e o isolamento do banco continuam provados pelo canário.

Artefatos locais:

- `artifacts/io-l2-workload/batched-25ms-run-1.json`;
- `artifacts/io-l2-workload/batched-25ms-run-2.json`;
- `artifacts/io-l2-workload/batched-25ms-serial.json`.

Decisão: aceitar batching no perfil L2, mas manter `IO_L2_CACHE_PROFILE=off` como default. O próximo gate de promoção
é operacional: provar comportamento sob `SIGKILL` com lote pendente, lock/contenção SQLite externa e repetição em
processo longo. Perder o último lote em crash é aceitável para cache reconstruível; corromper, bloquear shutdown ou
degradar a leitura não é.

Validação: cache SQLite/registry/engine **60 passados, 0 falhas**; canário cross-process **PASS**; lint focado e
typecheck strict de `src/copilot`: **PASS**.

### 1.37 Status de implementação — lifecycle e provas multiprocess do write-behind aplicados em 2026-06-14

A investigação do gate de shutdown encontrou IO-046: o banco registrava fechamento na prioridade `DATABASE`, mas o
registry L2 não participava do shutdown central; além disso, listeners próprios de `SIGTERM`/`SIGINT` fechavam SQLite
diretamente. Um sinal dentro da janela write-behind podia, portanto, fechar o banco antes do flush.

A correção:

- adiciona `SHUTDOWN_PRIORITY.CACHE_PERSISTENCE`, imediatamente anterior a `DATABASE`;
- registra `copilot-io-l2.flush` de forma idempotente sempre que o registry é consultado;
- drena o lote e interrompe o prune antes do close;
- faz os listeners de sinal do banco delegarem a `runShutdown()`;
- mantém o handler síncrono de `exit` como última proteção de fechamento.

Nova prova `test_io_cache_l2_multiprocess.spec.js`, sempre sobre bancos temporários reais:

1. `SIGKILL` antes do flush: a linha pendente não aparece no banco e `PRAGMA integrity_check` retorna `ok`;
2. shutdown central coordenado: a linha não existia antes do shutdown e persiste após o close;
3. `SIGTERM` real: timer de runtime é drenado, cache faz flush, DB fecha e processo sai com código zero;
4. `BEGIN IMMEDIATE` externo: primeiro flush recebe busy e mantém a linha legível/pendente; após liberação, retry
   persiste uma única linha, sem corrupção.

A semântica aceita é explícita: cache não confirmado pode ser perdido por `SIGKILL`, porque é reconstruível; lote
confirmado não pode sumir, lock externo não pode descartar o buffer e shutdown cooperativo deve ordenar flush antes
do close.

Validação: prova multiprocess **4 passados, 0 falhas**; conjunto focado DB/cache/registry **62 passados, 0 falhas**;
lint focado e typecheck strict de `src/copilot`: **PASS**.

### 1.38 Status de implementação — soak L2 e decisão de promoção aplicados em 2026-06-14

O novo harness `scripts/analysis/copilot-io-l2-soak.mjs` força um ciclo operacional completo sobre banco isolado:

- 24 ciclos, 300 entradas por ciclo e 7.200 sets totais de 4 KiB;
- janela write-behind real, leitura imediata do último item pendente e cap de 500 entradas;
- TTL de 250 ms seguido de prune;
- transições `experimental -> on -> off -> on` com lote pendente;
- checkpoint `PASSIVE` e `TRUNCATE` do WAL;
- shutdown central e reabertura por nova conexão com `integrity_check`.

Duas execuções consecutivas convergiram:

| Métrica | Run 1 | Run 2 |
| --- | ---: | ---: |
| batch flushes | 48 | 48 |
| linhas persistidas em lotes | 7.200 | 7.200 |
| lote médio | 150 | 150 |
| batch failures | 0 | 0 |
| máximo observado | 500 | 500 |
| removidos após TTL | 500 | 500 |
| WAL antes de truncate | 5.261.272 bytes | 5.261.272 bytes |
| WAL depois de truncate | 0 | 0 |
| crescimento de heap no pico | 3.269.536 bytes | 3.271.312 bytes |
| duração | 3.328 ms | 3.309 ms |
| integridade | `ok` | `ok` |

As 24 leituras de linha ainda pendente passaram; duas chaves atravessaram reconfiguração; o banco final reabriu com
102 entradas esperadas. A ordem observada no shutdown foi `timers.cancelAll`, `copilot-io-l2.flush`,
`copilot-db.close`.

Artefatos locais:

- `artifacts/io-l2-workload/soak-run-1.json`;
- `artifacts/io-l2-workload/soak-run-2.json`.

Decisão final de IO-018: o perfil está tecnicamente apto para opt-in em processo longo, mas não deve virar default
global. O custo de seed já é amortizável em 3–4 reusos concorrentes ou dois seriais, porém processos one-shot e
subcomandos curtos não garantem esse padrão. Promoção deve ser por perfil de deployment, com telemetria, sem mudar a
semântica conservadora do repositório.

Validação: soak **2 passados**; canário **PASS**; conjunto lifecycle/cache/DB **124 passados, 0 falhas**; lint focado e
typecheck strict de `src/copilot`: **PASS**.

### 1.39 Status de implementação — crash EXDEV real e exclusividade do temporário aplicados em 2026-06-14

A rodada `exploratory-bug-hunt` cobriu integralmente `move.js`, `copy.js`, `write-atomic.js`, `durability.js`,
`mutation-phase.js`, `temp-path.js` e os testes adjacentes, com foco nas categorias C1/C2/C3/C5/C7/C9.

IO-048 foi encontrado e corrigido: copy staged usava `COPYFILE_EXCL`, mas o fallback cross-device de move chamava
`copyFile(source, tmpDestination)` sem flag. Isso contradizia a declaração de IO-021 de que a criação exclusiva era a
autoridade final. `move.js` agora usa `COPYFILE_EXCL`; uma factory de temp injetável no nível baixo permite provar que
um temp preexistente recebe `EEXIST`, não é sobrescrito e não publica destino.

A nova prova multiprocess usa `/dev/shm` quando ele está em device diferente de `tmpdir()`, inicia o move real e mata
o child com `SIGKILL` em quatro fases:

| Fase do crash | Origem | Destino | Temp | Conteúdo |
| --- | --- | --- | --- | --- |
| `temp-written` | presente | ausente | um `.move.tmp` | temp e origem íntegros |
| `before-destination-directory-sync` | presente | presente | ausente | duplicação íntegra |
| dentro do primeiro directory `sync()` | presente | presente | ausente | duplicação íntegra |
| `after-source-unlink` | ausente | presente | ausente | destino íntegro |

O cenário “dentro do sync” abre o diretório real, conclui `FileHandle.sync()` e bloqueia antes de devolver ao move;
o processo pai então aplica `SIGKILL`. Assim, a prova cobre a janela entre o syscall confirmado e a transição de fase
do caller, não apenas um callback sintético antes do sync.

IO-049 permanece parcial: crash antes do publish deixa um temp órfão pelo schema canônico. Ele é oculto, contém PID,
token de 128 bits e papel, mas não existe cleanup genérico seguro. Remover automaticamente exige distinguir processo
ativo, PID reutilizado e filesystem compartilhado; essa política não deve nascer como `rm` oportunista em toda
mutação.

Validação: crash EXDEV multiprocess e fault injection **18 passados, 0 falhas**; lint focado e typecheck strict de
`src/copilot`: **PASS**.

### 1.40 Status de implementação — recovery bounded de temporários aplicado em 2026-06-14

IO-049 foi fechado sem introduzir uma varredura global ou remover arquivos de outro processo por nome aproximado:

- novos temporários usam
  `.<basename>.<host-12hex>.<pid>.<token-128-bit>.<role>.tmp`;
- parser aceita somente roles `write|copy|move`, host/token hex e PID inteiro;
- antes da primeira publicação em cada diretório por processo, write/copy/move executam um scan best-effort;
- host local exige idade mínima de 24 h **e** PID morto;
- host diferente é preservado por default; limpeza administrativa pode fornecer quarentena explícita, provada com
  sete dias;
- nomes legados, symlinks, arquivos jovens e PID vivo são preservados;
- o scan examina no máximo 10 mil entradas;
- o cache FIFO de diretórios preparados é limitado a 1.024 e falha de scan permite retry futuro.

Uma prova cria simultaneamente temp local morto, PID atual, host estrangeiro jovem, host estrangeiro abandonado, nome
legado e arquivo jovem. Apenas os dois candidatos autorizados são removidos. Outra prova mostra que o primeiro write
do diretório remove um órfão de dois dias e o segundo write não repete a varredura no mesmo processo.

Limite consciente: cleanup é recuperação de lixo reconstruível, não mecanismo de coordenação. Recriação de container
pode trocar o hostname e deixar o temp preservado até uma limpeza administrativa explícita; shared filesystems
favorecem falso negativo (preservar) em vez de falso positivo (apagar temp ativo).

Validação focada de temp/write/copy/move/capacidade/engine/multiprocess: **68 passados, 0 falhas**; lint focado e
typecheck strict de `src/copilot`: **PASS**. `check:crude` continua bloqueado por cinco ocorrências preexistentes fora
desta onda.

### 1.41 Status de implementação — consistência sob alteração externa aplicada em 2026-06-14

IO-050 fechou as janelas reproduzíveis entre leitura, cache, parse e commit:

- `readBinaryMutationSnapshot()` agora abre `FileHandle`, confirma `stat` antes/depois e confirma que o path ainda
  aponta para o mesmo `dev/ino/size/mtime/ctime`;
- a leitura continua streamada e bounded; conflito aborta sidecar parcial, fecha handle e repete até duas vezes por
  default, terminando em `ESTALESNAPSHOT` quando a instabilidade persiste;
- o L1 passou a persistir e comparar `ctime/dev/ino` além de `mtime/size`; revalidação por hash renova todo o
  fingerprint rico;
- `readBytes`, `readText`, todos os caminhos de prefetch e promoções L2->L1 carregam a identidade rica;
- novos registros L2 persistem `ctime/dev/ino` em `metaJson`; entradas legadas continuam em fallback `mtime+size`
  somente até expiração/regravação;
- o índice reconfirma o arquivo antes de aceitar o fast path unchanged, antes de renovar fingerprint por hash e
  depois do parse, imediatamente antes da transação SQLite;
- builds de diretório repetem conflitos até `snapshotRetries` (default 2) e expõem `snapshotConflicts`; callers
  diretos com fingerprint rico falham stale em vez de publicar conteúdo obsoleto.

Provas novas usam processos Node externos e replace atômico real:

- durante o primeiro chunk do snapshot, o child substitui o inode; a tentativa antiga é descartada, o sidecar parcial
  é removido e a segunda tentativa materializa somente os bytes novos;
- entre parse e commit do índice, o child substitui o arquivo; o FTS não recebe o token antigo, o retry publica apenas
  o token novo e registra um conflito recuperado;
- replace same-size/same-mtime invalida o L1 pela identidade do inode.

Validação focada: **102 passados, 0 falhas**; provas snapshot+índice: **27 passados, 0 falhas**; lint focado e
`typecheck:strict:src.copilot`: **PASS**. O strict global de testes permanece vermelho por dívidas preexistentes fora
desta onda; após a correção, nenhum erro reportado nele pertence aos arquivos de produção alterados.

Limites conscientes:

- o stale probe L1 preserva a janela configurável de 2 s por default; `0` oferece validação a cada hit;
- entradas L2 antigas sem fingerprint rico mantêm compatibilidade até TTL/regravação;
- `readTextChunks`/`readTextChunksStream` foram separados como IO-051 porque chunks já entregues exigem contrato de
  versão/abort distinto de uma leitura materializada; a seção seguinte registra o fechamento.

### 1.42 Status de implementação — streaming textual versionado aplicado em 2026-06-14

IO-051 foi fechado sem fingir que uma stream já consumida pode ser repetida transparentemente:

- o byte-line index usa `mtime/size/ctime/dev/ino`, chave de path normalizada e construção por `FileHandle`;
- construção de offsets e byte-seek confirmam handle/path antes de aceitar o resultado;
- `readTextLineChunks()` descarta a tentativa inteira e repete até duas vezes por default antes de devolver qualquer
  chunk;
- o resultado materializado expõe `snapshotVersion`, `snapshotAttempts`, `consistent` e metadata originada no mesmo
  handle, removendo o `stat(path)` posterior que podia desalinhar conteúdo e metadata;
- `readTextLineChunksStream()` mantém um handle fixo e inclui o mesmo token opaco de 24 hex chars em cada chunk;
- se inode ou fingerprint mudar, a stream encerra com `ESTALECHUNKSTREAM`, `partial:true` e o token da versão que deve
  ser descartada pelo consumidor;
- o fast path por byte seek preserva os labels públicos existentes e expõe separadamente
  `snapshotFingerprintStrategy: mtime-size-ctime-dev-ino`.

Provas multiprocess novas:

- um child troca o inode exatamente depois da construção do byte-line index; o primeiro seek é recusado e a segunda
  tentativa retorna somente as linhas da versão nova;
- um child troca o inode após o primeiro chunk bruto da `ReadableStream`; todos os chunks entregues pertencem ao
  mesmo token/handle antigo e o fechamento sinaliza stale, sem apresentar conclusão falsa.

Validação: leitura baixa + engine **56 passados, 0 falhas**; rodada ampliada com MCP/read tools **133 passados,
0 falhas**; lint focado, `diff --check` e `typecheck:strict:src.copilot`: **PASS**.

Limite consciente: `ESTALECHUNKSTREAM` pode chegar após chunks já consumidos. O contrato exige descartar a versão
parcial; retry automático só é correto na API materializada, antes da exposição ao caller.

### 1.43 Status de implementação — patch protegido contra writer externo aplicado em 2026-06-14

IO-052 foi fechado no limite portátil disponível em Node/POSIX:

- `writeAtomicFileUnlocked(..., { expectedHash })` recalcula um snapshot consistente e bounded imediatamente antes
  de `rename`, depois de `before-publish`;
- `writeFileAtomic` propaga a precondição até a primitiva baixa, removendo a antiga janela entre a checagem sob lock e
  a publicação;
- `patchTextLocked` sempre usa o hash da base lida como precondição final, mesmo quando o caller não forneceu
  `expectedHash`;
- conflito externo recusa o publish com `EEXPECTEDHASH`, preserva a versão de editor/Git e remove o temporário;
- quando um patch grande já materializou sidecar de rollback, o conflito pré-publish também descarta esse sidecar
  obsoleto.

Provas novas coordenam a troca exatamente em `before-publish`: um processo Node simula o save atômico de editor e um
repositório Git real executa `git checkout` de outra versão. Em ambos, o patch calculado sobre a base antiga é
recusado e a versão externa permanece íntegra. A prova baixa adicional cobre `writeAtomicFileUnlocked` diretamente.

Validação focada desta onda: **104 passados, 0 falhas**; lint Copilot, `diff --check` e
`typecheck:strict:src.copilot`: **PASS**. O strict também encontrou e levou à correção de uma assinatura Zod
incompatível em trabalho paralelo que será sincronizado.

Limite consciente: APIs portáteis de filesystem não oferecem compare-and-swap entre hash de conteúdo e `rename`.
Permanece uma microjanela entre a última confirmação e o syscall de publicação; eliminá-la exigiria cooperação do
writer externo, protocolo de versão compartilhado ou primitiva específica de plataforma.

### 1.44 Status de implementação — primeira bateria de fuzz determinístico aplicada em 2026-06-14

A Faixa 5 recebeu uma bateria bounded e reproduzível sem dependência nova:

- seed `0x1a2b3c4d`: 160 casos de patch com Unicode, LF/CRLF, ocorrência específica, replace-all, bytes e line delta;
- seed `0x5e6f7788`: 48 casos de leitura em chunks com janelas, Unicode, LF/CRLF e `highWaterMark` entre 1 e 12 bytes;
- corpus binário: 6 sequências UTF-8 inválidas confirmam `BinaryFileError` e preservação byte a byte.

Cada falha informa seed, índice e caso serializado. A primeira execução encontrou IO-053 em produção:

- quando um chunk físico terminava em `\r`, o parser guardava `\r + fragmento` em vez de `fragmento + \r`, criando
  linhas vazias e perdendo linhas válidas em CRLF;
- ao parar depois de atingir `endLine`, o último chunk parcial usava a linha apenas escaneada como `endLine`, inflando
  `returnedLineCount` mesmo quando o conteúdo devolvido estava correto.

As duas falhas foram corrigidas em `read-chunks.js`; uma regressão mínima de fronteira CRLF complementa o fuzz.
Validação: bateria fuzz **214 casos gerados/corpus, 0 falhas**; rodada focada ampliada **208 passados, 0 falhas**;
suíte Copilot completa **6.661 total, 6.633 passados, 0 falhas, 28 pending**.

### 1.45 Status de implementação — UTF-8 fatal no streaming textual aplicado em 2026-06-14

A investigação contínua após o fuzz encontrou IO-054: `readText` e patch recusavam UTF-8 inválido, mas as duas rotas
de leitura em chunks usavam `StringDecoder`, que substituía bytes inválidos silenciosamente. Isso podia apresentar
texto com U+FFFD como se fosse conteúdo válido.

O parser streaming agora usa `TextDecoder('utf-8', { fatal: true })`, que no Node 24 preserva sequências multibyte
entre chamadas com `{ stream:true }` e recusa dados malformados. O erro nativo é normalizado para
`BinaryFileError/ERR_INVALID_UTF8`, alinhando chunks materializados, byte-seek e stream com a política textual
canônica. O corpus fuzz valida também que os bytes originais não são regravados.

Validação focada pós-IO-054: **139 passados, 0 falhas**; lint focado, `diff --check` e
`typecheck:strict:src.copilot`: **PASS**.

### 1.46 Status de implementação — `highWaterMark` efetivo e concatenação linear em byte-seek aplicados em 2026-06-14

A revisão pós-fuzz encontrou IO-055 na rota otimizada de leitura por linhas: o caller podia fornecer
`highWaterMark`, mas a construção inicial do índice byte/linha ignorava a opção. Assim, uma leitura de janela pequena
ainda podia varrer o arquivo em blocos maiores que o orçamento solicitado. A opção agora é propagada para o stream de
indexação e para o byte-seek, com prova que observa `after-byte-index-chunk` e `after-byte-range-chunk`.

A mesma rota acumulava cada fragmento decodificado com `text +=`, cujo custo pode crescer de forma superlinear sob
`highWaterMark` pequeno. Os fragmentos agora são coletados em array e unidos uma única vez, preservando decode UTF-8
fatal e o token de consistência.

### 1.47 Status de implementação — limites físicos do parser corrigidos em 2026-06-14

IO-056 fechou dois desvios entre o contrato declarado e o trabalho entregue ao parser:

- a contagem `content.split('\n').length` alocava um array proporcional ao arquivo e não reconhecia CR isolado, o que
  permitia que arquivos CR-only ultrapassassem `IO_PARSER_MAX_LINES`;
- `IO_PARSER_MAX_BYTES` era aplicado com `content.slice(0, MAX_PARSE_BYTES)`, usando unidades UTF-16 e podendo
  entregar ao Babel várias vezes o orçamento anunciado quando o prefixo continha Unicode multibyte.

O parser agora conta LF, CRLF e CR isolado em uma passagem sem array intermediário, trunca em fronteira UTF-8 por
bytes e expõe `parsedBytes` além de `bytes`. Provas isoladas com overrides pequenos confirmam line guard para CR-only,
ausência de símbolo além do orçamento e `parsedBytes <= IO_PARSER_MAX_BYTES`.

Validação conjunta de IO-055/IO-056: **49 passados, 0 falhas**; lint focado, `diff --check` e
`typecheck:strict:src.copilot`: **PASS**.

### 1.48 Status de implementação — parsers puros migrados para linhas lazy em 2026-06-14

IO-057 removeu três materializações proporcionais ao arquivo fora do Babel:

- `extractTopComments` fazia `split('\n')` do conteúdo inteiro para examinar somente as primeiras 50 linhas;
- o outline Markdown dividia todo o documento antes de percorrê-lo;
- o fallback JSONL fazia `split + map + find` para localizar a primeira linha não vazia.

A nova primitiva compartilhada `iterateTextLines` percorre LF, CRLF e CR isolado de forma lazy e preserva linha física. Comentários
interrompem a leitura lógica na linha 50, JSONL retorna na primeira amostra e Markdown mantém linhas reais sem array
intermediário. As regressões incluem CR-only nas três superfícies.

### 1.49 Status de implementação — retenção e saída do parser bounded por bytes em 2026-06-14

IO-058 fechou dois budgets ausentes:

- os LRUs de símbolos e `FileContext` eram limitados apenas por quantidade de entradas; agora também usam
  `maxSize/sizeCalculation`, com defaults de 64 MiB, overrides por env e exposição de `calculatedSize/maxBytes` no
  health;
- `workspace_parse_file` e `repo_file_outline` podiam devolver todas as coleções extraídas. Ambas agora aceitam
  `maxItems` e `maxBytes`, com defaults de 500 itens e 512 KiB, orçamento global somente sobre coleções solicitadas,
  `returnedContentBytes`, contagens total/retornada e `truncated`.

Um contexto maior que o orçamento individual do LRU não é retido e incrementa `fileContext.rejected`. O índice
interno continua recebendo o parse completo; o windowing ocorre apenas na fronteira de resposta para LLM/tool.

Validação focada de IO-057/IO-058: **87 passados, 0 falhas**; lint focado, `diff --check` e
`typecheck:strict:src.copilot`: **PASS**.

### 1.50 Status de implementação — cache simbólico validado por versão física em 2026-06-14

IO-059 corrigiu um risco de consistência externa no `_symbolCache`: a chave era apenas o path e um editor/Git que
substituísse o inode sem passar pelo bus podia receber símbolos antigos até o TTL. Cada entrada agora carrega
fingerprint rico (`size/mtime/ctime/dev/ino`); hits são confirmados por `stat`, o arquivo é reconfirmado depois do
worker e conflitos durante parse repetem de forma bounded.

`parseAndCacheSymbols` também aceita um `TextFileSnapshot` consistente já lido. `warmReadThroughContext` usa essa
porta, eliminando sua segunda leitura do mesmo arquivo. O health distingue hits, misses, stales, leituras internas,
snapshots fornecidos e conflitos. Uma prova com replace atômico externo sem invalidação confirma que o símbolo antigo
nunca é devolvido; outra comprova `symbolSuppliedSnapshots=1` e `symbolSnapshotReads=0` no read-through.

### 1.51 Status de implementação — chunking do index-store migrado para gerador bounded em 2026-06-14

IO-060 removeu outra materialização proporcional: `countLines` e `makeLineChunks` faziam split integral, e o commit
SQLite mantinha simultaneamente o array de todas as linhas e o array de todos os chunks. A primitiva de linhas físicas
foi promovida para `infra/shared`; `iterateLineChunks` conserva apenas o chunk atual e o indexador insere cada chunk
diretamente na transação. A API array permanece como compatibilidade para callers pequenos.

Validação conjunta de IO-059/IO-060: **68 passados, 0 falhas**; lint focado, `diff --check` e
`typecheck:strict:src.copilot`: **PASS**.

### 1.52 Status de implementação — revisão integral do `@babel/parser` aplicada em 2026-06-14

A documentação oficial completa do `@babel/parser` foi confrontada com a versão instalada, **7.29.7**. IO-061
removeu drift entre main thread e worker e atualizou o contrato para as APIs atuais:

- uma policy única define `sourceType`: `.cjs/.cts` usam `commonjs`, `.mjs/.mts` usam `module` e extensões ambíguas
  mantêm `unambiguous`;
- `allowImportExportEverywhere` e `allowReturnOutsideFunction` foram removidos. Código inválido volta a produzir
  `BABEL_PARSER_SYNTAX_ERROR/reasonCode`, enquanto CommonJS legítimo aceita top-level return pela semântica própria;
- TypeScript ativa `dts` em `.d.ts/.d.mts/.d.cts`, `disallowAmbiguousJSXLike` em `.mts/.cts` e JSX apenas em `.tsx`;
- `sourceFilename`, `attachComment`, `errorRecovery` e `createImportExpressions` são explícitos;
- erros recuperáveis e irrecuperáveis são normalizados com `code`, `reasonCode`, linha/coluna e mensagem;
- o extrator AST também foi unificado e agora cobre `ImportExpression`, forma legada de dynamic import, `require`
  estático, `TSImportEqualsDeclaration`, `TSExportAssignment`, ambient declarations, namespaces e bindings
  destruturados.

Decisões conscientes após a leitura:

- `parse()` permanece correto porque a unidade é arquivo/programa; `parseExpression()` não serve ao índice simbólico;
- `tokens` e `ranges` continuam desligados para não ampliar AST/memória sem consumidor;
- AST Babel nativo é preservado; `estree` não é necessário para os extratores internos;
- `attachComment` permanece ligado apesar do custo documentado porque `docComment` é parte do índice e das tools;
- features ECMAScript já estáveis não recebem plugins redundantes;
- Flow, V8 intrinsics e proposals experimentais não são habilitados globalmente sem extensão/pragma e caso de uso,
  evitando interpretar sintaxe inválida como válida;
- `decorators-legacy` permanece por compatibilidade com o corpus atual; migração para decorators stage 3 exige
  evidência e fixture própria.

Provas cobrem CommonJS versus módulo, import aninhado inválido, `.d.ts`, `.mts`, `.tsx`, destructuring,
`ImportExpression`, `require`, paridade worker/fallback e worker sem fallback silencioso.

Validação focada de IO-061: parser/governança **48 passados, 0 falhas**; índice **20 passados, 0 falhas**; lint
focado, `diff --check` e `typecheck:strict:src.copilot`: **PASS**.

### 1.53 Status de implementação — read-through reutiliza L1 e evita cópia binária em 2026-06-14

IO-062 fechou uma dupla materialização no caminho principal de `read_file_content`: após `readText` já carregar e
validar o texto integral no L1, `warmReadThroughContext` relia o arquivo para index/parse e criava também um Buffer
UTF-8 completo. O read-through agora:

- consulta a entrada textual L1 com fingerprint verificado e a converte em `TextFileSnapshot` sem nova leitura;
- passa esse mesmo snapshot ao cache simbólico versionado;
- aceita `cacheBytes`; o caller textual usa `false`, evitando a cópia binária sem consumidor;
- expõe `reusedTextCache` e `primedByteCache` no relatório.

Provas confirmam que o caminho frio preserva o comportamento legado quando `cacheBytes=true`, enquanto o caminho de
`read_file_content` reutiliza L1, mantém `symbolSnapshotReads=0` e uma leitura binária posterior ainda é `l1-miss`.

Validação focada de IO-062: **92 passados, 0 falhas**; lint focado, `diff --check` e
`typecheck:strict:src.copilot`: **PASS**.

### 1.54 Status de implementação — semântica física de linhas aplicada ao patch em 2026-06-14

IO-063 corrigiu metadata incorreta em arquivos CR-only/mistos: `countPatchLines` e `lineNumberAt` consideravam apenas
LF, e o segundo criava `slice + split` para cada consulta. A primitiva compartilhada agora oferece contagem física e
linha por offset sem substring, tratando LF, CRLF e CR isolado.

O caminho de ocorrência específica usa diretamente o offset já encontrado, eliminando uma segunda varredura e
concatenação incremental. Replace-all no patch canônico, patch-plan e MCP usa `String.prototype.replaceAll`, evitando
o array intermediário de `split/join`.

Validação focada de IO-063: **61 passados, 0 falhas**, incluindo fuzz, patch plan e MCP; lint focado,
`diff --check` e `typecheck:strict:src.copilot`: **PASS**.

### 1.55 Status de implementação — leitura física e cache de offsets bounded em 2026-06-14

IO-064 fechou duas divergências no núcleo de leitura. O caminho de bypass do line-offset cache ainda executava
`split('\n')`, materializando strings e array proporcionais ao arquivo, e o cache reconhecia apenas LF. Além disso,
o LRU limitava quantidade de entradas, mas não bytes retidos; arquivos densos em newlines podiam manter milhões de
`number` do heap por entrada.

A primitiva compartilhada de linhas agora:

- recorta janelas LF, CRLF e CR isolado em uma varredura com memória auxiliar O(1);
- preserva delimitadores internos originais e remove somente o delimitador final da janela;
- oferece arrays de linhas físicas apenas para APIs cujo contrato exige materialização;
- constrói offsets compactos em `Uint32Array`.

O line-offset cache usa o scanner O(1) no bypass, aplica a mesma semântica física em hits/misses e mantém orçamento
global `IO_LINE_OFFSET_CACHE_MAX_BYTES` (default 16 MiB), além dos limites por entradas e tamanho textual. Health
expõe `sizeBytes`, `maxBytes` e `rejected`; invalidações e evicções descontam o peso retido. `readText`, `readLines` e
`readTextLinesSnapshot` agora concordam para CRLF/CR, preservando a distinção histórica de snapshot vazio.

Validação focada de IO-064: **70 passados, 0 falhas** em cache, engine, chunks e índice; lint focado,
`diff --check` e `typecheck:strict:src.copilot`: **PASS**.

### 1.56 Status de implementação — diff e output window sem arrays integrais em 2026-06-14

IO-065 removeu materializações proporcionais aos inputs em duas superfícies de saída:

- `buildSimpleTextDiff` deixou de criar arrays completos para os dois arquivos e uma lista de cada linha alterada;
  duas passagens lazy calculam hunks e renderizam somente os ranges necessários;
- o diff completo e o otimizado por range usam a mesma primitiva física LF/CRLF/CR;
- `limitTextLines` e `windowTextLines` deixaram de executar `split/slice/join`; contagem e offsets LF são calculados
  sem array proporcional, preservando byte a byte a semântica pública de newline terminal e cursor;
- arrays remanescentes são proporcionais aos hunks/saída retornada, não aos inputs completos.

Compatibilidade foi provada diferencialmente em **5.000 pares LF** para diff e **5.000 casos** de paginação, além das
regressões físicas CR/CRLF. O algoritmo de diff permanece intencionalmente simples e index-aligned; esta onda não
introduziu LCS/Myers nem alterou seu formato público.

### 1.57 Status de implementação — UTF-8 fatal no stdout de busca em 2026-06-14

IO-066 fechou a lacuna textual remanescente de `streamSearchFile`: cada chunk era convertido isoladamente com
`Buffer.toString('utf8')`, portanto um code point dividido entre eventos de stdout podia virar U+FFFD. O subprocesso
agora usa `TextDecoder` incremental fatal, preserva carry multibyte e rejeita bytes inválidos ou sequência truncada
com `EUTF8SEARCHOUTPUT`.

O parser de linhas do stdout deixou de executar `pendingStdout.split('\n')` por chunk e passa a avançar por offsets,
mantendo early stop, `maxBuffer` e coleta opcional. Sanitização e contagens de busca também deixaram pipelines de
`split/map/filter`, sem mudar a visão pós-sanitização nem o contrato de paginação.

Validação combinada de IO-065/IO-066: **119 passados, 0 falhas** em patch, fuzz, output-window, search, subprocess,
engine e MCP; duas provas diferenciais de 5.000 casos; lint focado, `diff --check` e
`typecheck:strict:src.copilot`: **PASS**.

### 1.58 Status de implementação — cauda JSONL bounded e UTF-8 fatal em 2026-06-14

IO-067 corrigiu a última leitura textual potencialmente sem bound encontrada nesta rodada. `readJsonlTail` parava
por quantidade de newlines; uma linha final gigante sem newline fazia o leitor caminhar até o início e concatenar o
arquivo inteiro. O decode usava `Buffer.toString('utf8')`, permitindo substituição silenciosa dentro de um JSON
sintaticamente válido.

O leitor agora:

- impõe orçamento efetivo `maxBytes` (default 16 MiB, hard cap 64 MiB), `maxLines` até 10 mil e blocos até 1 MiB;
- expõe `bytesRead`, `maxBytes` e `truncatedByByteLimit`;
- guarda blocos em ordem reversa sem `unshift`, descarta a primeira linha parcial em bytes e só então decodifica;
- usa `TextDecoder` incremental fatal entre blocos e `EUTF8JSONL` para bytes inválidos;
- mantém somente um ring de no máximo `maxLines`, sem `Buffer.concat + split + filter + slice`;
- reaproveita o último bloco para detectar newline terminal, removendo um syscall/read redundante.

`repairJsonlTrailingPartial` também valida UTF-8 fatal antes de aceitar uma última linha como JSON legítimo. Provas
cobrem linha gigante bounded, code point atravessando blocos, UTF-8 inválido real e bytes inválidos contidos apenas
na linha parcial descartada.

Os callers foram alinhados ao novo sinal: o archive SSE retorna `tailRead` com bytes/orçamento/truncagem; o resumo
legado de auditoria mantém `object[]`, normaliza `limit` em até 500 e emite warning quando a cauda pode estar
incompleta.

Validação focada de IO-067: **124 passados, 0 falhas** em JSONL, audit pipeline, SSE canônico e commands; lint
focado, `diff --check` e `typecheck:strict:src.copilot`: **PASS**.

### 1.59 Status de investigação — custo real de `attachComment` medido em 2026-06-14

IO-068 encerrou a decisão pendente sobre o custo documentado de `attachComment`. O benchmark local usou os **1.272
arquivos JS/TS** de `src/copilot` (**10.666.067 bytes**) com a policy Babel real por extensão, warm-up e oito pares
alternando a ordem on/off.

Resultados de parse puro:

- razão mediana `attachComment=true/false`: **1,109x**;
- faixa observada dos pares: **0,970x–1,330x**, ainda sensível a JIT/GC;
- uma rodada mais ampla com extração ficou sobreposta pelo ruído, sem regressão estável acima dessa faixa;
- símbolos extraídos: **10.423** em ambos os modos;
- símbolos com `docComment`: **8.591** com comments versus **0** sem comments;
- erros de parse no corpus: **0**.

Decisão: manter `attachComment:true` como policy canônica. O custo mediano local aproximado de 10,9% é menor que a
perda funcional de documentação em 82,4% dos símbolos. Um futuro perfil sem comments só será aceitável se:

1. for opt-in explícito por caller que não consome `docComment`;
2. usar chave/cache distinta para não contaminar resultados ricos;
3. provar ganho end-to-end, não apenas parse microbench;
4. nunca for aplicado às tools de outline/symbol search ou ao índice que persiste documentação.

### 1.60 Status de implementação — corpos HTTP/MCP/OAuth bounded e UTF-8 fatal em 2026-06-14

IO-069 estendeu a política textual fatal às fronteiras HTTP estruturadas de `src/copilot`:

- `readMcpHttpJsonBody` valida UTF-8 antes de `JSON.parse`, mantendo 400 genérico sem eco do payload;
- `mcpFetchText` agora tem limite default de **2 MiB** mesmo quando o caller omite `maxBytes`;
- respostas são rejeitadas cedo por `Content-Length`, cancelam o reader ao exceder o stream e usam decode fatal;
- request bodies OAuth e documentos remotos de client metadata usam o helper UTF-8 canônico após budgets de 64 KiB;
- concatenação usa `concatBufferViews` com comprimento conhecido, eliminando somas/decodes ad hoc.

Stderr de subprocessos permanece uma exceção consciente: é diagnóstico bounded e decode best-effort evita descartar o
erro operacional inteiro por bytes não textuais. `execSearchFile` legado só é usado pelo probe `rg --version`; stdout
das buscas reais já está sob IO-066.

Validação focada de IO-069: **39 passados, 0 falhas** em HTTP body/client, stateful router, connection profile e JWKS;
lint focado, `diff --check` e `typecheck:strict:src.copilot`: **PASS**. Uma suíte Cloudflare adicional não carregou
por alias preexistente ausente (`#copilot/mcp/cloudflare/cli-probe.js`); as superfícies alteradas passaram
isoladamente.

### 1.61 Status de implementação — tools web com caps determinísticos em 2026-06-14

IO-070 corrigiu um contrato inconsistente em `web_fetch_local`: `maxBytes` era descrito como informativo, mas o loop
parava depois de adicionar o chunk inteiro quando `received >= limit`. Assim, a mesma resposta podia ser integral ou
truncada conforme o chunking físico, `truncated` permanecia falso e a ausência de parâmetro deixava retenção
ilimitada.

Estado novo:

- `web_fetch_local` aplica default **2 MiB**, hard cap configurável **8 MiB** e coleta no máximo o prefixo pedido;
- truncagem em meio de code point recua até três bytes, sem aceitar UTF-8 inválido interno;
- metadata expõe `effectiveMaxBytes`, `returnedBytes`, `boundaryTrimmedBytes`, `limitMode:'enforced'` e truncagem real;
- `bytesRead` representa bytes observados da rede, separado dos bytes retornados;
- `web_search` não usa mais `response.json()/text()` sem bound: JSON e HTML devem caber integralmente em **2 MiB**,
  com precheck de `Content-Length`, cancelamento e decode fatal;
- cleanup aceita readers cujo `cancel()` seja síncrono ou assíncrono.

Validação focada de IO-070: **50 passados, 0 falhas** em web tools/introspection; lint focado, `diff --check` e
`typecheck:strict:src.copilot`: **PASS**.

### 1.62 Status de implementação — importadores de catálogo com resposta bounded em 2026-06-14

IO-071 fechou a fronteira HTTP textual dos **28 importadores** em
`model-gateway/catalog/importers`. Antes, os importadores misturavam `response.json()` e `response.text()` diretos:
catálogos públicos, páginas de documentação, paginação autenticada e enriquecimentos por modelo podiam materializar
um corpo arbitrário e aceitar UTF-8 substitutivo antes do parse.

Estado novo:

- `response-body.js` aplica o perfil de catálogo sobre o leitor HTTP público, com default de **8 MiB** e hard cap de
  **32 MiB**;
- `Content-Length` acima do budget falha antes da leitura;
- streams reais são coletados somente até o limite, cancelados no erro e decodificados pelo helper UTF-8 fatal;
- paginações e detalhes de Anthropic, Gemini, Groq e Ollama usam o mesmo contrato em cada request;
- catálogos JSON e superfícies HTML/Markdown de OpenAI, Anthropic, Gemini, Groq, Mistral, Cloudflare, OpenRouter,
  Kilo, Cerebras, NVIDIA, Hugging Face, Chutes, Z.AI e OpenCode Zen foram migrados;
- doubles legados de teste que expõem apenas `json()` continuam aceitos somente quando não possuem um
  `ReadableStream`; respostas `Response` reais nunca usam esse bypass.

O cap é maior que o das tools web porque um catálogo integral pode conter milhares de modelos e precisa ser parseado
como documento completo. Ainda assim, o teto impede crescimento arbitrário; respostas truncadas não são
parcialmente promovidas a evidência.

Validação focada de IO-071: **31 passados, 0 falhas** — 3 casos próprios do leitor e 28 contratos de importação;
lint de todos os importadores, `diff --check` e `typecheck:strict:src.copilot`: **PASS**.

### 1.63 Status de implementação — leitor HTTP público e consumo inbound consolidado em 2026-06-14

IO-072 removeu as implementações paralelas restantes de consumo de `Response`. A nova fachada
`infra/public/http-response.js` oferece bytes, texto e JSON com o mesmo contrato:

- default global **2 MiB**, hard cap global **32 MiB** e perfil customizável por domínio;
- precheck de `Content-Length`, contagem física durante streaming e cancelamento quando o limite é excedido;
- concatenação única com comprimento conhecido e UTF-8 fatal antes de produzir texto ou JSON;
- fallback para `arrayBuffer()`/`text()` somente quando não há stream;
- compatibilidade com doubles `json()`-only restrita a objetos sem stream e sem `arrayBuffer()`.

Foram migrados:

- bridge JSON-RPC MCP local, com cap de **2 MiB** antes de entregar resultado de tool ao modelo;
- descoberta BYOK OpenAI-compatible, com cap de **8 MiB**;
- cliente HTTP do control plane, substituindo sua implementação privada;
- metrics, config audit e apply de tunnel origin do Cloudflare;
- smoke HTTP, smoke OAuth e benchmark de latência MCP;
- perfil dos 28 importadores, que agora delega ao leitor público com seus caps de catálogo.

A varredura por `.text()`, `.json()`, `.arrayBuffer()`, `.blob()` e `.formData()` em `src/copilot` não encontrou
consumo inbound direto restante: os matches fora das fachadas são respostas Express (`res.json`) e um exemplo em
comentário.

Validação focada de IO-072: **80 passados, 0 falhas** em reader, importers, bridge MCP, provider BYOK, HTTP client,
tunnel origin e OAuth smoke; lint focado, `diff --check` e `typecheck:strict:src.copilot`: **PASS**.

---

## 2. Evidência de leitura integral

### 2.1 Arquivos lidos integralmente em `src/copilot/infra/io/**`

Foram lidos completamente todos os arquivos diretamente sob a árvore de infra IO:

| Área | Arquivos |
| --- | --- |
| `fs` | `append.js`, `capacity-preflight.js`, `copy.js`, `index.js`, `line-offset-cache.js`, `locked-mutations.js`, `locked-writes.js`, `mkdir.js`, `move.js`, `portable-atomic.js`, `read-bytes.js`, `read-chunks.js`, `read-lines.js`, `read-services.js`, `read-text.js`, `remove.js`, `rollback-sidecar.js`, `snapshot.js`, `stat.js`, `temp-path.js`, `write-atomic.js` |
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

### 3.5 `statfs` apoia preflight advisory de espaço livre

`fsPromises.statfs()` retorna informações do filesystem de um path.

**Implicação aplicada:** atomic write, copy staged e move `EXDEV` acima de limiar estimam `bavail * bsize` e falham
cedo quando a insuficiência já é observável. ENOSPC real continua sendo a autoridade final, pois o preflight não
reserva blocos.

Referência: https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesstatfspath-options

### 3.6 `fsPromises.glob` está estável em Node 24, mas cuidado com opções pós-24.5

A documentação de Node 24.x marca `fsPromises.glob()` como estável em Node 24.0.0, mas mostra que `followSymlinks` só foi adicionado em Node 24.16.0.

**Implicação aplicada:** `minimatch` governa a semântica de padrões, mas `glob` cru não substitui o scanner. A prova
live mostrou que ele enumeraria paths de `model-gateway/secrets` removidos pela policy async. Também não devemos
depender de `followSymlinks`, ausente na matriz alvo 24.5.

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
| IO-001 | P0 | Escrita atômica | **Concluído com limite documentado:** replace usa flush e sync do diretório | `write-atomic.js`, `durability.js`, metadata/health | Filesystem pode não suportar directory sync | Promover falha real e manter unsupported explicitamente best-effort |
| IO-002 | P0 | Locks | **Concluído com limite documentado:** L0 permanece default, L1 multiprocess é opt-in por perfil de risco | `COPILOT_IO_FILE_LOCKS_ENABLED=high-risk|mutations|all`, provas multiprocess e health de locks | Deploy que deixa `off` aceita concorrência apenas intra-processo | Usar `high-risk` em workspaces com múltiplos processos cooperativos |
| IO-003 | P0 | Prefetch/cache | **Concluído:** prefetch textual usa validação UTF-8 canônica | `io-prefetch.js`, testes binários | Binário não cria text cache | Manter decode compartilhado com `readText` |
| IO-004 | P0 | Patch | **Concluído:** patch recusa UTF-8 inválido antes de editar | `locked-mutations.js`, testes de binário sem regravação | Nenhum byte inválido é convertido em U+FFFD | Manter leitura em Buffer e validação prévia |
| IO-005 | P0 | Move | **Concluído com limite documentado:** EXDEV é staged, verificado e durável | `move.js`, prova EXDEV real e fault injection | Falha após publish pode deixar duplicação reportada | Manter metadata explícita e provas por fase |
| IO-006 | P0 | Bypass | **Concluído com exceções formais:** writers usam fachadas; cleanup/mkdir têm matriz exata | contratos bloqueiam writers e exigem matriz por arquivo/operação para cleanup/mkdir | Exceções intencionais ainda usam fs direto | Manter matriz estreita e remover entradas quando migrações tornarem calls redundantes |
| IO-007 | P1 | Snapshot | **Concluído:** leitura normal e rollback streamado confirmam FileHandle/path | `snapshot.js`, `read-bytes.js`, prova de replace externo | Mudança concorrente provoca retry/falha e sidecar parcial é abortado | Manter fingerprints ricos e retry bounded |
| IO-008 | P1 | Create/copy | **Concluído:** create/copy sem overwrite têm exclusividade real | hard link/open `wx`, `COPYFILE_EXCL`, testes concorrentes | Processo externo recebe/gera EEXIST sem overwrite | Manter exclusividade no publish, não em precheck |
| IO-009 | P1 | Append | **Parcial por desenho:** JSONL é framed/durável; logs fracos são best-effort explícito | `append.js`, `jsonl-file-writer.js`, `jsonl-reader.js` | Logs não críticos ainda podem perder cauda em crash | Manter classificação explícita e recovery físico opt-in |
| IO-010 | P1 | Rollback | **Concluído:** conteúdo acima do orçamento migra para sidecar durável | `rollback-sidecar.js`, `snapshot.js`, `locked-mutations.js`, token v2 | TTL limita a janela material de restauração por desenho | Monitorar cleanup e tornar TTL configurado visível no health |
| IO-011 | P1 | Memória | **Concluído:** snapshot de mutação processa stream incrementalmente | `snapshot.js`, sidecar writer | Memória fica bounded pelo orçamento de rollback | Manter hash/sidecar em `for await` |
| IO-012 | P1 | Cache derivado | **Concluído:** hooks derivados são drenados antes do retorno | `invalidation/cache-tiers.js`, testes read-after-write | Burst pode aumentar latência de mutação | Medir custo, sem reintroduzir janela stale |
| IO-013 | P1 | Line offsets | **Concluído:** keys e invalidação usam caminho normalizado | `line-offset-cache.js`, testes relativo/absoluto | Aliases equivalentes convergem para a mesma entrada | Manter normalização canônica |
| IO-014 | P1 | Path policy | **Concluído:** capabilities workspace-bound e trusted estão separadas | `public/workspace-io.js`, `public/trusted-io.js`, contratos de boundaries/callers | Facade operacional baixa continua sem containment por desenho declarado | Manter superfícies externas sob contrato e allowlistar apenas escapes trusted |
| IO-015 | P1 | Search | **Concluído:** sanitização antecede paginação e contagens | rg/grep/FTS/símbolos retornam `countsPostSanitization:true` | Linhas removidas não afetam total ou cursor | Manter prova de primeira página redigida |
| IO-016 | P1 | Scanner | **Concluído:** classificação básica usa `Dirent` | `io-scanner.js`, benchmark local | DT_UNKNOWN ainda exige fallback | Manter `lstat` apenas para arquivo/fingerprint ou ambiguidade |
| IO-017 | P1 | Index freshness | **Concluído:** identidade rica, hash periódico e confirmação pré-commit | unchanged/hash refresh/parse reconfirmam path; retry bounded no build | Arquivos grandes confiam em metadata rica entre reindexações | Medir hit/miss/custo e conflitos por perfil |
| IO-018 | P1 | L2 SQLite | **Concluído com limite documentado:** perfil experimental medido, hardened e aprovado para long-lived opt-in | break-even 2–4 reusos; crash, contenção e soak de 7.200 sets passaram | Processos curtos podem não amortizar seed | Manter default `off`; ativar por perfil de deployment |
| IO-019 | P1 | Bypass storage | **Concluído:** json store usa fachada atômica portátil | `infra/storage/json-store.js` | Escape é trusted e explícito | Manter contrato de callers da fachada |
| IO-020 | P1 | Bypass export | **Concluído:** export usa fachada atômica portátil | `terminal/commands/export.js` | Paths externos continuam capability trusted | Manter caller explícito e testes de contrato |
| IO-021 | P2 | Temp naming | **Concluído:** publicação usa nome irmão oculto e token de 128 bits | `temp-path.js`; write/copy/move compartilham o helper | Colisão continua decidida por criação exclusiva | Manter papéis bounded e sidecar especializado sob seu schema |
| IO-022 | P2 | Remove recursive | **Concluído com limite documentado:** remoção recursiva exige confirmação exata e workspace root é protegido | `remove.js`, `locked-mutations.js`, `workspace-io.js`, `session-fs.js` | Após confirmação a operação continua destrutiva e sem snapshot de árvore | Preferir quarantine nos tools; manter confirmação exata na engine |
| IO-023 | P2 | Parser reset | **Concluído:** reset de parser é awaitable e testes aguardam isolamento | `io-parser.js`, `test_io_parser.spec.js` | Teardown de workers é explícito para evitar churn por teste | Usar shutdown/reset com teardown em processos one-shot |
| IO-024 | P2 | Scope readiness | **Concluído:** warming/ready/stale/degraded são distintos e erro é sanitizado | `io-session-scope.js`, `io-health.js`, terminal scope | `awaitReady()` continua não-rejeitante por compatibilidade | Consumidores devem checar `status`/`degraded`, não apenas conclusão da Promise |
| IO-025 | P2 | Observability | **Concluído:** espera, fila e leases L0/L1 são bounded e sanitizados | histogramas globais/por operação, p95, outcomes e amostra por hash no health | Paths não entram no snapshot; métricas são cumulativas por processo | Usar os dados para definir perfis de ativação do L1 |
| IO-026 | P2 | Search subprocess | **Concluído:** `rg`/`grep` textuais processam stdout incrementalmente | `subprocess.js`, `text-search.js` | `maxBuffer` permanece como proteção contra linha/chunk anômalo | Monitorar `streamStoppedEarly` e custo em buscas grandes |
| IO-027 | P2 | Glob policy | **Concluído:** matcher minimatch v10 compartilhado, enumeração protegida preservada | scanner/prefetch/FTS usam `scan/glob.js`; prova comparativa com Node glob | Node glob cru não aplica policy async/denylist | Manter scanner como owner da enumeração |
| IO-028 | P2 | Statfs | **Concluído com limite documentado:** preflight advisory antes de materializar payload grande | `capacity-preflight.js`, atomic write, copy staged, move EXDEV | `statfs` não reserva blocos e pode falhar aberto em plataforma unsupported | Manter ENOSPC real como autoridade final |
| IO-029 | P2 | Durable append | **Concluído:** recovery lógico e físico opt-in da linha parcial | `jsonl-reader.js` ignora por default e repara sob lock quando solicitado | Evita parser quebrado sem mutação surpresa | Manter repair bounded e opt-in |
| IO-030 | P3 | L3 cache | L3 reservado, mas sem contrato | `io-cache-tiering.js` | Sem problema atual | Só planejar se houver múltiplos runtimes/processos reais |
| IO-031 | P0 | Lock L1 | **Concluído:** PID local vivo prevalece sobre TTL | `file-resource-lock.js:isStaleLock` usa hostname/PID e heartbeat por mtime | Evita roubo de lease local longo | Manter prova multiprocess na Faixa 5 |
| IO-032 | P0 | Lock L1 | **Concluído:** metadata parcial respeita idade do inode | `observeLock()` combina metadata e `stat`; reclaim confirma a mesma observação | Fecha janela entre `open('wx')` e metadata | Adicionar crash injection durante criação |
| IO-033 | P1 | Lock release | **Concluído:** release determinístico | `releaseAsync()` idempotente em lease simples/múltiplo e wrappers | Cleanup L1 termina antes de liberar L0 | Manter `release()` apenas como compatibilidade |
| IO-034 | P0 | Move | **Concluído:** `overwrite=false` exclusivo same-device | `link(source,destination)` + sync + `unlink(source)` | Não sobrescreve destino criado em corrida | Provar com dois processos reais |
| IO-035 | P0 | Copy | **Concluído:** copy staged e verificado | temp exclusivo, hash/tamanho incremental, sync, `link`/`rename` | Preserva destino anterior até publish | Adicionar crash injection e ENOSPC real |
| IO-036 | P1 | Snapshot | **Concluído:** snapshot baixo consistente | `FileHandle.stat/read/stat`, confirmação do path e retry | Cache recebe bytes e metadata do mesmo inode/versão | Testar modificação externa durante read |
| IO-037 | P1 | Invalidation | **Concluído:** derivados são drenados antes do retorno | `invalidateIoCacheTiers*()` chama `flushIoInvalidationQueue()` | Read-after-write não espera debounce | Medir custo sob bursts de mutação |
| IO-038 | P1 | JSONL | **Concluído com exceção formal:** writer, leitura e recovery físico estão centralizados | `jsonl-file-writer.js`, `jsonl-reader.js`; logger síncrono allowlistado | Logger de emergência mantém semântica síncrona intencional | Manter contrato de allowlist e recovery opt-in |
| IO-039 | P2 | Lock governance | **Concluído:** `file-resource-lock.js` é SSOT | `infra/lockfile.js` delega aquisição ao L1 canônico e preserva API legado | Remove semânticas concorrentes | Manter facade até callers antigos desaparecerem |
| IO-040 | P2 | Scanner | **Concluído:** tipo básico vem de `Dirent` | `readdir({ withFileTypes:true })`; `lstat` só para arquivo/ambíguo | Reduz syscalls de classificação | Preservar benchmark e testar DT_UNKNOWN |
| IO-041 | P0 | Lock wait | **Concluído:** timer aguardado não usa `unref()` | prova multiprocess reproduziu exit 13 durante espera L1 | Processo podia encerrar antes de adquirir/rejeitar lock | Manter `unref()` apenas em heartbeat/background |
| IO-042 | P0 | Move durability | **Concluído:** sync posterior ao unlink não é confundido com falha de unlink | fases de source unlink e source directory sync foram separadas | Resultado podia reportar duplicação quando a origem já havia sido removida | Manter provas de falha antes/depois do unlink |
| IO-043 | P2 | Parser workers | **Concluído:** fila bounded, timeout end-to-end e health de pressão | `io-parser.js`, `io-health.js` | Subprocesso curto em Node 24 ainda pode precisar `process.exit` no teste isolado | Monitorar `workerQueueRejected`/`workerQueueTimeouts` em workloads reais |
| IO-044 | P1 | L2 SQLite | **Concluído:** hit não escreve recência em toda leitura | touch throttled por TTL/4, stats e workload antes/depois | Recência pode atrasar até 30 s, aceitável para cache | Manter janela bounded e observar evicção |
| IO-045 | P1 | L2 SQLite | **Concluído:** sets são agrupados em transações write-behind bounded | janela 25 ms/256 chaves, leitura pendente, flush explícito e workload incluindo drain | `SIGKILL` pode perder somente lote reconstruível ainda pendente | Manter prova multiprocess e alertar sobre batch failures |
| IO-046 | P1 | Shutdown/DB | **Concluído:** cache drena antes do fechamento SQLite | prioridade `CACHE_PERSISTENCE`, sinais delegam ao shutdown central e prova `SIGTERM` real | `SIGKILL` continua sem cleanup por definição | Manter ordem canônica e prova multiprocess recorrente |
| IO-047 | P1 | L2 soak | **Concluído:** cap, TTL, reconfiguração, WAL e shutdown passaram em processo longo sintético | duas execuções, 7.200 sets cada, zero batch failure e integridade `ok` | Soak sintético não substitui telemetria de deployment | Ativar `experimental` apenas onde reuse real justificar |
| IO-048 | P1 | Move EXDEV | **Concluído:** criação do temp cross-device agora é exclusiva | `COPYFILE_EXCL` e colisão determinística preservando sentinel | Token forte reduz corrida, exclusividade decide | Manter mesma regra de copy staged |
| IO-049 | P2 | Temp recovery | **Concluído com limite documentado:** cleanup é age-gated, host-aware e bounded | 24 h/PID morto local; host estrangeiro opt-in; scan 10 mil e cache 1.024 dirs | Recriação de container pode exigir limpeza administrativa | Manter schema estrito e nunca limpar por glob aproximado |
| IO-050 | P1 | Consistência externa | **Concluído:** snapshot, L1 e índice recusam inode/versão obsoletos | fingerprint rico, retries e provas multiprocess com replace atômico | L1 ainda respeita stale-probe configurável; L2 legado cai em fallback | Usar probe `0` somente em perfis paranoicos e observar `snapshotConflicts` |
| IO-051 | P2 | Chunk streaming | **Concluído com limite documentado:** handle/version token e stale abort end-to-end | byte-index rico, retry materializado e `ESTALECHUNKSTREAM` multiprocess | Caller incremental pode ter consumido chunks antes do erro | Exigir descarte integral do token stale; nunca retry transparente após entrega |
| IO-052 | P2 | Patch externo | **Concluído com limite documentado:** editor/Git externo é recusado antes do publish | precondição final baixa, processo editor e `git checkout` real | Microjanela portátil entre confirmação e `rename` | Manter a prova coordenada e preferir writers cooperativos quando possível |
| IO-053 | P1 | Chunk CRLF | **Concluído:** fuzz encontrou carry CRLF reordenado e metadata final inflada | seeds reproduzíveis, regressão mínima e `read-chunks.js` corrigido | Parser podia perder linhas sob fronteira física específica | Manter seeds fixas e ampliar corpus sem tornar a suíte não determinística |
| IO-054 | P0 | Chunk UTF-8 | **Concluído:** streaming textual usa decode fatal e recusa bytes inválidos | `TextDecoder` streaming fatal, corpus binário e erro canônico | StringDecoder anterior podia substituir bytes silenciosamente | Manter todas as superfícies textuais sob a mesma política fatal |
| IO-055 | P1 | Chunk byte-seek | **Concluído:** `highWaterMark` governa índice e seek; concatenação é linear | fases observáveis confirmam blocos físicos bounded; join único | Caller agora controla o tamanho dos blocos, não o total varrido para índice frio | Medir indexação fria de arquivos grandes e considerar índice persistente só com evidência |
| IO-056 | P1 | Parser limits | **Concluído:** line guard cobre CR/LF/CRLF e truncamento respeita bytes UTF-8 | `parsedBytes`, child tests com budgets pequenos e contagem sem split | Conteúdo completo já está materializado pelo caller; limite governa o parse, não a leitura | Auditar callers para evitar materialização integral quando apenas símbolos forem necessários |
| IO-057 | P1 | Parsers puros | **Concluído:** comentários, Markdown e JSONL iteram linhas lazy | primitiva CR/LF/CRLF compartilhada e regressões CR-only | Slices de cada linha ainda criam somente a string consumida, bounded pelo avanço | Reusar a primitiva em novos parsers line-oriented |
| IO-058 | P1 | Parser budgets | **Concluído:** caches e respostas de outline são bounded por bytes | LRU weighted, health, rejection metric, `maxItems/maxBytes` nas duas tools | Estimativa de heap do LRU é conservadora, não medição exata do V8 | Calibrar defaults com telemetria de produção e manter hard caps |
| IO-059 | P0 | Symbol cache | **Concluído:** hits são validados por fingerprint rico e parse é reconfirmado | replace externo real, retries bounded e métricas por caminho | `stat` por hit adiciona syscall deliberado em troca de consistência | Medir hit latency; só considerar probe temporal com evidência |
| IO-060 | P1 | Index chunks | **Concluído:** contagem/chunking não materializam todas as linhas | iterador compartilhado, gerador bounded e inserção SQLite incremental | FTS ainda recebe o conteúdo integral exigido pela API atual | Avaliar FTS5 contentless/external-content apenas com benchmark e plano de migração |
| IO-061 | P1 | Babel parser | **Concluído:** policy/extrator únicos usam opções atuais por extensão | CommonJS/module, TS dts/mts/tsx, ImportExpression, error codes e paridade worker | Proposals/Flow não são auto-habilitados; decorators continuam legacy | Monitorar Babel semver e criar fixture antes de alterar syntax policy |
| IO-062 | P1 | Read-through | **Concluído:** snapshot textual L1 é reutilizado e Buffer duplicado é opt-out | métricas no relatório e prova de miss binário posterior | Reuso exige fingerprint rico; entradas legadas caem para snapshot físico | Propagar snapshots diretamente em novos callers, sem reconstruir conteúdo |
| IO-063 | P1 | Patch lines | **Concluído:** metadata usa LF/CRLF/CR e ocorrência específica evita segunda varredura | regressão mista, fuzz e consumers de patch-plan | Diff foi alinhado posteriormente em IO-065 | Manter fuzz físico compartilhado |
| IO-064 | P1 | Read line offsets | **Concluído:** slicing físico é uniforme e retenção do cache é bounded por bytes | scanner O(1) no bypass, offsets `Uint32Array`, health e regressões CR/LF/CRLF | Construção de offsets faz duas varreduras para obter alocação compacta exata | Medir miss frio versus redução de heap; manter o orçamento global |
| IO-065 | P1 | Diff/output window | **Concluído:** inputs não viram arrays integrais para diff/paginação | duas passagens lazy, scanners de offsets e 10 mil casos diferenciais | Diff continua index-aligned, não é algoritmo LCS | Só migrar algoritmo com contrato/fixtures de inserção e benchmark |
| IO-066 | P0 | Search UTF-8 | **Concluído:** stdout streaming usa decode incremental fatal | code point entre chunks, bytes inválidos e early stop cobertos | stderr diagnóstico e `execSearchFile` legado continuam decode best-effort após concatenação | Manter stdout textual de busca sob política fatal |
| IO-067 | P0 | JSONL tail | **Concluído:** cauda tem budgets físicos e decode incremental fatal | hard caps, ring bounded, regressões e propagação SSE/audit | Uma linha maior que `maxBytes` é omitida e sinalizada, não parcialmente parseada | Manter warning/metadata quando completude for funcionalmente relevante |
| IO-068 | P2 | Babel comments | **Concluído por medição:** `attachComment` permanece ligado | 1.272 arquivos/10,7 MB; mediana 1,109x; 8.591 docs preservados | Benchmark local tem dispersão de JIT/GC e não substitui telemetria | Perfil sem docs somente opt-in, cacheado à parte e com prova end-to-end |
| IO-069 | P0 | HTTP UTF-8/budgets | **Concluído:** corpos estruturados MCP/OAuth e probes são bounded/fatais | default 2 MiB, request caps 64 KiB, cancelamento e testes de bytes inválidos | Stderr diagnóstico continua best-effort e bounded | Manter payloads estruturados sob decode fatal; não promover stderr a dado confiável |
| IO-070 | P0 | Web tools | **Concluído:** fetch/search têm caps determinísticos e UTF-8 fatal | 2 MiB default/search, 8 MiB máximo fetch, truncagem code-point-safe | HTML/JSON acima do cap falham em vez de retornar parse parcial | Expor aumento de cap somente de forma explícita e bounded |
| IO-071 | P0 | Catalog HTTP | **Concluído:** 28 importadores compartilham leitura bounded e UTF-8 fatal | 8 MiB default, 32 MiB hard cap, precheck e 31 testes focados | JSON precisa caber integralmente; doubles sem stream não exercitam budget físico | Manter qualquer importer novo no helper e adicionar prova com `Response` real |
| IO-072 | P0 | Response inbound | **Concluído:** bytes/texto/JSON usam fachada pública bounded | bridge, BYOK, Cloudflare e scripts migrados; 80 testes focados | Doubles sem stream preservam fallback de compatibilidade | Criar guardrail estático contra consumo direto novo |

### 5.1 Reclassificação dos achados originais no baseline atual

| Estado | IDs |
| --- | --- |
| Concluído | IO-003, IO-004, IO-007, IO-008, IO-010, IO-011, IO-012, IO-013, IO-014, IO-015, IO-016, IO-017, IO-019, IO-020, IO-021, IO-023, IO-024, IO-025, IO-026, IO-027, IO-029, IO-031, IO-032, IO-033, IO-034, IO-035, IO-036, IO-037, IO-039, IO-040, IO-041, IO-042, IO-043, IO-044, IO-045, IO-046, IO-047, IO-048, IO-050, IO-053, IO-054, IO-055, IO-056, IO-057, IO-058, IO-059, IO-060, IO-061, IO-062, IO-063, IO-064, IO-065, IO-066, IO-067, IO-068, IO-069, IO-070, IO-071, IO-072 |
| Concluído com limite documentado | IO-001, IO-002, IO-005, IO-006, IO-018, IO-022, IO-028, IO-038, IO-049, IO-051, IO-052 |
| Parcial | IO-009 |
| Aberto | IO-030 |

---

## 6. Situação atual: avaliação por dimensão

### 6.1 Segurança contra corrupção

**Bom:**

- Mutação canônica usa locks intra-processo e pode compor lockfile L1 opt-in por perfil de risco.
- Patch e write podem usar `expectedHash`.
- Atomic replace usa temp exclusivo, `flush:true`, rename/link e directory sync best-effort.
- Move `EXDEV` verifica hash/tamanho antes de publicar e remover a origem.
- Create, copy e move sem overwrite têm exclusividade real.
- Copy com overwrite é staged e só substitui o destino após verificação e sync.
- Temporários de publicação são ocultos, irmãos do destino, bounded e usam token de 128 bits.
- Snapshot baixo confirma inode/fingerprint antes de alimentar cache.
- Cache é invalidado após mutações canônicas.

**Insuficiente:**

- Sidecars têm janela de restauração limitada pelo TTL e ainda não entram no health agregado.
- Remoção recursiva continua destrutiva após confirmação, mas não pode mais ocorrer sem repetir o alvo exato e não
  pode remover a raiz de uma capability workspace-bound.
- O preflight de espaço é advisory e não reserva blocos; `ENOSPC` durante a operação continua sendo a autoridade final.

**Diagnóstico:** as primitivas canônicas protegem replace, copy, move, snapshot, rollback material e concorrência
cooperativa/multiprocess opt-in. A camada ainda não é uma transação ACID: rollback é um plano com material temporário,
não um executor atômico distribuído.

### 6.2 Locks e concorrência

O design L0 de `io-locks.js` continua correto para single-process async concurrency. A reentrância com `AsyncLocalStorage` evita deadlocks e multi-lock ordenado lexicograficamente evita inversão.

O L1 coordena processos cooperativos por `open('wx')`, heartbeat e stale recovery conservador. Release determinístico
compõe L1 antes de liberar L0, o lock manager legado delega ao SSOT e provas multiprocess cobrem espera, exclusão e
recovery. A promoção a default agora depende de medir contenção/custo e definir perfis de ativação. Em devcontainer,
concorrência externa continua incluindo:

- VS Code/editor;
- Git;
- terminal humano;
- outro Node process;
- validações/testes;
- ferramentas externas de format/lint.

Estado ideal: manter L0 rápido e ativar L1 por perfil para mutações P0/P1 com p95, timeout e leases sanitizados.

### 6.3 Atomicidade e durabilidade

O writer atual executa a sequência durável para replace, propaga resultados de durabilidade e copy/move usam
publicação staged/verificada. Falhas reais de sync são promovidas conforme a política, enquanto misses explicitamente
não suportados permanecem best-effort. A sequência de referência permanece:

1. abrir tmp no mesmo diretório com flags exclusivas;
2. escrever payload completo;
3. `filehandle.sync()` ou `writeFile(..., { flush: true })`;
4. fechar handle;
5. `rename(tmp, target)`;
6. abrir diretório e `sync()` quando plataforma suportar;
7. invalidar caches e publicar evento.

Para append, a política implementada depende do tipo:

- JSONL/audit: append record framed, newline, flush opcional, recovery de última linha.
- Logs de baixa criticidade: append buffered sem flush, mas explicitamente classificado como best-effort.

### 6.4 Cache e invalidação

L1 é bem pensado: TTL, max bytes, fingerprint `mtime/size/ctime/dev/ino` e hash revalidation para arquivos pequenos.
Snapshot inicial consistente, line-offset normalizado e flush derivado já foram incorporados. O stale probe de 2 s é
uma decisão de custo/freshness, não uma garantia instantânea; deployments que exigem validação em cada hit podem usar
intervalo `0`.

A prioridade remanescente é:

- medir hit/miss e custo da verificação periódica do índice.
- medir `snapshotConflicts` e a incidência real de retry sob editor/Git.
- medição do custo do flush imediato sob bursts.
- coletar telemetria do L2 apenas nos deployments long-lived que optarem por `experimental`; os gates sintéticos estão
  concluídos e o default global permanece `off`.

### 6.5 Scanner, busca e index

O scanner usa `readdir({ withFileTypes: true })` e evita `lstat` para diretórios e symlinks reconhecidos. O benchmark local ficou entre 154 e 214 ms para 1.565 entradas de `src/copilot`; ainda falta benchmark comparativo automatizado e cobertura de filesystems que retornam tipo desconhecido.

A busca está bem protegida contra shell injection: usa `spawn` com args array e maxBuffer/timeout. O índice FTS agora
combina metadata rica com verificação periódica bounded, e contagens/cursor derivam da visão sanitizada. Stdout
textual de `rg`/`grep` é processado incrementalmente, com UTF-8 fatal e early stop. O risco remanescente fica restrito
a chamadas sem `maxResults`, que podem coletar saída até `maxBuffer`, e ao decode best-effort de stderr/adapter legado
após concatenação bounded.

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

- [x] Criar regra de governança/allowlist para writers síncronos diretos.
- [x] Ampliar governança para writers assíncronos diretos restantes.
- [x] Classificar cleanup/mkdir diretos em matriz exata por arquivo/operação.
- [x] Migrar `/export` para atomic portable.
- [x] Migrar audit/SSE/observability para append canônico.
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
- [x] Promover falha real de file/directory sync e preservar skips unsupported.
- [x] Propagar metadata detalhada de durabilidade para resultados públicos e eventos de IO.
- [x] Projetar agregados de durabilidade no health.

#### Fase 1.2 — Move seguro

- [x] `EXDEV` copia para temp, verifica hash/tamanho e publica antes de unlink.
- [x] Duplication state é exposto quando unlink da origem falha.
- [x] Same-device `overwrite=false` usa publicação exclusiva.
- [x] Falha real de `syncFileBestEffort` impede remoção da origem quando a durabilidade foi exigida.
- [x] Sync dos diretórios source/destination no caminho same-device.
- [x] Falha real no sync do destino preserva origem; sync após unlink não reporta duplicação falsa.

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
- [x] Truncamento físico opcional e bounded da última linha parcial sob lock.
- [x] Migrar metrics/transcript e formalizar logger síncrono best-effort em allowlist.

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

- [x] Separar capability workspace-facing da capability trusted/portable.
- [x] `workspaceIo` exige `workspaceRoot` e policy async.
- [x] `trustedPortableIo` exige caller explícito e possui allowlist exata.
- [x] Testar fail-fast de trusted sem caller e null-byte na engine baixa.
- [x] Testar traversal, symlink externo e absoluto externo na capability workspace-bound.

#### Fase 2.4 — Observabilidade

- [x] Histograma/p95 de espera L0 e L1.
- [x] Contadores de timeout e abort.
- [x] Contadores de stale recovery e heartbeat failure.
- [x] Snapshot de leases com idade e operação, sem vazar path sensível.

#### Fase 2.5 — Perfis de ativação L1

- [x] `off`, `high-risk`, `mutations` e `all` como enum suportado.
- [x] Compatibilidade booleana legado.
- [x] Propagar `operation`, `target` e `riskClass` nos mutators centrais.
- [x] Health degradado para perfil inválido.
- [x] Schema/template/documentação de env alinhados.

#### Fase 2.6 — Guardrail destrutivo

- [x] Exigir confirmação exata do path resolvido em toda remoção recursiva da engine.
- [x] Proteger a raiz da capability workspace-bound contra remove recursivo.
- [x] Fazer SessionFS confirmar somente após containment.
- [x] Manter quarentena MCP como caminho reversível preferido, sem duplicá-la na engine baixa.

#### Fase 2.7 — Preflight de capacidade

- [x] Consultar `statfs` antes de atomic write/copy staged/move EXDEV acima de limiar.
- [x] Falhar cedo com ENOSPC apenas quando a insuficiência é observável.
- [x] Falhar aberto quando `statfs` não está disponível.
- [x] Expor threshold, reserva e relatório estruturado sem prometer reserva de blocos.

#### Fase 2.8 — Readiness de scopes

- [x] Separar warming, ready, stale e degraded.
- [x] Preservar `awaitReady()` não-rejeitante sem falso `ready:true`.
- [x] Sanitizar erro por fase/código sem expor path.
- [x] Projetar contagens/alerta no health e estado humano no terminal.

### Faixa 3 — Snapshot e coerência derivada

#### Fase 3.1 — Snapshot consistente

- [x] `open` + `stat/read/stat` + verificação do path.
- [x] Retry limitado quando inode/fingerprint muda.
- [x] Retorna `dev`, `ino`, `ctimeMs`, tentativas e `consistent`.
- [x] Cacheia somente snapshot consistente.

#### Fase 3.2 — Snapshot de mutação incremental

- [x] Remover `Array.fromAsync(stream)`.
- [x] Hash e orçamento de rollback em `for await`.
- [x] Adicionar teste de arquivo grande sem retenção integral.
- [x] Persistir excedente em sidecar durável com hash e TTL.
- [x] Cleanup bounded de finais e `.pending` expirados sob lock.
- [x] Propagar sidecar pelo token v2 preservando tokens v1.
- [x] Confirmar handle/path após o stream e repetir conflito externo sem publicar sidecar parcial.

#### Fase 3.3 — Invalidação read-after-write

- [x] Normalizar line-offset keys.
- [x] Forçar flush dos hooks derivados antes de retornar mutação canônica.
- [x] Testar equivalência de path relativo/absoluto.
- [x] Testar mudança same-size/same-mtime.

#### Fase 3.4 — L2 e índice

- [x] Perfil experimental L2 em CI, isolado e multiprocess.
- [x] Perfil operacional `off|experimental|on`, fail-closed e documentado.
- [x] Auditar WAL, `busy_timeout` e `synchronous`.
- [x] Hash periódico bounded + ctime/dev/ino para freshness.
- [x] Medir cold/warm inicial entre processos e steady-state.
- [x] Coletar hit ratio, distribuição de payloads e break-even em workload longo.
- [x] Remover write amplification de recência em cada hit.
- [x] Medir admissão por tamanho; nenhum limiar melhorou break-even.
- [x] Aplicar batching de sets e medir seed incluindo o flush terminal.
- [x] Provar perda bounded sob `SIGKILL`, contenção SQLite externa e shutdown por `SIGTERM`.
- [x] Executar soak de processo longo cobrindo TTL, evicção, reconfiguração e crescimento de WAL.
- [x] Documentar decisão: `experimental` para long-lived com reuse comprovado; default global `off`.
- [x] Persistir fingerprint rico em novos registros L2 e propagar identidade na promoção L2->L1.
- [x] Reconfirmar unchanged/hash-refresh/parse imediatamente antes de commit e repetir conflito bounded.

#### Fase 3.5 — Streaming versionado

- [x] Migrar byte-line index para fingerprint rico e handle confirmado.
- [x] Definir version token/abort para `readTextChunksStream` quando o path trocar de inode.
- [x] Permitir retry somente na API materializada, antes de expor chunks ao caller.
- [x] Provar replace externo entre construção de offsets e byte-seek.

### Faixa 4 — Performance

#### Fase 4.1 — Scanner com Dirent

- [x] `readdir({ withFileTypes:true })`.
- [x] `lstat` apenas para arquivo/fingerprint ou caso ambíguo.
- [x] Benchmark em `src/copilot` completo.

#### Fase 4.2 — Search streaming

- [x] Sanitizar antes de paginar e contar.
- [x] Parser incremental de stdout.
- [x] Early stop real em `maxResults`.
- [x] Totais calculados pós-redação.

#### Fase 4.3 — Parser workers

- [x] Reset async interno existe e shutdown público aguarda.
- [x] Backpressure/limite de fila.
- [x] Queue length e timeout por arquivo no health.

#### Fase 4.4 — Política glob

- [x] Consolidar scanner, prefetch e filtro FTS em minimatch v10.
- [x] Preservar basename e segmentos simples para compatibilidade operacional.
- [x] Tratar negation/comments literalmente em campos include/exclude separados.
- [x] Comparar live com `fsPromises.glob` e manter enumeração sob policy async.

#### Fase 4.5 — Higiene de temporários

- [x] Inventariar geradores de temporário, sidecars e backups de recuperação.
- [x] Consolidar write/copy/move em helper irmão no mesmo diretório.
- [x] Usar prefixo dot-hidden, PID, papel bounded e token de 128 bits.
- [x] Limitar nomes longos por bytes sem cortar code point UTF-8.
- [x] Provar cleanup após falha injetada antes do publish.
- [x] Recuperar órfãos de crash com host/PID, idade mínima e scan/cache bounded.
- [x] Definir cleanup age-gated e host-aware para temporários deixados por crash real.

#### Fase 4.6 — Fronteiras HTTP textuais

- [x] Aplicar budgets e UTF-8 fatal a corpos MCP/OAuth estruturados.
- [x] Tornar fetch/search web bounded e observáveis.
- [x] Migrar todos os importadores de catálogo para um leitor bounded comum.
- [x] Auditar e migrar downloads, responses e streams textuais restantes fora de `catalog/importers`.
- [ ] Impedir por guardrail estático novo consumo direto de corpos `Response`.

### Faixa 5 — Provas

- [x] Fuzz textual e binário bounded, determinístico e reproduzível.
- [x] UTF-8 inválido recusado também em chunks materializados/streaming.
- [x] Fault injection determinístico em write, publish, move e rotate+append.
- [x] Fault injection em directory sync e prova `EXDEV` real entre devices distintos.
- [x] Crash real durante directory sync e fases internas do `EXDEV`, com órfão pré-publish documentado.
- [x] Dois processos concorrendo por create/copy/move/write.
- [x] Crash de holder L1 seguido de stale recovery real.
- [x] Modificação externa durante snapshot e index.
- [x] Git checkout/editor save durante patch.
- [x] Replace externo durante byte-line index/stream.

---

## 9. Matriz de testes recomendada

| Domínio | Caso | Resultado esperado |
| --- | --- | --- |
| UTF-8 | Prefetch de arquivo binário | Não cria text cache; `readText` continua recusando |
| Patch | Patch em UTF-8 inválido | Erro `BinaryFileError`; nenhum write |
| Atomic write | Abort durante espera de lock | Nenhum tmp órfão relevante; lock liberado |
| Atomic write | Crash antes de rename | Destino intacto; tmp detectável/limpável |
| Atomic write | Crash após rename | Destino íntegro; diretório persistido no modo durable |
| Temp naming | Destino com basename longo/Unicode | Temp oculto no mesmo diretório, entrada <= 240 bytes e UTF-8 válido |
| Create | Dois processos criando mesmo arquivo | Um vence; outro recebe EEXIST sem sobrescrever |
| Copy | `overwrite=false` com corrida externa | Não sobrescreve destino externo |
| Move | EXDEV com copy parcial | Origem preservada; destino final não publicado |
| Cache | Read relativo + read absoluto + write | Todas as entradas equivalentes invalidam |
| Snapshot | Arquivo muda durante read | Retry ou `ESTALESNAPSHOT`; não popular cache/sidecar ruim |
| Append | JSONL truncado por crash | Recovery ignora/trunca última linha inválida |
| Scanner | Symlink para fora do workspace | Não atravessa por padrão; path redigido/bloqueado |
| Search | Resultado enorme | Early stop sem estourar buffer |
| Catalog HTTP | Corpo acima do budget ou UTF-8 inválido | Falha antes do parse; nenhuma evidência parcial |
| Index | Mudança externa após parse | Retry antes da transação; FTS contém somente versão confirmada |
| Chunk stream | Inode troca após byte-line index | Abort/version mismatch; nunca usar offsets de versão anterior |
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
5. [x] adicionar truncamento físico opcional e bounded da cauda parcial;
6. [x] migrar metrics/transcript e allowlistar logger síncrono restante;
7. [x] consolidar `infra/lockfile.js` sobre o L1 canônico;
8. [x] executar provas multiprocess de create/copy/move/write e crash de holder L1;
9. [x] executar fault injection determinístico em publish e rotate+append;
10. [x] executar fault injection em directory sync e prova `EXDEV` real;
11. [ ] executar crash real durante directory sync e fases internas do `EXDEV`.

---

## 11. Notas específicas sobre arquivos centrais

### `io/fs/write-atomic.js`

É a primitiva baixa canônica de replace, possui estratégia de durabilidade e retorna o resultado do preflight e do
directory sync. O temporário é gerado por `temp-path.js`, no mesmo diretório, oculto e com 128 bits; falhas reais de
sync são promovidas, enquanto ausência explícita de suporte permanece best-effort. Quando recebe `expectedHash`,
reconfirma um snapshot consistente imediatamente antes do publish.

### `io/fs/locked-writes.js`

Bom encapsulamento. `expectedHash`, create exclusivo, release L1 determinístico e propagação de durabilidade estão no
lugar certo. Append/rotação seguem o writer canônico separado, evitando misturar replace e append na mesma primitiva.

### `io/fs/locked-mutations.js`

Patch valida UTF-8, materializa rollback grande e reconfirma a base antes do publish; conflito externo preserva a
versão vencedora e descarta sidecar obsoleto. Copy/move staged preservam o destino anterior por base64 ou sidecar.
Remove recursivo exige confirmação exata do alvo resolvido. A operação ainda não cria snapshot de árvore, por desenho;
callers humanos devem continuar preferindo a quarentena reversível do MCP.

### `io/fs/move.js`

O fallback EXDEV e o caminho same-device foram endurecidos. Sem overwrite, a publicação é exclusiva por `link`; falha ao remover origem é reportada como duplicação.

### `io/fs/snapshot.js`

O snapshot de mutação é incremental, aceita orçamento zero e promove o excedente para writer sidecar sem reter o
arquivo inteiro. Agora lê pelo `FileHandle`, confirma handle/path ao final e aborta o sidecar da tentativa stale antes
de repetir. A prova multiprocess substitui o inode após o primeiro chunk e confirma que somente a versão nova é
materializada.

### `io-prefetch.js`

Respeita a validação UTF-8 de `readText` e promove `ctime/dev/ino` em todos os caminhos bytes/text/read-through. O
trabalho remanescente é medir custo/benefício do warmup por workload; o L2 experimental já expõe custo por operação.

### `io-cache.js`

Boa engenharia. Hash revalidation, fingerprint rico, snapshot consistente e path normalization universal tornam o L1
confiável fora da janela configurada de stale probe. O L2 agora possui perfil explícito, touch throttled, batching
transacional, fingerprint rico para registros novos e telemetria separada de set/flush. O custo básico já atingiu
break-even em 2–4 reusos; promoção além de `experimental` depende de telemetria de deployment.

### `io-scanner.js`

Usa `Dirent` para classificação básica e mantém a política de não seguir symlink por padrão. Falta benchmark automatizado comparativo e caso DT_UNKNOWN.

### `io-index-sqlite.js`

Freshness combina metadata rica (`mtime/size/ctime/dev/ino`) com hash periódico bounded e confirmação pré-commit.
Fast path, renovação por hash e resultado do parser são reconfirmados; builds repetem conflitos e expõem
`snapshotConflicts`. O próximo trabalho é medir hit/miss/retry por perfil e ajustar orçamento.

### `io-locks.js`

Sólido no L0 e composto com L1 conservador. Release é determinístico, o legado delega ao SSOT e a concorrência
multiprocess foi provada. Espera, fila, timeout/abort e leases ativos são observáveis com cardinalidade e payload
bounded. A próxima evolução é escolher perfis de ativação do L1 usando esses dados.

---

## 12. Critérios de aceite para declarar a infra IO “confiável”

Os critérios fundacionais originalmente definidos estão atendidos:

- [x] escrita fora de `infra` passa por fachada pública/trusted ou allowlist formal;
- [x] `readText`, prefetch, patch e index compartilham validação UTF-8;
- [x] create/copy/move sem overwrite usam exclusividade real;
- [x] atomic write possui modo durável com sync de arquivo e diretório;
- [x] move EXDEV verifica integridade;
- [x] snapshots de leitura são consistentes ou falham sem popular cache;
- [x] cache derivado é invalidado antes do retorno de mutação crítica;
- [x] há provas multiprocess e fault injection determinístico;
- [x] semânticas de lock estão documentadas por nível;
- [x] rollback material de arquivo grande possui hash, TTL e cleanup seguro.

Critérios operacionais adicionais já atendidos:

- [x] perfil explícito de ativação L1 para mutações P0/P1;
- [x] p95/histograma, timeout/abort e leases sanitizados;
- [x] confirmação reforçada intrínseca para remove recursivo e proteção da raiz workspace-bound;
- [x] preflight opcional de espaço livre em payloads grandes;
- [x] search incremental com early stop real.
- [x] canário recorrente do perfil L2 `experimental` em CI sem alterar o default.
- [x] reduzir e medir o custo de seed do L2 sem esconder o flush terminal.
- [x] provar perda bounded em `SIGKILL`, retry após contenção e flush antes do DB em `SIGTERM`.
- [x] executar soak L2 com TTL, evicção, reconfiguração, checkpoint WAL e reabertura íntegra.
- [x] provar replace externo durante snapshot de rollback, validação L1 e commit do índice.

Maturidade operacional avançada:

- [x] fuzz textual/binário bounded e reproduzível sobre patch, chunks e limites;
- [x] aplicar budgets físicos de linhas/bytes sem arrays ou truncamento em unidades incorretas;
- [x] limitar retenção dos caches de parser por peso e respostas de outline por itens/bytes;
- [x] validar cache simbólico contra writers externos e eliminar releitura no read-through;
- [x] inserir chunks do índice a partir de gerador bounded;
- [x] unificar policy/extrator Babel e alinhar source modes, TS e ImportExpression à documentação oficial;
- [x] reutilizar snapshot textual L1 no read-through e evitar cache binário duplicado no caller textual;
- [x] unificar linhas físicas no patch e remover segunda varredura/arrays do replace-all;
- [x] unificar linhas físicas na leitura e limitar o line-offset cache por bytes;
- [x] remover arrays integrais de diff/output-window sem alterar contratos;
- [x] tornar fatal e incremental o decode UTF-8 do stdout de busca;
- [x] limitar cauda JSONL por bytes/linhas e recusar decode substitutivo;
- [x] medir `attachComment` no corpus real e formalizar a decisão funcional;
- [x] aplicar budgets e UTF-8 fatal a corpos estruturados HTTP/MCP/OAuth;
- [x] tornar caps de web fetch/search determinísticos e observáveis;
- [x] aplicar leitura bounded e UTF-8 fatal aos 28 importadores de catálogo;
- [x] consolidar consumo inbound de `Response` em fachada pública para bytes/texto/JSON;
- [ ] manter ampliação contínua do corpus quando incidentes ou novos contratos surgirem.

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
- `@babel/parser` API, options, AST, plugins e error codes: https://babeljs.io/docs/babel-parser

---

## 14. Próxima ação executável

Criar guardrail estático que recuse novo consumo direto de corpos `Response` fora das fachadas canônicas, distinguindo
essas leituras de `res.json()` do Express. Depois continuar a auditoria de streams de subprocesso/socket e ampliar
fixtures Babel somente para sintaxe realmente aceita pelo workspace. Manter fuzz/chaos como gates recorrentes.
IO-030/L3 permanece explicitamente sem implementação até existir evidência de múltiplos runtimes/processos reais que
justifique o contrato.
