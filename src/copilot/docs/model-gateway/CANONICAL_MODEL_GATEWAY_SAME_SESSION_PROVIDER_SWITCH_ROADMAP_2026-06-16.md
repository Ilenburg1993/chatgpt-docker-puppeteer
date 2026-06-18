# Model Gateway / BYOK / LLM-B — roadmap canonico de troca de provider na mesma sessao

Data canonica: 2026-06-16

Ultima atualizacao material: 2026-06-18 — auditoria profunda do worktree, validacao ampla, live LLM-B
`model-gateway-route-apply-minimal` PASS, correcao dos bloqueios de reattach/ask_user, `ops` rapido com timeouts por
subgate, `runtimeSelector` default `merged` restaurado, runtime-health SQLite indexado, primeiro nucleo de readiness
unica, pending handoffs visiveis em `overview`/`ops` e reconstrucao deste roadmap.

Status: ativo, normativo e continuamente atualizavel.

Escopo de arquitetura: `src/copilot`.

Escopo de validacao solicitado: typecheck strict, lint e testes em `src/copilot` no maior escopo pratico, com execucao
focada durante iteracao e suite ampla apenas nos checkpoints.

Checkpoint de base desta revisao:

- branch: `main`;
- HEAD antes desta revisao: `fb7f27489f78` (`feat(copilot): bind sdk sessions through model gateway ingress`);
- checkpoint publicado desta revisao: `b78c1c816` (`feat(copilot): harden same-session model gateway routing`);
- checkpoint documental de sincronizacao: `12a746fb5` (`docs(copilot): record model gateway checkpoint push`);
- checkpoint live PASS e correcao pos-ask: `1834513ff` (`fix(copilot): preserve route switch ask continuation`);
- checkpoint ops/readiness rapido: `977bf61c6` (`fix(copilot): bound model gateway ops readiness`);
- checkpoint runtime selector merged: `7bbf27fb3` (`fix(copilot): restore merged runtime selector default`);
- checkpoint indices runtime-health: `45e87e31c` (`fix(copilot): index runtime health reads`);
- checkpoint effective route compartilhada: `12e7bdaa1` (`feat(copilot): share model gateway effective route`);
- checkpoint pending handoffs compartilhados: `45f0d6c01` (`feat(copilot): surface pending model gateway handoffs`);
- checkpoint `/health` effective route: `1eb06d588` (`fix(copilot): render health effective model gateway route`);
- worktree continha implementacao extensa ainda nao commitada para same-session route promotion, ingress adaptativo,
  SQLite v13, testes e este roadmap;
- untracked externos e artefatos historicos permanecem no workspace e nao foram incluidos no checkpoint canonico sem
  revisao explicita: `audit_externa_src_copilot`, `src/DOCUMENTACAO/...`, `src/copilot/.ai/rollback/` e
  `workspaces/...`.

## 1. Regras de governanca continua

- [x] Este arquivo e o guia operacional atual para a troca de provider/modelo na mesma sessao.
- [x] Checkboxes so podem ser marcados como concluidos com codigo, teste, live run ou evidencia operacional.
- [x] Trabalho parcial fica em `[ ]`, com nota de progresso quando relevante.
- [x] Live run que prova parte do fluxo, mas falha criterio de harness ou continuacao, e registrado como evidencia
  parcial, nao como aceite final.
- [x] Nova sessao SDK nunca e fallback automatico do Model Gateway.
- [x] `same-session` significa preservar o `sessionId` logico; o handle/runtime pode ser fechado e reconstruido.
- [x] `dialog.turn_end` e o limite canonico para promover reattach deferido por tool-turn ativo.
- [x] Ao mudar codigo relevante, atualizar este roadmap no mesmo incremento antes do commit.

## 2. Modelo mental canonico

### 2.1 Identidades separadas

- Sessao logica SDK: identidade persistente representada por `sessionId`.
- Handle/runtime vivo: objeto em memoria que pode ser encerrado e recriado.
- Binding de transporte/provider: `provider`, `baseUrl`, credencial, wire API e modelo vistos pelo SDK.
- Dialog loop: turno semantico em que a LLM e as tools ainda estao produzindo resposta.
- Nova sessao: nova identidade SDK; permitida somente por comando humano explicito.

