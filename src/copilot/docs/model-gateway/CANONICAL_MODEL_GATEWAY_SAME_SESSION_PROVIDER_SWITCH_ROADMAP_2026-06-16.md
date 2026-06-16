# Model Gateway / BYOK / LLM-B — guia canônico pós-consolidação same-session

Data canônica: 2026-06-16

Status: ativo, normativo e continuamente atualizável

Escopo exclusivo: `src/copilot`

Base lida integralmente antes deste guia:
`src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_LLM_B_CONTROL_PLANE_AUDIT_AND_ROADMAP_2026-06-15.md`

Leitura confirmada: 1.796 linhas, do título até as referências externas.

Checkpoint sincronizado antes da investigação original:

- commit local/remoto: `b211cb47` (`feat(copilot): consolidate model gateway control plane`);
- branch: `main`;
- push: `origin/main` atualizado de `64ab084f3` para `b211cb47`.

Checkpoint sincronizado após os incrementos de same-session e lifecycle SDK:

- commit local/remoto: `4281d9313` (`feat(copilot): restart sdk sessions through model gateway lifecycle`);
- branch: `main`;
- push: `origin/main` atualizado de `5b3b11da4` para `4281d9313`;
- worktree rastreado limpo após o push; permanecem apenas untracked externos ao incremento atual.

Este arquivo passa a ser o novo guia operacional para as próximas etapas. O roadmap anterior continua histórico e
útil como evidência, mas o trabalho novo deve atualizar os checkboxes deste documento no mesmo incremento do código.

## 1. Regra de atualização contínua

- [x] Nenhum checkbox é marcado como concluído sem código ou evidência verificável.
- [x] Trabalho parcial fica em `[ ]` com nota de progresso.
- [x] Live runs que falham por harness, mas provam funcionalidade, são registrados como evidência operacional, não como
  aceite final.
- [x] `/restart` é restart real de sessão SDK: fecha o runtime atual e reabre pelo initializer.
- [x] `/conversation-restart` é o comando conversa-only: reinicia apenas o dialog loop, sem mudar provider, modelo,
  rota nem identidade SDK.
- [x] `/restart` sem argumentos não força nova sessão; ele executa o initializer para consumir seleção pendente ou
  automática. Nova sessão é opt-in em `/restart new` ou `/session sdk restart new`.
- [x] Nova sessão só ocorre por pedido explícito humano ou por comando explícito dedicado a criar nova sessão.
- [ ] Ao implementar qualquer item abaixo, atualizar este arquivo antes do commit.

## 2. Situação atual reconstruída

### 2.1 O que já está forte

- [x] Existe control plane em `src/copilot/model-gateway/control-plane/`.
- [x] `SessionBindingPlan`, `ModelIdentity`, lifecycle canônico e secret diagnostics existem.
- [x] Troca de modelo é transacional e idempotente no caminho canônico.
- [x] Troca de rota/provider preserva `sessionId` e falha fechado se o SDK retornar outra identidade.
- [x] `model_gateway_route_switch` não tenta reattach durante tool-turn ativo; retorna
  `deferred_until_turn_boundary`.
- [x] O terminal consegue promover operação deferida com `/byok provider ... idempotency:<key> force-deferred`.
- [x] O terminal também tenta promover operações deferidas automaticamente em `assistant.turn_end`, filtrando por
  `deferReason=ACTIVE_DIALOG_LOOP_ROUTE_REATTACH_DEFERRED`, mesma sessão e operação retryable.
- [x] O live test mínimo provou deferimento dentro do tool-turn e promoção posterior para
  `ollama-cloud/qwen3-coder-next` na mesma sessão.
- [x] Existem 16 tools locais `model_gateway_*` para LLM-B, incluindo guia e workflow planner.
- [x] Profile store materializa perfis BYOK como `gateway_profile` antes da borda SDK.
- [x] `onListModels` já projeta catálogo elegível do gateway, com fallback compatível.
- [x] `npm run typecheck:node` passou após correção de tipagem em `runtime-route-switch.js`.
- [x] `git diff --check --cached` passou antes do commit `b211cb47`.
- [x] `4281d9313` adicionou full stop/start do runtime para `/restart`, `/conversation-restart`, scheduler de promoção
  diferida e testes focados.

### 2.2 O que ainda não está fechado

