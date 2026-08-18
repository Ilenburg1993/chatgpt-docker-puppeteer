# Model Gateway — Troca de Rota / Provider

> Documento canônico de análise, gerado em 2026-08-14, com foco no fluxo real de `route_switch` e promoção diferida no Model Gateway.

---

## 1. Propósito do sistema

O módulo `src/copilot/model-gateway` implementa a camada de roteamento de modelos do LLM-B. Ele existe para:

- selecionar provider/modelo com base em catálogo, saúde, custo e políticas;
- permitir troca de rota **na mesma sessão SDK** sem perder continuidade;
- registrar operações mutantes em SQLite com idempotência, auditoria e observabilidade;
- adiar promoções inseguras para o limite seguro do turno dialogal.

O componente central para a pergunta atual é a **troca de rota/provider preservando sessionId**, não um simples `model_switch` de modelo.

---

## 2. Fluxo canônico `route_switch`

### 2.1 Camada de ferramenta

`src/copilot/tools/model-gateway/model-gateway-tools.js`

É a facade que expõe `model_gateway_route_switch` ao SDK/terminal. Responsabilidades:

- validar schema do `route` por meio de `schemas.js`;
- anexar `operationMeta` com `actor`, `source`, `correlationId`, `idempotencyKey` e `expectedResult`;
- redatar valores sensíveis via `redactModelGatewayAuditedValue`;
- serializar resultado final via `serializeResult`.

Apesar de não ser o owner da mutação, essa camada decide:

- se a tool está no plano de readiness, catalog, route, runtime-proof, same-session-runtime ou byok-profile;
- qual objeto `route` é aceito;
- como o resultado é apresentado ao LLM/terminal.

### 2.2 Runtime wrapper

`src/copilot/tools/model-gateway/model-gateway-tools.js`

A função `readRouteReattachApplySafety` lê a capability `sdk.same-session-route-reattach` por meio de `runtimeControl.readCapabilities(runtimeId)`. Ela classifica três condições de bloqueio:

- capability ausente;
- capability indisponível;
- capability em `deferredUntilTurnBoundary` ou dialog loop ativo ou state degradado.

Essa função explica por que o `apply` pode ser seguro agora ou precisar ser diferido.

### 2.3 Serviço transactional

`src/copilot/model-gateway/control-plane/runtime-route-switch.js`

`executeModelGatewayRuntimeRouteSwitch` é o owner canônico da troca. Ele:

- recebe `sessionId`, `previousRoute`, `targetRoute`, `idempotencyKey`, `timeoutMs`, `source`, `deferReason`, `deferDetails`, `forceApplyDeferred`;
- monta `reattach`, `verify`, `commit` e `record` usando ports injetados;
- persiste/replay operações por idempotency key;
- registra operação no SQLite por meio do recorder.

Importante: ele não decide a rota. Decide apenas se pode executar/replay/armar a troca.

### 2.4 Transações de estado

`src/copilot/model-gateway/control-plane/same-session-route-switch.js`

A transição canônica é:

```
planned -> reattach_requested -> reattached -> verified -> committed
```

Se houver erro antes de `reattach_requested`:

- estado final: `failed`;
- `rollback` com `attempted: false`.

Se erro ocorrer após reattach:

- tenta reanexar à rota anterior;
- se rollback verificado: `rolled_back`;
- caso contrário: `failed` com `reconciliationRequired` possivelmente true.

A invariante forte é a identidade de sessão:

```text
if target.sessionId !== input.sessionId:
    throw SAME_SESSION_IDENTITY_CHANGED
```

Isso significa que o serviço considera falha trocar de sessão, mesmo que o provider funcione.

### 2.5 Gravação canônica

`src/copilot/model-gateway/control-plane/sqlite-same-session-route-switch-recorder.js`

Esse módulo transforma transições em:

- `writeSdkSessionHandoffRecords`: uma linha por operação, com `handoffId`, `decisionId`, `sessionId`, `selectedRouteKey`, `routeProfile`, `source`, `operation`;
- `writeSdkSessionConfirmationRecords`: para `verified`, `rolled_back` e `failed`.

Ele também deriva:

- `targetProviderId`
- `previousProviderId`
- `targetModel`
- `previousModel`
- `bindingStrategy`
- `wireApi`
- `selectedRouteKey`

Isso alimenta o read-model e a observabilidade.

---

## 3. Modelo de deferimento e turno dialogal

### 3.1 Por que existe deferimento

O LLM não pode fazer uma segunda tool call “fora” do turno ativo. Por isso, quando `route_switch apply` é confirmado mas o runtime indica que o reattach deve ser adiado, o sistema:

- persiste a operação como `deferred_until_turn_boundary`;
- arma promoção automática para `dialog.turn_end`;
- encerra o tool-turn atual sem travar.

### 3.2 Política de classificação

`src/copilot/model-gateway/control-plane/deferred-route-operation.js`

A função `classifyModelGatewayDeferredRouteOperation` decide se uma operação diferida é `promotable`. Regras:

- estado exato: `deferred_until_turn_boundary`;
- mesma `sessionId` esperada;
- `requiresNewSession === false`;
- `retryable === true`;
- `deferReason === ACTIVE_DIALOG_LOOP_ROUTE_REATTACH_DEFERRED`;
- `promotionAuthorization.policy === authorized_after_turn_boundary`;
- `promotionAuthorization.authorized === true`;
- identidade mínima da rota: `operationId`, `sessionId`, `idempotencyKey`, `route`, `providerId`, `providerModel`/`selectorSyntax`.

Se alguma condição falhar, a classificação é:

- `cancelled`
- `expired`
- `review_required`
- `invalid`

