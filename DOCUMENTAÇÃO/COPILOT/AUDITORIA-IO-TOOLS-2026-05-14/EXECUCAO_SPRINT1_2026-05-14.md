# Execução Sprint 1 — Log de Implementação (2026-05-14)

## Escopo executado nesta rodada

### 1) `src/copilot/tools/todo/store.js`
- Refatorado `withStore` para mutex serial canônico.
- Elimina fragilidade de cadeia `Promise` e cobre unlock consistente em `finally`.

### 2) `src/copilot/infra/io/fs/read-chunks.js`
- Adicionado bloco `try/finally` no loop de leitura.
- `finally` fecha `readline.Interface` e destrói `ReadStream`.

### 3) `src/copilot/tools/shell/sandbox.js`
- Removido cache TTL de `safeEnv` (recomputa por chamada).
- `checkCommandBlocklist` agora valida sobre comando normalizado (`NFKC`).
- Adicionada função exportada `normalizeCommandForValidation`.
- Regex sensível de ambiente ampliada para mais famílias de segredo.

### 4) `src/copilot/tools/shell/executor.js`
- `runPipeline` ganhou rotina `stopAll` para cleanup coordenado.
- Em erro/timeout: destrói `stdin/stdout/stderr` e finaliza processos.

### 5) `src/copilot/infra/index-store/sqlite/query.js`
- `sanitizeFtsQuery` passou a filtrar tokens com tamanho mínimo de 2.

### 6) `src/copilot/infra/io-engine.js`
- Adicionado `assertValidIoFilePath` com bloqueio explícito de `null-byte`.
- Validação aplicada em `readBytes`, `readText` e `writeFileAtomic`.

### 7) `src/copilot/infra/io-parser.js`
- Introduzido lifecycle explícito do hook de invalidação (`ensureInvalidationHook`).
- Adicionado `resetParserCacheForTest()` com `unregister` seguro.

### 8) `src/copilot/infra/io-index-sqlite.js`
- `pruneMissingRows` passou a consultar lista sob path com filtro de extensão no SQL (`json_each`), reduzindo carga em memória.

### 9) `src/copilot/infra/sse/replay-buffer.js`
- Adicionado limite de tamanho de payload por evento (`SSE_REPLAY_MAX_PAYLOAD_BYTES`, default 64KB).
- Payloads não serializáveis ou acima do limite agora são normalizados para shape defensivo.

### 10) `src/copilot/tools/hook/hook-tools.js`
- `request_user_input` passou a sanitizar `context` (limite de 2000 chars + normalização de quebras).

### 11) `src/copilot/infra/sse/stream-hub.js`
- `broadcast` ficou resiliente a erro por cliente (`try/catch`) sem interromper fanout global.
- Clientes com falha de envio são removidos do pool.

### 12) `src/copilot/infra/io-health.js`
- Snapshot de saúde agora usa chamadas seguras (`safeCall`) para stats de parser/index/cache/scopes.

### 13) `src/copilot/infra/io-cache-l2-registry.js`
- Circuit breaker adicionado para falhas repetidas de init de L2 cache, com cooldown progressivo.

### 14) `src/copilot/tools/web/web-tools.js`
- `web_search` agora limita e sanitiza o tamanho da query antes de montar URLs externas.

### 15) `src/copilot/infra/io-index-sqlite.js`
- Persistência de `metadataJson` migrada para serialização segura (`safeMetaJson`) com limite de bytes.

### 16) `src/copilot/infra/webhooks.js`
- Timers de retry/timeout em `#deliverWithRetry` agora usam `unref()` para não bloquear shutdown.

### 17) `src/copilot/infra/io-parser.js`
- Loader lazy do Babel parser agora usa sentinel de indisponibilidade (`unavailable`) para evitar retries repetidos.

### 18) `src/copilot/tools/hub/hub-tools.js`
- `MAX_MSG_CHARS` passou a ser configurável por env (`COPILOT_HUB_MAX_MSG_CHARS`).

