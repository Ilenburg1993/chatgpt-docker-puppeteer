# Auditoria — Dialog Loop, Steer e Intervenção Imediata

Data: 2026-05-08 Escopo: `src/copilot/presentation`, `src/copilot/channel`,
`src/copilot/terminal/repl`, `src/copilot/agent/facades` e fluxo SDK `steerMessage`.

> Nota de leitura: as seções iniciais preservam o histórico da auditoria. O estado canônico vigente
> está consolidado em **Rodada 3.2 — retificação crítica: queue via mailbox zero-PR, sem PR por
> padrão**. Qualquer menção anterior a `mode=queue` como turno canônico/consumo de PR foi suplantada
> por `mode=turn`/`mode=dialog`.

## Objetivo

Aprofundar o caso em que uma segunda inteligência operacional entra durante um turno ativo da LLM-B.
Essa segunda origem pode ser a LLM-A via `/inject`, o usuário humano via terminal, ou uma próxima
rodada automatizada que precisa corrigir o rumo sem esperar a resposta atual terminar.

O princípio canônico adotado é: existe um único dialog loop como dono da serialização de turnos.
Intervenções não criam loop paralelo; elas usam capacidades do SDK ou controles formais do runtime.

## Achado principal

Antes desta rodada, o sistema tinha duas superfícies distintas:

- `/inject` sempre significava “envie um turno e aguarde resposta”.
- `/steer` existia em rota de controle separada, usando `agent.steerMessage()`.
- o terminal tinha `abortCurrentMessage()` para recuperação, mas não uma UX humana canônica para
  “intervir agora”.

Isso deixava uma lacuna arquitetural: a LLM-A podia tentar entrar no meio de um turno usando
`/inject`, mas essa mensagem seria apenas enfileirada. Se o objetivo fosse redirecionar o turno
atual, não havia contrato explícito no canal mais usado pela LLM-A.

## Semântica histórica inicialmente implementada (suplantada pela Rodada 3.2)

`POST /inject` agora aceita `mode`:

- `queue`: modo padrão histórico. Entrava no dialog loop e aguardava resposta da LLM-B. **Retificado
  em 3.2: `queue` agora significa mailbox zero-PR; turno explícito usa `turn`/`dialog`.**
- `steer`: usa o modo SDK `immediate` via `steerMessage()`. Afeta o turno SDK ativo sem aguardar
  `REPLY` do dialog loop. Retorna `202` com `messageId`.
- `interrupt`: chama `abortCurrentMessage()` no runtime ativo e então envia a nova mensagem pelo
  dialog loop como substituição canônica.

Aliases aceitos: `turn` e `dialog` para `queue`; `immediate` para `steer`; `abort-and-queue` e
`abort_and_queue` para `interrupt`.

## Cenários avaliados

### 1. LLM-A envia `/inject` enquanto LLM-B trabalha

Comportamento ideal: por padrão, não deve haver mutação surpresa do turno em andamento. O contrato
default precisa preservar ordem, auditoria e determinismo.

Implementação histórica: `mode=queue` entrava como próximo turno. **Estado vigente: mensagem comum e
`mode=queue` entram no mailbox zero-PR; próximo turno só com `mode=turn`/`mode=dialog`.**

### 2. LLM-A precisa corrigir o rumo do turno ativo

Comportamento ideal: a LLM-A deve poder mandar uma intervenção leve, sem derrubar o turno atual e
sem esperar a fila. Isso é steering, não substituição de turno.

Implementação: `mode=steer` usa a façade `steerAgentRuntimeMessage()`, que desce para
`steerRuntimeMessage()` e finalmente `AlwaysAliveAgent.steerMessage()`. O canal retorna antes de
qualquer `REPLY`, porque o efeito esperado acontece dentro da sessão SDK ativa.

### 3. Humano quer interromper imediatamente

Comportamento ideal: o operador não deve precisar esperar o turno atual consumir todo o tempo. A
intervenção humana deve poder abortar o processamento atual e colocar uma mensagem substituta na
fila canônica.

Implementação no terminal:

- `/steer <msg>` envia intervenção SDK immediate.
- `/interrupt <msg>` aborta o turno ativo e enfileira a mensagem como substituta.
- `/abort` apenas aborta o turno SDK ativo.

Esses comandos são classificados como imediatos em `repl-input-routing.js`, então não ficam presos
atrás de `lineQueue`.

As sequências de abort/interrupção também são serializadas localmente no terminal. Isso evita que
duas intervenções humanas rápidas intercalem `abort` de uma com a mensagem substituta da outra.

### 4. Interrupção durante `ask_user`

Comportamento ideal: resposta normal a `ask_user` continua usando a via direta de
`answerPendingQuestion()`. Interrupção é uma escolha explícita e mais forte: aborta o turno atual.

Implementação: linhas humanas normais ainda tentam responder `ask_user` antes de enfileirar turno.
Somente `/interrupt` e `mode=interrupt` acionam abort.

### 5. Relação com a próxima LLM-B

Se a intervenção for `queue`, a próxima LLM-B recebe o turno normalmente após a conclusão atual. Se
for `steer`, a LLM-B atual continua no comando, mas recebe uma mensagem SDK immediate no mesmo
contexto vivo. Se for `interrupt`, a LLM-B atual é abortada; a próxima execução do dialog loop
processa a mensagem substituta já sob a serialização canônica.

