# Relatório de Auditoria de Código — Hooks System (modularização/refatoração)

## Sumário executivo

O sistema de hooks está funcional e robusto em regras de negócio (autorização, lifecycle e hardening),
mas atingiu **complexidade estrutural alta**. O principal risco não é falta de feature; é **acoplamento
acidental entre políticas, persistência, recovery e telemetria** dentro dos mesmos scripts.

Hotspots objetivos por tamanho:

- `.github/hooks/scripts/smoke-test.sh`: **2785 linhas**
- `.github/hooks/hooks-lib/agent-stop-lib.sh`: **2196 linhas**
- `.github/hooks/scripts/session-start.sh`: **1500 linhas**
- `.github/hooks/hooks-lib/common.sh`: **1479 linhas**
- `.github/hooks/scripts/pre-tool-use.sh`: **995 linhas**
- `.github/hooks/scripts/log-prompt.sh`: **932 linhas**
- `.github/hooks/scripts/post-tool-use.sh`: **876 linhas**
- `.github/hooks/scripts/agent-stop.sh`: **686 linhas**

Conclusão: há base madura para hardening, porém a manutenção evolutiva pede modularização explícita por
camadas, com rollout em fases e critérios de aceite objetivos.

## Contexto da auditoria

- Escopo: `.github/hooks/` (scripts automáticos e libs associadas), com foco primário nos hooks
  acionados automaticamente via `.github/hooks/copilot-hooks.json`
- Runtime/stack considerada: Bash + jq + flock + sponge + arquivos JSONL/JSON de estado
- Premissas/restrições:
  - preservar protocolo atual de autorização (Template F + KEY para fechamento de SESSION)
  - preservar comportamento operacional existente durante migração (sem regressão de guardrails)

## Tabela-resumo

### Issues (Parte I)

| ID      | Arquivo/Linhas                                                                                                                                                                              | Categoria                      | Severidade | Título                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------- | ------------------------------------------------------------------------------------------ |
| GAP-001 | `.github/hooks/scripts/session-start.sh:1-1500`, `.github/hooks/scripts/pre-tool-use.sh:1-995`, `.github/hooks/scripts/post-tool-use.sh:1-876`, `.github/hooks/scripts/agent-stop.sh:1-686` | Arquitetura                    | Alta       | Scripts de ciclo crítico com responsabilidades múltiplas no mesmo arquivo                  |
| GAP-002 | `.github/hooks/scripts/pre-tool-use.sh:214-938`, `.github/hooks/scripts/post-tool-use.sh:176-739`, `.github/hooks/hooks-lib/agent-stop-lib.sh`                                              | Governança/Políticas           | Alta       | Regras de askQuestions espalhadas em múltiplos pontos com risco de drift                   |
| GAP-003 | `.github/hooks/scripts/subagent-start.sh:34-67`, `.github/hooks/scripts/subagent-stop.sh:41-74`, `.github/hooks/scripts/pre-compact.sh:40-73`, `.github/hooks/hooks-lib/common.sh`          | Confiabilidade                 | Média      | Guard de `session_id` parcialmente duplicado apesar de helpers existentes                  |
| GAP-004 | `.github/hooks/scripts/session-start.sh`, `.github/hooks/scripts/subagent-start.sh`, `.github/hooks/scripts/subagent-stop.sh`, `.github/hooks/scripts/pre-compact.sh`                       | Concorrência/Estado            | Alta       | Cobertura de lock (`flock`) inconsistente em scripts automáticos                           |
| GAP-005 | `.github/hooks/scripts/session-start.sh:109-1397`, `.github/hooks/scripts/session-end.sh:1-514`                                                                                             | Separação de responsabilidades | Média      | Bootstrap/encerramento acumulam lifecycle + analytics + briefing/report em caminho crítico |
| GAP-006 | `.github/hooks/scripts/smoke-test.sh:1-2785`                                                                                                                                                | Testabilidade                  | Média      | Teste monolítico dificulta isolamento de regressões por domínio                            |

### Upgrades (Parte II)