- [x] Promoção automática em `assistant.turn_end` existe para operações diferidas seguras, retryable e com
  `deferReason=ACTIVE_DIALOG_LOOP_ROUTE_REATTACH_DEFERRED`.
- [x] `model_gateway_runtime_reconcile` reconhece operação `same-session-route-switch:*` diferida e retorna plano seguro
  de promoção quando o reattach imediato não é seguro.
- [ ] A promoção automática ainda não tem policy/consent ledger próprio; hoje ela promove somente operações que o
  executor marcou como autopromovíveis pelo `deferReason`.
- [ ] Ingress/proxy dinâmico do Model Gateway ainda não existe para providers que o SDK não rebindar diretamente.
- [ ] Não há módulo `model-gateway/ingress` nem proxy OpenAI-compatible local estável; existem adapters
  OpenAI-compatible e specs de endpoint, mas não uma camada runtime de roteamento por operação.
- [ ] `terminal/commands/byok.js` segue monolítico e ainda concentra casos de uso.
- [ ] Existem testes legados que ainda esperam `auto_prepare_new_session`, `prepare_new_sdk_session` e
  `/session sdk next new` como caminho normal.
- [ ] Profile management ainda persiste no processo vivo; escrita durável controlada precisa de decisão final.
- [ ] O shape de `profile` em `model_gateway_profile_manage` é flexível demais para ser a situação ideal.
- [ ] Readiness ainda precisa convergir completamente entre `overview`, `/byok`, `ops` e health cockpit.
- [ ] O live mais recente `2026-06-16T07-33-21-790Z` provou o fluxo funcional, mas falhou critérios de export/usage:
  `export-sse-correlation`, `no-prompt-double-render`, `export-ask-user`, `export-ask-user-answer`,
  `byok-real-usage-classified`.
- [ ] Falta live controlado de rollback induzido e reconcile pós-mismatch.
- [ ] O caminho vanilla GitHub Copilot SDK ainda precisa de golden tests explícitos.

### 2.3 Investigação 2026-06-16 pós-`4281d9313`

- [x] `src/copilot/terminal/byok/deferred-route-promotion.js` é a nova primitiva terminal de promoção automática.
  Ela lê handoffs recentes no SQLite, filtra operações diferidas autopromovíveis e chama o mesmo executor terminal de
  route switch com `forceApplyDeferred=true`.
- [x] `src/copilot/terminal/events/sdk-session-events.js` agenda a promoção em `assistant.turn_end` via `setImmediate`,
  após o drain de mailbox do turno.
- [x] `src/copilot/tools/model-gateway/model-gateway-tools.js` já permite `model_gateway_runtime_reconcile` com
  `routeOperationId`, incluindo plan/apply para promover operação diferida quando a safety capability permite.
- [x] `src/copilot/model-gateway/control-plane/runtime-route-switch.js` impede replay cruzado por `sessionId` e route
  identity, e não reaproveita `deferred_until_turn_boundary` quando `forceApplyDeferred=true`.
- [x] `src/copilot/model-gateway/control-plane/same-session-route-switch.js` grava estado
  `deferred_until_turn_boundary` sem chamar `reattach` quando o tool-turn/dialog loop ativo torna o reattach inseguro.
- [x] `src/copilot/model-gateway/providers/openai-compatible-adapter.js` e specs de endpoints já sabem projetar
  providers OpenAI-compatible para sessão SDK, mas não há ingress/proxy dinâmico.
- [ ] `/now` e `/health` ainda usam `readTerminalConfigProjection()` + `modelGatewayProjection`, não um
  `ModelGatewayReadiness` único; eles exibem contagens e rota ativa, mas não listam operações diferidas pendentes.
- [ ] `/activity` exibe eventos e tools Model Gateway via presenters, mas não tem seção dedicada a route switches
  diferidos/promovíveis.
- [ ] `src/copilot/terminal/commands/config.js` ainda contém copy que sugere `/session sdk next new` para troca de
  provider/perfil; isso deve ser revisado para `/byok provider` + reattach same-session ou `/restart` quando houver
  boot/restart explícito.
- [ ] Os testes de `test_commands_byok.spec.js` passam após atualização de mocks e expectativas focadas, mas ainda
  preservam fixtures/nomes legados para policy compatibility; `test_model_gateway_contracts.spec.js` ainda contém
  expectativas antigas de `prepare_new_session`.

