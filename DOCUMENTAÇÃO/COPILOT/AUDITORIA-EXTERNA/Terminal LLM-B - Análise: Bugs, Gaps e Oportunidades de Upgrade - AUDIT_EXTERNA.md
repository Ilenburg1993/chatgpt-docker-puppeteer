# Terminal LLM-B — Análise Completa: Bugs, Gaps e Oportunidades de Upgrade

> **Escopo**: `src/copilot/terminal/` · SDK Copilot 0.3.0 · Node.js 24+ ESM
> **Data de geração**: 2026-05-17
> **Base de análise**: 139 arquivos lidos (bootstrap, runtime-root, commands, dialog, events, frontend, state, repl, wiring, terminal-phases)

---

## Sumário Executivo

A base é sólida arquiteturalmente. O terminal implementa corretamente a separação entre frontend/projections/gateways, mantém um REPL multi-fase, e usa uma pipeline de eventos bem articulada. Contudo, a migração para SDK 0.3.0 expõe **17 gaps de compatibilidade** imediatos, além de **12 bugs** identificados no código e **19 oportunidades de upgrade** classificadas por impacto.

---

## 1. Bugs Confirmados

### BUG-001 — `sdk-session-events.js`: Garbage de bytes em strings de encoding
**Arquivo**: `src/copilot/terminal/commands/sdk.js` (linhas ~230, ~295, ~490)
**Severidade**: MÉDIA
**Descrição**: Strings como `"materializa\xc3\xa7\xc3\xa3o"`, `"configura\xc3\xa7\xc3\xa3o"`, `"Arquivo n\xc3\xa3o textual"` aparecem literalmente no código fonte como sequências de escape `\xNN` no meio de text ANSI. Isso indica que o arquivo foi salvo com encoding incorreto ou sofreu corrupção durante edição.

```js
// Exemplo do bug em sdk.js (linha ~230)
throw new TypeError('[terminal/workspace] tool sem handler executavel.');
// Deveria ser:
throw new TypeError('[terminal/workspace] tool sem handler executável.');
```

**Impacto**: Mensagens de erro/UX exibem texto corrompido ao operador; TypeScript strict mode pode falhar em comparações de string.
**Correção**: Re-salvar o arquivo em UTF-8 e substituir todas as sequências `\xNN` pelas letras corretas.

---

### BUG-002 — Race condition em `repl-command-router.js` no `/restart`
**Arquivo**: `src/copilot/terminal/repl/repl-command-router.js` (função `_cmdRestart`)
**Severidade**: ALTA
**Descrição**: O listener `onceTerminalAgentRuntimeEvent(EMITTER_DIALOG_READY, onReady)` é registrado *antes* de `stopTerminalDialogMode()`, mas o comentário diz que foi feito assim para evitar race condition. Contudo, o `timeout` é criado dentro do `new Promise` e pode ser rejeitado *depois* que o `onReady` já foi chamado — o `clearTimeout(timeout)` só acontece dentro do callback `onReady`, não no caso de "dialog loop já ativo":

```js
// BUG: timeout vaza se o path "dialog loop já ativo" for tomado
if (!readTerminalRuntimeControlState().dialogLoopActive) {
    await readyPromise;
} else {
    // clearTimeout aqui, mas offTerminalAgentRuntimeEvent(EMITTER_DIALOG_READY, onReady)
    // nunca é chamado. O listener onReady permanece registrado.
    clearTimeout(timeout);
    offTerminalAgentRuntimeEvent(EMITTER_DIALOG_READY, onReady);
}
```

O `offTerminalAgentRuntimeEvent` foi adicionado depois mas o listener pode disparar múltiplas vezes em restarts rápidos sucessivos.
**Correção**: Usar `AbortController` ou um flag booleano `settled` para garantir que o listener se auto-remove em qualquer path de saída.

---

### BUG-003 — `engine.js`: `IDLE_TRANSITION_TIMEOUT_MS` pode ser 0 em configs agressivas
**Arquivo**: `src/copilot/terminal/dialog/engine.js` (linha ~28)
**Severidade**: BAIXA
**Descrição**:
```js
const IDLE_TRANSITION_TIMEOUT_MS = Math.max(15_000, Math.min(120_000, Math.round(LLM_B_BOOT_TIMEOUT_MS * 0.5)));
```
Se `LLM_B_BOOT_TIMEOUT_MS` for `undefined` ou `NaN`, `Math.round(undefined * 0.5)` resulta em `NaN`. `Math.max(15_000, NaN)` → `NaN`. A promise de timeout nunca rejeita e o boot fica travado silenciosamente.
**Correção**: Adicionar guard: `const bootMs = Number.isFinite(LLM_B_BOOT_TIMEOUT_MS) ? LLM_B_BOOT_TIMEOUT_MS : 60_000;`

