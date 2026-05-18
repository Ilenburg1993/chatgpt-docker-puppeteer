# Auditoria Técnica — Copilot SDK 0.3.0 + Node.js 24 ESM
**Data**: 16 de maio de 2026
**Escopo**: `src/copilot/infra/` · `src/copilot/tools/`
**Base**: SDK `@github/copilot-sdk@0.3.0` · Node.js 24 LTS · ESM puro

---

## Sumário Executivo

| Categoria |  Total | Crítico |   Alto |  Médio | Baixo |
| --------- | -----: | ------: | -----: | -----: | ----: |
| Bugs      |     19 |       3 |      6 |      7 |     3 |
| Gaps      |     15 |       2 |      5 |      6 |     2 |
| Upgrades  |     16 |       — |      5 |      7 |     4 |
| **Total** | **50** |   **5** | **16** | **20** | **9** |

---

## Parte 1 — Bugs

### BUG-01 · **[CRÍTICO]** Iteração sobre `_lru.keys()` com deleção simultânea em `io-cache.js`

**Arquivo**: `src/copilot/infra/io-cache.js` · método `invalidate`

```js
// Código atual — INSEGURO
for (const k of _lru.keys()) {
    if (k.startsWith(prefix) || (options.recursive === true && k.startsWith(subtreePrefix))) {
        _lru.delete(k);   // ← deleção durante iteração do mesmo iterador
        _invalidations++;
    }
}
```

Iterar e deletar concorrentemente do mesmo iterador é comportamento não especificado pela implementação interna do `lru-cache`. Dependendo da versão e do modo de iteração, entradas podem ser puladas ou visitadas duas vezes. O risco é real pois `invalidate` é chamado diretamente pelo `io-engine` após cada escrita.

**Correção**:
```js
const keysToDelete = [];
for (const k of _lru.keys()) {
    if (k.startsWith(prefix) || (options.recursive === true && k.startsWith(subtreePrefix))) {
        keysToDelete.push(k);
    }
}
for (const k of keysToDelete) {
    _lru.delete(k);
    _invalidations++;
}
```

---

### BUG-02 · **[CRÍTICO]** `toBufferView` armazena views não-owning em `subprocess.js`

**Arquivo**: `src/copilot/infra/io/search/subprocess.js` · função `collect`

```js
const buffer =
    typeof chunk === 'string'
        ? toOwnedBuffer(chunk)
        : toBufferView(           // ← cria view sem cópia
              chunk,
          );
// ...
stdoutChunks.push(buffer);        // ← view armazenada; pode ser reciclada pelo stream
```

`toBufferView` cria um `Buffer` que aponta para a mesma memória do chunk original. O runtime do Node.js (via libuv) pode reutilizar o backing buffer do chunk assim que o evento `data` terminar, corrompendo silenciosamente `stdoutChunks`. Isso afeta qualquer busca que use `rg` ou `grep` através de `execSearchFile`.

**Correção**:
```js
const buffer = toOwnedBuffer(
    typeof chunk === 'string' ? chunk : chunk,
);
```
Ou de forma mais explícita: substituir `toBufferView` por `toOwnedBuffer` na função `collect`.

---

### BUG-03 · **[CRÍTICO]** Race condition em `warmReadThroughContext`: `readTextFileSnapshot` + `fsStat` desacoplados

**Arquivo**: `src/copilot/infra/io-prefetch.js` · função `warmReadThroughContext`

```js
const text = await readTextFileSnapshot(filePath);       // leitura em T1
// ... processamento ...
const stats = await fsStat(filePath).catch(() => null);  // stat em T2 (arquivo pode ter mudado)
if (indexStore && stats) {
    await indexStore.indexTextFile({
        filePath,
        content: text.content,   // conteúdo de T1
        sizeBytes: stats.size,   // tamanho de T2 — inconsistente!
        mtimeMs: stats.mtimeMs,  // mtime de T2 — inconsistente!
    });
}
```

Se o arquivo for modificado entre T1 e T2, o índice persiste `content` desatualizado com `mtimeMs`/`sizeBytes` do estado novo. O comparador de fingerprint vai considerar o arquivo fresco quando, na verdade, o conteúdo do índice é stale. Isso afeta `workspace_index_build` e todas as buscas FTS5 subsequentes.

**Correção**: usar `text.mtimeMs` e `text.sizeBytes` retornados pelo próprio `readTextFileSnapshot`, eliminando o segundo `fsStat`.

---

### BUG-04 · **[ALTO]** `_storeMutex` do todo store não protege `readStore` (leituras ruidosas)

**Arquivo**: `src/copilot/tools/todo/store.js`

A função `readStore` chama `_readStoreRaw()` diretamente, **sem** entrar no mutex serial. Se uma operação de escrita via `withStore` estiver a meio caminho de `_writeStoreRaw`, uma leitura concorrente via `readStore` pode enxergar um estado parcial — especialmente quando a transação SQLite ainda não foi comitada (a camada `db.transaction()` é síncrona, mas o JavaScript pode interleaved por microtasks se houver `await` antes do commit).

**Correção**: `readStore` deve adquirir o mutex em modo read-only, ou a implementação deve confiar exclusivamente no isolamento transacional do SQLite com `PRAGMA read_uncommitted = false` (padrão).

---

### BUG-05 · **[ALTO]** `capSizeIfNeeded` no L2 cache gera N+1 queries por escrita

