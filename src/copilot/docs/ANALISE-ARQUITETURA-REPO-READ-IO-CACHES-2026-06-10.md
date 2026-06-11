# Análise estrutural de `repo-read.js`, IO, caches e tool local de leitura

Data: 2026-06-10  
Escopo: `src/copilot/mcp/tools/repo-read.js`, facade pública de IO, serviços de leitura, caches L1/L2, invalidação, parser/index/search associados e tool local análoga `read_file_content`.

## 1. Sumário executivo

Há **mais de um tipo de cache** no fluxo de leitura, e eles têm finalidades diferentes:

1. **Cache de payload MCP (`repo-read-cache.js`)**: cacheia respostas já estruturadas de `repo_read_file` e `repo_read_file_chunks`, incluindo `structured` + `text`. É um cache acima do IO, específico do MCP.
2. **IO L1 em memória (`io-cache.js`)**: cacheia bytes/texto completos por path e operação, com LRU, TTL, limite por bytes, validação por mtime+size e revalidação opcional por hash.
3. **IO L2 SQLite (`io-cache-l2-*`)**: cache opcional persistente por env, também para bytes/texto completos, validado por stat.
4. **Line-offset cache (`io/fs/line-offset-cache.js`)**: cacheia offsets derivados de linhas para acelerar janelas de `readText` sem guardar conteúdo de arquivo.
5. **Parser symbol cache (`io-parser.js::_symbolCache`)**: cacheia símbolos parseados por arquivo para `parseAndCacheSymbols`.
6. **Parser FileContext cache (`io-parser.js::_fileContextCache`)**: cacheia `symbols + outline + topComments` por `path + content.length + sha256(content)`, acelerando `parseFileForContext` e, por consequência, `repo_file_outline`.
7. **Index/FTS (`io-index-*`)**: índice derivado e persistente para search/symbol search; não é cache de leitura, embora funcione como aceleração de busca.
8. **Search subprocess cache**: cache booleano simples da disponibilidade de `rg`/ripgrep.
9. **Prefetch/read-through (`io-prefetch.js`)**: aquece L1 e, opcionalmente, índice/parser/imports relacionados; não é cache separado de conteúdo.
10. **Tool local `read_file_content`**: não tem cache próprio de conteúdo; delega para IO L1/L2 no modo `cached` e para stream bypass no modo `stream`.

A conclusão central é que os caches **não são o mesmo cache**. O cache MCP é um cache de resposta de tool; o cache IO é um cache de conteúdo completo; o line-offset cache é um cache de metadados derivados; o parser symbol cache é um cache de análise simbólica; o FileContext cache é um cache de contexto parseado; o índice é um cache/índice derivado de busca; e o prefetch apenas aquece L1/índice/parser.

## 2. Arquivos investigados

### Lidos integralmente

- `src/copilot/mcp/tools/repo-read.js`
- `src/copilot/infra/public/io.js`
- `src/copilot/infra/io/fs/index.js`
- `src/copilot/infra/io/fs/read-text.js`
- `src/copilot/infra/io/fs/read-chunks.js`
- `src/copilot/infra/io/fs/read-services.js`
- `src/copilot/infra/io-cache.js`
- `src/copilot/infra/io-cache-l2-registry.js`
- `src/copilot/infra/io-cache-l2-sqlite.js`
- `src/copilot/infra/io/invalidation/bus.js`
- `src/copilot/infra/io/invalidation/events.js`
- `src/copilot/infra/io/invalidation/cache-tiers.js`
- `src/copilot/infra/io-health.js`
- `src/copilot/infra/io-parser.js`
- `src/copilot/infra/io-prefetch.js`
- `src/copilot/tools/file/read/read-file-content.js`
- `src/copilot/tools/file/read/metadata.js`
- `src/copilot/tools/file/read/window.js`
- `src/copilot/tools/file/read/feedback.js`
- `src/copilot/tools/file/read/index.js`
- `src/copilot/tools/file/read-tools.js`
- `src/copilot/tools/file/shared.js`

### Lidos por chunks/outline por bloqueios intermitentes do host

- `src/copilot/infra/io-scanner.js`: outline completo + corpo central de `scanDirectory` por chunks.
- `src/copilot/infra/io/search/text-search.js`: outline completo + grande parte do corpo por chunks. Um trecho curto entre as linhas 621-649 foi bloqueado pelo host, mas o fluxo principal de `searchText` e `searchWorkspaceSymbols` foi mapeado.
- `src/copilot/infra/io-index-registry.js`: stats disponíveis; leitura direta/outline foram bloqueados nesta sessão.

