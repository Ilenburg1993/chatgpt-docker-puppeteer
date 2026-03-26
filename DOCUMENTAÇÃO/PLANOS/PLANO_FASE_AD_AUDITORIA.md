# Plano de Execução — Fase AD: Auditoria `src/copilot`

> **Documento**: Plano detalhado de execução da Fase AD  
> **Origem**: Auditoria técnica `DOCUMENTAÇÃO/AUDITORIAS/AUDITORIA_INDEPENDENTE_SRC_COPILOT.md`  
> **Criado em**: 2026-03-25  
> **Validado por**: análise estática sobre código real (HEAD `bdaa1347`)  
> **Status geral**: 🔴 PLANEJADO — execução pendente

---

## 1. Metodologia de Validação

Cada item da auditoria foi verificado diretamente no código-fonte antes de incluir neste plano.
Itens descartados não entram no plano de execução.

| Decisão     | Critério                                                                  |
| ----------- | ------------------------------------------------------------------------- |
| ✅ INCLUÍDO  | Bug/vulnerabilidade confirmado no código atual, tem solução clara          |
| ⚠️ ADIADO   | Válido mas complexidade/escopo exige fase separada futura                  |
| ❌ DESCARTADO | Inaplicável (Node.js 24 fixo, acesso controlado, ou já corrigido)         |

---

## 2. Itens Incluídos — por Sprint

### Sprint AD-1: Bugs Críticos (🔴 Executar primeiro)

#### AD-1.1 — BUG-01: `AlwaysAliveAgent.stop()` não para o `DialogWatchdog`

**Confirmado**: `stop()` (linha 354 de `always-alive.js`) nunca chama `this.#watchdog.stop()`.
`stopDialogLoop()` (linha 696) chama, mas `stop()` não chama `stopDialogLoop()`.

**Arquivo**: `src/copilot/agent/always-alive.js`

**Correção**: Dentro de `stop()`, após `this.#setStatus('stopped')`, adicionar:
```js
if (this.#dialogLoopActive) {
    this.#dialogLoopActive = false;
    this.#watchdog?.stop();
}
```

**Teste**: verificar que após `agent.stop()`, `alwaysAliveAgent.#watchdog` não emite mais eventos.

---

#### AD-1.2 — BUG-03: Race condition em `ConversationStore.writeTurn`

**Confirmado**: `SELECT MAX(turn_number)` + `INSERT` em `store.js` não estão dentro de `db.transaction()`.

**Arquivo**: `src/copilot/conversation-hub/store.js`

**Correção**: Encapsular o corpo inteiro de `writeTurn()` em `db.transaction(fn)()`.

---

#### AD-1.3 — BUG-04: `parseError` nunca populado em `chatStructured()`

**Confirmado**: `client.js` retorna `{ structured, raw, taskId, ... }` sem `parseError`.
`orchestrator.js` lê `result.parseError` — sempre `undefined`.

**Arquivos**: `src/copilot/channel/client.js`, `src/copilot/types/structured-message.js`

**Correção mínima**:
```js
// client.js — chatStructured():
const structured = parseStructuredResponse(chatResult.response);
const parseError = (chatResult.response && !structured)
    ? new Error(`Resposta não-StructuredMessage (${chatResult.responseLen} chars)`)
    : undefined;
return { structured, raw: chatResult.response, ..., parseError };
```
Adicionar `parseError?: Error` ao typedef `StructuredChatResult`.

---

#### AD-1.4 — SEC-02: FTS5 injection em `store.js`

**Confirmado**: `opts.search.replace(/['"]/g, ' ')` é insuficiente. Operadores FTS5 (`AND`, `OR`,
`NOT`, `NEAR`, `*`, `^`, `column:`) passam direto.

**Arquivo**: `src/copilot/conversation-hub/store.js`