## Riscos reduzidos

- Deadlock por comando de intervenção preso atrás de turno longo.
- Race entre rota separada de steer e rota principal de inject.
- Ambiguidade semântica sobre “mensagem nova” versus “intervenção no turno atual”.
- Uso ad hoc de `abortCurrentMessage()` fora de uma UX e API rastreáveis.
- Interleaving entre duas chamadas `interrupt` simultâneas no mesmo runtime.

## Arquivos alterados nesta rodada

- `src/copilot/agent/facades/agent-runtime-controls.js`
- `src/copilot/agent/facades/index.js`
- `src/copilot/agent/index.js`
- `src/copilot/presentation/runtime/controls.js`
- `src/copilot/presentation/agent-control.js`
- `src/copilot/channel/inject.js`
- `src/copilot/server/routes/agent.js`
- `src/copilot/terminal/frontend/gateways/agent-runtime.js`
- `src/copilot/terminal/repl/repl-command-router.js`
- `src/copilot/terminal/repl/repl-input-routing.js`
- `src/copilot/terminal/commands/help.js`
- `tests/unit/copilot/terminal/test_handlers_agent.spec.js`
- `tests/unit/copilot/terminal/test_repl_input_routing.spec.js`

## Validação esperada

- `mode=queue` permanece compatível com clientes antigos como mailbox zero-PR.
- `mode=steer` retorna `202`, `reply=null` e `messageId`.
- `mode=interrupt` chama abort antes de enviar o turno substituto.
- `/steer`, `/interrupt` e `/abort` furam a fila do REPL.

---

## Nova rodada de auditoria profunda (2026-05-08/09) — achados e correções

### Escopo adicional auditado

- `src/copilot/server/routes/agent.js`
- `src/copilot/presentation/agent-control.js`
- `src/copilot/channel/inject.js`
- `src/copilot/terminal/repl/repl-lifecycle.js`
- `src/copilot/terminal/repl/repl-command-router.js`
- `src/copilot/terminal/repl/repl-input-routing.js`
- `src/copilot/terminal/events/sdk-session-events.js`

### Achado A1 — lacuna semântica entre "steer/interrupt" e "abort" na API `/inject`

**Problema:** a semântica de intervenção humana/operacional já tratava `abort` no REPL, mas a API
HTTP de injeção não tinha `mode=abort` canônico (zero-PR explícito), apenas `queue|steer|interrupt`.

**Risco operacional:** clientes automáticos (LLM-A/orquestradores) ficavam sem uma rota formal para
"apenas abortar" sem enfileirar novo turno, podendo recorrer a `interrupt` indevidamente (consumindo
PR desnecessário).

**Correção aplicada:**

1. `server/routes/agent.js`

- schema zod do `/inject` agora aceita `mode='abort'`.
- regra de validação permite ausência de `message/content` quando `mode=abort`.

2. `presentation/agent-control.js`

- `resolveInjectMode()` passa a resolver `'abort'`.
- `handleInject()` ganhou branch `injectMode === 'abort'`:
  - executa `abortAgentRuntimeCurrentMessage(runtimeId)`;
  - retorna `202` com `reply: null`;
  - registra histórico/diagnóstico com `outcome: 'aborted'`.

3. `channel/inject.js`

- contratos JSDoc atualizados para incluir `mode='abort'` no request/response.

**Resultado:** agora existe trilha oficial para intervenção zero-PR ponta a ponta no canal HTTP.

### Achado A1.1 — race entre intervenções de modos distintos no mesmo runtime

**Problema:** `interrupt` já era serializado por runtime, mas `steer` e `abort` não passavam pela
mesma fila de intervenção. Em concorrência (ex.: `steer` + `abort` quase simultâneos), podia haver
ordem não determinística.

**Correção aplicada:**

- `presentation/agent-control.js` agora serializa **todos** os modos de intervenção (`steer`,
  `abort`, `interrupt`) via `runInjectInterventionSequence(runtimeId, ...)`.

**Resultado:** intervenção por runtime passa a ter ordem determinística e sem interleaving
acidental.

### Achado A2 — risco de supressão permanente de observability em sessões longas

**Problema:** em `sdk-session-events.js`, o rastreamento de external tools "em voo" era por
`Set<string>` de `toolName` sem contagem concorrente e sem expiração temporal.

**Riscos detectados:**

- se um `tool.completed` não chegasse (abort/degradação), a supressão podia ficar presa
  indefinidamente;
- chamadas concorrentes da mesma tool podiam "desmarcar" cedo demais (um completed removia tudo);
- impacto na legibilidade operacional (eventos úteis suprimidos além do necessário).

**Correção aplicada:**

- migração para `Map<string, { count, lastTs }>`;
- contagem de concorrência por `toolName`;
- TTL (`EXTERNAL_TOOL_INFLIGHT_TTL_MS`) + prune defensivo;
- limpeza explícita no `session.shutdown`.

### Achado A3 — crescimento não-limitado de requestIds suprimidos de protocolo

**Problema:** `suppressedProtocolRequestIds` era `Set` sem política de bounded/TTL.

**Risco:** em sessões muito longas com muitos eventos de protocolo (`ready/reply/stopped`), poderia
haver crescimento contínuo de memória (ainda que gradual).

**Correção aplicada:**

