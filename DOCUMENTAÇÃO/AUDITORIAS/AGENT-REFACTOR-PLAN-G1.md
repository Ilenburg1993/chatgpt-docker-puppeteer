# AGENT-REFACTOR-PLAN-G1 — Segunda Auditoria Profunda e Roadmap de Evolução

_Versão: 1.0 — 2026-06-11_ _Escopo: `src/copilot/agent/`, `src/copilot/api/`, `src/copilot/routes/`,
arquivos associados_ _Autoria: Copilot Audit Agent após leitura completa de ~3.800 LOC em `agent/` +
~15k LOC em dependências diretas_

---

## Sumário Executivo

O pacote `src/copilot/agent/` após a Fase F (plano anterior) atingiu boa separação de módulos, JSDoc
robusto e 0 erros de lint/typecheck. Esta segunda auditoria identifica **27 achados** classificados
em quatro categorias:

| Categoria                   | Total | Crítico | Alto | Médio | Baixo |
| --------------------------- | ----- | ------- | ---- | ----- | ----- |
| Bugs e riscos de runtime    | 8     | 1       | 3    | 3     | 1     |
| Gaps arquiteturais          | 9     | 0       | 4    | 3     | 2     |
| API pública e acoplamento   | 5     | 0       | 2    | 2     | 1     |
| Melhorias de qualidade e DX | 5     | 0       | 0    | 3     | 2     |

O principal achado crítico é **G1-BUG-01**: a ordem das instruções em `#ensureDialogLoopAttached()`
está invertida — o guard `if (this.#dialogLoopAttached) return;` foi colocado _depois_ de `attach()`
em vez de _antes_, o que significa que `attach()` ainda é chamado repetidamente a cada re-attach. Os
demais achados são de severidade alta/média e estão documentados com proposta de correção.

O roadmap é dividido em **4 fases (G1.1–G1.4)** com critério de entrega e quality gates por fase.

---

## PARTE I — ACHADOS DETALHADOS

### 1. Bugs e Riscos de Runtime

---

#### G1-BUG-01 · CRÍTICO · `always-alive.js` · `#ensureDialogLoopAttached()`

**Arquivo**: `src/copilot/agent/always-alive.js` ~L787

**Problema**: O guard de idempotência (`#dialogLoopAttached`) foi adicionado _depois_ de `attach()`:

```js
// Estado atual (BUGADO)
#ensureDialogLoopAttached() {
    const host = { ... };
    this.#dialogLoop.attach(host, this.#telemetry);  // ← chamado toda vez
    if (this.#dialogLoopAttached) return;             // ← guard muito tarde
    this.#dialogLoopAttached = true;
    this.#dialogLoop.removeAllListeners();
    ...
}
```

**Efeito**: `attach()` sobrescreve `#host` e `#telemetry` do `DialogLoopManager` em cada chamada de
`startDialogLoop()`. Isso é inofensivo na maioria dos casos (os valores são iguais desde que o
agente não tenha reiniciado), mas:

1. Após `stop()` + `start()` o agente cria nova `#telemetry = createTelemetry()` mas o DLM recebe a
   telemetria antiga na sessão anterior — causando registros de spans na telemetria errada.
2. Se `start()` for chamado em overlap (race condition improvável mas possível em testes), `#host`
   do DLM pode apontar para um agente já parado.

**Correção**: mover o guard para _antes_ de `attach()`:

```js
#ensureDialogLoopAttached() {
    this.#dialogLoop.attach(this.#buildAgentHost(), this.#telemetry);
    if (this.#dialogLoopAttached) return;
    this.#dialogLoopAttached = true;
    // ... event wiring
}
```

Ou melhor, separar os dois concerns:

```js
#ensureDialogLoopAttached() {
    // Sempre atualiza host/telemetry (pode mudar após reconexão)
    this.#dialogLoop.attach(this.#buildAgentHost(), this.#telemetry);
    if (this.#dialogLoopAttached) return;
    this.#dialogLoopAttached = true;
    this.#wireDialogLoopEvents();
}
```

---

#### G1-BUG-02 · ALTO · `always-alive.js` · `stop()` — dialogLoopAttached não resetado na ordem correta