Essas limitações não impedem a conclusão sobre caches de leitura, porque o eixo crítico é `repo-read.js -> public/io -> read-services -> io-cache/L2/read-chunks/read-text`, que foi lido integralmente.

## 3. Estrutura de `repo-read.js`

`repo-read.js` é uma tool surface MCP read-only com múltiplas tools:

- `repo_status`
- `repo_tree`
- `repo_root_tree`
- `repo_root_redaction_status`
- `repo_read_file`
- `repo_file_stats`
- `repo_read_file_chunks`
- `repo_diff_files`
- `repo_search_text`
- `repo_find_symbol_usages`
- `repo_symbol_search`
- `repo_file_outline`

### 3.1 Helpers e responsabilidades internas

O arquivo hoje mistura quatro responsabilidades:

1. **Normalização/formatting**
   - `normalizeOptionalRepoPath`
   - `escapeForRegex`
   - `parseUsageOutput`
   - `formatUsageMatches`
   - `countEntryTypes`
   - `scanHardLimitReached`

2. **Integração com cache MCP de leitura**
   - `readRepoFileWithValidatedResultCache`
   - `readRepoFileChunksWithValidatedResultCache`
   - cache real movido para `repo-read-cache.js`

3. **Output shaping**
   - `applyRepoReadHashMode`
   - `withResultSizeHint(...)`
   - `okResult(...)`

4. **Declaração das tools MCP**
   - array `repoReadTools` com schemas Zod, annotations e handlers.

O arquivo está funcional, mas já ficou grande o suficiente para justificar extração do cache para módulo separado.

## 4. Fluxo de `repo_read_file`

Fluxo real:

```text
MCP request
  -> resolveReadPath(path)
  -> valida startLine/endLine
  -> readRepoFileWithValidatedResultCache(resolved, startLine, endLine)
       -> monta key absoluta: absolutePath\0start\0end
       -> tenta cache MCP de resposta
          -> se trust window ativa e dentro da janela: retorna sem stat
          -> senão statPath() e compara size+mtime
          -> se válido: retorna structured/text cloneados
          -> se stale: remove
       -> se miss: readText(resolved.resolved, { startLine, endLine })
          -> IO L1/L2/full-file/FS
       -> monta structured com content, sha256, returnedSha256, bytes, linhas
       -> guarda no cache MCP
  -> applyRepoReadHashMode(...)
  -> okResult + result-size hint
```

### 4.1 Observação importante sobre `hashMode`

`hashMode` atua **só no output**. O cache MCP armazena a estrutura completa com `sha256` e `returnedSha256`. Isso é correto: evita multiplicar cache keys por modo de hash e permite que a mesma leitura seja retornada como `full`, `returned` ou `none` sem reler.

## 5. Fluxo de `repo_read_file_chunks`

Fluxo atual após as últimas mudanças:

```text
MCP request
  -> resolveReadPath(path)
  -> cursor -> effectiveStartLine
  -> valida endLine >= effectiveStartLine
  -> readRepoFileChunksWithValidatedResultCache(...)
       -> monta key absoluta: absolutePath\0chunks\0start\0end\0chunkLines\0highWaterMark
       -> tenta cache MCP de chunks
          -> trust window opcional
          -> senão statPath() e compara size+mtime
       -> se miss: readTextChunks(resolved.resolved, ...)
          -> stream via createReadStream/readTextLineChunks
       -> monta structured com chunks, nextCursor, linhas, bytes etc.
       -> guarda no cache MCP
  -> okResult + result-size hint
```

### 5.1 Relação com o cache IO

`readTextChunks` no IO declara `cacheFingerprintStrategy: 'stream-bypass'`. Ou seja: a API de chunks **não usa IO L1/L2**. Ela lê via stream e metadados. Portanto, o cache de chunks que foi adicionado em `repo-read.js` é o único cache de resposta para leituras chunked MCP.

Isso é coerente para o MCP, mas ainda não beneficia a tool local `read_file_content` quando usa `readStrategy=stream`, porque essa tool chama diretamente `readTextChunks` e não passa por `repo-read.js`.

## 6. Facade pública de IO

`src/copilot/infra/public/io.js` é a porta pública para consumidores fora de `infra`. Ela reexporta:

- mutações locked/atomic;
- `readBytes`;
- `readLines`;
- `readText`;
- `readTextChunks`;
- `readTextChunksStream`;
- `statPath`;
- `diffText`;
- `searchText`;
- `searchWorkspaceSymbols`;
- `warmReadThroughContext`;
- `scanDirectory`;
- `readIoRuntimeHealthSnapshot`.

`repo-read.js` usa essa facade, não os módulos internos diretamente. Isso é bom: a camada MCP não deve conhecer detalhes de `fs`/cache/L2.

## 7. IO `readText`: cache L1/L2 de arquivo completo

`readText(filePath, { startLine, endLine })` funciona assim:

1. Valida path via `assertValidIoFilePath`.
2. Normaliza path para key de cache.
3. Usa key **full-file**: `makeTextKey(normalizedPath, undefined, undefined)`.
4. Tenta L1 com `getVerifiedIoL1Entry`.
5. Se L1 hit, faz `split('\n')` e retorna apenas a janela pedida.
6. Se L1 miss, tenta L2 se habilitado.
7. Se L2 hit validado por stat, promove para L1 e retorna janela.
8. Se miss total, lê bytes do FS, valida UTF-8, cria string full-file, calcula hashes, armazena full-file em L1 e L2.

### 7.1 Implicação

O IO cache para texto **não cacheia a janela**. Ele cacheia o arquivo completo e recorta a janela a cada chamada.

Isso significa:

- Para arquivos pequenos/médios, o IO L1 já resolve muito do custo de I/O físico.
- Para arquivos grandes, cada hit ainda faz `split('\n')`, que pode custar CPU/memória.
- O cache MCP de `repo_read_file` evita essa repetição quando a mesma janela é solicitada de novo, porque guarda o output já recortado.

## 8. IO `readTextChunks`: stream bypass

`readTextChunks` usa `readTextLineChunks`, que por sua vez usa `createReadStream`, `StringDecoder` e um generator de chunks de linhas.

Características:

- Não usa L1/L2.
- Lê por stream.
- Pode parar quando atinge `endLine`.
- Retorna `chunks`, `returnedLineCount`, `lastScannedLine`, `totalLinesKnown`, `fileTotalLinesKnown`.
- Define `cacheFingerprintStrategy: 'stream-bypass'`.

### 8.1 Implicação

Antes do cache MCP de chunks, leituras repetidas da mesma janela sempre faziam stream novamente. Agora o MCP evita isso para chamadas repetidas dentro do mesmo processo, desde que o stat confirme `size+mtime`.

## 9. IO L1 em memória

`io-cache.js` implementa L1:

- Singleton por processo.
- Backend `lru-cache`.
- TTL padrão: `60_000ms` via `IO_L1_CACHE_TTL_MS`.
- Máximo de entradas: `2_000` via `IO_L1_CACHE_MAX_ENTRIES`.
- Máximo de bytes: `128 MiB` via `IO_L1_CACHE_MAX_BYTES`.
- Stale probe: `2_000ms` via `IO_L1_STALE_PROBE_INTERVAL_MS`.
- Revalidação por hash: até `1 MiB` via `IO_L1_HASH_REVALIDATE_MAX_BYTES`.

### 9.1 Validação

`getVerifiedIoL1Entry(key, filePath)`:

- retorna sem stat se dentro do stale probe interval;
- fora da janela, faz `stat`;
- compara `mtime+size`;
- se divergiu, pode revalidar por hash se tamanho igual e arquivo pequeno;
- se divergiu de fato, invalida a entrada.

### 9.2 Invalidação

`invalidateIoCachePath` e `invalidateIoCacheSubtree` removem keys prefixadas por path normalizado e publicam evento no bus de invalidação.

## 10. IO L2 SQLite

`io-cache-l2-registry.js` habilita L2 somente se:

```text
IO_L2_CACHE_ENABLED=1
```

Quando habilitado:

- cria cache SQLite via `createIoL2SqliteCache`;
- TTL padrão: 5 minutos;
- max entries padrão: 100.000;
- faz prune periódico;
- tem circuit breaker para falhas de inicialização.

`io-cache-l2-sqlite.js` guarda:

- key;
- file_path;
- kind (`bytes`, `text`, `json`);
- payload BLOB;
- size;
- mtime/ctime;
- meta_json;
- expires_at_ms;
- last_accessed_ms.

