# Validação do fluxo canônico 2.2 — SDK → Agent → Presentation → Terminal → Server (`elicitation` + `ask_user`)

Data: 2026-05-06 Escopo: `src/copilot/**` com foco em `elicitation`, `user_input.*`, `ask_user` e
nas surfaces operacionais que consomem esses sinais.

## 1) Situação atual validada

### 1.1 SDK (núcleo canônico)

- `sdk/session/elicitation.js` agora concentra:
  - `normalizeElicitationResult()`
  - `normalizeElicitationPendingEvent()`
  - `normalizeElicitationCompletedEvent()`
  - `createQueuedElicitationHandler()`
- `sdk/session/user-input.js` agora concentra:
  - `normalizeUserInputRequestedEvent()`
  - `normalizeUserInputCompletedEvent()`
  - `createReadlineInputHandler()`
  - `createQueuedInputHandler()`
  - `createStaticInputHandler()`
- `sdk/index.js` exporta essas surfaces pelo barrel canônico `#copilot/sdk`.

### 1.2 Hooks

- `hooks/elicitation.js` virou compat layer, sem autoridade semântica própria.
- `hooks/user-input.js` virou compat layer, sem ser owner de `ask_user`.
- Resultado: hooks preservam API histórica, mas não centralizam mais a regra do fluxo.

### 1.3 Agent

- `agent/context-factories.js` emite `elicitation.pending/completed` usando os normalizers
  canônicos.
- O runtime provider-side continua no agent, mas o contrato do evento agora pertence ao SDK.

### 1.4 Event handlers

- `event-handlers/sdk-responses.js` consome os normalizers canônicos de `elicitation`.
- `event-handlers/interaction-events.js` consome os normalizers canônicos de `user_input.*`.
- Isso remove parsing ad-hoc desses payloads na entrada do EventBus do agent.

### 1.5 Terminal

- `terminal/sdk-interactions.js` passou a consumir os normalizers canônicos de:
  - `elicitation.pending/completed`
  - `user_input.requested/completed`
- O terminal continua tratando a semântica do dialog protocol (`READY/REPLY/...`) como detalhe de
  UX, não como owner do shape bruto do evento.

### 1.6 Server

- `server/routes/copilot-api/tasks.js` deixou de validar resultado de `elicitation` direto via
  `core/elicitation-schema.js`.
- A rota agora usa `normalizeElicitationResult()` via `#copilot/sdk`.

## 2) Fluxo canônico ponta a ponta (estado alcançado nesta faixa)

### 2.1 `elicitation`

1. SDK/provider emite ou resolve o pedido estruturado.
2. O contrato bruto é normalizado em `sdk/session/elicitation.js`.
3. Agent/EventBus propaga o payload já estabilizado.
4. Terminal e server consomem o mesmo contrato canônico.
5. Hooks ficam apenas como camada de compatibilidade histórica.

### 2.2 `ask_user` / `user_input.*`

1. SDK emite `user_input.requested` / `user_input.completed`.
2. `event-handlers/interaction-events.js` normaliza esses eventos via `sdk/session/user-input.js`.
3. Agent/EventBus mantém o shape estável para camadas superiores.
4. Terminal consome esse contrato estável e aplica a UX do `DialogProtocol` por cima.
5. Hooks deixam de ser owner das factories de `onUserInputRequest`.

## 3) Arquiteturas paralelas detectadas e tratadas

### Tratado

- `hooks/elicitation.js` como owner de fila provider-side → movido para
  `sdk/session/elicitation.js`.
- `hooks/user-input.js` como owner de factories de `ask_user` → movido para
  `sdk/session/user-input.js`.
- parsing ad-hoc de `elicitation.*` em terminal/server/event-handlers → substituído por normalizers
  do SDK.
- parsing ad-hoc de `user_input.*` em event-handlers/terminal → substituído por normalizers do SDK.

### Remanescente controlado

- a tool `request_user_input` em `tools/hook-tools.js` continua sendo um wrapper semântico, porém
  intencional, sobre `ask_user`; agora com fallback operacional canônico em
  `answerPendingQuestion()` quando não há pergunta viva do SDK.

## 4) Gaps restantes (não bloqueantes para esta faixa)

1. adicionar teste de integração HTTP para `/answer` cobrindo `ask_user` vivo e fallback
   `request_user_input`;
