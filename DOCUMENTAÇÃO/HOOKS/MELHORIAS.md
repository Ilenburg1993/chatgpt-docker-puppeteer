# Melhorias e Upgrades Propostos — Sistema de Hooks

> **Status**: Backlog vivo | **Última atualização**: 2026-03-12 (Fase 10 — correções completas)

---

## Melhorias Implementadas (Fase 10 — 2026-03-12)

### Ciclo de Correções BUG-01..BUG-17 + GAP-01..GAP-05 + ROB-B + GAP-O1 ✅ IMPLEMENTADO

**Motivação**: auditoria profunda (subagente haiku + revisão manual) identificou 24+ bugs e gaps nos
11 scripts e na hooks-lib. Implementação incremental ao longo de 3 sessões.

**Resumo dos principais itens**:

1. **BUG-01..BUG-06**: Guards de session_id em todos os hooks principais (`log-prompt.sh`,
   `pre-tool-use.sh`, `post-tool-use.sh`, `agent-stop.sh`). RECONNECT-01/02/03 em `log-prompt.sh`.
   Inline_restart (BUG-06) adota CTX como fonte de verdade (PREMISSA 1).

2. **GAP-01..GAP-04**: Counter `session_id_mismatches` em `session-start.sh`; log-prompt.sh
   consistente com session-start.sh; HEAL extraído para `hooks-lib/common.sh` (heal_v1, heal_v2,
   increment_mismatch, ctx_update, ensure_dirs, log_audit_event).

3. **BUG-07..BUG-15**: Scripts secundários (`subagent-start.sh`, `subagent-stop.sh`,
   `tool-use-failure.sh`, `pre-compact.sh`, `session-end.sh`) recebem guards + HEAL + mismatch
   counter. Double-count `subagent_calls` corrigido. `subagent_delegated` reset implementado.

4. **BUG-16**: Guard de session_id em `tool-use-failure.sh` movido para ANTES dos writes de
   `audit.jsonl` e `errors.jsonl`.

5. **BUG-17**: HEALs inline de `manual_recovery` em `pre-tool-use.sh` e `post-tool-use.sh` agora
   atualizam `.session.vs_code_session_id`.

6. **GAP-05**: Schema `session-start.sh` completo com 7 novos campos em `session_stats` e
   `current_turn`.

7. **ROB-B**: Sourcing de `common.sh` padronizado em 8 scripts com mensagem `[WARN]` quando a lib
   não é encontrada.

8. **GAP-O1**: Log `session_id_sync_inline_restart` limitado a 5 ocorrências em `pre-tool-use.sh` e
   `post-tool-use.sh`. Após limite, emite evento `_cap`.

9. **ROB-C** (confirmado já implementado): padrão `jq -r ... 2>/dev/null || echo 'default'` uniforme
   em todos os scripts — nenhuma alteração necessária.

**Backlog remanescente** (Seção 4 de STATUS-E-ROADMAP.md):

- G10-01/INC-02: section_name default consistente
- G10-02/INC-03: padrão único de CTX update (sponge vs mktemp)
- G10-03/UPG-01: separação VS Code vs sessão lógica (Schema v9)

---

## Melhorias Implementadas (sessão 8 — 2026-03-10)

### Consolidação v3 — Hardening copilot-instructions + Guards completos ✅ IMPLEMENTADO

**Motivação**: copilot-instructions.md não mencionava o sistema de hooks, o ciclo de vida
SESSION/SECTION/TURN, ou os mecanismos de segurança. session_id guards cobriam apenas 3 de 6 hooks
auto-triggered que modificam estado.

**Implementação (Plano de Consolidação v3)**:

1. **copilot-instructions.md hardening**:
   - Adicionada seção "Ciclo de Vida — SESSION, SECTION, TURN" com glossário, invariante e
     comportamentos automáticos/manuais
   - Seção ⛔ REGRA ABSOLUTA expandida com mecanismos de enforcement (decision:block, session_id
     guards, flags)
   - Adicionado protocolo de encerramento de SESSION com close_key e Template F
   - Referências a AGENTS.md, PROTOCOLO-AUTORIZACAO.md e REFERENCIA-HOOKS.md

2. **session_id guards completos** (6 de 6 hooks):
   - `log-prompt.sh` — valida antes de resetar current_turn (vetor crítico)
   - `error-occurred.sh` — valida antes de incrementar failures_detected
   - `subagent-stop.sh` — valida antes de incrementar subagent_calls
   - Padrão idêntico aos 3 guards anteriores (agent-stop, pre-tool-use, post-tool-use)

