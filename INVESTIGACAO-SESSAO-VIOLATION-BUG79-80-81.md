# Investigação: Violação de Protocolo BUG-79/80/81

**Data**: 2026-03-12 **Contexto**: Rastreamento de encerramento não-autorizado em sessões
**Status**: Em investigação

---

## 📋 Resumo Executivo

Há uma **contradição crítica** no sistema de rastreamento de sessão:

- **Session dcf579af**: Diz `close_key_validated: true` na session-context
- **Audit dcf579af**: Mostra **12 askQuestions_response, TODAS com `close_key_found: false`**
- **Conclusão**: A sessão foi marcada como "autorizada a fechar" sem que o usuário fornecesse a
  close_key via Template F

---

## 🔍 Cronologia de Session IDs

| Session ID   | Tipo     | Início                      | Fim         | Status                        | Notas                                                              |
| ------------ | -------- | --------------------------- | ----------- | ----------------------------- | ------------------------------------------------------------------ |
| **a0be08af** | Original | 2026-03-09                  | ?           | ❌ Non-auth close             | Causadora da violação inicial BUG-79                               |
| **dcf579af** | Recovery | 2026-03-12 11:01:14Z        | ?           | ✅ close_key_validated        | Supostamente autorizada, MAS sem evidência na audit                |
| **c516b172** | Rollover | 2026-03-12 09:12:53Z(!\*\*) | Ativa agora | ❌ close_key_validated: false | Chronology error: precedeu dcf579af mas aparentemente é "anterior" |

**⚠️ PROBLEMA CRONOLÓGICO**: c516b172 começou em 09:12:53Z mas dcf579af começou em 11:01:14Z. Porém
dcf579af é descrita como "auto_recovery" DE c516b172. Isso é confuso.

---

## 📊 Análise de Audit Files

### audit-dcf579af.jsonl

```
Total linhas: 1047
Primeiro evento: 2026-03-12T11:51:17.938Z (postToolUse)
Último evento:   2026-03-12T20:48:53.851Z (preToolUse)

askQuestions_response count: 12
  ✅ close_key_found: true  → 0
  ❌ close_key_found: false → 12

Eventos sessionEnd/sessionClose: 0 (nenhum)
```

### session-context-dcf579af.json

```json
{
  "session": {
    "id": "dcf579af-502e-4bf2-9d92-75903f85b0a2",
    "started_at": "2026-03-12T11:01:14Z",
    "ended_at": null,
    "close_key_validated": true,    ← ⚠️ CONTRADITÓRIO!
    "source": "auto_recovery"
  },
  "session_stats": {
    "turn_count": 3,
    "tools_total": 578,
    "turn_authorized": 3,
    "turn_unauthorized": 0
  }
}
```

### session-context-cd593a12.json (c516b172)

```json
{
  "session": {
    "id": "c516b172-d79b-4b05-bf1e-ebce4a5b2520",
    "started_at": "2026-03-12T09:12:53Z",   ← 2 HORAS ANTES!
    "reconnect_at": "2026-03-12T11:20:44Z",  ← reconecta DURANTE dcf579af
    "prev_session_id": "dcf579af-502e-4bf2-9d92-75903f85b0a2",
    "close_key_validated": false,   ← Ainda ativa, não autorizada
    "source": "reconnect_rollover"
  },
  "session_stats": {
    "turn_count": 0,        ← ⚠️ turn_count = 0
    "turn_authorized": 8,   ← Mas turn_authorized = 8!
    "tools_total": 1434
  }
}
```

**CONTRADIÇÃO CRONOLÓGICA**:

- c516b172 começou ANTES (09:12:53Z)
- dcf579af descrita como "auto_recovery" DE c516b172
- Mas dcf579af começou DEPOIS (11:01:14Z)
- E c516b172 "reconnect_at" DURANTE dcf579af (11:20:44Z)

---

## 🧩 Cenários Possíveis

### Cenário A: session-context está CORRETO, audit está ERRADO

- dcf579af realmente teve close_key validada "offline" (outside vscode_askQuestions)
- Mas o audit não registrou o evento (bug no logging)
- **Implicação**: Há um pathway de session-close.sh que NÃO escreve evento sessionEnd

