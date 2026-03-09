# UPGRADE PLAN — Fase 8: Consolidação Pós-Auditoria CODEX
**Gerado em:** 2026-03-09
**Baseado em:** AUDITORIA CODEX — Sistema de Hooks .md + análise independente do agente
**Escopo:** `.github/hooks/scripts/`, `.git/hooks/`, estado e logs do sistema
**Branch de trabalho:** main (a partir do commit da Fase 7: `1674615b`)

---

## 1. Contexto e Metodologia

### Fontes analisadas
1. **CODEX Audit Report** — auditoria técnica produzida pelo modelo CODEX (2026-03-09),
   com inspeção estática de scripts, contratos de eventos e estado.
2. **Análise própria do agente** — verificação ativa do estado atual pós-Fase 7,
   confirmando o que ainda se aplica e o que foi resolvido.

### Estado do repositório ao analisar
- Commit HEAD: `1674615b` (Fase 7 — IDs únicos, Schema v8, fix session_id_mismatch)
- shellcheck: 0 erros/avisos em 15 scripts
- CTX_FILE: `session.source = "healed_from_real_session"` (mismatch resolvido)

---

## 2. Avaliação Crítica dos Achados do CODEX

### 2.1 Achados Críticos (H-001 a H-002)

#### H-001 — Hook Git de push instalado com nome inválido (`post-push`)
**Status CODEX:** Crítico — `post-push` não existe como hook nativo Git.
**Verificação atual:** CONFIRMADO.
- `install-git-hooks.sh` instala arquivo em `.git/hooks/post-push`.
- Git não dispara `post-push` automaticamente — só `pre-push`, `post-merge`, etc.
- `.git/hooks/post-push` está ausente (hook não instalado via install-git-hooks.sh nesta sessão).
- `.git/hooks/post-commit` foi criado manualmente na Fase 7 — funciona corretamente.

**Avaliação do agente:** O CODEX está correto. Há duas situações distintas:
- O `on-git-push.sh` nunca é chamado via hook Git nativo.
- A Fase 7 criou `post-commit` (rastreio de commit) — separado e funcional.
- O rastreio de push dependia de `post-push` que nunca dispara.

**Decisão:** Migrar instalação para `pre-push`. Script `on-git-push.sh` já trata stdin
corretamente (lê `<local-ref> <local-sha1> <remote-ref> <remote-sha1>`).

**Prioridade:** P0 — o subsistema de push tracking está inativo.

---

#### H-002 — Crash do relatório diário por variável não definida (`ERRORS_TODAY`)
**Status CODEX:** Crítico — variável usada sem inicialização com `set -uo pipefail`.
**Verificação atual:** CONFIRMADO.
- `generate-daily-report.sh` usa `${ERRORS_TODAY}` em template heredoc sem inicializar antes.
- Com `set -u`, referência a variável não definida causa `exit 1` imediato.

**Avaliação do agente:** CODEX correto. A variável deve ser inicializada com query ao
`audit.jsonl` (count de eventos de erro do dia). Análogo ao `TOOLS_TOTAL` já existente.

**Prioridade:** P0 — relatório diário falha silenciosamente.

---

### 2.2 Achados Altos (H-003 a H-007)

#### H-003 — Divergência de schema (`.session_id` vs `.session.id`)
**Status CODEX:** Alto.
**Verificação atual:** CONFIRMADO em 2 scripts auditados:
- `add-task.sh`: lê `.session_id` (legado, resulta em string vazia).
- `complete-task.sh`: idem.
- Suspeita: `resolve-finding.sh`, `reset-auth-violation.sh` também afetados.

**Avaliação do agente:** CODEX correto. O Schema v6+ definiu `.session.id` mas scripts
de CRUD (tasks, findings) não foram atualizados. Impacto: `session_id` em eventos de
task/finding aparece vazio → métricas por sessão degradadas.

**Prioridade:** P1 — bug silencioso que corrompe dados de rastreio.

**Fix:** leitura com fallback: `jq -r '.session.id // .session_id // ""'` (temporário),
depois migração para `.session.id` canônico.

---

#### H-004 — Contrato divergente (`toolFailure` vs `toolUseFailure`)
**Status CODEX:** Alto.
**Verificação atual:** CONFIRMADO.
- `tool-use-failure.sh` (produtor): usa `toolUseFailure` (5 ocorrências).
- `session-start.sh` + `generate-session-summary.sh` (consumidores): leem `toolFailure` (3 ocorrências).
- Resultado: falhas de ferramenta não aparecem nos relatórios de sessão.

