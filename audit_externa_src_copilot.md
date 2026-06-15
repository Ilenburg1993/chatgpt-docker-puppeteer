# Auditoria Técnica — `src/copilot/infra/` + `tools/file/`
**Projeto:** `chatgpt-docker-puppeteer`
**Runtime alvo:** Node.js 24.x · ESM · WSL2/Docker DevContainer
**Runtime validado nesta remediação:** Node.js 24.15.0
**Data:** 14 de junho de 2026
**Escopo:** todos os arquivos anexados nas pastas `src/copilot/infra/**` e `src/copilot/tools/file/**`
**Metodologia:** leitura integral line-by-line, cruzamento com Node 24 API docs, SQLite 3.x, `lru-cache` v10, `better-sqlite3` e as interfaces públicas já auditadas do SDK Copilot.

---

## Índice

1. [Sumário Executivo](#1-sumário-executivo)
2. [P0 — Bugs Críticos](#2-p0--bugs-críticos)
3. [P1 — Bugs Significativos](#3-p1--bugs-significativos)
4. [P2 — Issues Moderados](#4-p2--issues-moderados)
5. [P3 — Qualidade de Código e Issues Menores](#5-p3--qualidade-de-código-e-issues-menores)
6. [Lacunas Arquiteturais](#6-lacunas-arquiteturais)
7. [Oportunidades de Upgrade — Node 24.5](#7-oportunidades-de-upgrade--node-245)
8. [Checklist de Remediação Rápida](#8-checklist-de-remediação-rápida)
9. [Validação Codex contra o estado atual](#9-validação-codex-contra-o-estado-atual)
10. [Roadmap sistêmico de implementação](#10-roadmap-sistêmico-de-implementação)

---

## 1. Sumário Executivo

A infraestrutura de I/O do projeto é madura e bem estruturada: cache L1/L2 com fingerprint rico, locks hierárquicos (L0 em memória + L1 lockfile), índice FTS5 com símbolos Babel, parser off-main-thread com worker pool, sistema de sessão/escopo para a LLM-B e um conjunto coerente de write tools com rollback e audit log. O nível de cuidado com observabilidade (`diagnostics_channel`, histogramas, health snapshot) é notavelmente alto.

Ainda assim, a auditoria identificou **3 bugs P0**, **7 bugs P1**, **12 issues P2**, **14 issues P3** e **16 lacunas/oportunidades** — vários com remediação trivial dada a qualidade da base existente.

| Severidade    | Qtd. | Impacto dominante                                                           |
| ------------- | ---- | --------------------------------------------------------------------------- |
| P0            | 3    | Corrupção silenciosa de config / hang de processo                           |
| P1            | 7    | Degradação de performance, dupla leitura de disco, inconsistência de índice |
| P2            | 12   | Escrita desperdício, race conditions leves, buracos de API para LLM-B       |
| P3            | 14   | DRY violations, fallbacks obsoletos no Node 24, menor corretude             |
| Gaps/Upgrades | 16   | Schema sem versioning, `node:sqlite`, `import.meta.dirname`, etc.           |

---

## 2. P0 — Bugs Críticos

### P0-1 · `io-cache.js` — Variáveis de config L1 aceitam `NaN` silenciosamente

**Arquivo:** `src/copilot/infra/io-cache.js`, linhas de inicialização das constantes.

```js
// ATUAL — vulnerável a NaN
const DEFAULT_TTL_MS     = Number(process.env['IO_L1_CACHE_TTL_MS']     ?? 60_000);
const DEFAULT_MAX_ENTRIES = Number(process.env['IO_L1_CACHE_MAX_ENTRIES'] ?? 2_000);
const DEFAULT_MAX_BYTES   = Number(process.env['IO_L1_CACHE_MAX_BYTES']   ?? 128 * 1024 * 1024);
const DEFAULT_HASH_REVALIDATE_MAX_BYTES = Number(process.env['IO_L1_HASH_REVALIDATE_MAX_BYTES'] ?? 1024 * 1024);
```

Se qualquer dessas variáveis de ambiente estiver definida com valor não numérico (ex.: `IO_L1_CACHE_MAX_ENTRIES=disabled`), `Number('disabled')` retorna `NaN`. Os efeitos são:

- `NaN > 0` é `false`, portanto `DEFAULT_TTL_MS = NaN` silencia o TTL — o cache nunca expira e cresce sem bounds.
- `max: NaN` passado ao construtor do `LRUCache` provoca comportamento indefinido (a biblioteca pode lançar ou usar `Infinity`).
- `maxSize: NaN` idem para o budget de memória.
- `DEFAULT_HASH_REVALIDATE_MAX_BYTES = NaN` faz `currentSize <= NaN` retornar `false` — toda revalidação por hash é pulada.

**Nenhum destes erros produz exceção**: o processo sobe aparentemente normal e o cache degrada silenciosamente.

**Correção:**

```js
// CORRIGIDO — usa o helper que já existe no módulo shared
import { readEnvPositiveInt } from './shared/env.js';

const DEFAULT_TTL_MS                    = readEnvPositiveInt('IO_L1_CACHE_TTL_MS',               60_000);
const DEFAULT_MAX_ENTRIES               = readEnvPositiveInt('IO_L1_CACHE_MAX_ENTRIES',            2_000);
const DEFAULT_MAX_BYTES                 = readEnvPositiveInt('IO_L1_CACHE_MAX_BYTES',     128 * 1024 * 1024);
const DEFAULT_HASH_REVALIDATE_MAX_BYTES = readEnvPositiveInt('IO_L1_HASH_REVALIDATE_MAX_BYTES', 1024 * 1024);
const STALE_PROBE_INTERVAL_MS           = readEnvPositiveInt('IO_L1_STALE_PROBE_INTERVAL_MS',    2_000);
// Nota: STALE_PROBE_INTERVAL_MS = 0 deve desabilitar; usar readEnvNonNegativeInt para esse caso.
```

`readEnvPositiveInt` já existe em `shared/env.js` e está amplamente utilizado no resto da base. O padrão é deliberadamente ignorado aqui, o que é um descuido, não uma decisão de design.

---

### P0-2 · `io-cache-l2-sqlite.js` — `setBatchTimer` nunca é `.unref()`'d

**Arquivo:** `src/copilot/infra/io-cache-l2-sqlite.js`, função `scheduleSetBatchFlush`.

```js
// ATUAL
function scheduleSetBatchFlush() {
    if (setBatchTimer) return;
    setBatchTimer = setTimeout(flushPendingSets, setBatchWindowMs);
    // ← .unref() ausente
}
```

O timer gerado pelo `setTimeout` mantém o event loop do Node vivo enquanto houver writes pendentes no buffer. Em ferramentas CLI como `copilot:index build`, isso **impede o processo de encerrar** após a conclusão do trabalho: o processo fica suspenso indefinidamente aguardando o timer disparar, mesmo que não haja nenhum trabalho real a fazer.

O `registerShutdownHandler` registrado em `io-cache-l2-registry.js` faz flush de emergência no shutdown, mas só é invocado quando o runtime de ciclo de vida decide encerrar — o que não acontece se o timer mantém o processo vivo.

**Correção:**

```js
function scheduleSetBatchFlush() {
    if (setBatchTimer) return;
    setBatchTimer = setTimeout(flushPendingSets, setBatchWindowMs);
    setBatchTimer.unref?.();   // ← permite exit limpo em CLIs
}
```

O padrão `timer.unref?.()` já é adotado em `io-cache-l2-registry.js` (linha `_pruneTimer.unref()`) e em `io-parser.js`. A consistência é fácil de alcançar.

---

### P0-3 · `io-parser.js` — Worker pool desabilitado permanentemente após falha de restart

**Arquivo:** `src/copilot/infra/io-parser.js`, função `restartWorkerSlot`.

```js
async function restartWorkerSlot(slot) {
    // ... termina worker antigo ...
    try {
        const replacement = createWorkerSlot(slot.index);
        _workerPool[slot.index] = replacement;
        dispatchQueuedWorkerTask(replacement);
    } catch {
        _workerPoolDisabledByError = true;   // ← flag permanente
        while (_workerQueue.length > 0) {
            const queued = _workerQueue.shift();
            queued?.reject(new Error('parser worker pool unavailable'));
        }
    }
}
```

Uma falha transitória no restart (ex.: `@babel/parser` momentaneamente indisponível durante hot-reload, OOM pontual, arquivo de worker temporariamente bloqueado) seta `_workerPoolDisabledByError = true` sem mecanismo de recuperação automática. A única saída é chamar `shutdownParserWorkerPool()` seguido de re-inicialização do módulo — não acessível em runtime normal.

**Consequência:** depois do erro, `parseFileSymbols` sempre cai no fallback síncrono no main thread para **todo** arquivo JS/TS, bloqueando o event loop indefinidamente para projetos grandes.

**Correção sugerida:** implementar backoff exponencial com tentativa de re-criação do pool:

```js
let _workerRestartAttempts = 0;
const MAX_WORKER_RESTART_ATTEMPTS = 5;
const WORKER_RESTART_BACKOFF_MS   = [500, 1000, 2000, 5000, 10_000];

async function restartWorkerSlot(slot) {
    // ... termina worker antigo ...
    if (_workerRestartAttempts >= MAX_WORKER_RESTART_ATTEMPTS) {
        _workerPoolDisabledByError = true;
        // rejeita fila pendente ...
        return;
    }
    const backoffMs = WORKER_RESTART_BACKOFF_MS[_workerRestartAttempts] ?? 10_000;
    _workerRestartAttempts += 1;
    await new Promise(r => setTimeout(r, backoffMs).unref?.());
    try {
        const replacement = createWorkerSlot(slot.index);
        _workerPool[slot.index] = replacement;
        _workerRestartAttempts = 0;          // reset em sucesso
        dispatchQueuedWorkerTask(replacement);
    } catch {
        void restartWorkerSlot(slot);        // tenta novamente com backoff maior
    }
}
```

---

## 3. P1 — Bugs Significativos

### P1-1 · `io-index-sqlite.js` + `schema.js` — `DELETE` com `LIKE` em coluna `UNINDEXED` do FTS5 causa full scan

**Arquivo:** `src/copilot/infra/io-index-sqlite.js`, função `clearFileRows`.

```js
function clearFileRows(filePath) {
    const prefix = `${filePath}/%`;
    stmtDeleteChunks.run(filePath, prefix);
    stmtDeleteFts.run(filePath, prefix);    // ← problema aqui
    stmtDeleteSymbols.run(filePath, prefix);
    stmtDeleteImports.run(filePath, prefix);
    stmtDeleteFile.run(filePath, prefix);
}
```

O statement `stmtDeleteFts` é:

```sql
DELETE FROM copilot_io_index_fts WHERE file_path = ? OR file_path LIKE ?
```

`file_path` é declarado como `UNINDEXED` na tabela FTS5:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS copilot_io_index_fts USING fts5(
    file_path UNINDEXED,
    relative_path,
    content,
    ...
);
```

Colunas `UNINDEXED` no FTS5 não possuem índice auxiliar. O `LIKE` forçará uma varredura sequencial de toda a tabela FTS5 — que cresce linearmente com o número de chunks indexados (default de 200 linhas/chunk para cada arquivo). Em um workspace com 5000 arquivos e média de 500 linhas, isso são 12.500+ linhas FTS5 percorridas para **cada** invalidação de arquivo.

O statement `stmtSearchScoped` também sofre do mesmo problema:

```sql
WHERE copilot_io_index_fts MATCH ?
  AND (file_path = ? OR file_path LIKE ?)
```

**Correção:** materializar `file_path` em uma shadow-table indexada, ou filtrar por `file_path` na tabela principal `copilot_io_index_files` (que tem índice adequado) e usar os `rowid`s resultantes para delete na FTS5:

```sql
-- Alternativa eficiente: deletar via rowid
DELETE FROM copilot_io_index_fts
WHERE rowid IN (
    SELECT f.rowid FROM copilot_io_index_fts f
    WHERE f.file_path = ? OR f.file_path LIKE ?
);
```

Ou, mais limpo, manter uma tabela de mapeamento `file_path → fts_rowid` com índice normal.

---

### P1-2 · `io-prefetch.js` — `warmReadThroughContext` lê o mesmo arquivo duas vezes do disco

**Arquivo:** `src/copilot/infra/io-prefetch.js`, função `warmReadThroughContext`.

```js
export async function warmReadThroughContext(filePath, opts = {}) {
    // ...
    const text = await readTextFileSnapshot(filePath);       // ← 1ª leitura do disco
    primeIoL1Entry(makeTextKey(...), text.content, {...});   // aquece L1
    primeIoL1Entry(makeBytesKey(...), toOwnedBuffer(text.content), {...});

    if (relatedImports) {
        const symbols = await parseAndCacheSymbols(filePath).catch(() => null); // ← 2ª leitura!
    }
}
```

`parseAndCacheSymbols` em `io-parser.js`:

```js
export async function parseAndCacheSymbols(filePath) {
    const cached = _symbolCache.get(cacheKey);
    if (cached) return cached;
    const snapshot = await readTextFileSnapshot(filePath);  // ← lê disco novamente
    const symbols = await parseFileSymbols(filePath, snapshot.content);
    ...
}
```

`readTextFileSnapshot` é uma porta baixa que **não consulta L1** — sempre vai ao disco. Portanto, para o caso cold (ausente do `_symbolCache`), o arquivo é lido duas vezes do filesystem por uma única chamada a `warmReadThroughContext`.

**Correção:** passar o conteúdo já lido para evitar o segundo round trip:

```js
// Em io-parser.js: adicionar parâmetro opcional
export async function parseAndCacheSymbols(filePath, providedContent) {
    const cacheKey = normalizeParserPath(filePath);
    const cached = _symbolCache.get(cacheKey);
    if (cached) return cached;

    const content = providedContent ?? (await readTextFileSnapshot(filePath)).content;
    const symbols = await parseFileSymbols(filePath, content);
    _symbolCache.set(cacheKey, symbols);
    return symbols;
}

// Em io-prefetch.js:
if (relatedImports) {
    const symbols = await parseAndCacheSymbols(filePath, text.content).catch(() => null);
}
```

---

### P1-3 · `io-parser-worker.js` — Duplicação integral da lógica de extração de símbolos

**Arquivos:** `io-parser.js` e `io-parser-worker.js` — ambos implementam `extractSymbolsFromAst`, `_extractDeclSymbols` / `extractDeclSymbols`, `extractLeadingComment`, `extractName`.

As implementações são funcionalmente idênticas com nomes de helpers levemente diferentes (`_extractDeclSymbols` vs `extractDeclSymbols`). Qualquer fix de bug (ex.: novo tipo de nó Babel, suporte a `using` declarations do TC39 Stage-4, `export type *` do TypeScript) deve ser aplicado manualmente nos dois arquivos. O histórico de divergências futuras é inevitável.

**Causa raiz:** o worker não pode importar de `io-parser.js` diretamente porque carregaria `lru-cache`, `node:fs`, `node:path` e outros módulos desnecessários para um processo de parse puro.

**Correção:** extrair o core de parse para um arquivo puro e compartilhado:

```
src/copilot/infra/parse/js-ast-extractor.js   ← novo arquivo puro (sem imports de IO)
  exporta: extractSymbolsFromAst, extractDeclSymbols, extractLeadingComment, extractName

io-parser.js         → import { extractSymbolsFromAst } from './parse/js-ast-extractor.js'
io-parser-worker.js  → import { extractSymbolsFromAst } from './parse/js-ast-extractor.js'
```

Isso elimina a duplicação sem violar a separação de concerns — `parse/` já é explicitamente uma zona "pura" segundo o README.

---

### P1-4 · `tools/file/index-tools.js` — `workspace_index_build` sem `workspaceRoot`

**Arquivo:** `src/copilot/tools/file/index-tools.js`.

```js
handler: async ({ directory, ... }) => {
    const pathCheck = await validatePath(directory, { mode: 'read' });
    // ...
    return buildIoIndexForDirectory(pathCheck.resolved, options);
    //                                                   ↑ workspaceRoot não está em options
}
```

Em `io-index-sqlite.js`, quando `workspaceRoot` não é fornecido:

```js
const workspaceRoot = normalizeIndexPath(options.workspaceRoot ?? rootPath);
```

O `rootPath` é o próprio diretório indexado. Resultado: `relativePath` em todos os registros do índice é relativo ao diretório indexado, não à raiz do workspace.

**Exemplo concreto:** indexar `src/copilot` produz `relative_path = 'infra/io-cache.js'` em vez de `'src/copilot/infra/io-cache.js'`. Buscas por caminho retornam resultados incorretos; cruzamento com outros módulos que usam caminhos workspace-relativos falha.

**Correção:**

```js
// IndexBuildParameters — adicionar campo
workspaceRoot: z.string().optional().describe(
    'Raiz do workspace para cálculo de relativePath. Default: WORKSPACE_ROOT do boot.'
),

// handler
import { WORKSPACE_ROOT } from './shared.js';
const options = {};
options.workspaceRoot = workspaceRoot ? (await validatePath(workspaceRoot, { mode: 'read' })).resolved
                                      : WORKSPACE_ROOT;
return buildIoIndexForDirectory(pathCheck.resolved, options);
```

---

### P1-5 · `io/fs/read-chunks.js` — `byteLineIndexCache` usa evicção FIFO, não LRU

**Arquivo:** `src/copilot/infra/io/fs/read-chunks.js`.

```js
function trimByteLineIndexCache() {
    while (byteLineIndexCache.size > BYTE_LINE_INDEX_MAX_ENTRIES) {
        const oldest = byteLineIndexCache.keys().next().value;  // ← remove o mais antigo (FIFO)
        if (typeof oldest !== 'string') break;
        byteLineIndexCache.delete(oldest);
    }
}
```

A Map JavaScript mantém ordem de inserção. `keys().next()` retorna sempre o elemento inserido mais cedo — não o menos recentemente acessado. Arquivos muito acessados (ex.: `io-engine.js`, `io-cache.js`) serão evictados antes de arquivos lidos apenas uma vez, causando rebuilds desnecessários do índice de bytes toda vez que forem acessados via `readStrategy=stream`.

Em contraste, `lineOffsetCache` no mesmo codebase implementa LRU corretamente com `delete + set`:

```js
// line-offset-cache.js — LRU correto
lineOffsetCache.delete(key);
lineOffsetCache.set(key, entry);   // move para o final (mais recente)
```

**Correção — aplicar o mesmo padrão:**

```js
async function getByteLineIndex(filePath, options = {}) {
    // ...
    const cached = byteLineIndexCache.get(cacheKey);
    if (cached && byteLineIndexMatchesStats(cached, stats)) {
        byteLineIndexCache.delete(cacheKey);   // ← remove e re-insere = move para o fim
        byteLineIndexCache.set(cacheKey, cached);
        return cached;
    }
    // ...
}
```

---

### P1-6 · `io/fs/locked-mutations.js` — `patchTextLocked` grava disco mesmo quando `noop=true`

**Arquivo:** `src/copilot/infra/io/fs/locked-mutations.js`.

```js
// computeTextPatch retorna noop: true quando updated === content
const { updated, ..., noop } = patch;
const durability = options.dryRun ? null : await writeAtomicFileUnlocked(filePath, updated);
//                                          ↑ grava mesmo quando noop=true e dryRun=false
```

Quando `allowNoop=true` e `old_string === new_string`, o patch é válido mas sem efeito (`updated === content`). Mesmo assim, `writeAtomicFileUnlocked` é chamado, resultando em:

- Escrita de conteúdo idêntico no disco.
- Reset do `mtime` do arquivo.
- Invalidação desnecessária de L1, L2 e índice FTS5.
- Falsa detecção de mudança por ferramentas externas (watchers, git).

**Correção:**

```js
const durability = (options.dryRun || patch.noop)
    ? null
    : await writeAtomicFileUnlocked(filePath, updated);
```

A propriedade `noop` já está disponível no resultado de `computeTextPatch`.

---

### P1-7 · `io-index-sqlite.js` — `pruneMissingRows` executa N DELETEs sequenciais

**Arquivo:** `src/copilot/infra/io-index-sqlite.js`, função `pruneMissingRows`.

```js
function pruneMissingRows(rootPath, currentFilePaths, extensions) {
    const rows = stmtListIndexedUnderPathFiltered.all(...);
    let pruned = 0;
    for (const row of rows) {
        if (currentFilePaths.has(row.filePath)) continue;
        clearFileRows(row.filePath);   // ← 5 DELETEs separados por arquivo
        pruned += 1;
    }
    return pruned;
}
```

Para um build com 500 arquivos removidos, isso executa 2.500 statements SQLite individuais fora de uma transação explícita. Em `better-sqlite3` (síncrono), cada statement adquire um lock de escrita e aguarda o WAL — o throughput é ordens de magnitude inferior ao de um batch.

**Correção:** envolver em transação e preferir um DELETE em lote:

```js
function pruneMissingRows(rootPath, currentFilePaths, extensions) {
    const rows = stmtListIndexedUnderPathFiltered.all(...);
    const toDelete = rows
        .filter(row => !currentFilePaths.has(row.filePath))
        .map(row => row.filePath);

    if (toDelete.length === 0) return 0;

    // usar transação única
    const doPrune = db.transaction((paths) => {
        for (const fp of paths) clearFileRows(fp);
    });
    doPrune(toDelete);
    return toDelete.length;
}
```

Se a lista for muito grande (>999 itens), SQLite limita `IN (...)` por default. Para esses casos, batch de 500 por transação ainda é drasticamente mais rápido que N transações individuais.

---

## 4. P2 — Issues Moderados

### P2-1 · `io-cache-l2-sqlite.js` — Recuperação de flush com race condition

**Arquivo:** `src/copilot/infra/io-cache-l2-sqlite.js`, `flushPendingSets`.

```js
function flushPendingSets() {
    const rows = [...pendingSets.values()];
    pendingSets.clear();
    try {
        persistRowsBatch(rows);
        // ...
    } catch {
        for (const row of rows) {
            if (!pendingSets.has(row.key)) pendingSets.set(row.key, row);  // ← recuperação
        }
        // ...
    }
}
```

Entre o `pendingSets.clear()` e o bloco `catch`, chamadas concorrentes a `set()` (via `scheduleSetBatchFlush`) podem adicionar novas entradas ao `pendingSets`. O bloco de recuperação usa `if (!pendingSets.has(row.key))` para não sobrescrever entradas mais novas — lógica correta. Contudo, se a nova entrada tem uma `key` diferente das entradas em falha, ambas sobrevivem. Se a nova entrada tem a **mesma chave** de uma entrada restaurada, a recuperação pula a restauração — perdendo a versão antiga. Na prática, a versão mais nova na Map é a correta para essa chave (é um cache), então a perda não é de dados, mas de um write que deveria ser persistido. Em contexto de auditoria, isso pode criar a aparência de dados que foram salvos mas não foram.

**Recomendação:** documentar explicitamente o contrato de best-effort do L2 no código e expor o `batchFailures` counter via `getStats()` (já exposto) para monitorar em produção.

---

### P2-2 · `io-session-scope.js` — Re-declaração de scope aguarda warm anterior completar

**Arquivo:** `src/copilot/infra/io-session-scope.js`.

```js
const previousWarmPromise = _warmPromises.get(sessionId) ?? null;
// ...
abortWarmForSession(sessionId);   // sinaliza abort via AbortController
// ...
const warmPromise = (async () => {
    if (previousWarmPromise) {
        await previousWarmPromise.catch(() => undefined);   // ← aguarda o anterior
    }
    // só então começa a aquecer
})();
```

O `abortWarmForSession` seta o signal como abortado mas não cancela I/O já em voo (que não recebe o signal). Para diretórios grandes, `warmFromDirectory` → `scanDirectory` → 100s de `readBytesFileSnapshot` em paralelo podem estar em progresso. O novo warm aguarda o término completo, mesmo que o resultado não seja utilizado. Em fluxos onde a LLM-B re-declara o escopo rapidamente (mudança de tarefa), a latência de resposta de `awaitReady` pode ser multisegundos.

**Correção:** propagar o `signal` ao `scanDirectory` e às operações de prefetch para que cancelem mais agressivamente. O `warmFromDirectory` e `startSessionScope` já aceitam `signal`, mas o `signal` do `AbortController` anterior não é o mesmo que o novo.

---

### P2-3 · `io/search/subprocess.js` — `streamSearchFile` não tem timeout para SIGTERM

**Arquivo:** `src/copilot/infra/io/search/subprocess.js`.

```js
const emitLine = (line) => {
    const keepGoing = options.onStdoutLine?.(line);
    if (keepGoing === false) {
        stoppedEarly = true;
        if (!child.killed) child.kill('SIGTERM');   // ← sem timeout para forçar SIGKILL
        return false;
    }
    return true;
};
```

Se o processo filho (`rg` ou `grep`) ignorar `SIGTERM` (possível em sistemas sob carga extrema ou containers com signal masking), a Promise aguarda o evento `close` indefinidamente. Em contexto de tool chamado pela LLM-B com timeout de sessão, isso pode deixar processos zumbis e consumir file descriptors.

**Correção:**

```js
if (!child.killed) {
    child.kill('SIGTERM');
    setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
    }, 3000).unref?.();
}
```

---

### P2-4 · `io-cache.js` — TTL sem `ttlAutopurge` acumula entradas expiradas em memória

**Arquivo:** `src/copilot/infra/io-cache.js`.

```js
new LRUCache({
    max: DEFAULT_MAX_ENTRIES,
    maxSize: DEFAULT_MAX_BYTES,
    ttl: DEFAULT_TTL_MS,
    ttlAutopurge: false,   // ← entradas expiradas só são removidas em acesso
    allowStale: false,
    updateAgeOnGet: true,
})
```

Com `ttlAutopurge: false`, entradas expiradas permanecem no cache até que a chave seja acessada ou evictada por LRU. Um workspace que indexa 2000 arquivos e depois para de ler por 60s (TTL padrão) terá todas as 2000 entradas tecnicamente expiradas mas ainda consumindo memória. O `calculatedSize` retornado em `stats()` continuará reportando memória alocada, enganando métricas de monitoramento.

**Correção:** habilitar purge periódico ou aumentar o budget de memória com `ttlAutopurge: true`. Se o custo de CPU for preocupante, adicionar uma tarefa de purge agendada a cada `DEFAULT_TTL_MS`:

```js
// Em getIoL1Cache():
if (DEFAULT_TTL_MS > 0) {
    const purgeTimer = setInterval(() => _lru.purgeStale(), DEFAULT_TTL_MS);
    purgeTimer.unref?.();
}
```

---

### P2-5 · `tools/file/write-tools.js` — `copy_file` não expõe `expectedSourceHash`

A tool `copy_file` não aceita `expectedHash` para o arquivo de origem. A camada subjacente (`copyFileUnlocked`) suporta `expectedSourceHash` e `expectedSourceBytes`, permitindo que cópias concorrentes do mesmo arquivo detectem modificações durante a cópia. Sem esse parâmetro, a LLM-B não tem como garantir a integridade da cópia em ambientes onde outro processo possa modificar a origem.

**Correção:** adicionar ao schema da tool:

```js
expectedSourceHash: z.string().optional()
    .describe('SHA-256 esperado do arquivo de origem. Se o arquivo mudou, a cópia falha.')
```

E passar para `copyFileLocked`:

```js
const copyResult = await copyFileLocked(src.resolved, dst.resolved, {
    overwrite,
    ...(expectedSourceHash ? { expectedSourceHash } : {}),
});
```

---

### P2-6 · `tools/file/write-tools.js` — `create_file` não suporta `encoding=base64`

`write_file_content` aceita `encoding: 'utf8' | 'base64'` para conteúdo binário. `create_file` aceita apenas texto (`content: z.string()`). Para criar um arquivo binário novo via tool, a LLM-B precisa usar `write_file_content` com `requireExists: true` — que falha se o arquivo não existe — e depois `create_file` sem conteúdo, seguido de `write_file_content`. Esse workaround é não-atômico.

**Correção:** adicionar `encoding` ao schema de `create_file` e decodificar via `decodeBase64ToOwnedBuffer` quando necessário (o padrão já existe em `write_file_content`).

---

### P2-7 · `io/fs/capacity-preflight.js` — `statfs` chamado para cada write sem caching

`preflightIoCapacity` é chamado em `writeAtomicFileUnlocked`, `copyFileUnlocked` e `moveFileUnlocked`. Cada chamada executa `statfs(path.dirname(targetPath))` — uma syscall de I/O. Em fluxos de patch/write em lote (ex.: aplicar 50 patches em 50 arquivos no mesmo diretório), isso são 50 `statfs` desnecessários para o mesmo filesystem.

**Sugestão:** cache com TTL curto (1–2s) keyed por device number, ou expor `disableCapacityPreflight` como opção para callers que sabem que o disco tem espaço suficiente.

---

### P2-8 · `io-index-registry.js` — Hook de invalidação registrado no módulo-level sem unregister

```js
// Executado na carga do módulo:
registerInvalidationHook((filePath) => {
    try {
        getIoIndex()?.invalidatePath(filePath);
    } catch { /* swallow */ }
});
```

O retorno de `registerInvalidationHook` (a função de unregister) é descartado. Em testes que fazem `resetIoIndexForTest()`, o hook de invalidação permanece registrado e continua tentando chamar `getIoIndex()` em um estado zerado. Se o índice foi resetado e outro teste o re-inicializa, o hook do módulo anterior pode interferir com o novo estado.

**Correção:** armazenar o unregister e expô-lo via `resetIoIndexForTest`:

```js
let _indexInvalidationUnregister = null;

function ensureIndexInvalidationHook() {
    if (_indexInvalidationUnregister) return;
    _indexInvalidationUnregister = registerInvalidationHook((filePath) => {
        try { getIoIndex()?.invalidatePath(filePath); } catch { /* swallow */ }
    });
}

export function resetIoIndexForTest() {
    _ioIndex = null;
    _inflightIndexBuilds.clear();
    _indexInvalidationUnregister?.();   // ← remove o hook
    _indexInvalidationUnregister = null;
}
```

---

### P2-9 · `io-session-scope.js` — `refreshScope` sem guard de concorrência

Duas chamadas paralelas a `refreshScope(sessionId, paths)` para o mesmo scope executam `invalidateParserCache(p)` e `parseAndCacheSymbols(p)` de forma intercalada. A condição de corrida em `scope.symbolIndex.set(p, symbols)` não resulta em corrupção de dados (a última escrita na Map é vencedora), mas pode resultar em trabalho duplicado para os mesmos arquivos e em `refreshed` counts incorretos.

**Sugestão:** introduzir um `Set<string>` de paths em refresh para deduplicação:

```js
const _refreshingPaths = new Set();
// no início do loop:
if (_refreshingPaths.has(p)) continue;
_refreshingPaths.add(p);
// no finally:
_refreshingPaths.delete(p);
```

---

### P2-10 · `io-parser.js` — Worker overload retorna `parseError` sem símbolos; outros erros fazem fallback

A assimetria de tratamento de erros no `parseFileSymbols`:

```js
} catch (error) {
    const errorCode = getParserWorkerRuntimeErrorCode(error);
    if (
        errorCode === 'ERR_IO_PARSER_WORKER_QUEUE_FULL' ||
        errorCode === 'ERR_IO_PARSER_WORKER_QUEUE_TIMEOUT' ||
        errorCode === 'ERR_IO_PARSER_WORKER_TIMEOUT'
    ) {
        base.parseError = '...';
        return base;    // ← retorna sem símbolos, sem fallback main-thread
    }
    _parserRuntimeStats.workerFallbacks += 1;
    // ← cai no parse main-thread (pode bloquear event loop)
}
```

Para erros de sobrecarga, retorna `{ symbols: [], parseError: '...' }` — o índice FTS5 registrará o arquivo como `status: 'failed'` com zero símbolos, impactando buscas simbólicas.

Para erros de crash do worker, cai silenciosamente no main thread, potencialmente bloqueando o event loop para arquivos grandes.

**Sugestão:** para erros de overload, também tentar o fallback main-thread para arquivos pequenos (`bytes < MAX_PARSE_BYTES / 10`), sacrificando latência em favor de corretude:

```js
if (isOverloadError && base.bytes < MAX_PARSE_BYTES / 10) {
    _parserRuntimeStats.workerFallbacks += 1;
    // cai no parse main-thread
} else {
    base.parseError = '...';
    return base;
}
```

---

### P2-11 · `io/fs/locked-writes.js` — `createOrReplaceFileAtomic` cria dir pai com lock separado

```js
export async function createOrReplaceFileAtomic(filePath, content, options = {}) {
    if (options.createParentDirs !== false) {
        await mkdirPathLocked(dirname(filePath), {   // ← lock no dirname
            recursive: true,
        });
    }
    return writeFileAtomic(filePath, content, options);  // ← lock no filePath
}
```

Os dois locks são adquiridos sequencialmente, não juntos. Uma corrida entre dois `createOrReplaceFileAtomic` para arquivos no mesmo diretório pode resultar em ambos chamando `mkdir` simultaneamente (o que é seguro pelo `recursive: true`), mas também em ambos entrando no `writeFileAtomic` simultaneamente com o lock do `filePath` individual. Isso é seguro por design, mas o lock do `dirname` é essencialmente inútil nesse contexto — cria overhead de lock desnecessário para cada escrita de novo arquivo.

**Sugestão:** se `createParentDirs: true`, usar `mkdirPathUnlocked` em vez de `mkdirPathLocked` (o lock relevante é o do `filePath` e já está em `writeFileAtomic`).

---

### P2-12 · `tools/file/read/read-file-content.js` — Stream path não usa `readThrough`

```js
const readThrough =
    resolvedReadStrategy === 'cached' && includeReadThrough !== false && stats.size >= MIN_READ_THROUGH_BYTES
        ? await warmReadThroughContext(resolved, {...})
        : null;
```

Quando `readStrategy=stream`, `readThrough` é sempre `null`. Arquivos grandes lidos via stream (o caso mais comum de uso da estratégia) nunca aquecem o cache de imports relacionados. A LLM-B precisaria de uma segunda chamada explícita para obter o contexto de imports, aumentando a latência de leitura semântica completa.

**Sugestão:** executar `warmReadThroughContext` de forma `void` (fire-and-forget) também para o path de stream, desde que `includeReadThrough !== false`.

---

## 5. P3 — Qualidade de Código e Issues Menores

### P3-1 · Redundância: `content.length` na chave do `_fileContextCache`

**Arquivo:** `io-parser.js`, `buildFileContextCacheKey`.

```js
return `${normalized}\u0000${content.length}\u0000${hash}`;
```

O SHA-256 (`hash`) já identifica univocamente o conteúdo. `content.length` é redundante e adiciona 10–20 bytes por chave sem valor de segurança. Remover e usar apenas `${normalized}\u0000${hash}`.

---

### P3-2 · `module-map.js` — fallback de `Object.groupBy` pode ser removido no Node 24

```js
const objectCtor = /** @type {{ groupBy?: ... }} */ (Object);
if (typeof objectCtor.groupBy === 'function') {
    // ...
} else {
    // fallback manual
}
```

`Object.groupBy` é estável desde Node 22. No Node 24.5, o guard e fallback são letra morta. Pode ser removido sem substituição.

---

### P3-3 · `runtime/transaction.js` — fallback de `structuredClone` pode ser removido no Node 24

```js
const structuredCloneFn = globalThis.structuredClone;
if (typeof structuredCloneFn === 'function') {
    return structuredCloneFn(value);
}
return JSON.parse(JSON.stringify(value));  // ← fallback morto no Node 24
```

`structuredClone` está disponível globalmente desde Node 17. No Node 24, a linha de fallback nunca é executada.

---

### P3-4 · `io/fs/read-chunks.js` — `Array.fromAsync` com cast desnecessário

```js
const arrayCtor = /** @type {any} */ (Array);
const chunks = await arrayCtor.fromAsync(iterateTextLineChunks(...))
```

`Array.fromAsync` é estável desde Node 22. Em Node 24.5, o cast pode ser removido:

```js
const chunks = await Array.fromAsync(iterateTextLineChunks(...));
```

---

### P3-5 · `io/fs/read-chunks.js` — `ReadableStream.from()` com guard desnecessário

```js
const readableStreamCtor = globalThis.ReadableStream;
if (typeof readableStreamCtor?.from === 'function') {
    return readableStreamCtor.from(iterable);
}
return new ReadableStream({ ... });
```

`ReadableStream.from()` está disponível desde Node 22. O guard e fallback podem ser removidos.

---

### P3-6 · `io-parser.js` — `STALE_PROBE_INTERVAL_MS = -1` não documentado publicamente

O valor `-1` desabilita toda validação de fingerprint (modo legacy). Isso está comentado no módulo mas não há uma constante nomeada nem validação:

```js
// Se STALE_PROBE_INTERVAL_MS < 0 → nunca valida (modo paranoico reverso)
```

Considerar uma constante explícita:

```js
const FINGERPRINT_DISABLED = -1;
const FINGERPRINT_ALWAYS   =  0;
```

E validar no `readEnvPositiveInt` com valor especial documentado em `README`.

---

### P3-7 · `io/jsonl-file-writer.js` — `sizes` Map sem evicção

```js
const sizes = new Map();  // path → lastKnownSize, nunca evictado
```

Para um servidor de longa duração que escreve em muitos arquivos de log, o Map cresce indefinidamente. Bounded por `MAX_WEBHOOKS` na prática para logs de webhook, mas não para audit logs gerais.

---

### P3-8 · `io-health.js` — Objeto fallback de `getParserCacheStats` desincronizado

O objeto hardcoded como fallback no `safeCall(getParserCacheStats, {...})` tem ~30 campos. Se novos campos forem adicionados a `getParserCacheStats()`, o fallback não os incluirá, quebrando consumidores que dependem de uma shape consistente. Sugestão: retornar apenas `{ error: '...' }` no fallback e deixar consumidores lidar com campos ausentes.

---

### P3-9 · `io-locks.js` — `activeLeases` sem limite de tamanho

`activeLeases: Map<string, {...}>` cresce com cada lease ativo e é removida no release. Se um bug externo causar leak de lease (release nunca chamado), o Map cresce indefinidamente. O `MAX_ACTIVE_LEASE_SAMPLE = 32` limita apenas o que é **reportado** em `getIoLockStats()`, não o tamanho real do Map.

**Sugestão:** adicionar verificação periódica de leases com `ageMs > threshold` e emitir alerta via `publishIoLifecycleEvent`.

---

### P3-10 · `io-scanner.js` — `evaluateIoPathPolicyAsync` por entry quando `redactProtectedPaths=true`

Para um diretório com 1000 entries, isso gera 1000 chamadas async à policy, mesmo que todas apontem para o mesmo workspace e resultem em `policy.ok = true`. Considerar um cache simples de resultados de policy keyed por prefixo de path durante a duração de um único scan.

---

### P3-11 · `lockfile.js` — `legacyLeases` sem limpeza para leases que falharam ao ser adquiridos

```js
export async function acquireLock(lockPath) {
    const normalizedPath = path.resolve(lockPath);
    if (legacyLeases.has(normalizedPath)) return false;
    try {
        const lease = await acquireFileResourceLock(normalizedPath, { timeoutMs: 0, ... });
        legacyLeases.set(normalizedPath, lease);   // só é inserido em sucesso
        return true;
    } catch (error) {
        const code = error?.code;
        if (code === 'ETIMEDOUT') return false;
        throw error;   // outros erros propagam sem limpar o Map
    }
}
```

Se `acquireFileResourceLock` lançar com um código diferente de `ETIMEDOUT`, o `throw` propaga. Como `legacyLeases` nunca teve a entrada inserida, não há leak — esse P3 é apenas sobre consistência de contrato: o caller recebe uma exceção e pode tentar novamente com `acquireLock`, que deveria funcionar sem problema. Contudo, o comportamento é ligeiramente surpreendente para callers que não esperam exceções além de `ETIMEDOUT`.

---

### P3-12 · `io-cache-l2-sqlite.js` — `capSizeIfNeeded` não considera pending sets no count

`stmtCount.get()?.total` conta apenas entradas **persistidas**. As entradas em `pendingSets` (ainda não flushadas) não são contabilizadas. O cache pode temporariamente exceder `maxEntries` em até `setBatchMaxEntries` (padrão: 256) entradas sem triggering eviction. Não é um bug grave (é auto-corrigido no próximo flush), mas o `getStats().size` reportará um valor menor que o real.

---

### P3-13 · `io/patch/text-patch.js` — `findOccurrenceOffsets` O(n×m) sem early exit

Para arquivos grandes com muitas ocorrências, `findOccurrenceOffsets` coleta **todas** as posições antes de validar `expectedOccurrences`. Se `expectedOccurrences = 1` mas existem 1000 ocorrências, a função percorre o arquivo inteiro antes de lançar o erro. Um early exit após `expectedOccurrences + 1` achados seria suficiente.

---

### P3-14 · `sse/utils.js` — gzip stream sem cleanup explícito em `close()`

```js
close: () => {
    if (!out.writableEnded) {
        if (gzStream) gzStream.end();   // correto para fechar o gzip
        else res.end();
    } else {
        cleanup();   // ← mas se gzStream.end() já triggera finish → cleanup, tudo bem
    }
},
```

Se `gzStream.end()` falhar (ex.: broken pipe), `cleanup()` pode não ser chamado porque o `res.on('finish', cleanup)` não dispara. O `res.on('error', cleanup)` deveria disparar, mas para streams piped, o evento de erro pode não propagar automaticamente. Adicionar `gzStream.on('error', () => cleanup())` para cobrir esse caso.

---

## 6. Lacunas Arquiteturais

### GAP-1 · Sem sistema formal de versionamento de schema SQLite

`ensureIoIndexSchema` e `ensureIoL2Schema` usam `CREATE TABLE IF NOT EXISTS` e checks manuais de colunas (`PRAGMA table_info`). O check de colunas está implementado para `dev` e `ino`:

```js
if (!columns.has('dev')) db.exec('ALTER TABLE copilot_io_index_files ADD COLUMN dev INTEGER');
if (!columns.has('ino')) db.exec('ALTER TABLE copilot_io_index_files ADD COLUMN ino INTEGER');
```

Mas não há uma tabela de versões de schema (`copilot_schema_migrations`). Futuras migrações precisarão de checks igualmente manuais, o que é frágil e propenso a inconsistências entre deploys de ambientes diferentes.

**Sugestão:** introduzir uma tabela `copilot_schema_version` e um sistema simples de migrations sequenciais, similar ao que SQLite típico usa:

```sql
CREATE TABLE IF NOT EXISTS copilot_schema_version (
    version   INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL,
    description TEXT
);
```

---

### GAP-2 · Sem tool de execução de rollback

O sistema de rollback é robusto: `buildMutationChangeSet` produz `changeSet.rollback.token` (base64url de `IoRollbackToken`), e `rollbackToken.steps` descreve exatamente quais operações reverter. Contudo, **não existe nenhuma tool `rollback_change_set`** para a LLM-B executar o rollback. Os tokens são emitidos mas nunca consumidos por nenhum executor automatizado.

**Sugestão:** implementar `rollback_change_set`:

```js
parameters: z.object({
    token: z.string().describe('Token de rollback retornado por write/patch/delete tools.'),
    dryRun: z.boolean().optional().default(true),
})
```

O executor usaria `parseIoRollbackToken(token)` e executaria os `steps` em ordem reversa, usando `snapshotBase64` ou `rollbackSidecar` para restaurar.

---

### GAP-3 · Sem tool `workspace_scope_invalidate_path`

`invalidateScopePath(sessionId, filePath)` existe na API pública do módulo (`public/session.js`) mas **não tem tool correspondente**. A LLM-B precisa usar `workspace_scope_refresh` com `modifiedPaths` como workaround, que faz re-parse completo em vez de apenas invalida o cache. Para fluxos onde a LLM-B edita um arquivo e quer atualizar o scope sem re-parsear imediatamente, isso é ineficiente.

---

### GAP-4 · `workspace_scope_declare` — sem notificação de evicção por limite de escopos

Quando `IO_MAX_ACTIVE_SCOPES = 10` é atingido e um novo escopo é declarado, o escopo LRU é silenciosamente fechado. A LLM-B não recebe nenhuma indicação de que seu scope anterior foi descartado. Chamadas subsequentes a `workspace_scope_context(sessionId)` ou `workspace_scope_find_symbol(sessionId)` retornam `null`, que é indistinguível de "nunca foi declarado".

**Sugestão:** em `enforceScopeLimit`, emitir um `publishIoLifecycleEvent('scope', 'evicted', {...})` com o `sessionId` evictado. Consumidores de observabilidade poderiam logar um aviso.

---

### GAP-5 · Sem rate limiting para invocações de tools

As tools `patch_file`, `write_file_content` e `workspace_index_build` podem ser invocadas em loop pela LLM-B sem nenhum throttle no nível de infra. Um agente mal configurado pode saturar o filesystem ou o SQLite. O `resolveIoSearchBudget` controla I/O de busca mas não há equivalente para escritas.

---

### GAP-6 · `workspace_parse_file` e `workspace_index_find_symbol` não aceitam `workspaceRoot`

Assim como `workspace_index_build` (GAP da P1-4), essas tools fixam o `workspaceRoot` implicitamente via `WORKSPACE_ROOT` do boot. Em ambientes multi-workspace ou quando o workspace muda por configuração em runtime, as tools retornam caminhos relativos incoerentes com o contexto da LLM-B.

---

### GAP-7 · `io-index-sqlite.js` — índice FTS5 não armazena conteúdo de chunks separados

`copilot_io_index_chunks` armazena o conteúdo dos chunks mas eles **não são indexados no FTS5**. O `stmtInsertFts` insere o conteúdo completo do arquivo:

```js
stmtInsertFts.run(filePath, relativePath, input.content);
```

Chunks são armazenados na tabela `copilot_io_index_chunks` mas não são buscáveis via FTS5. A ferramenta `workspace_index_search` não tem acesso a resultados com `start_line`/`end_line`. Isso inviabiliza a LLM-B de fazer buscas que retornem o trecho exato (`snippet`) com sua localização de linha.

**Sugestão:** ao invés de inserir o arquivo inteiro no FTS5, inserir um registro por chunk com `start_line`/`end_line` como campos UNINDEXED:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS copilot_io_index_fts USING fts5(
    file_path   UNINDEXED,
    relative_path,
    chunk_index UNINDEXED,
    start_line  UNINDEXED,
    end_line    UNINDEXED,
    content,
    tokenize='porter unicode61 remove_diacritics 1'
);
```

---

### GAP-8 · Sem tool para listar/ler conteúdo de rollback sidecars

`persistRollbackSidecar` cria arquivos `.rollback` em `src/copilot/.ai/rollback/`. Não há tool para listar esses sidecars, ler seu conteúdo ou verificar a integridade do hash. Para fluxos de auditoria pós-falha, o operador precisa inspecionar o filesystem manualmente.

---

## 7. Oportunidades de Upgrade — Node 24.5

### UPG-1 · `node:sqlite` — substituir `better-sqlite3`

Node 24 inclui o módulo built-in `node:sqlite` (stable desde Node 24.x após período experimental no 22/23). Benefícios:

- Elimina a dependência nativa de `better-sqlite3` (que requer compilação nativa via `node-gyp`).
- Reduz o tamanho da imagem Docker.
- Garante compatibilidade garantida com a engine V8 do Node.

**Caveat:** a API é substancialmente diferente. `better-sqlite3` é síncrono por design; `node:sqlite` usa uma API similar mas com algumas operações async. A migração requer auditoria de todos os callers de `getCopilotDb()`.

**Prioridade:** média. Aguardar estabilidade confirmada na versão exata 24.5.

---

### UPG-2 · `import.meta.dirname` — substituir padrão `fileURLToPath + dirname`

**Node 21.2+**, estável no Node 24. O padrão atual em `module-map.js`:

```js
// ATUAL
import { fileURLToPath } from 'node:url';
import { dirname }       from 'node:path';
const modulePath = fileURLToPath(import.meta.url);
const infraRoot  = dirname(modulePath);
```

Pode ser simplificado para:

```js
// MODERNO — Node 24
const infraRoot = import.meta.dirname;
```

O mesmo padrão aparece em `io-parser.js` (`PARSER_WORKER_URL = new URL('./io-parser-worker.js', import.meta.url)`). Neste caso, `import.meta.resolve('./io-parser-worker.js')` retorna a URL resolvida sem precisar construir um `new URL(...)`.

---

### UPG-3 · `node:fs/promises.glob` — substituir implementação manual de glob

**Node 22+.** A implementação em `scan/glob.js` usa `minimatch` v10 com complexidade de configuração considerável (`MINIMATCH_OPTIONS`, `matchesPlainPathPattern`, `simpleGlobToRegExp`). O Node 24 expõe:

```js
import { glob } from 'node:fs/promises';

for await (const file of glob('src/**/*.js', { cwd: workspaceRoot })) {
    // ...
}
```

Isso não elimina a dependência de `minimatch` imediatamente (já que `glob` do Node tem semântica ligeiramente diferente), mas reduz o código de normalização de padrões.

---

### UPG-4 · `AbortSignal.any()` — combinar múltiplos signals

**Node 22+.** Em vários pontos do código, timeout e signal externo são gerenciados separadamente:

```js
// Em io-locks.js: waitForPrevious
if (options.timeoutMs === undefined && !options.signal) {
    return previous.catch(() => undefined);
}
// Setup manual de timeout + signal listener
```

Com `AbortSignal.any([timeoutSignal, options.signal].filter(Boolean))`, a lógica seria consolidada:

```js
// MODERNO
const combined = AbortSignal.any([
    ...(options.timeoutMs ? [AbortSignal.timeout(options.timeoutMs)] : []),
    ...(options.signal ? [options.signal] : []),
]);
return previous.catch(() => undefined);  // combined usado nas operações internas
```

---

### UPG-5 · `Array.fromAsync`, `ReadableStream.from`, `Object.groupBy` — remover guards

Conforme detalhado em P3-2, P3-3, P3-4, P3-5: os guards e fallbacks para essas APIs são letra morta no Node 24 e adicionam complexidade desnecessária. Remoção segura e imediata.

---

### UPG-6 · `node:worker_threads` — usar `worker.hasRef()` para diagnóstico

Node 24 adiciona `worker.hasRef()`. Em `io-parser.js`, `worker.unref?.()` é chamado mas não há forma de verificar o estado atual. Usar `hasRef()` em health checks para confirmar que os workers estão devidamente unref'd.

---

### UPG-7 · Permission Model (`--permission` flag)

O Node 24 tem um modelo de permissões estável que pode restringir acesso ao filesystem no nível do processo:

```bash
node --permission --allow-fs-read=/workspaces/projeto --allow-fs-write=/workspaces/projeto server.js
```

Isso complementaria a `evaluateIoPathPolicyAsync` existente com uma barreira de segurança no nível do OS, impedindo que bugs de bypass de policy resultem em acesso real ao filesystem fora do workspace.

---

### UPG-8 · `node:crypto` — `subtle.digest` para hashing assíncrono de arquivos grandes

`sha256` em `shared/hash.js` usa `createHash` síncrono. Para arquivos maiores que `IO_PARSER_MAX_BYTES` (2MB), o hashing bloqueia o event loop brevemente. `crypto.subtle.digest('SHA-256', buffer)` é assíncrono e não bloqueia:

```js
// MODERNO
export async function sha256Async(content) {
    const buf = typeof content === 'string'
        ? new TextEncoder().encode(content)
        : content;
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Buffer.from(hash).toString('hex');
}
```

Aplicável especialmente em `io-index-sqlite.js` durante builds de diretório com arquivos grandes.

---

### UPG-9 · `--experimental-transform-types` + TypeScript nativo

Node 24 inclui suporte experimental para executar TypeScript diretamente via `--experimental-strip-types`. O projeto usa `@ts-check` e JSDoc extensivamente — uma migração gradual para TypeScript nativo (`.ts`) eliminaria os comentários JSDoc de tipagem e habilitaria verificação de tipos em tempo de compilação, não apenas via Language Server.

---

### UPG-10 · V8 compile cache + startup snapshots

Para CLIs como `copilot:index`, Node 24 suporta:

```bash
node --build-snapshot copilot-index-snapshot.js
node --snapshot-blob snapshot.blob copilot:index build ...
```

Isso reduz o tempo de startup de ferramentas CLI que hoje carregam toda a cadeia de módulos (`io-engine`, `io-index-sqlite`, `io-scanner`, `io-parser`) a cada invocação.

---

## 8. Checklist de Remediação Rápida

Itens que podem ser implementados em menos de 30 minutos cada, sem risco de regressão significativa:

| #   | Arquivo                                | Ação                                                                                      | Prioridade |
| --- | -------------------------------------- | ----------------------------------------------------------------------------------------- | ---------- |
| 1   | `io-cache.js`                          | Substituir `Number(env)` por `readEnvPositiveInt` em 4 constantes                         | **P0**     |
| 2   | `io-cache-l2-sqlite.js`                | Adicionar `.unref?.()` no `setBatchTimer`                                                 | **P0**     |
| 3   | `io/fs/read-chunks.js`                 | Implementar LRU (delete+set) no `byteLineIndexCache`                                      | **P1**     |
| 4   | `io-parser.js` + `io-parser-worker.js` | Extrair `extractSymbolsFromAst` para `parse/js-ast-extractor.js`                          | **P1**     |
| 5   | `io/fs/locked-mutations.js`            | Pular `writeAtomicFileUnlocked` quando `patch.noop === true`                              | **P1**     |
| 6   | `tools/file/index-tools.js`            | Adicionar `workspaceRoot` ao `workspace_index_build`                                      | **P1**     |
| 7   | `io-index-registry.js`                 | Armazenar e expor unregister do hook no `resetIoIndexForTest`                             | **P2**     |
| 8   | `io/search/subprocess.js`              | Adicionar `setTimeout(SIGKILL, 3000).unref()` após SIGTERM                                | **P2**     |
| 9   | `io-cache.js`                          | Adicionar purge periódico: `setInterval(() => _lru.purgeStale(), DEFAULT_TTL_MS).unref()` | **P2**     |
| 10  | `tools/file/write-tools.js`            | Adicionar `expectedSourceHash` ao schema de `copy_file`                                   | **P2**     |
| 11  | `io/patch/text-patch.js`               | Adicionar early exit em `findOccurrenceOffsets` quando `expectedOccurrences` atingido     | **P3**     |
| 12  | `module-map.js`                        | Remover fallback `countBy` / usar `Object.groupBy` diretamente                            | **P3**     |
| 13  | `runtime/transaction.js`               | Remover fallback JSON do `structuredClone`                                                | **P3**     |
| 14  | `io/fs/read-chunks.js`                 | Remover cast `(Array)` de `Array.fromAsync` e guard de `ReadableStream.from`              | **P3**     |
| 15  | `io-parser.js`                         | Remover `buildFileContextCacheKey` e usar apenas `hash` sem `content.length`              | **P3**     |
| 16  | `module-map.js`                        | Substituir `fileURLToPath(import.meta.url) + dirname()` por `import.meta.dirname`         | **UPG**    |

---

*Relatório gerado via auditoria manual line-by-line. Nenhuma ferramenta automatizada foi utilizada na fase de diagnóstico.*
*Referências: Node.js 24.5 Changelog, SQLite 3.46 docs, `lru-cache` v10.4, `better-sqlite3` v9, `@babel/parser` v7.25.*

---

## 9. Validação Codex contra o estado atual

**Rodada:** 14 de junho de 2026
**Escopo validado:** `src/copilot/infra/**`, `src/copilot/tools/file/**`, facades públicas e testes diretamente associados.
**Legenda:** `confirmado` requer correção; `parcial` tem fundamento, mas a causa/solução proposta precisa ajuste;
`já corrigido` não se reproduz mais; `rejeitado` não representa defeito no contrato atual; `oportunidade` é evolução,
não bug.

### 9.1 P0 e P1

| ID   | Status           | Validação atual                                                                                                                                                                                     |
| ---- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 | **confirmado**   | As cinco configs L1 ainda usam `Number(env)` sem fallback para `NaN`/valores fora do domínio. Severidade real: P1 de configuração/availability, pois `LRUCache` pode falhar cedo em alguns valores. |
| P0-2 | **parcial**      | Falta `unref`, mas o timer tem janela curta e não causa hang indefinido. É hardening de lifecycle, não P0.                                                                                          |
| P0-3 | **confirmado**   | Falha de recriação seta `_workerPoolDisabledByError` permanentemente até reset explícito. A solução deve também impedir restarts concorrentes do mesmo slot.                                        |
| P1-1 | **remediado**    | A FTS não armazena mais `file_path`; `rowid` referencia chunks e filtros de árvore usam range B-tree em `idx_io_index_chunks_file`, confirmado por `EXPLAIN QUERY PLAN`.                           |
| P1-2 | **já corrigido** | `warmReadThroughContext` já passa `{ snapshot: text }` para `parseAndCacheSymbols`, evitando a segunda leitura.                                                                                     |
| P1-3 | **já corrigido** | Extração Babel já está centralizada em `parse/babel-symbols.js`, usada pelo worker e pelo main thread.                                                                                              |
| P1-4 | **confirmado**   | `workspace_index_build` ainda omite `workspaceRoot`; o índice usa o diretório indexado como raiz relativa.                                                                                          |
| P1-5 | **já corrigido** | Hit válido já executa `delete + set`, promovendo a entrada no `Map` antes da evicção.                                                                                                               |
| P1-6 | **confirmado**   | `patchTextLocked` ainda chama `writeAtomicFileUnlocked` quando `patch.noop === true`.                                                                                                               |
| P1-7 | **confirmado**   | `pruneMissingRows` executa cinco deletes por arquivo fora de uma transação agregadora.                                                                                                              |

### 9.2 P2

| ID    | Status                  | Validação atual                                                                                                                                                             |
| ----- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-1  | **rejeitado como race** | JavaScript executa o trecho síncrono sem interleaving; preservar a versão mais nova da mesma chave é o contrato correto de cache best-effort. Métricas de falha já existem. |
| P2-2  | **remediado**           | O signal do warm agora alcança scan, snapshots, prefetch, parse, fila/worker e build do índice; aborts deixam de ser convertidos em falhas parciais.                         |
| P2-3  | **confirmado ampliado** | Falta escalada para `SIGKILL` tanto no stop antecipado do streaming quanto nos caminhos timeout/abort/maxBuffer.                                                            |
| P2-4  | **rejeitado**           | Entradas stale permanecem alocadas até acesso/evicção, mas o cache já é estritamente limitado por `max` e `maxSize`; não há crescimento sem bounds.                         |
| P2-5  | **confirmado**          | A camada baixa aceita `expectedSourceHash`, mas `copy_file` não expõe a precondição.                                                                                        |
| P2-6  | **confirmado**          | `create_file` ainda força UTF-8 e não cria binário atomicamente em uma única chamada.                                                                                       |
| P2-7  | **remediado**           | `statfs` usa cache LRU curto por diretório/função, TTL configurável e bypass por `0`; falhas não permanecem cacheadas.                                                     |
| P2-8  | **confirmado**          | `io-index-registry` descarta o unregister e `resetIoIndexForTest` não desmonta/recria o hook.                                                                               |
| P2-9  | **confirmado**          | Refreshs concorrentes do mesmo escopo/path duplicam invalidação, leitura e parse. O guard deve ser por `sessionId + path`, não global por path.                             |
| P2-10 | **remediado**           | Overload/falha do worker faz fallback main-thread somente até `IO_PARSER_MAIN_THREAD_FALLBACK_MAX_BYTES` (128 KiB por padrão); acima do teto mantém backpressure.            |
| P2-11 | **rejeitado**           | O lock do diretório coordena `mkdir` com mutações concorrentes do mesmo recurso; removê-lo reduz garantias por ganho não demonstrado.                                       |
| P2-12 | **já corrigido**        | O planner atual permite read-through também para stream e retorna relatório explícito de execução/skip.                                                                     |

### 9.3 P3

| ID    | Status                          | Validação atual                                                                                                                             |
| ----- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-1  | **oportunidade rejeitada**      | O tamanho na chave é redundante criptograficamente, mas barato e útil para diagnóstico; não há defeito.                                     |
| P3-2  | **remediado**                   | `Object.groupBy` nativo substituiu o fallback manual e passou no strict typecheck ES2024.                                                    |
| P3-3  | **remediado**                   | `structuredClone` nativo é usado diretamente no runtime transacional.                                                                      |
| P3-4  | **remediado com bridge de tipos** | Guard/fallback foi removido; `lib: ES2024` ainda não declara `Array.fromAsync`, portanto resta apenas um cast localizado via `unknown`.     |
| P3-5  | **remediado com bridge de tipos** | Guard/fallback foi removido; os tipos DOM ES2024 ainda não declaram `ReadableStream.from`, exigindo bridge localizada.                      |
| P3-6  | **remediado**                   | Contrato `-1/0/>0` possui parser validado e agora está documentado na referência humana de `infra`.                                         |
| P3-7  | **confirmado**                  | `sizes` cresce com paths rotativos/dinâmicos durante toda a vida do writer. Precisa limite ou limpeza por path inativo.                     |
| P3-8  | **confirmado**                  | O fallback de health replica manualmente a shape extensa do parser e tende a drift.                                                         |
| P3-9  | **remediado**                   | Leases acima de `IO_LOCK_ACTIVE_LEASE_WARN_MS` geram evento `copilot.io.lock/lease.stale`, métrica e alerta de health, sem evicção insegura. |
| P3-10 | **parcial**                     | Há uma policy async por entry. Otimização exige preservar checks de symlink/realpath e deve ser guiada por benchmark.                       |
| P3-11 | **rejeitado**                   | Não existe leak: a entrada só é criada após aquisição bem-sucedida e erros não-`ETIMEDOUT` devem propagar.                                  |
| P3-12 | **já mitigado**                 | `getStats()` força flush antes de contar; excesso temporário é limitado pela janela/batch e corrigido no flush.                             |
| P3-13 | **remediado no caso seguro**    | Com `expectedOccurrences`, a busca encerra em `expected + 1` e reporta contagem mínima; casos que precisam total exato continuam completos. |
| P3-14 | **confirmado**                  | O gzip não possui listener próprio de erro/cleanup e o lifetime timer não é `unref`.                                                        |

### 9.4 Gaps e upgrades

| ID     | Status                              | Validação atual                                                                                                                              |
| ------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-1  | **remediado**                       | O index-store possui migrations sequenciais próprias, versão atual 2, execução transacional e integração pela migration global 15.          |
| GAP-2  | **remediado**                       | Tokens v3 carregam precondições/snapshots completos; executor faz dry-run ou apply sob locks, e a tool exige confirmação e registra auditoria. |
| GAP-3  | **confirmado**                      | `invalidateScopePath` é público em infra, mas não existe tool local correspondente.                                                          |
| GAP-4  | **confirmado**                      | Evicção LRU de scope não produz evento nem retorno observável ao consumidor.                                                                 |
| GAP-5  | **remediado como advisory**         | Budget rolante comum mede operações, bytes estimados e concorrência em mutações workspace-bound e builds, com evento/health sem bloquear I/O. |
| GAP-6  | **parcial**                         | `workspace_parse_file` opera com `WORKSPACE_ROOT` canônico e path validado; multi-workspace requer mudança sistêmica, não parâmetro isolado. |
| GAP-7  | **remediado**                       | Cada linha FTS referencia um chunk persistido; resultados incluem `chunkIndex`, `startLine` e `endLine`, inclusive após backfill legado.     |
| GAP-8  | **remediado com restrição segura**  | Tool lista metadados e verifica conteúdo internamente; leitura valida diretório, nome, expiração, tamanho, hash e não segue symlink.           |
| UPG-1  | **adiado**                          | Migração para `node:sqlite` tem blast radius alto e não deve ser misturada com correções funcionais.                                         |
| UPG-2  | **remediado no ponto aplicável**    | `module-map.js` usa `import.meta.dirname`; URLs de worker permanecem com `new URL()` por expressarem melhor a referência de módulo.           |
| UPG-3  | **adiado**                          | `fs.promises.glob` não é substituição semântica direta para o contrato atual de minimatch.                                                   |
| UPG-4  | **avaliado e não aplicável agora**  | Não há composição de múltiplos signals em `infra`; listeners atuais carregam semântica de fila, restart e cleanup que `any()` não substitui. |
| UPG-5  | **remediado com limite de tipos**   | Fallbacks de Node 24 foram removidos; duas APIs recentes mantêm bridges locais porque o projeto fixa `lib: ES2024`.                            |
| UPG-6  | **rejeitado**                       | Node 24.15.0 não expõe `Worker.hasRef()`; o método existe em `MessagePort`, não em `Worker`. Verificado diretamente no runtime alvo.         |
| UPG-7  | **oportunidade operacional**        | Permission Model é defesa adicional de processo e requer desenho de entrypoint/container.                                                    |
| UPG-8  | **rejeitado como solução geral**    | `subtle.digest` ainda materializa o buffer inteiro; para arquivos grandes, hashing incremental/streaming é a solução adequada.               |
| UPG-9  | **adiado**                          | Migração ampla para TypeScript nativo foge do ciclo de correção e depende de estratégia de build/runtime.                                    |
| UPG-10 | **adiado**                          | Snapshots/compile cache precisam benchmark de startup e pipeline dedicado.                                                                   |

### 9.5 Evidências de implementação — Faixa 1

- [x] Runtime confirmado: Node.js `v24.15.0`, compatível com `engines.node >=24.0.0`.
- [x] Testes focados de infra/tools/terminal: `215/215` passaram.
- [x] Testes dos consumidores de health/parser: `62/62` passaram.
- [x] `npm run typecheck:strict:src.copilot` passou após tratar explicitamente degradação de parser.
- [x] ESLint focado passou em todos os arquivos alterados da faixa.
- [x] `npm run lint:copilot` passou para `src/copilot` e `tests/unit/copilot`.
- [x] `git diff --check` passou sem whitespace errors.
- [ ] `npm run typecheck:strict:tests.unit` não é baseline verde: falha em centenas de fixtures e scripts
      preexistentes fora desta faixa; os erros não foram usados para mascarar o gate estrito de produção.
- [x] UPG-6 foi revalidado diretamente no runtime: `Worker.prototype.hasRef` e `worker.hasRef` são `undefined`.
- [x] P2-5 revelou e corrigiu um gap adicional: `copyFileLocked` descartava a precondição recebida pela tool.

**Itens remediados nesta faixa:** P0-1, P0-2, P0-3, P1-4, P1-6, P1-7, P2-3, P2-5, P2-6,
P2-8, P2-9, P3-7, P3-8, P3-14, GAP-3, GAP-4. UPG-6 foi rejeitado por evidência de runtime.

### 9.6 Evidências de implementação — Faixa 2

- [x] Cancelamento propagado de session scope até scanner, snapshots, prefetch, parser e build do índice.
- [x] Tarefa abortada é retirada da fila do parser; tarefa em voo é rejeitada e o slot afetado é reiniciado.
- [x] Builds com signal deixaram de compartilhar promise com callers de ownership distinto.
- [x] Leases antigas produzem uma única notificação por lease e aparecem em stats/health sem revelar paths.
- [x] Fallback síncrono do parser ficou restrito a payloads pequenos por teto explícito e observável.
- [x] Testes focados de scanner/parser/scope/index/locks/health: `89/89` passaram.
- [x] Testes focados finais do parser, incluindo os dois lados do limite de fallback: `46/46` passaram.
- [x] `npm run typecheck:strict:src.copilot` passou.
- [x] ESLint focado passou nos arquivos alterados da faixa.

**Itens remediados nesta faixa:** P2-2, P2-10 e P3-9.

### 9.7 Evidências de implementação — Faixa 3

- [x] Subschema do índice versionado em `copilot_io_index_schema_migrations`, com versão atual 2.
- [x] Migration global 15 aciona a mesma implementação canônica usada por bancos in-memory e callers diretos.
- [x] Banco legado com FTS por arquivo é backfillado para chunks antes da recriação da FTS.
- [x] Falha induzida ao registrar a versão 2 reverte `ALTER`, backfill e recriação da FTS integralmente.
- [x] FTS usa `rowid = chunk.id`; busca retorna `chunkIndex`, `startLine` e `endLine`.
- [x] Filtro scoped usa range lexicográfico e `idx_io_index_chunks_file`; `EXPLAIN QUERY PLAN` não faz scan dos chunks.
- [x] Workload reproduzível adicionado em `npm run analyze:io:index-workload`.
- [x] Amostra de 300 arquivos no Node 24.15.0: build `260,568 ms`, busca scoped média `2,154 ms`,
      invalidate `0,953 ms`, prune de 50 arquivos `74,482 ms`.
- [x] Testes focados de índice, tools, banco e io-engine: `124/124` passaram.
- [x] `npm run typecheck:strict:src.copilot`, ESLint focado e `git diff --check` passaram.

**Itens remediados nesta faixa:** P1-1, GAP-1 e GAP-7.

### 9.8 Evidências de implementação — Faixa 4

- [x] Todas as mutações `write/create/patch/delete/copy/move` foram confrontadas com seus tokens e estados anterior/posterior.
- [x] Token v3 mantém compatibilidade de leitura com v1/v2 e inclui `source`/`destination` para moves executáveis.
- [x] Snapshots binários são capturados dentro do lock; payloads grandes permanecem em sidecar durável verificado.
- [x] Executor faz preflight integral sob locks L0/L1 antes de aplicar e bloqueia hash, ausência ou move legado divergentes.
- [x] Aplicação retorna resultado por etapa, distingue falha parcial e invalida os tiers de cache após cada mutação.
- [x] Tool `rollback_file_changes` usa dry-run por padrão, exige `confirm=true` no apply, revalida paths e grava auditoria.
- [x] Tool `rollback_sidecars_status` não expõe path absoluto nem conteúdo e pode verificar hash/tamanho sob demanda.
- [x] Budget advisory rolante cobre mutações da capability workspace e builds reais de índice, sem cobrar builds coalescidos.
- [x] Pressão por operações, bytes ou concorrência é publicada em `copilot.io.budget` e projetada no health snapshot.
- [x] Casos de snapshot inline, arquivo vazio, sidecar, delete, move com overwrite e stale hash têm cobertura direta.
- [x] Testes focalizados finais: `74/74` passaram.
- [x] `npm run typecheck:strict:src.copilot` e ESLint focalizado passaram.

**Itens remediados nesta faixa:** GAP-2, GAP-5 e GAP-8. A implementação também corrigiu tokens incompletos de
`write_file_content`, overwrite em `create_file`/`copy_file` e a ordem de restauração de `move_file`.

### 9.9 Evidências de implementação — Faixa 5

- [x] `Object.groupBy`, `structuredClone` e `import.meta.dirname` são usados diretamente no baseline Node 24.
- [x] Guards/fallbacks de `Array.fromAsync` e `ReadableStream.from` foram removidos; bridges tipadas locais preservam
      `lib: ES2024` sem ampliar globalmente o contrato do compilador.
- [x] Novo módulo de budget foi incluído no inventário executável; o gate de drift voltou a cobrir toda a raiz.
- [x] Capacity preflight reutiliza `statfs` por até 1 segundo, limita o cache a 256 entradas e remove promises falhas.
- [x] Patch com `expectedOccurrences` encerra cedo após encontrar uma ocorrência excedente e explicita contagem não exata.
- [x] Referência humana de envs documenta L1 stale probe, capacity preflight, parser fallback e budget advisory.
- [x] `AbortSignal.any()` foi confrontado com todos os pontos de abort em `infra`; não existe composição de signals que
      justifique substituir handlers com semântica adicional.
- [x] Benchmark local de SHA-256, 32 MiB × 5 no Node 24.15.0: `createHash` contíguo `535,6 MiB/s`, chunks de 1 MiB
      `532,7 MiB/s`, `subtle.digest` contíguo `399,3 MiB/s`.
- [x] Snapshot grande já calcula hash incremental enquanto lê/escreve sidecar; migrar para WebCrypto aumentaria
      materialização sem ganho observado.
- [x] Testes focalizados: `49/49` passaram; strict typecheck e ESLint focalizado passaram.

**Itens remediados nesta faixa:** P2-7, P3-2, P3-3, P3-4, P3-5, P3-6, P3-13, UPG-2 e UPG-5.
UPG-4 foi rejeitado no estado atual por ausência de composição real; UPG-8 permanece rejeitado como solução geral.

## 10. Roadmap sistêmico de implementação

### Fase 0 — Evidência e baseline

- [x] Ler integralmente a auditoria externa.
- [x] Confrontar todos os itens P0/P1/P2/P3/GAP/UPG com o código atual.
- [x] Separar bugs confirmados, itens já corrigidos, hipóteses parciais, rejeições e oportunidades.
- [x] Preservar alterações preexistentes fora do escopo da auditoria.
- [x] Executar baseline focado de testes, lint e typecheck strict no Node 24.15.0 do repositório.

### Fase 1 — Correções de baixo risco e alto retorno

- [x] Validar e normalizar todas as envs do cache L1, preservando `STALE_PROBE=-1/0/>0`.
- [x] Tornar o timer de batch L2 não bloqueante para lifecycle.
- [x] Pular escrita, durabilidade e invalidação física em patch textual no-op.
- [x] Fixar `workspaceRoot` canônico no build de índice disparado por tool.
- [x] Envolver poda de arquivos ausentes em transação única.
- [x] Tornar hook do registry do índice desmontável em testes.
- [x] Expor e honrar `expectedSourceHash` em `copy_file` e `copyFileLocked`.
- [x] Adicionar `encoding=base64` atômico em `create_file`.
- [x] Adicionar tool local `workspace_scope_invalidate_path`.
- [x] Adicionar cleanup e escalada de sinal aos subprocessos de busca.
- [x] Cobrir correções com testes unitários focados.

### Fase 2 — Resiliência concorrente e lifecycle

- [x] Implementar restart serializado e recuperável do worker pool com backoff limitado.
- [x] Rejeitar `Worker.hasRef()` após prova negativa no Node 24.15.0 e manter apenas métricas suportadas de restart/lifecycle.
- [x] Deduplicar refresh concorrente por `sessionId + path`.
- [x] Propagar cancelamento do warm até scan, parse e index onde o contrato permitir.
- [x] Emitir evento observável na evicção LRU de scopes.
- [x] Limitar o mapa de tamanhos do writer JSONL.
- [x] Simplificar fallback de health do parser sem drift de shape.
- [x] Adicionar alerta observável para leases excessivamente antigas.
- [x] Limitar fallback main-thread do parser a arquivos pequenos sob teto configurável.
- [x] Corrigir cleanup/erro/unref do gzip SSE.

### Fase 3 — Índice, schema e busca localizada

- [x] Introduzir versionamento transacional de schema para estruturas de I/O.
- [x] Projetar mapping indexado de path para linhas FTS sem scan de coluna `UNINDEXED`.
- [x] Migrar FTS para resultados por chunk com `startLine`/`endLine`.
- [x] Preservar compatibilidade de bancos existentes e rollback de migration.
- [x] Adicionar workload parametrizável de invalidate/search/prune para workspaces grandes.

### Fase 4 — Rollback operacional e governança de tools

- [x] Auditar completude dos rollback tokens para cada write/patch/delete/copy/move.
- [x] Implementar executor dry-run de rollback com verificação de hash/precondições.
- [x] Implementar aplicação explícita de rollback com auditoria e resultado por etapa.
- [x] Adicionar listagem/verificação segura de sidecars sem expor conteúdo sensível.
- [x] Criar orçamento advisory comum para writes, patches e builds de índice.

### Fase 5 — Modernizações Node 24 guiadas por gates

- [x] Remover fallbacks mortos de APIs Node 24 somente após typecheck/lint/test focados.
- [x] Adotar `import.meta.dirname` onde simplifica sem reduzir clareza.
- [x] Avaliar `AbortSignal.any()` nos fluxos com composição real de signals.
- [x] Medir hashing incremental versus opções assíncronas para payloads grandes.
- [x] Avaliar `node:sqlite`, Permission Model e snapshots em roadmaps próprios, mantendo-os fora desta remediação.

### Fase 6 — Validação contínua e entrega

- [x] Rodar testes unitários diretamente associados após cada subfase.
- [x] Rodar `typecheck:strict:src.copilot`.
- [x] Rodar lint escopado nos arquivos alterados e, depois, `lint:copilot`.
- [ ] Rodar suíte unitária de `infra` e `tools/file`.
- [ ] Rodar suíte máxima de `src/copilot` compatível com o ambiente.
- [x] Revisitar esta matriz após a primeira faixa e marcar apenas itens comprovadamente concluídos.
- [x] Criar commits coesos, fazer push e continuar pelas fases seguintes.