- migração para `Map<requestId, timestamp>`;
- TTL (`SUPPRESSED_PROTOCOL_TTL_MS`) + limite máximo (`SUPPRESSED_PROTOCOL_MAX`);
- prune periódico na entrada;
- limpeza no `session.shutdown`.

### Revalidação da política zero-PR (estado atual)

- `mode=queue`: **zero-PR** no estado vigente; entra no mailbox e aguarda `ask_user(kind=question)`.
- `mode=steer`: **pode consumir PR** (SDK `session.send(..., mode='immediate')` ainda participa do
  pipeline de usage).
- `mode=interrupt`: **abort + mailbox** por padrão; só consome PR se fallback de turno for
  habilitado explicitamente.
- `mode=abort` (novo): **zero-PR** (somente interrupção do turno ativo).

### Conclusão da rodada

O fluxo de intervenção está agora mais coerente semanticamente entre HTTP e REPL, com cobertura
explícita de `abort` para cenários zero-PR, e com hardening relevante de observability/memória para
sessões long-running. Isso reduz risco de degradação silenciosa e melhora fluidez operacional sem
matar o dialog loop.

---

## Zero-PR 2.0 — princípio canônico reforçado (nova rodada)

### Meta arquitetural

**Intervenção humana nunca deve abrir novo PR por acidente.**

No modelo 2.0, a cadeia de decisão para input humano passa a ser:

1. `ask_user` pendente → responder (`answer`) no runtime (zero-PR);
2. sem `ask_user`, mas turno ativo → por padrão **bloquear steer** (evita consumo implícito de PR);
3. sem turno ativo → **não** enfileirar por padrão (bloqueia consumo implícito de PR);
4. abrir novo turno só por intenção explícita (`/turn <msg>`, `mode=turn` ou `mode=dialog`).

### Mudanças implementadas

#### 1) Política dinâmica Zero-PR (runtime, sem reinício)

Arquivo: `src/copilot/config/env.js`

- `TERMINAL_ZERO_PR_INTERVENTIONS` (default `true`)
- `TERMINAL_ZERO_PR_ALLOW_QUEUE_FALLBACK` (default `false`)
- `TERMINAL_ZERO_PR_ALLOW_STEER` (default `false`)
- `INJECT_ZERO_PR_USER_DEFAULT` (default `true`)
- `INJECT_ZERO_PR_USER_ALLOW_QUEUE_FALLBACK` (default `false`)
- `INJECT_ZERO_PR_USER_ALLOW_STEER` (default `false`)
- Getters dinâmicos:
  - `getTerminalInterventionPolicy()`
  - `getInjectInterventionPolicy()`

**Efeito:** governança de intervenção muda em runtime via env (sem restart), preservando liberdade
operacional da LLM-B com defaults coerentes ao princípio zero-PR.

#### 2) `/inject` com semântica humana zero-PR por default

Arquivos: `src/copilot/presentation/agent-control.js`, `src/copilot/server/routes/agent.js`

- Novo alias de modo: `auto`.
- Para `from=user`/`from=llm-a` sem modo explícito: resolução não abre PR por default; entra no
  mailbox zero-PR.
- Em `mode=steer` e havendo `ask_user` pendente (`kind=question`): resposta é aplicada via
  `answerAgentPendingQuestion()` em vez de abrir turno.
- Em `mode=steer` para origem operacional com `allowSteer=false`: retorno `202` com preservação no
  mailbox (`ZERO_PR_DEFERRED_MAILBOX`), evitando consumo implícito de PR sem perder intenção.
- Em `mode=queue`: retorno `202` com preservação no mailbox (`ZERO_PR_MAILBOX_QUEUED`).
- `mode=interrupt` para origem operacional aborta e preserva substituição no mailbox quando fallback
  de turno está desabilitado.

**Efeito:** API fica alinhada ao contrato “intervenção humana não consome PR”, com fallback de fila
apenas quando política permitir explicitamente.

#### 3) REPL com texto livre em modo intervenção (não turno)

Arquivo: `src/copilot/terminal/repl/repl-lifecycle.js`

- Texto livre (sem `/`) agora prioriza fluxo zero-PR estrito:
  - responde `ask_user` quando pendente;
  - com `allowSteer=false`, não envia steer e não abre turno implícito;
  - apenas com fallback explícito ativo pode enfileirar turno.
- Logs estruturados adicionados para observability (`accepted`, `fallback`, `blocked`).

**Efeito:** digitação humana não vira novo PR implicitamente; PR só ocorre por ação deliberada.

#### 4) Comando explícito para consumo deliberado de PR

Arquivos: `src/copilot/terminal/repl/repl-command-router.js`,
`src/copilot/terminal/commands/help.js`

- Novo comando: `/turn <mensagem>`, caminho canônico para abrir turno e potencialmente consumir PR.
- `/queue <mensagem>` é mailbox zero-PR.
- `/interrupt` respeita política zero-PR: por default aborta e registra substituição no mailbox.
- Help atualizado para deixar explícita a diferença entre intervenção e abertura de turno.

**Efeito:** separação semântica forte entre:

- **intervenção operacional** (`answer`, `abort`) → zero-PR;
- **steer** → intervenção immediate que pode consumir PR (desligada por padrão em política zero-PR
  estrita);
- **novo turno deliberado** (`/turn`) → pode consumir PR.

### Edge cases críticos cobertos

- Intervenção humana enquanto `ask_user` está ativo: resposta roteada para pending question, sem
  fila.
