# audit.jsonl — Schema Canônico de Eventos

> **Status**: Canônico | **Última atualização**: 2026-03-09
> **Schema verificado empiricamente** em 2026-03-09 via inspeção de `raw-input.jsonl` e `raw-post-input.jsonl`.

---

## Formato geral

Cada linha é um objeto JSON independente (JSONL). Campos comuns a todos os eventos:

| Campo        | Tipo     | Descrição                                 |
| ------------ | -------- | ----------------------------------------- |
| `event`      | `string` | Tipo do evento (ver tabela abaixo)        |
| `session_id` | `string` | UUID da sessão (pode ser `""` se ausente) |
| `timestamp`  | `string` | ISO 8601 ou epoch ms (depende do hook)    |

---

## Eventos por categoria

### Ciclo de sessão

#### `sessionStart`
```json
{
    "event": "sessionStart",
    "session_id": "a0be08af-7a26-42d8-b8a5-3c43206494c7",
    "timestamp": "2026-03-09T01:55:55Z",
    "cwd": "/workspaces/chatgpt-docker-puppeteer",
    "source": "test"
}
```
- `source`: `"payload"` (session_id do Copilot) ou `"test"` (gerado localmente)

#### `sessionEnd_compliance`
```json
{
    "event": "sessionEnd_compliance",
    "session_id": "...",
    "timestamp": "...",
    "authorized_turns": 3,
    "violation_turns": 0,
    "fully_compliant": true
}
```

#### `sessionEnd_authorized_close`
```json
{
    "event": "sessionEnd_authorized_close",
    "session_id": "...",
    "timestamp": "...",
    "close_key_validated": true
}
```
- Emitido quando a SESSION encerra com `close_key_validated = true` — encerramento legítimo
- O arquivo `.github/hooks/state/SESSION_CLOSE_NO_KEY.flag` é removido se existir

#### `sessionEnd_no_key`
```json
{
    "event": "sessionEnd_no_key",
    "session_id": "...",
    "timestamp": "...",
    "close_key_validated": false
}
```
- Emitido quando a SESSION encerra **sem** `close_key_validated = true`
- Cria `.github/hooks/state/SESSION_CLOSE_NO_KEY.flag` com metadados para investigação
- O próximo `session-briefing.md` exibirá alerta `🔑 ENCERRAMENTO SEM CHAVE`

---

### Interação do usuário

#### `userPromptSubmitted`
```json
{
    "event": "userPromptSubmitted",
    "session_id": "...",
    "timestamp": "...",
    "cwd": "/workspaces/chatgpt-docker-puppeteer",
    "prompt_hash": "a1b2c3d4e5f6a7b8",
    "prompt_len": 347
}
```
- O texto do prompt **nunca** é logado — apenas hash SHA-256 truncado (16 chars) + tamanho.

---

### Ferramentas

#### `preToolUse`
```json
{
    "event": "preToolUse",
    "session_id": "...",
    "timestamp": "2026-03-09T03:14:22.105Z",
    "tool_name": "run_in_terminal",
    "tool_use_id": "toolu_vrtx_016UeU9owRJaCjvX8RfTerF6__vscode-..."
}
```

#### `postToolUse`
```json
{
    "event": "postToolUse",
    "session_id": "...",
    "timestamp": "2026-03-09T03:14:23.407Z",
    "tool_name": "run_in_terminal",
    "tool_use_id": "toolu_vrtx_016UeU9owRJaCjvX8RfTerF6__vscode-...",
    "result_type": "success"
}
```
- `result_type`:
  - `"success"` — resposta não vazia, sem padrão de erro detectado
  - `"failure"` — resposta contém padrão de erro (`Error:`, `ENOENT`, `fatal:`, etc.) → incrementa `failures_detected`
  - `"unknown"` — resposta vazia (não necessariamente falha)

---

### Ciclo do agente

