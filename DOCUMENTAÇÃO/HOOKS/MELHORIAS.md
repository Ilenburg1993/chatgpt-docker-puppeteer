# Melhorias e Upgrades Propostos — Sistema de Hooks

> **Status**: Backlog vivo | **Última atualização**: 2026-03-09 (sessão 3)
>
> Cada item classifica: prioridade, esforço (S/M/L), e categoria (fix/melhoria/upgrade profundo).

---

## Melhorias Implementadas (sessão 3 — 2026-03-09)

| #   | Melhoria                                                            | Scripts                                                                        | Status         |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------- |
| UP2 | Integração Findings ↔ Tasks (`--finding-id`, `--create-task`, sync) | `add-task.sh`, `save-finding.sh`, novo `sync-tasks-to-docs.sh`                 | ✅ Implementada |
| UP4 | Checkpoint de tarefas com diff (SHA-256 hash + `tasks_changed`)     | `session-checkpoint.sh`                                                        | ✅ Implementada |
| UP5 | Exportação de métricas CSV/JSON                                     | novo `export-metrics.sh`                                                       | ✅ Implementada |
| M4  | Quality gates: detecção real de sucesso/falha em `tool_response`    | `post-tool-use.sh`, `session-start.sh`                                         | ✅ Implementada |
| M5  | `subagent-stop.sh` mais informativo                                 | `subagent-stop.sh`                                                             | ✅ Implementada |
| —   | Sync automático de tarefas (a cada 5 turnos)                         | `agent-stop.sh`                                                                | ✅ Implementada |

---

## Melhorias Implementadas (sessão 2 — 2026-03-09)

| #   | Melhoria                                                    | Scripts                                                | Status         |
| --- | ----------------------------------------------------------- | ------------------------------------------------------ | -------------- |
| M1  | Lifecycle de Findings — `finding_id` + `resolve-finding.sh` | `save-finding.sh`, novo `resolve-finding.sh`           | ✅ Implementada |
| M2  | Sumarização de `tools_used` array                           | `pre-tool-use.sh`, `session-start.sh`, `agent-stop.sh` | ✅ Implementada |
| M3  | Alertas de Threshold escalonados                            | `session-start.sh`                                     | ✅ Implementada |
| UP1 | Analytics Cross-Session                                     | novo `analytics.sh`                                    | ✅ Implementada |
| UP3 | Health Check automático no session-start                    | `session-start.sh`                                     | ✅ Implementada |

---

## Bugs Corrigidos (sessão 1 — 2026-03-09)

| #   | Bug                                                                                   | Script                  | Fix aplicado                                       |
| --- | ------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------- |
| B1  | `auth_requested_this_turn` não resetado entre turnos → falso positivo na Estratégia 3 | `agent-stop.sh`         | Reset no final do turno + reset em `log-prompt.sh` |
| B2  | `failure_count_unknown` nome enganoso (a maioria são sucessos com body vazio)         | `post-tool-use.sh`      | Renomeado para `tool_responses_empty`              |
| B3  | Glob vazio em bash → array com literal do pattern quando não há checkpoints           | `session-checkpoint.sh` | Substituído por `mapfile + compgen`                |
| B4  | `/tmp/pre-commit-gate-output.txt` path fixo → race condition em commits paralelos     | `install-git-hooks.sh`  | Substituído por `mktemp` + `trap EXIT`             |

---

## Melhorias Pendentes

### ~~M1 — Lifecycle de Findings~~ ✅ IMPLEMENTADA (sessão 2)

**Implementação**:
- `save-finding.sh` agora gera `finding_id` único (`f_<timestamp_ms>_<RANDOM>`) em cada achado
- `resolve-finding.sh` (novo): marcação de resolução append-only no JSONL; idempotente; valida existência do ID
- `analytics.sh` exibe findings abertos vs resolvidos por severidade

**Gate de aceitação**: ✅ `save-finding.sh` gera `finding_id`; `resolve-finding.sh` funciona; `analytics.sh` inclui seção de Findings.

---

### ~~M2 — Sumarização de `tools_used` array~~ ✅ IMPLEMENTADA (sessão 2)

**Implementação**:
- `pre-tool-use.sh`: array `tools_used[]` (crescia indefinidamente) → `tools_used_counts{}` (objeto de contagem) + `tools_used_recent[]` (janela deslizante de 20) + `tools_used_total` (int)
- `session-start.sh`: inicialização atualizada; `failure_count_unknown` renomeado para `tool_responses_empty`
- `agent-stop.sh`: `session_summary` usa `tools_used_total` ao invés de `length do array`

**Gate de aceitação**: ✅ `session-context.json` não cresce com o número de chamadas de ferramenta.

---

### ~~M3 — Alertas de Threshold~~ ✅ IMPLEMENTADA (sessão 2)

**Implementação** em `session-start.sh`:
- `consecutive_unauthorized_closes = 1`: `⛔ AVISO DE VIOLAÇÃO`
- `consecutive_unauthorized_closes = 2`: `⛔⛔ SEGUNDA VIOLAÇÃO CONSECUTIVA`
- `consecutive_unauthorized_closes >= 3`: `⛔⛔⛔ VIOLAÇÃO CRÍTICA REITERADA (Nx consecutivas)`

**Gate de aceitação**: ✅ Briefing escalona visualmente o alerta conforme contagem acumulada.

---

### M4 — Quality Gates na Detecção de success/failure Reais (Backlog, Esforço L)

**Problema**: `post-tool-use.sh` usa heurística de "body vazio = unknown" para determinar
sucesso, pois o payload do Copilot não inclui campo `result_type` explícito.

