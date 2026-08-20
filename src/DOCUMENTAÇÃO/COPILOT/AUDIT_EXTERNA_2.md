# Auditoria profunda — `src/copilot/terminal/dialog` com Node 24+ e GitHub Copilot SDK 0.3.0

**Escopo dos anexos lidos:** `dialog-runtime.js`, `engine.js`, `engine-persistence.js`, `index.js`,
`output.js`, `README.md`, `sse.js`, `turn-display.js`, `turn-reconciliation.js`.

**Objetivo:** identificar bugs, gaps arquiteturais, oportunidades de upgrade, situação atual,
situação ideal e roadmap com fases/subfases para transformar a camada de diálogo/render do terminal
em um subsistema robusto, observável, seguro e idiomático para **Node 24+ ESM** e **GitHub Copilot
SDK 0.3.0**.

---

## 1. Sumário executivo

A pasta `terminal/dialog` já tem uma arquitetura relativamente madura: há separação entre **barrel
público**, **lazy-loading do engine**, **motor de turnos**, **persistência**, **SSE**,
**renderização de streaming/reasoning**, **reconciliação final** e **output/prompt**. O `README.md`
define corretamente a intenção da pasta: ela deve transformar “a verdade já lida do runtime” em
prompt, waiting state, SSE e output humano; e não deve decidir a semântica do SDK por conta própria.

Contudo, a implementação atual concentra responsabilidade demais em `engine.js` e `output.js`, ainda
tem riscos fortes em **render lock**, **terminal injection**, **SSE sem safe
stringify/backpressure**, **persistência não transacional**, **reconciliação final com perda de
formatação**, **erro de lazy import cacheado permanentemente**, e **ausência de integração plena com
as novidades do SDK 0.3.0**.

Os pontos mais graves são:

1. **Bug crítico de render lock preso:** `turn-display.js` chama `beginTerminalRenderLock()` quando
   começa reasoning/streaming, mas a liberação só ocorre em `renderStreamingFooter()`. Se
   `runTerminalDialogTurnDetailed()` lançar exceção antes do footer, `engine.js` entra no `catch` e
   nunca chama `renderStreamingFooter()`, podendo deixar `_terminalRenderLockDepth > 0` e travar
   redraw de prompt.
2. **Terminal injection:** chunks vindos do modelo são escritos diretamente em `process.stdout` via
   `writeTerminalRaw()` sem sanitização robusta. Um modelo, tool ou evento comprometido pode emitir
   sequências ANSI/OSC para limpar tela, mover cursor, criar hyperlinks invisíveis, alterar título
   do terminal ou confundir logs.
3. **SSE frágil:** `broadcastSse()` faz `JSON.stringify(enrichedData)` sem tratamento de erro;
   `BigInt`, circular refs ou objetos com `toJSON` perigoso podem derrubar broadcast. O truncamento
   só cobre `content`, não `chunk`, `reasoningContent`, metadados aninhados ou payloads grandes.
4. **Persistência parcial:** `persistTurnToHub()` grava user turn e LLM-B turn separadamente, sem
   transação. Se a gravação da resposta falhar, o banco pode ficar com turnos
   ímpares/inconsistentes. Além disso, `_persistenceFailureCount` não é incrementado quando
   `writeTurn()` falha antes do notify.
5. **Reconciliador de streaming perde formatação:** `turn-reconciliation.js` calcula sufixo a partir
   de textos normalizados (`finalNormalized.slice(...)`), e não do texto original. Isso pode remover
   quebras de linha, espaços e Markdown no sufixo renderizado.
6. **Lazy import cacheia falha permanentemente:** `dialog-runtime.js` guarda `_engineModulePromise`;
   se `import('./engine.js')` falhar uma vez, a promise rejeitada fica cacheada e todas as futuras
   chamadas falham até reiniciar o processo.
7. **SDK 0.3.0 ainda subaproveitado:** não há evidência, nesses anexos, de tratamento nativo de
   `agentId` em sub-agent streaming, aprovações escopadas (`approve-for-session`,
   `approve-for-location`), `sessionIdleTimeoutSeconds`, RPCs de
   usage/skills/permissions/instructions ou SessionFs provider idiomático.

A situação ideal é transformar essa pasta em um microkernel de diálogo com:

- **máquina de estados explícita**;
- **AbortController por turno**;
- **render lock RAII/disposable**;
- **sanitização terminal-safe**;
- **SSE schema-first com safe stringify, quota e backpressure**;
- **persistência outbox transacional**;
- **streaming multi-agent aware**;
- **integração plena com Copilot SDK 0.3.0**;
- **testes `node:test` em Node 24**;
- **política de permissões Node + SDK unificada**.

---

## 2. Inventário técnico dos anexos

| Arquivo                  | Linhas | Papel atual                                                                                                             | Risco principal                                                                                                                   |
| ------------------------ | -----: | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `dialog-runtime.js`      |     51 | Lazy-loading do `engine.js` e facade assíncrona para `ensureDialogLoop`/`sendTurn`.                                     | Cache permanente de import rejeitado; `getTurnQueueDepth()` retorna 0 antes de carregar engine.                                   |
| `engine.js`              |    889 | Coração do turno: fila, loop, embeddings, streaming callbacks, reconciliação, persistência, busy state e prompt redraw. | Arquivo monolítico, estado global, render lock preso em erros, perda de attachments/requestHeaders em falha, swallowing de erros. |
| `engine-persistence.js`  |    168 | Escrita de turnos no ConversationHub e notificações pendentes.                                                          | Sem transação; fila silenciosamente descarta notificações quando cheia; falhas de write não contabilizadas.                       |
| `index.js`               |     30 | Barrel público.                                                                                                         | Pode exportar APIs demais sem fronteira semântica/contratos.                                                                      |
| `output.js`              |    770 | Prompt dinâmico, status inline, stdout, boot prompt e renderização de exchange.                                         | Terminal control codes, prompt redraw em readline fechado, string-width impreciso, muita responsabilidade.                        |
| `README.md`              |     31 | Contrato conceitual da pasta.                                                                                           | Bom, mas curto; falta contrato formal de estados/eventos/erros.                                                                   |
| `sse.js`                 |    150 | Broadcast SSE/Socket.io/eventFanout e event IDs.                                                                        | JSON.stringify sem proteção, backpressure ignorada, truncamento parcial, archive/fanout podem derrubar broadcast.                 |
| `turn-display.js`        |    443 | Callbacks de reasoning/streaming, render lock, SSE delta/reasoning, footer.                                             | Raw streaming sem sanitização; reasoning completo em memória/SSE; render lock sem garantia de liberação.                          |
| `turn-reconciliation.js` |     60 | Decide se renderiza mensagem final completa, sufixo ou nada.                                                            | Cálculo do sufixo sobre texto normalizado, perdendo formatação original.                                                          |

