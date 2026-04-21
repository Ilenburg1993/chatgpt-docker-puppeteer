# 12-ASK-USER-DIALOG-LOOP — Auditoria Profunda do Fluxo `ask_user`

**Auditoria Profunda de `src/copilot`** · Abril 2026 **Escopo**:
`agent/dialog/user-input-handler.js`, `dialog/loop-manager.js`, `messaging/agent-messaging.js`,
`lifecycle/state-io.js`, `terminal/terminal-agent-wiring.js`, `terminal/frontend/llm-b-runtime.js`,
rotas HTTP e projeções de health ligadas ao dialog loop. **Documentado em**: 2026-04-18

---

## 1. Por que `ask_user` é crítico

No desenho atual, `ask_user` não é apenas uma ferramenta do SDK. Ele é o **canal de controle** do
dialog loop e, portanto, o ponto central de acoplamento entre:

- o estado vivo do SDK;
- o loop permanente da LLM-B;
- a política de **zero premium requests**;
- o watchdog de recuperação;
- o estado persistido entre reinicializações;
- as rotas HTTP e o frontend do terminal.

Em termos práticos:

- `READY:` representa **prontidão sem consumo de novo PR**;
- `REPLY:` representa **resposta de turno**;
- `STOPPED` representa **encerramento indevido do loop**;
- perguntas normais representam **interação real do usuário/operador**.

Se o sistema não distingue semanticamente esses quatro casos, todo o restante fica certo “por
aproximação”, não por contrato.

---

## 2. Situação anterior encontrada

Antes desta rodada, havia quatro problemas estruturais principais.

### ASK-01 — Persistência sem semântica

O estado persistido guardava basicamente:

- `pendingQuestion: string | null`
- `lastAskUserAt: number`

Isso não permitia responder perguntas essenciais como:

- a pendência era `READY`, `REPLY`, `STOPPED` ou pergunta real?
- fazia parte do protocolo do loop ou era uma pergunta fora dele?
- o watchdog podia tratar isso como recuperação zero-PR ou não?

### ASK-02 — Recovery zero-PR otimista demais

O watchdog do terminal tratava **qualquer** `pendingQuestion` reaparecida como sinal de recuperação
zero-PR.

Isso era impreciso: uma pergunta qualquer não equivale a “loop retomado com `READY` preservado”.

### ASK-03 — Mistura entre pergunta viva e estado restaurado

O runtime não distinguia adequadamente:

- uma **pergunta viva do SDK**, ainda respondível via `answerPendingQuestion()`;
- uma **sombra restaurada de processo anterior**, cujo resolver do SDK já não existe mais.

Isso criava um gap conceitual importante: o operador via “há pergunta pendente”, mas o sistema não
deixava claro se ainda era possível responder aquilo de forma real.

### ASK-04 — Observabilidade pública incompleta

Terminal, health e snapshots expunham a existência de `pendingQuestion`, mas não sua **semântica**.

Resultado: troubleshooting do dialog loop exigia leitura de log e inferência manual.

---

## 3. Correções implementadas nesta rodada

### 3.1 Semântica explícita de `ask_user`

Foram introduzidos em `src/copilot/agent/types.js`:

- `PendingQuestionKind = 'ready' | 'reply' | 'stopped' | 'question'`
- `PendingQuestionMeta`
- `PendingQuestionShadow`

Agora o runtime diferencia claramente:

- **pergunta viva** do SDK (`PendingQuestion`)
- **sombra persistida** restaurada do disco (`PendingQuestionShadow`)

### 3.2 Persistência seletiva e semanticamente rica

`agent/dialog/user-input-handler.js` agora:

- classifica cada `ask_user` com `DialogProtocol.classify(...)`;
- persiste `pendingQuestionMeta` junto com `pendingQuestion` quando fizer sentido;
- persiste apenas tipos com valor real para recovery/continuidade:
  - `question`
  - `ready`
