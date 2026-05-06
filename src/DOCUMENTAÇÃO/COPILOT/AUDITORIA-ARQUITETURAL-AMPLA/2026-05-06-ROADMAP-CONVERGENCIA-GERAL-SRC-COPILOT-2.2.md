# Roadmap 2.2 — convergência geral de `src/copilot`

Data base: 2026-05-06 Origem: rodada de auditoria geral em `src/copilot`, expandindo a trilha de
permissions para SDK RPC, terminal, server/routes, system prompt, elicitation, `ask_user` e module
maps.

## R0 — Guardrails e anti-bypass (concluído nesta rodada)

- [x] Fechar chamada crua `session.rpc.instructions.getSources()` fora de `sdk/`.
- [x] Promover `instructionSourcesGet(session)` para a façade SDK.
- [x] Garantir `check:copilot:guardrails` verde.
- [x] Alinhar module maps a arquivos reais e limites de hotspot.

## R1 — Permissions P2 funcional

- [x] Implementar `/permission pending` com fonte ativa quando o namespace SDK expuser contrato
      confiável de listagem. - 2026-05-06: incluído `permissionsListPending()` no SDK RPC e
      propagado para agent/presentation/terminal, com fallback explícito para estado observado local
      quando o namespace não oferece listagem ativa. Complemento da rodada live: requests vindos da
      listagem ativa agora hidratam o estado local para manter `/permission respond <id>` como borda
      única também em cenários RPC-only.
- [x] Expandir `/permission respond` guiado com validação por tipo de permissão. - 2026-05-06:
      terminal valida `approval` em `approve-for-session` e `approval` + `locationKey` em
      `approve-for-location` antes de chamar o RPC.
- [x] Expor cockpit curto: modo atual, últimas mudanças, pendências por tipo e quick actions. - 2026-05-06:
      comando `/permission cockpit` no terminal com agregação de pendências por tipo, latest
      request, histórico local de `permission.mode_changed` e atalhos operacionais.
- [ ] Criar teste de integração request → respond → completed com `requestId` correlacionado.

## R2 — System prompt projection única

- [x] Consolidar status, compatibilidade SDK, freshness, bindings e instruction sources em uma
      projection pública única. - 2026-05-06: criada a projection canônica
      `buildSystemPromptPublicProjection()` em `config/system-prompt/projection.js`, consumida pela
      `presentation/runtime-sdk-session` e exposta em `projection` mantendo campos legados.
- [x] Documentar owner: `config/system-prompt` monta política; `sdk/rpc` fala com RPC; presentation
      projeta para terminal/server. - 2026-05-06: ownership explícito na projection (`policyOwner`,
      `rpcOwner`, `projectionOwner`) + documentação no módulo canônico.
- [x] Adicionar contrato contra regressão de `session.rpc` fora de `sdk/` no caminho de system
      prompt. - 2026-05-06: `check:crude` cobre a regressão e `server/routes/sdk/deps.js` deixou de
      expor helpers avulsos para a rota HTTP.

## R2.5 — Elicitation + `ask_user` como contratos canônicos do SDK

- [x] Promover `elicitation` a núcleo canônico em `sdk/session/elicitation.js`. - 2026-05-06:
      normalizers de pending/completed/result + fila provider-side migrados para o SDK.
- [x] Transformar `hooks/elicitation.js` em compat layer. - 2026-05-06: `hooks` deixam de ser owner
      do fluxo de elicitation.
- [x] Fazer terminal, server, event-handlers e agent provider-side consumirem o contrato canônico de
      `elicitation`. - 2026-05-06: concluído.
- [x] Promover `user_input`/`ask_user` a surface canônica em `sdk/session/user-input.js`. -
      2026-05-06: normalizers de requested/completed e factories de handlers saíram de `hooks/`.
- [x] Transformar `hooks/user-input.js` em compat layer. - 2026-05-06: concluído.
- [x] Fazer `interaction-events` e `terminal/sdk-interactions` consumirem o contrato canônico de
      `user_input`. - 2026-05-06: concluído.
- [x] Alinhar a taxonomia resumida de `ask_user` no terminal (`protocol`) com `DialogProtocol`
      (`stopped`/`question`/`ready`/`reply`) e remover o ramo morto `PROTO:`. - 2026-05-06:
      `terminal/sdk-interactions.js` passou a consumir `classifyUserInputQuestionKind()` do SDK,
      eliminando o branch morto `PROTO:`.
- [x] Decidir o contrato-alvo entre a tool `request_user_input` e o fluxo nativo
      `ask_user`/`user_input.*`. - 2026-05-06: `answerPendingQuestion()` passou a tratar
      `request_user_input` como fallback canônico quando não há `ask_user` vivo, mantendo `/answer`
      como borda única de resposta humana.

## R3 — SSE e adapters explícitos

- [x] Transformar passthrough residual em matriz evento → adapter/ignore/passthrough.
- [x] Adicionar teste que falha quando evento novo entra no passthrough sem classificação. -
      2026-05-06: `permission.mode_changed` foi removido do passthrough e a matriz agora testa
      interseção vazia entre eventos explícitos e passthrough.
- [x] Garantir runtime targeting antes de abrir streams operacionais. - 2026-05-06:
      `copilot-api/stream` e `copilot-api/stream/tasks` passaram a rejeitar `runtimeId` explícito
      inexistente com `404` + metadata canônica (`requestedRuntimeId`, `runtimeFound=false`) antes
      de abrir conexão SSE, evitando fallback silencioso em superfície operacional.

## R4 — Hotspots por seams semânticos

Fora do escopo da rodada complementar de 2026-05-06 por solicitação explícita. Manter como backlog,
sem mexidas cosméticas.

Prioridade sugerida:

1. `terminal/sdk-session-events.js`: separar render, state update e emission side effects.
2. `terminal/commands/sdk.js`: fatiar `/sdk`, `/permission`, `/elicitation`, `/workspace`.
3. `sdk/session/lifecycle.js`: separar create/resume/recovery/model-resolution.
4. `presentation/agent-control.js`: separar inject/preflight/result projection.
5. `server/routes/sdk/session-crud.js` e `server/routes/sdk/deps.js`: reduzir composition roots
   muito densos.

## R5 — Multi-runtime e multi-agent

- [x] Provar isolamento de stream por `runtimeId`. - 2026-05-06: teste de integração
      `tests/unit/copilot/test_copilot_api_multi_runtime.spec.js` passou a abrir dois SSE streams
      simultâneos (`default` e `audit`) e validar que cada stream recebe apenas o evento `status`
      emitido pelo seu runtime (`runtimeId`/`sourceRuntime` correlacionados), sem bleed cross-runtime.
- [~] Provar isolamento de rate-limit por `runtimeId`. - 2026-05-06: subescopo de rate limit
      (`session` vs `weekly_model` vs `unknown`) agora é classificado em `sdk/errors.js` e
      `presentation/sdk-recovery-policy.js`; ainda falta prova multi-runtime real.
- [~] Separar profile/capability snapshot por runtime/agent profile. - 2026-05-06: policy Auto,
      metadata de modelo observado e preferência local `gpt-5.4/high` passaram a ser projetadas por
      runtime; ainda falta exercitar múltiplos runtimes vivos em paralelo.
- [x] Garantir que fallback para runtime default continue explícito e metadata-rich. - 2026-05-06:
      projection de config agora usa o runtime efetivamente resolvido para policy Auto e metadata,
      evitando `NotFoundError` quando a chamada cai no default.

## R6 — Governança documental viva

- [ ] Manter os documentos 100–106 como baseline histórica.
- [ ] Usar os documentos 2026-05-06 como trilha viva da fase 2.2.
- [ ] Atualizar o README da auditoria ampla a cada nova rodada com status, validações e próximos
      cortes.

## Próximo corte operacional recomendado

1. retomar `R1` (`/permission pending` e cockpit curto);
2. adicionar teste de integração HTTP cobrindo `/answer` com fallback `request_user_input`;
3. só então voltar ao fatiamento de hotspots (`R4`).

Atualização complementar desta rodada:

1. Teste HTTP de integração para `/answer` com fallback canônico `request_user_input` adicionado em
      `tests/unit/copilot/test_copilot_api_answer_fallback.spec.js`.
2. O fallback confirma `question.answered` com `hadPending=false` e `resolvedViaTool=true`,
      preservando `/answer` como borda única de input humano também quando não existe `ask_user` vivo.

Atualização operacional após teste live:

1. `/permission pending` já cobre listagem ativa + fallback + hidratação local; o restante de R1 é
   cockpit curto e teste request → respond → completed correlacionado.
2. `terminal:llm-b` bootou em standalone e manteve `/status`, `/sdk waits`, `/permission pending`,
   `/health` e `/config` funcionais sob `rate_limit` externo.
3. O primeiro turno real LLM-B ainda precisa ser repetido após reset do rate limit para validar
   streaming conversacional sem a interferência do provider.

Atualização operacional sobre Auto model e quota:

1. `model="auto"` já é preservado até o SDK em criação/retomada de sessão; ele não deve ser
   resolvido localmente no fluxo canônico.
2. Limite de sessão agora orienta aguardar reset e não agenda fallback automático.
3. Limite semanal/modelo agora orienta `/model auto` + `/restart` como estratégia permitida,
   alinhada ao comportamento oficial do Copilot.
4. Documento dedicado: `2026-05-06-AUDITORIA-AUTO-MODEL-E-RATE-LIMIT-COPILOT-SDK.md`.

Reteste live adicional:

1. `terminal:llm-b` iniciou com `model=auto` e sessão ativa.
2. SDK roteou Auto para `claude-haiku-4.5`.
3. `/status`, `/sdk quota`, `/health` e `/config` responderam com runtime saudável.
4. Turno curto retornou resposta em aproximadamente `2.3s`.
5. Quota semanal baixa foi observada, mas sem bloqueio de sessão nesse teste.

Reteste Auto model e preferência local:

1. Critérios oficiais do `Auto` foram documentados: disponibilidade, saúde operacional,
   performance, redução de rate limit/latência/erros, políticas administrativas, plano e exclusão
   de modelos com multiplicador premium maior que `1`.
2. SDK local agora expõe policy Auto observável com autoridade `GitHub Copilot`,
   `canForcePreference=false` e preferência local default `gpt-5.4/high`.
3. `/model` e `/status` mostram último modelo efetivo/cobrado, preferência local e metadata do
   modelo observado quando `model=auto`.
4. Teste live confirmou que `/model gpt-5.4` pode atualizar configuração local, mas não houve
   convergência positiva da sessão SDK; `Auto` continuou sob autoridade do Copilot e roteou para
   `claude-haiku-4.5`.
5. `usage` agora normaliza `effectiveModel=auto` para o `billedModel` concreto quando disponível,
   preservando rastreabilidade da seleção real.

## Critério de pronto 2.2

- Guardrails estruturais verdes por padrão.
- Nenhum `session.rpc`/`client.rpc` executável fora de `sdk/`.
- `elicitation` e `user_input` consumidos por contracts SDK canônicos, sem hooks como owner.
- Permissions operáveis sem depender apenas de estado observado local.
- System prompt com projection única e sem bypass de SDK boundary.
- Passthrough SSE residual classificado por contrato.
- Hotspots reduzidos por extração de owners reais, não por movimentação cosmética.