**Arquivo**: `src/copilot/agent/always-alive.js` ~L432

**Problema**: `this.#dialogLoopAttached = false` é chamado em `stop()`, mas _após_
`#dialogLoop.forceDeactivate()`. Se o DLM emitir eventos durante `forceDeactivate()`, os listeners
ainda registrados tentarão fazer `this.emit()` num agente em processo de shutdown — potencialmente
propagando eventos para SSE subscribers já removidos.

**Correção**: resetar `#dialogLoopAttached` e remover listeners _antes_ de `forceDeactivate()`.

---

#### G1-BUG-03 · ALTO · `task-executor.js` · `executeTask()` — unsubscribers em caso de AbortError do signal

**Arquivo**: `src/copilot/agent/task-executor.js`

**Problema**: O cleanup `finally` chama `unsubDelta()`, `unsubToolStart()`, `unsubToolComplete()`,
`unsubIdle()` — correto. Porém, se `session.sendAndWait()` lançar `DOMException('AbortError')` via
signal, o `catch` tenta chamar `tryReconnect(e)`. Uma exceção `AbortError` **não é** um erro de
sessão — não deve acionar reconexão, apenas rejeitar a tarefa imediatamente.

**Efeito**: cada task abortada causa 1 ciclo desnecessário de `tryReconnect` (tentativa de reconexão
por 5 tentativas com backoff exponencial). Se o AbortSignal vier de um timeout externo, pode
levar >30s para finalizar a task.

**Correção**:

```js
} catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
        setStatus('idle');
        emit('task.error', { taskId: task.id, error: 'AbortError' });
        task.reject(e);
    } else {
        // tryReconnect path existente
        ...
    }
}
```

---

#### G1-BUG-04 · ALTO · `dialog-loop-manager.js` · `#executeTurn()` — double-registration de `question.pending`

**Arquivo**: `src/copilot/agent/dialog-loop-manager.js` ~L450

**Problema**: Em `#executeTurn()`, o listener `onPending` é registrado via
`this.once('question.pending', onPending)`. Logo após, verifica-se `host.getPendingQuestion()` de
forma síncrona para evitar miss. Porém, se nesse intervalo `question.pending` for emitido pelo
scheduler de eventos **antes** do `getPendingQuestion()` check, `onPending` será chamado via evento
E também será invocado pelo fallback síncrono — resultado: `host.answerPendingQuestion(message)`
chamado duas vezes. O segundo `answerPendingQuestion()` sem `#pendingQuestion` gera log + import
dinâmico de hook-tools desnecessário.

**Correção**: usar uma flag `consumed` ou verificar antes do event registration:

```js
if (host.getPendingQuestion()) {
  host.answerPendingQuestion(message);
  // registra listeners apenas para reply/stopped
} else {
  this.once('question.pending', () => {
    pendingListener = null;
    host.answerPendingQuestion(message);
    // registra listeners para reply/stopped
  });
}
```

---

#### G1-BUG-05 · MÉDIO · `state-io.js` · write-then-read race condition

**Arquivo**: `src/copilot/agent/state-io.js`

**Problema**: `writeStateAsync` atualiza `_stateCache` **após** `writeFile()`. Se `readState()` for
chamado entre o início de `writeFile()` e a resolução da Promise, devolve o estado desatualizado
(cache estava null e lê o arquivo ainda não escrito ou o arquivo da versão anterior).

Em `always-alive.js` existem múltiplas chamadas paralelas a `writeStateAsync` (ex.:
`pendingQuestion` + `pendingTurnConsumedPR` em fluxos de billing). Se duas escritas ocorrerem em
paralelo, a segunda pode sobrescrever a primeira porque ambas leram `current = readState()` antes da
escrita.

**Correção**: adicionar um mutex simples (fila FIFO de Promise) para serializar escritas assíncronas
— ou simplesmente usar `writeState` (síncrono) nos paths onde a concorrência é possível.

---

#### G1-BUG-06 · MÉDIO · `session-event-wirer.js` · dupla emissão de `task.delta` durante dialog loop

**Arquivo**: `src/copilot/agent/session-event-wirer.js` ~L110