---

## 3. Situação atual por subsistema

### 3.1. `dialog-runtime.js` — facade lazy do engine

A intenção é boa: manter `dialog/index.js` como barrel puro e carregar o `engine.js` sob demanda. O
arquivo mantém `_engineModulePromise` e `_engineModule` e exporta `ensureDialogLoop()`, `sendTurn()`
e `getTurnQueueDepth()`.

#### Pontos fortes

- Reduz custo inicial de importação.
- Evita ciclos diretos entre barrel e engine.
- Facilita isolar o engine pesado.

#### Bugs/gaps

**DR-01 — Falha de import fica cacheada para sempre.**

Hoje, `loadEngineModule()` faz:

```js
if (_engineModulePromise === null) {
  _engineModulePromise = import('./engine.js').then(...)
}
return _engineModulePromise
```

Se o import falhar por erro transitório, circular import, arquivo corrompido durante hot reload, ou
falha de resolução de alias, `_engineModulePromise` ficará rejeitada. Chamadas futuras retornarão a
mesma promise rejeitada, sem retry.

**Correção canônica:**

```js
function loadEngineModule() {
  if (_engineModulePromise === null) {
    _engineModulePromise = import("./engine.js")
      .then((mod) => {
        _engineModule = mod;
        return mod;
      })
      .catch((err) => {
        _engineModulePromise = null;
        _engineModule = null;
        throw err;
      });
  }
  return _engineModulePromise;
}
```

**DR-02 — `getTurnQueueDepth()` retorna 0 antes do engine carregar.**

Isso é funcionalmente aceitável, mas semanticamente enganoso: dashboards/diagnósticos podem
interpretar “0” como verdade operacional, quando na realidade o engine ainda nem foi importado.

**Situação ideal:** retornar uma projeção:

```js
export function getDialogRuntimeLoadState() {
  return {
    loaded: _engineModule !== null,
    importInFlight: _engineModulePromise !== null && _engineModule === null,
    turnQueueDepth: _engineModule?.getTurnQueueDepth() ?? null,
  };
}
```

---

### 3.2. `engine.js` — motor de turno e diálogo

O `engine.js` é o centro do subsistema. Ele faz muita coisa: lê estado, decide se precisa reiniciar
loop, embute anexos, cria callbacks de streaming/reasoning, dispara SSE, materializa resposta final,
faz reconciliação, imprime output, registra métricas e persiste turnos.

#### Pontos fortes

- Possui mutex sequencial (`_sendTurnMutex`) para serializar turnos.
- Protege contra fila maior que `MAX_TURN_QUEUE_SIZE`.
- Usa retries em `ensureDialogLoop()`.
- Integra contexto real/estimado e avisa quando a context window está alta.
- Materializa respostas finais com diagnóstico de streaming.
- Usa callbacks para reasoning/delta, separando render de transporte.
- Limpa `busy` e redesenha prompt no `finally`.

#### Bugs e riscos

**ENG-01 — `sendTurn()` engole erro e retorna `null`, dificultando teste e automação.**

A linha conceitual é:

```js
const next = _sendTurnMutex.then(() => _executeTurn(...)).catch(() => null);
```

Como `_executeTurn()` já tem `try/catch`, esse `.catch(() => null)` adicional esconde erros
inesperados e torna o contrato opaco. Para testes e chamadas programáticas, seria melhor retornar um
objeto discriminado:

```js
type TurnResult =
  | { ok: true; reply: string; diagnostics: TurnDiagnostics }
  | { ok: false; error: Error; stage: string; diagnostics: TurnDiagnostics };
```

**ENG-02 — Attachments e request headers são consumidos antes do turno ser realmente executado.**

O código captura `attachments` e `requestHeaders`, limpa as filas imediatamente e só depois entra no
mutex. Se o turno falhar antes de enviar ao SDK, o material do usuário é perdido. Isso é
particularmente problemático quando:

- `ensureDialogLoop()` falha;
- o SDK rejeita por permissão/cota;
- há timeout;
- `runTerminalDialogTurnDetailed()` lança exceção.

**Situação ideal:** limpar as filas apenas após ack de envio, ou re-enfileirar em caso de falha
pré-dispatch. Exemplo:

```js
const reserved = reserveNextTurnPayload();
try {
  const result = await executeReservedTurn(reserved);
  commitReservedTurn(reserved.id);
  return result;
} catch (err) {
  rollbackReservedTurn(reserved.id);
  throw err;
}
```

**ENG-03 — `ensureDialogLoop()` pode retornar “sucesso” quando o diálogo está pausado.**

Quando `runtimeState.dialogPaused` é verdadeiro, `ensureDialogLoop()` retorna `Promise.resolve()`.
Em seguida, `_executeTurn()` continua e chama `runTerminalDialogTurnDetailed()`. Isso conflita com a
semântica de “pausado”: se está pausado, um novo turno deveria ser recusado, agendado ou
explicitamente autorizado.

**Correção:** distinguir `ensureDialogLoop()` de `assertDialogLoopReadyForTurn()`.

```js
const readiness = await ensureDialogLoopReady({ allowPaused: false });
if (!readiness.ok) return { ok: false, reason: readiness.reason };
```

**ENG-04 — polling manual com deadlines sem AbortSignal.**