### Cenário B: session-context está ERRADO, audit está CORRETO

- dcf579af NUNCA recebeu close_key do usuário (12x close_key_found: false)
- MAS foi marcada como "close_key_validated: true" incorretamente
- **Implicação**: A lógica de validação tem um bug que marca TRUE sem evidência

### Cenário C: Ambos estão PARCIALMENTE CORRETOS

- Um dos dois arquivos é stale (desatualizado)
- c516b172 "reconnect_at" durante dcf579af confundiu as sesões
- **Implicação**: Sistema de reconnect está quebrado

---

## 🚨 Problemas Identificados

### BUG-79 (Confirmado) — Unauthorized Session Close

- **Sintoma**: Sessão anterior encerrou sem vscode_askQuestions Template F
- **Evidence**: UNAUTHORIZED_CLOSE.flag foi criada em briefing anterior
- **Status**: PARCIALMENTE RESOLVIDO (session-context diz close_key_validated: true para dcf579af)

### BUG-80 (Novo) — Session Context Contradiction

- **Sintoma**: close_key_validated: true SEM close_key_found: true na audit
- **Root Cause**: TBD — pode ser (A), (B) ou (C) acima
- **Impact**: Impossível determinar se session foi realmente autorizada
- **Severity**: CRÍTICO — quebra o mecanismo de autorização

### BUG-81 (Inferido) — turn_count = 0 vs turn_authorized = 8

- **Symptom**: session-context-cd593a12.json (c516b172) mostra:
  - `turn_count: 0` (nenhum turno completado?)
  - `turn_authorized: 8` (8 turnos autorizados?)
- **Inconsistency**: Não faz sentido ter turn_authorized > turn_count
- **Severity**: ALTO — corrupted session metadata

### BUG-82 (Inferido) — Chronological Impossibility

- **Symptom**: c516b172 started 09:12:53Z, dcf579af started 11:01:14Z
  - dcf579af described as "auto_recovery" OF c516b172
  - c516b172 "reconnect_at" 11:20:44Z (AFTER dcf579af started)
- **Implication**: Session recovery logic is broken or sessions were confused
- **Severity**: ALTO — fundamental timing issue

---

## 📋 Checklist de Investigação

- [ ] Ler todos os bits relevantes de session-close.sh para entender como close_key_validated é
      definida
- [ ] Procurar por eventos "session-close.sh" ou "session-end.sh" executados para dcf579af
- [ ] Comparar timestamps de audit-dcf579af.jsonl com git log para correlacionar commits
- [ ] Revisar post-tool-use.sh para ver como detecta close_key_found
- [ ] Checar se há um mecanismo de "offline close" que não escreve eventos audit
- [ ] Validar lógica no session-start.sh que cria session-context.json

---

## 🔧 Hardenings Propostos

Para evitar futuração similar:

### Guard B — Enforce All Questions via vscode_askQuestions

```bash
# PRÉ-COMMIT: Se response contém "?" sem vscode_askQuestions → erro
grep '\?' response.txt && ! grep 'vscode_askQuestions' tools_called.log → VIOLATION
```

### Guard C — Detect "Completion Heuristic" Activation

```bash
# PRÉ-COMMIT: Se response contém padrão "✅ TODO X completo" → require vscode_askQuestions
grep '✅.*TODO.*[Cc]ompleto' response.txt → MUST have vscode_askQuestions after
```

### Guard E — Token Budget Monitoring

```bash
# A cada 5 turnos: verifique remaining_tokens
# Se < 30%: dispare /compact command automático
# Se < 10%: force vscode_askQuestions Template D + pause
```

---

## 📍 Próximos Passos

1. **CRÍTICO**: Replicar a sessão dcf579af para entender como foi encerrada
2. **CRÍTICO**: Validar se close_key_validated está sendo set corretamente
3. **ALTO**: Corrigir turn_count vs turn_authorized em c516b172
4. **ALTO**: Resolver chronological impossibility entre c516b172 e dcf579af
5. **MÉDIO**: Implementar Guards B, C, E para futuro

---

_Investigação iniciada: 2026-03-12T21:00:00Z_ _Status: BLOQUEADO até resolução de contradições_
