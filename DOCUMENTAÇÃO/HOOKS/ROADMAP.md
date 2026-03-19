# Roadmap — Sistema de Hooks (SESSION / TURN / SUBTURN)

**Versão**: 1.0
**Gerado em**: 2026-03-20
**Fonte de verdade**: `PLANO-REIMPLEMENTACAO-HOOKS-2026-03-17.md` (v2.2)

---

## Hierarquia canônica

```
SESSION
└── TURN  (ciclo UserPromptSubmit → Stop)
    └── SUBTURN  (ciclo PreToolUse → PostToolUse)
```

> **SECTION foi explicitamente eliminada do escopo desta implementação.**
> Adicionava complexidade sem benefício imediato. Pode ser reintroduzida como módulo
> independente em fase futura sem quebrar o sistema base (ver Parte 2B.3 do plano).

---

## Estado atual da implementação

### ✅ F1 — Core (completo)

| Artefato | Linhas | Status |
|---|---|---|
| `lib/common.sh` | 522 | ✅ Completo + expandido com lifecycle utilities |
| `scripts/stop.sh` + `lib/stop-lib.sh` | 83 | ✅ Enforcement **desativado** — rastreia sem bloquear |
| `scripts/post-tool-use.sh` + `lib/post-tool-use-lib.sh` | 66 | ✅ Detecta askQuestions + close_key |
| `scripts/session-close.sh` + `lib/session-close-lib.sh` | 101 | ✅ Encerramento autorizado |
| `scripts/smoke-test.sh` | 352 | ✅ 16/16 testes passando |
| `state/session.json` | — | ✅ Schema completo |
| `hooks.json` | — | ✅ 8 eventos configurados |

### ✅ F2 — Inicialização de Sessão (completo)

| Artefato | Linhas | Status |
|---|---|---|
| `scripts/session-start.sh` + `lib/session-start-lib.sh` | 149 | ✅ Init/reconnect + briefing + additionalContext |
| `scripts/user-prompt-submit.sh` + `lib/user-prompt-submit-lib.sh` | 117 | ✅ TURN lifecycle + orphan healing |

### ✅ F3 — Proteções (completo)

| Artefato | Linhas | Status |
|---|---|---|
| `scripts/pre-tool-use.sh` + `lib/pre-tool-use-lib.sh` | 137 | ✅ Subturn tracking + bloqueio session-close.sh direto |

### ✅ F4 — Auxiliares de Hooks (completo)

| Artefato | Linhas | Status |
|---|---|---|
| `scripts/pre-compact.sh` + `lib/pre-compact-lib.sh` | 103 | ✅ Checkpoint + additionalContext ao compactar |
| `scripts/subagent-start.sh` + `lib/subagent-lib.sh` | 142 | ✅ Tracking de subagentes |
| `scripts/subagent-stop.sh` | 9 | ✅ Thin wrapper para subagent-lib.sh |

### 🔄 F4.5 — Scripts Auxiliares Operacionais (em progresso)

Scripts chamados **manualmente pelo agente** (não hooks automáticos do VS Code).
Localização: `scripts/` (mesma pasta dos hooks).

| Script | Prioridade | Status | Descrição |
|---|---|---|---|
| `start-turn.sh "intenção"` | 🔴 Alta | 🔄 A fazer | Declara intenção do turno antes de trabalhar |
| `session-checkpoint.sh` | 🟡 Média | 🔄 A fazer | Salva checkpoint manual antes de mudanças críticas |
| `session-reminder.sh` | 🟡 Média | 🔄 A fazer | Exibe resumo da sessão atual (close_key, stats, tarefas) |
| `add-task.sh <prior> <título> <desc>` | 🟡 Média | 🔄 A fazer | Adiciona tarefa ao backlog (`state/pending-tasks.md`) |
| `complete-task.sh <padrão>` | 🟡 Média | 🔄 A fazer | Marca tarefa como concluída no backlog |
| `save-finding.sh <mod> <sev> <tipo> <desc>` | 🟢 Baixa | 🔄 A fazer | Registra finding (bug/gap/melhoria) em `state/findings.md` |
| `watchdog.sh [--json]` | 🟢 Baixa | 🔄 A fazer | Verifica saúde do sistema de hooks |

### ❌ Fora de escopo (explicitamente excluídos)

| Artefato | Motivo da exclusão |
|---|---|
| `start-section.sh` | SECTION eliminada do escopo — adiciona complexidade sem benefício imediato |
| `section-end.sh` | idem |
| `continue-section.sh` | idem |
| `git-push-hook / on-git-push.sh` | Fora do ciclo SESSION/TURN/SUBTURN core |
| Node.js handlers (Arquitetura B) | Decisão tomada mas bash é suficiente por ora; migração postergada |

### 📋 F5 — Validação Completa (futuro)

| Entregável | Status |
|---|---|
| Suite smoke-test expandida (todos os scripts) | 🔄 16/16 atual só cobre stop + post-tool-use |
| Testes de sessão completa end-to-end | 🔄 A fazer |
| Testes de RECONNECT | 🔄 A fazer |
| Testes de orphan healing | 🔄 A fazer |
| Testes de pending_session_close flow | 🔄 A fazer |

---

## Notas de Design

### Stop hook sem enforcement

O enforcement (`emit_stop_block`) foi **desativado** até que o ciclo de lifecycle
(SESSION/TURN/SUBTURN) esteja maduro e bem testado. O stop hook continua **rastreando**
turnos não-autorizados (`turn_unauthorized`, `consecutive_unauthorized`) mas não bloqueia.

Para reativar: em `lib/stop-lib.sh`, substituir o passo 4 (turno não-autorizado) de volta
para a versão com `emit_stop_block`. O smoke-test T04/T05/T06 precisará ser revertido.

### Hierarquia de estado

```
session.json
├── session_id, started_at, close_key
├── pending_session_close (flag → stop.sh chama session-close.sh)
├── strict_turn_close (sempre true — enforcement desativado por opt)
├── current_turn { number, turn_id, started_at, ask_questions_called, ... }
├── current_subturn { number, subturn_id, started_at, response_at }
├── session_stats { turn_count, turn_authorized, turn_unauthorized, ... }
└── compliance { consecutive_unauthorized, last_turn_authorized }
```

### Fluxo de encerramento de sessão

```
Agente: vscode_askQuestions (Template F)
    ↓
Usuário digita: ENCERRAR-XXXXXXXX
    ↓
post-tool-use.sh: detecta close_key → pending_session_close = true
    ↓
Stop hook dispara
    ↓
stop-lib.sh: pending_session_close = true → chama session-close.sh
    ↓
session-close.sh: grava ended_at, gera session-final-report.md
```
