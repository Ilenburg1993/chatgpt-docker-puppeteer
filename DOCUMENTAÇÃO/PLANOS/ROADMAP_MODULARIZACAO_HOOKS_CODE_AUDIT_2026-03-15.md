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

## Atualização pós-correções de smoke (2026-03-16)

- ✅ `smoke-test.sh --quiet` → **PASS 244/244**
- ✅ `smoke-test.sh --domains --quiet` → **FAIL_DOMAINS=0**
- ✅ `smoke-test.sh --all --quiet` → **PASS 245/245**
- ✅ Commit criado e push realizado em `main` (`b4f52b9e`) após pré-autorização explícita.

## Auditoria geral atual do sistema de hooks (baseline para próxima rodada)

### Panorama técnico consolidado

- Hotspots atuais por volume:
  - `.github/hooks/scripts/smoke-test.sh`: **2899 linhas**
  - `.github/hooks/hooks-lib/agent-stop-lib.sh`: **2730 linhas**
  - `.github/hooks/hooks-lib/common.sh`: **1565 linhas**
  - `.github/hooks/scripts/session-start.sh`: **1177 linhas**
  - `.github/hooks/scripts/pre-tool-use.sh`: **1059 linhas**
  - `.github/hooks/scripts/log-prompt.sh`: **994 linhas**
  - `.github/hooks/scripts/post-tool-use.sh`: **895 linhas**
- Cobertura operacional (baseline pré-F7): `scripts_count=40`, `hooks_lib_count=8`.
- Cobertura operacional (estado pós-F7): `scripts_count=41`, `hooks_lib_count=36`.
- Estado funcional: hardening e suíte smoke verdes; dívida principal é **complexidade residual** e **governança contínua de contratos**.

### Classificação atual de scripts (auto x manual)

**A) Hooks automáticos (acionados por `copilot-hooks.json`)**

- `session-start.sh`
- `log-prompt.sh`
- `pre-tool-use.sh`
- `post-tool-use.sh`
- `agent-stop.sh`
- `subagent-start.sh`
- `subagent-stop.sh`
- `pre-compact.sh`
- `session-end.sh`

**B) Scripts manuais chamados por hooks automáticos (runtime interno)**

- `watchdog.sh` (via `session-start.sh`)
- `rotate-audit.sh` (via `session-start.sh`)
- `session-close.sh` (via `post-tool-use.sh`)
- `session-checkpoint.sh` (via `pre-compact.sh`, `agent-stop.sh`, `session-end.sh`)
- `sync-tasks-to-docs.sh` (via `agent-stop.sh`)
- `generate-session-summary.sh` (via `session-end.sh` + `hooks-lib/session-end-aux.sh`)

**C) Scripts manuais não acionados automaticamente por hooks (uso usuário/operação)**

- Orquestração humana: `start-turn.sh`, `start-section.sh`, `continue-section.sh`, `section-end.sh`, `session-reminder.sh`, `manual-session-init.sh`.
- Backlog/auditoria: `add-task.sh`, `complete-task.sh`, `save-finding.sh`, `resolve-finding.sh`.
- Operação/diagnóstico: `smoke-test.sh`, `smoke-test-domains.sh`, `verify-hook-delivery.sh`, `export-metrics.sh`, `analytics.sh`, `sync-transcript-errors.sh`, `migrate-per-session-audit.sh`, `install-git-hooks.sh`.
- Automação externa (git hook): `on-git-push.sh`.

### Padronização mandatória Script↔Lib (nova diretriz)

- Todo script em `.github/hooks/scripts/*.sh` deve ter **ao menos uma lib relacionada** em `.github/hooks/hooks-lib/`.
- Desenho obrigatório por convenção:
  - script = entrypoint/orquestração,
  - lib = regras reutilizáveis, IO, contrato e helpers.
- Lacuna atual: há scripts sem referência explícita a `hooks-lib/`; regularização entra em **F7.0**.
- Regra de execução adicionada: para cada script sem lib relacionada, deve ser criado arquivo lib dedicado (mesmo que wrapper inicial), com migração incremental do conteúdo.

### Estrutura-alvo de subpastas em `hooks-lib/` (F7)

