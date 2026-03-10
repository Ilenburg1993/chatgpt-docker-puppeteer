# Análise: Encerramento de SESSION — Diagnóstico, Causas e Hardening

**Data**: 2026-03-10
**Autor**: Copilot Agent (sessão `dcf579af`)
**Status**: Ativo — base para implementação em andamento
**Versão**: 1.0

---

## 1. Diagnóstico — O Problema Central

### 1.1 Dados Empíricos (audit.jsonl)

| Evento         | Quantidade |
|----------------|-----------|
| `sessionStart` | 5         |
| `sessionEnd`   | 0 (antes do fix)  |
| `sessionCloseAuthorized` | 0 (mecanismo inexistente) |

**5 sessões iniciadas. 0 encerradas legitimamente.**

Todas as sessões terminaram abruptamente. O padrão típico em `audit.jsonl`:
```
sessionStart (sid=XXXX, ts=2026-03-09T17:12:35)
... muitos eventos de ferramenta ...
(sem sessionEnd)
sessionStart (sid=YYYY, ts=2026-03-09T17:23:38) ← nova sessão sem encerrar a anterior
```

### 1.2 Root Cause Primário: `sessionEnd` não dispara na plataforma

O evento `sessionEnd` está registrado em `copilot-hooks.json`:
```json
"sessionEnd": [
  { "type": "command", "bash": "./scripts/session-end.sh", "timeoutSec": 60 }
]
```

**Mas o evento NUNCA dispara.** Razão: a plataforma VS Code Copilot só dispara `sessionEnd`
em condições controladas (encerramento limpo via API). Na prática, as sessões terminam por:
- Timeout de inatividade (Copilot Chat desconecta silenciosamente)
- Usuário fecha a aba/janela do VS Code
- Copilot é reiniciado por atualização de extensão
- Usuário inicia nova conversa sem encerrar a anterior
- Erro fatal do processo

Nenhuma dessas condições dispara `sessionEnd`.

### 1.3 Root Cause Secundário: Lacuna de protocolo — agente não chama Template F

Mesmo quando o usuário decide encerrar voluntariamente, o agente historicamente não
invocava `vscode_askQuestions` com Template F antes de encerrar. Causas:
1. Protocolo não estava suficientemente claro nas instruções
2. Não havia mecanismo de enforcement (decision:block foi removido na v5.0 do TURN model)
3. O agente encerrava o turno sem Template F → próxima sessão detectava abrupt close

---

## 2. Taxonomia de Encerramento

| Tipo | Descrição | Detectável? | Mitigável? |
|------|-----------|------------|-----------|
| **A — Autorizado** | Template F → KEY → session-close.sh | Sim (sessionCloseAuthorized) | — (já é o caso ideal) |
| **B — Voluntário sem protocolo** | Usuário encerra, agente não invocou Template F | Limitado | Sim: nudge + instruções |
| **C — Inatividade** | Copilot desconecta por timeout | Sim (last_event_age > 30min) | Parcial: checkpoint periódico |
| **D — Crash/Restart** | Copilot reinicia abruptamente | Sim (sem sessionEnd) | Não |
| **E — Nova sessão** | Usuário inicia nova conversa | Sim (nova sessionStart) | Parcial: briefing alerta |

---

## 3. Mecanismos de Hardening Propostos

### 3.1 [IMPLEMENTADO] session-close.sh — Encerramento Manual com KEY

**Status**: Commit `5171c58d` (2026-03-10)

O agente deve chamar manualmente após receber a KEY do usuário via Template F:
```bash
bash .github/hooks/scripts/session-close.sh "ENCERRAR-XXXXXXXX"
```

**O que faz**:
1. Valida KEY contra `session.close_key` no contexto
2. Seta `close_key_validated=true`
3. Loga `sessionCloseAuthorized` em `audit.jsonl`
4. Cria `SESSION_CLOSE_AUTHORIZED.flag`
5. Chama `session-end.sh` internamente (gera relatório + `sessionEnd`)

**Limitação**: Só funciona quando o agente é voluntariamente encerrado (Tipo A). Não resolve Tipo C, D, E.

### 3.2 [IMPLEMENTADO] session-start.sh — Detecção de Encerramento Limpo

**Status**: Commit `5171c58d` (2026-03-10)

