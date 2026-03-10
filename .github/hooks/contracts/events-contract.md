# Events Contract — Sistema de Hooks

**Status**: Canônico. **Última atualização**: 2026-03-11. **Versão**: 1.1

> Este documento é o contrato formal de todos os eventos que fluem pelo sistema de hooks.
> Toda adição ou mudança de schema deve ser refletida aqui antes de ser implementada.

---

## Hierarquia de eventos

```
SESSION
  └── userPromptSubmitted        → log-prompt.sh
  └── SECTION
        └── TURN
              ├── preToolUse     → pre-tool-use.sh       (um por tool call)
              └── postToolUse    → post-tool-use.sh       (um por tool call)
              └── postToolUseFailure → tool-use-failure.sh
        └── agentStop            → agent-stop.sh          (fim de TURN)
  └── subagentStart              → subagent-start.sh, pre-tool-use.sh (hardening)
  └── subagentStop               → subagent-stop.sh
  └── preCompact                 → pre-compact.sh
  └── sessionEnd                 → session-end.sh
```

---

## Eventos Copilot (externos — input via stdin do hook)

### `sessionStart`
- **Script**: `scripts/session-start.sh`
- **Timeout**: 15s
- **Input schema** (stdin JSON):
  ```json
  {
    "timestamp":     "2026-03-10T06:00:00Z",
    "hook_event_name": "SessionStart",
    "session_id":    "uuid-v4",
    "cwd":           "/workspaces/repo",
    "source":        "new | resumed"
  }
  ```
- **Output** (fd 3 → additionalContext):
  ```json
  { "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "<briefing>" } }
  ```
- **Efeitos colaterais**:
  - Cria/sobrescreve `state/session-context.json` (Schema v8)
  - Gera `state/session-briefing.md`
  - Roda `watchdog.sh --quiet` → `state/watchdog-report.json`
  - Roda `rotate-audit.sh` (auto-rotação se > 5000 linhas)
  - Auto-limpa `UNAUTHORIZED_CLOSE.flag` se for de sessão diferente (G9-03)
  - Gera close_key: `ENCERRAR-XXXXXXXX`
  - Loga `sessionStart` em `logs/audit.jsonl`
- **Invariante**: session "início" sempre criada como primeira SECTION

### `userPromptSubmitted`
- **Script**: `scripts/log-prompt.sh`
- **Timeout**: 10s
- **Input schema** (stdin JSON):
  ```json
  {
    "timestamp":       "2026-03-10T06:01:00Z",
    "hook_event_name": "UserPromptSubmitted",
    "session_id":      "uuid-v4",
    "prompt":          "<texto do prompt do usuário>"
  }
  ```
- **Output**: nenhum
- **Efeitos colaterais**:
  - Reseta `current_turn.*` em `session-context.json`
  - Incrementa `session_stats.turn_count`
  - Loga `userPromptSubmitted` em `logs/audit.jsonl`

### `preToolUse`
- **Script**: `scripts/pre-tool-use.sh`
- **Timeout**: 15s
- **Variável de ambiente**: `HOOKS_LOG_LEVEL=INFO`
- **Input schema** (stdin JSON):
  ```json
  {
    "timestamp":       "2026-03-10T06:01:05Z",
    "hook_event_name": "PreToolUse",
    "session_id":      "uuid-v4",
    "tool_name":       "run_in_terminal",
    "tool_input":      { "...": "..." },
    "tool_use_id":     "tooluse_xxx",
    "transcript_path": "/path/to/transcript",
    "cwd":             "/workspaces/repo"
  }
  ```
- **Output**: nenhum (logging-only; nunca emite `permissionDecision:deny`)
- **Efeitos colaterais**:
  - Redacta credentials (GitHub tokens, Bearer, etc.) antes de log
  - Loga `preToolUse` em `logs/audit.jsonl` com args redactados
  - Atualiza `current_turn.tools_count`, `tools_by_name`, `last_tool`
  - Detecta `vscode_askQuestions` → seta `current_turn.auth_requested = true`
  - Detecta `runSubagent`/`Task` → seta `auth_requested=true`, `subagent_delegated=true`; loga `subagentStart` (hardening v6)
  - Session_id guard: ignora payload se session_id ≠ ctx ativo (v5)

