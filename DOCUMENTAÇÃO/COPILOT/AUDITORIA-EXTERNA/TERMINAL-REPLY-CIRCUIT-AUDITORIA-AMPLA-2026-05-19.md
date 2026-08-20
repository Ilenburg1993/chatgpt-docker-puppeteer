# Auditoria Ampla — Circuito de Reply, Streaming e Renderização do Terminal LLM-B

Data: `2026-05-19`

Escopo principal:

- `src/copilot/agent/dialog/**`
- `src/copilot/channel/**`
- `src/copilot/event-handlers/**`
- `src/copilot/terminal/dialog/**`
- `src/copilot/terminal/events/**`
- `src/copilot/terminal/frontend/gateways/dialog.js`
- `src/copilot/terminal/frontend/projections/timeline.js`
- `node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts`

---

## 1. Objetivo desta auditoria

Esta auditoria responde a um problema operacional específico e crítico:

> o operador envia uma mensagem no terminal, o turno consome uso/custo e conclui sem erro aparente,
> mas a resposta da LLM-B não aparece de forma confiável no terminal.

O objetivo aqui não é propor remendos locais; é mapear o circuito inteiro de:

`SDK event → event-handlers → agent/dialog runtime → channel bridge → terminal render → history/timeline`

e definir:

1. a situação atual real;
2. a situação ideal;
3. um roadmap estrutural por faixas, fases e subfases;
4. as transformações necessárias para que a resposta da LLM-B volte a aparecer no terminal de
   maneira canônica e durável.

---

## 2. Taxonomia canônica deste circuito

### 2.1 `SDK session events`

Fonte de verdade externa. No SDK 0.3.0 instalado, os eventos relevantes são:

- `assistant.message`
- `assistant.message_delta`
- `assistant.turn_end`
- `assistant.reasoning_delta`
- `assistant.streaming_delta`

Confirmado em `node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts`:

- `assistant.message.data.content` contém a resposta final textual do assistente;
- `assistant.message_delta.data.deltaContent` contém o streaming textual incremental;
- `assistant.turn_end.data.turnId` contém apenas metadado de fechamento de turno.

### 2.2 `event-handlers`

Layer de normalização SDK → eventos internos do agent.

Owners principais:

- `event-handlers/sdk-responses.js`
- `event-handlers/streaming.js`
- `event-handlers/catch-all.js`

### 2.3 `agent/dialog runtime`

Owner canônico do turno explícito no loop de diálogo.

Owners principais:

- `agent/dialog/orchestrators/loop-manager.js`
- `agent/dialog/executors/turn-executor.js`
- `agent/dialog/seams/turn-execution-context.js`
- `agent/dialog/seams/turn-result-persistence.js`

### 2.4 `channel bridge`

Adapter terminal/consumidores → agent dialog runtime.

Owners principais:

- `channel/client-dialog.js`
- `channel/client.js`

### 2.5 `terminal explicit turn rendering`

Owner da UX do turno explícito no REPL.

Owners principais:

- `terminal/dialog/engine.js`
- `terminal/dialog/turn-display.js`
- `terminal/dialog/output.js`

### 2.6 `terminal out-of-band transcript`

Owner das mensagens da LLM-B que chegam fora do turno explícito, ou como transcript persistente de
eventos.

Owners principais:

- `terminal/events/sdk-session-events.js`
- `terminal/events/task-stream-events.js`
- `terminal/events/assistant-transcript-renderer.js`
- `terminal/state/transcript-state.js`

### 2.7 `history/timeline`

Owner de leitura consolidada posterior, não de render em tempo real.

Owners principais:

- `terminal/frontend/gateways/dialog.js`
- `terminal/frontend/projections/timeline.js`
- `terminal/commands/session.js`

---

## 3. Topologia atual real do reply

## 3.1 Caminho nominal esperado

O caminho nominal esperado do turno explícito é:

1. o terminal chama `runTerminalDialogTurn(...)`;
2. isso delega para `llmBridgeClient.dialogTurn(...)`;
3. o bridge chama `sendRuntimeDialogTurnOnActiveLoop(...)`;
4. o `DialogLoopManager` despacha o turno ao host ativo;
5. o runtime resolve o reply por `dialog.reply` **ou** por fallback semântico;
6. o reply retorna até `engine.js`;
7. o terminal renderiza a resposta e a escreve em histórico/bridge.