- Intervenção humana sem turno ativo: bloqueio seguro sem consumo implícito de PR.
- Concorrência de intervenções (`steer/abort/interrupt`): serialização por runtime mantida.
- API client com `from=user`/`from=llm-a` sem `mode`: herda semântica zero-PR automaticamente via
  mailbox.

### Resultado prático

O sistema converge para o objetivo original do dialog loop: **manter o loop sempre ativo e usar
`ask_user`/intervenção como mediadores, evitando consumo de PR por input humano não-intencional**.

---

## Retificação crítica (investigação aprofundada) — consumo de PR em `steer`

### Evidência de código (ponta a ponta)

1. `steer` no runtime usa `sendAgentSdkSession(session, { prompt, mode: 'immediate' })`.
2. A façade chama `sendSession(session, messageOptions)` do wrapper SDK.
3. O runtime trata `assistant.usage` como evento de billing e emite `pr.consumed`.

Arquivos-chave:

- `src/copilot/agent/messaging/agent-messaging.js`
- `src/copilot/agent/facades/agent-sdk-runtime.js`
- `src/copilot/sdk/session-lifecycle.js` (`sendSession`)
- `src/copilot/event-handlers/usage.js` (`assistant.usage` → `pr.consumed`)

### Conclusão técnica

`steer` **não** pode mais ser tratado como “zero-PR garantido”. Ele não abre turno no dialog loop,
mas ainda pode acionar consumo de PR no pipeline SDK/billing.

### Implicação para bursts (múltiplas mensagens seguidas)

Sem política estrita, várias mensagens em sequência no modo `steer` podem gerar múltiplos envios
immediate e aumentar consumo de PR. Com Zero-PR 2.0:

- steer humano fica bloqueado por padrão (`allowSteer=false`);
- queue humano/LLM-A entra no mailbox zero-PR por padrão (`allowQueueFallback=false` impede turno PR
  automático);
- `ask_user`/`abort` seguem como canais zero-PR canônicos.

---

## Zero-PR 3.0 — Mailbox coalescente para intervenção contínua (nova investigação)

### Hipótese investigada

Como manter intervenção contínua (humano + LLM-A) sem PR mesmo com múltiplas mensagens em sequência
e sem quebrar o dialog loop?

### Resposta arquitetural implementada

Foi introduzido um **Runtime Intervention Mailbox** (bounded + coalescente + observável), com os
princípios:

1. intervenção não vira turno automaticamente;
2. intervenção entra em mailbox por runtime;
3. mailbox é drenado automaticamente no próximo `ask_user(kind=question)`;
4. PR permanece ação explícita (`/turn`, `mode=turn`/`mode=dialog`, etc.).

### Caminho E2E atualizado

#### Terminal (texto livre)

- texto livre sem `/` em política zero-PR habilitada:
  - registra no mailbox (`deferred`), não abre turno;
  - informa fila/dropped ao operador.

#### Comandos explícitos

- `/steer` bloqueado por política zero-PR agora registra no mailbox (não perde intenção);
- `/interrupt <msg>` com fallback de fila desativado:
  - aborta turno atual;
  - registra mensagem substituta no mailbox;
  - não abre novo turno.

#### `/inject` (API)

- em caminhos anteriormente 409 (`steer` bloqueado, `queue` bloqueado, sem turno ativo para steer,
  `interrupt` com fallback desativado), agora retorna `202 deferred_mailbox` e registra intervenção
  sem PR;
- cobertura estendida para origem `llm-a`/`llm_a` (além de `user`) no fluxo zero-PR.

#### Evento SDK `user_input.requested`

- ao detectar `kind=question`, o runtime tenta consumir mailbox automaticamente via
  `answerPendingQuestion`;
- sucesso: evento `intervention.mailbox.applied` emitido;
- falha: requeue defensivo para não perder intervenção.

### Tratamento de burst (N mensagens seguidas)

- política de coalescência por janela temporal;
- limite máximo por runtime;
- contador de descartes (`dropped`) para auditabilidade;
- comando operacional `/mailbox [status|consume|clear]` para inspeção e controle manual.

### Relação com watchdog e estabilidade do loop

- nenhuma intervenção cria loop paralelo;
- consumo ocorre no ponto de mediação formal (`ask_user`), preservando serialização;
- em caso de saturação, mailbox absorve pressão sem abrir PR acidental.

---

## Novos arquivos/módulos tocados nesta etapa 3.0

- `src/copilot/presentation/runtime-ui-state-store.js`
- `src/copilot/presentation/runtime-ui-state.js`
- `src/copilot/terminal/events/sdk-session-events.js`

E ajustes complementares em:

- `src/copilot/presentation/agent-control.js`
- `src/copilot/terminal/repl/repl-lifecycle.js`
- `src/copilot/terminal/repl/repl-command-router.js`
- `src/copilot/terminal/commands/help.js`
- `src/copilot/config/env.js`

---

## Conclusão consolidada (estado atual)

O sistema evoluiu de um zero-PR “defensivo” (bloquear) para um zero-PR “operável” (deferir,
coalescer e aplicar na mediação formal). Isso resolve o gap central para intervenção contínua
durante turno ativo sem consumir PR por acidente, mantendo o dialog loop como autoridade de
serialização.

---

## Zero-PR 3.1 — aplicação imediata + compatibilidade profunda com `src/copilot/agent`