**Problema**: O listener `assistant.message_delta` no session-event-wirer usa `isProcessing()`
(status === 'processing') para filtrar deltas do dialog loop. Porém durante `waiting_for_input`
(quando o modelo emiu ask_user), `isProcessing()` retorna false — e deltas intermediários emitidos
pelo SDK antes do ask_user chegam ao SSE com `taskId: null`, causando confusão no dashboard.

**Correção**: condição mais precisa — filtrar também durante `waiting_for_input` no dialog loop:

```js
session.on('assistant.message_delta', (evt) => {
  if (isProcessing() || dialogLoopActive()) return;
  // ...
});
```

---

#### G1-BUG-07 · MÉDIO · `dialog-loop-manager.js` · watchdog não resetado no `resume()` via Estratégia B

**Arquivo**: `src/copilot/agent/dialog-loop-manager.js` `resume()`

**Problema**: Na Estratégia B (1 PR), `resume()` chama `this.start()` que cria um **novo watchdog**
mas não para o watchdog anterior (que pode não ter sido parado se `pause()` não chamou
`#watchdog.stop()`). Resultado: dois watchdogs ativos simultaneamente.

**Correção**: garantir `this.#watchdog?.stop()` antes de `this.start()` na Estratégia B.

---

#### G1-BUG-08 · BAIXO · `session-initializer.js` · `buildHookSystemContextSafe()` — truncamento pode quebrar UTF-8

**Arquivo**: `src/copilot/agent/session-initializer.js`

**Problema**: O truncamento usa `Buffer.from(raw, 'utf8').subarray(0, HOOK_CONTEXT_MAX_BYTES)` que
pode cortar um caractere multibyte no meio, gerando string UTF-8 inválida no system prompt.

**Correção**: usar `truncate` via TextDecoder com `fatal: false` ou garantir truncamento em limite
de caractere.

---

### 2. Gaps Arquiteturais

---

#### G1-ARCH-01 · ALTO · `AlwaysAliveAgent` como singleton acoplado — falta API de factory pública

**Problema**: `always-alive.js` exporta `alwaysAliveAgent` como singleton global (instância
singleton hardcoded na última linha do módulo). Isso impede:

1. Testes unitários que precisam de instâncias isoladas por teste.
2. Cenários multi-agente (ex.: dois agentes com modelos diferentes).
3. Injeção de dependência em bridges/rotas sem import direto de `always-alive.js`.

**Proposta**: Expor o singleton pelo `index.js` mas torná-lo _lazy_:

```js
// always-alive.js — não exportar o singleton daqui
export class AlwaysAliveAgent extends EventEmitter { ... }
// Sem export const alwaysAliveAgent

// index.js — singleton lazy
let _agent = null;
export function getAgent() {
    return (_agent ??= new AlwaysAliveAgent());
}
export const alwaysAliveAgent = getAgent(); // retrocompatibilidade
```

---

#### G1-ARCH-02 · ALTO · Ausência de contrato de Interface (`IAlwaysAliveAgent`) para bridges

**Problema**: Os bridges (`bridge-control.js`, `bridge-tasks.js`, `bridge-dialog.js`,
`bridge-stream.js`) definem cada um seu próprio `typedef AlwaysAliveAgentLike` — há pelo menos **4
typedefs diferentes** que descrevem o mesmo agente, com campos inconsistentes entre si. Isso torna a
refatoração perigosa (mudar um método silenciosamente quebra alguns bridges mas não outros).

**Proposta**: Criar `src/copilot/agent/types.js` (ou `agent-contract.d.ts`) com:

```js
/**
 * @typedef {Object} IAlwaysAliveAgent
 * @property {AgentStatus} status
 * @property {string | null} sessionId
 * @property {string} model ...todos os métodos públicos com assinaturas explícitas
 */
```

E usar este typedef nos 4 bridges + routes/agent.js + qualquer outro arquivo que receba o agente
como parâmetro.

---

#### G1-ARCH-03 · ALTO · `#processQueue()` não observa reconexão ativa — tarefa pode ser processada em sessão morta

**Arquivo**: `src/copilot/agent/always-alive.js` `#processQueue()`