**Arquivo**: `src/copilot/infra/io-cache-l2-sqlite.js` · método `set`

```js
set(input) {
    stmtSet.run(...);            // INSERT/UPDATE
    stats.sets += 1;
    capSizeIfNeeded();           // ← SELECT COUNT(*) + DELETE a cada set()
    return true;
}
```

`capSizeIfNeeded` executa sempre um `SELECT COUNT(*)` e potencialmente um `DELETE` com subquery. Em cenários de warm-up de diretório com milhares de arquivos, isso multiplica a carga sobre SQLite de forma quadrática. O L2 foi projetado para cenários de miss de L1, mas essa implementação degradaria qualquer build de índice que popule o L2.

**Correção**: aplicar o check de capacidade apenas a cada N operações (e.g., `stats.sets % 100 === 0`) ou mediante um TTL em tempo absoluto.

---

### BUG-06 · **[ALTO]** Accumulo de callbacks no `setInterval` de limpeza de `io-locks.js`

**Arquivo**: `src/copilot/infra/io-locks.js`

```js
setInterval(() => {
    for (const [key, tail] of tails.entries()) {
        void tail.finally(() => {           // ← novo .finally() a cada 60s por entrada
            if (tails.get(key) === tail) {
                tails.delete(key);
            }
        });
    }
}, 60_000).unref?.();
```

Para cada entrada no mapa `tails`, a cada 60 segundos é adicionado um novo callback `.finally()` à mesma Promise. Se uma Promise de lock ficar pendente por 10 minutos, ela acumulará 10 callbacks `.finally()` que nunca removem a entrada — apenas criam closures extras que impedem GC. Em sessões longas com alto volume de operações bloqueadas, isso constitui um memory leak.

**Correção**: substituir o `setInterval` por limpeza on-demand (após `release()`), que já está corretamente implementada em `scheduleTailCleanup`. O `setInterval` é redundante e prejudicial.

---

### BUG-07 · **[ALTO]** `declareScope` sobrescreve scope ativo sem aguardar o warm em andamento

**Arquivo**: `src/copilot/infra/io-session-scope.js` · função `declareScope`

```js
_registry.set(sessionId, scope);          // substitui imediatamente
// ...
const warmPromise = (async () => { ... })();
_warmPromises.set(sessionId, warmPromise); // substitui a promise anterior
```

Se `declareScope` for chamada duas vezes com o mesmo `sessionId` (re-declaração de escopo após edição de arquivos), a primeira `warmPromise` continua executando em background, mas sua referência é perdida. Quando ela escreve em `scope.preloaded`, `scope.failed` etc., ela está mutando o objeto **antigo** de escopo (já descartado do registry). Resultado: o novo escopo aparece com contadores zerados enquanto o aquecimento real continua em segundo plano sem ser observável.

**Correção**: cancelar (ou aguardar) a warmPromise existente antes de registrar um novo scope com o mesmo ID.

---

### BUG-08 · **[ALTO]** Lógica invertida em `buildIoCacheTierPlan` para recomendação de L2

**Arquivo**: `src/copilot/infra/io-cache-tiering.js`

```js
if (!l2Enabled && readHotsetRatio < 0.1) {
    recommendations.push('Keep L2 disabled until hotset/read patterns stabilize.');
}
```

Um `readHotsetRatio` baixo (< 10%) significa que poucas leituras estão sendo satisfeitas pelo cache — exatamente quando o L2 **mais ajudaria** a preencher lacunas de L1. A recomendação deveria ser o oposto: investigar por que o hit-ratio está baixo ou considerar habilitar L2 para aumentar cobertura.

**Correção**: inverter a condição ou separar a semântica (hit-ratio baixo pode indicar tanto cache subdimensionado quanto workload frio).

---

### BUG-09 · **[ALTO]** `pruneMissingRows` silencia poda quando `include`/`exclude` presentes, mas também quando `pruneMissing: false` explícito

**Arquivo**: `src/copilot/infra/io-index-sqlite.js`

```js
const maySafelyPrune =
    (options.include?.length ?? 0) === 0 &&
    (options.exclude?.length ?? 0) === 0 &&
    options.pruneMissing !== false;
```

A lógica é correta, mas a tool `workspace_index_build` em `index-tools.js` não expõe `pruneMissing` ao usuário quando `include`/`exclude` estão presentes. Isso significa que o usuário **não pode forçar poda** mesmo em builds onde sabe que a fatia é completa. O parâmetro `pruneMissing` está no schema Zod mas a condição interna ignora-o quando `include.length > 0`.

**Correção**: desacoplar as duas condições — `include`/`exclude` devem avisar (não bloquear) e `pruneMissing` deve ser o controle autoritativo.

---

### BUG-10 · **[MÉDIO]** `sanitizeFtsQuery` rejeita tokens com menos de 2 caracteres, quebrando buscas por siglas e operadores curtos

**Arquivo**: `src/copilot/infra/index-store/sqlite/query.js`

```js
.filter((token) => token.length >= 2)
```

Buscas por termos como `"fs"`, `"db"`, `"io"`, `"id"` retornam `""` (query vazia), que produz resultados incoerentes (FTS5 retorna todas as linhas ou nenhuma dependendo da versão do SQLite). Esses são exatamente os termos mais comuns em um codebase Node.js.

**Correção**: reduzir o mínimo para 1 caractere, ou preservar tokens curtos que sejam alphanumericamente válidos e com length ≥ 1.