## 3. Situação ideal

### 3.1 Superfície única

Operador humano e LLM-B devem enxergar uma superfície única:

```text
catálogo + perfis + saúde + rota + sessão viva
  -> Model Gateway Control Plane
  -> terminal / tools / boot / SDK server
```

O terminal renderiza e aciona use-cases. As tools planejam e aplicam operações. O boot consome bindings. Nenhuma borda
reinventa regra de provider/modelo.

### 3.2 Troca natural na mesma sessão

Trocar modelo/provider/rota deve parecer tão natural quanto trocar reasoning:

- planejar com explicação;
- aplicar com idempotência;
- preservar `sessionId`;
- exibir provider/modelo efetivo;
- registrar operação e saúde;
- corrigir mismatch sem nova sessão implícita.

Quando o reattach imediato é perigoso no meio do tool-turn, a operação deve ser agendada/promovida no limite seguro do
turno, não empurrada para uma nova sessão.

### 3.3 Control plane completo para LLM-B

A LLM-B deve conseguir:

- consultar visão geral;
- buscar catálogo;
- propor workflow;
- planejar rota/modelo;
- avaliar modelos por custo, contexto, saúde e tool-calling;
- executar probes descartáveis;
- atualizar catálogo;
- gerir perfis sem segredo inline;
- trocar modelo/provider;
- reconciliar divergência;
- acompanhar ledgers e evidências.

### 3.4 Segurança e observabilidade

- Segredos nunca aparecem em transcript, tool result, export, SSE ou Markdown.
- `sessionId`, provider, providerModel, profile, route key, operation id e idempotency key aparecem em forma redigida e
  rastreável.
- Falhas de provider viram health evidence e política de elegibilidade, não ruído textual.
- Readiness distingue estrutural, operacional, live, freshness e mismatch.

## 4. Roadmap executável

### Faixa 0 — Governança pós-push

- [x] Commit estrutural `b211cb47` criado.
- [x] Push para `origin/main` concluído.
- [x] Roadmap canônico anterior lido integralmente.
- [x] Gaps abertos extraídos por checkbox e busca textual.
- [x] Novo guia canônico criado.
- [ ] Limpar ou substituir rascunhos documentais locais que contradizem o estado atual.
- [ ] Commitar e pushar este novo guia.

### Faixa A — Promoção automática de route switch deferido

#### A.1 Ledger e descoberta de operações deferidas

- [ ] Adicionar consulta dedicada, indexada e não apenas scan recente, para operações `same-session-route-switch:*` em
  `deferred_until_turn_boundary`.
- [ ] Indexar por `sessionId`, `idempotencyKey`, route identity e `createdAt`.
- [ ] Expor no `model_gateway_operation_status` quais operações diferidas são promovíveis, expiradas ou exigem revisão.
- [ ] Incluir `nextActions` concretos: promoção terminal, promoção automática ou descarte.
- [x] Caminho terminal inicial lê `readSdkSessionHandoffRecords({ limit })` e classifica candidatos com guardas de
  idade, state, retryable, requiresNewSession=false, idempotencyKey e targetRoute.

#### A.2 Scheduler em limite de turno

- [x] Definir evento canônico de promoção em `assistant.turn_end`.
- [x] Garantir que a promoção só roda depois de tool responses fechadas.
- [ ] Exigir sinal explícito de autorização/política para aplicar promoção automática além do `deferReason`.
- [x] Preservar dialog loop e `sessionId` durante a promoção.
- [ ] Registrar transição `deferred_until_turn_boundary -> reattach_requested -> ... -> committed`.
- [ ] Cobrir operação agendada, operação cancelada e operação expirada.
  - Progresso: unit test cobre promoção válida e bloqueio por `deferReason` não autopromovível.
- [ ] Adicionar métrica/atividade quando não houver candidato, quando candidato expirar e quando a promoção for
  ignorada por policy.

#### A.3 UX e tools

- [x] `model_gateway_route_switch` explica o deferimento com erro semântico
  `ROUTE_SWITCH_DEFERRED_UNTIL_TURN_BOUNDARY` e `nextActions`.