Nunca `promotable`. O sistema é deliberadamente fail-closed.

### 3.3 Promoção no turn boundary

`src/copilot/model-gateway/control-plane/deferred-route-promotion.js`

`promoteModelGatewayDeferredRouteSwitchAtTurnBoundary`:

- lê deferred handoffs por `sessionId`;
- considera apenas a operação mais nova;
- supersede as mais antigas para evitar revert acidental;
- classifica a operação mais nova;
- se `promotable`, chama `switchRoute` com:
  - `allowActiveDialogLoopReattach: true`
  - `forceApplyDeferred: true`
- registra `promoted`, `superseded`, `skipped`, `errors`.

### 3.4 Agendamento agent-owned

`src/copilot/agent/lifecycle/model-gateway-turn-boundary.js`

O agent agenda promoção após:

- `dialog.turn_end`;
- ausência de perguntas humanas pendentes;
- ausência de itens na fila dialog;
- ausência de processamento ativo.

Se houver pergunta aberta, o agente adia até o próximo `EMITTER_QUESTION_ANSWERED` + `dialog.turn_end`.

O agente usa `trackBackgroundTask` para evitar orfandade.

---

## 4. Capacidade e safety do reattach

### 4.1 Capability do runtime

A capability `sdk.same-session-route-reattach` é consultada antes de decidir se o `apply` deve ocorrer imediatamente. Se o runtime reportar:

- `deferredUntilTurnBoundary = true`
- `dialogLoopActive = true`
- `state = degraded`

...o tool-turn atual deve:

- aceitar `deferred_until_turn_boundary` como retorno válido;
- não repetir apply com mesma chave;
- não inventar bypass.

### 4.2 Segurança estrutural

O sistema não cria nova sessão como fallback. Se `route_switch apply` falhar, o comportamento esperado é:

- preservar session atual;
- registrar falha e, quando permitido, retornar à rota anterior;
- solicitar nova autorização humana em vez de forçar troca.

---

## 5. Persistência e operação

### 5.1 Idempotência

A chave `idempotencyKey` vira `operationId` por SHA256 truncado em `same-session-route-switch.js`. O `runtime-route-switch.js` usa essa chave para:

- consultar `readSdkSessionHandoffRecord`;
- reaplicar/replay operações idênticas quando:
  - mesma `sessionId`;
  - mesma identidade de rota;
  - estado é `committed`, `rolled_back`, `failed` ou `deferred_until_turn_boundary`;
  - `forceApplyDeferred` não é usado para reexecutar operação deferida existente.

### 5.2 Replay

O replay não reexecuta probes, não revalida provider, não reabre sessão. Ele retorna a operação persistida.

---

## 6. Papéis dos módulos

| Módulo | Owner |
| --- | --- |
| `tools/model-gateway/model-gateway-tools.js` | Facade SDK/terminal |
| `model-gateway/control-plane/runtime-route-switch.js` | Orquestração transactional |
| `model-gateway/control-plane/same-session-route-switch.js` | Transições, timeout, rollback, invariante de sessão |
| `model-gateway/control-plane/sqlite-same-session-route-switch-recorder.js` | Gravação canônica SQLite |
| `model-gateway/control-plane/deferred-route-operation.js` | Política fail-closed de promoção |
| `model-gateway/control-plane/deferred-route-promotion.js` | Execução efetiva da promoção no turno |
| `agent/lifecycle/model-gateway-turn-boundary.js` | Agendamento pós-turno no agente |

---

## 7. Invariantes arquiteturais

1. Mesma `sessionId` antes e depois da troca.
2. Nenhuma criação de sessão substituta.
3. Nenhum reattach direto quando o runtime indicar `deferred_until_turn_boundary` dentro do tool-turn ativo.
4. Promoção automática só após `dialog.turn_end` e somente para operações autorizadas.
5. Operação idempotente por chave estável.
6. Sem segredo inline em perfis; uso obrigatório de env references.
7. Falha deve produzir estado distinguível: `failed`, `rolled_back`, `deferred_until_turn_boundary`.

---

## 8. Observabilidade

- Transições são registradas em memória e persistidas.
- `operationMeta` inclui `actor`, `source`, `correlationId`, `expectedResult`.
- Recorder produz tanto handoff quanto confirmation, permitindo reconstruir:
  - rota anterior;
  - rota alvo;
  - provider/model confirmados;
  - estado final;
  - erro, se houver.

---

## 9. Aprendizados para o operador / LLM-B

- `model_gateway_route_switch plan` é seguro; não altera runtime.
- `model_gateway_route_switch apply` pode retornar sucesso estruturado mesmo quando a promoção real é adiada; isso é comportamento esperado.
- Se o objetivo for provar que o apply não trava, o critério correto é:
  - retorno estruturado sem exceção;
  - `sessionId` preservado na operação registrada;
  - ausência de criação de nova sessão;
  - promoção, se houver, ocorrendo no próximo turno via agente, não dentro do tool-turn.
- Nunca chame `model_gateway_model_switch`, `model_gateway_runtime_reconcile`, `catalog_refresh`, `maintenance` ou `profile_manage` como substituto para validar `route_switch`.

---

## 10. Próximos passos recomendados

1. Ler `src/copilot/model-gateway/session/session-binding.js` e `src/copilot/model-gateway/control-plane/read-model.js`.
2. Mapear o read-model de operações para terminal comando `/byok`.
3. Cruzar `deferred_route_promotion` com eventos do terminal para validar se o scheduler está realmente ativo no runtime atual.
4. Se desejado, gerar um diagrama de sequência focado em sucesso, deferimento e rollback.