- evita continuar escrevendo `REPLY`/`STOPPED` no disco a cada turno.

Também houve correção explícita de conformidade com o SDK em `session-setup.js`:

- `UserInputRequest.allowFreeform` é opcional no SDK e tem default efetivo `true`;
- o wiring do agent agora respeita isso (`undefined` → `true`), em vez de degradar silenciosamente
  para `false`.

### 3.3 Sombra persistida reidratada no boot

`agent/lifecycle/agent-lifecycle.js` agora restaura do `state-io`:

- `pendingQuestion`
- `pendingQuestionMeta`

como uma **sombra persistida**, via `ctx.setPendingQuestionShadow(...)`, em vez de fingir que existe
uma pergunta viva respondível.

Além disso, a shadow restaurada agora carrega TTL explícito e semântica temporal:

- `restoredAt`
- `expiresAt`

via helper canônico em `agent/dialog/pending-question-shadow.js`.

Nesta continuação, o TTL também deixou de ser único para todos os casos e passou a ser **semântico
por kind**:

- `ready` → TTL menor
- `question` → TTL padrão/mais longo

Quando a shadow já nasce expirada no boot:

- o runtime **mantém a shadow em memória** para observabilidade/hints operacionais;
- mas agenda limpeza canônica do estado persistido via `persistStateWithPolicy(...)`.

### 3.4 Health e terminal agora enxergam a diferença

O snapshot de health passou a expor:

- `pendingQuestion`
- `pendingQuestionKind`
- `pendingQuestionShadow`
- `pendingQuestionShadowKind`
- `pendingQuestionShadowExpired`
- `pendingQuestionShadowAgeMs`
- `pendingQuestionShadowExpiresAt`

Além disso, foi criado o novo risco canônico:

- `io.pending_question_shadow`

e, quando a shadow já não é mais respondível:

- `io.pending_question_shadow_expired`

com a ação recomendada correspondente:

- `review_pending_question_shadow`
- `clear_pending_question_shadow`

No terminal, `readTerminalRuntimeState()` também passou a projetar essa distinção.

Além disso, `readTerminalStatusProjection()` e o comando `/status` agora expõem:

- tipo da pergunta viva;
- tipo da shadow persistida;
- expiração da shadow;
- ação recomendada do health.

### 3.5 Watchdog zero-PR ficou semântico

`terminal/terminal-agent-wiring.js` deixou de usar “qualquer pergunta pendente” como critério de
recuperação.

Agora o watchdog só considera recuperação zero-PR quando o estado volta especificamente para:

- `pendingQuestionKind === 'ready'`

Isso alinha a semântica operacional com a política de zero-PR.

### 3.6 Limpeza explícita da shadow virou capability pública

O runtime agora expõe limpeza canônica da shadow persistida por duas vias:

1. `AlwaysAliveAgent.clearPendingQuestionShadow()`
2. `POST /answer/clear-shadow`
3. comando REPL `/clear-shadow`

Com isso, a ação sugerida pelo health (`clear_pending_question_shadow`) deixou de ser apenas
descritiva e passou a ter uma superfície operacional direta.

Importante: essa limpeza atua apenas sobre a **shadow persistida restaurada**, não sobre perguntas
vivas do SDK.

---

## 4. Situação atual validada

Depois desta rodada, o fluxo `ask_user` passou a ter estas propriedades:

### ✅ O runtime sabe o que está pendente

Não existe mais apenas “tem texto pendente”; agora existe classificação explícita:

- `ready`
- `reply`
- `stopped`
- `question`

### ✅ Recovery não confunde estado persistido com estado vivo

Uma pergunta restaurada do disco agora é tratada como **sombra** e não como pergunta viva do SDK.

### ✅ O health consegue explicar o problema

Se o processo sobe com uma sombra persistida de `ask_user`, o health entra em caminho degradado e
recomenda ação explícita.

### ✅ O terminal passou a ter base para UX mais segura

