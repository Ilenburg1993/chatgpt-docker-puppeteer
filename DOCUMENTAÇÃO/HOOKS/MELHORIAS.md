# Melhorias e Upgrades Propostos — Sistema de Hooks

> **Status**: Backlog vivo | **Última atualização**: 2026-03-09
>
> Cada item classifica: prioridade, esforço (S/M/L), e categoria (fix/melhoria/upgrade profundo).

---

## Bugs Corrigidos (nesta sessão — 2026-03-09)

| #   | Bug                                                                                   | Script                  | Fix aplicado                                       |
| --- | ------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------- |
| B1  | `auth_requested_this_turn` não resetado entre turnos → falso positivo na Estratégia 3 | `agent-stop.sh`         | Reset no final do turno + reset em `log-prompt.sh` |
| B2  | `failure_count_unknown` nome enganoso (a maioria são sucessos com body vazio)         | `post-tool-use.sh`      | Renomeado para `tool_responses_empty`              |
| B3  | Glob vazio em bash → array com literal do pattern quando não há checkpoints           | `session-checkpoint.sh` | Substituído por `mapfile + compgen`                |
| B4  | `/tmp/pre-commit-gate-output.txt` path fixo → race condition em commits paralelos     | `install-git-hooks.sh`  | Substituído por `mktemp` + `trap EXIT`             |

---

## Melhorias Pendentes

### M1 — Lifecycle de Findings (Média prioridade, Esforço M)

**Problema**: `findings.jsonl` cresce indefinidamente. Não há como marcar um finding como
resolvido/won't-fix, nem rastrear o lifecycle de cada achado.

**Proposta**:
- Adicionar `resolve-finding.sh <finding_id> <resolved|wont_fix> [razão]`
- Schema: `{event: "findingResolved", finding_id, resolution, reason, resolved_by_session}`
- Relatório diário mostra ratio abertos vs resolvidos

**Gate de aceitação**: `save-finding.sh` gera `finding_id` único; `resolve-finding.sh` funciona; relatório diário inclui seção "Findings Resolvidos Hoje".

---

### M2 — Sumarização de `tools_used` array (Média prioridade, Esforço S)

**Problema**: o array `tools_used` em `session-context.json` cresce indefinidamente na sessão
(150+ entradas na sessão atual). Isso torna `session-context.json` grande e operações `jq`
mais lentas.

**Proposta**:
- Em `agent-stop.sh`, após incrementar `turn_count`, substituir o array longo por um objeto de contagem: `tools_used_counts: {run_in_terminal: 45, read_file: 30, ...}`
- Manter apenas os últimos N tool names em `tools_used_recent` (e.g., últimas 10 chamadas)
- O array completo por turno vai para o checkpoint, que é o lugar certo para isso

**Gate de aceitação**: `session-context.json` não ultrapassa 50KB; `session-checkpoint.sh` ainda captura o histórico completo.

---

### M3 — Alertas de Threshold (Média prioridade, Esforço M)

**Problema**: quando `consecutive_unauthorized_closes > 2` ou `error_count > 10`, não há
sinalização adicional além do flag file.

**Proposta**:
- Em `agent-stop.sh`: se `consecutive_unauthorized_closes >= 3`, escrever `CRITICAL_ALERT.flag`
  com mensagem urgente e incrementar o nível de alerta no próximo briefing (blocos mais grandes, mais `⛔`)
- Em `session-start.sh`: escalonar a mensagem de alerta baseado no contador:
  - 1 violação: aviso padrão
  - 2+: aviso em maiúsculas + instrução de parar e pedir desculpas primeiro
  - 3+: bloqueio visual total do briefing com instrução de emergência

**Gate de aceitação**: com `consecutive_unauthorized_closes = 3`, o briefing mostra um bloco de alerta escalonado visualmente distinto.

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

### UP1 — Analytics Cross-Session (Alta, Esforço L)

**Visão**: agregar `tool-metrics.jsonl` e `audit.jsonl` de múltiplas sessões para gerar
tendências históricas: ferramentas mais usadas por tipo de tarefa, evolução da conformidade,
duração média de turnos por tipo de trabalho.

**Componentes**:
1. `analytics.sh <data_inicio> <data_fim>` — agrega métricas de um período
2. Formato de saída: JSON + relatório Markdown
3. Integração com `generate-daily-report.sh` para seção de tendências (7 dias vs 30 dias)

**Gate de aceitação**: `bash analytics.sh 2026-03-01 2026-03-09` gera relatório com top-5 ferramentas, taxa de conformidade histórica, erros por sessão.

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

### UP3 — Sistema de Health Check Contínuo (Média, Esforço M)

**Visão**: verificações proativas de saúde do sistema de hooks a cada sessão.

**Proposta** (no final de `session-start.sh`):
1. Verificar se `sponge` está instalado (crítico para operações atômicas)
2. Verificar se `jq` ≥ 1.6 está disponível
3. Verificar se `audit.jsonl` > 4500 linhas (pre-aviso de rotação)
4. Verificar integridade de `session-context.json` (JSON válido?)
5. Se qualquer check falhar: adicionar seção "⚠️ HEALTH WARNINGS" no briefing

**Gate de aceitação**: `session-start.sh` em máquina sem `sponge` exibe aviso no briefing; em máquina com `audit.jsonl` > 4500 linhas, exibe pre-aviso de rotação.

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