#### `agentStop`
```json
{
    "event": "agentStop",
    "session_id": "...",
    "timestamp": "2026-03-09T03:15:08Z",
    "turn_duration_s": 134
}
```

#### `subagentStop`
```json
{
    "event": "subagentStop",
    "session_id": "...",
    "timestamp": "2026-03-09T..."
}
```

---

### Seções Temáticas

#### `sectionStart`
```json
{
    "event": "sectionStart",
    "session_id": "...",
    "timestamp": "2026-03-09T...",
    "section_name": "implementação",
    "section_number": 2,
    "turn_number": 3,
    "description": "Fase B do plano — script X e Y",
    "prev_section": "início",
    "auto_open": false
}
```
- Emitido por `start-section.sh` (chamada manual do agente) ou por `session-start.sh` (seção padrão `"início"`)
- `section_number`: número ordinal da seção na sessão (começa em 1)
- `description`: descrição opcional (arg 2 de `start-section.sh`); `null` se omitida
- `prev_section`: nome da seção anterior fechada automaticamente; `null` se não havia
- `auto_open`: `true` se abertura automática pelo `session-start.sh`

#### `sectionEnd`
```json
{
    "event": "sectionEnd",
    "session_id": "...",
    "timestamp": "2026-03-09T...",
    "section_name": "implementação",
    "section_number": 2,
    "reason": "concluída",
    "started_at": "2026-03-09T03:10:00Z",
    "turn_start": 3,
    "turn_end": 5,
    "turns_covered": 2,
    "duration_s": 480
}
```
- Emitido por `section-end.sh` (manual), `start-section.sh` (auto-close da anterior) ou `session-end.sh` (reason: `session_ended`)
- `reason` possíveis: `"concluída"`, `"auto_closed_by_new_section"`, `"session_ended"`, customizado
- `section_number`: número ordinal da seção encerrada

---

### Turnos

#### `turnStart`
```json
{
    "event": "turnStart",
    "session_id": "...",
    "timestamp": "...",
    "turn_number": 3,
    "section_name": "implementação"
}
```
- Emitido automaticamente por `log-prompt.sh` (hook `userPromptSubmitted`)
- `section_name`: seção ativa no momento do início do turno (`null` se nenhuma — não deve ocorrer com Schema v4)

#### `turnStart_enriched`
```json
{
    "event": "turnStart_enriched",
    "session_id": "...",
    "timestamp": "...",
    "turn_number": 3,
    "section_name": "implementação",
    "intent": "Implementar Fase A + rodar smoke-test"
}
```
- Emitido manualmente via `bash start-turn.sh "intenção"` (primeiro ato do agente no turno)
- `intent`: descrição da intenção do turno declarada pelo agente; `null` se omitida
- Complementa `turnStart` — não o substitui

---

### Protocolo de autorização

#### `turnEnd_authorized`
```json
{
    "event": "turnEnd_authorized",
    "session_id": "...",
    "timestamp": "2026-03-09T..."
}
```

#### `turnEnd_UNAUTHORIZED`
```json
{
    "event": "turnEnd_UNAUTHORIZED",
    "session_id": "...",
    "timestamp": "2026-03-09T...",
    "message": "VIOLAÇÃO: turno encerrado sem vscode_askQuestions. Flag gravada em UNAUTHORIZED_CLOSE.flag"
}
```

#### `authViolation_reset`
```json
{
    "event": "authViolation_reset",
    "session_id": "...",
    "timestamp": "...",
    "reason": "violação resolvida manualmente"
}
```

#### `askQuestions_response`
```json
{
    "event": "askQuestions_response",
    "session_id": "...",
    "timestamp": "...",
    "response_length": 42,
    "close_key_found": false
}
```
- Emitido a cada resposta capturada de `vscode_askQuestions`
- O texto completo da resposta **não é logado** — apenas tamanho e flag `close_key_found`
- Resposta completa é armazenada em `session-context.json` → `current_turn.last_askquestions_response`