`_tryStartDialogLoop()` faz polling com `Date.now()` e `sleepMs(500)`. Funciona, mas é pouco
idiomático para Node 24. O ideal é usar `AbortController`, `timers/promises.setTimeout()` e uma
função `waitForState()` cancelável.

**Modelo ideal:**

```js
import { setTimeout as delay } from "node:timers/promises";

async function waitForRuntimeStatus(predicate, { timeoutMs, signal }) {
  const deadline = AbortSignal.timeout(timeoutMs);
  const composite = AbortSignal.any([signal, deadline]);
  while (!composite.aborted) {
    const state = readTerminalRuntimeControlState();
    if (predicate(state)) return state;
    await delay(250, undefined, { signal: composite });
  }
  throw new DOMException("Runtime state wait timed out", "TimeoutError");
}
```

**ENG-05 — Render lock pode ficar preso em caso de erro.**

`turn-display.js` chama `beginTerminalRenderLock()` quando inicia reasoning ou streaming;
`renderStreamingFooter()` chama `releaseRenderLock()`. Porém `engine.js` só chama
`renderStreamingFooter()` depois de `runTerminalDialogTurnDetailed()` completar. Se o SDK lançar
erro após streaming ter começado, o `catch` de `engine.js` não libera o lock.

**Sintoma provável:** prompt deixa de redesenhar; linhas futuras parecem “presas”; estado de
renderização fica inconsistente.

**Correção imediata:** exportar `releaseDisplayState()` ou tornar `renderStreamingFooter()` seguro
para erro e sempre chamar no `finally`.

```js
let displayState = null;
try {
  displayState = createDisplayState(...);
  await runTerminalDialogTurnDetailed(...);
} catch (err) {
  if (displayState) renderStreamingAbortFooter(displayState, err);
  throw err;
} finally {
  if (displayState) releaseDisplayState(displayState);
}
```

**ENG-06 — Embedding de anexos carrega tudo em memória e descarta excedente silenciosamente.**

O código usa `Promise.all()` para transformar todos os anexos em strings, mede bytes e para quando
excede `MAX_EMBED_BYTES`. Se anexos excedem o limite, o usuário recebe pouca ou nenhuma informação
sobre o que foi descartado.

**Upgrade ideal:**

- processar anexos sequencialmente;
- emitir diagnóstico por arquivo;
- suportar streaming/chunking;
- usar `SessionFs` do SDK 0.3.0 quando disponível;
- retornar relatório de anexos aceitos/rejeitados.

**ENG-07 — `requestHeaders` por turno são aceitos sem governança.**

O SDK 0.3.0 suporta headers customizados por sessão/mensagem para BYOK, mas isso é sensível. Headers
podem carregar chaves ou dados de autenticação. O engine apenas lista os nomes e despacha. O ideal é
aplicar política:

- allowlist de headers;
- redaction de nomes sensíveis;
- auditoria de origem;
- escopo por sessão;
- confirmação do usuário para headers não previstos.

**ENG-08 — Persistência fora do caminho crítico, mas sem outbox transacional.**

`persistTurnToHub()` é chamado ao fim do turno. Se falha, loga warning. Porém o turno pode ser
renderizado ao usuário e não ficar persistido. Isso precisa aparecer em `/status` e no prompt,
porque a conversa pode parecer registrada quando não está.

**ENG-09 — `BOOT_PROMPT` é importado no engine, mas `resumeSessionAttach = true` faz
`startTerminalDialogMode(undefined, ...)`.**

A linha conceitual é:

```js
const resumeSessionAttach = true;
await startTerminalDialogMode(resumeSessionAttach ? undefined : (BOOT_PROMPT ?? undefined), ...)
```

Isso significa que a sessão sempre reanexa sem boot prompt. Se for uma sessão nova sem estado READY,
pode depender de comportamento implícito em outro gateway. A decisão “usar ou não boot prompt”
deveria vir de uma projeção explícita:

```js
const mode = decideDialogAttachMode({
  runtimeState,
  sdkSessionState,
  hubState,
});
```

---

### 3.3. `engine-persistence.js` — persistência e notificações pendentes

O módulo foi extraído do engine para reduzir complexidade. Isso é positivo. Ele mantém
`_pendingNotifications` com limite 50 e `_persistenceFailureCount`.

#### Pontos fortes

- Isola a persistência do engine.
- Possui fila de notificações pendentes quando o Hub não está pronto.
- Se `notifyTerminalHubTurn()` falha, re-enfileira a notificação.

#### Bugs/gaps

**PER-01 — Escrita user/reply não é transacional.**

`persistTurnToHub()` chama `store.writeTurn()` duas vezes. Se a primeira gravação passar e a segunda
falhar, a sessão fica com uma mensagem do usuário sem resposta correlata.

**Solução ideal:** `store.writeTurnPair()` transacional.

```js
await store.transaction(async (tx) => {
  const user = await tx.writeTurn(...);
  const reply = await tx.writeTurn(...);
  await tx.writeTurnLink(user.id, reply.id, { durationMs, traceId });
});
```

**PER-02 — `_persistenceFailureCount` não conta falhas de write.**

A contagem só aumenta em falhas de notify. Se `store.writeTurn()` falha, a função lança antes e a
contagem não é incrementada. O número de falhas exibido ao usuário tende a ser subestimado.

**PER-03 — Fila cheia descarta silenciosamente.**

`_enqueuePendingNotification()` faz:

```js
if (_pendingNotifications.length >= MAX_PENDING_NOTIFICATIONS) return;
```

Quando cheia, perde notificações sem log, métrica ou SSE. Esse tipo de perda é perigoso em
auditoria.

**Solução:** política explícita: drop-oldest com log, drop-new com log, ou spool em disco.

**PER-04 — Falhas dentro de `_enqueuePendingNotification()` não são capturadas.**

A função chama `readTerminalHubTurn()` para reconstruir números de turno. Se essa leitura falhar, o
erro pode interromper o fluxo de persistência. Como é path de fallback, deveria ser especialmente
defensivo.

**PER-05 — Ausência de outbox persistente.**

Se o processo cai enquanto `_pendingNotifications` tem itens, perde notificações. O ideal é uma
outbox persistente em SQLite/JSONL com status `pending`, `sent`, `failed`, `retryAt`.

