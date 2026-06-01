# Canonical Model Gateway Terminal Auto Runtime Roadmap - 2026-06-01

Este arquivo passa a ser o guia operacional para levar o `src/copilot/model-gateway` do estado de catalogo, selecao
pre-runtime e automacao parcial para um sistema funcional no terminal, capaz de escolher, trocar, replanejar e registrar
modelos BYOK de forma automatica, auditavel e segura.

O guia anterior continua como historico:

- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_BYOK_NEXT_GUIDE_2026-05-26.md`
- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_AUTO_RUNTIME_OPERABILITY_ROADMAP_2026-06-01.md`

Playbook operacional ativo para humano/LLM:

- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATOR_RUNTIME_PLAYBOOK_2026-06-01.md`
- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATOR_AND_CODE_GUIDE_2026-06-01.md`

## 1. Escopo

- O foco primario e `src/copilot/model-gateway/`.
- O foco de integracao e `src/copilot/terminal/`.
- Scripts operacionais vivem somente em `scripts/model-gateway/`.
- O catalogo canonico de metadados nao deve ser corrompido por runtime, quotas ou falhas temporarias.
- Runtime health, route decisions, automation decisions, effect applications, recovery attempts, SDK handoffs,
  confirmations e live scenario runs sao overlays operacionais.
- Ollama/local/private e suportado, mas nunca selecionado por default sem pedido explicito do operador.
- Validadores devem ser focados nos arquivos alterados, com suites amplas apenas quando realmente necessario.

## 2. Situacao Atual

### 2.1 Banco e metadados

- [x] Catalogo canonico JSON existe.
- [x] SQLite operacional existe.
- [x] Schema SQLite esta na versao 10.
- [x] Catalog rows, route decisions, runtime health e automation decisions estao visiveis.
- [x] Automation effect applications estao persistidas.
- [x] SDK session handoffs estao persistidos.
- [x] Retention ja separa camadas operacionais.
- [x] Existe tabela/fluxo para policy snapshots por decision.
- [x] Existe tabela/fluxo para SDK binding confirmations.
- [x] Existe tabela/fluxo para post-turn recovery attempts.
- [x] Existe tabela/fluxo para live test scenario runs.

### 2.2 Scripts canonicos

- [x] `scripts/model-gateway/index.mjs` e o barril unico.
- [x] Runner LLM-B vive em `scripts/model-gateway/`.
- [x] Wrapper legado em `scripts/copilot/` foi removido.
- [x] `model-gateway:ops` existe.
- [x] `model-gateway:auto:status` existe.
- [x] `model-gateway:auto:ready` existe.
- [x] `model-gateway:auto:doctor` existe.
- [x] `Makefile` tem aliases para os comandos auto.
- [x] Inventario canonico lista package, make e terminal.
- [x] `model-gateway:auto:explain`.
- [x] `model-gateway:auto:scenarios`.
- [x] `model-gateway:auto:handoffs`.
- [x] `model-gateway:auto:confirmations`.
- [x] `model-gateway:auto:recoveries`.
- [x] `model-gateway:live:runs`.

### 2.3 Terminal

- [x] `/byok auto status` existe.
- [x] `/byok auto record` existe.
- [x] `/byok auto apply` existe.
- [x] `/byok auto history` existe.
- [x] `/byok auto on` persiste policy.
- [x] `/byok auto off` desliga policy persistente.
- [x] `/byok auto policy` mostra policy efetiva.
- [x] Pre-turn auto roda quando policy esta ligada.
- [x] Pre-turn persiste decision, effect applications e handoffs.
- [x] `prepare_new_sdk_session` agenda novo boot SDK quando autorizado.
- [x] `/byok auto explain`.
- [x] `/byok auto switch`.
- [x] `/byok auto doctor` mostra readiness, policy, rota e ledgers no cockpit terminal.
- [x] `/byok auto handoffs`.
- [x] `/byok auto confirmations`.
- [x] `/byok auto recoveries`.
- [x] `/byok auto recovery-fixture`.
- [x] Post-turn controller automatico roda quando a policy esta ligada.

### 2.4 SDK boundary

