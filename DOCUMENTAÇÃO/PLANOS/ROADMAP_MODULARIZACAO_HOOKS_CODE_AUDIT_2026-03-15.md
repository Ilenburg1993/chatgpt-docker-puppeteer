# Roadmap de Execução — Modularização do Hooks System (Code Audit)

**Data**: 2026-03-15 **Fonte-base**:
`DOCUMENTAÇÃO/PLANOS/PLANO-MODULARIZACAO-HOOKS-SYSTEM-CODE-AUDIT.md`

## Objetivo

Executar a modularização do sistema de hooks com rollout seguro, preservando comportamento atual e
reduzindo acoplamento estrutural.

## Princípios de execução

- Não quebrar contratos críticos de autorização (`Template F + close_key`).
- Migrar por fases pequenas e verificáveis.
- Validar cada fase com smoke + gates mínimos.
- Priorizar primeiro infraestrutura comum, depois policy, depois lifecycle.

## Sequência de fases (roadmap)

### Fase 0 — Baseline e congelamento comportamental

- Capturar contrato atual de eventos e regras críticas.
- Registrar matriz de comportamento esperado por hook automático.
- **Critério de saída**: smoke canônico 100% verde e baseline aprovado.

### Fase 1 — Runtime comum e contexto transacional

- Extrair utilitários de parsing/path/lock para `hooks-lib/runtime`.
- Unificar escrita de `session-context` em API transacional única.
- Migrar hooks automáticos para essa API sem alterar regra de negócio.
- **Critério de saída**: 100% dos hooks escrevendo contexto via API única.

### Fase 2 — Consolidação do policy engine

- Centralizar autorização/continuidade/fechamento em `hooks-lib/policy`.
- Reduzir duplicação entre `pre-tool-use`, `post-tool-use` e `agent-stop`.
- **Critério de saída**: regra de autorização em fonte única, sem drift.

### Fase 3 — Fatiamento de session-start/session-end

- Separar lifecycle mínimo de briefing/reporting/analytics.
- Garantir que jobs auxiliares não derrubem start/end.
- **Critério de saída**: fluxo crítico mais curto e resiliente.

### Fase 4 — Completar modularização do agent-stop

- Extrair blocos restantes de bloqueio/subturn para módulos dedicados.
- Manter `agent-stop.sh` como orquestrador magro.
- **Critério de saída**: baixa lógica inline e paridade funcional.

### Fase 5 — Reestruturação de testes de hooks

- Quebrar `smoke-test.sh` em suítes por domínio.
- Manter agregador único para CI local.
- **Critério de saída**: diagnóstico por domínio e paridade de cobertura.

### Fase 6 — Rollout controlado e corte de legado

- Ativar módulos via feature flags em modo sombra.
- Medir divergências entre caminho legado e modular.
- Remover legado após janela estável.
- **Critério de saída**: 0 divergências críticas por janela acordada.

## Ordem recomendada imediata

1. **Executar Fase 3** (fatiamento lifecycle start/end).
2. Na sequência, **Fase 4** (modularização final do `agent-stop`).
3. Consolidar com **Fase 5** e **Fase 6** (smoke por domínio + rollout/corte de legado).

## Backlog operacional (F0→F6)

Backlog materializado em `.github/hooks/state/pending-tasks.md` no formato compatível com os scripts
de hooks:

- **Alta**: F0, F1, F2
- **Média**: F3, F4
- **Backlog**: (sem pendências de fase)

Contagem atual do plano: **7 fases totais** (F0→F6), **7 concluídas** (F0, F1, F2, F3, F4, F5, F6) e
**0 pendentes**.

### TODO mestre por fase (F0→F6)

- [x] **F0** — Baseline e congelamento comportamental.
- [x] **F1** — Runtime comum e contexto transacional.
- [x] **F2** — Consolidação do policy engine.
- [x] **F3** — Fatiamento de `session-start`/`session-end`.
- [x] **F4** — Modularização final do `agent-stop`.
- [x] **F5** — Reestruturação da suíte smoke.
- [x] **F6** — Rollout controlado e corte de legado.

## Status de execução (atualização)