**Problema**: `#processQueue()` verifica `this.#session !== null` mas não verifica se a sessão está
**reconectando** — `#tryReconnect()` é assíncrono e durante a reconexão `this.#session` pode apontar
para a sessão anterior (ainda viva) ou ter sido trocada para null e de volta. Se
`MessageQueue.onEnqueue` disparar `#processQueue()` durante uma reconexão em andamento, uma nova
tarefa pode ser executada na sessão antiga em estado de erro.

**Proposta**: Adicionar flag `#isReconnecting = false` que bloqueia `#processQueue()` enquanto
reconexão está ativa.

---

#### G1-ARCH-04 · ALTO · `always-alive.js` ainda tem 1.134 LOC — `#handleInteractiveQuestion` merece módulo próprio

**Problema**: Após as extrações da Fase F, `always-alive.js` tem 1.134 LOC. O orquestrador de
questões interativas (`#handleUserInputRequest`, `#handleDialogLoopInput`,
`#handleInteractiveQuestion`) representa ~80 LOC com lógica não trivial e sem testes diretos.
Deveria ser um módulo `user-input-handler.js`.

---

#### G1-ARCH-05 · MÉDIO · `session-event-wirer.js` recebe callbacks demais — acoplamento implícito

**Problema**: `wireSessionEvents()` recebe 6 callbacks: `emit`, `getStatusSnapshot`,
`onCheckpointPath`, `onContextState`, `onPrInfo`, `isProcessing`. Isso é um sinal de "too many
parameters" — a função conhece detalhes internos do `AlwaysAliveAgent` que deveria ignorar.

**Proposta**: consolidar em um objeto `SessionWirerHost`:

```js
/** @typedef {Object} SessionWirerHost
 *   @property {AlwaysAliveAgentLike} agent
 */
export function wireSessionEvents(session, isResumed, host) { ... }
```

---

#### G1-ARCH-06 · MÉDIO · `task-executor.js` usa `any` para `session` — sem tipagem do SDK

**Arquivo**: `src/copilot/agent/task-executor.js`

**Problema**: O parâmetro `session` é tipado como `any` porque `CopilotSession` não está disponível
no path de importação. Isso anula a proteção do TypeScript para o `sendAndWait`, `session.on()` etc.

**Proposta**: importar `@github/copilot-sdk`-types e criar `SessionLike` typedef para o mínimo
necessário.

---

#### G1-ARCH-07 · MÉDIO · `tools-bootstrap.js` — lista `allTools` duplica os arrays já em `bootrapTools()`

**Arquivo**: `src/copilot/agent/tools-bootstrap.js`

**Problema**: `bootstrapTools()` primeiro faz `registerTools(registry, toolGroup)` para cada grupo,
e depois constrói `allTools = [...taskTools, ...codeTools, ...]` duplicando exatamente os mesmos
arrays. Isso é frágil — se um grupo for adicionado em `registerTools` mas esquecido em `allTools`,
as tools não aparecerão na sessão SDK (apenas no registry interno).

**Proposta**: manter uma **única lista de pares** `[tools, opts]` que seja iterada para registro E
construção de `allTools`:

```js
const TOOL_GROUPS = [
  [taskTools, { category: 'task', tags: ['queue', 'state'] }],
  [codeTools, { category: 'code', tags: ['lint', 'test', 'typecheck'], readOnly: true }],
  // ...
];
export function bootstrapTools(registry, telemetry, mcpTools) {
  for (const [tools, opts] of TOOL_GROUPS) {
    registerTools(registry, tools, opts);
  }
  const allTools = TOOL_GROUPS.flatMap(([t]) => t);
  // ...
}
```

---

#### G1-ARCH-08 · BAIXO · `state-io.js` mistura concerns: leitura de arquivo + cache + default state

**Problema**: `state-io.js` define `_stateCache`, `_stateDirReady`, a lógica de `mkdirSync`/`mkdir`
E a função `_defaultState()`. Esses são 4 responsabilidades. Para o cache, seria mais limpo um
objeto `StateStore` com métodos `read/write/clear`.

---