| ID      | Categoria            | Prioridade | Título                                                                  |
| ------- | -------------------- | ---------- | ----------------------------------------------------------------------- |
| UPG-001 | Manutenibilidade     | Alta       | Introduzir arquitetura modular em `hooks-lib/` por domínio              |
| UPG-002 | Confiabilidade       | Alta       | Unificar persistência de contexto em uma API transacional única         |
| UPG-003 | Segurança/Governança | Alta       | Isolar policy engine de autorização/Template F em módulo dedicado       |
| UPG-004 | Observabilidade      | Média      | Padronizar emitters de evento com contrato único e helpers declarativos |
| UPG-005 | Testabilidade        | Alta       | Quebrar `smoke-test.sh` em suíte por domínio + contrato + integração    |
| UPG-006 | Modernização         | Média      | Criar camada de compatibilidade durante migração (dual-path + flags)    |

---

## Parte I — Issues detalhados

### [ID: GAP-001] Scripts de ciclo crítico com responsabilidades múltiplas no mesmo arquivo

- **Arquivo/Linhas:**
  - `.github/hooks/scripts/session-start.sh:1-1500`
  - `.github/hooks/scripts/pre-tool-use.sh:1-995`
  - `.github/hooks/scripts/post-tool-use.sh:1-876`
  - `.github/hooks/scripts/agent-stop.sh:1-686`
- **Categoria:** Arquitetura
- **Severidade:** Alta
- **Descrição:**
  Cada script mistura inicialização de contexto, regras de negócio, detecção de anomalia,
  serialização de eventos, formatting de mensagens e side-effects externos. Isso aumenta o custo de
  mudança e reduz previsibilidade de impacto.
- **Cenário de manifestação:**
  Uma alteração pequena em policy (ex.: fechamento de turno) exige editar blocos longos em scripts
  diferentes, com alto risco de regressão cruzada.
- **Impacto:**
  Maior lead time de manutenção, dificuldade de revisão e risco de regressão funcional em hardening.
- **Proposta de correção:**
  Extrair domínio por módulos em `hooks-lib/` e manter scripts como *entrypoints magros* (orquestração).

### [ID: GAP-002] Regras de askQuestions espalhadas em múltiplos pontos com risco de drift

- **Arquivo/Linhas:**
  - `.github/hooks/scripts/pre-tool-use.sh:214-938`
  - `.github/hooks/scripts/post-tool-use.sh:176-739`
  - `.github/hooks/hooks-lib/agent-stop-lib.sh`
- **Categoria:** Governança/Políticas
- **Severidade:** Alta
- **Descrição:**
  A governança de Template F, continuidade A/D/E, invalidação de autorização e auto-auditoria está
  distribuída entre pre/post/stop, com regras parcialmente duplicadas.
- **Cenário de manifestação:**
  Atualização de regra em um ponto (ex.: `template_f_request_pending`) sem sincronização exata nos
  demais gera comportamentos contraditórios.
- **Impacto:**
  Bloqueios falsos, bypass involuntário ou mensagens conflitantes ao agente.
- **Proposta de correção:**
  Criar `hooks-lib/policy/turn-authorization.sh` + `hooks-lib/policy/askquestions.sh` como fonte única.

### [ID: GAP-003] Guard de session_id parcialmente duplicado apesar de helpers

- **Arquivo/Linhas:**
  - `.github/hooks/scripts/subagent-start.sh:34-67`
  - `.github/hooks/scripts/subagent-stop.sh:41-74`
  - `.github/hooks/scripts/pre-compact.sh:40-73`
  - `.github/hooks/hooks-lib/common.sh`
- **Categoria:** Confiabilidade
- **Severidade:** Média
- **Descrição:**
  Existem helpers canônicos em `common.sh`, mas parte do guard continua em implementações ad-hoc por script.
- **Cenário de manifestação:**
  Um fix de reconciliação aplicado no caminho canônico não cobre todos os hooks auxiliares.
- **Impacto:**
  Inconsistência de recuperação, aumento de divergência entre scripts e retrabalho.