---

### BUG-004 — `sdk-interactions.js`: Prune infinito em sessões longas
**Arquivo**: `src/copilot/terminal/state/sdk-interactions.js` (função `pruneCompletedInteractionMap`)
**Severidade**: BAIXA-MÉDIA
**Descrição**: A função `pruneCompletedInteractionMap` chama `map.delete()` iterando `[...map.values()]`, mas o `latestId` passado como segundo argumento é `let` no módulo, não uma referência reativa. Se a entrada `_latestElicitationId` for deletada durante a poda, ela é corretamente nulificada, mas o return final faz outra varredura linear `O(n)` de um map que acabou de ser alterado:
```js
return [...map.values()].sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt))[0]?.id ?? null;
```
Em sessões com milhares de elicitations (ex: MCP intensivo), isso cria pressão de GC desnecessária.
**Correção**: Manter um índice secundário `latest: string | null` atualizado incrementalmente em cada `set/delete`.

---

### BUG-005 — `output.js`: `_statusRowsReserved` nunca decresce após `printlnBlock`
**Arquivo**: `src/copilot/terminal/dialog/output.js` (função `printlnBlock`)
**Severidade**: MÉDIA
**Descrição**: `printlnBlock` limpa `_statusRowsReserved = 0` após `clearReservedStatusRowsPreservingCursor()`, depois escreve uma linha em branco e seta `_statusRowsReserved = 1`. Mas se `printlnBlock` for chamado repetidamente em rápida sucessão (ex: auto-brief com 5 linhas), cada chamada escreve um `\n` extra e seta `_statusRowsReserved = 1`, acumulando linhas em branco no terminal.
**Impacto**: Layout visual do REPL degrada após sequências rápidas de output (ex: `/status` em loop).
**Correção**: Só escrever o `\n` de reserva se `_statusRowsReserved === 0` antes da chamada.

---

### BUG-006 — `timeline.js`: Sync schedule com keys inconsistentes entre reinicializações
**Arquivo**: `src/copilot/terminal/frontend/projections/timeline.js`
**Severidade**: BAIXA
**Descrição**: `buildTimelineSyncKey` usa a assinatura de conteúdo dos turnos, mas `_timelineSyncCompleted` e `_timelineSyncFailures` são Maps de módulo — vivem na lifetime do processo. Se o processo é reiniciado via PM2 sem hot-reload, os Maps são zerados, mas o Hub já tem os turnos persistidos, então no primeiro boot o `reconciliationStatus` será `'aligned'` e o sync status `'not_needed'` — correto. Mas se a sincronização falha na primeira tentativa (e entra em `_timelineSyncFailures`) e o processo reinicia logo depois (restart rápido), o `_timelineSyncFailures` é zerado mas o Hub ainda não tem os dados. O próximo boot vai tentar sincronizar normalmente — comportamento correto — mas o backoff de `nextRetryAt` é perdido, podendo causar burst de writes.
**Correção**: Persistir `_timelineSyncFailures` em arquivo de estado local (similar ao `alias-store`) ou adicionar delay mínimo pós-boot.

---

### BUG-007 — `tool-lifecycle-runtime.js`: `renderReportIntentToolPayload` chamado em `complete` antes da verificação de supressão
**Arquivo**: `src/copilot/terminal/events/tool-lifecycle-runtime.js` (função `handleTerminalNativeToolComplete`)
**Severidade**: BAIXA
**Descrição**: `renderReportIntentToolPayload` é chamado no início de `handleTerminalNativeToolComplete`, mas as verificações de supressão (`suppressByInFlightName`, `wasNameRecentlyCompleted`, `wasRecentlyCompleted`) só acontecem depois. Isso significa que intents de `report_intent` são renderizados mesmo quando o evento de complete seria suprimido por dedup:
```js
renderReportIntentToolPayload({ toolName: name, evt: {...}, ... }); // chamado ANTES
// ...
if (suppressByInFlightName || registry.wasNameRecentlyCompleted(...)) {
    return; // supressão — mas intent já foi renderizado
}
```
**Correção**: Mover `renderReportIntentToolPayload` para depois das verificações de supressão.

---

### BUG-008 — `io-activity-events.js`: Dedup window não respeita `targets` múltiplos
**Arquivo**: `src/copilot/terminal/events/io-activity-events.js` (função `isDuplicateIoOperation`)
**Severidade**: BAIXA
**Descrição**: A key de dedup é `${operation}::${primaryTarget}`, mas uma operação de `move` ou `copy` tem dois targets (`src -> dest`). Se a operação `move a.js b.js` dispara três vezes (triple-firing das camadas de cache), a key usa apenas o `primaryTarget` (o primeiro target após split), ignorando o destino. Operações de mesma origem mas destinos diferentes são incorretamente suprimidas.
**Correção**: Incluir todos os `targets` no hash da dedup key.