**Correção**: Escapar via frase exata:
```js
const ftsQuery = `"${opts.search.replace(/"/g, ' ').trim()}"`;
if (!ftsQuery || ftsQuery === '""') return [];
```
Busca por frase exata (coloca entre aspas duplas FTS5) — qualquer input do usuário torna-se literal.

---

### Sprint AD-2: Bugs Altos (🟠)

#### AD-2.1 — BUG-02: Leak de listener em `sendDialogTurn` no ramo `question.pending`

**Confirmado**: Quando `onPending` dispara, registra `once('dialog.reply')` interno mas:
  - Se `dialog.stopped` (registrado **antes** do `else`) disparar, o `newTimeout` e o listener
    interno não são limpos — timer + listener órfãos.

**Arquivo**: `src/copilot/agent/always-alive.js`

**Correção**: Dentro do `onPending`, registrar também um handler `onStop` que limpa `newTimeout`
e deregistra `onReply`:
```js
const onPending = (_) => {
    clearTimeout(timeoutHandle);
    const newTimeout = setTimeout(() => {
        this.off('dialog.reply', onReply);
        this.off('dialog.stopped', onStop);
        reject(new SessionError(`sendDialogTurn timeout após ${timeout}ms`, 'DIALOG_TIMEOUT'));
    }, timeout);
    const onReply = (evt) => {
        clearTimeout(newTimeout);
        this.off('dialog.stopped', onStop);
        resolve(evt.reply);
    };
    const onStop = () => {
        clearTimeout(newTimeout);
        this.off('dialog.reply', onReply);
        reject(new SessionError('Diálogo encerrado.', 'DIALOG_ENDED'));
    };
    this.once('dialog.reply', onReply);
    this.once('dialog.stopped', onStop);
    this.answerPendingQuestion(message);
};
```

---

#### AD-2.2 — BUG-05: Mutação ilegal de `ReadonlyArray` em `cmdCompact`

**Confirmado**: `context.js` linhas 135–136 fazem:
```js
llmBridgeClient.history.length = 0;           // falha silenciosa
llmBridgeClient.history.push({ ... });        // TypeError em modo estrito
```
`clearHistory()` existe em `client.js` (linha 357), mas `seedHistory()` não.

**Arquivos**: `src/copilot/channel/client.js`, `src/copilot/terminal/commands/context.js`

**Correção**:
1. Adicionar `seedHistory(role, content)` em `LlmBridgeClient`:
   ```js
   seedHistory(role, content) {
       this.#history.push({ role, content, timestamp: Date.now() });
   }
   ```
2. Em `cmdCompact`:
   ```js
   llmBridgeClient.clearHistory();
   llmBridgeClient.seedHistory('assistant', reply);
   ```

---

#### AD-2.3 — BUG-06: `#getActiveSdkSessionId` ignora `agentOverride`

**Confirmado**: linha 381 de `orchestrator.js` usa `alwaysAliveAgent` hardcoded, não `this.#agent`.

**Arquivo**: `src/copilot/conversation-hub/orchestrator.js`

**Correção**:
```js
#getActiveSdkSessionId() {
    try {
        const agent = this.#agent ?? alwaysAliveAgent;
        const snap = /** @type {{ sessionId?: string }} */ (agent.getStatusSnapshot());
        return snap.sessionId;
    } catch {
        return undefined;
    }
}
```

---

#### AD-2.4 — BUG-07: `stop()` invocado durante `status === 'starting'`

**Confirmado**: `stop()` não tem guard para `this.#status === 'starting'`. Se chamado durante o
boot, define `stopped` imediatamente; quando o boot completar emitirá eventos em estado inválido.

**Arquivo**: `src/copilot/agent/always-alive.js`

**Correção**: adicionar ao início de `stop()`, após o guard de `stopped`:
```js
if (this.#status === 'starting') {
    log('INFO', '[AlwaysAlive] stop() durante boot — aguardando conclusão (máx 15s)...');
    await Promise.race([
        new Promise(r => this.once('ready', r)),
        new Promise(r => this.once('error', r)),
        new Promise(r => setTimeout(r, 15_000)),
    ]);
}
```

---

#### AD-2.5 — BUG-08: `DialogWatchdog` instanciado no construtor e substituído em `startDialogLoop`

**Confirmado**: construtor linha 160 cria `#watchdog`; `startDialogLoop` linha 609 cria outro e
sobrescreve. Instância do construtor é descartada sem cleanup.

**Arquivo**: `src/copilot/agent/always-alive.js`

**Correção**: Remover a instanciação do construtor — declarar `#watchdog = null` e inicializar
**somente** em `startDialogLoop()`.

---

#### AD-2.6 — BUG-09: Dynamic `import()` no hot-path do middleware Socket.io

**Confirmado**: `socket-ns.js` executa `await import('#core/jwt_config')` e `await import('jsonwebtoken')`
dentro do middleware `ns.use()`, que roda em cada nova conexão.