- **Proposta de correção:**
  Centralizar reconciliação em função única obrigatória por hook (`guard_or_reconcile_session_context`).

### [ID: GAP-004] Cobertura de lock (`flock`) inconsistente em scripts automáticos

- **Arquivo/Linhas:**
  - Sem lock explícito: `.github/hooks/scripts/session-start.sh`, `.github/hooks/scripts/subagent-start.sh`, `.github/hooks/scripts/subagent-stop.sh`, `.github/hooks/scripts/pre-compact.sh`
  - Com lock explícito: `log-prompt.sh`, `pre-tool-use.sh`, `post-tool-use.sh`, `agent-stop.sh`, `session-end.sh`
- **Categoria:** Concorrência/Estado
- **Severidade:** Alta
- **Descrição:**
  Parte do pipeline transacional usa lock, parte não. Isso cria janelas de race em updates do
  `session-context` durante eventos concorrentes.
- **Cenário de manifestação:**
  Subagente inicia/encerra enquanto hooks de tool e stop atualizam o mesmo contexto.
- **Impacto:**
  Estado não determinístico, contadores incorretos e sinais falsos de conformidade.
- **Proposta de correção:**
  Padronizar lock em todo script que escreve contexto, via helper único de escrita transacional.

### [ID: GAP-005] Lifecycle e relatórios pesados no caminho crítico de start/end

- **Arquivo/Linhas:**
  - `.github/hooks/scripts/session-start.sh:109-1397`
  - `.github/hooks/scripts/session-end.sh:1-514`
- **Categoria:** Separação de responsabilidades
- **Severidade:** Média
- **Descrição:**
  Session start/end agregam tarefas de briefing, watchdog, tendências e geração de relatórios no
  mesmo fluxo do lifecycle primário.
- **Cenário de manifestação:**
  Latência ou falha em componente documental/analítico interfere no ciclo de sessão.
- **Impacto:**
  Menor resiliência operacional e aumento do tempo de startup/teardown.
- **Proposta de correção:**
  Separar “lifecycle mínimo” de “jobs auxiliares” (pós-evento assíncrono ou best-effort isolado).

### [ID: GAP-006] Teste de fumaça monolítico reduz foco de regressão

- **Arquivo/Linhas:** `.github/hooks/scripts/smoke-test.sh:1-2785`
- **Categoria:** Testabilidade
- **Severidade:** Média
- **Descrição:**
  O smoke atual cobre muita coisa, mas concentrado em um único arquivo grande com checks heterogêneos.
- **Cenário de manifestação:**
  Regressão em política de autorização é mascarada por ruído de outros checks; debug lento.
- **Impacto:**
  Menor velocidade para diagnosticar e corrigir falhas.
- **Proposta de correção:**
  Dividir em suites (`smoke-core`, `smoke-policy`, `smoke-recovery`, `smoke-session-close`, `smoke-git-push`).

---

## Parte II — Upgrades detalhados

### [ID: UPG-001] Arquitetura modular por domínio em `hooks-lib/`

- **Categoria:** Manutenibilidade
- **Prioridade:** Alta
- **Motivação:**
  Reduzir acoplamento e tornar cada regra rastreável em um único módulo.
- **Implementação proposta:**
  Criar subpastas:
  - `hooks-lib/runtime/` (input parsing, path resolution, locks)
  - `hooks-lib/context/` (read/write transacional, migração de schema)
  - `hooks-lib/policy/` (askQuestions, turn/session authorization)
  - `hooks-lib/events/` (emitters canônicos de audit)
  - `hooks-lib/recovery/` (heal v1/v2, reconnect rollover)
  - `hooks-lib/reporting/` (briefing e sumários)
- **Trade-offs e riscos:**
  Aumento inicial de arquivos e curva de migração; mitigado com rollout faseado.

### [ID: UPG-002] API transacional única para `session-context`

- **Categoria:** Confiabilidade
- **Prioridade:** Alta
- **Motivação:**
  Evitar padrões diferentes de `jq + sponge + mktemp + mv` espalhados nos scripts.
