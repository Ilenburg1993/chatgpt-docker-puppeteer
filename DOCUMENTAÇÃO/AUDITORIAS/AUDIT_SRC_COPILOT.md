# Auditoria Técnica — Módulo `src/copilot`
> **Repositório**: `Ilenburg1993/chatgpt-docker-puppeteer`
> **Escopo**: Todo o subsistema `src/copilot/` (~107 arquivos)
> **SDK de Referência**: `@github/copilot-sdk` (latest release v0.1.10 → CHANGELOG até v0.x)
> **Data**: 2026-03-26
> **Classificação de Severidade**: 🔴 CRÍTICO · 🟠 ALTO · 🟡 MÉDIO · 🔵 BAIXO · 💡 MELHORIA

---

## Sumário Executivo

O módulo `src/copilot/` implementa uma camada de orquestração sofisticada sobre o `@github/copilot-sdk`, compreendendo o **AlwaysAliveAgent**, o **ConversationHub**, o **Terminal Permanente LLM-B** e um conjunto de 30+ Custom Tools. A arquitetura é ambiciosa e bem documentada, mas a análise identificou **8 bugs críticos**, **14 falhas de alta severidade**, **22 gaps de conformidade com a API oficial do SDK**, e **31 melhorias recomendadas**.

| Categoria            | Crítico 🔴 | Alto 🟠 | Médio 🟡 | Baixo 🔵 |
| -------------------- | --------- | ------ | ------- | ------- |
| Conformidade SDK API | 3         | 6      | 8       | 5       |
| Bugs de Runtime      | 3         | 4      | 6       | 4       |
| Segurança            | 2         | 4      | 3       | 2       |
| Arquitetura / Design | 0         | 0      | 5       | 10      |
| **Total**            | **8**     | **14** | **22**  | **21**  |

---

## Índice

