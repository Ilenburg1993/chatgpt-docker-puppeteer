# Protocolo de Autorização — Spec Completo

> **Status**: Canônico | **Última atualização**: 2026-03-09 | **Versão**: 2.0

---

## Problema

O agente pode encerrar cada turno sem perguntar ao usuário o que fazer a seguir.
Isso interrompe o fluxo de trabalho e cria sessões que "morrem silenciosamente".

**A falha mais comum**: o agente escreve "O que deseja fazer a seguir?" como **texto plano** —
isso NÃO equivale a chamar a ferramenta `vscode_askQuestions`.

---

## Definição da Regra

> **Antes de encerrar qualquer turno, o agente DEVE:**
> 1. Chamar o **tool call real** `vscode_askQuestions`
> 2. Aguardar a resposta do usuário

**Formas inválidas (violam a regra):**
- Escrever "O que deseja fazer a seguir?" como texto
- Encerrar a resposta com uma pergunta em texto livre
- Dizer "posso continuar?" sem chamar a ferramenta

---

## Implementação Técnica

### Layer 1 — Instrução no contexto primário

A regra está inscrita no topo de dois arquivos lidos no início de cada sessão:
- `.github/copilot-instructions.md` → seção `⛔ REGRA ABSOLUTA` (lida pelo Copilot como instrução)
- `.github/AGENTS.md` → seção `⛔⛔⛔ REGRA ABSOLUTA` (lida por todos os agentes de IA)

### Layer 2 — Rastreamento por preToolUse

Quando `vscode_askQuestions` é chamado, o hook `pre-tool-use.sh` registra:
```json
{"auth_requested_this_turn": true, "auth_requested_at": "<ISO timestamp>"}
```
em `state/session-context.json`.

### Layer 3 — Detecção por agentStop

A cada fim de turno, `agent-stop.sh` executa 3 estratégias de detecção em cascata:

```
Estratégia 1 — Fronteira por userPromptSubmitted:
  ┌── Encontra linha L = última ocorrência de userPromptSubmitted em audit.jsonl
  ├── Verifica se existe preToolUse com tool_name=vscode_askQuestions após linha L
  └── Se sim → AUTH_REQUESTED = true

Estratégia 2 — Recência (fallback quando userPromptSubmitted ausente):
  ┌── userPromptSubmitted é raro: só dispara quando o Copilot recebe foco
  ├── Se LAST_PROMPT_LINE == 0: varre as últimas 150 linhas do audit.jsonl
  └── Se vscode_askQuestions presente → AUTH_REQUESTED = true

Estratégia 3 — Contexto (último recurso):
  ┌── Lê auth_requested_this_turn no session-context.json
  └── Se true → AUTH_REQUESTED = true
```

### Layer 4 — Alerta na próxima sessão

Se violação detectada, `session-start.sh` injeta no topo do `session-briefing.md`:

```
⛔⛔⛔ VIOLAÇÃO CRÍTICA DETECTADA ⛔⛔⛔

A sessão ANTERIOR terminou WITHOUT calling vscode_askQuestions.
Violation timestamp: 2026-03-09T03:15:08Z
Session: a0be08af-...
Consecutive violations: 1

MANDATORY FIRST ACTION:
1. Apologize for unauthorized close
2. Call vscode_askQuestions NOW, before anything else
```

---

## Reset de `auth_requested_this_turn` — Crítico

O flag `auth_requested_this_turn` deve ser resetado para `false` entre turnos.
Sem este reset, autorização do turno N vazaria para o turno N+1 (falso positivo).

**Dois pontos de reset (belt-and-suspenders):**

1. `agent-stop.sh` → ao final do processamento de cada turno:
   ```bash
   jq '.auth_requested_this_turn = false | .auth_requested_at = null' ...
   ```

2. `log-prompt.sh` → ao início de cada novo prompt do usuário:
   ```bash
   jq '.auth_requested_this_turn = false | .auth_requested_at = null' ...
   ```

---

## Arquivos de Estado

### `UNAUTHORIZED_CLOSE.flag`

Presente quando há violação ativa. Schema:
```json
{
    "timestamp": "2026-03-09T03:15:08Z",
    "session_id": "a0be08af-7a26-42d8-b8a5-3c43206494c7",
    "turn_count": 2,
    "violation": "Turno encerrado sem chamar vscode_askQuestions",
    "severity": "critical"
}
```

**Ciclo de vida**:
- **Criado**: por `agent-stop.sh` quando turno não autorizado
- **Criado também**: por `session-end.sh` como safety net se sessão termina sem turnos autorizados
- **Removido**: por `agent-stop.sh` quando turno seguinte é autorizado
- **Reset manual**: `bash reset-auth-violation.sh "motivo"`

---

## Eventos de Auditoria

Todos registrados em `logs/audit.jsonl`:

| Evento                  | Quando ocorre                         |
| ----------------------- | ------------------------------------- |
| `turnEnd_authorized`    | Turno encerrado com vscode_askQuestions chamado |
| `turnEnd_UNAUTHORIZED`  | Turno encerrado sem vscode_askQuestions |
| `sessionEnd_compliance` | Fim de sessão — resumo de conformidade |
| `authViolation_reset`   | Flag resetada manualmente             |

---

## Métricas de Conformidade

O `generate-daily-report.sh` calcula:
- `TURNS_AUTHORIZED` — turnos conformes no dia
- `TURNS_VIOLATED` — turnos em violação no dia
- Taxa de conformidade: `TURNS_AUTHORIZED / (TURNS_AUTHORIZED + TURNS_VIOLATED) * 100`

Query manual:
```bash
# Taxa de conformidade histórica
jq -r 'select(.event | startswith("turnEnd")) | .event' \
    .github/hooks/logs/audit.jsonl | sort | uniq -c
```

---

## Casos Especiais

### Subagentes

`subagent-stop.sh` não implementa o protocolo de autorização — subagentes são temporários e
controlados pelo agente pai. A violação (se houver) é detectada quando o agente pai encerra seu turno.

### Sessões que terminam abruptamente

`session-end.sh` conta os `turnEnd_authorized` vs `turnEnd_UNAUTHORIZED` da sessão. Se `authorized_turns == 0`, grava `UNAUTHORIZED_CLOSE.flag` como safety net — mesmo sem `agent-stop` ter disparado.

### Restart do container

`session-start.sh` recupera `session-context.json` existente (incluindo `consecutive_unauthorized_closes`).  
O `UNAUTHORIZED_CLOSE.flag` persiste em disco — sobrevive a restarts.

---

*Para instruções ao agente, ver [.github/AGENTS.md](../../AGENTS.md) e [.github/copilot-instructions.md](../../copilot-instructions.md).*