---

### BUG-11 · **[MÉDIO]** `io-parser.js` inicializa hook de invalidação no module-load com efeito colateral permanente

**Arquivo**: `src/copilot/infra/io-parser.js`

```js
ensureInvalidationHook();  // chamado no topo do módulo
```

`ensureInvalidationHook` registra um hook no bus de invalidação global. Em ambientes de teste onde o módulo é importado múltiplas vezes (via `vi.resetModules()`), o hook pode ser registrado múltiplas vezes se o `_parserInvalidationUnregister` for zerado entre testes mas o módulo não for completamente descartado. `resetParserCacheForTest` deregistra o hook, mas se não for chamado, os hooks se acumulam.

**Correção**: o hook deve ser registrado lazily na primeira chamada de `parseFileSymbols` ou `parseAndCacheSymbols`, e `resetParserCacheForTest` deve ser chamado explicitamente nos setups de teste.

---

### BUG-12 · **[MÉDIO]** `buildToolsModuleScorecard` e `buildInfraModuleScorecard` não refletem adição de novos módulos

**Arquivos**: `module-map.js` (infra e tools)

Os inventários `INFRA_MODULE_LAYOUT` e `TOOLS_MODULE_LAYOUT` são arrays estáticos. Qualquer novo arquivo ou diretório adicionado ao subsistema deve ser manualmente inserido neles. O gate arquitetural `test_infra_barrel_governance.spec.js` verifica cobertura, mas apenas em CI. Em desenvolvimento ativo, há uma janela de discrepância entre o filesystem e o mapa.

**Recomendação**: o script de scorecard deve ler o filesystem e comparar com o inventário em runtime, emitindo warnings observáveis quando a cobertura cair.

---

### BUG-13 · **[MÉDIO]** `checkRateLimit` em `web-tools.js` não é thread-safe em worker_threads

**Arquivo**: `src/copilot/tools/web/web-tools.js`

```js
const RATE_WINDOW = new Map();  // estado de módulo compartilhado por instância ESM
```

Se o runtime executar múltiplos worker threads que importem o mesmo módulo, cada worker terá seu próprio `RATE_WINDOW` (ESM modules são por-worker). O rate limit efetivo seria `perMinute * numWorkers`, não `perMinute` global. Isso não é um bug no modelo single-process atual, mas é uma armadilha documentada para quem escalar via `node:cluster` ou `node:worker_threads`.

**Recomendação**: documentar explicitamente o comportamento por-processo ou implementar rate limit via `SharedArrayBuffer`.

---

### BUG-14 · **[MÉDIO]** `resolveRelativeImportTargets` em `io-prefetch.js` não deduplica chamadas `fsStat`

**Arquivo**: `src/copilot/infra/io-prefetch.js`

```js
const IMPORT_EXTENSIONS = ['', '.js', '.mjs', '.cjs', '.jsx', '.ts', ...];
// Para cada import, gera ~20 candidatos e faz stat() em cada um:
const candidates = IMPORT_EXTENSIONS.flatMap((ext) => [
    `${raw}${ext}`,
    path.join(raw, `index${ext || '.js'}`),
]);
for (const candidate of candidates) {
    const stat = await fsStat(candidate).catch(() => null);
```

Para um arquivo com 20 imports relativos, isso gera até 400 chamadas `fsStat` sequenciais. Não há cache de resultados de resolução nem `Promise.all` para paralelização.

**Correção**: paralelizar os candidates por import (não os imports entre si) e adicionar um cache de resolução por sessão.

---

### BUG-15 · **[MÉDIO]** `tokenizeShell` em `executor.js` não detecta `$()` subshell sem `(`

**Arquivo**: `src/copilot/tools/shell/executor.js`

```js
if (c === '$' && command[i + 1] === '(') return true; // subshell $()
```

Esta verificação já está em `hasShellMetaOutsideQuotes` em `sandbox.js`, **mas não** em `tokenizeShell`. O tokenizador divide `echo $(id)` como `['echo', '$(id)']` e passa pelo blocklist sem triggerar a proteção. O argumento `$(id)` é então passado diretamente ao `execFile` — que não executa shell expansion — então o risco de RCE é mitigado pelo uso de `execFile`, mas o comportamento confuso pode levar a falsos negativos nos logs de segurança.

---

### BUG-16 · **[BAIXO]** `AsyncQueue` em `queue/async-queue.js` ignora prioridades fora de `{0, 5, 10}`

**Arquivo**: `src/copilot/infra/queue/async-queue.js`

```js
const queue = this.#queues.get(normalizedPriority) ?? this.#queues.get(5);
```

Qualquer prioridade que não seja `0`, `5` ou `10` cai silenciosamente para `5` (normal). Um caller passando `priority = 3` esperaria alta prioridade mas receberia normal. O comportamento deveria ser documentado ou o mapa deveria ser dinâmico.

---

### BUG-17 · **[BAIXO]** `releaseLock` em `lockfile.js` usa `existsSync`/`lstatSync`/`readFileSync` síncronos no hot path

**Arquivo**: `src/copilot/infra/lockfile.js`

```js
export function releaseLock(lockPath) {
    try {
        if (!existsSync(lockPath)) return;
        if (lstatSync(lockPath).isSymbolicLink()) return;
        const pid = readLockOwnerPid(readFileSync(lockPath, 'utf-8'));
```

