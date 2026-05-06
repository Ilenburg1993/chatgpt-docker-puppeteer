# Auditoria geral — `src/copilot` fluxos paralelos, gaps e bugs

Data: 2026-05-06 Escopo: `src/copilot/**`, com aprofundamento em permissions, elicitation,
`ask_user`/user input, SDK RPC, system prompt, terminal, server/routes e governança executável de
module maps.

## 1) Cobertura executada

- `src/copilot`: 617 arquivos JS, 106.621 LOC, 24 diretórios de primeiro nível.
- Varredura grep-first: TODO/FIXME/HACK, `JSON.parse`, `setTimeout(async)`, timers/listeners,
  `process.exit`, `not implemented`, RPC cru e hotspots por tamanho.
- Leitura dirigida dos artefatos recentes 100–106 e do roadmap de permissions.
- Validação pós-correção com guardrails e suites focadas.

## 2) Achados corrigidos nesta rodada

| ID                | Severidade | Área                                | Evidência                                                                                                                                                               | Status    |
| ----------------- | ---------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| BUG-2026-05-06-01 | Alto       | SDK boundary / system prompt        | `config/system-prompt/sdk-introspection.js` chamava `session.rpc.instructions.getSources()` fora de `sdk/`, quebrando `check:crude`.                                    | Corrigido |
| GAP-2026-05-06-02 | Médio      | Terminal module map                 | `ui-preferences.js` e `ui-theme.js` existiam na raiz do terminal, mas não estavam declarados em `terminal/module-map.js`.                                               | Corrigido |
| GAP-2026-05-06-03 | Médio      | Hotspot governance                  | `terminal/sdk-interactions.js` e `server/routes/sdk/deps.js` passaram de 300 LOC e seguiam como `watch`.                                                                | Corrigido |
| GAP-2026-05-06-04 | Médio      | Permissions contracts               | `hooks/permission-handler.js` precisava consumir o núcleo via barrel canônico `#copilot/sdk` para satisfazer a migração F19 e evitar bypass documental.                 | Corrigido |
| BUG-2026-05-06-05 | Baixo      | Typecheck strict                    | `channel/inject.js` mantinha o helper morto `_roundToSecond()`, quebrando `typecheck:strict:src.copilot` por `TS6133`.                                                  | Corrigido |
| BUG-2026-05-06-06 | Médio      | Terminal SSE adapters               | `permission.mode_changed` tinha adapter dedicado em `sdk-session-events.js`, mas ainda estava no passthrough SSE residual.                                              | Corrigido |
| BUG-2026-05-06-07 | Médio      | Permission respond                  | `/permission respond approve-for-session` aceitava payload sem `approval`, deixando o terminal enviar decisão inválida ao RPC do SDK.                                   | Corrigido |
| GAP-2026-05-06-08 | Baixo      | System prompt HTTP adapter          | `server/routes/sdk/deps.js` expunha helpers avulsos de system prompt além da projection canônica usada pela rota.                                                       | Corrigido |
| GAP-2026-05-06-09 | Alto       | Elicitation canonical flow          | `hooks/elicitation.js` ainda concentrava fila provider-side; terminal, server e event-handlers consumiam shapes parcialmente ad-hoc.                                    | Corrigido |
| GAP-2026-05-06-10 | Alto       | User input canonical flow           | `ask_user`/`user_input` ainda dependia de factories em `hooks/user-input.js` e parsing local em `interaction-events`/`sdk-interactions`.                                | Corrigido |
| GAP-2026-05-06-11 | Médio      | Permission pending active list      | `/permission pending` ainda dependia exclusivamente de estado observado local, sem consulta ativa via sessão SDK quando disponível.                                     | Corrigido |
| BUG-2026-05-06-12 | Médio      | Permission RPC → terminal UX        | `/permission pending` exibia requests vindos do RPC ativo, mas não hidratava o estado local; `/permission respond <id>` podia falhar para request RPC-only.             | Corrigido |
| GAP-2026-05-06-13 | Baixo      | Elicitation ownership docs          | JSDoc/provider em `agent/*` ainda apontavam `hooks/elicitation` como owner mesmo após a promoção para `sdk/session/elicitation.js`.                                     | Corrigido |
| GAP-2026-05-06-14 | Médio      | Permission cockpit operacional      | Faltava cockpit curto no terminal para consolidar modo atual, últimas mudanças de mode e pendências por tipo com ações rápidas.                                         | Corrigido |
| GAP-2026-05-06-15 | Médio      | HTTP `/answer` fallback tool        | Faltava teste de integração HTTP garantindo que `/answer` cobre fallback `request_user_input` sem `ask_user` vivo.                                                      | Corrigido |
| GAP-2026-05-06-16 | Médio      | Stream runtime targeting            | `/stream` e `/stream/tasks` podiam abrir SSE com fallback default mesmo com `runtimeId` explícito inexistente, mascarando erro de targeting operacional.                | Corrigido |
| GAP-2026-05-06-17 | Médio      | System prompt projection drift      | Status/freshness/binding/compat/instruction sources eram consumidos por shapes fragmentados entre terminal/server/presentation sem envelope público único.              | Corrigido |
| GAP-2026-05-06-18 | Alto       | Stream runtime isolation proof      | Faltava prova executável de que streams simultâneos em runtimes diferentes não vazam eventos entre si.                                                                  | Corrigido |
| GAP-2026-05-06-19 | Médio      | Permissions E2E requestId           | Faltava prova executável do fluxo `permission.requested → /permission respond → permission.completed` com correlação explícita por `requestId`.                         | Corrigido |
| GAP-2026-05-06-20 | Alto       | Permission store runtime bleed      | Estado local de permissions no terminal era global; `show/respond latest` podia mirar request de runtime diferente em cenários multi-runtime.                           | Corrigido |
| GAP-2026-05-06-21 | Alto       | Elicitation/UserInput runtime bleed | Estado local de `elicitation` e `user_input` no terminal era compartilhado entre runtimes; `/sdk waits` e `/elicitation latest` podiam mirar fila de runtime diferente. | Corrigido |