### 2.2 Regra operacional

```text
mesmo provider + capability live setModel
  -> trocar modelo no handle vivo

provider/base URL/wire API/binding incompatível
  -> terminar o turno atual
  -> reconstruir transporte/provider
  -> resumeSession(sessionId original, novo binding)
  -> exigir isResumed=true e sessionId retornado === sessionId original

qualquer desvio de identidade
  -> falhar fechado; nunca criar sessao substituta
```

## 3. Situacao atual auditada

### 3.1 Ja esta forte

- [x] Control plane existe em `src/copilot/model-gateway/control-plane/`.
- [x] Tools locais `model_gateway_*` existem para a LLM-B, incluindo overview, operation status, route plan/switch e
  workflow planner.
- [x] `model_gateway_route_switch` aceita plano/aplicacao com idempotency key e retorna `requiresNewSession=false`.
- [x] Quando o tool-turn esta ativo, o route switch e deferido para `deferred_until_turn_boundary` em vez de tentar
  reattach destrutivo no meio da resposta.
- [x] O Agent possui scheduler em `agent/lifecycle/model-gateway-turn-boundary.js`, acionado por `dialog.turn_end`.
- [x] Operacoes deferidas sao classificadas de forma fail-closed por sessao, autorizacao, expiracao, retryability,
  idempotencia e target route.
- [x] A politica `newest intent wins` evita que uma intencao antiga reverta uma rota mais nova.
- [x] SQLite schema v13 materializa evidencias de provider anterior/alvo, binding strategy, wire API, route key e estado.
- [x] Ingress OpenAI Chat Completions existe com registry local, auth local por rota, auth upstream injetada, streaming e
  rollback/CAS.
- [x] A decisao de binding `direct|ingress|blocked` e compartilhada por route plan, route switch, initializer e facade.
- [x] Direct rebind usa evidencia runtime relacional quando disponivel.
- [x] Initializer exige `isResumed === true` e `sessionId` identico para reattach same-session.
- [x] `/restart` e restart real do runtime/handle SDK; `/conversation-restart` e conversa-only.

### 3.2 Evidencia desta auditoria — 2026-06-17

- [x] O roadmap anterior foi lido integralmente antes desta reconstrução.
- [x] `node scripts/model-gateway/run.mjs --list-json` confirmou o runner canonico e o comando `llmBLiveTest`.
- [x] `npx eslint` focado nos modulos de Model Gateway/Agent/tools/testes alterados passou.
- [x] `npx vitest run --config vitest.copilot.config.js` focado em 10 specs de binding, deferred route, ingress,
  initializer e workflow passou: 10 arquivos, 62 testes.
- [x] `npm run typecheck:strict:src.copilot` passou.
- [x] Checkpoint amplo passou apos a reconstrução:
  - `npm run lint:copilot`;
  - `npm run typecheck:strict:src.copilot`;
  - `npm run test:copilot:unit` com 6.819 testes totais, 6.791 aprovados, zero falhas, 28 pendentes e 2.069 suites
    aprovadas;
  - `npx eslint` nos scripts `model-gateway-live-readiness.mjs` e `model-gateway-runtime-selector.mjs`.
- [x] `node scripts/model-gateway/run.mjs sqliteDiagnostics --json` passou e mostrou schema SQLite v13, snapshot ativo,
  130.683 health observations, 102.963 probe results e ultimo live real anterior falhando 5 criterios.
- [x] `node scripts/model-gateway/run.mjs runtimeSelector --json --profile=repo_agent` passou apos correção parcial do
  runner; default operacional agora usa `runtimeSource=file` e JSON compacto.
- [x] `node scripts/model-gateway/run.mjs autoStatus --json` passou apos a mesma correção; decisao retornou
  `manual_intervention` por ausencia de sessao viva, sem nova sessao implicita.
- [x] `node scripts/model-gateway/run.mjs liveReadiness --json` passou com timeout de 40s; readiness ok.
- [x] `node scripts/model-gateway/run.mjs livePlan --json` passou e gerou plano live com readiness ok.
- [x] Live LLM-B `llmBLiveTest --live-scenario=model-gateway-route-apply-minimal` executou tools reais:
  `report_intent`, `read_file_content`, `model_gateway_overview`, `model_gateway_operation_status` e
  `model_gateway_route_switch` plan/apply.