### Achado Z31-1 — defer desnecessário quando já existe `ask_user` pendente

**Sintoma:** em alguns caminhos bloqueados por política zero-PR (ex.: `steer` desabilitado), a
intervenção era registrada no mailbox mesmo quando já havia `ask_user(kind=question)` ativo no
runtime, causando atraso evitável até o próximo ciclo de consumo.

**Correção aplicada:**

- `src/copilot/presentation/agent-control.js`
  - novo helper `tryApplyImmediateZeroPrIntervention(runtimeId, message)`;
  - antes de cair em `deferred_mailbox`, tenta responder imediatamente via
    `answerAgentPendingQuestion(...)` quando `pendingQuestionKind === 'question'` e
    `protocolControlled=false`.
  - aplicado em 4 trilhas críticas: `steer` bloqueado, `steer` sem turno ativo (fallback bloqueado),
    `queue` bloqueado e `interrupt` com fallback de fila desabilitado.

- `src/copilot/terminal/repl/repl-command-router.js`
  - novo helper `tryApplyImmediateTerminalZeroPr(message)` com leitura direta do estado runtime;
  - `/steer` bloqueado por política e `/interrupt` (sem queue fallback) agora tentam aplicar
    resposta imediata no `ask_user` antes de registrar mailbox.

**Efeito:** intervenção humana/LLM-A fica mais fluida e continua zero-PR quando o runtime já está em
ponto respondível.

### Achado Z31-2 — watchdog podia ignorar `ask_user` shadow restaurado

**Sintoma:** a supressão de escalonamento do watchdog considerava somente `pendingQuestion` vivo. Em
cenários de restauração (`pendingQuestionShadow`) havia risco de interpretação indevida de stall e
recovery agressivo.

**Correção aplicada:**

- `src/copilot/agent/types.js`
  - contrato de `DialogLoopHost` expandido com:
    - `getPendingQuestionShadowSnapshot?()`
    - `isPendingQuestionShadowExpired?()`

- `src/copilot/agent/dialog/controllers/agent-dialog-controller.js`
  - `ensureDialogLoopAttached()` passa a expor shadow e estado de expiração no host adaptado.

- `src/copilot/agent/dialog/orchestrators/loop-manager.js`
  - `#shouldSuppressWatchdogEscalation()` agora também suprime escalonamento quando há
    `pendingQuestionShadow.kind === 'question'` e shadow não expirada.

**Efeito:** maior estabilidade do dialog loop em cenários de restauração de estado e menor risco de
restart desnecessário durante janelas legítimas de espera por input humano.

### Revalidação sintática da rodada 3.1

Validação executada com `node --check` em:

- `src/copilot/agent/dialog/orchestrators/loop-manager.js`
- `src/copilot/agent/dialog/controllers/agent-dialog-controller.js`
- `src/copilot/presentation/agent-control.js`
- `src/copilot/terminal/repl/repl-command-router.js`
- `src/copilot/agent/types.js`

Resultado: **OK (`OK_ZERO_PR_DEEP_PATCH`)**.

---

## Rodada 3.2 — retificação crítica: queue via mailbox zero-PR, sem PR por padrão

### Motivo da retificação

A tentativa anterior de “fila por padrão + imediato explícito” foi uma regressão conceitual: ela
tratava `queue` como fila canônica de turno SDK, o que pode consumir PR. Isso contradiz o objetivo
central deste trabalho: **o padrão deve ser zero-PR**.

O contrato corrigido é:

1. mensagem comum de usuário/LLM-A deve ir para mailbox zero-PR;
2. `mode=queue`, `/queue`, `!!queue`, `!!fila` e `!!mailbox` também significam mailbox zero-PR;
3. abrir turno SDK que pode consumir PR só é permitido por intenção explícita: `mode=turn`,
   `mode=dialog`, `/turn`, `!!turn` ou `!!dialog`;
4. `steer/immediate` continua uma intenção explícita, mas fica bloqueada por padrão porque
   `SDK immediate` pode consumir PR; quando bloqueada, a mensagem é preservada no mailbox.

### Achado Z32-1 — `queue` era ambíguo e podia significar PR

**Problema:** o mesmo nome `queue` estava sendo usado para duas coisas diferentes:

- fila mailbox zero-PR, aguardando `ask_user(kind=question)`;
- fila de turnos do dialog loop, que dispara `session.send()` e pode consumir PR.

Essa ambiguidade era perigosa porque “quero queue” podia virar “abra um novo turno PR”.

**Correção aplicada:**

- `src/copilot/presentation/agent-control.js`
  - `mode=queue`, `mode=mailbox`, `mode=defer` e `mode=deferred` agora resolvem para `intervene`,
    isto é, mailbox zero-PR;
  - `mode=turn` e `mode=dialog` são os únicos aliases de API que entram no caminho interno
    `queue`/turno canônico;
  - `/inject` sem `mode` usa mailbox zero-PR por default;
  - `from=system` também passa pela proteção zero-PR, evitando PR acidental por origem operacional.

**Resultado:** `queue` deixou de ser nome para turno PR. Turno PR agora precisa ser dito como `turn`
ou `dialog`.

### Achado Z32-2 — REPL precisava separar `/queue` de `/turn`

**Problema:** no terminal, texto livre e comandos de fila podiam ser interpretados como turno
canônico.

**Correção aplicada:**