- `hooks-lib/runtime/` → parsing de input, paths, lock, utilitários de shell.
- `hooks-lib/context/` → leitura/escrita transacional de contexto e guards de sessão.
- `hooks-lib/policy/` → autorização, continuidade, close-key, reason-codes.
- `hooks-lib/lifecycle/` → start/end/subturn/section lifecycle helpers.
- `hooks-lib/audit/` → emissão de eventos, resumo, trilhas de auditoria.
- `hooks-lib/maintenance/` → sync de backlog, rotação e housekeeping.
- `hooks-lib/testing/` → helpers compartilhados de smoke/fixtures (quando aplicável).

### Riscos prioritários remanescentes (P0/P1/P2)

1. **P0 — Complexidade crítica em `agent-stop-lib.sh` e `smoke-test.sh`**
  - Alto custo de revisão e risco de regressão por mudanças aparentemente pequenas.
2. **P1 — `common.sh` ainda concentrando domínios heterogêneos**
  - Runtime, contexto, subturn e recovery coexistem no mesmo arquivo.
3. **P1 — Governança documental e operacional distribuída**
  - Necessidade de sincronismo rígido entre `ROADMAP`, `PLANO` e backlog de hooks.
4. **P2 — Gap de observabilidade para KPIs de refatoração**
  - Falta painel objetivo com métricas de regressão por fase (tempo de execução, divergência, contratos violados).

## Programa abrangente de refatoração rigorosa (F7→F12)

> Este programa continua o ciclo F0→F6 com foco em redução estrutural, contratos executáveis e rollout governado.
> Referências vivas obrigatórias: este roadmap +
> `DOCUMENTAÇÃO/PLANOS/PLANO-MODULARIZACAO-HOOKS-SYSTEM-CODE-AUDIT.md`.

### F7 — Auditoria sistêmica profunda e mapa de acoplamentos

**Objetivo**: produzir um diagnóstico executável de dependências internas e riscos de regressão.

**Subfases**:

- **F7.0** Consolidação estrutural inicial (pastas, taxonomia de scripts e matriz Script↔Lib) — **primeira execução obrigatória do pacote F7**.

- **F7.1** Inventário de funções/exportações por script/lib (quem chama quem).
- **F7.2** Matriz de acoplamento por domínio (`runtime`, `policy`, `recovery`, `events`, `reporting`).
- **F7.3** Ranking de hotspots por severidade (mudança, teste, rollback).
- **F7.4** Criar libs dedicadas para scripts sem relação explícita Script↔Lib.
- **F7.5** Migrar `hooks-lib/` para subpastas canônicas com camada de compatibilidade.
- **F7.6** Definir e aplicar verificador estático Script↔Lib + taxonomia de subpastas.
- **F7.7** Migrar módulos legados no root de `hooks-lib/` para subpastas de domínio com shims compatíveis.
- **F7.8** Publicar índice canônico machine-readable (`script -> lib -> domínio -> owner`).
- **F7.9** Formalizar governança de diretórios (`README` por domínio + convenção de naming).
- **F7.10** Integrar gate estrutural Script↔Lib na rotina operacional (task/CI/local).

**Critérios de saída**:

- Matriz de acoplamento publicada e revisada.
- Lista P0/P1/P2 com owner técnico por item.
- Backlog de refatoração priorizado para F8/F9/F10.

### F8 — Contratos executáveis e validação semântica de policy

**Objetivo**: tornar regras de autorização e continuidade formalmente verificáveis.

**Subfases**:

- **F8.1** Consolidar contratos JSON/Markdown em `contracts/` com versionamento explícito.
- **F8.2** Criar checks de conformidade para reason codes obrigatórios.
- **F8.3** Introduzir validação de compatibilidade retroativa (campos top-level + `hookSpecificOutput`).

**Critérios de saída**:

- Contratos versionados (`vX.Y`) com changelog.
- Smoke cobrindo contratos críticos com fixtures dedicadas.
- Zero drift entre policy e contrato documentado.

### F9 — Reengenharia da suíte smoke para granularidade máxima

**Objetivo**: reduzir custo de diagnóstico e acelerar correção de regressão.

**Subfases**:

- **F9.1** Extrair grupos V90/AS para arquivos de domínio menores e independentes.
- **F9.2** Introduzir harness de fixtures reutilizáveis (sandbox padrão por cenário).
- **F9.3** Criar relatório agregador por domínio com severidade e causa provável.

**Critérios de saída**:

- Cada falha aponta para domínio/arquivo responsável em ≤ 1 passo.
- Tempo de triagem manual reduzido (meta: ≤ 5 min por falha).
- Runner principal preserva compatibilidade com `--quiet`, `--domains`, `--all`.

### F10 — Decomposição final de módulos monolíticos

**Objetivo**: reduzir arquivos críticos para blocos com responsabilidade única.

**Subfases**:

- **F10.1** Fatiar `agent-stop-lib.sh` em `stop-block`, `stop-auth`, `stop-subturn`, `stop-observability`.
- **F10.2** Fatiar `common.sh` por domínio (`ctx`, `runtime`, `subturn`, `session-id-guard`).
- **F10.3** Revisão de contratos públicos dos helpers e camada de compatibilidade.

**Critérios de saída**:

- Redução objetiva de tamanho/complexidade dos arquivos monolíticos.
- Zero quebra de hooks automáticos em smoke completo.
- API interna documentada com JSDoc e exemplo de uso.

### F11 — Observabilidade de refatoração e SLO operacional

**Objetivo**: medir qualidade do sistema durante evolução contínua.

**Subfases**:

- **F11.1** Definir KPIs/SLOs (falha por domínio, tempo de smoke, divergência shadow/on).
- **F11.2** Persistir métricas históricas em artefato canônico para auditoria.
- **F11.3** Gerar relatório de tendência por janela (diária/semanal).

**Critérios de saída**:

- Painel de métricas acessível no repositório.
- Alertas para regressão de SLO definidos.
- Rito de revisão periódica operacional formalizado.

### F12 — Rollout final rigoroso + governança de manutenção

**Objetivo**: fechar ciclo de refatoração com segurança e operação sustentável.

**Subfases**:

- **F12.1** Janela de estabilização com critérios de entrada/saída e rollback explícitos.
- **F12.2** Corte de caminhos legados residuais com checklist de compatibilidade.
- **F12.3** Institucionalizar rotina de atualização de `ROADMAP` + `PLANO` + `pending-tasks.md`.

**Critérios de saída**:

- Janela estável sem divergência crítica pelo período acordado.
- Legado residual removido ou oficialmente deprecado.
- Governança contínua ativa e documentada.

## TODO mestre completo (F7→F12)

- [x] **F7.0** Consolidar estrutura de diretórios/scripts e mapear pareamento Script↔Lib obrigatório.
- [x] **F7.1** Inventário completo de dependências internas dos hooks.
- [x] **F7.2** Matriz de acoplamento por domínio com severidade.
- [x] **F7.3** Backlog priorizado P0/P1/P2 para execução técnica.
- [x] **F7.4** Criar arquivos lib para 100% dos scripts ainda sem relação Script↔Lib explícita.
- [x] **F7.5** Criar subpastas canônicas em `hooks-lib/` e realocar módulos por domínio.
- [x] **F7.6** Automatizar auditoria de conformidade Script↔Lib e layout de `hooks-lib/`.
- [x] **F7.7** Migrar módulos legados do root de `hooks-lib/` para subpastas com compatibilidade.
- [x] **F7.8** Publicar índice canônico em artefato machine-readable da fase F7.
- [x] **F7.9** Consolidar documentação de domínio por subpasta (`README` + regras de naming).
- [ ] **F7.10** Integrar verificador estrutural ao fluxo padrão de validação.
- [x] **F8.1** Versionar contratos executáveis de policy e stop.
- [x] **F8.2** Cobrir reason codes e payloads obrigatórios via smoke.
- [ ] **F8.3** Validar compatibilidade retroativa dos contratos.
- [ ] **F9.1** Fatiar checks V90/AS em suítes menores por domínio.
- [ ] **F9.2** Criar harness padrão de fixtures reutilizáveis.
- [ ] **F9.3** Publicar relatório de diagnóstico por domínio.
- [ ] **F10.1** Decompor `agent-stop-lib.sh` em módulos menores.
- [ ] **F10.2** Decompor `common.sh` por responsabilidade.
- [ ] **F10.3** Documentar API interna final dos helpers.
- [ ] **F11.1** Definir KPIs/SLOs canônicos da refatoração.
- [ ] **F11.2** Persistir histórico de métricas operacionais.
- [ ] **F11.3** Publicar relatório periódico de tendência.
- [ ] **F12.1** Conduzir janela de estabilização com gate objetivo.
- [ ] **F12.2** Cortar/deprecar legado residual com checklist formal.
- [ ] **F12.3** Manter sincronismo contínuo entre ROADMAP/PLANO/backlog.