## 3.2 O que realmente existe hoje

Hoje existem **quatro superfícies concorrentes** de materialização da resposta:

1. `EMITTER_LOOP_REPLY` / `dialog.reply`
2. `assistant.message`
3. `task.delta` / `dialog.delta`
4. renderização tardia do terminal (`engine.js`) a partir do valor retornado pelo bridge

Além disso, o terminal também possui **múltiplos sinks** concorrentes:

1. `printExchange(...)` no fechamento do turno explícito;
2. `renderTerminalAssistantTranscript(...)` em `sdk-session-events.js`;
3. `task-transcript-accumulator` via `task-stream-events.js`;
4. `llmBridgeClient.history` / projections / timeline persistida.

---

## 4. Evidência operacional observada

Em sessão real com `npm run terminal:llm-b`, foram confirmados os seguintes sintomas:

1. o turno explícito enfileira e conclui;
2. o watchdog/loop permanecem ativos;
3. há linha de usage/billing ao fim do turno;
4. não há erro recente em `/errors`;
5. mesmo assim, a resposta textual da LLM-B não aparece de forma confiável no terminal;
6. `/history` pode permanecer vazio ou insuficiente para o turno recém-concluído;
7. `/status` e `/live` mostram o sistema operacionalmente vivo.

Isso prova que o problema não está simplesmente em “falha total do SDK”.

O problema está na **materialização do reply** e na **governança de owner** desse reply ao longo do
circuito.

---

## 5. Bugs e gaps estruturais identificados

## RC-BUG-001 — owner difuso de resolução do reply

### Situação atual

O reply pode ser decidido em mais de um lugar:

- `turn-executor.js` / `createAssistantReplyFallback(...)`
- `channel/client-dialog.js`
- `engine.js` / renderização terminal final

### Problema

Não existe uma autoridade única, explícita e verificável para responder à pergunta:

> qual é o texto final canônico deste turno explícito?

### Impacto

- aumenta drift entre valor retornado, transcript e timeline;
- permite que o bridge receba `reply=''` embora o runtime já tenha conteúdo semântico suficiente;
- empurra fallback para camadas erradas.

### Situação ideal

O **agent/dialog runtime** deve ser o único owner da resolução semântica do reply do turno.

O `channel/` não deve reinterpretar semanticamente o turno; o `terminal/` menos ainda.

---

## RC-BUG-002 — superfícies duplicadas de streaming (`dialog.delta` vs `task.delta`)

### Situação atual

Quando o dialog loop está ativo:

- `assistant.message_delta` é roteado para `dialog.delta`;
- fora desse caminho, vai para `task.delta`.

Vários consumidores escutam conjuntos diferentes desses eventos.

### Problema

Não há uma superfície única de “output incremental do turno explícito”.

### Impacto

- callbacks do bridge e acumuladores do terminal podem enxergar fluxos diferentes;
- a visibilidade do streaming depende do adapter consumido, não do contrato do turno.

### Situação ideal

Haver uma **surface canônica de output do turno explícito**, e os adapters antigos se tornarem
apenas compatibilidade.

---

## RC-BUG-003 — o terminal explícito depende demais do valor retornado pelo bridge

### Situação atual

`terminal/dialog/engine.js` renderiza a resposta do turno explícito principalmente a partir do
`reply` devolvido por `runTerminalDialogTurn(...)`.

Enquanto o turno está ativo, `assistant.message` é deliberadamente suprimido em
`sdk-session-events.js` quando `getBusy()` está true.

### Problema

Se o bridge retorna `reply=''`, o owner explícito do turno fica praticamente cego, mesmo que eventos
do SDK já tenham conteúdo suficiente.

### Impacto

- o operador não vê a resposta;
- a narrativa do turno explícito depende de quedas oportunísticas em outros listeners.

### Situação ideal

O turno explícito deve fechar com um **reply canônico já materializado** vindo do runtime, e não
depender de renderizadores paralelos para “salvá-lo”.

---