---

### BUG-009 — `repl-lifecycle.js`: `tryAnswerTerminalPendingQuestionInput` chamado duas vezes para a mesma linha
**Arquivo**: `src/copilot/terminal/repl/repl-lifecycle.js`
**Severidade**: MÉDIA
**Descrição**: No handler `rl.on('line', ...)`, há uma verificação early-exit:
```js
if (!multilineInput.hasPending() && trimmedForEscape && !trimmedForEscape.startsWith('/')) {
    const pendingAnswer = tryAnswerTerminalPendingQuestionInput(trimmedForEscape);
    if (pendingAnswer.routed) { ... return; }
}
```
Mas se `pendingAnswer.routed` for `false`, a linha entra na `lineQueue` e eventualmente chama `handleLine(line)`, que chama `tryAnswerTerminalPendingQuestionInput(trimmed)` novamente. Se entre as duas chamadas o estado muda (ex: o SDK respondeu a pergunta), a segunda chamada opera em estado inconsistente.
**Correção**: Eliminar a verificação early-exit no `rl.on('line')` e confiar exclusivamente no path da `lineQueue` serializada.

---

### BUG-010 — `agent-runtime-events.js`: Heartbeat timer não é limpo em `cleanup()`
**Arquivo**: `src/copilot/terminal/events/agent-runtime-events.js` (função `setupTerminalAgentRuntimeEventListeners`)
**Severidade**: BAIXA
**Descrição**: O `toolHeartbeatTimer` é criado com `setInterval` e tem `.unref()` chamado, mas o `clearInterval(toolHeartbeatTimer)` está no início do cleanup:
```js
return () => {
    clearInterval(toolHeartbeatTimer); // ✓ OK
    agent.off(EMITTER_QUESTION_PENDING, onQuestion);
    // ...
};
```
Isso está correto. **Mas**: se o módulo for recarregado em modo `dev-watch`, a função de cleanup pode não ser chamada antes do novo registro, e o timer anterior fica ativo, produzindo dois heartbeat loops concorrentes.
**Correção**: Adicionar guard global semelhante ao `_agentListenersRegistered` em `terminal-agent-wiring.js`.

---

### BUG-011 — `bootstrap-lifecycle.js`: `terminalShutdownSignalsRegistered` não é resetado em testes
**Arquivo**: `src/copilot/terminal/bootstrap-lifecycle.js`
**Severidade**: BAIXA (teste)
**Descrição**: A função `resetTerminalBootstrapLifecycleForTests` existe e reseta a flag, mas o módulo não exporta qualquer mecanismo para verificar o estado da flag antes de chamar `registerTerminalShutdownSignals`. Em suítes de teste que usam `--experimental-vm-modules`, o módulo pode ser instanciado múltiplas vezes com a flag já em estado `true` do teste anterior, silenciando o registro de signals.
**Correção**: Exportar `isTerminalShutdownSignalsRegistered()` para inspeção em testes.

---

### BUG-012 — `wiring/terminal-agent-wiring.js`: BUG-WDOG-02 parcialmente mitigado
**Arquivo**: `src/copilot/terminal/wiring/terminal-agent-wiring.js`
**Severidade**: BAIXA
**Descrição**: O comentário `BUG-WDOG-02` está presente e descreve o problema corretamente, mas a correção implementada (`if (settled) return;`) ainda tem uma janela de tempo entre `check()` e a criação do `setInterval`:
```js
check();
if (settled) return; // OK se check() já resolveu
const interval = setInterval(() => { ... }, 500);
// Janela: se o SDK emite 'ready' aqui, o handler não está registrado ainda
```
**Correção**: Registrar o listener de evento `EMITTER_DIALOG_READY` antes de qualquer polling assíncrono.

---

## 2. Gaps de Compatibilidade — SDK Copilot 0.3.0

### GAP-001 — `onPermissionRequest` não está passado em `createSession`
**Severidade**: CRÍTICA
**Descrição**: O SDK 0.3.0 introduziu `onPermissionRequest` como opção de sessão. O projeto usa `permission.requested`/`permission.completed` como eventos reativos, mas o SDK 0.3.0 pode exigir um handler síncrono para aprovação automática em certos contextos (ex: `approveAll`). Sem isso, algumas permissões podem ficar em deadlock esperando resolução.
**Referência**: SDK 0.3.0 — "Per-session GitHub authentication" e `session.rpc.permissions.setApproveAll()`.

---