- [ ] `model_gateway_workflow_plan` deve gerar etapa de promoção pós-turno quando apropriado.
- [ ] `/activity`, `/byok` e `/tools diag` devem exibir operação diferida pendente sem sugerir nova sessão.
- [x] `/restart` deve ser descrito como restart real de sessão SDK em todos os pontos do terminal.
- [x] `/conversation-restart` deve ser descrito como conversa-only em todos os pontos do terminal.

### Faixa A.4 — Comandos explícitos de lifecycle SDK

- [x] `/restart` sem argumentos fecha o runtime atual e reabre via initializer, consumindo seleção pendente ou automática
  sem forçar nova sessão.
- [x] `/restart new` fecha a sessão atual e cria nova sessão SDK por pedido explícito.
- [x] `/restart resume <id|#n|atual|última|primeiro-plano>` fecha a sessão atual e reabre tentando retomar a sessão
  escolhida.
- [x] `/restart auto` limpa diretiva explícita e reinicializa pelo padrão persistido.
- [x] `/session restart ...` e `/session sdk restart ...` existem como comandos verbosos de operador.
- [x] `/conversation-restart` e `/dialog-restart` preservam o antigo restart do dialog loop.
- [ ] Adicionar live test validando que `/restart` consome `nextSdkSessionBoot` e altera/retoma o `sessionId` esperado.

### Faixa B — Reconcile de rota/provider, não só modelo

- [x] Fazer `model_gateway_runtime_reconcile` aceitar `routeOperationId` de route switch diferido.
- [x] Distinguir reconcile de modelo (`expectedModelId`) e reconcile de rota (`routeOperationId`).
- [x] Quando a operação estiver deferida, retornar plano de promoção em vez de `runtime_reconcile_not_committed`.
- [x] Quando a operação de rota já estiver `committed`, marcar `already_converged`.
- [x] Quando a capability indicar reattach seguro, aplicar o mesmo executor de route switch com
  `forceApplyDeferred=true`.
- [x] Adicionar teste unitário para operação diferida reconhecida e não promovida durante tool-turn ativo.
- [ ] Adicionar testes unitários para deferred -> committed via reconcile quando capability estiver segura.
- [ ] Adicionar live mínimo: deferir route switch, promover por reconcile, continuar mesma sessão.

### Faixa C — Matar a dívida de nova sessão implícita

- [ ] Atualizar/renomear fixtures legadas em `tests/unit/copilot/terminal/test_commands_byok.spec.js` que ainda citam
  `auto_prepare_new_session` como compatibilidade.
  - Progresso: a suíte completa passou com 119/119 após atualizar expectativas de output que exigiam
    `/session sdk next new` como caminho normal.
- [ ] Atualizar testes legados em `tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js` que ainda
  esperam `prepare_new_session` como ação normal.
- [ ] Reclassificar `/session sdk next new` como ação explícita de operador, nunca recomendação automática de BYOK.
- [ ] Preservar compatibilidade de leitura do preset `auto_prepare_new_session` como alias para
  `auto_same_session_route`, sem efeito de nova sessão.
- [ ] Remover copy de terminal que sugira que restart/next boot é forma normal de trocar provider.
  - Gap atual confirmado: `src/copilot/terminal/commands/config.js` ainda recomenda `/session sdk next new` para
    troca de provider/perfil.
- [ ] Adicionar regra de teste: qualquer novo `prepare_new_sdk_session` precisa provar que é opt-in explícito.

### Faixa D — Decompor `/byok`

- [ ] Mapear casos ainda implementados diretamente em `terminal/commands/byok.js`.
- [ ] Extrair parser puro de argumentos.
- [ ] Extrair renderers de status, provider, health, probes e recommendation.
- [ ] Extrair use-cases que chamam control plane: profile, model, provider, probe, refresh, recommend.
- [ ] Garantir que terminal e tools usam os mesmos serviços, não parsing textual.
- [ ] Manter aliases humanos PT-BR/EN sem transformar output humano em API primária.
- [ ] Reduzir `terminal/commands/byok.js` para orquestração fina e delegação.

### Faixa E — Perfis BYOK duráveis e schemas por provider