3. **PROTOCOLO-AUTORIZACAO.md v3.0**: documentados Layer 3.5 (decision:block com anti-recursão) e
   Layer 3.6 (session_id guards com lista de 6 scripts cobertos)

4. **PLANO-CONSOLIDACAO-v2.md**: marcado como ✅ CONCLUÍDO e superado por v3

---

### Hardening v5 — decision:block + sandbox + session_id guards ✅ IMPLEMENTADO

**Motivação**: diagnóstico de root cause revelou que testes inline contaminaram session-context.json
com dados de sessão falsa (`test-sess-001`), fazendo close_key_validated=true incorretamente.
Adicionalmente, `pre-tool-use.sh` sobrescrevia `.session.id` com dados do payload.

**Implementação** (commit 1469986e):

1. **decision:block em agent-stop.sh**: quando TURN não chamou vscode_askQuestions, emite
   `{"decision":"block","systemMessage":"..."}` no stdout. Anti-recursão: `stop_hook_active` e
   `block_count` (max 1 retry).

2. **session_id guards** (3 scripts iniciais): `agent-stop.sh`, `pre-tool-use.sh`,
   `post-tool-use.sh` validam `session_id` do payload contra o contexto ativo. Mismatch → log
   `session_id_mismatch` + skip state write.

3. **Remoção de overwrite em pre-tool-use.sh**: removida linha que sobrescrevia `.session.id` com o
   `session_id` do payload — agora session_id é APENAS definido por `session-start.sh`.

4. **Smoke-test sandbox**: testes funcionais agora usam `mktemp -d` com scripts symlinkados,
   verificando hash do estado real antes e depois para garantir zero contaminação.

---

## Melhorias Implementadas (sessão 7 Phase 2 — 2026-03-10)

### Schema legado (v4) — Fluxo canônico SESSION / SECTION / TURN ✅ IMPLEMENTADO

**Motivação**: o Schema v3 inaugurou a SESSION CLOSE KEY, mas não havia um modelo invariante
garantindo que SESSION, SECTION e TURN estivessem _sempre_ ativos simultaneamente.
`current_section.name` podia ser `null`; não havia rastreamento de quantas seções ocorreram por
sessão; TURNs não tinham início explícito.

**Novos campos (schema legado v4)**:

| Campo            | Localização       | Valor inicial |
| ---------------- | ----------------- | ------------- |
| `section_count`  | `session_stats`   | `1`           |
| `section_names`  | `session_stats`   | `["início"]`  |
| `section_number` | `current_section` | `1`           |
| `section_name`   | `current_turn`    | `"início"`    |

**Scripts modificados**:

- `session-start.sh` — inicializa schema legado (v4); cria seção padrão `"início"` e loga
  `sectionStart`; adicionado bloco `📍 Estado Ativo` no briefing com seção + turno em destaque
- `start-section.sh` — auto-fecha seção anterior (full sectionEnd procedures) antes de abrir nova;
  incrementa `section_count`; appenda a `section_names[]`
- `log-prompt.sh` — inclui `section_name` no reset de `current_turn`; loga evento `turnStart`
- `section-end.sh` — lê e inclui `section_number` no evento `sectionEnd`
- `session-end.sh` — auto-fecha seção ativa antes de encerrar a sessão

**Novo script**: `start-turn.sh` — enriquecimento explícito de início de TURN; loga
`turnStart_enriched`

**Invariante garantida**: sempre deve haver SESSION + SECTION + TURN ativos. `"início"` é criada
automaticamente na `sessionStart`; `start-section.sh` auto-fecha a anterior; `session-end.sh`
auto-fecha a ativa.

**Documentação atualizada**: `AUDIT-SCHEMA.md` (sectionStart v4 + evento `turnStart` adicionado);
`README.md` (schema legado v4 + tabela de campos); `AGENTS.md` (protocolo + invariante
SECTION/TURN); `smoke-test.sh` (5 novas validações do schema legado v4)

---

### SESSION CLOSE KEY (sessão 7 Phase 1) ✅ IMPLEMENTADO — veja commit d3442cb8

> Cada item classifica: prioridade, esforço (S/M/L), e categoria (fix/melhoria/upgrade profundo).

---

## Melhorias Implementadas (sessão 6 — 2026-03-09)