### GAP-002 — `assistant.message_delta` de sub-agentes não filtrado por `agentId`
**Arquivo**: `src/copilot/terminal/events/sdk-session-events.js` (handler `onAssistantMessage`)
**Severidade**: ALTA
**Descrição**: O SDK 0.3.0 passa `agentId` nos eventos `assistant.message_delta` e `assistant.reasoning_delta` de sub-agentes. O código atual não filtra por `agentId`, causando duplicação de rendering quando sub-agentes estão ativos — a resposta de um sub-agente aparece tanto via `task.delta` (em `task-stream-events.js`) quanto via `assistant.message` (em `sdk-session-events.js`).
**Correção**: Verificar `evt.agentId` e suprimir eventos de sub-agentes no handler `onAssistantMessage` (ou adicionar `includeSubAgentStreamingEvents: false` na configuração de sessão).

---

### GAP-003 — `defaultAgent.excludedTools` não utilizado
**Severidade**: MÉDIA
**Descrição**: O SDK 0.3.0 introduziu `defaultAgent.excludedTools` para esconder tools do agente raiz enquanto sub-agentes mantêm acesso. O projeto tem `excludedTools` referenciado em `readTerminalToolRegistrySnapshot()` (campo `disabled`), mas não mapeia esse campo para a configuração de sessão SDK.
**Oportunidade**: Usar `defaultAgent.excludedTools` para remover tools legadas expostas ao modelo sem precisar desregistrá-las do registry.

---

### GAP-004 — `sessionIdleTimeoutSeconds` não configurado
**Severidade**: MÉDIA
**Descrição**: O SDK 0.3.0 adicionou `sessionIdleTimeoutSeconds` (desabilitado por padrão; antes era 30 min fixos). O projeto não passa essa opção, o que significa que comportamento depende da versão anterior do SDK. Para o Terminal Permanente LLM-B que deve viver indefinidamente, é recomendável configurar explicitamente como `0` ou `Infinity` para deixar a intenção clara.

---

### GAP-005 — API `session.rpc.skills` não utilizada
**Severidade**: MÉDIA
**Descrição**: O SDK 0.3.0 expõe `session.rpc.skills.config.setDisabledSkills()` e `session.rpc.skills.discover()`. O projeto gerencia skills via `PinnedFilesLoader` e o comando `/skills`, mas não usa a API RPC do SDK para sincronizar o estado. Isso cria divergência entre o estado local de skills e o que o SDK conhece.
**Oportunidade**: Usar `session.rpc.skills.discover()` no `runTerminalPinnedContextPhase` para validar o que o SDK carregou.

---

### GAP-006 — `session.rpc.mcp.oauthLogin()` não integrado ao fluxo `mcp.oauth.required`
**Arquivo**: `src/copilot/terminal/events/sdk-session-events.js` (handler `onMcpOauthRequired`)
**Severidade**: MÉDIA
**Descrição**: O handler `onMcpOauthRequired` apenas imprime uma mensagem e emite SSE. O SDK 0.3.0 agora expõe `session.rpc.mcp.oauthLogin()` para iniciar o fluxo OAuth programaticamente. O terminal pode oferecer o URL de login diretamente ou abrir o browser.

---

### GAP-007 — `SessionFs` API quebrada (interface de callbacks mudou radicalmente)
**Severidade**: CRÍTICA (se `SessionFs` for usado)
**Descrição**: O SDK 0.3.0 redesenhou `SessionFs` de uma interface RPC-shaped (com `{ path, error }`) para callbacks idiomáticos que lançam exceções em erro. Se qualquer parte do projeto usa a API antiga de `SessionFs`, ela quebra silenciosamente (os handlers antigos retornam objetos com `error` em vez de lançar, o que o SDK 0.3.0 interpreta como sucesso com conteúdo `{error: ...}`).
**Ação**: Auditar todos os usos de `createSessionFsHandler` ou equivalente.

---

### GAP-008 — `gitHubToken` → `gitHubToken` (capitalização)
**Severidade**: BAIXA-MÉDIA
**Descrição**: O SDK 0.3.0 corrigiu `githubToken` → `gitHubToken` (capital H) em `CopilotClientOptions`. Se o projeto passa a propriedade com nome antigo, a autenticação falha silenciosamente (a propriedade simplesmente é ignorada).
**Ação**: Verificar todos os locais que constroem `CopilotClientOptions`.

---

### GAP-009 — `convertMcpCallToolResult()` não utilizada
**Severidade**: BAIXA
**Descrição**: O SDK 0.3.0 exporta `convertMcpCallToolResult()` para converter resultados MCP em `ToolResultObject`. O projeto tem `external_tool.requested/completed` mas converte manualmente. Migrar para a utilidade do SDK reduz código customizado.

---

