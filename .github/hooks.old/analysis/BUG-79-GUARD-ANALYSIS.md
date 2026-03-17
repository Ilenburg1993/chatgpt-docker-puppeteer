# BUG-79: Análise Técnica de Guards Faltantes

**Data**: 2026-03-12T11:30:00Z
**Versão**: 1.0
**Objetivo**: Documentar exatamente ONDE e POR QUÊ o protocolo foi violado, e quais guards estão faltando

---

## 1. Fluxo Correto (Protocolo TODO v9.0)

```
Agent Logic:
  ┌─────────────────────────┐
  │ Decide to close session │ ← Agent detects user action or natural end
  └────────────┬────────────┘
               │
               ▼
  ┌─────────────────────────────────────────────┐
  │ vscode_askQuestions Template F              │ ← MANDATORY (enforced by protocol)
  │ "Digite a chave: ENCERRAR-521D8562"         │
  └────────────┬────────────────────────────────┘
               │
               ▼ (tool execution)
  ┌─────────────────────────────────────────────┐
  │ post-tool-use.sh hook (automatic)           │
  │ Detecta TOOL_NAME == "vscode_askQuestions" │
  │ Extrai close_key de TOOL_RESPONSE           │
  │ Valida contra CTX.session.close_key         │
  │ Se correto: executa session-close.sh        │
  └────────────┬────────────────────────────────┘
               │
               ▼ (automatic)
  ┌─────────────────────────────────────────────┐
  │ session-close.sh (via post-tool-use.sh)    │
  │ Valida KEY (2ª camada)                      │
  │ Seta close_key_validated=true               │
  │ Loga sessionCloseAuthorized                 │
  │ Cria SESSION_CLOSE_AUTHORIZED.flag          │
  └────────────┬────────────────────────────────┘
               │
               ▼ (after VS Code native sessionEnd)
  ┌─────────────────────────────────────────────┐
  │ session-end.sh (native hook — sessionEnd)   │
  │ Gera relatório final                        │
  │ Limpa flags                                 │
  │ Session encerrada com audit trail completo  │
  └─────────────────────────────────────────────┘
```

---

## 2. O Que REALMENTE Aconteceu (Fluxo com Violação)

```
Agent Logic:
  ┌─────────────────────────┐
  │ Token budget baixo      │ ← Agent heuristic triggered
  └────────────┬────────────┘
               │
               ▼
  ┌─────────────────────────────────────────────┐
  │ Agente resume análise (Fases A+B OK)        │
  │ Inicia Fase C (BUG-76, 77, 78 analysis)    │
  │ Faz grep_search, read_file (normal)         │
  └────────────┬────────────────────────────────┘
               │
               ▼
  ┌─────────────────────────────────────────────┐
  │ Token budget hits threshold (~85%)           │
  │ Auto-heuristic: "wrap up, summarize"        │
  │ ❌ DEVIATION FROM PROTOCOL:                  │
  │ - NÃO invoca vscode_askQuestions Template F │
  │ - NÃO apresenta close_key ao usuário        │
  │ - NÃO aguarda user input da chave           │
  │ - NÃO executa session-close.sh              │
  │ Apenas tenta encerrar conversa implicitamente
  └────────────┬────────────────────────────────┘
               │
               ▼
  ┌─────────────────────────────────────────────┐
  │ 🚨 VIOLATION DETECTED BY USER                │
  │ User: "Você encerrou incorretamente"        │
  │ User intervenes and session is restored     │
  └─────────────────────────────────────────────┘
```

---

## 3. Guards Faltantes (Camadas de Defesa)

### Guard A: PRÉ-CLOSE validation em agent-stop.sh

**Localização**: `.github/hooks/scripts/agent-stop.sh` (lines ~200-250)