### BUG-A — `START_EPOCH` unbound variable em `session-end.sh` ✅ CORRIGIDO

**Problema**: com `set -euo pipefail`, se `START_ISO` estiver vazio, o script crashava pois
`START_EPOCH` era definido somente dentro do bloco `if [ -n "$START_ISO" ]` mas usado fora dele.

**Fix**: adicionado `START_EPOCH=0` antes do bloco `if`, garantindo valor seguro mesmo quando a
sessão não tem `started_at` registrado.

---

### BUG-B — `end_at` escrito na raiz do JSON em vez de `.session.ended_at` ✅ CORRIGIDO

**Problema**: `session-end.sh` usava `. + {end_at: $ts, end_reason: $reason}` que adiciona os campos
à raiz do JSON, violando o schema canônico v2.

**Fix**: expressão jq alterada para `.session.ended_at = $ts | .session.end_reason = $reason`.

---

### BUG-C — Arquivos de estado não gitignored ✅ CORRIGIDO

**Problema**: `UNAUTHORIZED_CLOSE.flag`, `AUTHORIZED_CLOSE.flag` e `pending-tasks.md` não estavam no
`.gitignore` e poderiam vazar estado volátil para o repositório.

**Fix**: os três adicionados ao `.gitignore`; `pending-tasks.md` destracado com `git rm --cached`.

---

### Schema Drift — 4 campos ausentes do schema canônico ✅ CORRIGIDO

**Problema**: `agent-stop.sh` e `post-tool-use.sh` escrevem campos (`quality_gates`,
`session_summary`, `last_turn_ts`, `session.end_reason`) que não eram inicializados por
`session-start.sh`, causando comportamento imprevisível em sessões novas.

**Fix**: todos os 4 campos adicionados à inicialização canônica em `session-start.sh`.

---

### AUTHORIZED_CLOSE.flag — Simetria de flags ✅ IMPLEMENTADO

**Motivação**: existia `UNAUTHORIZED_CLOSE.flag` para sinalizar fechamentos não autorizados, mas não
havia o equivalente positivo. Isso dificultava auditoria e inspeção de estado.

**Implementação** em `agent-stop.sh`:

- Quando turno autorizado: cria `AUTHORIZED_CLOSE.flag` com
  `{authorized_at, session_id, turn_number}`
- Quando não autorizado: remove `AUTHORIZED_CLOSE.flag` (limpa sinal positivo)
- Ambos os flags são mutuamente exclusivos e sempre sincronizados

---

### `section-end.sh` — Novo script para fechar Seção Temática ✅ IMPLEMENTADO

**Motivação**: `start-section.sh` abria Seções Temáticas, mas não havia contrapartida para fechá-las
explicitamente. O encerramento implícito (abertura de nova seção) não logava duração.

**Implementação** (`section-end.sh`):

- Lê `current_section.{name, started_at}` do `session-context.json`
- Calcula duração em segundos
- Reseta `current_section` para todos os campos `null`
- Loga evento `sectionEnd` no `audit.jsonl` com `{section_name, turn_number, duration_s}`
- Saída graciosa se nenhuma seção estiver ativa
- Uso: `bash .github/hooks/scripts/section-end.sh`

---

### `smoke-test.sh` — Validação de integridade do sistema ✅ IMPLEMENTADO

**Motivação**: não havia meio rápido de verificar se toda a infraestrutura de hooks estava íntegra
antes de uma sessão ou após alterações.

**Implementação** (`smoke-test.sh`) — **43 checks** em 7 seções:

1. **Dependências**: jq, sponge, date, sha256sum, wc
2. **Scripts**: 16 scripts — presença + bit executável
3. **copilot-hooks.json**: parse jq + contagem de hooks
4. **Diretórios**: state/, logs/
5. **Schema**: 13 campos obrigatórios no `session-context.json` (usa `has()` para distinguir `null`
   de ausente)
6. **Funcional**: `section-end.sh` sem seção ativa (dry-run)
7. **shellcheck**: 5 scripts críticos

Uso: `bash .github/hooks/scripts/smoke-test.sh` (exit code = nº de falhas; 0 = tudo ok)

---

### Documentação — Múltiplas correções ✅ CORRIGIDO