**Avaliação do agente:** CODEX correto. O nome foi alterado em alguma fase anterior,
mas consumidores não foram sincronizados. Dois campos canônicos (`toolFailure` vs
`toolUseFailure`) coexistem gerando subcontagem.

**Prioridade:** P1 — métricas de falha incorretas.

**Fix:** migrar consumidores para leitura dual (`toolFailure`, `toolUseFailure`) → depois
padronizar para `toolUseFailure`.

---

#### H-005 — Flood de `session_id_mismatch` e bloqueio de escrita
**Status CODEX:** Alto.
**Verificação atual:** RESOLVIDO na Fase 7.
- HEAL v1 implementado em 4 scripts: quando `source=manual_recovery`, adota payload session_id.
- CTX_FILE atualizado manualmente + evento `session_id_healed` registrado.
- 395+ bloqueios históricos não ocorrerão novamente para o mesmo cenário.

**Avaliação do agente:** O fix implementado é correto e cobre o caso identificado.
Porém, a lógica de heal atual só trata `source=manual_recovery`. Casos futuros de
desincronização por outras causas ainda resultariam em flood. Sugere-se upgrade para
**reconciliação por contagem consecutiva** (ex: após 5 mismatches consecutivos com
mesmo "got", adotar o novo session_id) — isso cobre casos além do `manual_recovery`.

**Prioridade:** P2 — melhoria incremental sobre fix já em produção.

---

#### H-006 — `reset-auth-violation.sh` escreve campos legados
**Status CODEX:** Alto.
**Verificação atual:** CONFIRMADO.
- Escreve `.consecutive_unauthorized_closes = 0` e `.last_close_authorized = true`.
- Campos canônicos reais: `.compliance.consecutive_unauthorized` e `.compliance.last_turn_authorized`.
- Resultado: reset parece ter sucesso mas não altera os campos usados pelo sistema.

**Avaliação do agente:** CODEX correto. Impacto direto: violações de autorização não
são resetadas efetivamente.

**Prioridade:** P1 — funcionalidade de reset quebrada.

---

#### H-007 — Ausência de locking transacional
**Status CODEX:** Alto.
**Verificação atual:** CONFIRMADO — 0 usos de `flock` em scripts.
**Avaliação do agente:** CODEX correto sobre o risco, mas com nuançamento importante:
- `sponge` oferece escrita atômica simples (cria temp, depois rename).
- Os scripts já usam `sponge` como padrão — issue é que escrita há uma janela de vulnerabilidade entre reads.
- Race condition real ocorreria com múltiplas chamadas simultâneas de hooks (ex: dois `pre-tool-use.sh` paralelos).
- Em prática, hooks Copilot são serializados — risco é baixo mas real.

**Prioridade:** P2 — melhoria de confiabilidade, não urgente operacionalmente.

**Fix sugerido:** `flock` granular apenas em escritas de `session-context.json`; `audit.jsonl` já é append-only (mais seguro).

---

### 2.3 Achados Médios (M-001 a M-004)

#### M-001 — `smoke-test.sh` com validações frágeis
**Status CODEX:** Médio.
**Avaliação do agente:** CONFIRMADO PARCIALMENTE.
- Smoke-test valida presença de texto (ex: `post-push`) em vez de comportamento.
- Com a Fase 7 e fix H-001 pendente, alguns checks ficarão desatualizados.
**Prioridade:** P2 — atualizar após fixes P0/P1.

---

#### M-002 — Métricas de seção contam sessão inteira
**Status CODEX:** Médio.
**Verificação atual:** CONFIRMADO.
- `generate-section-summary.sh` queries filtram por `session_id`, não por janela temporal da seção.
- Fase 7 adicionou `section_id` em eventos, então agora é possível filtrar por seção.
**Avaliação do agente:** CODEX correto. Com section_id disponível nos eventos (Fase 7),
a query pode ser refinada para `select(.section_id == $section_id)`.
**Prioridade:** P2 — melhoria de precisão de métricas.

---

#### M-003 — Timestamps inconsistentes
**Status CODEX:** Médio.
**Verificação atual:** PARCIALMENTE RESOLVIDO.
- Fase 7 adicionou `timestamp` nos eventos de mismatch e healed.
- Outros eventos ainda podem ter timestamps nulos ou do payload (não garantidos).
**Avaliação do agente:** Fase 7 melhorou mas não resolveu completamente.
**Prioridade:** P2 — normalização incremental.

---

#### M-004 — Pre-commit apenas informativo
**Status CODEX:** Médio.
**Avaliação do agente:** DISCORDO DA PRIORIDADE.
- O pre-commit atual é informativo intencionalmente (política de não bloquear dev local).
- Bloquear commits por padrão aumenta atrito sem ganho proporcional (CI já garante qualidade).
- Modo configurável (`warn`/`enforce`) é válido como melhoria, mas não urgente.
**Prioridade:** P3 — nice-to-have, não risco operacional.