A detecção de abrupt-close agora reconhece `sessionCloseAuthorized` e `SESSION_CLOSE_AUTHORIZED.flag`
como evidências de encerramento limpo (além de `sessionEnd`).

### 3.3 [PROPOSTO] Registrar Template F invocado em post-tool-use.sh

**Problema**: Mesmo com session-close.sh, o agente pode receber a KEY via Template F mas esquecer
de chamar o script. Precisamos registrar quando Template F foi invocado.

**Implementação**:
- `post-tool-use.sh`: quando `vscode_askQuestions` é respondida com a close_key detectada,
  além de setar `close_key_validated=true`, também setar `session.template_f_invoked_at = timestamp`
- Isso já é feito parcialmente (KEY é detectada em `post-tool-use.sh`)
- **Gap**: mesmo com KEY detectada, o agente ainda precisa chamar `session-close.sh` manualmente

**Hardening proposto**: quando `close_key_validated=true` (KEY estava na resposta ao askQuestions),
`post-tool-use.sh` pode chamar `session-close.sh` automaticamente:
```bash
# Em post-tool-use.sh, quando KEY_FOUND=true:
if [ "$KEY_FOUND" = "true" ]; then
    bash "$SCRIPTS_DIR/session-close.sh" "$CURRENT_CLOSE_KEY" 2>/dev/null || true
fi
```
Isso eliminaria a dependência de o agente chamar o script manualmente.

### 3.4 [PROPOSTO] agent-stop.sh — Nudge Específico de Encerramento

**Problema**: Quando o agente está encerrando um turno sem Template F e sem `close_key_validated`,
o systemMessage de nudge deve ser mais específico sobre encerramento de SESSION.

**Implementação**:
Adicionar ao nudge de `agent-stop.sh` quando `close_key_validated=false` e muitos turnos
sem `vscode_askQuestions`:
```
Se for encerrar a sessão, invoque ANTES: vscode_askQuestions (Template F) 
com close_key=[ACTUAL_KEY], e então chame: session-close.sh "ENCERRAR-XXX"
```

### 3.5 [PROPOSTO] session-start.sh — Categorização de Fechamento Anterior

**Problema**: O briefing atual apenas distingue "abrupto" vs "limpo" mas não explica a causa.

**Implementação**: Calcular métricas do último evento antes do novo `sessionStart`:
- **Tempo desde último evento**: se > 30min → provável inatividade/timeout
- **Tipo do último evento**: `agentStop` = normal vs `preToolUse` = possível crash
- **Template F invocado no último turno**: indica tentativa de encerrar

Resultado esperado no briefing:
```
⚠️ ENCERRAMENTO ABRUPTO (sessão anterior)
   Causa provável: INATIVIDADE (último evento há 47min)
   Template F invocado: NÃO
   Última ferramenta: run_in_terminal
```

### 3.6 [PROPOSTO] Checkpoint de Autorização

**Problema**: Não há rastreamento de quantas vezes Template F foi invocado sem ser seguido
de session-close.sh.

**Implementação**: Adicionar ao `session-context.json`:
```json
"session": {
  "template_f_invoked_at": null,      // timestamp da última invocação de Template F
  "close_requested_at": null,          // quando o agente invocou Template F
  "close_key_validated": false,
  "session_close_sh_called": false     // flag: session-close.sh foi chamado
}
```

### 3.7 [PROPOSTO] Reduzir Fechamentos Abruptos por Inatividade

O Copilot desconecta quando fica inativo por muito tempo. Mitigações:
1. **Checkpoint periódico automático**: `session-checkpoint.sh` chamado a cada N turnos
   (já existe via nudge, mas pode ser mais agressivo)
2. **Instrução de handoff**: quando o agente percebe que vai ficar inativo, deve invocar
   Template F antecipadamente e salvar checkpoint

---

## 4. Flags do Sistema — Inventário e Ciclo de Vida

| Flag | Criado por | Removido por | Representa |
|------|-----------|-------------|-----------|
| `SESSION_CLOSE_AUTHORIZED.flag` | `session-close.sh` (KEY correta) | `session-start.sh` na sessão seguinte | Encerramento legítimo |
| `SESSION_CLOSE_NO_KEY.flag` | `session-end.sh` (close_key_validated=false) | `session-close.sh` (antes de chamar session-end.sh) | Encerramento sem KEY |
| `UNAUTHORIZED_CLOSE.flag` | Legado (v4.0) — não mais criado | — | Obsoleto |
| `SESSION_STALE.flag` | `watchdog.sh` | `watchdog.sh` | Sessão sem atividade |