- [x] No live LLM-B, `model_gateway_route_switch` retornou sem travar e os marcadores esperados apareceram no resultado:
  `operation.inspect`, `route.switch`, `deferred_until_turn_boundary`, `same_session`.
- [x] No live LLM-B, a rota viva foi confirmada na mesma sessao para `ollama-cloud/qwen3-coder-next`; o prompt mudou de
  `kilo-auto/free` para `qwen3-coder-next`.
- [x] O live LLM-B inicial terminou `BLOCKED` por `assistant-empty-turn` antes do `ask_user` obrigatorio e final marker,
  expondo um bug real de continuidade pos-reattach.
  Artefato: `artifacts/terminal-live/2026-06-17T23-llmb-route-apply-minimal-codex/summary.md`.
- [x] A causa tecnica do empty turn foi reduzida a dois defeitos:
  - binding de sessao repassava `modelCapabilities.supports.reasoningEffort=true` para
    `ollama-cloud/qwen3-coder-next`, mesmo quando a camada BYOK/SDK-facing indicava `sdkReasoningEffort=false`;
  - o scheduler de turn boundary podia promover o reattach no mesmo `dialog.turn_end` que materializava `ask_user`,
    interrompendo a janela de resposta humana e a continuacao pos-pergunta.
- [x] `src/copilot/model-gateway/session/session-binding.js` agora preserva a decisao SDK-facing de reasoning effort:
  `summary.capabilities.sdkReasoningEffort` e `modelCapabilities.supports.reasoningEffort` so ficam `true` quando o
  legado e o binding adaptado concordam.
- [x] `src/copilot/agent/lifecycle/model-gateway-turn-boundary.js` agora observa `question.pending`,
  `user_input.requested`, `question.answered` e `user_input.completed`, aguarda uma pequena janela de settle e so
  promove reattach depois do `dialog.turn_end` posterior a resposta humana.
- [x] Live LLM-B repetido apos as correcoes terminou `PASS`, com 601 eventos SSE publicos, zero erros, pergunta
  `ask_user`, resposta humana `SIM`, final marker pos-ask e correlacao SSE/export completa.
  Artefato:
  `artifacts/terminal-live/2026-06-18T00-llmb-route-apply-minimal-ask-boundary-fix/summary.md`.
- [x] `/health full` no live corrigido alinhou prompt, BYOK e Gateway em `ollama-cloud/qwen3-coder-next`, com
  raciocinio SDK-facing desligado.
- [x] Checkpoint amplo pos-correcao passou:
  - `npm run typecheck:strict:src.copilot`;
  - `npm run lint:copilot`;
  - `npm run test:copilot:unit` com 6.821 testes totais, 6.793 aprovados, zero falhas, 28 pendentes e 2.071 suites
    aprovadas;
  - artefato `artifacts/test-runs/copilot/2026-06-17T23-44-25-650Z/summary.md`.
- [ ] O export Markdown do live PASS ainda aparece com `timeline=mixed/diverged` e `sync=blocked:diverged-no-overlap`;
  os criterios funcionais passaram, mas a reconciliacao/exportacao historica ainda precisa de melhoria.
- [x] `ops --json --profile=repo_agent` passou dentro de budget operacional curto: caiu de ~26,4s para ~15,7s no banco
  atual e agora tem timeout por subgate com fallback JSON parcial.
- [x] `liveReadiness --json` caiu de ~21,8s para ~12,8s ao trocar a auditoria SQLite de redaction profunda por amostra
  operacional default; `--deep-redaction` preserva a varredura profunda e passou em ~21,7s.
- [x] `ops --json --subcommand-timeout-ms=500` retornou `ok=false` com falhas tipadas por subgate e `commands` parcial
  preservado, em vez de travar o cockpit.
- [x] `runtimeSelector --json --profile=repo_agent` voltou a usar `runtimeSource=merged` por default e passou em ~3,9s;
  `autoStatus --json --profile=repo_agent` passou em ~4,4s e `ops --json --profile=repo_agent` seguiu ok em ~17,1s.