| Arquivo                    | Problema                                                | Fix                                         |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------- |
| `PROTOCOLO-AUTORIZACAO.md` | `auth_requested_this_turn` (nome v1) em todo o doc      | Alterado para `current_turn.auth_requested` |
| `PROTOCOLO-AUTORIZACAO.md` | Nenhuma menção de que `vscode_askQuestions` é gratuito  | Adicionada nota proeminente no cabeçalho    |
| `README.md`                | `AUTHORIZED_CLOSE.flag` descrito incorretamente         | Descrição corrigida                         |
| `README.md`                | `tool_responses_empty` referenciado (campo inexistente) | Todas as referências removidas              |
| `AUDIT-SCHEMA.md`          | `result_type` mostrava só `"success"`                   | Adicionados `"failure"` e `"unknown"`       |
| `AUDIT-SCHEMA.md`          | Eventos `sectionStart`/`sectionEnd` não documentados    | Schemas completos adicionados               |
| `README.md`                | `section-end.sh` e `smoke-test.sh` não documentados     | Seções adicionadas                          |

---

## Melhorias Implementadas (sessão 5 — 2026-03-09)

### Correção de Inconsistências de Campo — Schema v2 vs Implementação

**Motivação**: A sessão 4 planejou campos com nomes diferentes dos que `session-start.sh` (fonte
canônica) efetivamente escrevia. Os scripts foram reescritos com os nomes planejados, não os reais.
Teste e2e revelou todas as discrepâncias.

**Mapeamento de erros corrigidos** (nome planejado → nome canônico real):

| Campo planejado (errado)                       | Campo canônico (session-start.sh)     | Script corrigido         |
| ---------------------------------------------- | ------------------------------------- | ------------------------ |
| `session_stats.failures_total`                 | `session_stats.failures_detected`     | session-checkpoint.sh    |
| `session_stats.failures_total`                 | `session_stats.failures_detected`     | error-occurred.sh        |
| `session_stats.unauthorized_turns`             | `session_stats.turn_unauthorized`     | (não chegou a ser usado) |
| `last_tool.result_type`                        | `last_tool.result`                    | (já estava correto)      |
| `active_section.*`                             | `current_section.*`                   | session-checkpoint.sh    |
| `active_section.*`                             | `current_section.*`                   | start-section.sh         |
| `active_section.turn_number`                   | `current_section.turn_start`          | start-section.sh         |
| `conformidade.consecutive_unauthorized_closes` | `compliance.consecutive_unauthorized` | session-checkpoint.sh    |

**Correções adicionais descobertas**:

| #   | Correção                                                                      | Script                | Commit     |
| --- | ----------------------------------------------------------------------------- | --------------------- | ---------- |
| C1  | `session-end.sh` passava `START_ISO` para helper que esperava `START_TS` (ms) | session-end.sh        | `72c5a19a` |
| C2  | `subagent-stop.sh` não incrementava `session_stats.subagent_calls`            | subagent-stop.sh      | `72c5a19a` |
| C3  | `error-occurred.sh` não incrementava `session_stats.errors_total`             | error-occurred.sh     | `72c5a19a` |
| C4  | `session-checkpoint.sh` output usava `failures_total` (inconsistente)         | session-checkpoint.sh | `72c5a19a` |
| C5  | Comentário `active_section.{name, started_at, turn_number}` desatualizado     | start-section.sh      | `72c5a19a` |

**Validação**: shellcheck 0 warnings em todos os 14+ scripts · análise estática via grep/read_file.

---

## Melhorias Implementadas (sessão 4 — 2026-03-09)

### Schema v2 — Conceitos Claros e Arquitetura de Dados

**Motivação**: O schema anterior misturava dados de sessão, turno e chamada num nível flat,
dificultando consultas, causando bugs sutis e tornando o contexto confuso para o agente.

**Conceitos canônicos** (fixos pelo Copilot):

| Conceito           | Escopo                         | Boundary                                              |
| ------------------ | ------------------------------ | ----------------------------------------------------- |
| Sessão             | UUID gerado pelo Copilot       | `sessionStart` → `sessionEnd`                         |
| Turno              | Ciclo completo prompt→resposta | `userPromptSubmitted` → `agentStop`                   |
| Chamada            | Uso de uma ferramenta          | `preToolUse` → `postToolUse`                          |
| **Seção Temática** | Fase lógica nomeada            | Declarada pelo agente via `start-section.sh` _(NOVO)_ |

**Estrutura do schema v2** (`session-context.json`) — campos canônicos verificados em 2026-03-09:

```json
{
  "session":        { "id", "started_at", "date_short", "ended_at", "source", "cwd" },
  "session_stats":  { "turn_count", "turn_authorized", "turn_unauthorized", "tools_total",
                      "tools_by_name", "failures_detected", "errors_total", "subagent_calls" },
  "current_turn":   { "number", "started_at", "tools_count", "tools_by_name",
                      "failures_count", "auth_requested", "auth_requested_at" },
  "current_section": { "name", "started_at", "turn_start", "description" },
  "last_tool":      { "name", "ts", "use_id", "result" },
  "compliance":     { "last_turn_authorized", "consecutive_unauthorized", "flag_file_exists" }
}
```

| #   | Mudança                                                                    | Scripts                               | Status |
| --- | -------------------------------------------------------------------------- | ------------------------------------- | ------ |
| —   | Schema v2: structs aninhadas substituem campo flat                         | todos                                 | ✅     |
| B1  | Remove `tools_used[]` array ilimitado → substituído por `tools_by_name {}` | `session-start.sh`, `pre-tool-use.sh` | ✅     |
| B2  | Remove `failure_count_unknown` fantasma → era campo inexistente no spec    | `post-tool-use.sh`                    | ✅     |
| B3  | `turn_duration_s` usava `last_tool.ts` em vez de `current_turn.started_at` | `agent-stop.sh`                       | ✅     |
| B4  | `session_summary` exibia dados de sessão acumulados, não do turno atual    | `agent-stop.sh`                       | ✅     |
| B5  | `session-end.sh` não chamava `session-checkpoint.sh` antes de encerrar     | `session-end.sh`                      | ✅     |
| B6  | Newline rogue em `log-prompt.sh` SESSION_ID read corrompía o UUID          | `log-prompt.sh`                       | ✅     |
| —   | **Novo**: `start-section.sh` — agente declara Seção Temática nomeada       | novo `start-section.sh`               | ✅     |

**Uso da Seção Temática**:

```bash
bash .github/hooks/scripts/start-section.sh "implementação do schema v2"
# → grava current_section em session-context.json
# → emite evento sectionStart no audit.jsonl
```

---

## Melhorias Implementadas (sessão 3 — 2026-03-09)

| #   | Melhoria                                                            | Scripts                                                        | Status          |
| --- | ------------------------------------------------------------------- | -------------------------------------------------------------- | --------------- |
| UP2 | Integração Findings ↔ Tasks (`--finding-id`, `--create-task`, sync) | `add-task.sh`, `save-finding.sh`, novo `sync-tasks-to-docs.sh` | ✅ Implementada |
| UP4 | Checkpoint de tarefas com diff (SHA-256 hash + `tasks_changed`)     | `session-checkpoint.sh`                                        | ✅ Implementada |
| UP5 | Exportação de métricas CSV/JSON                                     | novo `export-metrics.sh`                                       | ✅ Implementada |
| M4  | Quality gates: detecção real de sucesso/falha em `tool_response`    | `post-tool-use.sh`, `session-start.sh`                         | ✅ Implementada |
| M5  | `subagent-stop.sh` mais informativo                                 | `subagent-stop.sh`                                             | ✅ Implementada |
| —   | Sync automático de tarefas (a cada 5 turnos)                        | `agent-stop.sh`                                                | ✅ Implementada |

---

## Melhorias Implementadas (sessão 2 — 2026-03-09)

| #   | Melhoria                                                    | Scripts                                                | Status          |
| --- | ----------------------------------------------------------- | ------------------------------------------------------ | --------------- |
| M1  | Lifecycle de Findings — `finding_id` + `resolve-finding.sh` | `save-finding.sh`, novo `resolve-finding.sh`           | ✅ Implementada |
| M2  | Sumarização de `tools_used` array                           | `pre-tool-use.sh`, `session-start.sh`, `agent-stop.sh` | ✅ Implementada |
| M3  | Alertas de Threshold escalonados                            | `session-start.sh`                                     | ✅ Implementada |
| UP1 | Analytics Cross-Session                                     | novo `analytics.sh`                                    | ✅ Implementada |
| UP3 | Health Check automático no session-start                    | `session-start.sh`                                     | ✅ Implementada |

---

## Bugs Corrigidos (sessão 1 — 2026-03-09)