**Proposta longo prazo**:
- Monitorar o payload real de `postToolUse` em `raw-post-input.jsonl` para encontrar padrões
  que indiquem falha real (e.g., erro de ferramenta na resposta)
- Atualizar a lógica quando o schema do Copilot evoluir para incluir indicador de falha

**Status atual**: sem ação imediata — monitorar `raw-post-input.jsonl` para novos padrões.

---

### M5 — `subagent-stop.sh` mais informativo (Backlog, Esforço S)

**Problema**: `subagent-stop.sh` loga apenas `{event, session_id, timestamp}` — sem dados
do subagente (nome, duração, resultado).

**Proposta**:
- Extrair campos do payload (se disponíveis): `subagent_name`, qualquer campo de resultado
- Calcular duração aproximada usando `last_tool_ts`
- Fazer referência ao `tool_use_id` do subagente se presente no payload

**Gate de aceitação**: audit.jsonl mostra informações úteis de subagentes além de timestamps.

---

## Upgrades Profundos

### ~~UP1 — Analytics Cross-Session~~ ✅ IMPLEMENTADA (sessão 2)

**Implementação**: `analytics.sh` (novo):
- Saída Markdown ou `--json` para automação
- Seções: resumo global, top-10 ferramentas com % do total, performance P50/P95 por ferramenta,
  compliance por sessão (✅/⚠️), findings por severidade com abertos vs resolvidos, atividade por dia
- Uso: `bash analytics.sh` | `bash analytics.sh --output relatorio.md` | `bash analytics.sh --json`

**Gate de aceitação**: ✅ Relatório gerado com todas as seções; `--json` mode para automação funcional.

---

### UP2 — Integração com Sistema de Tarefas do Projeto (Alta, Esforço L)

**Visão**: `pending-tasks.md` é o backlog do agente. Hoje não há sincronização com
`DOCUMENTAÇÃO/BUGS/` ou com o tracker do GitHub Issues.

**Proposta**:
1. `sync-tasks-to-docs.sh` — exporta tarefas concluídas para `DOCUMENTAÇÃO/RELATORIOS/`
2. Opção em `save-finding.sh` para criar automaticamente uma tarefa via `add-task.sh`
3. Referência cruzada por ID entre findings e tasks

**Gate de aceitação**: ao concluir uma tarefa tagueada com finding, o relatório de sessão mostra o link finding → task → resolved.

---

### ~~UP3 — Sistema de Health Check Contínuo~~ ✅ IMPLEMENTADA (sessão 2)

**Implementação** em `session-start.sh`:
- Verifica: `sponge` instalado (crítico), `jq` instalado (crítico), `audit.jsonl` tamanho (aviso >3000, crítico >4500), `session-context.json` com permissão de escrita, findings críticos/high abertos
- Nova seção "**Saúde do Sistema**" no `session-briefing.md`: status (✅/⚠️/⛔) + lista de problemas
- Executa automaticamente a cada sessão sem overhead significativo

**Gate de aceitação**: ✅ Máquina sem `sponge` exibe aviso; `audit.jsonl` > 4500 linhas exibe alerta crítico.

---

### UP4 — Checkpoint de Tarefas com Diff (Backlog, Esforço M)

**Visão**: o `session-checkpoint.sh` captura o contagem de tarefas por prioridade, mas não
quais tarefas foram adicionadas ou concluídas desde o checkpoint anterior.

**Proposta**:
- Adicionar ao checkpoint: hash SHA-256 do `pending-tasks.md` atual
- Se hash changed VS checkpoint anterior: registrar `tasks_changed: true`
- Opcional: capturar diff de tarefas (adicionadas/removidas)

**Gate de aceitação**: checkpoint.json inclui `tasks_hash` e `tasks_changed`; diff disponível via comparação de checkpoints consecutivos.

---

### UP5 — Exportação de Métricas para CSV (Backlog, Esforço S)

**Visão**: facilitar análise externa (Excel, Jupyter) das métricas de performance.

**Proposta**:
- `export-metrics.sh [formato: csv|json] [data_inicio] [data_fim]`
- Exporta `tool-metrics.jsonl` filtrado por período em CSV: `timestamp,tool_name,duration_ms,result_type`
- Exporta summary de conformidade por sessão em CSV

**Gate de aceitação**: `bash export-metrics.sh csv 2026-03-01 2026-03-09 > metricas.csv` gera CSV válido com cabeçalho.

---

## Tabela de Priorização

| ID  | Título                         | Prioridade | Esforço | Categoria        |
| --- | ------------------------------ | ---------- | ------- | ---------------- |
| M1  | Lifecycle de Findings          | Média      | M       | Melhoria         |
| M2  | Sumarização de tools_used      | Média      | S       | Melhoria         |
| M3  | Alertas de Threshold           | Média      | M       | Melhoria         |
| M4  | Detection real de falhas       | Backlog    | L       | Melhoria         |
| M5  | subagent-stop mais informativo | Backlog    | S       | Melhoria         |
| UP1 | Analytics Cross-Session        | Alta       | L       | Upgrade Profundo |
| UP2 | Integração Tarefas ↔ Docs      | Alta       | L       | Upgrade Profundo |
| UP3 | Health Check Contínuo          | Média      | M       | Upgrade Profundo |
| UP4 | Checkpoint com Diff de Tarefas | Backlog    | M       | Upgrade Profundo |
| UP5 | Exportação CSV de Métricas     | Backlog    | S       | Upgrade Profundo |

---

*Atualizar este documento ao aprovar ou implementar qualquer item.
Para registrar novos achados de bug: `bash .github/hooks/scripts/save-finding.sh ...`
Para nova tarefa aprovada: `bash .github/hooks/scripts/add-task.sh ...`*