### 10.1 Relação com L1

Em `readText`/`readBytes`, L2 é consultado após L1 miss. Se o L2 hit passa na validação de stat, ele promove a entrada para L1.

## 11. Invalidação de IO

A invalidação IO tem duas camadas:

1. `invalidateIoCachePath` / `invalidateIoCacheSubtree` no L1.
2. `invalidateIoCacheTiers` / `invalidateIoCacheTierSubtrees`, que tentam invalidar L1 e L2.

O bus (`io/invalidation/bus.js`) permite hooks best-effort. O parser usa esse mecanismo para invalidar `_symbolCache`.

### 11.1 Diferença importante

O cache MCP de `repo-read.js` **não está inscrito** no bus IO. Ele é invalidado diretamente por `repo-write.js` chamando `clearRepoReadFileResultCacheForResolvedPath`.

Isso é suficiente para mutações feitas pelas MCP write tools, mas não é uma integração global. Para mutações externas, o cache MCP depende de stat validation por chamada.

## 12. Parser cache

`io-parser.js` tem `_symbolCache`:

- LRUCache;
- max 500 entradas;
- TTL 5 minutos;
- invalidado por hook registrado no IO invalidation bus;
- usado por `parseAndCacheSymbols(filePath)`.

Mas `repo_file_outline` faz:

```text
readText(...)
parseFileForContext(filePath, snapshot.content)
```

`parseFileForContext` chama `parseFileSymbols(filePath, content)` diretamente e **não usa `_symbolCache`**. Isso evita cachear parse de conteúdo que já foi passado explicitamente, mas perde benefício em chamadas repetidas de outline.

## 13. Search/index não é o mesmo cache

`repo_search_text` e `repo_symbol_search` usam `searchText`/`searchWorkspaceSymbols`.

`searchText` usa, em ordem:

1. índice FTS se a query for compatível e o índice estiver fresco;
2. otimização para regex alternation simples via índice;
3. fallback para `rg`;
4. fallback para `grep`.

Esse índice é aceleração de busca, não cache de leitura. Ele guarda conteúdo derivado/snippets/símbolos e tem semântica própria de freshness.

Há também cache booleano de disponibilidade de `rg` em `subprocess.js`.

## 14. Scanner de diretório

`scanDirectory`:

- valida path;
- respeita hidden, denylist, gitignore, include/exclude;
- usa concorrência e batches;
- pode gerar fingerprint por arquivo;
- aplica hard max entries;
- publica eventos de observabilidade.

Não é cache de leitura. É traversal observável e pode alimentar outros mecanismos como índice/prefetch.

## 15. Tool local análoga: `read_file_content`

A tool local fora do MCP é:

```text
src/copilot/tools/file/read/read-file-content.js
```

Ela é mais orientada a UX/LLM-B local do que a MCP connector.

### 15.1 Recursos

- `encoding=utf8|base64`
- `readStrategy=cached|stream`
- `startLine`, `endLine`, `cursor`, `maxLines`, `maxBytes`
- `includeMetadata`
- `includeHash`
- `includeReadThrough`
- `includeCacheStats`
- sanitização de output
- truncamento por policy
- terminal summary / presentation
- failure feedback estruturado

### 15.2 Fluxo `readStrategy=cached`

```text
read_file_content
  -> validatePath(...)
  -> fsStat
  -> readText(...) ou readBytes(...)
       -> IO L1/L2 ou FS
  -> opcional warmReadThroughContext
  -> sanitize/truncate
  -> metadata + terminalSummary + withIoMeta
```

### 15.3 Fluxo `readStrategy=stream`

```text
read_file_content
  -> validatePath(...)
  -> fsStat
  -> readTextChunks(...)
       -> stream-bypass, sem IO L1/L2
  -> junta chunks em texto
  -> sanitize/truncate
  -> metadata + terminalSummary + withIoMeta
```

A tool local não conhece o cache MCP de `repo_read_file_chunks`. Portanto, o ganho de cache chunked feito no MCP não acelera `read_file_content(readStrategy=stream)`.

## 16. Read-through / prefetch

`io-prefetch.js` aquece L1 diretamente.

`read_file_content` chama `warmReadThroughContext` quando:

- `readStrategy=cached`;
- `includeReadThrough !== false`;
- arquivo tem pelo menos 1024 bytes.

`warmReadThroughContext`:

- lê o arquivo por porta baixa;
- primeia L1 text e bytes;
- pode indexar texto se índice disponível;
- pode parsear imports e aquecer arquivos relacionados.

Isso é prefetch, não cache separado.

## 17. Mapa comparativo dos caches

| Camada | Onde fica | O que guarda | Chave | Validação | Invalidação | Consumidores |
|---|---|---|---|---|---|---|
| MCP file cache | `repo-read.js` | `structured + text` de `repo_read_file` | absolute path + start/end | stat size+mtime ou trust window | chamada direta por `repo-write.js` | MCP `repo_read_file` |
| MCP chunk cache | `repo-read.js` | `structured + text` de `repo_read_file_chunks` | absolute path + start/end/chunkLines/highWaterMark | stat size+mtime ou trust window | chamada direta por `repo-write.js` | MCP `repo_read_file_chunks` |
| IO L1 | `io-cache.js` | bytes ou texto completo | normalized path + `read:bytes`/`read:text` | TTL + stale probe + stat + hash opcional | IO cache invalidation | `readText`, `readBytes`, local/MCP callers |
| IO L2 | `io-cache-l2-*` | bytes/texto completo persistido | mesma key lógica | stat size+mtime | invalidatePath + prune | `readText`, `readBytes` se habilitado |
| Parser cache | `io-parser.js` | símbolos/imports/exports | path normalizado | TTL 5 min | IO invalidation hook | `parseAndCacheSymbols`, prefetch/index flows |
| Index FTS/symbol | `io-index-*` | conteúdo derivado para busca | SQLite/index rows | freshness própria | index invalidation/build | `searchText`, `searchWorkspaceSymbols` |
| Search subprocess cache | `subprocess.js` | disponibilidade de `rg` | singleton boolean | reset/test only | reset manual/test | search fallback |
| Prefetch/session scope | `io-prefetch.js` | aquece L1 e relacionados | paths/session ids | usa L1 verification | escopo/session end | local `read_file_content`, session tools |

## 18. Delimitação crítica: MCP cache vs IO cache

O cache MCP é redundante em alguns casos, mas não duplicado semanticamente:

- IO L1/L2 reduz leitura física e mantém conteúdo completo.
- MCP cache reduz reconstrução de payload e reuso de janela/chunks já montados.

Em `repo_read_file`, quando IO L1 acerta, ainda há custo de:

- split do texto completo;
- slice de linhas;
- hashing do trecho retornado;
- reconstrução de response.

O cache MCP evita esse custo para a mesma janela.

Em `repo_read_file_chunks`, IO não cacheia. O cache MCP é a única camada que evita repetir stream para a mesma janela.

## 19. Riscos atuais

### 19.1 Cache MCP não participa do bus de invalidação IO

As write tools MCP limpam o cache MCP diretamente. Isso é suficiente para escritas MCP, mas não cobre mutações externas sem depender de stat.

Risco baixo com `COPILOT_MCP_REPO_READ_TRUST_WINDOW_MS=0`, porque todo hit valida stat. Risco maior se operador habilitar trust window e houver mutações externas dentro dessa janela.

### 19.2 `repo_file_outline` não usa parser cache

Chamadas repetidas de outline para o mesmo conteúdo podem reparsar. O IO cache evita reler o arquivo, mas não evita parse.

### 19.3 Cache stats misturam file/chunk

`repoReadFileResultCacheStats` agora contém campos de file e chunk. Funciona, mas o nome ficou impreciso e a telemetria pode ficar confusa.

### 19.4 `read_file_content(stream)` não aproveita chunk cache MCP

A tool local `read_file_content` em stream continua bypassando IO L1/L2 e também não usa o cache MCP.

### 19.5 Caches têm políticas de validação diferentes

- MCP cache valida por stat em toda chamada, salvo trust window.
- IO L1 valida por stale probe interval.
- IO L2 valida por stat em hit.
- Parser cache usa TTL e invalidation hook.
- Index depende de freshness própria.

Isso é aceitável, mas precisa estar documentado para evitar confusão operacional.

## 20. Recomendações

### P0 — Documentação e estabilização

- Manter este documento como referência arquitetural.
- Expor no runtime health os campos de cache MCP file/chunk separados.
- Renomear internamente `repoReadFileResultCacheStats` para algo como `repoReadCacheStats`.

### P1 — Extrair cache MCP para módulo próprio

Criar:

```text
src/copilot/mcp/tools/repo-read-cache.js
```

Responsabilidades:

- Maps de file/chunk cache;
- key builders;
- stat validation;
- trust window;
- stats;
- clear by resolved path;
- clone safe.

Benefícios:

- `repo-read.js` volta a ser tool declaration + handlers;
- fica mais fácil testar cache isoladamente;
- abre caminho para integração com invalidation bus.

### P2 — Integrar cache MCP ao bus de invalidação IO

Em vez de depender apenas de import direto de `repo-write.js`, registrar hook no bus de invalidação do IO.

Cuidado: evitar acoplamento circular. Idealmente o novo `repo-read-cache.js` importaria uma facade pública de invalidation ou receberia função de registro em bootstrap.

### P3 — Implementar cache/offset de linhas em IO

P3 foi implementado como cache de **line offsets** por fingerprint em:

```text
src/copilot/infra/io/fs/line-offset-cache.js
```

O cache guarda apenas metadados derivados do texto já validado:

```text
key: path + sizeBytes + mtimeMs + textLength
value: starts[] + totalLines
```

Ele não guarda conteúdo do arquivo. O conteúdo continua vindo do IO L1/L2/FS.

`readText` agora usa `sliceTextByCachedLineOffsets(...)` nos três caminhos quentes:

- L1 text hit;
- L2 text hit;
- FS read/miss.

Com isso, leituras repetidas de janelas diferentes no mesmo arquivo evitam `text.split('\n')` completo a cada chamada. A primeira janela monta os offsets; as seguintes fazem slicing por índices de caracteres.

O cache também:

- tem LRU bounded por `IO_LINE_OFFSET_CACHE_MAX_ENTRIES`;
- pode ser desativado por `IO_LINE_OFFSET_CACHE_ENABLED=0|false|off|disabled`;
- ignora textos acima de `IO_LINE_OFFSET_CACHE_MAX_TEXT_CHARS`;
- expõe stats por `getLineOffsetCacheStats()`;
- aparece em `readIoRuntimeHealthSnapshot().cache.lineOffsets`;
- aparece no MCP em `mcp_runtime_health.metrics.ioCache.lineOffsets`;
- registra hook no bus de invalidação IO;
- limpa offsets quando `invalidateIoCachePath` ou eventos recursivos são publicados.

Limitação deliberada: `readTextChunks` continua stream-bypass. P3 otimiza `readText`/janelas de texto completo; salto por offsets de byte em stream fica para uma P3.2 futura, porque envolve UTF-8 byte offsets e semântica diferente.

#### Fechamento P3.1

P3.1 consolidou a frente com observabilidade e kill-switch:

- `mcp_runtime_health` passou a incluir `metrics.ioCache.lineOffsets`.
- O teste de runtime health garante que `lineOffsets.size` existe no payload MCP.
- `IO_LINE_OFFSET_CACHE_ENABLED=0|false|off|disabled` força bypass e preserva semântica antiga.
- Os testes de infra cobrem equivalência com split, hit, invalidação por bus, bypass por fingerprint inválido e kill-switch operacional.

### P4 — Cache de `FileContext` para `repo_file_outline`

P4 foi implementado pela opção 2: cache de `FileContext` por path+hash de conteúdo dentro de `io-parser.js`.

O desenho preserva a separação conceitual:

```text
_symbolCache        -> FileSymbols usado por parseAndCacheSymbols
_fileContextCache   -> FileContext completo: symbols + outline + topComments
```

`parseFileForContext(filePath, content)` agora:

1. normaliza o path;
2. gera hash SHA-256 do conteúdo recebido;
3. consulta `_fileContextCache` por `path + content.length + hash`;
4. retorna cache hit quando possível;
5. em miss, chama `parseFileSymbols`, `buildOutline` e `extractTopComments`, depois guarda o contexto.

Hardening operacional:

- `IO_PARSER_FILE_CONTEXT_CACHE_ENABLED=0|false|off|disabled` força bypass.
- `IO_PARSER_FILE_CONTEXT_CACHE_MAX_ENTRIES` ajusta o LRU.
- `IO_PARSER_FILE_CONTEXT_CACHE_TTL_MS` ajusta TTL.
- `invalidateParserCache(filePath)` limpa símbolos e contextos daquele path.
- O hook de invalidação IO limpa `_fileContextCache` junto com `_symbolCache`.
- `getParserCacheStats()` expõe `fileContext.{enabled,size,maxSize,hits,misses,sets,clears,bypasses}`.
- `mcp_runtime_health` expõe essa telemetria em `metrics.ioParser.fileContext`.