- **Implementação proposta:**
  Introduzir wrappers como:
  - `ctx_tx_read`
  - `ctx_tx_update`
  - `ctx_tx_update_with_guard`
  - `ctx_tx_merge`
  Todos com lock obrigatório, fallback portável e logs de falha padronizados.
- **Trade-offs e riscos:**
  Mudança ampla de chamadas; pede migração por script com validação incremental.

### [ID: UPG-003] Policy engine dedicado para autorização de TURN/SESSION

- **Categoria:** Segurança/Governança
- **Prioridade:** Alta
- **Motivação:**
  Eliminar drift entre pre/post/stop na mesma regra de negócio.
- **Implementação proposta:**
  Consolidar regra em funções puras:
  - `policy_eval_askquestions_input`
  - `policy_eval_askquestions_response`
  - `policy_eval_turn_close`
  - `policy_eval_session_close`
  E manter scripts apenas como orquestração e emissão.
- **Trade-offs e riscos:**
  Exige snapshots de contrato e testes de não-regressão para cada regra crítica.

### [ID: UPG-004] Contrato de eventos e emitters canônicos

- **Categoria:** Observabilidade
- **Prioridade:** Média
- **Motivação:**
  Garantir shape consistente dos eventos (`audit.jsonl`) e facilitar analytics.
- **Implementação proposta:**
  Definir `event-contracts.json` + helper `emit_event <type> <payload>` com validação mínima.
- **Trade-offs e riscos:**
  Pequeno overhead de validação; ganho em qualidade de dados supera custo.

### [ID: UPG-005] Testes por domínio + contrato

- **Categoria:** Testabilidade
- **Prioridade:** Alta
- **Motivação:**
  Melhorar diagnóstico e velocidade de regressão.
- **Implementação proposta:**
  Estruturar:
  - `smoke-core.sh`
  - `smoke-policy.sh`
  - `smoke-recovery.sh`
  - `smoke-close.sh`
  - `smoke-git-push.sh`
  + `smoke-all.sh` agregador.
- **Trade-offs e riscos:**
  Mais arquivos de teste para manter; compensado por isolamento e foco.

### [ID: UPG-006] Migração com dual-path e feature flags

- **Categoria:** Modernização
- **Prioridade:** Média
- **Motivação:**
  Reduzir risco de regressão durante refactor profundo.
- **Implementação proposta:**
  Introduzir flags:
  - `HOOKS_ENABLE_MODULAR_RUNTIME`
  - `HOOKS_ENABLE_MODULAR_POLICY`
  - `HOOKS_ENABLE_MODULAR_REPORTING`
  Executar modo sombra (legacy + modular em paralelo) antes de corte final.
- **Trade-offs e riscos:**
  Período de convivência aumenta complexidade temporária; reduz risco de indisponibilidade.

---

## Plano de execução por fases (com critérios claros)

### Fase 0 — Baseline e congelamento comportamental

**Objetivo:** capturar comportamento atual como contrato de regressão.

**Entregáveis:**
- Matriz de eventos esperados por hook automático
- Snapshot de regras críticas (askQuestions / close_key / session_id)

**Critérios de aceite:**
- Smoke atual verde
- Documento de contrato baseline aprovado

### Fase 1 — Extração do runtime comum

**Objetivo:** mover parsing/lock/path/update para `hooks-lib/runtime` e `hooks-lib/context`.

**Entregáveis:**
- API transacional única de contexto
- Adaptação dos 9 hooks automáticos para wrappers comuns

**Critérios de aceite:**
- 100% dos hooks automáticos escrevendo contexto via API única
- Nenhum `jq|sponge` ad-hoc restante nos entrypoints

### Fase 2 — Consolidação de policy engine

**Objetivo:** centralizar decisões de autorização e continuidade.

**Entregáveis:**
- `hooks-lib/policy/askquestions.sh`
- `hooks-lib/policy/turn-close.sh`
- `hooks-lib/policy/session-close.sh`