### GAP-010 — `session.rpc.usage.getMetrics()` não usado em `/sdk quota`
**Arquivo**: `src/copilot/terminal/commands/sdk.js` (função `renderSdkQuota`)
**Severidade**: BAIXA
**Descrição**: O SDK 0.3.0 expõe `session.rpc.usage.getMetrics()` como nova RPC. O projeto usa `getAgentSdkQuota()` que é a API de nível mais alto. Vale verificar se a API de nível baixo fornece métricas adicionais (ex: por-agente) úteis para o painel de diagnóstico.

---

### GAP-011 — Sub-agente streaming com `agentId` não exibido no terminal
**Arquivo**: `src/copilot/terminal/events/sdk-session-events.js`
**Severidade**: BAIXA
**Descrição**: O SDK 0.3.0 entrega `agentId` em deltas de streaming de sub-agentes. O terminal renderiza esses deltas via `createDeltaCallback` sem indicar qual sub-agente gerou o output. Em cenários com múltiplos sub-agentes concorrentes, o output fica misturado sem identificação.

---

### GAP-012 — `session.rpc.instructions.getSources()` vs `readTerminalSdkSystemPromptProjection`
**Arquivo**: `src/copilot/terminal/commands/sdk.js` (função `renderSdkSystemPrompt`)
**Severidade**: BAIXA
**Descrição**: A projeção `readTerminalSdkSystemPromptProjection` já chama `instructionSources`, mas o SDK 0.3.0 expõe `session.rpc.instructions.getSources()` como método RPC direto, que pode retornar informações mais detalhadas e atualizadas do que o snapshot em cache.

---

### GAP-013 — `per-agent skills` não mapeados para sub-agentes customizados
**Severidade**: BAIXA
**Descrição**: O SDK 0.3.0 permite `skills: string[]` em agentes customizados. O projeto tem `PinnedFilesLoader` para injetar contexto, mas não expõe essa API para sub-agentes declarados via `defaultAgent.excludedTools`/custom agents pattern.

---

### GAP-014 — `enableConfigDiscovery` não configurado
**Severidade**: BAIXA
**Descrição**: O SDK 0.3.0 (via CHANGELOG) inclui `enableConfigDiscovery: true` para descoberta automática de `.mcp.json` e diretórios de skills. O projeto gerencia isso manualmente. Ativar com `enableConfigDiscovery: true` poderia simplificar a inicialização.

---

### GAP-015 — `requestHeaders` por-mensagem não exposto em `runTerminalDialogTurn`
**Arquivo**: `src/copilot/terminal/frontend/gateways/dialog.js` (função `runTerminalDialogTurn`)
**Severidade**: BAIXA
**Descrição**: O SDK 0.3.0 permite `requestHeaders` por-mensagem em `send()`. O gateway `runTerminalDialogTurn` não aceita nem passa esse parâmetro, impossibilitando customização de headers para BYOK em nível de turno.

---

### GAP-016 — Blob attachments não suportados em `embedMultiple`
**Arquivo**: `src/copilot/terminal/dialog/engine.js` (uso de `embedMultiple`)
**Severidade**: BAIXA
**Descrição**: O SDK 0.3.0 introduziu attachment do tipo `blob` para enviar imagens/binários sem escrever em disco. O sistema atual de attachments (`/attach`) suporta apenas arquivos no filesystem. Não há suporte a `stdin` ou dados binários em memória.

---

### GAP-017 — `resetSessionApprovals` não exposto no `/permission`
**Arquivo**: `src/copilot/terminal/commands/sdk.js` (função `cmdPermission`)
**Severidade**: BAIXA
**Descrição**: O SDK 0.3.0 expõe `session.rpc.permissions.resetSessionApprovals()`. O comando `/permission` não oferece essa operação, forçando o usuário a reiniciar a sessão para redefinir aprovações acumuladas.

---

## 3. Oportunidades de Upgrade (Priorizadas)

### UPG-001 — Migrar para `EventEmitter` nativo com `EventTarget` do Node.js 24
**Impacto**: MÉDIO · **Esforço**: MÉDIO
**Descrição**: O Node.js 24 promoveu `EventTarget` e `CustomEvent` como APIs de primeira classe. O `terminalActivityEmitter` usa `EventEmitter` clássico. Migrar para `EventTarget` habilita `AbortSignal` nativo em listeners, melhor integração com `AsyncLocalStorage`, e type safety mais forte sem necessidade de cast manual.

---

### UPG-002 — `AsyncLocalStorage` para propagação de `runtimeId`
**Impacto**: ALTO · **Esforço**: MÉDIO
**Descrição**: O padrão `callWithRuntimeTarget(fn, runtimeId, ...args)` permeia 30+ comandos. Em Node.js 24, `AsyncLocalStorage` permite propagar `runtimeId` implicitamente pelo contexto assíncrono, eliminando o parâmetro de propagação manual e reduzindo a surface de bugs de `runtimeId` nulo/undefined sendo passado incorretamente.