---

### 3.4. `sse.js` — broadcast, replay e Socket.io

O módulo `sse.js` transmite eventos para SSE raw, Socket.io e `eventFanout`. Ele também adiciona
`hubSessionId` e grava arquivo/event archive.

#### Pontos fortes

- Sanitiza nome do evento removendo CR/LF.
- Usa replay buffer.
- Arquiva eventos.
- Faz broadcast por sessão quando há `hubSessionId`.
- Se o client write falha por exceção, remove o client.

#### Bugs/gaps

**SSE-01 — `JSON.stringify` sem proteção.**

`writeSseEvent()` monta:

```js
data: ${JSON.stringify(enrichedData)}


```

`JSON.stringify()` pode lançar por `BigInt`, ciclos ou `toJSON()` mal comportado. O erro não é
capturado dentro de `writeSseEvent`, então pode quebrar `emitSse()`.

**Solução:** `safeJsonStringify()` com redaction, limite de profundidade e substituição de BigInt.

**SSE-02 — Truncamento só cobre `content`.**

O código reduz `data.content`, mas eventos de streaming usam `chunk`, reasoning usa `content` em
alguns lugares, metadados aninhados podem ser enormes. O truncamento precisa ser schema-aware e
recursivo.

**SSE-03 — `recordTerminalSseEventArchive()` e `eventFanout.publish()` estão no caminho crítico.**

Se archive ou fanout lançarem exceção, o broadcast pode falhar. Essas chamadas deveriam estar em
`try/catch` isolados.

**SSE-04 — Backpressure ignorada.**

`client.write(payload)` retorna boolean. Se retorna `false`, há backpressure. O código ignora, o que
pode aumentar buffer de memória com clientes lentos.

**Solução:**

- manter fila por client com limite;
- se passar do limite, desconectar client lento;
- usar `drain`;
- contar métricas de dropped events.

**SSE-05 — Segurança de sessão.**

O módulo injeta `hubSessionId`, mas não autentica nem autoriza quem recebe eventos. A autorização
pode estar em outra camada, mas este módulo deveria documentar o contrato e, idealmente, receber
`sessionScope` ou `clientScope` para filtrar eventos.

---

### 3.5. `output.js` — prompt, stdout e boot prompt

Esse arquivo é poderoso e delicado. Ele controla o prompt, status inline, locks de renderização,
mensagens finais, clear line, boot prompt e medidas de largura.

#### Pontos fortes

- Tem uma política transcript-first: overlay de status inline só é opt-in
  (`COPILOT_TERMINAL_INLINE_STATUS=overlay`), reduzindo bugs visuais.
- Usa `WeakMap` para agendar um único redraw por readline.
- Possui `beginTerminalRenderLock()`/`endTerminalRenderLock()` para coordenar streaming com prompt.
- Tem prompt dinâmico com tags `[NOLOOP]`, `[PAUSED]`, `[ASK]`, `[MODEL-CHECK]`, queue e shadow.
- O boot prompt é claro sobre contrato zero-PR e protocolo `READY`/`REPLY`.

#### Bugs/gaps

**OUT-01 — Controle de ANSI incompleto.**

`stripAnsiEscapes()` usa regex para CSI (`ESC [`), mas não cobre OSC (`ESC ]`), DCS, APC, hyperlinks
OSC 8, BEL/ST e outras sequências. Além disso, o output do modelo é escrito bruto em
`turn-display.js`.

**Solução:** criar `sanitizeTerminalText()` central, com duas saídas:

- `stripForMeasure()` — remove ANSI e controles para medição;
- `escapeForRender()` — neutraliza controles antes de escrever no terminal.

**OUT-02 — Largura de texto incorreta para emojis/CJK/graphemes.**

`visibleTextLength()` usa `Array.from()`, que conta code points, não largura física. Emojis podem
ocupar 2 colunas, combinações Unicode podem ocupar 1, caracteres CJK geralmente ocupam 2. Isso
impacta prompt, wrap e status.

**Solução:** usar pacote `string-width` ou implementar `Intl.Segmenter` + tabela East Asian Width.

**OUT-03 — `scheduleTerminalPromptRedraw()` pode chamar `rl.prompt()` em readline fechado.**

Node 24 tem validações mais estritas em readline. Se o readline for fechado entre agendar e executar
`setImmediate`, `rl.prompt()` pode lançar.

**Correção:** encapsular em try/catch e checar `rl.closed` quando disponível.

**OUT-04 — Backpressure de stdout ignorada.**

`process.stdout.write()` é chamado em muitos lugares sem verificar retorno. Em terminal local
geralmente é aceitável, mas em pipes, logs, CI ou pseudo-terminals lentos pode gerar buffers
grandes.

**OUT-05 — Boot prompt acopla semântica do SDK dentro de output.**

O `README.md` diz que esta pasta não deve decidir semântica do SDK por conta própria. Porém
`DEFAULT_BOOT_PROMPT` contém protocolo operacional zero‑PR, READY/REPLY e regras de loop. Isso pode
ser aceitável como UX, mas idealmente o prompt deve vir de uma projeção/configuração externa
estabilizada, não de `dialog/output.js`.

---

### 3.6. `turn-display.js` — rendering de streaming/reasoning

Esse arquivo cuida dos callbacks de reasoning e delta. Ele é crítico para UX e segurança.

#### Pontos fortes

- Separa callbacks de display do engine.
- Mede TTFT e streaming chars.
- Registra histórico de thinking.
- Usa `renderLock` para impedir prompt redraw durante escrita contínua.
- Envia `delta` e `reasoning` por SSE com correlação de trace/turn.

#### Bugs/gaps

**DISP-01 — Escreve chunks do modelo diretamente no terminal.**

`writeStreamingText()` chama `writeTerminalRaw(rest)` para conteúdo vindo do modelo. Isso permite
terminal injection. Exemplo de ataque: um chunk com `\x1b[2J\x1b[H` limpa a tela; OSC 8 pode criar
links invisíveis; sequências de título podem alterar a janela.

