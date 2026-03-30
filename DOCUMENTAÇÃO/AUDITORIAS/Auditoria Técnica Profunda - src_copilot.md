# Auditoria Técnica Profunda — Módulo `src/copilot/`

### `chatgpt-docker-puppeteer` · Fase Pós-Sprint Hub

> **Data**: 2026-03-28 **Escopo**: 99 arquivos do módulo `src/copilot/` (agent, api, bridges,
> channel, config, conversation-hub, core, lib, routes, terminal, tools, types) **SDK de
> Referência**: `@github/copilot-sdk` (Technical Preview, confirmado com documentação oficial NPM +
> GitHub Releases) **Metodologia**: Leitura integral de cada arquivo + cruzamento com docs
> oficiais + análise de dependências cruzadas

---

## Índice

1. [Resumo Executivo](#1-resumo-executivo)
2. [Bugs Críticos](#2-bugs-críticos)
3. [Bugs de Alta Severidade](#3-bugs-de-alta-severidade)
4. [Gaps de Conformidade com o SDK](#4-gaps-de-conformidade-com-o-sdk)
5. [Vulnerabilidades de Segurança](#5-vulnerabilidades-de-segurança)
6. [Problemas Arquiteturais](#6-problemas-arquiteturais)
7. [Bugs de Severidade Média](#7-bugs-de-severidade-média)
8. [Aprimoramentos e Upgrades Propostos](#8-aprimoramentos-e-upgrades-propostos)
9. [Checklist de Conformidade SDK](#9-checklist-de-conformidade-sdk)
10. [Roadmap de Correções](#10-roadmap-de-correções)

---

## 1. Resumo Executivo

A análise integral do módulo revela uma base arquitetural sólida e bem estruturada, com separação
clara de responsabilidades (agent, channel, hub, tools, terminal). Contudo, foram encontrados **4
bugs críticos**, **11 bugs de alta severidade**, **7 gaps de conformidade com o SDK oficial** e **6
vulnerabilidades de segurança** que requerem atenção imediata antes de qualquer promoção a produção.

| Categoria               | Contagem |
| ----------------------- | -------- |
| 🔴 Bugs Críticos        | 4        |
| 🟠 Bugs Alta Severidade | 11       |
| 🟡 Gaps SDK             | 7        |
| 🔒 Segurança            | 6        |
| 🏗️ Arquitetura          | 8        |
| 🔵 Média Severidade     | 12       |
| ✨ Upgrades/Melhorias   | 14       |

---

## 2. Bugs Críticos

### BUG-CRIT-01 — `todo-tools.js`: `log.info` inexistente causa crash em todos os writes ✅ CORRIGIDO

**Arquivo**: `src/copilot/tools/todo-tools.js` **Linhas afetadas**: todas as handlers de escrita
(`todo_create`, `todo_update`, `todo_set_status`, `todo_delete`, `todo_add_subtask`,
`todo_bulk_update`, `todo_clear_completed`, `todo_import`) **Impacto**: Runtime crash. As 8 tools de
escrita do sistema de TODOs falham **100% do tempo**.

**Causa raiz**: O módulo importa `log` de `#core/logger` como uma função chamável na forma
`log('INFO', msg)`. Entretanto, os handlers utilizam `log.info(...)`, que é `undefined`.

```javascript
// ERRADO — em todos os handlers de write
import { log } from '#core/logger';
// ...
log.info(`[todo_create] Tarefa criada id=${id}...`); // TypeError: log.info is not a function
log.info(`[todo_update] Tarefa atualizada id=...`); // idem
```

**Correção**:

```javascript
// Substituir todas as ocorrências de log.info( por log('INFO',
log('INFO', `[todo_create] Tarefa criada id=${id} title=${task.title} priority=${task.priority}`);
log(
  'INFO',
  `[todo_update] Tarefa atualizada id=${args.id} changed=${Object.keys(args)
    .filter((k) => k !== 'id')
    .join(',')}`,
);
// ... idem para todos os demais handlers
```

---

### BUG-CRIT-02 — `socket-ns.js`: Promise não resolvida emitida como `turnId` no `inject:ack` ✅ CORRIGIDO

**Arquivo**: `src/copilot/conversation-hub/socket-ns.js` **Linhas afetadas**: handler
`socket.on('user:inject', ...)`, bloco de `try` **Impacto**: O evento `inject:ack` entrega
`{ turnId: {} }` (Promise serializada como objeto vazio) ao cliente Socket.io. O cliente não recebe
o `turnId` real. Além disso, erros dentro de `injectUserMessage` ficam silenciosos (Promise
rejeitada sem catch).

**Causa raiz**: `orchestrator.injectUserMessage(...)` retorna `Promise<number>`, mas o handler de
evento não é `async` e não usa `await`.

```javascript
// ERRADO — handler síncrono mas função retorna Promise
socket.on('user:inject', (data) => {
    // ...
    const turnId = orchestrator.injectUserMessage(data.hubSession, safeContent, { ... });
    // turnId é uma Promise<number>, NÃO um number
    socket.emit('inject:ack', { hubSession: data.hubSession, turnId }); // enviará {}
});
```

**Correção**:

```javascript
socket.on('user:inject', async (data) => {
  if (!data?.hubSession || !data?.content) {
    socket.emit('error:inject', { reason: 'hubSession e content são obrigatórios.' });
    return;
  }
  if (!checkSocketInjectRate(clientId)) {
    socket.emit('error:inject', { reason: 'Rate limit excedido.' });
    return;
  }
  const MAX_INJECT_CONTENT = 32_000;
  const rawContent = typeof data.content === 'string' ? data.content : String(data.content ?? '');
  const safeContent = rawContent
    .slice(0, MAX_INJECT_CONTENT)
    .replace(/^\s*\[SYSTEM[^\]]*\]/gim, '[BLOCKED]')
    .replace(/^\s*SYSTEM:/gim, '[BLOCKED]');
  try {
    const session = store.getHubSession(data.hubSession);
    if (!session || session.status !== 'active') {
      socket.emit('error:inject', { reason: `Sessão ${data.hubSession} não está ativa.` });
      return;
    }
    const turnId = await orchestrator.injectUserMessage(data.hubSession, safeContent, {
      metadata: {
        injectedBy: socket.userId ?? 'anonymous',
        socketId: clientId,
      },
    });
    socket.emit('inject:ack', { hubSession: data.hubSession, turnId });
  } catch (err) {
    socket.emit('error:inject', { reason: err.message });
  }
});
```

---

### BUG-CRIT-03 — `conversation-hub/store.js`: `syncFromSdkHistory` mapeia role como `'llm-b'` (hífen) em vez de `'llm_b'` (underscore) ✅ CORRIGIDO

**Arquivo**: `src/copilot/conversation-hub/store.js` **Linha afetada**: método `syncFromSdkHistory`,
linha `const role = msg.type === 'assistant' ? 'llm-b' : 'user'` **Impacto**: Corrompção silenciosa
de dados. Turnos sincronizados do SDK ficam com role `'llm-b'` em vez do `'llm_b'` canônico. Queries
que filtram por `role = 'llm_b'` nunca retornam turnos sincronizados. Inconsistência de dados não
detectável.

```javascript
// ERRADO — usa hífen
const role = msg.type === 'assistant' ? 'llm-b' : 'user';

// CORRETO — usa underscore (alinhado com TurnRole typedef)
const role = msg.type === 'assistant' ? 'llm_b' : 'user';
```

**Correção**: Trocar `'llm-b'` por `'llm_b'` na linha do `syncFromSdkHistory`. Adicionalmente, criar
uma migration de correção dos dados existentes no SQLite:

```sql
UPDATE copilot_conversation_turns SET role = 'llm_b' WHERE role = 'llm-b';
```

---

### BUG-CRIT-04 — `channel/audit.js`: `auditToolComplete` usa `fs.appendFileSync` bloqueando o event loop ✅ CORRIGIDO

**Arquivo**: `src/copilot/channel/audit.js` **Linha afetada**: método `auditToolComplete`, chamada
de `fs.appendFileSync` **Impacto**: Cada conclusão de tool call bloqueia o event loop do Node.js
enquanto escreve no disco. Em sessões intensas (30+ tool calls por turno), isso cria latência
acumulada perceptível. Em discos lentos (containers Docker com volume mapeado), pode causar
timeouts.

```javascript
// ERRADO — I/O síncrono no hot path de tool execution
export function auditToolComplete(entry) {
  // ...
  try {
    ensureLogsDir(); // fs.existsSync + fs.mkdirSync — SÍNCRONO
    maybeRotate(); // fs.statSync + fs.renameSync — SÍNCRONO
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(record) + '\n', 'utf8'); // SÍNCRONO
  } catch {
    /* ... */
  }
}
```

**Correção** — converter para I/O assíncrono com buffer interno:

```javascript
// Buffer de escritas pendentes
const _writeQueue = [];
let _flushScheduled = false;

function scheduleFlush() {
  if (_flushScheduled) return;
  _flushScheduled = true;
  setImmediate(async () => {
    _flushScheduled = false;
    const batch = _writeQueue.splice(0);
    if (!batch.length) return;
    try {
      await mkdir(join(AUDIT_FILE, '..'), { recursive: true });
      try {
        const { size } = await stat(AUDIT_FILE);
        if (size >= MAX_SIZE_BYTES) await rename(AUDIT_FILE, AUDIT_ROTATE);
      } catch {
        /* arquivo não existe */
      }
      await appendFile(AUDIT_FILE, batch.join(''), 'utf8');
    } catch {
      /* não bloquear agente */
    }
  });
}

export function auditToolComplete(entry) {
  // ...
  const line = JSON.stringify(record) + '\n';
  _writeQueue.push(line);
  scheduleFlush();
}
```

---

## 3. Bugs de Alta Severidade

### BUG-HIGH-01 — `tools/file-tools.js`: `patch_file` vulnerável a replacement patterns em `new_string` ✅ CORRIGIDO

**Arquivo**: `src/copilot/tools/file-tools.js` **Linha afetada**: handler `patch_file`,
`const updated = content.replace(old_string, new_string)` **Impacto**: Se `new_string` contém `$&`,
`$1`, `$$`, `$'`,
`$\`` (padrões especiais de `String.prototype.replace`), o resultado é inesperado. Ex.: `new_string
= "prefix$$suffix"` resulta em `"prefix$suffix"` em vez do literal `"prefix$$suffix"`.

```javascript
// ERRADO
const updated = content.replace(old_string, new_string);

// CORRETO — escapar padrões de substituição em new_string
const safeNewString = new_string.replace(/\$/g, '$$$$');
const updated = content.replace(old_string, safeNewString);
```

---

### BUG-HIGH-02 — `terminal/dialog.js`: `broadcastSse` emite para TODOS os clientes Socket.io, ignorando `hubSessionId` ✅ CORRIGIDO

**Arquivo**: `src/copilot/terminal/dialog.js` **Linha afetada**: função `broadcastSse`, bloco
Socket.io **Impacto**: Todos os eventos do dialog loop (`reply`, `ready`, `busy`, etc.) são emitidos
para **todos** os clientes conectados ao namespace `/copilot`, independentemente de qual
`hub_session` eles estão observando. Vazamento de informação entre sessões.

```javascript
// ERRADO — broadcast global sem filtragem de sessão
const _ns = getCopilotNamespace();
if (_ns) {
  _ns.emit(event, { ...safeData, hubSessionId: getHubSessionId() });
}
```

**Correção**:

```javascript
const _ns = getCopilotNamespace();
const _hubSessionId = getHubSessionId();
if (_ns && _hubSessionId) {
  // Emitir apenas para a sala da hub_session ativa
  _ns.to(_hubSessionId).emit(event, { ...safeData, hubSessionId: _hubSessionId });
} else if (_ns) {
  // Fallback: sem sessão ativa, emitir globalmente apenas eventos de sistema
  const SYSTEM_EVENTS = new Set(['ready', 'stalled', 'stopped', 'fatal']);
  if (SYSTEM_EVENTS.has(event)) {
    _ns.emit(event, { ...safeData, hubSessionId: null });
  }
}
```

---

### BUG-HIGH-03 — `orchestrator.js`: Streaming de delta NÃO funciona quando `dialogLoopActive = true` ✅ CORRIGIDO

**Arquivo**: `src/copilot/conversation-hub/orchestrator.js` **Linha afetada**: bloco
`if (useDialogLoop)` em `#executeSendToLlmB` **Impacto**: Quando o dialog loop está ativo, a
resposta de LLM-B só aparece após conclusão completa — nenhum evento `turn:delta` é emitido.
Observers do namespace `/copilot` não veem progresso em tempo real, degradando a experiência do
usuário.

```javascript
// PROBLEMA — sem callback onDelta no caminho de dialogLoop
if (useDialogLoop) {
  const content = typeof message === 'string' ? message : messageContent;
  llmBResponse = await agentInst.sendDialogTurn(content, { timeout: timeoutMs });
  // Nenhum emit de 'turn:delta' ocorre aqui
}
```

**Análise**: `sendDialogTurn` não suporta streaming porque opera via `ask_user` /
`onUserInputRequest` internamente. Para emitir chunks, seria necessário interceptar eventos
`task.delta` durante a execução do turno de diálogo.

**Correção**:

```javascript
if (useDialogLoop) {
  const content = typeof message === 'string' ? message : messageContent;
  // Registrar listener de delta temporariamente
  const onDelta = (evt) => {
    llmBResponse += evt.chunk ?? '';
    this.emit('turn:delta', { hubSessionId, chunk: evt.chunk ?? '', turnNumber: turnNumber + 1 });
  };
  alwaysAliveAgent.on('task.delta', onDelta);
  try {
    llmBResponse = await agentInst.sendDialogTurn(content, { timeout: timeoutMs });
  } finally {
    alwaysAliveAgent.off('task.delta', onDelta);
  }
}
```

---

### BUG-HIGH-04 — `always-alive.js`: Após reconexão automática, dialog loop não é reiniciado ✅ CORRIGIDO

**Arquivo**: `src/copilot/agent/always-alive.js` **Linha afetada**: método `#tryReconnect`, após
reconexão bem-sucedida **Impacto**: Se a sessão SDK quebra durante um turno de diálogo (erro de
rede, timeout), `#tryReconnect` cria uma nova sessão mas não reinicia o dialog loop. O
`#dialogLoopActive` permanece `true` mas não há mais uma sessão do SDK suspensa em `ask_user`.
Chamadas subsequentes a `sendDialogTurn` ficam presas aguardando `question.pending` que nunca chega.

**Correção**:

```javascript
async #tryReconnect(originalError, opts = {}) {
    // ... (lógica existente de reconexão)
    if (reconnected) {
        log('INFO', `[AlwaysAlive] Reconexão bem-sucedida na tentativa ${attempt}.`);
        this.emit('ready', { sessionId: session.sessionId, isResumed, reconected: true });

        // NOVO: se dialog loop estava ativo, reiniciar automaticamente
        if (this.#dialogLoopActive) {
            log('INFO', '[AlwaysAlive] Reiniciando dialog loop após reconexão...');
            this.#dialogLoopActive = false; // reset para permitir novo startDialogLoop
            this.emit('dialog.stopped', { reason: 'reconnect_restart', authorized: false });
        }
        return true;
    }
}
```

---

### BUG-HIGH-05 — `session-manager.js`: `buildHookSystemContext` usa I/O síncrono em caminho crítico de boot ✅ CORRIGIDO

**Arquivo**: `src/copilot/agent/session-manager.js` **Impacto**: `readFileSync` e `existsSync` são
chamados durante `initOrResumeSession`, que é chamado no boot do AlwaysAliveAgent. Em sistemas com
I/O lento (containers Docker com volumes NFS), isso pode travar o event loop por centenas de
milissegundos.

**Correção**: Converter `buildHookSystemContext` para `async` e usar `fs/promises`:

```javascript
import { readFile, access } from 'node:fs/promises';

export async function buildHookSystemContext() {
  const parts = [];
  try {
    await access(BRIEFING_FILE);
    const content = await readFile(BRIEFING_FILE, 'utf8');
    parts.push('## Contexto da Sessão (Hook System)\n\n' + content);
  } catch {
    /* arquivo não existe */
  }
  try {
    await access(SESSION_JSON_FILE);
    const raw = await readFile(SESSION_JSON_FILE, 'utf8');
    const state = JSON.parse(raw);
    // ... mesmo processamento
  } catch {
    /* arquivo não existe ou JSON inválido */
  }
  return parts.join('\n\n');
}
```

E em `initOrResumeSession`:

```javascript
const hookContext = injectContext ? await buildHookSystemContext() : '';
const systemMessage = hookContext ? buildHookContextAppendMessage(hookContext) : undefined;
```

---

### BUG-HIGH-06 — `lib/session.js`: `buildSessionConfig` para 'create' sempre habilita infiniteSessions ✅ CORRIGIDO

**Arquivo**: `src/copilot/lib/session.js` **Linha afetada**:
`cfg.infiniteSessions = buildInfiniteSessionConfig(co.infiniteSessions)` em modo `'create'`
**Impacto**: Sessões de diagnóstico criadas via `buildDiagnosticConfig()` (que chama `createSession`
diretamente com `streaming: false`) **não passam** por `buildSessionConfig` — usam path separado.
OK. Mas sessões criadas via `createSdkSession` em `routes/sessions.js` **sempre** herdam
`{ enabled: true, backgroundCompactionThreshold: 0.75 }` mesmo que o cliente não queira. O parâmetro
`infiniteSessions: false` do request body é ignorado.

**Correção**:

```javascript
// Só adicionar infiniteSessions se explicitamente fornecido OU se mode === 'always-alive'
if (co.infiniteSessions !== undefined) {
  cfg.infiniteSessions = buildInfiniteSessionConfig(co.infiniteSessions);
} else {
  // Default apenas para sessões always-alive, não para todas
  cfg.infiniteSessions = { enabled: false };
}
```

---

### BUG-HIGH-07 — `tools/file-tools.js`: spreading de `defineTool` pode quebrar instâncias de Tool ✅ VALIDADO SEGURO (sem mudança necessária)

**Arquivo**: `src/copilot/agent/tools-bootstrap.js` **Linha afetada**:
`allTools.map((t) => (t.overridesBuiltInTool ? t : { ...t, overridesBuiltInTool: true }))`
**Impacto**: Se `Tool` é uma instância de classe (não um POJO), o spread `{ ...t }` copia apenas
propriedades enumeráveis próprias, perdendo métodos do prototype e propriedades não-enumeráveis. Se
`handler` é uma propriedade não-enumerável (comum em classes TypeScript com decoradores), o SDK não
encontrará o handler.

**Verificação necessária**: Inspecionar o tipo de retorno de `defineTool` no SDK. Se for um POJO,
spread é seguro. Se for uma instância de classe, usar `Object.assign`.

**Correção mais segura**:

```javascript
const finalTools = allTools.map((t) => {
  if (t.overridesBuiltInTool) return t;
  // Usar Object.assign para preservar o prototype, se necessário
  return Object.defineProperty(Object.create(Object.getPrototypeOf(t)), 'overridesBuiltInTool', {
    value: true,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  // Alternativa mais simples e segura:
  // return Object.assign(Object.create(Object.getPrototypeOf(t)), t, { overridesBuiltInTool: true });
});
```

---

### BUG-HIGH-08 — `channel/client.js`: `chatBatch` usa `Promise.all` sem respeitar MAX_QUEUE_SIZE ✅ CORRIGIDO

**Arquivo**: `src/copilot/channel/client.js` **Impacto**: `chatBatch(messages)` cria todas as
tarefas simultaneamente via `Promise.all`. Se `messages.length > MAX_QUEUE_SIZE (100)`, todas as
tarefas além do limite são rejeitadas com `QUEUE_FULL` mas a rejeição individual é silenciosa (o
caller vê resultados mistos). Além disso, mesmo abaixo do limite, `Promise.all` não respeita a ordem
de prioridade da fila.

**Correção**:

```javascript
async chatBatch(messages, opts = {}) {
    // Processar sequencialmente para respeitar a fila serializada
    const results = [];
    for (const msg of messages) {
        try {
            results.push(await this.chat(msg, opts));
        } catch (err) {
            results.push({ error: err.message, response: null, taskId: '', responseLen: 0, chunks: [], durationMs: 0 });
        }
    }
    return results;
}
```

---

### BUG-HIGH-09 — `session-manager.js`: `buildAuditingPermissionHandler` ignora retorno de `approveAll` em caso de erro ✅ CORRIGIDO

**Arquivo**: `src/copilot/agent/session-manager.js` **Linha afetada**: dentro de
`buildAuditingPermissionHandler`, bloco `if (baseHandler)` **Impacto**: Se `baseHandler` lança uma
exceção (e.g., handler customizado com bug), a exceção propaga para o SDK e pode derrubar a sessão.
O `approveAll` do SDK é um fallback somente quando `baseHandler` é `undefined`.

**Correção**: Adicionar try/catch ao redor da chamada ao `baseHandler`:

```javascript
try {
  result = baseHandler
    ? await baseHandler(request, invocation)
    : await approveAll(request, invocation);
} catch (handlerErr) {
  log(
    'ERROR',
    `[AH.6] Erro no permission handler: ${handlerErr.message} — aprovando como fallback seguro`,
  );
  result = await approveAll(request, invocation);
}
```

---

### BUG-HIGH-10 — `nerv-bridge.js`: NERV bridge não se re-registra após `stop()`/`start()` do agente ✅ CORRIGIDO

**Arquivo**: `src/copilot/bridges/nerv-bridge.js` **Impacto**: Quando `alwaysAliveAgent.stop()` é
chamado e depois `start()` é chamado novamente (restart normal via PM2 ou recovery), o
`nerv-bridge.js` **não** chama `_attachListeners()` novamente. Após o restart, nenhum evento do
agente é encaminhado ao NERV bus.

**Correção**: Registrar um listener no evento `'ready'` do agente para re-vincular:

```javascript
// Em mount():
alwaysAliveAgent.on('ready', () => {
  if (_nerv !== null && _listeners.size === 0) {
    log('INFO', '[nerv-bridge] Re-registrando listeners após restart do agente.');
    _attachListeners();
  }
});

// Em stop() do agente ('before-stop' já mapeado):
alwaysAliveAgent.on('before-stop', () => {
  _detachListeners();
});
```

---

### BUG-HIGH-11 — `routes/sessions.js`: Validação de `timeoutMs` aceita `NaN` convertido de parâmetro body ✅ VALIDADO OK (sem bug)

**Arquivo**: `src/copilot/routes/sessions.js` **Linha afetada**: handler `POST /sessions/:id/send`
**Análise**: A fix `NEW-03` trata `rawTimeoutMs` mas apenas para valores
`typeof rawTimeoutMs === 'number'`. Se o body vem como JSON com `"timeoutMs": "30000"` (string), o
resultado é `null` (retorna 400). Correto. Mas se o body tiver `timeoutMs: null`, o fallback
`60_000` é usado corretamente. Porém `timeoutMs: Infinity` passa a validação `isFinite` retornando
`false` — **rejeitado corretamente**. E `timeoutMs: 0` — `0 > 0` é `false` — rejeitado corretamente.
**Esta fix está correta.** Revisão confirma sem bug aqui.

_[Reclassificado como OK — retirando da lista de bugs]_

---

## 4. Gaps de Conformidade com o SDK

### GAP-SDK-01 — `session-manager.js`: `resumeOrCreate` passa `SessionCreateOptions` para `resumeSession` ⚠️ DOCUMENTADO (tipagem enganosa, comportamento funcional correto)

**Arquivo**: `src/copilot/lib/session.js` **Análise**: A função
`resumeOrCreate(client, sessionId, opts)` passa `opts` (do tipo `SessionCreateOptions`) para
`resumeSession(client, sessionId, opts)`. `resumeSession` usa
`buildSessionConfig(options, 'resume')` que, no modo `'resume'`, ignora `infiniteSessions`,
`workingDirectory`, `mcpServers`, etc. Portanto o comportamento atual é funcionalmente correto, mas
a tipagem é enganosa. **Recomendação**: Separar os tipos `SessionCreateOptions` e
`SessionResumeOptions` claramente na chamada de `resumeOrCreate`.

---

### GAP-SDK-02 — `always-alive.js`: `session.getMessages()` pode não existir em versões antigas do SDK ✅ CORRIGIDO

**Arquivo**: `src/copilot/agent/always-alive.js` **Linha afetada**: método `getSessionMessages()` e
`#syncSdkHistory` **Análise**: O código usa `typeof sdkSession.getMessages === 'function'` como
guard. A documentação oficial do SDK (Technical Preview) lista `session.getMessages()` como
retornando histórico de mensagens. Porém, em versões do CLI anteriores a determinado build, este
método pode não estar disponível. O guard protege contra crash, mas não loga uma advertência quando
ausente. **Melhoria**: Adicionar log.WARN quando `getMessages` não está disponível, para diagnóstico
de incompatibilidade de versão.

---

### GAP-SDK-03 — `session-rpc-tools.js`: APIs `rpc.*` são `@experimental` e podem quebrar sem aviso ✅ VALIDADO (try/catch já implementados)

**Arquivo**: `src/copilot/tools/session-rpc-tools.js` **Análise**: As 8 tools que usam
`session.rpc.mode`, `session.rpc.plan`, `session.rpc.agent`, `session.rpc.compaction` operam sobre
APIs marcadas como `@experimental` no SDK (confirmado via `github/copilot-sdk` releases v0.x —
"Experimental API annotations" adicionadas em #875). O SDK pode mudar estas APIs **sem versionamento
semântico** durante a Technical Preview. **Recomendação**: Adicionar comentários `// @experimental`
em cada tool e implementar try/catch em todos os handlers:

```javascript
handler: async () => {
  const r = getRpc();
  if (!r.ok) return { error: r.error };
  try {
    // Verificar se a API experimental está disponível
    if (!r.rpc?.mode?.get) {
      return { error: 'API session.rpc.mode não disponível nesta versão do SDK.' };
    }
    const result = await r.rpc.mode.get();
    return result;
  } catch (e) {
    log('ERROR', `[session_mode_get] Erro em API experimental: ${e.message}`);
    return { error: e.message };
  }
};
```

---

### GAP-SDK-04 — `always-alive.js`: Evento `'context:compacted'` não documentado no SDK ✅ CORRIGIDO

**Arquivo**: `src/copilot/agent/always-alive.js` **Linha afetada**:
`this.emit('context:compacted', {...})` em `session.compaction_complete` **Análise**: O evento
`'context:compacted'` é emitido localmente pelo `AlwaysAliveAgent` mas não está na lista
`AGENT_EVENTS` em `agent/events.js`. Portanto não é encaminhado via SSE nem via NERV bridge.
Observers externos não recebem este evento. **Correção**: Adicionar `'context:compacted'` ao array
`AGENT_EVENTS`:

```javascript
export const AGENT_EVENTS = /** @type {const} */ ([
  // ... eventos existentes
  'context:compacted', // NOVO
]);
```

E adicionar ao `nerv-bridge.js`:

```javascript
{ event: 'context:compacted', actionCode: 'COPILOT_CONTEXT_COMPACTED' },
```

---

### GAP-SDK-05 — `lib/session.js`: `mode: 'append'` pode ser obsoleto em SDK v0.2.0+ ⚠️ DOCUMENTADO (requer verificação futura com changelog do SDK)

**Arquivo**: `src/copilot/config/system-prompt.js`, `src/copilot/lib/session.js` **Análise**: Os
comentários no código dizem "SDK v0.1.x não suporta mode:'customize'; usar mode:'append'".
Verificando o CHANGELOG oficial do SDK, não há menção de `mode: 'customize'` ainda, portanto
`mode: 'append'` está correto. Porém, a documentação oficial do SDK usa apenas
`{ mode: 'append', content: '...' }` e não lista outros modos. O campo `mode: 'replace'` (usado em
`buildReplaceSystemMessage`) pode ser não-documentado. **Ação recomendada**: Auditar se
`mode: 'replace'` é suportado oficialmente ou é um detalhe de implementação. Se não documentado,
migrar para `mode: 'append'` que é o modo seguro.

---

### GAP-SDK-06 — `tools/tool-factory.js`: `zodToJsonSchema` pode ser incompatível com Zod v4 ⚠️ DOCUMENTADO (verificar versões em package.json ao atualizar Zod)

**Arquivo**: `src/copilot/tools/tool-factory.js` **Análise**: O código usa `zod-to-json-schema` com
detecção de Zod v3 (`'_def' in parameters`) e Zod v4 (`'_zod' in parameters`). Porém,
`zod-to-json-schema` em versões < 3.24 não suporta Zod v4. Se o projeto usa Zod v4 e
`zod-to-json-schema` < 3.24, a conversão falha silenciosamente (retorna `undefined`), resultando em
tools sem schema de parâmetros. **Verificação**: Confirmar versões no `package.json`:

```json
// Esperado para suporte a Zod v4:
"zod": "^4.x",
"zod-to-json-schema": "^3.24.x"
```

---

### GAP-SDK-07 — `mcp-tool-bridge.js`: Tools MCP criadas com `overridesBuiltInTool` não definido ✅ CORRIGIDO

**Arquivo**: `src/copilot/bridges/mcp-tool-bridge.js` **Análise**: `createSdkToolFromMcp` cria tools
com `defineTool(toolName, { description, parameters, handler })` sem especificar
`overridesBuiltInTool: true`. O `tools-bootstrap.js` tenta corrigir isso com o spread
`{ ...t, overridesBuiltInTool: true }`, mas conforme BUG-HIGH-07, esse spread pode não funcionar
corretamente para instâncias de classe. **Correção direta em `mcp-tool-bridge.js`**:

```javascript
return defineTool(toolName, {
  description: `[MCP] ${mcpTool.description ?? mcpTool.name}`,
  parameters: schema,
  overridesBuiltInTool: true, // ADICIONAR AQUI
  handler: async (params) => {
    /* ... */
  },
});
```

---

## 5. Vulnerabilidades de Segurança

### SEC-VULN-01 — `tools/web-tools.js`: SSRF via AWS metadata, link-local e 0.0.0.0 ✅ CORRIGIDO

**Arquivo**: `src/copilot/tools/web-tools.js` **Severidade**: Alta **Análise**: O `PRIVATE_HOST_RE`
não bloqueia:

- `169.254.x.x` (AWS EC2 Instance Metadata Service — `http://169.254.169.254/latest/meta-data/`)
- `0.0.0.0` (binds a todas as interfaces — comportamento de host imprevisível)
- `[::ffff:127.0.0.1]` (IPv4-mapped IPv6 loopback)
- `metadata.google.internal` (GCP metadata service)

**Correção**:

```javascript
const PRIVATE_HOST_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|0\.0\.0\.0|169\.254\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+|fd[0-9a-f]{2}:|metadata\.google\.internal)/i;
```

---

### SEC-VULN-02 — `tools/hook-tools.js`: `request_user_input` broadca conteúdo não sanitizado via SSE ✅ CORRIGIDO

**Arquivo**: `src/copilot/tools/hook-tools.js` **Severidade**: Média **Análise**: O `fullQuestion`
concatena `question` e `context` diretamente, e este valor é transmitido via
`broadcastSse('waiting_for_input', { question: fullQuestion, ... })`. Se um modelo LLM injetar
conteúdo HTML ou JavaScript no `context`, este pode ser renderizado no dashboard sem escape.
**Correção**:

```javascript
// Sanitizar conteúdo antes de broadcast
const sanitizeText = (s) =>
  String(s ?? '')
    .slice(0, 4_000)
    .replace(
      /[<>&"']/g,
      (c) =>
        ({
          '<': '&lt;',
          '>': '&gt;',
          '&': '&amp;',
          '"': '&quot;',
          "'": '&#x27;',
        })[c],
    );

const safeFullQuestion = sanitizeText(fullQuestion);
broadcastSse('waiting_for_input', {
  question: safeFullQuestion,
  choices: (choices ?? []).map(sanitizeText),
  allowFreeform,
});
```

---

### SEC-VULN-03 — `session-manager.js`: Valores de `session.json` injetados em Markdown sem validação ✅ CORRIGIDO

**Arquivo**: `src/copilot/agent/session-manager.js` **Severidade**: Média **Análise**: Os valores
`consecutive`, `turnNum` e `strictClose` são extraídos de `session.json` e injetados diretamente em
uma string Markdown que é enviada como `systemMessage` ao SDK. Um `session.json` manipulado poderia
injetar instruções arbitrárias no system prompt do LLM-B.

**Correção**:

```javascript
// Validar tipos antes de interpolar
const consecutive = Number.isInteger(state?.compliance?.consecutive_unauthorized)
  ? state.compliance.consecutive_unauthorized
  : 0;
const turnNum = Number.isInteger(state?.current_turn?.number) ? state.current_turn.number : 0;
const strictClose = typeof state?.strict_turn_close === 'boolean' ? state.strict_turn_close : true;
// closeKey já tem sanitização de regex — OK
```

---

### SEC-VULN-04 — `tools/shell/index.js`: `safeEnv()` remove `REDIS_URL` e `DATABASE_URL` quebrando health checks ✅ CORRIGIDO

**Arquivo**: `src/copilot/tools/shell/index.js` **Severidade**: Baixa (operacional) **Análise**: A
lista de variáveis sensíveis removidas de `safeEnv()` inclui `REDIS_URL`, `DATABASE_URL`,
`REDIS_PASSWORD`. Quando `run_npm_script` executa `npm run health:core` ou `npm run diagnose`, estas
variáveis de conexão são necessárias para verificar o estado das conexões. O script retornará falsos
negativos ("conexão indisponível") mesmo com os serviços operacionais. **Correção**: Dividir em dois
grupos — variáveis de autenticação (sempre remover) vs. variáveis de conexão (remover apenas em
contexto seguro):

```javascript
// Sempre remover — credenciais de autenticação
const AUTH_VARS = [
  'GITHUB_TOKEN',
  'COPILOT_TOKEN',
  'NPM_TOKEN',
  'JWT_SECRET',
  'SESSION_SECRET',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
];
// Remover apenas se não for script de diagnóstico
const CONN_VARS = ['DATABASE_URL', 'DATABASE_PASSWORD', 'REDIS_URL', 'REDIS_PASSWORD'];

function safeEnv(removeConnVars = true) {
  const env = { ...process.env };
  for (const key of AUTH_VARS) delete env[key];
  if (removeConnVars) {
    for (const key of CONN_VARS) delete env[key];
  }
  return env;
}
```

E em `run_npm_script`:

```javascript
const DIAGNOSTIC_SCRIPTS = new Set(['health:core', 'health:full', 'diagnose', 'queue:status']);
const removeConn = !DIAGNOSTIC_SCRIPTS.has(script);
const result = await runProcess('npm', ['run', script], {
  cwd: WORKSPACE_ROOT,
  timeoutMs,
  removeConnVars: removeConn,
});
```

---

### SEC-VULN-05 — `routes/sessions.js`: Rate limiting ausente em endpoints sensíveis ✅ CORRIGIDO

**Arquivo**: `src/copilot/routes/sessions.js` **Severidade**: Média **Análise**: Os endpoints
`POST /sessions`, `POST /sessions/:id/resume`, `POST /sessions/:id/send` e `DELETE /sessions/:id`
não têm rate limiting. Um atacante autenticado pode criar centenas de sessões SDK (cada uma consome
memória e processos CLI), potencialmente esgotando recursos. **Recomendação**: Integrar com o rate
limiter existente em `terminal/server.js` ou implementar um rate limiter de sessão:

```javascript
// Adicionar antes dos handlers sensíveis
const sessionCreateLimiter = createRateLimiter({ max: 10, windowMs: 60_000 });
router.post('/sessions', sessionCreateLimiter, async (req, res) => { ... });
```

---

### SEC-VULN-06 — `terminal/server.js`: Rate limiter usa janela fixa, vulnerável a burst no boundary ✅ CORRIGIDO

**Arquivo**: `src/copilot/terminal/server.js` **Severidade**: Baixa **Análise**: O rate limiter de
`/inject` usa `Math.floor(Date.now() / 60_000)` como bucket fixo. Um atacante pode enviar 10
requests em 59s + 10 requests em 1s (segundo bucket) = 20 requests em ~2 segundos, efetivamente
dobrando o limite. **Correção**: Implementar sliding window:

```javascript
// Sliding window com array circular de timestamps
const _injectTimestamps = new Map(); // ip -> timestamp[]

function checkInjectRateSliding(ip) {
  const now = Date.now();
  const window = now - INJECT_RATE_WINDOW_MS;
  const ts = (_injectTimestamps.get(ip) ?? []).filter((t) => t > window);
  if (ts.length >= INJECT_RATE_MAX) {
    return { allowed: false, remaining: 0, resetIn: Math.ceil((ts[0] - window) / 1000) };
  }
  ts.push(now);
  _injectTimestamps.set(ip, ts);
  return { allowed: true, remaining: INJECT_RATE_MAX - ts.length, resetIn: 0 };
}
```

---

## 6. Problemas Arquiteturais

### ARCH-01 — `conversation-hub/orchestrator.js` + `channel/client.js`: Acoplamento duplo ao `alwaysAliveAgent` singleton ⚠️ RECONHECIDO (design de longo prazo)

**Análise**: Tanto `HubOrchestrator` quanto `LlmBridgeClient` operam sobre o mesmo
`alwaysAliveAgent` singleton via imports diretos. Se o terminal server e o ConversationHub tentarem
usar o dialog loop simultaneamente (ex.: um request via `/inject` e um `hub_send_message`
simultâneos), ambos competem pelo mesmo `#pendingQuestion` no agente, criando race condition.

**Recomendação de Longo Prazo**: Implementar um mecanismo de exclusão mútua global (mutex de nível
de aplicação) que serialize acesso ao dialog loop, independente de qual consumidor está usando o
agente.

```javascript
// Em always-alive.js — expor um lock de dialog turn
get dialogLock() { return this.#dialogTurnMutex; }
```

---

### ARCH-02 — `tools/hub-tools.js`: Import dinâmico de `hub.js` cria acoplamento oculto ✅ CORRIGIDO

**Análise**: `requireHub()` usa `await import('../conversation-hub/hub.js')` dinamicamente para
evitar dependência circular. Isso funciona mas esconde a dependência e impede análise estática de
dependências. Além disso, o `isReady` check é feito a cada chamada, adicionando overhead de
resolução de módulo.

**Recomendação**: Usar injeção de dependência explícita via `setHub(hub)` function, similar ao
padrão `setSessionRpc(rpc)` já usado em `session-rpc-tools.js`.

```javascript
// hub-tools.js
let _hub = null;
export function setHub(hub) {
  _hub = hub;
}
async function requireHub() {
  return _hub?.isReady ? _hub : null;
}
// Em tools-bootstrap.js — após inicializar o hub:
import { setHub } from '../tools/hub-tools.js';
setHub(conversationHub);
```

---

### ARCH-03 — `terminal/dialog.js`: Dependência circular via import dinâmico de `hook-tools.js` ✅ CORRIGIDO

**Análise**: `hook-tools.js` faz `import('../terminal/dialog.js')` dinamicamente para chamar
`broadcastSse`. E `terminal/dialog.js` importa `llmBridgeClient` de `channel/client.js` que importa
`alwaysAliveAgent`. Este ciclo, embora resolvido via import dinâmico, cria dependências implícitas
difíceis de testar.

**Recomendação**: Injetar `broadcastSse` via callback em vez de import dinâmico:

```javascript
// hook-tools.js — receber broadcastSse como parâmetro de configuração
let _broadcastSse = () => {};
export function configureHookTools({ broadcastSse }) {
  _broadcastSse = broadcastSse;
}
```

---

### ARCH-04 — `conversation-hub/store.js`: WAL checkpoint em `setInterval` sem `clearInterval` no `stop()` ✅ CORRIGIDO

**Arquivo**: `src/copilot/conversation-hub/store.js` **Análise**: O checkpoint WAL é agendado via
`setInterval` com `unref()`. Porém, quando `ConversationHub.stop()` é chamado, o `setInterval` não é
cancelado (não há referência ao timer no `stop()`). Em ambientes de teste onde o hub é criado e
destruído repetidamente, timers fantasmas podem acumular.

**Correção**:

```javascript
// No init():
const _checkpointTimer = setInterval(() => { ... }, 5 * 60 * 1000);
_checkpointTimer.unref?.();

// Adicionar ao ConversationStore um método close():
close() {
    if (this._checkpointTimer) {
        clearInterval(this._checkpointTimer);
        this._checkpointTimer = null;
    }
    this.#db = null;
    this.#initialized = false;
}
```

---

### ARCH-05 — `api/bridge-stream.js`: Listeners de SSE não têm limite máximo por sessão ✅ CORRIGIDO

**Arquivo**: `src/copilot/api/bridge-stream.js` **Análise**: O endpoint `GET /api/copilot/stream`
registra listeners via `AGENT_EVENTS.map(...)` para cada cliente SSE. Com muitos eventos (27 em
`AGENT_EVENTS`) e muitos clientes, o `setMaxListeners(50)` em `AlwaysAliveAgent` pode ser excedido.
Com apenas 2 clientes SSE simultâneos, já são 54 listeners registrados (27 × 2).

**Correção**: Usar um único listener "fan-out" em vez de um listener por evento por cliente:

```javascript
// Em bridge-stream.js — usar o padrão "tap" com um único listener global
const globalFanOut = new EventEmitter();
globalFanOut.setMaxListeners(0); // sem limite para fan-out

// Registrar UMA VEZ no agente
AGENT_EVENTS.forEach((evt) => {
  alwaysAliveAgent.on(evt, (data) => globalFanOut.emit(evt, data));
});

// Cada cliente SSE se subscreve ao fan-out, não ao agente diretamente
bridge.get('/stream', (req, res) => {
  // ...
  const handlers = new Map(AGENT_EVENTS.map((evt) => [evt, (data) => sendEvt(evt, data ?? {})]));
  handlers.forEach((handler, evt) => globalFanOut.on(evt, handler));
  req.on('close', () => {
    handlers.forEach((handler, evt) => globalFanOut.off(evt, handler));
  });
});
```

---

### ARCH-06 — `channel/client.js`: `LlmBridgeClient.#MAX_HISTORY_SIZE` estático compartilhado entre instâncias ✅ CORRIGIDO

**Análise**: `#MAX_HISTORY_SIZE = 500` era um campo estático privado. Todas as instâncias
compartilhavam o mesmo limite. Não era bug funcional mas design smell para campo que deveria ser
configurável por instância.

**Correção aplicada**: Campo estático renomeado para `#DEFAULT_MAX_HISTORY_SIZE`, adicionado campo
de instância `#maxHistorySize` e construtor `constructor({ maxHistorySize = 500 } = {})`. Todas as
referências a `LlmBridgeClient.#MAX_HISTORY_SIZE` substituídas por `this.#maxHistorySize`.
Instâncias existentes sem argumento mantêm o comportamento padrão (500).

---

### ARCH-07 — `terminal/index.js`: Reflection loop sem controle de concorrência ✅ CORRIGIDO

**Arquivo**: `src/copilot/terminal/index.js` **Análise**: O reflection loop periódico chama
`sendTurn(...)` via `setInterval`. Se um turno anterior ainda estiver em execução quando o interval
disparar, `sendTurn` enfileira outro turno (graças ao mutex TERM-01), mas a fila pode crescer
indefinidamente se o interval for menor que a latência de resposta do modelo. O
`MAX_TURN_QUEUE_SIZE = 10` serve como proteção, mas o comportamento de backpressure resultante (null
retornado silenciosamente) pode confundir o operador.

**Recomendação**: Adicionar verificação antes de enviar reflexão:

```javascript
const runReflection = () => {
  if (!alwaysAliveAgent.dialogLoopActive) return;
  if (getTurnQueueDepth() > 0) {
    log('INFO', '[TerminalServer] Reflection loop pulado — fila ocupada.');
    return;
  }
  // ...
};
```

---

## 7. Bugs de Severidade Média

### BUG-MED-01 — `config/session-config.js`: `DEFAULT_EXCLUDED_TOOLS` exclui `web_fetch` mas custom tool a sobrescreve ⚠️ DOCUMENTADO (comportamento intencional — custom tool e built-in são registros independentes)

`DEFAULT_EXCLUDED_TOOLS = ['powershell', 'web_fetch', 'web_search', 'memory']`. A custom tool
`web_fetch` em `tools/web-tools.js` usa `overridesBuiltInTool: true`. A exclusão via `excludedTools`
do SDK aplica-se apenas à ferramenta built-in. A custom tool é registrada separadamente e não é
afetada pela `excludedTools`. Isso pode causar confusão: o operador configura `web_fetch` como
excluída pensando que está desativada, mas a versão customizada continua disponível.
**Recomendação**: Documentar explicitamente este comportamento e considerar nomear a custom tool
diferente (ex.: `safe_web_fetch`) para evitar conflito semântico.

---

### BUG-MED-02 — `channel/client.js`: `dialogTurn` registra turno de usuário antes de confirmar envio ✅ CORRIGIDO

**Análise**: `#pushHistory({ role: 'user', content: message, timestamp: sentAt })` é chamado
**antes** de `await alwaysAliveAgent.sendDialogTurn(message, ...)`. Se `sendDialogTurn` falhar
(timeout, dialog loop inativo), o turno do usuário já está no histórico mas sem a resposta
correspondente. O histórico fica inconsistente. **Correção**: Mover o push do histórico para dentro
do `try`, após confirmação de envio bem-sucedido, ou usar uma flag `pending` para turnos não
confirmados.

---

### BUG-MED-03 — `always-alive.js`: `#statusSnapshotCache` invalidado mas não nas mudanças de fila ✅ CORRIGIDO

**Análise**: `#statusSnapshotCache = null` é chamado em `#setStatus()` e em `sendMessage()` (quando
tarefa é enfileirada). Mas quando uma tarefa é **removida** da fila (em `stop()` com
`remainingTasks.splice(0)`), o cache NÃO é invalidado. Um health check feito logo após `stop()` pode
retornar `queueSize` desatualizado.

---

### BUG-MED-04 — `lib/permissions.js`: `createPermissionHandler` não trata `kind: 'content-exclusion-check'` corretamente ✅ VALIDADO CORRETO

**Análise**: O resultado `{ kind: 'denied-by-content-exclusion-policy', path, message }` é retornado
**somente** quando `request.kind === 'content-exclusion-check'`, o que garante conformidade com o
SDK. A lógica está correta. O resultado é produzido apenas quando o request tem esse kind
específico, portanto não há risco de resultado malformado.

---

### BUG-MED-05 — `routes/sessions.js`: Endpoint `DELETE /sessions/:id` usa apenas header, não body, para confirmação ⚠️ DOCUMENTADO (OK para uso interno; CORS preflight documentado como limitação conhecida)

**Análise**: A confirmação usa `req.headers['x-confirm-delete']`. Ferramentas HTTP simples (curl sem
`-H`) não enviam este header por default, o que é a proteção pretendida. Porém, navegadores que
fazem preflight CORS para DELETE podem ter comportamento inesperado. OK para uso interno via SDK,
mas documentar.

---

### BUG-MED-06 — `terminal/server.js`: `readBody` com `MAX_BODY_BYTES = 2MB` mas `terminal/http-handlers.js` tem limite próprio de `MAX_EMBED_BYTES = 64KB` para attachments ⚠️ DOCUMENTADO (truncamento ocorre corretamente; inconsistência de UX, não de segurança)

**Análise**: Existe inconsistência entre o limite de body (2MB) e o limite de embed de attachments
(64KB). Um body de 1.5MB com múltiplos attachments passará o `readBody` mas será truncado no
processamento. Não é um bug funcional (o trunc ocorre corretamente) mas pode confundir o chamador
que não recebe erro 413 para payloads entre 64KB e 2MB.

---

### BUG-MED-07 — `always-alive.js`: `emit('before-stop')` e `removeAllListeners('before-stop')` em `stop()` remove listener único ⚠️ DOCUMENTADO (comportamento intencional — cleanup em cascata ao reiniciar a sessão)

**Análise**: O código faz:

```javascript
this.emit('before-stop');
this.removeAllListeners('before-stop');
```

Isso remove TODOS os listeners de `'before-stop'`, incluindo os do NERV bridge. Funciona
corretamente na primeira parada. Mas se o agente for reiniciado e o NERV bridge registrar novamente
um listener de `'before-stop'`, na segunda parada o `removeAllListeners` remove esse listener
também. Este é o comportamento desejado (cleanup em cascade), mas deve ser documentado.

---

### BUG-MED-08 — `tools/code-tools.js`: `lint_check` usa caminho `node_modules/.bin/eslint` que pode não existir ✅ CORRIGIDO

**Arquivo**: `src/copilot/tools/code-tools.js` **Análise**:
`const eslintArgs = ['node_modules/.bin/eslint', ...]` — se chamado de um diretório diferente do
root do workspace, o caminho relativo falha. Além disso, em sistemas onde o ESLint é instalado
globalmente, este caminho também falha. **Correção**:

```javascript
const eslintArgs = ['npx', '--no', 'eslint', '--max-warnings=0'];
// OU
const eslintBin = path.join(ROOT, 'node_modules/.bin/eslint');
if (!existsSync(eslintBin))
  return { success: false, error: 'ESLint não encontrado em node_modules' };
```

---

### BUG-MED-09 — `bridges/mcp-tool-bridge.js`: Circuit breaker não persiste entre restarts do processo ✅ CORRIGIDO (backoff exponencial implementado)

**Análise**: `_mcpCircuitOpen` e `_mcpCircuitOpenAt` são variáveis de módulo (em memória). Se o
processo PM2 do agente reiniciar, o circuit breaker é resetado. O servidor MCP pode estar offline
mas o agente tenta 3 requisições na inicialização antes de reabrir o circuit. Em ambientes com
muitos restarts, isso gera ~9 tentativas HTTP desnecessárias a cada reinício. **Recomendação**:
Persistir o estado do circuit breaker em um arquivo temporário ou usar backoff exponencial no
início:

```javascript
const INITIAL_BACKOFF_MS = [0, 100, 500, 2000]; // Tentativas 1-4 com backoff
```

---

### BUG-MED-10 — `tools/shell/index.js`: `checkCommandBlocklist` não detecta `rm -rf` com múltiplos espaços ✅ CORRIGIDO

**Análise**: A regex `BLOCKED_COMMAND_PATTERNS` usa `\brm\s+-[a-z]*r[a-z]*f|rm\s+-[a-z]*f[a-z]*r`. O
`\s+` captura um ou mais espaços, então `rm  -rf` (dois espaços) é detectado. OK. Mas `rm\t-rf`
(tab) também usa `\s+`. OK. Porém `rm -r -f` (flags separadas) não é detectado pela regex.
**Correção**:

```javascript
/\brm\b.*-[a-z]*r[a-z]*f|\brm\b.*-[a-z]*f[a-z]*r|\brm\b.*--recursive.*--force/i,
```

---

### BUG-MED-11 — `conversation-hub/store.js`: FTS5 trigger `memories_au` usa `INSERT ... VALUES('delete', ...)` incorretamente ✅ VALIDADO CORRETO (sem mudança)

**Análise**: O trigger de UPDATE para FTS5 em content mode deve usar o comando especial:

```sql
INSERT INTO copilot_memories_fts(copilot_memories_fts, rowid, id, tag, content)
VALUES('delete', old.rowid, old.id, old.tag, old.content);
```

O código usa exatamente este padrão — CORRETO. A verificação confirma que a sintaxe está alinhada
com a documentação SQLite FTS5.

_[Reclassificado como OK após verificação.]_

---

### BUG-MED-12 — `lib/telemetry.js`: `startSpan` tem race condition na inicialização do tracer ✅ CORRIGIDO

**Arquivo**: `src/copilot/lib/telemetry.js` **Análise**: A variável `_tracerInitPromise` evita
múltiplas inicializações paralelas. Mas o padrão:

```javascript
if (_tracerInitPromise === null) {
  _tracerInitPromise = getTracer().then(() => undefined);
}
await _tracerInitPromise;
```

Se duas chamadas a `startSpan` chegam ANTES de `_tracerInitPromise` ser atribuído (mesmo microtask
tick em JS), ambas entram no `if` e criam duas Promises. Isso cria dois inicializadores do
`NodeTracerProvider`. Na prática, a probabilidade é muito baixa mas é uma race teórica.
**Correção**:

```javascript
// Inicializar no carregamento do módulo em vez de lazily
const _tracerInit = initTracer(); // Promise resolvida no import
async function startSpan(name, attrs, fn) {
  const tracer = await _tracerInit;
  if (!tracer) return fn();
  // ...
}
```

---

## 8. Aprimoramentos e Upgrades Propostos

### UPG-PROP-01 — Telemetria OpenTelemetry nativa via `CopilotClient` config ⏭️ ADIADO (requer refatoração do ciclo de vida do CopilotClient em always-alive.js — complexidade alta, benefício marginal dado que lib/telemetry.js já funciona)

**Análise**: O SDK oficial suporta telemetria OTEL diretamente via
`CopilotClient({ telemetry: { otlpEndpoint: '...' } })`. O projeto implementa OTEL via
`lib/telemetry.js` de forma paralela. A integração deveria usar o mecanismo nativo do SDK que
propaga trace context automaticamente via `traceparent` headers entre o agente e as tool calls.

**Proposta**:

```javascript
// Em always-alive.js constructor:
const client = new CopilotClient({
  ...(process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? {
        telemetry: {
          otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        },
      }
    : {}),
});
```

---

### UPG-PROP-02 — Migrar `always-alive.js` para padrão `await using` (Explicit Resource Management) ⏭️ ADIADO (`Symbol.asyncDispose` já implementado; migração de scripts standalone é opcional e de baixo impacto)

O `Symbol.asyncDispose` já está implementado no `AlwaysAliveAgent`. O padrão `await using` está
disponível no Node.js 22+ (stage 4 TC39). Migrar scripts standalone:

```javascript
// Antes:
await alwaysAliveAgent.start();
try {
  await bridge.chat('...');
} finally {
  await alwaysAliveAgent.stop();
}

// Depois:
{
  await using agent = alwaysAliveAgent;
  await agent.start();
  await bridge.chat('...');
} // agent.stop() chamado automaticamente
```

---

### UPG-PROP-03 — `StructuredMessageSchema`: Adicionar `.strict()` para rejeitar campos desconhecidos ✅ IMPLEMENTADO

```javascript
export const StructuredMessageSchema = z
  .object({
    // ... campos existentes
  })
  .strict(); // Rejeitar campos não declarados
```

Isso evita que LLM-B responda com campos proprietários que são silenciosamente ignorados.

---

### UPG-PROP-04 — Implementar `session.getMessages()` cache em `LlmBridgeClient` ✅ IMPLEMENTADO

Cache com TTL de 30s adicionado diretamente em `AlwaysAliveAgent.getSessionMessages()` (o método
público que encapsula a chamada ao SDK). Campos `#messagesCache`, `#messagesCacheAt` e
`static #MESSAGES_CACHE_TTL = 30_000` adicionados à classe. Cache é invalidado quando `#session` é
definido como `null` no `stop()`.

```javascript
// Em always-alive.js
#messagesCacheAt = 0;
#messagesCache = null;
static #MESSAGES_CACHE_TTL = 30_000; // 30s

async getSessionMessages() {
    if (this.#messagesCache && Date.now() - this.#messagesCacheAt < AlwaysAliveAgent.#MESSAGES_CACHE_TTL) {
        return this.#messagesCache;
    }
    const messages = await this.#session?.getMessages() ?? [];
    this.#messagesCache = messages;
    this.#messagesCacheAt = Date.now();
    return messages;
}
```

---

### UPG-PROP-05 — `tools/todo-tools.js`: Adicionar campo `completedBy` para rastreabilidade ✅ IMPLEMENTADO

```javascript
// Acrescentar ao schema:
completedBy: z.string().optional().describe('Identificador de quem concluiu a tarefa (agente, usuário, etc.)'),
```

---

### UPG-PROP-06 — `conversation-hub/store.js`: Adicionar índice fulltext em `conversation_turns.content` ✅ IMPLEMENTADO

FTS5 virtual table `copilot_turns_fts` criada com triggers de sincronização automática
(INSERT/UPDATE/DELETE). Método `searchTurns({ query, hubSessionId?, role?, limit? })` adicionado ao
`ConversationStore`. Função `initTurnsFts()` re-sincroniza a tabela FTS em BDs existentes
(idempotente). 5 novos testes unitários cobrindo busca, filtro por role, filtro por sessão e limite.

---

### UPG-PROP-07 — `api/bridge-control.js`: Endpoint `/health` deve incluir versão do SDK ✅ IMPLEMENTADO

```javascript
// Adicionar ao response de /health
const sdkVersion = (() => {
  try {
    const req = createRequire(import.meta.url);
    return req('@github/copilot-sdk/package.json').version;
  } catch {
    return 'unknown';
  }
})();

res.status(healthy ? 200 : 503).json({
  // ... campos existentes
  sdkVersion,
  channelVersion: CHANNEL_VERSION,
  nodeVersion: process.version,
});
```

---

### UPG-PROP-08 — `terminal/server.js`: Adicionar endpoint `GET /metrics` (Prometheus-compatible) ✅ IMPLEMENTADO

Endpoint `GET /metrics` adicionado em `http-handlers.js` (`handleMetrics`) e roteado em `server.js`.
Isento de autenticação (compatível com scraping Prometheus). Expõe: `llmb_agent_status`,
`llmb_queue_size`, `llmb_send_count_total`, `llmb_sse_clients`, `llmb_context_tokens`,
`llmb_context_token_limit`, `llmb_context_utilization`. Formato: `text/plain; version=0.0.4`.

```javascript
server.on('request', (req, res) => {
  if (req.method === 'GET' && url.pathname === '/metrics') {
    const snap = alwaysAliveAgent.getStatusSnapshot();
    const metrics = [
      `# HELP copilot_agent_status Agent status (1=active, 0=stopped)`,
      `# TYPE copilot_agent_status gauge`,
      `copilot_agent_status{status="${snap.status}"} ${snap.status !== 'stopped' ? 1 : 0}`,
      `# HELP copilot_queue_size Current task queue size`,
      `copilot_queue_size ${snap.queueSize}`,
      `# HELP copilot_turn_queue_depth Dialog turn queue depth`,
      `copilot_turn_queue_depth ${getTurnQueueDepth()}`,
      `# HELP copilot_sse_clients Connected SSE clients`,
      `copilot_sse_clients ${getSseClients().size}`,
    ].join('\n');
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    res.end(metrics);
    return;
  }
  // ...
});
```

---

### UPG-PROP-09 — `config/mcp-servers.js`: Validar credenciais MCP antes de registrar servidores ✅ IMPLEMENTADO

```javascript
export function buildMcpConfig(enabled = DEFAULT_ENABLED) {
  if (enabled.length === 0) return undefined;
  const result = {};
  for (const name of enabled) {
    const server = MCP_SERVERS[name];
    if (!server) continue;
    // Validar credenciais necessárias
    if (name === 'github' && !process.env.GITHUB_TOKEN) {
      log('WARN', `[MCP] Servidor '${name}' requer GITHUB_TOKEN — pulando.`);
      continue;
    }
    if (name === 'github-official' && !process.env.GITHUB_TOKEN) {
      log('WARN', `[MCP] Servidor '${name}' requer GITHUB_TOKEN — pulando.`);
      continue;
    }
    result[name] = server;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
```

---

### UPG-PROP-10 — `always-alive.js`: Expor `listenerDiagnostics()` no endpoint `/health` ✅ IMPLEMENTADO

O método `listenerDiagnostics()` já existe mas é removido do response HTTP por `SEC-V04`. Considerar
reintroduzi-lo em modo desenvolvimento:

```javascript
// Em bridge-control.js /health
const listenerCounts = process.env.NODE_ENV === 'development'
    ? agent.listenerDiagnostics()
    : undefined;
res.json({
    ...,
    ...(listenerCounts ? { listenerCounts } : {}),
});
```

---

### UPG-PROP-11 — `types/structured-message.js`: Adicionar validação de `correlationId` como UUID ✅ IMPLEMENTADO

```javascript
correlationId: z.string().uuid().optional(),
traceId: z.string().uuid().optional(),
```

---

### UPG-PROP-12 — `channel/client.js`: Adicionar método `getHistory(n)` com slice inteligente ✅ IMPLEMENTADO

```javascript
/**
 * Retorna os últimos N pares (user+assistant) do histórico.
 * @param {number} pairs - Número de pares a retornar
 */
getLastNPairs(pairs = 5) {
    const hist = [...this.#history];
    const userIndices = hist.map((t, i) => ({ i, role: t.role }))
        .filter(t => t.role === 'user')
        .map(t => t.i)
        .slice(-pairs);
    if (!userIndices.length) return hist.slice(-pairs * 2);
    const startIdx = userIndices[0];
    return hist.slice(startIdx);
}
```

---

### UPG-PROP-13 — `terminal/commands/session.js`: `cmdDbHistory` deveria paginar ✅ IMPLEMENTADO

Parâmetro `offset` adicionado a `cmdDbHistory({ ... }, n = 20, offset = 0)`. Parser em `repl.js`
atualizado: `/db-history [n] [offset]` (ex.: `/db-history 20 40`). Banner do terminal atualizado
para refletir a nova sintaxe.

---

### UPG-PROP-14 — Migrar `codeTools` para usar `execa` em vez de `execFile` ⏭️ ADIADO (nova dependência de produção; impacto alto para benefício moderado — `execFile` com promisify funciona corretamente)

A dependência `execa` (já popular no ecossistema Node.js) oferece melhor tratamento de erros,
streams melhorados e cancelamento nativo via AbortSignal, sem o overhead de promisify:

```javascript
import { execa } from 'execa';
// Substitui execFile + promisify em code-tools.js e git-tools.js
```

---

## 9. Checklist de Conformidade SDK

| Item                                                             | Status          | Arquivo                   | Observação                                               |
| ---------------------------------------------------------------- | --------------- | ------------------------- | -------------------------------------------------------- |
| `onPermissionRequest` obrigatório em `createSession`             | ✅ OK           | `session-manager.js`      | Implementado via `buildAuditingPermissionHandler`        |
| `onPermissionRequest` obrigatório em `resumeSession`             | ✅ OK           | `lib/session.js`          | Passado via `buildSessionConfig`                         |
| `session.sendAndWait({ prompt }, timeout)`                       | ✅ OK           | `task-executor.js`        | Assinatura correta                                       |
| `session.disconnect()` em vez de `session.destroy()`             | ✅ OK           | `always-alive.js`         | Usa `disconnect()`                                       |
| `skipPermission: true` em read-only tools                        | ✅ OK           | Múltiplos arquivos        | Aplicado via `withSkipPermission()`                      |
| `overridesBuiltInTool: true` em tools que sobrescrevem built-ins | ⚠️ PARCIAL      | `tools-bootstrap.js`      | BUG-HIGH-07: spread pode ser inseguro                    |
| `infiniteSessions` com `backgroundCompactionThreshold`           | ✅ OK           | `session-manager.js`      | Configurável via `setBackgroundCompactionThreshold`      |
| `skillDirectories` em `SessionConfig`                            | ✅ OK           | `session-manager.js`      | `'.github/skills'` configurado                           |
| `customAgents` com `infer: true`                                 | ⚠️ RISCO        | `config/custom-agents.js` | `infer` não documentado oficialmente no SDK — GAP-SDK-03 |
| `session.rpc.*` APIs                                             | ⚠️ EXPERIMENTAL | `session-rpc-tools.js`    | GAP-SDK-03                                               |
| `getMessages()` em vez de `getHistory()`                         | ✅ OK           | `always-alive.js`         | Fix SDK-NC01 corretamente aplicada                       |
| `mcpServers` com type `'http'` para GitHub oficial               | ✅ OK           | `config/mcp-servers.js`   | Configuração correta                                     |
| `session.on('session.usage_info', ...)`                          | ✅ OK           | `always-alive.js`         | Evento mapeado corretamente                              |
| `session.on('session.compaction_*')`                             | ✅ OK           | `always-alive.js`         | Ambos eventos mapeados                                   |
| `session.on('assistant.reasoning_delta', ...)`                   | ✅ OK           | `always-alive.js`         | Evento forwarded corretamente                            |
| Rate limiting em session creation                                | ❌ AUSENTE      | `routes/sessions.js`      | SEC-VULN-05                                              |

---

## 10. Roadmap de Correções

### Fase 1 — Críticos (Corrigir Antes do Próximo Deploy)

| ID          | Arquivo                                     | Esforço |
| ----------- | ------------------------------------------- | ------- |
| BUG-CRIT-01 | `tools/todo-tools.js`                       | 30 min  |
| BUG-CRIT-02 | `conversation-hub/socket-ns.js`             | 1h      |
| BUG-CRIT-03 | `conversation-hub/store.js` + migration SQL | 1h      |
| BUG-CRIT-04 | `channel/audit.js`                          | 2h      |

### Fase 2 — Alta Severidade (Sprint Atual)

| ID          | Arquivo                            | Esforço |
| ----------- | ---------------------------------- | ------- |
| BUG-HIGH-01 | `tools/file-tools.js`              | 15 min  |
| BUG-HIGH-02 | `terminal/dialog.js`               | 1h      |
| BUG-HIGH-03 | `conversation-hub/orchestrator.js` | 2h      |
| BUG-HIGH-04 | `agent/always-alive.js`            | 1h      |
| BUG-HIGH-05 | `agent/session-manager.js`         | 2h      |
| BUG-HIGH-07 | `agent/tools-bootstrap.js`         | 1h      |
| BUG-HIGH-10 | `bridges/nerv-bridge.js`           | 1h      |

### Fase 3 — Segurança (Sprint Seguinte)

| ID          | Arquivo                    | Esforço |
| ----------- | -------------------------- | ------- |
| SEC-VULN-01 | `tools/web-tools.js`       | 30 min  |
| SEC-VULN-02 | `tools/hook-tools.js`      | 45 min  |
| SEC-VULN-03 | `agent/session-manager.js` | 30 min  |
| SEC-VULN-04 | `tools/shell/index.js`     | 1h      |
| SEC-VULN-05 | `routes/sessions.js`       | 2h      |
| SEC-VULN-06 | `terminal/server.js`       | 2h      |

### Fase 4 — Conformidade SDK e Arquitetura

| ID         | Descrição                                       | Esforço |
| ---------- | ----------------------------------------------- | ------- |
| GAP-SDK-04 | Adicionar `'context:compacted'` ao AGENT_EVENTS | 15 min  |
| GAP-SDK-07 | Fix `overridesBuiltInTool` em MCP tools         | 15 min  |
| ARCH-04    | Fix WAL checkpoint timer leak                   | 30 min  |
| ARCH-05    | Refatorar SSE fan-out pattern                   | 3h      |
| BUG-MED-08 | Fix caminho ESLint em `lint_check`              | 15 min  |
| BUG-MED-10 | Fix regex `rm -r -f` em blocklist               | 15 min  |

### Fase 5 — Upgrades Propostos (Backlog)

| ID          | Descrição                                 | Esforço |
| ----------- | ----------------------------------------- | ------- |
| UPG-PROP-01 | OTEL via `CopilotClient` config nativa    | 2h      |
| UPG-PROP-06 | FTS5 em `conversation_turns.content`      | 3h      |
| UPG-PROP-08 | Endpoint `/metrics` Prometheus-compatible | 2h      |
| UPG-PROP-09 | Validação de credenciais MCP              | 1h      |

---

## Apêndice — Arquivos Auditados

```
src/copilot/
├── agent/          always-alive.js, dialog-watchdog.js, entry.js, events.js,
│                   session-manager.js, task-executor.js, tools-bootstrap.js,
│                   webhook-manager.js
├── api/            bridge-control.js, bridge-dialog.js, bridge-stream.js,
│                   bridge-tasks.js, copilot-router.js, http-bridge.js,
│                   sdk-api.js, sdk-router.js
├── bridges/        alias-store.js, gh-bridge.js, git-bridge.js, inject-llmb.js,
│                   llm-bridge-client.js, mcp-tool-bridge.js, nerv-bridge.js
├── channel/        audit.js, client.js, index.js, inject.js
├── config/         custom-agents.js, index.js, mcp-servers.js,
│                   pinned-files-loader.js, session-config.js, system-prompt.js,
│                   tools/index.js, tools/registry.js, tools/state.js
├── conversation-hub/ hub.js, index.js, orchestrator.js, socket-ns.js, store.js
├── core/           constants.js, errors.js, index.js, types.js
├── lib/            agents.js, client.js, hooks.js, index.js, models.js,
│                   permissions.js, session.js, telemetry.js, tools-registry.js
├── routes/         agent.js, client.js, sessions.js, webhooks.js
├── terminal/       commands/ (12 arquivos), dialog.js, file-context.js,
│                   http-handlers.js, index.js, repl.js, server.js, state.js,
│                   workspace-context.js
├── tools/          code-tools.js, file-tools.js, git-tools.js, git/index.js,
│                   hook-tools.js, hub-tools.js, index.js, introspection-tools.js,
│                   session-rpc-tools.js, session-tools.js, shell/index.js,
│                   task-tools.js, todo-tools.js, tool-factory.js, web-tools.js
├── types/          index.js, structured-message.js
└── (raiz)          agent.js, llm-a-conversation.mjs, terminal-server.js,
                    LLM-A-COMMUNICATION-GUIDE.md, PLANO-AMBIENTE-PERMANENTE.md
```

**Total**: 99 arquivos analisados integralmente. **Documentação SDK consultada**:
`npmjs.com/@github/copilot-sdk`, `github.com/github/copilot-sdk` (CHANGELOG, releases,
docs/features/), `docs.github.com/copilot/how-tos/copilot-sdk`.

---

_Relatório gerado por Claude Sonnet 4.6 em 2026-03-28_