## Detalhamento técnico das subfases (execução rigorosa)

### Pacote F7 (auditoria sistêmica)

**Artefatos concluídos nesta rodada F7**:

- `DOCUMENTAÇÃO/HOOKS/F7-INVENTARIO-SCRIPT-LIB-2026-03-16.md`
- `DOCUMENTAÇÃO/HOOKS/F7-MATRIZ-ACOPLAMENTO-2026-03-16.md`
- `.github/hooks/scripts/verify-script-lib-coverage.sh`
- `.github/hooks/scripts/export-script-lib-index.sh`
- `.github/hooks/hooks-lib/testing/export-script-lib-index-lib.sh`
- `.github/hooks/state/f7-script-lib-index.json`
- Entradas canônicas criadas em subpastas: `hooks-lib/runtime/*.sh`, `hooks-lib/policy/policy.sh`, `hooks-lib/lifecycle/session-*.sh`.

**Status F7.7 (concluído)**: inversão root->shim aplicada e contrapartes canônicas ativas nas subpastas de domínio.

**Status F7.8 (concluído)**: índice machine-readable publicado com schema validado e cobertura total (`scripts_total=42`, `coverage.none=0`).

**Status F7.9 (concluído)**: governança de diretórios/naming publicada em `hooks-lib/README.md` e em todos os `hooks-lib/*/README.md`.

- **F7.0 — Consolidação estrutural inicial (fase de abertura)**
  - **Entrada**: árvore atual de `scripts/` e `hooks-lib/` + classificação auto/manual.
  - **Entrega**: matriz Script↔Lib (1:N), taxonomia formal (auto, manual-runtime, manual-user, manutenção) e gap-list dos scripts sem lib explícita.
  - **Evidência**: roadmap/plano/pending-tasks sincronizados com o novo mapeamento estrutural.
  - **Gate**: nenhum script sem lib relacionada definida (direta ou via backlog de migração com owner e prazo).

- **F7.1 — Inventário de dependências internas**
  - **Entrada**: árvore atual de `scripts/`, `hooks-lib/`, `contracts/`.
  - **Entrega**: mapa `arquivo -> funções públicas -> consumidores`.
  - **Evidência**: relatório versionado no roadmap + anexos de inventário.
  - **Gate**: nenhuma função pública sem consumidor conhecido.
- **F7.2 — Matriz de acoplamento por domínio**
  - **Entrada**: inventário F7.1.
  - **Entrega**: matriz com severidade, probabilidade de regressão e custo de rollback.
  - **Evidência**: tabela P0/P1/P2 com justificativa objetiva.
  - **Gate**: todos hotspots classificados e priorizados.
- **F7.3 — Backlog técnico priorizado**
  - **Entrada**: matriz F7.2.
  - **Entrega**: backlog com owners, sequência e dependências.
  - **Evidência**: `pending-tasks.md` sincronizado.
  - **Gate**: backlog pronto para execução sem ambiguidades.
- **F7.4 — Criação de libs faltantes por script**
  - **Entrada**: gap-list F7.0/F7.1.
  - **Entrega**: arquivo lib dedicado para cada script sem relação explícita (wrapper inicial + TODO técnico de migração).
  - **Evidência**: cobertura Script↔Lib em 100% dos scripts monitorados.
  - **Gate**: zero script sem arquivo lib correspondente.
- **F7.5 — Subpastas canônicas em `hooks-lib/`**
  - **Entrada**: inventário de libs atuais.
  - **Entrega**: reorganização por domínio (`runtime`, `context`, `policy`, `lifecycle`, `audit`, `maintenance`, `testing`) com shims de compatibilidade temporários.
  - **Evidência**: árvore de pastas publicada e dif de migração documentado.
  - **Gate**: nenhuma quebra de source/import durante migração incremental.
- **F7.6 — Verificador de conformidade estrutural**
  - **Entrada**: matriz final Script↔Lib + nova árvore `hooks-lib/`.
  - **Entrega**: check automatizado para detectar script órfão e lib fora da taxonomia.
  - **Evidência**: execução do check com relatório e saída determinística.
  - **Gate**: check aprovado e integrado ao fluxo operacional.