#### G1-ARCH-09 · BAIXO · `events.js` sem `@type` union — não previne erros de typo nos consumers

**Arquivo**: `src/copilot/agent/events.js`

**Problema**: `AGENT_EVENTS` é um array `as const` e `AgentEventName` é o union type, mas os
overloads de `on/off/emit` em `AlwaysAliveAgent` **não** usam `AgentEventName` — aceitam `string`.
Se alguém usar `agent.on('dialog.loop_changed', ...)` (typo: underscore em vez de ponto), não haverá
erro de compilação.

**Proposta**: adicionar overloads ao `AlwaysAliveAgent` para eventos conhecidos:

```js
/** @param {AgentEventName} event */
on(event, listener) { return super.on(event, listener); }
```

---

### 3. API Pública e Acoplamento

---

#### G1-API-01 · ALTO · Inexistência de fachada `AgentAPI` usável fora de `src/copilot/`

**Problema**: atualmente, `src/copilot/bridges/nerv-bridge.js`,
`src/copilot/terminal/http-handlers.js`, os 4 bridges em `src/copilot/api/`, e
`src/copilot/routes/agent.js` importam `alwaysAliveAgent` diretamente de
`'../agent/always-alive.js'` ou indiretamente via `'../agent/index.js'`. Isso cria **10+ pontos de
acoplamento direto** ao singleton.

**Proposta**: criar `src/copilot/agent/api.js` exportando uma interface limpa e documentada ao mundo
exterior do pacote:

```js
// src/copilot/agent/api.js
export { alwaysAliveAgent, AlwaysAliveAgent } from './always-alive.js';

// Funções de conveniência sem exposição de internals:
export function agentStatus() {
  return alwaysAliveAgent.status;
}
export function agentSnapshot() {
  return alwaysAliveAgent.getStatusSnapshot();
}
export async function agentSend(msg, opts) {
  return alwaysAliveAgent.sendMessage(msg, opts);
}
// etc.
```

Isso cria um ponto único de entrada para refatorações futuras (ex.: multi-agente).

---

#### G1-API-02 · ALTO · `bridge-control.js`, `bridge-tasks.js`, `bridge-dialog.js`, `bridge-stream.js` — definições de tipo inconsistentes

**Problema**: Cada bridge define seu próprio `typedef AlwaysAliveAgentLike` com campos diferentes.
Exemplo:

- `bridge-control.js` define `getPermissionMode?` como opcional
- `bridge-tasks.js` não inclui `getPermissionMode`
- `bridge-dialog.js` não tem `listenerDiagnostics`

Se o agente mudar uma assinatura, apenas alguns bridges falharão no typecheck.

**Correção**: unificar em `types.js` no próprio pacote agent — ver G1-ARCH-02.

---

#### G1-API-03 · MÉDIO · `entry.js` não expõe `alwaysAliveAgent` via processo pai (IPC)

**Problema**: O processo PM2 `copilot-sdk-agent` inicia o agente mas não oferece mecanismo de
controle via IPC do processo. Controle é feito apenas via HTTP bridge (porta 3008). Se o servidor
HTTP estiver indisponível, não há como controlar o agente.

**Proposta**: adicionar listener básico em `process.on('message', ...)` para comandos de controle
mínimos: `{ cmd: 'status' }`, `{ cmd: 'stop' }`, `{ cmd: 'ping' }`.

---

#### G1-API-04 · MÉDIO · `listenerDiagnostics()` expõe eventos internos via HTTP em produção

**Arquivo**: `src/copilot/api/bridge-control.js` `/health`

**Problema**: `listenerDiagnostics` é exposto no `/health` apenas em `NODE_ENV === 'development'`
(correto). Porém `listenerDiagnostics()` em `always-alive.js` itera sobre `AGENT_EVENTS` sem limite
— em produção o método ainda existe e pode ser chamado por outros paths não protegidos.

**Proposta**: adicionar anotação `@internal` e verificação de ambiente dentro do próprio método.

---

#### G1-API-05 · BAIXO · `getSessionMessages()` cache de 30s não é invalidado quando a sessão muda

**Arquivo**: `src/copilot/agent/always-alive.js` `getSessionMessages()`