---

### 2.4 Segurança (S-001, S-002)

#### S-001 — Persistência de raw-input.jsonl
**Status CODEX:** Alto (segurança).
**Avaliação do agente:** VÁLIDO.
- `raw-input.jsonl` pode conter prompts brutos não redacted históricos.
- Risco em ambiente compartilhado ou push unintencional.
**Prioridade:** P1 — purge de raw logs e TTL automático.

---

#### S-002 — Redaction por regex insuficiente
**Status CODEX:** Médio.
**Avaliação do agente:** VÁLIDO MAS COMPLEXO.
- Redaction estrutural (allowlist) é arquiteturalmente superior ao regex em string.
- Porém, é um refactor significativo dos hooks de pre-tool-use.
**Prioridade:** P3 — melhorar incrementalmente.

---

## 3. Gaps Adicionais Identificados Pelo Agente (Não no CODEX)

### A-001 — `generate-section-summary.sh` abre dois reads de CTX_FILE sem lock
**Tipo:** Consistência
**Descrição:** A geração de summary lê `CTX_FILE` em momentos distintos (para
`TURN_TYPE`, `PUSH_COUNT`, etc.), com possível mudança de estado entre reads.
Com `sponge` como única proteção, um `start-section.sh` paralelo poderia corromper a view.
**Prioridade:** P3 (risco baixo na prática)

### A-002 — `session-start.sh` fallback de CLOSE_KEY pode ser determinístico
**Tipo:** Segurança leve
**Descrição:** O fallback `$(date +%s | sha256sum | head -c 8)` produz close key
determinística (timestamp é previsível). Corrigido parcialmente na Fase 7 com
`tr '[:lower:]' '[:upper:]'`, mas a entropia de `date +%s` é baixa.
**Fix:** Usar `openssl rand -hex 4` como único path, sem fallback determinístico.
**Prioridade:** P2 — close_key com entropia adequada.

### A-003 — Ausência de `events-contract.md` centralizado
**Tipo:** Governança
**Descrição:** Não há documento único que liste todos os eventos com campos obrigatórios,
tipos e produtor/consumidor. Qualquer mudança de nome (como toolFailure→toolUseFailure)
passa sem registro formal.
**Prioridade:** P2 — documento único seria a âncora de contratos futuros.

### A-004 — `section_id` na query de ferramentas em `generate-section-summary.sh`
**Tipo:** Precisão (extensão de M-002)
**Descrição:** Com section_id disponível nos eventos pós-Fase 7, a query de ferramentas
pode ser feita por seção em vez de sessão inteira. Isso é uma extensão direta de M-002
já com os dados disponíveis.
**Fix:** `select(.section_id == $section_id and .event == "preToolUse")` em vez de
`select(.session_id == $sid and .event == "preToolUse")`
**Prioridade:** P2 — métricas de seção precisas.

---

## 4. O Que o CODEX Disse Que Não Se Aplica ou Está Superado

| Item CODEX                  | Avaliação                | Motivo                                                                         |
| --------------------------- | ------------------------ | ------------------------------------------------------------------------------ |
| H-005 (mismatch flood)      | ✅ Resolvido              | Fase 7: HEAL v1 em 4 scripts                                                   |
| M-003 (timestamps)          | ⚠️ Parcialmente resolvido | Fase 7 adicionou timestamps em novos eventos                                   |
| Sec. 7 (arquitetura alvo)   | ⚠️ Válido mas ambicioso   | `hooks-lib/common.sh` é refactor de longa duração; priorizar fixes P0/P1 antes |
| M-004 (pre-commit blocking) | ❌ Discordo da urgência   | Não é risco operacional; P3                                                    |

---

## 5. Plano de Execução — Fase 8

### P0 — Hotfixes críticos (executar imediatamente)

| ID     | Arquivo(s)                 | Fix                                                               |
| ------ | -------------------------- | ----------------------------------------------------------------- |
| F8-01  | `install-git-hooks.sh`     | Migrar `post-push` → `pre-push` no nome e na lógica de instalação |
| F8-01b | `smoke-test.sh`            | Atualizar checks de hook name de `post-push` → `pre-push`         |
| F8-02  | `generate-daily-report.sh` | Inicializar `ERRORS_TODAY` com query ao `audit.jsonl`             |

---

### P1 — Bugs de dados e contrato (alta prioridade, executar na sequência)