- `src/copilot/terminal/repl/repl-lifecycle.js`
  - texto livre sem `/` resolve para `intervene` quando a política default é zero-PR;
  - `!!queue`, `!!fila`, `!!mailbox` e `[queue|fila|mailbox|intervene]` vão para mailbox;
  - `!!turn`, `!!dialog` e `[turn|dialog]` são os atalhos explícitos para turno PR.
- `src/copilot/terminal/repl/repl-command-router.js`
  - `/queue <msg>` enfileira no mailbox zero-PR e tenta responder `ask_user` pendente antes;
  - `/turn <msg>` abre um turno explicitamente e alerta que pode consumir PR;
  - `/steer <msg>` fica bloqueado por padrão e cai no mailbox quando
    `TERMINAL_ZERO_PR_ALLOW_STEER=false`;
  - `/interrupt <msg>` aborta o turno ativo e, por padrão, guarda substituição no mailbox zero-PR.
- `src/copilot/terminal/commands/help.js`
  - UX/help atualizada para refletir “mailbox zero-PR por padrão” e “/turn quando aceitar PR”.

### Achado Z32-3 — contrato público precisava aceitar nomes zero-PR sem ambiguidade

**Correção aplicada:**

- `src/copilot/server/routes/agent.js`
  - schema de `/inject` aceita `mailbox`, `defer`, `deferred`, `turn` e `dialog`.
- `src/copilot/channel/inject.js`
  - JSDoc documenta `queue/mailbox` como mailbox zero-PR;
  - documenta que `reply` pode ser `null` em modos assíncronos/mailbox.
- `src/copilot/config/env.js`
  - defaults preservam zero-PR:
    - `TERMINAL_ZERO_PR_INTERVENTIONS=true`;
    - `TERMINAL_ZERO_PR_ALLOW_QUEUE_FALLBACK=false`;
    - `TERMINAL_ZERO_PR_ALLOW_STEER=false`;
    - `TERMINAL_INTERVENTION_DEFAULT_MODE=zero-pr`;
    - `INJECT_ZERO_PR_USER_DEFAULT=true`;
    - `INJECT_ZERO_PR_USER_ALLOW_QUEUE_FALLBACK=false`;
    - `INJECT_ZERO_PR_USER_ALLOW_STEER=false`;
    - `INJECT_USER_DEFAULT_MODE=intervene`.

### Drenagem mailbox confirmada

A investigação confirmou que o mailbox já é a fila correta para zero-PR:

- `src/copilot/presentation/runtime-ui-state-store.js`
  - `enqueueRuntimeInterventionMailbox(...)`;
  - limite por runtime (`TERMINAL_MAX_INTERVENTION_MAILBOX`);
  - coalescência por origem dentro de `TERMINAL_INTERVENTION_MAILBOX_COALESCE_WINDOW_MS`;
  - truncamento por `TERMINAL_INTERVENTION_MAILBOX_MAX_MESSAGE_CHARS`;
  - consumo FIFO por `consumeRuntimeInterventionMailbox(...)`.
- `src/copilot/terminal/events/sdk-session-events.js`
  - em `user_input.requested`, quando `DialogProtocol.classify(question) === 'question'`, consome
    uma entrada do mailbox e responde via `answerTerminalPendingQuestion(...)`;
  - se a resposta não puder ser aplicada, re-enfileira a entrada.

Esse caminho não chama `session.send()` e, portanto, não abre PR.

### Testes adicionados/atualizados

- `tests/unit/copilot/terminal/test_handlers_agent.spec.js`
  - `/inject` sem `mode` enfileira no mailbox zero-PR e não chama `sendAgentDialogTurn`;
  - `mode=turn`/`mode=dialog` são os caminhos explícitos que chamam `sendAgentDialogTurn`;
  - `from=user` sem `mode` permanece zero-PR;
  - `mode=queue` permanece zero-PR;
  - `mode=steer` e `mode=immediate` são bloqueados por padrão e preservados no mailbox;
  - `mode=steer` só chama SDK immediate quando `INJECT_ZERO_PR_USER_ALLOW_STEER=true`;
  - `mode=interrupt` aborta e registra substituição no mailbox por padrão.

### Validação executada

- `node --check` em:
  - `src/copilot/config/env.js`
  - `src/copilot/presentation/agent-control.js`
  - `src/copilot/server/routes/agent.js`
  - `src/copilot/terminal/repl/repl-lifecycle.js`
  - `src/copilot/terminal/repl/repl-command-router.js`
  - `src/copilot/terminal/commands/help.js`
  - `src/copilot/channel/inject.js`
  - `tests/unit/copilot/terminal/test_handlers_agent.spec.js`
- `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/terminal/test_handlers_agent.spec.js tests/unit/copilot/terminal/test_repl_input_routing.spec.js`
- `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/terminal`

Resultado: **OK — 38 testes focados passaram; suíte unitária terminal completa passou com 324
testes**.

### Estado canônico após 3.2 corrigida

- Texto livre no terminal: mailbox zero-PR por padrão.
- `/queue <msg>`: mailbox zero-PR.
- `/turn <msg>`: abre turno explicitamente, pode consumir PR.
- `/inject` sem `mode`: mailbox zero-PR.
- `/inject mode=queue|mailbox|defer|deferred`: mailbox zero-PR.
- `/inject mode=turn|dialog`: turno explícito, pode consumir PR.
- `/inject mode=steer|immediate`: intenção imediata explícita, mas bloqueada por default e
  preservada no mailbox.