### 19) `src/copilot/infra/io-index-sqlite.js`
- `indexDirectory` passou a emitir eventos `build.progress` periódicos.

### 20) `src/copilot/infra/io-prefetch.js` + `src/copilot/infra/io-engine.js` + `src/copilot/infra/io/fs/read-bytes.js`
- Propagação de `AbortSignal` do prefetch para leitura subjacente do engine/snapshot.

### 21) `src/copilot/infra/io-engine.js`
- Budget de busca migrado para lazy init (`getIoSearchBudget`) em vez de resolução em module load.

### 22) `src/copilot/infra/lockfile.js`
- Mitigação adicional anti-symlink em acquire/release do lockfile (hardening parcial do risco TOCTOU).

### 23) `src/copilot/infra/queue/async-queue.js`
- Implementado suporte a prioridade em filas (`0` alta, `5` normal, `10` baixa), preservando controle de concorrência.

### 24) `src/copilot/infra/sse/fanout.js`
- `publish` desacoplado para emissão assíncrona com `setImmediate` (reduz bloqueio por subscribers lentos).

### 25) `src/copilot/infra/io-observability.js` + `src/copilot/infra/io-health.js`
- Introduzidos histogramas de latência por operação (`recordIoLatency` / `getIoLatencyStats`).
- Snapshot de health passou a expor o bloco `latency`.

### 26) `src/copilot/tools/shell/sandbox.js`
- Hardening adicional de `safeEnv` com ampliação de `sensitiveExact` para credenciais comuns faltantes.

### 27) `src/copilot/tools/todo/store.js`
- Saneamento de integridade referencial no carregamento do store (`subtaskIds` e `parentId`).

### 28) `src/copilot/infra/io/fs/write-atomic.js`
- `normalizeWritePayload` passou a retornar `Buffer` único, eliminando alocação dupla.

### 29) `src/copilot/infra/io-prefetch.js`
- `warmCacheForPaths` migrou de worker pool manual para `p-limit` com concorrência normalizada.

### 30) `src/copilot/infra/io-locks.js`
- Reentrância segura implementada com `AsyncLocalStorage` para locks no mesmo recurso dentro do mesmo contexto.
- Cleanup adicional de `tails` via `tail.finally` para reduzir retenção de entradas obsoletas.

### 31) `src/copilot/tools/web/web-tools.js`
- `web_fetch_local` passou a bloquear redirects para portas sensíveis de serviços internos.

### 32) `tests/unit/copilot/infra/test_locks.spec.js`
- Novo teste de reentrância (`withIoResourceLock` no mesmo recurso dentro de lock ativo).

### 33) `src/copilot/infra/module-map.js`
- Melhoria de documentação de dependências cruzadas no inventário infra (`webhooks.js` -> `#copilot/config`/`#copilot/core`).

### 34) `src/copilot/infra/io-engine.js`
- Validação de `filePath` (`null-byte`/arg inválido) ampliada para operações adicionais: `readTextChunks`, `createOrReplaceFileAtomic`, `appendTextLocked`, `statPath`, `mkdirPathLocked`, `deleteFileLocked`, `removePathLocked`, `copyFileLocked`, `moveFileLocked`, `patchTextLocked` e `diffText`.

### 35) `src/copilot/infra/io-scanner.js`
- Recursão de diretórios simplificada para reduzir overhead de segunda passada com batching.

### 36) `tests/unit/copilot/infra/test_io_engine.spec.js`
- Teste de contratos de retorno adicionado para `readBytes`, `readText` e `writeFileAtomic`.

### 37) `src/copilot/tools/bootstrap.js`
- `TOOL_GROUPS` migrou para estrutura fortemente tipada (`ToolGroupConfig[]`) com registro por objeto (`tools/category/tags/readOnly`).

### 38) `src/copilot/infra/io-session-scope.js`
- Removido acoplamento de `_warmPromise` no objeto de escopo; warm-up agora gerenciado por `_warmPromises` registry dedicado.

