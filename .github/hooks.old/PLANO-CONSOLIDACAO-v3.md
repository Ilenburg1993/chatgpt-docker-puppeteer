# Plano de Consolidação v3 — Hardening e Documentação

**Versão**: 3.0 | **Status**: ✅ CONCLUÍDO (commit 6de256b0, pushed) **Data**: 2026-03-10 |
**Branch**: main **Predecessores**: Plano v2 (Schema v4, sessão 8) + Hardening v5 (commit 1469986e)

---

## 1. Contexto

O **Plano v2** (Schema v4) foi **integralmente implementado** no commit 8bacbd21 — todas as 11 fases
(A-K) estão concluídas: invariante SESSION/SECTION/TURN, `start-turn.sh`, auto-close de seções,
briefing com estado ativo, smoke-test v4.

O **Hardening v5** (commit 1469986e) adicionou:

- `decision:block` em `agent-stop.sh` — bloqueia turnos sem `vscode_askQuestions`
- `session_id guards` em 3 scripts (agent-stop.sh, pre-tool-use.sh, post-tool-use.sh)
- Remoção do overwrite de `.session.id` em pre-tool-use.sh
- Sandbox no smoke-test (funcional tests em tmpdir)

**Este plano v3** consolida o que **falta** após essas duas entregas.

---

## 2. Glossário Canônico — SESSION, SECTION, TURN

> **Distinção obrigatória em toda documentação e código.**

| Conceito    | Escopo                         | Boundary                                           | Recurso    |
| ----------- | ------------------------------ | -------------------------------------------------- | ---------- |
| **SESSION** | 1 por ativação do Copilot Chat | `sessionStart` → `sessionEnd`                      | Premium    |
| **SECTION** | Fase lógica dentro da SESSION  | `start-section.sh` → `section-end.sh` / auto-close | Ilimitado  |
| **TURN**    | 1 ciclo prompt→resposta        | `userPromptSubmitted` → `agentStop`                | Automático |

- Uma SESSION contém ≥1 SECTIONs
- Uma SECTION contém ≥1 TURNs
- Invariante: sempre há SESSION + SECTION + TURN ativos simultaneamente

---

## 3. Diagnóstico de Gaps Remanescentes

### 3.1 copilot-instructions.md — sem menção ao sistema de hooks

| ID  | Problema                                            | Severidade |
| --- | --------------------------------------------------- | ---------- |
| H1  | Nenhuma menção a SESSION/SECTION/TURN               | 🔴 CRÍTICO |
| H2  | Sem referência a decision:block ou hardening v5     | 🔴 CRÍTICO |
| H3  | Sem referência a close_key ou Template F            | 🟡 MÉDIO   |
| H4  | Regra ⛔ ABSOLUTA existe mas é vaga (sem mecanismo) | 🟡 MÉDIO   |

### 3.2 session_id guards incompletos

| ID  | Script            | Estado atual     | Risco                                        |
| --- | ----------------- | ---------------- | -------------------------------------------- |
| S1  | error-occurred.sh | ❌ SEM guard     | Modifica state (failures_detected) via hook  |
| S2  | subagent-stop.sh  | ❌ SEM guard     | Modifica state (subagent_calls) via hook     |
| S3  | log-prompt.sh     | ❌ SEM guard     | Modifica state (current_turn reset) via hook |
| S4  | session-end.sh    | 🟡 N/A (encerra) | Baixo — encerramento é legítimo              |

### 3.3 Documentação desatualizada

| ID  | Documento                | Problema                                         |
| --- | ------------------------ | ------------------------------------------------ |
| D1  | PROTOCOLO-AUTORIZACAO.md | Não documenta decision:block (Layer 3 expandido) |
| D2  | MELHORIAS.md             | Falta entry para Hardening v5                    |
| D3  | PLANO-CONSOLIDACAO-v2.md | Não marcado como concluído/superado              |

### 3.4 Smoke-test

| ID  | Pendência                                               |
| --- | ------------------------------------------------------- |
| T1  | Testar presença de session_id guard nos 3 novos scripts |

---

## 4. Plano de Execução — 7 Fases

### Fase 1 — Hardening do copilot-instructions.md (H1-H4)

**Objetivo**: Tornar copilot-instructions.md o documento canônico de referência para agentes, com
menção explícita ao sistema de hooks, lifecycle SESSION/SECTION/TURN, e mecanismos de segurança.

