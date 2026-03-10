# Referência Definitiva — Hooks do GitHub Copilot Chat

**Versão**: 1.0 — github.copilot-chat-0.38.2
**Última atualização**: 2026-01
**Status**: Canônico. Baseado em documentação oficial + análise empírica do source.

> Este documento combina:
> - Documentação oficial em `hooks.md` (bundled na extensão)
> - Análise direta do source `extension.js` (~18MB) e `cli.js` (~12MB)
> - Confirmação empírica via `audit.jsonl` (1990+ eventos de sessão real)

---

## Índice

1. [Arquitetura em duas camadas](#1-arquitetura-em-duas-camadas)
2. [Localidades de configuração](#2-localidades-de-configuração)
3. [Formatos de configuração](#3-formatos-de-configuração)
4. [Mecanismo de execução](#4-mecanismo-de-execução)
5. [JSON enviado ao stdin](#5-json-enviado-ao-stdin)
6. [Contrato de saída (stdout)](#6-contrato-de-saída-stdout)
7. [Tabela de todos os eventos disponíveis](#7-tabela-de-todos-os-eventos-disponíveis)
8. [Detalhamento de cada hook](#8-detalhamento-de-cada-hook)
9. [Mapeamento do nosso copilot-hooks.json](#9-mapeamento-do-nosso-copilot-hooksjson)
10. [Implicações para a arquitetura SESSION/SECTION/TURN](#10-implicações-para-a-arquitetura-sessionsectionturn)
11. [Apêndice: Código-fonte anotado](#11-apêndice-código-fonte-anotado)

---

## 1. Arquitetura em duas camadas

```
┌────────────────────────────────────────────────────────────┐
│  CAMADA 1: VSCode Extension (extension.js)                 │
│                                                            │
│  ChatHookService.executeHook(                              │
│    eventName: string [PascalCase],                         │
│    hooks: Map<string, HookConfig[]>,                       │
│    payload: object,                                        │
│    sessionId: string,                                      │
│    token: CancellationToken                                │
│  )                                                         │
│  └── HookExecutor._spawn(hookConfig, inputJSON, token)     │
│       └── child_process.spawn(                             │
│             command,                                       │
│             [],                                            │
│             {shell: true, stdio: "pipe", cwd, env}         │
│           )                                                │
│           stdin ← JSON.stringify(baseContext + payload)    │
│           stdout → JSON parse (exit 0)                     │
│           exit 2 → BLOCKING                                │
│           other  → non-blocking warning                    │
└────────────────────────────────────────────────────────────┘
                        ▲
                        │ hooks dict (PascalCase keys)
                        │
┌────────────────────────────────────────────────────────────┐
│  CAMADA 2: Claude Code CLI (cli.js)                        │
│                                                            │
│  Lê copilot-hooks.json / settings.json                     │
│  Converte camelCase → PascalCase                           │
│  Converte campos: bash→command, timeoutSec→timeout         │
│  Repassa como request.hooks para a extensão                │
│                                                            │
│  Ativação: .vscode/settings.json                           │
│            "chat.useClaudeHooks": true                     │
└────────────────────────────────────────────────────────────┘
                        ▲
                        │ lê
                        │
┌────────────────────────────────────────────────────────────┐
│  .github/hooks/copilot-hooks.json                          │
│  (ou ~/.claude/settings.json, .claude/settings.json, etc.) │
└────────────────────────────────────────────────────────────┘
```

**Ponto-chave**: A extensão VSCode só conhece PascalCase. O CLI faz a tradução.
Mesmo que nosso `copilot-hooks.json` use camelCase/bash/timeoutSec, funciona
porque a conversão ocorre no CLI **antes** de chegar à extensão.

---

## 2. Localidades de configuração

| Caminho                       | Escopo                  | Notas                                                     |
| ----------------------------- | ----------------------- | --------------------------------------------------------- |
| `.github/hooks/*.json`        | Workspace compartilhado | Commitado. Lido pelo CLI ao ativar `chat.useClaudeHooks`. |
| `.claude/settings.json`       | Workspace               | Padrão Claude Code — PascalCase nativo.                   |
| `.claude/settings.local.json` | Workspace local         | Não deve ser commitado (segredos).                        |
| `~/.claude/settings.json`     | Perfil do usuário       | Global, todos os workspaces.                              |

**Nosso workspace usa**: `.github/hooks/copilot-hooks.json` (via `chat.useClaudeHooks: true`).

---

## 3. Formatos de configuração

### 3.1 Formato copilot-hooks.json (Copilot-specific, via CLI)

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "bash": "./scripts/session-start.sh",
        "cwd": ".github/hooks",
        "timeoutSec": 15,
        "env": { "MINHA_VAR": "valor" }
      }
    ]
  }
}
```

| Campo        | Tipo   | Aliases            | Descrição                                                  |
| ------------ | ------ | ------------------ | ---------------------------------------------------------- |
| `type`       | string | —                  | Deve ser `"command"`. Único valor suportado.               |
| `bash`       | string | alias de `command` | Comando ou script a executar. CLI converte para `command`. |
| `command`    | string | —                  | Nome padrão SDK (PascalCase nativo).                       |
| `timeoutSec` | number | alias de `timeout` | Timeout em segundos. CLI converte para `timeout`.          |
| `timeout`    | number | —                  | Nome padrão SDK. Padrão interno: **30 segundos**.          |
| `cwd`        | string | —                  | Diretório de trabalho para o processo filho.               |
| `env`        | object | —                  | Variáveis de ambiente extras (merged com process.env).     |
| `windows`    | string | —                  | Comando específico para Windows (override de `command`).   |
| `linux`      | string | —                  | Comando específico para Linux (override de `command`).     |
| `osx`        | string | —                  | Comando específico para macOS (override de `command`).     |

**Chaves camelCase** aceitas no copilot-hooks.json (convertidas para PascalCase pelo CLI):

| copilot-hooks.json    | SDK PascalCase       |
| --------------------- | -------------------- |
| `sessionStart`        | `SessionStart`       |
| `userPromptSubmitted` | `UserPromptSubmit`   |
| `preToolUse`          | `PreToolUse`         |
| `postToolUse`         | `PostToolUse`        |
| `agentStop`           | `Stop`               |
| `subagentStop`        | `SubagentStop`       |
| `sessionEnd`          | `SessionEnd`         |
| `subagentStart`       | `SubagentStart`      |
| `preCompact`          | `PreCompact`         |
| `postToolUseFailure`  | `PostToolUseFailure` |
| `subagentStart`       | `SubagentStart`      |
| `preCompact`          | `PreCompact`         |

> **errorOccurred** foi removido do copilot-hooks.json (commit 4ceb3a52) — nunca
> disparava (não existe no array `Mti` do SDK). Substituído por `postToolUseFailure`.

### 3.2 Formato .claude/settings.json (SDK nativo, PascalCase)

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

---

## 4. Mecanismo de execução

### 4.1 ChatHookService.executeHook() — fluxo completo

Localizado em `extension.js` (classe `ChatHookService`, pos ~17813239):

```javascript
async executeHook(eventName, hooksMap, payload, sessionId, token) {
    // 1. Constrói contexto base (enviado a TODOS os hooks):
    const baseContext = {
        timestamp:       new Date().toISOString(),
        hook_event_name: eventName,     // ex: "PreToolUse"
        session_id:      sessionId,     // UUID da sessão
        transcript_path: transcriptPath // caminho do transcript ativo
    };

    // 2. Faz flush do transcript (timeout: 500ms) antes de executar
    await transcriptService.flush(timeout_500ms);

    // 3. Merge base + payload específico do hook
    const input = {...baseContext, ...payload};

    // 4. Para cada hook configurado para este evento:
    for (const hookConfig of hooksMap.get(eventName) ?? []) {
        // 5. Adiciona cwd se configurado no hook
        const inputWithCwd = hookConfig.cwd ? {...input, cwd: hookConfig.cwd} : input;

        // 6. Executa via HookExecutor
        const result = await hookExecutor.executeCommand(hookConfig, inputWithCwd, token);
    }
}
```

### 4.2 HookExecutor._spawn() — processo filho

Localizado em `extension.js` (classe `gce`, pos ~17651125):

```javascript
_spawn(hookConfig, payload, cancellationToken) {
    const cwd = hookConfig.cwd ?? os.homedir();
    const proc = child_process.spawn(hookConfig.command, [], {
        stdio: "pipe",
        cwd:   cwd,
        env:   {...process.env, ...hookConfig.env},
        shell: true   // executa via /bin/sh -c "command"
    });

    // Envia o payload completo como JSON para stdin
    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();

    // Timeout: hookConfig.timeout ?? 30 segundos (OCr = 30)
    // Ao dar timeout: SIGTERM, depois SIGKILL após 5000ms (q9a = 5000)

    // Exit 0  → lê stdout, faz JSON.parse → {kind: 1, result: parsedJSON}
    // Exit 2  → {kind: 2, result: stderr}  → BLOCKING (erro bloqueante)
    // Outros  → {kind: 3, result: stderr}  → não-bloqueante, só aviso
}
```

---

## 5. JSON enviado ao stdin

### 5.1 Campos base (presentes em TODOS os hooks)

```json
{
    "timestamp":       "2026-01-27T12:34:56.789Z",
    "hook_event_name": "PreToolUse",
    "session_id":      "a0be08af-7a26-42d8-b8a5-3c43206494c7",
    "transcript_path": "/path/to/transcript.jsonl",
    "cwd":             "/workspaces/chatgpt-docker-puppeteer"
}
```

> **Nota**: `cwd` é adicionado apenas se configurado no hook (`hookConfig.cwd`).
> `transcript_path` pode ser ausente se o transcript ainda não foi criado.

### 5.2 Payloads específicos por hook

#### PreToolUse
```json
{
    "...campos_base...",
    "tool_name":  "run_in_terminal",
    "tool_input": { "command": "npm test", "explanation": "..." }
}
```

#### PostToolUse
```json
{
    "...campos_base...",
    "tool_name":     "run_in_terminal",
    "tool_input":    { "command": "npm test", "explanation": "..." },
    "tool_response": "resultado do tool como string"
}
```

#### PostToolUseFailure
```json
{
    "...campos_base...",
    "tool_name":    "run_in_terminal",
    "tool_input":   { "command": "npm test" },
    "error":        "mensagem de erro",
    "is_interrupt": false
}
```

#### PermissionRequest
```json
{
    "...campos_base...",
    "tool_name":              "run_in_terminal",
    "tool_input":             { "command": "rm -rf /" },
    "permission_suggestions": ["allow", "deny"]
}
```

#### UserPromptSubmit ⚠️ RARO
```json
{
    "...campos_base...",
    "prompt": "texto digitado pelo usuário no chat"
}
```

#### Stop (agentStop)
```json
{
    "...campos_base...",
    "stop_hook_active": false
}
```

> `stop_hook_active: true` significa que o Stop foi iniciado **por um hook**
> (prevenção de recursão). O hook deve verificar este campo antes de tentar
> bloquear novamente.

#### SubagentStart
```json
{
    "...campos_base...",
    "agent_id":   "uuid-do-subagente",
    "agent_type": "tipo-do-subagente"
}
```

#### SubagentStop
```json
{
    "...campos_base...",
    "agent_id":              "uuid-do-subagente",
    "agent_transcript_path": "/path/to/subagent-transcript.jsonl",
    "stop_hook_active":      false
}
```

#### PreCompact
```json
{
    "...campos_base...",
    "trigger":             "auto",
    "custom_instructions": "instruções de compactação customizadas"
}
```

> `trigger`: `"manual"` ou `"auto"`.

#### SessionStart
```json
{
    "...campos_base...",
    "source": "startup"
}
```

> `source`: `"startup"` | `"resume"` | `"clear"` | `"compact"`.

#### SessionEnd
```json
{
    "...campos_base...",
    "reason": "clear"
}
```

> `reason`: `"clear"` | `"logout"` | `"prompt_input_exit"` | `"other"`.

#### Notification
```json
{
    "...campos_base...",
    "message":           "texto da notificação",
    "notification_type": "tipo",
    "title":             "título"
}
```

---

## 6. Contrato de saída (stdout)

O hook escreve JSON no stdout (exit 0). A extensão faz JSON.parse do stdout.

### 6.1 Campos comuns (todos os hooks)

```json
{
    "continue":    true,
    "stopReason":  "motivo opcional",
    "systemMessage": "mensagem injetada no contexto do agente"
}
```

### 6.2 Saída específica por hook

#### PreToolUse — controle de permissão

```json
{
    "hookSpecificOutput": {
        "permissionDecision": "allow"
    }
}
```

> `permissionDecision`: `"allow"` | `"ask"` | `"deny"`.

#### PostToolUse — bloqueio

```json
{
    "decision": "block"
}
```

> `decision: "block"` interrompe o processamento do resultado do tool.

#### Stop (agentStop) — manter agente rodando

```json
{
    "decision": "block"
}
```

> `decision: "block"` → `shouldContinue: true` na extensão → **o agente continua rodando**
> em vez de encerrar o turno. Use com cautela: pode criar loop infinito.

#### SessionStart — contexto adicional

```json
{
    "hookSpecificOutput": {
        "additionalContext": "texto injetado no início da sessão"
    }
}
```

### 6.3 Códigos de saída

| Exit code | Significado          | Efeito                                         |
| --------- | -------------------- | ---------------------------------------------- |
| `0`       | Sucesso              | Stdout parseado como JSON                      |
| `2`       | Erro bloqueante      | Interrompe a operação (stderr como mensagem)   |
| Outros    | Aviso não-bloqueante | Operação continua; stderr exibido como warning |

---

## 7. Tabela de todos os eventos disponíveis

Lista completa extraída do source (array `Mti` em `extension.js`, pos ~1066861):

| Evento SDK (PascalCase) | Documentado oficialmente       | Configurável em nosso hooks        |
| ----------------------- | ------------------------------ | ---------------------------------- |
| `SessionStart`          | ✅ Sim                          | ✅ via `sessionStart`               |
| `UserPromptSubmit`      | ✅ Sim                          | ✅ via `userPromptSubmitted` (RARO) |
| `PreToolUse`            | ✅ Sim                          | ✅ via `preToolUse`                 |
| `PostToolUse`           | ✅ Sim                          | ✅ via `postToolUse`                |
| `PostToolUseFailure`    | ✅ Sim                          | ✅ via `postToolUseFailure`         |
| `Stop`                  | ✅ Sim (como "Stop")            | ✅ via `agentStop`                  |
| `SubagentStart`         | ✅ Sim                          | ✅ via `subagentStart`              |
| `SubagentStop`          | ✅ Sim                          | ✅ via `subagentStop`               |
| `PreCompact`            | ✅ Sim                          | ✅ via `preCompact`                 |
| `SessionEnd`            | ❌ Não documentado oficialmente | ✅ via `sessionEnd`                 |
| `Notification`          | ❌ Não documentado              | ❌ não configurado                  |
| `PermissionRequest`     | ❌ Não documentado              | ❌ não configurado                  |
| `Setup`                 | ❌ Não documentado              | ❌ não configurado                  |
| `TeammateIdle`          | ❌ Não documentado              | ❌ não configurado                  |
| `TaskCompleted`         | ❌ Não documentado              | ❌ não configurado                  |
| `ConfigChange`          | ❌ Não documentado              | ❌ não configurado                  |
| `WorktreeCreate`        | ❌ Não documentado              | ❌ não configurado                  |
| `WorktreeRemove`        | ❌ Não documentado              | ❌ não configurado                  |

> **errorOccurred** foi removido do copilot-hooks.json (commit 4ceb3a52).
> Substituído por `postToolUseFailure` (SDK `PostToolUseFailure`).
> O script `error-occurred.sh` permanece no filesystem como legacy.

---

## 8. Detalhamento de cada hook

### 8.1 SessionStart — início de sessão

| Aspecto              | Detalhe                                                     |
| -------------------- | ----------------------------------------------------------- |
| **Quando dispara**   | Primeiro prompt de uma nova sessão do agente                |
| **Frequência**       | 1x por sessão                                               |
| **Campo específico** | `source`: `"startup"`, `"resume"`, `"clear"`, `"compact"`   |
| **Saída útil**       | `hookSpecificOutput.additionalContext` → injetado na sessão |
| **Handler interno**  | `executeSessionStartHook()` em extension.js                 |
| **Nosso script**     | `.github/hooks/scripts/session-start.sh`                    |
| **Uso atual**        | Inicializa session-context.json com novo session_id         |

**Confirmação empírica**: 1 evento por sessão em audit.jsonl.

---

### 8.2 UserPromptSubmit — prompt do usuário ⚠️ RARO

| Aspecto                | Detalhe                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------- |
| **Quando dispara**     | Usuário digita diretamente no chat do Copilot e pressiona Enter                    |
| **Quando NÃO dispara** | Resposta a `vscode_askQuestions`, continuações por compactação, operações internas |
| **Frequência**         | ~4 eventos em 1990+ eventos totais (sessão real) — **muito raro**                  |
| **Campo específico**   | `prompt`: texto digitado pelo usuário                                              |
| **Saída**              | Campos comuns (`systemMessage`, etc.)                                              |
| **Nosso script**       | `.github/hooks/scripts/log-prompt.sh`                                              |
| **Uso atual**          | Registra prompt, marca `current_turn.started_at`                                   |

**IMPORTANTE PARA ARQUITETURA**: Não usar `userPromptSubmitted` como marcador de início de turno.
A maioria das interações (via `vscode_askQuestions`) **não dispara** este hook.

**Confirmação empírica**: ~4 eventos vs 1990+ tool events na mesma sessão.

---

### 8.3 PreToolUse — antes de cada tool ⚡ FREQUENTE

| Aspecto              | Detalhe                                                               |
| -------------------- | --------------------------------------------------------------------- |
| **Quando dispara**   | Imediatamente antes de cada invocação de tool                         |
| **Frequência**       | ~1000 por sessão (mais frequente de todos)                            |
| **Campo específico** | `tool_name`, `tool_input`                                             |
| **Saída útil**       | `hookSpecificOutput.permissionDecision`: `"allow"`, `"ask"`, `"deny"` |
| **Exit 2**           | Bloqueia o uso do tool                                                |
| **Nosso script**     | `.github/hooks/scripts/pre-tool-use.sh`                               |
| **Uso atual**        | Registra tool call em audit.jsonl; **detecta `runSubagent`/`Task` → seta `subagent_delegated=true` no contexto e loga `subagentStart` (sinal de auth implícita, Hardening v6)** |

---

### 8.4 PostToolUse — após cada tool ⚡ FREQUENTE

| Aspecto                | Detalhe                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| **Quando dispara**     | Após invocação bem-sucedida de tool                                     |
| **Frequência**         | ~1000 por sessão (em par com PreToolUse)                                |
| **Campos específicos** | `tool_name`, `tool_input`, `tool_response`                              |
| **Saída útil**         | `decision: "block"` para interromper processamento do resultado         |
| **Nosso script**       | `.github/hooks/scripts/post-tool-use.sh`                                |
| **Uso atual**          | Detecta `vscode_askQuestions` → seta `auth_requested: true` no contexto |

**CRÍTICO**: É via PostToolUse que detectamos `vscode_askQuestions` e marcamos
`current_turn.auth_requested = true` em session-context.json.

---

### 8.5 Stop (agentStop) — fim de turno ✅ CONFIÁVEL

| Aspecto              | Detalhe                                                        |
| -------------------- | -------------------------------------------------------------- |
| **Quando dispara**   | Fim de cada turno de resposta do agente                        |
| **Frequência**       | 1x por turno (após TODAS as ferramentas do turno)              |
| **Campo específico** | `stop_hook_active: boolean`                                    |
| **Saída útil**       | `decision: "block"` → `shouldContinue: true` → agente continua |
| **Handler interno**  | `executeStopHook()` em extension.js                            |
| **Nosso script**     | `.github/hooks/scripts/agent-stop.sh`                          |
| **Uso atual**        | Verifica autorização, registra fim de turno, reseta estado     |

**`stop_hook_active` explicado**:
- `false` → parada normal do agente (caso padrão)
- `true` → esta parada foi iniciada **por um hook** (prevenção de recursão infinita)

Se o seu Stop hook retornar `decision: block` quando `stop_hook_active: true`,
causará recursão infinita. **Sempre verificar este campo antes de bloquear.**

**Confirmação empírica**: 4 agentStop eventos em audit.jsonl — 1 por turno de agente.

---

### 8.6 SubagentStop — fim de subagente

| Aspecto                | Detalhe                                                 |
| ---------------------- | ------------------------------------------------------- |
| **Quando dispara**     | Quando um subagente encerra                             |
| **Frequência**         | Raro (apenas quando há subagentes)                      |
| **Campos específicos** | `agent_id`, `agent_transcript_path`, `stop_hook_active` |
| **Nosso script**       | `.github/hooks/scripts/subagent-stop.sh`                |
| **Uso atual**          | Registro básico                                         |

---

### 8.7 SessionEnd — fim de sessão

| Aspecto              | Detalhe                                                           |
| -------------------- | ----------------------------------------------------------------- |
| **Quando dispara**   | Quando a sessão do agente encerra                                 |
| **Frequência**       | 1x por sessão                                                     |
| **Campo específico** | `reason`: `"clear"`, `"logout"`, `"prompt_input_exit"`, `"other"` |
| **Nosso script**     | `.github/hooks/scripts/session-end.sh`                            |
| **Uso atual**        | Gera relatório final da sessão                                    |

**Nota**: `SessionEnd` não está na documentação oficial bundled (`hooks.md`),
mas existe na lista `Mti` do source e funciona empiricamente.

---

### 8.8 PostToolUseFailure — falha em ferramenta

| Aspecto            | Detalhe                                                          |
| ------------------ | ---------------------------------------------------------------- |
| **Quando dispara** | Após uma chamada de ferramenta falhar (erro, timeout)            |
| **Mapeamento SDK** | `PostToolUseFailure` (confirmado no array `Mti`)                 |
| **Status atual**   | ✅ Ativo desde commit 4ceb3a52                                    |
| **Nosso script**   | `.github/hooks/scripts/tool-use-failure.sh`                      |
| **Funcionalidade** | Loga falha, incrementa failures_detected/errors_total no context |

### 8.9 SubagentStart — início de subagente

| Aspecto            | Detalhe                                                   |
| ------------------ | --------------------------------------------------------- |
| **Quando dispara** | Quando um subagente é iniciado pelo agente principal      |
| **Mapeamento SDK** | `SubagentStart` (confirmado no array `Mti`)               |
| **Status atual**   | ✅ Ativo desde commit 4ceb3a52                             |
| **Nosso script**   | `.github/hooks/scripts/subagent-start.sh`                 |
| **Funcionalidade** | Loga início, incrementa subagent_calls no session-context |

### 8.10 PreCompact — antes de compactação de contexto

| Aspecto            | Detalhe                                                       |
| ------------------ | ------------------------------------------------------------- |
| **Quando dispara** | Antes do Copilot compactar o contexto da conversa             |
| **Mapeamento SDK** | `PreCompact` (confirmado no array `Mti`)                      |
| **Status atual**   | ✅ Ativo desde commit 4ceb3a52                                 |
| **Nosso script**   | `.github/hooks/scripts/pre-compact.sh`                        |
| **Funcionalidade** | Cria checkpoint completo, incrementa compaction_count, alerta |

### 8.11 errorOccurred — REMOVIDO (legacy)

| Aspecto             | Detalhe                                                     |
| ------------------- | ----------------------------------------------------------- |
| **Status**          | ❌ Removido do copilot-hooks.json (commit 4ceb3a52)          |
| **Motivo**          | Não existe no array `Mti` do SDK — nunca disparava          |
| **Substituído por** | `postToolUseFailure` → `tool-use-failure.sh`                |
| **Script legacy**   | `error-occurred.sh` mantido no filesystem (não configurado) |

---

## 9. Mapeamento do nosso copilot-hooks.json

Estado atual (`copilot-hooks.json` commitado, versão pós-8bacbd21):

| Chave no JSON         | SDK PascalCase       | Nosso script          | Status  | Frequência       |
| --------------------- | -------------------- | --------------------- | ------- | ---------------- |
| `sessionStart`        | `SessionStart`       | `session-start.sh`    | ✅ ativo | 1/sessão         |
| `userPromptSubmitted` | `UserPromptSubmit`   | `log-prompt.sh`       | ✅ ativo | Raro (~4/sessão) |
| `preToolUse`          | `PreToolUse`         | `pre-tool-use.sh`     | ✅ ativo | ~1000/sessão     |
| `postToolUse`         | `PostToolUse`        | `post-tool-use.sh`    | ✅ ativo | ~1000/sessão     |
| `agentStop`           | `Stop`               | `agent-stop.sh`       | ✅ ativo | 1/turno          |
| `subagentStop`        | `SubagentStop`       | `subagent-stop.sh`    | ✅ ativo | Raro             |
| `postToolUseFailure`  | `PostToolUseFailure` | `tool-use-failure.sh` | ✅ ativo | Raro (falhas)    |
| `subagentStart`       | `SubagentStart`      | `subagent-start.sh`   | ✅ ativo | Raro             |
| `preCompact`          | `PreCompact`         | `pre-compact.sh`      | ✅ ativo | Raro (~0-2/sess) |
| `sessionEnd`          | `SessionEnd`         | `session-end.sh`      | ✅ ativo | 1/sessão         |

> **errorOccurred** removido (commit 4ceb3a52). Script `error-occurred.sh` mantido como legacy.

### 9.1 Ativação

```json
// .vscode/settings.json
{
    "chat.useClaudeHooks": true
}
```

Esta configuração instrui o CLI (cli.js) a ler `.github/hooks/copilot-hooks.json`
e repassar os hooks à extensão VSCode.

---

## 10. Implicações para a arquitetura SESSION/SECTION/TURN

### 10.1 Marcadores confiáveis de entrada/saída

| Evento de ciclo        | Hook usado                                 | Confiabilidade            |
| ---------------------- | ------------------------------------------ | ------------------------- |
| Início de SESSION      | `sessionStart` → `session-start.sh`        | ✅ 100% (1/sessão)         |
| Início de TURN         | `preToolUse` do 1º tool OU `start-turn.sh` | ⚠️ Indireto                |
| Início de TURN (ideal) | `userPromptSubmitted`                      | ❌ Raro — só prompt direto |
| Fim de TURN            | `agentStop` → `agent-stop.sh`              | ✅ 100% (1/turno)          |
| Fim de SESSION         | `sessionEnd` → `session-end.sh`            | ✅ Sim                     |

### 10.2 Por que não usar userPromptSubmitted como start-turn

`UserPromptSubmit` NÃO dispara quando:
- O usuário responde a um `vscode_askQuestions` (o caso mais comum!)
- A sessão retoma após compactação
- O agente continua a partir de context injection

**Conclusão**: O único marcador confiável de início de turno é inferir pelo
`agentStop` anterior (o turno começa quando o turno anterior terminou).
Ou usar `preToolUse` da primeira ferramenta como proxy.

### 10.3 Detecção de vscode_askQuestions

Usa `postToolUse`: quando `tool_name == "vscode_askQuestions"`,
seta `current_turn.auth_requested = true`.

O `agentStop` então verifica este flag para determinar se o turno foi autorizado.

### 10.4 Fluxo de um turno típico

```
userPromptSubmitted (OU resposta a askQuestions — sem hook)
    │
    ├── preToolUse  {tool_name: "semantic_search", ...}
    ├── postToolUse {tool_name: "semantic_search", ...}
    ├── preToolUse  {tool_name: "run_in_terminal", ...}
    ├── postToolUse {tool_name: "run_in_terminal", ...}
    ├── ...
    ├── preToolUse  {tool_name: "vscode_askQuestions", ...}
    ├── postToolUse {tool_name: "vscode_askQuestions", ...}  ← seta auth_requested=true
    │
    └── agentStop   {stop_hook_active: false}  ← verifica auth, reseta estado
```

---

## 11. Apêndice: Código-fonte anotado

### 11.1 executeStopHook() em extension.js (pos ~13263450)

```javascript
async executeStopHook(payload, sessionId, hooks, token) {
    const output = await chatHookService.executeHook(
        "Stop",
        hooks,
        payload,  // {stop_hook_active: boolean}
        sessionId,
        token
    );

    // Se o hook retorna decision: block → mantém agente rodando
    const shouldContinue = output?.decision === "block";
    return { shouldContinue };
}
```

### 11.2 executeSessionStartHook() em extension.js (pos ~13263450+)

```javascript
async executeSessionStartHook(payload, sessionId, hooks, token) {
    const output = await chatHookService.executeHook(
        "SessionStart",
        hooks,
        payload,  // {source: "startup"|"resume"|"clear"|"compact"}
        sessionId,
        token
    );

    // additionalContext é injetado no início da sessão
    const additionalContext = output?.hookSpecificOutput?.additionalContext;
    return { additionalContext };
}
```

### 11.3 PreCompact disparado internamente (extension.js)

```javascript
// Chamado automaticamente antes de qualquer compactação
await chatHookService.executeHook(
    "PreCompact",
    hooks,
    { trigger: "auto" },
    sessionId,
    token
);
```

### 11.4 Lista HOOK_EVENTS completa (array Mti, pos ~1066861)

```javascript
const Mti = [
    "PreToolUse",       // ✅ documentado, suportado
    "PostToolUse",      // ✅ documentado, suportado
    "PostToolUseFailure", // ❌ não documentado
    "Notification",     // ❌ não documentado
    "UserPromptSubmit", // ✅ documentado, raro
    "SessionStart",     // ✅ documentado, suportado
    "SessionEnd",       // ✅ suportado (não na doc oficial)
    "Stop",             // ✅ documentado (nosso agentStop)
    "SubagentStart",    // ✅ documentado
    "SubagentStop",     // ✅ documentado, suportado
    "PreCompact",       // ✅ documentado
    "PermissionRequest",// ❌ não documentado
    "Setup",            // ❌ não documentado
    "TeammateIdle",     // ❌ não documentado
    "TaskCompleted",    // ❌ não documentado
    "ConfigChange",     // ❌ não documentado
    "WorktreeCreate",   // ❌ não documentado
    "WorktreeRemove"    // ❌ não documentado
];
```

---

*Baseado em análise de `github.copilot-chat-0.38.2` (extension.js ~18MB, cli.js ~12MB)
e confirmação empírica com sessão real de 1990+ eventos.*