### `postToolUse`
- **Script**: `scripts/post-tool-use.sh`
- **Timeout**: 15s
- **Input schema** (stdin JSON):
  ```json
  {
    "timestamp":       "2026-03-10T06:01:10Z",
    "hook_event_name": "PostToolUse",
    "session_id":      "uuid-v4",
    "tool_name":       "run_in_terminal",
    "tool_use_id":     "tooluse_xxx",
    "tool_input":      { "...": "..." },
    "tool_response":   { "...": "..." }
  }
  ```
- **Output**: nenhum
- **Efeitos colaterais**:
  - Loga `postToolUse` em `logs/audit.jsonl`
  - Atualiza `session_stats.tool_calls_total`
  - Detecta close_key em tool_response → seta `session_stats.close_key_confirmed`
  - Session_id guard ativo

### `postToolUseFailure`
- **Script**: `scripts/tool-use-failure.sh`
- **Timeout**: 10s
- **Input schema** (stdin JSON):
  ```json
  {
    "timestamp":       "2026-03-10T06:01:10Z",
    "hook_event_name": "PostToolUseFailure",
    "session_id":      "uuid-v4",
    "tool_name":       "run_in_terminal",
    "tool_use_id":     "tooluse_xxx",
    "error":           "Error message"
  }
  ```
- **Output**: nenhum
- **Efeitos colaterais**:
  - Loga `toolUseFailure` em `logs/audit.jsonl`
  - Incrementa `current_turn.failures_count`

### `agentStop`
- **Script**: `scripts/agent-stop.sh`
- **Timeout**: 10s
- **Input schema** (stdin JSON):
  ```json
  {
    "timestamp":        "2026-03-10T06:05:00Z",
    "hook_event_name":  "AgentStop",
    "session_id":       "uuid-v4",
    "stop_hook_active": false
  }
  ```
- **Output** (stdout, apenas quando NÃO autorizado):
  ```json
  {
    "hookSpecificOutput": {
      "hookEventName": "Stop",
      "decision":      "block",
      "reason":        "Turno não autorizado — vscode_askQuestions não foi chamado"
    },
    "systemMessage": "<mensagem rica com estado contextualizado>"
  }
  ```
- **Lógica de autorização** (4 estratégias em cascata):
  1. Busca `vscode_askQuestions` **ou** `subagentStart` após último `userPromptSubmitted` no audit.jsonl
  2. Fallback: últimas 150 linhas do audit.jsonl (aceita `vscode_askQuestions` ou `subagentStart`)
  3. Fallback: `current_turn.auth_requested` do session-context.json
  4. Fallback: `current_turn.subagent_delegated` do session-context.json (novo em v6)
- **Hardening v5**:
  - `decision:block` quando sem autorização E `stop_hook_active=false` E `block_count < 1`
  - Session_id guard: bloqueia escrita se session_id ≠ ctx ativo
  - HEAL v1: cura session_id se source=`manual_recovery`
  - **HEAL v2** (G9-04): cura após 3 mismatches consecutivos com mesmo "got" session_id
  - **Hardening v6**: aceita `subagentStart` como sinal de autorização (Strategy 4 + Strategies 1/2 atualizadas)
- **Efeitos colaterais**:
  - Loga `agentStop` sempre
  - Loga `turnEnd_authorized` ou `turnEnd_BLOCKED` ou `turnEnd_UNAUTHORIZED`
  - Loga `auth_via_subagent_delegation` quando Strategy 4 é ativada
  - Remove ou cria `state/UNAUTHORIZED_CLOSE.flag`
  - Reseta `current_turn.*` e incrementa `session_stats.*`
  - Gera `turnStart_enriched_auto` se intent não declarado