### Correções aplicadas

- Criada a façade SDK `instructionSourcesGet(session)` em `sdk/rpc/session.js`.
- `sdk/rpc.js` e `sdk/index.js` passaram a exportar `instructionSourcesGet`.
- `config/system-prompt/sdk-introspection.js` delega para `instructionSourcesGet`.
- `terminal/module-map.js` cobre os arquivos de UI recém-detectados e classifica hotspots reais.
- `server/routes/module-map.js` marca `sdk/deps.js` como hotspot.
- `channel/inject.js` remove helper morto que impedia typecheck estrito.
- Contratos em `tests/unit/copilot/contracts/test_module_layout_governance.spec.js` foram alinhados.
- `terminal/event-adapter-events.js` agora classifica `permission.mode_changed` como evento
  explícito, removendo retransmissão duplicada por passthrough.
- `/permission respond` valida decisões persistentes (`approve-for-session`/`approve-for-location`)
  antes de chamar o runtime gateway.
- `server/routes/sdk/deps.js` deixou de publicar helpers soltos de system prompt; a superfície HTTP
  usa a projection `readAgentSdkSystemPromptProjection`.
- Criado `sdk/session/elicitation.js` como núcleo canônico para:
  - `normalizeElicitationResult()`
  - `normalizeElicitationPendingEvent()`
  - `normalizeElicitationCompletedEvent()`
  - `createQueuedElicitationHandler()`
- `hooks/elicitation.js` virou compat layer delegando ao barrel `#copilot/sdk`.
- `agent/context-factories.js`, `event-handlers/sdk-responses.js`, `terminal/sdk-interactions.js` e
  `server/routes/copilot-api/tasks.js` passaram a consumir o contrato canônico de elicitation.
- Criado `sdk/session/user-input.js` como núcleo canônico para:
  - `normalizeUserInputRequestedEvent()`
  - `normalizeUserInputCompletedEvent()`
  - `createReadlineInputHandler()`
  - `createQueuedInputHandler()`
  - `createStaticInputHandler()`