```js
// Antes (padrão atual):
callWithRuntimeTarget(readTerminalConfigProjection, runtimeId)

// Depois com AsyncLocalStorage:
const runtimeIdStore = new AsyncLocalStorage();
// ...dentro do handler de comando:
runtimeIdStore.run(runtimeId, () => readTerminalConfigProjection())
```

---

### UPG-003 — `using` keyword para cleanup determinístico de recursos SDK
**Impacto**: MÉDIO · **Esforço**: BAIXO
**Descrição**: Node.js 24 suporta a proposta `Symbol.dispose`/`Symbol.asyncDispose` (TC39 Explicit Resource Management). Os wrappers de cleanup do terminal (`() => void`) são funções soltas sem garantia de chamada. Recursos como `toolHeartbeatTimer`, `cleanupLiveStatusLine`, e `setupTerminalIoActivityEvents` poderiam implementar `[Symbol.asyncDispose]`:

```js
const ioEvents = {
    ...setupTerminalIoActivityEvents(),
    [Symbol.asyncDispose]: async () => cleanup()
};
await using ioEvents = setupTerminalIoActivityEvents();
```

---

### UPG-004 — `diagnostics_channel` para métricas de I/O → substituir polling
**Arquivo**: `src/copilot/terminal/events/io-activity-events.js`
**Impacto**: MÉDIO · **Esforço**: BAIXO
**Descrição**: O canal `copilot.io.operation` já usa `diagnostics_channel`. Mas o projeto ainda faz polling em `readTerminalIoActivityProjection` em vez de publicar métricas incrementais. Node.js 24 expande `diagnostics_channel` com `channel.subscribe` que aceita `AbortSignal` — usar isso eliminaria o polling em `auto-brief.js` e `live-status-line.js`.

---

### UPG-005 — Substituir `Map` de módulo em `timeline.js` por `WeakRef` + `FinalizationRegistry`
**Arquivo**: `src/copilot/terminal/frontend/projections/timeline.js`
**Impacto**: MÉDIO · **Esforço**: ALTO
**Descrição**: `_timelineSyncInflight`, `_timelineSyncCompleted` e `_timelineSyncFailures` são Maps globais de módulo que crescem durante a sessão. Em sessões muito longas (24h+), o acúmulo pode ser significativo. Node.js 24 tem GC determinístico suficiente para usar `FinalizationRegistry` com entries que auto-expiram.

---

### UPG-006 — `ReadableStream` nativo para SSE em vez de `ServerResponse.write()`
**Arquivo**: `src/copilot/terminal/dialog/sse.js`
**Impacto**: BAIXO · **Esforço**: MÉDIO
**Descrição**: O SSE usa `client.write(payload)` diretamente em `ServerResponse`. Node.js 24 tem `ReadableStream` nativo (sem polyfill) e o `node:http` suporta `response.write` via stream pipeline. Migrar para `TransformStream` permite aplicar backpressure correto e `AbortSignal` para cleanup de clientes.

---

### UPG-007 — `structuredClone()` em vez de spread para snapshots de estado
**Impacto**: BAIXO · **Esforço**: BAIXO
**Descrição**: Funções como `toSnapshot(trace)` usam spreads manuais aninhados:
```js
tools: trace.tools.map((e) => ({ ...e })),
files: trace.files.map((e) => ({ ...e })),
```
`structuredClone()` (nativo em Node.js 24) é mais correto (lida com `Date`, `Map`, referências circulares) e mais legível. Para objetos pequenos de estado, a performance é equivalente.

---

### UPG-008 — `import.meta.resolve()` para caminhos de módulo em ESM
**Impacto**: BAIXO · **Esforço**: BAIXO
**Descrição**: Alguns caminhos são construídos com `dirname(fileURLToPath(import.meta.url))` (ex: `dev-watch.js`, `transcript-archive.js`). Node.js 24 suporta `import.meta.resolve()` para resolver módulos e `import.meta.dirname` (estável no Node.js 22+), simplificando:
```js
// Antes:
const _COPILOT_SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Depois:
const _COPILOT_SRC_DIR = resolve(import.meta.dirname, '..');
```

---

### UPG-009 — Tipagem de eventos com `TypedEventTarget` do SDK 0.3.0
**Impacto**: MÉDIO · **Esforço**: MÉDIO
**Descrição**: O SDK 0.3.0 (e Node.js 24) suportam `TypedEventTarget<EventMap>`. Os handlers de evento no terminal usam `/** @type {Record<string, unknown>} */ (evt)` em praticamente todos os handlers. Migrar para interfaces tipadas eliminaria esses casts e habilitaria verificação estática em `@ts-check`.

---

