# API HOOKS — Situação Atual e Roadmap Completo

**Versão do documento**: 3.3-modular
**Data**: 2026-03-21
**Arquivo de entrada**: `.github/hooks/lib/hook-payload-api.sh` (loader)
**Módulos**: `.github/hooks/lib/api/` (9 módulos)
**Status atual**: v1.5 — API de Métricas de Sessão · 252 smoke tests PASS · 111 integration tests PASS

> Este documento é a fonte canônica de evolução da `hook-payload-api.sh`.
> Ele documenta o contrato OFICIAL da plataforma (o que o VS Code fornece),
> o que CRIAMOS por cima, e o roadmap para uma API extremamente completa.

---

## Índice

0. [Estrutura Modular de Arquivos](#estrutura-modular)
1. [DIVISÃO FUNDAMENTAL: Plataforma vs Nosso Sistema](#divisão)
2. [Contratos Canônicos da Plataforma (fonte de verdade)](#contratos)
   - [2.1 Input universal (todos os eventos)](#input-universal)
   - [2.2 Output universal (todos os eventos)](#output-universal)
   - [2.3 Exit codes](#exit-codes)
   - [2.4 Contratos por evento](#contratos-por-evento)
3. [O que CRIAMOS por cima da plataforma](#nosso-sistema)
4. [Situação Atual da API — v1.0](#situação-atual)
5. [Gaps identificados na v1.0](#gaps)
6. [Roadmap por Versão](#roadmap-por-versão)
   - [v1.1 — Cobertura Completa de Tools](#v11)
   - [v1.2 — Hardening de Segurança](#v12)
   - [v1.3 — Camada de Risco e Política](#v13)
   - [v1.4 — Detecção de Templates e Protocolo](#v14)
   - [v1.5 — API de Métricas de Sessão](#v15)
   - [v2.0 — API de Transcript e Histórico](#v20)
   - [v2.1 — Gestão de close_key](#v21)
   - [v2.2 — API de Subagente e Grafo de Agentes](#v22)
   - [v2.3 — Context Builder para PreCompact](#v23)
   - [v2.4 — Versionamento e Migração de State](#v24)
   - [v2.5 — Schemas de Validação Estritos](#v25)
   - [v3.0 — Motor de Política Completo](#v30)
7. [Catálogo Completo de Funções (v1.0)](#catálogo-v10)
8. [Catálogo Alvo (v3.0 — 150+ funções)](#catálogo-v30)
9. [Critérios de Gate por Versão](#critérios-de-gate)
10. [Questões em Aberto](#questões-em-aberto)

---

<a id="estrutura-modular"></a>
## 0. Estrutura Modular de Arquivos

A partir de 2026-03-18, o monolito `hook-payload-api.sh` (1214 linhas) foi **decomposto em 8 módulos**
dentro de `.github/hooks/lib/api/`. O arquivo original tornou-se um **thin loader** de ~150 linhas.

### Estrutura atual

```
.github/hooks/lib/
├── common.sh                          (552 linhas)  ← estado, lifecycle, audit, briefing
├── hook-payload-api.sh               (144 linhas)  ← LOADER: source api/* + hook_api_parse()
├── hook-payload-api.sh.bak           (backup do monolito original — pode ser apagado)
├── api/                              ← MÓDULOS (total ~ 900 linhas de código)
│   ├── 01-vars.sh    🔵              ( ~90 linhas)  HOOK_* declarations + _hook_api_reset()
│   ├── 02-parse.sh   🔵              (~200 linhas)  _hook_api_parse_universal + parsers por evento
│   ├── 03-validate.sh 🔵             ( ~80 linhas)  _hook_api_validate_* + hook_api_validate()
│   ├── 04-predicates.sh 🔵🟧         (~170 linhas)  hook_is_* + hook_response_has_error + response_meta
│   ├── 05-output.sh  🟦              (~200 linhas)  _hook_json_* + hook_out_* (17 builders)
│   ├── 06-query.sh   🔵              (~105 linhas)  hook_get_* + hook_summary + hook_api_dump + hook_api_list_captures
│   ├── 07-state.sh   🟧              ( ~60 linhas)  hook_close_key_in_response + hook_is_template_f_proposed + hook_api_record
│   └── 08-risk.sh    🔵🟧             ( ~90 linhas)  hook_tool_risk_level + hook_tool_category + hook_is_high_risk + hook_policy_allow
├── post-tool-use-lib.sh              ( 67 linhas)  ← fat lib PostToolUse
├── pre-compact-lib.sh                (105 linhas)  ← fat lib PreCompact
├── pre-tool-use-lib.sh               (138 linhas)  ← fat lib PreToolUse
├── session-close-lib.sh              (101 linhas)  ← fat lib SessionEnd (close)
├── session-start-lib.sh              (150 linhas)  ← fat lib SessionStart
├── stop-lib.sh                       ( 84 linhas)  ← fat lib Stop
├── subagent-lib.sh                   (146 linhas)  ← fat lib SubagentStart/Stop
└── user-prompt-submit-lib.sh         (118 linhas)  ← fat lib UserPromptSubmit
```

### Responsabilidade de cada módulo

| Módulo                | Camada | Responsabilidade                                                                       |
| --------------------- | ------ | -------------------------------------------------------------------------------------- |
| `01-vars.sh`          | 🔵      | Declara e reseta todas as variáveis `HOOK_*`                                           |
| `02-parse.sh`         | 🔵      | Extrai campos do payload JSON por evento                                               |
| `03-validate.sh`      | 🔵      | Valida campos obrigatórios por schema oficial                                          |
| `04-predicates.sh`    | 🔵🟧     | Predicados semânticos (`hook_is_*`) e meta de resposta                                 |
| `05-output.sh`        | 🟦      | Constrói JSON de resposta conforme protocolo oficial                                   |
| `06-query.sh`         | 🔵      | Getters, `hook_summary`, `hook_api_dump`, `hook_api_list_captures`                     |
| `07-state.sh`         | 🟧      | `hook_close_key_in_response`, `hook_is_template_f_proposed`, `hook_api_record`         |
| `08-risk.sh`          | 🔵🟧     | `hook_tool_risk_level`, `hook_tool_category`, `hook_is_high_risk`, `hook_policy_allow` |
| `hook-payload-api.sh` | —      | **Loader**: carrega módulos + define `hook_api_parse()`                                |

### Compatibilidade retroativa

- Scripts que fazem `source lib/hook-payload-api.sh` continuam funcionando **sem nenhuma mudança**.
- Fat libs (`*-lib.sh`) **não importam** `hook-payload-api.sh` — apenas `common.sh`. Nenhuma alteração necessária.
- Testes (`smoke-test-payload-api.sh`, `integration-test-hooks.sh`) continuam passando **205/205 e 111/111**.

### Como adicionar uma nova função

1. Identifique a camada (🟦/🔵/🟧) seguindo os critérios da Seção 1.
2. Adicione no módulo correspondente:
   - Predicado de evento ou tool → `04-predicates.sh`
   - Output builder → `05-output.sh`
   - Getter ou utilitário de query → `06-query.sh`
   - Parser de novo campo → `02-parse.sh` + declare em `01-vars.sh`
3. Adicione testes em `smoke-test-payload-api.sh`.

---

<a id="divisão"></a>
## 1. DIVISÃO FUNDAMENTAL: Três Categorias

A API `hook-payload-api.sh` e os fat libs operam em **três camadas ortogonais**:

```
╔══════════════════════════════════════════════════════════════╗
║  🟦 CAMADA 1 — PLATAFORMA NATIVA (GitHub Copilot / VS Code) ║
║                                                              ║
║  O que a plataforma FAZ AUTOMATICAMENTE:                     ║
║  • Detecta os 8 eventos (Session/Prompt/Pre/Post/Compact...) ║
║  • Envia payload JSON via STDIN para nossos scripts          ║
║  • Lê a resposta JSON via STDOUT e aplica as decisões        ║
║  • Respeita exit codes (0=ok, 2=bloco, outros=aviso)         ║
║  • Gerencia o timeout dos scripts (default: 30s)             ║
║                                                              ║
║  O que a plataforma NÃO faz:                                 ║
║  • Não mantém estado entre eventos                           ║
║  • Não conhece SESSION/TURN/SUBTURN nem close_key            ║
║  • Não sabe o que é "protocolo TODO" ou Templates A-G        ║
║  • Não tem audit log                                         ║
╚══════════════════════════════════════════════════════════════╝
                             ▼
╔══════════════════════════════════════════════════════════════╗
║  🔵 CAMADA 2 — DERIVADA DA PLATAFORMA (nossa API pura)       ║
║                                                              ║
║  Funções que CRIAMOS na hook-payload-api.sh, mas que:        ║
║  • Operam APENAS sobre os dados que a plataforma envia       ║
║  • NÃO lêem session.json, audit.jsonl, close_key nem         ║
║    qualquer estado que seja nosso                            ║
║  • Poderiam ser extraídas como lib para QUALQUER projeto     ║
║    que use o VS Code Hook System                             ║
║                                                              ║
║  Exemplos:                                                   ║
║  • hook_is_git_push()     → checa tool_name + command        ║
║  • hook_tool_risk_level() → classifica tool por heurística   ║
║  • hook_out_pre_deny()    → constrói JSON válido p/ stdout   ║
║  • hook_get_tool_name()   → extrai campo do STDIN            ║
║  • hook_validate_pre_tool_use() → valida schema do evento    ║
╚══════════════════════════════════════════════════════════════╝
                             ▼
╔══════════════════════════════════════════════════════════════╗
║  🟧 CAMADA 3 — NOSSO SISTEMA (extensões proprietárias)       ║
║                                                              ║
║  Funções que dependem de estado que NÓS criamos:             ║
║  • Leem ou escrevem session.json                             ║
║  • Conhecem o conceito de SESSION / TURN / SUBTURN           ║
║  • Detectam Templates A-G do Protocolo TODO                  ║
║  • Gerenciam close_key                                       ║
║  • Fazem audit logging (audit.jsonl)                         ║
║  • Geram session-briefing.md, pending-tasks.md               ║
║  • Rastreiam ask_questions_called, consecutive_unauthorized  ║
╚══════════════════════════════════════════════════════════════╝
```

### Regra de ouro para classificar cada função:

| Pergunta                                                            | Resposta → Categoria |
| ------------------------------------------------------------------- | -------------------- |
| "Essa função usa APENAS campos que vieram do STDIN da plataforma?"  | Sim → 🔵 Derivada     |
| "Essa função lê ou escreve session.json, audit.jsonl ou close_key?" | Sim → 🟧 Nosso        |
| "Essa função descreve o contrato de input/output do VS Code?"       | Sim → 🟦 Plataforma   |

> **Por que esta distinção importa?**
> - As funções 🔵 são **portáveis** — poderiam virar uma lib npm para qualquer projeto com VS Code hooks.
> - As funções 🟧 são **proprietárias** — dependem da nossa arquitetura e não fazem sentido fora deste repo.
> - Saber a categoria ajuda a decidir **onde testar** e **o que pode mudar sem efeito colateral**:
>   `🔵` pode ser testada com fixtures JSON puras; `🟧` exige um state dir temporário.

---

### Classificação das 54 funções da v1.0

```
CAMADA 🟦 PLATAFORMA (campos/contratos documentados pela plataforma):
  hook_api_parse, hook_api_validate, hook_api_dump, hook_api_from_file

CAMADA 🔵 DERIVADA (nossa lógica, mas input = apenas stdin da plataforma):
  — Getters:
    hook_get_session_id, hook_get_tool_name, hook_get_agent_id, hook_get_prompt
    hook_get_command, hook_get_tool_input_field, hook_get_response_field
  — Predicados universais:
    hook_is_stop_active, hook_is_tool_event, hook_is_subagent_event
    hook_is_background_cmd, hook_response_has_error
  — Predicados de ferramenta (tool_name + tool_input):
    hook_is_file_write, hook_is_file_read, hook_is_run_in_terminal, hook_is_read_file
    hook_is_create_file, hook_is_git_cmd, hook_is_git_push, hook_is_git_commit
    hook_is_destructive_cmd, hook_is_ai_tool
  — Output builders:
    hook_out_continue, hook_out_system_message, hook_out_stop_session, hook_out_exit2
    hook_out_session_start_context, hook_out_pre_allow, hook_out_pre_deny,
    hook_out_pre_ask, hook_out_pre_update_input, hook_out_pre_full
    hook_out_post_context, hook_out_post_block, hook_out_stop_block, hook_out_stop_safe_block
    hook_out_subagent_start_context, hook_out_subagent_stop_block, hook_out_subagent_stop_safe_block

CAMADA 🟧 NOSSO (depende de session.json, audit.jsonl, close_key ou protocolo):
  hook_is_ask_questions         → depende de HOOK_TOOL_NAME == vscode_askQuestions
  hook_is_session_close_cmd     → depende de conhecer o padrão close_key
  hook_close_key_in_response    → lê close_key do session.json para comparar
  hook_is_manage_todo           → conhece manage_todo_list (ferramenta do nosso protocolo)
  hook_is_manage_todo_post      → idem, PostToolUse
  hook_is_runsubagent           → conhece runSubagent (ferramenta do nosso protocolo)
  hook_todo_last_is_ask         → interage com estado do manage_todo (nosso protocolo)
  hook_is_template_f_proposed   → detecta padrão de Template F (nosso protocolo)
  hook_summary                  → formata dados de session.json (nosso estado)
  hook_api_record               → grava em audit.jsonl (nosso estado)
  hook_api_list_captures        → lista debug-capture (nossa infra de debug)
```

> **Nota sobre `hook_is_ask_questions`**: tecnicamente verifica `tool_name == vscode_askQuestions`
> sem ler state, mas a INTENÇÃO é rastrear o Protocolo TODO (nosso) — classificado como 🟧.

> **Nota sobre `hook_is_manage_todo` / `hook_is_runsubagent`**: verificam apenas o nome da
> ferramenta no STDIN, mas são conceitos do nosso protocolo — classificados como 🟧.

---

<a id="contratos"></a>
## 2. Contratos Canônicos da Plataforma

> **FONTE**: https://code.visualstudio.com/docs/copilot/customization/hooks (consultado 2026-03-21)
> Esta seção documenta apenas o que a plataforma REALMENTE envia — sem invenções.

<a id="input-universal"></a>
### 2.1 Input Universal (todos os eventos)

```json
{
  "timestamp":       "2026-02-09T10:30:00.000Z",
  "cwd":             "/path/to/workspace",
  "sessionId":       "session-identifier",
  "hookEventName":   "PreToolUse",
  "transcript_path": "/path/to/transcript.json"
}
```

| Campo             | Tipo                | Notas                                    |
| ----------------- | ------------------- | ---------------------------------------- |
| `timestamp`       | string ISO 8601 UTC | Momento exato do evento                  |
| `cwd`             | string              | Diretório raiz do workspace              |
| `sessionId`       | string              | UUID imutável durante toda a sessão      |
| `hookEventName`   | string (PascalCase) | `"SessionStart"`, `"PreToolUse"`, etc.   |
| `transcript_path` | string              | Caminho para o JSON com todo o histórico |

> **Nota prática**: Na doc oficial `sessionId` é camelCase. Observado em campo também como `session_id`.
> Sempre usar fallback: `jq -r '.sessionId // .session_id // empty'`

<a id="output-universal"></a>
### 2.2 Output Universal (todos os eventos)

```json
{
  "continue":     true,
  "stopReason":   "Reason shown to user",
  "systemMessage": "Warning in chat"
}
```

| Campo           | Tipo    | Efeito                                                   |
| --------------- | ------- | -------------------------------------------------------- |
| `continue`      | boolean | `false` = para TODA a sessão (drástico). Default: `true` |
| `stopReason`    | string  | Razão exibida ao usuário quando `continue=false`         |
| `systemMessage` | string  | Aviso exibido no chat, independente de outras decisões   |

> ⚠️ **`continue: false` é irreversível na sessão** — encerra o agente completamente.
> Para bloquear apenas uma ferramenta, use `permissionDecision: "deny"` (PreToolUse) ou `decision: "block"` (PostToolUse/Stop).

<a id="exit-codes"></a>
### 2.3 Exit Codes

| Código  | Efeito                                                                            |
| ------- | --------------------------------------------------------------------------------- |
| `0`     | Sucesso — VS Code faz parse do stdout como JSON                                   |
| `2`     | Erro bloqueante — para o processamento; stderr é mostrado ao modelo como contexto |
| `outro` | Aviso não-bloqueante — avisa o usuário, mas continua                              |

<a id="contratos-por-evento"></a>
### 2.4 Contratos por Evento

#### SessionStart

**Input adicional:**
```json
{ "source": "new" }
```
> Doc oficial: `source` é sempre `"new"`. Observado em campo: `"reconnect"` também ocorre (caso de reconexão).

**Output (hookSpecificOutput):**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "string injetada na conversa do agente"
  }
}
```

---

#### UserPromptSubmit

**Input adicional:**
```json
{ "prompt": "texto exato digitado pelo usuário" }
```

**Output:** apenas o output universal (sem `hookSpecificOutput`).

---

#### PreToolUse

**Input adicional:**
```json
{
  "tool_name":   "create_file",
  "tool_input":  { "filePath": "src/main.js", "content": "..." },
  "tool_use_id": "tool-123"
}
```

**Output (hookSpecificOutput):**
```json
{
  "hookSpecificOutput": {
    "hookEventName":           "PreToolUse",
    "permissionDecision":      "deny",
    "permissionDecisionReason": "Operação bloqueada",
    "updatedInput":            { "filePath": "src/safe.js" },
    "additionalContext":       "contexto extra para o modelo"
  }
}
```

| Campo                      | Valores                        | Notas                                                                    |
| -------------------------- | ------------------------------ | ------------------------------------------------------------------------ |
| `permissionDecision`       | `"allow"` / `"deny"` / `"ask"` | Priority: deny > ask > allow                                             |
| `permissionDecisionReason` | string                         | Razão exibida ao usuário                                                 |
| `updatedInput`             | object                         | Substitui o `tool_input` original. Deve ter o schema exato da ferramenta |
| `additionalContext`        | string                         | Contexto injetado na conversa                                            |

---

#### PostToolUse

**Input adicional:**
```json
{
  "tool_name":    "create_file",
  "tool_input":   { "filePath": "src/main.js" },
  "tool_use_id":  "tool-123",
  "tool_response": "File created successfully"
}
```

> ⚠️ `tool_response` pode ser string OU objeto JSON dependendo da ferramenta.

**Output:**
```json
{
  "decision": "block",
  "reason":   "Validação pós-processamento falhou",
  "hookSpecificOutput": {
    "hookEventName":    "PostToolUse",
    "additionalContext": "Arquivo tem erros de lint"
  }
}
```

> ⚠️ **Diferença importante**: para PostToolUse, `decision` e `reason` ficam na **raiz** do JSON
> (não dentro de `hookSpecificOutput`). Contrário do Stop hook.

---

#### Stop

**Input adicional:**
```json
{ "stop_hook_active": false }
```

> ⚠️ **Verificar sempre `stop_hook_active`** — se `true`, o agente já está continuando por causa
> de um Stop hook anterior. Nunca emitir `decision: block` se `stop_hook_active == true`
> (loop infinito).

**Output (hookSpecificOutput):**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "decision":      "block",
    "reason":        "Execute os testes antes de finalizar"
  }
}
```

> ⚠️ Para Stop, `decision` fica **DENTRO de `hookSpecificOutput`** (ao contrário de PostToolUse).

---

#### SubagentStart

**Input adicional:**
```json
{
  "agent_id":   "subagent-456",
  "agent_type": "Plan"
}
```

**Output (hookSpecificOutput):**
```json
{
  "hookSpecificOutput": {
    "hookEventName":    "SubagentStart",
    "additionalContext": "Contexto para o subagente"
  }
}
```

---

#### SubagentStop

**Input adicional:**
```json
{
  "agent_id":         "subagent-456",
  "agent_type":       "Plan",
  "stop_hook_active": false
}
```

**Output:**
```json
{
  "decision": "block",
  "reason":   "Verificar resultados antes de concluir"
}
```

> ⚠️ Para SubagentStop, `decision` fica na **raiz** (sem `hookSpecificOutput`).

---

#### PreCompact

**Input adicional:**
```json
{ "trigger": "auto" }
```

**Output:** apenas o output universal (sem `hookSpecificOutput`).

---

### 2.5 Resumo Visual: Onde fica o `decision`/`block` em cada evento

```
PreToolUse:      hookSpecificOutput.permissionDecision = "deny"|"ask"|"allow"
PostToolUse:     { decision: "block", reason: "..." }  ← RAIZ
Stop:            hookSpecificOutput.decision = "block"  ← DENTRO
SubagentStop:    { decision: "block", reason: "..." }  ← RAIZ
```

> Esta é uma inconsistência da API da plataforma — a `hook-payload-api.sh`
> encapsula isso nos builders `hook_out_*` para que os fat libs não precisem saber.

---

<a id="nosso-sistema"></a>
## 3. O que CRIAMOS por cima da Plataforma

Tudo abaixo **não existe na plataforma** — é 100% nosso:

| Item                                | Arquivo(s)                                     | Descrição                                                             |
| ----------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| **session.json**                    | `common.sh`                                    | Estado persistente da sessão (turn_count, close_key, compliance, ...) |
| **audit.jsonl**                     | `common.sh` (`log_audit`)                      | Log de auditoria append-only em JSONL                                 |
| **session-briefing.md**             | `session-start-lib.sh`                         | Briefing gerado no início/reconexão                                   |
| **pending-tasks.md**                | scripts manuais                                | Backlog de tarefas do agente                                          |
| **session-final-report.md**         | `session-close-lib.sh`                         | Relatório gerado ao encerrar sessão                                   |
| **Protocolo TODO**                  | `stop-lib.sh`, `post-tool-use-lib.sh`          | Rastreia se vscode_askQuestions foi chamado no turno                  |
| **close_key**                       | `session-start-lib.sh`, `post-tool-use-lib.sh` | Chave para autorizar encerramento de sessão                           |
| **Templates A-G**                   | `hook-payload-api.sh` (parcial)                | Detecção de templates do protocolo nos payloads                       |
| **Hierarquia SESSION/TURN/SUBTURN** | todos os fat libs                              | Estrutura de controle de lifecycle                                    |
| **Fat lib pattern**                 | toda a arquitetura                             | Thin wrapper + fat lib per event                                      |
| **hook-payload-api.sh**             | `.github/hooks/lib/`                           | API completa de parsing/predicados/builders                           |
| **debug-capture.sh**                | `scripts/debug-capture.sh`                     | Sistema de captura de payloads reais para debug                       |
| **Scripts manuais**                 | `scripts/`                                     | start-turn.sh, add-task.sh, session-reminder.sh, etc.                 |

---

<a id="situação-atual"></a>
## 4. Situação Atual da API — v1.0

### Cobertura em relação à plataforma

```
COBERTURA DA PLATAFORMA                    v1.0
─────────────────────────────────────────────────────
Input parsing universal                    ██████ 6/6 campos
SessionStart input                         ██████ 1/1 campo
UserPromptSubmit input                     ██████ 1/1 campo
PreToolUse input (campos principais)       ██████ 3/3 campos
PreToolUse tool_input (sub-campos)         ████░░ ~70% das tools cobertas
PostToolUse input                          █████░ tool_response parcialmente parseado
Stop input                                 ██████ 1/1 campo
SubagentStart input                        ██████ 2/2 campos
SubagentStop input                         ██████ 3/3 campos
PreCompact input                           ██████ 1/1 campo

Output builders (SessionStart)             ██████ additionalContext ✓
Output builders (UserPromptSubmit)         ██████ apenas common output (correto)
Output builders (PreToolUse)               █████░ allow/deny/ask/updatedInput ✓ (full falta)
Output builders (PostToolUse)             ██████ block + additionalContext ✓
Output builders (Stop)                     ██████ block ✓
Output builders (SubagentStart/Stop)       ██████ context + block ✓
Output builders (PreCompact)               ██████ apenas common output (correto)
─────────────────────────────────────────────────────
Média: ~85% da plataforma coberta na v1.0
```

### Inventário de funções (54 funções em 9 seções)

| Seção                        | Funções                                                                                                                                                                                                                                                                                                                                                      | Tipo       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| **Core**                     | `hook_api_parse`, `hook_api_validate`, `hook_api_dump`, `hook_api_from_file`                                                                                                                                                                                                                                                                                 | Plataforma |
| **Getters universais**       | `hook_get_session_id`, `hook_get_tool_name`, `hook_get_agent_id`, `hook_get_prompt`, `hook_get_command`, `hook_get_tool_input_field`, `hook_get_response_field`                                                                                                                                                                                              | Plataforma |
| **Predicados básicos**       | `hook_is_ask_questions`, `hook_is_stop_active`, `hook_is_tool_event`, `hook_is_subagent_event`, `hook_is_session_close_cmd`, `hook_is_manage_todo`, `hook_is_manage_todo_post`, `hook_is_runsubagent`, `hook_is_background_cmd`                                                                                                                              | Misto      |
| **Predicados de ferramenta** | `hook_is_file_write`, `hook_is_file_read`, `hook_is_run_in_terminal`, `hook_is_read_file`, `hook_is_create_file`, `hook_is_git_cmd`, `hook_is_git_push`, `hook_is_git_commit`, `hook_is_destructive_cmd`, `hook_is_ai_tool`                                                                                                                                  | Plataforma |
| **Predicados avançados**     | `hook_is_template_f_proposed`, `hook_todo_last_is_ask`, `hook_close_key_in_response`, `hook_response_has_error`                                                                                                                                                                                                                                              | Nosso      |
| **Saída — comum**            | `hook_out_continue`, `hook_out_system_message`, `hook_out_stop_session`, `hook_out_exit2`                                                                                                                                                                                                                                                                    | Plataforma |
| **Saída — por evento**       | `hook_out_session_start_context`, `hook_out_pre_allow`, `hook_out_pre_deny`, `hook_out_pre_ask`, `hook_out_pre_update_input`, `hook_out_pre_full`, `hook_out_post_context`, `hook_out_post_block`, `hook_out_stop_block`, `hook_out_stop_safe_block`, `hook_out_subagent_start_context`, `hook_out_subagent_stop_block`, `hook_out_subagent_stop_safe_block` | Plataforma |
| **Utilitários**              | `hook_summary`, `hook_api_record`, `hook_api_list_captures`                                                                                                                                                                                                                                                                                                  | Nosso      |

---

<a id="gaps"></a>
## 5. Gaps identificados na v1.0

### Gaps de Plataforma (o que a plataforma pode dar mas não estamos usando bem)

| Gap                                                                                                                                                                     | Impacto | Versão |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------ |
| `updatedInput` mutation — builders avançados para cada tool                                                                                                             | Médio   | v1.1   |
| Tools não mapeadas: `get_errors`, `get_terminal_output`, `tool_search_tool_regex`, `fetch_webpage`, `run_notebook_cell`, `edit_notebook_file`, `switch_agent`, `memory` | Médio   | v1.1   |
| `multi_replace_string_in_file.replacements[]` — array não iterado pelo item                                                                                             | Médio   | v1.1   |
| `tool_response` estruturado por tool — `get_errors` retorna array, não string                                                                                           | Médio   | v1.1   |
| `transcript_path` — nunca lido; poderia enriquecer decisões                                                                                                             | Baixo   | v2.0   |
| Validação por schema por evento (type checking, enums)                                                                                                                  | Médio   | v2.5   |

### Gaps do Nosso Sistema (lógica que queremos adicionar)

| Gap                                                        | Impacto | Versão |
| ---------------------------------------------------------- | ------- | ------ |
| Segurança/sanitização: injection detection, path traversal | Alto    | v1.2   |
| Risk scoring por tool (0..5)                               | Alto    | v1.3   |
| Detecção de Templates A-G (apenas F detectado hoje)        | Alto    | v1.4   |
| API de métricas: getters para session.json                 | Médio   | v1.5   |
| close_key: geração, rotação, validação (além de detecção)  | Médio   | v2.1   |
| Subagente: profundidade de nesting, budget tracking        | Médio   | v2.2   |
| PreCompact context builder estruturado                     | Médio   | v2.3   |
| State schema versioning + migration                        | Baixo   | v2.4   |
| Motor de política (hooks-policy.json)                      | Alto    | v3.0   |

---

<a id="roadmap-por-versão"></a>
## 6. Roadmap por Versão

> **Convenção de etiqueta** (as mesmas 3 camadas da Seção 1):
> 🟦 `[Plataforma]` = campo ou contrato que a plataforma define; estamos apenas expondo o que ela envia
> 🔵 `[Derivada]` = nossa implementação, mas opera APENAS sobre dados do stdin — sem depender de session.json/audit/state
> 🟧 `[Nosso]` = depende de session.json, audit.jsonl, close_key, Templates ou outro estado nosso

---

<a id="v11"></a>
### v1.1 — Cobertura Completa de Tools �

**Meta**: todo tool que o VS Code pode invocar tem seus campos `tool_input` extraídos e predicado dedicado.

**Novas funções:**

```bash
# Predicados de ferramenta faltando 🔵 (tool_name puro → sem state)
hook_is_get_errors()              # tool_name == "get_errors"
hook_is_get_terminal_output()     # tool_name == "get_terminal_output"
hook_is_semantic_search()         # tool_name == "semantic_search"
hook_is_file_search()             # tool_name == "file_search"
hook_is_tool_search_regex()       # tool_name == "tool_search_tool_regex"
hook_is_fetch_webpage()           # tool_name == "fetch_webpage"
hook_is_run_notebook_cell()       # tool_name == "run_notebook_cell"
hook_is_edit_notebook()           # tool_name == "edit_notebook_file"
hook_is_switch_agent()            # tool_name == "switch_agent"
hook_is_memory_op()               # tool_name == "memory"
hook_is_multi_replace()           # tool_name == "multi_replace_string_in_file"

# Novas variáveis extraídas do STDIN da plataforma 🔵
HOOK_MR_REPLACEMENTS_COUNT        # número de replacements em multi_replace
HOOK_MR_FIRST_FILE_PATH           # filePath do primeiro replacement
HOOK_GET_ERRORS_PATHS_JSON        # filePaths[] passados ao get_errors
HOOK_MEMORY_COMMAND               # command do memory tool (view/create/str_replace/...)
HOOK_MEMORY_PATH                  # path do memory tool
HOOK_FETCH_URL                    # url do fetch_webpage

# Parsing de respostas PostToolUse estruturadas 🔵 (tool_response do STDIN)
hook_response_is_error_array()    # tool_response é array de erros TSC/ESLint
hook_response_error_count()       # número de erros no array
hook_get_errors_first_file()      # arquivo com mais erros

# Builders de updatedInput para PreToolUse 🔵 (constrói JSON válido p/ stdout)
hook_out_pre_update_command()     # retorna updatedInput com command modificado
hook_out_pre_update_filepath()    # retorna updatedInput com filePath limpo
```

**Testes adicionais**: ~25 → total ~176

**Gate de aceitação**: todos os tools do GUIA-HOOKS-COPILOT.md têm ao menos 1 predicado.

---

<a id="v12"></a>
### v1.2 — Hardening de Segurança �+🟧

**Meta**: detectar e sinalizar inputs malformados, injetáveis ou suspeitos antes de entrarem nos fat libs.

```bash
# Sanitização e detecção de riscos 🔵 (analisa apenas stdin — path, command)
hook_input_is_path_traversal()    # detecta ../ no HOOK_TOOL_FILE_PATH
hook_has_network_access()         # detecta curl/wget/xh no comando
hook_is_within_workspace()        # valida filePath dentro do cwd (da plataforma)
hook_sanitize_for_log()           # remove chars perigosos para logging seguro ← 🔵 pura

# Detecção avançada 🟧 (usa session.json — ex: lista de comandos proibidos personalizada)
hook_input_has_injection()        # detecta padrões de injection + regras do state
hook_input_command_score()        # 0..100: score heurístico + política do state
hook_is_secret_exposure_risk()    # detecta tokens/passwords (pode usar lista negra do state)

# Variáveis 🔵 (derivadas do stdin)
HOOK_SECURITY_SCORE               # 0..100
HOOK_SECURITY_FLAGS               # lista de flags ativas: "PATH_TRAVERSAL INJECTION"
```

**Testes adicionais**: ~20 → total ~196

---

<a id="v13"></a>
### v1.3 — Camada de Risco e Política �+🟧

**Meta**: classificar cada tool call por nível de risco, permitindo decisões automáticas de política.

**Escala de risco (0..5):**
```
0 — Leitura pura       (read_file, list_dir, semantic_search, grep_search)
1 — Leitura agressiva  (file_search em todo o workspace, get_errors globais)
2 — Escrita reversível (create_file novo, edit_notebook, memory view)
3 — Escrita crítica    (replace_string, multi_replace, memory write/create)
4 — Execução local     (run_in_terminal — background=false)
5 — Execução + rede    (run_in_terminal com curl/git push, fetch_webpage)
```

```bash
# Risco 🔵 (derivado de tool_name + tool_input — sem state)
hook_tool_risk_level()            # retorna 0..5
hook_tool_category()              # "read"|"write"|"exec"|"ai"|"state"
hook_is_high_risk()               # risk >= 4
hook_is_medium_risk()             # risk == 3
hook_requires_confirmation()      # risk >= 4 → candidato a hook_out_pre_ask

# Decisão de política simples 🟧 (usa hooks-policy.json — estado nosso)
hook_policy_allow()               # aplica política padrão → true se permitido
hook_policy_reason()              # razão da decisão

# Variáveis 🔵
HOOK_RISK_LEVEL                   # 0..5
HOOK_TOOL_CATEGORY                # categoria da ferramenta
```

**Testes adicionais**: ~20 → total ~216

---

<a id="v14"></a>
### v1.4 — Detecção de Templates e Protocolo 🟧

**Meta**: detectar todos os 7 templates do protocolo (A-G) dentro das perguntas do `vscode_askQuestions`.

**Templates a detectar:**
```
A — Next Step (tarefa concluída — continuidade)
B — Bug Discovery (≥ 3 bugs encontrados)
C — Upgrade Proposal (proposta arquitetural)
D — Checkpoint Periódico (a cada ~15 turnos)
E — Session Kickoff (sessão sem prompt explícito)
F — Session Close (encerramento com close_key) ← já existe na v1.0
G — Commit/Push Pre-Authorization
```

```bash
# Detecção de templates 🟧 (nosso protocolo — sem correspondente na plataforma)
hook_is_template_a()              # questions contém padrão Template A
hook_is_template_b()              # questions contém padrão Template B
hook_is_template_c()              # questions contém padrão Template C
hook_is_template_d()              # questions contém padrão Template D
hook_is_template_e()              # questions contém padrão Template E
# hook_is_template_f_proposed()  já existe
hook_is_template_g()              # questions contém padrão Template G
hook_detect_template()            # retorna "A"|"B"|"C"|"D"|"E"|"F"|"G"|"UNKNOWN"
hook_template_label()             # descrição legível

# Variáveis 🟧
HOOK_TEMPLATE                     # "A".."G" | "UNKNOWN"
HOOK_TEMPLATE_LABEL               # string descritiva
```

**Testes adicionais**: ~20 → total ~236

---

<a id="v15"></a>
### v1.5 — API de Métricas de Sessão 🟧

**Meta**: expor os campos do `session.json` como funções getter, evitando manipulação direta de JSON nos fat libs.

```bash
# Getters de session_stats 🟧
hook_stat_turn_count()            # session_stats.turn_count
hook_stat_turn_authorized()       # session_stats.turn_authorized
hook_stat_turn_unauthorized()     # session_stats.turn_unauthorized
hook_stat_subturn_total()         # session_stats.subturn_total
hook_stat_tools_total()           # session_stats.tools_total

# Getters de current_turn 🟧
hook_turn_number()                # current_turn.number
hook_turn_ask_called()            # current_turn.ask_questions_called
hook_turn_started_at()            # current_turn.started_at

# Getters de compliance 🟧
hook_compliance_consecutive()     # compliance.consecutive_unauthorized
hook_compliance_last_authorized() # compliance.last_turn_authorized

# Predicados de saúde 🟧
hook_session_is_healthy()         # sem turnos órfãos; contadores consistentes
hook_compliance_ok()              # consecutive_unauthorized == 0
hook_needs_askquestions()         # turno aberto sem askQuestions chamado
hook_is_orphan_turn()             # turno com started_at > 1h sem Stop

# Variáveis 🟧
HOOK_STAT_TURN_COUNT
HOOK_STAT_TURN_AUTHORIZED
HOOK_COMPLIANCE_CONSECUTIVE
HOOK_SESSION_CLOSE_KEY
```

**Testes adicionais**: ~20 → total ~256

---

<a id="v20"></a>
### v2.0 — API de Transcript e Histórico 🟦→🔵

**Meta**: parsear `transcript_path` (campo fornecido pela PLATAFORMA em todos os eventos) para enriquecer decisões.

> A plataforma envia `transcript_path` — nós nunca usamos esse dado. v2.0 muda isso.
> As funções de leitura são 🔵 (parseiam apenas o arquivo que a plataforma aponta).
> As funções que cruzam com session state são 🟧.

```bash
# Leitura do transcript 🔵 (arquivo apontado pela plataforma — sem nosso state)
hook_transcript_load()            # lê transcript_path → popula HOOK_TX_*
hook_transcript_message_count()   # número de mensagens
hook_transcript_last_user_msg()   # última mensagem do usuário
hook_transcript_last_n_msgs()     # últimas N mensagens
hook_transcript_tool_calls()      # tool calls no turno atual

# Predicados 🔵 (derivados do arquivo de transcript)
hook_tx_had_git_push_in_turn()    # git push ocorreu no turno atual
hook_tx_had_commit_in_turn()      # git commit ocorreu no turno atual

# Predicado 🟧 (cruza transcript com protocolo nosso)
hook_tx_had_askquestions_in_turn() # vscode_askQuestions foi chamado (via transcript)

# Variáveis 🟦 (campo vem da plataforma)
HOOK_TX_LOADED
HOOK_TX_MSG_COUNT
HOOK_TX_LAST_USER
HOOK_TX_TOOL_CALLS_JSON
```

**Limite**: transcript pode ter >10MB — parsing deve ser lazy com limite de mensagens.

**Testes adicionais**: ~20 → total ~276

---

<a id="v21"></a>
### v2.1 — Gestão de close_key 🟧

**Meta**: centralizar toda a lógica de close_key na API.

```bash
# Geração e rotação 🟧
hook_close_key_generate()         # gera "ENCERRAR-XXXXXXXX" (8 chars hex uppercase)
hook_close_key_rotate()           # gera nova close_key + persiste no session.json
hook_close_key_read()             # lê close_key do session.json

# Validação 🟧
hook_close_key_valid_format()     # valida formato ENCERRAR-XXXXXXXX
hook_close_key_matches()          # compara KEY fornecida com a do session.json
# hook_close_key_in_response()   já existe (v1.0)

# Variáveis 🟧
HOOK_CLOSE_KEY_VALUE
HOOK_CLOSE_KEY_IN_PAYLOAD
```

**Testes adicionais**: ~15 → total ~291

---

<a id="v22"></a>
### v2.2 — API de Subagente e Grafo de Agentes 🟦+🟧

**Meta**: rastrear hierarquia de subagentes (campos `agent_id`, `agent_type` da plataforma) + budget tracking (nosso).

```bash
# Grafo de subagentes 🟧 (usando agent_id da plataforma 🟦)
hook_subagent_depth()             # profundidade de nesting
hook_subagent_is_nested()         # depth > 0
hook_subagent_parent_id()         # agent_id do pai (do state)
hook_subagent_budget_ok()         # abaixo do limite de invocações

# Tracking 🟧
hook_subagent_count_session()     # total de subagentes na sessão
hook_subagent_count_turn()        # total no turno atual

# Variáveis
HOOK_SUBAGENT_DEPTH
HOOK_SUBAGENT_COUNT_SESSION
HOOK_SUBAGENT_BUDGET_LIMIT
```

**Testes adicionais**: ~15 → total ~306

---

<a id="v23"></a>
### v2.3 — Context Builder para PreCompact 🟧

**Meta**: construir `additionalContext` rico e estruturado para o PreCompact (nosso estado → output da plataforma).

```bash
# Builders de context 🟧 → injetados no output da plataforma 🟦
hook_compact_ctx_session_summary()   # seção: stats da sessão
hook_compact_ctx_pending_tasks()     # seção: tarefas pendentes
hook_compact_ctx_close_key()         # seção: close_key (para que agente não perca)
hook_compact_ctx_findings()          # seção: findings.md
hook_compact_ctx_full()              # combina todos → string markdown

# Variáveis 🟧
HOOK_COMPACT_CONTEXT_BYTES
```

**Testes adicionais**: ~15 → total ~321

---

<a id="v24"></a>
### v2.4 — Versionamento e Migração de State 🟧

```bash
hook_state_version()              # lê .state_schema_version
hook_state_needs_migration()      # compara versão com esperada
hook_state_migrate()              # upgrade seguro do schema
hook_state_schema_ok()            # valida campos obrigatórios
```

**Testes adicionais**: ~10 → total ~331

---

<a id="v25"></a>
### v2.5 — Schemas de Validação Estritos 🟦

**Meta**: validação por evento com type checking baseada exatamente nos contratos da plataforma.

```bash
# Um validador por evento 🟦
hook_validate_session_start()     # source deve ser string
hook_validate_user_prompt()       # prompt não-vazio
hook_validate_pre_tool_use()      # tool_name string; tool_input object; tool_use_id string
hook_validate_post_tool_use()     # tool_use_id; tool_response presente
hook_validate_stop()              # stop_hook_active boolean
hook_validate_subagent()          # agent_id e agent_type presentes
hook_validate_pre_compact()       # trigger == "auto"

# Variáveis
HOOK_VALIDATION_ERRORS_JSON       # array JSON de erros
HOOK_VALIDATION_WARNINGS_JSON     # avisos não-bloqueantes
```

**Testes adicionais**: ~20 → total ~351

---

<a id="v30"></a>
### v3.0 — Motor de Política Completo 🟧

**Meta**: arquivo `hooks-policy.json` drive a lógica de allow/deny/ask sem alterar código.

**Arquivo `hooks-policy.json`:**
```json
{
  "version": "1.0",
  "rules": [
    {
      "event": "PreToolUse",
      "when": { "risk_level_gte": 4 },
      "action": "ask",
      "message": "Operação de alto risco requer confirmação."
    },
    {
      "event": "PreToolUse",
      "when": { "tool": "run_in_terminal", "command_matches": "rm\\s+-rf" },
      "action": "deny",
      "reason": "Deleção recursiva bloqueada."
    },
    {
      "event": "PreToolUse",
      "when": { "is_git_push": true },
      "action": "ask_template",
      "template": "G"
    }
  ]
}
```

```bash
# Motor de política 🟧
hook_policy_load()                # carrega hooks-policy.json
hook_policy_evaluate()            # avalia regras → HOOK_POLICY_ACTION
hook_policy_action()              # "allow"|"deny"|"ask"|"ask_template"
hook_policy_message()             # mensagem da regra disparada
hook_policy_matched_rule()        # índice da regra que casou
hook_policy_audit_log()           # loga decisão no audit.jsonl

# Variáveis
HOOK_POLICY_ACTION
HOOK_POLICY_REASON
HOOK_POLICY_TEMPLATE
```

**Integração**: `pre-tool-use-lib.sh` delegará toda decisão a `hook_policy_evaluate()`.

**Testes adicionais**: ~50 → total ~401

---

<a id="catálogo-v10"></a>
## 7. Catálogo Completo de Funções — v1.0

```
🟦 PLATAFORMA (4 funções — expõem o contrato de STDIN/STDOUT)
  hook_api_parse          hook_api_validate
  hook_api_dump           hook_api_from_file

🔵 DERIVADA (37 funções — nossa lógica, input = apenas STDIN, sem state)
  — Getters (7):
    hook_get_session_id       hook_get_tool_name      hook_get_agent_id
    hook_get_prompt           hook_get_command
    hook_get_tool_input_field hook_get_response_field
  — Predicados (5):
    hook_is_stop_active       hook_is_tool_event      hook_is_subagent_event
    hook_is_background_cmd    hook_response_has_error
  — Predicados de ferramenta (10):
    hook_is_file_write        hook_is_file_read        hook_is_run_in_terminal
    hook_is_read_file         hook_is_create_file      hook_is_git_cmd
    hook_is_git_push          hook_is_git_commit       hook_is_destructive_cmd
    hook_is_ai_tool
  — Output-comum (4):
    hook_out_continue         hook_out_system_message
    hook_out_stop_session     hook_out_exit2
  — Output-evento (13):
    hook_out_session_start_context
    hook_out_pre_allow        hook_out_pre_deny        hook_out_pre_ask
    hook_out_pre_update_input hook_out_pre_full
    hook_out_post_context     hook_out_post_block
    hook_out_stop_block       hook_out_stop_safe_block
    hook_out_subagent_start_context
    hook_out_subagent_stop_block   hook_out_subagent_stop_safe_block

🟧 NOSSO (13 funções — dependem de estado/protocolo nosso)
  — Protocolo / ferramentas do nosso sistema (7):
    hook_is_ask_questions         hook_is_session_close_cmd
    hook_is_manage_todo           hook_is_manage_todo_post
    hook_is_runsubagent           hook_todo_last_is_ask
    hook_is_template_f_proposed
  — close_key (1):
    hook_close_key_in_response
  — Infraestrutura de debug/audit (3):
    hook_summary  hook_api_record  hook_api_list_captures

TOTAL v1.0: 54 funções | 1214 linhas | 35 variáveis expostas
  Plataforma:  4 (7%)
  Derivada:   37 (69%)
  Nosso:      13 (24%)
```

---

<a id="catálogo-v30"></a>
## 8. Catálogo Alvo — v3.0 (150+ funções)

```
Novas funções por versão (planejadas):
  v1.1  +17  (🔵 predicados tools + response parsers + updatedInput builders)
  v1.2  + 7  (🔵 path/injection + 🟧 policy-aware scoring)
  v1.3  + 9  (🔵 risk_level/category + 🟧 policy_allow)
  v1.4  + 9  (🟧 templates A-G + detect + label)
  v1.5  +15  (🟧 getters de session.json + compliance + predicados de saúde)
  v2.0  +10  (🔵 transcript load/parse + 🟧 tx_had_askquestions)
  v2.1  + 6  (🟧 close_key lifecycle: generate/rotate/validate)
  v2.2  + 7  (🔵 agent_id/agent_type + 🟧 budget tracking)
  v2.3  + 6  (🟧 compact context builder)
  v2.4  + 4  (🟧 state schema migration)
  v2.5  + 8  (🔵 validation schemas per event — baseado em contratos da plataforma)
  v3.0  +10  (🟧 motor de política completo)
  ─────────────────────────────────────────────
  TOTAL     +108 novas

PROJEÇÃO v3.0:
  54 + 108 = ~162 funções | ~3000 linhas | ~65 variáveis | ~401 testes
  🟦 Plataforma:  ~4   (3%)
  🔵 Derivada:   ~80  (49%)
  🟧 Nosso:      ~78  (48%)
```

---

<a id="critérios-de-gate"></a>
## 9. Critérios de Gate por Versão

| Versão | Gate                                                                                  |
| ------ | ------------------------------------------------------------------------------------- |
| v1.1   | Smoke test ≥ 176 PASS + shellcheck limpo + todos os tools do GUIA cobertos            |
| v1.2   | Injection/traversal detectados em 5+ casos de teste; score=0 para payloads limpos     |
| v1.3   | `hook_tool_risk_level()` correto para 15 ferramentas; integration test lifecycle      |
| v1.4   | Todos os Templates A-G detectados em fixtures realistas (1 fixture por template)      |
| v1.5   | `hook_session_is_healthy()` funciona end-to-end (lifecycle test T-I-22)               |
| v2.0   | Transcript de 50 msgs parseado em < 2s; 3 predicados transcript corretos              |
| v2.1   | Round-trip generate→check→rotate funciona + formato ENCERRAR-XXXXXXXX validado        |
| v2.2   | Subagente aninhado 3 níveis: depth=3 detectado; budget limit respeitado               |
| v2.3   | `hook_compact_ctx_full()` com 20 turnos cabe em 2000 chars                            |
| v2.4   | Migração state v0→v1 sem perda de dados (smoke test)                                  |
| v2.5   | Payload com campo errado rejeitado; payload correto passa — para todos os 7 eventos   |
| v3.0   | Motor de política processa 10 regras + audit log correto + integration test lifecycle |

---

<a id="questões-em-aberto"></a>
## 10. Questões em Aberto

| #   | Questão                                                                                                                    | Versão        |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Q1  | `source: "reconnect"` — confirmado em campo mas não documentado oficialmente. Tratar como valor válido ou como workaround? | v1.0/contrato |
| Q2  | `tool_response` em PostToolUse — é string ou JSON? A plataforma não especifica. Como detectar e parsear de forma robusta?  | v1.1          |
| Q3  | Limite de tamanho de `additionalContext` — existe limite máximo? O que acontece se exceder?                                | v1.5/v2.3     |
| Q4  | `transcript_path` — o arquivo está sempre disponível? Pode ter delay de escrita?                                           | v2.0          |
| Q5  | `hooks-policy.json` — hot reload (detectar mudança no arquivo) ou reload manual?                                           | v3.0          |
| Q6  | `session_stats.tools_total` — deve incluir ou excluir `vscode_askQuestions`?                                               | v1.5          |
| Q7  | Motor de política: first-match ou todas as regras? Prioridade explícita?                                                   | v3.0          |
| Q8  | `updatedInput` — se o schema não bater com o esperado, a plataforma ignora silenciosamente?                                | v1.1          |
| Q9  | Templates A-G — detecção por keyword exata ou pattern fuzzy (Levenshtein)?                                                 | v1.4          |
| Q10 | `hook_state_migrate()` — deve fazer backup automático antes de migrar?                                                     | v2.4          |

---

## Histórico de Versões

| Versão | Data       | Descrição                                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0    | 2026-03-21 | Criação inicial: situação atual v1.0 + roadmap v1.1→v3.0                                                                                                                                                                                                                                                                                                                                              |
| 2.0    | 2026-03-21 | Revisão completa: seção "DIVISÃO FUNDAMENTAL" adicionada. Contratos canônicos da plataforma documentados (consultado docs.vscode.com). Cada versão do roadmap rotulada como 🟦 Plataforma vs 🟧 Nosso. Nuance post vs stop `decision` documentada.                                                                                                                                                      |
| 3.0    | 2026-03-18 | Modularização completa: `hook-payload-api.sh` (1214 linhas) dividido em 6 módulos `lib/api/`. Loader de 144 linhas. 151→151 smoke tests, 93→93 integration tests.                                                                                                                                                                                                                                     |
| 3.1    | 2026-03-18 | **v1.1 implementada**: 11 predicados de tools, 6 variáveis novas, 3 response parsers, 2 output builders. 151→185 smoke tests (34 novos).                                                                                                                                                                                                                                                              |
| 3.2    | 2026-03-18 | **v1.2 implementada**: 7 funções de segurança (`hook_input_is_path_traversal`, `hook_has_network_access`, `hook_is_within_workspace`, `hook_sanitize_for_log`, `hook_input_has_injection`, `hook_input_command_score`, `hook_is_secret_exposure_risk`), `_hook_security_compute`, `HOOK_SECURITY_SCORE`, `HOOK_SECURITY_FLAGS`. 185→205 smoke tests (20 novos).                                       |
| 3.3    | 2026-03-21 | **Refactor 🟧 isolation**: criado `07-state.sh` com as 3 funções que dependem de estado externo (`hook_close_key_in_response`, `hook_is_template_f_proposed`, `hook_api_record`). Removidas de `04-predicates.sh` e `06-query.sh`. Loader atualizado para 7 módulos. SC_EXIT=0, 205/205 smoke, 111/111 integration.                                                                                    |
| 3.4    | 2026-03-21 | **v1.3 implementada**: `08-risk.sh` com `hook_tool_risk_level` (0..5), `hook_tool_category` (5 categorias), `hook_is_high_risk`, `hook_is_medium_risk`, `hook_requires_confirmation`, `hook_policy_allow`, `hook_policy_reason`, `_hook_risk_compute`. `HOOK_RISK_LEVEL` e `HOOK_TOOL_CATEGORY` populados automaticamente após `hook_api_parse`. 205→223 smoke tests (18 novos T-76→T-87). SC_EXIT=0. |


---

## Índice

- [API HOOKS — Situação Atual e Roadmap Completo](#api-hooks--situação-atual-e-roadmap-completo)
  - [Índice](#índice)
  - [0. Estrutura Modular de Arquivos](#0-estrutura-modular-de-arquivos)
    - [Estrutura atual](#estrutura-atual)
    - [Responsabilidade de cada módulo](#responsabilidade-de-cada-módulo)
    - [Compatibilidade retroativa](#compatibilidade-retroativa)
    - [Como adicionar uma nova função](#como-adicionar-uma-nova-função)
  - [1. DIVISÃO FUNDAMENTAL: Três Categorias](#1-divisão-fundamental-três-categorias)
    - [Regra de ouro para classificar cada função:](#regra-de-ouro-para-classificar-cada-função)
    - [Classificação das 54 funções da v1.0](#classificação-das-54-funções-da-v10)
  - [2. Contratos Canônicos da Plataforma](#2-contratos-canônicos-da-plataforma)
    - [2.1 Input Universal (todos os eventos)](#21-input-universal-todos-os-eventos)
    - [2.2 Output Universal (todos os eventos)](#22-output-universal-todos-os-eventos)
    - [2.3 Exit Codes](#23-exit-codes)
    - [2.4 Contratos por Evento](#24-contratos-por-evento)
      - [SessionStart](#sessionstart)
      - [UserPromptSubmit](#userpromptsubmit)
      - [PreToolUse](#pretooluse)
      - [PostToolUse](#posttooluse)
      - [Stop](#stop)
      - [SubagentStart](#subagentstart)
      - [SubagentStop](#subagentstop)
      - [PreCompact](#precompact)
    - [2.5 Resumo Visual: Onde fica o `decision`/`block` em cada evento](#25-resumo-visual-onde-fica-o-decisionblock-em-cada-evento)
  - [3. O que CRIAMOS por cima da Plataforma](#3-o-que-criamos-por-cima-da-plataforma)
  - [4. Situação Atual da API — v1.0](#4-situação-atual-da-api--v10)
    - [Cobertura em relação à plataforma](#cobertura-em-relação-à-plataforma)
    - [Inventário de funções (54 funções em 9 seções)](#inventário-de-funções-54-funções-em-9-seções)
  - [5. Gaps identificados na v1.0](#5-gaps-identificados-na-v10)
    - [Gaps de Plataforma (o que a plataforma pode dar mas não estamos usando bem)](#gaps-de-plataforma-o-que-a-plataforma-pode-dar-mas-não-estamos-usando-bem)
    - [Gaps do Nosso Sistema (lógica que queremos adicionar)](#gaps-do-nosso-sistema-lógica-que-queremos-adicionar)
  - [6. Roadmap por Versão](#6-roadmap-por-versão)
    - [v1.1 — Cobertura Completa de Tools �](#v11--cobertura-completa-de-tools-)
    - [v1.2 — Hardening de Segurança �+🟧](#v12--hardening-de-segurança-)
    - [v1.3 — Camada de Risco e Política �+🟧](#v13--camada-de-risco-e-política-)
    - [v1.4 — Detecção de Templates e Protocolo 🟧](#v14--detecção-de-templates-e-protocolo-)
    - [v1.5 — API de Métricas de Sessão 🟧](#v15--api-de-métricas-de-sessão-)
    - [v2.0 — API de Transcript e Histórico 🟦→🔵](#v20--api-de-transcript-e-histórico-)
    - [v2.1 — Gestão de close\_key 🟧](#v21--gestão-de-close_key-)
    - [v2.2 — API de Subagente e Grafo de Agentes 🟦+🟧](#v22--api-de-subagente-e-grafo-de-agentes-)
    - [v2.3 — Context Builder para PreCompact 🟧](#v23--context-builder-para-precompact-)
    - [v2.4 — Versionamento e Migração de State 🟧](#v24--versionamento-e-migração-de-state-)
    - [v2.5 — Schemas de Validação Estritos 🟦](#v25--schemas-de-validação-estritos-)
    - [v3.0 — Motor de Política Completo 🟧](#v30--motor-de-política-completo-)
  - [7. Catálogo Completo de Funções — v1.0](#7-catálogo-completo-de-funções--v10)
  - [8. Catálogo Alvo — v3.0 (150+ funções)](#8-catálogo-alvo--v30-150-funções)
  - [9. Critérios de Gate por Versão](#9-critérios-de-gate-por-versão)
  - [10. Questões em Aberto](#10-questões-em-aberto)
  - [Histórico de Versões](#histórico-de-versões)
  - [Índice](#índice-1)
  - [1. Situação Atual — v1.0](#1-situação-atual--v10)
    - [Inventário de funções (54 funções em 9 seções)](#inventário-de-funções-54-funções-em-9-seções-1)
    - [Variáveis expostas após `hook_api_parse` (35 variáveis)](#variáveis-expostas-após-hook_api_parse-35-variáveis)
    - [Gaps identificados na v1.0](#gaps-identificados-na-v10)
  - [2. Visão de Destino — v3.0](#2-visão-de-destino--v30)
  - [3. Mapa de Funcionalidade por Dimensão](#3-mapa-de-funcionalidade-por-dimensão)
  - [4. Roadmap por Versão](#4-roadmap-por-versão)
    - [v1.1 — Cobertura Completa de Tools](#v11--cobertura-completa-de-tools)
    - [v1.2 — Hardening de Segurança](#v12--hardening-de-segurança)
    - [v1.3 — Camada de Risco e Política](#v13--camada-de-risco-e-política)
    - [v1.4 — Detecção de Templates e Protocolo](#v14--detecção-de-templates-e-protocolo)
    - [v1.5 — API de Métricas de Sessão](#v15--api-de-métricas-de-sessão)
    - [v2.0 — API de Transcript e Histórico](#v20--api-de-transcript-e-histórico)
    - [v2.1 — Gestão de close\_key](#v21--gestão-de-close_key)
    - [v2.2 — API de Subagente e Grafo de Agentes](#v22--api-de-subagente-e-grafo-de-agentes)
    - [v2.3 — Context Builder para PreCompact](#v23--context-builder-para-precompact)
    - [v2.4 — Versionamento e Migração de State](#v24--versionamento-e-migração-de-state)
    - [v2.5 — Schemas de Validação Estritos](#v25--schemas-de-validação-estritos)
    - [v3.0 — Motor de Política Completo](#v30--motor-de-política-completo)
  - [5. Catálogo Completo de Funções — v1.0](#5-catálogo-completo-de-funções--v10)
  - [6. Catálogo Alvo — v3.0 (120+ funções)](#6-catálogo-alvo--v30-120-funções)
  - [7. Critérios de Gate por Versão](#7-critérios-de-gate-por-versão)
  - [8. Questões em Aberto](#8-questões-em-aberto)
  - [Histórico de Versões](#histórico-de-versões-1)

---

<a id="situação-atual"></a>
## 1. Situação Atual — v1.0

### Inventário de funções (54 funções em 9 seções)

| Seção                        | Funções                                                                                                                                                                                                                                                                                                                                                      | Descrição                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| **Core**                     | `hook_api_parse`, `hook_api_validate`, `hook_api_dump`, `hook_api_from_file`                                                                                                                                                                                                                                                                                 | Parsing de stdin, validação, debug |
| **Getters universais**       | `hook_get_session_id`, `hook_get_tool_name`, `hook_get_agent_id`, `hook_get_prompt`, `hook_get_command`, `hook_get_tool_input_field`, `hook_get_response_field`                                                                                                                                                                                              | Acesso tipado a campos             |
| **Predicados básicos**       | `hook_is_ask_questions`, `hook_is_stop_active`, `hook_is_tool_event`, `hook_is_subagent_event`, `hook_is_session_close_cmd`, `hook_is_manage_todo`, `hook_is_manage_todo_post`, `hook_is_runsubagent`, `hook_is_background_cmd`                                                                                                                              | Detecção de tipo de evento         |
| **Predicados de ferramenta** | `hook_is_file_write`, `hook_is_file_read`, `hook_is_run_in_terminal`, `hook_is_read_file`, `hook_is_create_file`, `hook_is_git_cmd`, `hook_is_git_push`, `hook_is_git_commit`, `hook_is_destructive_cmd`, `hook_is_ai_tool`                                                                                                                                  | Classificação de ferramentas       |
| **Predicados avançados**     | `hook_is_template_f_proposed`, `hook_todo_last_is_ask`, `hook_close_key_in_response`, `hook_response_has_error`                                                                                                                                                                                                                                              | Detecção semântica                 |
| **Saída — comum**            | `hook_out_continue`, `hook_out_system_message`, `hook_out_stop_session`, `hook_out_exit2`                                                                                                                                                                                                                                                                    | Builders de resposta universal     |
| **Saída — por evento**       | `hook_out_session_start_context`, `hook_out_pre_allow`, `hook_out_pre_deny`, `hook_out_pre_ask`, `hook_out_pre_update_input`, `hook_out_pre_full`, `hook_out_post_context`, `hook_out_post_block`, `hook_out_stop_block`, `hook_out_stop_safe_block`, `hook_out_subagent_start_context`, `hook_out_subagent_stop_block`, `hook_out_subagent_stop_safe_block` | Builders especializados por evento |
| **Utilitários**              | `hook_summary`, `hook_api_record`, `hook_api_list_captures`                                                                                                                                                                                                                                                                                                  | Debug e captura                    |

### Variáveis expostas após `hook_api_parse` (35 variáveis)

```bash
# Universais
HOOK_RAW, HOOK_EVENT, HOOK_SESSION_ID, HOOK_TIMESTAMP, HOOK_CWD, HOOK_TRANSCRIPT
HOOK_PARSE_OK, HOOK_VALIDATION_OK, HOOK_VALIDATION_ERR

# SessionStart
HOOK_SOURCE

# UserPromptSubmit
HOOK_PROMPT

# PreToolUse + PostToolUse
HOOK_TOOL_NAME, HOOK_TOOL_USE_ID, HOOK_TOOL_INPUT

# tool_input sub-campos
HOOK_TOOL_COMMAND, HOOK_TOOL_EXPLANATION, HOOK_TOOL_GOAL, HOOK_TOOL_IS_BG
HOOK_TOOL_TIMEOUT, HOOK_TOOL_FILE_PATH, HOOK_TOOL_START_LINE, HOOK_TOOL_END_LINE
HOOK_TOOL_OLD_STRING, HOOK_TOOL_NEW_STRING, HOOK_TOOL_QUERY, HOOK_TOOL_IS_REGEX
HOOK_TOOL_INCLUDE_PAT, HOOK_TOOL_DIR_PATH, HOOK_TOOL_AGENT_NAME, HOOK_TOOL_AGENT_PROMPT
HOOK_ASK_QUESTIONS_JSON, HOOK_TODO_LIST_JSON, HOOK_TODO_LAST_TITLE
HOOK_TODO_LAST_STATUS, HOOK_TODO_COUNT

# PostToolUse
HOOK_TOOL_RESPONSE, HOOK_TOOL_RESPONSE_IS_JSON, HOOK_TOOL_RESPONSE_TEXT
HOOK_ASK_FREE_TEXT, HOOK_ASK_SELECTED, HOOK_ASK_ALL_TEXT, HOOK_ASK_SKIPPED

# Stop / SubagentStop
HOOK_STOP_HOOK_ACTIVE

# PreCompact
HOOK_COMPACT_TRIGGER

# SubagentStart / SubagentStop
HOOK_AGENT_ID, HOOK_AGENT_TYPE
```

### Gaps identificados na v1.0

| Categoria             | Gap                                                                                                                                          | Impacto |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Tool coverage         | `get_errors`, `get_terminal_output`, `tool_search_tool_regex`, `fetch_webpage`, `run_notebook_cell`, etc. — sem campos específicos extraídos | Médio   |
| Tool coverage         | `multi_replace_string_in_file` — `replacements[]` array não parseado por item                                                                | Médio   |
| PostToolUse response  | `get_errors` retorna array estruturado não parseado                                                                                          | Médio   |
| Security              | Nenhuma sanitização de input — risco de injection em comandos                                                                                | Alto    |
| Métricas de sessão    | Sem helpers para ler `session.json` via API                                                                                                  | Médio   |
| Detecção de templates | Apenas Template F detectado (`hook_is_template_f_proposed`)                                                                                  | Alto    |
| close_key             | Apenas detecção — sem geração, rotação, validação                                                                                            | Médio   |
| Transcript            | Sem API para ler `transcript_path`                                                                                                           | Baixo   |
| Validação             | Sem schemas por evento (qualquer JSON passa)                                                                                                 | Médio   |
| Mock generators       | Sem funções para gerar payloads de teste                                                                                                     | Baixo   |

---

<a id="visão-de-destino"></a>
## 2. Visão de Destino — v3.0

A v3.0 da API deve ser capaz de ser o **motor completo de decisão** para qualquer hook script,
substituindo heurísticas ad-hoc por funções declarativas e testadas.

**Características da v3.0:**
- 120+ funções em 15+ categorias
- 400+ testes (smoke + integration + edge cases)
- Zero lógica duplicada entre os fat libs — tudo delegado à API
- Detecção completa de todos os 7 templates (A-G) do protocolo
- Motor de política extensível via arquivo `hooks-policy.json`
- Transcript parser para raciocinar sobre histórico da conversa
- Input sanitizado e validado por schema por evento
- Suite de mock generators para facilitar testes

---

<a id="mapa-de-funcionalidade"></a>
## 3. Mapa de Funcionalidade por Dimensão

```
DIMENSÃO             v1.0    v1.5    v2.5    v3.0
─────────────────────────────────────────────────
Input parsing        ████░░  ████░░  ██████  ██████
Output builders      █████░  █████░  ██████  ██████
Predicados básicos   ████░░  █████░  ██████  ██████
Segurança/sanitiz.   ░░░░░░  ██░░░░  ████░░  ██████
Risco e política     ░░░░░░  ░░░░░░  ████░░  ██████
Templates A-G        █░░░░░  ███░░░  █████░  ██████
Métricas de sessão   ░░░░░░  ████░░  █████░  ██████
Transcript API       ░░░░░░  ░░░░░░  ██░░░░  ████░░
close_key lifecycle  █░░░░░  ███░░░  █████░  ██████
Subagente / grafo    ██░░░░  ████░░  █████░  ██████
PreCompact context   █░░░░░  ██░░░░  ████░░  █████░
Validação schemas    █░░░░░  ██░░░░  ████░░  ██████
Mock generators      ░░░░░░  ░░░░░░  ██░░░░  ████░░
Motor de política    ░░░░░░  ░░░░░░  ░░░░░░  ██████
─────────────────────────────────────────────────
(█ = 20% da capacidade total)
```

---

<a id="roadmap-por-versão"></a>
## 4. Roadmap por Versão

---

<a id="v11"></a>
### v1.1 — Cobertura Completa de Tools

**Meta**: todo tool que o VS Code pode invocar tem seus campos `tool_input` extraídos e predicado dedicado.

**Novas funções:**

```bash
# Predicados de ferramenta (faltando na v1.0)
hook_is_get_errors()              # tool_name == "get_errors"
hook_is_get_terminal_output()     # tool_name == "get_terminal_output"
hook_is_semantic_search()         # tool_name == "semantic_search"
hook_is_file_search()             # tool_name == "file_search"
hook_is_tool_search_regex()       # tool_name == "tool_search_tool_regex"
hook_is_fetch_webpage()           # tool_name == "fetch_webpage"
hook_is_run_notebook_cell()       # tool_name == "run_notebook_cell"
hook_is_edit_notebook()           # tool_name == "edit_notebook_file"
hook_is_switch_agent()            # tool_name == "switch_agent"
hook_is_memory_op()               # tool_name == "memory"
hook_is_multi_replace()           # tool_name == "multi_replace_string_in_file"

# Novas variáveis após hook_api_parse (v1.1)
HOOK_MR_REPLACEMENTS_COUNT        # número de replacements em multi_replace
HOOK_MR_FIRST_FILE_PATH           # filePath do primeiro replacement
HOOK_GET_ERRORS_PATHS_JSON        # filePaths[] passados ao get_errors
HOOK_MEMORY_COMMAND               # command do memory tool (view/create/str_replace/...)
HOOK_MEMORY_PATH                  # path do memory tool
HOOK_FETCH_URL                    # url do fetch_webpage

# Parsing de respostas PostToolUse estruturadas
hook_response_is_error_array()    # tool_response é array de erros TSC/ESLint
hook_response_error_count()       # número de erros no array
hook_get_errors_first_file()      # arquivo do primeiro erro
```

**Novas variáveis**: +12
**Novos predicados**: +11
**Testes adicionais**: ~25 → total ~176

**Gate de aceitação**: todo tool listado no `tools.json` do VS Code Copilot tem ao menos 1 predicado e seus campos core extraídos.

---

<a id="v12"></a>
### v1.2 — Hardening de Segurança

**Meta**: a API detecta e sinaliza inputs malformados, injetáveis ou suspeitos antes que entrem nos fat libs.

**Novas funções:**

```bash
# Sanitização e detecção de riscos
hook_input_has_injection()        # detecta padrões de injection em HOOK_TOOL_COMMAND
hook_input_is_path_traversal()    # detecta ../ no HOOK_TOOL_FILE_PATH
hook_input_command_score()        # 0..100: score de risco do comando
hook_sanitize_for_log()           # remove chars perigosos para logging seguro
hook_is_within_workspace()        # valida filePath dentro do cwd
hook_has_network_access()         # detecta comandos com acesso de rede (curl, wget, xh, ...)
hook_is_secret_exposure_risk()    # detecta tokens/passwords no command/filePath

# Variáveis expostas
HOOK_SECURITY_SCORE               # 0..100 (0 = seguro, 100 = alto risco)
HOOK_SECURITY_FLAGS               # lista de flags ativas (ex: "PATH_TRAVERSAL INJECTION")
```

**Integração nos fat libs**: os fat libs que chamam `hook_api_parse` devem verificar `HOOK_SECURITY_SCORE` e loggar `security_warn` se > 70.

**Testes adicionais**: ~20 → total ~196

**Gate de aceitação**: `shellcheck` limpo + casos de injection tentados em smoke tests geram `hook_input_has_injection()=true`.

---

<a id="v13"></a>
### v1.3 — Camada de Risco e Política

**Meta**: classificar cada tool call por nível de risco e expor predicados para decisões de política nos hooks.

**Categorias de risk level (0..5):**
```
0 — Leitura pura      (read_file, list_dir, semantic_search)
1 — Leitura com side  (get_errors, grep_search com regex ampla)
2 — Escrita reversível (create_file, edit_notebook_file)
3 — Escrita crítica   (replace_string_in_file, multi_replace, memory write)
4 — Execução          (run_in_terminal — background=false)
5 — Execução + rede   (run_in_terminal com curl/wget/git push, fetch_webpage)
```

**Novas funções:**

```bash
# Risco
hook_tool_risk_level()            # retorna 0..5
hook_tool_category()              # "read" | "write" | "exec" | "ai" | "state"
hook_is_high_risk()               # true se risk >= 4
hook_is_medium_risk()             # true se risk == 3
hook_requires_confirmation()      # true se risco >= 4 (candidato a hook_out_pre_ask)

# Política simples
hook_policy_allow()               # aplica política padrão → true se permitido
hook_policy_reason()              # razão da decisão (string para log/systemMessage)

# Variáveis
HOOK_RISK_LEVEL                   # 0..5
HOOK_TOOL_CATEGORY                # categoria
```

**Integração**: `pre-tool-use-lib.sh` pode usar `hook_tool_risk_level` para decidir se rastreia no audit.

**Testes adicionais**: ~20 → total ~216

---

<a id="v14"></a>
### v1.4 — Detecção de Templates e Protocolo

**Meta**: detectar todos os 7 templates do protocolo (A-G) dentro das `questions` que o agente envia ao `vscode_askQuestions`, permitindo que `post-tool-use-lib.sh` saiba qual template foi usado.

**Templates a detectar:**
```
A — Next Step (tarefa concluída — continuidade)
B — Bug Discovery (≥ 3 bugs encontrados)
C — Upgrade Proposal (proposta arquitetural)
D — Checkpoint Periódico (a cada ~15 turnos)
E — Session Kickoff (sessão sem prompt)
F — Session Close (encerramento com close_key)
G — Commit/Push Pre-Authorization (antes de git commit/push)
```

**Novas funções:**

```bash
hook_is_template_a()              # questions contém padrão Template A
hook_is_template_b()              # questions contém padrão Template B (Bug Discovery)
hook_is_template_c()              # questions contém padrão Template C
hook_is_template_d()              # questions contém padrão Template D (Checkpoint)
hook_is_template_e()              # questions contém padrão Template E (Kickoff)
# hook_is_template_f_proposed()  já existe na v1.0
hook_is_template_g()              # questions contém padrão Template G (commit/push)
hook_detect_template()            # retorna "A"|"B"|"C"|"D"|"E"|"F"|"G"|"UNKNOWN"
hook_template_label()             # descrição legível do template detectado

# Variáveis
HOOK_TEMPLATE                     # "A".."G" | "UNKNOWN"
HOOK_TEMPLATE_LABEL               # string descritiva
```

**Impacto em fat libs**: `post-tool-use-lib.sh` pode logar o template usado no audit como `askQuestions_template_A` etc.

**Testes adicionais**: ~20 → total ~236

---

<a id="v15"></a>
### v1.5 — API de Métricas de Sessão

**Meta**: expor todos os campos relevantes do `session.json` como funções getter, permitindo que qualquer fat lib consulte o estado sem manipular JSON diretamente.

**Novas funções:**

```bash
# Getters de session_stats
hook_stat_turn_count()            # session_stats.turn_count
hook_stat_turn_authorized()       # session_stats.turn_authorized
hook_stat_turn_unauthorized()     # session_stats.turn_unauthorized
hook_stat_subturn_total()         # session_stats.subturn_total
hook_stat_tools_total()           # session_stats.tools_total

# Getters de current_turn
hook_turn_number()                # current_turn.number
hook_turn_ask_called()            # current_turn.ask_questions_called → "true"|"false"
hook_turn_started_at()            # current_turn.started_at
hook_turn_section()               # current_turn.section (se existir)

# Getters de compliance
hook_compliance_consecutive()     # compliance.consecutive_unauthorized
hook_compliance_last_authorized() # compliance.last_turn_authorized → "true"|"false"

# Predicados de saúde
hook_session_is_healthy()         # turn_count <= turn_authorized + turn_unauthorized + 1
hook_compliance_ok()              # consecutive_unauthorized == 0
hook_needs_askquestions()         # ask_questions_called == false (turno ainda aberto)
hook_is_orphan_turn()             # turno com started_at há mais de 1h sem Stop

# Variáveis (populadas ao incluir common.sh + chamar hook_api_parse)
HOOK_STAT_TURN_COUNT
HOOK_STAT_TURN_AUTHORIZED
HOOK_COMPLIANCE_CONSECUTIVE
HOOK_SESSION_CLOSE_KEY            # close_key registrada no session.json
```

**Testes adicionais**: ~20 → total ~256

---

<a id="v20"></a>
### v2.0 — API de Transcript e Histórico

**Meta**: parsear o arquivo `transcript_path` (enviado em todos os hooks) para que os hooks possam raciocinar sobre o histórico de mensagens, tool calls anteriores e contexto acumulado.

> ⚠️ **Complexidade alta**: transcript_path pode ser >10MB. Parsing deve ser lazy e com limite.

**Novas funções:**

```bash
# Leitura do transcript
hook_transcript_load()            # lê transcript_path → popula HOOK_TX_*
hook_transcript_message_count()   # número de mensagens
hook_transcript_last_user_msg()   # última mensagem do usuário
hook_transcript_last_n_msgs()     # últimas N mensagens (default: 5)
hook_transcript_tool_calls()      # lista de tool calls no último turno
hook_transcript_search()          # busca string no histórico → booleano

# Predicados baseados em histórico
hook_tx_had_git_push_in_turn()    # git push ocorreu no turno atual
hook_tx_had_commit_in_turn()      # git commit ocorreu no turno atual
hook_tx_had_askquestions_in_turn() # vscode_askQuestions foi chamado neste turno (via transcript)

# Variáveis
HOOK_TX_LOADED                    # "true" | "false"
HOOK_TX_MSG_COUNT                 # número de mensagens
HOOK_TX_LAST_USER                 # texto da última msg do usuário
HOOK_TX_TOOL_CALLS_JSON           # JSON array de tool calls do turno atual
```

**Dependência**: requer que `transcript_path` seja acessível e legível.

**Testes adicionais**: ~20 → total ~276

---

<a id="v21"></a>
### v2.1 — Gestão de close_key

**Meta**: mover toda a lógica de close_key para a API, centralizando geração, validação e rotação.

**Novas funções:**

```bash
# Geração e rotação
hook_close_key_generate()         # gera "ENCERRAR-XXXXXXXX" (8 chars hex uppercase)
hook_close_key_rotate()           # gera nova close_key e persiste no session.json
hook_close_key_read()             # lê close_key atual do session.json

# Validação
hook_close_key_valid_format()     # valida formato ENCERRAR-XXXXXXXX
hook_close_key_matches()          # compara KEY fornecida com a do session.json
# hook_close_key_in_response()   já existe na v1.0 (detecta no payload)

# Variáveis
HOOK_CLOSE_KEY_VALUE              # valor atual (lido do session.json)
HOOK_CLOSE_KEY_IN_PAYLOAD         # "true" se encontrada no HOOK_ASK_ALL_TEXT
```

**Testes adicionais**: ~15 → total ~291

---

<a id="v22"></a>
### v2.2 — API de Subagente e Grafo de Agentes

**Meta**: rastrear hierarquia de subagentes, profundidade de nesting e budget de invocações.

**Novas funções:**

```bash
# Grafo de subagentes
hook_subagent_depth()             # profundidade de nesting (0 = agente principal)
hook_subagent_is_nested()         # depth > 0
hook_subagent_parent_id()         # agent_id do agente pai (se disponível no state)
hook_subagent_budget_ok()         # verifica se abaixo do limite de invocações

# Tracking de budget
hook_subagent_count_session()     # total de subagentes lançados na sessão
hook_subagent_count_turn()        # total de subagentes no turno atual

# Variáveis
HOOK_SUBAGENT_DEPTH
HOOK_SUBAGENT_COUNT_SESSION
HOOK_SUBAGENT_BUDGET_LIMIT        # lido do session.json ou default (10)
```

**Testes adicionais**: ~15 → total ~306

---

<a id="v23"></a>
### v2.3 — Context Builder para PreCompact

**Meta**: construir `additionalContext` rico e estruturado para injetar antes da compactação, maximizando o contexto útil que o agente retém.

**Novas funções:**

```bash
# Builders de context para PreCompact
hook_compact_ctx_session_summary()   # seção: stats da sessão (turn_count, authorized, ...)
hook_compact_ctx_pending_tasks()     # seção: tarefas pendentes (de pending-tasks.md)
hook_compact_ctx_close_key()         # seção: close_key (para que o agente não perca)
hook_compact_ctx_current_section()   # seção: nome da section atual
hook_compact_ctx_findings()          # seção: findings registrados (de findings.md)
hook_compact_ctx_full()              # combina todos acima em string markdown

# Variáveis
HOOK_COMPACT_CONTEXT_PARTS          # array das seções incluídas
HOOK_COMPACT_CONTEXT_BYTES          # tamanho em bytes do context gerado
```

**Testes adicionais**: ~15 → total ~321

---

<a id="v24"></a>
### v2.4 — Versionamento e Migração de State

**Meta**: permitir que o schema do `session.json` evolua sem quebrar sessões em andamento.

**Novas funções:**

```bash
hook_state_version()              # lê .state_schema_version do session.json
hook_state_needs_migration()      # compara versão atual com a esperada
hook_state_migrate()              # faz upgrade do schema (safe, preserva dados)
hook_state_schema_ok()            # valida campos obrigatórios do schema atual
```

**Versão do schema** a ser gravada no session.json: `"state_schema_version": "1.0"`.

**Gate**: quando common.sh inicializa o zero state, grava `state_schema_version` automaticamente.

**Testes adicionais**: ~10 → total ~331

---

<a id="v25"></a>
### v2.5 — Schemas de Validação Estritos

**Meta**: validação por evento com checagem de tipos, enums e ranges — não apenas presença de campos.

**Schemas por evento:**

```bash
# Validação por tipo de evento
hook_validate_session_start()     # source deve ser "new" | "reconnect"
hook_validate_user_prompt()       # prompt deve ser string não-vazia
hook_validate_pre_tool_use()      # tool_name deve ser string; tool_input object
hook_validate_post_tool_use()     # tool_use_id deve corresponder ao PreToolUse
hook_validate_stop()              # stop_hook_active deve ser boolean
hook_validate_subagent()          # agent_id e agent_type devem estar presentes
hook_validate_pre_compact()       # trigger deve ser "auto"

# Variáveis de validação enriquecidas
HOOK_VALIDATION_ERRORS_JSON       # array JSON de erros com campo+mensagem
HOOK_VALIDATION_WARNINGS_JSON     # avisos (não-bloqueantes)
```

**Testes adicionais**: ~20 → total ~351

---

<a id="v30"></a>
### v3.0 — Motor de Política Completo

**Meta**: API que lê um arquivo `hooks-policy.json` e decide dinamicamente o que permitir, bloquear ou pedir confirmação, sem alterar código dos fat libs.

**Arquivo de política (`hooks-policy.json`):**
```json
{
  "version": "1.0",
  "rules": [
    {
      "event": "PreToolUse",
      "when": { "risk_level_gte": 4 },
      "action": "ask",
      "message": "Operação de alto risco requer confirmação."
    },
    {
      "event": "PreToolUse",
      "when": { "tool": "run_in_terminal", "command_matches": "rm\\s+-rf" },
      "action": "deny",
      "reason": "Deleção recursiva bloqueada pela política."
    },
    {
      "event": "PreToolUse",
      "when": { "is_git_push": true },
      "action": "ask_template",
      "template": "G"
    }
  ]
}
```

**Novas funções:**

```bash
# Motor de política
hook_policy_load()                # carrega hooks-policy.json
hook_policy_evaluate()            # avalia regras contra HOOK_* atual → HOOK_POLICY_ACTION
hook_policy_action()              # "allow" | "deny" | "ask" | "ask_template"
hook_policy_message()             # mensagem da regra que disparou
hook_policy_matched_rule()        # índice da regra que casou

# Audit de política
hook_policy_audit_log()           # loga decisão de política no audit.jsonl

# Variáveis
HOOK_POLICY_ACTION                # "allow" | "deny" | "ask" | "ask_template"
HOOK_POLICY_REASON                # string da regra aplicada
HOOK_POLICY_TEMPLATE              # "A".."G" (se action == "ask_template")
```

**Integração nos fat libs**: `pre-tool-use-lib.sh` delega a decisão final para `hook_policy_evaluate()`,
tornando-se apenas um dispatcher — toda a lógica de negócio fica na API.

**Testes adicionais**: ~50 → total ~401

---

<a id="catálogo-v10"></a>
## 5. Catálogo Completo de Funções — v1.0

```
Core (4 funções)
  hook_api_parse            hook_api_validate
  hook_api_dump             hook_api_from_file

Getters (7 funções)
  hook_get_session_id       hook_get_tool_name        hook_get_agent_id
  hook_get_prompt           hook_get_command
  hook_get_tool_input_field hook_get_response_field

Predicados básicos (9 funções)
  hook_is_ask_questions     hook_is_stop_active       hook_is_tool_event
  hook_is_subagent_event    hook_is_session_close_cmd hook_is_manage_todo
  hook_is_manage_todo_post  hook_is_runsubagent        hook_is_background_cmd

Predicados de ferramenta (10 funções)
  hook_is_file_write        hook_is_file_read         hook_is_run_in_terminal
  hook_is_read_file         hook_is_create_file       hook_is_git_cmd
  hook_is_git_push          hook_is_git_commit        hook_is_destructive_cmd
  hook_is_ai_tool

Predicados avançados (4 funções)
  hook_is_template_f_proposed  hook_todo_last_is_ask
  hook_close_key_in_response   hook_response_has_error

Output builders — comum (4 funções)
  hook_out_continue         hook_out_system_message
  hook_out_stop_session     hook_out_exit2

Output builders — por evento (13 funções)
  hook_out_session_start_context  hook_out_pre_allow      hook_out_pre_deny
  hook_out_pre_ask                hook_out_pre_update_input hook_out_pre_full
  hook_out_post_context           hook_out_post_block
  hook_out_stop_block             hook_out_stop_safe_block
  hook_out_subagent_start_context hook_out_subagent_stop_block
  hook_out_subagent_stop_safe_block

Utilitários (3 funções)
  hook_summary              hook_api_record           hook_api_list_captures

TOTAL: 54 funções | 1214 linhas | 35 variáveis expostas
```

---

<a id="catálogo-v30"></a>
## 6. Catálogo Alvo — v3.0 (120+ funções)

```
Novas funções planejadas por versão:
  v1.1   + 11 predicados + 5 variáveis
  v1.2   + 7 segurança + 2 variáveis
  v1.3   + 9 risco/política + 3 variáveis
  v1.4   + 9 templates + 2 variáveis
  v1.5   + 15 métricas + 6 variáveis
  v2.0   + 10 transcript + 4 variáveis
  v2.1   + 6 close_key + 2 variáveis
  v2.2   + 7 subagent + 3 variáveis
  v2.3   + 6 compact context + 2 variáveis
  v2.4   + 4 migração + 1 variável
  v2.5   + 8 validação + 2 variáveis
  v3.0   + 10 motor política + 5 variáveis

PROJEÇÃO v3.0: ~54 + 102 = ~156 funções | ~3000 linhas | ~65 variáveis expostas
                                           ~401 testes cobrindo todas as versões
```

---

<a id="critérios-de-gate"></a>
## 7. Critérios de Gate por Versão

| Versão | Gate de Aceitação                                                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.1   | `smoke-test-payload-api.sh ≥ 176 PASS` + shellcheck limpo                                                                                                                                                           |
| v1.2   | Casos de injection/path-traversal detectados em testes; score 0 para payloads limpos                                                                                                                                |
| v1.3   | `hook_tool_risk_level()` retorna correto para 15 ferramentas diferentes                                                                                                                                             |
| v1.4   | ✅ **CONCLUÍDO** — Todos os 7 fat libs integrados com `hook_api_parse()`; `hook_is_bypass_attempt()` implementada; 226/226 smoke PASS; 111/111 integration PASS; ShellCheck limpo. (Templates A-G movidos para v1.5) |
| v1.5   | ✅ **CONCLUÍDO** — `09-metrics.sh` implementado (15 funções + `hook_metrics_load`); 252/252 smoke PASS; ShellCheck limpo. Lifecycle test T-I-22 pendente para próxima fase. |
| v2.0   | Transcript de 50+ mensagens parseado em < 2s; `hook_tx_had_askquestions_in_turn()` correto                                                                                                                          |
| v2.1   | `hook_close_key_generate()` produz chaves únicas; round-trip generate→check→rotate funciona                                                                                                                         |
| v2.2   | Subagente aninhado 3 níveis: depth=3 detectado corretamente                                                                                                                                                         |
| v2.3   | `hook_compact_ctx_full()` em sessão com 20 turnos cabe em 2000 chars                                                                                                                                                |
| v2.4   | Migração de state v0.9→v1.0→v1.1 sem perda de dados em smoke test                                                                                                                                                   |
| v2.5   | Payload com campo errado rejeita via `hook_validate_*`; payload correto passa                                                                                                                                       |
| v3.0   | Motor de política processa `hooks-policy.json` de 10 regras; policy audit logado                                                                                                                                    |

---

<a id="questões-em-aberto"></a>
## 8. Questões em Aberto

| #   | Questão                                                                                       | Versão alvo |
| --- | --------------------------------------------------------------------------------------------- | ----------- |
| Q1  | Limite de tamanho do transcript para parsing — truncar em quantas msgs?                       | v2.0        |
| Q2  | `hook_tool_risk_level()` deve ser configurável por `hooks-policy.json` ou hardcoded?          | v1.3/v3.0   |
| Q3  | Schema de validação: erros são bloqueantes ou warnings? Quem decide?                          | v2.5        |
| Q4  | `session_stats.tools_total` deve excluir `vscode_askQuestions` (subturn, não tool)?           | v1.5        |
| Q5  | Motor de política: as regras têm prioridade ou primeira-match?                                | v3.0        |
| Q6  | `hook_compact_ctx_full()` — limite de caracteres para evitar overflow do `additionalContext`? | v2.3        |
| Q7  | `HOOK_SECURITY_SCORE` — exposição como variável ou apenas via função getter?                  | v1.2        |
| Q8  | Templates A-G: detecção por keyword exata ou pattern fuzzy?                                   | v1.4        |
| Q9  | `hook_state_migrate()` — deve fazer backup automático antes de migrar?                        | v2.4        |
| Q10 | `hooks-policy.json` — hot reload (detectar mudança no arquivo) ou reload manual?              | v3.0        |

---

## Histórico de Versões

| Versão | Data       | Descrição                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0    | 2026-03-21 | Criação do documento. Situação atual v1.0 documentada (54 funções, 151+93 tests). Roadmap v1.1→v3.0 definido.                                                                                                                                                                                                                                                                                                        |
| 1.1    | 2026-03-18 | Implementados 11 predicados + vars: `hook_is_pre_tool_use`, `hook_tool_matches`, `hook_is_write_tool`, `hook_is_read_tool`, `hook_tool_risk_is_high`, `hook_tool_risk_is_medium`, `hook_tool_risk_is_safe`, `hook_is_stop_active`, `hook_is_ask_questions`, `hook_is_compact_triggered`, `hook_tool_has_command`. Smoke: 223 PASS.                                                                                   |
| 1.2    | 2026-03-18 | Implementadas 7 funções de segurança + vars: `hook_is_command_injection`, `hook_is_path_traversal`, `hook_is_prompt_injection`, `hook_security_flags_str`, `hook_sanitize_for_log`, `hook_security_is_safe`, `hook_security_is_high_risk`. Compute: `_hook_security_compute`. Smoke: 223 PASS (shared c/ v1.1).                                                                                                      |
| 1.3    | 2026-03-18 | Implementadas 9 funções de risco/categoria + vars `HOOK_RISK_LEVEL` / `HOOK_TOOL_CATEGORY`: `hook_tool_risk_level`, `hook_tool_category`, `hook_is_ai_tool`, `hook_is_file_tool`, `hook_is_shell_tool`, `hook_is_network_tool`, `hook_is_editor_tool`, `hook_is_search_tool`, `hook_is_unknown_tool`. Arquivo `08-risk.sh`. Smoke: 223 PASS.                                                                         |
| 1.4    | 2026-03-19 | **Consolidação Phase 7 — Integração Fat Libs**: todos os 7 fat libs (`pre-tool-use-lib.sh`, `post-tool-use-lib.sh`, `stop-lib.sh`, `session-start-lib.sh`, `subagent-lib.sh`, `user-prompt-submit-lib.sh`, `pre-compact-lib.sh`) refatorados para usar `hook_api_parse()` + vars `HOOK_*`. Adicionada `hook_is_bypass_attempt()` em `08-risk.sh`. Smoke: **226 PASS**. Integration: **111 PASS**. ShellCheck: limpo. |
| 1.5    | 2026-03-21 | **API de Métricas de Sessão** — Novo módulo `09-metrics.sh` (15 funções + `hook_metrics_load`): getters lazy de `session_stats`, `current_turn`, `compliance`, `close_key` + predicados `hook_session_is_healthy`, `hook_compliance_ok`, `hook_needs_askquestions`, `hook_is_orphan_turn`. Novas vars `HOOK_STAT_*`, `HOOK_COMPLIANCE_*`, `HOOK_TURN_*`, `HOOK_SESSION_CLOSE_KEY` em `01-vars.sh`. Smoke: **252 PASS**. ShellCheck: limpo. |