Três operações síncronas de filesystem em sequência. Como `releaseLock` é chamada em `finally` blocks e shutdown handlers, isso bloqueia o event loop durante cleanup. Num processo com muitos lockfiles, pode causar timeout de shutdown.

---

### BUG-18 · **[BAIXO]** `buildGrepArgs` não sanitiza `includePattern`/`excludePattern` contra injeção de argumento

**Arquivo**: `src/copilot/infra/io/search/grep-adapter.js`

```js
...(opts.includePattern ? [`--include=${opts.includePattern}`] : []),
```

Se `includePattern` contiver espaços ou caracteres como `;`, e o grep for invocado via `spawn` (que é o caso), o argumento é passado diretamente sem shell expansion — tornando a injeção inofensiva para RCE. Contudo, um `includePattern` como `*.js --include=*.json` criaria argumentos extras não intencionais. A validação `hasNullByte` no adapter de busca não detecta este caso.

---

### BUG-19 · **[BAIXO]** `countLines` em `index-store/sqlite/content.js` retorna `0` para string vazia mas `1` deveria ser o mínimo

**Arquivo**: `src/copilot/infra/index-store/sqlite/content.js`

```js
export function countLines(content) {
    if (content.length === 0) return 0;
    return content.split(/\r\n|\r|\n/u).length;
}
```

Um arquivo vazio tem 0 linhas — correto. Mas um arquivo de uma linha sem `\n` final retorna `1` (correto) enquanto a função em `io/patch/text-patch.js` usa `countLines` de forma diferente:

```js
function countLines(content) {
    return content.length === 0 ? 1 : content.split('\n').length;
}
```

Dois `countLines` com comportamento diferente para string vazia (`0` vs `1`) coexistem no mesmo codebase. O da `text-patch.js` usa `? 1` para que o delta de linhas nunca seja negativo em patches, enquanto o do `index-store` usa `? 0`. Isso causa inconsistência no campo `line_count` do índice vs. os deltas reportados pelo `patchTextLocked`.

---

## Parte 2 — Gaps

### GAP-01 · **[CRÍTICO]** Ausência de mutex/guard em `buildIoIndexForDirectory` permite corridas de escrita SQLite

**Arquivo**: `src/copilot/infra/io-index-sqlite.js`

A função `indexDirectory` pode ser chamada concorrentemente por múltiplas ferramentas (e.g., `workspace_index_build` chamada duas vezes em paralelo ou pelo `declareScope` + chamada direta). Internamente, cada arquivo usa `db.transaction(commit)()` individualmente, mas não há lock externo impedindo que dois processos de indexação deletem e re-insiram a mesma entrada simultaneamente (`clearFileRows` + `stmtUpsertFile` não é atômico com outra thread do mesmo processo).

**Recomendação**: adicionar um lock de processo via `withIoResourceLock` com chave derivada do `rootPath` antes de iniciar o loop de indexação.

---

### GAP-02 · **[CRÍTICO]** `declareScope` com `directory` popula índice L2 sem limite de tamanho observável

**Arquivo**: `src/copilot/infra/io-session-scope.js`

```js
if (directory && indexMode !== 'off') {
    const indexResult = await buildIoIndexForDirectory(directory, indexOptions);
```

Não há proteção contra a indexação acidental de `/` ou de um workspace com centenas de milhares de arquivos. A ferramenta `workspace_scope_declare` aceita qualquer `directory` válido. O parâmetro `maxFiles` é descrito como "advisory" e não limita a operação — o scanner vai até `depth: 20` por padrão.

**Recomendação**: implementar um limite hard de arquivos no scan de escopo (configurável via env) e retornar um advisory warning quando o limite for atingido.

---

### GAP-03 · **[ALTO]** Inexistência de paginação no `readStore` do todo store

**Arquivo**: `src/copilot/tools/todo/store.js`

```js
const rows = db.prepare('SELECT id, data FROM copilot_todo_tasks').all();
```

O store carrega **todos** os TODOs em memória a cada leitura. Com centenas ou milhares de tarefas (especialmente após `todo_import` em massa), isso cria pressão de memória e latência de desserialização proporcional. A paginação está implementada nas tools de query (`todo_list`, `todo_search`) mas acontece **depois** do carregamento total.

**Recomendação**: implementar paginação na camada SQL com `LIMIT`/`OFFSET` ou cursor por `id`, especialmente para `todoListTool` e `todoSearchTool`.

---

### GAP-04 · **[ALTO]** Falta de WAL mode no banco SQLite compartilhado

**Arquivo**: `src/copilot/infra/io-cache-l2-sqlite.js`, `io-index-sqlite.js`, `todo/store.js`

Todos os módulos usam o mesmo banco (`getCopilotDb()`). O SQLite no modo padrão (journal_mode=DELETE) serializa leitores e escritores, o que cria contenção severa quando o L2 cache, o índice FTS e o todo store operam simultaneamente. WAL mode permite leitores concorrentes com um único escritor e elimina a maioria das contenções.

**Recomendação**:
```js
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('wal_autocheckpoint = 1000');
```
Estes pragmas devem ser aplicados uma vez no setup do banco, em `getCopilotDb()`.

---

### GAP-05 · **[ALTO]** `web_fetch_local` não suporta `POST`/`PUT`, limitando casos de uso de API

**Arquivo**: `src/copilot/tools/web/web-tools.js`