**Problema**: `#messagesCache` é invalidado em `stop()` (quando `#session = null`), mas não ao
trocar de sessão durante uma reconexão bem-sucedida. Se `#tryReconnect()` criar uma nova sessão,
`#messagesCache` ainda contém as mensagens da sessão anterior por até 30s.

**Correção**: adicionar `this.#messagesCache = null` no início de `#initSession()`.

---

### 4. Melhorias de Qualidade e DX

---

#### G1-DX-01 · MÉDIO · Nenhum teste para `task-executor.js` — módulo crítico sem cobertura direta

**Problema**: `task-executor.js` é o coração do processamento de tarefas (send, retry, reconnect,
abort). Não existe spec `tests/unit/copilot/agent/task-executor.spec.js`. O módulo foi extraído para
ser testável mas nunca foi testado diretamente.

**Proposta**: criar spec cobrindo 5 paths: sucesso, erro + reconexão OK, erro + reconexão falha, max
retries, AbortError.

---

#### G1-DX-02 · MÉDIO · Nenhum teste para `dialog-loop-manager.js` — módulo de 610 LOC

**Problema**: `dialog-loop-manager.js` com 610 LOC e lógica complexa (mutex, watchdog, pause/resume,
protocol handling) não tem spec própria. Bugs como G1-BUG-04 e G1-BUG-07 só seriam capturados por
testes de integração.

**Proposta**: criar spec cobrindo pelo menos: start/stop, sendTurn (sucesso e timeout), pause/resume
(estratégia A e B), handleProtocolInput (ready/reply/stopped).

---

#### G1-DX-03 · MÉDIO · `reconnect-policy.js` — backoff jitter introduz não-determinismo em testes

**Arquivo**: `src/copilot/agent/reconnect-policy.js`

**Problema**: `delay = baseDelayMs * Math.pow(2, attempt-1) + Math.random() * baseDelayMs` usa
`Math.random()` que torna os testes não-determinísticos. Além disso, a função não é exportada
separadamente do jitter — impossível testar sem mockar `Math.random`.

**Proposta**: aceitar `jitterFn` opcional no `opts`:

```js
export async function tryReconnect(error, client, status, callbacks, opts = {}) {
    const { jitterFn = Math.random, ... } = opts;
    // ...
    delay += jitterFn() * baseDelayMs;
}
```

---

#### G1-DX-04 · BAIXO · `tools-bootstrap.js` — nomes de categoria/tag não têm constantes canônicas

**Problema**: `category: 'task'`, `category: 'code'`, etc. são strings literais. Uma refatoração que
mudar os nomes das categorias causaria busca+replace manual em múltiplos arquivos.

**Proposta**: exportar objeto `TOOL_CATEGORIES` de `src/copilot/core/constants.js`.

---

#### G1-DX-05 · BAIXO · `status-snapshot.js` — `starvationAlert` usa threshold hardcoded (60s)

**Arquivo**: `src/copilot/agent/status-snapshot.js`

**Problema**: O threshold de starvation (60s) está hardcoded em `buildStatusSnapshot()`. Deveria ser
configurável via variável de ambiente ou constante exportada.

---

## PARTE II — PROPOSTA DE API UNIFICADA DO AGENTE

### Motivação

O `AlwaysAliveAgent` é consumido em múltiplos contextos:

1. **API REST** (`/api/copilot/*`) — bridge-control, bridge-tasks, bridge-dialog
2. **Terminal LLM-B** (`/api/terminal/*`) — http-handlers.js acessa `alwaysAliveAgent` diretamente
3. **routes/agent.js** — informações de diagnóstico e telemetria
4. **bridges** — nerv-bridge.js subscreve eventos do agente
5. **tools** — `hook-tools.js` acessa `answerPendingQuestion()`

Todos esses 10+ pontos de acoplamento resultam em:

- Dificuldade de refatorar (mudança de API quebra silenciosamente consumers não verificados)
- Impossibilidade de multi-agente
- Código de teste acoplado ao singleton

### Proposta: `IAlwaysAliveAgent` + `AgentFacade`

