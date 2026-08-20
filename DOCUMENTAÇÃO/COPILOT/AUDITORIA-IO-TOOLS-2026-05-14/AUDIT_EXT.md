# Auditoria Arquitetural — `src/copilot` (infra + tools)

**Projeto:** Ilenburg1993/chatgpt-docker-puppeteer **Escopo:** `src/copilot/infra/**` e
`src/copilot/tools/**` **Stack:** Node.js 24+ (LTS "Krypton"), ESM, `@ts-check` strict, GitHub
Copilot SDK 0.3.0 **Data:** 14 de maio de 2026 **Autor:** Auditoria automatizada com revisão
arquitetural profunda

---

## Índice

1. [Sumário Executivo](#1-sumário-executivo)
2. [Bugs Confirmados (CRITICAL / HIGH)](#2-bugs-confirmados-critical--high)
3. [Gaps de Segurança](#3-gaps-de-segurança)
4. [Gaps de Funcionalidade / Observabilidade](#4-gaps-de-funcionalidade--observabilidade)
5. [Dívidas Técnicas e Code Smells](#5-dívidas-técnicas-e-code-smells)
6. [Oportunidades de Modernização (Node.js 24+)](#6-oportunidades-de-modernização-nodejs-24)
7. [Alinhamento com SDK 0.3.0](#7-alinhamento-com-sdk-030)
8. [Propostas Arquiteturais](#8-propostas-arquiteturais)
9. [Propostas de Correção por Arquivo](#9-propostas-de-correção-por-arquivo)
10. [Roadmap de Upgrades Priorizados](#10-roadmap-de-upgrades-priorizados)
11. [Apêndice: Inventário de Riscos](#11-apêndice-inventário-de-riscos)

---

## 1. Sumário Executivo

O subsistema `src/copilot` é um runtime agentic de produção sofisticado. A arquitetura barrel-first,
as facades públicas, o cache L1/L2, o índice FTS5 SQLite e o sistema de tools está bem estruturado.
Contudo, a auditoria identificou **12 bugs de alta severidade**, **9 gaps de segurança**, **18
dívidas técnicas significativas** e **~25 oportunidades de modernização** para Node.js 24+ e SDK
0.3.0.

**Score de saúde geral: 6.8/10** — sólido para MVP mas com riscos reais em produção sob carga.

---

## 2. Bugs Confirmados (CRITICAL / HIGH)

### BUG-CRIT-01 — Race condition no mutex de `withStore` (todo/store.js)

**Arquivo:** `src/copilot/tools/todo/store.js` **Severidade:** CRITICAL **Descrição:** O mutex
serial implementado com `Promise.resolve()` + chain tem um bug sutil: se `_storeMutex` for atribuído
com `_storeMutex.then(() => token)` antes de `await prev`, mas outro chamador chegar _entre_ a
atribuição do `tail` e o `await prev`, o token pode vazar para a cadeia do próximo chamador sem a
garantia de serialização.

```js
// PROBLEMA ATUAL
let release;
const token = new Promise((r) => { release = r; });
const prev = _storeMutex;
_storeMutex = _storeMutex.then(() => token);  // ← tail não está encadeada com token corretamente
await prev;
```

**Correção proposta:**

```js
// CORRIGIDO — usando padrão mutex serial canônico
let _storeMutex = Promise.resolve();

export async function withStore(fn) {
  const acquire = _storeMutex.then(() => {});
  let release = /** @type {() => void} */ (() => {});
  _storeMutex = new Promise((res) => { release = res; });
  await acquire;
  try {
    const store = await _readStoreRaw();
    const result = await fn(store);
    await _writeStoreRaw(store);
    return result;
  } finally {
    release();
  }
}
```

---

### BUG-CRIT-02 — `release` pode não ser chamada em erros síncronos no `withStore`

**Arquivo:** `src/copilot/tools/todo/store.js` **Severidade:** HIGH **Descrição:** Se
`_readStoreRaw()` lançar sincronamente (improvável mas possível em corrupção de DB), o `finally` no
bloco externo `await prev` não é alcançado porque `release` seria chamada no `finally` interno, mas
o `token` nunca resolveria.

**Correção:** O padrão proposto em BUG-CRIT-01 já cobre este caso.

---

### BUG-HIGH-01 — Deadlock potencial em `withIoResourceLocks` com chaves duplicadas

**Arquivo:** `src/copilot/infra/io-locks.js` **Severidade:** HIGH **Descrição:** A deduplicação via
`new Set(resourceKeys.map(...))` elimina duplicatas, mas se uma operação aninhada chamar
`withIoResourceLock` com uma chave que já está na fila interna de `withIoResourceLocks`, o lock
aninhado aguardará indefinidamente porque a chave pai nunca liberará até o filho resolver.

Exemplo problemático:

```js
// copyFileLocked → withIoResourceLocks([source, dest])
//   └─ dentro do callback → mkdirPathUnlocked → não usa lock, OK
//   └─ mas se tiver writeFileAtomic no mesmo path → deadlock
```

**Correção:** Adicionar contexto de lock reentrante via `AsyncLocalStorage`:

```js
// io-locks.js — adicionar
import { AsyncLocalStorage } from 'node:async_hooks';
const _heldLocks = new AsyncLocalStorage();

export async function withIoResourceLock(key, operation, options = {}) {
  const held = _heldLocks.getStore() ?? new Set();
  if (held.has(normalizeIoResourceKey(key))) {
    // Reentrante — executa diretamente
    const value = await operation();
    return { value, waitMs: 0 };
  }
  // ... lógica existente com _heldLocks.run(new Set([...held, key]), ...)
}
```

---

### BUG-HIGH-02 — Memory leak no `_symbolCache` do io-parser quando arquivos são deletados

**Arquivo:** `src/copilot/infra/io-parser.js` **Severidade:** HIGH **Descrição:** O
`registerInvalidationHook` registra uma função anônima que remove entradas do `_symbolCache`. Porém,
se o `io-cache.js` for reiniciado via `resetIoL1CacheForTest()`, os hooks registrados _não são
limpos_ — a função de invalidação aponta para o closure do `_symbolCache` antigo, mas os novos hooks
se acumulam indefinidamente no bus de invalidação.

**Evidência:**

```js
// io-parser.js linha ~75
registerInvalidationHook((filePath, event) => {
  // Este hook nunca é removido — mesmo após resetIoL1CacheForTest()
  const normalized = normalizeParserPath(filePath);
  _symbolCache.delete(normalized);
  ...
});
```

**Correção:**

```js
// Armazenar o unregister e expor cleanup
let _parserInvalidationUnregister = /** @type {(() => void) | null} */ (null);

function ensureInvalidationHook() {
  if (_parserInvalidationUnregister) return;
  _parserInvalidationUnregister = registerInvalidationHook((filePath, event) => {
    // ... lógica existente
  });
}

export function resetParserCacheForTest() {
  _symbolCache.clear();
  _parserInvalidationUnregister?.();
  _parserInvalidationUnregister = null;
}
```

---

### BUG-HIGH-03 — `readTextLineChunks` usa `readline` mas não fecha o stream em erros

**Arquivo:** `src/copilot/infra/io/fs/read-chunks.js` **Severidade:** HIGH **Descrição:** O
`createInterface` sobre `createReadStream` não tem tratamento de erro do stream subjacente. Se o
`ReadStream` emitir `'error'` (ex: arquivo deletado durante leitura), o `for await` lançará, mas o
`readline.Interface` e o stream ficam em estado indefinido sem cleanup explícito.

**Correção:**

```js
export async function readTextLineChunks(filePath, options = {}) {
  // ... validação de params ...
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      // ... lógica existente ...
    }
  } finally {
    rl.close();             // garante fechamento do interface
    stream.destroy();       // garante fechamento do stream
  }
  // ... resto do código ...
}
```

---

### BUG-HIGH-04 — `pruneMissingRows` em `io-index-sqlite.js` itera all rows mesmo sem extensão match

**Arquivo:** `src/copilot/infra/io-index-sqlite.js` **Severidade:** HIGH **Descrição:** A função
`pruneMissingRows` faz `stmtListIndexedUnderPath.all(normalizedRoot, ...)` que retorna **todos os
arquivos** sob o path no índice, e só filtra por extensão em JS. Para workspaces com 10k+ arquivos,
isso carrega todos os registros em memória antes de filtrar.

**Correção:**

```sql
-- Adicionar query filtrada por extensão ao schema
SELECT file_path as filePath, extension
FROM copilot_io_index_files
WHERE (file_path = ? OR file_path LIKE ?)
  AND extension IN (SELECT value FROM json_each(?))
ORDER BY file_path ASC
```

```js
// Em io-index-sqlite.js
const stmtListIndexedUnderPathFiltered = db.prepare(`
  SELECT file_path as filePath, extension
  FROM copilot_io_index_files
  WHERE (file_path = ? OR file_path LIKE ?)
    AND (? = '[]' OR extension IN (SELECT value FROM json_each(?)))
  ORDER BY file_path ASC
`);
```

---

### BUG-HIGH-05 — `safeEnv()` com cache TTL não é invalidado após mudança de `process.env`

**Arquivo:** `src/copilot/tools/shell/sandbox.js` **Severidade:** MEDIUM-HIGH **Descrição:** O cache
de `safeEnv()` tem TTL de 5s. Se uma variável sensível for adicionada a `process.env` durante uma
sessão (ex: via `loadEnvFile()` do SDK), o cache retornará o env antigo sem a nova variável removida
por até 5s. Pior: se a variável for adicionada _após_ o cache ser populado, ela vai passar pelo
filtro por um período.

**Correção:** Invalidar o cache sempre que `process.env` for modificado via `Proxy`, ou simplesmente
remover o cache TTL e recomputar a cada chamada (o custo de `Object.keys` + filter é
~microsegundos):

```js
export function safeEnv() {
  // Sem cache — recomputa sempre; custo negligível vs. fork de processo
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (sensitiveExact.has(key) || sensitivePattern.test(key)) delete env[key];
  }
  return /** @type {Record<string, string>} */ (env);
}
```

---

### BUG-HIGH-06 — `runPipeline` não fecha stdin do primeiro processo corretamente sob erro

**Arquivo:** `src/copilot/tools/shell/executor.js` **Severidade:** MEDIUM-HIGH **Descrição:** No
fluxo de erro (`proc.on('error', ...)`), `procs[0]?.stdin?.end()` só é chamado no final do setup,
mas se um processo intermediário falhar antes de `procs[0]` iniciar completamente, `stdin` pode
ficar aberto causando leak de file descriptor.

**Correção:**

```js
// Dentro do handler de error e do timer de timeout:
for (const p of procs) {
  p.stdout?.destroy();
  p.stderr?.destroy();
  p.stdin?.destroy();  // ← adicionar destroy em vez de só kill
  if (p.exitCode === null && !p.killed) p.kill('SIGTERM');
}
```

---

### BUG-MED-01 — `buildSimpleTextDiff` gera duplicatas de hunk quando mudanças são adjacentes

**Arquivo:** `src/copilot/infra/io/patch/text-diff.js` **Severidade:** MEDIUM **Descrição:** O
algoritmo itera linha por linha e quando encontra diferença emite um hunk de `contextLines` ao
redor. Porém, se duas mudanças estão dentro de `2*contextLines` linhas uma da outra, dois hunks
sobrepostos são emitidos sem merge, resultando em diff inválido com linhas duplicadas.

**Correção:** Usar algoritmo de diff por hunks consolidados (LCS-based ou diff-match-patch):

```js
// Alternativa: usar diff simples mas com merge de hunks sobrepostos
function mergeOverlappingHunks(hunks, contextLines) {
  const merged = [];
  for (const hunk of hunks) {
    const last = merged[merged.length - 1];
    if (last && hunk.start <= last.end + contextLines * 2) {
      last.end = Math.max(last.end, hunk.end);
      last.lines.push(...hunk.lines);
    } else {
      merged.push({ ...hunk });
    }
  }
  return merged;
}
```

---

### BUG-MED-02 — `io-cache-l2-sqlite.js` usa `lastAccessedMs` mas `stmtGet` não retorna o campo

**Arquivo:** `src/copilot/infra/io-cache-l2-sqlite.js` **Severidade:** MEDIUM **Descrição:** O
`stmtGet` não inclui `last_accessed_ms` no SELECT. O `stmtEvictOldest` ordena por
`last_accessed_ms ASC` para LRU, mas após `stmtTouch.run(nowMs, key)` a cache pode não ter o campo
atualizado em tempo para a próxima evicção se o SQLite não fizer flush imediato.

**Correção:** Garantir que o `stmtTouch` seja executado **dentro de uma transação** quando
`capSizeIfNeeded()` for chamado logo após:

```js
set(input) {
  try {
    const payload = toBuffer(input.payload);
    // ... setup ...
    const setAndCap = db.transaction(() => {
      stmtSet.run(/* ... */);
      capSizeIfNeeded();
    });
    setAndCap();
    // ...
  }
}
```

---

### BUG-MED-03 — `web_fetch_local` não valida redirect para URLs com porta não padrão

**Arquivo:** `src/copilot/tools/web/web-tools.js` **Severidade:** MEDIUM **Descrição:**
`fetchWithRedirectPolicy` usa `evaluateIoUrlPolicy` em cada redirect, mas a resolução de URL
relativa `new URL(location, currentUrl)` pode resultar em `http://internal-service:8080/` que passa
pelo validator se o hostname for público mas a porta aponta para serviço interno.

**Correção:** Adicionar verificação de porta para URLs redirecionadas:

```js
// Na função fetchWithRedirectPolicy, após evaluateIoUrlPolicy
const resolvedURL = new URL(resolvedUrl);
const DANGEROUS_PORTS = new Set([22, 25, 3306, 5432, 6379, 27017, 8080, 8443, 9200]);
if (DANGEROUS_PORTS.has(resolvedURL.port ? parseInt(resolvedURL.port, 10) : 0)) {
  throw new Error(`Redirect para porta de serviço interno bloqueado: ${resolvedURL.port}`);
}
```

---

### BUG-MED-04 — `sanitizeFtsQuery` pode gerar query FTS5 inválida com tokens de 1 char

**Arquivo:** `src/copilot/infra/index-store/sqlite/query.js` **Severidade:** MEDIUM **Descrição:** O
filtro `filter(Boolean)` elimina strings vazias mas não filtra tokens de 1 caractere que são
inválidos para FTS5 Porter stemmer e podem causar `SQLITE_ERROR: fts5: syntax error near "*"`.

**Correção:**

```js
export function sanitizeFtsQuery(query) {
  const tokens = query
    .split(/\s+/u)
    .map((part) => part.replace(/[^\p{L}\p{N}_./:-]+/gu, '').trim())
    .filter((t) => t.length >= 2);  // ← mínimo 2 chars para FTS5
  return tokens.length > 0
    ? tokens.map((token) => `"${token.replace(/"/gu, '""')}"`).join(' ')
    : '""';
}
```

---

## 3. Gaps de Segurança

### SEC-GAP-01 — Ausência de validação de `filePath` contra null bytes em `io-engine.js`

**Arquivo:** `src/copilot/infra/io-engine.js` — `readBytes`, `readText`, `writeFileAtomic`
**Severidade:** HIGH **Descrição:** As funções de I/O em `io-engine.js` não validam se `filePath`
contém null bytes (`\0`) antes de passar para `fs.readFile`. Em Node.js, um path com null byte lança
`ENOENT` ou comportamento undefined. Deveria lançar erro explícito antes de qualquer I/O.

**Correção:**

```js
// Adicionar no início de readBytes, readText, writeFileAtomic:
import { hasNullByte } from './policy/path-resource.js';

if (typeof filePath !== 'string' || hasNullByte(filePath)) {
  throw Object.assign(new TypeError(`Path inválido: ${String(filePath)}`), { code: 'ERR_INVALID_ARG_VALUE' });
}
```

---

### SEC-GAP-02 — `exec_command` permite bypass de blocklist via Unicode lookalike characters

**Arquivo:** `src/copilot/tools/shell/sandbox.js` **Severidade:** HIGH **Descrição:** Os patterns em
`BLOCKED_COMMAND_PATTERNS` usam `\b` para word boundaries, que não funciona com Unicode. `rm`
escrito com caractere Unicode similar (`ｒｍ`) poderia passar pelo blocklist.

**Correção:**

```js
// Adicionar normalização Unicode antes de qualquer validação
export function normalizeCommandForValidation(command) {
  return command.normalize('NFKC');  // Normaliza fullwidth/compatibilidade
}

// E em checkCommandBlocklist:
export function checkCommandBlocklist(command) {
  const normalized = normalizeCommandForValidation(command);
  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(normalized)) {
      return { ok: false, reason: `...` };
    }
  }
  return { ok: true };
}
```

---

### SEC-GAP-03 — `SseReplayBuffer` não tem limite de tamanho de payload

**Arquivo:** `src/copilot/infra/sse/replay-buffer.js` **Severidade:** MEDIUM **Descrição:** O buffer
circular limita o **número** de eventos mas não o **tamanho** de cada payload. Um evento com payload
de 10MB repetido `SSE_REPLAY_BUFFER_SIZE` vezes resultaria em `~10GB` em memória.

**Correção:**

```js
export class SseReplayBuffer {
  #maxPayloadBytes = 64 * 1024; // 64KB por evento

  push(event, data) {
    const serialized = JSON.stringify(data);
    if (Buffer.byteLength(serialized, 'utf8') > this.#maxPayloadBytes) {
      // Trunca ou omite payload grande
      data = { _truncated: true, _originalSize: serialized.length };
    }
    // ... resto
  }
}
```

---

### SEC-GAP-04 — `web_search` não sanitiza a query antes de enviar ao DDG

**Arquivo:** `src/copilot/tools/web/web-tools.js` **Severidade:** MEDIUM **Descrição:** A query é
passada diretamente para `encodeURIComponent` sem validação de comprimento. Uma query de 100KB
poderia gerar uma URL que ultrapassaria limites de servidor e revelar informações sensíveis em logs
de servidor remoto.

**Correção:**

```js
const MAX_QUERY_CHARS = 500;
const safeQuery = typeof query === 'string'
  ? query.slice(0, MAX_QUERY_CHARS).trim()
  : '';
if (!safeQuery) return { success: false, error: 'Query inválida.' };
```

---

### SEC-GAP-05 — Tokens em `process.env` vazam para `exec_command` via `safeEnv` incompleto

**Arquivo:** `src/copilot/tools/shell/sandbox.js` **Severidade:** MEDIUM **Descrição:** O filtro
`sensitivePattern` em `safeEnv()` remove vars com
`TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|PRIVATE_KEY`, mas não cobre: `GITHUB_APP_*`,
`NPM_CONFIG_*`, `DOCKER_PASSWORD`, `AWS_ACCESS_KEY_ID` (sem SECRET), `KUBECONFIG`, `HOME` (que pode
expor estrutura de diretórios).

**Correção:**

```js
const sensitivePattern = /TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|PRIVATE_KEY|KUBECONFIG|DOCKER_|AWS_ACCESS|GITHUB_APP_|NPM_CONFIG_/i;
// E explicitamente:
const sensitiveExact = new Set([
  // ... existentes ...
  'AWS_ACCESS_KEY_ID', 'KUBECONFIG', 'DOCKER_CONFIG', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY',
  'NPM_CONFIG_AUTHTOKEN', 'NPM_CONFIG__AUTH',
]);
```

---

### SEC-GAP-06 — `io-index-sqlite.js` não sanitiza `metadata` antes de persistir em JSON

**Arquivo:** `src/copilot/infra/io-index-sqlite.js` **Severidade:** LOW-MEDIUM **Descrição:** O
campo `metadataJson` é persistido como `JSON.stringify({...input.metadata})` sem validação de
profundidade ou tamanho. Objetos circulares ou muito profundos causariam `TypeError` ou JSON
extremamente grande.

**Correção:**

```js
function safeMeta(meta, maxBytes = 4096) {
  try {
    const json = JSON.stringify(meta ?? {});
    return json.length <= maxBytes ? json : JSON.stringify({ _truncated: true });
  } catch {
    return JSON.stringify({ _error: 'non-serializable' });
  }
}
```

---

### SEC-GAP-07 — `WebhookManager` não verifica Certificate Transparency ou pinning

**Arquivo:** `src/copilot/infra/webhooks.js` **Severidade:** LOW **Descrição:** `fetch()` usa a CA
padrão do sistema. Em ambientes Docker sem atualização de CA, webhooks HTTPS podem ser vulneráveis a
MITM se o certificado do servidor de destino for assinado por uma CA comprometida.

**Recomendação:** Usar `node:tls` com opção `minVersion: 'TLSv1.3'` para conexões de webhook
críticas.

---

### SEC-GAP-08 — `lockfile.js` é vulnerável a TOCTOU em `open('wx')` + `realpath` check

**Arquivo:** `src/copilot/infra/lockfile.js` **Severidade:** LOW-MEDIUM **Descrição:** Entre
`existsSync(dir)` e `mkdir(dir, { recursive: true })`, outro processo pode criar o diretório — isso
é inofensivo pois `recursive: true` tolera o caso. Contudo, entre `open(lockPath, 'wx')` e a leitura
de PID, um symlink poderia ser injetado.

**Correção:** Usar `openat()` ou verificar que `lockPath` não é symlink via `lstat` antes de `open`.

---

### SEC-GAP-09 — `request_user_input` não tem proteção contra prompt injection via `context`

**Arquivo:** `src/copilot/tools/hook/hook-tools.js` **Severidade:** MEDIUM **Descrição:** O campo
`context` é interpolado diretamente na `fullQuestion` sem sanitização. Um agente mal-intencionado ou
input LLM comprometido poderia injetar instruções via `context` que aparecem como parte da pergunta
ao usuário humano.

**Correção:**

```js
const MAX_CONTEXT_CHARS = 2000;
const safeContext = context
  ? context.slice(0, MAX_CONTEXT_CHARS).replace(/\n{3,}/g, '\n\n')
  : undefined;
const fullQuestion = safeContext ? `${question}\n\n**Contexto**: ${safeContext}` : question;
```

---

## 4. Gaps de Funcionalidade / Observabilidade

### FUNC-GAP-01 — Ausência de `AbortSignal` propagation no ciclo de prefetch

**Arquivo:** `src/copilot/infra/io-prefetch.js` **Descrição:** `warmCacheForPaths` aceita `signal`
via `PrefetchOptions`, mas os workers internos verificam `signal?.aborted` apenas no início de cada
iteração, não durante `readBytes`/`readText`. Se um arquivo grande demorar, o abort signal é
ignorado pelo I/O subjacente.

**Correção:**

```js
// Passar signal para readBytes/readText:
if (cachedBytes === null) {
  await readBytes(filePath, { signal }); // ← passar signal
}
```

---

### FUNC-GAP-02 — `io-health.js` não captura erros de `getParserCacheStats()`

**Arquivo:** `src/copilot/infra/io-health.js` **Descrição:** `readIoRuntimeHealthSnapshot()` não tem
try/catch ao redor de `getParserCacheStats()` e `getIoIndexStats()`. Se qualquer um lançar (ex: DB
corrompido), o snapshot inteiro falha.

**Correção:**

```js
function safeCall(fn, fallback) {
  try { return fn(); } catch (e) { return { ...fallback, error: e instanceof Error ? e.message : String(e) }; }
}

export function readIoRuntimeHealthSnapshot() {
  return {
    generatedAt: Date.now(),
    cache: { ... },
    index: safeCall(getIoIndexStats, { enabled: false, available: false, reason: 'error' }),
    parser: safeCall(getParserCacheStats, { size: 0, maxSize: 500 }),
    // ...
  };
}
```

---

### FUNC-GAP-03 — `io-index-sqlite.js` não emite evento de progresso durante `indexDirectory`

**Arquivo:** `src/copilot/infra/io-index-sqlite.js` **Descrição:** O build de índice para diretórios
grandes (>500 arquivos) não emite eventos de progresso via `publishIoLifecycleEvent`. A telemetria
`build.start` e `build.complete` existem, mas não há `build.progress` com percentual e arquivo
atual.

**Correção:**

```js
// Dentro do loop de indexação, a cada 50 arquivos:
if (indexed.length % 50 === 0) {
  publishIoLifecycleEvent('index', 'build.progress', {
    traceId,
    rootPath,
    indexed: indexed.length,
    total: files.length,
    pct: Math.round((indexed.length / files.length) * 100),
    currentFile: entry.absolutePath,
  });
}
```

---

### FUNC-GAP-04 — `AsyncQueue` não suporta prioridade

**Arquivo:** `src/copilot/infra/queue/async-queue.js` **Descrição:** A fila é FIFO pura. Para o
runtime agentic, algumas operações (ex: leituras críticas do LLM) têm prioridade sobre prefetch de
background. Sem prioridade, o prefetch pode starvar operações críticas.

**Upgrade proposto:**

```js
export class AsyncQueue {
  #queues = new Map([[0, []], [5, []], [10, []]]);  // prioridades: 0=alta, 5=normal, 10=baixa

  add(fn, priority = 5) {
    const queue = this.#queues.get(priority) ?? this.#queues.get(5);
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      this.#drain();
    });
  }

  #nextTask() {
    for (const [, q] of [...this.#queues.entries()].sort(([a], [b]) => a - b)) {
      if (q.length > 0) return q.shift();
    }
    return undefined;
  }
}
```

---

### FUNC-GAP-05 — `EventFanout` não tem backpressure para handlers lentos

**Arquivo:** `src/copilot/infra/sse/fanout.js` **Descrição:** `EventEmitter.emit()` é síncrono. Se
um subscriber do `EventFanout` for lento (ex: escrita em banco), ele bloqueia a emissão de todos os
eventos seguintes no mesmo tick.

**Upgrade:** Usar `setImmediate` para desacoplar handlers:

```js
publish(channel, event, data) {
  const fanoutEvt = { channel, event, data, ts: Date.now(), origin: this.#processId };
  setImmediate(() => {
    this.#emitter.emit(channel, fanoutEvt);
    this.#emitter.emit('*', fanoutEvt);
  });
}
```

---

### FUNC-GAP-06 — Ausência de circuit breaker para operações de DB no cache L2

**Arquivo:** `src/copilot/infra/io-cache-l2-registry.js` **Descrição:** Se o SQLite começar a
retornar erros repetidos (disco cheio, corrupção), o `getIoL2Cache()` continuará tentando
inicializar e falhando, registrando `_lastInitError` mas sem backoff exponencial ou circuit breaker
que desabilite temporariamente o L2.

**Correção:**

```js
let _initFailCount = 0;
const MAX_INIT_FAILURES = 3;
const BACKOFF_MS = [1000, 5000, 30000];

export function getIoL2Cache() {
  if (!isEnabled()) return null;
  if (_initFailCount >= MAX_INIT_FAILURES) return null;  // circuit open
  if (_ioL2Cache) return _ioL2Cache;
  try {
    _ioL2Cache = createIoL2SqliteCache({ ... });
    _initFailCount = 0;
    return _ioL2Cache;
  } catch (err) {
    _initFailCount++;
    // ...
  }
}
```

---

### FUNC-GAP-07 — `todo/store.js` não valida integridade referencial de `subtaskIds`

**Arquivo:** `src/copilot/tools/todo/store.js` **Descrição:** Ao carregar o store, não há
verificação de que todos os IDs em `task.subtaskIds` ainda existem no store. Após `todo_delete` com
`cascade: false`, se o processo reiniciar com o DB corrompido, `subtaskIds` pode referenciar IDs
inexistentes causando resultados incorretos em `todo_get`.

**Correção:** Adicionar validação de integridade na leitura:

```js
async function _readStoreRaw() {
  // ... carrega rows ...
  // Sanitiza referências quebradas
  for (const task of Object.values(tasks)) {
    task.subtaskIds = task.subtaskIds.filter((id) => id in tasks);
    if (task.parentId && !(task.parentId in tasks)) {
      task.parentId = null;
    }
  }
  return { version: SCHEMA_VERSION, tasks };
}
```

---

### FUNC-GAP-08 — Ausência de telemetria de latência por operação no `io-engine.js`

**Arquivo:** `src/copilot/infra/io-engine.js` **Descrição:** `publishIoOperation` recebe
`durationMs` mas os canais `diagnostics_channel` não têm histograma de latência. Para detectar
regressões de performance, seria necessário usar `node:perf_hooks` PerformanceObserver.

**Upgrade:**

```js
// io-observability.js — adicionar histograma
import { createHistogram } from 'node:perf_hooks';

const _readLatencyHistogram = createHistogram();
const _writeLatencyHistogram = createHistogram();

export function recordIoLatency(operation, durationMs) {
  if (operation === 'read' || operation === 'scan') {
    _readLatencyHistogram.record(durationMs);
  } else if (operation === 'write' || operation === 'patch' || operation === 'append') {
    _writeLatencyHistogram.record(durationMs);
  }
}

export function getIoLatencyStats() {
  return {
    read: { mean: _readLatencyHistogram.mean, p95: _readLatencyHistogram.percentile(95), p99: _readLatencyHistogram.percentile(99) },
    write: { mean: _writeLatencyHistogram.mean, p95: _writeLatencyHistogram.percentile(95) },
  };
}
```

---

## 5. Dívidas Técnicas e Code Smells

### DEBT-01 — `io-engine.js` tem 800+ linhas — viola Single Responsibility

**Severidade:** MEDIUM **Descrição:** O arquivo centraliza read, write, search, symbol search, diff,
stat, mkdir, copy, move — 12+ operações distintas. Já existe um esforço de migração para `io/fs/`
portas baixas, mas `io-engine.js` ainda é um god object.

**Plano:**

```
io-engine.js → dividir em:
  io-engine/read.js     (readBytes, readText, readLines, readTextChunks)
  io-engine/write.js    (writeFileAtomic, createOrReplaceFileAtomic, appendTextLocked)
  io-engine/mutate.js   (deleteFileLocked, removePathLocked, copyFileLocked, moveFileLocked, patchTextLocked)
  io-engine/search.js   (searchText, searchWorkspaceSymbols)
  io-engine/meta.js     (statPath, mkdirPathLocked, diffText)
  io-engine/index.js    (re-exporta tudo para compatibilidade)
```

---

### DEBT-02 — `bootstrap.js` de tools usa array de pares `[tools, opts]` com tipagem fraca

**Arquivo:** `src/copilot/tools/bootstrap.js` **Severidade:** MEDIUM **Descrição:** O array
`TOOL_GROUPS` é tipado como `[Tool[], Record<string, unknown>][]` mas deveria ser fortemente tipado
para detectar em compile-time se `opts.category` está ausente.

**Correção:**

```js
/** @type {{ tools: import('#copilot/sdk/types').Tool[]; category: string; tags: string[]; readOnly?: boolean }[]} */
const TOOL_GROUPS = [
  { tools: taskTools, category: 'task', tags: ['queue', 'state'] },
  // ...
];
```

---

### DEBT-03 — Duplicação de lógica de fingerprint entre `io-cache.js` e `io-index-sqlite.js`

**Severidade:** LOW-MEDIUM **Descrição:** Ambos os módulos implementam lógica de comparação
`mtimeMs + size` para detectar arquivos modificados. Existem sutilezas diferentes (L1 usa
`Math.round`, L2 usa `===` direto) que podem causar divergências.

**Correção:** Extrair para `shared/fingerprint-match.js`:

```js
// shared/fingerprint-match.js
export function fingerprintMatches(cached, actual) {
  const cachedMtime = Number(cached.mtimeMs);
  const actualMtime = Number(actual.mtimeMs);
  const mtimeOk = Number.isFinite(cachedMtime) && Number.isFinite(actualMtime)
    && (cachedMtime === actualMtime || Math.abs(cachedMtime - actualMtime) < 2); // 2ms tolerância FAT32
  const sizeOk = Number.isFinite(Number(cached.sizeBytes)) && Number(cached.sizeBytes) === Number(actual.size);
  return mtimeOk && sizeOk;
}
```

---

### DEBT-04 — `@ts-check` com JSDoc não captura erros de tipo em handlers de tools

**Severidade:** MEDIUM **Descrição:** O padrão `/** @type {{ field: string }} */ {}` em parâmetros
de handler é frágil. O TypeScript via JSDoc não verifica o bind entre o schema Zod e os tipos dos
parâmetros do handler automaticamente.

**Recomendação:** Migrar tools para TypeScript `.ts` com inferência nativa de
`z.infer<typeof Schema>`, ou usar o padrão `z.object(...).parse(args)` explicitamente no início de
cada handler para garantia em runtime.

---

### DEBT-05 — `io-session-scope.js` mantém `_warmPromise` no objeto de scope mas o tipo `_InternalScope` não reflete corretamente

**Arquivo:** `src/copilot/infra/io-session-scope.js` **Severidade:** LOW **Descrição:**
`_InternalScope._warmPromise` é `Promise<void>` mas é acessado externamente via `scope._warmPromise`
no `awaitReady` closure. A propriedade está no typedef mas não é parte da interface pública
documentada, criando acoplamento implícito.

---

### DEBT-06 — `createReadStream` em `read-chunks.js` não usa `stream/promises.pipeline`

**Arquivo:** `src/copilot/infra/io/fs/read-chunks.js` **Severidade:** LOW-MEDIUM **Descrição:** O
código usa `for await (const line of rl)` que é correto mas não usa `stream/promises` para garantir
cleanup automático em caso de erro. Com Node.js 24+, `stream/promises.pipeline` com um `Transform`
seria mais robusto.

---

### DEBT-07 — `webhooks.js` usa `setTimeout` para exponential backoff sem `unref()`

**Arquivo:** `src/copilot/infra/webhooks.js` **Severidade:** LOW **Descrição:** Os `setTimeout` em
`#deliverWithRetry` não chamam `.unref()`. Se o processo tentar encerrar durante um backoff de
webhook, o event loop ficará vivo aguardando o próximo retry.

**Correção:**

```js
await new Promise((r) => {
  const t = setTimeout(r, delay);
  t.unref?.(); // ← não bloqueia shutdown
});
```

---

### DEBT-08 — `normalizeWritePayload` em `write-atomic.js` duplica lógica de `toWriteBuffer`

**Arquivo:** `src/copilot/infra/io/fs/write-atomic.js` **Descrição:** `normalizeWritePayload` chama
`toWriteBuffer` mas também reconstrói `payload` como `string` se o input for string. Isso causa
double-allocation quando o input é string grande (Buffer criado + string mantida).

**Correção:**

```js
export function normalizeWritePayload(_filePath, content, encoding) {
  const buf = toWriteBuffer(content, encoding);
  return { payload: buf, bytes: buf.byteLength };
}
// E em writeAtomicFileUnlocked: sempre aceitar Buffer
```

---

### DEBT-09 — `io-prefetch.js` usa worker pool manual em vez de `p-limit`

**Arquivo:** `src/copilot/infra/io-prefetch.js` **Severidade:** LOW **Descrição:** A função
`warmCacheForPaths` implementa um worker pool com `idx++` e `while (idx < total)`. O código já usa
`p-limit` em outros módulos — deveria ser consistente.

**Correção:**

```js
import pLimit from 'p-limit';

export async function warmCacheForPaths(paths, opts = {}) {
  const { concurrency = 8, textMode = true, silent = true, signal } = opts;
  const limit = pLimit(Math.max(1, concurrency));
  const t0 = Date.now();
  let preloaded = 0, failed = 0, skipped = 0;

  await Promise.all(paths.map((filePath) => limit(async () => {
    if (signal?.aborted) return;
    // ... lógica existente ...
  })));

  return { preloaded, failed, skipped, durationMs: Date.now() - t0 };
}
```

---

### DEBT-10 — `io-locks.js` usa `Map` global de `tails` sem cleanup de entradas obsoletas

**Arquivo:** `src/copilot/infra/io-locks.js` **Severidade:** LOW-MEDIUM **Descrição:**
`tails.delete(key)` só é chamado quando `tails.get(key) === tail` (comparação de referência). Em
cenários de alta concorrência com muitos paths diferentes, entradas obsoletas podem se acumular se a
comparação falhar por timing.

**Correção:** Usar `WeakRef` ou garantir limpeza via `FinalizationRegistry`, ou simplesmente limitar
o tamanho do Map:

```js
// Cleanup periódico de entradas resolvidas
setInterval(() => {
  for (const [key, promise] of tails) {
    // Verificar se promise já resolveu via race com Promise.resolve()
    Promise.race([promise, Promise.resolve('__pending__')]).then((v) => {
      if (v !== '__pending__') tails.delete(key);
    });
  }
}, 60_000).unref();
```

---

### DEBT-11 — `module-map.js` de tools lista `webhooks.js` mas o arquivo está em `infra/`, não `tools/`

**Arquivo:** `src/copilot/infra/module-map.js` **Descrição:** `webhooks.js` está corretamente em
`infra/`, mas o `INFRA_MODULE_LAYOUT` o lista. O `TOOLS_MODULE_LAYOUT` não o menciona. Isso é
correto, mas o arquivo `module-map.js` de `infra/` não menciona que `webhooks.js` depende de
`#copilot/config`, `#copilot/core` — dependências externas que não estão documentadas no mapa.

---

### DEBT-12 — `io-scanner.js` usa `mapInBatches` para children recursivos causando overhead de serialização

**Arquivo:** `src/copilot/infra/io-scanner.js` **Descrição:** A segunda chamada a `mapInBatches`
para processar children recursivos cria um novo batch para cada subdiretório, resultando em
múltiplas passagens de array e criação de closures para diretórios grandes. `p-limit` com stream
recursivo seria mais eficiente.

---

### DEBT-13 — Ausência de testes de contrato para `io-engine.js` e fachadas públicas

**Descrição:** O roadmap menciona `test_infra_barrel_governance.spec.js` e
`test_io_tools_boundary_contracts.spec.js`, mas não há evidência de testes de contrato para as
assinaturas de retorno das funções públicas (ex: verificar que `readText` sempre retorna
`{ path, content, bytesRead, totalLines, returnedLines, io }`).

---

### DEBT-14 — `SseClientPool.broadcast` não tem proteção contra `entry.sse.send()` lançando

**Arquivo:** `src/copilot/infra/sse/stream-hub.js` **Descrição:** Se `entry.sse.send()` lançar (ex:
resposta já fechada com erro), a exceção propaga para fora do `for..of`, interrompendo o broadcast
para clientes restantes.

**Correção:**

```js
for (const entry of this.#clients) {
  if (entry.filter && !entry.filter(filterEvent)) continue;
  try {
    entry.sse.send(event, payload, { skipBuffer: true, ...(eventId != null ? { eventId } : {}) });
    delivered++;
  } catch (err) {
    this.#count('send_error');
    this.removeClient(entry); // Remove cliente com erro
  }
}
```

---

### DEBT-15 — `io-parser.js` carrega `@babel/parser` lazily mas sem cache de falha

**Arquivo:** `src/copilot/infra/io-parser.js` **Descrição:** Se `@babel/parser` não estiver
instalado, `getBabelParse()` retorna `null` a cada chamada (sem cache de falha). Workspaces com
muitos arquivos JS/TS chamarão `import('@babel/parser')` e falharão repetidamente, criando overhead
de resolve.

**Correção:**

```js
let _babelParse = /** @type {((code: string, opts: object) => any) | null | 'unavailable'} */ (null);

async function getBabelParse() {
  if (_babelParse !== null) return _babelParse === 'unavailable' ? null : _babelParse;
  try {
    const m = await import('@babel/parser');
    _babelParse = m.parse ?? m.default?.parse ?? null;
    if (!_babelParse) _babelParse = 'unavailable';
  } catch {
    _babelParse = 'unavailable';
  }
  return _babelParse === 'unavailable' ? null : _babelParse;
}
```

---

### DEBT-16 — `todo-write-tools.js` e `crud-tools.js` duplicam lógica de `now()` e `sanitize()`

**Descrição:** Ambos importam `now` e `sanitize` de `store.js`. A função `now()` é simplesmente
`new Date().toISOString()` — poderia ser inline. `sanitize(task)` apenas faz `{ ...task }` — spread
superficial. Isso induz a pensar que existe alguma transformação significativa quando não há.

---

### DEBT-17 — `hub-tools.js` tem limite fixo de `MAX_MSG_CHARS = 32_000` não configurável via env

**Arquivo:** `src/copilot/tools/hub/hub-tools.js` **Descrição:** O limite é hardcoded. Para modelos
com contextos maiores (GPT-5, Claude Opus), 32k chars pode ser insuficiente.

**Correção:**

```js
const MAX_MSG_CHARS = Number(process.env['COPILOT_HUB_MAX_MSG_CHARS'] ?? 32_000);
```

---

### DEBT-18 — `resolveIoSearchBudget()` é chamado no módulo level de `io-engine.js`

**Arquivo:** `src/copilot/infra/io-engine.js` **Descrição:**
`const IO_SEARCH_BUDGET = resolveIoSearchBudget()` é executado na carga do módulo. Variáveis de
ambiente que controlam o budget precisam ser definidas **antes** do primeiro import de
`io-engine.js`, o que é frágil em ambientes de teste.

**Correção:** Usar lazy initialization:

```js
let _ioSearchBudget = /** @type {ReturnType<typeof resolveIoSearchBudget> | null} */ (null);
function getIoSearchBudget() {
  return (_ioSearchBudget ??= resolveIoSearchBudget());
}
```

---

## 6. Oportunidades de Modernização (Node.js 24+)

### MOD-01 — Usar `node:sqlite` (built-in) em vez de `better-sqlite3`

**Node.js 24.15.0** marcou `node:sqlite` como "release candidate" estável. O `DatabaseSync` agora
tem suporte a `limits` property e melhores APIs.

**Benefícios:**

- Elimina dependência nativa `better-sqlite3` (compilação C++, problemas em ARM/Alpine)
- API idêntica para workloads síncronos existentes
- Melhor integração com Node.js permission model

**Migração proposta:**

```js
// Antes (better-sqlite3):
import Database from 'better-sqlite3';
const db = new Database('./copilot.sqlite');

// Depois (node:sqlite):
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('./copilot.sqlite');
// API compatível: db.exec(), db.prepare(), db.transaction()
```

---

### MOD-02 — Usar `stream/promises.pipeline` com `AbortSignal` em leituras de arquivo

**Arquivo:** `src/copilot/infra/io/fs/read-chunks.js`

```js
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Transform } from 'node:stream';

export async function readTextLineChunks(filePath, options = {}) {
  const { startLine = 1, endLine = Infinity, chunkLines = 200, signal } = options;
  const chunks = [];
  // ...
  const lineTransform = new Transform({
    objectMode: true,
    transform(line, _enc, cb) { /* ... */ cb(); },
  });

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8', signal }),
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) { /* ... */ }
  } finally {
    rl.close();
  }
}
```

---

### MOD-03 — `AsyncLocalStorage` para propagação de `traceId` sem passar explicitamente

**Node.js 24** melhorou o `AsyncContextFrame` com ganhos de performance significativos.

```js
// io-trace-context.js (novo)
import { AsyncLocalStorage } from 'node:async_hooks';

const _traceStorage = new AsyncLocalStorage();

export function withTraceId(traceId, fn) {
  return _traceStorage.run({ traceId }, fn);
}

export function getCurrentTraceId() {
  return _traceStorage.getStore()?.traceId;
}

// Em io-engine.js — eliminar passagem explícita de traceId:
export async function readBytes(filePath, options = {}) {
  const traceId = options.traceId ?? getCurrentTraceId() ?? createIoTraceId();
  // ...
}
```

---

### MOD-04 — `using` / `await using` para cleanup determinístico de recursos

**Node.js 24+ / TypeScript 5.2+** suportam `Symbol.dispose` e `Symbol.asyncDispose`.

```js
// io-locks.js — adicionar suporte a Symbol.asyncDispose
export async function withIoResourceLock(key, operation, options = {}) {
  // ... versão existente funciona via wrapper
}

// Novo: helper para uso com 'await using'
export function lockResource(key, options = {}) {
  let _release = () => {};
  const acquired = new Promise((res) => { _release = res; });
  // ... setup do lock ...
  return {
    [Symbol.asyncDispose]: async () => {
      _release();
    },
  };
}

// Uso:
// await using _lock = lockResource('/path/to/file');
// await doWork();
// // lock liberado automaticamente
```

---

### MOD-05 — Usar `performance.timerify()` para métricas de I/O sem overhead manual

```js
// io-observability.js
import { performance, PerformanceObserver } from 'node:perf_hooks';

const obs = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.entryType === 'function') {
      const channel = lifecycleChannels['io'] ?? ioOperationChannel;
      channel.publish({ type: 'perf', name: entry.name, duration: entry.duration });
    }
  }
});
obs.observe({ type: 'function', buffered: false });

// Wrapper automático para funções críticas:
export const timedReadText = performance.timerify(readText);
```

---

### MOD-06 — Usar `ReadableStream` (Web Streams API) em `web_fetch_local`

Node.js 24 tem Web Streams totalmente estável. A leitura do body via `response.body.getReader()` já
está correta, mas pode ser simplificada com `Response.text()` quando não há truncamento, ou com
`ReadableStream.pipeTo()` para streaming.

```js
// Versão modernizada com Web Streams:
const { response, finalUrl } = await fetchWithRedirectPolicy(parsed.toString(), maxRedirects);
const reader = response.body?.getReader();
if (!reader) return { success: false, error: 'Resposta sem corpo.' };

const textDecoder = new TextDecoder();
let text = '';
let received = 0;
try {
  while (true) {
    const { done, value } = await reader.read();
    if (done || (advisoryLimit !== null && received >= advisoryLimit)) break;
    text += textDecoder.decode(value, { stream: true });
    received += value?.byteLength ?? 0;
  }
  text += textDecoder.decode(); // flush
} finally {
  reader.cancel().catch(() => {});  // ← cancel em vez de releaseLock para liberar recursos
}
```

---

### MOD-07 — `diagnostics_channel` — subscrever ao canal `undici:request` para telemetria de fetch

Node.js 24 expõe o canal `undici:request:create` que fornece rastreabilidade de fetch nativa sem
monkey-patching:

```js
// io-observability.js — adicionar
import { channel } from 'node:diagnostics_channel';

channel('undici:request:create').subscribe(({ request }) => {
  ioOperationChannel.publish({
    ts: Date.now(),
    type: 'undici.request',
    url: request.path,
    method: request.method,
  });
});
```

---

### MOD-08 — `node:crypto` — usar `crypto.subtle` para SHA-256 assíncrono em arquivos grandes

```js
// shared/hash.js — adicionar versão async para arquivos > 1MB
export async function sha256Async(content) {
  const data = typeof content === 'string'
    ? new TextEncoder().encode(content)
    : content;
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Buffer.from(hashBuffer).toString('hex');
}
```

---

### MOD-09 — Usar `EventTarget` em vez de `EventEmitter` no `EventFanout`

Node.js 24 tem `EventTarget` estável com melhor compatibilidade com código browser e suporte a
`AbortSignal` nativo:

```js
export class EventFanout extends EventTarget {
  publish(channel, event, data) {
    const fanoutEvt = new CustomEvent(channel, {
      detail: { channel, event, data, ts: Date.now(), origin: this.#processId }
    });
    this.dispatchEvent(fanoutEvt);
  }

  subscribe(channel, handler, options = {}) {
    const wrapper = (e) => handler(e.detail);
    this.addEventListener(channel, wrapper, options);
    return { unsubscribe: () => this.removeEventListener(channel, wrapper) };
  }
}
```

---

### MOD-10 — `node:test` para testes unitários em vez de Vitest (onde aplicável)

Para testes puros de funções de `infra/` (sem DOM, sem module mocking complexo), o runner nativo do
Node.js 24 é suficiente e elimina a dependência de Vitest:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFtsQuery } from '../index-store/sqlite/query.js';

describe('sanitizeFtsQuery', () => {
  test('queries válidas', () => {
    assert.strictEqual(sanitizeFtsQuery('hello world'), '"hello" "world"');
  });
});
```

---

### MOD-11 — `node:fs` `throwIfNoEntry` option para stat seguro

Node.js 24.15.0 adicionou `throwIfNoEntry` ao `fs.promises.stat`:

```js
// Antes:
const stats = await fs.stat(filePath).catch(() => null);

// Depois (mais explícito):
const stats = await fs.stat(filePath, { throwIfNoEntry: false });
// retorna undefined se não existir, em vez de lançar ENOENT
```

Útil em `io-cache.js` (`getVerifiedIoL1Entry`), `io-prefetch.js` e `io-session-scope.js`.

---

### MOD-12 — `worker_threads` para builds de índice pesadas

Para `indexDirectory` com >2000 arquivos, o parse Babel é CPU-bound. Mover para Worker Thread
evitaria bloquear o event loop principal:

```js
// io-index-worker.js (novo)
import { parentPort, workerData } from 'node:worker_threads';
import { parseFileSymbols } from '../io-parser.js';

const { filePath, content } = workerData;
const symbols = await parseFileSymbols(filePath, content);
parentPort?.postMessage(symbols);
```

---

### MOD-13 — `AbortSignal.timeout()` em vez de `setTimeout` + `AbortController` manual

Node.js 20+ tem `AbortSignal.timeout(ms)` — usar em todos os lugares onde há timeout + abort:

```js
// Antes:
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);
try { await fetch(url, { signal: controller.signal }); }
finally { clearTimeout(timer); }

// Depois:
await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
// cleanup automático — sem vazamento de timer
```

Aplicável em: `web-tools.js`, `io-prefetch.js`, `io-scanner.js`.

---

### MOD-14 — `Array.fromAsync` para coleta de iteradores assíncronos

Node.js 22+ suporta `Array.fromAsync`. Uso em `io-scanner.js`:

```js
// Antes:
const entries = [];
for await (const entry of readdir(dir, { withFileTypes: true })) {
  entries.push(entry);
}

// Depois:
const entries = await Array.fromAsync(readdir(dir, { withFileTypes: true }));
```

---

### MOD-15 — `Object.groupBy` para agrupar tools por categoria em `bootstrap.js`

```js
// Antes: loop manual para categoryCount
const byCategory = Object.groupBy(
  [...registry.entries.values()],
  (entry) => entry.category ?? 'unknown'
);
```

---

## 7. Alinhamento com SDK 0.3.0

### SDK-GAP-01 — `session.rpc.permissions` não é usado nas permission tools

**Arquivo:** `src/copilot/tools/permission/permission-tools.js` **Descrição:** O SDK 0.3.0 expõe
`session.rpc.permissions.setApproveAll()` e `session.rpc.permissions.resetSessionApprovals()`. O
agente usa apenas `agent.setPermissionMode()` interno — não sincroniza com o runtime do SDK.

**Correção:** Chamar `rpc.permissions.setApproveAll()` quando `mode === 'approve_all'` e
`rpc.permissions.resetSessionApprovals()` para outros modos.

---

### SDK-GAP-02 — `session.onEvent("assistant.message")` com tipo `AssistantMessageData` não está sendo usado

**Descrição:** O SDK 0.3.0 exporta tipos nomeados por evento (`AssistantMessageData`, etc.). O
código ainda usa o handler genérico sem tipagem forte do evento.

---

### SDK-GAP-03 — `approve-for-session` não é explorado nas permission handlers

**Descrição:** O SDK 0.3.0 adicionou `"approve-for-session"` como tipo de aprovação escopada. O
`permission_mode_set` poderia usar isso para criar whitelists persistentes por sessão sem ter que
reiniciar o agente.

---

### SDK-GAP-04 — `copilotHome` option do `CopilotClient` não está documentada no bootstrap

**Descrição:** O SDK 0.3.0 adicionou `copilotHome` como configuração de diretório de dados. O
projeto não documenta onde configurar isso, o que pode causar colisões de state entre múltiplas
instâncias em dev.

---

### SDK-GAP-05 — `Symbol.asyncDispose` não está sendo usado nas sessões SDK

**Descrição:** O SDK 0.3.0 suporta `await using session = await client.createSession(...)`. O código
atual usa `try/finally` para cleanup — poderia usar `await using` para cleanup determinístico.

---

## 8. Propostas Arquiteturais

### ARCH-01 — Introduzir `IoOperationContext` via `AsyncLocalStorage`

**Problema atual:** `traceId`, `advisoryLimits` e metadados de operação são passados explicitamente
por toda a call stack, tornando as assinaturas de função pesadas e difíceis de manter.

**Proposta:**

```
src/copilot/infra/runtime/io-context.js (novo)
  → AsyncLocalStorage com { traceId, sessionId, operationId, advisoryLimits }
  → withIoContext(ctx, fn) — executar operação com contexto
  → getIoContext() — lê contexto atual

io-engine.js — remover parâmetros de traceId/advisoryLimits das assinaturas públicas
              → buscar via getIoContext()
```

**Benefícios:**

- Assinaturas menores e mais limpas
- Propagação automática de contexto em operações assíncronas
- Correlação automática de logs/eventos

---

### ARCH-02 — Plugin System para tools via SDK 0.3.0 MCP

**Problema atual:** Tools são registradas estaticamente no bootstrap. Para adicionar uma tool nova,
é necessário reiniciar o agente.

**Proposta:**

```
src/copilot/tools/plugin/
  plugin-registry.js   → registro dinâmico de tool plugins
  plugin-loader.js     → carrega tools via MCP server dinamicamente
  plugin-validator.js  → valida contrato de tool antes de registrar
```

Com SDK 0.3.0 `session.rpc.mcp.discover()` e `session.rpc.mcp.config.enable()`, é possível carregar
tools via MCP em runtime.

---

### ARCH-03 — `IoTransactionEnvelope` para operações compostas atômicas

**Problema atual:** Operações como "criar arquivo + atualizar índice + invalidar cache" são feitas
sequencialmente sem garantia de rollback se uma etapa falhar.

**Proposta:**

```js
// runtime/io-transaction.js (novo)
export async function withIoTransaction(operations) {
  const envelope = createIoOperationEnvelope({ capability: 'io.transaction', ... });
  const rollbacks = [];
  try {
    for (const op of operations) {
      const result = await op.execute();
      rollbacks.unshift(() => op.rollback(result));
    }
    return completeIoOperationEnvelope(envelope);
  } catch (error) {
    for (const rollback of rollbacks) {
      await rollback().catch(() => {});
    }
    throw error;
  }
}
```

---

### ARCH-04 — Separar `io-index-sqlite.js` em `IoIndexWriter` e `IoIndexReader`

**Problema atual:** O indexador é um god-object com responsabilidades de escrita (indexing, pruning)
e leitura (search, findSymbol). Isso dificulta otimizar reads (ex: usar read-only connections ao
SQLite) separadamente de writes.

**Proposta:**

```
io-index-sqlite.js → dividir em:
  io/index/writer.js   → indexTextFile, indexDirectory, clearAll, invalidatePath
  io/index/reader.js   → search, findSymbol, getStats
  io/index/index.js    → factory createIoIndexSqlite() que compõe ambos
```

---

### ARCH-05 — `IoObservabilityBus` centralizado via `diagnostics_channel`

**Problema atual:** Múltiplos canais de `diagnostics_channel` são criados em `io-observability.js`
mas não há um mecanismo central de subscription/aggregation. Módulos externos que querem observar
I/O precisam conhecer os nomes dos canais.

**Proposta:**

```js
// io-observability.js — adicionar subscriber registry
export function subscribeToAllIoEvents(handler) {
  const channels = [ioOperationChannel, ioCacheChannel, ioIndexChannel, ioScopeChannel, ioScanChannel];
  const unsubs = channels.map((ch) => {
    ch.subscribe(handler);
    return () => ch.unsubscribe(handler);
  });
  return () => unsubs.forEach((u) => u());
}
```

---

### ARCH-06 — Migrar `io-cache.js` LRU para `node:lru_cache` nativo (quando disponível)

O Node.js team está trabalhando em `node:lru_cache` nativo. Quando disponível (est. Node.js 25+),
eliminar a dependência `lru-cache` npm:

```js
// io-cache.js — abstração preparada
import { LRUCache } from 'node:lru_cache'; // futuro
// fallback:
// import { LRUCache } from 'lru-cache';
```

---

## 9. Propostas de Correção por Arquivo

### `src/copilot/infra/io/fs/read-chunks.js`

```js
// CORREÇÃO COMPLETA (BUG-HIGH-03 + MOD-02 + DEBT-06)
// @ts-check
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export async function readTextLineChunks(filePath, options = {}) {
  const chunkLines =
    Number.isFinite(options.chunkLines) && Number(options.chunkLines) > 0
      ? Math.floor(Number(options.chunkLines))
      : 200;
  const startLine = Math.max(1, options.startLine ?? 1);
  const endLine = Number.isFinite(options.endLine)
    ? Math.max(startLine, Number(options.endLine))
    : Number.POSITIVE_INFINITY;

  /** @type {{ index: number; startLine: number; endLine: number; content: string; bytes: number }[]} */
  const chunks = [];
  /** @type {string[]} */
  let current = [];
  let currentStartLine = startLine;
  let totalLines = 0;
  let bytesRead = 0;

  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      totalLines += 1;
      if (totalLines < startLine) continue;
      if (totalLines > endLine) break;
      if (current.length === 0) currentStartLine = totalLines;
      current.push(line);
      if (current.length >= chunkLines) {
        const content = current.join('\n');
        const bytes = Buffer.byteLength(content, 'utf8');
        bytesRead += bytes;
        chunks.push({ index: chunks.length, startLine: currentStartLine, endLine: totalLines, content, bytes });
        current = [];
      }
    }
  } finally {
    rl.close();      // sempre fecha o readline interface
    stream.destroy(); // sempre libera o file descriptor
  }

  if (current.length > 0) {
    const content = current.join('\n');
    const bytes = Buffer.byteLength(content, 'utf8');
    bytesRead += bytes;
    chunks.push({
      index: chunks.length,
      startLine: currentStartLine,
      endLine: currentStartLine + current.length - 1,
      content,
      bytes,
    });
  }

  return {
    path: filePath,
    chunks,
    totalLines,
    bytesRead,
    chunkLines,
    startLine,
    endLine: Number.isFinite(endLine) ? endLine : null,
  };
}
```

---

### `src/copilot/infra/io-observability.js` — adicionar latência

```js
// Adicionar ao io-observability.js:
import { createHistogram } from 'node:perf_hooks';

/** @type {Map<string, ReturnType<typeof createHistogram>>} */
const _latencyHistograms = new Map();

function getOrCreateHistogram(operation) {
  let h = _latencyHistograms.get(operation);
  if (!h) {
    h = createHistogram();
    _latencyHistograms.set(operation, h);
  }
  return h;
}

export function recordIoLatency(operation, durationMs) {
  if (durationMs > 0) {
    getOrCreateHistogram(operation).record(Math.round(durationMs));
  }
}

export function getIoLatencyStats() {
  /** @type {Record<string, { mean: number; p50: number; p95: number; p99: number; count: number }>} */
  const stats = {};
  for (const [op, h] of _latencyHistograms) {
    stats[op] = {
      mean: Math.round(h.mean),
      p50: h.percentile(50),
      p95: h.percentile(95),
      p99: h.percentile(99),
      count: h.count,
    };
  }
  return stats;
}
```

---

### `src/copilot/infra/shared/hash.js` — versão async

```js
// @ts-check
import { createHash } from 'node:crypto';

/**
 * SHA-256 síncrono (para uso em contextos síncronos e buffers pequenos).
 * @param {string | Buffer | Uint8Array} content
 * @returns {string}
 */
export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * SHA-256 assíncrono via Web Crypto API (para arquivos grandes em contexto async).
 * @param {string | Buffer | Uint8Array} content
 * @returns {Promise<string>}
 */
export async function sha256Async(content) {
  const data = typeof content === 'string'
    ? new TextEncoder().encode(content)
    : content instanceof Buffer
      ? content
      : Buffer.from(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Buffer.from(hashBuffer).toString('hex');
}
```

---

### `src/copilot/tools/shell/sandbox.js` — safeEnv sem cache

```js
// Remover cache TTL — recomputar sempre (custo ~5µs, negligível vs fork de processo)
export function safeEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (sensitiveExact.has(key) || sensitivePattern.test(key)) {
      delete env[key];
    }
  }
  return /** @type {Record<string, string>} */ (env);
}
```

---

### `src/copilot/infra/sse/stream-hub.js` — broadcast defensivo

```js
broadcast(event, payload, opts = {}) {
  const replayEvent = opts.replayEvent ?? event;
  const filterEvent = opts.filterEvent ?? replayEvent;
  const eventId = opts.skipReplay ? undefined : this.#replayBuffer.push(replayEvent, payload);

  this.#count('broadcast');

  /** @type {SseClientEntry[]} */
  const toRemove = [];
  let delivered = 0;
  let filteredOut = 0;

  for (const entry of this.#clients) {
    if (entry.filter && !entry.filter(filterEvent)) { filteredOut++; continue; }
    try {
      entry.sse.send(event, payload, { skipBuffer: true, ...(eventId != null ? { eventId } : {}) });
      delivered++;
    } catch {
      toRemove.push(entry); // Marca para remoção após o loop
    }
  }

  for (const entry of toRemove) {
    this.#clients.delete(entry);
    this.#count('client_removed_on_error');
  }

  this.#count('delivered', delivered);
  if (filteredOut > 0) this.#count('filtered_out', filteredOut);
  return eventId;
}
```

---

## 10. Roadmap de Upgrades Priorizados

### Sprint 1 — Bugs Críticos (1-2 semanas)

| ID          | Arquivo                       | Ação                                                | Esforço |
| ----------- | ----------------------------- | --------------------------------------------------- | ------- |
| BUG-CRIT-01 | `todo/store.js`               | Corrigir mutex withStore                            | 2h      |
| BUG-HIGH-03 | `io/fs/read-chunks.js`        | Adicionar finally com rl.close() + stream.destroy() | 1h      |
| BUG-HIGH-05 | `shell/sandbox.js`            | Remover cache TTL de safeEnv()                      | 30m     |
| BUG-HIGH-06 | `shell/executor.js`           | Adicionar destroy() em handlers de erro de pipeline | 1h      |
| BUG-MED-04  | `index-store/sqlite/query.js` | Filtrar tokens < 2 chars em sanitizeFtsQuery        | 30m     |
| SEC-GAP-01  | `io-engine.js`                | Validar null bytes em filePath                      | 1h      |
| SEC-GAP-02  | `shell/sandbox.js`            | Normalizar Unicode em checkCommandBlocklist         | 1h      |

### Sprint 2 — Segurança e Observabilidade (2-3 semanas)

| ID          | Arquivo                   | Ação                                                | Esforço |
| ----------- | ------------------------- | --------------------------------------------------- | ------- |
| BUG-HIGH-02 | `io-parser.js`            | Corrigir memory leak de invalidation hooks          | 3h      |
| BUG-HIGH-04 | `io-index-sqlite.js`      | SQL query filtrada por extensão em pruneMissingRows | 2h      |
| SEC-GAP-03  | `sse/replay-buffer.js`    | Limitar tamanho de payload                          | 1h      |
| SEC-GAP-09  | `hook/hook-tools.js`      | Sanitizar context em request_user_input             | 1h      |
| DEBT-14     | `sse/stream-hub.js`       | Broadcast defensivo com try/catch                   | 1h      |
| FUNC-GAP-02 | `io-health.js`            | try/catch em todos os calls de health               | 2h      |
| FUNC-GAP-06 | `io-cache-l2-registry.js` | Circuit breaker para falhas de inicialização        | 3h      |

### Sprint 3 — Modernização Node.js 24 (3-4 semanas)

| ID     | Ação                                             | Esforço |
| ------ | ------------------------------------------------ | ------- |
| MOD-01 | Migrar para `node:sqlite` (quando estável RC→GA) | 8h      |
| MOD-03 | `AsyncLocalStorage` para propagação de traceId   | 6h      |
| MOD-04 | `await using` para locks e sessões SDK           | 4h      |
| MOD-08 | `crypto.subtle.digest` para hash assíncrono      | 2h      |
| MOD-11 | `throwIfNoEntry` em todos os stat calls          | 2h      |
| MOD-13 | `AbortSignal.timeout()` em web tools             | 2h      |

### Sprint 4 — Arquitetura (4-6 semanas)

| ID         | Ação                                       | Esforço |
| ---------- | ------------------------------------------ | ------- |
| ARCH-01    | `IoOperationContext` via AsyncLocalStorage | 12h     |
| ARCH-04    | Separar IoIndexWriter / IoIndexReader      | 8h      |
| ARCH-05    | `IoObservabilityBus` centralizado          | 6h      |
| DEBT-01    | Dividir `io-engine.js` em módulos          | 16h     |
| SDK-GAP-01 | Integrar `session.rpc.permissions`         | 4h      |

---

## 11. Apêndice: Inventário de Riscos

| ID   | Componente                | Risco                                              | Probabilidade | Impacto | Mitigação   |
| ---- | ------------------------- | -------------------------------------------------- | ------------- | ------- | ----------- |
| R-01 | `io-locks.js`             | Deadlock em operações aninhadas                    | Baixa         | Crítico | BUG-HIGH-01 |
| R-02 | `todo/store.js`           | Race condition em writes concorrentes              | Média         | Alto    | BUG-CRIT-01 |
| R-03 | `shell/sandbox.js`        | Bypass de blocklist via Unicode                    | Baixa         | Alto    | SEC-GAP-02  |
| R-04 | `io-cache-l2-registry.js` | Falhas em cascata se SQLite corrompido             | Média         | Médio   | FUNC-GAP-06 |
| R-05 | `sse/replay-buffer.js`    | OOM com payloads grandes                           | Baixa         | Alto    | SEC-GAP-03  |
| R-06 | `web_fetch_local`         | SSRF por redirect para porta interna               | Baixa         | Alto    | BUG-MED-03  |
| R-07 | `io-parser.js`            | Memory leak em testes de longa duração             | Média         | Médio   | BUG-HIGH-02 |
| R-08 | `io-index-sqlite.js`      | Performance degradada em workspaces >10k files     | Média         | Médio   | BUG-HIGH-04 |
| R-09 | `executor.js`             | File descriptor leak em pipeline com erro          | Baixa         | Médio   | BUG-HIGH-06 |
| R-10 | `io-engine.js`            | Módulo level initialization com env mutável        | Média         | Baixo   | DEBT-18     |
| R-11 | SDK 0.3.0                 | Breaking changes em tipos de evento não propagados | Alta          | Médio   | SDK-GAP-02  |
| R-12 | `node:sqlite`             | API instável (RC) em Node.js 24.x                  | Alta          | Médio   | Aguardar GA |

---

## Notas Finais

### Sobre Compatibilidade `node:sqlite`

O módulo `node:sqlite` foi marcado como **release candidate** no Node.js 24.15.0 (LTS "Krypton"). A
migração de `better-sqlite3` deve aguardar o status **GA (estável)**, estimado para Node.js 24.x ou
25.x. Até lá, manter `better-sqlite3` com lock de versão (`^10.0.0`).

### Sobre SDK 0.3.0

A auditoria não identificou usos de APIs removidas/renomeadas no SDK 0.3.0 (ex: `githubToken` →
`gitHubToken`). Verificar se o projeto usa `CopilotClientOptions.githubToken` (lowercase h) — se
sim, atualizar para `gitHubToken`.

### Sobre TypeScript Strict

O projeto usa `@ts-check` com JSDoc em arquivos `.js`. Para máxima cobertura de tipos, considerar
migração gradual para `.ts` começando pelos módulos mais críticos: `io-engine.js`, `io-cache.js`,
`io-index-sqlite.js`. A inferência de tipos Zod (`z.infer<>`) em handlers de tools seria
especialmente valiosa.

---

_Documento gerado em 14/05/2026. Para questões sobre esta auditoria, referenciar commits da análise
no branch de auditoria correspondente._
