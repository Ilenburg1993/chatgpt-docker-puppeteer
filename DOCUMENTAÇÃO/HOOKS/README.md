# Sistema de Hooks — Copilot Automation

> **Status**: Canônico | **Última atualização**: 2026-03-12 | **Versão**: 10.0 (Schema v8, Fase 10 —
> 24+ correções)

> ⚠️ Para rastreamento detalhado de issues e roadmap, veja
> [`STATUS-E-ROADMAP.md`](./STATUS-E-ROADMAP.md).

Sistema de hooks do GitHub Copilot que automatiza: rastreabilidade de sessões, protocolo de
autorização de encerramento, métricas de ferramentas, checkpoints de estado e relatórios.

---

## Índice

1. [Visão Geral](#visão-geral)
2. [Estrutura de Diretórios](#estrutura-de-diretórios)
3. [Protocolo de Autorização](#protocolo-de-autorização)
4. [Scripts — Referência Rápida](#scripts--referência-rápida)
5. [Fluxo de Dados](#fluxo-de-dados)
6. [Estado Persistido](#estado-persistido)
7. [Logs e Artefatos](#logs-e-artefatos)
8. [Manutenção](#manutenção)
9. [Documentos Relacionados](#documentos-relacionados)

---

## Visão Geral

O sistema é ativado automaticamente pelo GitHub Copilot via `.github/hooks/copilot-hooks.json`. Oito
eventos do ciclo de vida do agente disparam scripts shell correspondentes:

| Evento Copilot        | Script                | Propósito                             |
| --------------------- | --------------------- | ------------------------------------- |
| `sessionStart`        | `session-start.sh`    | Inicialização + briefing da sessão    |
| `userPromptSubmitted` | `log-prompt.sh`       | Log de metadados + reset de auth flag |
| `preToolUse`          | `pre-tool-use.sh`     | Rastreia tool calls + redação de cred |
| `postToolUse`         | `post-tool-use.sh`    | Métricas de duração + quality gates   |
| `agentStop`           | `agent-stop.sh`       | Detecção de autorização + checkpoint  |
| `subagentStop`        | `subagent-stop.sh`    | Registro mínimo do subagente          |
| `subagentStart`       | `subagent-start.sh`   | Marca início de subagent call         |
| `postToolUseFailure`  | `tool-use-failure.sh` | Log de falha de ferramenta            |
| `preCompact`          | `pre-compact.sh`      | Registra compactação de contexto      |
| `errorOccurred`       | `error-occurred.sh`   | Log de erros no audit + errors.jsonl  |
| `sessionEnd`          | `session-end.sh`      | Relatório final + conformidade        |

---

## Estrutura de Diretórios

```
.github/hooks/
├── copilot-hooks.json          # Configuração canônica de hooks (10 eventos)
├── scripts/                    # 33+ scripts shell
│   ├── session-start.sh        # Hook: sessionStart
│   ├── agent-stop.sh           # Hook: agentStop — protocolo de autorização
│   ├── session-end.sh          # Hook: sessionEnd — relatório + conformidade
│   ├── log-prompt.sh           # Hook: userPromptSubmitted
│   ├── pre-tool-use.sh         # Hook: preToolUse
│   ├── post-tool-use.sh        # Hook: postToolUse — métricas
│   ├── subagent-stop.sh        # Hook: subagentStop
│   ├── subagent-start.sh       # Hook: subagentStart
│   ├── tool-use-failure.sh     # Hook: postToolUseFailure
│   ├── pre-compact.sh          # Hook: preCompact
│   ├── error-occurred.sh       # Hook: errorOccurred
│   ├── start-turn.sh           # Helper: declara intent do turno
│   ├── start-section.sh        # Helper: abre nova seção temática
│   ├── section-end.sh          # Helper: fecha seção manualmente
│   ├── continue-section.sh     # Helper: confirma continuação após git push
│   ├── session-checkpoint.sh   # Helper: snapshot incremental por turno
│   ├── generate-session-summary.sh  # Helper: relatório Markdown da sessão
│   ├── generate-section-summary.sh  # Helper: resumo de seção
│   ├── generate-daily-report.sh    # Helper: relatório diário de métricas
│   ├── save-finding.sh         # Util: registra finding em findings.jsonl
│   ├── resolve-finding.sh      # Util: resolve finding aberto
│   ├── add-task.sh             # Util: adiciona tarefa em pending-tasks.md
│   ├── complete-task.sh        # Util: marca tarefa como concluída
│   ├── watchdog.sh             # Saúde: detecta anomalias de sessão
│   ├── on-git-push.sh          # Git: acionado por .git/hooks/pre-push
│   ├── install-git-hooks.sh    # Setup: instala hooks git (pre-push, pre-commit, commit-msg)
│   ├── rotate-audit.sh         # Manutenção: rotaciona audit.jsonl (Fase 9)
│   ├── reset-auth-violation.sh # Admin: reseta UNAUTHORIZED_CLOSE.flag
│   ├── smoke-test.sh           # QA: 106+ checks de integridade do sistema
│   ├── analytics.sh            # Analytics: cross-session
│   ├── export-metrics.sh       # Export: métricas CSV/JSON
│   └── sync-tasks-to-docs.sh   # Sync: backlog → docs
├── contracts/                  # Contratos formais (Fase 9)
│   ├── events-contract.md      # Contrato de todos os eventos do ciclo de vida
│   └── session-context.schema.json  # JSON Schema v7 do session-context.json
├── hooks-lib/                  # Biblioteca compartilhada (Fase 9)
│   └── common.sh               # Funções: hl_iso_now, hl_with_lock, ctx_update...
├── state/                      # Estado persistido entre turnos e sessões
│   ├── session-context.json    # Contexto da sessão atual (JSON, Schema v8)
│   ├── session-briefing.md     # Briefing gerado no início da sessão
│   ├── pending-tasks.md        # Backlog de tarefas do agente
│   ├── watchdog-report.json    # Último resultado do watchdog
│   ├── UNAUTHORIZED_CLOSE.flag # Presente quando violação detectada (JSON)
│   └── AUTHORIZED_CLOSE.flag   # Presente quando último turno foi autorizado
└── logs/                       # Logs append-only (chmod 700)
    ├── audit.jsonl             # Log principal — todos os eventos (<5000 linhas; auto-rotacionado)
    ├── audit-YYYYMMDD_HHMMSS.jsonl  # Arquivo rotacionado de audit.jsonl
    ├── findings.jsonl          # Findings de auditoria registrados
    ├── tool-metrics.jsonl      # Métricas de duração por ferramenta
    └── errors.jsonl            # Erros com stack trace completo
```

---

## Protocolo de Autorização

> **Regra absoluta**: o agente DEVE chamar o **tool call real** `vscode_askQuestions` antes de
> encerrar qualquer turno. Texto plano NÃO equivale a autorização.

### Mecanismo (3 camadas em cascata)

O `agent-stop.sh` detecta autorização via:

1. **Estratégia 1 — Fronteira por userPromptSubmitted** (mais precisa): Encontra a última entrada
   `userPromptSubmitted` em `audit.jsonl` e verifica se `vscode_askQuestions` aparece em algum
   `preToolUse` após essa linha.

2. **Estratégia 2 — Fallback por recência** (quando userPromptSubmitted ausente): Varre as últimas
   150 linhas de `audit.jsonl` procurando `vscode_askQuestions`.

3. **Estratégia 3 — Fallback de contexto** (último recurso): Lê `current_turn.auth_requested` em
   `session-context.json`.

### Reset de flag entre turnos

**Crítico**: o campo `current_turn.auth_requested` é resetado em dois momentos:

- **`agent-stop.sh`** — ao final do turno, após verificar conformidade.
- **`log-prompt.sh`** — ao inicio de cada novo turno do usuário (belt-and-suspenders).

Isso garante que autorização de turno N não "vaze" para o turno N+1.

### Violação detectada

Quando o turno termina sem `vscode_askQuestions`:

1. `UNAUTHORIZED_CLOSE.flag` é gravado em `state/` com
   `{timestamp, session_id, turn_count, severity: "critical"}`
2. `turnEnd_no_askQuestions` é appendado em `audit.jsonl` 3. `session-context.json` →
   `compliance.consecutive_unauthorized + 1`
3. **Na próxima sessão**: `session-start.sh` detecta o flag e injeta bloco `⛔⛔⛔ VIOLAÇÃO CRÍTICA`
   no topo do `session-briefing.md`, com instrução de pedir desculpas e chamar `vscode_askQuestions`
   imediatamente.

### Reset manual

```bash
bash .github/hooks/scripts/reset-auth-violation.sh "motivo da redefinição"
```

---

## Scripts — Referência Rápida

### `session-start.sh` — Inicialização da sessão

**Quando**: ao iniciar uma sessão Copilot.

**O que faz**:

- Inicializa ou recupera `session-context.json` (mantém session_id entre reinicializações do mesmo
  container)
- Detecta `UNAUTHORIZED_CLOSE.flag` e injeta alerta crítico no briefing
- Gera `session-briefing.md` com: status do sistema, tarefas de alta prioridade, histórico de
  métricas, violation alerts
- Loga `sessionStart` em `audit.jsonl`

**Variável chave**: `source: "test"` no session-context indica que o session_id foi gerado
localmente (não veio de payload do Copilot que não inclui session_id no evento sessionStart).

---

### `agent-stop.sh` — Protocolo de autorização por turno

**Quando**: a cada fim de turno do agente (toda vez que o agente termina de responder).

**O que faz** (em ordem):

1. Loga `agentStop` em audit.jsonl com duração do turno
2. Detecta autorização (3 estratégias — veja seção Protocolo)
3. Grava/remove `UNAUTHORIZED_CLOSE.flag` conforme resultado
4. Loga `turnEnd_authorized` ou `turnEnd_no_askQuestions`

- **Reseta `current_turn.auth_requested = false`** e incrementa `session_stats.turn_count`

6. Salva checkpoint via `session-checkpoint.sh`

---

### `log-prompt.sh` — Rastreamento de prompts

**Quando**: a cada prompt do usuário.

**O que faz**:

- Calcula hash SHA-256 truncado (16 chars) do prompt — jamais loga o texto
- Registra `{event: userPromptSubmitted, prompt_hash, prompt_len}` em audit.jsonl
- **Reseta `current_turn.auth_requested = false`** (belt-and-suspenders contra falso positivo
  inter-turn)

---

### `pre-tool-use.sh` — Rastreamento de tool calls

**Quando**: antes de cada uso de ferramenta.

**O que faz**:

- Redação de credenciais (`ghp_*`, `gho_*`, `Bearer *`, `--password`, `--token`)
- Loga `preToolUse` em audit.jsonl com `tool_name`, `tool_use_id`
- Atualiza `last_tool.*`, `session_stats.tools_*`, `current_turn.tools_*` em session-context.json
- **Quando `vscode_askQuestions`**: define `current_turn.auth_requested = true` e
  `auth_requested_at`

### `post-tool-use.sh` — Métricas de ferramentas

**Quando**: após cada uso de ferramenta.

**O que faz**:

- Loga `postToolUse` em audit.jsonl com `result_type` (`success` vs `unknown`)
- Calcula `duration_ms` entre `last_tool_ts` e `timestamp` atual → `tool-metrics.jsonl`
- Filtra durações inválidas (negativas ou >10min = gap inter-sessão)
- Detecta quality gates (`npm run lint/typecheck/test/format`) → registra em
  `session-context.json.quality_gates`
- Classifica `result_type`: `success` (resposta não vazia), `failure` (padrão de erro detectado) ou
  `unknown` (resposta vazia)

---

### `start-section.sh` — Seção Temática _(utilitário do agente)_

**Quando**: chamado manualmente pelo agente para declarar uma fase lógica nomeada.

**Uso**:

```bash
bash .github/hooks/scripts/start-section.sh "implementação do schema v2"
```

**O que faz**:

- Grava `current_section = {name, started_at, turn_start, description}` em session-context.json
- Emite evento `sectionStart` em `audit.jsonl` com `{section_name, turn_number}`

**Quando usar**: no início de cada fase lógica de trabalho (ex: "correção-de-bugs",
"commit-e-documentação"). O checkpoint e o relatório final incluem a seção ativa.

---

### `section-end.sh` — Encerramento de Seção Temática _(utilitário do agente)_

**Quando**: chamado manualmente pelo agente para encerrar explicitamente a seção atual.

**Uso**:

```bash
bash .github/hooks/scripts/section-end.sh "motivo opcional"
# Exemplos:
bash .github/hooks/scripts/section-end.sh "implementação concluída"
bash .github/hooks/scripts/section-end.sh # sem args usa "concluída"
```

**O que faz**:

- Calcula a duração da seção em segundos e o número de turnos cobertos
- Limpa `current_section` no session-context.json (seção encerrada = sem seção ativa)
- Emite evento `sectionEnd` em `audit.jsonl` com `{section_name, reason, turns_covered, duration_s}`
- Se não houver seção ativa, avisa e sai sem erro (idempotente)

**Relação com `start-section.sh`**: ao declarar nova seção com `start-section.sh`, a anterior é
implicitamente substituída no contexto, mas sem `sectionEnd` registrado. Use `section-end.sh` antes
de `start-section.sh` para lifecycle completo com duração calculada.

---

### `session-end.sh` — Encerramento de sessão

**Quando**: fim da sessão Copilot.

**O que faz**:

- **Schema v3**: lê `session.close_key_validated` de `session-context.json`
- **Schema v9**: `current_section.name` nunca é `null` (seção `"início"` criada automaticamente);
  `current_turn.section_name` rastreia a seção ativa no turno; `session_stats.section_count` e
  `section_names[]` acumulam histórico de seções
  - Se `true` → remove `SESSION_CLOSE_NO_KEY.flag`; loga `sessionEnd_authorized_close`
  - Se `false` → cria `SESSION_CLOSE_NO_KEY.flag`; loga `sessionEnd_no_key`
- Chama `generate-session-summary.sh` → grava relatório Markdown em `state/`
- Conta `turnEnd_authorized` vs `turnEnd_no_askQuestions` nessa sessão → conformidade
- Se nenhum turno autorizado: grava `UNAUTHORIZED_CLOSE.flag` como safety net
- Loga `sessionEnd_compliance` com `{authorized_turns, violation_turns, fully_compliant}`
- Rotação de `audit.jsonl` quando >5000 linhas → arquiva excesso

---

### `session-checkpoint.sh` — Snapshot por turno

**Quando**: chamado pelo `agent-stop.sh` a cada turno (pode ser chamado manualmente).

**O que faz**:

- Captura snapshot JSON de: turn_count, tasks por prioridade, findings por severidade, métricas de
  tools
- Salva em `checkpoints/sess_<uuid>_turn<N>_<ts>.json`
- Atualiza symlink `sess_<uuid>_latest.json`
- Prune automático: mantém MAX_CHECKPOINTS (default: 30) por sessão
- **Globbing seguro**: usa `mapfile + compgen` para evitar bug de glob vazio em bash

---

### `save-finding.sh` — Registro de findings

**Uso**:

```bash
bash .github/hooks/scripts/save-finding.sh \
  "<módulo>" "<severity>" "<type>" "<descrição>"
```

**Severidades**: `critical | high | medium | low | info` **Tipos**:
`bug | gap | improvement | vulnerability | performance | debt`

Grava em `findings.jsonl` + `audit.jsonl` (dupla visibilidade).

---

### `add-task.sh` — Gestão de backlog

**Uso**:

```bash
bash .github/hooks/scripts/add-task.sh < alta | media | backlog > "<Título>" "<Descrição>"
```

Insere tarefa no topo da seção correspondente em `pending-tasks.md`.

---

### `complete-task.sh` — Conclusão de tarefas

**Uso**:

```bash
bash .github/hooks/scripts/complete-task.sh "<padrão único do título>"
```

Marca a primeira tarefa que contém o padrão como `[x]` com anotação de data.

---

### `generate-daily-report.sh` — Relatório diário

**Uso** (manual ou via cron):

```bash
bash .github/hooks/scripts/generate-daily-report.sh [YYYY-MM-DD]
```

Gera relatório com: eventos do dia, top ferramentas, métricas de performance, conformidade de
autorização, findings pendentes.

---

### `install-git-hooks.sh` — Quality gates de git

**Uso** (uma vez por checkout fresco):

```bash
bash .github/hooks/scripts/install-git-hooks.sh
# ou
npm run hooks:install-git
```

Instala em `.git/hooks/`:

- `pre-commit`: lint + format:check + typecheck:node
- `commit-msg`: validação Conventional Commits

---

### `smoke-test.sh` — Verificação de integridade dos hooks

**Uso**:

```bash
bash .github/hooks/scripts/smoke-test.sh         # verbose
bash .github/hooks/scripts/smoke-test.sh --quiet # só erros
```

**O que verifica** (43 checks):

1. Dependências instaladas (`jq`, `sponge`, `date`, `sha256sum`, `wc`)
2. Todos os scripts existem e são executáveis
3. `copilot-hooks.json` é JSON válido
4. Diretórios `state/` e `logs/` existem
5. Schema canônico de `session-context.json` (todos os campos obrigatórios)
6. `section-end.sh` sem seção ativa não crasha
7. `shellcheck` nos scripts principais (se disponível)

**Exit code**: número de falhas (0 = PASS total).

---

## Fluxo de Dados

```
userPromptSubmitted
    │
    └─► log-prompt.sh
            │ reset current_turn.auth_requested=false
            └─► audit.jsonl (userPromptSubmitted)

preToolUse (por ferramenta)
    │
    └─► pre-tool-use.sh
            │ redact credentials
            │ update session-context (last_tool.*, session_stats.tools_*, current_turn.tools_*)
            │ IF vscode_askQuestions: current_turn.auth_requested=true
            └─► audit.jsonl (preToolUse)

postToolUse (por ferramenta)
    │
    └─► post-tool-use.sh
            │ detect quality gates
            │ calculate duration_ms
            │ classify result_type (success | failure | unknown)
            ├─► audit.jsonl (postToolUse)
            └─► tool-metrics.jsonl

agentStop (fim de turno)
    │
    └─► agent-stop.sh
            │ log agentStop
            │ detect authorization (3 strategies)
            │ write/remove UNAUTHORIZED_CLOSE.flag
            │ log turnEnd_authorized OR turnEnd_no_askQuestions
            │ reset current_turn.auth_requested=false
            │ increment session_stats.turn_count
            └─► session-checkpoint.sh
                    └─► checkpoints/sess_<uuid>_turn<N>_<ts>.json

sessionEnd
    │
    └─► session-end.sh
            │ generate session report
            │ compliance check
            │ log rotation (>5000 lines)
            └─► audit.jsonl (sessionEnd_compliance)

sessionStart (nova sessão)
    │
    └─► session-start.sh
            │ recover/init session-context.json
            │ detect UNAUTHORIZED_CLOSE.flag
            │ inject violation alert if flagged
            └─► state/session-briefing.md
```

---

## Estado Persistido

### `session-context.json` — Schema v9 ← atualizado (2026-03-13)

O arquivo é inicializado por `session-start.sh` e atualizado atomicamente por cada hook. Usa
`sponge` para evitar arquivos parcialmente escritos.

```json
{
  "session": {
    "id": "sess_...",
    "started_at": "2026-03-09T04:43:00Z",
    "date_short": "20260309_044300",
    "ended_at": null,
    "end_reason": null,
    "source": "payload | test | resume",
    "cwd": "/workspaces/...",
    "close_key": "ENCERRAR-7A3F2B1C",
    "close_key_validated": false
  },
  "session_stats": {
    "turn_count": 0,
    "turn_authorized": 0,
    "turn_unauthorized": 0,
    "tools_total": 0,
    "tools_by_name": {},
    "failures_detected": 0,
    "errors_total": 0,
    "subagent_calls": 0,
    "section_count": 1,
    "section_names": ["início"]
  },
  "current_turn": {
    "number": 1,
    "started_at": "...",
    "tools_count": 0,
    "tools_by_name": {},
    "failures_count": 0,
    "auth_requested": false,
    "auth_requested_at": null,
    "last_askquestions_response": null,
    "section_name": "início"
  },
  "current_section": {
    "name": "início",
    "started_at": "...",
    "turn_start": 1,
    "section_number": 1,
    "description": null
  },
  "last_tool": {
    "name": null,
    "ts": "...",
    "use_id": null,
    "result": null
  },
  "compliance": {
    "last_turn_authorized": null,
    "consecutive_unauthorized": 0,
    "flag_file_exists": false
  }
}
```

**Campos por sub-objeto:**

| Sub-objeto        | Campo                        | Tipo      | Responsável           |
| ----------------- | ---------------------------- | --------- | --------------------- |
| `session`         | `id`                         | string    | session-start.sh      |
| `session`         | `started_at`                 | ISO 8601  | session-start.sh      |
| `session`         | `date_short`                 | string    | session-start.sh      |
| `session`         | `source`                     | enum      | session-start.sh      |
| `session`         | `close_key`                  | string    | session-start.sh ← v3 |
| `session`         | `close_key_validated`        | boolean   | post-tool-use.sh ← v3 |
| `session_stats`   | `turn_count`                 | number    | agent-stop.sh         |
| `session_stats`   | `turn_authorized`            | number    | agent-stop.sh         |
| `session_stats`   | `turn_unauthorized`          | number    | agent-stop.sh         |
| `session_stats`   | `tools_total`                | number    | pre-tool-use.sh       |
| `session_stats`   | `tools_by_name`              | object    | pre-tool-use.sh       |
| `session_stats`   | `failures_detected`          | number    | post-tool-use + error |
| `session_stats`   | `errors_total`               | number    | error-occurred.sh     |
| `session_stats`   | `subagent_calls`             | number    | subagent-stop.sh      |
| `current_turn`    | `number`                     | number    | log-prompt.sh         |
| `current_turn`    | `tools_count`                | number    | pre-tool-use.sh       |
| `current_turn`    | `tools_by_name`              | object    | pre-tool-use.sh       |
| `current_turn`    | `failures_count`             | number    | post-tool-use.sh      |
| `current_turn`    | `auth_requested`             | boolean   | pre-tool-use.sh       |
| `current_turn`    | `auth_requested_at`          | ISO/null  | pre-tool-use.sh       |
| `current_turn`    | `last_askquestions_response` | str/null  | post-tool-use.sh ← v3 |
| `current_turn`    | `section_name`               | string    | log-prompt.sh ← v4    |
| `current_section` | `name`                       | string    | session-start.sh ← v4 |
| `current_section` | `turn_start`                 | number    | start-section.sh      |
| `current_section` | `section_number`             | number    | start-section.sh ← v4 |
| `session_stats`   | `section_count`              | number    | start-section.sh ← v4 |
| `session_stats`   | `section_names`              | string[]  | start-section.sh ← v4 |
| `last_tool`       | `name`                       | str/null  | pre-tool-use.sh       |
| `last_tool`       | `result`                     | str/null  | post-tool-use.sh      |
| `compliance`      | `last_turn_authorized`       | bool/null | agent-stop.sh         |
| `compliance`      | `consecutive_unauthorized`   | number    | agent-stop.sh         |
| `compliance`      | `flag_file_exists`           | boolean   | agent-stop.sh         |

### Flags de estado

| Arquivo                     | Significado                                                                   |
| --------------------------- | ----------------------------------------------------------------------------- |
| `UNAUTHORIZED_CLOSE.flag`   | Violação ativa — turno encerrado sem `vscode_askQuestions`; briefing alertará |
| `SESSION_CLOSE_NO_KEY.flag` | SESSION encerrada sem close_key validada — exige investigação ← v3            |
| (ausência dos flags)        | Sessão em conformidade total                                                  |

---

## Logs e Artefatos

### `audit.jsonl` — Eventos canônicos

Todos os campos são presentes em cada linha mas alguns podem ser `""` ou `null`.

| `event`                       | Gerado por            | Campos extras                                            |
| ----------------------------- | --------------------- | -------------------------------------------------------- |
| `sessionStart`                | session-start.sh      | `cwd`, `source`                                          |
| `userPromptSubmitted`         | log-prompt.sh         | `prompt_hash`, `prompt_len`, `cwd`                       |
| `preToolUse`                  | pre-tool-use.sh       | `tool_name`, `tool_use_id`                               |
| `postToolUse`                 | post-tool-use.sh      | `tool_name`, `tool_use_id`, `result_type`                |
| `agentStop`                   | agent-stop.sh         | `turn_duration_s`                                        |
| `subagentStop`                | subagent-stop.sh      | —                                                        |
| `errorOccurred`               | error-occurred.sh     | `errorName`, `errorMsg`                                  |
| `sessionCheckpoint`           | session-checkpoint.sh | `turn_count`, `tasks_open`, `checkpoint_file`            |
| `turnEnd_authorized`          | agent-stop.sh         | —                                                        |
| `turnEnd_no_askQuestions`     | agent-stop.sh         | `message`                                                |
| `askQuestions_response`       | post-tool-use.sh      | `response_length`, `close_key_found` ← v3                |
| `sessionClose_key_validated`  | post-tool-use.sh      | `close_key` ← v3                                         |
| `sessionEnd_authorized_close` | session-end.sh        | `close_key_validated: true` ← v3                         |
| `sessionEnd_no_key`           | session-end.sh        | `close_key_validated: false` ← v3                        |
| `sessionEnd_compliance`       | session-end.sh        | `authorized_turns`, `violation_turns`, `fully_compliant` |
| `finding`                     | save-finding.sh       | `module`, `severity`, `type`, `description`              |
| `taskAdded`                   | add-task.sh           | `priority`, `title`, `description`                       |
| `taskCompleted`               | complete-task.sh      | `pattern`, `date`                                        |

**Rotação automática**: quando >5000 linhas, o excesso é arquivado em `audit-archive-<ts>.jsonl`.

### `tool-metrics.jsonl` — Métricas de performance

```json
{
  "session_id": "...",
  "timestamp": "...",
  "tool_name": "run_in_terminal",
  "duration_ms": 1234,
  "result_type": "success"
}
```

### `findings.jsonl` — Achados de auditoria

```json
{
  "event": "finding",
  "session_id": "...",
  "timestamp": "...",
  "date": "...",
  "module": "src/kernel/",
  "severity": "high",
  "type": "bug",
  "description": "..."
}
```

---

## Manutenção

### Consultas úteis

```bash
# Distribuição de eventos
jq -r '.event' .github/hooks/logs/audit.jsonl | sort | uniq -c | sort -rn

# Turnos sem autorização
jq -r 'select(.event == "turnEnd_no_askQuestions")' .github/hooks/logs/audit.jsonl

# Top 10 ferramentas por duração média
jq -s 'group_by(.tool_name) | map({tool: .[0].tool_name, avg_ms: (map(.duration_ms) | add / length | floor)}) | sort_by(-.avg_ms)[:10]' \
  .github/hooks/logs/tool-metrics.jsonl

# Findings de alta severidade
jq -r 'select(.severity == "high" or .severity == "critical") | [.date, .severity, .module, .description] | @tsv' \
  .github/hooks/logs/findings.jsonl

# Verificar flag de violação
cat .github/hooks/state/UNAUTHORIZED_CLOSE.flag 2> /dev/null || echo "Sem violação ativa"

# Reset de emergência (violação resolvida manualmente)
bash .github/hooks/scripts/reset-auth-violation.sh "violação resolvida — agente instruído"

# Relatório diário
bash .github/hooks/scripts/generate-daily-report.sh
```

### Diagnóstico rápido

```bash
# Estado da sessão atual
jq '.' .github/hooks/state/session-context.json

# Último checkpoint
jq '.' .github/hooks/checkpoints/sess_*_latest.json 2> /dev/null | head -60

# Últimos 20 eventos do audit
tail -20 .github/hooks/logs/audit.jsonl | jq -r '[.timestamp, .event, .tool_name] | @tsv'
```

---

## Documentos Relacionados

| Documento                                                        | Conteúdo                                  |
| ---------------------------------------------------------------- | ----------------------------------------- |
| [SCRIPTS.md](./SCRIPTS.md)                                       | Referência detalhada de cada script       |
| [PROTOCOLO-AUTORIZACAO.md](./PROTOCOLO-AUTORIZACAO.md)           | Spec completo do protocolo de autorização |
| [AUDIT-SCHEMA.md](./AUDIT-SCHEMA.md)                             | Schema completo de audit.jsonl            |
| [MELHORIAS.md](./MELHORIAS.md)                                   | Backlog de melhorias e upgrades propostos |
| [.github/AGENTS.md](../../AGENTS.md)                             | Instruções para agentes de IA             |
| [.github/copilot-instructions.md](../../copilot-instructions.md) | Instruções principais do Copilot          |

---

_Gerado em 2026-03-09. Mantido pelo Modo Arquiteto._
