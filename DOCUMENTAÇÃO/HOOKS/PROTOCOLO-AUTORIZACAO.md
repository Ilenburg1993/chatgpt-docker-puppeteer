# Protocolo de Autorização — Spec Completo

> **Status**: Canônico | **Última atualização**: 2026-03-10 | **Versão**: 5.0

> **v5.0 — TURN Autônomo**: TURNs encerram livremente. `vscode_askQuestions` é **recomendado**
> por TURN, mas **obrigatório** apenas para encerramento de SESSION (Template F + close_key) e
> operações git commit/push (Template G).

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

## Definição da Regra (v5.0 — TURN Autônomo)

> **TURNs encerram livremente.** Não há obrigação de `vscode_askQuestions` por TURN.
>
> **Obrigatório apenas para:**
> 1. Encerramento de **SESSION**: Template F + close_key `ENCERRAR-XXXXXXXX`
> 2. Operações de **git commit/push**: Template G (pré-autorização)

**Recomendado (boa prática):** chamar `vscode_askQuestions` após concluir tarefas,
a cada ~5 TURNs sem perguntar (nudge periódico), ao propor mudança arquitetural.

**Monitoramento informativo (sem bloqueio):**
- Turno sem `vscode_askQuestions` → `turnEnd_no_askQuestions` em `audit.jsonl`
- Turno com `vscode_askQuestions` → `turnEnd_authorized`
- Nudge via `systemMessage` a cada `HOOKS_TURN_NUDGE_INTERVAL` TURNs (padrão: 5)

---

## Implementação Técnica

### Layer 1 — Instrução no contexto primário

A regra está inscrita nos arquivos lidos no início de cada sessão:
- `.github/copilot-instructions.md` → seção `Protocolo de Comunicação` (TURN autônomo, SESSION obrigatório)
- `.github/AGENTS.md` → seção `Protocolo de encerramento por nível` (v5.0)
- `.github/instructions/hooks-protocol.instructions.md` → `applyTo: '**/*'`

### Layer 2 — Rastreamento por preToolUse

Quando `vscode_askQuestions` é chamado, o hook `pre-tool-use.sh` registra:
```json
{"current_turn": {"auth_requested": true, "auth_requested_at": "<ISO timestamp>"}}
```
em `state/session-context.json`.

### Layer 3 — Detecção por agentStop

A cada fim de turno, `agent-stop.sh` executa **4 estratégias de detecção** em cascata:

```
Estratégia 1 — Fronteira por userPromptSubmitted:
  ┌── Encontra linha L = última ocorrência de userPromptSubmitted em audit.jsonl
  ├── Verifica se existe preToolUse com tool_name=vscode_askQuestions
  │   OU subagentStart event após linha L
  └── Se sim → AUTH_REQUESTED = true

Estratégia 2 — Recência (fallback quando userPromptSubmitted ausente):
  ┌── userPromptSubmitted é raro: só dispara quando o Copilot recebe foco
  ├── Se LAST_PROMPT_LINE == 0: varre as últimas 150 linhas do audit.jsonl
  └── Se vscode_askQuestions OU subagentStart presente → AUTH_REQUESTED = true

Estratégia 3 — Contexto (último recurso):
  ┌── Lê current_turn.auth_requested no session-context.json
  └── Se true → AUTH_REQUESTED = true

Estratégia 4 — Delegação via subagente (Hardening v6):
  ┌── Lê current_turn.subagent_delegated no session-context.json
  ├── Setado por pre-tool-use.sh quando tool_name = runSubagent|Task
  ├── Se true → AUTH_REQUESTED = true
  └── Loga evento auth_via_subagent_delegation em audit.jsonl
```

> **Nota (v4.0)**: Estratégias 1 e 2 aceitam `subagentStart` como sinal alternativo a
> `vscode_askQuestions`. Isso resolve falsos UNAUTHORIZED quando o agente delega trabalho
> a um subagente sem ter chamado `vscode_askQuestions` antes.