| #   | Bug                                                                                   | Script                  | Fix aplicado                                       |
| --- | ------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------- |
| B1  | `auth_requested_this_turn` não resetado entre turnos → falso positivo na Estratégia 3 | `agent-stop.sh`         | Reset no final do turno + reset em `log-prompt.sh` |
| B2  | `failure_count_unknown` nome enganoso (a maioria são sucessos com body vazio)         | `post-tool-use.sh`      | Renomeado para `tool_responses_empty`              |
| B3  | Glob vazio em bash → array com literal do pattern quando não há checkpoints           | `session-checkpoint.sh` | Substituído por `mapfile + compgen`                |
| B4  | `/tmp/pre-commit-gate-output.txt` path fixo → race condition em commits paralelos     | `install-git-hooks.sh`  | Substituído por `mktemp` + `trap EXIT`             |

---

## Melhorias Pendentes

### ~~M1 — Lifecycle de Findings~~ ✅ IMPLEMENTADA (sessão 2)

**Implementação**:

- `save-finding.sh` agora gera `finding_id` único (`f_<timestamp_ms>_<RANDOM>`) em cada achado
- `resolve-finding.sh` (novo): marcação de resolução append-only no JSONL; idempotente; valida
  existência do ID
- `analytics.sh` exibe findings abertos vs resolvidos por severidade

**Gate de aceitação**: ✅ `save-finding.sh` gera `finding_id`; `resolve-finding.sh` funciona;
`analytics.sh` inclui seção de Findings.

---

### ~~M2 — Sumarização de `tools_used` array~~ ✅ IMPLEMENTADA (sessão 2)

**Implementação**:

- `pre-tool-use.sh`: array `tools_used[]` (crescia indefinidamente) → `tools_used_counts{}` (objeto
  de contagem) + `tools_used_recent[]` (janela deslizante de 20) + `tools_used_total` (int)
- `session-start.sh`: inicialização atualizada; `failure_count_unknown` renomeado para
  `tool_responses_empty`
- `agent-stop.sh`: `session_summary` usa `tools_used_total` ao invés de `length do array`

**Gate de aceitação**: ✅ `session-context.json` não cresce com o número de chamadas de ferramenta.

---

### ~~M3 — Alertas de Threshold~~ ✅ IMPLEMENTADA (sessão 2)

**Implementação** em `session-start.sh`:

- `consecutive_unauthorized_closes = 1`: `⛔ AVISO DE VIOLAÇÃO`
- `consecutive_unauthorized_closes = 2`: `⛔⛔ SEGUNDA VIOLAÇÃO CONSECUTIVA`
- `consecutive_unauthorized_closes >= 3`: `⛔⛔⛔ VIOLAÇÃO CRÍTICA REITERADA (Nx consecutivas)`

**Gate de aceitação**: ✅ Briefing escalona visualmente o alerta conforme contagem acumulada.

---

### M4 — Quality Gates na Detecção de success/failure Reais (Backlog, Esforço L)

**Problema**: `post-tool-use.sh` usa heurística de "body vazio = unknown" para determinar sucesso,
pois o payload do Copilot não inclui campo `result_type` explícito.

**Proposta longo prazo**:

- Monitorar o payload real de `postToolUse` em `raw-post-input.jsonl` para encontrar padrões que
  indiquem falha real (e.g., erro de ferramenta na resposta)
- Atualizar a lógica quando o schema do Copilot evoluir para incluir indicador de falha

**Status atual**: sem ação imediata — monitorar `raw-post-input.jsonl` para novos padrões.

---

### M5 — `subagent-stop.sh` mais informativo (Backlog, Esforço S)

**Problema**: `subagent-stop.sh` loga apenas `{event, session_id, timestamp}` — sem dados do
subagente (nome, duração, resultado).

**Proposta**:

- Extrair campos do payload (se disponíveis): `subagent_name`, qualquer campo de resultado
- Calcular duração aproximada usando `last_tool_ts`
- Fazer referência ao `tool_use_id` do subagente se presente no payload

**Gate de aceitação**: audit.jsonl mostra informações úteis de subagentes além de timestamps.

---

## Upgrades Profundos

### ~~UP1 — Analytics Cross-Session~~ ✅ IMPLEMENTADA (sessão 2)

**Implementação**: `analytics.sh` (novo):

- Saída Markdown ou `--json` para automação
- Seções: resumo global, top-10 ferramentas com % do total, performance P50/P95 por ferramenta,
  compliance por sessão (✅/⚠️), findings por severidade com abertos vs resolvidos, atividade por
  dia