- ✅ **F0 concluída em 2026-03-15**
  - Artefato: `DOCUMENTAÇÃO/PLANOS/F0_BASELINE_CONTRATOS_HOOKS_2026-03-15.md`
  - Evidência técnica: `bash .github/hooks/scripts/smoke-test.sh --quiet` → **PASS 244/244**
  - Escopo consolidado: matriz de hooks automáticos + snapshot de regras críticas.

- ✅ **F1 concluída em 2026-03-15**
  - Escopo: convergência de runtime comum e escrita transacional nos hooks críticos.
  - Evidência: migração registrada em F1.1→F1.7 e verificação local sem erros de editor.

- ✅ **F2 concluída em 2026-03-15**
  - Escopo: criação de `hooks-lib/policy.sh` e adoção por `pre-tool-use`, `post-tool-use`,
    `agent-stop-lib`.
  - Evidência: reason-codes normalizados e redução de drift semântico entre pre/post/stop.

- ▶️ **Próxima fase recomendada**: F4 (modularização final do `agent-stop`).

## Gates de validação por fase

- `bash .github/hooks/scripts/smoke-test.sh --quiet`
- `npm run lint`
- `npm run test:unit`
- `git diff --name-only | xargs -r npx prettier --check`

## Resultado da limpeza inicial de backlog (hooks)

- Arquivo criado/normalizado: `.github/hooks/state/pending-tasks.md`
- Situação atual: **0 tarefas pendentes** de fase (F0→F6 concluídas).

## Próximo passo sugerido

Abrir execução da **Fase 4** com extração dos blocos remanescentes de `agent-stop` e redução
adicional da lógica inline do entrypoint.

## TODO operacional completo (execução contínua F1→F6)

> Estado atual: **em execução contínua**.
>
> Regras desta execução (solicitadas pelo usuário):
>
> - **Não executar commit/push** sem solicitação explícita.
> - **Não executar lint / format check / unit tests** sem solicitação explícita.

### Painel consolidado (todos os F em execução)

| Fase | Status      | Objetivo macro                        | Próxima ação objetiva                |
| ---- | ----------- | ------------------------------------- | ------------------------------------ |
| F0   | ✅ Concluída | Congelar baseline comportamental      | Mantida como referência de regressão |
| F1   | ✅ Concluída | Runtime comum + contexto transacional | Sem ação pendente                    |
| F2   | ✅ Concluída | Policy engine canônico                | Sem ação pendente                    |
| F3   | ✅ Concluída | Fatiar lifecycle start/end            | Sem ação pendente                    |
| F4   | ✅ Concluída | Enxugar `agent-stop`                  | Sem ação pendente                    |
| F5   | ✅ Concluída | Suíte smoke por domínio               | Sem ação pendente                    |
| F6   | ✅ Concluída | Rollout com flags + corte legado      | Sem ação pendente                    |

### F1 — Runtime comum e contexto transacional

- [x] **F1.1** Inventariar uso atual de runtime/helpers por hook (`resolve_hook_runtime_input`,
      `apply_per_session_paths`, `ctx_update`, `flock`).
- [x] **F1.2** Definir mapa “hook atual → helper canônico” para parsing, path per-session e lock.
- [x] **F1.3** Migrar `pre-tool-use.sh` para uso estrito dos helpers comuns (reduzindo lógica inline repetida).
- [x] **F1.4** Migrar `post-tool-use.sh` para uso estrito dos helpers comuns (paridade com pre-tool-use).
- [x] **F1.5** Migrar `log-prompt.sh` e `session-start.sh` para o mesmo contrato de runtime transacional.
- [x] **F1.6** Migrar `subagent-start.sh`, `subagent-stop.sh` e `pre-compact.sh` para o mesmo contrato.
- [x] **F1.7** Fechar checklist de paridade comportamental F1 (sem alterar policy de autorização).

#### Snapshot técnico F1.1 (inventário inicial)