**Critérios de aceite:**
- Regras de Template F, continuação A/D/E e close_key em fonte única
- Sem duplicação de regra em pre/post/stop (apenas chamadas ao módulo)

### Fase 3 — Fatiar `session-start` e `session-end`

**Objetivo:** separar lifecycle mínimo de jobs auxiliares (briefing/reporting/analytics).

**Entregáveis:**
- `session-lifecycle-core.sh`
- `session-briefing-builder.sh`
- `session-reporting-jobs.sh`

**Critérios de aceite:**
- Caminho crítico de start/end reduzido
- Falha de job auxiliar não quebra lifecycle principal

### Fase 4 — Modularizar `agent-stop` além do estado atual

**Objetivo:** completar extração de blocos ainda remanescentes no `agent-stop.sh`.

**Entregáveis:**
- `hooks-lib/policy/stop-block.sh`
- `hooks-lib/subturn/subturn-lifecycle.sh`

**Critérios de aceite:**
- `agent-stop.sh` focado em orquestração (baixo volume de lógica inline)
- Cobertura de cenários de block/reblock mantida

### Fase 5 — Reestruturação de testes

**Objetivo:** dividir o smoke monolítico por domínio e criar suite agregadora.

**Entregáveis:**
- Suites modulares + runner único
- Fixtures de contrato por hook

**Critérios de aceite:**
- Diagnóstico por domínio (< 2 min para identificar classe de falha)
- Paridade funcional com cobertura atual

### Fase 6 — Rollout controlado e corte final

**Objetivo:** ativar módulos novos por flag e remover legado após estabilização.

**Entregáveis:**
- Modo sombra + relatório de divergência
- Corte de legado após janela estável

**Critérios de aceite:**
- 0 divergências críticas por N sessões consecutivas (definir N=20 recomendado)
- Flags legadas removidas com documentação atualizada

---

## Status atual e continuidade do programa

F0→F6 foi concluído com estabilização do smoke legado/domínios/all. A partir daqui, o foco passa a ser
**refatoração rigorosa de segunda onda**, orientada por redução estrutural e governança contínua.

> Referências vivas obrigatórias neste ciclo:
>
> - `DOCUMENTAÇÃO/PLANOS/PLANO-MODULARIZACAO-HOOKS-SYSTEM-CODE-AUDIT.md` (este documento)
> - `DOCUMENTAÇÃO/PLANOS/ROADMAP_MODULARIZACAO_HOOKS_CODE_AUDIT_2026-03-15.md`

### Classificação operacional de scripts (base para F7)

**1) Hooks automáticos (gatilho direto do runtime Copilot):**

- `session-start.sh`, `log-prompt.sh`, `pre-tool-use.sh`, `post-tool-use.sh`, `agent-stop.sh`,
  `subagent-start.sh`, `subagent-stop.sh`, `pre-compact.sh`, `session-end.sh`.

**2) Scripts manuais executados internamente por hooks automáticos:**

- `watchdog.sh`, `rotate-audit.sh`, `session-close.sh`, `session-checkpoint.sh`,
  `sync-tasks-to-docs.sh`, `generate-session-summary.sh`.

**3) Scripts manuais de uso direto (operação/usuário/manutenção):**

- Orquestração: `start-turn.sh`, `start-section.sh`, `continue-section.sh`, `section-end.sh`,
  `session-reminder.sh`, `manual-session-init.sh`.
- Backlog/findings: `add-task.sh`, `complete-task.sh`, `save-finding.sh`, `resolve-finding.sh`.
- Diagnóstico/manutenção: `smoke-test.sh`, `smoke-test-domains.sh`, `verify-hook-delivery.sh`,
  `export-metrics.sh`, `analytics.sh`, `sync-transcript-errors.sh`,
  `migrate-per-session-audit.sh`, `install-git-hooks.sh`, `on-git-push.sh`.

### Diretriz mandatória Script↔Lib