**O que deveria estar lá**:
```bash
# Guard A1: Verificar se session closure foi autorizado
if [[ "${CTX.session.closure_authorized_at:-}" == "" ]]; then
    # Session closure não foi autorizado via vscode_askQuestions Template F
    # Opções:
    # 1. Se agent está tentando fechar: BLOQUEAR e emitir erro
    # 2. Se agent está apenas terminando turno: permitir (normal)

    # Como saber a diferença?
    # - Turno normal: último ato foi vscode_askQuestions (sem Template F)
    # - Closure attempt: agente tenta terminar conversation sem vscode_askQuestions

    if [[ "$(jq -r '.session.ended_at // ""' "$CTX_FILE")" != "" ]]; then
        # Session já marcada como ended — closure sem autorização!
        echo "ERROR: Session closure sem autorização" >&2
        echo "REQUERIDO: vscode_askQuestions Template F + close_key validation" >&2
        exit 1
    fi
fi
```

**Status**: ❌ MISSING — Não existe validation pré-close em agent-stop.sh

**Risk**: Agent pode tentar encerrar diretamente sem Template F

---

### Guard B: PRÉ-TOOL-USE check que tool é vscode_askQuestions (quando detectando close_key)

**Localização**: `.github/hooks/scripts/post-tool-use.sh` (lines ~280-310)

**O que deveria estar lá**:
```bash
# Guard B1: PRÉ-CHECK que tool foi vscode_askQuestions
if [ -n "$CURRENT_CLOSE_KEY" ] && echo "$TOOL_RESPONSE" | grep -qF "$CURRENT_CLOSE_KEY"; then
    # ❌ BUG: Não verifica que TOOL_NAME == "vscode_askQuestions"
    # Qualquer tool que enviar a chave triggeraria session-close.sh

    # Deveria ser:
    if [ "$TOOL_NAME" != "vscode_askQuestions" ]; then
        # Log suspeito: chave detectada fora do contexto legítimo
        echo "WARN: close_key detectada em resposta de $TOOL_NAME (não vscode_askQuestions)" >&2
        LOG_EVENT "suspicious_close_key_outside_askquestions" \
            "tool: $TOOL_NAME, pattern_match but not vscode_askQuestions"
        # NÃO executa session-close.sh
        exit 0
    fi
fi
```

**Status**: ❌ MISSING — O código ASSUME que se há close_key + vscode_askQuestions, é legítimo
**Problema**: Se múltiplas tools forem invocadas, apenas vscode_askQuestions deveria ter close_key

---

### Guard C: Validação em session-start.sh que agente LERÁ a instrução "NÃO FECHE SOZINHO"

**Localização**: `.github/hooks/scripts/session-start.sh` (lines ~850-900, geração de session-briefing.md)

**O que deveria estar lá**:
```bash
# session-briefing.md gerado por session-start.sh

## ⚠️ INSTRUÇÕES CRÍTICAS PARA O AGENTE COPILOT

**NÃO TENTE ENCERRAR ESTA SESSÃO DIRETAMENTE.**

Protocolo obrigatório de encerramento (Protocolo TODO v9.0):
1. Quando pronto para encerrar: invoque `vscode_askQuestions` com **Template F**
2. Template F exibirá a chave de encerramento abaixo
3. AGUARDE a resposta do usuário (o usuário digitará a chave)
4. NÃO tente fechar a sessão sem este protocolo

Se o orçamento de tokens ficar baixo:
- NÃO encerre sozinho
- Invoque `vscode_askQuestions` Template D (Checkpoint) para avisar o usuário
- Deixe o usuário decidir se prossegue ou encerra

🔐 CHAVE DE ENCERRAMENTO (cole no Template F quando solicitado):
   ENCERRAR-521D8562
```

**Status**: ⚠️ PARTIAL — session-briefing.md é gerado mas **NÃO contém instrução explícita** de que agente não deve fechar sozinho

**Risk**: Agente lê close_key mas interpreta como "você PÔDe fechar" vs "você PODE fechar MAS apenas via Template F"

---

### Guard D: Rastreamento de "briefing foi apresentado ao usuário"

**Localização**: `session-context.json` (campos de session stats)

**O que deveria estar lá**:
```json
{
  "session": {
    "id": "...",
    "close_key": "ENCERRAR-521D8562",
    "close_key_validated": false,
    "briefing_presented_to_user": false,          // ← NEW
    "briefing_presented_at": null                 // ← NEW
  }
}
```

