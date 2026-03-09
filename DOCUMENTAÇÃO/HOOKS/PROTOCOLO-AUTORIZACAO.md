# Protocolo de Autorização — Spec Completo

> **Status**: Canônico | **Última atualização**: 2026-03-09 | **Versão**: 2.1

---

## Fundamento: `vscode_askQuestions` é GRATUITO e deve ser AMPLIADO

> **Ponto crítico de entendimento**: `vscode_askQuestions` é uma ferramenta de UI do VS Code que
> exibe um seletor de opções ao usuário. Ela **NUNCA consome "premium requests"** do GitHub Copilot.
> O custo por turno de conversa (LLM) é inerente e não é controlado pelo uso desta ferramenta.
>
> **Conclusão**: o agente deve usar `vscode_askQuestions` MAIS, não menos. É o mecanismo principal
> de controle do usuário sobre o agente. Ver Templates A-E em `.github/AGENTS.md`.

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
{"current_turn": {"auth_requested": true, "auth_requested_at": "<ISO timestamp>"}}
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
  ┌── Lê current_turn.auth_requested no session-context.json
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

## Reset de `current_turn.auth_requested` — Crítico

O campo `current_turn.auth_requested` deve ser resetado para `false` entre turnos.
Sem este reset, autorização do turno N vazaria para o turno N+1 (falso positivo).

**Dois pontos de reset (belt-and-suspenders):**

1. `agent-stop.sh` → ao final do processamento de cada turno:
   ```bash
   jq '.current_turn.auth_requested = false | .current_turn.auth_requested_at = null' ...
   ```

2. `log-prompt.sh` → ao início de cada novo prompt do usuário:
   ```bash
   jq '.current_turn.auth_requested = false | .current_turn.auth_requested_at = null' ...
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

### `SESSION_CLOSE_NO_KEY.flag` ← NEW (Schema v3)

Presente quando a SESSION foi encerrada sem a `close_key` validada. Schema:
```json
{
    "session_id": "a0be08af-7a26-42d8-b8a5-3c43206494c7",
    "timestamp": "2026-03-09T03:15:08Z",
    "note": "SESSION encerrada sem close_key validada"
}
```

**Ciclo de vida**:
- **Criado**: por `session-end.sh` quando `session.close_key_validated = false` ao encerrar
- **Removido**: por `session-end.sh` quando `session.close_key_validated = true` — encerramento legítimo
- **Alertado**: próximo `session-briefing.md` exibe bloco `🔑 ENCERRAMENTO SEM CHAVE`

**O que fazer quando encontrar esta flag**:
1. Verificar `audit.jsonl` para eventos `sessionEnd_no_key` — identificar a sessão
2. Verificar se houve evento `sessionClose_key_validated` naquela sessão
3. Se não houve → encerramento não autorizado — registrar finding e investigar causa
4. Se houve → bug no sistema — reportar e corrigir `post-tool-use.sh` ou `session-end.sh`

---

## Camada 5 — SESSION CLOSE KEY (Schema v3)

SESSION é um recurso premium (1 por dia). Para além do `vscode_askQuestions` obrigatório por turno,
o encerramento de SESSION exige uma **chave dinâmica única por sessão**:

```
Fluxo de encerramento autorizado:
1. Usuário pede encerramento
2. Agente invoca Template F (vscode_askQuestions)
3. Usuário digita ENCERRAR-XXXXXXXX no campo livre
4. post-tool-use.sh detecta a chave na resposta
5. session-context.json: close_key_validated = true
6. session-end.sh lê close_key_validated = true → encerramento registrado como autorizado
```

**Geração da chave**:
- `session-start.sh` gera: `ENCERRAR-$(head -c 4 /dev/urandom | xxd -p | tr 'a-z' 'A-Z' | head -c 8)`
- Ex: `ENCERRAR-7A3F2B1C` — 8 caracteres hexadecimais maiúsculos
- Única por sessão — muda a cada `sessionStart`

**Anúncio da chave**:
- Exibida no `session-briefing.md` → seção `🔐 CHAVE DE ENCERRAMENTO DA SESSÃO`
- Disponível em `session-context.json` → campo `session.close_key`

---

## Eventos de Auditoria

Todos registrados em `logs/audit.jsonl`:

| Evento                        | Quando ocorre                                          |
| ----------------------------- | ------------------------------------------------------ |
| `turnEnd_authorized`          | Turno encerrado com vscode_askQuestions chamado        |
| `turnEnd_UNAUTHORIZED`        | Turno encerrado sem vscode_askQuestions                |
| `sessionEnd_compliance`       | Fim de sessão — resumo de conformidade                 |
| `authViolation_reset`         | Flag resetada manualmente                              |
| `askQuestions_response`       | Resposta de vscode_askQuestions capturada              |
| `sessionClose_key_validated`  | close_key encontrada na resposta — SESSION pode fechar |
| `sessionEnd_authorized_close` | SESSION encerrada com close_key validada               |
| `sessionEnd_no_key`           | SESSION encerrada sem close_key — flag criada          |

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