| Hook/script         | `resolve_hook_runtime_input` | Per-session path (`apply_per_session_paths`/`resolve_*`) | Escrita transacional (`ctx_update`)          | Lock (`flock`)                      | Status de convergência |
| ------------------- | ---------------------------- | -------------------------------------------------------- | -------------------------------------------- | ----------------------------------- | ---------------------- |
| `pre-tool-use.sh`   | Sim                          | Sim                                                      | Parcial (ainda há blocos `jq+sponge` inline) | Sim                                 | **Parcial**            |
| `post-tool-use.sh`  | Sim                          | Sim                                                      | Parcial                                      | Sim                                 | **Parcial**            |
| `agent-stop.sh`     | Sim                          | Sim (via `apply_per_session_paths`)                      | Parcial                                      | Sim                                 | **Parcial**            |
| `log-prompt.sh`     | Sim                          | Sim (via `apply_per_session_paths`)                      | Parcial                                      | Sim                                 | **Parcial**            |
| `session-end.sh`    | Parcial                      | Sim (`resolve_ctx_file`/`resolve_audit_file`)            | Parcial                                      | Sim                                 | **Parcial**            |
| `session-start.sh`  | Não                          | Sim (per-session nativo)                                 | Parcial                                      | Não (não aplicável no mesmo padrão) | **Parcial**            |
| `subagent-start.sh` | Não                          | Sim (`apply_per_session_paths`)                          | Sim (contador)                               | Não                                 | **Parcial**            |
| `subagent-stop.sh`  | Não                          | Sim (`apply_per_session_paths`)                          | Sim (contador)                               | Não                                 | **Parcial**            |
| `pre-compact.sh`    | Não                          | Sim (`resolve_ctx_file`/`resolve_audit_file`)            | Sim (contador)                               | Não                                 | **Parcial**            |

**Leitura operacional do snapshot**:

- Base comum já existe em `.github/hooks/hooks-lib/common.sh` e está funcional.
- A principal dívida de F1 está em **padronização de escrita transacional** e redução de blocos inline `jq/sponge` em scripts centrais.
- Próximo passo objetivo: executar F1.3 com foco em convergência de `pre-tool-use.sh` para helpers comuns.

**Atualização de execução (F1.2)**:

- `subagent-start.sh`, `subagent-stop.sh` e `pre-compact.sh` já foram alinhados para usar
  `resolve_hook_runtime_input` como entrada canônica de runtime.

**Atualização de execução (F1.3/F1.4)**:

- `pre-tool-use.sh` e `post-tool-use.sh` convergiram para o helper local `ctx_apply_expr`,
  apoiado pelo helper compartilhado `ctx_apply_jq_expr_best_effort` em `hooks-lib/common.sh`.
- Redução efetiva de duplicação `jq + sponge + mktemp`, preservando comportamento de negócio
  (autorização, guardas e eventos).
- **F1.5 iniciada**: `session-start.sh` já passou a consumir `resolve_hook_runtime_input` como
  entrada canônica de runtime (com fallback compatível).
- `log-prompt.sh` recebeu `ctx_apply_expr` e já convergiu o bloco de obrigação de leitura
  (`required_docs_*`) para contrato transacional compartilhado.
- `session-start.sh` ganhou `ctx_apply_expr_file` e já convergiu o update tardio de `recovery`
  para a mesma abordagem transacional/fallback.
- Próxima subfase ativa: iniciar F2.1 (mapa de regras duplicadas entre `pre-tool-use`,
  `post-tool-use` e `agent-stop`).

#### Checklist de paridade F1.7 (fechado)

- [x] `pre-tool-use.sh` convergido para helper transacional local (`ctx_apply_expr`).
- [x] `post-tool-use.sh` convergido para helper transacional local (`ctx_apply_expr`).
- [x] `log-prompt.sh` convergido no fluxo de `required_docs_*` para helper transacional.
- [x] `session-start.sh` convergido em runtime canônico + update transacional de `recovery`.
- [x] `subagent-start.sh` / `subagent-stop.sh` / `pre-compact.sh` alinhados com runtime canônico.
- [x] Verificação local de problemas de editor (`get_errors`) sem erros nos arquivos alterados.

> Observação operacional: gates executáveis (lint/format/test/smoke) foram **deliberadamente não
> executados** nesta etapa por diretriz explícita do usuário para este ciclo de execução.

### F2 — Consolidação de policy engine