- `/inject mode=interrupt`: aborta turno ativo e guarda substituição no mailbox por default.
- `/inject mode=abort`: abort puro, sem mensagem substituta.

---

## Rodada 3.3 — separação formal: SDK queue/steer vs mailbox do dialog loop

### Objetivo desta rodada

Depois da retificação 3.2, ainda havia risco de leitura equivocada por causa de um detalhe nominal:
o código interno historicamente usa `queue` para o caminho de turno do dialog loop, enquanto o
contrato externo agora exige que `queue` signifique **mailbox zero-PR**.

Esta rodada consolida a separação em termos explícitos:

- **SDK direto / turno explícito:** chama `session.send()` direta ou indiretamente e pode emitir
  `assistant.usage` / `pr.consumed`;
- **mailbox do nosso dialog loop:** armazena intervenção em `runtime-ui-state-store` e só aplica via
  `ask_user(kind=question)` + `answerPendingQuestion`, sem abrir novo turno SDK.

### Perguntas investigativas respondidas

#### Pergunta 1 — `queue` externo ainda pode chamar `session.send()`?

**Resposta:** não. No contrato público vigente:

- `/inject mode=queue|mailbox|defer|deferred` resolve para `intervene`;
- `/queue <mensagem>` escreve no mailbox;
- texto livre no terminal, com política zero-PR ativa, escreve no mailbox;
- `!!queue`, `!!fila` e `!!mailbox` também escrevem no mailbox.

O nome interno `queue` ainda existe em `agent-control.js`, mas agora representa somente o caminho
explícito de turno após aliases `turn`/`dialog`. Essa distinção foi documentada em JSDoc no próprio
arquivo para evitar regressão futura.

#### Pergunta 2 — `steer` é zero-PR?

**Resposta:** não como garantia arquitetural. `steer/immediate` usa o caminho SDK immediate e pode
produzir usage / PR. Por isso:

- `mode=steer|immediate` é intenção explícita de intervenção imediata;
- por padrão fica bloqueada para origens operacionais zero-PR;
- quando bloqueada, a mensagem é preservada no mailbox em vez de ser perdida;
- só chama SDK immediate quando a policy de allow-steer estiver explicitamente habilitada.

#### Pergunta 3 — o mailbox é um segundo loop paralelo?

**Resposta:** não. Ele é uma fila de intenção paralela ao ponto de vista da UI/API, mas não um
segundo loop SDK. A serialização continua pertencendo ao dialog loop. O mailbox só é drenado quando
o próprio loop alcança uma mediação formal (`ask_user(kind=question)`), e a aplicação ocorre por
`answerPendingQuestion`.

#### Pergunta 4 — o que acontece se a drenagem falhar?

**Resposta:** a entrada é re-enfileirada defensivamente. A rodada adicionou cobertura unitária para:

- consumo FIFO do mailbox quando chega `user_input.requested` humano;
- chamada a `answerTerminalPendingQuestion(...)`;
- emissão de `intervention.mailbox.applied` no sucesso;
- requeue quando a resposta não consegue ser aplicada.

#### Pergunta 5 — quais rotas continuam PR-capable por design?

**Resposta:** elas continuam existindo, mas agora ficam semanticamente marcadas como explícitas:

- `/inject mode=turn|dialog`;
- `/turn <mensagem>`;
- `mode=steer|immediate` quando `allowSteer=true`;
- `src/copilot/server/routes/copilot-api/control.js` em `_handleSteer(...)`;
- rotas SDK diretas em `src/copilot/server/routes/sdk/session-core-routes.js`;
- helpers diretos em `src/copilot/server/routes/sdk/session-send-helpers.js`;
- `sendAgentSdkSession(...)`, `sendAndWaitWithInactivityTimeout(...)` e wrappers de
  `sendSession(...)`.

Esses caminhos são válidos para operação deliberada, mas não são o padrão zero-PR.

### Correções e reforços aplicados

- `src/copilot/presentation/agent-control.js`
  - aliases externos foram separados em grupos nomeados:
    - `ZERO_PR_MAILBOX_MODE_ALIASES`;
    - `EXPLICIT_TURN_MODE_ALIASES`;
    - `SDK_IMMEDIATE_MODE_ALIASES`;
    - `INTERRUPT_MODE_ALIASES`;
  - JSDoc reforça que `queue/mailbox/defer/deferred` nunca devem chamar `session.send()`;
  - JSDoc reforça que `turn/dialog` são a fronteira explícita para PR-capable turn;
  - JSDoc reforça que `steer/immediate` é SDK immediate e, portanto, não é zero-PR garantido.

- `src/copilot/presentation/runtime-ui-state-store.js`
  - `RuntimeInterventionMailboxEntry` passou a documentar que `modeHint='queue'` é intenção de
    mailbox, não fila SDK;
  - correções de nullable strict em `peek` e coalescência com `entries.at(-1)`.

- `src/copilot/channel/inject.js`
  - cliente de `/inject` deixou de enviar `mode=auto` implicitamente para `from=user`;
  - a ausência de modo agora deixa o servidor aplicar o default canônico: mailbox zero-PR;
  - `reply: null` é preservado para respostas assíncronas/mailbox.

- `src/copilot/core/schemas.js`
  - schema de resposta de `/inject` aceita `reply: null`, `mode` e `messageId`, alinhado ao contrato
    real.