- Cada script em `.github/hooks/scripts/*.sh` deve mapear para ao menos uma lib em
  `.github/hooks/hooks-lib/`.
- Onde não houver referência explícita atual, criar backlog de adequação com owner, prioridade e
  prazo.
- Esta regularização é requisito de entrada de F7 e é executada primeiro em **F7.0**.
- Regra mandatória adicional: todo script órfão deve receber arquivo lib dedicado (wrapper inicial),
  seguido de migração progressiva da lógica para a lib.

### Estrutura-alvo de subpastas `hooks-lib/`

- `hooks-lib/runtime/`
- `hooks-lib/context/`
- `hooks-lib/policy/`
- `hooks-lib/lifecycle/`
- `hooks-lib/audit/`
- `hooks-lib/maintenance/`
- `hooks-lib/testing/`

> Objetivo: reduzir colisão semântica em arquivos monolíticos e tornar ownership por domínio
> explicitamente verificável.

## Nova trilha abrangente (F7→F12)

### F7 — Auditoria sistêmica profunda

**Objetivo:** mapear acoplamentos técnicos reais e risco de mudança.

**Subfases:**

- F7.0 Consolidação estrutural inicial (pastas/taxonomia/matriz Script↔Lib) — **primeira etapa executável do pacote F7**.

- F7.1 Inventário de dependências internas (scripts/libs/contracts).
- F7.2 Matriz de acoplamento por domínio + severidade.
- F7.3 Priorização P0/P1/P2 com backlog executável.
- F7.4 Criar libs dedicadas para scripts sem relação explícita Script↔Lib.
- F7.5 Migrar `hooks-lib/` para subpastas canônicas com compatibilidade incremental.
- F7.6 Implementar verificador estrutural Script↔Lib e taxonomia de subpastas.
- F7.7 Migrar módulos legados no root de `hooks-lib/` para subpastas por domínio com shims.
- F7.8 Publicar índice machine-readable `script/lib/domínio/owner`.
- F7.9 Consolidar governança de diretórios (`README` por subpasta + naming).
- F7.10 Integrar gate estrutural em task/pipeline de validação.

**Critérios de aceite:**

- Matriz publicada e revisada.
- Hotspots com owner e estratégia de mitigação.
- Backlog pronto para execução técnica.

### F8 — Contratos executáveis de policy e stop

**Objetivo:** transformar regras críticas em contratos verificáveis e versionados.

**Subfases:**

- F8.1 Versionar contratos de autorização/continuidade/close.
- F8.2 Cobrir reason codes e payloads obrigatórios no smoke.
- F8.3 Garantir compatibilidade retroativa dos campos legados.

**Critérios de aceite:**

- Contratos versionados com changelog.
- Paridade policy ↔ contrato sem drift.
- Quebra retroativa detectada por check automatizado.

### F9 — Reengenharia da suíte smoke

**Objetivo:** maximizar diagnóstico e reduzir tempo de triagem.

**Subfases:**

- F9.1 Quebrar grupos V90/AS em módulos menores por domínio.
- F9.2 Criar harness de fixtures/sandbox reutilizável.
- F9.3 Gerar relatório por domínio com causa provável.

**Critérios de aceite:**

- Falha mapeada ao domínio em um único salto.
- Triagem de falha em até 5 minutos.
- Compatibilidade preservada com `--quiet`, `--domains`, `--all`.

### F10 — Decomposição final dos módulos monolíticos

**Objetivo:** reduzir arquivos críticos e consolidar responsabilidade única.

**Subfases:**

- F10.1 Fatiar `agent-stop-lib.sh` por domínio funcional.
- F10.2 Fatiar `common.sh` por domínio operacional.
- F10.3 Padronizar APIs internas e documentação JSDoc.

**Critérios de aceite:**

- Redução mensurável de complexidade/volume nos hotspots.
- Entry points de hooks mais finos e previsíveis.
- Smoke e contratos verdes após cada extração.

### F11 — Observabilidade e SLO da refatoração

**Objetivo:** operar a evolução com métricas objetivas.

**Subfases:**