- [x] O terminal diferencia binding BYOK preparado e vivo.
- [x] `set_live_model` so e aplicado dentro da mesma boundary quando policy autoriza.
- [x] Troca de provider/perfil gera handoff de nova sessao.
- [x] Eventos `session.model_changed` sao observados pelo terminal.
- [x] `session.model_changed` tenta correlacionar com handoff pendente.
- [x] Confirmation do modelo vivo e persistida.
- [x] Mismatch inicial e persistido como status operacional.
- [x] Terminal mostra linha curta para modelo vivo atualizado, boot SDK preparado e detalhe pos-falha.

### 2.5 Falhas, quotas e recovery

- [x] Falha BYOK e classificada.
- [x] Runtime health e gravado em memoria e pode ser espelhado no SQLite.
- [x] Cooldown e reset window entram na selecao.
- [x] O erro BYOK nao deve consumir Premium Request do SDK.
- [x] Pos-falha executa controller automatico quando a policy esta ligada.
- [x] Recovery decision e persistida via automation decision post-turn.
- [x] Replanejamento pos-falha bloqueia repeticao imediata da mesma rota quando ela acabou de falhar.
- [x] Recovery pos-falha separa escopo conta/key de escopo modelo/rota.
- [x] Cockpit auto expõe `nextRetry`/cooldown/reset quando a rota aguarda nova tentativa.

## 3. Arquitetura Ideal

### 3.1 Fluxo macro

```text
provider metadata/importers
    -> catalogo canonico
    -> overlays account/key/quota/runtime health
    -> selecao pre-runtime
    -> runtime selector plan
    -> automation decision
    -> controller step
    -> terminal effect executor
    -> SQLite operational ledger
    -> SDK event confirmation
    -> post-turn recovery loop
```

### 3.2 Separacao de responsabilidades

- `model-gateway/catalog`: metadados canonicos e SQLite.
- `model-gateway/routing`: selecao sem mutacao de terminal.
- `model-gateway/automation`: decisoes e efeitos puros.
- `terminal/byok/gateway-auto`: adaptador terminal, executor e persistencia operacional.
- `terminal/dialog/engine`: pontos pre-turn e post-turn.
- `terminal/events/sdk-session-events`: confirmacoes vindas do SDK.
- `scripts/model-gateway`: cockpit e automacao read-only ou explicitamente mutante.

### 3.3 Invariantes

- [ ] Nenhum runtime test altera metadados canonicos.
- [ ] Nenhum segredo bruto e persistido em docs, logs ou SQLite.
- [ ] Nenhum provider externo e chamado por comandos read-only.
- [ ] Policy desligada por default.
- [ ] Ollama/local/private exige opt-in explicito.
- [ ] Falha temporaria vira overlay operacional, nao exclusao do catalogo.
- [ ] Falha dura de acesso vira overlay operacional com freshness.
- [ ] Todo efeito aplicado tem decision id.
- [ ] Todo handoff tem decision id.
- [ ] Toda confirmation deve tentar encontrar handoff/effect correlato.

## 4. Estados Operacionais

- [x] `metadata_selected`
- [x] `pre_runtime_selected`
- [x] `runtime_plan_ready`
- [x] `automation_decided`
- [x] `effect_application_recorded`
- [x] `sdk_handoff_recorded`
- [x] `policy_snapshot_recorded`
- [ ] `live_same_boundary_applied`
- [ ] `next_session_boot_scheduled`
- [ ] `sdk_boot_started`
- [x] `sdk_binding_confirmed`
- [x] `model_changed_confirmed`
- [ ] `turn_started`
- [ ] `turn_succeeded`
- [ ] `turn_failed_retriable`
- [ ] `turn_failed_hard`
- [x] `post_turn_recovery_decided`
- [x] `post_turn_recovery_applied`
- [ ] `manual_required`

## 5. Fluxo Do Operador

### 5.1 Antes do uso

1. `npm run model-gateway:auto:ready`
2. `npm run model-gateway:auto:doctor`
3. `/byok auto policy`
4. `/byok auto on profile:repo_agent allow-live-set-model`
5. opcional: `/byok auto on profile:repo_agent allow-live-set-model allow-new-session`

### 5.2 Durante o turno

