# Melhorias e Upgrades Propostos — Sistema de Hooks

> **Status**: Backlog vivo | **Última atualização**: 2026-03-09 (sessão 5)
>
> Cada item classifica: prioridade, esforço (S/M/L), e categoria (fix/melhoria/upgrade profundo).

---

## Melhorias Implementadas (sessão 5 — 2026-03-09)

### Correção de Inconsistências de Campo — Schema v2 vs Implementação

**Motivação**: A sessão 4 planejou campos com nomes diferentes dos que `session-start.sh` (fonte
canônica) efetivamente escrevia. Os scripts foram reescritos com os nomes planejados, não os reais.
Teste e2e revelou todas as discrepâncias.

**Mapeamento de erros corrigidos** (nome planejado → nome canônico real):

| Campo planejado (errado)                          | Campo canônico (session-start.sh) | Script corrigido        |
| ------------------------------------------------- | --------------------------------- | ----------------------- |
| `session_stats.failures_total`                    | `session_stats.failures_detected` | session-checkpoint.sh   |
| `session_stats.failures_total`                    | `session_stats.failures_detected` | error-occurred.sh       |
| `session_stats.unauthorized_turns`                | `session_stats.turn_unauthorized` | (não chegou a ser usado)|
| `last_tool.result_type`                           | `last_tool.result`                | (já estava correto)     |
| `active_section.*`                                | `current_section.*`               | session-checkpoint.sh   |
| `active_section.*`                                | `current_section.*`               | start-section.sh        |
| `active_section.turn_number`                      | `current_section.turn_start`      | start-section.sh        |
| `conformidade.consecutive_unauthorized_closes`    | `compliance.consecutive_unauthorized` | session-checkpoint.sh |

**Correções adicionais descobertas**:

| #  | Correção                                                                   | Script           | Commit      |
| -- | -------------------------------------------------------------------------- | ---------------- | ----------- |
| C1 | `session-end.sh` passava `START_ISO` para helper que esperava `START_TS` (ms) | session-end.sh | `72c5a19a`  |
| C2 | `subagent-stop.sh` não incrementava `session_stats.subagent_calls`          | subagent-stop.sh | `72c5a19a`  |
| C3 | `error-occurred.sh` não incrementava `session_stats.errors_total`           | error-occurred.sh | `72c5a19a` |
| C4 | `session-checkpoint.sh` output usava `failures_total` (inconsistente)      | session-checkpoint.sh | `72c5a19a` |
| C5 | Comentário `active_section.{name, started_at, turn_number}` desatualizado  | start-section.sh | `72c5a19a`  |

**Validação**: shellcheck 0 warnings em todos os 14+ scripts · análise estática via grep/read_file.

---

## Melhorias Implementadas (sessão 4 — 2026-03-09)

### Schema v2 — Conceitos Claros e Arquitetura de Dados

**Motivação**: O schema anterior misturava dados de sessão, turno e chamada num nível flat,
dificultando consultas, causando bugs sutis e tornando o contexto confuso para o agente.

**Conceitos canônicos** (fixos pelo Copilot):

| Conceito           | Escopo                         | Boundary                                              |
| ------------------ | ------------------------------ | ----------------------------------------------------- |
| Sessão             | UUID gerado pelo Copilot       | `sessionStart` → `sessionEnd`                         |
| Turno              | Ciclo completo prompt→resposta | `userPromptSubmitted` → `agentStop`                   |
| Chamada            | Uso de uma ferramenta          | `preToolUse` → `postToolUse`                          |
| **Seção Temática** | Fase lógica nomeada            | Declarada pelo agente via `start-section.sh` *(NOVO)* |

**Estrutura do schema v2** (`session-context.json`) — campos canônicos verificados em 2026-03-09:
```json
{
  "session":        { "id", "started_at", "date_short", "ended_at", "source", "cwd" },
  "session_stats":  { "turn_count", "turn_authorized", "turn_unauthorized", "tools_total",
                      "tools_by_name", "failures_detected", "errors_total", "subagent_calls" },
  "current_turn":   { "number", "started_at", "tools_count", "tools_by_name",
                      "failures_count", "auth_requested", "auth_requested_at" },
  "current_section": { "name", "started_at", "turn_start", "description" },
  "last_tool":      { "name", "ts", "use_id", "result" },
  "compliance":     { "last_turn_authorized", "consecutive_unauthorized", "flag_file_exists" }
}
```

| #   | Mudança                                                                    | Scripts                               | Status |
| --- | -------------------------------------------------------------------------- | ------------------------------------- | ------ |
| —   | Schema v2: structs aninhadas substituem campo flat                         | todos                                 | ✅      |
| B1  | Remove `tools_used[]` array ilimitado → substituído por `tools_by_name {}` | `session-start.sh`, `pre-tool-use.sh` | ✅      |
| B2  | Remove `failure_count_unknown` fantasma → era campo inexistente no spec    | `post-tool-use.sh`                    | ✅      |
| B3  | `turn_duration_s` usava `last_tool.ts` em vez de `current_turn.started_at` | `agent-stop.sh`                       | ✅      |
| B4  | `session_summary` exibia dados de sessão acumulados, não do turno atual    | `agent-stop.sh`                       | ✅      |
| B5  | `session-end.sh` não chamava `session-checkpoint.sh` antes de encerrar     | `session-end.sh`                      | ✅      |
| B6  | Newline rogue em `log-prompt.sh` SESSION_ID read corrompía o UUID          | `log-prompt.sh`                       | ✅      |
| —   | **Novo**: `start-section.sh` — agente declara Seção Temática nomeada       | novo `start-section.sh`               | ✅      |

**Uso da Seção Temática**:
```bash
bash .github/hooks/scripts/start-section.sh "implementação do schema v2"
# → grava current_section em session-context.json
# → emite evento sectionStart no audit.jsonl
```

---

## Melhorias Implementadas (sessão 3 — 2026-03-09)

| #   | Melhoria                                                            | Scripts                                                        | Status         |
| --- | ------------------------------------------------------------------- | -------------------------------------------------------------- | -------------- |
| UP2 | Integração Findings ↔ Tasks (`--finding-id`, `--create-task`, sync) | `add-task.sh`, `save-finding.sh`, novo `sync-tasks-to-docs.sh` | ✅ Implementada |
| UP4 | Checkpoint de tarefas com diff (SHA-256 hash + `tasks_changed`)     | `session-checkpoint.sh`                                        | ✅ Implementada |
| UP5 | Exportação de métricas CSV/JSON                                     | novo `export-metrics.sh`                                       | ✅ Implementada |
| M4  | Quality gates: detecção real de sucesso/falha em `tool_response`    | `post-tool-use.sh`, `session-start.sh`                         | ✅ Implementada |
| M5  | `subagent-stop.sh` mais informativo                                 | `subagent-stop.sh`                                             | ✅ Implementada |
| —   | Sync automático de tarefas (a cada 5 turnos)                        | `agent-stop.sh`                                                | ✅ Implementada |

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
