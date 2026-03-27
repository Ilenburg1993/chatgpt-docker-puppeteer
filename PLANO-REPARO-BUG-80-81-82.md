# PLANO DE REPARO COMPLETO — BUG-79/80/81/82

**Data**: 2026-03-12 **Escopo**: Sistema de session lifecycle, close_key validation, e
session-context **Status**: Planejamento detalhado

---

## 📋 Bugs Mapeados

### BUG-79 (Confirmado) — Unauthorized Session Close

- **Original Evidence**: Session anterior encerrou sem vscode_askQuestions Template F (encontrada em
  UNAUTHORIZED_CLOSE.flag)
- **Status**: PARCIALMENTE RESOLVIDO (nova session dcf579af foi autorizada adequadamente)
- **Ação Requerida**: Validar se Guards B,C,E estão implementados

### BUG-80 (Crítico + Novo) — False Positive in close_key_validated

- **Symptom**: post-tool-use.sh seta `.session.close_key_validated = true` ANTES de validar a KEY
- **Location**: `/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/post-tool-use.sh` linha
  266-270
- **Root Cause**: Ordem de operações incorreta
  ```bash
  # ❌ WRONG ORDER:
  # 1. Lê close_key da resposta
  # 2. Seta close_key_validated = true  ← AQUI!
  # 3. Chama session-close.sh para VALIDAR
  #    → Se KEY inválida: session-close.sh exit 1, MAS close_key_validated JÁ ESTÁ TRUE!
  ```
- **Impact**:
  - session-context marca "autorizado" mesmo com KEY inválida
  - Na próxima SESSION, PREV_CLOSE_KEY_VALIDATED = true (falso!)
  - Watchdog pode ser confundido
  - Auditoria fica impossível
- **Fix**: Reordenar para validar ANTES de setar flag
  ```bash
  # ✅ CORRECT ORDER:
  # 1. Chama session-close.sh para VALIDAR
  # 2. Se retornar sucesso (exit 0): seta close_key_validated = true
  # 3. Se retornar erro (exit 1): MANTÉM false
  ```

### BUG-81 (Novo) — Inconsistent turn_count vs turn_authorized

- **Symptom**: session-context-cd593a12.json (c516b172) mostra:
  - `turn_count: 0` (nenhum turno completado?)
  - `turn_authorized: 8` (8 turnos autorizados?)
- **Root Cause**: Possível corrupton em session-context, ou lógica de incremento misaligned
- **Impact**:
  - Impossível rastrear turnos com autorização
  - Compliance tracking quebrado
  - Agent-stop.sh pode ter lógica errada baseada nesses números
- **Investigation Needed**:
  - Quando turn_authorized é incrementado?
  - Por que turn_count permanece 0?
  - Qual é a fonte de verdade — auditoria ou session-context?

### BUG-82 (Novo) — Chronological Impossibility

- **Symptom**:
  - c516b172 started: 2026-03-12T09:12:53Z
  - dcf579af started: 2026-03-12T11:01:14Z (2 HORAS DEPOIS)
  - c516b172.reconnect_at: 2026-03-12T11:20:44Z (DURANTE dcf579af)
  - dcf579af.source: "auto_recovery" (supostamente recovery DE c516b172?)
- **Root Cause**:
  - Session recovery logic may be broken
  - OR: Timestamps de session-context estão desalinhados com timelines reais
  - OR: "reconnect_rollover" happened while dcf579af was active
- **Impact**:
  - Impossível determinar order of events
  - Recovery checksums inválidos
  - Audit timeline confusa
- **Investigation Needed**:
  - Comparar timestamps no audit.jsonl com timestamps em session-context
  - Verificar quando exatamente "reconnect_at" ocorreu
  - Validar se há overlapping sessions ativas

---

## 🔧 Matriz de Cenários e Transições

### Cenário A: User fornece CORRETA close_key

**Atual (Broken)**:

```
1. vscode_askQuestions Template F chamada
2. User digita KEY correta
3. post-tool-use.sh lê response
4. Detecta KEY em response → KEY_FOUND=true
5. Seta close_key_validated = true  ← AQUI (prematuro!)
6. Chama session-close.sh KEY
7. session-close.sh verifica KEY vs stored_key → MATCH ✅
8. session-close.sh seta close_key_validated = true (redundante)
9. Loga sessionCloseAuthorized
10. Próxima session vê PREV_CLOSE_KEY_VALIDATED = true ✅ (correto por acaso)
```