2. decidir se `request_user_input` deve ganhar projection canônica explícita na camada presentation
   (além do fallback já consolidado);
3. avaliar se observability deve persistir também o payload já normalizado, e não apenas o raw do
   SDK.

## 5) Critério de elegância arquitetural 2.2 aplicado aqui

- núcleo semântico único no SDK para `elicitation` ✅
- núcleo semântico único no SDK para `user_input` ✅
- hooks como compatibilidade, não centralidade ✅
- bordas consumindo contratos estáveis, não payloads parseados localmente ✅
- terminal preservando UX/protocolo como concern de apresentação, não como owner do contrato ✅
- taxonomia resumida terminal alinhada ao DialogProtocol (`stopped` em vez de `protocol`) ✅
- contrato `/answer` unificado para `ask_user` e `request_user_input` ✅

## 6) Evidência de validação

- `make lint`: verde.
- `vitest` focado em terminal, event-handlers, session lifecycle e rotas de server: verde.
- Baterias executadas nesta rodada:
  - `tests/unit/copilot/terminal/test_commands_sdk.spec.js`
  - `tests/unit/copilot/test_server_agent_route_validation.spec.js`
  - `tests/unit/copilot/test_sdk_api.spec.js`
  - `tests/unit/copilot/test_terminal_agent_runtime_events.spec.js`
  - `tests/unit/copilot/test_terminal_sdk_session_events.spec.js`
  - `tests/unit/copilot/agent/test_faixa_b_event_handlers.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_session_lifecycle.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_session_core_lifecycle.spec.js`

Resultado factual: verde (`116` testes passando, `1` skipped nas baterias focadas desta rodada).

Rodada complementar final focada em `ask_user` / `user_input`:

- `tests/unit/copilot/test_user_input_handler.spec.js`
- `tests/unit/copilot/test_terminal_sdk_session_events.spec.js`
- `tests/unit/copilot/agent/test_faixa_b_event_handlers.spec.js`
- `tests/unit/copilot/terminal/test_commands_session.spec.js`
- `tests/unit/copilot/test_terminal_agent_runtime_events.spec.js`

Resultado factual adicional: verde (`83` testes passando).

## Addendum 2026-05-06 — permission pending SDK-first

Complemento factual desta fase 2.2 para fechar a trilha de governança operacional em permissions:

- `sdk/rpc/ops.js` passou a expor `permissionsListPending(session)` com detecção compatível de
  surface (`permissions.listPendingPermissionRequests` ou `permissions.listPendingRequests`).
- O contrato foi propagado por `agent` → `presentation` → `terminal` sem bypass de camada.
- O comando `/permission pending` agora tenta listagem ativa via RPC e, quando indisponível, reporta
  fallback explícito para estado observado local.
- Quando a listagem ativa retorna requests, o terminal agora hidrata o estado observado local com os
  IDs vindos do RPC. Isso garante que `/permission respond <id>` funcione também para requests que
  não chegaram por SSE/event adapter.
- Resquícios de ownership documental em `agent/*` foram alinhados para `sdk/session/elicitation.js`.

### Evidência de validação do addendum

- `tests/unit/copilot/terminal/test_commands_sdk.spec.js`
- `tests/unit/copilot/sdk/test_sdk_rpc.spec.js`
- `tests/unit/copilot/test_presentation_runtime_sdk_session.spec.js`
- `tests/unit/copilot/test_agent_sdk_access.spec.js`
- `tests/unit/copilot/sdk/test_sdk_barrel.spec.js`

Resultado factual: verde (`112` testes passando).

### Evidência live complementar

- `npm run terminal:llm-b` iniciou o terminal, criou sessão runtime e expôs o inject server em
  `http://127.0.0.1:3009`.
- `GET /health` e `GET /config` responderam `ok=true`.
- REPL aceitou `/status`, `/sdk waits`, `/permission pending` e `/exit` sem travar.
- O dialog loop entrou em `NOLOOP` por `rate_limit` externo do Copilot SDK, com mensagem de reset
  explícita; esse bloqueio impediu um turno real LLM-B, mas não quebrou a comunicação terminal/HTTP.
- Teste focado após a correção RPC-only:
  `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/terminal/test_commands_sdk.spec.js`
  verde (`16` testes).