- Uso: `bash analytics.sh` | `bash analytics.sh --output relatorio.md` | `bash analytics.sh --json`

**Gate de aceitação**: ✅ Relatório gerado com todas as seções; `--json` mode para automação
funcional.

---

### UP2 — Integração com Sistema de Tarefas do Projeto (Alta, Esforço L)

**Visão**: `pending-tasks.md` é o backlog do agente. Hoje não há sincronização com
`DOCUMENTAÇÃO/BUGS/` ou com o tracker do GitHub Issues.

**Proposta**:

1. `sync-tasks-to-docs.sh` — exporta tarefas concluídas para `DOCUMENTAÇÃO/RELATORIOS/`
2. Opção em `save-finding.sh` para criar automaticamente uma tarefa via `add-task.sh`
3. Referência cruzada por ID entre findings e tasks

**Gate de aceitação**: ao concluir uma tarefa tagueada com finding, o relatório de sessão mostra o
link finding → task → resolved.

---

### ~~UP3 — Sistema de Health Check Contínuo~~ ✅ IMPLEMENTADA (sessão 2)

**Implementação** em `session-start.sh`:

- Verifica: `sponge` instalado (crítico), `jq` instalado (crítico), `audit.jsonl` tamanho
  (aviso >3000, crítico >4500), `session-context.json` com permissão de escrita, findings
  críticos/high abertos
- Nova seção "**Saúde do Sistema**" no `session-briefing.md`: status (✅/⚠️/⛔) + lista de problemas
- Executa automaticamente a cada sessão sem overhead significativo

**Gate de aceitação**: ✅ Máquina sem `sponge` exibe aviso; `audit.jsonl` > 4500 linhas exibe alerta
crítico.

---

### UP4 — Checkpoint de Tarefas com Diff (Backlog, Esforço M)

**Visão**: o `session-checkpoint.sh` captura o contagem de tarefas por prioridade, mas não quais
tarefas foram adicionadas ou concluídas desde o checkpoint anterior.

**Proposta**:

- Adicionar ao checkpoint: hash SHA-256 do `pending-tasks.md` atual
- Se hash changed VS checkpoint anterior: registrar `tasks_changed: true`
- Opcional: capturar diff de tarefas (adicionadas/removidas)

**Gate de aceitação**: checkpoint.json inclui `tasks_hash` e `tasks_changed`; diff disponível via
comparação de checkpoints consecutivos.

---

### UP5 — Exportação de Métricas para CSV (Backlog, Esforço S)

**Visão**: facilitar análise externa (Excel, Jupyter) das métricas de performance.

**Proposta**:

- `export-metrics.sh [formato: csv|json] [data_inicio] [data_fim]`
- Exporta `tool-metrics.jsonl` filtrado por período em CSV:
  `timestamp,tool_name,duration_ms,result_type`
- Exporta summary de conformidade por sessão em CSV

**Gate de aceitação**: `bash export-metrics.sh csv 2026-03-01 2026-03-09 > metricas.csv` gera CSV
válido com cabeçalho.

---

## Tabela de Priorização

| ID  | Título                         | Prioridade | Esforço | Categoria        |
| --- | ------------------------------ | ---------- | ------- | ---------------- |
| M1  | Lifecycle de Findings          | Média      | M       | Melhoria         |
| M2  | Sumarização de tools_used      | Média      | S       | Melhoria         |
| M3  | Alertas de Threshold           | Média      | M       | Melhoria         |
| M4  | Detection real de falhas       | Backlog    | L       | Melhoria         |
| M5  | subagent-stop mais informativo | Backlog    | S       | Melhoria         |
| UP1 | Analytics Cross-Session        | Alta       | L       | Upgrade Profundo |
| UP2 | Integração Tarefas ↔ Docs      | Alta       | L       | Upgrade Profundo |
| UP3 | Health Check Contínuo          | Média      | M       | Upgrade Profundo |
| UP4 | Checkpoint com Diff de Tarefas | Backlog    | M       | Upgrade Profundo |
| UP5 | Exportação CSV de Métricas     | Backlog    | S       | Upgrade Profundo |

---

_Atualizar este documento ao aprovar ou implementar qualquer item. Para registrar novos achados de
bug: `bash .github/hooks/scripts/save-finding.sh ...` Para nova tarefa aprovada:
`bash .github/hooks/scripts/add-task.sh ...`_
