# audit.jsonl — Schema Canônico de Eventos

> **Status**: Canônico | **Última atualização**: 2026-03-09
> **Schema verificado empiricamente** em 2026-03-09 via inspeção de `raw-input.jsonl` e `raw-post-input.jsonl`.

---

## Formato geral

Cada linha é um objeto JSON independente (JSONL). Campos comuns a todos os eventos:

| Campo        | Tipo     | Descrição                                |
| ------------ | -------- | ---------------------------------------- |
| `event`      | `string` | Tipo do evento (ver tabela abaixo)       |
| `session_id` | `string` | UUID da sessão (pode ser `""` se ausente) |
| `timestamp`  | `string` | ISO 8601 ou epoch ms (depende do hook)   |

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
- `result_type`: `"success"` (tool_response não vazia) ou `"unknown"` (body vazio — não necessariamente falha)

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