- **F7.7 — Migração dos módulos legados de root**
  - **Entrada**: lista de módulos legados detectados no root (`common`, `config`, `policy`, `session-start/end-*`).
  - **Entrega**: realocação para subpastas de domínio + shims de compatibilidade no root.
  - **Evidência**: modo `--strict-legacy-root` com contagem decrescente controlada.
  - **Gate**: `legacy_root_modules_unmapped_count=0` em modo estrito.
- **F7.8 — Índice machine-readable da fase F7**
  - **Entrada**: inventário final Script↔Lib.
  - **Entrega**: artefato versionado (`json`/`md`) com mapeamento script/lib/domínio/owner.
  - **Evidência**: `bash .github/hooks/scripts/export-script-lib-index.sh` gerando `.github/hooks/state/f7-script-lib-index.json`; schema validado e sincronismo com `verify-script-lib-coverage.sh --strict-legacy-root` (`missing_relation_count=0`, `legacy_root_modules_unmapped_count=0`).
  - **Gate**: rastreabilidade de 100% dos scripts em formato automatizável.
- **F7.9 — Governança de diretórios e naming**
  - **Entrada**: árvore `hooks-lib/` pós-migração.
  - **Entrega**: `README` por domínio e convenções de nome de wrappers/helpers.
  - **Evidência**: READMEs atualizados em `hooks-lib/{runtime,context,policy,lifecycle,audit,maintenance,testing}/README.md` + convenção central em `hooks-lib/README.md`.
  - **Gate**: nenhuma subpasta crítica sem documentação mínima.
- **F7.10 — Integração do gate estrutural**
  - **Entrada**: verificador F7.6 estável.
  - **Entrega**: inclusão do check em task local e/ou pipeline de validação.
  - **Evidência**: execução reproduzível via comando único de validação.
  - **Gate**: regressão estrutural detectada automaticamente antes de merge.

### Pacote F8 (contratos executáveis)

**Status F8.2 (concluído em 2026-03-15)**: cobertura contratual adicionada em
`.github/hooks/scripts/smoke-test.sh` (legacy) e
`.github/hooks/scripts/smoke-domains/smoke-policy.sh` (domínio policy), incluindo:

- validação de presença/parse de `contracts/contract-registry.json` e `contracts/stop-decision.schema.json`;
- assert de referência `stop-decision-output` no registry;
- assert de campos mínimos obrigatórios do schema (`decision`, `reason`, `hookSpecificOutput`);
- checks explícitos de reason codes obrigatórios e payload mínimo de `emit_stop_block`.

- **F8.1 — Versionar contratos críticos**
  - **Entrada**: regras atuais de policy/stop.
  - **Entrega**: contratos versionados (`vX.Y`) + changelog.
  - **Evidência**: `contracts/contract-registry.json` (registro central), `contracts/stop-decision.schema.json` (contrato executável stop) e `contracts/CONTRACT_VERSIONING_POLICY.md` (regras de compatibilidade semver).
  - **Gate**: contrato parseável e referenciado no smoke.
- **F8.2 — Cobrir reason codes/payloads no smoke**
  - **Entrada**: contrato F8.1.
  - **Entrega**: checks automatizados para payload mínimo e reason codes.
  - **Evidência**: suíte smoke verde com asserts contratuais.
  - **Gate**: nenhuma regra crítica sem teste.
- **F8.3 — Compatibilidade retroativa**
  - **Entrada**: payload legado + payload atual.
  - **Entrega**: matriz compatível/incompatível + fallback documentado.
  - **Evidência**: relatório de não-regressão.
  - **Gate**: top-level fields e `hookSpecificOutput` preservados.

### Pacote F9 (smoke granular)

- **F9.1 — Split V90/AS por domínio**
  - **Entrada**: bloco monolítico atual.
  - **Entrega**: arquivos menores com ownership por domínio.
  - **Evidência**: runner agregador sem perda de cobertura.
  - **Gate**: nenhum cenário crítico perdido no split.
- **F9.2 — Harness padrão de fixtures**
  - **Entrada**: cenários comportamentais existentes.
  - **Entrega**: helpers de sandbox/seed/replay reutilizáveis.
  - **Evidência**: redução de duplicação nas suítes.
  - **Gate**: fixture única para cenários equivalentes.
