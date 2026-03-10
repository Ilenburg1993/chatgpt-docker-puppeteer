# Status & Roadmap — Sistema de Hooks
**Documento canônico de acompanhamento evolutivo do sistema de hooks do Copilot.**
**Última atualização**: 2026-03-11 | **Versão do documento**: 2.1

> Este arquivo é o guia vivo do sistema de hooks. Deve ser atualizado a cada fase concluída,
> novo bug descoberto ou decisão arquitetural tomada. É a fonte primária de verdade sobre o
> que está feito, o que está pendente e como evoluir o sistema.

---

## Índice

1. [Visão Geral do Sistema](#1-visão-geral-do-sistema)
2. [Histórico de Fases](#2-histórico-de-fases)
3. [Diagnóstico do Estado Atual (2026-03-10)](#3-diagnóstico-do-estado-atual-2026-03-10)
4. [Issues Abertas — Classificadas por Prioridade](#4-issues-abertas--classificadas-por-prioridade)
5. [Roadmap — Fase 9 e além](#5-roadmap--fase-9-e-além)
6. [Critérios de Aceite por Nível](#6-critérios-de-aceite-por-nível)
7. [Guia de Manutenção Contínua](#7-guia-de-manutenção-contínua)
8. [Contratos de Eventos (Tabela Canônica)](#8-contratos-de-eventos-tabela-canônica)
9. [Dependências e Referências Cruzadas](#9-dependências-e-referências-cruzadas)
10. [Changelog deste Documento](#10-changelog-deste-documento)

---

## 1. Visão Geral do Sistema

### Propósito

Sistema de automação de observabilidade e compliance para sessões do GitHub Copilot.
Rastreia turnos, seções e sessões; garante autorização antes de encerramento; gera métricas,
relatórios e alertas.

### Componentes principais

| Componente               | Localização                              | Papel                                           |
| ------------------------ | ---------------------------------------- | ----------------------------------------------- |
| Configuração de hooks    | `.github/hooks/copilot-hooks.json`       | Mapeia eventos Copilot → scripts shell          |
| Scripts operacionais     | `.github/hooks/scripts/`                 | 31 scripts cobrindo todo o ciclo de vida        |
| Estado persistido        | `.github/hooks/state/`                   | session-context.json, briefing, tasks, watchdog |
| Logs                     | `.github/hooks/logs/`                    | audit.jsonl, tool-metrics.jsonl, findings.jsonl |
| Hooks Git nativos        | `.git/hooks/`                            | pre-commit, commit-msg, post-commit, (pre-push) |
| Documentação operacional | `DOCUMENTAÇÃO/HOOKS/`                    | README, REFERENCIA-HOOKS, PROTOCOLO-AUTORIZACAO |
| Instruções para agente   | `.github/copilot-instructions.md`        | Regras absolutas e ciclo de vida documentado    |
| Protocolo de hooks       | `.github/instructions/hooks-protocol.md` | Protocolo completo de operação para agentes     |

### Schema de estado — versão atual

**Schema v8** (em produção desde commit `1674615b`)

Estrutura canônica de `session-context.json`:
```
.session.id          → UUID único da sessão
.session_stats.*     → contadores agregados (turn_count, section_count, etc.)
.current_turn.*      → estado do turno ativo (section_turn, number, intent, ...)
.current_section.*   → estado da seção ativa (name, section_id, local_turn, ...)
.compliance.*        → estado de autorização (consecutive_unauthorized, ...)
```

### Ciclo de vida SESSION → SECTION → TURN

```
SESSION (1 por dia, 1 por ativação Copilot)
  ├─ SECTION (fase lógica; ≥1 por SESSION)
  │    ├─ TURN (ciclo prompt→resposta; ≥1 por SECTION)
  │    ├─ TURN
  │    └─ ...
  ├─ SECTION
  └─ ...
```

**Invariante absoluto**: sempre deve haver SESSION + SECTION + TURN ativos simultaneamente.

---

## 2. Histórico de Fases

| Fase             | Commit                             | Data       | Principais entregas                                                                                                                                                           |
| ---------------- | ---------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fase 0+1         | `4ceb3a52`                         | ~2026-03   | Auto-recovery, 3 novos hooks, guards robustos, section-end cleanup                                                                                                            |
| Fase 2+3         | `3c8a429a`                         | ~2026-03   | Watchdog, feedback dinâmico, invariante SESSION+SECTION+TURN                                                                                                                  |
| Fase 4           | `0900bcfa`                         | ~2026-03   | Dual TURN numbering, git push auto-trigger, Template G                                                                                                                        |
| Fase 5           | `aa3b64b0`                         | ~2026-03   | Section summaries, additionalContext, Schema v6, Stop format                                                                                                                  |
| Fase 6           | `95e73001`                         | ~2026-03   | Metadata hardening, Schema v7, event enrichment                                                                                                                               |
| Fase 7           | `1674615b`                         | 2026-03-09 | IDs UUID, rastreio commits, Schema v8, fix session_id_mismatch (HEAL v1)                                                                                                      |
| Hardening v5     | `1469986e`                         | 2026-03-09 | decision:block, session_id guards em 3 scripts, smoke-test sandbox                                                                                                            |
| Guards v2        | `90cd9592`                         | 2026-03-09 | Guards completos em error-occurred.sh, subagent-stop.sh, log-prompt.sh                                                                                                        |
| Consolidação v3  | `6de256b0`                         | 2026-03-09 | copilot-instructions atualizado, docs PROTOCOLO-AUTORIZACAO, briefing                                                                                                         |
| **Fase 8**       | `e22e8730`                         | 2026-03-09 | Hotfixes CODEX P0+P1: H-001,H-002,H-003,H-004,H-006,M-001,M-002,M-003                                                                                                         |
| **Fase 9**       | `e22e8730` + `1674615b`→`3447fb73` | 2026-03-10 | G9-01..G9-10: pre-push reinstalado, rotate-audit, flag stale clear, HEAL v2, raw-logs deletados, contracts/events-contract.md, hooks-lib/common.sh, smoke-test seção 15       |
| **Hardening v6** | `3447fb73`                         | 2026-03-11 | Subagente auth (3 camadas), REV4-01~08: auth_via_subagent_delegation, events-contract v1.1, smoke-test sandbox, ctx_guard_session_id removida, flock session-end, caps config |

### O que a Fase 8 resolveu

| ID CODEX | Descrição                                       | Status Fase 8                                                                                                                 |
| -------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| H-001    | Hook git `post-push` inválido                   | ✅ Script `install-git-hooks.sh` corrigido para `pre-push`                                                                     |
| H-002    | `ERRORS_TODAY` indefinido em relatório diário   | ✅ Variável inicializada e calculada                                                                                           |
| H-003    | Leitura de `.session_id` legado em scripts CRUD | ✅ Migrado com fallback `.session.id // .session_id // ""`                                                                     |
| H-004    | `toolFailure` vs `toolUseFailure` divergência   | ✅ Dual-read implementado em consumidores                                                                                      |
| H-005    | Flood de `session_id_mismatch`                  | ✅ Resolvido na Fase 7 (HEAL v1)                                                                                               |
| H-006    | `reset-auth-violation.sh` campos legados        | ✅ Corrigido para `.compliance.*`                                                                                              |
| H-007    | Ausência de locking transacional                | ✅ Parcialmente resolvido (Hardening v6): session-end.sh tem flock (REV4-07); agent-stop.sh/log-prompt.sh usa sponge (atômico) |
| M-001    | Smoke-test validações frágeis                   | ✅ Checks alinhados ao contrato correto                                                                                        |
| M-002    | Métricas de seção usam sessão inteira           | ✅ Filtro por `section_id` implementado                                                                                        |
| M-003    | Timestamps inconsistentes                       | ✅ Normalizado; alguns eventos ainda legacy                                                                                    |
| M-004    | Pre-commit apenas informativo                   | ⏳ Decidido: P3, não urgente                                                                                                   |
| S-001    | Raw logs persistem dados sensíveis              | ✅ Resolvido (Fase 9): rotate-audit.sh purga raw-*.jsonl automáticamente                                                       |
| S-002    | Redaction por regex insuficiente                | ⏳ Pendente (P3)                                                                                                               |

### O que o Hardening v6 (commit `3447fb73`) resolveu

| ID      | Descrição                                                 | Status                                                                                                  |
| ------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| HV6-01  | Sessão encerrada sem auth após `runSubagent`              | ✅ `pre-tool-use.sh` detecta `runSubagent`/`Task` → seta `subagent_delegated=true`, loga `subagentStart` |
| HV6-02  | `agent-stop.sh` não reconhecia subagente como autorização | ✅ Strategies 1+2 aceitam `subagentStart`; Strategy 4 (nova): lê `subagent_delegated` do contexto        |
| REV4-01 | `agentStop_invocations` não incrementava atomicamente     | ✅ `+= 1` via jq (atômico via sponge)                                                                    |
| REV4-02 | `events-contract.md` sem 25+ eventos                      | ✅ v1.1: 7 eventos adicionados, `turnStart`→`turnStart_enriched`, agentStop 3→4 strategies               |
| REV4-03 | `generate-section-summary.sh` hardcoded cap `50`          | ✅ Usa `$HOOKS_SECTION_HISTORY_CAP` da `config.sh`                                                       |
| REV4-04 | `start-section.sh`/`start-turn.sh` ignoravam config.sh    | ✅ Ambos sourced `common.sh`; usam `$HOOKS_*_HISTORY_CAP`                                                |
| REV4-05 | `ctx_guard_session_id` dead code em `common.sh`           | ✅ Removida (nenhum script a chamava)                                                                    |
| REV4-06 | `auth_requested_at` ausente em branch sem close_key       | ✅ `post-tool-use.sh` seta em ambos os branches                                                          |
| REV4-07 | `session-end.sh` sem flock (race condition)               | ✅ `flock -x -w` adicionado antes da leitura do stdin                                                    |
| REV4-08 | `smoke-test.sh` não executava scripts em sandbox          | ✅ Seção REV4-08: syntax check em 11 scripts + exec isolada de `watchdog.sh`                             |

**Smoke-test após Hardening v6**: 143/143 PASS | shellcheck: 0 warnings

---

## 3. Diagnóstico do Estado Atual (2026-03-11 → atualizado Hardening v6)

### 3.1 O que está funcionando

- ✅ Invariante SESSION/SECTION/TURN ativa e monitorada
- ✅ `start-turn.sh` declara intenção; `vscode_askQuestions` enforcement via `decision:block`
- ✅ `agent-stop.sh` bloqueia encerramento sem autorização (decision:block, hardening v5)
- ✅ Session ID guards em `agent-stop.sh`, `pre-tool-use.sh`, `post-tool-use.sh`, `error-occurred.sh`, `subagent-stop.sh`, `log-prompt.sh`
- ✅ `session-start.sh` gera briefing completo com estado ativo, backlog, watchdog
- ✅ `generate-daily-report.sh` executa sem crash (ERRORS_TODAY calculado)
- ✅ `reset-auth-violation.sh` atualiza campos `.compliance.*` corretos
- ✅ `generate-section-summary.sh` filtra por `section_id`
- ✅ Dual-read `toolFailure`/`toolUseFailure` em consumidores
- ✅ CLOSE_KEY gerada com `openssl rand -hex 4` (boa entropia)
- ✅ Hooks Git `pre-commit`, `commit-msg`, `post-commit` instalados e funcionais
- ✅ `watchdog.sh` detecta anomalias (sessão antiga, flags de violação)
- ✅ Findings com `finding_id` único; `resolve-finding.sh` funcional
- ✅ Analytics cross-session (`analytics.sh`, `export-metrics.sh`)
- ✅ Sync de tasks para docs (`sync-tasks-to-docs.sh`)
- ✅ Checkpoint com `tasks_hash` e `tasks_changed` (`session-checkpoint.sh`)

### 3.2 Problemas ativos identificados

#### CRÍTICO — NÃO FUNCIONAL

**G9-01 — Hook `pre-push` não está instalado em `.git/hooks/`**
- ✅ **RESOLVIDO (Fase 9)**: `install-git-hooks.sh` reinstalado; `.git/hooks/pre-push` existe e é executável.
- `on-git-push.sh` agora dispara automaticamente em `git push`.

**G9-02 — `audit.jsonl` acima do limiar crítico (6315 > 5000 linhas)**
- ✅ **RESOLVIDO (Fase 9)**: `rotate-audit.sh` criado e integrado em `session-start.sh`.
- `audit.jsonl` rotacionado para `audit-20260310_064741.jsonl` (6371 linhas → arquivo).
- Auto-rotação ativa: threshold=5000 linhas a cada início de sessão.

#### ALTO — BUG ATIVO

**G9-03 — `UNAUTHORIZED_CLOSE.flag` presente (sessão anterior)**
- ✅ **RESOLVIDO (Fase 9)**: `session-start.sh` agora auto-limpa flags de sessões diferentes.
- Flag de sessão anterior é detectado como stale e deletado com evento `authViolationFlag_stale_cleared`.
- Briefing diferencia "nota histórica" (stale) de "violação ativa" (sessão anterior imediata).

**G9-04 — Estado órfão de sessão anterior no watchdog**
- ✅ **RESOLVIDO (Fase 9)**: HEAL v2 implementado em `agent-stop.sh`.
- Após N_HEAL_THRESHOLD=3 mismatches consecutivos com mesmo `got`, auto-heals com source `healed_auto_consecutive`.
- Reduz flood de `session_id_mismatch` em cenários de desincronização.

#### ALTO — SEGURANÇA

**G9-05 — Raw logs ativos (`raw-input.jsonl`, `raw-post-input.jsonl`)**
- ✅ **RESOLVIDO (Fase 9)**: Arquivos deletados. `rotate-audit.sh` purga `raw-*.jsonl` a cada rotação.
- Captura bruta não mais ativa em produção.

#### MÉDIO — QUALIDADE/PRECISÃO

**G9-06 — Ausência de `events-contract.md` centralizado**
- ✅ **RESOLVIDO (Fase 9)**: `.github/hooks/contracts/events-contract.md` criado.
- Documenta todos os 10 eventos Copilot + eventos internos com campos, produtores e consumidores.

**G9-07 — Sem `hooks-lib/common.sh` (código duplicado)**
- ✅ **RESOLVIDO (Fase 9)**: `hooks-lib/common.sh` criado com 7 funções utilitárias.
- `hl_with_lock()` disponível para integração de flock (G9-08 pendente).

**G9-08 — Sem locking transacional (`flock`) em escritas críticas**
- ⏳ **PENDENTE**: `hl_with_lock()` existe em `common.sh` mas ainda não integrada nos scripts.
- Múltiplos scripts escrevem `session-context.json` sem coordenação de lock.
- `sponge` protege contra truncamento mas não contra race conditions de read-modify-write.
- Fix: integrar `hl_with_lock` em `agent-stop.sh`, `post-tool-use.sh`, `log-prompt.sh`.

**G9-09 — Documentação `DOCUMENTAÇÃO/HOOKS/README.md` desatualizada**
- ⏳ **PENDENTE (G9-13)**: README ainda diz "v4.0 (Schema v4)"; sistema está em Schema v8+ com 33+ scripts.
- Fix: atualizar README para refletir Schema v8, hooks Fase 9, referências corretas.

#### BAIXO — BACKLOG / REFACTOR

**G9-10 — Smoke-test ainda com validações parcialmente textuais (M-001 residual)**
- ✅ **RESOLVIDO (Fase 9)**: Seção 15 adicionada ao `smoke-test.sh` com 6 checks comportamentais para G9.
- Resultado: 106/106 PASS após todos os ajustes.

**G9-11 — Redaction estrutural (S-002 residual)**
- ⏳ **PENDENTE**: Redaction atual por regex em string serializada pode deixar campos sensíveis aninhados.
- Fix P3: allowlist de chaves logáveis com drop de campos não necessários por padrão.
- `hl_redact()` já existe em `common.sh` como fundação.

**G9-12 — Schemas JSON formais não existem**
- ✅ **RESOLVIDO (Fase 9)**: `contracts/session-context.schema.json` criado em `.github/hooks/contracts/`.
- Fix P3: criar contratos formais para validar produtores e consumidores em CI.

**G9-13 — README desatualizado para Schema v8**
- ⏳ **PENDENTE**: `DOCUMENTAÇÃO/HOOKS/README.md` diz v4.0/Schema v4.
- Fix P3: atualizar para refletir Schema v8, Fase 9 e referências corretas.

**G9-14 — Pre-commit em modo apenas informativo (M-004)**
- ⏳ **Decidido**: P3, não urgente. Modo configurável `warn/enforce` é backlog estrutural.
- Fix P3: variável `HOOKS_PRE_COMMIT_MODE=warn|enforce` lida pelo hook.

---

## 4. Issues Abertas — Classificadas por Prioridade

### P0 — Fazer imediatamente (sistema parcialmente quebrado)

| ID    | Issue                       | Script(s) afetado(s)                  | Fix                                             |
| ----- | --------------------------- | ------------------------------------- | ----------------------------------------------- |
| G9-01 | ~~pre-push não instalado~~  | `.git/hooks/`, `install-git-hooks.sh` | ✅ **RESOLVIDO Fase 9** — pre-push reinstalado   |
| G9-02 | ~~audit.jsonl 6315 linhas~~ | `session-start.sh`, `watchdog.sh`     | ✅ **RESOLVIDO Fase 9** — rotate-audit.sh criado |

### P1 — Esta sessão ou próxima

| ID    | Issue                       | Script(s) afetado(s) | Fix                                                         |
| ----- | --------------------------- | -------------------- | ----------------------------------------------------------- |
| G9-03 | ~~UNAUTHORIZED_CLOSE.flag~~ | `session-start.sh`   | ✅ **RESOLVIDO Fase 9** — auto-clear stale flag implementado |
| G9-04 | ~~Sessão órfã no watchdog~~ | `agent-stop.sh`      | ✅ **RESOLVIDO Fase 9** — HEAL v2 implementado               |
| G9-05 | ~~Raw logs ativos~~         | (logs deletados)     | ✅ **RESOLVIDO Fase 9** — deletados + purge no rotate        |

### P2 — Próximas sessões de melhoria

| ID    | Issue                      | Script(s) afetado(s)                                 | Fix                                                                |
| ----- | -------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| G9-06 | ~~Sem events-contract.md~~ | `.github/hooks/contracts/`                           | ✅ **RESOLVIDO Fase 9** — events-contract.md criado                 |
| G9-07 | ~~Sem common.sh~~          | `.github/hooks/hooks-lib/`                           | ✅ **RESOLVIDO Fase 9** — common.sh criado com 7 funções            |
| G9-08 | Integrar flock             | `agent-stop.sh`, `post-tool-use.sh`, `log-prompt.sh` | ⏳ Parcial: `session-end.sh` tem flock (REV4-07); sponge nos demais |
| G9-09 | Docs desatualizados        | `DOCUMENTAÇÃO/HOOKS/README.md`                       | ⏳ Atualizar após Fase 9 completa (coincide com G9-13)              |

### P3 — Backlog estrutural

| ID    | Issue                     | Esforço | Valor                   | Status                                          |
| ----- | ------------------------- | ------- | ----------------------- | ----------------------------------------------- |
| G9-10 | ~~Smoke-test section 15~~ | Médio   | Prevenção de regressões | ✅ RESOLVIDO Fase 9                              |
| G9-11 | Redaction estrutural      | Alto    | Segurança de logs       | ⏳ Pendente                                      |
| G9-12 | Schemas JSON formais      | Médio   | Contrato versionado     | ✅ `session-context.schema.json` criado (Fase 9) |
| G9-13 | README.md Schema v8       | Médio   | Documentação atualizada | ⏳ Pendente                                      |
| G9-14 | Pre-commit configurável   | Baixo   | Governança leve         | ⏳ Pendente/Backlog                              |

---

## 5. Roadmap — Fase 9 e além

### Fase 9 — Hotfix operacional + auto-rotação de logs (P0+P1)

**objetivo**: restaurar rastreio de push e controlar crescimento de logs

#### F9-01 — Reinstalar hook git `pre-push`
```bash
bash .github/hooks/scripts/install-git-hooks.sh
# Verificar: ls -la .git/hooks/pre-push
# CI gate: ls .git/hooks/pre-push && bash -n .git/hooks/pre-push
```

#### F9-02 — Auto-rotação de `audit.jsonl` em `session-start.sh`
- Threshold: 5000 linhas
- Ação: mover para `logs/audit-YYYYMMDD.jsonl` e recriar `audit.jsonl` vazio
- Localização do fix: início de `session-start.sh`, antes de qualquer query
- Script auxiliar sugerido: `rotate-audit.sh` (chamado por session-start e pode ser usado manualmente)

```bash
# Exemplo de lógica:
AUDIT_LINES=$(wc -l < "$AUDIT_FILE")
if [ "$AUDIT_LINES" -gt 5000 ]; then
    ARCHIVE="$LOGS_DIR/audit-$(date -u +%Y%m%d_%H%M%S).jsonl"
    mv "$AUDIT_FILE" "$ARCHIVE"
    touch "$AUDIT_FILE"
    log "audit.jsonl rotacionado → $ARCHIVE ($AUDIT_LINES linhas)"
fi
```

#### F9-03 — Reset do flag UNAUTHORIZED_CLOSE (P1 operacional)
```bash
bash .github/hooks/scripts/reset-auth-violation.sh
```

#### F9-04 — Limpeza de sessão órfã no watchdog (P1)
- Em `session-start.sh`: se watchdog detectar SESSION_STALE ao iniciar nova sessão,
  registrar evento `sessionEnd_stale_cleanup` para a sessão antiga e limpar o flag.
- Alternativa imediata: `bash .github/hooks/scripts/session-end.sh manual_cleanup`

#### F9-05 — Desabilitar/limitar raw logs (P1 segurança)
- Em `pre-tool-use.sh`: adicionar flag `HOOKS_RAW_LOG_ENABLED=${HOOKS_RAW_LOG_ENABLED:-false}`
- Adicionar TTL: purge de arquivos raw com mais de 24h no início de cada sessão

**Critérios de aceite da Fase 9 (P0+P1):**
- [x] `.git/hooks/pre-push` existe e é executável ✅
- [x] `git push` dispara `on-git-push.sh` e registra evento em `audit.jsonl` ✅
- [x] `audit.jsonl` < 5000 linhas após o início da sessão ✅ (501 linhas pós-rotação)
- [x] `UNAUTHORIZED_CLOSE.flag` stale auto-limpo ✅
- [x] HEAL v2 implementado em `agent-stop.sh` ✅
- [x] Raw logs deletados e purge automático no rotate ✅
- [x] `events-contract.md` criado ✅
- [x] `hooks-lib/common.sh` criado (7 funções, shellcheck OK) ✅
- [x] Smoke-test 106/106 PASS com seção 15 G9 ✅
- [ ] `hl_with_lock()` integrada nos scripts críticos (G9-08)
- [ ] Redaction estrutural por allowlist (G9-11)
- [ ] `session-context.schema.json` criado (G9-12)
- [ ] README.md atualizado para Schema v8 (G9-13)
- [ ] Todos os scripts modificados: shellcheck 0 erros ✅ (verificado para scripts alterados)

---

### Fase 10 — Qualidade e precisão (P2)

#### F10-01 — ~~events-contract.md~~
- ✅ **RESOLVIDO na Fase 9** (G9-06) — `.github/hooks/contracts/events-contract.md` criado

#### F10-02 — ~~HEAL v2 (mismatch reconciliation)~~
- ✅ **RESOLVIDO na Fase 9** (G9-04) — implementado em `agent-stop.sh` com N_HEAL_THRESHOLD=3

#### F10-03 — flock granular em session-context.json
Wrapper para escrita de `session-context.json`:
```bash
with_ctx_lock() {
    local lock_file="$CTX_FILE.lock"
    (flock -x 9; "$@") 9>"$lock_file"
}
```
Aplicar apenas nas escritas (não leituras) dos scripts de maior frequência.

#### F10-04 — Atualizar documentação DOCUMENTAÇÃO/HOOKS/
- `README.md`: Schema v8, 31 scripts, hooks Git corretos (pre-push), versão atualizada
- `REFERENCIA-HOOKS.md`: adicionar hooks novos (error-occurred, subagent-stop, etc.)
- `AUDIT-SCHEMA.md`: refletir Schema v8

**Critérios de aceite da Fase 10:**
- [ ] `events-contract.md` criado e referenciado no README
- [ ] HEAL v2 testado em sandbox com mismatches consecutivos
- [ ] `flock` funcional sem regressão de latência (< 50ms overhead em teste local)
- [ ] Docs DOCUMENTAÇÃO/HOOKS atualizados com versões corretas

---

### Fase 11 — Refactor estrutural (P3)

#### F11-01 — ~~`hooks-lib/common.sh`~~
- ✅ **RESOLVIDO na Fase 9** (G9-07) — `hooks-lib/common.sh` criado com 7 funções (shellcheck OK)
- Funções: `hl_iso_now`, `hl_get_session_id`, `hl_log_event`, `hl_write_ctx`, `hl_with_lock`, `hl_redact`, `hl_check_session_guard`
- Integração nos scripts existentes permanece como item pendente (substituição incremental).

#### F11-02 — Smoke-test comportamental
Substituir checks textuais por cenários end-to-end em sandbox:
1. `sessionStart` → arquivo de briefing gerado
2. `userPromptSubmitted` + intenção → turn ativo no contexto
3. `preToolUse` + `postToolUse` → métricas incrementadas
4. `agentStop` sem `vscode_askQuestions` → decision:block retornado
5. `git push` em repo temporário → `on-git-push.sh` dispara e registra evento
6. `sessionEnd` com close_key → encerramento limpo

#### F11-03 — Schemas JSON formais
Criar validadores de contrato:
- `contracts/events.schema.json`: campos obrigatórios de cada evento
- `contracts/session-context.schema.json`: estrutura de estado esperada
- Script `hooks-verify-contracts.sh`: valida produtores e consumidores contra schemas

#### F11-04 — Redaction estrutural
Substituir regex em string por allowlist de chaves logáveis:
```bash
LOGGABLE_FIELDS=("session_id" "tool_name" "event" "timestamp" "cwd")
# Drop de qualquer campo não na allowlist antes de logar
```

#### F11-05 — Pre-commit configurável
```bash
# .github/hooks/hooks.env (ou variável de ambiente)
HOOKS_PRE_COMMIT_MODE=warn   # warn | enforce
# No hook .git/hooks/pre-commit:
[ "$HOOKS_PRE_COMMIT_MODE" = "enforce" ] && exit "$GATE_RESULT" || exit 0
```

---

## 6. Critérios de Aceite por Nível

### Gate mínimo para qualquer mudança em scripts de hooks
- `bash -n script.sh` → sem erros de sintaxe
- `shellcheck -x script.sh` → 0 erros, 0 avisos relevantes
- Smoke-test passa: `bash .github/hooks/scripts/smoke-test.sh`
- Sem regressão funcional (verificar session-start + agent-stop manualmente)

### Gate para fase completa
- Todos os critérios de aceite específicos da fase (ver seções acima)
- 0 novos findings de severidade > medium introduzidos
- Documentação atualizada (pelo menos REFERENCIA-HOOKS.md e este arquivo)

---

## 7. Guia de Manutenção Contínua

### Rotina de início de sessão (para o agente)
1. Ler `state/session-briefing.md`
2. Ler este arquivo (`STATUS-E-ROADMAP.md`) para pegar o contexto atual
3. Verificar `state/watchdog-report.json` para anomalias
4. Executar `bash watchdog.sh --json` se watchdog reportar CRITICAL
5. Chamar `start-turn.sh` e `vscode_askQuestions` conforme protocolo

### Como registrar um novo bug descoberto
```bash
bash .github/hooks/scripts/save-finding.sh \
    ".github/hooks/scripts/nome-do-script.sh" \
    "high" \
    "bug" \
    "Descrição clara do problema e impacto"
```
E adicionar à seção 4 deste arquivo com ID sequencial.

### Como registrar uma tarefa nova
```bash
bash .github/hooks/scripts/add-task.sh "alta" "Título" "Descrição + gate de aceite"
```

### Como concluir uma fase
1. Executar todos os critérios de aceite
2. Marcar itens como ✅ nas seções 4 e 5 deste arquivo
3. Atualizar a tabela de [Histórico de Fases](#2-histórico-de-fases)
4. Atualizar `[10. Changelog deste Documento](#10-changelog-deste-documento)`
5. `bash .github/hooks/scripts/complete-task.sh "<padrão>"`

### Limiares de health

| Métrica                             | Verde  | Amarelo   | Vermelho |
| ----------------------------------- | ------ | --------- | -------- |
| `audit.jsonl` linhas                | < 3000 | 3000–5000 | > 5000   |
| Findings críticos/high abertos      | 0      | 1–2       | ≥ 3      |
| Turnos não autorizados consecutivos | 0      | 1         | ≥ 2      |
| Sessão órfã (SESSION_STALE)         | n/a    | n/a       | Qualquer |
| `UNAUTHORIZED_CLOSE.flag` presente  | n/a    | n/a       | Qualquer |

### Rotação manual de audit.jsonl
```bash
ARCHIVE=".github/hooks/logs/audit-$(date -u +%Y%m%d_%H%M%S).jsonl"
cp .github/hooks/logs/audit.jsonl "$ARCHIVE"
echo "[]" > .github/hooks/logs/audit.jsonl  # NÃO use > sozinho (trunca com race)
# Ou preferir:
jq -c '.' "$ARCHIVE" | tail -500 > .github/hooks/logs/audit.jsonl  # mantém 500 linhas recentes
echo "Rotação concluída. Arquivo de arquivo: $ARCHIVE"
```

---

## 8. Contratos de Eventos (Tabela Canônica)

> Fonte de verdade provisória até que `events-contract.md` seja criado (G9-06).

### Eventos do ciclo de vida

| Evento                    | Produtor           | Campos obrigatórios                                      | Consumidores principais   |
| ------------------------- | ------------------ | -------------------------------------------------------- | ------------------------- |
| `sessionStart`            | `session-start.sh` | `session_id`, `timestamp`, `source`                      | watchdog                  |
| `sessionEnd`              | `session-end.sh`   | `session_id`, `timestamp`, `end_reason`                  | session-start (histórico) |
| `sectionStart`            | `start-section.sh` | `session_id`, `timestamp`, `section_id`, `section_name`  | generate-section-summary  |
| `sectionEnd`              | `section-end.sh`   | `session_id`, `timestamp`, `section_id`, `duration_s`    | analytics                 |
| `turnStart`               | `log-prompt.sh`    | `session_id`, `timestamp`, `turn_number`, `section_turn` | session-start (stats)     |
| `turnStart_enriched_auto` | `agent-stop.sh`    | `session_id`, `timestamp`, `tools_used`                  | analytics                 |
| `turnEnd_AUTHORIZED`      | `agent-stop.sh`    | `session_id`, `timestamp`, `turn_number`                 | compliance                |
| `turnEnd_UNAUTHORIZED`    | `agent-stop.sh`    | `session_id`, `timestamp`, `turn_number`                 | compliance, watchdog      |

### Eventos de ferramentas

| Evento           | Produtor              | Campos obrigatórios                                   | Notas                                     |
| ---------------- | --------------------- | ----------------------------------------------------- | ----------------------------------------- |
| `preToolUse`     | `pre-tool-use.sh`     | `session_id`, `timestamp`, `tool_name`, `tool_use_id` | guarda tool_args (redacted)               |
| `postToolUse`    | `post-tool-use.sh`    | `session_id`, `timestamp`, `tool_name`, `result_type` | `result_type`: success\|error\|unknown    |
| `toolUseFailure` | `tool-use-failure.sh` | `session_id`, `timestamp`, `tool_name`                | ~~toolFailure~~ (legado, ainda dual-read) |

### Eventos de estado

| Evento                | Produtor                | Campos obrigatórios                                 | Notas                                      |
| --------------------- | ----------------------- | --------------------------------------------------- | ------------------------------------------ |
| `gitPush`             | `on-git-push.sh`        | `session_id`, `timestamp`, `refs_pushed`            | requer `pre-push` instalado                |
| `session_id_mismatch` | guards em 6 scripts     | `session_id`, `expected`, `got`                     | pode ser falso positivo legado             |
| `session_id_healed`   | HEAL v1                 | `session_id`, `adopted_id`, `reason`                | adota payload quando fonte=manual_recovery |
| `finding`             | `save-finding.sh`       | `session_id`, `timestamp`, `finding_id`, `severity` | rastreado em `findings.jsonl`              |
| `findingResolved`     | `resolve-finding.sh`    | `session_id`, `timestamp`, `finding_id`             | deve fechar finding em aberto              |
| `checkpoint`          | `session-checkpoint.sh` | `session_id`, `timestamp`, `tasks_hash`             | salva estado snapshottable                 |

### Status de renaming de evento (para evitar confusão futura)

| Nome antigo   | Nome atual       | Desde    | Estado de migração                                                 |
| ------------- | ---------------- | -------- | ------------------------------------------------------------------ |
| `toolFailure` | `toolUseFailure` | Fase 5~6 | dual-read implementado; legado ainda pode aparecer em logs antigos |
| `post-push`   | `pre-push`       | Fase 8   | script corrigido; hook não reinstalado (G9-01)                     |

---

## 9. Dependências e Referências Cruzadas

### Documentação associada

| Documento                  | Localização                                            | Status                                | Relação                                   |
| -------------------------- | ------------------------------------------------------ | ------------------------------------- | ----------------------------------------- |
| README do sistema de hooks | `DOCUMENTAÇÃO/HOOKS/README.md`                         | ⚠️ Desatualizado (diz v4.0/Schema v4)  | Ponto de entrada para devs                |
| Referência de hooks        | `DOCUMENTAÇÃO/HOOKS/REFERENCIA-HOOKS.md`               | ⚠️ Verificar atualidade                | Lista de todos os hooks e scripts         |
| Protocolo de autorização   | `DOCUMENTAÇÃO/HOOKS/PROTOCOLO-AUTORIZACAO.md`          | Verificar                             | Spec técnico do fluxo de auth             |
| Audit schema               | `DOCUMENTAÇÃO/HOOKS/AUDIT-SCHEMA.md`                   | ⚠️ Pode estar em Schema v7 ou anterior | Schema de session-context.json            |
| Melhorias                  | `DOCUMENTAÇÃO/HOOKS/MELHORIAS.md`                      | Verificar                             | Itens implementados nas fases anteriores  |
| Hooks protocol             | `.github/instructions/hooks-protocol.instructions.md`  | ✅ Atualizado                          | Protocolo para agentes (regras absolutas) |
| Copilot instructions       | `.github/copilot-instructions.md`                      | ✅ Atualizado                          | Contexto operacional geral                |
| Auditoria CODEX            | `.github/hooks/AUDITORIA CODEX — Sistema de Hooks .md` | Histórico                             | Auditoria original de 2026-03-09          |
| Upgrade Fase 8             | `.github/hooks/UPGRADE-PLAN-FASE8.md`                  | Histórico                             | Plano detalhado da Fase 8                 |
| Consolidação v3            | `.github/hooks/PLANO-CONSOLIDACAO-v3.md`               | Concluído                             | Hardening v5 + documentação               |

### Scripts e suas dependências

| Script                     | Depende de                             | Chamado por                              |
| -------------------------- | -------------------------------------- | ---------------------------------------- |
| `session-start.sh`         | `jq`, `sponge`, `openssl`, `awk`       | copilot-hooks (sessionStart)             |
| `agent-stop.sh`            | `session-context.json`, `jq`, `sponge` | copilot-hooks (agentStop)                |
| `pre-tool-use.sh`          | `session-context.json`, `jq`, `sponge` | copilot-hooks (preToolUse)               |
| `post-tool-use.sh`         | `session-context.json`, `jq`, `sponge` | copilot-hooks (postToolUse)              |
| `log-prompt.sh`            | `session-context.json`, `jq`, `sponge` | copilot-hooks (userPromptSubmitted)      |
| `start-turn.sh`            | `log-prompt.sh` ou direct CTX_FILE     | chamado manualmente pelo agente          |
| `start-section.sh`         | `section-end.sh`, CTX_FILE             | chamado pelo agente (mudança de fase)    |
| `on-git-push.sh`           | CTX_FILE, `audit.jsonl`                | `.git/hooks/pre-push` (quando instalado) |
| `install-git-hooks.sh`     | `.github/hooks/scripts/`               | chamado pelo agente para instalar hooks  |
| `watchdog.sh`              | CTX_FILE, `audit.jsonl`                | session-start, ou manualmente            |
| `generate-daily-report.sh` | `audit.jsonl`, `tool-metrics.jsonl`    | manualmente ou scheduled                 |
| `smoke-test.sh`            | todos os scripts                       | CI ou manualmente após mudanças          |

---

## 10. Changelog deste Documento

| Data       | Versão | Autor                   | Mudanças                                                                                                                                                                                              |
| ---------- | ------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-03-10 | 1.0    | Agente (GitHub Copilot) | Criação inicial — consolida AUDITORIA CODEX, UPGRADE-PLAN-FASE8, PLANO-CONSOLIDACAO-v3 e diagnóstico fresh do estado do repositório em main/commit e22e8730                                           |
| 2026-03-10 | 2.0    | Agente (GitHub Copilot) | Fase 9 concluída (G9-01..G9-10): pre-push reinstalado, rotate-audit, HEAL v2, flag stale clear, raw-logs deletados, events-contract.md, common.sh, smoke-test 106/106 PASS. G9-08/11/12/13 pendentes. |

---

*Este documento deve ser atualizado sempre que:*
- *Uma fase for concluída (marcar ✅ e registrar em Histórico de Fases)*
- *Um novo bug for descoberto (adicionar à seção 4 com ID sequencial)*
- *Uma decisão arquitetural for tomada (registrar em Guia de Manutenção)*
- *Um contrato de evento for alterado (atualizar seção 8)*