A ferramenta está hardcoded para `method: 'GET'`. Quando o agente precisa interagir com APIs REST (webhooks, form posts, GraphQL), é forçado a usar `exec_command` com `curl`, contornando toda a proteção SSRF e o rate limiting da tool dedicada.

**Recomendação**: adicionar parâmetro `method` com enum `['GET', 'POST', 'PUT', 'PATCH']` e parâmetro `body` opcional, mantendo a validação SSRF existente.

---

### GAP-06 · **[ALTO]** Sem circuit breaker no `getIoL2Cache()` para falhas repetidas de inicialização

**Arquivo**: `src/copilot/infra/io-cache-l2-registry.js`

O circuit breaker existente (`_circuitOpenUntilMs`) abre apenas após `MAX_INIT_FAILURES = 3` falhas consecutivas. O backoff usa `[1000, 5000, 30000]` ms. Em ambientes com SQLite corrompido ou permissões incorretas, o processo vai tentar inicializar o L2 três vezes com falha, depois entrar em circuit-open, e silenciosamente operar em modo L1-only sem alertar de forma persistente nos logs de saúde (`io-health.js`).

**Recomendação**: emitir um evento de lifecycle `'cache:l2:circuit-open'` via `publishIoLifecycleEvent` quando o circuit abrir, e expor o estado de circuit-open de forma mais proeminente no snapshot de health.

---

### GAP-07 · **[MÉDIO]** `io-parser.js` usa `@babel/parser` síncrono bloqueando o event loop para arquivos grandes

**Arquivo**: `src/copilot/infra/io-parser.js`

```js
function tryBabelParse(code, lang) {
    const parser = _babelParse;
    // ...
    return parser(code, { ... });   // síncrono, sem timeout
}
```

`@babel/parser` é CPU-bound e síncrono. Para arquivos gerados (e.g., `bundle.js`, `.d.ts` com milhares de linhas), pode bloquear o event loop por centenas de milissegundos. O limite `MAX_PARSE_BYTES` (2MB) mitiga o caso extremo, mas dentro desse limite ainda é possível ter arquivos com parsing lento.

**Recomendação**: mover `tryBabelParse` para um `worker_threads` pool dedicado, ou ao menos adicionar um timeout baseado em `performance.now()` para abortar parses excessivamente longos.

---

### GAP-08 · **[MÉDIO]** Falta de deduplicação de invalidações no bus (`io/invalidation/bus.js`)

**Arquivo**: `src/copilot/infra/io/invalidation/bus.js`

Quando um arquivo é escrito via `patchTextLocked`, a cadeia `invalidateIoCacheTiers` → `invalidateIoCachePath` → `publishIoInvalidation` pode disparar hooks para L1, L2 e o índice em sequência rápida. Se vários patches forem aplicados em série (e.g., multi-hunk patch), o mesmo path pode invalidar o índice 5+ vezes sem necessidade.

**Recomendação**: implementar debounce por `filePath` no bus (e.g., 50ms) ou batch de invalidações dentro de uma janela de operação.

---

### GAP-09 · **[MÉDIO]** `searchInFilesTool` não documenta fallback de engine para o usuário

**Arquivo**: `src/copilot/tools/search/text-search-tools.js`

O retorno inclui `engine: 'fts5-index' | 'rg' | 'grep'`, mas quando o fallback de `fts5-index` para `rg` ocorre (índice vazio ou query complexa), o modelo não recebe nenhuma explicação. Em casos onde o índice está desatualizado e `rg` produz mais resultados, o agente pode ter percepção incorreta de completude.

**Recomendação**: incluir campo `indexFallback: boolean` e `indexFallbackReason?: string` no retorno, para que o agente possa decidir se deve executar `workspace_index_build` antes de repetir a busca.

---

### GAP-10 · **[MÉDIO]** `io-session-scope.js` não limita o número de escopos ativos simultâneos

**Arquivo**: `src/copilot/infra/io-session-scope.js`

```js
const _registry = new Map();  // sem limite
```

O agente pode declarar escopos sem limite. Cada escopo mantém em memória: paths, symbolIndex (Map de `FileSymbols`), prefetch cache. Em sessões de longa duração com muitas tarefas concorrentes, o registro pode crescer indefinidamente. `listScopes()` é exposto mas nenhum GC automático existe além do `closeScope` explícito.

**Recomendação**: implementar limite configurável (e.g., `IO_MAX_ACTIVE_SCOPES=10`) com eviction LRU por último acesso.

---

### GAP-11 · **[MÉDIO]** Ausência de rastreamento de origem nos `_warmPromises` — não é possível cancelar warm em andamento

**Arquivo**: `src/copilot/infra/io-session-scope.js`

O `warmPromise` armazenado em `_warmPromises` não possui `AbortController` associado. Quando `closeScope` é chamado, o warm continua em background mesmo após o escopo ser deletado do registry. Isso desperdiça recursos de I/O e pode preencher o L1 cache com dados de um escopo que foi explicitamente fechado.

**Recomendação**: associar um `AbortController` a cada `warmPromise` e fazer `controller.abort()` em `closeScope`.

---

### GAP-12 · **[MÉDIO]** `io-health.js` não expõe latência por operação na saída de health

**Arquivo**: `src/copilot/infra/io-health.js`

O snapshot retorna `latency: safeCall(getIoLatencyStats, {})` que contém p50/p95/p99 por operação, mas a ferramenta `get_agent_info` em `introspection-tools.js` não expõe esses dados. O agente não tem visibilidade de latência de I/O sem chamar diretamente a API de health.