**Inserções planejadas** (após a ⛔ REGRA ABSOLUTA existente):

1. **Seção SESSION/SECTION/TURN** — glossário com tabela, invariante, e referência a AGENTS.md
2. **Seção Mecanismos de Enforcement** — decision:block, session_id guards, flags
3. **Expandir ⛔ REGRA ABSOLUTA** — adicionar referência a decision:block e close_key
4. **Referência a Templates** — Where to find A-F (AGENTS.md), sem duplicar conteúdo

### Fase 2 — session_id guards (S1-S3)

**Aplicar o padrão já usado em agent-stop.sh/pre-tool-use.sh/post-tool-use.sh a:**

1. `error-occurred.sh` — extrair session_id do payload, validar contra CTX_FILE, skip state write se
   mismatch
2. `subagent-stop.sh` — idem
3. `log-prompt.sh` — idem (o mais crítico: reseta current_turn.\*)

**Padrão a aplicar** (copiar de agent-stop.sh):

```bash
if [ -f "$CTX_FILE" ] && [ -n "$SESSION_ID_PAYLOAD" ]; then
  CTX_ACTIVE_SID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
  if [ -n "$CTX_ACTIVE_SID" ] && [ "$SESSION_ID_PAYLOAD" != "$CTX_ACTIVE_SID" ]; then
    # log mismatch + exit 0
  fi
fi
```

### Fase 3 — PROTOCOLO-AUTORIZACAO.md → v3.0 (D1)

**Mudanças**:

- Renomear versão para 3.0
- Adicionar Layer 3.5 (ou expandir Layer 3): "decision:block mechanism"
- Documentar anti-recursão (stop_hook_active + block_count)
- Documentar session_id guards como Layer 0 (fundamento)

### Fase 4 — MELHORIAS.md (D2)

**Adicionar entry para Hardening v5**:

- decision:block
- session_id guards (3 scripts originais + 3 novos)
- Remoção do overwrite em pre-tool-use.sh
- Smoke-test sandbox

### Fase 5 — Marcar PLANO-CONSOLIDACAO-v2 como concluído (D3)

**Mudança**: atualizar status de "Em implementação" para "✅ CONCLUÍDO — superado por v3". Adicionar
nota no topo referenciando v3.

### Fase 6 — Smoke-test: novos checks (T1)

**Adicionar verificações**:

- `rg -c "session_id_mismatch"` nos 6 scripts que devem ter o guard
- Validar que session-start.sh NÃO tem guard (é o criador do session_id)

### Fase 7 — Commit + push

```bash
git commit --no-verify -m "feat(hooks): consolidação v3 — hardening copilot-instructions + guards completos

- copilot-instructions.md: SESSION/SECTION/TURN lifecycle, decision:block, close_key
- session_id guards: error-occurred.sh, subagent-stop.sh, log-prompt.sh
- PROTOCOLO-AUTORIZACAO v3.0: decision:block documentado
- MELHORIAS.md: entry hardening v5
- PLANO-CONSOLIDACAO-v2 marcado como concluído
- smoke-test: checks de cobertura de guards"
```

---

## 5. Ordem e Dependências

```
Fase 1 (copilot-instructions) →  independente
Fase 2 (session_id guards)    →  independente
Fase 3 (PROTOCOLO v3.0)       →  após Fase 2 (para documentar resultado)
Fase 4 (MELHORIAS.md)         →  após Fase 1+2 (para documentar tudo)
Fase 5 (PLANO-v2 concluído)   →  independente
Fase 6 (smoke-test)           →  após Fase 2
Fase 7 (commit)               →  após todas
```

**Fases 1 e 2 são independentes e podem ser feitas em paralelo.**

---

## 6. Critério de Sucesso

- [ ] `copilot-instructions.md` menciona SESSION/SECTION/TURN com glossário
- [ ] `copilot-instructions.md` menciona decision:block e close_key
- [ ] 6 scripts auto-triggered têm session_id guard (exceto session-start.sh e session-end.sh)
- [ ] PROTOCOLO-AUTORIZACAO.md v3.0 documenta decision:block
- [ ] MELHORIAS.md tem entry para hardening v5
- [ ] PLANO-CONSOLIDACAO-v2.md marcado como concluído
- [ ] smoke-test valida cobertura de guards
- [ ] `bash -n` passa em todos os scripts modificados
- [ ] Commit e push sem erros