## RC-BUG-004 — múltiplos sinks de transcript competem pelo mesmo conteúdo

### Situação atual

O mesmo conteúdo pode tentar entrar por:

- `engine.js`
- `assistant-transcript-renderer.js`
- `task-stream-events.js`
- `llmBridgeClient.history`

### Problema

Há dedupe e suppressions locais, mas não há uma política única dizendo:

> este sink é o owner do transcript do turno explícito; aquele sink é apenas para mensagens fora de
> turno; aquele outro é só persistência/linha do tempo.

### Impacto

- texto pode sumir visualmente;
- histórico do bridge pode divergir do transcript local;
- timeline persistida vira “último recurso” em vez de reconciliação saudável.

### Situação ideal

Definir owners explícitos:

1. **turno explícito** → sink próprio do engine, alimentado por reply canônico;
2. **mensagens fora de turno** → `assistant-transcript-renderer`;
3. **streaming auxiliar** → acumulador que alimenta apenas o sink certo;
4. **timeline/history** → projeções posteriores, nunca autoridade primária de render.

---

## RC-GAP-001 — `assistant.turn_end` hoje é gatilho fraco demais

### Situação atual

No SDK 0.3.0, `assistant.turn_end` traz só `turnId`, não texto final.

### Problema

Múltiplas camadas ainda tratam `turn_end` como se ele pudesse, sozinho, fechar semanticamente o
reply.

### Situação ideal

`assistant.turn_end` deve ser tratado apenas como:

- gatilho de fechamento;
- momento de forçar a resolução a partir do **collector canônico de output** já alimentado por
  message/delta.

---

## RC-GAP-002 — o catch-all de eventos desconhecidos ainda é só alerta bruto

### Situação atual

`event-handlers/catch-all.js` apenas loga:

`Evento SDK desconhecido: kind=...`

### Problema

Isso é útil para diagnóstico, mas não gera projeção estruturada de drift do SDK.

### Situação ideal

ter scorecard/telemetria de drift de eventos do SDK para evitar regressão silenciosa em upgrades do
pacote.

Esse gap não é a causa primária do reply invisível, mas entrou na investigação por aparecer durante
sessões vivas.

---

## 6. Situação atual x situação ideal

### Situação atual

- boot/lifecycle estão razoavelmente sólidos;
- o SDK entrega `assistant.message` e `assistant.message_delta` corretamente em nível tipado;
- o runtime já possui fallbacks semânticos parciais;
- o terminal já tem transcript renderer, stream accumulator e projections maduras;
- mas o circuito do reply do turno explícito continua com owner difuso e sinks concorrentes.

### Situação ideal

1. **uma única autoridade de reply do turno explícito** no `agent/dialog runtime`;
2. **um único collector canônico** para conteúdo final e incremental do turno explícito;
3. `channel/client-dialog.js` reduzido a transporte/callbacks, não a parser semântico secundário;
4. `terminal/dialog/engine.js` renderizando um reply já resolvido, não tentando reconstruí-lo;
5. `assistant.message` fora do turno ativo continuando no renderer próprio, sem competir com o turno
   explícito;
6. `history/timeline` refletindo o reply canônico e não tentando compensar uma perda anterior.

---

## 7. Roadmap estrutural — faixas, fases e subfases

## Faixa RC-1 — Canonicalização do owner de reply

### Fase RC-1.1 — Collector canônico de output do turno explícito

- criar um owner explícito e único no `agent/dialog` para:
  - `assistant.message`
  - `assistant.message_delta`
  - `dialog.delta` / `task.delta`
  - `assistant.turn_end`
- esse owner deve expor `resolveBestEffort()` / snapshot canônico do output do turno.

### Fase RC-1.2 — Simplificação do `turn-executor`

- substituir a semântica dispersa de fallback por um collector único;
- `assistant.turn_end` vira gatilho de flush/resolução, não owner de conteúdo.

### Fase RC-1.3 — Desinflar o `client-dialog`

- remover parsing semântico duplicado do bridge;
- manter apenas transporte, callbacks de streaming e compatibilidade mínima.

## Faixa RC-2 — Superfície canônica de streaming do turno explícito

### Fase RC-2.1 — Unificação de output incremental