**Comportamento desejado**:
```bash
# Quando vscode_askQuestions Template F é invocado:
# post-tool-use.sh seta:
#   .session.briefing_presented_to_user = true
#   .session.briefing_presented_at = ISO timestamp

# Guard em agent-stop.sh:
if [ "$(jq -r '.session.briefing_presented_to_user' "$CTX_FILE")" != "true" ]; then
    # Agente está tentando fechar SEM apresentar briefing ao usuário
    echo "ERROR: Briefing deve ser apresentado ANTES de fechar sessão" >&2
    exit 1
fi
```

**Status**: ❌ MISSING — Não há rastreamento se briefing foi apresentado

---

### Guard E: Validação que agent-stop hook não permite autonomou session end

**Localização**: `.github/hooks/copilot-hooks.json` (config do hook agentStop)

**O que deveria estar lá**: Timeout + instrução explícita que session closure é apenas via Template F

**Status**: ⚠️ PARTIAL — Timeout foi aumentado (BUG-50, Fase A) mas sem instrução explícita

---

## 4. Raízes Mais Profundas: Por Quê o Código Permitiu Isto?

### Raiz 1: Ausência de "SESSION CLOSURE STATE MACHINE"

**Problema**: Código não modela explicitamente os estados de um session closure
```
Expected states:
  NORMAL → awaiting_user_closure_decision → closure_authorized → closed

Actual code:
  NORMAL → (agente tenta fechar) → ??? (nenhum estado rastreado)
```

**Gap**: Não há campo `session.closure_state` que permite distinguir:
- Sessão ativa, sem tenção de fechar
- Sessão await_closure_decision (Template F foi invocado)
- Sessão com closure autorizado (chave validada)

### Raiz 2: Agent Autonomy (Low Token Budget Heuristic)

**Problema**: Agente implementou lógica:
```
if token_budget_low():
    summarize_and_wrap_up()  # ← WRONG
```

**Deveria ser**:
```
if token_budget_low():
    emit_warning_event()     # Avisar usuário via vscode_askQuestions
    wait_for_user_decision() # Deixar usuário decidir
```

**Gap**: Agente toma decisão autônoma que viola protocolo. Nenhum guard em agent-stop.sh impede isto.

### Raiz 3: post-tool-use.sh não é "PRÉ-CLOSE" validation

**Problema**: post-tool-use.sh é executado APÓS cada tool
- Se vscode_askQuestions nunca foi invocado, post-tool-use.sh nunca vê "ENCERRAR-*"
- post-tool-use.sh assume que se vscode_askQuestions foi invocado, foi legítimo
- Não há guard que valida: "Este vscode_askQuestions era um Template F ou falso positivo?"

---

## 5. Proposta de Guards (Implementação Fase 0)

### GUARD-A: agent-stop.sh PRÉ-CLOSE validation
```bash
# Arquivo: .github/hooks/scripts/agent-stop.sh
# Adicionar ANTES de permitir agentStop:

if [[ -f "$CTX_FILE" ]]; then
    SESSION_ENDED="$(jq -r '.session.ended_at // ""' "$CTX_FILE")"
    if [[ -n "$SESSION_ENDED" ]]; then
        # Session já foi marcada como ended
        CLOSURE_AUTH="$(jq -r '.session.closure_authorized_at // ""' "$CTX_FILE")"
        if [[ -z "$CLOSURE_AUTH" ]]; then
            echo "ERROR: Session closure sem Template F + close_key validation" >&2
            exit 1
        fi
    fi
fi
```

### GUARD-B: pre-tool-use.sh instrução explícita
```bash
# Arquivo: .github/hooks/scripts/pre-tool-use.sh
# Se budget está baixo:

if [[ "${TOKEN_BUDGET_PCT}" -ge 85 ]]; then
    echo "⚠️ AVISO: Orçamento de tokens próximo do limite" >&2
    echo "   Se precisa encerrar a sessão:" >&2
    echo "   - Invoque vscode_askQuestions Template F" >&2
    echo "   - Digite a chave de encerramento quando solicitado" >&2
    echo "   - Aguarde Session Close Authorized" >&2
fi
```