### `subagentStart`
- **Scripts**: `scripts/subagent-start.sh` (hook Copilot), `scripts/pre-tool-use.sh` (hardening v6 — quando `runSubagent`/`Task` detectado)
- **Timeout**: 10s
- **Input schema**: `{ timestamp, hook_event_name, session_id }`
- **Output**: nenhum
- **Efeitos colaterais**:
  - Loga `subagentStart` em audit.jsonl com `tool_name`, `tool_use_id`, `message`
  - Quando emitido por `pre-tool-use.sh`: seta `auth_requested=true`, `subagent_delegated=true` no contexto
- **Consumido por**: `agent-stop.sh` — aceito como sinal de autorização nas Strategies 1 e 2

### `subagentStop`
- **Script**: `scripts/subagent-stop.sh`
- **Timeout**: 10s
- **Input schema**: `{ timestamp, hook_event_name, session_id }`
- **Output**: nenhum
- **Efeitos colaterais**: loga `subagentStop` em audit.jsonl; session_id guard ativo

### `preCompact`
- **Script**: `scripts/pre-compact.sh`
- **Timeout**: 10s
- **Input schema**: `{ timestamp, hook_event_name, session_id }`
- **Output**: nenhum
- **Efeitos colaterais**: loga `preCompact` em audit.jsonl; incrementa `session_stats.compaction_count`

### `sessionEnd`
- **Script**: `scripts/session-end.sh`
- **Timeout**: 60s
- **Input schema**: `{ timestamp, hook_event_name, session_id, reason }`
- **Output**: nenhum
- **Efeitos colaterais**:
  - Valida SESSION CLOSE KEY
  - Fecha SECTION ativa
  - Gera `session-summary.json`
  - Loga `sessionEnd` em audit.jsonl
  - Cria `SESSION_CLOSE_NO_KEY.flag` se chave não foi fornecida

---

## Eventos internos (audit.jsonl)

Todos os eventos em `logs/audit.jsonl` são JSON objects com pelo menos:
```json
{ "event": "...", "session_id": "uuid", "timestamp": "ISO-8601" }
```

### Tabela canônica de eventos