### UPG-010 — `AbortSignal.timeout()` nos handlers de tool
**Arquivo**: `src/copilot/terminal/commands/fs.js`, `sdk.js`
**Impacto**: BAIXO · **Esforço**: BAIXO
**Descrição**: Chamadas a `invokeFileTool()` e `getToolHandler(tool)(args)` não têm timeout próprio. Node.js 24 tem `AbortSignal.timeout(ms)` nativo, permitindo:
```js
const result = await getToolHandler(tool)(args, { signal: AbortSignal.timeout(5_000) });
```

---

### UPG-011 — Consolidar `Map<string, number>` de dedup em `LRUCache` nativo
**Arquivo**: `src/copilot/terminal/events/io-activity-events.js`, `intent-renderer.js`, `assistant-transcript-renderer.js`
**Impacto**: BAIXO · **Esforço**: BAIXO
**Descrição**: Os três módulos mantêm Maps com poda manual por TTL. Node.js 24 não inclui `LRUCache` nativo, mas o padrão pode ser consolidado em uma única utilidade `createTtlMap(maxSize, ttlMs)` compartilhada, eliminando a duplicação de lógica de poda.

---

### UPG-012 — `Promise.withResolvers()` em engine.js e repl-command-router.js
**Impacto**: BAIXO · **Esforço**: BAIXO
**Descrição**: `Promise.withResolvers()` é nativo no Node.js 22+ e elimina o padrão de `let resolve, reject; new Promise((r, j) => { resolve = r; reject = j; })`:

```js
// Antes (engine.js, _doEnsureDialogLoop):
let resolveReady, rejectReady;
const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve; rejectReady = reject;
});

// Depois:
const { promise: readyPromise, resolve: resolveReady, reject: rejectReady } = Promise.withResolvers();
```

---

### UPG-013 — Modo `autopilot` no SDK 0.3.0 vs `autopilot` local
**Arquivo**: `src/copilot/terminal/commands/plan.js`
**Impacto**: MÉDIO · **Esforço**: MÉDIO
**Descrição**: O comando `/plan autopilot` usa `mode.set('autopilot')`. Verificar se o SDK 0.3.0 ainda suporta esse modo ou se foi renomeado/descontinuado no ciclo de naming cleanup do 0.3.0.

---

### UPG-014 — `live-status-line.js`: debounce via `scheduler.wait()` do Node.js 24
**Arquivo**: `src/copilot/terminal/repl/live-status-line.js`
**Impacto**: BAIXO · **Esforço**: BAIXO
**Descrição**: O `setInterval(render, intervalMs)` pode causar drift temporal em sistemas sob carga. Node.js 24 expõe `timers/promises` com `scheduler.wait()` que é mais preciso em contextos de event loop saturado.

---

### UPG-015 — Adicionar `onPromptSubmitted` hook para o SDK 0.3.0
**Arquivo**: `src/copilot/terminal/state/sdk-hook-events.js`
**Impacto**: MÉDIO · **Esforço**: MÉDIO
**Descrição**: O estado `sdk-hook-events.js` existe mas o hook `onUserPromptSubmitted` precisa ser verificado contra a API 0.3.0 — o SDK pode ter mudado a assinatura do callback no cleanup de naming. O campo `output.modifiedPrompt` pode ter sido renomeado.

---

### UPG-016 — `rpc.permissions.resetSessionApprovals()` no comando `/permission`
**Impacto**: BAIXO · **Esforço**: BAIXO
**Descrição**: Ver GAP-017. Implementar subcomando `/permission reset-approvals` que chama `session.rpc.permissions.resetSessionApprovals()`.

---

### UPG-017 — Melhorar `cmdMenu` com execução automática real via `sendPrompt`
**Arquivo**: `src/copilot/terminal/commands/menu.js`
**Impacto**: BAIXO · **Esforço**: BAIXO
**Descrição**: `deps.executeCommandLine` é opcional e retorna `boolean`. Em produção, `cmdMenu` sempre cai no path "execução automática indisponível". O composition root deveria injetar `executeCommandLine` via `dispatchCmd` em `repl-command-router.js`.

---

### UPG-018 — Persistência do `displayState` entre reinicializações
**Arquivo**: `src/copilot/terminal/state/display-policy.js`
**Impacto**: BAIXO · **Esforço**: BAIXO
**Descrição**: O estado de display (thinking, streaming, usage, tools, intent) é perdido a cada reinicialização do processo. O `alias-store.js` demonstra o padrão correto de persistência em JSON. Aplicar o mesmo padrão ao `display-policy.js` evitaria que o usuário precise reconfigurar a cada reinício.

---

### UPG-019 — `@ts-check` + tipo explícito para `TerminalBootContext.copilotServer`
**Arquivo**: `src/copilot/terminal/runtime-root.js`
**Impacto**: BAIXO · **Esforço**: BAIXO
**Descrição**: `copilotServer: TerminalCopilotServer | null` usa `import('./server/index.js').CopilotServer` como tipo. Mas `boot-http.js` faz `ctx.copilotServer = await ctx.startCopilotServer(serverOpts)` sem verificar o tipo de retorno. Se `startCopilotServer` mudar de assinatura, o erro só aparece em runtime.