**Recomendação**: criar uma tool `get_io_health` que expõe o snapshot completo de `readIoRuntimeHealthSnapshot`.

---

### GAP-13 · **[BAIXO]** `BLOCKED_COMMAND_PATTERNS` em `sandbox.js` não cobre `history` e `declare -p`

**Arquivo**: `src/copilot/tools/shell/sandbox.js`

Comandos como `history`, `declare -p` (bash), e `typeset` podem expor variáveis de ambiente e histórico de comandos. `safeEnv()` já remove variáveis sensíveis, mas o histórico do shell pode conter tokens passados como argumentos de comandos anteriores.

---

### GAP-14 · **[BAIXO]** `io-scanner.js` sem limite absoluto de entradas retornadas

**Arquivo**: `src/copilot/infra/io-scanner.js`

Um scan recursivo a `depth: 20` num workspace grande sem `maxFiles` pode retornar dezenas de milhares de entradas, all carregadas em memória como array. O `advisoryLimits` no retorno menciona `limitMode: 'informative'`, mas não há proteção hard.

---

### GAP-15 · **[BAIXO]** Ausência de teste de disponibilidade de `grep` como fallback final

**Arquivo**: `src/copilot/infra/io/search/text-search.js`

O código assume que `grep` está disponível quando `rg` não está. Em containers mínimos (scratch images, distroless), `grep` pode não existir. O erro `ENOENT` é corretamente propagado, mas a mensagem de erro é genérica e não orienta sobre qual ferramenta instalar.

---

## Parte 3 — Upgrades (Node.js 24 + SDK 0.3.0)

### UPG-01 · **[ALTO]** Adotar `Promise.withResolvers()` em `io-locks.js`

**Disponível desde**: Node.js 22 (estável em Node 24)

O padrão atual de captura de `resolve` fora do constructor é um antipadrão clássico:

```js
// Atual — antipadrão
let release = () => {};
const current = new Promise((resolve) => {
    release = () => resolve(undefined);
});
```

**Upgrade**:
```js
// Node 24 — idiomático
const { promise: current, resolve: release } = Promise.withResolvers();
```

Isso elimina a mutação de variável externa, melhora legibilidade e evita o risco de `release` ser chamado antes de ser atribuído em edge cases de microtask scheduling.

---

### UPG-02 · **[ALTO]** Usar `await using` (Explicit Resource Management) para locks e escopos

**Disponível desde**: Node.js 24 (V8 13.6 — TC39 Stage 4)

Os padrões `try/finally` com `release()` em `io-locks.js` e `closeScope` em `io-session-scope.js` são candidatos ideais para `await using`:

```js
// Adicionar ao objeto retornado por withIoResourceLock:
// [Symbol.asyncDispose]: async () => release()

// Uso:
await using _lock = await acquireIoResourceLock(filePath);
// ... operação ...
// _lock é liberado automaticamente ao sair do bloco
```

Isso elimina toda uma classe de bugs de "lock esquecido" em casos de exceção e torna o controle de ciclo de vida explícito e composível.

---

### UPG-03 · **[ALTO]** Substituir `AbortController` + `setTimeout` manual por `AbortSignal.timeout()`

**Disponível desde**: Node.js 17.3+ (estável)

Vários módulos implementam timeout manual:

```js
// Padrão atual (web-tools.js, subprocess.js)
const controller = new AbortController();
const timeoutHandle = setTimeout(() => controller.abort(), ms);
try {
    const result = await fetch(url, { signal: controller.signal });
    return result;
} finally {
    clearTimeout(timeoutHandle);
}
```

**Upgrade**:
```js
const result = await fetch(url, { signal: AbortSignal.timeout(ms) });
```

**Atenção**: conforme issue `nodejs/node#57736`, `AbortSignal.any()` tem bugs de confiabilidade em Node 24.x. Usar `AbortSignal.timeout()` diretamente (sem `any()`) é seguro.

---

### UPG-04 · **[ALTO]** Migrar para `Error.isError()` em validações de tipo de erro

**Disponível desde**: Node.js 24 (V8 13.4)

```js
// Padrão atual — falha em cross-realm (iframes, vm.runInContext, etc.)
if (error instanceof Error) { ... }

// Upgrade — robusto para todos os realms
if (Error.isError(error)) { ... }
```

Especialmente relevante em `toError`, `toExecError`, `classifyToolFailure` e todos os `catch (err)` que verificam `instanceof Error`.

---

### UPG-05 · **[ALTO]** SDK 0.3.0: Breaking change `githubToken` → `gitHubToken`

**Fonte**: Release Notes SDK v0.3.0

```
The githubToken/GithubToken property on CopilotClientOptions has been corrected
to gitHubToken/GitHubToken (capital H) for consistency with GitHub's branding.
```

Qualquer código que passe `githubToken` no cliente ou sessão silenciosamente ignorará o token. **Verificar todos os pontos de criação de `CopilotClient` e `createSession`** no projeto.

---

### UPG-06 · **[MÉDIO]** SDK 0.3.0: `SessionFs` API redesenhada — interface idiomática

**Fonte**: Release Notes SDK v0.3.0

```
The SessionFs API now uses an idiomatic SessionFsProvider interface where methods
take plain arguments and signal errors by throwing, instead of the previous
RPC-shaped interface with parameter objects and error-result returns.
```