- [ ] Decidir store durável canônico: `.env.local` controlado, JSON dedicado ou SQLite.
- [ ] Implementar `plan` com diff redigido antes de qualquer escrita persistente.
- [ ] Implementar `apply` atômico com idempotency key.
- [ ] Implementar rollback de mutação de perfil.
- [ ] Criar validação estrutural por provider/wire API.
- [ ] Restringir `profile` flexível da tool por canonicalização antes da escrita.
- [ ] Bloquear refs arbitrárias fora da allowlist do provider, preservando leitura de legados.
- [ ] Expor auditoria de mutação de perfil em `operation_status`.

### Faixa F — Readiness única

- [ ] Definir schema único `ModelGatewayReadiness`.
- [ ] Alimentar `model_gateway_overview` com esse schema.
- [ ] Alimentar `/byok`, `/session sdk`, `/now` e `/health` com o mesmo schema.
- [ ] Alinhar `ops --json` ao mesmo readiness, removendo falso `ok` para snapshot obsoleto/mismatch.
- [ ] Incluir freshness, standby, health probes, route mismatch, session identity e deferred operations.
- [ ] Adicionar budget de latência e fonte dos dados no payload.
- [ ] Cobrir por unit tests e um smoke real.

### Faixa G — Catálogo, saúde e política de modelo

- [ ] Executar refresh controlado sem exposição de segredo.
- [ ] Normalizar filtros `provider:kilo-code` para refletir modelos funcionais selecionáveis.
- [ ] Rebaixar modelos com `agent probe tool-missing` para tarefas que exigem tool-calling.
- [ ] Separar capability de visão como opcional enquanto fixture PNG falha em providers reais.
- [ ] Promover/rebaixar elegibilidade por evidência live recente, não só catálogo remoto.
- [ ] Criar standby plans persistidos e testáveis.

### Faixa H — Ingress/proxy dinâmico

- [x] Confirmar estado atual: não existe implementação de ingress/proxy dinâmico no Model Gateway; só adapters,
  specs de endpoints e fixture OpenAI-compatible local.
- [ ] Definir se o SDK consegue rebindar todos os providers necessários via `resumeSession`, usando matriz por
  provider/modelo/capability.
- [ ] Desenhar contrato `ModelGatewayIngressRoute` com `routeId`, `sessionId`, provider real, model real, profile,
  secret refs redigidas, capabilities e TTL.
- [ ] Criar módulo `src/copilot/model-gateway/ingress/` com servidor OpenAI-compatible local estável visto pelo SDK
  como provider único.
- [ ] Roteamento interno do ingress deve usar provider/model/profile/secret do Model Gateway, sem segredo no URL,
  transcript, SSE ou ledger.
- [ ] Preservar streaming, JSON, tool-calling, tool_choice, ask_user e erros OpenAI-compatible.
- [ ] Registrar health por provider real e por route identity, não apenas pelo ingress local.
- [ ] Integrar ingress ao `SessionBindingPlan` somente quando o provider não suportar rebind direto confiável.
- [ ] Adicionar rollback e reconciliação para troca de rota via ingress.
- [ ] Testar troca cross-provider sem recriar sessão usando ingress.
- [ ] Criar fixture hermética do ingress para unidade/smoke antes de qualquer provider real.

### Faixa I — Harness live, export e SSE

- [ ] Corrigir `export-sse-correlation` para ask_user e answer.
- [ ] Corrigir export Markdown para conter pergunta canônica e resposta humana com autoria correta.
- [ ] Corrigir `no-prompt-double-render` sem mascarar prompts legítimos.
- [ ] Corrigir `byok-real-usage-classified` para classificação BYOK atual.
- [ ] Manter cenário mínimo de deferimento + promoção como PASS formal.
- [ ] Criar cenários menores por família de tools: catálogo, probes, perfil, switch/reconcile, manutenção.
- [ ] Rodar live rollback induzido e live reconcile pós-mismatch.

### Faixa J — Golden path vanilla GitHub Copilot SDK

- [ ] Criar golden test para `createSession` sem BYOK.
- [ ] Criar golden test para `resumeSession` sem BYOK.
- [ ] Provar que defaults e capabilities nativas são preservadas.
- [ ] Provar que `onListModels` vanilla não é sequestrado quando gateway não está ativo.
- [ ] Provar que BYOK/gateway não degrada sessão nativa.

### Faixa K — Aceite final

