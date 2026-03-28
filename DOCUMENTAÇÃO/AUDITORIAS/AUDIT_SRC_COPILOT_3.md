# Relatório de Auditoria — `src/copilot/`

> **Projeto**: `chatgpt-docker-puppeteer`
> **Módulo auditado**: `src/copilot/` (completo)
> **Data**: 2026-03-27
> **Auditor**: Claude Sonnet 4.6
> **Metodologia**: Leitura linha a linha cruzada com documentação oficial `@github/copilot-sdk` (npm, GitHub Docs, github/copilot-sdk README)
> **Baseline SDK**: `@github/copilot-sdk` Technical Preview — NodeJS SDK

---

## Índice

1. [Sumário Executivo](#1-sumário-executivo)
2. [Bugs Críticos](#2-bugs-críticos)
3. [Bugs de Alta Severidade](#3-bugs-de-alta-severidade)
4. [Não-conformidades com o SDK Oficial](#4-não-conformidades-com-o-sdk-oficial)
5. [Vulnerabilidades de Segurança](#5-vulnerabilidades-de-segurança)
6. [Problemas Arquiteturais](#6-problemas-arquiteturais)
7. [Gaps de Qualidade e Manutenibilidade](#7-gaps-de-qualidade-e-manutenibilidade)
8. [Propostas de Aprimoramento e Upgrade](#8-propostas-de-aprimoramento-e-upgrade)
9. [Tabela de Prioridades Consolidada](#9-tabela-de-prioridades-consolidada)

---

## 1. Sumário Executivo

A auditoria cobriu **99 arquivos** do módulo `src/copilot/`, abrangendo o agente `AlwaysAliveAgent`, o `ConversationHub`, 30+ custom tools, a camada de canal LLM-A ↔ LLM-B, o terminal permanente e toda a infraestrutura de API REST/SSE/Socket.io.

O módulo demonstra arquitetura sofisticada e cobertura funcional notável. Não obstante, foram identificados:

| Categoria                            | Contagem |
| ------------------------------------ | -------- |
| Bugs Críticos (blockers de produção) | 5        |
| Bugs de Alta Severidade              | 9        |
| Não-conformidades com SDK            | 4        |
| Vulnerabilidades de Segurança        | 6        |
| Problemas Arquiteturais              | 7        |
| Gaps de qualidade/manutenibilidade   | 11       |

Os itens mais urgentes são: (a) convenção de chamada incorreta de `log()` em `todo-tools.js` que derruba o agente em runtime; (b) `Atomics.wait()` no thread principal do Node.js dentro do `ConversationStore`, bloqueando o event loop inteiro; (c) incompatibilidade na resposta do `PermissionHandler` do hook `onPreToolUse` com a API real do SDK; (d) race condition no reconectar do `AlwaysAliveAgent` que registra tools duplicadas.

---

## 2. Bugs Críticos

### BUG-C01 — `todo-tools.js`: Chamada incorreta ao logger em todo arquivo

**Arquivo**: `src/copilot/tools/todo-tools.js`
**Severidade**: CRÍTICA — provoca `TypeError` em runtime derrubando o agente

**Problema**: O arquivo usa `log.info(msg)` em múltiplos handlers, mas o logger do projeto é uma função de assinatura `log(level, message)`. `log.info` é `undefined`.

```js
// ❌ ERRADO — ocorre em todo-tools.js em ~8 lugares
log.info(`[todo_create] Tarefa criada id=${id} ...`);
log.info(`[todo_update] Tarefa atualizada id=${args.id} ...`);
log.info(`[todo_set_status] Status alterado id=${args.id} ...`);
// etc.
```

**Consequência**: Qualquer invocação das tools `todo_create`, `todo_update`, `todo_set_status`, `todo_delete`, `todo_add_subtask`, `todo_bulk_update`, `todo_clear_completed`, `todo_import` causa `TypeError: log.info is not a function`, lançando uma exceção não capturada dentro do handler SDK e potencialmente derrubando a sessão.

**Correção**:

```js
// ✅ CORRETO — substitua TODAS as ocorrências em todo-tools.js
log('INFO', `[todo_create] Tarefa criada id=${id} ...`);
log('INFO', `[todo_update] Tarefa atualizada id=${args.id} ...`);
log('INFO', `[todo_set_status] Status alterado id=${args.id} ...`);
```

**Escopo da correção**: Busca global por `log.info(` e `log.warn(` e `log.error(` em `todo-tools.js`, substituindo por `log('INFO',`, `log('WARN',` e `log('ERROR',` respectivamente.

---

### BUG-C02 — `conversation-hub/store.js`: `Atomics.wait()` bloqueia o event loop do Node.js

**Arquivo**: `src/copilot/conversation-hub/store.js`, método `writeTurn()`
**Severidade**: CRÍTICA — congela o event loop inteiro durante retry de escrita SQLite

**Problema**: A lógica de retry com backoff para conflitos de `UNIQUE constraint` usa `Atomics.wait()` como `sleepSync`:

```js
// ❌ ERRADO — bloqueia o event loop principal
const sleepSync = (ms) =>
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
for (let attempt = 0; attempt < WRITE_MAX_RETRIES; attempt++) {
    try {
        return doWrite();
    } catch (err) {
        if (!isConstraint || attempt === WRITE_MAX_RETRIES - 1) throw err;
        sleepSync(RETRY_DELAYS_MS[attempt] ?? 5); // ← congela todo o processo
    }
}
```

`Atomics.wait()` no thread principal do Node.js está documentado como operação **inadmissível** — lança `TypeError: Cannot perform Atomics.wait on the main thread` no Node.js ≥ 16 em modo strict. Mesmo onde não lança exceção, congela completamente o event loop durante 5–40ms por retry, impedindo processamento de qualquer outra requisição, evento SSE ou tick de socket.io.

**Correção**: Substituir por lógica async com `setTimeout` promissificado, aproveitando que `writeTurn` pode ser tornado assíncrono (já é chamado em contextos async):

```js
// ✅ CORRETO
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async writeTurn(hubSessionId, opts) {
    const WRITE_MAX_RETRIES = 3;
    const RETRY_DELAYS_MS = [5, 15, 40];
    for (let attempt = 0; attempt < WRITE_MAX_RETRIES; attempt++) {
        try {
            return doWrite(); // doWrite permanece síncrono (better-sqlite3)
        } catch (err) {
            const isConstraint = err?.code === 'SQLITE_CONSTRAINT_UNIQUE'
                              || err?.code === 'SQLITE_CONSTRAINT';
            if (!isConstraint || attempt === WRITE_MAX_RETRIES - 1) throw err;
            await sleep(RETRY_DELAYS_MS[attempt] ?? 5);
        }
    }
}
```

**Atenção**: Como `writeTurn` torna-se `async`, todos os call sites (`orchestrator.js`, `dialog.js`) devem usar `await store.writeTurn(...)`.

---

### BUG-C03 — `always-alive.js`: Reconnect duplica registros de tools no ToolRegistry

**Arquivo**: `src/copilot/agent/always-alive.js`, método `#tryReconnect()`
**Severidade**: CRÍTICA — corrupção de estado em reconexões

**Problema**: O método `#tryReconnect()` chama `bootstrapTools(this.#toolsRegistry, this.#telemetry, mcpTools)` sem resetar `this.#toolsRegistry` antes. O `ToolRegistry` usa um `Map<name, entry>` — portanto `set()` substitui (não duplica). Porém, o array retornado por `bootstrapTools()` contém as tools **novamente**, e é passado a `initOrResumeSession()`. O SDK recebe um array com cada tool listada **duas vezes** (uma da sessão original, uma do reconectar), causando registros duplicados de tool calls no SDK.

```js
// ❌ ERRADO — no método #tryReconnect()
const tools = bootstrapTools(this.#toolsRegistry, this.#telemetry, mcpTools);
// this.#toolsRegistry já tem todas as tools da sessão inicial.
// bootstrapTools chama registerTools() novamente (sobrescreve o Map OK),
// mas retorna um novo array com TODAS as tools — dobrando o que vai para o SDK.
const { session } = await initOrResumeSession(this.#client, {
    tools, // ← SDK recebe tools duplicadas
    ...
});
```

**Correção**:

```js
// ✅ CORRETO — resetar registry antes de rebootstrap
this.#toolsRegistry = createRegistry();
this.#telemetry = createTelemetry(); // opcional: manter telemetria histórica
const tools = bootstrapTools(this.#toolsRegistry, this.#telemetry, mcpTools);
```

---

### BUG-C04 — `nerv-bridge.js`: Evento `'before-stop'` ausente de `AGENT_EVENTS`

**Arquivo**: `src/copilot/bridges/nerv-bridge.js` e `src/copilot/agent/events.js`
**Severidade**: CRÍTICA — listener registrado em evento não-gerenciado, causando memory leak

**Problema**: `nerv-bridge.js` mapeia o evento `'before-stop'` para o NERV:

```js
// Em nerv-bridge.js EVENT_MAP:
{ event: 'before-stop', actionCode: 'COPILOT_AGENT_BEFORE_STOP' },
```

Porém `'before-stop'` **não está em `AGENT_EVENTS`** (`src/copilot/agent/events.js`). Isso tem dois efeitos:

1. `listenerDiagnostics()` em `always-alive.js` itera `AGENT_EVENTS` — o listener de `'before-stop'` não aparece no diagnóstico, tornando-o invisível para monitoramento.
2. Em `stop()`, o agent executa `this.removeAllListeners('before-stop')` após emitir o evento — mas o listener do nerv-bridge, registrado via `alwaysAliveAgent.on('before-stop', handler)` no `_attachListeners()`, nunca é removido no `_detachListeners()` (que itera `EVENT_MAP` mas o removeAllListeners do agent já limpou). Isso cria um desequilíbrio no fluxo de limpeza.

**Correção**:

```js
// Em src/copilot/agent/events.js — adicionar ao array AGENT_EVENTS:
'before-stop',

// Verificar e garantir que _detachListeners() em nerv-bridge.js remove corretamente
// este listener ANTES do stop() do agent (que chama removeAllListeners).
```

---

### BUG-C05 — `conversation-hub/orchestrator.js`: `getTurn()` pode retornar `null`, silenciando `turnNumber`

**Arquivo**: `src/copilot/conversation-hub/orchestrator.js`, método `#executeSendToLlmB()`
**Severidade**: CRÍTICA — persiste turn com `turn_number: 0` corrompendo sequência histórica

**Problema**:

```js
const llmATurnId = this.#store.writeTurn(hubSessionId, { role: 'llm_a', ... });
const llmATurn = this.#store.getTurn(llmATurnId);
const turnNumber = llmATurn?.turn_number ?? 0; // ← fallback 0 silencioso
```

Se `writeTurn()` lançar (constraint, disco cheio, lock) e o erro for engolido na retry logic, `llmATurnId` pode ser `-1` (ver o `/* c8 ignore next */ return -1;` no final do loop de retry). `getTurn(-1)` retorna `null`, `turnNumber` fica `0`, e o evento `'turn:sent'` é emitido com `turnNumber: 0`. O mesmo problema ocorre para `llmBTurnId`.

**Correção**:

```js
const llmATurnId = this.#store.writeTurn(hubSessionId, { role: 'llm_a', ... });
if (llmATurnId === -1) {
    throw new Error('[HubOrchestrator] writeTurn falhou irrecuperavelmente (llmATurnId=-1)');
}
const llmATurn = this.#store.getTurn(llmATurnId);
const turnNumber = llmATurn?.turn_number;
if (!turnNumber) {
    throw new Error(`[HubOrchestrator] Turno ${llmATurnId} não encontrado após writeTurn`);
}
```

---

## 3. Bugs de Alta Severidade

### BUG-H01 — `tools/shell/index.js`: Tokenizador ingênuo quebra comandos com argumentos entre aspas

**Arquivo**: `src/copilot/tools/shell/index.js`, handler de `exec_command`
**Severidade**: ALTA — executa executável errado em muitos casos de uso legítimos

**Problema**: O código usa `command.trim().split(/\s+/)` para separar o executável dos argumentos:

```js
// ❌ ERRADO — não respeita aspas
const parts = command.trim().split(/\s+/);
const [executable, ...execArgs] = parts;
```

Qualquer comando com argumentos entre aspas falha silenciosamente ou produz comportamento errado:

```bash
# Usuário envia:
git log --pretty=format:"%h %s" -10
# O split produz: ['git', 'log', '--pretty=format:"%h', '%s"', '-10']
# execFile recebe o argumento malformado --pretty=format:"%h
```

O `hasShellMetaOutsideQuotes()` bloqueia `|`, `;`, `&`, etc. — mas o tokenizador subsequente ainda falha com aspas que NÃO contêm metacaracteres.

**Correção**: Usar um tokenizador que respeite aspas simples e duplas:

```js
// ✅ CORRETO — tokenizador com suporte a aspas
function tokenize(command) {
    const args = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < command.length; i++) {
        const c = command[i];
        if (c === "'" && !inDouble) { inSingle = !inSingle; continue; }
        if (c === '"' && !inSingle) { inDouble = !inDouble; continue; }
        if (/\s/.test(c) && !inSingle && !inDouble) {
            if (current) { args.push(current); current = ''; }
            continue;
        }
        current += c;
    }
    if (current) args.push(current);
    return args;
}
const [executable, ...execArgs] = tokenize(command.trim());
```

---

### BUG-H02 — `lib/hooks.js`: `permissionDecision` usa valor errado conforme SDK oficial

**Arquivo**: `src/copilot/lib/hooks.js`
**Severidade**: ALTA — hooks `onPreToolUse` potencialmente ignorados pelo SDK

**Problema**: O handler construído em `createHooks()` retorna:

```js
return { permissionDecision: 'deny', additionalContext: '...' }; // 'allow' ou 'deny'
```

Porém a documentação oficial do SDK mostra que `onPreToolUse` deve retornar `permissionDecision: "allow" | "deny" | "ask"`. Isso não é um bug em si. O bug real está na ausência de suporte para `"ask"` — o factory `createHooks` nunca gera `"ask"`, impossibilitando o padrão de interação que pede aprovação do usuário antes de executar ferramentas de alto risco.

Adicionalmente, `createDenyAllHooks()` retorna `{ permissionDecision: 'deny', permissionDecisionReason: '...' }`. O campo `permissionDecisionReason` **não existe** na API do SDK — o campo correto é `additionalContext`.

**Correção**:

```js
// Em createDenyAllHooks():
const denyHandler = async () => ({
    permissionDecision: 'deny',
    additionalContext: 'Ferramentas desabilitadas nesta sessão.', // ← não 'permissionDecisionReason'
});
```

---

### BUG-H03 — `llm-a-conversation.mjs`: Usa import path depreciado

**Arquivo**: `src/copilot/llm-a-conversation.mjs`
**Severidade**: ALTA — pode quebrar em refactorings futuros, junta dívida técnica

**Problema**:

```js
import { LlmBridgeClient } from './bridges/llm-bridge-client.js';
```

`src/copilot/bridges/llm-bridge-client.js` é declarado como `@deprecated` e é apenas um re-export para `src/copilot/channel/client.js`. Arquivos de script standalone que servem como documentação viva devem usar o caminho canônico.

**Correção**:

```js
import { LlmBridgeClient } from '../channel/client.js';
// ou via alias:
import { LlmBridgeClient } from '#copilot/channel';
```

---

### BUG-H04 — `agent/events.js`: Evento `'session.context_changed'` declarado mas nunca emitido

**Arquivo**: `src/copilot/agent/events.js` e `always-alive.js`
**Severidade**: ALTA — AGENT_EVENTS contém evento fantasma; listeneres externos nunca disparam

**Problema**: `AGENT_EVENTS` inclui `'session.context_changed'`, e `bridge-stream.js` cria listener SSE para ele. Porém nenhum lugar em `always-alive.js` emite esse evento. Clientes SSE que subscrevem `session.context_changed` nunca recebem dados.

**Correção**: Ou emitir o evento quando aplicável (ex.: após `session.setModel()` ou mudança de workingDirectory), ou remover de `AGENT_EVENTS` e de `bridge-stream.js`.

---

### BUG-H05 — `channel/client.js`: `dialogTurn()` não propaga streaming delta para `onDelta`

**Arquivo**: `src/copilot/channel/client.js`, método `dialogTurn()`
**Severidade**: ALTA — streaming visual quebrado no modo diálogo

**Problema**: No modo dialog loop, respostas chegam via evento `'dialog.reply'`, não via `'task.delta'`. O método `dialogTurn()` chama `alwaysAliveAgent.sendDialogTurn()` e aguarda a string de resposta completa. Não há mecanismo para fornecer chunks parciais ao chamador — a opção `onDelta` do `startDialogMode()` captura `dialog.reply` completo, não chunks individuais.

O usuário vê o terminal congelado durante todo o tempo de geração de resposta, sem feedback de progresso.

**Correção**: Registrar um listener temporário em `'task.delta'` ou `'dialog.reply'` parcial (se o SDK os emitir durante o ask_user). Alternativamente, emitir pseudo-chunks via polling de status:

```js
// Em dialogTurn(), registrar listener de task.delta antes de sendDialogTurn:
const onDeltaTemp = opts?.onDelta
    ? (evt) => { if (evt.chunk) opts.onDelta(evt.chunk); }
    : null;
if (onDeltaTemp) alwaysAliveAgent.on('task.delta', onDeltaTemp);
try {
    const reply = await alwaysAliveAgent.sendDialogTurn(message, { timeout });
    return reply;
} finally {
    if (onDeltaTemp) alwaysAliveAgent.off('task.delta', onDeltaTemp);
}
```

---

### BUG-H06 — `file-tools.js`: Symlink traversal em diretórios pai

**Arquivo**: `src/copilot/tools/file-tools.js`, função `validatePath()`
**Severidade**: ALTA — bypass de contenção ao workspace

**Problema**: O código usa `realpathSync()` para resolver symlinks, mas falha silenciosamente para caminhos inexistentes e usa o path não-resolvido como fallback:

```js
let realResolved = resolved;
try {
    realResolved = realpathSync(resolved);
} catch {
    // Arquivo não existe ainda — usar o caminho resolvido sem symlinks
}
```

Se o diretório PAI de um novo arquivo a ser criado contém um symlink que aponta para fora do workspace, `resolved` parecerá dentro do workspace, mas a escrita real irá para fora. Ex.:

```
/workspaces/proj/evil -> /etc/
# validatePath('/workspaces/proj/evil/passwd')
# → resolved = '/workspaces/proj/evil/passwd'
# → realpathSync lança (passwd não existe ainda)
# → usa resolved → relatve = 'evil/passwd' → não começa com '..' → APROVADO
# → createFileTool escreve em /etc/passwd
```

**Correção**: Resolver o symlink do **diretório pai** mesmo que o arquivo ainda não exista:

```js
function validatePath(filePath) {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(WORKSPACE_ROOT, filePath);
    let realResolved = resolved;
    try {
        realResolved = realpathSync(resolved);
    } catch {
        // Arquivo não existe — resolver pelo menos o pai
        try {
            const parentReal = realpathSync(path.dirname(resolved));
            realResolved = path.join(parentReal, path.basename(resolved));
        } catch {
            realResolved = resolved; // pai também não existe — aceitar
        }
    }
    const relativeToWorkspace = path.relative(WORKSPACE_ROOT, realResolved);
    if (relativeToWorkspace.startsWith('..')) {
        return { ok: false, reason: `Acesso negado: caminho fora do workspace (${realResolved})`, resolved };
    }
    // ...
}
```

---

### BUG-H07 — `session-manager.js`: `buildAuditingPermissionHandler` ignora o `invocation` param

**Arquivo**: `src/copilot/agent/session-manager.js`
**Severidade**: ALTA — assinatura do handler incompatível com SDK; `invocation` sempre undefined

**Problema**: A assinatura do `PermissionHandler` no SDK é `(request, invocation) => PermissionRequestResult`. O wrapper `buildAuditingPermissionHandler` só recebe `request`:

```js
return async (request, invocation) => {
    // 'invocation' existe na assinatura mas nunca é passado ao baseHandler
    let result;
    if (baseHandler) {
        result = await baseHandler(request, invocation); // ← OK, passa invocation
    } else {
        result = { kind: 'approved' }; // ← Implementação ad-hoc sem usar approveAll do SDK
    }
```

O problema é o fallback `{ kind: 'approved' }` — em vez de usar o `approveAll` importado do SDK (que pode ter lógica interna adicional), usa uma implementação manual. Qualquer mudança futura no contrato do `approveAll` não seria herdada.

**Correção**:

```js
import { approveAll } from '@github/copilot-sdk';
// ...
if (baseHandler) {
    result = await baseHandler(request, invocation);
} else {
    result = await approveAll(request, invocation); // ← delegar ao SDK
}
```

---

### BUG-H08 — `mcp-tool-bridge.js`: `buildZodSchema` perde informação em objetos vazios

**Arquivo**: `src/copilot/bridges/mcp-tool-bridge.js`, função `buildZodSchema()`
**Severidade**: ALTA — tools MCP com schemas complexos recebem validação incorreta

**Problema**: Quando `schema.type === 'object'` mas `schema.properties` está ausente ou vazio, o código retorna `z.record(z.string(), z.unknown())`:

```js
if (schema.type === 'object' || schema.properties) {
    if (!schema.properties) return z.record(z.string(), z.unknown());
```

Isso significa que um objeto MCP com `additionalProperties: false` e sem `properties` declaradas (esquema de objeto genérico) se torna `z.record()`, que aceita qualquer chave. Mais grave: objetos com `allOf`, `oneOf`, `anyOf` (composição JSON Schema) são completamente ignorados.

**Correção**: Adicionar suporte para composição e tratar o caso vazio de forma mais explícita:

```js
// Suporte para allOf/oneOf/anyOf
if (schema.allOf || schema.oneOf || schema.anyOf) {
    return z.unknown().describe(schema.description ?? '');
}
if (!schema.properties || Object.keys(schema.properties).length === 0) {
    return z.object({}).catchall(z.unknown());
}
```

---

### BUG-H09 — `terminal/dialog.js`: Race condition no restart automático do dialog loop

**Arquivo**: `src/copilot/terminal/dialog.js` e `src/copilot/terminal/index.js`
**Severidade**: ALTA — duplo restart pode criar dois dialog loops simultâneos

**Problema**: Dois eventos podem disparar `ensureDialogLoop()` quase simultaneamente:

1. `dialog.stalled` → chama `llmBridgeClient.stopDialogMode()` → emite `dialog.stopped` → listener em `index.js` chama `ensureDialogLoop()`
2. O `dialog.stalled` listener em `index.js` também poderia encadear

O coalescimento via `_ensureDialogLoopInFlight` protege contra duas **chamadas simultâneas** ao `ensureDialogLoop()`. Porém há um cenário onde `alwaysAliveAgent.dialogLoopActive` ainda é `true` quando `dialog.stopped` chega (antes de `stopDialogMode()` completar no SDK), fazendo o coalescimento retornar `Promise.resolve()` prematuramente e o segundo restart não ocorrer.

**Correção**: Adicionar verificação de status explícita:

```js
// No handler de dialog.stopped em index.js:
alwaysAliveAgent.on('dialog.stopped', async (evt) => {
    if (evt.reason === 'authorized_stop') return;
    // Aguardar que dialogLoopActive seja false antes de reiniciar
    const maxWait = Date.now() + 5000;
    while (alwaysAliveAgent.dialogLoopActive && Date.now() < maxWait) {
        await new Promise(r => setTimeout(r, 100));
    }
    ensureDialogLoop().catch(e => log('ERROR', `...`));
});
```

---

## 4. Não-conformidades com o SDK Oficial

### SDK-NC01 — Uso de `session.getHistory()` vs `session.getMessages()`

**Arquivo**: `src/copilot/agent/always-alive.js` e `src/copilot/conversation-hub/store.js`
**Severidade**: MÉDIA

**Problema**: `#syncSdkHistory()` chama `session.getHistory()`:

```js
if (typeof sdkSession.getHistory !== 'function') return;
const messages = await sdkSession.getHistory();
```

Mas `getSessionMessages()` (método público de `AlwaysAliveAgent`) chama `session.getMessages()`. A documentação oficial do SDK Node.js expõe apenas `session.getMessages()` — `getHistory()` pode não existir, causando fallback silencioso com `return` sem sincronização.

**Correção**: Usar `getMessages()` consistentemente:

```js
async #syncSdkHistory(session) {
    if (typeof session.getMessages !== 'function') return;
    const messages = await session.getMessages();
    // ...
}
```

---

### SDK-NC02 — `sendAndWait()` timeout passa como segundo argumento posicional

**Arquivo**: `src/copilot/agent/task-executor.js`
**Severidade**: MÉDIA

**Problema**:

```js
const event = await session.sendAndWait(sendOpts, task.timeoutMs ?? 60_000);
```

A assinatura oficial do SDK é `sendAndWait(options: MessageOptions): Promise<AssistantMessageEvent>`. Não há segundo argumento para timeout na API pública documentada. O timeout é uma opção interna do CLI. Passar um número como segundo argumento pode ser ignorado silenciosamente ou lançar exceção em versões futuras.

**Correção**: Envolver com `AbortSignal.timeout()` ou `Promise.race()` externo, como já feito em `bridge-tasks.js` para o caso de `waitForResponse`.

---

### SDK-NC03 — `onPreToolUse` hook não suporta valor de retorno `"ask"`

**Arquivo**: `src/copilot/lib/hooks.js`
**Severidade**: BAIXA — funcionalidade ausente

O SDK suporta `permissionDecision: "ask"` que solicita confirmação interativa ao usuário. Toda a implementação de hooks no projeto usa apenas `"allow"` e `"deny"`, perdendo este modo que seria muito útil para ferramentas de alto risco.

---

### SDK-NC04 — `session.on()` em `task-executor.js`: return value não verificado

**Arquivo**: `src/copilot/agent/task-executor.js`
**Severidade**: BAIXA

`session.on()` retorna uma função de unsubscribe. O código já usa isso corretamente (`const unsubDelta = session.on(...)`). Porém, se `session.on` retornar `undefined` (em mock/stub de teste), `unsubDelta()` no `finally` lança `TypeError`. Adicionar guarda:

```js
const unsub = session.on('...', handler);
// No finally:
typeof unsub === 'function' && unsub();
```

---

## 5. Vulnerabilidades de Segurança

### SEC-V01 — `web-tools.js`: Scraping HTML do DuckDuckGo é não-autenticado e frágil

**Arquivo**: `src/copilot/tools/web-tools.js`
**Severidade**: ALTA — pode ser usado para exfiltração de dados via "busca" controlada

**Problema**: `webSearchTool` usa o frontend HTML lite do DDG para scraping com regex sobre HTML:

```js
const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
```

Este mecanismo é frágil (qualquer mudança no HTML do DDG o quebra), não-autenticado (sem quota/auditoria), e pode ser usado por um adversário que controla o LLM para injetar queries que recuperam conteúdo de URLs controladas por ele (exfiltração via search + fetch encadeados).

**Correção**: Desabilitar `webSearchTool` por padrão, exigir `WEB_SEARCH_ENABLED=true` explícito. Alternativamente, usar uma API de busca oficial com quota (ex. Brave Search API, Serper.dev).

---

### SEC-V02 — `shell/index.js`: `exec_command` permite subshell via backticks

**Arquivo**: `src/copilot/tools/shell/index.js`
**Severidade**: ALTA

**Problema**: `hasShellMetaOutsideQuotes()` bloqueia `$()` corretamente mas NÃO bloqueia backticks (`` ` ``):

```js
if ('|;&<>'.includes(c)) return true;
if (c === '`') return true; // ← EXISTE no código? Verificar:
if (c === '$' && command[i + 1] === '(') return true;
```

Consultando o código real: `` if (c === '`') return true `` **está presente** — mas a blocklist `BLOCKED_COMMAND_PATTERNS` não inclui o padrão de heredoc (`<<`), que pode ser usado para injeção de conteúdo arbitrário em alguns shells:

```bash
cat << 'EOF' > /workspaces/proj/malicious.sh
...
EOF
```

O tokenizador `split(/\s+/)` passaria `cat` como executável e `<<` como argumento — o `execFile` não interpreta `<<` (é shell syntax), mas o argumento `<<` em si pode confundir certos executáveis.

**Correção**: Adicionar `<<` e `>>` à detecção em `hasShellMetaOutsideQuotes()`.

---

### SEC-V03 — `session-manager.js`: Caminhos de tool-audit JSONL sem rotação

**Arquivo**: `src/copilot/agent/session-manager.js`, função `logToolAudit()`
**Severidade**: MÉDIA — crescimento ilimitado de disco; possível DoS

**Problema**: `logToolAudit()` usa `appendFileSync` sem nenhuma rotação de arquivo. O `audit.js` em `channel/audit.js` tem rotação, mas o `session-manager.js` tem uma implementação **duplicada e separada** de audit sem rotação:

```js
// Em session-manager.js — sem rotação:
appendFileSync(TOOL_AUDIT_LOG, line, 'utf8');
```

**Correção**: Consolidar ambas as implementações de audit em `channel/audit.js` (que já tem rotação de 10MB).

---

### SEC-V04 — `bridge-control.js`: Endpoint `/health` expõe `listenerCounts`

**Arquivo**: `src/copilot/api/bridge-control.js`
**Severidade**: BAIXA — information disclosure

O endpoint `GET /health` retorna `listenerCounts: agent.listenerDiagnostics()`, que expõe o número de listeners de cada evento interno do agente. Esta informação pode ser usada por atacantes para fingerprinting do estado interno.

**Correção**: Tornar `listenerCounts` opt-in via query param `?debug=true` protegido por autenticação.

---

### SEC-V05 — `file-tools.js`: `search_in_files` permite exfiltração via padrão regex

**Arquivo**: `src/copilot/tools/file-tools.js`
**Severidade**: MÉDIA

Um adversário que controla o LLM pode usar `search_in_files` com `isRegex: true` para buscar conteúdo de arquivos sensíveis (mesmo fora dos `BLOCKED_PATTERNS`) como certificados, arquivos de configuração de CI, etc. `BLOCKED_PATTERNS` só se aplica a `validatePath()` (não à busca dentro do workspace).

**Correção**: Adicionar checagem de `BLOCKED_PATTERNS` nos **resultados** do ripgrep, filtrando linhas que contenham dados aparentemente sensíveis (chaves PEM, tokens JWT no formato `ey...`).

---

### SEC-V06 — `server.js` (terminal): Rate limiter não persiste entre restarts

**Arquivo**: `src/copilot/terminal/server.js`
**Severidade**: BAIXA

O rate limiter de `POST /inject` usa `Map` em memória. Um atacante pode simplesmente reiniciar o processo para zerar o contador. Para ambientes de produção, o rate limiter deveria ser persistido (Redis, SQLite) ou implementado na camada de reverse proxy (nginx, Caddy).

---

## 6. Problemas Arquiteturais

### ARCH-01 — Dois sistemas paralelos de audit JSONL sem unificação

**Arquivos**: `src/copilot/channel/audit.js` e `src/copilot/agent/session-manager.js`
**Impacto**: MÉDIO — dados de auditoria fragmentados em dois arquivos, impossível correlacionar

Existem duas implementações independentes de logging de tool calls em JSONL:
- `channel/audit.js`: robusto, com rotação de 10MB, campos `sessionId`, `taskId`, `durationMs`
- `session-manager.js` `logToolAudit()`: simples, sem rotação, sem `taskId` nem `durationMs`

**Proposta**: Eliminar `logToolAudit()` de `session-manager.js`; fazer `buildAuditingPermissionHandler` chamar `auditToolStart()`/`auditToolComplete()` de `channel/audit.js`.

---

### ARCH-02 — `ConversationHub` não gerencia o ciclo de vida do `AlwaysAliveAgent`

**Arquivos**: `src/copilot/conversation-hub/hub.js`, `src/copilot/agent/always-alive.js`
**Impacto**: ALTO — acoplamento implícito; o Hub assume que o agente já está iniciado

O `HubOrchestrator` usa `alwaysAliveAgent` diretamente (importação estática) sem verificar se está ativo. Se o main-server inicializar o Hub antes do agente estar pronto (ex.: race condition no boot), chamadas a `hub.sendToLlmB()` falharão com "Agente não está ativo".

**Proposta**: Implementar verificação de prontidão no Orchestrator:

```js
async #executeSendToLlmB(...) {
    const agentInst = this.#agent ?? alwaysAliveAgent;
    if (agentInst.status === 'stopped') {
        throw new Error('[HubOrchestrator] AlwaysAliveAgent não está ativo');
    }
    // ...
}
```

---

### ARCH-03 — `hub-tools.js`: `requireHub()` lança exceção em modo terminal standalone

**Arquivo**: `src/copilot/tools/hub-tools.js`
**Impacto**: ALTO — todas as 5 hub tools estão inutilizáveis no terminal standalone

Quando o terminal LLM-B roda como processo PM2 separado (não integrado ao main-server), `conversationHub.isReady` é `false`. Qualquer tentativa da LLM-B de usar `hub_create_session`, `hub_send_message`, etc. lança:

```
Error: ConversationHub não está inicializado. Chame init() primeiro.
```

**Proposta**: Retornar degradação graciosa em vez de lançar:

```js
async function requireHub() {
    const { conversationHub } = await import('../conversation-hub/hub.js');
    if (!conversationHub.isReady) {
        return null; // graceful degradation
    }
    return conversationHub;
}
// Em cada handler:
const hub = await requireHub();
if (!hub) return { success: false, error: 'ConversationHub não disponível neste modo de execução.' };
```

---

### ARCH-04 — `nerv-bridge.js`: Mapeamento de eventos inclui eventos que não existem no SDK

**Arquivo**: `src/copilot/bridges/nerv-bridge.js`
**Impacto**: MÉDIO — listeners registrados para `'session.usage_info'` e `'assistant.reasoning_delta'` que são eventos **do SDK** (da sessão), não do `AlwaysAliveAgent` (EventEmitter)

O `AlwaysAliveAgent` re-emite esses eventos com outros nomes (`'session.usage'` e `'task.reasoning'`). Registrar listeners em `'session.usage_info'` diretamente no agent não dispara nada — esses são eventos emitidos pelo SDK na sessão, não pelo agent em si.

```js
// No EVENT_MAP — eventos que nunca são emitidos pelo AlwaysAliveAgent:
{ event: 'session.usage_info', actionCode: 'COPILOT_SESSION_USAGE_INFO' },
{ event: 'assistant.reasoning_delta', actionCode: 'COPILOT_ASSISTANT_REASONING_DELTA' },
```

**Correção**: Remover esses dois mapeamentos do NERV bridge. Os eventos correspondentes já são re-emitidos pelo agent como `'session.usage'` e `'task.reasoning'`, que já estão mapeados.

---

### ARCH-05 — `PinnedFilesLoader` inicializado sem paths em `terminal/index.js`

**Arquivo**: `src/copilot/terminal/index.js`
**Impacto**: MÉDIO — o loader é instanciado com array vazio, nunca carrega nada

```js
const pinnedLoader = new PinnedFilesLoader([]); // ← sem paths
```

O loader é instanciado e iniciado com `[]`, tornando-o um no-op completo. Os skills do sistema (`.github/skills/`) não são carregados.

**Proposta**: Ler os paths de `skills.json` (já gerenciado pelo `handleGetSkills()`):

```js
const { skills } = handleGetSkills().body;
const pinnedLoader = new PinnedFilesLoader(skills.paths ?? ['.github/skills']);
```

---

### ARCH-06 — Namespace Socket.io `/copilot` não é recriado após desmonte

**Arquivo**: `src/copilot/conversation-hub/socket-ns.js`
**Impacto**: MÉDIO — após stop/restart do hub, o namespace fica em estado inconsistente

`copilotNamespace` é uma variável de módulo. `mountCopilotNamespace()` guarda a referência e retorna o mesmo namespace se já montado. Mas `ConversationHub.stop()` não desmonta o namespace — o namespace permanece ativo mas o orchestrator é destruído, causando eventos pendentes sendo emitidos por um orchestrator null.

**Proposta**: Adicionar `unmount()` em `socket-ns.js` e chamá-lo em `ConversationHub.stop()`.

---

### ARCH-07 — `LlmBridgeClient` singleton `llmBridgeClient` tem historico limitado por `MAX_HISTORY_SIZE=500`

**Arquivo**: `src/copilot/channel/client.js`
**Impacto**: BAIXO — perda silenciosa de contexto em sessões longas

O histórico local é usado para `seedHistory()` e `clearHistory()` no `cmdCompact`, mas também para o `cmdHistory`. Com `MAX_HISTORY_SIZE = 500`, em sessões muito longas os turnos mais antigos são silenciosamente descartados sem notificação ao usuário.

**Proposta**: Emitir warning quando o histórico é truncado e expor o total real via `turnCount`.

---

## 7. Gaps de Qualidade e Manutenibilidade

### GAP-Q01 — `session-config.js`: `DEFAULT_EXCLUDED_TOOLS` inclui `'memory'` sem documentação de impacto

A exclusão de `'memory'` afeta o Memory MCP server. Se `COPILOT_MCP_SERVERS=memory` estiver definido, a tool `memory` é carregada via MCP mas simultaneamente excluída via `DEFAULT_EXCLUDED_TOOLS`, gerando comportamento confuso sem mensagem de aviso.

**Proposta**: Documentar o conflito e adicionar log de aviso quando MCP `memory` estiver habilitado E `memory` estiver em `excludedTools`.

---

### GAP-Q02 — `config/pinned-files-loader.js`: `fs.watch()` pode emitir `null` como filename em Linux

A documentação do Node.js avisa que em alguns sistemas Linux, `fs.watch()` pode emitir `null` como `filename`. O código verifica `if (!filename) return` — correto. Porém o código também usa `watch(dir, { persistent: false }, callback)` sem listener de `'error'` no watcher. Se o diretório for removido durante a execução, o watcher lança e o processo pode crashar.

**Correção**:

```js
const watcher = watch(dir, { persistent: false }, ...);
watcher.on('error', (err) => {
    log('WARN', `[PinnedFilesLoader] Watcher erro em ${dir}: ${err.message}`);
    this.#watchers.delete(dir);
});
```

---

### GAP-Q03 — `config/custom-agents.js`: Sub-agentes SDK têm `infer: true` fixo sem opção de configuração

Os 6 sub-agentes em `SDK_AGENTS` têm `infer: true` hardcoded. Não há mecanismo para desabilitar inferência individual de um agente sem editar o código. Em ambientes de produção restritivos, pode ser necessário desabilitar agentes específicos (ex. `shell-ops`) sem remover os outros.

**Proposta**: Adicionar env var `COPILOT_DISABLED_AGENTS=shell-ops,git-ops` (CSV) para filtrar sub-agentes dinamicamente em `buildCustomAgentsConfig()`.

---

### GAP-Q04 — `tools/web-tools.js`: `webSearchTool` regex frágil para extração de resultados DDG

As regex de extração de resultados DDG são brittle:

```js
const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
```

DDG mudou seu HTML diversas vezes em 2024-2025. Qualquer mudança de classe CSS ou estrutura HTML quebra silenciosamente a ferramenta (retorna array vazio sem erro).

**Proposta**: Adicionar log de warning quando `results.length === 0` para facilitar debugging, e considerar usar uma API de busca mais estável (Brave Search API tem plano gratuito).

---

### GAP-Q05 — `terminal/repl.js`: `/restart` pode causar deadlock se `dialog.ready` nunca disparar

```js
const readyPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout aguardando restart')), 30_000);
    alwaysAliveAgent.once('dialog.ready', () => {
        clearTimeout(timeout);
        resolve(undefined);
    });
});
await llmBridgeClient.stopDialogMode();
await readyPromise;
```

Se `stopDialogMode()` falhar ou o restart automático em `index.js` não disparar `dialog.ready` dentro de 30s (ex.: token expirado, SDK offline), o `/restart` lança e o terminal fica sem feedback de progresso. O fallback `ensureDialogLoop()` no `catch` é bom, mas o usuário não vê por quê o restart primário falhou.

**Proposta**: Adicionar `println()` no `catch` com o erro original antes do fallback.

---

### GAP-Q06 — `api/sdk-router.js` existe mas sua rota não está documentada no mapa de módulos

O arquivo `src/copilot/api/sdk-router.js` é mencionado no mapa como "router SDK legado" mas não está referenciado em nenhum outro lugar do projeto. Arquivo órfão que aumenta confusão.

**Proposta**: Verificar se `sdk-router.js` é montado em algum lugar. Se não, remover.

---

### GAP-Q07 — `conversation-hub/store.js`: `PRAGMA wal_checkpoint(PASSIVE)` periódico sem controle de erro escalado

```js
const checkpointTimer = setInterval(() => {
    try {
        db.pragma('wal_checkpoint(PASSIVE)');
    } catch {
        // Ignorar erros de checkpoint — não é crítico
    }
}, 5 * 60 * 1000);
```

Ignorar erros de WAL checkpoint indefinidamente pode mascarar uma situação onde o WAL file cresce sem limites (ex.: readers de longa duração). Após 10+ erros consecutivos, deveria ao menos emitir um warning.

---

### GAP-Q08 — `always-alive.js`: `#statusSnapshotCache` não é invalidado quando `#queue` muda

`getStatusSnapshot()` tem cache de 500ms. O `queueSize` no snapshot pode estar desatualizado por até 500ms após uma tarefa ser enfileirada. Para sistemas de monitoramento que fazem polling rápido, isso pode dar uma visão incorreta do backlog.

**Proposta**: Invalidar o cache também em `sendMessage()` (quando uma task é enfileirada):

```js
// Em sendMessage(), após this.#queue.push(task):
this.#statusSnapshotCache = null;
```

---

### GAP-Q09 — `tools/git/index.js`: `gitCommitTool` não verifica se há algo staged antes de commitar

O handler de `git_commit` executa `git add` e `git commit` sem verificar se há mudanças staged. Um commit sem mudanças falha com erro git, mas o erro é retornado sem contexto sobre a causa.

---

### GAP-Q10 — `terminal/http-handlers.js`: `handleInject` não limita tamanho total dos attachments embeddados

`attachmentToEmbed` já limita arquivos individuais a `MAX_EMBED_BYTES`. Porém, `handleInject` pode receber um array com dezenas de attachments, cada um abaixo do limite mas totalizando megabytes. Não há limite no número de attachments nem no total de bytes embeddados.

**Proposta**: Adicionar limite de `MAX_EMBED_BYTES` no total acumulado dos embeddings em `handleInject`.

---

### GAP-Q11 — Ausência de testes de integração para o fluxo LLM-A → ConversationHub → LLM-B

O Sprint Hub foi completamente implementado mas nenhum teste de integração cobre:
- `hub_create_session` + `hub_send_message` end-to-end
- Persistência de turns no SQLite após restart
- Namespace Socket.io `/copilot` broadcasting

Isso aumenta o risco de regressão silenciosa nas próximas iterações.

---

## 8. Propostas de Aprimoramento e Upgrade

### UPG-01 — Migrar `exec_command` para suportar pipes via stdin/stdout encadeados de forma segura

Em vez de bloquear pipes inteiramente, permitir um subconjunto seguro usando `spawn` com pipes entre processos explicitamente definidos (sem shell):

```js
// Permitir sintaxe: "cmd1 | cmd2" como dois processos explícitos
// Parse de pipelines: ['cmd1 args', 'cmd2 args']
// Executar como: spawn('cmd1') | spawn('cmd2') via stdio piping
```

---

### UPG-02 — Adicionar Circuit Breaker para chamadas ao MCP Tool Registry

`mcp-tool-bridge.js` tenta `buildMcpTools()` em cada `start()` e `#tryReconnect()`. Se o servidor MCP estiver offline, cada tentativa leva 8s (timeout de `fetch`). Com 5 tentativas de reconexão, isso é 40s de bloqueio.

**Proposta**: Implementar circuit breaker simples:

```js
let _mcpCircuitOpen = false;
let _mcpCircuitOpenAt = 0;
const CIRCUIT_RESET_MS = 60_000;

export async function buildMcpTools() {
    if (_mcpCircuitOpen && Date.now() - _mcpCircuitOpenAt < CIRCUIT_RESET_MS) {
        return []; // Circuit aberto — não tentar
    }
    try {
        const tools = await listMcpTools();
        _mcpCircuitOpen = false;
        return tools.map(createSdkToolFromMcp);
    } catch (e) {
        _mcpCircuitOpen = true;
        _mcpCircuitOpenAt = Date.now();
        return [];
    }
}
```

---

### UPG-03 — `StructuredMessage`: Adicionar campo `timestamp` e `correlationId`

O protocolo Sprint A é sólido mas carece de rastreabilidade temporal e correlação de request/response:

```ts
interface StructuredMessage {
    // ... campos atuais ...
    timestamp: number;       // Unix ms — quando foi criada/enviada
    correlationId: string;   // UUID — para correlacionar request LLM-A com response LLM-B
    turnNumber: number;      // já existe, manter
}
```

O `traceId` atual é gerado em `buildStructuredRequest()` mas não é propagado na resposta de LLM-B. `correlationId` seria enviado por LLM-A e devolvido inalterado por LLM-B, permitindo match exato.

---

### UPG-04 — Adicionar `GET /api/copilot/context` — endpoint dedicado para uso de contexto

O `contextWindow` já é exposto em `/status` e `/health`, mas não há endpoint dedicado para monitoramento de uso de contexto em tempo real. Dashboards precisam fazer polling do `/status` inteiro para obter apenas `contextWindow`.

```
GET /api/copilot/context
→ {
    tokens: number,
    tokenLimit: number,
    utilization: number,      // 0.0 – 1.0
    utilizationPercent: number, // 0 – 100
    lastCheckpointPath: string | null,
    warning: 'none' | 'moderate' | 'high' | 'critical'
  }
```

---

### UPG-05 — `ConversationStore`: Adicionar índice por `role` para queries de polling eficientes

`getPendingUserMessages()` faz full scan com `WHERE role = 'user' AND user_read = 0`. O índice existente `idx_conv_turns_unread` cobre `(hub_session_id, user_read) WHERE user_read = 0` — bom. Mas `markAllUserMessagesRead()` faz `UPDATE ... WHERE hub_session_id = ? AND role = 'user' AND user_read = 0` sem índice em `role`.

**Proposta**: Adicionar índice parcial:

```sql
CREATE INDEX IF NOT EXISTS idx_conv_turns_user_unread
    ON copilot_conversation_turns(hub_session_id)
    WHERE role = 'user' AND user_read = 0;
```

---

### UPG-06 — Implementar `chatBatch()` no `LlmBridgeClient` (Sprint D parcial)

O Sprint D está planejado mas nunca implementado. Uma versão simplificada sem paralelismo real (serializa via mutex existente) pode ser útil já:

```js
async chatBatch(messages, opts = {}) {
    return Promise.all(
        messages.map(msg => this.chat(msg, opts))
    );
}
// Nota: sem paralelismo real pois AlwaysAliveAgent serializa a fila.
// Mas a interface é útil para LLM-A que não precisa gerenciar futures manualmente.
```

---

### UPG-07 — Adicionar `version` ao barrel `CHANNEL_VERSION` no formato semver

`CHANNEL_VERSION = '1'` não segue semver e não permite detecção de breaking changes. Proposta:

```js
export const CHANNEL_VERSION = '1.3.0'; // MAJOR.MINOR.PATCH
// MAJOR: mudanças incompatíveis no protocolo StructuredMessage
// MINOR: novas features backward-compatible
// PATCH: bugfixes
```

---

### UPG-08 — Adicionar health check de conectividade ao CLI do Copilot no boot

Atualmente, falhas de conectividade ao CLI do Copilot só são detectadas quando a primeira sessão falha. Adicionar verificação proativa no boot:

```js
// Em entry.js, antes de startWithRetry():
try {
    const client = new CopilotClient();
    const ping = await Promise.race([
        client.ping('boot health check'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Ping timeout')), 5000))
    ]);
    log('INFO', `[copilot/agent] CLI conectado: ${JSON.stringify(ping)}`);
} catch (e) {
    log('WARN', `[copilot/agent] CLI não respondeu ao ping: ${e.message}`);
    // Continuar de qualquer forma — o startWithRetry() tratará o erro
}
```

---

### UPG-09 — Migrar `createHooks()` para suportar modo `"ask"` com callback de aprovação

```js
// Adicionar suporte a 'ask' com handler customizável:
export function createHooks(cfg = {}) {
    const askHandler = cfg.onPermissionAsk; // async (toolName) => boolean
    // ...
    const preToolFn = async (input, invocation) => {
        const decision = resolveToolDecision(...);
        if (decision === 'ask' && askHandler) {
            const approved = await askHandler(toolName);
            return { permissionDecision: approved ? 'allow' : 'deny' };
        }
        return { permissionDecision: decision };
    };
}
```

---

### UPG-10 — Adicionar métricas de latência por tool no `TelemetryStore`

Atualmente `recordToolCall()` armazena `durationMs` mas `getSummary()` só expõe a média global. Para identificar tools lentas:

```js
// Em getSummary() — adicionar:
const p95ByTool = {};
for (const [toolName, calls] of byToolMap.entries()) {
    const sorted = calls.map(c => c.durationMs).sort((a, b) => a - b);
    p95ByTool[toolName] = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
}
```

---

## 9. Tabela de Prioridades Consolidada

| ID          | Arquivo Principal                         | Descrição                                                 | Severidade  | Esforço              | Sprint Sugerido |
| ----------- | ----------------------------------------- | --------------------------------------------------------- | ----------- | -------------------- | --------------- |
| BUG-C01     | `tools/todo-tools.js`                     | `log.info()` — TypeError em runtime                       | CRÍTICA     | XS (busca/substitui) | Imediato        |
| BUG-C02     | `conversation-hub/store.js`               | `Atomics.wait()` — bloqueia event loop                    | CRÍTICA     | S                    | Imediato        |
| BUG-C03     | `agent/always-alive.js`                   | Reconnect duplica tools no SDK                            | CRÍTICA     | S                    | Sprint 25       |
| BUG-C04     | `bridges/nerv-bridge.js`                  | `'before-stop'` ausente de AGENT_EVENTS                   | CRÍTICA     | XS                   | Sprint 25       |
| BUG-C05     | `conversation-hub/orchestrator.js`        | `getTurn()` null silencia `turnNumber`                    | CRÍTICA     | S                    | Sprint 25       |
| BUG-H01     | `tools/shell/index.js`                    | Tokenizador ingênuo quebra aspas                          | ALTA        | M                    | Sprint 25       |
| BUG-H02     | `lib/hooks.js`                            | `permissionDecisionReason` campo inválido no SDK          | ALTA        | XS                   | Sprint 25       |
| BUG-H03     | `llm-a-conversation.mjs`                  | Import depreciado                                         | ALTA        | XS                   | Sprint 25       |
| BUG-H04     | `agent/events.js`                         | `session.context_changed` nunca emitido                   | ALTA        | S                    | Sprint 26       |
| BUG-H05     | `channel/client.js`                       | `dialogTurn()` sem streaming delta                        | ALTA        | M                    | Sprint 26       |
| BUG-H06     | `tools/file-tools.js`                     | Symlink traversal via diretório pai                       | ALTA        | S                    | Sprint 25       |
| BUG-H07     | `agent/session-manager.js`                | `buildAuditingPermissionHandler` não usa `approveAll` SDK | ALTA        | XS                   | Sprint 25       |
| BUG-H08     | `bridges/mcp-tool-bridge.js`              | `buildZodSchema` perde info em objetos vazios             | ALTA        | S                    | Sprint 26       |
| BUG-H09     | `terminal/dialog.js`                      | Race condition no restart do dialog loop                  | ALTA        | M                    | Sprint 26       |
| SDK-NC01    | `agent/always-alive.js`                   | `getHistory()` vs `getMessages()`                         | MÉDIA       | XS                   | Sprint 25       |
| SDK-NC02    | `agent/task-executor.js`                  | `sendAndWait()` timeout como arg posicional               | MÉDIA       | S                    | Sprint 26       |
| SDK-NC03    | `lib/hooks.js`                            | Hook `"ask"` não implementado                             | BAIXA       | M                    | Sprint 27       |
| SDK-NC04    | `agent/task-executor.js`                  | `session.on()` return sem guarda                          | BAIXA       | XS                   | Sprint 26       |
| SEC-V01     | `tools/web-tools.js`                      | Scraping DDG sem quota/auditoria                          | ALTA        | M                    | Sprint 26       |
| SEC-V02     | `tools/shell/index.js`                    | Heredoc `<<` não bloqueado                                | ALTA        | XS                   | Sprint 25       |
| SEC-V03     | `agent/session-manager.js`                | Audit log sem rotação                                     | MÉDIA       | S                    | Sprint 26       |
| SEC-V04     | `api/bridge-control.js`                   | `listenerCounts` exposto publicamente                     | BAIXA       | XS                   | Sprint 27       |
| SEC-V05     | `tools/file-tools.js`                     | `search_in_files` pode vazar secrets                      | MÉDIA       | M                    | Sprint 26       |
| SEC-V06     | `terminal/server.js`                      | Rate limiter em memória                                   | BAIXA       | M                    | Sprint 27       |
| ARCH-01     | `channel/audit.js` + `session-manager.js` | Dois sistemas de audit paralelos                          | MÉDIO       | M                    | Sprint 26       |
| ARCH-02     | `conversation-hub/hub.js`                 | Hub não verifica se agente está ativo                     | ALTO        | S                    | Sprint 25       |
| ARCH-03     | `tools/hub-tools.js`                      | Hub tools lançam em modo standalone                       | ALTO        | S                    | Sprint 25       |
| ARCH-04     | `bridges/nerv-bridge.js`                  | Eventos SDK mapeados no NERV sem re-emissão               | MÉDIO       | XS                   | Sprint 25       |
| ARCH-05     | `terminal/index.js`                       | `PinnedFilesLoader` sem paths                             | MÉDIO       | XS                   | Sprint 26       |
| ARCH-06     | `conversation-hub/socket-ns.js`           | Namespace não desmontado no stop                          | MÉDIO       | S                    | Sprint 26       |
| ARCH-07     | `channel/client.js`                       | Truncamento silencioso do histórico                       | BAIXO       | XS                   | Sprint 27       |
| GAP-Q01–Q11 | Vários                                    | Qualidade/manutenibilidade (ver §7)                       | BAIXO–MÉDIO | XS–S                 | Sprint 26–27    |
| UPG-01–10   | Vários                                    | Aprimoramentos e novos recursos                           | —           | S–L                  | Sprint 26–28    |

**Legenda de esforço**: XS = < 1h · S = 1–4h · M = 4–8h · L = 1–3 dias

---

*Relatório gerado em 2026-03-27. Auditoria baseada em leitura estática dos arquivos fornecidos e cruzamento com documentação oficial `@github/copilot-sdk` (npm registry, github.com/github/copilot-sdk, docs.github.com/en/copilot). Nenhuma ferramenta automatizada de análise estática foi utilizada durante a auditoria.*
