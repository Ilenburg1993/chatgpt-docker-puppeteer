# 🔐 Investigação: Session Lifecycle Hardening

**Data**: 2026-03-14 **Sessão**: dcf579af-502e-4bf2-9d92-75903f85b0a2 (Recovery #2) **Status**: ✅
Investigação Completa + Propostas Detalhadas

---

## 1. Pergunta Central do Usuário

> "Sempre que o Copilot inicia um processo de encerramento, o sistema de hooks chama AUTOMATICAMENTE
> o sessionEnd, certo? Se a resposta é sim, não seria possível nós incluirmos no script session-end
> alguma lógica para bloquear o processo de encerramento caso todas as condições não sejam
> satisfeitas?"

---

## 2. Resposta Baseada em Documentação Oficial

### 2.1 Descoberta Crítica: sessionEnd Output é IGNORADO

**Fonte**:
[GitHub Docs - Hooks Configuration](https://docs.github.com/en/copilot/reference/hooks-configuration)

```
### Session end hook

Executed when the agent session completes or is terminated.

Input JSON:
{
  "timestamp": 1704618000000,
  "cwd": "/path/to/project",
  "reason": "complete"  // One of: "complete", "error", "abort", "timeout", "user_exit"
}

Output: **Ignored** ← ⚠️ CRUCIAL
```

### 2.2 Implicações Diretas

| Aspecto                           | Realidade                                                           |
| --------------------------------- | ------------------------------------------------------------------- |
| **sessionEnd é automático?**      | ✅ SIM — Copilot dispara automaticamente quando sessão encerra      |
| **Pode bloquear o encerramento?** | ❌ NÃO — Output é completamente ignorado (não há `decision:block`!) |
| **Por que ignorado?**             | sessionEnd é um hook **pós-evento** (cleanup), não pré-aprovação    |
| **Fluxo esperado**                | sessionEnd → cleanup/logging APENAS (session já está encerrando)    |

---

## 3. Análise de Nossa Implementação Local

### 3.1 Atual: `session-end.sh` (61+ linhas)

**Propósito**: Cleanup e logging quando sessão encerra

**Fluxo atual**:

```
sessionEnd hook dispara (automático)
    ↓
session-end.sh executa:
  1. Checkpoint final (B5)
  2. Resolve session_id (HEAL v1)
  3. Atualiza session_context.json
  4. Gera relatório final (session-summary.txt)
  5. Arquiva logs em DOCUMENTAÇÃO/RELATORIOS/SESSIONS/
```

**Gap Identificado**:

- session-end.sh NÃO tem mecanismo para **bloquear** o encerramento
- Mesmo que quiséssemos, output de sessionEnd é ignorado
- O script roda DEPOIS que a sessão já iniciou seu término

### 3.2 Questão Filosófica Implícita

Quando o usuário pergunta "não seria possível bloquear o processo de encerramento", está
implicitamente perguntando:

> "Como podemos impedir que uma sessão termine sem passar pelo protocolo de autorização?"

**Resposta**: Não via `sessionEnd` hook, MAS há **outras abordagens mais eficazes**:

1. **Defesa em camadas**: Bloquear ANTES que o agente iniciar o encerramento
2. **Detecção de anomalia**: Identificar encerramento não autorizado NO COMEÇO (sessionStart
   recovery)
3. **Força de autorização**: Exigir `vscode_askQuestions` Template F OBRIGATORIAMENTE antes de
   qualquer ação terminal

---

## 4. Hardenings Propostos (5 níveis)

### Nível 1: DETECT — Anomaly Detection (sessionStart)

**Objetivo**: Identificar quando última sessão encerrou sem autorização

**Implementação**: Expandir `session-start.sh` com detecção de gaps

```bash
# session-start.sh — Nova lógica de recovery (pseudocódigo)

# Verifica previous session_context
PREV_CLOSE_MODE="$(jq -r '.session.close_mode // "unknown"' PREV_CTX_FILE)"

case "$PREV_CLOSE_MODE" in
  authorized_close)
    # OK: encerramento legítimo
    jq '.session.prev_close_mode = "recovered_authorized"' NEW_CTX_FILE
    ;;
  key_rejected)
    # ALERT: usuário tentou encerrar com KEY inválida
    # Log BUG-ALERT e continue (recuperação automática)
    jq '.session.alerts += ["previous_session_key_rejected"]' NEW_CTX_FILE
    ;;
  missing_authorization)
    # CRITICAL: encerramento SEM key at all
    # Log BUG-CRITICAL e continue (defesa fallback)
    jq '.session.alerts += ["previous_session_closed_no_key"]' NEW_CTX_FILE
    ;;
  abrupt/** | timeout/*)
    # ERROR: crash/timeout durante lasturn
    jq '.session.alerts += ["previous_session_abrupt_termination"]' NEW_CTX_FILE
    ;;
esac

# Se há alertas no recovery, exigir vscode_askQuestions Template E (Session Kickoff)
if jq -e '.session.alerts and (.session.alerts | length > 0)' NEW_CTX_FILE > /dev/null; then
  # Sinalizamsg para agent-startup: deve invocar Template E antes de trabalho
  jq '.session.recovery_alerts_require_kickoff = true' NEW_CTX_FILE
fi
```

**Resultado**: Agent começa nova sessão CONSCIENTE de que anterior falhou

---

### Nível 2: ENFORCE — Pre-termination Guard (preToolUse)

**Objetivo**: Bloquear qualquer ação que **poderia levar a encerramento** sem autorização

**Padrão**: Bloquear `git push` (mais comum trigger de session-close) sem Template F assinado

```bash
# preToolUse hook — Git Push Guard (NOVO)

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName')

if [ "$TOOL_NAME" != "bash" ]; then
  exit 0 # Allow non-bash tools
fi

COMMAND=$(echo "$INPUT" | jq -r '.toolArgs.command')

# Detecta padrões de "final push" que precedem Session Close
if echo "$COMMAND" | grep -qE "^git push"; then
  # Verifica se última ação foi vscode_askQuestions Template F (close key request)
  LAST_TOOL="$(jq -r '.current_turn.last_tool_name // ""' "$CTX_FILE")"
  LAST_RESPONSE="$(jq -r '.current_turn.last_askquestions_response // ""' "$CTX_FILE")"

  # Se não foi Template F, BLOQUEIA
  if [ "$LAST_TOOL" != "vscode_askQuestions" ] || ! echo "$LAST_RESPONSE" | grep -q "close_key_found=true"; then
    echo '{
      "permissionDecision": "deny",
      "permissionDecisionReason": "Git push precedendo session closure requer Template F (Session Close) com valid close key. Use vscode_askQuestions Template F primeiro."
    }' >&1
    exit 0
  fi
fi
```

**Resultado**: Qualquer intento de git push final será bloqueado a menos que Template F tenha sido
invocado corretamente

---

### Nível 3: MANDATE — Mandatory vscode_askQuestions Before Agent Stop

**Objetivo**: Força agente a invocar `vscode_askQuestions` Template F ANTES que agentStop seja
executado

**Implementação**: Expandir `agent-stop.sh` com validação adicional

```bash
# agent-stop.sh — Novo gate (pseudocódigo)

# GATE-CLOSE-AUTH: Verifica se há pendência de Session Close
PREV_CLOSE_PENDING="$(jq -r '.session.close_pending // false' "$CTX_FILE")"
CLOSE_KEY_VALIDATED="$(jq -r '.session.close_key_validated // false' "$CTX_FILE")"

# Se há indicação de que agent está terminando e close_key_validated = false
if [ "$PREV_CLOSE_PENDING" = "true" ] && [ "$CLOSE_KEY_VALIDATED" = "false" ]; then
  # BLOQUEIO: agent DEVE invocar Template F antes de poder parar
  LOG_DECISION_BLOCKED "agent_stop_close_key_required" \
    "Agent está terminando sua SESSION mas close_key_validated=false. Deve invocar Template F primeiro."

  # Força systemMessage para recordar Template F
  jq '.session.system_reminder_close_key = true' "$CTX_FILE" | sponge "$CTX_FILE"

  # Exit com decision:block
  exit 1
fi
```

---

### Nível 4: Refactor session-end.sh para VALIDATE Antes de Commit Final

**Objetivo**: Mesmo que output seja ignorado, session-end.sh pode VALIDAR state e logar
discrepâncias

```bash
# session-end.sh — Validação pré-encerramento (NOVO)

# Extrai motivo do encerramento
REASON="$(echo "$INPUT" | jq -r '.reason')"

# Se reason != "complete", significa abort/error/timeout
# Nestes casos, checar configuração de close_key_validated
if [ "$REASON" != "complete" ]; then
  CLOSE_KEY_VALIDATED="$(jq -r '.session.close_key_validated // false' "$CTX_FILE")"

  if [ "$CLOSE_KEY_VALIDATED" = "false" ]; then
    # Session foi encerrada de forma NÃO AUTORIZADA
    jq -cn \
      --arg reason "$REASON" \
      --arg msg "Session ended with reason=$reason but close_key_validated=false — ANOMALY DETECTED" \
      '{
        event: "sessionEnd_unauthorized_termination_detected",
        session_id: $SESSION_ID,
        timestamp: $NOW_MS,
        reason: $reason,
        close_key_validated: false,
        severity: "CRITICAL",
        message: $msg
      }' >> "$AUDIT_FILE"

    # Mark flag para sessionStart recovery loop
    jq '.session.close_mode = "abrupt_no_auth"' "$CTX_FILE" | sponge "$CTX_FILE"
  fi
fi
```

---

### Nível 5: Dashboard Indicator + Alerting

**Objetivo**: UI visual de "CLOSE_KEY_REQUIRED" status

```javascript
// src/server/realtime/session-monitor.js (NOVO)

// Monitora em tempo real se close_key_validated = false mas session parece estar encerrando
if (sessionStatus.reason === 'user_exit' && !sessionStatus.close_key_validated) {
  // Envia alerta em realtime para dashboard
  io.emit('session:unauthorized_termination_risk', {
    sessionId: sessionStatus.session_id,
    message: '⚠️ Session está encerrando SEM autorização. Aplique close key AGORA.',
    severity: 'CRITICAL',
  });
}
```

---

## 5. Mapa de Implementação (Fases)

### ✅ Já Implementado

- BUG-80 fix: post-tool-use.sh validação de close_key ANTES de setar flag (✅ DONE)

### 🟡 Fase 1: Detecção de Anomalias (Nível 1)

**Arquivo**: `session-start.sh` **Escopo**: Adicionar `recovery_alerts_require_kickoff` logic
**Tempo estimado**: 30 min **Risco**: BAIXO (apenas adição de flags, sem change de fluxo)

### 🟡 Fase 2: Pre-termination Guard (Nível 2)

**Arquivo**: `preToolUse` hook (novo) **Escopo**: Bloquear git push sem Template F **Tempo
estimado**: 45 min **Risco**: MÉDIO (pode ser muito restritivo, validar com casos reais)

### 🟡 Fase 3: Mandatory vscode_askQuestions (Nível 3)

**Arquivo**: `agent-stop.sh` **Escopo**: CLOSE_KEY gate antes de agent parar **Tempo estimado**: 1
hora **Risco**: MÉDIO-ALTO (pode criar loops infinitos, precisa cuidado)

### 🟡 Fase 4: Terminal State Validation (Nível 4)

**Arquivo**: `session-end.sh` **Escopo**: Validação de anomalias + BUG-CRITICAL logs **Tempo
estimado**: 30 min **Risco**: BAIXO (logging apenas, sem change de behavior)

### 🟡 Fase 5: UI/Alerting (Nível 5)

**Arquivo**: `src/server/realtime/session-monitor.js` **Escopo**: Dashboard indicators **Tempo
estimado**: 1 hora **Risco**: BAIXO (cosmetic, não afeta fluxo)

---

## 6. Descobertas Adicionais (Relacionadas a Hardenings)

### 6.1 BUG-81: Detecção de Direct Questions (SEM vscode_askQuestions)

**Status**: Identificado **Problema**: Agent pode fazer perguntas no texto da resposta sem usar
`vscode_askQuestions` **Solução**: Adicionar regex check em `post-tool-use.sh`

```bash
# post-tool-use.sh — Novo gate (pseudocódigo)

RESPONSE_TEXT="$(echo "$INPUT" | jq -r '.current_turn.last_response_text // ""')"

# Se response contém "?", deve haver correspondente vscode_askQuestions event
if echo "$RESPONSE_TEXT" | grep -q '?'; then
  # Check se último event foi vscode_askQuestions
  LAST_TOOL="$(jq -r '.current_turn.last_tool_name' "$CTX_FILE")"

  if [ "$LAST_TOOL" != "vscode_askQuestions" ]; then
    # LOG WARNING: direct question detected
    jq -cn '{event: "direct_question_detected", ...}' >> "$AUDIT_FILE"
  fi
fi
```

---

### 6.2 BUG-82: Context Compaction (/compact command)

**Status**: Não implementado **Problema**: Audit logs crescem indefinidamente **Solução**:
Implementar `/compact` command + token budget monitoring

```bash
# Novo command em agentStop: /compact

# Analisa tamanho do audit.jsonl
AUDIT_SIZE=$(wc -c < "$AUDIT_FILE")
TOKENS_ESTIMATE=$((AUDIT_SIZE / 4)) # Rough estimate

if [ $TOKENS_ESTIMATE -gt 100000 ]; then # 70% threshold
  # Trigger compaction
  # Opção 1: Compress eventos old com summary
  # Opção 2: Archive e rotate para novo arquivo
  # Opção 3: Enviar para storage externo
fi
```

---

### 6.3 BUG-83: False Confidence na session-start.sh

**Descoberta**: `session-start.sh` sempre reseta `close_key_validated=false`, mas se última sessão
terminou abruptamente, isso não é suficiente

**Proposta**: Após reset, TAMBÉM verificar se há `SESSION_CLOSE_NO_KEY.flag` deixado pela sessão
anterior

```bash
# session-start.sh — Novo check

if [ -f ".github/hooks/state/SESSION_CLOSE_NO_KEY.flag" ]; then
  # Last session closed without close key — ALERT
  jq '.session.alerts += ["previous_session_no_key_validation"]' "$CTX_FILE"

  # Opção: Limpar o flag ou manter para investigação?
  # Recomendação: MANTER até que user confirme via new vscode_askQuestions
fi
```

---

## 7. Roadmap Resumido (Próx. 3 Turnos)

| Turno     | Deliverable                                                    | Status     |
| --------- | -------------------------------------------------------------- | ---------- |
| **Atual** | BUG-80 fix (post-tool-use.sh) + Investigação Session Lifecycle | ✅ DONE    |
| **T+1**   | Implementar Níveis 1-2 Hardening + BUG-81 guard                | 🟡 PLANNED |
| **T+2**   | Implementar Níveis 3-4 + BUG-82 compact                        | 🟡 PLANNED |
| **T+3**   | Implementar Nível 5 + Testes Integrados                        | 🟡 PLANNED |

---

## 8. Conclusão

**Resposta à pergunta do usuário**:

> ✅ **Verdade parcial**: `sessionEnd` É chamado automaticamente, MAS seu output É ignorado pelo
> Copilot, então NÃO é possível bloquear diretamente via sessionEnd.
>
> ✅ **Mas há alternativas**: Usar preToolUse (bloqueia ações), agentStop (força
> vscode_askQuestions), e sessionStart recovery (detecta anomalias). Estas SÃO eficazes.
>
> ✅ **Recomendação**: Implementar os 5 níveis de hardening de forma progressiva. Os 3-4 primeiros
> resolvem a maioria dos cenários. Nível 5 é cosmético.

---

**Prepared by**: CI Agent (dcf579af session recovery) **Next**: Await user confirmation to proceed
with Phase 1 implementation