- `src/copilot/server/routes/agent.js`
  - tipagem strict do corpo aceita `mode?: unknown`, evitando buraco entre validação Zod e JSDoc.

- `src/copilot/server/routes/copilot-api/control.js`
  - `_handleSteer(...)` agora tem aviso JSDoc: é rota SDK direta e pode emitir `pr.consumed`.

- `src/copilot/server/routes/sdk/session-send-helpers.js`
  - helper direto recebeu aviso JSDoc equivalente: zero-PR deve usar mailbox + `ask_user`, não
    `sendSession`.

### Regressões cobertas

- `tests/unit/copilot/test_terminal_sdk_session_events.spec.js`
  - mailbox é drenado em `ask_user(kind=question)` humano;
  - `answerTerminalPendingQuestion(...)` é o mecanismo de aplicação;
  - falha de aplicação re-enfileira a intervenção.

- `tests/unit/copilot/test_inject_concurrency.spec.js`
  - ajustado para o contrato real de `InjectResult.reply`, que pode ser `null`.

### Validação executada na rodada 3.3

- `npm run typecheck:strict:src.copilot`
- `npm run typecheck:strict:tests.unit`
- `npm run typecheck:strict`
- `npm run lint:quiet`
- `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/test_terminal_sdk_session_events.spec.js tests/unit/copilot/terminal/test_handlers_agent.spec.js tests/unit/copilot/test_inject_concurrency.spec.js`

Resultado: **OK**.

### Estado canônico consolidado após 3.3

- O default operacional é mailbox zero-PR, inclusive quando o usuário apenas digita texto.
- `queue` externo significa mailbox, não turno SDK.
- Turno SDK/PR-capable só por `turn`/`dialog` ou por rotas SDK diretas deliberadas.
- `steer/immediate` não é tratado como zero-PR; é bloqueado por default e preservado no mailbox.
- O sistema “paralelo” é uma fila de intenção mediada pelo nosso dialog loop, não uma segunda
  conversa SDK.

---

## Rodada 3.4 — smoke live no terminal LLM-B e correção de semântica operacional

### Teste live executado

Foi aberto `npm run terminal:llm-b` e validado:

- boot saudável em `http://127.0.0.1:3009`;
- `/inject mode=queue` retorna `ZERO_PR_MAILBOX_QUEUED` sem reply e incrementa mailbox;
- `/queue <msg>` no REPL incrementa mailbox zero-PR;
- `/mailbox status` mostra fila, fonte e `modeHint`;
- `/turn <msg>` abre turno explícito e pode consumir PR;
- `mode=turn` com conteúdo começando por `!!queue` preserva o prefixo como texto literal quando a
  diretiva conflita com o modo explícito.

### Achado live Z34-1 — a LLM-B confundiu PR com pull request

No primeiro turno operacional, a LLM-B descreveu “zero-PR” como se PR significasse “pull request
pendente”. Isso era um gap de prompt/UX, não do handler: o código já separava mailbox zero-PR de
turno explícito, mas a própria LLM-B não tinha a definição suficientemente explícita no boot/system
prompt.

### Correção aplicada

- `src/copilot/terminal/dialog/output.js`
  - boot prompt padrão agora define que, neste terminal, PR significa paid/prompt request do
    SDK/modelo, não pull request do GitHub;
  - explica que mailbox zero-PR é aplicado via `ask_user`/`answerPendingQuestion`, sem novo
    `session.send()`;
  - explica que `/turn`, `mode=turn`, `mode=dialog`, `!!turn`, `!!dialog`, `steer/immediate` e rotas
    SDK diretas são PR-capable quando usados deliberadamente.

- `src/copilot/config/system-prompt/sections/guidelines.js`
  - a mesma definição foi adicionada ao system prompt modular para cobrir live reload e sessões
    futuras.

- `src/copilot/terminal/repl/repl-banner.js`
  - o banner inicial agora expõe `/queue <msg>`, `/turn <msg>` e `/mailbox [status|consume|clear]`
    como linha própria.

- `src/copilot/terminal/terminal-phases/boot-banner.js`
  - o quadro curto de boot também cita `/queue`, `/turn` e `/mailbox`.

### Confirmação live pós-correção

Após reiniciar `terminal:llm-b`, um turno curto confirmou a semântica correta:

- PR = paid/prompt request;
- zero-PR = operar sem abrir nova requisição ao modelo;
- mailbox = intenção aplicada por `answerPendingQuestion`.

### Validação executada na rodada 3.4

- `node --check` em:
  - `src/copilot/presentation/agent-control.js`
  - `src/copilot/terminal/repl/repl-lifecycle.js`
  - `src/copilot/terminal/dialog/output.js`
  - `src/copilot/config/system-prompt/sections/guidelines.js`
  - `src/copilot/terminal/repl/repl-banner.js`
  - `src/copilot/terminal/terminal-phases/boot-banner.js`
- `npm run typecheck:strict:src.copilot`
- `npm run typecheck:strict:tests.unit`
- `npm run lint:quiet`
- `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/terminal/test_handlers_agent.spec.js tests/unit/copilot/test_terminal_sdk_session_events.spec.js tests/unit/copilot/test_inject_concurrency.spec.js tests/unit/copilot/terminal/test_repl_input_routing.spec.js`

Resultado: **OK**.