```
src/copilot/agent/
├── always-alive.js          (implementação, privada)
├── agent-contract.js        (NOVO — IAlwaysAliveAgent typedef + AgentEventName)
├── agent-facade.js          (NOVO — fachada com sub-APIs por domínio)
└── index.js                 (barrel, exporta IAlwaysAliveAgent, AgentFacade, alwaysAliveAgent)
```

A `AgentFacade` expõe sub-APIs:

```js
class AgentFacade {
  /** Sub-API de controle de ciclo de vida */
  get control() {
    return new ControlAPI(this.#agent);
  }
  /** Sub-API de envio de mensagens */
  get tasks() {
    return new TasksAPI(this.#agent);
  }
  /** Sub-API de dialog loop */
  get dialog() {
    return new DialogAPI(this.#agent);
  }
  /** Sub-API de sessão e estado */
  get session() {
    return new SessionAPI(this.#agent);
  }
  /** Sub-API de observabilidade (read-only) */
  get metrics() {
    return new MetricsAPI(this.#agent);
  }
}
```

---

## PARTE III — ROADMAP DE EXECUÇÃO (FASES G1.1–G1.4)

### Fase G1.1 — Correção de Bugs Críticos e Altos

**Objetivo**: corrigir G1-BUG-01 a G1-BUG-04 (crítico + altos).

**Estimativa de arquivos modificados**: 3–4 **Risco**: baixo (correções cirúrgicas)

| ID        | Arquivo                  | Ação                                                               |
| --------- | ------------------------ | ------------------------------------------------------------------ |
| G1-BUG-01 | `always-alive.js`        | Mover guard DEPOIS de attach(); extrair `#buildAgentHost()`        |
| G1-BUG-02 | `always-alive.js`        | Resetar #dialogLoopAttached e limpar listeners antes de deactivate |
| G1-BUG-03 | `task-executor.js`       | Separar AbortError do path de tryReconnect                         |
| G1-BUG-04 | `dialog-loop-manager.js` | Corrigir double-registration de `question.pending` em executeTurn  |

**Quality gates**: lint, typecheck, format, test:unit (0 fail)

---

### Fase G1.2 — Testes Críticos Ausentes

**Objetivo**: cobrir `task-executor.js` e `dialog-loop-manager.js` com specs (G1-DX-01, G1-DX-02).

**Estimativa**: ~300–400 LOC de specs novas

| ID       | Arquivo de teste                                 | Casos                                                            |
| -------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| G1-DX-01 | `tests/unit/copilot/agent/task-executor.spec.js` | sucesso, erro+reconexão OK, max retries, AbortError              |
| G1-DX-02 | `tests/unit/copilot/agent/dialog-loop.spec.js`   | start/stop, sendTurn sucesso/timeout, pause/resume A+B, protocol |
| G1-DX-03 | `tests/unit/copilot/agent/reconnect.spec.js`     | backoff determinístico via jitterFn, max attempts                |

**Quality gates**: `npm run test:unit` (0 fail), cobertura > 60% nos módulos adicionados

---

### Fase G1.3 — Contratos de Interface e Tipos

**Objetivo**: resolver G1-ARCH-02, G1-API-01, G1-API-02 — criar `agent-contract.js` e unificar
typedefs.

| ID         | Arquivo                        | Ação                                                       |
| ---------- | ------------------------------ | ---------------------------------------------------------- |
| G1-ARCH-02 | `agent/agent-contract.js`      | NOVO — `IAlwaysAliveAgent` typedef canônico                |
| G1-API-01  | `agent/index.js`               | Exportar `IAlwaysAliveAgent`                               |
| G1-API-02  | `api/bridge-*.js` (4 arquivos) | Substituir `AlwaysAliveAgentLike` por `IAlwaysAliveAgent`  |
| G1-ARCH-09 | `always-alive.js`              | Adicionar overloads de `on/off/emit` para `AgentEventName` |
| G1-API-05  | `always-alive.js`              | Invalidar `#messagesCache` no início de `#initSession()`   |

**Quality gates**: typecheck strict 0 erros, lint 0 erros

---

### Fase G1.4 — Refatorações Arquiteturais