### Layer 3.5 — ~~decision:block~~ (REMOVIDO — Fase 10, v5.0)

> **Este mecanismo foi removido em 2026-03-10 (Fase 10 — Modelo TURN Autônomo).**
>
> `decision:block` causava falsos positivos em cenários de subagência e sessões paralelas.
> Substituído por nudge informativo (`systemMessage`) a cada N TURNs sem `vscode_askQuestions`.
> Mantido aqui como registro histórico para rastreabilidade de auditorias antigas.

```
[HISTÓRICO] Fluxo decision:block (removido):
  ┌── AUTH_REQUESTED = false?
  │   ├── stop_hook_active = true?  → NÃO bloquear (anti-recursão)
  │   ├── block_count >= 1?         → NÃO bloquear (safety valve)
  │   └── Emitia: {"decision":"block","systemMessage":"..."}
  └── Removido: agente agora encerra livremente (TURN autônomo)
```

### Layer 3.7 — Delegação via subagente (Hardening v6)

Quando o agente invoca `runSubagent` ou `Task`, o hook `pre-tool-use.sh` detecta a chamada e:

1. Seta `current_turn.subagent_delegated = true` e `current_turn.auth_requested = true` no contexto
2. Incrementa `session_stats.subagent_calls`
3. Loga evento `subagentStart` no `audit.jsonl` (reconhecido como sinal de auth pelas Estratégias 1+2)

Ao fim do turno, `agent-stop.sh` detecta:
- O evento `subagentStart` via Estratégias 1 e 2 (busca em audit.jsonl), **OU**
- O flag `subagent_delegated = true` via Estratégia 4 (busca em contexto)

Qualquer um dos dois sinaliza autorização implícita e loga `auth_via_subagent_delegation`.

**Fundamento**: quando o agente delega substancialmente a um subagente, isso substitui de forma
legítima a chamada a `vscode_askQuestions`. A delegação é uma forma válida de encerrar o turno.

**Prevenção de abuso**: o mecanismo é auditado. Todas as delegações ficam registradas em
`audit.jsonl` com tipo `subagentStart` e `auth_via_subagent_delegation`, rastreáveis via
`generate-daily-report.sh`.

### Layer 3.8 — session_id guards (Hardening v5)

Todos os hooks que recebem payload com `session_id` validam contra o `session.id` do
`session-context.json`. Se houver mismatch:

- O evento é logado como `session_id_mismatch` no `audit.jsonl`
- O hook **PULA** qualquer modificação de estado (state write bloqueado)
- O hook encerra com `exit 0` (não bloqueia a extensão)

**Scripts com guard ativo** (6 de 8 hooks auto-triggered):
- `pre-tool-use.sh` — valida antes de gravar tool use
- `post-tool-use.sh` — valida antes de gravar resultado
- `agent-stop.sh` — valida antes de processar fim de turno
- `log-prompt.sh` — valida antes de resetar current_turn
- `error-occurred.sh` — valida antes de incrementar failures
- `subagent-stop.sh` — valida antes de incrementar subagent_calls

**Scripts sem guard (por design)**:
- `session-start.sh` — é o criador do session.id (cria o contexto)
- `session-end.sh` — encerramento é legítimo mesmo com session_id diferente

**Vetor de ataque mitigado**: testes inline ou prompts de outra sessão que sobrescreviam
`session-context.json` com dados de uma sessão diferente. Agora, qualquer payload com
`session_id` diferente do contexto ativo é ignorado silenciosamente (mas auditado).

### Layer 4 — Alerta na próxima sessão (informativo, v5.0)

Se um `UNAUTHORIZED_CLOSE.flag` residual (de sessões anteriores ao v5.0) ou um `SESSION_CLOSE_NO_KEY.flag`
for detectado, `session-start.sh` injeta aviso no `session-briefing.md`. Em v5.0, esse aviso é
**informativo** — não exige ação obrigatória do agente:

```
⚡ AVISO — SESSÃO ANTERIOR ENCERRADA SEM session-end.sh

A sessão anterior não registrou evento sessionEnd.
Iso ocorre quando o VS Code / Copilot é fechado abruptamente.

Sessão afetada: a0be08af-...
A close_key não pôde ser validada — encerramento não auditado.

Ação recomendada: verificar se havia trabalho pendente.
```

> **Obs.**: com o modelo TURN Autônomo (v5.0), o alerta de `UNAUTHORIZED_CLOSE` por TURN
> não é mais gerado por `agent-stop.sh`. O único mecanismo residual é o `SESSION_CLOSE_NO_KEY.flag`
> criado por `session-end.sh` quando a `close_key` não é fornecida.

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

**Ciclo de vida (v5.0)**:
- **Criado**: por `session-end.sh` como safety net se SESSION encerra sem `close_key` → [HISTÓRICO: em v4.x era criado por `agent-stop.sh` a cada TURN sem autorização]
- **Removido**: por `session-start.sh` se pertence a sessão diferente da atual (stale auto-cleanup)
- **Reset manual**: `bash reset-auth-violation.sh "motivo"`

> Em v5.0, `agent-stop.sh` **não cria** `UNAUTHORIZED_CLOSE.flag`. TURNs encerram livremente.
> O flag pode existir como artefato de sessões anteriores ao v5.0 (limpeza automática no `session-start.sh`).

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

| Evento                         | Quando ocorre                                                       |
| ------------------------------ | ------------------------------------------------------------------- |
| `turnEnd_authorized`           | Turno encerrado com vscode_askQuestions chamado                     |
| `turnEnd_no_askQuestions`      | Turno encerrado sem vscode_askQuestions (informativo, sem bloqueio) |
| `sessionEnd_compliance`        | Fim de sessão — resumo de conformidade                              |
| `authViolation_reset`          | Flag resetada manualmente                                           |
| `askQuestions_response`        | Resposta de vscode_askQuestions capturada                           |
| `sessionClose_key_validated`   | close_key encontrada na resposta — SESSION pode fechar              |
| `sessionEnd_authorized_close`  | SESSION encerrada com close_key validada                            |
| `sessionEnd_no_key`            | SESSION encerrada sem close_key — flag criada                       |
| `subagentStart`                | runSubagent/Task detectado em pre-tool-use.sh → auth implícita      |
| `auth_via_subagent_delegation` | Autorização concedida via subagent_delegated flag (Estratégia 4)    |

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

**Hardening v6** introduziu delegação automática: quando o agente invoca `runSubagent` ou `Task`,
`pre-tool-use.sh` seta `current_turn.subagent_delegated = true` e loga `subagentStart` em
`audit.jsonl`. O `agent-stop.sh` reconhece esse sinal como autorização implícita (Estratégias 1,
2 e 4), evitando falsos UNAUTHORIZED.

**Subagentes em si** (via `subagent-stop.sh`) não implementam o protocolo de autorização — são
processos temporários controlados pelo agente pai. A autorização é detectada no lado do pai via
os mecanismos acima.

### Sessões que terminam abruptamente

Quando o VS Code / Copilot é fechado sem chamar `session-end.sh`, a sessão encerra sem validar
a `close_key`. O próximo `session-start.sh` detecta o encerramento abrupto verificando se há
evento `sessionEnd` no `audit.jsonl` para a sessão anterior e exibe aviso no `session-briefing.md`.

> **Hardening v5.0**: `session-start.sh` detecta abrupt close via ausência de `sessionEnd`
> no audit para a sessão anterior, e injeta aviso `SESSION_ABRUPT_CLOSE` no briefing.

### Restart do container

`session-start.sh` recupera `session-context.json` existente (incluindo `consecutive_unauthorized_closes`).
O `UNAUTHORIZED_CLOSE.flag` persiste em disco — sobrevive a restarts.

---

*Para instruções ao agente, ver [.github/AGENTS.md](../../AGENTS.md) e [.github/copilot-instructions.md](../../copilot-instructions.md).*