**Correção:** todo output vindo de modelo/tool/SDK deve passar por `escapeForTerminalRender()`.

**DISP-02 — Reasoning completo é acumulado e transmitido.**

`state.reasoningContent += chunk` acumula todo o reasoning em memória e `reasoning.complete`
transmite `content: state.reasoningContent`. Dependendo do modelo e política, isso pode expor
raciocínio interno, tokens sensíveis, payloads grandes ou conteúdo não destinado ao usuário.

**Situação ideal:**

- por padrão, não transmitir raw reasoning;
- armazenar apenas resumo, contagem, hash e ID;
- permitir raw reasoning apenas em modo debug explícito com limite e redaction;
- enviar `reasoning.progress` com contadores, não conteúdo.

**DISP-03 — Render lock sem RAII.**

O lock é acionado em `ensureRenderLock(state)` e solto só em `renderStreamingFooter()`. Isso precisa
ser protegido por `try/finally` no engine ou por `Symbol.dispose`/`Symbol.asyncDispose`.

**DISP-04 — Sem suporte explícito a `agentId` do SDK 0.3.0.**

O SDK 0.3.0 passou a entregar deltas de sub-agentes por padrão. O callback aceita envelope genérico
com `source`, `streamId`, `chunkSeq`, etc., mas não trata `agentId`. Se deltas de sub-agentes
chegarem intercalados, a saída do terminal pode misturar texto do agente raiz e sub-agentes.

**Correção:** incluir `agentId`, `agentRole`, `agentDisplayName` no `TurnDisplayState` e permitir
política:

- `root-only`;
- `show-subagents-collapsed`;
- `show-all-with-prefix`;
- `debug-agent-streams`.

**DISP-05 — `stripTerminalInvisibleText()` incompleto.**

Ele trata CSI (`ESC [`), mas não cobre OSC/DCS/APC nem todas as sequências. Isso afeta medição e
segurança.

---

### 3.7. `turn-reconciliation.js` — reconciliação final

O módulo é pequeno e tenta evitar duplicação quando o SDK entrega deltas e depois a mensagem final
completa.

#### Pontos fortes

- Simples e compreensível.
- Distingue `already_streamed`, `no_visible_stream`, `stream_suffix`, `stream_mismatch` e
  `empty_reply`.
- Evita duplicação quando stream e final são iguais.

#### Bug principal

**REC-01 — Sufixo calculado no texto normalizado perde formatação.**

O código faz:

```js
const suffix = finalNormalized.slice(streamedNormalized.length);
return { mode: "suffix", content: suffix };
```

Esse `suffix` não é extraído do `reply` original, mas de uma versão normalizada. Assim, se a parte
faltante contém indentação, quebras de linha, Markdown, espaços significativos ou blocos de código,
a renderização pode sair corrompida.

**Correção ideal:** gerar mapa de normalização para índices originais ou usar diff de texto.

Pseudoabordagem:

```js
const finalMap = buildNormalizedIndexMap(reply);
const suffixRawStart =
  finalMap[streamedNormalized.length]?.rawIndex ?? reply.length;
const suffix = reply.slice(suffixRawStart);
```

**REC-02 — Divergência pequena vira render full.**

Qualquer diferença que não seja prefixo gera `stream_mismatch` e render completo, duplicando
potencialmente quase toda a resposta. Um diff mais inteligente poderia renderizar apenas um patch ou
aviso.

---

### 3.8. `index.js` — barrel público

O barrel exporta persistência, runtime lazy, output, SSE e callbacks. Ele cumpre papel de interface
pública.

#### Gap

**BAR-01 — Barrel expõe APIs internas demais.**

Exporta `createDeltaCallback`, `createDisplayState`, `renderStreamingFooter`, `broadcastSse`,
`println`, `writeInlineStatus`, etc. Isso facilita acoplamento externo a detalhes de renderização.

**Situação ideal:** dois barrels:

- `dialog/public.js` — APIs estáveis: `sendTurn`, `ensureDialogLoop`, `getDialogSnapshot`.
- `dialog/internal.js` — APIs internas usadas por testes e wiring.

---

## 4. A tensão com o README: o que a pasta promete vs. o que faz

O README afirma:

> Esta pasta não deve decidir semântica do SDK por conta própria.

Na prática, a pasta ainda decide ou codifica partes semânticas importantes:

- `output.js` contém o boot prompt e o protocolo `READY`/`REPLY`.
- `engine.js` decide que READY pendente significa loop semanticamente vivo.
- `engine.js` decide quando reanexar sessão sem boot prompt.
- `turn-display.js` decide como tratar reasoning e deltas.
- `sse.js` decide que eventos recebem `hubSessionId` e como são fanoutados.

Isso não é “errado”, mas indica que a pasta é mais que render/output: ela se tornou o
**micro-orquestrador do loop de diálogo**. A solução não é remover funcionalidade; é explicitar
contratos e mover decisões semânticas para projeções e policies.

Situação ideal:

```txt
frontend/gateways/       → lê SDK/runtime bruto
frontend/projections/    → estabiliza verdade semântica
terminal/dialog/policies → decide UX do terminal a partir das projections
terminal/dialog/render   → renderiza sem decidir semântica
terminal/dialog/events   → emite eventos schema-first
```

---

## 5. Situação ideal perfeita com Node 24+

### 5.1. Princípios

1. **Cada turno é uma transação lógica.** Deve haver `turnId`, `traceId`, `abortSignal`, `state`,
   `input`, `attachments`, `requestHeaders`, `stream`, `finalReply`, `persistenceStatus`.
2. **Nenhum output não confiável escreve raw no terminal.** Toda saída de modelo, tool, SDK ou rede
   passa por sanitização.
3. **Toda operação longa é abortável.** Boot, wait idle, ensure loop, SDK send, persistence, SSE
   fanout e compaction devem aceitar `AbortSignal`.
4. **Render lock é RAII/disposable.** Se o código entrar em modo streaming, o lock será liberado
   mesmo com exceção.
5. **SSE é schema-first.** Cada evento tem tipo, versão, limite de tamanho, redaction e safe
   stringify.