1. Engine le policy efetiva.
2. Se desligada, nao executa automacao.
3. Se ligada, pre-turn gera runtime selector plan.
4. Decision vira controller step.
5. Executor aplica somente efeitos autorizados.
6. SQLite grava decision, effect applications, recovery attempts e handoffs.
7. Turno roda.
8. Se falhar, post-turn classifica e grava health.
9. Post-turn replaneja com overlays atualizados.
10. Post-turn aplica efeito autorizado ou reporta blocker.

### 5.3 Apos eventos SDK

1. `session.model_changed` atualiza projecao viva.
2. Confirmation procura handoff/effect pendente.
3. Confirmation grava modelo confirmado.
4. Divergencia grava mismatch.
5. Cockpit mostra prepared/live/confirmed.

## 6. Roadmap

Todos os checkboxes sao booleanos. Nao usar estado parcial.

### Faixa A - Scripts E Cockpit Read-Only

- [x] A.1 Barril unico em `scripts/model-gateway/index.mjs`.
- [x] A.2 `model-gateway:auto:ready`.
- [x] A.3 `model-gateway:auto:doctor`.
- [x] A.4 Package scripts para ready/doctor.
- [x] A.5 Makefile para ready/doctor.
- [x] A.6 README de scripts atualizado.
- [x] A.7 `model-gateway:auto:explain`.
- [x] A.8 `model-gateway:auto:handoffs`.
- [x] A.9 `model-gateway:auto:confirmations`.
- [x] A.10 `model-gateway:auto:recoveries`.
- [x] A.11 `model-gateway:auto:scenarios`.

### Faixa B - Policy Explicavel

- [x] B.1 Defaults seguros.
- [x] B.2 Policy file.
- [x] B.3 Env override.
- [x] B.4 `/byok auto on`.
- [x] B.5 `/byok auto off`.
- [x] B.6 `/byok auto policy`.
- [x] B.7 Policy snapshot por automation decision.
- [x] B.8 Fonte por campo no JSON do doctor.
- [x] B.9 Validacao de policy invalida.
- [x] B.10 Modo auto full documentado com limites.

### Faixa C - Ledger Operacional

- [x] C.1 Automation decisions.
- [x] C.2 Effect applications.
- [x] C.3 SDK handoffs.
- [x] C.4 Policy snapshots.
- [x] C.5 SDK confirmations.
- [x] C.6 Recovery attempts.
- [x] C.7 Live scenario runs.
- [x] C.8 Retention para novas tabelas.
- [x] C.9 Diagnostics para novas tabelas.
- [ ] C.10 Redaction audit para novas tabelas.

### Faixa D - Pre-Turn Auto

- [x] D.1 Policy gate.
- [x] D.2 Runtime selector plan.
- [x] D.3 Controller step.
- [x] D.4 Effects executor.
- [x] D.5 Persistence.
- [x] D.6 Activity log curto.
- [x] D.7 Linha terminal explicita quando modelo e trocado.
- [x] D.8 Linha terminal explicita quando handoff e preparado.
- [ ] D.9 Anti-loop pre-turn para mesma decision.
- [ ] D.10 Teste fixture de pre-turn.

### Faixa E - Post-Turn Recovery

- [x] E.1 Classificacao de falha BYOK.
- [x] E.2 Runtime health local.
- [x] E.3 Hint manual.
- [x] E.4 Controller post-turn automatico.
- [x] E.5 Replanejamento com health recem-gravado.
- [x] E.6 Persistir recovery decision.
- [x] E.7 Persistir recovery effect application.
- [x] E.8 Evitar loop no mesmo provider/modelo.
- [x] E.9 Mostrar acao pos-falha no terminal.
- [ ] E.10 Teste fixture de falha e fallback.

### Faixa F - SDK Session Confirmation

- [x] F.1 Evento `session.model_changed` observado.
- [x] F.2 Projecao viva e atualizada.
- [x] F.3 Correlacionar event com handoff pendente quando possivel.
- [x] F.4 Persistir confirmation.
- [x] F.5 Persistir mismatch.
- [ ] F.6 Cockpit prepared/live/confirmed.
- [x] F.7 Teste unitario de confirmation.
- [ ] F.8 Teste fixture com model_changed.
- [ ] F.9 Auditar compatibilidade com SDK quota snapshots.
- [ ] F.10 Garantir BYOK quota != SDK quota.