### 39) `src/copilot/infra/io-locks.js`
- Adicionado sweep periódico de `tails` com `unref()` para hardening adicional de retenção sob alta rotação.

### 40) `src/copilot/infra/io-scanner.js`
- Hardening de entrada: valida `rootPath/workspaceRoot` (bloqueio de null-byte/arg inválido) e sanitiza `include/exclude/blockedSegments`.

### 41) `src/copilot/infra/io-engine.js`
- Hardening das APIs de busca: validações de `targetPath`, `pattern`/`symbolName` e padrões com null-byte em `searchText`/`searchWorkspaceSymbols`.

### 42) `tests/unit/copilot/infra/test_io_scanner.spec.js`
- Novo teste cobrindo rejeição de `rootPath/workspaceRoot` inválidos com null-byte.

### 43) `tests/unit/copilot/infra/test_io_engine.spec.js`
- Novo teste cobrindo validações de parâmetros inválidos em `searchText`/`searchWorkspaceSymbols`.

### 44) `src/copilot/infra/shared/fingerprint-match.js`
- Novo helper compartilhado para comparação de fingerprint (`mtimeMs` + `sizeBytes`) com tolerância configurável.

### 45) `src/copilot/infra/io-cache.js` + `src/copilot/infra/io-index-sqlite.js`
- Adoção do helper `fingerprintMatches` para unificar lógica de freshness entre cache L1 e indexação SQLite.

### 46) `src/copilot/infra/io/fs/read-chunks.js`
- `readTextLineChunks` evoluiu com suporte a `AbortSignal` e erro explícito `AbortError` quando cancelado.

### 47) `tests/unit/copilot/infra/test_fingerprint_match.spec.js`
- Nova suíte cobrindo cenário de tolerância, divergência de size e estouro de tolerância em mtime.

### 48) `tests/unit/copilot/infra/test_io_fs_read_chunks.spec.js`
- Novo teste para garantir rejeição com `AbortError` quando `readTextLineChunks` é chamado com signal já abortado.

### 49) `src/copilot/tools/file/shared.js`
- Política de output das file-tools migrou de default ilimitado para defaults altos e finitos (com override por ENV).

### 50) `src/copilot/tools/session/session-tools.js`
- `get_workspace_info` deixou de usar `maxBuffer` de 1 GiB em chamadas git; agora usa orçamento finito + timeout.

### 51) `src/copilot/tools/web/web-tools.js`
- `web_search` passou a aplicar limite default finito e clamp defensivo de `maxResults`.

### 52) `DOCUMENTAÇÃO/.../02-ROADMAP-FAIXAS-FASES.md`
- Roadmap alinhado à situação ideal com matriz de coerência Atual ↔ Ideal e status operacional atualizado por faixa.

### 53) `src/copilot/infra/io-prefetch.js`
- Transformação ampla de modularização: remoção da dependência direta de leitura em `io-engine`.
- Prefetch passou a usar `io/fs/read-bytes` e `io/fs/read-text` com priming explícito de L1 (`bytes` + `text` + hash/fingerprint).

### 54) Gate oficial pós-transformação ampla
- `typecheck:strict:src.copilot` ✅
- `lint -- src/copilot` ✅
- `test:copilot:unit` ✅ (2720/2720)

### 55) `src/copilot/infra/io/patch/text-diff.js`
- Refatorado `buildSimpleTextDiff` para consolidar hunks sobrepostos/adjacentes em uma única janela.
- Elimina cabeçalhos duplicados e contexto repetido em mudanças próximas (regressão do BUG-MED-01).

### 56) `tests/unit/copilot/infra/test_io_patch.spec.js`
- Adicionados testes de regressão para merge de hunks e não-duplicação de linhas de contexto.

### 57) `tests/unit/copilot/terminal/test_commands_index.spec.js`
- Estabilizado teste de status do índice para evitar flakiness por contagem global variável (`files>=2`),
  mantendo validação funcional do fluxo `/index build/status/search/symbol`.