#### `sessionClose_key_validated`
```json
{
    "event": "sessionClose_key_validated",
    "session_id": "...",
    "timestamp": "...",
    "close_key": "ENCERRAR-7A3F2B1C"
}
```
- Emitido quando a `close_key` é encontrada na resposta de `vscode_askQuestions`
- Após este evento, `session.close_key_validated = true` em `session-context.json`
- Necessário para que `session-end.sh` classifique o encerramento como autorizado

---

### Estado interno

#### `sessionCheckpoint`
```json
{
    "event": "sessionCheckpoint",
    "session_id": "...",
    "timestamp": "2026-03-09T...",
    "turn_count": 3,
    "tasks_open": 8,
    "checkpoint_file": ".github/hooks/checkpoints/sess_..._turn3_20260309_031508.json"
}
```

---

### Auditoria de código

#### `finding`
```json
{
    "event": "finding",
    "session_id": "...",
    "timestamp": "1741500000000",
    "module": "src/kernel/execution_engine/",
    "severity": "high",
    "type": "bug",
    "description": "race condition em acquire() quando Chrome reinicia"
}
```

---

### Tarefas

#### `taskAdded`
```json
{
    "event": "taskAdded",
    "session_id": "...",
    "timestamp": "...",
    "priority": "alta",
    "title": "Corrigir race condition em browser_pool",
    "description": "pool.acquire() pode retornar handle fechado. Gate: test:integration."
}
```

#### `taskCompleted`
```json
{
    "event": "taskCompleted",
    "session_id": "...",
    "timestamp": "...",
    "pattern": "race condition em browser_pool",
    "date": "20260309"
}
```

---

## `errors.jsonl` — Erros com stack trace

Gerado por `error-occurred.sh`. Schema:
```json
{
    "event": "errorDetail",
    "session_id": "...",
    "timestamp": "...",
    "errorName": "TypeError",
    "errorMsg": "Cannot read properties of undefined (reading 'length')",
    "stack": "TypeError: ... at ... (truncado em 1000 chars)"
}
```

---

## `tool-metrics.jsonl` — Métricas de performance

Gerado por `post-tool-use.sh`. Schema:
```json
{
    "session_id": "...",
    "timestamp": "...",
    "tool_name": "run_in_terminal",
    "duration_ms": 1234,
    "result_type": "success"
}
```
- Durações negativas ou >600.000ms (10min) são descartadas (gaps inter-sessão)

---

## `findings.jsonl` — Findings de auditoria

Gerado por `save-finding.sh`. Schema:
```json
{
    "event": "finding",
    "session_id": "...",
    "timestamp": "...",
    "date": "2026-03-09T01:55:55Z",
    "module": "...",
    "severity": "high",
    "type": "bug",
    "description": "..."
}
```

---

## Notas de Schema

### Inconsistências conhecidas (observadas)

1. **`timestamp` em `preToolUse`/`postToolUse`**: formato ISO 8601 com milissegundos
   **`timestamp` em `agentStop`/`sessionStart`**: alguns eventos usam epoch string

2. **`result_type` sem campo explícito no payload**: determinado por heurística
   (tool_response vazia → `"unknown"`, não vazia → `"success"`)

3. **`session_id` em preToolUse**: vem do payload do Copilot (campo `.session_id`)
   **`session_id` em error-occurred**: lido de `session-context.json` (pode ser stale se for erro de outra sessão)

4. **`userPromptSubmitted` é raro** no audit.jsonl: o hook `userPromptSubmitted` só dispara quando o Copilot recebe foco. Em sessões longas, pode haver múltiplos turnos sem nenhum `userPromptSubmitted` — por isso existem as Estratégias 2 e 3 no protocolo de autorização.

---

*Mantido pelo Modo Arquiteto. Para atualizar, editar este arquivo e commitar no branch principal.*