Testes adicionados/atualizados:

- cache hit de `parseFileForContext` para mesmo path+conteúdo;
- invalidação por `invalidateParserCache`;
- kill-switch de file-context cache;
- runtime health garante `metrics.ioParser.fileContext.size`.

### P5 — Unificar telemetria

`mcp_runtime_health` deveria apresentar:

- IO L1/L2 stats;
- parser cache;
- index status;
- MCP repo read file/chunk cache;
- local read-through/session scopes.

Hoje parte disso já existe, mas o mapa conceitual ainda fica espalhado.

## 21. O que não fazer

- Não ativar `COPILOT_MCP_REPO_READ_TRUST_WINDOW_MS` por default acima de 0.
- Não cachear `/mcp` no Cloudflare.
- Não remover validação por path/policy.
- Não transformar `readTextChunks` em full-file read por default; isso derrotaria o propósito do stream para arquivos grandes.
- Não misturar parser cache com content cache: são entidades distintas.
- Não fazer cache persistente de payload MCP sem revisar proteção de paths e dados sensíveis.

## 22. P1 implementado: extração do cache MCP

P1 foi implementado após a investigação:

```text
src/copilot/mcp/tools/repo-read-cache.js
```

Foram movidos para o novo módulo:

- `REPO_READ_FILE_CACHE_MAX_ENTRIES`
- `repoReadFileResultCache`
- `repoReadFileChunkCache`
- stats internas de cache, agora como `repoReadCacheStats`
- `readRepoReadFileResultCacheStats`
- `clearRepoReadFileResultCacheForResolvedPath`
- `readRepoFileWithValidatedResultCache`
- `readRepoFileChunksWithValidatedResultCache`
- key builders de file/chunk cache
- `readRepoReadTrustWindowMs`
- remember/trim helpers
- clone seguro de structured result

A extração removeu dois acoplamentos ruins:

- `runtime-health.js` agora importa stats de `./repo-read-cache.js`, não de `./repo-read.js`.
- `repo-write.js` agora importa invalidação de `./repo-read-cache.js`, não de `./repo-read.js`.

Resultado arquitetural:

```text
repo-read.js        -> handlers MCP e shaping de output
repo-read-cache.js  -> cache de resposta MCP, stats e invalidação por path
repo-write.js       -> invalida cache via módulo dedicado
runtime-health.js   -> observa stats via módulo dedicado
```

Foram adicionados testes para provar que o módulo extraído atende aos dois caminhos principais:

- `repo_read_file`: primeira chamada gera `miss/set`, segunda chamada gera `hit`.
- `repo_read_file_chunks`: primeira chamada gera `chunkMiss/chunkSet`, segunda chamada gera `chunkHit`.

## 23. P2 implementado: integração com o bus de invalidação IO

P2 também foi implementado após a extração:

- `repo-read-cache.js` registra um hook idempotente com `registerIoInvalidationHook`.
- Eventos de `invalidateIoCachePath(path)` agora limpam as entradas MCP do path exato.
- Eventos recursivos limpam path exato e subtree.
- A telemetria ganhou `busInvalidations` e `recursiveInvalidations`.
- `resetRepoReadResponseCacheForTest()` unregister/re-registra o hook para manter isolamento nos testes.

Isso reduz o acoplamento manual: além das chamadas diretas de `repo-write.js`, qualquer mutação canônica que publique no bus IO passa a invalidar também o cache de resposta MCP.

Foram adicionados testes que aquecem o cache MCP e depois chamam `invalidateIoCachePath(...)`, verificando que:

- entradas de `repo_read_file` são limpas via bus;
- entradas de `repo_read_file_chunks` são limpas via bus;
- `busInvalidations` é incrementado.

## 24. Conclusão geral e fechamento P1-P4

A frente P1/P2/P3/P4 está validada em `mcp-full` para o escopo MCP:

```text
suite-mcp-full: passed
checks: typecheck, lint, unit-mcp
```

Validações adicionais executadas durante o fechamento:

- `typecheck` isolado passou após P3, após a exposição de `ioCache.lineOffsets` no runtime health e após P4.
- `lint` isolado passou após P3.
- `unit-copilot` completo ainda possui duas falhas pré-existentes de terminal/barrel governance e SDK consumer migration; as falhas introduzidas pelos novos testes de line-offset/FileContext foram corrigidas ou não reapareceram nas rodadas posteriores.

### Estado final do desenho

```text
IO L1/L2                 -> conteúdo completo validado por stat/hash/TTL
line-offset-cache        -> offsets derivados do conteúdo validado, sem armazenar conteúdo
repo-read-cache          -> payload MCP já estruturado para repo_read_file/repo_read_file_chunks
_symbolCache             -> símbolos parseados para parseAndCacheSymbols
_fileContextCache        -> symbols + outline + topComments por path+hash de conteúdo
mcp_runtime_health       -> expõe repoReadFileCache + ioCache.lineOffsets + ioParser.fileContext
IO invalidation bus      -> invalida parser cache, FileContext cache, repo-read-cache e line-offset-cache
```

### Mapa final de variáveis operacionais

| Variável | Camada | Padrão | Efeito |
|---|---|---:|---|
| `COPILOT_MCP_REPO_READ_TRUST_WINDOW_MS` | MCP repo-read-cache | `0` | Permite hits sem stat por janela curta. Mantido em zero por segurança. |
| `IO_LINE_OFFSET_CACHE_ENABLED` | IO line offsets | `1` | `0/false/off/disabled` força bypass e volta ao slicing antigo por split. |
| `IO_LINE_OFFSET_CACHE_MAX_ENTRIES` | IO line offsets | `256` | Limite LRU de entradas de offsets. |
| `IO_LINE_OFFSET_CACHE_MAX_TEXT_CHARS` | IO line offsets | `2000000` | Limite defensivo para não indexar texto muito grande. |
| `IO_PARSER_FILE_CONTEXT_CACHE_ENABLED` | Parser FileContext | `1` | `0/false/off/disabled` força bypass do cache de contexto. |
| `IO_PARSER_FILE_CONTEXT_CACHE_MAX_ENTRIES` | Parser FileContext | `256` | Limite LRU de contextos. |
| `IO_PARSER_FILE_CONTEXT_CACHE_TTL_MS` | Parser FileContext | `300000` | TTL do cache de contexto. |

### Ganhos concretos

- `repo_read_file` ganhou cache de resposta MCP e redução de custo de recomputar payload.
- `repo_read_file_chunks` ganhou cache MCP próprio, já que o IO chunked continua stream-bypass.
- `readText` ganhou cache de offsets para evitar `split('\n')` completo repetido em janelas do mesmo arquivo.
- `repo_file_outline`/`parseFileForContext` ganhou cache de FileContext por hash de conteúdo.
- Invalidação ficou coordenada pelo bus IO, reduzindo risco de cache obsoleto após mutações canônicas.
- Observabilidade ficou consolidada em `mcp_runtime_health`.
- Todos os novos caches relevantes têm kill-switch operacional.

### Riscos remanescentes

- O cache MCP ainda é process-local; restart limpa tudo, o que é aceitável para segurança e simplicidade.
- `readTextChunks` ainda não usa byte-offset seek; continua stream-bypass por desenho.
- O FileContext cache usa SHA-256 do conteúdo recebido; isso é seguro contra stale context, mas custa hashing em miss/check. O custo é menor que reparse repetido em cenários de outline recorrente.
- As falhas `unit-copilot` remanescentes são de terminal/barrel governance e SDK consumer migration, fora desta frente.

### Próximas frentes recomendadas

1. **P3.2 — byte-offset/seek para `readTextChunks`**: desenhar índice de byte offsets UTF-8-safe antes de implementar; não reaproveitar ingenuamente offsets de caracteres.
2. **P5 — telemetria unificada de caches**: painel/summary único com `repoReadFileCache`, `ioCache.lineOffsets`, `ioParser.fileContext`, IO L1/L2 e index stats.
3. **P6 — limpeza segura de `.ai/jobs`**: ferramenta bounded, reversível ou com allowlist estrita, preservando tokens/OAuth/Cloudflare.
4. **P7 — benchmark sintético**: medir latência antes/depois para `repo_read_file`, `repo_read_file_chunks` e `repo_file_outline` em arquivos pequenos, médios e grandes.
5. **P8 — resolver falhas antigas de terminal/barrel governance**: tratar W114.5/F151 em frente separada, sem misturar com MCP/IO caches.