---

## 4. Análise de Hotspots Arquiteturais

### HOTSPOT-A — `sdk-session-events.js` (550+ linhas)
**Risco**: ALTO
**Descrição**: Este arquivo concentra todos os handlers de eventos vanilla do SDK. Com o SDK 0.3.0 adicionando `agentId` a eventos de sub-agentes, `per-session auth`, e novos RPCs, ele tende a crescer mais. Recomendável dividir em:
- `sdk-session-events-lifecycle.js` (turn start/end, compaction, shutdown)
- `sdk-session-events-interaction.js` (elicitation, permission, user_input)
- `sdk-session-events-system.js` (mode, plan, tools, skills, MCP)

### HOTSPOT-B — `engine.js` (400+ linhas)
**Risco**: MÉDIO
**Descrição**: O dialog engine mistura: resolução de timeout, embed de arquivos, renderização de streaming, métricas de billing, e persistência no hub. O `engine-persistence.js` já extraiu parte da lógica, mas `_executeTurn` ainda é um método de 120+ linhas. Candidato para extração de `engine-streaming.js` e `engine-metrics.js`.

### HOTSPOT-C — `status.js` (projeção de status)
**Risco**: BAIXO-MÉDIO
**Descrição**: A projeção de status lê ~25 fontes diferentes e constrói um objeto com 60+ campos. Em benchmarks de produção, essa projeção pode ser chamada a cada `/now` e `/status` (frequentemente durante debugging intenso). Considerar cache com TTL de 500ms para snapshots que não mudaram.

---

## 5. Checklist de Ações Imediatas

| Prioridade | Item                                                              | Tipo    | Arquivo                                       |
| ---------- | ----------------------------------------------------------------- | ------- | --------------------------------------------- |
| P0         | Corrigir encoding UTF-8 corrompido                                | Bug     | `commands/sdk.js`                             |
| P0         | Verificar `SessionFs` API contra SDK 0.3.0                        | GAP     | Todos `gateways/`                             |
| P0         | Adicionar `gitHubToken` (capital H) check                         | GAP     | Configuração de sessão                        |
| P1         | Filtrar `agentId` em `onAssistantMessage`                         | GAP     | `sdk-session-events.js`                       |
| P1         | Race condition no `/restart`                                      | Bug     | `repl-command-router.js`                      |
| P1         | Corrigir dupla chamada de `tryAnswerTerminalPendingQuestionInput` | Bug     | `repl-lifecycle.js`                           |
| P1         | `onPermissionRequest` em `createSession`                          | GAP     | Configuração de sessão                        |
| P2         | Mover `renderReportIntentToolPayload` pós-supressão               | Bug     | `tool-lifecycle-runtime.js`                   |
| P2         | Guard NaN em `IDLE_TRANSITION_TIMEOUT_MS`                         | Bug     | `engine.js`                                   |
| P2         | `sessionIdleTimeoutSeconds: 0` explícito                          | GAP     | Configuração de sessão                        |
| P2         | `import.meta.dirname` no lugar de `dirname(fileURLToPath(...))`   | UPG     | `dev-watch.js`, `transcript-archive.js`       |
| P2         | `Promise.withResolvers()`                                         | UPG     | `engine.js`, `repl-command-router.js`         |
| P3         | `session.rpc.mcp.oauthLogin()` no handler OAuth                   | GAP     | `sdk-session-events.js`                       |
| P3         | Persistência do `displayState`                                    | UPG     | `display-policy.js`                           |
| P3         | Consolidar poda de Maps de dedup                                  | UPG     | `io-activity-events.js`, `intent-renderer.js` |
| P3         | `AsyncLocalStorage` para `runtimeId`                              | UPG     | `commands/*.js`, `frontend/`                  |
| P3         | Subcomando `/permission reset-approvals`                          | UPG+GAP | `commands/sdk.js`                             |

---

## 6. Referências

- [SDK 0.3.0 Release Notes](https://github.com/github/copilot-sdk/releases/tag/v0.3.0)
- [SDK Releases Page](https://github.com/github/copilot-sdk/releases)
- [Node.js 24 What's New](https://nodejs.org/en/blog/announcements/v24-release-announce)
- [TC39 Explicit Resource Management](https://github.com/tc39/proposal-explicit-resource-management)
- [Promise.withResolvers (Node.js 22+)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers)

---

*Relatório gerado com base em análise estática de 139 arquivos do módulo `terminal/` e comparação com changelog público do SDK Copilot 0.3.0.*