| Evento                        | Produzido por                        | Consumido por                                | Campos obrigatórios extras                                                                                                                    |
| ----------------------------- | ------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionStart`                | `session-start.sh`                   | `generate-session-summary.sh`                | `close_key`, `source`, `section_id`                                                                                                           |
| `userPromptSubmitted`         | `log-prompt.sh`                      | `agent-stop.sh` (fronteira)                  | `turn_number`, `section_turn`, `section_id`                                                                                                   |
| `preToolUse`                  | `pre-tool-use.sh`                    | `export-metrics.sh`                          | `tool_name`, `tool_use_id`, `args` (redacted)                                                                                                 |
| `postToolUse`                 | `post-tool-use.sh`                   | `export-metrics.sh`, `analytics.sh`          | `tool_name`, `tool_use_id`, `duration_ms`                                                                                                     |
| `toolUseFailure`              | `tool-use-failure.sh`                | —                                            | `tool_name`, `error`                                                                                                                          |
| `agentStop`                   | `agent-stop.sh`                      | —                                            | `turn_duration_s`, `stop_hook_active`, `tools_count`                                                                                          |
| `turnEnd_authorized`          | `agent-stop.sh`                      | `generate-session-summary.sh`                | `turn_number`, `section_turn`, `turn_duration_s`                                                                                              |
| `turnEnd_BLOCKED`             | `agent-stop.sh`                      | —                                            | `block_count`, `turn_id`                                                                                                                      |
| `turnEnd_UNAUTHORIZED`        | `agent-stop.sh`                      | `watchdog.sh`                                | `turn_number`                                                                                                                                 |
| `turnStart_enriched_auto`     | `agent-stop.sh`                      | —                                            | `intent`, `auto_generated: true`                                                                                                              |
| `turnStart_enriched`          | `start-turn.sh`                      | —                                            | `intent`, `intent_declared: true`                                                                                                             |
| `sectionStart`                | `start-section.sh`                   | `generate-section-summary.sh`                | `section_name`, `section_id`, `section_number`                                                                                                |
| `sectionEnd`                  | `section-end.sh`, `start-section.sh` | `generate-section-summary.sh`                | `section_id`, `reason`                                                                                                                        |
| `sessionEnd`                  | `session-end.sh`                     | —                                            | `reason`, `close_key_valid`                                                                                                                   |
| `sessionEnd_no_key`           | `session-end.sh`                     | —                                            | —                                                                                                                                             |
| `session_id_mismatch`         | `agent-stop.sh`                      | `watchdog.sh`                                | `expected`, `got`, `consecutive_count`                                                                                                        |
| `session_id_healed`           | `agent-stop.sh`                      | —                                            | `old_session_id`, `new_session_id`, `source`                                                                                                  |
| `authViolation_reset`         | `reset-auth-violation.sh`            | —                                            | `reason`, `original_flag_ts`                                                                                                                  |
| `authViolation_stale_cleared` | `session-start.sh`                   | —                                            | `old_session_id`, `flag_timestamp`                                                                                                            |
| `auditRotated`                | `rotate-audit.sh`                    | —                                            | `archive_file`, `archived_lines`, `kept_lines`                                                                                                |
| `gitPush`                     | `on-git-push.sh`                     | `agent-stop.sh` (pending_section_after_push) | `branch`, `ref`                                                                                                                               |
| `preCompact`                  | `pre-compact.sh`                     | —                                            | `compaction_count`                                                                                                                            |
| `subagentStart`               | `subagent-start.sh`, `pre-tool-use.sh` (hardening) | `agent-stop.sh` (Strategy 1+2 autorização) | `tool_name`, `tool_use_id`, `message`                                                          |
| `subagentStop`                | `subagent-stop.sh`                   | —                                            | —                                                                                                                                             |
| `auth_via_subagent_delegation` | `agent-stop.sh`                     | —                                            | `message` — indica que Strategy 4 autorizou o turno via flag `subagent_delegated`                                                            |
| `sectionContinued`            | `continue-section.sh`                | —                                            | `turn_number`, `section_name`, `section_id`, `reason` — seção mantida após `git push` (flag `pending_section_after_push` limpo)              |
| `sessionClose_key_validated`  | `post-tool-use.sh`                   | —                                            | `close_key` — chave de encerramento de sessão validada com sucesso no vscode_askQuestions                                                     |
| `errorOccurred`               | `error-occurred.sh`                  | `session-end.sh` (contagem)                  | `errorName`, `errorMsg` — log resumido em `audit.jsonl`                                                                                       |
| `errorDetail`                 | `error-occurred.sh`                  | —                                            | `errorName`, `errorMsg`, `stack` — log completo em `errors.jsonl` (não em audit.jsonl)                                                        |
| `session_manual_recovery`     | `manual-session-init.sh`             | —                                            | `message` — sessão inicializada manualmente quando sessionStart não disparou                                                                  |
| `finding_saved`               | `save-finding.sh`                    | `watchdog.sh`                                | `module`, `severity`, `type`                                                                                                                  |
| `task_added`                  | `add-task.sh`                        | —                                            | `priority`, `title`                                                                                                                           |
| `task_completed`              | `complete-task.sh`                   | —                                            | `title`                                                                                                                                       |
| `session_auto_recovery`       | `pre-tool-use.sh`                    | —                                            | `source: "auto_recovery"` — sessionStart não disparou; contexto mínimo criado                                                                 |
| `askQuestions_response`       | `post-tool-use.sh`                   | —                                            | `response`, `tool_use_id` — resposta do usuário ao vscode_askQuestions                                                                        |
| `sectionEnd_orphan`           | `section-end.sh`                     | —                                            | Aviso: section-end.sh chamado sem abrir nova seção imediatamente; `current_section.name` ficará null até agent-stop.sh criar seção `retomada` |
| `session_id_healed`           | `pre-tool-use.sh`                    | —                                            | session_id corrigido por mecanismo auto-heal (HEAL v2)                                                                                        |

### Eventos de diagnóstico (raramente produzidos)
| Evento                   | Produzido por              | Significado                       |
| ------------------------ | -------------------------- | --------------------------------- |
| `watchdog_run`           | `watchdog.sh`              | Resultado do watchdog             |
| `session_checkpoint`     | `session-checkpoint.sh`    | Snapshot antes de mudança crítica |
| `daily_report_generated` | `generate-daily-report.sh` | Relatório diário gerado           |

---

## Arquivos de estado (state/)

| Arquivo                     | Proprietário                      | Descrição                                     | TTL                                                      |
| --------------------------- | --------------------------------- | --------------------------------------------- | -------------------------------------------------------- |
| `session-context.json`      | `session-start.sh`                | Estado vivo da sessão (Schema v8)             | 1 sessão                                                 |
| `session-briefing.md`       | `session-start.sh`                | Briefing injetado no LLM                      | 1 sessão                                                 |
| `watchdog-report.json`      | `watchdog.sh`                     | Último relatório de saúde                     | 1 run                                                    |
| `pending-tasks.md`          | `add-task.sh`, `complete-task.sh` | Backlog canônico                              | Permanente                                               |
| `UNAUTHORIZED_CLOSE.flag`   | `agent-stop.sh`                   | Flag de violação de autorização               | Até next turnEnd_authorized ou sessão différente (G9-03) |
| `AUTHORIZED_CLOSE.flag`     | `agent-stop.sh`                   | Flag simétrico de autorização                 | 1 turno                                                  |
| `SESSION_CLOSE_NO_KEY.flag` | `session-end.sh`                  | Flag de encerramento sem chave                | Até next briefing                                        |
| `.mismatch_track.json`      | `agent-stop.sh`                   | Contador de mismatches consecutivos (HEAL v2) | Até heal ou sessão nova                                  |

---

## Arquivos de log (logs/)

| Arquivo                       | Escritor                                | Rotação                                    | Descrição                         |
| ----------------------------- | --------------------------------------- | ------------------------------------------ | --------------------------------- |
| `audit.jsonl`                 | Todos os scripts                        | Auto via `rotate-audit.sh` (> 5000 linhas) | Log principal de todos os eventos |
| `findings.jsonl`              | `save-finding.sh`                       | Manual                                     | Bug/gap/melhoria registrado       |
| `errors.jsonl`                | `error-occurred.sh`                     | Manual                                     | Erros registrados pelo agente     |
| `tool-metrics.jsonl`          | `post-tool-use.sh`, `export-metrics.sh` | Manual                                     | Métricas por tool call            |
| `audit-YYYYMMDD_HHMMSS.jsonl` | `rotate-audit.sh`                       | Permanente (arquivo)                       | Arquivo histórico rotacionado     |

---

## Regras de compatibilidade

1. **Nunca remover campos** de eventos já existentes — só adicionar opcionais.
2. **Dual-read obrigatório**: `toolUseFailure` e `toolFailure` são equivalentes (legado).
3. **session_id guard**: qualquer script que escreva em `session-context.json` deve verificar que o payload session_id corresponde ao contexto ativo (exceto `session-start.sh`).
4. **Schema version**: bumpar `session-context.json` version ao adicionar campos obrigatórios.
5. **Redação**: todo log de `tool_input` / `tool_response` passa por redaction de credentials.

---

## Versionamento deste contrato

| Versão | Data       | Mudança                          |
| ------ | ---------- | -------------------------------- |
| 1.0    | 2026-03-10 | Criação inicial (Fase 9 — G9-06) |
| 1.1    | 2026-03-11 | REV4-02: 7 eventos adicionados (`sectionContinued`, `auth_via_subagent_delegation`, `turnStart_enriched`, `sessionClose_key_validated`, `errorOccurred`, `errorDetail`, `session_manual_recovery`); corrigido `turnStart` → `turnStart_enriched`; `subagentStart` atualizado com producer/consumer do hardening v6; `agentStop` atualizado: 3→4 estratégias de autorização |