### 58) `src/copilot/tools/web/web-tools.js`
- `web_fetch_local` agora faz cleanup robusto de stream com `reader.cancel()` (best-effort) antes de `releaseLock()`
    em `finally`, alinhando com a política de streams/snapshots da situação ideal.

### 59) Gate oficial pós-hardening web stream
- `typecheck:strict:src.copilot` ✅
- `lint -- src/copilot` ✅
- `test:copilot:unit` ✅ (2720/2720)

### 60) `src/copilot/infra/io/search/text-search.js` + `src/copilot/infra/io-engine.js`
- Extração da lógica de `searchText` e `searchWorkspaceSymbols` para módulo dedicado de busca textual/simbólica.
- `io-engine` preserva API pública (mesmas exports) e passa a delegar para o subdomínio `io/search`.
- Barrel `io/search/index.js` atualizado para expor as APIs extraídas.

### 61) Gate oficial pós-extração de busca
- `typecheck:strict:src.copilot` ✅
- `lint -- src/copilot` ✅
- `test:copilot:unit` ✅ (2720/2720)

### 62) `src/copilot/infra/io/fs/locked-mutations.js` + `src/copilot/infra/io-engine.js`
- Extração do bloco de mutações com lock para módulo dedicado de FS (`delete/remove/copy/move/patch`).
- `io-engine` preserva as mesmas exports públicas e passa a delegar para o subdomínio `io/fs/locked-mutations`.
- Barrel `src/copilot/infra/io/fs/index.js` atualizado para reexportar as mutações extraídas.

### 63) Gate oficial pós-extração de mutações
- `typecheck:strict:src.copilot` ✅
- `lint -- src/copilot` ✅
- `test:copilot:unit` ✅ (2720/2720)

### 64) `src/copilot/infra/io/fs/locked-writes.js` + `src/copilot/infra/io-engine.js`
- Extração do bloco de escritas lockadas para módulo dedicado de FS (`writeFileAtomic`, `createOrReplaceFileAtomic`,
  `appendTextLocked`, `mkdirPathLocked`).
- `io-engine` mantém o contrato público e passa a delegar essas operações ao subdomínio `io/fs/locked-writes`.
- Barrel `src/copilot/infra/io/fs/index.js` atualizado para reexportar as APIs do novo módulo.

### 65) Gate oficial pós-extração de writes
- `typecheck:strict:src.copilot` ✅
- `lint -- src/copilot` ✅
- `test:copilot:unit` ✅ (2720/2720)

### 66) `src/copilot/infra/io/patch/text-diff-service.js` + `src/copilot/infra/io-engine.js`
- Extração da lógica de diff textual observável para serviço dedicado no subdomínio `io/patch`.
- `io-engine.diffText` preserva o contrato público e delega para `diffTextWithReader`.
- Barrel `src/copilot/infra/io/patch/index.js` atualizado para reexportar o novo serviço.

### 67) Gate oficial pós-extração de diff
- `typecheck:strict:src.copilot` ✅
- `lint -- src/copilot` ✅
- `test:copilot:unit` ✅ (2720/2720)

### 68) `src/copilot/infra/io/fs/read-services.js` + `src/copilot/infra/io-engine.js`
- Extração do bloco de leitura/metadata para serviço dedicado (`readBytes`, `readText`, `readLines`,
  `readTextChunks`, `statPath`).
- `io-engine` preserva o contrato público e delega as operações de leitura para `io/fs/read-services`.
- Barrel `src/copilot/infra/io/fs/index.js` atualizado para reexportar `read-services`.

### 69) Gate oficial pós-extração de read-services
- `typecheck:strict:src.copilot` ✅
- `lint -- src/copilot` ✅
- `test:copilot:unit` ✅ (2720/2720)

