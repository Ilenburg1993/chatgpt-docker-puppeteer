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

## Conclusão e próximos passos

1. Aprovar este plano faseado (principalmente Fases 1-3 como MVP de modularização).
2. Definir ordem de implementação inicial: **Fase 1 → Fase 2 → Fase 3**.
3. Iniciar execução com PR pequeno por fase, usando modo sombra quando aplicável.

## Perguntas de continuidade

- Você quer que eu abra agora a **Fase 1** com a proposta de estrutura de pastas/arquivos alvo?
- Deseja que eu já traga uma matriz de “arquivo atual → módulo destino” para cada hook automático?
- Quer priorizar primeiro os hooks mais críticos (`pre/post/agent-stop`) antes de `session-start/end`?