- definir uma surface canônica para o streaming do turno explícito;
- `dialog.delta` e `task.delta` passam a ser detalhes de adaptação, não o contrato principal.

### Fase RC-2.2 — Compatibilidade de listeners existentes

- manter task stream, SSE e observability compatíveis sem duplicar semântica.

## Faixa RC-3 — Renderização terminal explícita e transcript durável

### Fase RC-3.1 — Owner do transcript do turno explícito

- `engine.js` fecha o turno com reply canônico e sink explícito;
- definir com clareza quando usar renderer persistente vs `printExchange`.

### Fase RC-3.2 — Mensagens fora do turno ativo

- `sdk-session-events.js` continua responsável só por mensagens fora do turno explícito;
- busy suppression deixa de ser risco de invisibilidade.

### Fase RC-3.3 — História e reconciliação

- bridge history deve refletir o reply canônico;
- timeline persistida volta a ser reconciliação, não compensação de perda.

## Faixa RC-4 — Diagnóstico e hardening pós-fix

### Fase RC-4.1 — Drift de eventos do SDK

- enriquecer scorecard/diagnóstico de eventos desconhecidos;
- manter auditoria alinhada a upgrades do SDK.

### Fase RC-4.2 — Health/status honestos

- reavaliar flags como `recovering`/`unhealthy` quando o sistema está operacionalmente estável;
- evitar UX contraditória em `/status`, `/live` e `/sdk doctor`.

---

## 8. Estratégia de implementação recomendada

A sequência segura é:

1. **documentar e fixar owners**;
2. mover a resolução canônica do reply para o `agent/dialog runtime`;
3. simplificar `channel/client-dialog.js`;
4. só então ajustar a renderização final do terminal;
5. revalidar em sessão viva da LLM-B somente após essas mudanças estruturais.

---

## 9. Transformações estruturais já executadas nesta rodada

### 9.1 Owner canônico no runtime do dialog

Foi introduzido `src/copilot/agent/dialog/seams/turn-output-collector.js`, que consolida:

- `assistant.message`
- `dialog.delta`
- `task.delta`
- `assistant.turn_end` (como gatilho de flush)

sob um collector canônico no `agent/dialog`.

### 9.2 Bridge reduzido a transporte

`src/copilot/channel/client-dialog.js` deixou de resolver semanticamente o reply por
`assistant.message`/`task.delta`.

Agora:

- o runtime é o owner do reply;
- o bridge mantém apenas callbacks de streaming e fallback de transporte via `dialog.reply`.

### 9.3 Contrato explícito de turno enriquecido no terminal

Foi introduzido um contrato detalhado de turno explícito ao longo da cadeia:

- `channel/client-dialog.js` → `dialogTurnDetailed(...)`
- `channel/client.js` → `llmBridgeClient.dialogTurnDetailed(...)`
- `terminal/frontend/gateways/dialog.js` → `runTerminalDialogTurnDetailed(...)`
- `terminal/dialog/engine.js` → consumo de `replySource`

Com isso, o terminal deixa de depender de uma string opaca e passa a saber se o reply veio de:

- retorno direto do runtime;
- fallback canônico de `dialog.reply`;
- caminho direto `chat` com `requestHeaders`;
- ou se o transporte concluiu vazio.

### 9.4 Estado atual da execução

Após essas transformações:

- typecheck estrito do código Copilot: verde;
- lint Copilot: verde;
- suíte focal do circuito (`turn-executor`, `client-dialog`, `engine`, `frontend`, contratos):
  verde.

O próximo passo natural é a revalidação completa e, então, uma nova sessão viva da LLM-B para medir
o efeito no terminal real.

Isso evita continuar “empilhando fallback” em camadas erradas.

---

## 9. Veredito final

O problema central não é um bug único de string, regex, ANSI ou `printExchange()`.

O problema é **estrutural**:

- owner difuso de reply;
- owner difuso de streaming;
- owner difuso de transcript.

A correção correta é reorganizar o circuito para que:

- o runtime do dialog resolva um reply canônico único;
- o bridge apenas o transporte;
- o terminal apenas o renderize e persista no sink certo.

Enquanto isso não acontecer, qualquer correção apenas na ponta terminal tende a ser parcial.