- [x] A leitura SQLite runtime-health recebeu indices operacionais canonicos:
  - `idx_mg_health_observations_latest`;
  - `idx_mg_health_observations_observed`;
  - `idx_mg_runtime_probe_results_latest`.
- [x] No banco atual, `listRuntimeHealthRecords({limit:1500})` caiu para ~27ms e
  `listLatestRuntimeHealthRecords({limit:1500})` ficou em ~0,8s; o selector `merged` segue ok em ~3,9s.
- [x] Primeiro nucleo de readiness unica criado: `buildModelGatewayEffectiveRouteProjection()` agora normaliza a rota
  efetiva em `modelGatewayProjection.effectiveRoute`; `model_gateway_overview`, `/status` e `/now` passam a consumir o
  mesmo label provider/modelo.
- [x] Segundo nucleo de readiness unica criado para handoffs pendentes:
  - `readStorageDiagnostics()` expõe `sdkSessionDeferredHandoffRows` e `latestDeferredSdkSessionHandoff` filtrados por
    `deferred_until_turn_boundary` ainda nao expirado;
  - `ModelGatewayReadControlPlane.inspectOverview()` retorna `data.pendingHandoffs` e
    `data.modelGateway.pendingHandoffs`;
  - `ops --json --profile=repo_agent` retorna `database.sdkSessionDeferredHandoffRows` e
    `database.latestDeferredHandoff`;
  - evidencia operacional atual: `ops` passou em ~17,5s e revelou 4 handoffs diferidos ativos no ledger, incluindo
    registro antigo sem `promotionAuthorized`, reforcando a necessidade da fase rollback/reconcile.
- [x] `/health` compacto/full agora resolve o ativo do catálogo por `modelGatewayProjection.effectiveRoute` primeiro,
  com `active` legado apenas como fallback, alinhando a fonte com `/status` e `/now`.

### 3.3 Bugs/gaps concretos encontrados

- [x] `listLatestRuntimeHealthRecords()` e `listRuntimeHealthRecords()` agora possuem indices de leitura operacional para
  evitar regressao imediata em bancos com 100k+ linhas de runtime health/probes.
- [ ] `model-gateway-live-readiness` agora ignora runtime-health SQLite por default para manter readiness praticavel; o
  modo profundo fica opt-in em `--sqlite-runtime-health`.
- [x] `model-gateway-runtime-selector` voltou para `runtimeSource=merged` por default apos prova operacional com limite
  SQLite de runtime-health.
- [x] `ops` tem modo rapido default com timeout por subgate (`--subcommand-timeout-ms`, default 20s) e falha parcial
  estruturada.
- [x] A continuacao apos route switch real nao deve cair em BYOK provider failure/empty turn antes de `ask_user` quando a
  rota alvo nao suporta reasoning effort SDK-facing e a promocao respeita a janela humana pos-ask.
- [ ] Adicionar regressao focada para o export `timeline=mixed/diverged` do live PASS, distinguindo divergencia
  historica inofensiva de perda real de transcript.
- [ ] Eventos de `model-gateway.deferred-route-promotion` podem aparecer repetidamente no mesmo intervalo; falta metrica
  e coalescing/telemetria explicita para distinguir "no-op scan" de promocao real.
- [x] `/health full` deixou de divergir no live route apply minimal corrigido; a lacuna residual e tornar essa visao
  derivada de uma readiness unica compartilhada por todas as superficies.
- [x] O primeiro campo compartilhado dessa readiness unica e `effectiveRoute`, cobrindo provider/modelo/profile/source
  efetivos entre control-plane e terminal.
- [ ] `terminal/commands/byok.js` segue monolitico e concentra parsing, use-cases e rendering.
- [ ] Profile management ainda e flexivel demais e sem mutacao duravel transacional/rollback.
- [ ] Golden path vanilla GitHub Copilot SDK ainda nao tem cobertura explicita suficiente para provar ausencia de
  regressao quando o gateway esta desligado.

## 4. Situacao ideal proposta

### 4.1 Superficie unica

Operador humano, terminal, tools, boot SDK, server routes e LLM-B devem consumir o mesmo read model:

```text
catalogo + perfis + secrets redigidos + runtime health + rota ativa + sessao viva + handoffs
  -> ModelGatewayReadiness
  -> overview / tools / byok / now / health / activity / ops / live-readiness
```

### 4.2 Troca natural de provider/modelo

- Planejar a troca com rationale, binding decision e riscos.
- Aplicar com idempotency key e `confirm=true`.
- Se seguro, reattach imediato preservando `sessionId`.
- Se tool-turn ativo, retornar `accepted_for_turn_boundary` e encerrar o turno.
- O Agent promove no `dialog.turn_end`.
- Proximo turno verifica por `operation_status` e readiness unica.
- Fallback automatico nunca cria sessao nova.

### 4.3 Observabilidade sem segredos

- Secrets nunca entram em transcript, Markdown, SSE, ledgers ou URLs.
- `sessionId`, provider/model, route key, operation id e idempotency key sao rastreaveis, mas redigidos quando necessario.
- Health distingue estrutural, operacional, live, freshness, mismatch e pending handoffs.
- Cockpits exibem a mesma rota efetiva e a mesma sessao efetiva.

## 5. Roadmap executavel

### Faixa 0 — Checkpoint, sincronizacao e higiene

- [x] Ler integralmente este arquivo antes de editar.
- [x] Auditar worktree e arquivos associados principais.
- [x] Executar LLM-B live pelo runner canonico.
- [x] Recriar este roadmap com estado atual, situacao ideal e fases booleanas.
- [x] Rodar validacao ampla `src/copilot` antes do commit de checkpoint.
- [x] Confirmar quais untracked externos pertencem ao commit e quais devem permanecer fora.
- [x] Commitar e pushar checkpoint documental/corretivo para `main`.
- [x] Apos push, atualizar este roadmap com commit/hash e estado limpo do codigo canonico.

### Faixa A — Same-session route switch e promocao pos-turno

#### A.1 Contrato e ledgers

- [x] Persistir operacao `same-session-route-switch:*` com estado, sessionId, idempotency key e target route.
- [x] Classificar operacao deferida por autorizacao, expiracao, sessao, retryability e integridade da rota.
- [x] Supersede intencoes antigas da mesma sessao.
- [x] Expor estados deferidos em `model_gateway_operation_status`.
- [ ] Adicionar teste end-to-end unico para cadeia
  `deferred_until_turn_boundary -> reattach_requested -> reattached -> verified -> committed`.
- [ ] Expor transicoes completas no cockpit humano sem depender de leitura JSON crua.

#### A.2 Scheduler Agent-owned

- [x] Mover promocao automatica para Agent em `dialog.turn_end`.
- [x] Evitar reattach durante tool-turn ativo.
- [x] Revalidar sessao viva exata antes da promocao.
- [x] Preservar `requiresNewSession=false`.
- [ ] Reduzir eventos repetidos/no-op de background promotion ou classifica-los explicitamente.
- [ ] Adicionar metricas por `promoted`, `skipped`, `expired`, `superseded`, `policy_denied`, `error`.
- [x] Bloquear promocao durante `ask_user` pendente ou imediatamente apos resposta humana ate o proximo
  `dialog.turn_end`, preservando a continuacao do SDK.

#### A.3 UX LLM-B

- [x] Tool result instrui a LLM-B a encerrar o turno quando `automaticContinuation.armed=true`.
- [x] Workflow plan marca verificacao pos-turno como `sameTurnExecutionForbidden`.
- [x] Live LLM-B continua para `ask_user` depois do reattach sem cair em empty turn no cenario
  `model-gateway-route-apply-minimal`.
- [ ] Quando provider falha logo apos reattach, terminal deve oferecer fallback/reconcile sem quebrar o protocolo do
  harness.
- [ ] `/activity`, `/tools diag` e `/byok` devem listar handoffs diferidos/promoviveis como secao propria.

### Faixa B — Binding adaptativo direct/ingress

#### B.1 Decisao canonica