6. **Persistência é outbox transacional.** O par user/reply é gravado atomicamente; notify é
   assíncrono e recuperável.
7. **SDK 0.3.0 é primeira classe.** Per-session auth, scoped permissions, skills, sub-agent
   streaming, usage metrics, SessionFs e MCP são expostos como capacidades do terminal.
8. **Node 24 é explorado sem fetichismo.** Usar `node:test`, `timers/promises`,
   `AbortSignal.timeout`, `AbortSignal.any`, `AsyncLocalStorage`, permission model e explicit
   resource management onde melhoram confiabilidade.

### 5.2. Máquina de estados proposta

Estados explícitos:

```txt
UNLOADED
LOADING_ENGINE
ENGINE_READY
BOOTING_AGENT
READY
BUSY_PREPARING_TURN
BUSY_STREAMING
WAITING_HUMAN
PAUSED
RECOVERING
DEGRADED_PERSISTENCE
STOPPING
STOPPED
FATAL
```

Eventos:

```txt
engine.import.started
engine.import.failed
agent.start.requested
agent.ready
turn.queued
turn.started
turn.delta
turn.reasoning.progress
turn.final.received
turn.reconciled
turn.persisted
turn.persistence.failed
turn.aborted
turn.failed
render.lock.acquired
render.lock.released
sse.event.dropped
sse.client.backpressure
```

### 5.3. API ideal do engine

```js
export async function sendTurn(input, options = {}) {
  const turn = await turnCoordinator.createTurn(input, options);
  using renderLock = render.createLock({ turnId: turn.id });
  using abortScope = createTurnAbortScope(options.signal);

  try {
    await dialogLoop.ensureReady({ signal: abortScope.signal });
    const stream = await sdkTransport.send(turn, { signal: abortScope.signal });
    const result = await streamProcessor.consume(stream, {
      signal: abortScope.signal,
    });
    await persistence.persistTurnPair(result, { signal: abortScope.signal });
    return { ok: true, ...result };
  } catch (error) {
    await turnCoordinator.failTurn(turn, error);
    return { ok: false, error: serializeError(error), turnId: turn.id };
  }
}
```

### 5.4. Uso ideal de Node 24

| Recurso Node 24                               | Uso ideal no terminal                                                                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `timers/promises`                             | Substituir polling manual com `sleepMs(500)` por waits canceláveis.                                                                             |
| `AbortSignal.timeout()` / `AbortSignal.any()` | Timeouts de boot, turn, persistence e SSE fanout.                                                                                               |
| `AsyncLocalStorage` com `AsyncContextFrame`   | Propagar `traceId`, `turnId`, `hubSessionId`, `agentId` em logs, SSE e persistência.                                                            |
| Permission model `--permission`               | Rodar terminal com `--permission --allow-fs-read=<workspace> --allow-fs-write=<workspace/logs> --allow-child-process=<git/gh>` quando possível. |
| Explicit resource management                  | Disposables para render locks, watchers, SSE client handles e timers.                                                                           |
| `node:test`                                   | Testes nativos para engine, reconciliation, SSE, output e persistence.                                                                          |
| `RegExp.escape()`                             | Construção segura de regex em sanitizadores, prompts e filtros.                                                                                 |
| `URLPattern`                                  | Validação de rotas/eventos internos e endpoints de SSE/Hub se usados.                                                                           |
| Undici 7/fetch                                | Chamadas HTTP internas com timeout, abort e streaming nativo.                                                                                   |

### 5.5. Uso ideal do Copilot SDK 0.3.0

| Capacidade SDK 0.3.0                               | Aplicação ideal                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Per-session `gitHubToken`                          | Sessões isoladas por usuário/token, com quota e content exclusion corretos.                 |
| `defaultAgent.excludedTools`                       | Ocultar ferramentas perigosas do agente raiz e delegar a sub-agentes especializados.        |
| `skills: string[]` por agente                      | Injetar skills específicas conforme tarefa/escopo, sem herança acidental.                   |
| Sub-agent streaming com `agentId`                  | UI separa deltas do root agent e sub-agentes, evitando mistura visual.                      |
| `sessionIdleTimeoutSeconds`                        | Limpeza automática de sessões inativas + keepalive explícito e status no prompt.            |
| `requestHeaders` por create/resume/send            | Governança de BYOK headers, allowlist, redaction e auditoria.                               |
| `convertMcpCallToolResult()`                       | Bridge MCP consistente com `ToolResultObject`, incluindo texto, imagem e resources.         |
| RPC skills/permissions/mcp/instructions/usage/name | Comandos `/sdk skills`, `/sdk permissions`, `/sdk usage`, `/sdk instructions`, `/sdk name`. |
| Scoped approvals                                   | `/permission approve once/session/location`, com resumo de escopos ativos e revogação.      |
| SessionFsProvider idiomático                       | Provider local seguro, com throw-on-error, paths normalizados e suporte a streaming/chunks. |

---

## 6. Correções prioritárias com exemplos

### 6.1. Fix do render lock preso

Adicionar API em `turn-display.js`:

```js
export function releaseDisplayState(state) {
  if (!state) return;
  if (state.streamingBuffer) {
    flushStreamingBuffer(state, { force: true });
  }
  releaseRenderLock(state);
}
```

Usar no `engine.js`:

```js
let displayState = null;
try {
  displayState = createDisplayState(...);
  // run turn
} catch (e) {
  if (displayState) {
    recordTerminalActivity('error', 'Turno abortado durante render', {...});
  }
  throw e;
} finally {
  if (displayState) releaseDisplayState(displayState);
}
```

### 6.2. Safe stringify para SSE

```js
function safeJsonStringify(value, { maxDepth = 8, maxString = 20_000 } = {}) {
  const seen = new WeakSet();
  function normalize(v, depth) {
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "string")
      return v.length > maxString ? `${v.slice(0, maxString)}[…truncado]` : v;
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return "[Circular]";
    if (depth <= 0) return "[MaxDepth]";
    seen.add(v);
    if (Array.isArray(v)) return v.map((x) => normalize(x, depth - 1));
    return Object.fromEntries(
      Object.entries(v).map(([k, val]) => [k, normalize(val, depth - 1)]),
    );
  }
  return JSON.stringify(normalize(value, maxDepth));
}
```