O frontend da LLM-B já consegue saber se existe:

- pergunta viva atual;
- ou apenas sombra restaurada de uma pendência antiga.

---

## 5. O que ainda não está ideal

Apesar do avanço forte, ainda existem gaps residuais importantes.

### ASK-05 — TTL semântico existe, mas a higiene em runtime ainda pode evoluir

Hoje a shadow já tem:

- TTL semântico por `kind` (`ready` ≠ `question`);
- `expiresAt` explícito;
- detecção de expiração em health/runtime;
- limpeza do estado persistido quando o boot encontra uma shadow já vencida.
- estado semântico explícito no runtime/health/terminal:
  - `fresh`
  - `active`
  - `expiring_soon`
  - `expired`
- `pendingQuestionShadowRemainingMs` para troubleshooting direto do tempo restante.
- persistência também em snapshots manuais do terminal/agent, permitindo post-mortem com a mesma
  semântica.

O que ainda não está ideal:

- já existe reaper periódico no runtime para shadows que expiram **depois** do boot atual;
- a UX ainda não diferencia com mais riqueza “shadow expirada limpável” de “shadow restaurada ainda
  relevante”.

### ASK-06 — UX dedicada existe, mas ainda falta fechar o ciclo completo

Hoje já existem:

- projeção HTTP com shadow/expiração/ação sugerida;
- `/status` mostrando estado semântico de `ask_user`;
- rota explícita para limpar shadow;
- comando REPL `/clear-shadow`.
- projeção do terminal com estado semântico + tempo restante da shadow.

Também nesta rodada:

- `/diagnose` passou a exibir explicitamente o estado de `ask_user`
  (vivo/shadow/expirando/expirada), idade e tempo restante;
- snapshots manuais (`/session save` + `/session restore`) passaram a carregar/exibir também a
  shadow persistida.

O que ainda falta:

- UX mais explícita quando uma shadow restaurada ainda não expirou, mas já não é respondível por
  ausência de estado vivo;
- mensagens operacionais mais orientadas a recovery automático de dialog loop;
- distinção visual mais rica entre shadow recém-restaurada, expirada e já reapada automaticamente.

### ASK-07 — Ainda falta SSOT explícita final do orçamento zero-PR

O protocolo e o watchdog respeitam a política zero-PR, mas ainda falta um contrato formal único
dizendo:

- quais tipos de `ask_user` podem ser persistidos;
- quais podem ser usados para recovery zero-PR;
- quais nunca devem gerar I/O;
- quais transições consomem PR e quais não consomem.

---

## 6. Nova situação ideal proposta para `ask_user`

O estado ideal não é apenas “ter `pendingQuestionMeta`”.

O estado ideal é um **subprotocolo governado** de `ask_user`, com estas propriedades:

### AI-1 — Duas camadas explícitas de estado

1. **Live ask_user state**
   - objeto vivo com resolver do SDK;
   - único estado realmente respondível.

2. **Persisted ask_user shadow**
   - projeção semântica restaurável;
   - nunca tratada como input respondível;
   - usada apenas para recovery, observabilidade e hints operacionais.

### AI-2 — Semântica obrigatória por kind

Cada `ask_user` deve sempre carregar tipo:

- `ready`
- `reply`
- `stopped`
- `question`

Sem fallback implícito baseado só em prefixo textual no momento do troubleshooting.

### AI-3 — Política de persistência declarativa

Regra ideal:

- `ready` → pode persistir para recovery zero-PR;
- `question` → pode persistir para continuidade operacional;
- `reply` → não persiste;
- `stopped` → não persiste.

E, adicionalmente:

- toda shadow persistida deve carregar `restoredAt` + `expiresAt`;
- o runtime deve diferenciar claramente shadow **válida**, **expirada** e **limpa**.

### AI-4 — Recovery zero-PR baseado em invariantes

O watchdog e a retomada devem depender de invariantes explícitas, não heurística implícita.

Exemplo ideal:

- só `ready` conta como loop recuperado;
- `question` conta como pendência operacional, não como “loop pronto”;
- `shadow.ready` sem live state implica “degradado, mas não recuperado”.

### AI-5 — Health e UI devem convergir

As mesmas informações precisam aparecer em:

- health snapshot;
- terminal runtime state;
- rotas HTTP;
- snapshots de sessão.

Sem cada camada reinventar sua própria interpretação de `ask_user`.

### AI-6 — Conformidade explícita com o SDK

O SDK `@github/copilot-sdk` expõe `ask_user` apenas por:

- `SessionConfig.onUserInputRequest`
- `UserInputRequest = { question, choices?, allowFreeform? }`
- `UserInputResponse = { answer, wasFreeform }`

Ou seja:

- o SDK **não** persiste `ask_user`;
- o SDK **não** classifica `ready/reply/stopped/question`;
- o SDK **não** modela shadow/restauração/TTL.
- o SDK considera `allowFreeform` opcional no request, com default efetivo `true`.

Logo, toda a semântica de:

- `PendingQuestionKind`
- `PendingQuestionMeta`
- `PendingQuestionShadow`
- zero-PR
- TTL/expiração

deve permanecer como **governança interna do runtime**, nunca confundida com contrato nativo do SDK.

---

## 7. Critérios claros de consolidação do `ask_user`

Consideraremos o subfluxo `ask_user` consolidado quando todos estes critérios forem verdadeiros ao
mesmo tempo:

### AQ-1 — Semântica persistida

`pendingQuestionMeta` existe e é gravado apenas para tipos semanticamente válidos para
recovery/continuidade.

### AQ-2 — Estado vivo ≠ estado restaurado

O runtime diferencia explicitamente pergunta viva do SDK de sombra restaurada do disco.

### AQ-3 — Recovery zero-PR sem ambiguidade

O watchdog e o dialog loop só tratam `ready` vivo como recuperação zero-PR.

### AQ-4 — Health acionável

O snapshot de health expõe:

- `pendingQuestionKind`
- `pendingQuestionShadow`
- `pendingQuestionShadowKind`
- `pendingQuestionShadowExpired`
- `recommendedAction` coerente

### AQ-5 — Snapshot e terminal coerentes

Snapshots persistidos e frontend do terminal carregam a mesma semântica, sem modelos paralelos.

### AQ-5b — Shadow limpável por caminho canônico

Quando a ação recomendada for `clear_pending_question_shadow`, deve existir pelo menos um caminho
canônico suportado para executar essa limpeza sem tocar estado interno manualmente.

### AQ-6 — Testes mínimos de regressão

A malha cobre pelo menos:

- classificação `READY/REPLY/STOPPED/question`;
- persistência seletiva;
- restauração de shadow;
- health com shadow;
- watchdog zero-PR dependente de `ready`.

---

## 8. Conclusão

O grande problema do `ask_user` não era falta de funcionalidade.

Era **falta de semântica operacional explícita**.

Nesta rodada, o sistema passou a:

- classificar o `ask_user` com tipo explícito;
- persistir metadados úteis;
- distinguir pergunta viva de sombra restaurada;
- expor isso em health/terminal/snapshot;
- e usar `ready` — não “qualquer pendência” — como critério de recuperação zero-PR.

Resumo franco:

> O `ask_user` deixou de ser apenas um texto pendente no runtime e começou a virar um **subprotocolo
> governado** do dialog loop.

Ainda falta endurecer TTL, UX operacional e reconciliação no boot, mas a fundação certa agora
existe.

Hoje, o diagnóstico mais preciso é:

> `ask_user` já é um subprotocolo governado, com conformidade clara em relação ao SDK,
> shadow/restauração semanticamente modeladas, limpeza canônica via agent/HTTP/REPL e reap contínuo
> em runtime. O que falta agora não é fundação — é acabamento fino de UX e heurísticas operacionais
> mais ricas.