- [x] Implementar `ModelGatewayBindingStrategyDecision` em `ingress/binding-strategy.js`.
- [x] Separar confiabilidade de rebind direto, representabilidade de `ProviderConfig` e elegibilidade do ingress.
- [x] Bloquear ingress automatico para Responses, Anthropic Messages e Azure nativo.
- [x] Preservar ingress quando sessao atual ja esta em ingress e target e elegivel.
- [ ] Incluir profile materializado, secret refs redigidas e health policy normalizada no contrato de ingress route.

#### B.2 Registry e rollback

- [x] Registry ingress tem route local key aleatoria, auth segura, revision monotonic, CAS e snapshot.
- [x] Initializer restaura snapshot anterior quando preparacao do ingress falha.
- [x] Facade verifica commit/rollback ingress e sinaliza reconciliationRequired.
- [ ] Smoke local acoplado ao lifecycle SDK sem provider real.
- [ ] Smoke real de streaming, erro OpenAI-compatible e `ask_user` apos ingress.

### Faixa C — Runner, readiness e cockpits

#### C.1 Runners operacionais

- [x] `runtimeSelector --json --profile=repo_agent` volta a responder com JSON compacto.
- [x] `autoStatus --json` volta a responder.
- [x] `liveReadiness --json` passa em ~21s com SQLite runtime-health profundo desativado por default.
- [x] `livePlan --json` passa e registra readiness ok.
- [x] `ops --json` responde em budget curto no banco atual, com timeout por subgate e fallback parcial.
- [x] `liveReadiness --json` usa auditoria SQLite de redaction amostrada por default e `--deep-redaction` para auditoria
  operacional profunda.
- [x] `runtimeSelector --runtime-source=merged|sqlite` voltou a ser praticavel; `merged` e novamente o default.
- [x] `listLatestRuntimeHealthRecords` e `listRuntimeHealthRecords` possuem indices canonicos para 100k+ linhas.

#### C.2 Readiness unica

- [x] Definir primeiro nucleo de schema compartilhado: `effectiveRoute` com provider/modelo/profile/source/label
  canonicos.
- [x] Alimentar `model_gateway_overview` com `effectiveRoute`.
- [ ] Alimentar `/byok`, `/session sdk`, `/health`, `/activity` e `ops` com o mesmo schema completo.
- [x] Alimentar `/status` e `/now` com `modelGatewayProjection.effectiveRoute` quando disponivel.
- [x] Alimentar `/health` com `modelGatewayProjection.effectiveRoute` quando disponivel.
- [x] Alimentar `overview`/`model_gateway_overview` e `ops` com `pendingHandoffs.active/latest` a partir do ledger
  SQLite.
- [ ] Incluir rota efetiva, binding efetivo, sessao logica, provider real, provider SDK-facing, pending handoffs,
  freshness e mismatch.
- [ ] Remover divergencia cockpit: prompt em `qwen3-coder-next` versus `/health full` ainda citando `kilo-auto/free`.

### Faixa D — Live LLM-B e harness end-to-end

#### D.1 Cenario route apply minimal

- [x] Executar `llmBLiveTest --live-scenario=model-gateway-route-apply-minimal`.
- [x] Provar chamadas reais de tools de leitura e Model Gateway.
- [x] Provar `route_switch` plan/apply sem travar.
- [x] Provar deferimento same-session e mudanca para `ollama-cloud/qwen3-coder-next`.
- [x] Fazer o mesmo cenario terminar PASS com `ask_user` e final marker.
- [x] Capturar e corrigir a falha BYOK pos-reattach causada por reasoning effort indevido e promocao na janela humana.
- [ ] Adicionar live rollback induzido.
- [ ] Adicionar live reconcile pos-mismatch.

#### D.2 Export/SSE

- [x] Corrigir `export-sse-correlation` quando ask/final ocorrem apos reattach no cenario route apply minimal.
- [x] Garantir export Markdown com pergunta e resposta humana canonicas no cenario route apply minimal.
- [ ] Garantir `no-prompt-double-render` sem mascarar prompts legitimos.
- [ ] Classificar BYOK usage real sem falso Premium Request.
- [ ] Investigar `timeline=mixed/diverged`/`sync=blocked:diverged-no-overlap` no export mesmo quando SSE/export
  correlacionam ask, answer e postAsk corretamente.

### Faixa E — Perfis BYOK duraveis