- [ ] Catálogo elegível e sessão real concordam sobre provider/modelo em todos os cockpits.
- [ ] Troca de provider/modelo ocorre na mesma sessão de forma natural, inclusive via LLM-B.
- [ ] Tool-turn ativo nunca perde tool response por reattach no meio do turno.
- [ ] Deferimento tem promoção automática ou caminho explícito pelo control plane.
- [ ] Reconcile entende modelo, rota e operações deferidas.
- [ ] Terminal e tools compartilham serviços sem semânticas paralelas.
- [ ] Profile management é durável, auditável e redigido.
- [ ] Readiness única governa overview, terminal, ops e health.
- [ ] Testes focados e live autorizados passam sem segredo em output/export/SSE.
- [ ] Branch `main` fica limpa, commitada e pushada após cada incremento relevante.

## 5. Ordem recomendada de execução

1. Fechar Faixa A e B juntas: scheduler de promoção + reconcile de operação diferida.
2. Abrir Faixa H em paralelo com design + fixture hermética do ingress/proxy dinâmico, sem esperar por providers reais.
3. Corrigir harness/export da Faixa I para transformar o live mínimo em PASS formal.
4. Atualizar testes legados da Faixa C para remover a expectativa de nova sessão implícita.
5. Persistir perfis da Faixa E.
6. Decompor `/byok` na Faixa D.
7. Avançar readiness única e golden path vanilla.

## 6. Evidência inicial deste guia

- [x] `git fetch origin main` antes do push não encontrou avanço remoto.
- [x] `npm run validate:copilot` rodou até o `typecheck`; o lint amplo passou e o `typecheck` apontou um erro real.
- [x] Erro corrigido: `forceApplyDeferred` agora aceita `undefined` explicitamente sob `exactOptionalPropertyTypes`.
- [x] `npm run typecheck:node` passou após a correção.
- [x] `npx eslint src/copilot/model-gateway/control-plane/runtime-route-switch.js` passou.
- [x] `git diff --check --cached` passou.
- [x] `git commit -m "feat(copilot): consolidate model gateway control plane"` criou `b211cb47`.
- [x] `git push origin main` atualizou `origin/main`.
- [x] `model_gateway_runtime_reconcile` passou a aceitar `routeOperationId`, inspecionar o ledger SQLite de handoffs e
  retornar plano de promoção para operação `deferred_until_turn_boundary`.
- [x] `npx eslint src/copilot/tools/model-gateway/model-gateway-tools.js src/copilot/tools/model-gateway/schemas.js tests/unit/copilot/tools/test_model_gateway_workflow_plan.spec.js`
  passou.
- [x] `npx vitest run tests/unit/copilot/tools/test_model_gateway_workflow_plan.spec.js --reporter=dot` passou com
  3/3 testes.
- [x] `npm run typecheck:node` passou.

## 7. Evidência pós-checkpoint `4281d9313`

- [x] `git pull --ff-only` antes do push retornou `Already up to date`.
- [x] `git push` atualizou `origin/main` de `5b3b11da4` para `4281d9313`.
- [x] `npx vitest run tests/unit/copilot/terminal/byok/test_deferred_route_promotion.spec.js tests/unit/copilot/terminal/test_repl_input_routing.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_byok.spec.js --reporter=dot`
  passou com 4 arquivos e 176 testes.
- [x] `npx eslint` focado nos arquivos de lifecycle SDK, promoção diferida, terminal commands e specs passou.
- [x] `npm run typecheck:node` passou.
- [x] `git diff --check` passou antes do commit.
- [x] `tests/unit/copilot/terminal/test_commands_byok.spec.js` passou com 119/119 após alinhar mocks/expectativas à regra
  de mesma sessão e ao bloqueio de nova sessão implícita.
- [x] `tests/unit/copilot/terminal/byok/test_deferred_route_promotion.spec.js` cobre promoção válida e bloqueio por
  `deferReason` não autopromovível.
- [x] Investigação pós-push confirmou ausência de módulo de ingress/proxy dinâmico em `src/copilot/model-gateway/`;
  existem adapters OpenAI-compatible, specs de endpoints e fixture local, mas não proxy runtime.
- [x] Investigação pós-push confirmou que `/now` e `/health` ainda dependem de `modelGatewayProjection` derivada de
  configuração, não de um schema único `ModelGatewayReadiness`.
- [x] Investigação pós-push confirmou que `/activity` reconhece tools Model Gateway, mas ainda não lista operações
  diferidas/promovíveis como uma seção própria.