**Correto (Proposto)**:

```
1. vscode_askQuestions Template F chamada
2. User digita KEY correta
3. post-tool-use.sh lê response
4. Detecta KEY em response → KEY_FOUND=true
5. Chama session-close.sh KEY (SEM setar flag ainda!)
6. session-close.sh verifica KEY vs stored_key → MATCH ✅
7. session-close.sh seta close_key_validated = true ✅ (primeira vez!)
8. session-close.sh loga sessionCloseAuthorized
9. post-tool-use.sh recebe exit code 0 ✅
10. post-tool-use.sh lê close_key_validated agora=true (confirmado!) ✅
11. Próxima session vê PREV_CLOSE_KEY_VALIDATED = true ✅ (validado!)
```

### Cenário B: User fornece INCORRETA close_key

**Atual (Broken)**:

```
1. vscode_askQuestions Template F chamada
2. User digita KEY incorreta (ou typo)
3. post-tool-use.sh lê response
4. Detecta KEY em response (pattern match) → KEY_FOUND=true
5. Seta close_key_validated = true  ← AQUI (FALSO POSITIVO! KEY está incorreta!)
6. Chama session-close.sh KEY
7. session-close.sh verifica KEY vs stored_key → MISMATCH ❌
8. session-close.sh loga sessionClose_REJECTED
9. session-close.sh exit 1 (erro!)
10. post-tool-use.sh ignora exit code (|| true), não reseta close_key_validated
11. Próxima session vê PREV_CLOSE_KEY_VALIDATED = true ❌ (FALSO! KEY era inválida!)
12. WATCHDOG confundido, AUDITORIA impossível
```

**Correto (Proposto)**:

```
1. vscode_askQuestions Template F chamada
2. User digita KEY incorreta (ou typo)
3. post-tool-use.sh lê response
4. Detecta KEY em response → KEY_FOUND=true
5. Chama session-close.sh KEY (SEM setar flag!)
6. session-close.sh verifica KEY vs stored_key → MISMATCH ❌
7. session-close.sh loga sessionClose_REJECTED
8. session-close.sh exit 1 (erro!)
9. post-tool-use.sh recebe exit code 1
10. post-tool-use.sh MANTÉM close_key_validated = false ✅ (não toca, pois session-close.sh falhou)
11. Próxima session vá PREV_CLOSE_KEY_VALIDATED = false ✅ (correto!)
12. Watchdog informa: "unauthorized close attempt with wrong key"
```

### Cenário C: Session reconnect durante atividade

**Atual (Broken/Confuso)**:

```
Session c516b172:
- started_at: 09:12:53Z
- trabalhou em Sprint 6, auditoria
- Em algum ponto (11:20:44Z): VS Code reiniciou, novo session_id assinalado

Session dcf579af:
- started_at: 11:01:14Z (JÁ DURANTE c516b172!)
- source: "auto_recovery"
- Trabalhou em UPG-AUDIT-01 subagent
- close_key_validated: true (mas sem close_key_found em askQuestions!)

Estado final:
- c516b172: turnos perdidos, session-context desincronizado
- dcf579af: marcada como fechada mas sem prova de KEY validada
```

**Correto (Proposto)**:

```
Session c516b172:
- started_at: 09:12:53Z
- Trabalhou em Sprint 6, auditoria

VS Code reconnect ocorre:
- sessionEnd hook dispara para c516b172 (ou sessionRollover)
- c516b172 é finalizado/arquivado
- Nova session dcf579af criada com source="reconnect_rollover" (não auto_recovery!)
- PREV_SESSION_ID="c516b172"
- PREV_CLOSE_KEY_VALIDATED=false (lido do checkpoint de c516b172)
- Informa ao user: "Previous session c516b172 closed without authorization"

Agora dcf579af continua de forma limpa
```

---

## 🎯 Plano de Implementação

### Fase 1: Fix BUG-80 (post-tool-use.sh)

**Arquivo**: `/workspaces/chatgpt-docker-puppeteer/.github/hooks/scripts/post-tool-use.sh`

**Mudança**:

- Lines 260-310: Reordenar lógica de validação
  - ANTES: Setar close_key_validated, depois chamar session-close.sh
  - DEPOIS: Chamar session-close.sh, só setar se exit code 0

**Código Novo** (pseudocódigo):