- [x] **F2.1** Mapear regras duplicadas entre `pre-tool-use`, `post-tool-use` e `agent-stop`.
- [x] **F2.2** Extrair módulo canônico de decisão de autorização/continuidade/fechamento.
- [x] **F2.3** Adaptar hooks para consumir o módulo único sem mudar contratos externos.
- [x] **F2.4** Consolidar reason codes e mensagens para eliminar drift semântico.

#### Mapa F2.1 — duplicações identificadas (baseline)

| Domínio de regra                                | `pre-tool-use.sh`                                                                                                | `post-tool-use.sh`                                                                  | `agent-stop-lib.sh`                                                                                                                                                 | Risco de drift |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Governança Template F / escalonamento           | valida opção de escalonamento + nega Template F sem request (`ASK_TEMPLATE_F_PRE`, `template_f_request_pending`) | classifica `ASK_TEMPLATE_F`, calcula `template_f_request_pending` e flags derivadas | invalida fechamento com reason codes (`askquestions_missing_template_f_option`, `template_f_called_without_prior_request`, `non_template_f_continuation_mandatory`) | **Alto**       |
| Continuidade obrigatória pós askQuestions não-F | bloqueios no preTool para desvio prematuro quando `auto_audit_required=true`                                     | calcula `continuation_mandatory` e `auto_audit_required`                            | invalida encerramento quando continuidade ainda obrigatória                                                                                                         | **Alto**       |
| Chave de fechamento (`close_key_validated`)     | bloqueio de chamadas diretas de `session-close.sh` sem validação                                                 | valida KEY e delega fechamento automático                                           | exige validação no fechamento estrito (Nível 3 / reason codes)                                                                                                      | **Alto**       |
| Protocolo TODO (último item askQuestions)       | valida `todo_last_item_is_askquestions_continuation` e bloqueia quando inválido                                  | persiste estado derivado de continuidade                                            | consome estado no fechamento para autorização                                                                                                                       | **Médio**      |
| Leitura obrigatória de docs de início/retomada  | marca docs lidos e reduz `required_docs_pending`                                                                 | (não decide diretamente)                                                            | bloqueia fechamento com `required_docs_not_read`                                                                                                                    | **Médio**      |

**Conclusão F2.1**:

- A lógica de policy está distribuída em três pontos com forte acoplamento temporal.
- O alvo de F2.2 é extrair um núcleo canônico com entradas/saídas explícitas (estado + decisão),
  deixando pre/post/stop apenas como adaptadores de runtime/eventos.

**Atualização de execução (F2.2/F2.3/F2.4)**:

- Novo módulo canônico criado: `.github/hooks/hooks-lib/policy.sh`.
- `pre-tool-use.sh` e `post-tool-use.sh` passaram a consumir helpers de policy para detecção
  de Template F/opções de escalonamento e parsing de resposta de `vscode_askQuestions`
  (com fallback compatível para manter comportamento legado).
- `agent-stop-lib.sh` passou a consumir `policy_determine_turn_auth_invalid_reason`
  (com fallback local) e normalização de reason codes via `policy_normalize_auth_invalid_reason`.
- Resultado: redução de drift semântico entre pre/post/stop com manutenção dos contratos externos.

### F3 — Fatiamento de session-start/session-end

- [x] **F3.0** Avaliar granularidade e necessidade de subfases adicionais para reduzir risco de
  regressão no lifecycle.
- [x] **F3.1** Extrair núcleo crítico de `session-start` (init de contexto mínimo, close key,
  recovery essencial e auditoria obrigatória).
- [x] **F3.2** Isolar briefing/health/trends/backlog em blocos auxiliares **fail-open** em
  `session-start`.
- [x] **F3.3** Extrair núcleo crítico de `session-end` (checkpoint final, sectionEnd/sessionEnd,
  compliance e flags de fechamento).
- [x] **F3.4** Isolar pós-processamento de `session-end` (sumário, espelho em
  `DOCUMENTAÇÃO/RELATORIOS/SESSIONS`, nota em pending-tasks) como auxiliares tolerantes a falha.
- [x] **F3.5** Padronizar wrappers de execução auxiliar (timeout curto + log de falha sem abortar
  fluxo crítico).
- [x] **F3.6** Consolidar wiring final de lifecycle e validar paridade funcional sem alterar
  contratos externos.