**Objetivo**: resolver G1-ARCH-01 (singleton lazy), G1-ARCH-03 (flag reconnecting), G1-ARCH-07
(tools-bootstrap lista única), G1-BUG-05 (write mutex), G1-BUG-07 (watchdog duplo), G1-API-03 (IPC
no entry.js).

| ID         | Arquivo                       | Ação                                                                   |
| ---------- | ----------------------------- | ---------------------------------------------------------------------- |
| G1-ARCH-01 | `always-alive.js`, `index.js` | Singleton lazy (`getAgent()`)                                          |
| G1-ARCH-03 | `always-alive.js`             | Flag `#isReconnecting` em `#tryReconnect()` → bloqueia `#processQueue` |
| G1-ARCH-07 | `tools-bootstrap.js`          | `TOOL_GROUPS` como fonte única de verdade                              |
| G1-BUG-05  | `state-io.js`                 | Mutex simples para serializar `writeStateAsync`                        |
| G1-BUG-06  | `session-event-wirer.js`      | Filtro de `task.delta` também durante `waiting_for_input` + dialogLoop |
| G1-BUG-07  | `dialog-loop-manager.js`      | Stop watchdog anterior em Estratégia B                                 |
| G1-BUG-08  | `session-initializer.js`      | Fix truncamento UTF-8 seguro                                           |
| G1-API-03  | `entry.js`                    | `process.on('message', ...)` para IPC básico                           |
| G1-DX-04   | `core/constants.js`           | `TOOL_CATEGORIES` como constantes exportadas                           |
| G1-DX-05   | `status-snapshot.js`          | `STARVATION_THRESHOLD_MS` via env                                      |

**Quality gates**: lint, typecheck strict, format, test:unit, test:integration (todos 0 fail)

---

## PARTE IV — TRACKING TABLE

| Fase                              | Status      | Commit       |
| --------------------------------- | ----------- | ------------ |
| G1.1 Bugs críticos/altos          | ✅ COMPLETO | `63ec8123`   |
| G1.2 Testes ausentes              | ✅ COMPLETO | `3e5ea8a9`   |
| G1.3 Contratos de interface/tipos | ✅ COMPLETO | `f08451ee`   |
| G1.4 Refatorações arquiteturais   | ✅ COMPLETO | `51e21532` + |

---

## Apêndice — Arquivos Auditados

| Arquivo                                      | LOC  | Status Auditoria |
| -------------------------------------------- | ---- | ---------------- |
| `src/copilot/agent/always-alive.js`          | 1134 | ✅ Completo      |
| `src/copilot/agent/dialog-loop-manager.js`   | 610  | ✅ Completo      |
| `src/copilot/agent/session-event-wirer.js`   | 195  | ✅ Completo      |
| `src/copilot/agent/session-initializer.js`   | 250  | ✅ Completo      |
| `src/copilot/agent/task-executor.js`         | 144  | ✅ Completo      |
| `src/copilot/agent/tools-bootstrap.js`       | 153  | ✅ Completo      |
| `src/copilot/agent/message-queue.js`         | 189  | ✅ Completo      |
| `src/copilot/agent/state-io.js`              | 158  | ✅ Completo      |
| `src/copilot/agent/permission-controller.js` | 139  | ✅ Completo      |
| `src/copilot/agent/reconnect-policy.js`      | 84   | ✅ Completo      |
| `src/copilot/agent/status-snapshot.js`       | 97   | ✅ Completo      |
| `src/copilot/agent/entry.js`                 | 123  | ✅ Completo      |
| `src/copilot/agent/events.js`                | 80   | ✅ Completo      |
| `src/copilot/agent/index.js`                 | 29   | ✅ Completo      |
| `src/copilot/api/http-bridge.js`             | 43   | ✅ Completo      |
| `src/copilot/api/bridge-control.js`          | 230  | ✅ Parcial       |
| `src/copilot/routes/agent.js`                | 205  | ✅ Completo      |
| `src/copilot/routes/sessions.js`             | 661  | ✅ Parcial       |
| `src/copilot/terminal/http-handlers.js`      | 903  | ✅ Parcial       |
| `src/copilot/lib/index.js`                   | 135  | ✅ Completo      |