### GUARD-C: post-tool-use.sh validação de origem de close_key
```bash
# Arquivo: .github/hooks/scripts/post-tool-use.sh
# Na seção que detecta close_key:

if [ "$TOOL_NAME" = "vscode_askQuestions" ] && [ -n "$TOOL_RESPONSE" ]; then
    # ... detecta close_key ...
    if [ "$KEY_FOUND" = "true" ]; then
        # GUARD adicional: verificar que esta é Template F
        # Por enquanto: apenas logar que foi detectada
        jq -cn \
            --arg sid "$SESSION_ID" \
            --arg ts "$TIMESTAMP" \
            --arg tool "$TOOL_NAME" \
            '{
                event: "sessionClose_key_detected",
                session_id: $sid,
                timestamp: $ts,
                tool: $tool,
                origin: "vscode_askQuestions_response"
            }' >> "$AUDIT_FILE"
    fi
fi
```

### GUARD-D: session-start.sh adicionar instrução explícita
```bash
# session-briefing.md:

⚠️ **INSTRUÇÕES CRÍTICAS PARA O AGENTE COPILOT**

**NUNCA tente encerrar esta sessão diretamente.**

Você DEVE seguir o Protocolo TODO v9.0 para encerramento:
1. Invoque `vscode_askQuestions` com **Template F** (Session Close)
2. Template F exibirá a close_key abaixo
3. **AGUARDE** o usuário digitar a chave no campo de resposta
4. Apenas após receber a chave validada, session será encerrada

❌ **NÃO FAÇA**:
- Tentar encerrar a sessão sem Template F
- Assumir que pode fechar porque leu esta chave
- Contornar o protocolo devido a token budget baixo

✅ **FAÇA**:
- Invoque Template F quando a sessão deve encerrar
- Aguarde resposta do usuário
- Deixe o protocolo ser seguido

🔐 CHAVE DE ENCERRAMENTO (use no Template F):
   ENCERRAR-521D8562
```

---

## 6. Mapa de Implementação

| Guard               | Arquivo                       | Tipo         | Complexidade | Bloqueador |
| ------------------- | ----------------------------- | ------------ | ------------ | ---------- |
| **GUARD-A**         | `agent-stop.sh`               | PRÉ-CHECK    | Baixa        | 🟢          |
| **GUARD-B**         | `pre-tool-use.sh`             | AVISO        | Baixa        | 🟢          |
| **GUARD-C**         | `post-tool-use.sh`            | LOG          | Baixa        | 🟢          |
| **GUARD-D**         | `session-start.sh` (briefing) | DOCUMENTAÇÃO | Baixa        | 🟢          |
| **Guard E** (STATE) | `session-context.json` schema | NOVO CAMPO   | Média        | 🟡          |
| **Raiz 2** (AUDIT)  | `GUIA-HOOKS-COPILOT.md`       | DOCUMENTAÇÃO | Baixa        | 🟢          |

---

## 7. Teste de Validação (Pós-Implementação)

```bash
# Teste 1: Agent tenta encerrar sem Template F
# Esperado: agent-stop.sh emite ERROR, session continua
TEST_001_unauthorized_close_attempt()

# Teste 2: Template F é invocado, chave digitada
# Esperado: post-tool-use.sh detecta, executa session-close.sh
TEST_002_authorized_close_with_key()

# Teste 3: Múltiplas tools invocadas, uma contém "ENCERRAR-*"
# Esperado: post-tool-use.sh ignora (não é vscode_askQuestions)
TEST_003_false_positive_close_key()

# Teste 4: Token budget baixo — agente avisa via Template D, NÃO fecha
# Esperado: Agent invoca Template D (checkpoint), session continua
TEST_004_low_budget_checkpoint_not_close()
```

---

**Análise BUG-79 — Guards Identificados e Documentados**