- `hooks/user-input.js` virou compat layer delegando ao barrel `#copilot/sdk`.
- `event-handlers/interaction-events.js` e `terminal/sdk-interactions.js` deixaram de parsear
  `user_input.*` manualmente e passaram a depender dos normalizers do SDK.
- `sdk/rpc/ops.js` ganhou `permissionsListPending()` com detecção compatível de método no namespace
  `permissions` e envelope estável (`available/source/requests`).
- `agent/facades/sdk/ui-ops.js`, `agent/always-alive.js`, `presentation/runtime-sdk-session.js` e
  `terminal/frontend/gateways/sdk-session.js` passaram a expor a listagem ativa de permissões
  pendentes.
- `terminal/commands/sdk.js` ganhou `/permission pending` com estratégia dual: listagem ativa via
  RPC quando disponível, fallback explícito para estado observado local quando indisponível.
- `/permission pending` agora também hidrata o estado local do terminal com requests vindos do RPC
  ativo, mantendo `/permission respond <id>` como a única borda operacional de resolução.
- `terminal/sdk-interactions.js` passou a manter histórico local de `permission.mode_changed`
  (`listTerminalPermissionModeHistory`) para governança operacional do terminal.
- `terminal/commands/sdk.js` passou a expor `/permission cockpit` com agregação por tipo, latest
  request, mode log e quick actions.
- JSDoc/provider de `agent/context-factories.js`, `agent/types.js` e `agent/always-alive.js` foram
  alinhados para `sdk/session/elicitation.js`, removendo o último sinal documental de ownership em
  `hooks/elicitation`.
- Teste HTTP de integração adicionado em
  `tests/unit/copilot/test_copilot_api_answer_fallback.spec.js` validando `/answer` quando
  `answerPendingQuestion()` resolve via `request_user_input` fallback (`resolvedViaTool=true`).
- `server/routes/copilot-api/stream.js` passou a validar targeting estrito e retornar `404` quando
  `requestedRuntimeId` explícito não existe, antes de abrir conexão SSE.
- Teste dedicado adicionado em
  `tests/unit/copilot/test_copilot_api_stream_runtime_targeting.spec.js` cobrindo `/stream` e
  `/stream/tasks` com runtime ausente.
- `tests/unit/copilot/test_copilot_api_multi_runtime.spec.js` passou a validar isolamento real de
  SSE por runtime: dois streams paralelos (`default` e `audit`) recebem apenas eventos emitidos no
  emitter do runtime correspondente, com `runtimeId`/`sourceRuntime` correlacionados.
- `tests/unit/copilot/terminal/test_commands_sdk.spec.js` ganhou cobertura do fluxo
  `permission.requested → /permission respond → permission.completed` validando correlação pelo
  mesmo `requestId`, atualização do mesmo registro e preservação de payload de `completion`.
- `sdk/session/permission-events.js` passou a normalizar `runtimeId`/`sourceRuntime` em
  `permission.requested` e `permission.completed`.
- `event-handlers/interaction-events.js` passou a propagar `runtimeId` nos eventos `permission.*`.
- `terminal/sdk-interactions.js` passou a armazenar permissões com `runtimeId` e filtrar
  `list/get/summary` por runtime alvo.
- `terminal/commands/sdk.js` passou a respeitar runtime alvo em
  `/permission show|respond latest|cockpit` e no painel `/sdk waits`.
- Teste adicionado em `tests/unit/copilot/terminal/test_commands_sdk.spec.js` comprovando que
  `/permission show latest --runtime audit` e `/permission respond latest --runtime audit` não vazam
  para requests do runtime `default`.
- `sdk/session/elicitation.js` e `sdk/session/user-input.js` passaram a normalizar `runtimeId` com
  fallback para `sourceRuntime`.
- `event-handlers/interaction-events.js` e `event-handlers/sdk-responses.js` passaram a propagar
  `runtimeId` nos eventos `user_input.*` e `elicitation.*`.
