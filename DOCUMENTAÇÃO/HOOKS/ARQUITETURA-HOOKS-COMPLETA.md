# Arquitetura Completa — Sistema de Hooks do Copilot

**Versão**: 8.0 — Ciclo Completo de Correções (24+ itens implementados) **Data**: 2026-03-12
**Fonte**: Documentação oficial VS Code + implementação local auditada **Status**: Documento
canônico de referência para o sistema de hooks

---

## Sumário

1. [Por que hooks existem](#1-por-que-hooks-existem)
2. [API oficial do VS Code Copilot Hooks](#2-api-oficial-do-vs-code-copilot-hooks)
3. [Nosso modelo de conceitos: SESSION, SECTION, TURN](#3-nosso-modelo-de-conceitos-session-section-turn)
4. [Canal primário de comunicação: vscode_askQuestions](#4-canal-primário-de-comunicação-vscode_askquestions)
5. [Por que userPromptSubmit(ted) é irrelevante no nosso fluxo](#5-por-que-userpromptsubmitted-é-irrelevante-no-nosso-fluxo)
6. [Implementação: mapa completo dos nossos hooks](#6-implementação-mapa-completo-dos-nossos-hooks)
7. [Estado canônico: session-context.json](#7-estado-canônico-session-contextjson)
8. [Rastreamento: audit.jsonl e eventos](#8-rastreamento-auditjsonl-e-eventos)
9. [Hardening v7.0: decision:block estrutural](#9-hardening-v70-decisionblock-estrutural)
10. [Protocolo de encerramento de SESSION](#10-protocolo-de-encerramento-de-session)
11. [Templates de vscode_askQuestions (A-G)](#11-templates-de-vscode_askquestions-a-g)
12. [Diagrama de ciclo de vida completo](#12-diagrama-de-ciclo-de-vida-completo)
13. [Histórico de versões](#13-histórico-de-versões)

---

## 1. Por que hooks existem

O sistema de hooks do VS Code Copilot permite executar **comandos determinísticos** em pontos
específicos do ciclo de vida do agente. Ao contrário de instruções ou prompts personalizados (que
apenas "guiam" o comportamento), **hooks executam código real com resultado garantido**.

Casos de uso oficialmente suportados:

- **Segurança**: bloquear comandos destrutivos antes que executem
- **Qualidade de código**: rodar formatters/linters automaticamente
- **Rastreamento**: criar trilhas de auditoria de cada ferramenta
- **Injeção de contexto**: adicionar informações ao agente
- **Controle de aprovação**: aprovar automaticamente operações seguras, exigir confirmação para
  sensíveis

No nosso caso, usamos hooks para:

- Rastrear o ciclo de vida SESSION→SECTION→TURN
- **Bloquear** (v7.0) o agente de encerrar turnos sem chamar `vscode_askQuestions`
- Detectar e validar a chave de encerramento de SESSION
- Gerar briefings, auditorias e relatórios

---

## 2. API oficial do VS Code Copilot Hooks

> Fonte:
> [code.visualstudio.com/docs/copilot/customization/hooks](https://code.visualstudio.com/docs/copilot/customization/hooks)
> (acesso: 2026-03-10)

### 2.1 Os 8 eventos de ciclo de vida

| Evento (VS Code)   | Alias Copilot CLI     | Quando dispara                                           |
| ------------------ | --------------------- | -------------------------------------------------------- |
| `SessionStart`     | `sessionStart`        | Usuário submete o **primeiro** prompt de uma nova sessão |
| `UserPromptSubmit` | `userPromptSubmitted` | Usuário submete um prompt **pela caixa de chat**         |
| `PreToolUse`       | `preToolUse`          | **Antes** do agente invocar qualquer ferramenta          |
| `PostToolUse`      | `postToolUse`         | **Depois** de uma ferramenta completar com sucesso       |
| `PreCompact`       | `preCompact`          | Antes do contexto ser compactado (truncamento)           |
| `SubagentStart`    | `subagentStart`       | Um subagente é criado (`runSubagent`)                    |
| `SubagentStop`     | `subagentStop`        | Um subagente completa                                    |
| `Stop`             | `agentStop`           | Agente tenta **encerrar o turno current**                |

> ⚠️ **CRÍTICO**: O evento `Stop` (= nosso `agentStop`) dispara **quando o agente encerra um TURN**,
> não quando a SESSION termina. A SESSION termina quando o usuário fecha o VS Code (sessionEnd, que
> não tem blocking).

### 2.2 Localização dos arquivos de configuração

```
Workspace:        .github/hooks/*.json           ← NOSSO ARQUIVO (copilot-hooks.json)
Workspace Claude: .claude/settings.json
User Claude:      ~/.claude/settings.json
Agent-scoped:     frontmatter .agent.md
```

### 2.3 Formato de configuração dos hooks

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "type": "command",
        "command": "./scripts/validate-tool.sh",
        "timeout": 15
      }
    ]
  }
}
```

**Propriedades de cada entrada**:

| Propriedade | Tipo   | Descrição                                       |
| ----------- | ------ | ----------------------------------------------- |
| `type`      | string | Deve ser `"command"`                            |
| `command`   | string | Comando padrão (cross-platform)                 |
| `bash`      | string | Override para uso em bash (Linux/macOS)         |
| `linux`     | string | Override específico Linux                       |
| `cwd`       | string | Diretório de trabalho (relativo à raiz do repo) |
| `env`       | object | Variáveis de ambiente adicionais                |
| `timeout`   | number | Timeout em segundos (padrão: 30)                |

### 2.4 Input comum de todo hook (stdin JSON)

```json
{
  "timestamp": "2026-03-10T18:00:00.000Z",
  "cwd": "/path/to/workspace",
  "sessionId": "session-identifier",
  "hookEventName": "PreToolUse",
  "transcript_path": "/path/to/transcript.json"
}
```

### 2.5 Output comum (stdout JSON)

```json
{
  "continue": true,
  "stopReason": "Security policy violation",
  "systemMessage": "Warning message displayed to model"
}
```

| Campo           | Tipo    | Efeito                                                                 |
| --------------- | ------- | ---------------------------------------------------------------------- |
| `continue`      | boolean | `false` = para o processamento inteiro (drástico — encerra a SESSION!) |
| `stopReason`    | string  | Razão para parada (quando `continue: false`)                           |
| `systemMessage` | string  | Mensagem de aviso exibida ao agente (não bloqueante)                   |

> ⚠️ **`continue: false` encerra a SESSION inteira — NÃO use para bloquear turnos!** Para bloquear
> apenas o turno, use `hooks-specificOutput.decision: "block"` no hook `Stop`.

### 2.6 Exit codes

| Código | Significado                                                  |
| ------ | ------------------------------------------------------------ |
| `0`    | Sucesso: parse stdout como JSON                              |
| `2`    | Erro bloqueante: para processamento e exibe stderr ao modelo |
| Outros | Aviso não-bloqueante: exibe aviso ao usuário, continua       |

### 2.7 API específica: PreToolUse

**Input adicional**:

```json
{
  "tool_name": "editFiles",
  "tool_input": { "files": ["src/main.ts"] },
  "tool_use_id": "tool-123"
}
```

**Output específico** (via `hookSpecificOutput`):

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Destructive command blocked by policy",
    "updatedInput": { "files": ["src/safe.ts"] },
    "additionalContext": "User has read-only access to production files"
  }
}
```

| Campo                | Valores                      | Efeito                                  |
| -------------------- | ---------------------------- | --------------------------------------- |
| `permissionDecision` | `"allow"`, `"deny"`, `"ask"` | Controla aprovação da ferramenta        |
| `updatedInput`       | object                       | Modifica input da ferramenta (opcional) |
| `additionalContext`  | string                       | Contexto extra injetado na conversa     |

**Prioridade**: `deny` > `ask` > `allow` (mais restritivo vence quando múltiplos hooks rodam).

### 2.8 API específica: PostToolUse

**Input adicional**:

```json
{
  "tool_name": "editFiles",
  "tool_input": { "files": ["src/main.ts"] },
  "tool_use_id": "tool-123",
  "tool_response": "File edited successfully"
}
```

**Output específico** (blocking):

```json
{
  "decision": "block",
  "reason": "Post-processing validation failed",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "The edited file has lint errors"
  }
}
```

### 2.9 API específica: Stop (= nosso agentStop) ← CRÍTICO

**Input adicional**:

```json
{
  "stop_hook_active": false
}
```

| Campo              | Tipo    | Significado                                                                                                                |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `stop_hook_active` | boolean | `true` quando o agente já está rodando por causa de um stop hook anterior. **VERIFICAR SEMPRE** para evitar loop infinito. |

**Output específico** (blocking — FORMATO CORRETO v7.0):

```json
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "decision": "block",
    "reason": "Call vscode_askQuestions before finishing this turn"
  }
}
```

| Campo      | Valores   | Efeito                                                                                       |
| ---------- | --------- | -------------------------------------------------------------------------------------------- |
| `decision` | `"block"` | Impede o agente de encerrar o turno                                                          |
| `reason`   | string    | **Obrigatório** quando `decision: "block"`. Mostrado ao agente como contexto para continuar. |

> ⚠️ **PREVENÇÃO DE LOOP INFINITO**: Quando `stop_hook_active=true`, o hook **NUNCA deve retornar
> `decision:block`**. O `stop_hook_active` será `true` precisamente na segunda invocação depois de
> um block. Sempre verificar:
>
> ```bash
> if [ "$STOP_HOOK_ACTIVE" = "true" ]; then exit 0; fi
> ```

### 2.10 API específica: SessionStart

**Output específico** (injetando contexto):

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Project: v2.1.0 | Branch: main | close_key: ENCERRAR-XXXX"
  }
}
```

---

## 3. Nosso modelo de conceitos: SESSION, SECTION, TURN

### 3.1 Hierarquia

```
╔══════════════════════════════════════════╗
║  SESSION — 1 ativação do Copilot Chat    ║
║  ┌─────────────────────────────────────┐ ║
║  │  SECTION: "análise" (fase lógica)   │ ║
║  │  ┌───────────────────────────────┐  │ ║
║  │  │ TURN 1 (prompt→resposta)      │  │ ║
║  │  └───────────────────────────────┘  │ ║
║  │  ┌───────────────────────────────┐  │ ║
║  │  │ TURN 2 (prompt→resposta)      │  │ ║
║  │  └───────────────────────────────┘  │ ║
║  └─────────────────────────────────────┘ ║
║  ┌─────────────────────────────────────┐ ║
║  │  SECTION: "implementação"           │ ║
║  │  ┌───────────────────────────────┐  │ ║
║  │  │ TURN 3 (prompt→resposta)      │  │ ║
║  │  └───────────────────────────────┘  │ ║
║  └─────────────────────────────────────┘ ║
╚══════════════════════════════════════════╝
```

### 3.2 Tabela de diferenças

| Conceito    | O que é                                                                                                                   | Encerra com                                    | Autorização                                   | Script de controle                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------- | ---------------------------------------- |
| **SESSION** | 1 ativação do Copilot Chat. Tem ID único e `close_key`.                                                                   | Template F + KEY + `session-close.sh`          | **OBRIGATÓRIA** — sem exceção                 | `session-start.sh` / `session-end.sh`    |
| **SECTION** | Fase lógica de trabalho dentro da SESSION.                                                                                | Próxima `start-section.sh` ou `section-end.sh` | **Autônoma** — agente decide                  | `start-section.sh` / `section-end.sh`    |
| **TURN**    | Ciclo agente-trabalha → `Stop` hook dispara. Dentro de um TURN ocorrem N tool calls e N chamadas a `vscode_askQuestions`. | `agentStop` hook (Stop event)                  | **Requer** `vscode_askQuestions` antes (v7.0) | `start-turn.sh` (declaração de intenção) |

### 3.3 Regra de ouro

```
TURN encerrado?    → Requer vscode_askQuestions (v7.0, ou agentStop bloqueia)
SECTION encerrada? → Autônoma. Agente abre nova seção com start-section.sh
SESSION encerrada? → BLOQUEADA sem: Template F + KEY + bash session-close.sh KEY
```

### 3.4 Invariante: SESSION + SECTION + TURN sempre ativos

O sistema garante que sempre há uma SESSION, uma SECTION e um TURN ativos simultaneamente:

- `session-start.sh` cria a SECTION `"início"` automaticamente
- `agent-stop.sh` auto-cria a seção `"retomada"` se a SECTION for null
- `start-section.sh` fecha a seção anterior antes de abrir uma nova

---

## 4. Canal primário de comunicação: vscode_askQuestions

### 4.1 Por que esta tool é central

No fluxo de trabalho real:

1. O usuário envia **1 mensagem** pelo chatbox ao iniciar a SESSION
2. Toda comunicação subsequente ocorre via **`vscode_askQuestions`**
3. O usuário nunca digita no chatbox novamente durante a SESSION

Isso significa que `vscode_askQuestions` é:

- O canal de **checkpoint** periódico (Templates A, D)
- O canal de **aprovação** de decisões arquiteturais (Template C)
- O canal de **commit/push** authorization (Template G)
- O canal de **encerramento de SESSION** (Template F — com close_key)

### 4.2 Como vscode_askQuestions funciona nos hooks

Quando o agente chama `vscode_askQuestions`:

1. Isso é uma **tool call** normal
2. `preToolUse` hook dispara ANTES (pre-tool-use.sh registra)
3. `postToolUse` hook dispara DEPOIS com a resposta do usuário
4. `post-tool-use.sh` analisa `tool_response`:
   - Loga `askQuestions_response` em `audit.jsonl`
   - Verifica se a resposta contém a `close_key`
   - Se contém → seta `close_key_validated=true` → chama `session-close.sh` automaticamente

### 4.3 Fluxo de comunicação real

```
SESSION start (chatbox): [userPromptSubmitted disparara] ← RARO, só aqui
  └─ SECTION "início"
       ├─ TURN 1:
       │   ├─ [agente trabalha: ≥N tool calls]
       │   ├─ [agente chama vscode_askQuestions] ← CANAL PRIMÁRIO
       │   │   ├─ postToolUse captura resposta
       │   │   └─ askQuestions_response em audit.jsonl
       │   └─ [agente encerra TURN — agentStop hook checa vscode_askQuestions]
       │       - AUTH_REQUESTED=true → allowed
       │
       ├─ TURN 2:
       │   ├─ [agente trabalha]
       │   ├─ [agente chama vscode_askQuestions com Template D]
       │   └─ [TURN encerra normalmente]
       │
       ├─ ... (N TURNs)
       │
       └─ TURN N (encerramento):
           ├─ [agente chama vscode_askQuestions com Template F, exibindo close_key]
           ├─ [usuário responde digitando: ENCERRAR-XXXXXXXX]
           ├─ [postToolUse detecta KEY na resposta]
           ├─ [session-close.sh chamado automaticamente]
           └─ SESSION encerrada com autorização
```

---

## 5. Por que userPromptSubmit(ted) é irrelevante no nosso fluxo

### 5.1 Definição oficial

> `UserPromptSubmit` dispara quando o **usuário submete um prompt** — ou seja, quando mensagem é
> enviada pela **caixa de texto do chat** no VS Code.

### 5.2 Evidência empírica

Análise de correlação temporal em `audit.jsonl`:

```
askQuestions_response @ 18:00  → SEM userPromptSubmitted subsequente imediato
askQuestions_response @ 18:15  → SEM userPromptSubmitted
askQuestions_response @ 18:30  → SEM userPromptSubmitted
userPromptSubmitted   @ 18:45  → usuário digitou nova mensagem NO CHATBOX
```

**Conclusão**: `askQuestions_response` e `userPromptSubmitted` são **eventos completamente
independentes**. Responder a `vscode_askQuestions` NÃO dispara `userPromptSubmitted`.

### 5.3 Frequência real em nossa SESSION

| Evento                  | Frequência esperada       | Por quê                                     |
| ----------------------- | ------------------------- | ------------------------------------------- |
| `userPromptSubmitted`   | **~1x por SESSION**       | Usuário digita no chatbox apenas ao iniciar |
| `askQuestions_response` | **~N x por SESSION**      | Principal canal de comunicação              |
| `preToolUse`            | **~100-300x por SESSION** | Dispara antes de CADA tool call             |
| `postToolUse`           | **~100-300x por SESSION** | Dispara após CADA tool call                 |
| `agentStop` (Stop)      | **~N x por SESSION**      | Dispara ao fim de CADA TURN                 |

### 5.4 Implicação arquitetural

O hook mais confiável para injetar lembretes **periódicos** é `preToolUse`, não
`userPromptSubmitted`. Por isso:

- **v6.2**: SESSION reminder injetado via `pre-tool-use.sh` a cada X tool calls
- **v7.0**: Blocking via `agent-stop.sh` (Stop hook) que dispara ao fim de cada TURN

`log-prompt.sh` (userPromptSubmitted) permanece válido para o contexto inicial da SESSION, mas não é
o canal primário para lembretes.

---

## 6. Implementação: mapa completo dos nossos hooks

### 6.1 Arquivo de configuração: `.github/hooks/copilot-hooks.json`

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": "./scripts/session-start.sh",
    "userPromptSubmitted": "./scripts/log-prompt.sh",
    "preToolUse": "./scripts/pre-tool-use.sh",
    "postToolUse": "./scripts/post-tool-use.sh",
    "agentStop": "./scripts/agent-stop.sh",
    "subagentStop": "./scripts/subagent-stop.sh",
    "subagentStart": "./scripts/subagent-start.sh",
    "postToolUseFailure": "./scripts/tool-use-failure.sh",
    "preCompact": "./scripts/pre-compact.sh",
    "sessionEnd": "./scripts/session-end.sh"
  }
}
```

### 6.2 Tabela de scripts com propósito e output

| Script              | Hook event            | Principal propósito                               | Output crítico                       |
| ------------------- | --------------------- | ------------------------------------------------- | ------------------------------------ |
| `session-start.sh`  | `sessionStart`        | Inicializa estado, gera briefing, close_key       | `additionalContext` com briefing     |
| `log-prompt.sh`     | `userPromptSubmitted` | Loga início de turno (chatbox), injeta contexto   | `systemMessage` com SESSION reminder |
| `pre-tool-use.sh`   | `preToolUse`          | Atualiza contadores, SESSION reminder periódico   | `systemMessage` a cada 8 tool calls  |
| `post-tool-use.sh`  | `postToolUse`         | Rastreia tool calls, detecta KEY em askQuestions  | `askQuestions_response` + auto-close |
| `agent-stop.sh`     | `agentStop` (Stop)    | **BLOCKING v7.0**: bloqueia TURN sem askQuestions | `decision:block` + `systemMessage`   |
| `session-end.sh`    | `sessionEnd`          | Detecta encerramentos abruptos, gera relatório    | flags / SESSION_CLOSE_NO_KEY.flag    |
| `subagent-start.sh` | `subagentStart`       | Inicia subagente com contexto da SESSION pai      | `additionalContext`                  |
| `subagent-stop.sh`  | `subagentStop`        | Finaliza subagente                                | auditoria                            |

### 6.3 agent-stop.sh — Fluxo detalhado (v7.0)

```
agentStop dispara
    │
    ├─ Lê: stop_hook_active (bool), session_id, turn data
    ├─ Guard: session_id mismatch → HEAL v2 ou exit
    ├─ Lê: AUTH_REQUESTED (4 estratégias de detecção)
    │
    ├─ Log: agentStop evento em audit.jsonl
    ├─ Log: turnEnd_no_askQuestions (se não autorizado)
    │
    ├─ DECISION POINT v7.0:
    │   ├─ stop_hook_active=true → CONTINUAR NORMALMENTE (anti-loop)
    │   ├─ AUTH_REQUESTED=true  → CONTINUAR NORMALMENTE
    │   ├─ turn_count < 1       → CONTINUAR (primeiro turno: apenas warn)
    │   └─ DEFAULT              → BLOCK (decision:block via hookSpecificOutput)
    │           ├─ Log: agentStop_blocked em audit.jsonl
    │           ├─ Atualiza: compliance.consecutive_unauthorized
    │           ├─ Cria: UNAUTHORIZED_CLOSE.flag
    │           └─ Output: hookSpecificOutput.decision="block" + reason
    │
    ├─ systemMessage nudge (se não bloqueado e condições ativas)
    ├─ turnStart_enriched_auto (se intent não declarado)
    ├─ CTX update: incrementa turn_count, reseta current_turn
    ├─ Invariante: auto-seção "retomada" se SECTION=null
    └─ Checkpoint + sync de tarefas
```

### 6.4 post-tool-use.sh — Detecção de close_key

```bash
# Fluxo de detecção da KEY (já implementado):
if tool_name == "vscode_askQuestions":
    response = tool_response
    if response contains close_key:
        set close_key_validated = true in CTX
        log sessionClose_key_validated em audit.jsonl
        call session-close.sh automatically
```

Isso garante que a KEY só pode ser validada via tool call real (`vscode_askQuestions`), nunca por
texto plano.

---

## 7. Estado canônico: session-context.json

### 7.1 Estrutura principal

```json
{
  "session": {
    "id": "uuid-da-sessao",
    "close_key": "ENCERRAR-XXXXXXXX",
    "close_key_validated": false,
    "started_at": "2026-03-10T18:00:00Z",
    "source": "copilot"
  },
  "current_section": {
    "name": "implementacao",
    "section_id": "uuid-da-secao",
    "section_number": 3,
    "started_at": "...",
    "turn_start": 5
  },
  "current_turn": {
    "number": 7,
    "section_turn": 3,
    "started_at": "...",
    "intent": "implementar-blocking-v7",
    "intent_declared": true,
    "tools_count": 12,
    "auth_requested": true,
    "agentStop_invocations": 0
  },
  "session_stats": {
    "turn_count": 7,
    "turn_authorized": 5,
    "turn_no_askQuestions": 2,
    "turns_since_askQuestions": 0,
    "tools_total": 145,
    "pending_section_after_push": false
  },
  "compliance": {
    "consecutive_unauthorized": 0,
    "last_turn_authorized": true,
    "flag_file_exists": false
  }
}
```

### 7.2 Campos críticos

| Campo                                    | Significado                                 | Usado por                                              |
| ---------------------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| `session.close_key`                      | KEY necessária para encerrar SESSION        | agent-stop.sh, session-close.sh, post-tool-use.sh      |
| `session.close_key_validated`            | KEY foi recebida via vscode_askQuestions    | agent-stop.sh (permite stop se true), session-close.sh |
| `compliance.consecutive_unauthorized`    | Turnos consecutivos sem vscode_askQuestions | agent-stop.sh (decide blocking)                        |
| `current_turn.auth_requested`            | vscode_askQuestions foi chamado neste turno | agent-stop.sh (Estratégia 3 de detecção)               |
| `session_stats.turns_since_askQuestions` | Turnos desde o último askQuestions          | agent-stop.sh (nudge context)                          |

---

## 8. Rastreamento: audit.jsonl e eventos

### 8.1 Eventos principais

| Evento                       | Script                | Significado                                          |
| ---------------------------- | --------------------- | ---------------------------------------------------- |
| `sessionStart`               | session-start.sh      | Início de SESSION                                    |
| `sessionEnd`                 | session-end.sh        | Fim de SESSION (pode ser abrupto)                    |
| `sessionCloseAuthorized`     | session-close.sh      | SESSION encerrada com KEY correta                    |
| `sessionClose_key_validated` | post-tool-use.sh      | KEY detectada na resposta de vscode_askQuestions     |
| `SESSION_CLOSE_NO_KEY`       | session-end.sh        | SESSION encerrada sem KEY (violação)                 |
| `sectionStart`               | start-section.sh      | Nova SECTION aberta                                  |
| `sectionEnd`                 | section-end.sh / auto | SECTION encerrada                                    |
| `turnStart`                  | log-prompt.sh         | Novo TURN iniciado (chatbox)                         |
| `agentStop`                  | agent-stop.sh         | TURN encerrando                                      |
| `agentStop_blocked`          | agent-stop.sh         | TURN bloqueado por v7.0 (sem askQuestions)           |
| `turnEnd_authorized`         | agent-stop.sh         | TURN encerrado com vscode_askQuestions ✓             |
| `turnEnd_no_askQuestions`    | agent-stop.sh         | TURN encerrado sem vscode_askQuestions               |
| `askQuestions_response`      | post-tool-use.sh      | Resposta recebida do usuário via vscode_askQuestions |
| `sessionReminder_preToolUse` | pre-tool-use.sh       | SESSION reminder periódico (a cada 8 tools)          |

---

## 9. Hardening v7.0: decision:block estrutural

### 9.1 O problema raiz

Nas versões anteriores (v5.0-v6.2), o `agentStop` emitia apenas `systemMessage` (nudge informativo).
**O agente podia ignorar o nudge e encerrar o turno sem chamar `vscode_askQuestions`**. Quando o
usuário fechava o VS Code, a SESSION encerrava sem KEY → viola o protocolo.

### 9.2 A solução: Stop hook com decision:block

A documentação oficial do VS Code Copilot Hooks confirma: o hook `Stop` (= nosso `agentStop`)
suporta:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "decision": "block",
    "reason": "Motivo mostrado ao agente — deve chamar vscode_askQuestions"
  }
}
```

Quando isso é retornado:

1. O agente **não consegue encerrar o turno**
2. O `reason` é injetado como contexto ao agente
3. O agente continua rodando (pode chamar vscode_askQuestions, etc.)
4. Na próxima tentativa de parar, `stop_hook_active=true`
5. Com `stop_hook_active=true`, o hook **nunca bloqueia** (anti-loop)

### 9.3 Lógica de decisão (v7.0)

```
agentStop dispara com input: {stop_hook_active, ...}
    │
    ├─ stop_hook_active == true?  → PERMITE (anti-loop infinito)
    ├─ AUTH_REQUESTED == true?    → PERMITE (vscode_askQuestions foi chamado ✓)
    ├─ turn_count_total < 1?      → PERMITE (primeiro turno da sessão — warm-up)
    └─ DEFAULT:                   → BLOQUEIA
           reason: "Protocolo v7.0: chame vscode_askQuestions..."
```

### 9.4 Garantia do sistema (v7.0)

Com `decision:block`:

- **Todo TURN que não chama `vscode_askQuestions` é bloqueado**
- O agente tem **exatamente 1 chance** de chamar `vscode_askQuestions` antes de poder encerrar
- Isso garante que o usuário é consultado em **cada checkpoint**
- O encerramento de SESSION via Template F só pode ocorrer dentro do `vscode_askQuestions`

### 9.5 Exceções e casos especiais

| Caso                                  | Comportamento | Razão                                                           |
| ------------------------------------- | ------------- | --------------------------------------------------------------- |
| `stop_hook_active=true`               | PERMITE       | Anti-loop: o agente já continuou por causa de um block anterior |
| `AUTH_REQUESTED=true`                 | PERMITE       | vscode_askQuestions foi chamado neste turno                     |
| Primeiro turno (turn_count=0)         | PERMITE       | Sessão recém-iniciada, agente ainda precisa de contexto         |
| Subagente (`subagent_delegated=true`) | PERMITE       | Subagentes têm ciclo de vida próprio                            |
| `close_key_validated=true`            | PERMITE       | SESSION já está sendo encerrada com KEY correta                 |

---

## 10. Protocolo de encerramento de SESSION

### 10.1 3 passos obrigatórios

```
PASSO 1: Agente chama vscode_askQuestions com Template F
         (exibe a close_key: ENCERRAR-XXXXXXXX)
    │
PASSO 2: Usuário digita a chave ENCERRAR-XXXXXXXX no campo da tool
         (postToolUse detecta KEY automaticamente → valida em CTX)
    │
PASSO 3: Agente chama obrigatoriamente:
         bash .github/hooks/scripts/session-close.sh "ENCERRAR-XXXXXXXX"
```

> **Onde encontrar a close_key**:
>
> - `session-briefing.md` → seção `🔐 CHAVE DE ENCERRAMENTO` (primeira seção)
> - `session-context.json` → campo `session.close_key`
> - `bash .github/hooks/scripts/session-reminder.sh`

### 10.2 Verificações automáticas via hooks

| Mecanismo                 | Como funciona                                                     | Arquivo          |
| ------------------------- | ----------------------------------------------------------------- | ---------------- |
| Pre-check                 | `agent-stop.sh` sempre exibe close_key no nudge                   | agent-stop.sh    |
| Auto-validação            | `post-tool-use.sh` detecta KEY na resposta de vscode_askQuestions | post-tool-use.sh |
| Blocking                  | `agent-stop.sh` v7.0 bloqueia até vscode_askQuestions ser chamado | agent-stop.sh    |
| SESSION_CLOSE_NO_KEY.flag | Criado por `session-end.sh` quando sem KEY                        | session-end.sh   |
| Próximo briefing          | session-start.sh exibe alerta se flag existir                     | session-start.sh |

### 10.3 Por que texto plano não conta

A KEY **só é validada** quando aparece na **resposta de `vscode_askQuestions`** (capturada por
`post-tool-use.sh`). Isso é detectado pelo campo `tool_name == "vscode_askQuestions"` na entrada do
hook `postToolUse`.

Se o usuário simplesmente digitar `ENCERRAR-XXXXXXXX` no chatbox (sem ser via Template F do
`vscode_askQuestions`), isso dispara `userPromptSubmitted` → `log-prompt.sh`, que NÃO faz validação
de KEY. A KEY não seria validada.

---

## 11. Templates de vscode_askQuestions (A-G)

Para referência completa, veja `.github/AGENTS.md` → seção "Protocolo vscode_askQuestions".

| Template                 | Quando usar                               | Observação                                                     |
| ------------------------ | ----------------------------------------- | -------------------------------------------------------------- |
| **A** — Next Step        | Tarefa concluída → pergunta próximo passo | Mais comum; satisfaz requisito de vscode_askQuestions por TURN |
| **B** — Bug Discovery    | ≥3 bugs encontrados                       | Requer aprovação para continuar                                |
| **C** — Upgrade Proposal | Proposta arquitetural grande              | Requer aprovação explícita                                     |
| **D** — Checkpoint       | Checkpoint periódico (~a cada 5 TURNs)    | Satisfaz requisito de vscode_askQuestions                      |
| **E** — Session Kickoff  | Sessão sem prompt explícito               | Raríssimo em nosso fluxo                                       |
| **F** — Session Close    | **Encerramento de SESSION**               | **Exibe close_key obrigatoriamente**                           |
| **G** — Commit/Push Auth | Antes de git commit e/ou push             | Obrigatório antes de qualquer push                             |

---

## 12. Diagrama de ciclo de vida completo

```
┌─────────────────────────────────────────────────────────┐
│               HOOKS LIFECYCLE — v7.0                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [user opens VS Code Copilot Chat]                      │
│       │                                                 │
│       ▼                                                 │
│  sessionStart → session-start.sh                        │
│       │  - Gera close_key                               │
│       │  - Inicializa session-context.json              │
│       │  - Cria SECTION "início"                        │
│       │  - Gera session-briefing.md                     │
│       │  - Output: additionalContext (briefing)         │
│       │                                                 │
│  [user types in chatbox — ONCE]                         │
│       │                                                 │
│       ▼                                                 │
│  userPromptSubmitted → log-prompt.sh                    │
│       │  - Loga turnStart                               │
│       │  - SESSION reminder (raro, mas útil aqui)       │
│       │  - Output: systemMessage com close_key          │
│       │                                                 │
│  ┌────▼──────────────────────────────────────────────┐  │
│  │  TURN (agent generates response)                  │  │
│  │                                                   │  │
│  │  [...tool call...]                                │  │
│  │       ▼                                           │  │
│  │  preToolUse → pre-tool-use.sh                     │  │
│  │       │  - Atualiza contadores                    │  │
│  │       │  - Session reminder a cada 8 tools        │  │
│  │       │  - Output: systemMessage (periódico)      │  │
│  │       ▼                                           │  │
│  │  [TOOL EXECUTES]                                  │  │
│  │       ▼                                           │  │
│  │  postToolUse → post-tool-use.sh                   │  │
│  │       │  - Rastreia tool                          │  │
│  │       │  - Se tool=vscode_askQuestions:            │  │
│  │       │    → Captura resposta do usuário           │  │
│  │       │    → Verifica close_key na resposta        │  │
│  │       │    → Seta auth_requested=true              │  │
│  │       │  - Output: additionalContext               │  │
│  │  [...more tool calls...]                          │  │
│  │                                                   │  │
│  │  [agent finishes, tries to stop]                  │  │
│  │       ▼                                           │  │
│  │  agentStop → agent-stop.sh (STOP HOOK)            │  │
│  │       │                                           │  │
│  │       ├─ stop_hook_active=true?                   │  │
│  │       │   YES → permit stop (anti-loop)           │  │
│  │       │                                           │  │
│  │       ├─ AUTH_REQUESTED=true?                     │  │
│  │       │   YES → permit stop (vscode_askQ ✓)       │  │
│  │       │                                           │  │
│  │       └─ DEFAULT:                                 │  │
│  │           BLOCK (decision:block + reason)         │  │
│  │               │                                   │  │
│  │               ▼                                   │  │
│  │           [agent continues, calls askQ]           │  │
│  │               │                                   │  │
│  │           [agent tries to stop again]             │  │
│  │       agentStop (stop_hook_active=true)           │  │
│  │               ▼                                   │  │
│  │           PERMIT (anti-loop protection)           │  │
│  │                                                   │  │
│  └───────────────────────────────────────────────────┘  │
│       │                                                 │
│  [repeat N TURNs]                                       │
│       │                                                 │
│  [session ends]                                         │
│       │                                                 │
│       ▼                                                 │
│  sessionEnd → session-end.sh                            │
│       │  - Verifica close_key_validated                 │
│       │  - Se false → SESSION_CLOSE_NO_KEY.flag         │
│       │  - Gera relatório final                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 13. Histórico de versões

| Versão   | Data           | Mudanças principais                                                                                                                                                                                                 |
| -------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.0     | 2026-02        | Sistema inicial de hooks                                                                                                                                                                                            |
| v2.0     | 2026-03-08     | Wave 1+2: infra base                                                                                                                                                                                                |
| v3.0     | 2026-03-09     | Análise de sessões abruptas                                                                                                                                                                                         |
| v4.x     | 2026-03-09     | decision:block INTRODUZIDO (agressivo)                                                                                                                                                                              |
| v5.0     | 2026-03-09     | TURN Autônomo: decision:block REMOVIDO                                                                                                                                                                              |
| v5.1     | 2026-03-09     | Threshold reduzido (5→3), UNAUTHORIZED flag                                                                                                                                                                         |
| v6.0     | 2026-03-10     | SESSION reminder em log-prompt.sh + agent-stop.sh always-on                                                                                                                                                         |
| v6.1     | 2026-03-10     | Caixa crítica em AGENTS.md + copilot-instructions.md                                                                                                                                                                |
| v6.2     | 2026-03-10     | SESSION reminder via preToolUse; TURN definição atualizada                                                                                                                                                          |
| **v7.0** | **2026-03-10** | **decision:block RESTAURADO** — formato correto Stop hook. Todo TURN exige vscode_askQuestions. Sem exceção (exceto stop_hook_active, primeiro turno, subagente).                                                   |
| **v8.0** | **2026-03-12** | **Fase 10 — Ciclo de correções completo**: BUG-01..BUG-17 + GAP-01..GAP-05 + ROB-B + GAP-O1. Guards session_id, HEAL v1/v2, schema completo, inline_restart cap, common.sh warning. Ver `PLANO-CORRECOES-HOOKS.md`. |

---

## Referências

- Documentação oficial VS Code Hooks: https://code.visualstudio.com/docs/copilot/customization/hooks
- Arquivo de configuração: `.github/hooks/copilot-hooks.json`
- Estado canônico: `.github/hooks/state/session-context.json`
- Auditoria: `.github/hooks/logs/audit.jsonl`
- Relatório de hardening: `DOCUMENTAÇÃO/HOOKS/RELATORIO-SESSION-HARDENING-v3.md`
- Scripts: `.github/hooks/scripts/`
