# Análise Profunda: `src/copilot/sdk` — Wrapper Layer do GitHub Copilot SDK 0.3.0

> **Projeto:** Ilenburg1993/chatgpt-docker-puppeteer · `src/copilot/` **SDK target:**
> `@github/copilot-sdk@0.3.0` **Stack:** Node.js 24+ ESM · JS + JSDoc · TypeScript strict
> (tsconfig.strict.src.copilot.sdk.json) **Data da análise:** 2026-05-14

---

## Sumário Executivo

A camada SDK do projeto é **bem estruturada e abrangente** para uma wrapper layer JS+JSDoc em cima
do `@github/copilot-sdk`. A separação por subsurfaces (`session`, `rpc`, `models`, `tools`,
`telemetry`, `agent`), o uso de circuit breaker, injeção de dependências e pattern de
porta/adaptador são pontos positivos notáveis.

No entanto, a análise revela **17 bugs reais**, **12 gaps funcionais em relação ao SDK 0.3.0**, **9
duplicidades/ambiguidades** e **8 oportunidades de melhoria arquitetural** que merecem atenção. Os
itens críticos estão destacados com 🔴; os de alta prioridade com 🟠; os médios com 🟡.

---

## Índice

1. [Bugs e Defeitos](#1-bugs-e-defeitos)
2. [Gaps em relação ao SDK 0.3.0](#2-gaps-em-relação-ao-sdk-030)
3. [Duplicidades e Ambiguidades](#3-duplicidades-e-ambiguidades)
4. [Problemas de TypeCheck Strict](#4-problemas-de-typecheck-strict)
5. [Questões Arquiteturais](#5-questões-arquiteturais)
6. [Features Experimentais Não Implementadas](#6-features-experimentais-não-implementadas)
7. [Melhorias de Performance e Robustez](#7-melhorias-de-performance-e-robustez)
8. [Tabela Consolidada de Ações](#8-tabela-consolidada-de-ações)
9. [Propostas de Correção — Código](#9-propostas-de-correção--código)

---

## 1. Bugs e Defeitos

### 🔴 BUG-01 — `ToolSessionContext.snapshot()` referencia método estático privado incorretamente

**Arquivo:** `session/tool-session-context.js` · linhas finais do método `snapshot()`

```js
hasBroadcastSse: this.#broadcastSse !== ToolSessionContext.#noopSse,
```

**Problema:** `ToolSessionContext.#noopSse` é declarado como campo estático privado
`static #noopSse = () => {};`. Em JavaScript, campos estáticos privados **não são acessíveis** de
dentro de métodos de instância via `ClassName.#field` — essa sintaxe funciona apenas dentro de
métodos estáticos da própria classe. Em runtime Node 24 isso pode lançar `SyntaxError` ou retornar
sempre `false`.

**Correção:**

```js
// Adicionar campo de instância flag no construtor
#hasBroadcastSseConfigured = false;

configureBroadcastSse(fn) {
    if (typeof fn !== 'function') return;
    this.#broadcastSse = fn;
    this.#hasBroadcastSseConfigured = true;
}

snapshot() {
    return {
        sessionId: this.#sessionId,
        pendingInputCount: this.#pendingInputResolvers.size,
        pendingInputIds: [...this.#pendingInputResolvers.keys()],
        hasBroadcastSse: this.#hasBroadcastSseConfigured,
    };
}
```

---

### 🔴 BUG-02 — `getCompactionMethod()` em `rpc/ops.js` usa `fn.bind()` com argumento potencialmente `undefined`

**Arquivo:** `rpc/ops.js` · função `getCompactionMethod()`

```js
return fn.bind(rpc.history ?? rpc.compaction);
```

**Problema:** Se `fn` foi obtido de `rpc.history?.compact`, mas `rpc.history` é `undefined` e
`rpc.compaction?.compact` existe, então `rpc.history ?? rpc.compaction` devolve `rpc.compaction` —
correto. Porém se ambos existem mas `rpc.history.compact` é `undefined` e `rpc.compaction.compact`
existe, o fluxo já lançou o `TypeError` antes de chegar ao bind. O problema real é que `fn.bind()`
com `undefined` como `this` em strict mode pode causar comportamentos inesperados na chamada
subsequente ao RPC. Além disso, o tipo de retorno declara `() => Promise<CompactionCompactResult>`
mas o bind produz `Function`, perdendo tipagem.

**Correção:**

```js
function getCompactionMethod(session) {
    const rpc = session.rpc;
    if (rpc.history && typeof rpc.history.compact === 'function') {
        return () => rpc.history.compact();
    }
    if (rpc.compaction && typeof rpc.compaction.compact === 'function') {
        return () => rpc.compaction.compact();
    }
    throw new TypeError('[sdk/rpc/compaction.compact] RPC de compaction indisponível.');
}
```

---

### 🔴 BUG-03 — Race condition no `CopilotClientManager.#connect()`: `#startPromise = null` no `finally` antes de retornar

**Arquivo:** `session/client.js` · método `#connect()`

```js
} finally {
    this.#startPromise = null;
}
```

**Problema:** O `finally` zera `#startPromise` antes que o resultado seja consumido. Se duas
chamadas paralelas a `getClient()` chegam enquanto `#connect` está em andamento, ambas recebem a
mesma `#startPromise`. Quando a primeira resolve, o `finally` zera `#startPromise`. Se a segunda
ainda não foi resolvida (o que não deveria ocorrer já que é a mesma Promise), há janela de race. O
problema mais real é: se `#connect` lança exceção, `#startPromise = null` ocorre no finally mas
`#client` permanece null, e a próxima chamada a `getClient()` vai tentar reconectar — isso é
correto. Porém se `#connect` foi bem-sucedido, `#client` fica setado E `#startPromise` é zerado
antes de `return client` executar no chamador — tecnicamente ok pois a Promise já resolveu. **O bug
real** é que entre o `finally` e o `return client` no último `maxAttempts`, há uma janela onde
`#startPromise = null` mas `#client = null` também (falha), criando o estado inconsistente que
permite múltiplos `#connect()` simultâneos.

**Correção:** Usar uma flag booleana `#connecting` separada para debouncing:

```js
async #connect(overrides) {
    this.#connecting = true;
    try {
        // ... lógica existente
    } finally {
        this.#connecting = false;
        this.#startPromise = null;
    }
}
```

---

### 🟠 BUG-04 — `session/lifecycle.js`: `resolveSessionCreateModel()` exportado mas com semântica confusa

**Arquivo:** `session/lifecycle.js`

```js
export async function resolveSessionCreateModel(model, fallback = 'gpt-5-mini') {
    if (model !== 'auto') return model;
    return resolveSessionAutoModel(fallback);
}
```

**Problema:** A função resolve `model="auto"` para um modelo concreto, mas o comentário interno de
`createSession()` diz explicitamente _"Preservando model='auto' nativo do SDK"_. Isso cria uma
contradição: `createSession` não chama `resolveSessionCreateModel`, mas a função é exportada
publicamente levando consumers a acreditar que devem usá-la para normalizar modelos antes de criar
sessões — o que quebraria o comportamento nativo `auto` do SDK.

**Correção:** Marcar como `@deprecated` ou remover do barrel público, mantendo apenas para uso
interno em fluxos que realmente precisam de modelo concreto (ex: exibição de UI):

```js
/**
 * @deprecated Use model="auto" diretamente em SessionConfig. Esta função resolve
 * antecipadamente o modelo, perdendo o roteamento nativo do SDK.
 * Mantida apenas para compatibilidade com fluxos de UI que precisam exibir o modelo.
 */
export async function resolveSessionCreateModel(model, fallback = 'gpt-5-mini') {
```

---

### 🟠 BUG-05 — `models/helpers.js`: `_modelsCache` é singleton de módulo — não thread-safe em workers

**Arquivo:** `models/helpers.js`

```js
let _modelsCache = null;
```

**Problema:** Em Workers (worker_threads do Node 24) que importam este módulo, o cache não é
compartilhado entre threads mas também não tem mecanismo de invalidação cross-worker. Se a conta
muda de modelo ou quota muda, o cache pode ficar stale por até 5 minutos independentemente entre
workers. Em ambientes multi-worker (servidor HTTP com múltiplos threads), múltiplas chamadas
`listModels` podem disparar em paralelo no TTL inicial, sem deduplicação.

**Correção:** Adicionar deduplicação de requests em voo:

```js
let _modelsCache = null;
let _inflightRequest = null; // Promise em voo para deduplicar concurrent calls

export async function listModels(clientOverrides = {}, forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && _modelsCache && _modelsCache.expiresAt > now) {
        return _modelsCache.models;
    }
    if (_inflightRequest) return _inflightRequest;

    _inflightRequest = (async () => {
        try {
            const client = await getModelListClient(clientOverrides);
            const models = await client.listModels();
            _modelsCache = { models, expiresAt: now + MODELS_CACHE_TTL_MS };
            return models;
        } catch (e) {
            _modelsCache = null;
            throw e;
        } finally {
            _inflightRequest = null;
        }
    })();
    return _inflightRequest;
}
```

---

### 🟠 BUG-06 — `tools/custom.js`: `_resetRegistry()` não reseta `_loaded = false` antes de `_loadPromise`

**Arquivo:** `tools/custom.js`

```js
export function _resetRegistry() {
    _registry = new Map();
    _loadPromise = null;
    _loaded = false;
}
```

**Problema:** A ordem importa. Se `_resetRegistry()` for chamada enquanto `_loadPromise` ainda está
em voo (possível em testes paralelos), a Promise em voo vai completar e setar `_loaded = true` após
o reset, fazendo o registry parecer carregado com dados potencialmente de um estado anterior. A
ordem correta é: primeiro setar `_loaded = false`, depois zerar `_loadPromise`, depois limpar o
registry.

**Correção:**

```js
export function _resetRegistry() {
    _loaded = false;       // primeiro: impede que Promise em voo marque como loaded
    _loadPromise = null;   // segundo: abandona qualquer load pendente
    _registry = new Map(); // terceiro: limpa dados
}
```

---

### 🟠 BUG-07 — `session/permissions.js`: `content-exclusion-check` hardcoded como kind — pode variar entre versões do SDK

**Arquivo:** `session/permissions.js`

```js
if (kind === 'content-exclusion-check') {
```

**Problema:** O kind `'content-exclusion-check'` é uma string literal hardcoded que não está mapeada
em `PERMISSION_COMPLETED_KINDS` nem em `PERMISSION_RESULTS` em `constants.js`. Se o SDK 0.3.0+ mudar
este kind (ex: para `'content_exclusion'`), o handler silenciosamente parará de bloquear exclusões
de conteúdo — comportamento de segurança crítico.

**Correção:** Adicionar em `constants.js`:

```js
export const PERMISSION_KINDS = /** @type {const} */ ({
    SHELL: 'shell',
    WRITE: 'write',
    READ: 'read',
    MCP: 'mcp',
    URL: 'url',
    CUSTOM_TOOL: 'custom-tool',
    MEMORY: 'memory',
    HOOK: 'hook',
    CONTENT_EXCLUSION_CHECK: 'content-exclusion-check',
});
```

E usar `PERMISSION_KINDS.CONTENT_EXCLUSION_CHECK` no handler.

---

### 🟠 BUG-08 — `rpc/session.js`: `getWorkspaceRpc()` usa type assertion fragil sem validação de métodos

**Arquivo:** `rpc/session.js`

```js
const workspaceRpc = /** @type {{ listFiles... }} */ (candidate);
return workspaceRpc;
```

**Problema:** O cast JSDoc assume que `candidate` tem os métodos `listFiles`, `readFile`,
`createFile` sem validar. Se a versão do SDK tiver API ligeiramente diferente (ex: `readFile`
renomeado para `getFile`), o erro só ocorre em runtime com
`TypeError: workspaceRpc.readFile is not a function`.

**Correção:** Adicionar duck-typing check:

```js
if (typeof candidate.listFiles !== 'function') {
    throw new TypeError('[sdk/rpc/workspace] namespace não expõe listFiles().');
}
```

---

### 🟠 BUG-09 — `session/hook-bus.js`: silencia TODOS os erros de listener com um único catch

**Arquivo:** `session/hook-bus.js`

```js
} catch (e) {
    log('WARN', `[sdk/hook-bus] listener erro em '${hookName}': ${toError(e).message}`);
}
```

**Problema:** O try/catch envolve `this.emit(hookName, event)`, `this.emit('*', event)` E
`this.#eventBus.emit(...)`. Se `this.emit` lançar (improvável mas possível em listeners síncronos
que relançam), o EventBus nunca recebe o evento. Listeners que lançam erroneamente suprimem
propagação para outros listeners, especialmente o EventBus global.

**Correção:** Separar os try/catch:

```js
try { this.emit(hookName, event); } catch (e) { log('WARN', ...); }
try { this.emit('*', event); } catch (e) { log('WARN', ...); }
if (busType && this.#eventBus) {
    try { this.#eventBus.emit(...); } catch (e) { log('WARN', ...); }
}
```

---

### 🟡 BUG-10 — `models/selector.js`: `_scoreAndSort()` não lida com `COST_ORDER[model.costTier]` sendo `undefined`

**Arquivo:** `models/selector.js`

```js
const costScore = 4 - COST_ORDER[model.costTier];
```

**Problema:** Se `model.costTier` for um valor não presente em `COST_ORDER` (ex: um tier novo
adicionado pelo SDK), `COST_ORDER[model.costTier]` retorna `undefined`, e `4 - undefined = NaN`. O
score `NaN` quebra a ordenação `sort((a, b) => b.score - a.score)` pois `NaN - number = NaN` e o
sort se torna não-determinístico.

**Correção:**

```js
const costScore = 4 - (COST_ORDER[model.costTier] ?? 2); // default 'medium'
const speedScore = SPEED_ORDER[model.speedTier] ?? 1;
```

---

### 🟡 BUG-11 — `session/elicitation.js`: ID gerado com `crypto.randomUUID()` pode falhar em contextos sem Web Crypto

**Arquivo:** `session/elicitation.js`

```js
const id = `elicitation-${Date.now().toString(36)}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
```

**Problema:** `globalThis.crypto` está disponível no Node 19+, mas em workers com configurações
específicas ou ambientes de test runner mais antigos pode ser `undefined`. Deveria usar
`import { randomUUID } from 'node:crypto'` para garantir disponibilidade no Node 24.

**Correção:**

```js
import { randomUUID } from 'node:crypto';
// ...
const id = `elicitation-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
```

---

### 🟡 BUG-12 — `telemetry/quota-monitor.js`: `start()` chama `_fetch()` imediatamente mas ignora erro silenciosamente

**Arquivo:** `telemetry/quota-monitor.js`

```js
_fetch().catch(() => {
    // silencioso: erro de poll não deve derrubar o monitor
});
```

**Problema:** O catch silencioso no poll inicial impede que o consumer saiba se o monitor começou
com erro. Um `onError` callback não está disponível nas opções. Além disso, se o client não estiver
conectado quando `start()` for chamado, a falha silenciosa mascara um problema de inicialização.

**Correção:** Adicionar `onError` opcional nas opções:

```js
/** @property {(error: Error) => void} [onError] */

// no start():
_fetch().catch((err) => {
    if (typeof onError === 'function') onError(toError(err));
});
```

---

### 🟡 BUG-13 — `tools/registry.js`: `createToolRegistryAdapter()` não expõe `exclude` nem `merge`

**Arquivo:** `tools/registry.js`

```js
export function createToolRegistryAdapter(inner) {
    const reg = inner ?? createRegistry();
    return {
        // ...
        filter: (names) => createToolRegistryAdapter(filterByNames(reg, names)),
        // sem exclude, sem merge
    };
}
```

**Problema:** O adapter implementa `IToolRegistry` mas a interface parece incluir `exclude` e
`merge` pelo uso em `agent-policy.js` e outros. Consumers que recebem `IToolRegistry` não podem
chamar `exclude()` sem cast.

---

### 🟡 BUG-14 — `session/runtime.js`: `verifySessionModelSwitch()` pode lançar depois do `setSessionModel()` já ter retornado

**Arquivo:** `session/runtime.js`

A função `verifySessionModelSwitch` é `async` e chamada com `await`, correto. Porém a verificação
via `modelGetCurrent()` após o switch pode retornar o modelo antigo se o SDK processar a troca de
forma assíncrona internamente. O resultado `verifiedSwitch: false` pode ser falso-negativo,
acionando o fallback `rpc.model.switchTo()` desnecessariamente (double-switch).

**Correção:** Adicionar retry com backoff pequeno na verificação:

```js
async function verifyWithRetry(session, model, maxAttempts = 2) {
    for (let i = 0; i < maxAttempts; i++) {
        const current = await modelGetCurrent(session);
        if (current.modelId === model) return current;
        if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, 200));
    }
    return await modelGetCurrent(session);
}
```

---

### 🟡 BUG-15 — `rpc/ops.js`: `agentDeselect()` retorna `{}` tipado como `AgentDeselectResult` mas o SDK pode retornar dados

**Arquivo:** `rpc/ops.js`

```js
await session.rpc.agent.deselect();
return /** @type {AgentDeselectResult} */ ({});
```

**Problema:** O resultado real de `session.rpc.agent.deselect()` é descartado. Se o SDK 0.3.0
adicionou campos de resposta (ex: confirmação, sessionId), eles são perdidos silenciosamente.

**Correção:**

```js
const result = await session.rpc.agent.deselect();
return /** @type {AgentDeselectResult} */ (result ?? {});
```

---

### 🟡 BUG-16 — `session/client-events.js`: `getClientSnapshot()` pode retornar `null` sem que `assertClient()` seja chamado

**Arquivo:** `session/client-events.js`

```js
export function onLifecycleEvent(eventType, handler, client) {
    const c = client ?? getClientSnapshot();
    assertClient(c);
```

**Problema:** `getClientSnapshot()` retorna `CopilotClient | null`. `assertClient(null)` lança
`Error('[sdk/client-events] client is required')` — isso está correto, mas a mensagem de erro não é
informativa sobre _por que_ o client é null (não inicializado vs. já parado).

**Correção:** Melhorar a mensagem de erro:

```js
function assertClient(client) {
    if (!client || typeof client !== 'object') {
        throw new Error('[sdk/client-events] client inválido ou não inicializado. Chame getClient() primeiro.');
    }
    // ...
}
```

---

### 🟡 BUG-17 — `tools/custom.js`: `buildCustomTools()` chama `requireCustomToolsBuilder()` que lança se builder não injetado, mas `getCustomToolDefinitions()` não

**Arquivo:** `tools/custom.js`

```js
export function buildCustomTools() {
    ensureCustomToolsLoadedSync();
    const buildTool = requireCustomToolsBuilder(); // lança se não injetado
```

**Problema:** `getCustomToolDefinitions()` pode ser chamado antes do builder ser injetado (durante
introspecção da API). Isso está OK. Mas `buildCustomTools()` lança com mensagem técnica que vazará
para o usuário final se chamado durante bootstrap antes da injeção. Não há forma de verificar se o
builder está disponível antes de chamar `buildCustomTools()`.

**Correção:** Adicionar `isCustomToolsBuilderReady()`:

```js
export function isCustomToolsBuilderReady() {
    return _buildTool !== null;
}
```

---

## 2. Gaps em Relação ao SDK 0.3.0

### 🔴 GAP-01 — `session.rpc.history.compact` não está nos tipos declarados em `types.js`

O SDK 0.3.0 introduziu o namespace `history` com método `compact()` como substituição do antigo
`compaction.compact()`. O código em `rpc/ops.js` já lida com ambos, mas:

1. `types.js` não documenta o namespace `history` no RPC
2. O typedef `ExperimentalSession` não inclui `history`
3. Consumers externos não têm visibilidade da mudança de API

**Ação:** Adicionar em `types.js`:

```js
/**
 * Namespace de histórico de sessão (SDK 0.3.0+). Substitui `compaction.*`.
 * @typedef {{ compact: () => Promise<CompactionCompactResult> }} SessionHistoryRpc
 */
```

---

### 🔴 GAP-02 — `resolveSessionCreateModel` em `lifecycle.js` exporta mas `index.js` e barrels **não** reexportam `clearModelsCache`

**Arquivo:** `models/index.js` exporta `clearModelsCache`, mas `sdk/index.js` (barrel raiz) **não**
a inclui. Consumers de `#copilot/sdk` não conseguem invalidar o cache programaticamente sem acessar
o subpath `#copilot/sdk/models`.

**Ação:** Adicionar em `sdk/index.js`:

```js
export { clearModelsCache } from './models/helpers.js';
```

---

### 🟠 GAP-03 — Sem wrapper para `session.rpc.snapshot.*` (SDK 0.3.0 feature)

O SDK 0.3.0 adicionou `session.rpc.snapshot.rewind(snapshotId)` para desfazer operações via
snapshot. O evento `SESSION_SNAPSHOT_REWIND` já está mapeado em `constants.js`, mas **não existe
nenhum wrapper RPC** para `snapshot.rewind()` em `rpc/session.js` ou `rpc/ops.js`.

**Ação:** Criar em `rpc/session.js`:

```js
/**
 * Reverte sessão para um snapshot anterior.
 * @param {CopilotSession} session
 * @param {string} snapshotId
 * @returns {Promise<{ success: boolean }>}
 */
export async function snapshotRewind(session, snapshotId) {
    assertRpcSession(session, 'snapshot.rewind');
    // ...
}
```

E expor via `rpc/session-facade.js` e barrels.

---

### 🟠 GAP-04 — `session.rpc.backgroundTasks` não está implementado

O evento `SESSION_BACKGROUND_TASKS_CHANGED` está em `constants.js`, mas não há nenhum wrapper para
interagir com background tasks via RPC. O SDK 0.3.0 expõe `session.rpc.backgroundTasks.list()` e
potencialmente `cancel()`.

---

### 🟠 GAP-05 — `session.rpc.context.*` (workspace context) sem wrapper

O SDK 0.3.0 introduziu `session.rpc.context.get()` para obter o contexto atual do workspace
(arquivos abertos, seleção, etc.). O evento `SESSION_CONTEXT_CHANGED` está em `constants.js` mas não
há wrapper para ler o contexto via RPC.

---

### 🟠 GAP-06 — `onEvent` em `SessionConfig` não tem tipo documentado em `types.js`

**Arquivo:** `session/lifecycle.js` e `types.js`

`SessionConfig` em `types.js` menciona `onEvent?` mas o typedef não documenta a assinatura real do
handler. O campo `SessionCreateOptions.onEvent` está tipado como `SessionConfig['onEvent']` — que
resolve para `unknown` sem os tipos corretos do SDK carregados.

**Ação:** Documentar em `types.js`:

```js
/**
 * Handler genérico de eventos da sessão SDK (alternativa a session.on()).
 * @typedef {(event: SessionEvent) => void} SessionOnEventHandler
 */
```

---

### 🟠 GAP-07 — `session.capabilities` não cobre `backgroundTasks`, `snapshot`, `context`

**Arquivo:** `session/capabilities.js`

`getSessionCapabilities()` e `supportsElicitation()` apenas cobrem `ui.elicitation`. O SDK 0.3.0
expõe capabilities para outras features. Não há helpers como `supportsSnapshots()`,
`supportsBackgroundTasks()`.

---

### 🟠 GAP-08 — `createWorkspaceSessionFsHandler` não suporta `getFile` (alias de `readFile` no SDK 0.3.0)

O SDK 0.3.0 pode usar `getFile` como alias de `readFile` no provider interface. O
`createLocalSessionFsProvider` implementa `readFile` mas não `getFile`, potencialmente quebrando a
compatibilidade.

---

### 🟡 GAP-09 — `MCPServerConfig` não expõe `auth` field (OAuth support do SDK 0.3.0)

Os eventos `MCP_OAUTH_REQUIRED` e `MCP_OAUTH_COMPLETED` estão em `constants.js`, mas:

1. `MCPHTTPServerConfig` em `types.js` não documenta o campo `auth` para OAuth
2. Não há helpers para construir configurações MCP com OAuth
3. Não há wrapper para o fluxo `mcp.oauth_required` → `mcp.oauth_completed`

---

### 🟡 GAP-10 — `session.rpc.pending.*` sem wrapper

O SDK 0.3.0 tem `session.rpc.pending` para gerenciar mensagens pendentes. O evento
`PENDING_MESSAGES_MODIFIED` está em `constants.js` mas sem wrapper RPC correspondente.

---

### 🟡 GAP-11 — `session.rpc.subagent.*` sem wrapper

Eventos `SUBAGENT_STARTED`, `SUBAGENT_COMPLETED`, `SUBAGENT_FAILED`, `SUBAGENT_SELECTED`,
`SUBAGENT_DESELECTED` estão em `constants.js` mas não há wrappers RPC para gerenciar subagentes via
`session.rpc.subagent.*`.

---

### 🟡 GAP-12 — `ClientOptionsBuilder` não expõe `sessionStatePath` explicitamente

**Arquivo:** `session/client-options.js`

`buildConfiguredClientSessionFsConfig()` define `sessionStatePath` indiretamente via boot config,
mas `ClientOptionsBuilder` não tem método explícito para configurá-lo. Consumers que constroem
opções programaticamente precisam usar `.merge()` com cast manual.

---

## 3. Duplicidades e Ambiguidades

### 🟠 DUP-01 — `getSessionCapabilities()` exportada em DOIS módulos com implementações diferentes

**Arquivos:**

- `session/capabilities.js`: `getSessionCapabilities(session)` — retorna spread de
  `session.capabilities ?? {}`
- `session/ui.js`: `getSessionCapabilities(session)` — retorna `session.capabilities ?? {}`

**Diferença:** `capabilities.js` faz spread (`{ ...session.capabilities ?? {} }`), enquanto `ui.js`
retorna a referência direta. O barrel `session/index.js` exporta apenas a versão de `ui.js` (linha
final), mas a de `capabilities.js` também é exportada. Consumers que importam de `#copilot/sdk`
recebem a versão de `ui.js` via `sdk/index.js`.

**Ação:** Remover a implementação duplicada de `session/ui.js` e importar de `capabilities.js`:

```js
// session/ui.js
import { getSessionCapabilities } from './capabilities.js';
export { getSessionCapabilities };
```

---

### 🟠 DUP-02 — `assertRpcSession()` duplicada conceitualmente entre `rpc/guards.js` e funções locais em `rpc/session.js`, `rpc/ops.js`

**Arquivos:** `rpc/guards.js`, `rpc/session.js`, `rpc/ops.js`, `session/capabilities.js`,
`session/runtime.js`, `session/ui.js`

Cada módulo tem sua própria função `assertSession()` ou `assertClient()` com verificações
ligeiramente diferentes:

- `rpc/guards.js`: verifica `'rpc' in session`
- `session/capabilities.js`: verifica apenas `typeof session !== 'object'`
- `session/runtime.js`: verifica `'sessionId' in session`
- `session/ui.js`: verifica `'sessionId' in session`
- `session/client.js`: `assertClient` verifica `'rpc' in client`

Há **6 implementações diferentes** de guards de sessão/client espalhadas pelo código.

**Ação:** Centralizar em `rpc/guards.js` com variantes:

```js
export function assertSession(session, caller) { /* verifica sessionId */ }
export function assertSessionWithRpc(session, caller) { /* verifica sessionId + rpc */ }
export function assertClient(client, caller) { /* verifica rpc */ }
```

---

### 🟠 DUP-03 — `SessionCreateOptions` e `SessionResumeOptions` em `lifecycle.js` têm 90% dos campos idênticos

**Arquivo:** `session/lifecycle.js`

Ambos os typedefs têm os mesmos campos: `model`, `reasoningEffort`, `onPermissionRequest`, `hooks`,
`tools`, `commands`, `infiniteSessions`, `systemMessage`, `workingDirectory`, `mcpServers`,
`customAgents`, `defaultAgent`, `streaming`, `availableTools`, `excludedTools`, `provider`,
`configDir`, `onEvent`, `agent`, `skillDirectories`, `disabledSkills`, `gitHubToken`,
`createSessionFsHandler`, `onUserInputRequest`, `onElicitationRequest`, `modelCapabilities`,
`enableConfigDiscovery`, `includeSubAgentStreamingEvents`.

A única diferença real é que `SessionCreateOptions` tem `sessionId` e `clientName`, enquanto
`SessionResumeOptions` tem `disableResume`.

**Ação:** Usar composição de typedefs:

```js
/**
 * @typedef {object} SessionBaseOptions
 * @property {string} [model]
 * @property {ReasoningEffortLevel} [reasoningEffort]
 * // ... campos comuns
 */

/**
 * @typedef {SessionBaseOptions & { sessionId?: string; clientName?: string }} SessionCreateOptions
 */

/**
 * @typedef {SessionBaseOptions & { clientName?: string; disableResume?: boolean }} SessionResumeOptions
 */
```

---

### 🟠 DUP-04 — `AgentInfo` typedef declarado em TRÊS lugares diferentes

**Arquivos:**

- `agent/agents.js`:
  `@typedef {{ name: string; displayName: string; description: string }} AgentInfo`
- `rpc/ops.js`: `@typedef {{ name: string; displayName: string; description: string }} AgentInfo`
- `rpc/session-facade.js`:
  `@typedef {{ name: string; displayName: string; description: string }} AgentInfo`

Três declarações idênticas do mesmo typedef. Se o SDK mudar o shape de AgentInfo, precisará ser
atualizado em 3 lugares.

**Ação:** Mover para `types.js` como canonical e importar nos outros módulos via
`@typedef {import('./types.js').AgentInfo} AgentInfo`.

---

### 🟡 DUP-05 — `CompactionCompactResult` declarado em `rpc/ops.js` E implicitamente em `rpc/session-facade.js`

**Arquivos:** `rpc/ops.js` e `rpc/session-facade.js`

`CompactionResult` em `session-facade.js` e `CompactionCompactResult` em `ops.js` têm o mesmo shape
`{ success: boolean; tokensRemoved: number; messagesRemoved: number }` mas nomes diferentes.

---

### 🟡 DUP-06 — `ModelInfo` typedef em `rpc/server.js` duplica `@github/copilot-sdk`.ModelInfo

**Arquivo:** `rpc/server.js`

```js
/**
 * @typedef {{
 *     id: string;
 *     name: string;
 *     capabilities: { ... };
 *     // ...
 * }} ModelInfo
 */
```

Este typedef local de `ModelInfo` em `rpc/server.js` duplica o `ModelInfo` importado de
`@github/copilot-sdk` que já está em `types.js`. Pode causar discrepâncias se o SDK adicionar
campos.

**Ação:** Remover o typedef local e usar `@typedef {import('../types.js').ModelInfo} ModelInfo`.

---

### 🟡 DUP-07 — `stringOr()`, `objectOrNull()`, `tsOrNow()` duplicados em vários módulos de eventos

**Arquivos:** `session/elicitation.js`, `session/permission-events.js`, `session/session-events.js`,
`session/user-input.js`

Cada módulo de normalização de eventos define suas próprias funções utilitárias `stringOr`,
`objectOrEmpty`/`objectOrNull`, `tsOrNow` com implementações ligeiramente diferentes. São ~40 linhas
de código duplicado.

**Ação:** Criar `session/event-normalize-utils.js` com essas funções compartilhadas.

---

### 🟡 DUP-08 — `log()` re-exportado de `session/hook-logger.js` via `session/index.js` conflita com `log()` de `logger.js`

**Arquivo:** `session/index.js`

```js
export { clearHooksLogger, log, setHooksLogger } from './hook-logger.js';
```

O `log` de `hook-logger.js` tem assinatura `(level, msg, meta)` mas é re-exportado no barrel
`session/`, potencialmente colidindo com imports de `logger.js` que tem `log(level, msg, meta)`
idêntico. Consumers podem importar o `log` errado dependendo do caminho de importação.

**Ação:** Renomear o export:

```js
export { clearHooksLogger, log as hooksLog, setHooksLogger } from './hook-logger.js';
```

---

### 🟡 DUP-09 — `resolveSessionAutoModelFromCatalog` em `models/session-resolution-adapter.js` é wrapper trivial

**Arquivo:** `models/session-resolution-adapter.js`

```js
export async function resolveSessionAutoModelFromCatalog(fallback) {
    return createSessionAutoModelResolver()(fallback);
}
```

Essa função cria um resolver, chama-o e descarta. É equivalente a chamar `resolveModelIdAuto`
diretamente. A abstração em dois níveis (`createSessionAutoModelResolver` →
`resolveSessionAutoModelFromCatalog`) adiciona indireção sem benefício claro.

---

## 4. Problemas de TypeCheck Strict

### 🟠 TC-01 — `session/client.js`: `#startPromise` tipado como `Promise<CopilotClient> | null` mas pode resolver para throw

A tipagem de `#startPromise` não captura o fato de que pode rejeitar. Em `getClient()`, o resultado
de `#startPromise` é retornado diretamente — se a Promise rejeitar, o erro não é tipado como
`SdkOperationError`.

---

### 🟠 TC-02 — `tools/core.js`: `ToolParameterInput<T>` inclui `Record<string, unknown>` quebrando `noUncheckedIndexedAccess`

Com `noUncheckedIndexedAccess: true`, acessos a `Record<string, unknown>` precisam de `undefined`
checado. O uso de `Record<string, unknown>` como parâmetro aceito em `tryZodToJsonSchema` pode
falhar no typecheck estrito.

---

### 🟠 TC-03 — `rpc/experimental.js`: `requireRpcMethod()` retorna type com `NonNullable<...>` aninhado que falha com `exactOptionalPropertyTypes`

O tipo de retorno de `requireRpcMethod` usa `NonNullable<NonNullable<...>[M]>` que pode não
satisfazer `exactOptionalPropertyTypes: true` quando os métodos têm parâmetros opcionais.

---

### 🟡 TC-04 — `session/lifecycle.js`: `buildSessionConfig()` retorna union com `{ disableResume?: boolean }` não presente em `SessionConfig`

```js
return /** @type {import('@github/copilot-sdk').SessionConfig} */ (cfg);
```

O cast para `SessionConfig` do SDK descarta `disableResume` do tipo. Com `verbatimModuleSyntax`, o
cast deveria ser explícito e documentado.

---

### 🟡 TC-05 — `models/known-models.js`: cast excessivo `/** @type {CostTier} */ ('high')` em cada entry

Com 31 entradas no catálogo, há ~62 casts manuais de `CostTier` e `SpeedTier`. Com
`erasableSyntaxOnly`, isso é verboso e propenso a erro. Usar `as const` no objeto seria mais seguro.

---

## 5. Questões Arquiteturais

### 🔴 ARQ-01 — Ausência de `AbortController` como mecanismo padrão nas operações longas de RPC

**Contexto:** `rpc/ops.js`, `rpc/session.js`, `session/runtime.js`

Nenhuma operação de RPC (shellExec, planUpdate, etc.) aceita `AbortSignal`. Em cenários onde o
servidor WebSocket cai durante uma operação longa, a Promise fica pendente indefinidamente sem forma
de cancelamento.

**Proposta:** Adicionar `signal?: AbortSignal` como parâmetro opcional em todas as funções RPC que
executam operações longas:

```js
export async function shellExec(session, command, options) {
    const { cwd, timeout, signal } = options ?? {};
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    // ...
    const result = await Promise.race([
        session.rpc.shell.exec(params),
        signal ? new Promise((_, r) => signal.addEventListener('abort', () => r(new DOMException('Aborted', 'AbortError')), { once: true })) : never(),
    ]);
}
```

---

### 🟠 ARQ-02 — `defaultClientManager` é singleton de módulo mas não é lazy — inicializa circuit breaker na importação

**Arquivo:** `session/client.js`

```js
export const defaultClientManager = new CopilotClientManager({
    breaker: sdkConnectionCircuitBreaker,
    registry: defaultSdkSessionRegistry,
});
```

Isso significa que importar `#copilot/sdk/session` cria instâncias de `CircuitBreaker` e
`SdkSessionRegistry` imediatamente, mesmo em contextos de teste onde isso não é desejado. Em testes
unitários que importam helpers sem intenção de criar um client, o side effect de construção ocorre.

**Proposta:** Lazy initialization com `getDefaultClientManager()`:

```js
let _defaultManager = null;
function getDefaultClientManager() {
    if (!_defaultManager) {
        _defaultManager = new CopilotClientManager({ ... });
    }
    return _defaultManager;
}
export function getClient(overrides = {}) {
    return getDefaultClientManager().getClient(overrides);
}
```

---

### 🟠 ARQ-03 — `sdk/index.js` (barrel raiz) mistura exports de runtime e side effects implícitos

**Arquivo:** `sdk/index.js`

A importação:

```js
import { createTool as createToolCore, createToolSync as createToolSyncCore } from './tools/core.js';
```

E as funções wrapper `createTool`/`createToolSync` definidas inline no barrel adicionam **code
splitting penalty**: qualquer import de `#copilot/sdk` carrega `tools/core.js`, `zod-to-json-schema`
resolver, etc., mesmo quando o consumer só precisa de `SESSION_EVENTS`.

**Proposta:** Mover `createTool`/`createToolSync` para re-exports diretos sem wrapper:

```js
export { createTool, createToolSync } from './tools/core.js';
```

O wrapping (que adiciona zero comportamento além do forwarding) é desnecessário.

---

### 🟠 ARQ-04 — `module-map.js` lista `persistent-paths.js` como módulo público mas ele importa `#copilot/boot`

**Arquivo:** `module-map.js` e `persistent-paths.js`

O `SDK_MODULE_LAYOUT` lista `persistent-paths.js` como `public: true`, mas o módulo importa
`#copilot/boot`:

```js
import { resolvePersistentConfigFile as resolvePersistentConfigFileFromBoot } from '#copilot/boot';
```

Isso viola o contrato arquitetural descrito no README ("Importações proibidas: terminal/ como
dependency direta da camada SDK"). Embora `boot` seja permitido, a dependência runtime em importação
top-level de um barrel largo como `#copilot/boot` (que pode carregar SQLite, etc.) aumenta o custo
de boot do SDK.

**Proposta:** Usar importação dinâmica lazy ou receber o path como parâmetro injetado:

```js
export function resolvePersistentConfigFile(name) {
    assertSafePersistentFileName(name);
    const { resolvePersistentConfigFile: resolveFn } =
        /** @type {any} */ (require('#copilot/boot/contract'));
    return resolveFn(name);
}
```

---

### 🟡 ARQ-05 — `SDK_LAYER_ACCESS_POLICY` em `module-map.js` não é executável — é apenas documentação

O `SDK_LAYER_ACCESS_POLICY` descreve quais camadas podem usar quais surfaces, mas não há lint rules,
testes ou verificações automatizadas que enforcem essas políticas. O README menciona `module-map.js`
como "contrato verificável" mas não há mecanismo de enforcement.

**Proposta:** Criar um script de auditoria:

```js
// scripts/audit-sdk-imports.js
import { SDK_LAYER_ACCESS_POLICY } from './src/copilot/sdk/module-map.js';
// Varrer imports de cada camada e verificar contra a política
```

---

### 🟡 ARQ-06 — `KNOWN_MODELS` em `known-models.js` tem entradas duplicadas com IDs variantes não-canônicos

**Arquivo:** `models/known-models.js`

O catálogo tem:

- `claude-sonnet-4-5` E `claude-sonnet-4.5` (IDs diferentes, aliases sobrepostos)
- `claude-opus-4-5` E `claude-opus-4.5`
- `claude-haiku-4-5` E `claude-haiku-4.5`

Isso significa que `modelRegistry.all()` retorna 6 entradas para 3 modelos lógicos. Os aliases de um
contêm o ID do outro como alias, criando um grafo de aliases circular potencial.

**Proposta:** Escolher um ID canônico por modelo (preferencialmente com ponto, que é o formato
oficial Anthropic) e manter o outro apenas como alias:

```js
{
    id: 'claude-sonnet-4.5',
    // ...
    aliases: ['claude-sonnet-4-5', 'claude-4.5-sonnet', 'sonnet-4.5'],
},
// Remover a entrada claude-sonnet-4-5 como ID principal
```

---

### 🟡 ARQ-07 — `telemetry/operation-metrics.js` é um singleton de módulo sem suporte a múltiplos emitters

A função `setSdkMetricEmitter` define um único emitter global. Em ambientes onde diferentes
componentes precisam de telemetria separada (ex: servidor HTTP + agent principal), não há como ter
dois consumers de métricas.

**Proposta:** Suportar múltiplos emitters com `addSdkMetricEmitter`:

```js
const _emitters = new Set();
export function addSdkMetricEmitter(emitter) {
    if (typeof emitter === 'function') _emitters.add(emitter);
    return () => _emitters.delete(emitter);
}
export function emitSdkOperationMetric(metric) {
    for (const emit of _emitters) {
        try { emit(metric); } catch (e) { /* log */ }
    }
}
```

---

### 🟡 ARQ-08 — Não há estratégia de retry configurável nos wrappers RPC individuais

Os wrappers em `rpc/session.js` e `rpc/ops.js` não fazem retry. O retry está apenas na camada de
criação de client (`session/client.js`) e criação de sessão (`session/lifecycle.js`). Operações RPC
individuais como `planUpdate` ou `modelSwitchTo` que falham por timeout de rede não têm retry
automático.

**Proposta:** Adicionar `RetryPolicy` configurável por operação via injeção no
`CopilotClientManager`.

---

## 6. Features Experimentais Não Implementadas

### 🟠 EXP-01 — `rpc/experimental.js` não inclui `agent.*` mas a surface experimental diz que não deve

O README e `module-map.js` explicitamente dizem que `rpc/experimental` **não inclui `agent.*`** — os
wrappers de agent estão em `agent/agents.js`. Porém, do ponto de vista do consumer,
`agent.list/select/deselect` são chamadas RPC que passam por `session.rpc.agent.*`, que é uma API
experimental do SDK. A separação é arquiteturalmente correta mas pode confundir desenvolvedores que
esperam encontrar tudo relacionado a "experimental" em `rpc/experimental.js`.

**Proposta:** Adicionar nota explícita em `rpc/experimental.js`:

```js
/**
 * @note Agent RPC wrappers estão em `sdk/agent/agents.js`, não aqui.
 * Esta surface cobre: fleet, skills, mcp, plugins, extensions.
 */
```

---

### 🟠 EXP-02 — Sem implementação de `session.rpc.fleet` além do wrapper em `experimental.js`

`fleetStart()` existe em `experimental.js` mas não há:

- `fleetStop()`
- `fleetStatus()`
- Integração com `AgentToolPolicy`

O SDK pode ter mais métodos no namespace `fleet`.

---

### 🟠 EXP-03 — `session.rpc.skills` tem `skillsReload()` mas sem `skillsGet()` para inspecionar skill individual

O SDK provavelmente expõe `skills.get(name)` além de `skills.list()`. Não está implementado.

---

### 🟡 EXP-04 — `session.rpc.extensions` não tem wrapper para `extensions.getStatus(id)` ou `extensions.getLogs(id)`

O SDK 0.3.0 pode expor status detalhado e logs de extensões individuais além de
list/enable/disable/reload.

---

### 🟡 EXP-05 — Sem implementação de `session.rpc.plugins.install()` / `plugins.uninstall()`

O marketplace de plugins do Copilot provavelmente expõe install/uninstall além de list.

---

## 7. Melhorias de Performance e Robustez

### 🟠 PERF-01 — `session/session-fs.js`: `resolveWithinRoot()` é async e chama `evaluateIoPathPolicyAsync` para CADA operação de I/O

Em loops de alto volume (ex: agente varrendo estrutura de diretório), cada `readFile`, `writeFile`,
`exists` etc. faz uma chamada assíncrona para validação de política de I/O. Isso pode adicionar
latência significativa.

**Proposta:** Cache de políticas válidas com TTL curto (5s) por path normalizado.

---

### 🟡 PERF-02 — `tools/custom.js`: `ensureCustomToolsLoadedSync()` usa `readFileSync` bloqueando o event loop

**Arquivo:** `tools/custom.js`

`ensureCustomToolsLoadedSync()` usa `readFileSync` que bloqueia o event loop Node. Em contextos de
servidor HTTP com alto load, chamar `buildCustomTools()` ou `getCustomToolDefinitions()` na thread
principal pode causar jank.

**Proposta:** O `initCustomTools()` assíncrono já existe — garantir que seja sempre chamado no
bootstrap antes de qualquer chamada síncrona.

---

### 🟡 PERF-03 — `models/registry.js`: `ModelRegistry.all()` retorna array novo a cada chamada

```js
all() {
    return [...this.#catalog.values()];
}
```

Em hot paths (seleção de modelo a cada turn), criar um novo array a cada chamada adiciona pressure
de GC. Com o catálogo tendo ~30 entradas, o impacto é mínimo mas pode ser otimizado com memoização
invalidada em `register()`.

---

### 🟡 ROB-01 — `session/lifecycle.js`: `reconnectClientBestEffort()` não tem timeout

```js
async function reconnectClientBestEffort(client, operation) {
    try {
        await client.start(); // sem timeout!
```

Se `client.start()` travar (servidor CLI não responde), o retry vai aguardar indefinidamente.

**Proposta:**

```js
const RECONNECT_TIMEOUT_MS = 5_000;
await Promise.race([
    client.start(),
    new Promise((_, r) => setTimeout(() => r(new Error('reconnect timeout')), RECONNECT_TIMEOUT_MS)),
]);
```

---

## 8. Tabela Consolidada de Ações

| ID      | Categoria          | Severidade | Arquivo Principal                                        | Ação Proposta                                       |
| ------- | ------------------ | ---------- | -------------------------------------------------------- | --------------------------------------------------- |
| BUG-01  | Bug Runtime        | 🔴 Crítico | `session/tool-session-context.js`                        | Fix acesso a campo estático privado                 |
| BUG-02  | Bug Runtime        | 🔴 Crítico | `rpc/ops.js`                                             | Fix bind em getCompactionMethod                     |
| BUG-03  | Bug Concorrência   | 🔴 Crítico | `session/client.js`                                      | Fix race em #connect finally                        |
| BUG-04  | Semântica          | 🟠 Alto    | `session/lifecycle.js`                                   | Deprecar resolveSessionCreateModel                  |
| BUG-05  | Concorrência       | 🟠 Alto    | `models/helpers.js`                                      | Deduplicar requests em voo                          |
| BUG-06  | Ordem de Operações | 🟠 Alto    | `tools/custom.js`                                        | Fix ordem no _resetRegistry                         |
| BUG-07  | Segurança          | 🟠 Alto    | `session/permissions.js`                                 | Mover kind para constante                           |
| BUG-08  | Robustez           | 🟠 Alto    | `rpc/session.js`                                         | Validar métodos em getWorkspaceRpc                  |
| BUG-09  | Robustez           | 🟠 Alto    | `session/hook-bus.js`                                    | Separar try/catch por emissão                       |
| BUG-10  | Runtime            | 🟡 Médio   | `models/selector.js`                                     | Tratar costTier/speedTier unknown                   |
| BUG-11  | Compatibilidade    | 🟡 Médio   | `session/elicitation.js`                                 | Usar node:crypto                                    |
| BUG-12  | UX                 | 🟡 Médio   | `telemetry/quota-monitor.js`                             | Adicionar onError callback                          |
| BUG-13  | API                | 🟡 Médio   | `tools/registry.js`                                      | Completar IToolRegistry adapter                     |
| BUG-14  | Correctness        | 🟡 Médio   | `session/runtime.js`                                     | Retry na verificação de modelo                      |
| BUG-15  | Data Loss          | 🟡 Médio   | `rpc/ops.js`                                             | Não descartar resultado de deselect                 |
| BUG-16  | UX                 | 🟡 Médio   | `session/client-events.js`                               | Melhorar mensagem de erro                           |
| BUG-17  | API                | 🟡 Médio   | `tools/custom.js`                                        | Adicionar isCustomToolsBuilderReady                 |
| GAP-01  | API                | 🔴 Crítico | `types.js`                                               | Documentar history namespace                        |
| GAP-02  | API                | 🔴 Crítico | `sdk/index.js`                                           | Exportar clearModelsCache                           |
| GAP-03  | Feature            | 🟠 Alto    | `rpc/session.js`                                         | Wrapper snapshot.rewind                             |
| GAP-04  | Feature            | 🟠 Alto    | `rpc/session.js`                                         | Wrapper backgroundTasks                             |
| GAP-05  | Feature            | 🟠 Alto    | `rpc/session.js`                                         | Wrapper context.get                                 |
| GAP-06  | Tipos              | 🟠 Alto    | `types.js`                                               | Tipar onEvent handler                               |
| GAP-07  | Feature            | 🟠 Alto    | `session/capabilities.js`                                | Mais helpers de capability                          |
| GAP-08  | Compat             | 🟠 Alto    | `session/session-fs.js`                                  | Suporte a getFile alias                             |
| GAP-09  | Feature            | 🟡 Médio   | `types.js`                                               | MCPServerConfig com auth/OAuth                      |
| GAP-10  | Feature            | 🟡 Médio   | `rpc/`                                                   | Wrapper pending messages                            |
| GAP-11  | Feature            | 🟡 Médio   | `rpc/`                                                   | Wrapper subagent                                    |
| GAP-12  | API                | 🟡 Médio   | `session/client-options.js`                              | Método sessionStatePath no builder                  |
| DUP-01  | Duplicidade        | 🟠 Alto    | `session/capabilities.js`, `session/ui.js`               | Unificar getSessionCapabilities                     |
| DUP-02  | Duplicidade        | 🟠 Alto    | múltiplos                                                | Centralizar guards                                  |
| DUP-03  | Duplicidade        | 🟠 Alto    | `session/lifecycle.js`                                   | Extrair SessionBaseOptions                          |
| DUP-04  | Duplicidade        | 🟡 Médio   | `agent/agents.js`, `rpc/ops.js`, `rpc/session-facade.js` | Centralizar AgentInfo em types.js                   |
| DUP-05  | Duplicidade        | 🟡 Médio   | `rpc/ops.js`, `rpc/session-facade.js`                    | Unificar CompactionResult                           |
| DUP-06  | Duplicidade        | 🟡 Médio   | `rpc/server.js`                                          | Remover ModelInfo local                             |
| DUP-07  | Duplicidade        | 🟡 Médio   | múltiplos event normalizers                              | Extrair event-normalize-utils.js                    |
| DUP-08  | Ambiguidade        | 🟡 Médio   | `session/index.js`                                       | Renomear re-export de log                           |
| DUP-09  | Duplicidade        | 🟡 Médio   | `models/session-resolution-adapter.js`                   | Simplificar resolveSessionAutoModelFromCatalog      |
| TC-01   | TypeCheck          | 🟠 Alto    | `session/client.js`                                      | Tipar rejeição de #startPromise                     |
| TC-02   | TypeCheck          | 🟠 Alto    | `tools/core.js`                                          | Fix ToolParameterInput com noUncheckedIndexedAccess |
| TC-03   | TypeCheck          | 🟠 Alto    | `rpc/experimental.js`                                    | Fix requireRpcMethod com exactOptionalPropertyTypes |
| TC-04   | TypeCheck          | 🟡 Médio   | `session/lifecycle.js`                                   | Cast explícito de disableResume                     |
| TC-05   | TypeCheck          | 🟡 Médio   | `models/known-models.js`                                 | Reduzir casts com as const                          |
| ARQ-01  | Arquitetura        | 🔴 Crítico | `rpc/*`                                                  | AbortSignal em operações longas                     |
| ARQ-02  | Arquitetura        | 🟠 Alto    | `session/client.js`                                      | Lazy initialization do defaultClientManager         |
| ARQ-03  | Arquitetura        | 🟠 Alto    | `sdk/index.js`                                           | Remover wrappers triviais no barrel                 |
| ARQ-04  | Arquitetura        | 🟠 Alto    | `persistent-paths.js`                                    | Lazy import de #copilot/boot                        |
| ARQ-05  | Governança         | 🟡 Médio   | `module-map.js`                                          | Script de auditoria de imports                      |
| ARQ-06  | Dados              | 🟡 Médio   | `models/known-models.js`                                 | Deduplicar entradas claude-*-4-5 vs 4.5             |
| ARQ-07  | Extensibilidade    | 🟡 Médio   | `telemetry/operation-metrics.js`                         | Múltiplos emitters                                  |
| ARQ-08  | Robustez           | 🟡 Médio   | `rpc/*`                                                  | RetryPolicy configurável por operação               |
| EXP-01  | Experimental       | 🟠 Alto    | `rpc/experimental.js`                                    | Nota sobre agent.* separado                         |
| EXP-02  | Experimental       | 🟠 Alto    | `rpc/experimental.js`                                    | fleetStop/fleetStatus                               |
| EXP-03  | Experimental       | 🟡 Médio   | `rpc/experimental.js`                                    | skillsGet                                           |
| EXP-04  | Experimental       | 🟡 Médio   | `rpc/experimental.js`                                    | extensionsGetStatus/getLogs                         |
| EXP-05  | Experimental       | 🟡 Médio   | `rpc/experimental.js`                                    | pluginsInstall/Uninstall                            |
| PERF-01 | Performance        | 🟠 Alto    | `session/session-fs.js`                                  | Cache de políticas de I/O                           |
| PERF-02 | Performance        | 🟡 Médio   | `tools/custom.js`                                        | Evitar readFileSync em hot paths                    |
| PERF-03 | Performance        | 🟡 Baixo   | `models/registry.js`                                     | Memoizar all()                                      |
| ROB-01  | Robustez           | 🟡 Médio   | `session/lifecycle.js`                                   | Timeout em reconnectClientBestEffort                |

---

## 9. Propostas de Correção — Código

### Fix BUG-01: `tool-session-context.js`

```js
// ANTES (linha ~final de snapshot()):
hasBroadcastSse: this.#broadcastSse !== ToolSessionContext.#noopSse,

// DEPOIS:
// Adicionar ao constructor e configureBroadcastSse:
/** @type {boolean} */
#hasBroadcastSseConfigured = false;

configureBroadcastSse(fn) {
    if (typeof fn !== 'function') return;
    this.#broadcastSse = fn;
    this.#hasBroadcastSseConfigured = true; // ← ADICIONADO
}

snapshot() {
    return {
        sessionId: this.#sessionId,
        pendingInputCount: this.#pendingInputResolvers.size,
        pendingInputIds: [...this.#pendingInputResolvers.keys()],
        hasBroadcastSse: this.#hasBroadcastSseConfigured, // ← CORRIGIDO
    };
}
```

---

### Fix BUG-02: `rpc/ops.js` — `getCompactionMethod`

```js
// DEPOIS:
function getCompactionMethod(session) {
    const rpc = /** @type {Record<string, any>} */ (session.rpc);

    if (rpc['history'] && typeof rpc['history']['compact'] === 'function') {
        return () => /** @type {Promise<CompactionCompactResult>} */ (rpc['history']['compact']());
    }
    if (rpc['compaction'] && typeof rpc['compaction']['compact'] === 'function') {
        return () => /** @type {Promise<CompactionCompactResult>} */ (rpc['compaction']['compact']());
    }
    throw new TypeError('[sdk/rpc/compaction.compact] RPC de compaction indisponível (history/compaction).');
}
```

---

### Fix BUG-07: `constants.js` — Adicionar PERMISSION_KINDS

```js
// Adicionar em constants.js após PERMISSION_COMPLETED_KINDS:

/** Kinds de requisição de permissão emitidos pelo SDK. */
export const PERMISSION_KINDS = /** @type {const} */ ({
    SHELL: 'shell',
    WRITE: 'write',
    READ: 'read',
    MCP: 'mcp',
    URL: 'url',
    CUSTOM_TOOL: 'custom-tool',
    MEMORY: 'memory',
    HOOK: 'hook',
    CONTENT_EXCLUSION_CHECK: 'content-exclusion-check',
});
```

```js
// Em session/permissions.js, substituir:
if (kind === 'content-exclusion-check') {
// Por:
import { PERMISSION_KINDS } from '../constants.js';
if (kind === PERMISSION_KINDS.CONTENT_EXCLUSION_CHECK) {
```

---

### Fix DUP-07: Novo arquivo `session/event-normalize-utils.js`

```js
// @ts-check
/**
 * Utilitários compartilhados para normalização de eventos SDK.
 * @module copilot/sdk/session/event-normalize-utils
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function objectOrEmpty(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
export function objectOrNull(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
export function stringOr(value, fallback) {
    return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function tsOrNow(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

/**
 * @param {unknown} value
 * @returns {boolean | null}
 */
export function boolOrNull(value) {
    return typeof value === 'boolean' ? value : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function arrayOfStrings(value) {
    return Array.isArray(value)
        ? value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
        : [];
}
```

---

### Fix GAP-03: `rpc/session.js` — Wrapper para snapshot.rewind

```js
/**
 * Reverte a sessão para um snapshot anterior (SDK 0.3.0).
 * @see SESSION_SNAPSHOT_REWIND event em constants.js
 *
 * @param {CopilotSession} session
 * @param {string} snapshotId - ID do snapshot a restaurar
 * @returns {Promise<{ success: boolean; snapshotId: string }>}
 */
export async function snapshotRewind(session, snapshotId) {
    assertRpcSession(session, 'snapshot.rewind');
    if (typeof snapshotId !== 'string' || snapshotId.length === 0) {
        throw new TypeError('[sdk/rpc/snapshot.rewind] snapshotId deve ser string não-vazia.');
    }
    appLog('INFO', `[sdk/rpc] snapshot.rewind: snapshotId='${snapshotId}', sessionId='${session.sessionId}'`);
    const rpc = /** @type {{ snapshot?: { rewind?: (params: { snapshotId: string }) => Promise<unknown> } }} */ (session.rpc);
    if (typeof rpc.snapshot?.rewind !== 'function') {
        throw new TypeError('[sdk/rpc/snapshot.rewind] RPC indisponível nesta versão do SDK.');
    }
    try {
        return /** @type {{ success: boolean; snapshotId: string }} */ (await rpc.snapshot.rewind({ snapshotId }));
    } catch (error) {
        throw toSdkOperationError('snapshot.rewind', error);
    }
}
```

---

### Fix ARQ-06: `models/known-models.js` — Deduplicação das entradas claude-*

```js
// REMOVER as entradas com hífens (ex: claude-sonnet-4-5)
// MANTER apenas as com pontos (ex: claude-sonnet-4.5) como canônico
// ADICIONAR o ID com hífen como alias:

{
    id: 'claude-sonnet-4.5',
    costTier: 'high',
    speedTier: 'medium',
    contextWindow: 200_000,
    supportsReasoning: true,
    supportsVision: true,
    aliases: ['claude-sonnet-4-5', 'claude-4.5-sonnet', 'sonnet-4.5'], // hífen como alias
},
// Remover a entrada { id: 'claude-sonnet-4-5', ... } separada
```

Isso reduz o catálogo de 31 para ~25 entradas eliminando as duplicatas.

---

### Fix ARQ-01: Template para operações RPC com AbortSignal

```js
/**
 * Executa uma operação RPC com suporte a AbortSignal.
 * @template T
 * @param {() => Promise<T>} operation
 * @param {AbortSignal | undefined} signal
 * @param {string} operationName
 * @returns {Promise<T>}
 */
async function withAbortSignal(operation, signal, operationName) {
    if (signal?.aborted) {
        throw new DOMException(`[sdk/rpc] ${operationName} abortada antes de iniciar`, 'AbortError');
    }
    if (!signal) return operation();

    return new Promise((resolve, reject) => {
        const onAbort = () => reject(new DOMException(`[sdk/rpc] ${operationName} abortada`, 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
        operation().then(resolve, reject).finally(() => {
            signal.removeEventListener('abort', onAbort);
        });
    });
}

// Uso em shellExec:
export async function shellExec(session, command, options) {
    // ...
    const result = await withAbortSignal(
        () => session.rpc.shell.exec(params),
        options?.signal,
        'shell.exec'
    );
    // ...
}
```

---

## Observações Finais

### Pontos Fortes a Preservar

1. **Circuit breaker em client.js** — implementação correta e bem integrada com
   `getSdkRecoveryPolicy`
2. **`normalizeToolParametersSchema()`** — tratamento multi-versão Zod (v3/v4) é sofisticado e
   correto
3. **`buildSessionConfig()` em lifecycle.js** — uso de `if (field !== undefined)` em vez de spread
   evita sobrescrever valores do SDK com `undefined`
4. **Pattern de porta em `model-resolution-port.js`** — evita ciclo estático models/session
   corretamente
5. **`HookBus.emitHook()`** — integração bidirecional com EventBus local é uma boa separação
6. **`createLocalSessionFsProvider()`** — implementação defensiva com path traversal protection

### Prioridade de Implementação Sugerida

**Sprint 1 (Crítico — antes de próximo release):**

- BUG-01, BUG-02, BUG-03
- GAP-01, GAP-02
- ARQ-01 (AbortSignal pelo menos em shellExec)

**Sprint 2 (Alta prioridade):**

- BUG-04 a BUG-09
- DUP-01, DUP-02, DUP-03
- GAP-03, GAP-04, GAP-05
- ARQ-02, ARQ-03

**Sprint 3 (Melhoria contínua):**

- Restante dos DUPs, TCs, GARPs e EXPs
- Script de auditoria (ARQ-05)
- Deduplicação KNOWN_MODELS (ARQ-06)

---

_Análise gerada com base nos 69 arquivos de `src/copilot/sdk/` em 2026-05-14._