### 70) `src/copilot/infra/policy/path-resource.js` + adoção em módulos IO
- Introduzido helper canônico `assertValidIoFilePath` em `policy/path-resource`.
- Validação duplicada removida de `io-engine`, `io/fs/read-services`, `io/fs/locked-writes` e
    `io/fs/locked-mutations`.
- Resultado: menor drift entre módulos e comportamento de erro unificado (`ERR_INVALID_ARG_VALUE`).

### 71) Gate oficial pós-centralização de assert path
- `typecheck:strict:src.copilot` ✅
- `lint -- src/copilot` ✅
- `test:copilot:unit` ✅ (2720/2720)

### 72) `tests/unit/copilot/infra/test_policy_path_resource.spec.js`
- Cobertura ampliada para `assertValidIoFilePath`:
    - aceita path válido;
    - rejeita null-byte;
    - rejeita path vazio.

### 73) Gate oficial pós-cobertura de path policy
- `typecheck:strict:src.copilot` ✅
- `lint -- src/copilot` ✅
- `test:copilot:unit` ✅ (2723/2723)

---

## Itens da Sprint 1 ainda pendentes

- Hardening final de `safeEnv` (`sensitiveExact` adicional, se necessário).

## Itens da Sprint 2 já iniciados e aplicados

- SEC-GAP-03 (`replay-buffer`) — concluído.
- SEC-GAP-09 (`hook-tools`) — concluído.
- DEBT-14 (`stream-hub`) — concluído.
- FUNC-GAP-02 (`io-health`) — concluído.
- FUNC-GAP-06 (`io-cache-l2-registry`) — concluído.
- SEC-GAP-04 (`web_search`) — concluído.
- SEC-GAP-06 (`io-index-sqlite` metadataJson) — concluído.
- FUNC-GAP-01 (`io-prefetch` abort propagation) — concluído.
- FUNC-GAP-03 (`io-index-sqlite` progress events) — concluído.
- DEBT-07 (`webhooks` unref timers) — concluído.
- DEBT-15 (`io-parser` fail-cache) — concluído.
- DEBT-17 (`hub-tools` max chars env) — concluído.
- DEBT-18 (`io-engine` lazy search budget) — concluído.
- SEC-GAP-08 (`lockfile`) — mitigado parcialmente.
- FUNC-GAP-04 (`async-queue` prioridade) — concluído.
- FUNC-GAP-05 (`event-fanout` assíncrono) — concluído.
- FUNC-GAP-08 (`io latency histograms`) — concluído.
- SEC-GAP-05 (`safeEnv` hardening final) — concluído.
- FUNC-GAP-07 (`todo` integridade referencial na carga) — concluído.
- DEBT-08 (`normalizeWritePayload` sem double-allocation) — concluído.
- DEBT-09 (`prefetch` com `p-limit`) — concluído.
- BUG-HIGH-01 (`io-locks` reentrância) — concluído.
- BUG-MED-03 (`redirect` para portas sensíveis) — concluído.
- DEBT-10 (`tails cleanup`) — melhorado.
- DEBT-11 (documentação de dependências cruzadas) — melhorado.
- SEC-GAP-01 (`null-byte` em operações críticas de IO) — concluído.
- DEBT-12 (`io-scanner` overhead de segunda passada) — melhorado.
- DEBT-13 (testes de contrato em facades críticas) — concluído.
- DEBT-02 (`bootstrap` tipagem de grupos) — concluído.
- DEBT-05 (`io-session-scope` warm promise acoplada) — concluído.
- DEBT-10 (`tails cleanup`) — melhorado adicionalmente.
- DEBT-03 (`fingerprint matching disperso`) — concluído.
- DEBT-06 (`read-chunks` robustez abort/cancelamento) — melhorado.
- Drift de output window ilimitada em file-tools — mitigado (defaults finitos).
- Drift de orçamento excessivo (`session-tools` git info) — mitigado.

---

## Próximo gate obrigatório

Executar validadores de `src/copilot`:
1. typecheck strict
2. lint
3. unit tests