### Faixa G - Terminal UX

- [x] G.1 `/byok auto status`.
- [x] G.2 `/byok auto record`.
- [x] G.3 `/byok auto apply`.
- [x] G.4 `/byok auto history`.
- [x] G.5 `/byok auto policy`.
- [x] G.6 `/byok auto doctor`.
- [x] G.7 `/byok auto explain`.
- [x] G.8 `/byok auto switch`.
- [x] G.9 `/byok auto handoffs`.
- [x] G.10 `/byok auto confirmations`.
- [x] G.11 `/byok auto recoveries`.

### Faixa H - Runtime Selector Real

- [x] H.1 Runtime selector dry-run.
- [x] H.2 Runtime selector com policy.
- [x] H.3 Selector usa runtime health observado.
- [ ] H.4 Selector recebe exclusoes temporarias do post-turn.
- [ ] H.5 Selector recebe exclusoes account-wide.
- [ ] H.6 Selector preserva fallback profiles ordenados.
- [ ] H.7 Selector explica cada descarte.
- [ ] H.8 Selector gera handoff env completo.
- [ ] H.9 Selector nao escolhe Ollama por default.
- [ ] H.10 Selector passa live fixture.

### Faixa I - Account/Key/Quota

- [x] I.1 Provider health records.
- [x] I.2 Cooldowns.
- [x] I.3 Reset windows.
- [x] I.4 Account overlays derivados de health.
- [ ] I.5 Overlay "key sem acesso ao modelo".
- [ ] I.6 Overlay "quota temporaria esgotada".
- [ ] I.7 Overlay "credito duro esgotado".
- [ ] I.8 Freshness por overlay.
- [ ] I.9 Cockpit de limites.
- [ ] I.10 Policy para account-wide failures.

### Faixa J - Local/Ollama

- [x] J.1 Local provider existe no catalogo.
- [x] J.2 Guidance de opt-in local.
- [x] J.3 Seletores bloqueiam local por default.
- [ ] J.4 Auto doctor mostra local privado bloqueado por default.
- [ ] J.5 Auto switch exige pedido explicito para local.
- [ ] J.6 Tests de default remoto.
- [ ] J.7 Tests de opt-in local.
- [ ] J.8 Live readiness nao falha se Ollama nao esta rodando.
- [ ] J.9 Runtime selector nao tenta probe local sem opt-in.
- [ ] J.10 Documentar fluxo local.

### Faixa K - Live Tests LLM-B

- [x] K.1 Runner em `scripts/model-gateway`.
- [x] K.2 Fixture BYOK.
- [x] K.3 BYOK real com flags explicitas.
- [x] K.4 Runtime selector options no runner.
- [x] K.5 Auto cockpit no-PR live.
- [ ] K.6 Scenario pre-turn auto fixture.
- [ ] K.7 Scenario post-turn fallback fixture.
- [ ] K.8 Scenario model_changed confirmation fixture.
- [ ] K.9 Scenario handoff new session fixture.
- [ ] K.10 Scenario BYOK real no-pr.
- [ ] K.11 Relatorio de chancela.

### Faixa L - Chancela Funcional

- [x] L.1 `model-gateway:auto:ready` passa.
- [x] L.2 `model-gateway:auto:doctor` passa.
- [x] L.3 `/byok auto doctor` passa.
- [ ] L.4 Pre-turn fixture passa.
- [ ] L.5 Post-turn fixture passa.
- [ ] L.6 Confirmation fixture passa.
- [x] L.7 Live no-pr passa.
- [ ] L.8 Live real com fallback passa.
- [ ] L.9 Relatorio final gerado.
- [ ] L.10 Operador tem comando unico de rotina.

## 7. Proxima Sequencia De Implementacao

1. [x] Implementar tabela/records de policy snapshot por decision.
2. [x] Implementar tabela/records de SDK confirmation.
3. [x] Implementar `/byok auto doctor` reaproveitando `model-gateway:auto:doctor`.
4. [x] Implementar post-turn controller real apos falha BYOK.
5. [x] Persistir recovery attempts como decisions/effects post-turn e ledger dedicado.
6. [x] Correlacionar `session.model_changed` com handoffs.
7. [ ] Expandir live fixture de auto.
8. [x] Rodar live fixture.
9. [ ] Corrigir bugs descobertos.
10. [ ] Rodar live real apenas quando os gates estiverem verdes.