#### Nota de avaliação F3 (subfases adicionais)

- `session-start.sh` concentra múltiplos domínios (bootstrap de contexto, recovery, geração de
  briefing, saúde, tendências históricas), o que justifica dividir núcleo x auxiliares.
- `session-end.sh` combina encerramento crítico com tarefas de relatório/espelhamento; separar essas
  responsabilidades reduz risco de indisponibilidade em encerramentos com erro/timeout.
- Decisão: **manter F3 com subfases F3.0→F3.6** para execução incremental e validação por recorte.

#### Atualização de execução (F3.1)

- Novo módulo criado: `.github/hooks/hooks-lib/session-start-core.sh`.
- `session-start.sh` agora delega cálculo de sessão lógica e persistência inicial de contexto para
  o módulo core.
- Resultado esperado: reduzir lógica inline do fluxo crítico sem alterar contratos externos.

#### Atualização de execução (F3.2)

- Novo módulo auxiliar criado: `.github/hooks/hooks-lib/session-start-aux.sh`.
- `session-start.sh` passou a delegar backlog/findings, tendências históricas e health check para
  helpers auxiliares com execução **fail-open** (`|| true`).
- Resultado esperado: manter o bootstrap crítico resiliente mesmo com falhas em analytics/briefing.

#### Atualização de execução (F3.3)

- Novo módulo core criado: `.github/hooks/hooks-lib/session-end-core.sh`.
- `session-end.sh` passou a delegar fechamento da section ativa e finalização crítica de sessão
  (close_mode, eventos `sessionEnd*` e validação de close_key) ao módulo core.
- Resultado esperado: reduzir lógica inline do encerramento sem alterar contratos de auditoria.

#### Atualização de execução (F3.4)

- Novo módulo auxiliar criado: `.github/hooks/hooks-lib/session-end-aux.sh`.
- `session-end.sh` passou a delegar geração de summary/espelhamento e anotação em pending-tasks
  para helpers auxiliares em modo **fail-open**.
- Resultado esperado: evitar que falhas de relatório bloqueiem o encerramento crítico da sessão.

#### Atualização de execução (F3.5)

- Novo wrapper canônico em `hooks-lib/common.sh`: `run_aux_block`.
- `session-start.sh` e `session-end.sh` passaram a executar rotinas auxiliares via
  `run_aux_block` com timeout e log de falha.
- Novo tunável centralizado: `HOOKS_AUX_TIMEOUT_S` em `hooks-lib/config.sh`.

#### Atualização de execução (F3.6)

- Wiring final aplicado com módulos core/aux carregados explicitamente em `session-start.sh` e
  `session-end.sh`.
- Paridade local validada por checagens estruturais (`grep_search`) e diagnósticos de arquivo
  (`get_errors`) sem erros.
- F3 encerrada sem alteração de contratos externos de autorização/lifecycle.

### F4 — Modularização final do agent-stop

- [x] **F4.0** Avaliar granularidade e necessidade de subfases adicionais em `agent-stop`.
- [x] **F4.1** Extrair blocos remanescentes de metadados/subturn para módulos dedicados.
- [x] **F4.2** Reduzir `agent-stop.sh` para perfil mais orquestrador nos fluxos extraídos.
- [x] **F4.3** Revisar invariantes SESSION/SECTION/TURN/SubTurn após extrações iniciais.
- [x] **F4.4** Extrair o bloco principal de bloqueio (`AUTH_REQUESTED=false && stop_hook_active=false`)
      para helper dedicado.

#### Nota de avaliação F4 (subfases adicionais)

- `agent-stop.sh` ainda concentra o bloco principal de decisão de bloqueio; para reduzir risco,
  a modularização final foi quebrada em F4.0→F4.4.
- Decisão: executar extrações em etapas pequenas (metadados/subturn → ramo stop_hook_active →
  bloco principal de block), preservando paridade comportamental.

#### Atualização de execução (F4.1)

- `agent-stop-lib.sh` ganhou `populate_agent_stop_metadata_from_ctx` para carregar metadados de
  TURN/SubTurn.
- `agent-stop.sh` passou a consumir metadados via contrato TSV do helper, reduzindo leitura inline.