- **F9.3 — Relatório de triagem por domínio**
  - **Entrada**: execução de smoke por domínio.
  - **Entrega**: saída com causa provável e primeiro ponto de inspeção.
  - **Evidência**: relatório agregado versionado.
  - **Gate**: diagnóstico acionável em uma leitura.

### Pacote F10 (decomposição monolítica)

- **F10.1 — Fatiar `agent-stop-lib.sh`**
  - **Entrada**: mapa de funções e hotspots.
  - **Entrega**: módulos `stop-auth`, `stop-block`, `stop-subturn`, `stop-observability`.
  - **Evidência**: `agent-stop-lib.sh` reduzido para camada de composição.
  - **Gate**: paridade de comportamento no smoke completo.
- **F10.2 — Fatiar `common.sh`**
  - **Entrada**: funções compartilhadas por domínio.
  - **Entrega**: módulos `runtime/common`, `context/tx`, `recovery`, `subturn`.
  - **Evidência**: chamadas migradas sem duplicação residual.
  - **Gate**: nenhum helper órfão e sem regressão de lock/ctx.
- **F10.3 — API interna e JSDoc**
  - **Entrada**: módulos decompostos.
  - **Entrega**: contrato de API interna com exemplos e limites.
  - **Evidência**: documentação sincronizada em `PLANO` e `ROADMAP`.
  - **Gate**: onboarding técnico possível sem inspeção ad-hoc de código.

### Pacote F11 (observabilidade/SLO)

- **F11.1 — Definir KPIs/SLOs**
  - **Entrada**: baseline de execução atual.
  - **Entrega**: metas formais (latência smoke, falhas por domínio, divergência).
  - **Evidência**: tabela de SLO publicada no roadmap.
  - **Gate**: todos KPIs possuem fonte de medição.
- **F11.2 — Persistência histórica**
  - **Entrada**: métricas de execução por rodada.
  - **Entrega**: histórico acumulado por janela temporal.
  - **Evidência**: artefato versionado/revisável.
  - **Gate**: reprodutibilidade de tendência.
- **F11.3 — Tendência e alertas**
  - **Entrada**: histórico F11.2.
  - **Entrega**: relatório periódico com alertas de regressão.
  - **Evidência**: bloco de decisão operacional por janela.
  - **Gate**: regressão detectável antes de cortar legado.

### Pacote F12 (rollout final)

- **F12.1 — Janela de estabilização**
  - **Entrada**: F7→F11 concluídos.
  - **Entrega**: janela com critérios de entrada/saída e rollback.
  - **Evidência**: checklist de passagem de gate completo.
  - **Gate**: nenhuma divergência crítica na janela acordada.
- **F12.2 — Corte/depreciação de legado**
  - **Entrada**: estabilidade comprovada.
  - **Entrega**: remoção controlada de caminhos legados residuais.
  - **Evidência**: diff de corte + plano de rollback mínimo.
  - **Gate**: operação íntegra sem fallback automático ao legado.
- **F12.3 — Governança permanente**
  - **Entrada**: sistema pós-corte.
  - **Entrega**: rito contínuo de atualização ROADMAP/PLANO/backlog.
  - **Evidência**: cadence definida (ex.: semanal) com responsáveis.
  - **Gate**: documentação sempre consistente com estado real.

## Pacote de fases — Convergência Lib-First dos hooks automáticos (F13→F16)

> Diretriz solicitada: todos os hooks automáticos do `copilot-hooks.json` devem operar no modelo
> **script-orquestrador + libs de domínio**, usando `agent-stop.sh` como referência de integração
> com lib dedicada. A decomposição interna de `agent-stop-lib.sh` permanece planejada para depois.

### Escopo-alvo (hooks ativados automaticamente)