- F11.1 Definir KPIs/SLOs (falhas, tempo, divergência).
- F11.2 Persistir histórico de métricas.
- F11.3 Publicar tendências e alertas de regressão.

**Critérios de aceite:**

- Painel de métricas versionado no repositório.
- Alertas de regressão definidos.
- Revisão periódica operacional institucionalizada.

### F12 — Rollout final e governança permanente

**Objetivo:** concluir corte legado com segurança e manter evolução contínua.

**Subfases:**

- F12.1 Janela de estabilização com gates/rollback explícitos.
- F12.2 Corte/depreciação de legado residual.
- F12.3 Rotina obrigatória de sincronismo ROADMAP/PLANO/backlog.

**Critérios de aceite:**

- Janela estável sem divergência crítica.
- Legado residual oficialmente encerrado.
- Governança contínua formalizada.

## TODO mestre completo (F7→F12)

- [x] F7.0 Consolidação estrutural de pastas/scripts e pareamento obrigatório Script↔Lib.
- [x] F7.1 Inventário de dependências internas do hooks system.
- [x] F7.2 Matriz de acoplamento por domínio + severidade.
- [x] F7.3 Backlog priorizado P0/P1/P2 com owners.
- [x] F7.4 Criar arquivos lib para scripts ainda órfãos (100% de cobertura Script↔Lib).
- [x] F7.5 Criar subpastas canônicas em `hooks-lib/` e migrar libs por domínio.
- [x] F7.6 Adicionar check automatizado de conformidade estrutural Script↔Lib.
- [x] F7.7 Migrar módulos legados do root para subpastas com compatibilidade.
- [x] F7.8 Publicar índice canônico machine-readable da F7.
- [x] F7.9 Consolidar `README`/governança de naming por subpasta.
- [ ] F7.10 Integrar gate estrutural ao fluxo padrão de validação.
- [x] F8.1 Versionamento de contratos executáveis críticos.
- [ ] F8.2 Cobertura de reason codes/payloads no smoke.
- [ ] F8.3 Verificação de compatibilidade retroativa.
- [ ] F9.1 Split fino dos checks V90/AS por domínio.
- [ ] F9.2 Harness padrão de fixtures/sandbox.
- [ ] F9.3 Relatório de triagem por domínio.
- [ ] F10.1 Decomposição de `agent-stop-lib.sh`.
- [ ] F10.2 Decomposição de `common.sh`.
- [ ] F10.3 Padronização final de APIs internas/JSDoc.
- [ ] F11.1 Definição de KPIs/SLOs de refatoração.
- [ ] F11.2 Histórico de métricas persistido e validado.
- [ ] F11.3 Relatório periódico de tendência publicado.
- [ ] F12.1 Execução da janela de estabilização final.
- [ ] F12.2 Corte/depreciação do legado residual.
- [ ] F12.3 Governança contínua ROADMAP/PLANO/backlog ativa.

## Quadro técnico profundo por subfase (como executar)

### Artefatos executados na F7

- `DOCUMENTAÇÃO/HOOKS/F7-INVENTARIO-SCRIPT-LIB-2026-03-16.md`
- `DOCUMENTAÇÃO/HOOKS/F7-MATRIZ-ACOPLAMENTO-2026-03-16.md`
- `.github/hooks/scripts/verify-script-lib-coverage.sh`
- `.github/hooks/scripts/export-script-lib-index.sh`
- `.github/hooks/hooks-lib/testing/export-script-lib-index-lib.sh`
- `.github/hooks/state/f7-script-lib-index.json`
- Entradas canônicas por subpasta criadas para módulos legados (`runtime/common|config`, `policy/policy`, `lifecycle/session-*`).

> Status F7.7: **concluído** (contrapartes canônicas disponíveis e inversão root->shim aplicada).
>
> Status F7.8: **concluído** (índice machine-readable publicado e validado com `scripts_total=42` e `coverage.none=0`).
>
> Status F7.9: **concluído** (`hooks-lib/README.md` e `hooks-lib/*/README.md` padronizados com naming canônico).