**Arquivo**: `src/copilot/conversation-hub/socket-ns.js`

**Correção**: Mover os imports para o topo do módulo (imports estáticos ESM).

---

#### AD-2.7 — SEC-01: Injeção de shell em `exec_command`

**Confirmado**: `shell-tools.js` linha 262 passa o comando literal para `/bin/sh -c`.
A blocklist via regex é bypassável com `;`, `&&`, `$(...)`, redirecionamentos `>`.

**Arquivo**: `src/copilot/tools/shell-tools.js`

**Correção**: Para a maioria dos usos legítimos (git, npm, ls, node), tokenizar o comando e
rejeitar se contiver metacaracteres shell (`|`, `;`, `&&`, `$()`, `<`, `>`):

```js
/**
 * @param {string} command
 * @returns {{ executable: string; args: string[] } | null}
 */
function tokenizeSimpleCommand(command) {
    if (/[|;&<>$`\\]/.test(command)) return null;
    const parts = command.trim().split(/\s+/);
    if (parts.length === 0) return null;
    return { executable: parts[0], args: parts.slice(1) };
}
```

Usar `execFile(tokenized.executable, tokenized.args, ...)` em vez de `/bin/sh -c`.

**Atenção**: Alguns casos de uso legítimos dos tools podem exigir pipes (ex: `git log | head`).
Nesses casos, manter execução via shell mas apenas para padrões explicitamente permitidos via
allowlist de prefixos de comando (`git`, `npm`, `node`, `cat`, `ls`, `find`, `grep`, `wc`).

---

#### AD-2.8 — SEC-03: Injeção de shell em `search_in_files` via ripgrep

**Confirmado**: `file-tools.js` linha 359 interpolação de `safePattern` e `resolved` em template
string passada a `execSync`. Sanitização só com `replace(/'/g, "'\\''")`  não cobre todos os vetores.

**Arquivo**: `src/copilot/tools/file-tools.js`

**Correção**: Migrar para `execFile` com argumentos separados (`rg`, `args[]`) evitando parse shell.

---

#### AD-2.9 — SEC-04: Symlink traversal em `validatePath`

**Confirmado**: `validatePath` usa `path.relative()` sem `realpathSync`. Symlinks dentro do
workspace podem apontar para fora.

**Arquivo**: `src/copilot/tools/file-tools.js`

**Correção**:
```js
import { realpathSync } from 'node:fs';

function validatePath(filePath) {
    const resolved = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(WORKSPACE_ROOT, filePath);

    let realResolved = resolved;
    try {
        realResolved = realpathSync(resolved);
    } catch {
        // Arquivo ainda não existe (create_file) — usar resolved sem resolução
        realResolved = resolved;
    }

    const relativeToWorkspace = path.relative(WORKSPACE_ROOT, realResolved);
    if (relativeToWorkspace.startsWith('..')) {
        return { ok: false, reason: `Acesso negado: caminho fora do workspace (${realResolved})`, resolved: realResolved };
    }
    // ...
}
```

---

#### AD-2.10 — PERF-01: I/O síncrono por mensagem em `#processQueue`

**Confirmado**: `always-alive.js` linhas 731–732 fazem `readState()` + `writeState()` síncrono
em **cada** mensagem enfileirada.

**Arquivo**: `src/copilot/agent/always-alive.js`

**Correção**: Manter `sendCount` em campo privado `#sendCount = 0` em memória. Persistir no disco
apenas em eventos explícitos (shutdown, reconnection), não a cada mensagem.

---

#### AD-2.11 — PERF-02: `getStatusSnapshot()` faz `readState()` a cada chamada

**Confirmado**: `getStatusSnapshot()` linha 511 chama `readState()` (= `readFileSync`) toda vez.

**Arquivo**: `src/copilot/agent/always-alive.js`

**Correção**: Cache em memória com TTL de 2s:
```js
#cachedState = null;
#cacheExpiry = 0;
static #STATE_CACHE_TTL = 2_000;

#getState() {
    const now = Date.now();
    if (!this.#cachedState || now > this.#cacheExpiry) {
        this.#cachedState = readState();
        this.#cacheExpiry = now + AlwaysAliveAgent.#STATE_CACHE_TTL;
    }
    return this.#cachedState;
}
```
Invalidar cache (`this.#cachedState = null`) quando `writeState()` for chamado.

---

#### AD-2.12 — ARCH-02: 13 eventos ausentes no `nerv-bridge.js`

**Confirmado**: `AGENT_EVENTS` tem 22 eventos; `EVENT_MAP` do nerv-bridge tem apenas 9.
Eventos críticos ausentes: `task.delta`, `task.reasoning`, `ready`, `error`,
`session.fatal`, `session.usage`, `session.mode_changed`, `dialog.ready`, `dialog.reply`,
`dialog.stopped`, `dialog.stalled`, `tool.execution.start`, `tool.execution.complete`.

**Arquivo**: `src/copilot/bridges/nerv-bridge.js`

**Correção**: Gerar `EVENT_MAP` diretamente de `AGENT_EVENTS`:
```js
import { AGENT_EVENTS } from '../agent/events.js';

const EVENT_MAP = AGENT_EVENTS.map(event => ({
    event,
    actionCode: `COPILOT_${event.toUpperCase().replace(/\./g, '_')}`,
}));
```
Isso garante que todos os novos eventos adicionados a `AGENT_EVENTS` sejam automaticamente
propagados ao NERV sem manutenção manual.

---

#### AD-2.13 — TYPE-01: Cast `any` em `dialogLoopActive` no `orchestrator.js`

**Confirmado**: linha 229 do orchestrator usa `/** @type {any} */ (agentInst).dialogLoopActive`.

**Arquivo**: `src/copilot/conversation-hub/orchestrator.js`

**Correção**: Tipar corretamente o `agentOverride`:
```js
/**
 * @typedef {Pick<import('../agent/always-alive.js').AlwaysAliveAgent,
 *   'getStatusSnapshot' | 'dialogLoopActive' | 'sendDialogTurn'>} AgentLike
 */
/** @type {AgentLike | null} */
#agent = null;
```

---

#### AD-2.14 — GAP-01: Rate limiting ausente em `POST /inject`

**Confirmado**: `http-handlers.js` e `server.js` não têm controle de taxa para `/inject`.

**Arquivo**: `src/copilot/terminal/server.js` ou `src/copilot/terminal/http-handlers.js`

**Correção**: Implementar limitador simples in-memory (sem dependência externa):
```js
const _injectBucket = new Map(); // `${ip}` → { count: number, resetAt: number }

function checkInjectRateLimit(ip) {
    const now = Date.now();
    const e = _injectBucket.get(ip) ?? { count: 0, resetAt: now + 60_000 };
    if (now > e.resetAt) { e.count = 0; e.resetAt = now + 60_000; }
    e.count++;
    _injectBucket.set(ip, e);
    return e.count <= Number(process.env.LLM_B_INJECT_RPM ?? 20);
}
```
Aplicar antes de processar o body em `handleInject`.

---

#### AD-2.15 — GAP-03: `/send` com `waitForResponse=false` retorna `ok: true` com fila cheia

**Confirmado**: `bridge-tasks.js` não verifica capacidade da fila antes de retornar `ok: true`.

**Arquivo**: `src/copilot/api/bridge-tasks.js`

**Correção**: verificar `getStatusSnapshot().queueSize` antes de enfileirar:
```js
const snap = agent.getStatusSnapshot();
const MAX_Q = AlwaysAliveAgent.MAX_QUEUE_SIZE ?? 50;
if (snap.queueSize >= MAX_Q) {
    return res.status(503).json({
        ok: false,
        error: `Fila cheia (${snap.queueSize}/${MAX_Q}).`
    });
}
```

---

### Sprint AD-3: Type Safety e Docs (🟡)

#### AD-3.1 — TYPE-02: `'critical'` faltando no typedef `StructuredMessage.priority`

**Arquivo**: `src/copilot/types/structured-message.js`

**Correção**: `@property {'low' | 'medium' | 'high' | 'critical'} [priority]`

---

#### AD-3.2 — TYPE-03: `attachments` sem tipo em `bridge-tasks.js`

**Arquivo**: `src/copilot/api/bridge-tasks.js`

**Correção**: Adicionar typedef `SendRequestBody` com `attachments?:` tipado.

---

#### AD-3.3 — TYPE-04: `z.any()` em metadata dos hub-tools

**Arquivo**: `src/copilot/tools/hub-tools.js`

**Correção**: Restringir a primitivos serializáveis:
```js
z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
```

---

#### AD-3.4 — GAP-04: `LLM-A-COMMUNICATION-GUIDE.md` com paths desatualizados

**Arquivo**: `src/copilot/LLM-A-COMMUNICATION-GUIDE.md`

**Correção**: Atualizar seção de mapa de arquivos para refletir estrutura atual (`agent/`, `channel/`, `bridges/`).

---

### Sprint AD-4: Melhorias Adicionais (🔵)

#### AD-4.1 — MELHORIA-01: `listenerDiagnostics()` no healthcheck

**Arquivo**: `src/copilot/api/bridge-control.js`

---

#### AD-4.2 — MELHORIA-03: `handleInject` com suporte a `attachments` SDK

**Arquivo**: `src/copilot/terminal/http-handlers.js`

---

#### AD-4.3 — MELHORIA-04: Campo `traceId` no `StructuredMessage`

**Arquivo**: `src/copilot/types/structured-message.js`

---

#### AD-4.4 — MELHORIA-06: `CHANNEL_VERSION` no health endpoint

**Arquivo**: `src/copilot/channel/index.js`, `src/copilot/api/bridge-control.js`

---

## 3. Itens Adiados (para fase futura)

| Item      | Motivo do adiamento                                                              |
| --------- | -------------------------------------------------------------------------------- |
| ARCH-01   | 13 re-exports deprecated — remoção requer refatoração de todos os importadores   |
| ARCH-03   | Convergência de histórico entre instâncias `LlmBridgeClient` — alto impacto      |
| ARCH-04   | Hub saúde no health — impacto baixo, escopo da Fase Z3 revisada                  |
| GAP-02    | MCP schema com suporte a enums/nested — requer análise de MCP servers reais       |
| MELHORIA-02 | OpenTelemetry — requer instalação de pacotes e infraestrutura de tracing        |
| MELHORIA-05 | Histórico de SDK sessions por hub_session — migração de schema SQLite            |
| PERF-03   | Tokenizer FTS5 `porter unicode61` — melhoria de relevância, não bug crítico      |

## 4. Itens Descartados

| Item      | Motivo do descarte                                                                |
| --------- | --------------------------------------------------------------------------------- |
| SEC-05    | `run_node_file` — acesso já restrito a runtime controlado; BLOCKED_PATTERNS existe|
| ARCH-05   | `import.meta.dirname` — Node.js 24 é requerimento fixo; bundling não é objetivo   |

---

## 5. Ordem de Execução Recomendada

```
AD-1.1 (BUG-01: stop watchdog)
AD-1.2 (BUG-03: writeTurn transaction)
AD-1.3 (BUG-04: parseError)
AD-1.4 (SEC-02: FTS5 sanitization)
───────────────────────────────────
AD-2.8 (SEC-03: execFile para ripgrep)
AD-2.9 (SEC-04: realpathSync)
AD-2.7 (SEC-01: tokenize exec_command)
AD-2.10 (PERF-01: sendCount em memória)
AD-2.11 (PERF-02: cache de estado)
AD-2.12 (ARCH-02: todos os eventos no nerv-bridge)
───────────────────────────────────
AD-2.1 (BUG-02: leak listener onPending)
AD-2.2 (BUG-05: seedHistory + clearHistory)
AD-2.3 (BUG-06: agentOverride em orchestrator)
AD-2.4 (BUG-07: stop() durante starting)
AD-2.5 (BUG-08: watchdog duplicado)
AD-2.6 (BUG-09: static imports socket-ns)
AD-2.13 (TYPE-01: cast any)
AD-2.14 (GAP-01: rate limiting /inject)
AD-2.15 (GAP-03: fila cheia /send)
───────────────────────────────────
AD-3.1 → AD-3.4 (type safety + docs)
AD-4.1 → AD-4.4 (melhorias)
```

---

## 6. Resultado Esperado

Após a Fase AD completa:
- **0 bugs críticos** confirmados pela auditoria
- **0 vulnerabilidades SEC-01..04** nos caminhos de execução de comandos e SQL
- `npm run typecheck:node` mantém 0 erros
- `npm run lint` sem erros
- `npm run test:unit` sem regressões

---

*Plano gerado após validação manual de cada item da auditoria no código real (HEAD `bdaa1347`).*
*Criado em 2026-03-25.*