- [ ] Decidir store duravel canonico: `.env.local` controlado, JSON dedicado ou SQLite.
- [ ] `profile_manage` deve canonicalizar shape flexivel antes de qualquer escrita.
- [ ] `plan` deve produzir diff redigido.
- [ ] `apply` deve ser atomico e idempotente.
- [ ] Implementar rollback de mutacao de perfil.
- [ ] Bloquear refs arbitrarias fora da allowlist por provider, preservando leitura de legado.
- [ ] Expor auditoria de mutacao em `operation_status`.

### Faixa F — Decompor `/byok`

- [ ] Mapear todos os casos ainda implementados em `terminal/commands/byok.js`.
- [ ] Extrair parser puro.
- [ ] Extrair renderers de status, provider, health, probes e recommendation.
- [ ] Extrair use-cases que chamam control plane: profile, model, provider, probe, refresh, recommend.
- [ ] Garantir que terminal e tools chamam servicos comuns.
- [ ] Preservar aliases PT-BR/EN humanos sem tornar texto humano API primaria.

### Faixa G — Golden path vanilla SDK

- [ ] Golden test `createSession` sem BYOK/gateway.
- [ ] Golden test `resumeSession` sem BYOK/gateway.
- [ ] Provar que `onListModels` vanilla nao e sequestrado quando gateway esta inativo.
- [ ] Provar que BYOK/gateway nao degrada sessao nativa.
- [ ] Cobrir restart/resume/new com e sem next boot selection.

### Faixa H — Aceite final

- [x] `src/copilot` typecheck strict, lint e unit suite ampla passam no checkpoint final.
- [x] Live LLM-B route switch + ask_user + final marker passa ponta a ponta.
- [ ] Live rollback e reconcile passam.
- [ ] Cockpits concordam sobre provider/modelo/sessao.
- [ ] Runners read-only respondem dentro de budget documentado.
- [ ] Profile management e duravel, auditavel e redigido.
- [x] Branch `main` fica commitada, pushada e sincronizada.

## 6. Ordem recomendada a partir daqui

1. Implementar readiness unica e alinhar `/health`, `/now`, `/byok`, `/activity`, `overview` e `ops`.
2. Investigar e corrigir a reconciliacao `timeline=mixed/diverged` do export no live PASS.
3. Adicionar testes end-to-end de ledger transicional e metricas de promocao.
4. Rodar live rollback/reconcile.
5. Decompor `/byok`, finalizar perfis duraveis e golden path vanilla SDK.

## 7. Evidencias locais importantes

- `scripts/model-gateway/run.mjs --list-json`: runner canonico disponivel.
- `scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`: harness LLM-B canonico.
- `artifacts/terminal-live/2026-06-17T23-llmb-route-apply-minimal-codex/summary.md`: live desta auditoria,
  `BLOCKED` por `assistant-empty-turn` apos provar route switch.
- `artifacts/terminal-live/2026-06-18T00-llmb-route-apply-minimal-ask-boundary-fix/summary.md`: live corrigido,
  `PASS` ponta a ponta com route switch same-session, `ask_user`, resposta `SIM`, final marker e correlacao SSE/export.
- `node scripts/model-gateway/run.mjs liveRuns --json`: ledger SQLite registra o live como
  `terminal-live:2026-06-17T23-19-45-585Z:canonical_full_turn_model-gateway-route-apply-minimal`.
- Validacao focada desta auditoria:
  - `npx eslint ...` nos modulos alterados de Model Gateway/Agent/tools/testes;
  - `npx vitest run --config vitest.copilot.config.js ...` com 10 specs e 62 testes;
  - `npm run typecheck:strict:src.copilot`.
- Validacao focada das correcoes pos-live:
  - `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/agent/test_model_gateway_turn_boundary.spec.js tests/unit/copilot/model-gateway/test_session_binding.spec.js tests/unit/copilot/test_initializer_session_fs.spec.js tests/unit/copilot/terminal/byok/test_deferred_route_promotion.spec.js tests/unit/copilot/terminal/byok/test_live_model_switch.spec.js --reporter=dot`;
  - `npx eslint src/copilot/agent/lifecycle/model-gateway-turn-boundary.js tests/unit/copilot/agent/test_model_gateway_turn_boundary.spec.js src/copilot/model-gateway/session/session-binding.js tests/unit/copilot/model-gateway/test_session_binding.spec.js`.