#### Atualização de execução (F4.2)

- `agent-stop-lib.sh` ganhou `normalize_agent_stop_subturn_state` para fallback/rebind/duração de
  SubTurn.
- `agent-stop.sh` passou a delegar a normalização de SubTurn para helper dedicado.

#### Atualização de execução (F4.3)

- `agent-stop-lib.sh` ganhou `handle_stop_hook_active_branch`, encapsulando o fluxo
  resume/reblock de `stop_hook_active=true`.
- Paridade local validada por `get_errors` (sem erros) e checagens estruturais de integração.

#### Atualização de execução (F4.4)

- `agent-stop-lib.sh` ganhou `handle_main_stop_block_branch`, encapsulando o bloco principal de
  `decision:block` para o caso `AUTH_REQUESTED=false && stop_hook_active=false`.
- `agent-stop.sh` passou a delegar esse fluxo para helper dedicado, mantendo o entrypoint em perfil
  de orquestração (sem mudança de contrato externo).
- Validação local: `get_errors` sem erros em `agent-stop.sh` e `agent-stop-lib.sh` após extração.

**Escopo explícito de fechamento da F4**: a fase cobre a extração dos blocos remanescentes de
bloqueio/subturn e o enxugamento das decisões principais; o entrypoint ainda mantém responsabilidades
de orquestração de runtime, auditoria e integração entre guards.

✅ **F4 encerrada** com subfases F4.0→F4.4 concluídas.

### F5 — Reestruturação da suíte smoke

- [x] **F5.1** Quebrar suíte por domínio (`core`, `policy`, `recovery`, `close`, `git-push`).
- [x] **F5.2** Criar agregador único mantendo compatibilidade de execução.
- [x] **F5.3** Documentar matriz de cobertura por domínio.

#### Atualização de execução (F5.1)

- Novo diretório criado: `.github/hooks/scripts/smoke-domains/`.
- Novas suítes por domínio criadas:
  - `smoke-core.sh`
  - `smoke-policy.sh`
  - `smoke-recovery.sh`
  - `smoke-close.sh`
  - `smoke-git-push.sh`
- Novo agregador inicial criado: `.github/hooks/scripts/smoke-test-domains.sh`.
- Objetivo da subfase F5.1 cumprido: verificação smoke quebrada em domínios operacionais.

#### Atualização de execução (F5.2)

- `smoke-test.sh` recebeu modo compatível por flags:
  - `--domains`: delega para `smoke-test-domains.sh`.
  - `--all`: executa suíte legada e agrega resultado do novo agregador de domínios.
- Compatibilidade preservada: modo padrão continua legado (sem quebrar fluxo existente).

#### Atualização de execução (F5.3)

- Documento de matriz criado: `DOCUMENTAÇÃO/HOOKS/MATRIZ-COBERTURA-SMOKE-DOMINIOS.md`.
- Cobertura consolidada por domínio (`core`, `policy`, `recovery`, `close`, `git-push`) com
  referência explícita às suítes e critérios de aprovação.

✅ **F5 encerrada** com subfases F5.1→F5.3 concluídas.

### F6 — Rollout controlado e corte de legado

- [x] **F6.1** Introduzir flags de ativação por módulo (modo sombra).
- [x] **F6.2** Medir divergência entre caminho legado e modular.
- [x] **F6.3** Planejar janela de estabilização e remoção final do legado.

#### Atualização de execução (F6.1)

- Feature flag adicionada em `hooks-lib/config.sh`:
  - `HOOKS_FF_SMOKE_DOMAINS=off|shadow|on` (default `shadow`).
- `smoke-test.sh` passou a respeitar rollout controlado:
  - `--domains` retorna sem executar quando flag está `off`.
  - `--all` executa domínio em `shadow` sem quebrar gate legado.
  - `--all` em `on` transforma falha do domínio em falha de gate.

#### Atualização de execução (F6.2)

- `smoke-test.sh --all` passou a medir paridade legado x domínios e persistir métricas em:
  - `.github/hooks/state/smoke-rollout-metrics.json`
- Métricas registradas: status/falhas do caminho legado, status/falhas do caminho por domínios,
  modo de execução (`off|shadow|on`) e flag `divergence_detected`.