| Hook Copilot | Script | Estado atual | Meta desta trilha |
| --- | --- | --- | --- |
| `sessionStart` | `session-start.sh` | usa `common.sh` + `session-start-core/aux.sh` | consolidar `session-start-lib.sh` como entrypoint dedicado + script fino |
| `userPromptSubmitted` | `log-prompt.sh` | usa apenas `common.sh` | criar `log-prompt-lib.sh` e migrar lógica de domínio |
| `preToolUse` | `pre-tool-use.sh` | usa `common.sh` + `policy.sh` | criar `pre-tool-use-lib.sh` e deixar script como bootstrap/dispatch |
| `postToolUse` | `post-tool-use.sh` | usa `common.sh` + `policy.sh` | criar `post-tool-use-lib.sh` e reduzir lógica inline |
| `agentStop` | `agent-stop.sh` | usa `common.sh` + `agent-stop-lib.sh` | manter como padrão de referência; modularizar `agent-stop-lib.sh` só em fase posterior |
| `subagentStart` | `subagent-start.sh` | usa apenas `common.sh` | criar `subagent-start-lib.sh` e mover regras de negócio |
| `subagentStop` | `subagent-stop.sh` | usa apenas `common.sh` | criar `subagent-stop-lib.sh` e mover regras de negócio |
| `preCompact` | `pre-compact.sh` | usa apenas `common.sh` | criar `pre-compact-lib.sh` e mover regras de negócio |
| `sessionEnd` | `session-end.sh` | usa `common.sh` + `session-end-core/aux.sh` | consolidar `session-end-lib.sh` como entrypoint dedicado + script fino |

### F13 — Baseline e contratos de entrypoint (auto hooks)

- **F13.1** Congelar contrato canônico de script automático (`bootstrap + source libs + dispatch + saída padronizada`).
- **F13.2** Publicar matriz `hook automático -> script -> lib(s) -> owner -> domínio`.
- **F13.3** Definir regra objetiva de “script fino” (limite de responsabilidade inline por script).

**Gate F13**: todos os 9 hooks automáticos mapeados com contrato explícito de entrada/saída e owner.

### F14 — Migração script-orquestrador + lib dedicada por hook

- **F14.1** Criar libs dedicadas faltantes (`log-prompt-lib.sh`, `pre-tool-use-lib.sh`, `post-tool-use-lib.sh`, `subagent-start-lib.sh`, `subagent-stop-lib.sh`, `pre-compact-lib.sh`, `session-start-lib.sh`, `session-end-lib.sh`).
- **F14.2** Migrar regras de negócio de cada script automático para sua lib dedicada.
- **F14.3** Padronizar dispatch em todos os scripts automáticos para chamada única da função pública da lib.

**Gate F14**: 100% dos hooks automáticos com lib dedicada e script atuando como entrypoint fino.

### F15 — Redução de complexidade e modularização posterior do Stop

- **F15.1** Consolidar padrão dos 8 hooks automáticos não-Stop já no modelo lib-first.
- **F15.2** Iniciar decomposição interna de `agent-stop-lib.sh` em módulos menores (`stop-auth`, `stop-block`, `stop-subturn`, `stop-observability`).
- **F15.3** Manter `agent-stop.sh` como orquestrador estável durante toda a quebra interna da lib.

**Gate F15**: `agent-stop.sh` preservado como padrão de entrada; modularização interna da lib avançando sem regressão de contrato.

### F16 — Enforcement estrutural e rollout

- **F16.1** Expandir `verify-script-lib-coverage.sh` para exigir lib dedicada também para hooks automáticos (não só relação Script↔Lib genérica).
- **F16.2** Adicionar checks no smoke (`legacy` + `domains`) validando padrão de entrypoint lib-first em todos os scripts automáticos.
- **F16.3** Integrar gate no fluxo padrão (task local/CI) e registrar métricas de aderência por rodada.

**Gate F16**: regressão de padrão lib-first em hooks automáticos bloqueada automaticamente antes de merge.

### TODO mestre (novo pacote F13→F16)

- [ ] **F13.1** Contrato canônico de entrypoint para hooks automáticos.
- [ ] **F13.2** Matriz completa `hook->script->libs->owner` publicada.
- [ ] **F13.3** Critério objetivo de “script fino” formalizado.
- [ ] **F14.1** Criar libs dedicadas faltantes para todos os hooks automáticos.
- [ ] **F14.2** Migrar lógica de negócio dos scripts automáticos para libs dedicadas.
- [ ] **F14.3** Padronizar dispatch único por script automático.
- [ ] **F15.1** Consolidar 8 hooks não-Stop no padrão lib-first.
- [ ] **F15.2** Modularizar internamente `agent-stop-lib.sh` em módulos menores.
- [ ] **F15.3** Preservar estabilidade contratual de `agent-stop.sh` durante a quebra da lib.
- [ ] **F16.1** Enforcement no verificador estrutural para hooks automáticos.
- [ ] **F16.2** Cobertura smoke de aderência lib-first para hooks automáticos.
- [ ] **F16.3** Gate integrado em fluxo padrão com métricas de aderência.
