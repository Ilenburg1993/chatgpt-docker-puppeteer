# Auditoria — Dialog Loop, Steer e Intervenção Imediata

Data: 2026-05-08  
Escopo: `src/copilot/presentation`, `src/copilot/channel`, `src/copilot/terminal/repl`,
`src/copilot/agent/facades` e fluxo SDK `steerMessage`.

## Objetivo

Aprofundar o caso em que uma segunda inteligência operacional entra durante um turno ativo da
LLM-B. Essa segunda origem pode ser a LLM-A via `/inject`, o usuário humano via terminal, ou uma
próxima rodada automatizada que precisa corrigir o rumo sem esperar a resposta atual terminar.

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

## Semântica canônica implementada

`POST /inject` agora aceita `mode`:

- `queue`: modo padrão. Entra no dialog loop e aguarda uma resposta da LLM-B.
- `steer`: usa o modo SDK `immediate` via `steerMessage()`. Afeta o turno SDK ativo sem aguardar
  `REPLY` do dialog loop. Retorna `202` com `messageId`.
- `interrupt`: chama `abortCurrentMessage()` no runtime ativo e então envia a nova mensagem pelo
  dialog loop como substituição canônica.

Aliases aceitos: `turn` e `dialog` para `queue`; `immediate` para `steer`;
`abort-and-queue` e `abort_and_queue` para `interrupt`.

## Cenários avaliados

### 1. LLM-A envia `/inject` enquanto LLM-B trabalha

Comportamento ideal: por padrão, não deve haver mutação surpresa do turno em andamento. O contrato
default precisa preservar ordem, auditoria e determinismo.

Implementação: `mode=queue` continua sendo o padrão. A mensagem da LLM-A entra como próximo turno.

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

Se a intervenção for `queue`, a próxima LLM-B recebe o turno normalmente após a conclusão atual.
Se for `steer`, a LLM-B atual continua no comando, mas recebe uma mensagem SDK immediate no mesmo
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
- `src/copilot/presentation/runtime-controls.js`
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

- `mode=queue` permanece compatível com clientes antigos.
- `mode=steer` retorna `202`, `reply=null` e `messageId`.
- `mode=interrupt` chama abort antes de enviar o turno substituto.
- `/steer`, `/interrupt` e `/abort` furam a fila do REPL.