### 6.3. Sanitização terminal-safe

```js
export function escapeForTerminalRender(input) {
  return String(input)
    .replace(/\x1B\][\s\S]*?(?:\x07|\x1B\\)/g, "") // OSC
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "") // CSI
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}
```

Usar antes de `writeTerminalRaw()` em chunks de modelo e tool.

### 6.4. Lazy import resiliente

```js
_engineModulePromise = import("./engine.js")
  .then((mod) => {
    _engineModule = mod;
    return mod;
  })
  .catch((err) => {
    _engineModulePromise = null;
    _engineModule = null;
    throw err;
  });
```

### 6.5. Outbox transacional

```txt
conversation_turns
  id
  session_id
  role
  content
  metadata
  created_at

turn_pairs
  id
  session_id
  user_turn_id
  assistant_turn_id
  trace_id
  duration_ms

notification_outbox
  id
  turn_pair_id
  status: pending|sent|failed
  attempt_count
  next_retry_at
  last_error
```

---

## 7. Roadmap em fases e subfases

### Fase 0 — Baseline, inventário e contrato mínimo

**Objetivo:** travar o estado atual, medir riscos e criar rede de segurança.

#### 0.1. Inventário técnico

- Mapear APIs exportadas por `index.js` e classificá-las como pública/interna.
- Listar todos os eventos SSE emitidos e seus schemas reais.
- Listar todos os estados possíveis de `readTerminalRuntimeState()` consumidos pela pasta.
- Listar todos os locais que escrevem em `process.stdout`.

#### 0.2. Testes snapshot atuais

Criar testes Node 24 (`node:test`) para:

- `decideFinalTranscriptRender()`;
- `stripTerminalInvisibleText()`;
- `buildUserPrompt()`;
- `broadcastSse()` com payload simples;
- `drainPendingNotifications()`;
- `dialog-runtime` retry/failure behavior.

#### 0.3. Métricas iniciais

- TTFT médio/p95.
- duração média/p95 de turnos.
- quantidade de eventos SSE por turno.
- tamanho médio/p95 de payload SSE.
- falhas de persistência.
- render locks ativos.

---

### Fase 1 — Hotfixes críticos

**Objetivo:** remover riscos que podem travar terminal, vazar conteúdo ou perder dados.

#### 1.1. Render lock seguro

- Adicionar `releaseDisplayState()`.
- Garantir liberação em todos os paths de erro.
- Adicionar teste simulando erro após primeiro delta.

#### 1.2. Safe SSE

- Implementar `safeJsonStringify()`.
- Truncar `content`, `chunk`, `reasoningContent`, `metadata` e arrays grandes.
- Isolar `recordTerminalSseEventArchive` e `eventFanout.publish` em `try/catch`.
- Adicionar métrica `sse.dropped`, `sse.truncated`, `sse.stringifyError`.

#### 1.3. Terminal sanitization

- Implementar `escapeForTerminalRender()`.
- Sanitizar deltas, reasoning summary, mensagens finais e tool output.
- Manter opção debug para ver raw escaped (`\x1b` visível, não executável).

#### 1.4. Lazy import resiliente

- Resetar `_engineModulePromise` em falha.
- Exportar estado de carregamento.
- Testar falha/retry de import com mock.

#### 1.5. Persistência defensiva

- Incrementar `_persistenceFailureCount` em falhas de `writeTurn()`.
- Logar quando outbox em memória estiver cheia.
- Não descartar silenciosamente notificações.

---

### Fase 2 — Node 24 idiomático

**Objetivo:** modernizar o runtime sem reescrever a arquitetura inteira.

#### 2.1. AbortController por turno

- Criar `TurnAbortScope`.
- Ligar timeouts de turno a `AbortSignal.timeout()`.
- Cancelar waiting tickers, polling e streaming quando o turno abortar.

#### 2.2. Timers com `node:timers/promises`

- Substituir loops `Date.now() + sleepMs(500)` por `waitForState()` cancelável.
- Garantir `.unref()` onde fizer sentido.

#### 2.3. AsyncLocalStorage

- Criar contexto assíncrono por turno: `{ traceId, turnId, hubSessionId, actor, agentId }`.
- Enriquecer logs/SSE/persistência automaticamente.

#### 2.4. Permission model

- Criar modo experimental:
  - `node --permission`
  - allowlist de leitura/escrita do workspace;
  - permissões de rede para GitHub/Copilot;
  - permissões de child_process para `git`, `gh` apenas quando comandos exigirem.

#### 2.5. Test runner nativo

- Migrar testes críticos para `node:test`.
- Criar fixtures fake de `readTerminalRuntimeState()` e `runTerminalDialogTurnDetailed()`.

---

### Fase 3 — Integração plena com Copilot SDK 0.3.0

**Objetivo:** fazer o terminal entender as novas capacidades do SDK, não apenas “funcionar” com
elas.

#### 3.1. Multi-agent streaming

- Transportar `agentId` nos envelopes de delta/reasoning.
- Política de exibição:
  - root only;
  - sub-agents collapsed;
  - all with prefixes;
  - debug full.
- Evitar interleaving visual sem rótulo.

#### 3.2. Scoped permissions

- Atualizar command surface:
  - `/permission approve-once <id>`;
  - `/permission approve-session <id>`;
  - `/permission approve-location <id>`;
  - `/permission reject <id>`;
  - `/permission reset-session`.
- Exibir escopos ativos no prompt/status.

#### 3.3. Skills e tools por agente

- Adicionar:
  - `/skills discover`;
  - `/skills enable <skill>`;
  - `/skills disable <skill>`;
  - `/tools exclude <tool>`;
  - `/tools include <tool>`.
- Diferenciar root agent e sub-agents.

#### 3.4. Usage metrics e quota

- Integrar `session.rpc.usage.getMetrics()`.
- Melhorar `/context`, `/usage`, prompt e footer com dados reais de tokens/custo.