**Bug encontrado e corrigido (v5.2)**:
`session-end.sh` hardcodava `STATE_DIR` e `LOG_DIR` sem respeitar `HOOKS_STATE_DIR`/`HOOKS_LOG_DIR`.
Isso causava artefatos: quando o smoke test chamava `session-close.sh` com sandbox isolado, o
`session-end.sh` lía `close_key_validated=false` do CTX **real** e criava `SESSION_CLOSE_NO_KEY.flag`
no estado real da sessão ativa. **Correção**: `session-end.sh` agora respeita as variáveis de
ambiente de override, assim como todos os outros scripts. `session-close.sh` passa explicitamente
`HOOKS_STATE_DIR` e `HOOKS_LOG_DIR` ao invocar `session-end.sh`.

**Lifecycle dos flags (fluxo correto pós-v5.2)**:
```
session-close.sh chamado com KEY correta
  → atualiza CTX: close_key_validated=true
  → loga: sessionCloseAuthorized
  → cria: SESSION_CLOSE_AUTHORIZED.flag
  → remove: SESSION_CLOSE_NO_KEY.flag (se existir)
  → chama session-end.sh (com HOOKS_STATE_DIR correto)
      → lê close_key_validated=true do CTX correto
      → loga: sessionEnd_authorized_with_key
      → NÃO cria SESSION_CLOSE_NO_KEY.flag ✓

session-start.sh da próxima sessão:
  → encontra SESSION_CLOSE_AUTHORIZED.flag → PREV_ABRUPT_CLOSE=false
  → remove SESSION_CLOSE_AUTHORIZED.flag
  → briefing: "✅ SESSÃO ANTERIOR ENCERRADA CORRETAMENTE"
```

---

## 5. Plano de Implementação

### Fase 1 — COMPLETO (commit `5171c58d`)
- [x] session-close.sh criado
- [x] session-start.sh: detecção de SessionCloseAuthorized
- [x] Protocolo atualizado (5 arquivos)
- [x] smoke-test: 150/150 PASS

### Fase 2 — COMPLETO (commit pendente)
- [x] `post-tool-use.sh`: auto-chamar session-close.sh quando KEY detectada (§3.3)
- [x] `agent-stop.sh`: nudge específico de encerramento com close_key (§3.4)
- [x] `session-start.sh`: categorização de tipo de fechamento anterior (§3.5) — 3 modos: clean, key_validated, abrupt_no_key
- [x] `session-end.sh`: suporte a HOOKS_STATE_DIR e HOOKS_LOG_DIR (bug correção)
- [x] `session-close.sh`: passa HOOKS_STATE_DIR ao chamar session-end.sh
- [x] `ANALISE-SESSION-CLOSE.md`: documentação atualizada

### Fase 3 — Backlog
- [ ] Redução de fechamentos abruptos por inatividade (§3.7)
- [ ] Dashboard de saúde de SESSION (taxa de encerramentos autorizados vs abruptos)

---

## 6. Fluxo Ideal Pós-Implementação

```
Usuário decide encerrar
    ↓
Agente invoca vscode_askQuestions (Template F)
    ↓
post-tool-use.sh detecta KEY na resposta
    ↓
post-tool-use.sh auto-chama session-close.sh (Fase 2, §3.3)
    ↓
session-close.sh valida KEY, loga sessionCloseAuthorized
    ↓
session-close.sh chama session-end.sh (relatório + sessionEnd)
    ↓
SESSION_CLOSE_AUTHORIZED.flag criado
    ↓
Agente encerra turno normalmente
    ↓
Próxima sessão: session-start.sh detecta encerramento limpo → sem alerta
```

**Fluxo de fallback (agente esquece de chamar session-close.sh após Template F)**:
- `post-tool-use.sh` já chama automaticamente (Fase 2) → gap coberto

**Fluxo de fechamento abrupto (irresolvível)**:
- session-start.sh detecta → alerta no briefing com causa provável (Fase 2, §3.5)
- `SESSION_CLOSE_NO_KEY.flag` criado pela session-start.sh (não pela session-end.sh)