| ID    | Arquivo(s)                                                                         | Fix                                                                                                                |
| ----- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| F8-03 | `add-task.sh`, `complete-task.sh`, `resolve-finding.sh`, `reset-auth-violation.sh` | Migrar `.session_id` → `.session.id` (com fallback temporário)                                                     |
| F8-04 | `reset-auth-violation.sh`                                                          | Migrar campos legados → `.compliance.consecutive_unauthorized` e `.compliance.last_turn_authorized`                |
| F8-05 | `session-start.sh`, `generate-session-summary.sh`                                  | Consumidores: `toolFailure` → dual read (`toolFailure`, `toolUseFailure`); depois padronizar para `toolUseFailure` |
| F8-06 | `pre-tool-use.sh`                                                                  | Purge / desabilitação de `raw-input.jsonl` por padrão (ou TTL de 24h)                                              |

---

### P2 — Melhorias de qualidade e precisão

| ID    | Arquivo(s)                    | Fix                                                                                                 |
| ----- | ----------------------------- | --------------------------------------------------------------------------------------------------- |
| F8-07 | `generate-section-summary.sh` | Filtrar ferramentas por `section_id` em vez de `session_id` (extensão de M-002 + A-004)             |
| F8-08 | `session-start.sh`            | Melhorar entropia do fallback de CLOSE_KEY (A-002)                                                  |
| F8-09 | `agent-stop.sh`               | Heal v2: reconciliação por contagem consecutiva de mismatches (cobertura além de `manual_recovery`) |
| F8-10 | `.github/hooks/contracts/`    | Criar `events-contract.md` listando eventos, campos obrigatórios, produtores e consumidores (A-003) |
| F8-11 | Scripts críticos              | Introduzir `flock` granular em escritas de `session-context.json` (H-007)                           |

---

### P3 — Refactor estrutural e governança (backlog)

| ID    | Arquivo(s)                 | Fix                                                                                         |
| ----- | -------------------------- | ------------------------------------------------------------------------------------------- |
| F8-12 | `smoke-test.sh`            | Reescrever para cenários comportamentais completos (M-001)                                  |
| F8-13 | `hooks-lib/common.sh`      | Criar biblioteca comum (`log_event`, `get_session_id`, `iso_now`, `with_lock`, `write_ctx`) |
| F8-14 | `.github/hooks/contracts/` | Schemas JSON formais (`events.schema.json`, `session-context.schema.json`)                  |
| F8-15 | Pre-commit hook            | Modo configurável `warn`/`enforce` (M-004)                                                  |
| F8-16 | `pre-tool-use.sh`          | Redaction estrutural com allowlist (S-002)                                                  |

---

## 6. Critérios de Aceite para Fase 8 P0+P1

- `on-git-push.sh` dispara automaticamente no `git push` (verificado com test push).
- `generate-daily-report.sh` executa sem crash, `ERRORS_TODAY` calculado.
- Eventos de tasks/findings têm `session_id` correto (não vazio).
- `reset-auth-violation.sh` atualiza `.compliance.*` corretamente.
- Consumidores de `toolFailure` passam a ler `toolUseFailure` (taxas de falha coerentes).
- Raw logs não são capturados em modo padrão.
- shellcheck: 0 erros em todos os scripts modificados.

---

## 7. Riscos e Mitigações

| Risco                                                            | Mitigação                                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Migração `pre-push` quebra stdin parsing                         | Testar com `git push --dry-run` em sandbox antes de ativar                               |
| Dual-read de `toolFailure`+`toolUseFailure` duplicar contagem    | Usar `select(.event == "toolUseFailure" or .event == "toolFailure") \| .event` com dedup |
| Migração schema `.session_id` → `.session.id` em scripts legados | Fallback defensivo: `.session.id // .session_id // ""` por um ciclo                      |
| Hook lock com `flock` adicionar latência                         | Medir com `time bash hook.sh` antes e depois; lock só em escritas atômicas               |

---

## 8. Relação com Fases Anteriores

| Fase       | O que resolveu                                             | Gaps remanescentes                               |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------ |
| Fase 1-6   | Estrutura base, Schema v1→v7, events, session management   | Legado de `.session_id`, post-push, ERRORS_TODAY |
| Fase 7     | IDs UUID, Schema v8, fix session_id_mismatch, trace-commit | H-001, H-002, H-003, H-004, H-006 ainda ativos   |
| **Fase 8** | Hotfixes P0+P1, precisão de métricas P2, refactor P3       | —                                                |

---

*Documento gerado pelo agente em 2026-03-09 após análise do CODEX Audit Report e verificação
ativa do estado do repositório pós-Fase 7. Próximo passo: executar F8-01 (post-push → pre-push).*