- `terminal/sdk-interactions.js` passou a armazenar e filtrar `elicitation` e `user_input` por
  runtime alvo.
- `terminal/commands/sdk.js` passou a respeitar runtime alvo em `/sdk waits` e
  `/elicitation show|respond|list`, evitando bleed cross-runtime.
- Testes adicionados/ajustados em `tests/unit/copilot/terminal/test_commands_sdk.spec.js` cobrindo
  isolamento runtime-aware de `elicitation` e `ask_user` no painel `/sdk waits`.
- `config/system-prompt/projection.js` passou a definir envelope público único de projection
  (`status`, `sdkCompatibility`, `binding`, `freshness`, `session`, `instructionSources`,
  `ownership`, `revision`) e `presentation/runtime-sdk-session.js` passou a retornar esse envelope
  em `projection` sem quebrar campos legados.
- `terminal/commands/sdk.js` passou a consumir preferencialmente `projection` com fallback para os
  campos legados (`systemPrompt`, `binding`, `freshness`, `instructionSources`).
- `server/routes/sdk/deps.js` alinhou o fallback para retornar a mesma estrutura de `projection`
  quando a implementação principal estiver indisponível.
- A divergência aparente com o pacote transitivo `@github/copilot` foi descartada: a fonte canônica
  deste projeto é o pacote direto `@github/copilot-sdk@0.3.0`, onde `approve-once`/`reject` seguem
  sendo o contrato de `PermissionRequestResult`.

## 3) Fluxos paralelos ainda relevantes

1. **Permissions: listagem ativa RPC implementada com fallback local explícito.**
   - `/permission pending` agora consulta a sessão SDK quando houver contrato de listagem ativo no
     namespace `permissions`.
   - Quando indisponível, o terminal informa fallback para estado observado local, evitando falsa
     sensação de completude operacional.

2. **System prompt: status/config/live builders/freshness ainda são múltiplas superfícies.**
   - A chamada RPC crua foi eliminada e a rota HTTP passou a depender só da projection canônica.
   - Ainda resta consolidar as leituras de status/frescor consumidas por `/status`, `/metrics` e
     projections frontend para o mesmo shape público.

3. **Terminal SSE passthrough residual.**
   - `permission.mode_changed` saiu do passthrough residual.
   - `agent-sse-passthrough.js` segue como adapter estreito e explicitado para eventos sem UX/SSE
     dedicada.

4. **Hotspots com ownership preservado, mas ainda grandes.**
   - Principais hotspots atuais: `agent/agent-context.js` (1942 LOC), `agent/always-alive.js`
     (1220), `sdk/types.js` (1005), `terminal/frontend/projections/timeline.js` (906),
     `terminal/sdk-session-events.js` (864), `terminal/commands/sdk.js` (741),
     `sdk/session/lifecycle.js` (706), `terminal/commands/session.js` (674),
     `agent/lifecycle/orchestrators/agent-lifecycle.js` (655),
     `agent/dialog/orchestrators/loop-manager.js` (653), `presentation/agent-control.js` (635),
     `sdk/session/client.js` (634), `server/routes/sdk/session-crud.js` (624).

5. **Taxonomia de `ask_user` no terminal foi alinhada ao protocolo canônico.**

- `DialogProtocol.classify()` usa `ready|reply|stopped|question`.
- `terminal/sdk-interactions.js` agora resume `kind` em `question|ready|reply|stopped`, via
  `classifyUserInputQuestionKind()` exportada por `sdk/session/user-input.js`.
- O ramo morto `PROTO:` foi removido.

6. **`request_user_input` segue como wrapper semântico, mas com contrato operacional unificado.**

- A tool em `tools/hook-tools.js` permanece intencional para o protocolo operacional da LLM-B.
- `agent/messaging/answerPendingQuestion()` agora resolve `request_user_input` como fallback
  canônico quando não há `ask_user` pendente, preservando `/answer` como borda única de input.