O `io-engine.js` exporta `mkdirPathLocked` e outros providers que devem ser mapeados para o novo formato:

```js
// Antes (SDK < 0.3.0)
{ mkdir: async ({ path, recursive }) => ({ success: true }) }

// Depois (SDK 0.3.0)
createSessionFsHandler: (session) => ({
    mkdir: async (path, options) => { await fs.mkdir(path, options); }
})
```

Verificar se o wiring atual em `bootstrap.js` usa o formato antigo. Checar o projeto inteiro src/copilot para corrigir formatos antigos.

---

### UPG-07 · **[MÉDIO]** SDK 0.3.0: `defaultAgent.excludedTools` para orquestração maestro/sub-agente

**Fonte**: Release Notes SDK v0.3.0

```
A new defaultAgent.excludedTools option lets you hide tools from the default agent
while keeping them available to custom sub-agents, enabling the orchestrator pattern.
```

O padrão atual usa `toggle_tool` (runtime disable) e `isToolDisabled()` para filtrar tools do agente maestro. Com `excludedTools`, isso pode ser feito declarativamente na configuração da sessão, eliminando o estado mutável em `_disabledTools` em `introspection-tools.js`.

---

### UPG-08 · **[MÉDIO]** SDK 0.3.0: `assistant.message_delta` de sub-agentes — filtrar por `agentId`

**Fonte**: Release Notes SDK v0.3.0

```
Streaming sessions now receive assistant.message_delta and assistant.reasoning_delta
events from sub-agents as well as the root agent. To handle this, either filter on
event.agentId (absent for the root agent) or set includeSubAgentStreamingEvents: false.
```

O SSE fanout em `sse/fanout.js` repassa todos os eventos sem filtro de `agentId`. Clientes do terminal que renderizam streaming podem exibir output de sub-agentes intercalado com o agente principal, causando confusão de UX.

**Recomendação**: adicionar `includeSubAgentStreamingEvents: false` na configuração da sessão ou implementar filtro por `agentId` no fanout.

---

### UPG-09 · **[MÉDIO]** SDK 0.3.0: `enableConfigDiscovery` elimina configuração manual de MCP

**Fonte**: SDK Changelog

```
Set enableConfigDiscovery: true when creating a session to let the runtime
automatically discover MCP server configurations (.mcp.json, .vscode/mcp.json)
and skill directories from the working directory.
```

O projeto atualmente configura MCP servers manualmente via `COPILOT_MCP_SERVERS`. Com `enableConfigDiscovery: true`, a descoberta automática de `.mcp.json` e skill directories pode simplificar o bootstrap e suportar configurações por-projeto.

---

### UPG-10 · **[MÉDIO]** Adotar `structuredClone()` em vez de `JSON.parse(JSON.stringify())`

**Disponível desde**: Node.js 17+ (global)

Diversas instâncias de deep clone implícito via serialização JSON:

- `io-session-scope.js`: `scope.paths = [...paths]` (OK, mas outros campos usam spread shallow)
- `runtime/transaction.js`: `{ ...changeSet, entries: [...changeSet.entries, nextEntry] }` acumula cópias shallow

```js
// Antes
const copy = JSON.parse(JSON.stringify(obj));

// Depois — preserva tipos (Date, Map, Set, Buffer não clonável — use com cuidado)
const copy = structuredClone(obj);
```

**Nota**: `structuredClone` não suporta `Buffer` nativo — usar `Buffer.from(original)` para buffers.

---

### UPG-11 · **[MÉDIO]** Adotar `Object.groupBy()` para substituir reduções manuais por categoria

**Disponível desde**: Node.js 21+

```js
// Padrão atual em introspection-tools.js e module-map.js
const byRole = {};
for (const entry of INFRA_MODULE_LAYOUT) {
    increment(byRole, entry.role);
}

// Upgrade — mais idiomático
const byRole = Object.groupBy(INFRA_MODULE_LAYOUT, (e) => e.role);
```

Aplicável em `buildInfraModuleScorecard`, `buildToolsModuleScorecard`, `bootstrapTools` (agrupamento de categorias), e nos relatórios de telemetria.

---

### UPG-12 · **[MÉDIO]** Substituir polling FTS5 por event-driven invalidação no índice

**Contexto**: arquitetura atual vs. Node 24 `diagnostics_channel`

O canal `ioIndexChannel` em `io-observability.js` já publica eventos `'index:build.complete'` e `'index:file.indexed'`. Porém, os consumidores (health, prefetch) fazem polling periódico em vez de reagir a esses eventos. Com Node 24 e `diagnostics_channel` como subscriber registrado, seria possível invalidar proativamente outros caches quando o índice atualizar.

---

### UPG-13 · **[BAIXO]** Usar `Array.fromAsync()` para simplificar coletas de generators async

**Disponível desde**: Node.js 22+

```js
// Padrão atual
const results = [];
for await (const item of asyncGenerator()) {
    results.push(item);
}

// Upgrade
const results = await Array.fromAsync(asyncGenerator());
```

Aplicável em `io-scanner.js` e qualquer lugar que colete streams assíncronos.

---

### UPG-14 · **[BAIXO]** `ReadableStream.from()` para criar streams a partir de generators

**Disponível desde**: Node.js 22+

O `read-chunks.js` usa `createReadStream` + `addAbortSignal` + `StringDecoder` manual para chunked reading. Com `ReadableStream.from()` e a Web Streams API agora estável em Node 24, o mesmo resultado pode ser alcançado de forma mais declarativa e com melhor integração com `AbortSignal.timeout()`.