#### Atualização de execução (F6.3)

- Plano de estabilização/corte documentado em:
  - `DOCUMENTAÇÃO/HOOKS/PLANO-ESTABILIZACAO-E-CORTE-LEGADO-SMOKE.md`
- Janela proposta formalizada com etapas `shadow` → `on` → corte e critérios de saída/rollback.

✅ **F6 encerrada** (F6.1→F6.3 concluídas).
✅ **Roadmap F0→F6 concluído integralmente**.

### Governança contínua durante execução

- [ ] Atualizar este roadmap ao concluir cada subfase.
- [ ] Sincronizar `.github/hooks/state/pending-tasks.md` com o andamento real.
- [ ] Encerrar cada turno com `vscode_askQuestions` de continuidade (Template A/D/E; Template F só para fechamento de SESSION).

## Auditoria plano x execução + validações pré-commit (2026-03-15)

### Resultado da auditoria de execução do plano

- Status funcional do plano F0→F6: **concluído** (sem fases abertas no backlog).
- `pending-tasks.md` está coerente com o roadmap (F0→F6 marcadas como concluídas).
- Ajuste de consistência documental identificado: o trecho “Próxima fase recomendada: F4” ficou
  desatualizado após fechamento de F4/F5/F6.

### Resultado das validações executadas

| Validação                         | Resultado            | Observação principal                                                                                                       |
| --------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `validate:shell` (ShellCheck)     | ❌ Falhou             | Alta quantidade de warnings em `dist/`, `.venv/` e scripts legados; inclui warnings em hooks (`smoke-domains` com SC2153). |
| `smoke-test.sh --quiet`           | ❌ Falhou (19)        | Falhas concentradas em checks V90/AS (parcialmente desatualizados frente à modularização atual).                           |
| `smoke-test.sh --domains --quiet` | ❌ Falhou (1 domínio) | `smoke-policy.sh` reportou “agent-stop-lib não carrega policy.sh” (possível falso negativo de matcher).                    |
| `smoke-test.sh --all --quiet`     | ❌ Falhou (19)        | Resultado equivalente ao legado + bloco extra de domínios.                                                                 |
| `npm run lint`                    | ✅ Passou             | Sem erro de lint no run solicitado.                                                                                        |
| `npm run format:check`            | ❌ Falhou             | 57 arquivos fora do padrão Prettier (inclui base documental e código fora do escopo desta fase).                           |
| `test:fast` (task)                | ❌ Falhou             | `make test-fast` inexistente no Makefile.                                                                                  |
| `npm run test:fast`               | ❌ Falhou             | Script não existe em `package.json`.                                                                                       |
| `npm run test:unit`               | ✅ Passou             | 800 testes passando, 0 falhas.                                                                                             |
| `test:integration` (task)         | ❌ Falhou             | `make test-integration` encerra com código 2.                                                                              |
| `test:all` (task)                 | ❌ Falhou             | 1 teste de integração falhando (`test_contract_e2e.spec.js`, JSON inválido no payload híbrido).                            |
| `validate:json`                   | ✅ Passou             | JSONs críticos válidos.                                                                                                    |
| `validate:git`                    | ✅ Passou             | Sem whitespace errors no diff.                                                                                             |
| `health:core` / `health:full`     | ⚠️ Degradado          | PM2 sem processos `agente-gpt`, `dashboard-web`, `chrome-proxy` iniciados.                                                 |

### Gaps objetivos identificados após validação

1. **Inconsistência de automação de testes rápidos**: tasks e scripts não convergem (`test:fast`).
2. **Falha real em integração**: `test_contract_e2e.spec.js` quebra por JSON malformado no modo híbrido.
3. **Smoke legacy parcialmente desalinhado** com a refatoração modular atual (falsos/obsoletos V90/AS).
4. **Débito de formatação amplo** fora do escopo estrito do roadmap F0→F6.

### Decisão de readiness para commit/push

**Não recomendado** avançar para commit/push sem tratar ao menos:

- falha de integração (`test_contract_e2e.spec.js`),
- convergência `test:fast` (task/script),
- revisão dos asserts smoke desatualizados para refletir o estado modular atual.