- O evento `question.answered` continua emitido com `resolvedViaTool` para observabilidade e para
  evitar relay duplicado em `boot-runtime-bind`.

7. **Duas semânticas legítimas de permissão coexistem.**
   - Hooks de `pre_tool_use` usam `{ permissionDecision: allow|deny|ask }`.
   - Permission requests do SDK usam `PermissionRequestResult` (`approve-*`, `reject`, etc.).
   - A coexistência não é bug, mas precisa continuar documentada para evitar traduções indevidas.

## 4) Sinais investigados e não classificados como bug agora

- `setTimeout(async ...)` em `config/pinned-files.js`: possui `try/catch`, debounce map e cleanup
  via `stop()`. Recomenda-se migrar depois para timer registry, mas não é P1.
- `setTimeout(async ...)` em `bridges/mcp-tool-bridge.js`: possui cancelador, backoff e `unref()`;
  permanece aceitável como job operacional.
- `JSON.parse` em bordas HTTP/SSE/store: há usos com `try/catch` ou contexto controlado. Manter
  backlog para padronizar `safe-json` onde a entrada for externa.

## 5) Validação

- `npm run check:copilot:guardrails`: verde.
- `npm run typecheck:strict:src.copilot`: verde.
- `npx eslint` sobre arquivos JS/testes alterados: verde.
- `npm run test:copilot:unit`: verde, 145 arquivos e 2.412 testes.
- `npx vitest run --config vitest.copilot.config.js` com:
  - `tests/unit/copilot/contracts/test_module_layout_governance.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_migration_f19.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_permissions.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_rpc*.spec.js`
  - `tests/unit/copilot/config/test_system_prompt_modular.spec.js`
  - `tests/unit/copilot/test_presentation_runtime_sdk_session.spec.js`
  - `tests/unit/copilot/terminal/test_commands_sdk.spec.js`
  - `tests/unit/copilot/terminal/test_terminal_sdk_session_events.spec.js`
  - `tests/unit/copilot/observability/test_collectors.spec.js`

Resultado das suites focadas: verde.

Rodada complementar sem hotspots:

- `npx vitest run --config vitest.copilot.config.js` com permissions, SDK RPC, terminal SDK
  commands, event adapter coverage, agent context, projection routes e audit pipeline: verde, 15
  arquivos e 315 testes.

Rodada complementar de convergência canônica (`elicitation` + `user_input`):

- `make lint`: verde.
- `node_modules/.bin/vitest run` com:
  - `tests/unit/copilot/terminal/test_commands_sdk.spec.js`
  - `tests/unit/copilot/test_server_agent_route_validation.spec.js`
  - `tests/unit/copilot/test_sdk_api.spec.js`
  - `tests/unit/copilot/test_terminal_agent_runtime_events.spec.js`
  - `tests/unit/copilot/test_terminal_sdk_session_events.spec.js`
  - `tests/unit/copilot/agent/test_faixa_b_event_handlers.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_session_lifecycle.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_session_core_lifecycle.spec.js`

Resultado das duas baterias focadas: verde (`116` testes passando, `1` skipped).

Rodada final focada em `ask_user` / `user_input` após a promoção para `sdk/session/user-input.js`:

- `node_modules/.bin/eslint` sobre `sdk/session/user-input.js`, `hooks/user-input.js`,
  `event-handlers/interaction-events.js`, `terminal/sdk-interactions.js` e `sdk/index.js`: verde.
- `node_modules/.bin/vitest run` com:
  - `tests/unit/copilot/test_user_input_handler.spec.js`
  - `tests/unit/copilot/test_terminal_sdk_session_events.spec.js`
  - `tests/unit/copilot/agent/test_faixa_b_event_handlers.spec.js`
  - `tests/unit/copilot/terminal/test_commands_session.spec.js`
  - `tests/unit/copilot/test_terminal_agent_runtime_events.spec.js`

Resultado factual: verde (`83` testes passando).

Rodada complementar de convergência em permissions pending (SDK-first):