### F7 — Auditoria sistêmica

- **F7.0**: consolidar taxonomia estrutural (auto, manual-runtime, manual-user, manutenção),
  publicar matriz Script↔Lib e registrar gaps de scripts sem lib explícita.
- **F7.1**: gerar inventário de dependências reais (`scripts`, `hooks-lib`, `contracts`) e marcar funções públicas sem consumidor explícito.
- **F7.2**: construir matriz de acoplamento com risco/impacto/rollback por domínio.
- **F7.3**: converter matriz em backlog acionável com owner, prioridade e sequência.
- **F7.4**: criar arquivo lib dedicado para cada script órfão e preparar migração incremental de responsabilidades.
- **F7.5**: materializar subpastas canônicas em `hooks-lib/` e realocar módulos por domínio com shims de compatibilidade.
- **F7.6**: implantar verificação automatizada para impedir novos scripts sem lib relacionada e libs fora da taxonomia.
- **F7.7**: migrar módulos legados do root (`common/config/policy/session-*`) para subpastas alvo com shims de transição.
- **F7.8**: gerar índice machine-readable com rastreio completo script/lib/domínio/owner.
- **F7.9**: consolidar documentação de domínio por subpasta e regra única de naming.
- **F7.10**: plugar verificador estrutural em rotina padrão de validação (task local e/ou pipeline).

**Done Definition F7**:

- taxonomia estrutural publicada e versionada,
- matriz Script↔Lib completa com gaps/owners,
- libs dedicadas criadas para scripts órfãos,
- árvore `hooks-lib/` reorganizada por subpastas canônicas,
- módulos legados de root migrados ou shims explicitamente controlados,
- índice machine-readable publicado e versionado,
- inventário publicado,
- matriz P0/P1/P2 fechada,
- backlog sincronizado em `pending-tasks.md`.

### F8 — Contratos executáveis

- **F8.1**: versionar contratos de autorização/continuidade/close em `contracts/`.
- **F8.2**: criar cobertura de reason codes e payloads mínimos na suíte smoke.
- **F8.3**: validar retrocompatibilidade (campos top-level + `hookSpecificOutput`).

**Done Definition F8**:

- contratos versionados com changelog,
- checks contratuais verdes,
- regressão de contrato detectável automaticamente.

### F9 — Smoke granular e diagnóstico rápido

- **F9.1**: separar V90/AS em suites menores por domínio funcional.
- **F9.2**: padronizar harness de fixtures/sandbox (seed + teardown + replay).
- **F9.3**: produzir relatório de triagem por domínio com causa provável.

**Done Definition F9**:

- split completo sem perda de cobertura,
- reutilização de fixture padrão,
- triagem de falha em até 5 minutos.

### F10 — Decomposição monolítica final

- **F10.1**: fatiar `agent-stop-lib.sh` em módulos de responsabilidade única.
- **F10.2**: fatiar `common.sh` por domínio operacional.
- **F10.3**: consolidar APIs internas e documentação JSDoc.

**Done Definition F10**:

- redução real de complexidade nos hotspots,
- entry points mais magros,
- paridade funcional preservada no smoke.

### F11 — Observabilidade/SLO de evolução

- **F11.1**: definir KPIs e SLOs oficiais do programa de refatoração.
- **F11.2**: persistir histórico de métricas por janela.
- **F11.3**: emitir relatório periódico com tendência e alertas.

**Done Definition F11**:

- metas e fontes de métricas explícitas,
- histórico auditável versionado,
- alertas operacionais acionáveis.

### F12 — Fechamento rigoroso e governança contínua

- **F12.1**: executar janela de estabilização com critérios de gate e rollback.
- **F12.2**: cortar/deprecar legado residual com checklist formal.
- **F12.3**: institucionalizar sincronismo contínuo ROADMAP/PLANO/backlog.

**Done Definition F12**:

- estabilidade comprovada na janela final,
- legado residual removido/deprecado de forma segura,
- rotina contínua de atualização documental ativa.