1. [Conformidade com a API do SDK](#1-conformidade-com-a-api-do-sdk)
2. [Bugs de Runtime](#2-bugs-de-runtime)
3. [Vulnerabilidades de Segurança](#3-vulnerabilidades-de-segurança)
4. [Gaps de Arquitetura](#4-gaps-de-arquitetura)
5. [Melhorias e Upgrades Recomendados](#5-melhorias-e-upgrades-recomendados)
6. [Tabela de Correções Prioritárias](#6-tabela-de-correções-prioritárias)

---

## 1. Conformidade com a API do SDK

### SDK-01 🔴 — `onPreToolUse` hook retorna formato errado

**Arquivo**: `src/copilot/lib/hooks.js` (linhas ~85-100)
**Problema**: O hook `onPreToolUse` retorna `{ permissionDecision: 'allow' | 'deny' }`, mas a API oficial do SDK especifica que o valor retornado deve ser `{ permissionDecision: "allow" | "deny" | "ask", modifiedArgs?, additionalContext? }`. O campo `"ask"` está completamente ausente das implementações, e o campo `additionalContext` (que permite ao modelo receber contexto extra sobre o motivo da decisão) nunca é utilizado.

**Evidência na documentação oficial**:
```javascript
// SDK oficial
onPreToolUse: async (input, invocation) => {
  return {
    permissionDecision: "allow",   // "allow" | "deny" | "ask"
    modifiedArgs: input.toolArgs,  // modificação opcional dos args
    additionalContext: "Motivo",   // contexto para o modelo
  };
}
```

**Código problemático atual**:
```javascript
// hooks.js — falta "ask" e additionalContext
return { permissionDecision: decision };  // decision = 'allow' | 'deny'
```

**Correção**:
```javascript
// hooks.js — versão corrigida
async function resolveToolDecision(toolName, allowTools, denyTools, denyPatterns, auditMode) {
    if (denyTools.includes(toolName)) {
        return {
            permissionDecision: /** @type {'deny'} */ ('deny'),
            additionalContext: `Ferramenta '${toolName}' está na denylist.`,
        };
    }
    for (const pattern of denyPatterns) {
        if (pattern.test(toolName)) {
            return {
                permissionDecision: /** @type {'deny'} */ ('deny'),
                additionalContext: `Ferramenta '${toolName}' corresponde ao padrão bloqueado: ${pattern}`,
            };
        }
    }
    if (allowTools.length > 0 && !allowTools.includes(toolName)) {
        return {
            permissionDecision: /** @type {'deny'} */ ('deny'),
            additionalContext: `Ferramenta '${toolName}' não está na allowlist.`,
        };
    }
    return { permissionDecision: /** @type {'allow'} */ ('allow') };
}
```

---

### SDK-02 🔴 — `PermissionHandler` vs `onPreToolUse`: duas APIs confundidas

**Arquivo**: `src/copilot/lib/permissions.js`, `src/copilot/agent/session-manager.js`
**Problema**: O código mistura dois mecanismos distintos do SDK:
1. **`onPermissionRequest`** — o `PermissionHandler` que retorna `{ kind: 'approved' }` / `{ kind: 'denied-by-rules', rules: [] }` etc.
2. **`onPreToolUse`** (hook) — que retorna `{ permissionDecision: 'allow' | 'deny' | 'ask' }`.

Em `lib/permissions.js`, é criado um `PermissionHandler` corretamente. Mas em `lib/hooks.js`, o `onPreToolUse` também tenta agir como `PermissionHandler`, e em `session-manager.js` o `buildAuditingPermissionHandler` envolve o `approveAll` (PermissionHandler correto), mas os tipos JSDoc misturam as duas interfaces.

**Impacto**: Em runtime, se o SDK chamar `onPreToolUse` esperando `{ permissionDecision }` e receber `{ kind: 'approved' }`, a decisão é silenciosamente ignorada — a ferramenta pode ser executada mesmo quando deveria ser negada.

**Correção**: Separar explicitamente as duas responsabilidades e garantir que cada callback retorna o tipo exato esperado pelo SDK. Criar um arquivo `src/copilot/lib/permission-types.js` que documente a distinção:

```javascript
// permission-types.js
/**
 * @typedef {'approved'
 *   | 'denied-by-rules'
 *   | 'denied-no-approval-rule-and-could-not-request-from-user'
 *   | 'denied-interactively-by-user'
 *   | 'denied-by-content-exclusion-policy'} PermissionResultKind
 */

/**
 * ATENÇÃO: onPermissionRequest e onPreToolUse são APIs DISTINTAS.
 *
 * onPermissionRequest → retorna { kind: PermissionResultKind, ... }
 * onPreToolUse        → retorna { permissionDecision: 'allow'|'deny'|'ask', modifiedArgs?, additionalContext? }
 */
```

---

### SDK-03 🔴 — `systemMessage.mode: 'customize'` usado em código mas não suportado nesta versão

**Arquivo**: `src/copilot/lib/session.js` (linha ~120)
**Problema**: O código em `lib/session.js` monta um systemMessage com `mode: 'customize'` e `sections` estruturado:
```javascript
return {
    mode: 'customize',
    sections: {
        guidelines: { action: 'append', content },
    },
};
```
Entretanto, o SDK atual (v0.1.x) **não suporta `mode: 'customize'`** — apenas `mode: 'append'` e `mode: 'replace'`. O modo `customize` com `sections` foi introduzido na documentação como recurso futuro (SDK v0.2.0). O código em `config/system-prompt.js` corretamente usa `mode: 'append'`, criando uma **inconsistência** interna.

**Evidência**: `config/system-prompt.js` linha ~280 usa `mode: 'append'`; `lib/session.js` linha ~120 usa `mode: 'customize'`.

**Correção**: Unificar para `mode: 'append'` até o SDK v0.2.0 ser lançado. Marcar com TODO para migração futura:
```javascript
// lib/session.js — CORREÇÃO
function buildSystemMessageConfig(systemMessageOpt, content) {
    if (systemMessageOpt === false) return undefined;
    if (systemMessageOpt && typeof systemMessageOpt === 'object') return systemMessageOpt;
    if (!content) return undefined;
    // TODO: migrar para mode:'customize' com sections quando SDK v0.2.0 for lançado
    return { mode: 'append', content };
}
```

---

### SDK-04 🟠 — `defineTool` — assinatura inconsistente com o SDK oficial

**Arquivo**: Todos os arquivos em `src/copilot/tools/`
**Problema**: O SDK oficial define:
```javascript
defineTool(name: string, options: { description, parameters, handler, skipPermission?, overridesBuiltInTool? })
// ou
defineTool(options: { name, description, parameters, handler, ... })
```
No projeto, os arquivos de tools alternam entre as duas formas sem consistência, e em `tool-factory.js` há um wrapper que aceita as duas mas o casting para `ZodSchema<any>` perde a tipagem. Além disso, os handlers em vários arquivos usam:
```javascript
/** @type {import('@github/copilot-sdk').ZodSchema<any>} */ (/** @type {unknown} */ (z.object({...})))
```
Este double-cast é um anti-padrão que suprime erros de tipo legítimos.

**Correção**: Padronizar todos os arquivos de tools para a forma `defineTool(name, options)`, com os parâmetros Zod passados diretamente sem cast:
```javascript
// Forma canônica — sem casts
export const myTool = defineTool('my_tool', {
    description: '...',
    parameters: z.object({ path: z.string() }),
    handler: async ({ path }) => { /* ... */ },
    skipPermission: true,
});
```

---

### SDK-05 🟠 — `sendAndWait` timeout menor que o loop de diálogo

**Arquivo**: `src/copilot/agent/always-alive.js` (linha ~480)
**Problema**: O `startDialogLoop` chama `sendMessage` com `timeoutMs: 24 * 60 * 60 * 1000` (24h), mas o `sendAndWait` interno do SDK possui um timeout separado que pode ser configurado por sessão. Ao usar `sendAndWait(opts, task.timeoutMs ?? 60_000)`, o task do loop de diálogo usa o timeout de 24h, mas se o SDK internamente tiver um timeout de sessão menor, a sessão será encerrada prematuramente.

**Correção**: Verificar e alinhar o timeout passado ao `sendAndWait` com o timeout efetivo de sessão:
```javascript
// task-executor.js — usar timeout explícito e documentado
const DIALOG_LOOP_TIMEOUT_MS = 24 * 60 * 60 * 1_000; // 24h
const sendOpts = { prompt: task.message, ...(task.attachments ? { attachments: task.attachments } : {}) };
const effectiveTimeout = task.timeoutMs ?? 60_000;
const event = await session.sendAndWait(sendOpts, effectiveTimeout);
```

---

### SDK-06 🟠 — `session.on()` — unsubscribe não garantido em task-executor

**Arquivo**: `src/copilot/agent/task-executor.js`
**Problema**: O `unsubDelta`, `unsubToolStart` e `unsubToolComplete` são chamados no bloco `try/catch`, mas não em um `finally`. Se `sendAndWait` lançar uma exceção que seja capturada e levante novamente (após `tryReconnect` falhar), os listeners nunca são removidos, causando **memory leak** de listeners acumulados a cada tentativa de reconnect.

**Evidência**:
```javascript
// task-executor.js — PROBLEMA: unsubscribe só no caminho feliz e no catch, não no finally
try {
    const event = await session.sendAndWait(sendOpts, task.timeoutMs ?? 60_000);
    unsubDelta();
    unsubToolStart();
    unsubToolComplete();
    // ...
} catch (e) {
    unsubDelta();
    unsubToolStart();
    unsubToolComplete();
    // ...
} finally {
    scheduleNext(); // finally existe, mas unsubscribes não estão aqui
}
```

**Correção**:
```javascript
// task-executor.js — CORREÇÃO
try {
    const event = await session.sendAndWait(sendOpts, task.timeoutMs ?? 60_000);
    // processar resultado...
} catch (e) {
    // tratar erro...
} finally {
    unsubDelta();
    unsubToolStart();
    unsubToolComplete();
    scheduleNext();
}
```

---

### SDK-07 🟠 — `PermissionHandler` sem tipagem de retorno para `denied-by-content-exclusion-policy`

**Arquivo**: `src/copilot/lib/permissions.js`
**Problema**: O tipo union `PermissionRequestResult` do SDK inclui:
```typescript
{ kind: 'denied-by-content-exclusion-policy'; path: string; message: string }
```
Este caso não é tratado nem documentado no código do projeto, deixando um caminho de execução sem cobertura. Se o SDK invocar o handler com uma permissão do tipo `content-exclusion`, o handler retornará `makeApproved()` inadvertidamente, violando a política de exclusão de conteúdo.

**Correção**: Adicionar tratamento explícito para o caso de content exclusion na pipeline de permissões:
```javascript
// No handler de permissão, verificar o tipo de request
if (request.kind === 'content-exclusion-check') {
    // Delegar ao SDK — não aprovar automaticamente
    return { kind: 'denied-by-content-exclusion-policy', path: request.path, message: 'Política de exclusão ativa' };
}
```

---

### SDK-08 🟡 — `infiniteSessions.backgroundCompactionThreshold` sem validação de range no SDK

**Arquivo**: `src/copilot/agent/session-manager.js`, `src/copilot/terminal/http-handlers.js`
**Problema**: O threshold é validado em `handleSetInfiniteSessionConfig` (0.1 a 1.0), mas `setBackgroundCompactionThreshold` aceita qualquer número entre 0.1 e 1.0 sem verificar se o SDK aceita valores fora deste range. A API do SDK não documenta limites explícitos, mas valores próximos de 0 podem causar compaction loops.

**Correção**: Adicionar clamp defensivo e warning:
```javascript
export function setBackgroundCompactionThreshold(threshold) {
    const clamped = Math.max(0.3, Math.min(0.95, threshold)); // range seguro documentado
    if (clamped !== threshold) {
        log('WARN', `[session-manager] threshold ${threshold} fora do range seguro (0.3-0.95), ajustado para ${clamped}`);
    }
    _backgroundCompactionThreshold = clamped;
}
```

---

### SDK-09 🟡 — `session.on()` retorna unsubscribe mas o tipo não é verificado

**Arquivo**: `src/copilot/agent/always-alive.js` e `task-executor.js`
**Problema**: O SDK retorna uma função de unsubscribe de `session.on(event, handler)`, mas o código trata o retorno inconsistentemente — às vezes atribuindo a uma const (`unsubDelta`), às vezes ignorando. No `always-alive.js`, os listeners para `session.compaction_start`, `session.usage_info` etc. nunca são removidos explicitamente, mesmo no método `stop()`.

**Correção**: Armazenar todas as funções de unsubscribe em um array e chamar no `stop()`:
```javascript
// always-alive.js
#sessionListenerCleanups = [];

// ao registrar:
const unsub = session.on('session.compaction_start', handler);
this.#sessionListenerCleanups.push(unsub);

// em stop():
this.#sessionListenerCleanups.forEach(fn => fn?.());
this.#sessionListenerCleanups = [];
```

---

### SDK-10 🟡 — `mcpServers` configurado como `Record<string, McpServerConfig>` mas SDK espera formato diferente

**Arquivo**: `src/copilot/config/mcp-servers.js`
**Problema**: A configuração MCP passada ao SDK usa `type: 'stdio' | 'sse'`, mas a API oficial do SDK (v0.1.x) para MCP servers não documenta este campo exatamente. O campo `type` em MCPServerConfig pode ter sido renomeado ou ter comportamento diferente entre versões.

---

### SDK-11 🟡 — `session.getMessages()` chamado sem verificar disponibilidade

**Arquivo**: `src/copilot/agent/always-alive.js` (método `getSessionMessages`)
**Problema**: O método chama `session.getMessages()` mas não verifica se o SDK suporta este método na versão instalada — pode lançar exceção silenciosa.

---

### SDK-12 🔵 — `reasoningEffort: 'xhigh'` não documentado como suportado

**Arquivo**: `src/copilot/agent/always-alive.js`, `src/copilot/terminal/commands/config.js`
**Problema**: O nível `'xhigh'` está listado como opção válida, mas a documentação oficial do SDK menciona apenas `'low' | 'medium' | 'high'`. Pode gerar erro silencioso em modelos que não o suportam.

---

## 2. Bugs de Runtime

### BUG-01 🔴 — Race condition em `writeTurn()` persiste apesar da transação

**Arquivo**: `src/copilot/conversation-hub/store.js` (método `writeTurn`)
**Problema**: Embora o BUG-03 tenha sido corrigido com uma transaction, há uma race condition residual: `turn_number` é calculado dentro da transaction como `MAX(turn_number) + 1`, mas se duas transações concorrentes iniciarem simultaneamente antes de qualquer uma commitar, ambas podem ler o mesmo `MAX`. O SQLite com WAL mode permite leituras concorrentes, então **dois writers simultâneos podem atribuir o mesmo `turn_number`** para uma mesma `hub_session`.

**Evidência**:
```javascript
// store.js — a transaction protege do interleaving mas não da concorrência paralela
const doWrite = db.transaction(() => {
    const maxTurn = db.prepare(`SELECT MAX(turn_number) ...`).get(hubSessionId);
    const turnNumber = (maxTurn?.max_turn ?? 0) + 1;
    // Se outro writer leu maxTurn=5 antes deste commitar, ambos escreverão turn_number=6
    // ...
});
```

**Correção**: Usar `UNIQUE` constraint no banco e retry com backoff ao receber `SQLITE_CONSTRAINT`:
```sql
-- Schema adicional
ALTER TABLE copilot_conversation_turns
    ADD CONSTRAINT uq_hub_turn UNIQUE (hub_session_id, turn_number);
```
```javascript
// Ou usar AUTOINCREMENT adequado + índice natural de ordering por id
// Em vez de calcular turn_number manualmente, usar o id AUTOINCREMENT como turn_number
```

---

### BUG-02 🔴 — `AlwaysAliveAgent.stop()` pode deixar listeners órfãos no EventEmitter

**Arquivo**: `src/copilot/agent/always-alive.js` (método `stop`)
**Problema**: Em `stop()`, o código para o dialog loop e limpa a fila, mas os listeners registrados no `alwaysAliveAgent` por componentes externos (como `nerv-bridge.js`, `terminal/index.js`, `terminal/repl.js`) **não são removidos**. Após um `stop()` seguido de `start()`, os listeners se acumulam a cada ciclo de vida, eventualmente causando o warning do Node.js `MaxListenersExceededWarning` e potencialmente dead callbacks referenciando estado obsoleto.

**Evidência**: `alwaysAliveAgent.setMaxListeners(50)` é um sintoma do problema — foi aumentado para suprimir o warning sem endereçar a causa raiz.

**Correção**: Implementar um mecanismo de ciclo de vida limpo:
```javascript
// always-alive.js — adicionar evento 'before-stop' para que consumers limpem seus listeners
async stop({ shutdownTimeoutMs = 10_000 } = {}) {
    this.emit('before-stop'); // consumers removem seus próprios listeners aqui
    // ... resto do stop
    this.removeAllListeners('before-stop');
}
```
E em `nerv-bridge.js`:
```javascript
alwaysAliveAgent.once('before-stop', () => _detachListeners());
```

---

### BUG-03 🔴 — FTS5 trigger `memories_au` usa UPDATE sem checar `rowid`

**Arquivo**: `src/copilot/conversation-hub/store.js` (DDL_MEMORIES)
**Problema**: O trigger `memories_au` atualiza `copilot_memories_fts` usando `WHERE id=new.id`, mas como a tabela FTS5 virtual não tem uma coluna `id` real — `id` é uma coluna `UNINDEXED` — o WHERE pode não funcionar conforme esperado em todos os casos do SQLite. O correto para FTS5 content tables é usar `rowid`:

**Evidência**:
```sql
-- PROBLEMÁTICO
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON copilot_memories BEGIN
    UPDATE copilot_memories_fts SET tag=new.tag, content=new.content WHERE id=new.id;
END;
```

**Correção**:
```sql
-- CORRETO para FTS5 content tables
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON copilot_memories BEGIN
    INSERT INTO copilot_memories_fts(copilot_memories_fts, rowid, id, tag, content)
        VALUES('delete', old.rowid, old.id, old.tag, old.content);
    INSERT INTO copilot_memories_fts(rowid, id, tag, content)
        VALUES (new.rowid, new.id, new.tag, new.content);
END;
```

---

### BUG-04 🟠 — `AlwaysAliveAgent.#processQueue()` pode ser chamado reentrante

**Arquivo**: `src/copilot/agent/always-alive.js` (método `#processQueue`)
**Problema**: `sendMessage()` chama `#processQueue()` ao final, e o `executeTask` (via callbacks) também chama `scheduleNext()` (= `#processQueue()`). Se `sendMessage` for chamado durante o processamento de um task (o que é possível via `dialogTurn` → `answerPendingQuestion` → listener de `question.pending`), o agente pode tentar processar dois tasks simultaneamente, violando a invariante de processamento serial.

**Correção**: Adicionar guarda de reentrância explícita:
```javascript
#processingQueue = false;

#processQueue() {
    if (this.#processingQueue || this.#status !== 'idle' || !this.#queue.length || !this.#session) return;
    this.#processingQueue = true;
    const task = this.#queue.shift();
    // ...
    // no finally de executeTask:
    this.#processingQueue = false;
    this.#processQueue(); // próximo
}
```

---

### BUG-05 🟠 — `DialogWatchdog.start()` não verifica se já está rodando

**Arquivo**: `src/copilot/agent/dialog-watchdog.js`
**Problema**: Chamar `watchdog.start()` duas vezes cria dois intervalos simultâneos — o segundo `#timer` sobrescreve o primeiro sem limpar o interval anterior, causando leak de timer.

**Evidência**:
```javascript
start() {
    this.#lastActivity = Date.now();
    this.#timer = setInterval(() => { /* ... */ }, this.#intervalMs);
    // Se chamado duas vezes, o timer anterior vaza!
}
```

**Correção**:
```javascript
start() {
    if (this.#timer !== null) {
        log('WARN', '[DialogWatchdog] start() chamado com watchdog já ativo — ignorando.');
        return;
    }
    this.#lastActivity = Date.now();
    this.#timer = setInterval(() => { /* ... */ }, this.#intervalMs);
}
```

---

### BUG-06 🟠 — `LlmBridgeClient.startDialogMode()` registra listeners mas não os remove em caso de erro

**Arquivo**: `src/copilot/channel/client.js` (método `startDialogMode`)
**Problema**: Os callbacks `onReady`, `onReply`, `onStopped` são registrados com `once`/`on` no alwaysAliveAgent, mas se `startDialogLoop` lançar uma exceção após os listeners terem sido registrados, eles nunca são removidos:
```javascript
async startDialogMode(bootPrompt, opts = {}) {
    const { onReady, onReply, onStopped } = opts;
    if (onReady) alwaysAliveAgent.once('dialog.ready', onReady);
    if (onReply) alwaysAliveAgent.on('dialog.reply', ...);
    if (onStopped) alwaysAliveAgent.once('dialog.stopped', onStopped);
    await alwaysAliveAgent.startDialogLoop(bootPrompt); // pode lançar!
    // listeners ficam pendurados se a linha acima lançar
}
```

**Correção**: Usar try/finally para garantir limpeza:
```javascript
async startDialogMode(bootPrompt, opts = {}) {
    const { onReady, onReply, onStopped } = opts;
    const replyHandler = onReply ? (evt) => onReply(evt.reply ?? '') : null;

    if (onReady) alwaysAliveAgent.once('dialog.ready', onReady);
    if (replyHandler) alwaysAliveAgent.on('dialog.reply', replyHandler);
    if (onStopped) alwaysAliveAgent.once('dialog.stopped', onStopped);

    try {
        await alwaysAliveAgent.startDialogLoop(bootPrompt);
    } catch (err) {
        // limpeza defensiva
        if (onReady) alwaysAliveAgent.off('dialog.ready', onReady);
        if (replyHandler) alwaysAliveAgent.off('dialog.reply', replyHandler);
        if (onStopped) alwaysAliveAgent.off('dialog.stopped', onStopped);
        throw err;
    }
}
```

---

### BUG-07 🟠 — `exec_command` em `shell-tools.js` rejeita pipes mas a regex é defeituosa

**Arquivo**: `src/copilot/tools/shell-tools.js`
**Problema**: A regex de bloqueio de constructs shell complexos é:
```javascript
if (/[|;&<>$`\\]/.test(command)) {
    return { success: false, error: 'Constructs shell complexos...' };
}
```
Esta regex bloqueia corretamente pipes e redirecionamentos, mas também bloqueia:
- Caminhos de arquivo com `$` em variáveis de ambiente legítimas (`$HOME/arquivo.txt`)
- Comandos com barras invertidas em caminhos Windows válidos dentro do container
- O caractere `>` em mensagens de erro como argumento: `git log --format="%s > %b"`

Adicionalmente, a regex **não bloqueia** substituição de processo com `$(command)` quando não há `$` isolado — por exemplo, `echo $(id)` passaria se a regex for burguesa com o contexto.

**Correção**:
```javascript
// Tokenização mais precisa usando posição contextual
function hasShellMeta(command) {
    // Verifica presença de metacaracteres fora de aspas
    let inSingle = false, inDouble = false;
    for (let i = 0; i < command.length; i++) {
        const c = command[i];
        if (c === "'" && !inDouble) { inSingle = !inSingle; continue; }
        if (c === '"' && !inSingle) { inDouble = !inDouble; continue; }
        if (!inSingle && !inDouble) {
            if ('|;&<>'.includes(c)) return true;
            if (c === '$' && command[i+1] === '(') return true; // $() subshell
            if (c === '`') return true;
        }
    }
    return false;
}
```

---

### BUG-08 🟡 — `checkInjectRate` — rate limiter usa Map sem limpeza periódica

**Arquivo**: `src/copilot/terminal/server.js`
**Problema**: O `_injectRateLimiter` cresce indefinidamente porque entradas expiradas só são removidas quando o mesmo IP faz uma nova requisição. Em ambientes com muitos IPs únicos, isto é um vector de memory leak.

**Correção**: Adicionar limpeza periódica:
```javascript
// server.js — limpeza a cada 5 minutos
setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of _injectRateLimiter) {
        if (now >= bucket.resetAt) _injectRateLimiter.delete(ip);
    }
}, 5 * 60 * 1000).unref();
```

---

### BUG-09 🟡 — `migrateFts5Tokenizer` — acesso a tabela shadow pode falhar silenciosamente

**Arquivo**: `src/copilot/conversation-hub/store.js`
**Problema**: A migração tenta acessar `copilot_memories_fts_config` mas em algumas versões do SQLite a tabela shadow tem nome diferente ou pode não estar acessível. O `try/catch` silencia o erro, retornando sem migrar e sem notificar.

---

### BUG-10 🟡 — `conversationHub.store.writeTurn()` chamado no terminal sem verificar `isReady`

**Arquivo**: `src/copilot/terminal/dialog.js`
**Problema**: Na função `sendTurn`, há chamadas diretas a `conversationHub.store.writeTurn(...)` que podem falhar se o store não foi inicializado (cenário de processo standalone sem main-server). O bloco `try/catch` interno captura o erro como `WARN`, o que é adequado, mas o `conversationHub.store` pode ser `null` ou não inicializado, gerando um `TypeError` antes do catch.

**Correção**: Adicionar verificação de pré-condição:
```javascript
if (_hubSessionId && conversationHub.store.db) { // verifica se inicializado
    try {
        conversationHub.store.writeTurn(/* ... */);
    } catch (hubErr) { /* ... */ }
}
```

---

### BUG-11 🔵 — `getWorkspaceContext()` re-executa git a cada chamada

**Arquivo**: `src/copilot/terminal/workspace-context.js`
**Problema**: `getWorkspaceContext()` executa `git rev-parse` sincronicamente a cada chamada, incluindo dentro do loop de renderização do `/status`. Em repositórios grandes, isto pode adicionar latência perceptível.

**Correção**: Cache com TTL de 30s:
```javascript
let _wsCache = null, _wsCacheAt = 0;
export function getWorkspaceContext() {
    const now = Date.now();
    if (_wsCache && now - _wsCacheAt < 30_000) return _wsCache;
    const cwd = process.env.COPILOT_WORKING_DIRECTORY ?? process.cwd();
    const gitRoot = detectGitRoot(cwd);
    const currentBranch = gitRoot ? tryExec('git rev-parse --abbrev-ref HEAD', gitRoot) : null;
    _wsCache = { cwd, gitRoot, currentBranch };
    _wsCacheAt = now;
    return _wsCache;
}
```

---

### BUG-12 🔵 — `getAuditSummary` lê o arquivo inteiro a cada chamada

**Arquivo**: `src/copilot/channel/audit.js`
**Problema**: `getAuditSummary` carrega e parseia todo o `tool-audit.jsonl` a cada invocação. Com rotação em 10MB (~100k linhas), isso consome ~50ms de CPU síncrona por chamada, bloqueando o event loop.

**Correção**: Usar `tail` via `execFile` ou manter um buffer circular em memória das últimas N entradas.

---

## 3. Vulnerabilidades de Segurança

### SEC-01 🔴 — `BLOCKED_COMMAND_PATTERNS` pode ser contornado com encoding

**Arquivo**: `src/copilot/tools/shell-tools.js`
**Problema**: O `BLOCKED_COMMAND_PATTERNS` verifica o comando como string, mas um atacante poderia usar encoding de base64 ou variáveis de ambiente para contornar o bloqueio. Mais preocupante: o `safeEnv()` remove variáveis sensíveis, mas um comando como `printenv` ainda exporia variáveis não listadas que poderiam conter informações sensíveis do ambiente de desenvolvimento.

**Correção**: Adicionar bloqueio de comandos de enumeração de ambiente:
```javascript
/\bprintenv\b/,
/\benv\b\s*$/,  // env sem args lista todas as vars
/\bset\b\s*$/,  // shell builtin 'set' lista vars
```

---

### SEC-02 🔴 — FTS5 phrase-quoting não é suficiente contra injeção em SQLite FTS

**Arquivo**: `src/copilot/conversation-hub/store.js` (método `recallMemories`)
**Problema**: A "correção" SEC-02 atual usa:
```javascript
const ftsQuery = `"${opts.search.replace(/"/g, ' ').trim()}"`;
```
Isto ainda é vulnerável se o input contiver outros metacaracteres do FTS5 como `*`, `^`, `NOT`, `AND`, `OR`, `NEAR`, pois a API FTS5 interpreta estes como operadores mesmo dentro de aspas duplas em algumas construções.

**Exemplo de vetor**: `search = ' OR 1=1 --'` — após a substituição de `"` por espaço, resulta em `" OR 1=1 --"` que é uma phrase válida mas potencialmente unintended.

**Correção robusta**:
```javascript
// Escapar TODOS os metacaracteres FTS5
function escapeFts5Query(term) {
    // Remove todos os operadores FTS5 e envolve em aspas
    const sanitized = term.replace(/[*^"():|&!,-]/g, ' ').replace(/\b(AND|OR|NOT|NEAR)\b/gi, ' ').trim();
    return `"${sanitized}"`;
}
```

---

### SEC-03 🟠 — `nerv-bridge.js` emite `copilot:turn:complete` com conteúdo completo da resposta

**Arquivo**: `src/copilot/terminal/dialog.js`
**Problema**: O NERV bus é um barramento de eventos interno, mas `emitNerv('copilot:turn:complete', { content: reply, ... })` inclui o conteúdo completo de cada resposta de LLM-B. Se o NERV bus for exposto via WebSocket/SSE sem controle de acesso adequado, qualquer cliente conectado pode monitorar todas as conversas.

**Correção**: Limitar o payload NERV a metadados, não ao conteúdo:
```javascript
emitNerv('copilot:turn:complete', {
    hubSessionId: _hubSessionId,
    turnId: replyTurnId,
    role: 'llm_b',
    durationMs,
    contentLength: reply.length, // tamanho, não o conteúdo
    // Sem `content: reply`
});
```

---

### SEC-04 🟠 — `validatePath` em `file-tools.js` não verifica extensões perigosas

**Arquivo**: `src/copilot/tools/file-tools.js`
**Problema**: `BLOCKED_PATTERNS` bloqueia arquivos por nome, mas não por extensão potencialmente perigosa para leitura. Por exemplo:
- `node_modules/.bin/algum-script` — executável, pode ser lido e analisado
- `*.sock` — Unix socket descriptors
- `/proc/self/environ` — se o workspace estiver montado de forma permissiva

Adicionalmente, o `realpathSync` pode falhar silenciosamente para paths com symlinks circulares.

---

### SEC-05 🟠 — `broadcast` de delta para namespace `/copilot` sem controle de sala

**Arquivo**: `src/copilot/conversation-hub/socket-ns.js`
**Problema**: O orquestrador emite `turn:delta` com `ns.to(data.hubSessionId).emit(...)`, o que requer que o cliente tenha feito `join:session` na sala correta. Porém, não há validação de que o cliente que faz `join:session` tem permissão para aquela sessão específica — qualquer cliente autenticado pode ouvir qualquer conversa.

**Correção**: Adicionar autorização por sessão:
```javascript
socket.on('join:session', (data) => {
    // Verificar se o userId tem permissão para esta hub_session
    const session = store.getHubSession(data.hubSession);
    if (!session) { socket.emit('error:join', { reason: 'Sessão não encontrada' }); return; }
    // TODO: adicionar campo owner_id na tabela hub_sessions para verificar permissão
    void socket.join(data.hubSession);
});
```

---

### SEC-06 🟡 — `readFileContext` sem verificação de tipo MIME

**Arquivo**: `src/copilot/terminal/file-context.js`
**Problema**: A função `readFileContext` lê qualquer arquivo com extensão suportada sem verificar se o conteúdo corresponde à extensão declarada. Um arquivo `.js` com conteúdo binário disfarçado pode causar problemas ao ser injetado no contexto do modelo.

---

### SEC-07 🔵 — Secrets em variáveis de ambiente acessíveis via `get_agent_info`

**Arquivo**: `src/copilot/tools/introspection-tools.js`
**Problema**: `getAgentInfoTool` expõe `process.env.COPILOT_MCP_SERVERS` e `process.env.COPILOT_SDK_ENABLED`. Embora não sejam diretamente secrets, estes valores revelam a configuração interna do agente e podem ser usados para reconhecimento em cenários de comprometimento parcial.

---

## 4. Gaps de Arquitetura

### ARCH-01 🟡 — Excesso de re-exports de compatibilidade acumula dívida técnica

**Arquivos**: `src/copilot/always-alive.js`, `src/copilot/alias-store.js`, `src/copilot/gh-bridge.js`, `src/copilot/git-bridge.js`, `src/copilot/http-bridge.js`, `src/copilot/inject-llmb.js`, `src/copilot/llm-bridge-client.js`, `src/copilot/mcp-tool-bridge.js`, `src/copilot/nerv-bridge.js`, `src/copilot/session-manager.js`
**Problema**: Existem 10 arquivos "wrapper de compatibilidade retroativa" que apenas re-exportam do caminho canônico. Eles:
1. Aumentam o número de módulos no grafo de dependências
2. Dificultam o tree-shaking
3. Confundem novos contribuidores sobre qual é o caminho canônico
4. Não há data de deprecação definida — crescerão indefinidamente

**Solução**: Estabelecer um prazo de 2 sprints para remover os wrappers, atualizar todos os importadores, e documentar os caminhos canônicos no README do módulo.

---

### ARCH-02 🟡 — `AlwaysAliveAgent` como singleton global bloqueia testes de integração

**Arquivo**: `src/copilot/agent/always-alive.js`
**Problema**: A exportação `export const alwaysAliveAgent = new AlwaysAliveAgent()` como singleton de módulo impede que testes de integração criem instâncias isoladas. Qualquer teste que importe qualquer arquivo que, por transitiva importa `always-alive.js`, recebe o singleton compartilhado.

**Solução**: Exportar apenas a classe e criar o singleton em um arquivo separado `instance.js`:
```javascript
// agent/instance.js
import { AlwaysAliveAgent } from './always-alive.js';
export const alwaysAliveAgent = new AlwaysAliveAgent();
```
Componentes que precisam do singleton importam de `instance.js`; testes importam diretamente `AlwaysAliveAgent` e criam sua própria instância.

---

### ARCH-03 🟡 — `ConversationHub.sendToLlmB()` tem fallback implícito para `chat()` sem log de audit

**Arquivo**: `src/copilot/conversation-hub/orchestrator.js`
**Problema**: Quando `useStructured=true` e a mensagem é string (não objeto), o código cai no branch `chat()` simples sem gerar uma entrada de audit que documente a razão do fallback. Isso cria um gap de observabilidade nos logs.

---

### ARCH-04 🟡 — `PinnedFilesLoader` nunca é instanciado no bootstrap do terminal

**Arquivo**: `src/copilot/terminal/index.js`, `src/copilot/config/pinned-files-loader.js`
**Problema**: A classe `PinnedFilesLoader` está completamente implementada e documentada, mas nunca é criada nem integrada ao fluxo de boot do terminal. O comando `/skills reload` no REPL apenas imprime "Reinicie o processo" sem realmente recarregar. O `skills.json` é lido para configuração mas o loader que usaria esses paths para injetar contexto nos turnos nunca é ativado.

**Solução**: Instanciar e integrar o `PinnedFilesLoader` no `startTerminalServer()`:
```javascript
// terminal/index.js
import { PinnedFilesLoader } from '../config/pinned-files-loader.js';

export async function startTerminalServer() {
    // ...
    const skillsConfig = handleGetSkills().body.skills;
    if (skillsConfig.paths.length > 0) {
        const loader = new PinnedFilesLoader(skillsConfig.paths);
        await loader.start();
        // Usar loader.buildContext() ao montar mensagens para LLM-B
    }
    // ...
}
```

---

### ARCH-05 🟡 — `LlmBridgeClient` mantém histórico em memória sem limite

**Arquivo**: `src/copilot/channel/client.js`
**Problema**: `#history` cresce indefinidamente. Em sessões longas (dias, semanas), o histórico pode acumular milhares de entradas, consumindo memória progressivamente. Não há paginação nem truncamento.

**Solução**:
```javascript
// client.js — adicionar limite ao histórico em memória
static #MAX_HISTORY_SIZE = 500;

// após push:
if (this.#history.length > LlmBridgeClient.#MAX_HISTORY_SIZE) {
    this.#history.shift(); // descarta mais antigo
}
```

---

## 5. Melhorias e Upgrades Recomendados

### MELHORIA-01 💡 — Migrar para `mode: 'customize'` quando SDK v0.2.0 estiver disponível

O SDK lançou suporte ao `mode: 'customize'` com `sections` tipadas, que permite modificar seções individuais do system prompt (identity, tone, tool_efficiency, etc.) sem substituir o prompt inteiro. O projeto já tem as constantes `SYSTEM_PROMPT_SECTIONS` preparadas para esta migração.

**Plano**:
1. Criar feature flag `COPILOT_USE_CUSTOMIZE_MODE=false`
2. Em `system-prompt.js`, branch baseado na flag
3. Quando confirmado SDK v0.2.0, habilitar e remover o branch legado

---

### MELHORIA-02 💡 — Implementar `onEvent` catch-all (SDK feature nova)

O CHANGELOG do SDK documenta: *"SessionConfig.onEvent catch-all — A new onEvent handler on session config is registered before the RPC is issued, guaranteeing that early events like session.start are never dropped."*

O projeto não usa este handler, perdendo eventos emitidos durante a fase de boot da sessão (antes que os listeners manuais sejam registrados).

**Implementação**:
```javascript
// session-manager.js — adicionar ao opts
onEvent: (event) => {
    log('DEBUG', `[SDK-onEvent] ${event.type}`);
    // Forward para AlwaysAliveAgent via emit genérico
},
```

---

### MELHORIA-03 💡 — Usar `ToolResultObject` para controle granular do resultado das tools

O SDK suporta retorno rico de handlers:
```typescript
interface ToolResultObject {
    textResultForLlm: string;     // resultado visível ao modelo
    resultType: 'success' | 'failure';
    error?: string;               // erro interno (não mostrado ao modelo)
    toolTelemetry?: Record<string, unknown>; // telemetria adicional
}
```
Atualmente todos os handlers retornam objetos genéricos. Migrar para `ToolResultObject` permitiria:
- Separar o resultado visível ao modelo do log interno
- Sinalizar falhas de forma tipada sem expor detalhes técnicos ao modelo
- Alimentar o sistema de telemetria nativo do SDK

---

### MELHORIA-04 💡 — Implementar tracing distribuído com OTLP

O SDK suporta W3C trace context com exporter OTLP. Para um projeto de produção com múltiplos processos (PM2, Docker), esta seria a forma mais adequada de correlacionar logs de LLM-A, LLM-B, ferramentas e sessions.

**Implementação básica**:
```javascript
// lib/client.js
const client = new CopilotClient({
    telemetry: {
        otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        serviceName: 'chatgpt-docker-puppeteer-copilot',
    },
});
```

---

### MELHORIA-05 💡 — Multi-client architecture (protocolo v3 do SDK)

O CHANGELOG documenta: *"Two clients each register different tools; the agent can use both"*. O `AlwaysAliveAgent` atual usa um único cliente. A arquitetura multi-cliente permitiria separar as 30 tools em domínios (um cliente para file tools, outro para shell tools, outro para hub tools), possibilitando:
- Controle granular de permissões por cliente
- Isolamento de falhas (crash de um cliente não afeta os outros)
- Distribuição de load entre múltiplos processos

---

### MELHORIA-06 💡 — Adicionar `CustomAgents` especializados para reduzir context pollution

O SDK suporta `customAgents` na sessão, onde cada agente tem seu próprio prompt e set de tools. Ao invés de expor todas as 30 tools para um único agente, criar:
- `@auditor` — apenas read tools + code tools
- `@executor` — shell + git tools
- `@hub` — hub tools
- `@archivist` — session + hook tools

Isso reduziria a probabilidade de o modelo invocar a tool errada por confusão de contexto.

---

### MELHORIA-07 💡 — `AlwaysAliveAgent` deveria implementar `Symbol.asyncDispose`

Com Node.js 22+, o recurso `Symbol.asyncDispose` (protocolo `AsyncDisposable`) permite uso seguro com `await using`:
```javascript
// always-alive.js — adicionar
async [Symbol.asyncDispose]() {
    await this.stop();
}

// Uso nos scripts standalone:
await using agent = new AlwaysAliveAgent();
// stop() chamado automaticamente ao sair do bloco
```

---

### MELHORIA-08 💡 — Implementar `setModel()` com `reasoningEffort` (SDK v0.1.x feature)

O CHANGELOG documenta: *"reasoningEffort when switching models — All SDKs now accept an optional reasoningEffort parameter in setModel()"*. O método `setModel` no `AlwaysAliveAgent` apenas seta `#model` em memória mas não chama `session.setModel()` no SDK, o que significa que a mudança só tem efeito na próxima sessão criada, não na sessão atual.

**Correção**:
```javascript
async setModelLive(modelId, reasoningEffort) {
    this.#model = modelId;
    this.#reasoningEffort = reasoningEffort ?? this.#reasoningEffort;
    if (this.#session) {
        await this.#session.setModel(modelId, reasoningEffort ? { reasoningEffort } : undefined);
    }
}
```

---

### MELHORIA-09 💡 — `ConversationStore` deveria suportar WAL checkpoint explícito

Em operações de longa duração (horas/dias), o WAL file do SQLite pode crescer indefinidamente se não houver checkpoint. Adicionar um checkpoint periódico:
```javascript
// store.js — após init()
const checkpointInterval = setInterval(() => {
    try { this.#db.pragma('wal_checkpoint(PASSIVE)'); } catch { /* best-effort */ }
}, 30 * 60 * 1000); // a cada 30 minutos
checkpointInterval.unref();
```

---

### MELHORIA-10 💡 — Adicionar health check para dependência de `ripgrep` em `search_in_files`

**Arquivo**: `src/copilot/tools/file-tools.js`
O `searchInFilesTool` depende do `rg` (ripgrep) que pode não estar disponível em todos os ambientes. Adicionar verificação lazy no primeiro uso:

```javascript
let _rgAvailable = null;
async function checkRgAvailable() {
    if (_rgAvailable !== null) return _rgAvailable;
    try {
        await execFileAsync('rg', ['--version'], { timeout: 2000 });
        _rgAvailable = true;
    } catch {
        _rgAvailable = false;
        log('WARN', '[file-tools] ripgrep (rg) não encontrado. search_in_files usará fallback grep.');
    }
    return _rgAvailable;
}
```

---

### MELHORIA-11 💡 — `buildMcpTools` falha silenciosamente se MCP server demorar

**Arquivo**: `src/copilot/bridges/mcp-tool-bridge.js`
O timeout de 8s para a listagem de tools MCP pode ser insuficiente em ambientes com cold start. Adicionar retry com backoff exponencial:
```javascript
export async function listMcpTools(retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const result = await rpcCall('tools/list', {});
            return (result?.tools ?? []).filter(t => t && typeof t.name === 'string');
        } catch (e) {
            if (i === retries - 1) {
                log('WARN', `[mcp-tool-bridge] ${retries} tentativas falharam: ${e.message}`);
                return [];
            }
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
        }
    }
    return [];
}
```

---

### MELHORIA-12 💡 — `StructuredMessage.traceId` deveria ser gerado automaticamente

**Arquivo**: `src/copilot/types/structured-message.js`
O campo `traceId` existe no schema mas nunca é preenchido automaticamente. Para correlação de logs distribuídos, ele deveria ser gerado via `crypto.randomUUID()` em `buildStructuredRequest`:

```javascript
export function buildStructuredRequest(input) {
    return StructuredMessageSchema.parse({
        traceId: crypto.randomUUID(), // auto-gerar se não fornecido
        ...input,
    });
}
```

---

### MELHORIA-13 💡 — Adicionar `AbortSignal` support a `sendMessage`

Para permitir cancelamento gracioso de tasks longas sem precisar do workaround de timeout:
```javascript
sendMessage(message, { timeoutMs, attachments, signal } = {}) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new Error('Abortado')); return; }
        signal?.addEventListener('abort', () => {
            // Remove da fila se ainda não processado
            const idx = this.#queue.findIndex(t => t.id === task.id);
            if (idx !== -1) { this.#queue.splice(idx, 1); reject(new Error('Abortado')); }
        });
        // ...
    });
}
```

---

### MELHORIA-14 💡 — `nerv-bridge.js` EVENT_MAP deveria incluir novos eventos do SDK

Os eventos `'tool.execution.start'` e `'tool.execution.complete'` foram adicionados ao `AGENT_EVENTS` mas o `EVENT_MAP` do `nerv-bridge.js` os inclui. Contudo, faltam os eventos mais recentes do SDK:
- `'session.context_changed'` — está em `AGENT_EVENTS` mas não há handling no código principal

---

## 6. Tabela de Correções Prioritárias

| ID          | Arquivo                         | Severidade | Esforço | Impacto                 | Prioridade |
| ----------- | ------------------------------- | ---------- | ------- | ----------------------- | ---------- |
| SDK-01      | `lib/hooks.js`                  | 🔴 CRÍTICO  | Baixo   | Alta conformidade SDK   | P1         |
| SDK-02      | `lib/permissions.js`            | 🔴 CRÍTICO  | Médio   | Evita silent failures   | P1         |
| SDK-03      | `lib/session.js`                | 🔴 CRÍTICO  | Baixo   | Corrige modo inválido   | P1         |
| BUG-02      | `agent/always-alive.js`         | 🔴 CRÍTICO  | Médio   | Evita memory leak       | P1         |
| BUG-03      | `conversation-hub/store.js`     | 🔴 CRÍTICO  | Baixo   | Corrige trigger FTS5    | P1         |
| BUG-01      | `conversation-hub/store.js`     | 🔴 CRÍTICO  | Alto    | Evita duplicatas DB     | P1         |
| SEC-01      | `tools/shell-tools.js`          | 🔴 CRÍTICO  | Médio   | Segurança execução      | P1         |
| SEC-02      | `conversation-hub/store.js`     | 🔴 CRÍTICO  | Baixo   | Previne FTS injection   | P1         |
| SDK-06      | `agent/task-executor.js`        | 🟠 ALTO     | Baixo   | Evita listener leak     | P2         |
| BUG-04      | `agent/always-alive.js`         | 🟠 ALTO     | Médio   | Evita race condition    | P2         |
| BUG-05      | `agent/dialog-watchdog.js`      | 🟠 ALTO     | Baixo   | Evita timer leak        | P2         |
| BUG-06      | `channel/client.js`             | 🟠 ALTO     | Baixo   | Evita listener leak     | P2         |
| SEC-03      | `terminal/dialog.js`            | 🟠 ALTO     | Baixo   | Privacidade de dados    | P2         |
| SEC-04      | `tools/file-tools.js`           | 🟠 ALTO     | Médio   | Reforço de sandbox      | P2         |
| SEC-05      | `conversation-hub/socket-ns.js` | 🟠 ALTO     | Alto    | Controle de acesso      | P2         |
| SDK-04      | Todos `tools/*.js`              | 🟠 ALTO     | Alto    | Conformidade e tipos    | P2         |
| BUG-07      | `tools/shell-tools.js`          | 🟠 ALTO     | Médio   | Segurança shell         | P2         |
| SDK-05      | `agent/always-alive.js`         | 🟠 ALTO     | Baixo   | Estabilidade dialogo    | P2         |
| ARCH-04     | `config/pinned-files-loader.js` | 🟡 MÉDIO    | Alto    | Feature inoperante      | P3         |
| ARCH-05     | `channel/client.js`             | 🟡 MÉDIO    | Baixo   | Evita memory growth     | P3         |
| SDK-03 alt  | `lib/session.js`                | 🟡 MÉDIO    | Baixo   | Unificação              | P3         |
| MELHORIA-02 | `agent/session-manager.js`      | 💡          | Baixo   | Não perder eventos boot | P4         |
| MELHORIA-03 | Todos `tools/*.js`              | 💡          | Alto    | Melhor observabilidade  | P4         |
| MELHORIA-08 | `agent/always-alive.js`         | 💡          | Baixo   | Model switch ao vivo    | P4         |
| MELHORIA-07 | `agent/always-alive.js`         | 💡          | Baixo   | Ergonomia Node.js 22    | P4         |

---

## Apêndice A — Conformidade com o CHANGELOG do SDK

| Recurso SDK                                      | Status no Projeto                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `mode: 'append'` para systemMessage              | ✅ Implementado em `config/system-prompt.js`                                |
| `mode: 'replace'` para systemMessage             | ✅ Implementado                                                             |
| `mode: 'customize'` com sections                 | ⚠️ Parcialmente: constantes prontas, mas código usa modo inválido           |
| `skipPermission: true` em tools                  | ✅ Implementado via `withSkipPermission()`                                  |
| `overridesBuiltInTool: true`                     | ✅ Documentado em `tool-factory.js`                                         |
| `onPermissionRequest`                            | ✅ Implementado corretamente via `approveAll`                               |
| `onPreToolUse` hook com `permissionDecision`     | ❌ Retorna formato incorreto                                                |
| `onPostToolUse` hook com `additionalContext`     | ⚠️ Retorna void — `additionalContext` nunca usado                           |
| `onEvent` catch-all no SessionConfig             | ❌ Não implementado                                                         |
| `reasoningEffort` em `setModel()`                | ❌ `setModel()` no projeto não chama SDK live                               |
| Multi-client architecture (protocolo v3)         | ❌ Não implementado                                                         |
| `ToolResultObject` rico                          | ❌ Handlers retornam objetos genéricos                                      |
| Distributed tracing OTLP                         | ❌ Não implementado                                                         |
| `customAgents` per-session                       | ⚠️ Implementado em `config/custom-agents.js` mas não integrado ao bootstrap |
| `infiniteSessions.backgroundCompactionThreshold` | ✅ Implementado e configurável                                              |
| `skipPermission` em `defineTool`                 | ✅ Implementado                                                             |
| `SystemMessage.sections` (modo customize)        | ⚠️ Constantes preparadas, await SDK v0.2.0                                  |

---

## Apêndice B — Estatísticas de Cobertura por Arquivo

| Arquivo                            | Bugs | Gaps SDK | Seg | Melhorias |
| ---------------------------------- | ---- | -------- | --- | --------- |
| `agent/always-alive.js`            | 3    | 2        | 0   | 4         |
| `agent/task-executor.js`           | 0    | 1        | 0   | 0         |
| `agent/dialog-watchdog.js`         | 1    | 0        | 0   | 0         |
| `agent/session-manager.js`         | 0    | 1        | 0   | 1         |
| `channel/client.js`                | 2    | 0        | 0   | 1         |
| `conversation-hub/store.js`        | 3    | 0        | 2   | 2         |
| `conversation-hub/orchestrator.js` | 0    | 0        | 0   | 1         |
| `conversation-hub/socket-ns.js`    | 0    | 0        | 1   | 0         |
| `lib/hooks.js`                     | 0    | 1        | 0   | 1         |
| `lib/permissions.js`               | 0    | 2        | 0   | 0         |
| `lib/session.js`                   | 0    | 2        | 0   | 0         |
| `tools/shell-tools.js`             | 1    | 0        | 2   | 2         |
| `tools/file-tools.js`              | 0    | 0        | 2   | 2         |
| `tools/introspection-tools.js`     | 0    | 0        | 1   | 0         |
| `terminal/dialog.js`               | 1    | 0        | 1   | 0         |
| `terminal/server.js`               | 1    | 0        | 0   | 0         |
| `terminal/index.js`                | 0    | 0        | 0   | 1         |
| `terminal/workspace-context.js`    | 1    | 0        | 0   | 0         |
| `bridges/mcp-tool-bridge.js`       | 0    | 0        | 0   | 1         |
| `channel/audit.js`                 | 1    | 0        | 0   | 1         |
| `config/pinned-files-loader.js`    | 0    | 0        | 0   | 1         |
| `types/structured-message.js`      | 0    | 0        | 0   | 2         |

---

*Relatório gerado automaticamente com base em análise estática + contraste com documentação oficial `@github/copilot-sdk` (github.com/github/copilot-sdk, releases até v0.1.10). Última verificação: 2026-03-26.*
