# Auditoria Técnica Completa — `src/copilot/`
## Projeto: `chatgpt-docker-puppeteer`

**Data**: 2026-03-30
**Escopo**: Módulo completo `src/copilot/` (~25 000 linhas, 104 arquivos analisados)
**SDK referência**: `@github/copilot-sdk` v0.2.0 (npm, GitHub releases, docs oficiais)
**Auditor**: Claude Sonnet 4.6 (análise automatizada + validação vs documentação oficial)

---

## Índice

1. [Sumário Executivo](#1-sumário-executivo)
2. [Bugs Críticos](#2-bugs-críticos)
3. [Bugs Moderados](#3-bugs-moderados)
4. [Bugs Leves](#4-bugs-leves)
5. [Gaps de Conformidade com SDK Oficial](#5-gaps-de-conformidade-com-sdk-oficial)
6. [Gaps de Segurança](#6-gaps-de-segurança)
7. [Gaps de Arquitetura](#7-gaps-de-arquitetura)
8. [Oportunidades de Melhoria](#8-oportunidades-de-melhoria)
9. [Upgrades Recomendados](#9-upgrades-recomendados)
10. [Matriz de Prioridades](#10-matriz-de-prioridades)

---

## 1. Sumário Executivo

O módulo `src/copilot/` é uma das camadas mais complexas e críticas do projeto, implementando o `AlwaysAliveAgent` (agente autônomo sobre o GitHub Copilot SDK), o `ConversationHub` (persistência SQLite de conversas), o `LlmBridgeClient` (camada de diálogo), mais de 60 Custom Tools e um servidor HTTP de injeção na porta 3009.

A análise identificou **7 bugs críticos**, **15 bugs moderados**, **12 bugs leves**, **9 gaps de conformidade com o SDK oficial** (v0.2.0), **8 gaps de segurança** e numerosas oportunidades de melhoria e upgrades. Os achados mais graves são a ausência de `client.start()` antes de operações de sessão, o padrão de valor sentinela `-1` para erros em `writeTurn`, race conditions no `todo-tools.js` e divergências entre os nomes de eventos emitidos e os esperados pelo SDK v0.2.0.

---

## 2. Bugs Críticos

### BUG-CRIT-01 · `AlwaysAliveAgent.start()` não chama `client.start()`

**Arquivo**: `src/copilot/agent/always-alive.js`, método `start()` (linha ~220)

**Descrição**: A documentação oficial do SDK v0.2.0 e o README do `nodejs/` especificam explicitamente:

```js
const client = new CopilotClient();
await client.start();   // ← OBRIGATÓRIO antes de createSession/resumeSession
const session = await client.createSession({ ... });
```

O código atual faz:

```js
const client = new CopilotClient();
this.#client = client;
// ← AUSÊNCIA de client.start()
const { session, isResumed } = await startSpan('session.boot', ..., () => this.#initSession(client));
```

Versões anteriores do SDK auto-iniciavam no primeiro `createSession`, mas versões ≥ 0.1.32 requerem `start()` explícito. O `entry.js` cria uma instância separada `pingClient` e chama `.ping()` diretamente (sem `start()`), o que sugere que `.ping()` pode funcionar sem start, mas `createSession` pode não funcionar de forma confiável.

**Risco**: Falhas silenciosas ou erros JSON-RPC não descritivos em ambientes com CLI recém-instalado.

**Correção**:
```js
async start() {
    if (this.#status !== 'stopped') return;
    this.#setStatus('starting');
    const client = new CopilotClient();
    this.#client = client;
    await client.start();  // ← ADICIONAR
    const { session, isResumed } = await startSpan(..., () => this.#initSession(client));
    // ...
}
```

---

### BUG-CRIT-02 · `writeTurn` retorna `-1` como sentinela de erro — callers não tratam exceção

**Arquivo**: `src/copilot/conversation-hub/store.js`, `src/copilot/conversation-hub/orchestrator.js`

**Descrição**: `writeTurn` é `async` e, após 3 tentativas com UNIQUE constraint, cai no path "unreachable" e retorna `-1`:

```js
// store.js — fim de writeTurn
/* c8 ignore next */
return -1;
```

O `orchestrator.js` verifica:

```js
const llmATurnId = await this.#store.writeTurn(hubSessionId, { ... });
if (llmATurnId === -1) {
    throw new Error('[HubOrchestrator] writeTurn falhou irrecuperavelmente para turno LLM-A');
}
```

Porém, em `dialog.js` (terminal), `writeTurn` é chamado **sem verificação**:

```js
const msgTurnId = await conversationHub.store.writeTurn(_hubSessionId, { ... });
// ← nenhuma checagem de msgTurnId === -1
emitNerv('copilot:turn:sent', { hubSessionId, turnId: msgTurnId, ... });
```

Se `writeTurn` retornar `-1`, o evento NERV emitirá `turnId: -1` e o estado ficará inconsistente.

**Correção**: Uniformizar `writeTurn` para lançar exceção em vez de retornar `-1`. Remover o padrão sentinela:

```js
// No fim do loop de retry em writeTurn
throw new Error('[ConversationStore] writeTurn falhou após 3 tentativas de UNIQUE constraint');
// Remover o `return -1` abaixo
```

E atualizar todos os callers (dialog.js, orchestrator.js) para `try/catch` em vez de `=== -1`.

---

### BUG-CRIT-03 · `session.destroy()` vs `session.disconnect()` — API v0.2.0

**Arquivo**: `src/copilot/agent/always-alive.js`, método `stop()`

**Descrição**: O README oficial do SDK Node.js v0.2.0 usa `session.destroy()` para limpeza definitiva, enquanto `session.disconnect()` é para desconexão preservando estado de disco. O código usa `disconnect()` no `stop()`:

```js
await this.#session.disconnect();
```

Isso está correto **apenas** se a intenção é preservar o `sessionId` para retomada posterior (o que é o caso). Porém, a documentação v0.2.0 acrescenta que `destroy()` é necessário para liberar todos os recursos (event listeners internos, streams, timers internos do SDK).

O problema é que ao chamar `stop()` + posterior `start()`, há acúmulo de listeners se o SDK não libera internamente via `disconnect()`. O ciclo de vida correto seria:

- **Pausa/retomada**: `disconnect()` + posterior `resumeSession()`
- **Encerramento definitivo**: `destroy()`

**Correção**: Adicionar `disconnect()` para ciclos normais e expor `destroy()` para shutdown definitivo:

```js
async stop({ shutdownTimeoutMs = 10_000, permanent = false } = {}) {
    // ...
    if (this.#session) {
        try {
            if (permanent) {
                await this.#session.destroy?.() ?? this.#session.disconnect();
            } else {
                await this.#session.disconnect();
            }
        } catch (e) { /* warn */ }
    }
}
```

---

### BUG-CRIT-04 · Race condition grave em `todo-tools.js` — `readStore`/`writeStore` não serializados

**Arquivo**: `src/copilot/tools/todo-tools.js`

**Descrição**: As funções `readStore()` e `writeStore()` são assíncronas e usam `fsp.readFile`/`fsp.writeFile`. Quando duas tools são invocadas pelo modelo em paralelo (ex: `todo_create` + `todo_bulk_update`), ambas podem ler o mesmo estado, cada uma fazer suas modificações e a segunda sobrescrever as alterações da primeira:

```
Thread A: readStore() → { tasks: {a: ...} }
Thread B: readStore() → { tasks: {a: ...} }
Thread A: writeStore({ tasks: {a: ..., b: ...} })  ← adiciona 'b'
Thread B: writeStore({ tasks: {a: ..., c: ...} })  ← sobrescreve, 'b' é perdido
```

A escrita atômica via `.tmp` + `rename` protege contra corrupção de arquivo, mas não contra race conditions de leitura-modificação-escrita.

**Correção**: Implementar um mutex assíncrono (fila serial de Promises) ao redor das operações de store:

```js
let _storeMutex = Promise.resolve();

async function withStoreLock(fn) {
    const next = _storeMutex.then(() => fn());
    _storeMutex = next.catch(() => {});
    return next;
}

// Em cada handler:
handler: async (args) => withStoreLock(async () => {
    const store = await readStore();
    // ... modificações ...
    await writeStore(store);
    return result;
})
```

---

### BUG-CRIT-05 · `AlwaysAliveAgent` — double-emit de `task.delta` durante dialog loop

**Arquivo**: `src/copilot/agent/always-alive.js`, método `start()`

**Descrição**: O código registra **dois** listeners de `assistant.message_delta`: um no bloco `start()` (linhas ~320-330) e outro em `task-executor.js` (`executeTask`). Durante o dialog loop, ambos emitem `task.delta`:

1. O listener em `start()` emite: `this.emit('task.delta', { taskId: null, chunk })`
2. O listener em `task-executor.js` emite: `onDelta(chunk, task.id)` → `this.emit('task.delta', { taskId, chunk })`

No modo dialog loop, `sendMessage` é chamado com `timeoutMs: 24h`, portanto ambos ficam ativos simultaneamente, duplicando todos os chunks para consumidores SSE e Socket.io.

**Correção**: Remover o listener de `assistant.message_delta` do `start()` (linhas ~320-330 em `always-alive.js`), mantendo apenas o de `task-executor.js`. O `task-executor.js` é o local canônico para este evento.

```js
// REMOVER este bloco de start():
this.#sessionEventUnsubscribers.push(
    session.on('assistant.message_delta', (evt) => {
        const chunk = evt?.data?.deltaContent ?? evt?.data?.content ?? '';
        if (chunk) this.emit('task.delta', { taskId: null, chunk });
    }),
);
```

---

### BUG-CRIT-06 · `LlmBridgeClient.chatBatch()` — falsa promessa de paralelismo

**Arquivo**: `src/copilot/channel/client.js`, método `chatBatch()`

**Descrição**: O JSDoc diz "UPG-06: Envia múltiplas mensagens em sequência, retornando um array de resultados" e o comentário interno "BUG-HIGH-08 (fix): Promise.all disparava todas as mensagens em paralelo". Porém, a assinatura pública promete paralelismo:

```js
/**
 * @returns {Promise<(ChatResult | { error: string; response: null; ... })[]>}
 */
async chatBatch(messages, opts = {}) {
    const results = [];
    for (const msg of messages) { ... } // SEQUENCIAL
}
```

O problema é que `LLM-A-COMMUNICATION-GUIDE.md` documenta `chatBatch` como modo 4 de paralelismo, criando divergência entre documentação e implementação. Usuários que esperam execução paralela terão latência multiplicada.

**Correção**: Ou documentar explicitamente que é sequencial (e renomear para `chatSequential`) ou implementar paralelismo real usando `Promise.allSettled` com um semáforo:

```js
async chatBatch(messages, opts = {}) {
    const MAX_CONCURRENT = opts.concurrency ?? 1; // 1 = sequencial, seguro
    // Para paralelismo real, implementar semáforo aqui
}
```

---

### BUG-CRIT-07 · `PinnedFilesLoader` — watcher sem `recursive: false` pode perder eventos em subdirs

**Arquivo**: `src/copilot/config/pinned-files-loader.js`

**Descrição**: O `fs.watch` é iniciado com `{ persistent: false }` mas sem `recursive: false` explícito. Em Node.js 22+, o comportamento de `recursive` varia por plataforma (macOS usa `FSEvents` e detecta subdirs; Linux não). Se o diretório `.github/skills/` tiver subdiretórios (ex: `code-audit/SKILL.md`), eventos de mudança em arquivos em subdiretórios **não serão detectados no Linux** (ambiente DevContainer), causando silêncio quando skills são atualizadas.

**Correção**:
```js
// Usar `watch` com recursive em plataformas que suportam, com fallback
const watcher = process.platform === 'linux'
    ? this.#startPollingWatcher(dir)  // chokidar ou polling manual
    : watch(dir, { persistent: false, recursive: true }, callback);
```

Alternativamente, usar `chokidar` que abstrai as diferenças de plataforma.

---

## 3. Bugs Moderados

### BUG-MOD-01 · `session-manager.js` — `buildHookSystemContext()` expõe `close_key` via prompt injection

**Arquivo**: `src/copilot/agent/session-manager.js`

**Descrição**: `buildHookSystemContext()` lê `session.json` e injeta `close_key` no system message. Embora exista sanitização via regex `/^[a-zA-Z0-9_-]{1,64}$/`, o campo `consecutive_unauthorized` é truncado via `Math.trunc` mas não tem limite superior — um valor como `999999999` seria injetado no prompt sem problemas. Adicionalmente, `title` da sessão (se existir no JSON) não é sanitizado.

**Correção**: Adicionar limite superior para `consecutive`: `Math.min(Math.max(0, Math.trunc(rawConsecutive)), 9999)`.

---

### BUG-MOD-02 · `mcp-tool-bridge.js` — Circuit breaker não reseta contadores de boot após falha

**Arquivo**: `src/copilot/bridges/mcp-tool-bridge.js`

**Descrição**: `_bootAttemptCount` é resetado `_bootAttemptCount = 0` apenas em caso de **sucesso** (`mcpTools = await listMcpTools()`). Se o circuit breaker abrir (falha), `_bootAttemptCount` não é resetado, acumulando indefinidamente. Na próxima chamada após o circuit breaker fechar (60s), o delay de backoff já estará no máximo (`_BOOT_BACKOFF_MS[3] = 5000ms`) mesmo que a falha anterior tenha sido há muito tempo.

**Correção**:
```js
if (_mcpCircuitOpen) {
    _bootAttemptCount = 0; // Reset ao abrir circuito, não só no sucesso
    // ...
}
```

---

### BUG-MOD-03 · `hub-tools.js` — `hub_send_message` trunca `message` mas não valida `content` de `StructuredMessageInput`

**Arquivo**: `src/copilot/tools/hub-tools.js`

**Descrição**: A tool trunca `message` em 32 000 chars, mas quando `useStructured=true` e o payload é um objeto, o `context` e `intent` passados ao `chatStructured` podem ultrapassar limites sem truncamento:

```js
payload = {
    context: context ?? safeMessage,  // context pode ser longo sem truncamento
    intent: intent ?? safeMessage,
    // ...
};
```

**Correção**: Aplicar truncamento ao `context` e `intent` também.

---

### BUG-MOD-04 · `socket-ns.js` — rate limit de SSE por IP usa bucket compartilhado com `/memory` e `/pipeline`

**Arquivo**: `src/copilot/terminal/server.js`

**Descrição**: O rate limiter para SSE usa `checkWriteRate(`sse:${sseIp}`)`, o mesmo `_writeRateLimiter` usado para `/memory` e `/pipeline`. Isso significa que 5 requisições POST a `/memory` consomem quota que deveria ser reservada para conexões SSE. Um cliente que faz POSTs normais pode ser inadvertidamente bloqueado de abrir streams SSE.

**Correção**: Criar rate limiters separados para SSE vs operações de escrita HTTP.

---

### BUG-MOD-05 · `web-tools.js` — `web_search` parser HTML frágil com múltiplos match groups

**Arquivo**: `src/copilot/tools/web-tools.js`

**Descrição**: O parser do DDG usa regex `/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gs` que captura o conteúdo interno da tag. Porém, se o DDG incluir tags `<b>` ou `<span>` no título (ex: destaques de busca), o grupo `[2]` conterá HTML, e o `.replace(/<[^>]+>/g, '')` posterior pode não remover adequadamente atributos com `>` escapado ou tags CDATA. Além disso, a classe CSS `result__a` pode mudar sem aviso.

**Correção**: Usar uma biblioteca de parsing HTML leve (ex: `node-html-parser`) ou o endpoint da API do DDG InstantAnswer (JSON puro), que é mais estável que HTML scraping.

---

### BUG-MOD-06 · `always-alive.js` — `#dialogTurnMutex` pode crescer indefinidamente em sessões longas

**Arquivo**: `src/copilot/agent/always-alive.js`

**Descrição**: O comentário `BUG-AA-04 (fix)` afirma que a cadeia do mutex é resetada quando `#dialogTurnQueueDepth === 0`. Porém, o reset acontece em `void next.finally(() => { if (this.#dialogTurnQueueDepth === 0) this.#dialogTurnMutex = Promise.resolve(); })`. O problema: se o `finally` de uma Promise A executa *antes* que a Promise B (que encadeou em A) registre seu `finally`, o contaDor pode zerar prematuramente, quebrando a serialização para promessas futuras. Isso é uma condição de corrida sutil no próprio mecanismo de correção.

**Correção**: Usar um contador atômico via closure e resetar apenas quando confirmado que a fila está vazia *após* o processamento da cauda:

```js
// Usar um ID de geração para detectar se novos itens chegaram
let _mutexGeneration = 0;
const myGen = ++_mutexGeneration;
void next.finally(() => {
    this.#dialogTurnQueueDepth--;
    if (this.#dialogTurnQueueDepth === 0 && _mutexGeneration === myGen) {
        this.#dialogTurnMutex = Promise.resolve();
    }
});
```

---

### BUG-MOD-07 · `repl.js` — `/restart` pode resolver `readyPromise` antes do loop ter parado

**Arquivo**: `src/copilot/terminal/repl.js`

**Descrição**: O handler de `/restart` faz:

```js
const readyPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(...), 30_000);
    alwaysAliveAgent.once('dialog.ready', () => { clearTimeout(timeout); resolve(); });
});
await llmBridgeClient.stopDialogMode();
await readyPromise;
```

O `'dialog.ready'` listener é registrado **antes** de `stopDialogMode()`. Se o loop já estava em `READY:` aguardando input (evento já emitido no passado), o `once` não capturará o evento passado — ficará pendente até o timeout. Mas se o modelo emitir `READY:` imediatamente durante o stop (race condition), o evento pode ser perdido.

**Correção**: Registrar o listener após `stopDialogMode()` resolva, ou usar um estado explícito de "aguardando ready pós-restart".

---

### BUG-MOD-08 · `file-tools.js` — `validatePath` resolve symlinks via `realpathSync` de forma síncrona

**Arquivo**: `src/copilot/tools/file-tools.js`

**Descrição**: A função `validatePath` usa `realpathSync()` — operação síncrona de I/O — dentro de handlers assíncronos. Em ambientes com volumes NFS ou Docker montados (que é o caso do DevContainer), `realpathSync` pode bloquear o event loop por vários segundos.

**Correção**: Converter para `realpath()` async:

```js
async function validatePath(filePath) {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(WORKSPACE_ROOT, filePath);
    let realResolved = resolved;
    try {
        realResolved = await fs.promises.realpath(resolved);
    } catch {
        try {
            const parentDir = await fs.promises.realpath(path.dirname(resolved));
            realResolved = path.join(parentDir, path.basename(resolved));
        } catch { /* usar resolved */ }
    }
    // ...
}
```

---

### BUG-MOD-09 · `orchestrator.js` — `#inflightBySession` nunca é limpo para sessões fechadas

**Arquivo**: `src/copilot/conversation-hub/orchestrator.js`

**Descrição**: `closeSession()` chama `this.#inflightBySession.delete(hubSessionId)`, mas se uma `sendToLlmB()` for chamada *simultaneamente* ao `closeSession()`, a entrada deletada pode ser re-inserida pela lógica interna do `sendToLlmB` (que encadeia e re-seta a cauda). O `Map` pode crescer com entradas "zumbi" de sessões fechadas.

---

### BUG-MOD-10 · `session-config.js` — `buildAlwaysAliveConfig` aplica `onErrorOccurred` padrão mas `session-manager.js` também aplica

**Arquivo**: `src/copilot/config/session-config.js`, `src/copilot/lib/session.js`

**Descrição**: `lib/session.js` `buildSessionConfig()` injeta `onErrorOccurred` padrão (retry/skip/abort) se não fornecido pelo usuário. Mas `buildAlwaysAliveConfig()` chama `createHooks()` de `lib/hooks.js`, que *também* cria um `onErrorOccurred`. Quando `initOrResumeSession` é chamado, o hooks passado já contém `onErrorOccurred` de `createHooks`, e `buildSessionConfig` verifica `if (!composedHooks['onErrorOccurred'])` — portanto **não** sobrescreve. Mas a lógica de `createHooks` usa apenas logging sem retry, enquanto `buildSessionConfig` usa retry/skip/abort. Resultado: o retry automático por erro de modelo **nunca funciona** para sessões always-alive.

**Correção**: `buildAlwaysAliveConfig` deve explicitamente configurar `onErrorOccurred` com retry, ou `initOrResumeSession` deve ter prioridade sobre o hook de `createHooks`.

---

### BUG-MOD-11 · `audit.js` — `getAuditSummary` usa `readFileSync` síncrono no hot path

**Arquivo**: `src/copilot/channel/audit.js`

**Descrição**: `getAuditSummary()` lê o arquivo inteiro com `fs.readFileSync` — bloqueante. É chamado em `bridge-control.js` via `GET /health` (que inclui `hubStore`), e em potencial outros endpoints. Em arquivos de audit que cresçam para MB, isso bloqueia o event loop.

**Correção**: Converter para async com `fs.promises.readFile`, ou usar `readline` para ler apenas as últimas N linhas (tail eficiente).

---

### BUG-MOD-12 · `nerv-bridge.js` — `_onAgentBeforeStop` re-registra listener indefinidamente

**Arquivo**: `src/copilot/bridges/nerv-bridge.js`

**Descrição**: Em `_onAgentBeforeStop`, após o agente reiniciar, é feito:
```js
alwaysAliveAgent.once('ready', () => {
    // ...
    _attachListeners();
    alwaysAliveAgent.on('before-stop', _onAgentBeforeStop); // re-registra
});
```

Porém o `mount()` inicial também chama `alwaysAliveAgent.on('before-stop', _onAgentBeforeStop)`. Se o bridge for desmontado e remontado (`unmount()` + `mount()`), o listener `before-stop` pode ser registrado múltiplas vezes. O `unmount()` chama `alwaysAliveAgent.off('before-stop', _onAgentBeforeStop)`, mas se o ciclo stop/start aconteceu entre `unmount` e `mount`, o listener está orphan.

---

### BUG-MOD-13 · `shell-tools.js` — `ALLOWED_NPM_SCRIPTS` não inclui scripts de diagnóstico comuns

**Arquivo**: `src/copilot/tools/shell/index.js`

**Descrição**: `run_npm_script` bloqueia scripts não na whitelist, mas a whitelist não inclui scripts como `build`, `start`, `dev`, `prebuild`, `postbuild` que são comuns em workflows de desenvolvimento. O agente tentará rodar esses scripts e receberá mensagem de "não permitido", quebrando fluxos legítimos.

**Correção**: Avaliar se a whitelist deveria ser configurável via `tools-config.json` ou via variável de ambiente `COPILOT_NPM_SCRIPT_ALLOWLIST`.

---

### BUG-MOD-14 · `llm-bridge-client.js` — `chatStructured` sempre gera `traceId`/`correlationId` mas não os loga

**Arquivo**: `src/copilot/channel/client.js`, `src/copilot/types/structured-message.js`

**Descrição**: `buildStructuredRequest()` auto-gera `traceId` e `correlationId` via `crypto.randomUUID()`. Porém esses valores são incluídos na mensagem serializada e enviados ao modelo, mas nunca logados nem armazenados no ConversationStore. Se precisar correlacionar um turno com um `traceId` específico para debugging, é impossível recuperar a informação post-facto.

**Correção**: Incluir `traceId`/`correlationId` no `writeTurn` como parte do campo `metadata`.

---

### BUG-MOD-15 · `entry.js` — `pingClient.stop()` pode não existir em todas as versões do SDK

**Arquivo**: `src/copilot/agent/entry.js`

**Descrição**:
```js
pingClient.stop().catch(() => {});
```

O comentário `LEAK-01 (fix)` menciona chamar `pingClient.stop()` para evitar TCP persistente. Porém, a API pública do `CopilotClient` em v0.2.0 expõe `client.stop()` (que encerra o processo CLI) e `client.forceStop()`. Chamar `stop()` em um cliente que nunca foi `start()`-ado pode ter comportamento indefinido. A documentação oficial não menciona chamar `stop()` em clientes não iniciados.

**Correção**: Usar `pingClient.forceStop?.().catch(() => {})` com optional chaining para compatibilidade.

---

## 4. Bugs Leves

### BUG-LEVE-01 · `dialog-watchdog.js` — `stallMs` em ms mas mensagem diz "em segundos"

**Arquivo**: `src/copilot/agent/dialog-watchdog.js`

O log diz `Math.round(stalledMs / 1000)` segundos — correto. Mas a variável `stalledMs` é somada em `Date.now() - this.#lastActivity` (ms), enquanto a comparação é `stalledMs > this.#stallMs` onde `stallMs` é passado como ms. Correto matematicamente, mas o nome `stallMs` é ambíguo — poderia ser `stallThresholdMs` para clareza.

---

### BUG-LEVE-02 · `gh-bridge.js` — `runIcon` ignora conclusão `'timed_out'`

**Arquivo**: `src/copilot/bridges/gh-bridge.js`

`runIcon` mapeia `cancelled` mas não `timed_out`, que é um valor válido retornado pela API GitHub. Resultará em `'⚠️'` genérico para runs que deram timeout.

---

### BUG-LEVE-03 · `store.js` — índice `idx_conv_turns_user_unread` com cláusula `WHERE` redundante

**Arquivo**: `src/copilot/conversation-hub/store.js`

```sql
CREATE INDEX IF NOT EXISTS idx_conv_turns_user_unread ON copilot_conversation_turns(hub_session_id)
    WHERE role = 'user' AND user_read = 0;
```

Este índice parcial já cobre o caso de `getPendingUserMessages`. O índice `idx_conv_turns_unread` acima dele já existe com `WHERE user_read = 0`. Dois índices parciais sobrepostos sem necessidade clara.

---

### BUG-LEVE-04 · `web-tools.js` — `web_search` não trata redirecionamentos do DDG para URLs internas

**Arquivo**: `src/copilot/tools/web-tools.js`

A validação de redirect (`redirectCheck`) só ocorre em `web_fetch`. Em `web_search`, os URLs extraídos via `uddg` param não são validados contra `PRIVATE_HOST_RE` antes de serem retornados ao modelo, que poderia usar `web_fetch` para acessar uma URL interna sugestionada pelos resultados.

---

### BUG-LEVE-05 · `conversation-hub/store.js` — `syncFromSdkHistory` usa `LIKE` com `ESCAPE` mas não sanitiza o ID completamente

**Arquivo**: `src/copilot/conversation-hub/store.js`

O escape de `%` e `_` em `sdkTurnId` está correto, mas o `sdkTurnId` pode conter outros caracteres que SQLite interpreta em LIKE (por exemplo `[` em alguns modos de compatibilidade). A sanitização deveria usar `= ?` com JSON `includes`, não LIKE.

---

### BUG-LEVE-06 · `alias-store.js` — resolução de alias limita a 5 níveis mas não detecta loops

**Arquivo**: `src/copilot/bridges/alias-store.js`

Um loop de alias (`/a` → `/b`, `/b` → `/a`) consumirá 5 iterações silenciosamente sem aviso ao usuário que o alias está em loop.

---

### BUG-LEVE-07 · `permission-tools.js` — usa `alwaysAliveAgent` diretamente (import circular potencial)

**Arquivo**: `src/copilot/tools/permission-tools.js`

Importa diretamente `alwaysAliveAgent` de `../agent/always-alive.js`. Dependendo da ordem de carregamento de módulos, pode gerar referência circular se `always-alive.js` importar de `tools/index.js`. Deve ser verificado via `madge` ou similar.

---

### BUG-LEVE-08 · `structured-message.js` — `StructuredMessageSchema` usa `.strict()` mas `buildStructuredRequest` pode falhar com campos extras legítimos

**Arquivo**: `src/copilot/types/structured-message.js`

`.strict()` rejeita qualquer campo não declarado no schema. Se o código LLM-A passar um campo extra (ex: `attachments`), o `buildStructuredRequest` lançará `ZodError`. O comentário `UPG-PROP-03` está correto em intenção, mas LLM-A pode inadvertidamente incluir campos quando usa spread de objetos.

---

### BUG-LEVE-09 · `always-alive.js` — `#lastPrInfo` exposto como getter público sem validação

**Arquivo**: `src/copilot/agent/always-alive.js`

`get lastPrInfo()` retorna o objeto interno mutável diretamente. Um consumer que o modifique altera o estado interno do agente. Retornar `{ ...this.#lastPrInfo }` (cópia rasa) seria mais seguro.

---

### BUG-LEVE-10 · `todo-tools.js` — `todoDeleteTool` não verifica se tarefa tem subtarefas antes de cascade=false

**Arquivo**: `src/copilot/tools/todo-tools.js`

Com `cascade: false`, as subtarefas são desvinculadas (tornam-se raiz). O modelo pode não saber quantas subtarefas serão "orfanizadas", pois o resultado retorna apenas `deleted: [parentId]` sem mencionar quantas subtarefas foram desvinculadas.

---

### BUG-LEVE-11 · `git-tools.js` — `git_commit` usa `exec` (shell) em vez de `execFile`

**Arquivo**: `src/copilot/tools/git/index.js`

```js
const execAsync = promisify(exec);  // ← exec (shell), não execFile
```

Enquanto `file-tools.js` usa `execFile` corretamente, `git-tools.js` usa `exec` com interpolação de string via template, criando risco de injeção de comandos via `message` de commit se o modelo gerar uma mensagem com metacaracteres shell. A sanitização de aspas via `replace(/"/g, '\\"')` não é suficiente (ex: backticks, `$(...)`).

---

### BUG-LEVE-12 · `pinned-files-loader.js` — `readDir` usa `readdir` síncrono internamente via `fs` (não `fsp`)

**Arquivo**: `src/copilot/config/pinned-files-loader.js`

A função `#loadDir` usa `await readdir(dir)` de `node:fs/promises` (correto), mas o `#startWatchers()` usa `watch(dir, ...)` de `node:fs` (síncrono, OK). Porém `#loadFile` (chamado dentro de `#loadDir`) usa `readFile` async — correto. Sem bug, mas vale revisar se o `readdir` sem `{ withFileTypes: true }` retorna apenas nomes (strings), o que é diferente de `{ withFileTypes: true }` que retorna `Dirent`. A versão atual sem `withFileTypes` é correta para o uso, mas ao fazer `stat(filePath)` posterior há um TOCTOU (time-of-check vs time-of-use).

---

## 5. Gaps de Conformidade com SDK Oficial

### SDK-01 · `onPermissionRequest` obrigatório em v0.2.0 — SessionConfig sem ele gera erro

**Arquivo**: `src/copilot/routes/sessions.js`, `src/copilot/lib/session.js`

Em v0.2.0, de acordo com o release: "Require permission handler on session creation" (#554). O campo `onPermissionRequest` passou a ser **obrigatório**. Em `routes/sessions.js`, `POST /sessions`:

```js
const session = await createSdkSession({
    onPermissionRequest: approveAll,  // ← OK, está presente
    model: safeModel,
    // ...
});
```

Mas em `lib/session.js` `buildSessionConfig()`, se `opts.onPermissionRequest === undefined`, o campo simplesmente é omitido do config (via `pickDefined`). Isso causará erro no SDK v0.2.0. A correção é usar `approveAll` como default explícito.

---

### SDK-02 · `session.on()` retorna `() => void` — mas os tipos internos do SDK v0.2.0 mudaram

**Arquivo**: `src/copilot/agent/always-alive.js`

O código trata corretamente `session.on()` como retornando `() => void`. Porém, de acordo com o npm v0.2.0: "Subscribe to a specific session lifecycle event type. Returns an unsubscribe function." A tipagem `CopilotSession` pode ter mudado em v0.2.0 para exigir o tipo explícito do evento. Os `// @ts-check` nos arquivos devem ser validados via `tsc --strict`.

---

### SDK-03 · `systemMessage.mode = 'customize'` — API v0.2.0 com sections nomeadas

**Arquivo**: `src/copilot/lib/session.js`, `src/copilot/config/system-prompt.js`

O SDK v0.2.0 introduziu `mode: 'customize'` com `sections` nomeadas (10 seções: `identity`, `tone`, `tool_efficiency`, `environment_context`, `code_change_rules`, `guidelines`, `safety`, `tool_instructions`, `custom_instructions`, `last_instructions`). Cada seção suporta `action: 'replace' | 'remove' | 'append' | 'prepend'` e também um callback `transform`.

O código atual usa `mode: 'append'` (v0.1.x) ou `mode: 'customize'` com `content` string (sem `sections`). Isso pode ser compatível como fallback, mas não aproveita a granularidade do novo modo. As constantes `SYSTEM_PROMPT_SECTIONS` definidas em `system-prompt.js` antecipam esta API mas não estão sendo usadas.

**Correção**: Migrar `buildHookContextAppendMessage` para usar `mode: 'customize'` com `sections.guidelines`:

```js
return {
    mode: 'customize',
    sections: {
        guidelines: { action: 'append', content: hookContext }
    }
};
```

---

### SDK-04 · `session.getMessages()` pode não existir em todas as versões

**Arquivo**: `src/copilot/agent/always-alive.js`, método `#syncSdkHistory`

O código verifica:
```js
if (typeof sdkSession.getMessages !== 'function') {
    log('WARN', '[AlwaysAlive] AI.4: sdkSession.getMessages() não disponível...');
    return;
}
```

O método `getMessages()` **não** está na documentação oficial do SDK npm v0.2.0. Ele existe no README como exemplo interno mas não é parte da API pública estável. Em versões futuras pode ser removido sem aviso.

---

### SDK-05 · `session.rpc.*` — API não documentada, uso de RPC interno

**Arquivo**: `src/copilot/tools/session-rpc-tools.js`

As tools `session_mode_set`, `session_plan_read`, etc. usam `session.rpc.mode.get()`, `session.rpc.plan.read()` — APIs JSON-RPC internas do CLI que não fazem parte do contrato público do SDK Node.js. O SDK v0.2.0 adicionou suporte explícito a "agent selection and session compaction APIs" (#544), mas via métodos de sessão como `session.setModel()`, não via `rpc.*`.

Se o CLI atualizar seu protocolo interno RPC, estas tools quebrarão silenciosamente. Além disso, o `rpc` não está tipado no SDK, causando `any` em todo o código.

---

### SDK-06 · `sendAndWait` — segundo parâmetro timeout vs opções

**Arquivo**: `src/copilot/agent/task-executor.js`

```js
const event = await session.sendAndWait(sendOpts, task.timeoutMs ?? 60_000);
```

No SDK v0.2.0: `session.sendAndWait({ prompt: "..." }, timeout)` — onde o segundo parâmetro é um número (timeout em ms). Isso parece estar correto. Porém, em versões anteriores (v0.1.x), o segundo parâmetro poderia ser um objeto de opções. Verificar compatibilidade.

---

### SDK-07 · `client.ping()` — argumento string vs sem argumento

**Arquivo**: `src/copilot/agent/entry.js`, `src/copilot/routes/client.js`

```js
pingClient.ping('boot health check')
client.ping('sdk-api health check')
```

A API oficial: `client.ping()` — sem argumentos na documentação atual. Alguns exemplos mostram `client.ping()` sem string. Passar uma string pode ser ignorado ou causar erro em versões futuras.

---

### SDK-08 · `client.stop()` retorna `Error[]` mas o código ignora o retorno em vários locais

**Arquivo**: `src/copilot/lib/client.js`

```js
const errors = await _client.stop();
if (errors.length > 0) {
    log('WARN', `[lib/client] Erros ao parar: ${errors.map((e) => e.message).join(', ')}`);
}
```

Este arquivo trata corretamente. Mas em `always-alive.js` o client não é `stop()`-ado explicitamente — apenas a session é `disconnect()`-ada. O `CopilotClient` (processo CLI) fica em execução mesmo após `stop()` do agente. Isso causa vazamento de processo.

---

### SDK-09 · `defineTool` — `overridesBuiltInTool` vs `is_override` vs propriedade de classe

**Arquivo**: `src/copilot/tools/tool-factory.js`, múltiplos arquivos de tools

A documentação do SDK .NET menciona: "you must explicitly opt in by setting `is_override` in the tool's `AdditionalProperties`". O SDK Node.js usa `overridesBuiltInTool: true` como propriedade no objeto de configuração de `defineTool`. O `withSkipPermission` aplica `skipPermission: true`. Mas há tools que usam `buildTool` sem definir `overridesBuiltInTool` mesmo quando sobrescrevem ferramentas built-in (ex: `web_fetch`, `web_search` em `web-tools.js`). `buildTool` define `overridesBuiltInTool` apenas se `options.overridesBuiltInTool === true`, não como default.

Em `tools-bootstrap.js`:
```js
const finalTools = allTools.map((t) => (t.overridesBuiltInTool ? t : { ...t, overridesBuiltInTool: true }));
```

Este mapeamento força `overridesBuiltInTool: true` em todas as tools — o que resolve o problema, mas é uma gambiarra. A documentação do SDK diz que `overridesBuiltInTool` deve ser explícito para tools que de fato sobrescrevem. Forçar em todas pode suprimir advertências legítimas do SDK quando uma tool tem nome duplicado acidentalmente.

---

## 6. Gaps de Segurança

### SEC-01 · `exec_command` — tokenizador não cobre todos os casos de metacaracteres

**Arquivo**: `src/copilot/tools/shell/index.js`

A função `tokenizeShell` e `hasShellMetaOutsideQuotes` cobrem os casos mais comuns, mas têm lacunas:

1. Process substitution: `<(command)` — não detectada por `'|;&<>'`
2. Heredocs: `<< EOF ... EOF` — o `<` é detectado, mas poderia ser refinado
3. Brace expansion: `{a,b,c}` — não bloqueado, pode ser usado para contornar blocklist
4. Tilde expansion: `~root/.ssh/id_rsa` — não bloqueado

Para um agente autônomo, recomenda-se usar uma allowlist de executáveis conhecidos (`git`, `node`, `npm`, `npx`, `ls`, `cat`, `grep`, `fd`, `rg`, etc.) em vez de blocklist de metacaracteres.

---

### SEC-02 · `session-manager.js` — `buildHookSystemContext` lê arquivos com `readFile` mas sem limite de tamanho

**Arquivo**: `src/copilot/agent/session-manager.js`

```js
const content = await readFile(BRIEFING_FILE, 'utf8');
```

Se `session-briefing.md` ou `session.json` forem muito grandes (ex: corrompidos ou injetados com dados), todo o conteúdo vai para o system message, potencialmente esgotando o context window e causando falhas silenciosas de compaction.

**Correção**: Adicionar limite de tamanho:
```js
const content = (await readFile(BRIEFING_FILE, 'utf8')).slice(0, 8000); // max 8KB
```

---

### SEC-03 · `inject.js` — `checkLlmBHealth` parseia JSON de resposta sem validação de schema

**Arquivo**: `src/copilot/channel/inject.js`

```js
const parsed = JSON.parse(body);
return {
    ok: parsed.ok === true,
    ready: parsed.dialogLoopActive === true,
    // ...
};
```

Se um proxy ou interceptador retornar JSON malicioso (ex: com prototype pollution via `__proto__`), o parse pode poluir o prototype. Usar `JSON.parse` com reviver ou `Object.create(null)` para dados externos.

---

### SEC-04 · `server.js` — `TERMINAL_TOKEN` comparação via `===` suscetível a timing attack

**Arquivo**: `src/copilot/terminal/server.js`

```js
if (authHeader !== `Bearer ${TERMINAL_TOKEN}`) {
```

Comparação de string via `===` tem tempo constante na prática em V8 para strings curtas, mas para tokens longos pode ser suscetível a timing attack em ambientes adversariais. Usar `crypto.timingSafeEqual` com `Buffer.from`:

```js
import { timingSafeEqual } from 'node:crypto';
const expected = Buffer.from(`Bearer ${TERMINAL_TOKEN}`);
const provided = Buffer.from(authHeader ?? '');
if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    // 401
}
```

---

### SEC-05 · `file-tools.js` — `BLOCKED_PATTERNS` não cobre arquivos `.npmignore`, `.gitignore` com segredos

**Arquivo**: `src/copilot/tools/file-tools.js`

Arquivos como `.aws/credentials`, `~/.kube/config`, `.docker/config.json` não estão na blocklist. Se o `WORKSPACE_ROOT` estiver no home ou sob um mount que inclua esses paths, eles poderiam ser lidos.

---

### SEC-06 · `socket-ns.js` — `join:session` verifica existência mas não ownership/autorização

**Arquivo**: `src/copilot/conversation-hub/socket-ns.js`

O fix `SEC-05` verifica que a sessão existe antes de entrar na sala. Porém, qualquer cliente autenticado pode entrar em **qualquer** sessão, incluindo sessões de outros usuários. Em deployments multi-usuário, isso expõe conversas cruzadas.

**Correção**: Associar `hubSessionId` ao `socket.userId` no momento da criação, e verificar autorização no `join:session`:

```js
socket.on('join:session', ({ hubSession }) => {
    const session = store.getHubSession(hubSession);
    if (!session || session.owner_id !== socket.userId) {
        socket.emit('error:join', { reason: 'unauthorized' });
        return;
    }
    socket.join(hubSession);
});
```

---

### SEC-07 · `gh-bridge.js` — `rawApi` permite chamadas a qualquer endpoint GitHub sem restrições

**Arquivo**: `src/copilot/bridges/gh-bridge.js`

A tool `rawApi` e o `handleGhRawApi` permitem ao modelo (via `request_user_input`) induzir chamadas `gh api` a qualquer endpoint, incluindo endpoints de mutations destrutivas (`DELETE /repos/{owner}/{repo}`, `PUT /orgs/{org}/members`, etc.). Não há filtro de método ou endpoint.

**Correção**: Restringir `rawApi` a `GET` por default e manter uma allowlist de endpoints ou prefixos permitidos.

---

### SEC-08 · `web-tools.js` — `web_fetch` não valida CNAMEs que resolvem para IPs privados

**Arquivo**: `src/copilot/tools/web-tools.js`

A validação SSRF é feita via regex no `hostname` da URL. Um atacante pode registrar um domínio público que via DNS resolve para `127.0.0.1` (DNS rebinding). A proteção de hostname não previne isso. A solução completa requer resolução DNS antes do fetch e validação do IP resultante, o que não é trivial em `fetch()` nativo.

**Correção de curto prazo**: Usar `node-fetch` com `agent` customizado que valida o IP após DNS resolve, ou usar `got` com opção `dnsCache` e validator.

---

## 7. Gaps de Arquitetura

### ARCH-01 · Ausência de schema formal para `session.json` — mutações não auditadas

**Arquivo**: `src/copilot/agent/session-manager.js`

O tipo `AliveAgentState` tem ~15 campos, mas campos novos são adicionados incrementalmente via `writeStateAsync({ newField: value })` sem validação de schema. Isso pode levar a divergência entre o estado em disco e o tipo TypeScript. Recomenda-se usar Zod para validar ao ler.

---

### ARCH-02 · `ConversationStore` e `AlwaysAliveAgent` usam DBs diferentes — sem transação cross-componente

O `conversationStore` usa `maestro.sqlite` (via `getDb()`), enquanto o `session-manager.js` usa arquivos JSON (`.github/hooks/state/sdk-always-alive.json`). Não há como fazer uma operação atômica que atualize ambos simultaneamente, criando possibilidade de estados inconsistentes após crash.

---

### ARCH-03 · `LlmBridgeClient` e `AlwaysAliveAgent` são singletons module-level — dificulta testes

Os singletons `alwaysAliveAgent` e `llmBridgeClient` são exportados como variáveis de módulo. Isso torna impossível ter múltiplas instâncias em testes paralelos e requer mocks de módulo (`jest.mock`, `vi.mock`). A injeção de dependência via construtor seria superior.

---

### ARCH-04 · `dialog.js` (terminal) — dependência direta em `conversationHub.store` sem abstração

**Arquivo**: `src/copilot/terminal/dialog.js`

O `sendTurn` chama `conversationHub.store.writeTurn` diretamente. Se o hub não estiver inicializado (modo standalone sem servidor), a chamada falha silenciosamente (wrapped em `try/catch`), mas o código continua. Esta acoplamento direto ao singleton dificulta testes e uso do terminal sem hub.

---

### ARCH-05 · `tools-bootstrap.js` força `overridesBuiltInTool: true` em todas as tools

**Arquivo**: `src/copilot/agent/tools-bootstrap.js`

```js
const finalTools = allTools.map((t) => (t.overridesBuiltInTool ? t : { ...t, overridesBuiltInTool: true }));
```

Isso mascara ferramentas com nomes duplicados (conflito acidental com built-ins do CLI) sem gerar erro. Uma tool chamada `read_file` (built-in do CLI) seria silenciosamente sobrescrita. Adicionar uma verificação de colisão de nomes antes do `map`.

---

### ARCH-06 · `StructuredMessageSchema.strict()` causa `ZodError` em campos extras legítimos

**Arquivo**: `src/copilot/types/structured-message.js`

O `.strict()` rejeita campos desconhecidos. LLM-B pode adicionar campos extras legítimos na resposta (ex: `confidence`, `sources`). Usar `.passthrough()` para resposta e manter `.strict()` apenas para o request seria mais robusto.

---

### ARCH-07 · Ausência de health check para `ConversationStore` no modo terminal standalone

O `GET /health` em `bridge-control.js` verifica `conversationStore.db?.prepare('SELECT 1').get()`, mas o servidor terminal (`server.js` porta 3009) não tem endpoint `/hub-health`. Se o SQLite do hub corromper, o terminal não reporta.

---

## 8. Oportunidades de Melhoria

### UPG-01 · Migrar `git-tools.js` de `exec` (shell) para `execFile`

Substituir `promisify(exec)` por `promisify(execFile)` com argumentos separados para eliminar qualquer possibilidade de injeção de shell via mensagem de commit.

---

### UPG-02 · Implementar `OpenTelemetry` nativo via SDK v0.2.0

O SDK v0.2.0 suporta OTLP nativo via `new CopilotClient({ telemetry: { otlpEndpoint: 'http://...' } })`. O código atual tem `startSpan()` com fallback gracioso que carrega `@opentelemetry/sdk-trace-node` dinamicamente. Migrar para o telemetry do SDK elimina a dependência extra.

---

### UPG-03 · `todo-tools.js` — Migrar para SQLite em vez de JSON file

O sistema todo atual usa JSON + escrita atômica. Com múltiplas tools chamadas em sequência pelo modelo, mesmo com mutex, há latência de I/O. Migrar para uma tabela SQLite no mesmo `maestro.sqlite` (ou `copilot.db`) eliminaria o mutex e aproveitaria as transações do banco.

---

### UPG-04 · Adicionar `blob` attachment type à `handleInject`

O SDK v0.2.0 adicionou suporte a `type: 'blob'` para attachments base64 em memória. O handler de `/inject` aceita `type: 'file'` e `type: 'directory'`, mas não `type: 'blob'`. Adicionar suporte ao novo tipo evita escrita em disco para capturas de tela ou imagens geradas.

---

### UPG-05 · `LlmBridgeClient` — implementar `getLastNPairs` com paginação cursor-based

O `getLastNPairs` atual usa slice linear. Em históricos de 500 entradas, slices frequentes têm custo O(n). Implementar cursor-based: manter índice do último "user" visto e navegar ao invés de varrer.

---

### UPG-06 · `AlwaysAliveAgent` — adicionar `session.on('session.idle', ...)` para detecção de ociosidade real

O SDK emite `session.idle` quando o agente conclui processamento. Monitorar este evento para métricas precisas de latência, substituindo estimativas baseadas em timestamps.

---

### UPG-07 · `ConversationStore` — adicionar campo `owner_id` nas tabelas para multi-tenancy

Preparar as tabelas `copilot_hub_sessions` e `copilot_conversation_turns` para suportar múltiplos usuários adicionando `owner_id TEXT` e índice correspondente.

---

### UPG-08 · `structured-message.js` — versionar schema via SemVer explícito no campo `version`

O campo `version: z.string().default('1.0')` é string livre. Usar validação semver: `z.string().regex(/^\d+\.\d+(\.\d+)?$/)` e verificar compatibilidade no `parseStructuredResponse`.

---

### UPG-09 · `web-tools.js` — substituir DDG HTML scraping por DuckDuckGo Instant Answer API

```
https://api.duckduckgo.com/?q=QUERY&format=json&no_html=1&skip_disambig=1
```

Esta API JSON é mais estável que HTML scraping e retorna `RelatedTopics` estruturados.

---

### UPG-10 · Implementar `chatBatch` com paralelismo real controlado por semáforo

```js
async chatBatch(messages, { concurrency = 3, ...opts } = {}) {
    const semaphore = new Array(concurrency).fill(Promise.resolve());
    return Promise.allSettled(
        messages.map((msg, i) => {
            const slot = i % concurrency;
            semaphore[slot] = semaphore[slot].then(() => this.chat(msg, opts));
            return semaphore[slot];
        })
    );
}
```

---

### UPG-11 · `AlwaysAliveAgent` — expor `dialogLoopActive` via SSE para dashboard

Atualmente o dashboard deve pedir `GET /api/copilot/status` por polling. Emitir `dialog.loop.changed` via SSE quando o estado mudar permite que o dashboard reaja em tempo real.

---

### UPG-12 · Adicionar teste de integração para o ciclo stop/start do `AlwaysAliveAgent`

O Sprint 24 pendente menciona integration tests para o módulo copilot. O ciclo `stop()` + `start()` é especialmente frágil (listeners, singletons, estado em disco). Um teste que executa 3 ciclos completos capturaria regressões de memória e listeners orfãos.

---

## 9. Upgrades Recomendados

### SDK Upgrade para v0.2.0 (se ainda em v0.1.x)

Verificar versão instalada com `npm list @github/copilot-sdk`. Se < 0.2.0, o upgrade traz:

| Feature                           | Impacto                                                        |
| --------------------------------- | -------------------------------------------------------------- |
| `mode: 'customize'` com sections  | Habilita `SYSTEM_PROMPT_SECTIONS` já definidas mas não usadas  |
| `skipPermission: true` em tools   | Elimina necessidade de `withSkipPermission` ad-hoc             |
| `blob` attachment type            | Suporte a imagens em memória sem escrita em disco              |
| `onPermissionRequest` obrigatório | Força conformidade em todos os `createSession`                 |
| `session.destroy()` explícito     | Limpeza determinística de recursos                             |
| OTLP telemetry nativo             | Remove dependência opcional de `@opentelemetry/sdk-trace-node` |

---

### Zod v4 Migration

O `tool-factory.js` já detecta `_zod` (Zod v4). Migrar de `zod` v3 para v4 traz:

- Performance ~3× mais rápida na validação
- Suporte nativo a `z.uuid()`, `z.datetime()` sem plugins externos
- `z.input<typeof schema>` / `z.output<typeof schema>` inference melhorada

Atenção: `zod-to-json-schema` precisa ser atualizado para a versão compatível com Zod v4.

---

### Node.js `node:sqlite` nativo (Node 22.5+)

O `PLANO-AMBIENTE-PERMANENTE.md` menciona preferência por `node:sqlite`. Em Node.js 24 (ambiente do projeto), `node:sqlite` é estável e evita a dependência `better-sqlite3` (compilação nativa). A migração do `ConversationStore` de `getDb()` (better-sqlite3) para `node:sqlite` reduziria dependências externas.

---

### `chokidar` para `PinnedFilesLoader`

Substituir `fs.watch` por `chokidar` v4 (ESM-first, suporte a recursive em Linux, debounce integrado):

```js
import { watch } from 'chokidar';
const watcher = watch(dirs, { persistent: false, ignoreInitial: true, depth: 2 });
watcher.on('change', (path) => this.#scheduleReload(path));
```

---

### `better-sqlite3` WAL mode verification

Em `store.js`, o WAL checkpoint é agendado mas não há verificação de que o banco foi aberto em WAL mode. Adicionar na inicialização:

```js
this.#db.pragma('journal_mode=WAL');
this.#db.pragma('synchronous=NORMAL');
this.#db.pragma('cache_size=-32000'); // 32MB cache
```

---

## 10. Matriz de Prioridades

| ID          | Categoria       | Severidade | Esforço | Impacto | Prioridade |
| ----------- | --------------- | ---------- | ------- | ------- | ---------- |
| BUG-CRIT-01 | Bug Crítico     | 🔴 Crítico  | Baixo   | Alto    | **P0**     |
| BUG-CRIT-02 | Bug Crítico     | 🔴 Crítico  | Baixo   | Alto    | **P0**     |
| BUG-CRIT-04 | Bug Crítico     | 🔴 Crítico  | Médio   | Alto    | **P0**     |
| BUG-CRIT-05 | Bug Crítico     | 🔴 Crítico  | Baixo   | Médio   | **P0**     |
| SDK-01      | SDK Conformance | 🔴 Crítico  | Baixo   | Alto    | **P0**     |
| BUG-CRIT-03 | Bug Crítico     | 🟠 Alto     | Médio   | Médio   | **P1**     |
| BUG-CRIT-06 | Bug Crítico     | 🟠 Alto     | Médio   | Médio   | **P1**     |
| BUG-CRIT-07 | Bug Crítico     | 🟠 Alto     | Alto    | Baixo   | **P1**     |
| SEC-01      | Segurança       | 🟠 Alto     | Alto    | Alto    | **P1**     |
| SEC-06      | Segurança       | 🟠 Alto     | Médio   | Alto    | **P1**     |
| SEC-07      | Segurança       | 🟠 Alto     | Baixo   | Médio   | **P1**     |
| BUG-MOD-01  | Bug Moderado    | 🟡 Médio    | Baixo   | Médio   | **P2**     |
| BUG-MOD-04  | Bug Moderado    | 🟡 Médio    | Baixo   | Baixo   | **P2**     |
| BUG-MOD-08  | Bug Moderado    | 🟡 Médio    | Médio   | Médio   | **P2**     |
| BUG-MOD-11  | Bug Moderado    | 🟡 Médio    | Baixo   | Médio   | **P2**     |
| SDK-03      | SDK Conformance | 🟡 Médio    | Médio   | Médio   | **P2**     |
| SDK-05      | SDK Conformance | 🟡 Médio    | Alto    | Médio   | **P2**     |
| ARCH-03     | Arquitetura     | 🟡 Médio    | Alto    | Alto    | **P2**     |
| UPG-03      | Upgrade         | 🟢 Baixo    | Alto    | Alto    | **P3**     |
| UPG-09      | Upgrade         | 🟢 Baixo    | Baixo   | Médio   | **P3**     |
| UPG-12      | Upgrade         | 🟢 Baixo    | Alto    | Alto    | **P3**     |

---

## Apêndice: Arquivos de Maior Risco

| Arquivo                            | Bugs Identificados                        | Complexidade | Prioridade de Revisão |
| ---------------------------------- | ----------------------------------------- | ------------ | --------------------- |
| `agent/always-alive.js`            | CRIT-01, CRIT-03, CRIT-05, MOD-06, MOD-12 | Extrema      | **Crítica**           |
| `conversation-hub/store.js`        | CRIT-02, LEVE-03, LEVE-05                 | Alta         | **Alta**              |
| `conversation-hub/orchestrator.js` | CRIT-02, MOD-09, LEVE-01                  | Alta         | **Alta**              |
| `tools/todo-tools.js`              | CRIT-04, LEVE-10                          | Alta         | **Alta**              |
| `agent/session-manager.js`         | MOD-01, SEC-02, SDK-01                    | Média        | **Alta**              |
| `tools/shell/index.js`             | SEC-01, MOD-13                            | Média        | **Média**             |
| `terminal/dialog.js`               | CRIT-02, ARCH-04                          | Alta         | **Média**             |
| `tools/git/index.js`               | LEVE-11                                   | Baixa        | **Média**             |
| `terminal/server.js`               | MOD-04, SEC-04                            | Alta         | **Média**             |
| `channel/client.js`                | CRIT-06, MOD-14                           | Média        | **Baixa**             |

---

*Documento gerado por análise estática dos 104 arquivos do módulo `src/copilot/`, cruzado com documentação oficial `@github/copilot-sdk` v0.2.0 (npm, GitHub releases, docs.github.com). Data: 2026-03-30.*