- `node_modules/.bin/vitest run` com:
  - `tests/unit/copilot/terminal/test_commands_sdk.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_rpc.spec.js`
  - `tests/unit/copilot/test_presentation_runtime_sdk_session.spec.js`
  - `tests/unit/copilot/test_agent_sdk_access.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_barrel.spec.js`

Resultado factual adicional: verde (`112` testes passando).

Rodada complementar de runtime targeting em streams operacionais:

- `node_modules/.bin/vitest run --config vitest.copilot.config.js` com:
  - `tests/unit/copilot/test_copilot_api_stream_runtime_targeting.spec.js`
  - `tests/unit/copilot/test_copilot_api_multi_runtime.spec.js`
  - `tests/unit/copilot/test_copilot_api_answer_fallback.spec.js`
  - `tests/unit/copilot/terminal/test_commands_sdk.spec.js`

Resultado factual: verde (`22` testes passando).

Rodada complementar de prova de isolamento SSE por runtime:

- `node_modules/.bin/vitest run --config vitest.copilot.config.js` com:
  - `tests/unit/copilot/test_copilot_api_multi_runtime.spec.js`
  - `tests/unit/copilot/test_copilot_api_stream_runtime_targeting.spec.js`
  - `tests/unit/copilot/test_http_bridge_stream.spec.js`

Resultado factual: verde (`5` testes passando, `1` skipped).

Rodada live terminal/LLM-B e correção RPC-only permissions:

- `npm run terminal:llm-b`: boot completo em modo standalone, `GET /health` e `GET /config`
  responderam `ok=true`.
- Comandos REPL validados ao vivo: `/status`, `/sdk waits`, `/permission pending`, `/exit`.
- Resultado operacional: terminal permaneceu saudável em `NOLOOP` após rate limit externo do Copilot
  SDK; causa exibida no status e no prompt, sem crash do processo.
- Limitação factual: não houve turno conversacional real com a LLM-B porque o SDK retornou
  `rate_limit` com reset em 18 minutos.
- `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/terminal/test_commands_sdk.spec.js`:
  verde (`16` testes), incluindo cobertura de `/permission pending` hidratando estado local para
  `/permission respond`.

Rodada final do turno:

- `npm run typecheck:strict:src.copilot`: verde.
- `npm run lint`: verde.
- `npm run check:copilot:guardrails`: verde.
- `npm run test:copilot:unit`: verde (`146` arquivos, `2.426` testes).

## 7) Atualização 2026-05-06 — Auto model e rate limits

Auditoria complementar solicitada sobre o comportamento observado no Copilot vanilla do VS Code:

- Fonte oficial validada: GitHub Copilot distingue limite de sessão e limite semanal de 7 dias.
  Limite de sessão exige aguardar reset; limite semanal pode continuar com seleção `Auto` quando
  ainda há premium requests disponíveis.
- O caminho canônico atual já preserva `model="auto"` até `createSession()`/`resumeSession()` do SDK
  e omite `reasoningEffort` nesse caso.
- Gap corrigido: o terminal/recovery policy não deve sugerir `/model auto` como se fosse contorno
  universal para todo `429`.
- `presentation/sdk-recovery-policy.js` e `sdk/errors.js` passaram a diferenciar `session`,
  `weekly_model` e `unknown` como subescopos de rate limit.
- `hooks/session-hooks.js` deixou de agendar fallback automático quando o SDK informa limite de
  sessão com reset temporal.
- Documento dedicado criado: `2026-05-06-AUDITORIA-AUTO-MODEL-E-RATE-LIMIT-COPILOT-SDK.md`.

Nota de governança: não há transformação para evadir rate limit ou burlar termos. A convergência
implementada maximiza uso permitido via Auto model, fallback explícito, mensagens corretas e
preservação do host local.

## 7.1) Atualização 2026-05-06 — critérios do `Auto` e preferência `gpt-5.4/high`

Auditoria complementar sobre `model auto`:

- Fonte oficial validada: a seleção `Auto` considera disponibilidade, saúde operacional em tempo
  real, performance, redução de rate limits/latência/erros, políticas administrativas, plano e
  exclusão de modelos com multiplicador premium maior que `1`.
- Inspeção local do SDK confirmou que o contrato público de sessão expõe `model` e
  `reasoningEffort`, mas não expõe campo público de preferência como `modelPreference`.
- Implementado contrato local `auto-policy` para projetar critérios oficiais, autoridade
  `github-copilot`, `canForcePreference=false` e preferência observável `gpt-5.4/high`.
- `/model`, `/status` e `/config` passaram a carregar essa policy junto com o último modelo
  efetivo/cobrado observado.
- Catálogo local de modelos foi atualizado para IDs atuais observados no SDK, incluindo `gpt-5.4`,
  `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.2`, `gpt-5.4-mini` e `claude-haiku-4.5`.
- `usage` passou a normalizar `effectiveModel=auto` para o `billedModel` concreto quando disponível,
  evitando perda de rastreabilidade.

Teste live:

- `npm run terminal:llm-b` com `model=auto` roteou para `claude-haiku-4.5`;
- `/model gpt-5.4` não teve convergência positiva da sessão SDK live, reforçando que a preferência
  local não deve ser tratada como controle vinculante do roteador `Auto`;
- turnos curtos `OK-AUTO-POLICY` e `OK-USAGE-NORMALIZED` completaram e preservaram metadata
  observada no `/status`.

## 8) Próximo corte recomendado

Próxima fatia de convergência arquitetural, mantendo baixo risco e alta coerência com 2.2:

1. consolidar teste de integração HTTP para `/answer` com fallback `request_user_input`;
2. retomar `R1` de permissions (`/permission pending` e cockpit curto);
3. só depois disso, voltar a transforms mais profundas em hotspots como
   `terminal/sdk-session-events` e `terminal/commands/sdk`.

## 9) Reflexão e análise profunda — próximos passos em `src/copilot`

Com os gaps P0–P3 já fechados, o maior risco arquitetural residual está menos em funcionalidade
faltante e mais em **coesão por runtime** e **densidade de composition roots**. O próximo ciclo deve
seguir esta ordem para manter segurança de rollout:

1. **Isolamento por runtime nas stores de UX terminal (`sdk-interactions`)**
   - **Permissions, elicitation e user_input já foram isolados por runtime** nesta rodada.
   - Próximo passo: completar isolamento multi-runtime de rate-limit e capability/profile snapshot
     para fechar `R5[~]` de ponta a ponta.

2. **Fatiamento semântico dos hotspots R4 (sem refactor cosmético)**
   - `terminal/sdk-session-events.js`: separar adapters de evento, renderers e side effects SSE.
   - `terminal/commands/sdk.js`: extrair submódulos (`permissions`, `elicitation`, `workspace`,
     `system-prompt`) com contratos pequenos e testáveis.

3. **Prova multi-runtime de rate-limit e capability snapshots**
   - Fechar os itens `R5[~]` com testes que demonstrem ausência de bleed de recovery policy e
     snapshots entre runtimes distintos sob carga de quota/rate-limit.

Essa sequência maximiza convergência canônica 2.2, reduz risco de regressão e prepara o terreno para
evolução de UX sem reintroduzir owners paralelos fora do SDK.

## 10) Atualização complementar 2026-05-06 — runtime-aware de `elicitation` e `ask_user`

- `npm run typecheck:strict:src.copilot`: verde.
- `node_modules/.bin/eslint` nos arquivos alterados: verde.
- `node_modules/.bin/vitest run --config vitest.copilot.config.js` com:
  - `tests/unit/copilot/terminal/test_commands_sdk.spec.js`
  - `tests/unit/copilot/test_terminal_sdk_session_events.spec.js`
  - `tests/unit/copilot/test_terminal_agent_runtime_events.spec.js`

Resultado factual: verde (`41` testes passando), incluindo cobertura nova de isolamento
`elicitation/user_input` por `runtimeId` em `/sdk waits` e `/elicitation latest`.