- Validacao ampla das correcoes pos-live:
  - `npm run typecheck:strict:src.copilot`;
  - `npm run lint:copilot`;
  - `npm run test:copilot:unit`, resumo em
    `artifacts/test-runs/copilot/2026-06-17T23-44-25-650Z/summary.md`.
- Evidencia operacional da correcao de runners:
  - `node scripts/model-gateway/run.mjs liveReadiness --json` passou em ~12,8s com
    `redaction.sqlite.maxRowsPerTable=25`;
  - `node scripts/model-gateway/run.mjs liveReadiness --json --deep-redaction` passou em ~21,7s com
    `redaction.sqlite.maxRowsPerTable=100000`;
  - `node scripts/model-gateway/run.mjs ops --json --profile=repo_agent` passou em ~15,7s, com timings por subgate;
  - `node scripts/model-gateway/run.mjs ops --json --profile=repo_agent --subcommand-timeout-ms=500` retornou JSON
    parcial com falhas `timedOut=true`.
- Evidencia operacional da restauracao `runtimeSource=merged`:
  - `node scripts/model-gateway/run.mjs runtimeSelector --json --profile=repo_agent` passou em ~3,9s com
    `runtimeSource=merged`;
  - `node scripts/model-gateway/run.mjs autoStatus --json --profile=repo_agent` passou em ~4,4s;
  - `node scripts/model-gateway/run.mjs ops --json --profile=repo_agent` permaneceu ok em ~17,1s.
- Evidencia operacional dos indices runtime-health:
  - `listRuntimeHealthRecords({limit:1500})` passou em ~27ms com
    `idx_mg_health_observations_observed`;
  - `listLatestRuntimeHealthRecords({limit:1500})` passou em ~0,8s com
    `idx_mg_health_observations_latest` e `idx_mg_runtime_probe_results_latest`;
  - teste focado `test_model_gateway_contracts.spec.js -t "latest-runtime-health indexes|SQLite catalog stores"`
    passou.
- Evidencia do primeiro nucleo de readiness unica:
  - `buildModelGatewayOperatorProjection()` expõe `effectiveRoute`;
  - `ModelGatewayReadControlPlane.inspectOverview()` retorna `data.effectiveRoute` e
    `data.modelGateway.effectiveRoute`;
  - `/status` e `/now` renderizam o ativo do catálogo a partir de `effectiveRoute` quando disponivel;
  - testes focados `test_model_gateway_contracts.spec.js -t "operator projection|overview readiness"` e
    `test_commands_session.spec.js -t "cmdStatus|cmdNow"` passaram.
- Evidencia do segundo nucleo de readiness unica:
  - `readStorageDiagnostics()` expõe handoffs diferidos ativos e ultimo handoff diferido com rota, sessao, provider e
    modelo a partir de colunas normalizadas, sem depender de payload JSON cru;
  - `ModelGatewayReadControlPlane.inspectOverview()` e `ops --json` consomem o mesmo sinal `pendingHandoffs`;
  - testes focados:
    `test_model_gateway_contracts.spec.js -t "SQLite catalog store persists"` e
    `test_model_gateway_contracts.spec.js -t "exposes the same effective route projection"` passaram;
  - validacao escopada:
    `npm run typecheck:strict:src.copilot`,
    `npx eslint src/copilot/model-gateway/catalog/sqlite-catalog-store.js src/copilot/model-gateway/control-plane/read-model.js scripts/model-gateway/commands/model-gateway-ops.mjs tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`,
    `node scripts/model-gateway/run.mjs ops --json --profile=repo_agent`.
- Evidencia de alinhamento `/health` com `effectiveRoute`:
  - `src/copilot/terminal/commands/diagnose.js` usa `effectiveRoute` antes de `active`;
  - teste focado `test_commands_diagnose.spec.js -t "health|Gateway|diagnóstico"` passou;
  - validacao escopada: `npx eslint src/copilot/terminal/commands/diagnose.js tests/unit/copilot/terminal/test_commands_diagnose.spec.js`
    e `npm run typecheck:strict:src.copilot`.