```bash
if [ "$KEY_FOUND" = "true" ]; then
  # NÃO seta close_key_validated aqui!
  # Deixa para session-close.sh fazer

  _EXIT_CODE=0
  bash "$_SESSION_CLOSE_SCRIPT" "$CURRENT_CLOSE_KEY" || _EXIT_CODE=$?

  if [ $_EXIT_CODE -eq 0 ]; then
    # Sucesso: session-close.sh já setou close_key_validated=true
    # Log apenas para audit
    jq -cn ... '{event: "sessionClose_key_validated_confirmed", ...}' >> "$AUDIT_FILE"
  else
    # Falha: KEY era inválida
    # MANTÉM close_key_validated = false (nunca foi alterado)
    jq -cn ... '{event: "sessionClose_key_validation_failed", ...}' >> "$AUDIT_FILE"
  fi
fi
```

**Validação**:

- [ ] Test Cenário B (KEY inválida) → close_key_validated permanece false
- [ ] Test Cenário A (KEY válida) → close_key_validated fica true
- [ ] Shellcheck: sem erros
- [ ] Audit log: evento correto registrado

### Fase 2: Fix BUG-81 (turn_count vs turn_authorized)

**Investigation**:

- [ ] Encontrar onde turn_authorized é incrementado
- [ ] Comparar contra turn_count no code
- [ ] Determinar qual deve ser fonte de verdade
- [ ] Validar lógica em agent-stop.sh que usa esses números

**Action** (TBD após investigation):

- [ ] Sincronizar turn_count com turn_authorized
- [ ] Ou remover turn_authorized se turn_count é suficiente
- [ ] Documentar qual é a semantica de cada um

### Fase 3: Fix BUG-82 (Chronological Impossibility)

**Investigation**:

- [ ] Comparar session-context timestamps com audit.jsonl timestamps
- [ ] Validar when reconnect_at ocorreu
- [ ] Determinar if dcf579af foi realmente "auto_recovery" ou "reconnect_rollover"

**Action** (TBD após investigation):

- [ ] Potencialmente corrigir source=auto_recovery para source=reconnect_rollover
- [ ] Ou validar que a timeline é realmente correta (possível que os tempos estejam ajustados por
      timezone)

### Fase 4: Implement Guards B, C, E (Prevenção Futura)

**Guard B** — Enforce All Questions via vscode_askQuestions

- PRÉ-COMMIT: Regex checar se response contém "?" sem vscode_askQuestions invocation
- LOCAL: agent-stop.sh ou pre-commit hook
- Severity: ALTO (previne BUG-79 direto)

**Guard C** — Detect "Completion Heuristic"

- PRÉ-COMMIT: Se response contém padrão "✅ TODO X completo" → require vscode_askQuestions
- LOCAL: agent-stop.sh
- Severity: ALTO (previne BUG-80 direto)

**Guard E** — Token Budget Monitoring

- A cada 5 turnos: checar remaining_tokens
- Se < 30%: dispare /compact command
- Se < 10%: force vscode_askQuestions Template D
- LOCAL: preToolUse hook ou agent-stop.sh
- Severity: MÉDIO (previne future context overflow)

### Fase 5: Test and Validation

- [ ] Re-run Cenário A: KEY válida
- [ ] Re-run Cenário B: KEY inválida
- [ ] Re-run Cenário C: Reconnect
- [ ] Audit log: eventos corretos
- [ ] Watchdog: não detecta false positives
- [ ] Integration test: full session lifecycle

---

## ✅ Checklist de Qualidade

- [ ] Todas as mudanças têm comentários JSDoc/comentários explicativos
- [ ] Shellcheck passa em todos os scripts modificados
- [ ] Testes de cenários A, B, C passam
- [ ] Audit log é consistente com session-context
- [ ] Watchdog reports são corretos (sem false positives)
- [ ] Documentation atualizada (GUIA-HOOKS-COPILOT.md)
- [ ] Commit message descreve BUGs resolvidos
- [ ] Pre-commit hook aprovado

---

## 📅 Cronograma Proposto

1. **Hoje**: Implementar Fase 1 (post-tool-use.sh fix) + testes
2. **Próximo turno**: Fases 2-3 investigation + fix
3. **Turno seguinte**: Implementar Guards B, C, E
4. **Final**: Full test + documentation + commit

---

_Planejamento iniciado: 2026-03-12T21:30:00Z_ _Próximo passo: Revisão e aprovação do plano pelo
usuário_