---

### UPG-15 · **[BAIXO]** Node.js 24 + undici v7: stricter fetch spec compliance

**Fonte**: Node.js 24 release notes + msw/msw#2530

Node 24 atualizou para undici v7 com conformidade mais estrita à spec do `fetch`. Qualquer `AbortSignal` criado via Proxy ou passado de outro realm pode lançar:

```
TypeError: RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal.
```

O `web-tools.js` cria `AbortController` nativo — sem risco direto. Mas se o projeto usa interceptores de rede em testes (e.g., `msw`, `nock`), **testes de web tools podem quebrar** no Node 24 após upgrade de dependências.

**Recomendação**: auditar o setup de testes de web tools e garantir que não proxiem o objeto `AbortSignal`.

---

### UPG-16 · **[BAIXO]** SDK 0.3.0: MCP server config types renomeados

**Fonte**: Release Notes SDK v0.3.0

```
MCP server configuration types have been renamed to match MCP protocol terminology:
"local" → "stdio"
"remote" → "http"
```

Qualquer código que construa configs MCP com `type: 'local'` ou `type: 'remote'` quebrará silenciosamente (campo ignorado) ou lançará erro de validação dependendo do SDK. Verificar `COPILOT_MCP_SERVERS` parsing e qualquer config estática no projeto.

---

## Parte 4 — Matriz de Priorização

### Ação Imediata (Crítico/Alto — sprint atual)

| ID     | Arquivo Principal     | Impacto                                       |
| ------ | --------------------- | --------------------------------------------- |
| BUG-01 | `io-cache.js`         | Corrupção de cache em alto volume de escritas |
| BUG-02 | `subprocess.js`       | Corrupção silenciosa de output de busca       |
| BUG-03 | `io-prefetch.js`      | Índice FTS desatualizado por race condition   |
| GAP-01 | `io-index-sqlite.js`  | Corridas de escrita em builds concorrentes    |
| GAP-02 | `io-session-scope.js` | OOM em workspaces grandes                     |
| GAP-04 | SQLite shared DB      | Contenção severa em operações paralelas       |
| UPG-05 | bootstrap/session     | Breaking change SDK 0.3.0 silencioso          |
| UPG-06 | SessionFs wiring      | Breaking change SDK 0.3.0 na API FS           |

### Próximo Sprint (Alto — alta relação custo/benefício)

| ID     | Arquivo Principal       | Benefício                                |
| ------ | ----------------------- | ---------------------------------------- |
| BUG-05 | `io-cache-l2-sqlite.js` | Elimina N+1 queries em warm-up           |
| BUG-06 | `io-locks.js`           | Elimina memory leak em sessões longas    |
| BUG-07 | `io-session-scope.js`   | Corrige corrupção de estado de escopo    |
| GAP-03 | `todo/store.js`         | Paginação para escalabilidade            |
| GAP-05 | `web-tools.js`          | Habilita casos de uso de API REST        |
| UPG-01 | `io-locks.js`           | `Promise.withResolvers()` — idiomático   |
| UPG-02 | locks/scopes            | `await using` — segurança de recursos    |
| UPG-03 | subprocess/web          | `AbortSignal.timeout()` — simplificação  |
| UPG-04 | toda a base             | `Error.isError()` — robustez cross-realm |

### Backlog Médio Prazo (Médio)

- BUG-08 a BUG-15, GAP-06 a GAP-12, UPG-07 a UPG-12

### Dívida Técnica (Baixo)

- BUG-16 a BUG-19, GAP-13 a GAP-15, UPG-13 a UPG-16

---

## Parte 5 — Checklist de Conformidade SDK 0.3.0

```
[ ] Renomear githubToken → gitHubToken em todos os CopilotClientOptions
[ ] Migrar SessionFs API para novo SessionFsProvider (throw-on-error)
[ ] Filtrar sub-agent streaming events por agentId ou setar includeSubAgentStreamingEvents: false
[ ] Migrar MCP server type: 'local'/'remote' → 'stdio'/'http'
[ ] Avaliar enableConfigDiscovery: true para simplificar bootstrap de MCP
[ ] Avaliar defaultAgent.excludedTools em substituição ao _disabledTools runtime
[ ] Adicionar session-level gitHubToken onde identidades distintas forem necessárias
[ ] Atualizar custom agents para declarar skills: string[] se aplicável
[ ] Importar AssistantMessageData para tipagem forte de eventos assistant.message
```

---

## Parte 6 — Checklist de Conformidade Node.js 24

```
[ ] Verificar todos os testes de web tools contra undici v7 stricter fetch compliance
[ ] Substituir instanceof Error por Error.isError() em handlers de catch globais
[ ] Avaliar migração de locks para await using (Symbol.asyncDispose)
[ ] Substituir AbortController+setTimeout por AbortSignal.timeout() onde aplicável
[ ] Usar Promise.withResolvers() em io-locks.js e queue/async-queue.js
[ ] Habilitar WAL mode no SQLite compartilhado (getCopilotDb)
[ ] Auditar testes para subteste auto-await (Node 24 breaking change em test runner)
[ ] Verificar compatibilidade de bibliotecas de terceiros com Node 24 (especialmente msw)
```

---

*Documento gerado por análise estática manual + pesquisa de changelogs oficiais. Última revisão: 16 de maio de 2026.*