#### 3.5. SessionFsProvider

- Implementar provider idiomático com plain args e throw-on-error.
- Normalizar paths.
- Integrar com permission model e scoped approvals.
- Adicionar chunks/streams para arquivos grandes.

#### 3.6. Session idle timeout

- Configurar `sessionIdleTimeoutSeconds`.
- Exibir idle TTL no `/status`.
- Enviar keepalive controlado em vez de loops ad hoc.

---

### Fase 4 — Reestruturação arquitetural

**Objetivo:** reduzir complexidade e tornar o subsistema evolutivo.

#### 4.1. Separar `engine.js`

Dividir em:

```txt
engine/
  turn-coordinator.js
  dialog-loop-controller.js
  attachment-materializer.js
  sdk-turn-runner.js
  turn-finalizer.js
  turn-diagnostics.js
  index.js
```

#### 4.2. Separar `output.js`

Dividir em:

```txt
render/
  prompt-builder.js
  terminal-writer.js
  ansi-sanitizer.js
  inline-status.js
  transcript-renderer.js
  boot-prompt.js
```

#### 4.3. SSE schema-first

Criar registro de eventos:

```js
const TerminalSseEvents = {
  "turn.delta": { version: 1, maxBytes: 64_000, critical: false },
  "turn.final": { version: 1, maxBytes: 128_000, critical: true },
  "dialog.ready": { version: 1, maxBytes: 8_000, critical: true },
};
```

#### 4.4. Persistence outbox

Substituir `_pendingNotifications` por outbox persistente, com retries e backoff.

---

### Fase 5 — Segurança e governança

**Objetivo:** tornar a camada segura contra output malicioso, leaks e abuso de permissões.

#### 5.1. Redaction

- Redigir tokens, headers, paths sensíveis e segredos no log/SSE.
- Usar allowlist em `requestHeaders`.

#### 5.2. Raw reasoning off por padrão

- Não transmitir raw reasoning no SSE.
- Mostrar apenas métricas e IDs.
- Modo debug com limite e confirmação.

#### 5.3. Terminal security

- Sanitizar todos os outputs de modelo/tool.
- Adicionar testes com payloads ANSI/OSC.

#### 5.4. Policy-as-code

- Definir `terminal-dialog.policy.json`:
  - max payload SSE;
  - max attachments;
  - allowed event types;
  - allowed headers;
  - permission defaults;
  - streaming policy.

---

### Fase 6 — Observabilidade, performance e UX

**Objetivo:** melhorar diagnósticos e experiência sem sacrificar robustez.

#### 6.1. Métricas e tracing

- `dialog.turn.duration`;
- `dialog.turn.ttft`;
- `dialog.turn.delta_count`;
- `sse.client.backpressure`;
- `render.lock.duration`;
- `persistence.outbox.pending`.

#### 6.2. UX de streaming

- Agrupar deltas em frames de 16–33 ms.
- Mostrar sub-agents com prefixos.
- Preservar prompt sem flicker.

#### 6.3. UX de erro

- Todo erro deve trazer:
  - fase;
  - ação sugerida;
  - comando de diagnóstico;
  - `traceId`.

---

## 8. Prioridade de implementação

### P0 — Corrigir imediatamente

1. Liberar render lock em erro.
2. Sanitizar output de streaming.
3. Safe stringify no SSE.
4. Resetar lazy import em falha.
5. Incrementar falhas de persistência em `writeTurn()`.
6. Logar/contabilizar notificações descartadas.

### P1 — Próxima iteração

1. Transação/outbox persistente.
2. AbortController por turno.
3. `agentId` em streaming.
4. Métricas reais via SDK usage.
5. Tests `node:test` para todos os módulos anexados.

### P2 — Arquitetura ideal

1. Separar `engine.js` e `output.js` em módulos menores.
2. Criar state machine explícita.
3. Integrar permissions/skills/tools do SDK 0.3.0.
4. Criar policies declarativas.

---

## 9. Checklist final de aceitação

O subsistema estará no estado ideal quando:

- [ ] Nenhum erro de SDK deixa render lock preso.
- [ ] Nenhum texto do modelo pode executar sequências ANSI/OSC no terminal.
- [ ] Nenhum payload SSE derruba broadcast por `JSON.stringify`.
- [ ] Eventos SSE têm schema, versão e limites.
- [ ] Cliente SSE lento não causa crescimento ilimitado de memória.
- [ ] Turnos user/reply são persistidos atomicamente.
- [ ] Outbox sobrevive a restart do processo.
- [ ] `dialog-runtime` se recupera de import failure.
- [ ] `turn-reconciliation` preserva formatação original.
- [ ] `engine.js` está abaixo de ~250 linhas ou dividido em serviços claros.
- [ ] `output.js` não contém semântica de protocolo do SDK; apenas render/prompt.
- [ ] SDK 0.3.0: `agentId`, scoped permissions, usage metrics, skills e SessionFs estão integrados.
- [ ] Node 24: `AbortSignal`, `timers/promises`, `AsyncLocalStorage`, permission model e `node:test`
      são utilizados nos pontos apropriados.

---

## 10. Conclusão

A camada `terminal/dialog` já revela maturidade e preocupação com UX, streaming, persistência e
observabilidade. O desenho geral é correto: `engine.js` coordena turnos, `turn-display.js` renderiza
deltas, `sse.js` publica eventos, `engine-persistence.js` grava o histórico e `output.js` cuida do
terminal. A fragilidade está menos na intenção e mais na **ausência de contratos fortes**: contratos
de estado, de erro, de schema SSE, de render lock, de sanitização e de persistência.

A evolução para Node 24+ e Copilot SDK 0.3.0 deve ser feita em duas camadas: primeiro, correções
cirúrgicas que removem bugs críticos; depois, uma refatoração arquitetural que transforme o diálogo
em um sistema transacional, abortável, seguro e multi-agent-aware. A situação ideal não é apenas
“rodar no Node 24”, mas usar o Node 24 como fundamento para um runtime de longa duração: cancelável,
rastreável, com recursos liberados deterministicamente e com superfícies de segurança explícitas.