## 8. Definicao De Pronto

- [x] Catalogo e SQLite estao saudaveis.
- [x] Auto ready passa.
- [x] Auto doctor passa.
- [x] Terminal doctor passa.
- [ ] Pre-turn troca modelo quando autorizado.
- [ ] Pre-turn prepara nova sessao quando autorizado.
- [x] Post-turn replaneja apos falha.
- [ ] Health evita repetir rota quebrada.
- [x] SDK confirma modelo efetivo.
- [ ] Cockpit mostra prepared/live/confirmed.
- [x] Live fixture passa.
- [ ] Live real passa.
- [ ] Nao ha vazamento de segredo em logs, docs ou SQLite.

## 9. Evidencia Live Atual

### 9.1 Control no-PR

- [x] Rodado em 2026-06-01.
- [x] Comando: `npm run model-gateway:live:llm-b -- --no-pr --timeout-ms=180000`.
- [x] Artefato: `artifacts/terminal-live/2026-06-01T22-00-26-580Z/summary.md`.
- [x] Resultado: PASS.
- [x] Terminal error tracker: 0.
- [x] Sem turno explicito de modelo.
- [x] Observacao: `quota.warning` SDK pode aparecer como telemetria lateral, sem equivaler a quota BYOK.

### 9.2 BYOK fixture no-PR

- [x] Rodado em 2026-06-01.
- [x] Comando: `npm run model-gateway:live:llm-b -- --byok-probe --byok-fixture --no-pr --timeout-ms=240000`.
- [x] Artefato: `artifacts/terminal-live/2026-06-01T22-02-19-576Z/summary.md`.
- [x] Resultado: PASS.
- [x] Terminal error tracker: 0.
- [x] Criterios PASS: 31.
- [x] `/byok use codex-fixture` ativou perfil fixture no processo.
- [x] `/byok models refresh` descobriu catalogo fixture.
- [x] `/byok model fixture/model-b` trocou modelo preparado.
- [x] `/byok provider openai-compatible fixture/model-c <baseUrl>` trocou provider/model/baseUrl preparado.
- [x] `/byok use sdk` retornou para modo SDK.
- [x] Bearer token fixture nao vazou.

### 9.3 Auto cockpit no-PR

- [x] Rodado em 2026-06-01.
- [x] Comando: `npm run model-gateway:live:auto-probe`.
- [x] Artefato inicial: `artifacts/terminal-live/2026-06-01T22-10-32-162Z/summary.md`.
- [x] Artefato com ledger SQLite final: `artifacts/terminal-live/2026-06-01T22-57-46-528Z/summary.md`.
- [x] Artefato com recovery fixture final: `artifacts/terminal-live/2026-06-01T23-09-22-745Z/summary.md`.
- [x] Resultado: PASS.
- [x] Terminal error tracker: 0.
- [x] Sem turno explicito de modelo.
- [x] `/byok gateway commands` mostrou inventario canonico com 134 comandos apos incluir recovery fixture.
- [x] `/byok auto policy` mostrou policy efetiva.
- [x] `/byok auto status profile:repo_agent` mostrou decision sem aplicar efeito.
- [x] `/byok auto doctor profile:repo_agent` mostrou policy, decision, ledgers e blockers.
- [x] `/byok auto explain profile:repo_agent` explicou action/blockers/next commands.
- [x] `/byok auto recovery-fixture profile:repo_agent failure:rate-limit` persistiu recovery account-wide sem provider call.
- [x] `/byok auto history`, `/byok auto handoffs`, `/byok auto confirmations` e `/byok auto recoveries` renderizaram ledger/empty state.
- [x] `live-scenario-run-recorded` gravou `terminal-live:2026-06-01T23-09-22-754Z:auto_probe`.
- [x] `npm run model-gateway:live:runs` leu 5 registros persistidos e o ultimo com `criteriaTotal=27`.
- [x] `npm run model-gateway:auto:doctor` mostrou `schema=10`, `commands=134`, `recoveries=2` e `liveRuns=5`.
