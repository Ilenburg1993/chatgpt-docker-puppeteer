# Auditoria de Refatoração — Hook System
**Versão**: 1.0 | **Data**: 2026-03-22 | **Commit base**: `a53925b3`
**Escopo**: 54 arquivos, 11.393 linhas (`.github/hooks/`)
**Status**: ✅ TODOS OS ITENS R-01 a R-17 CONCLUÍDOS — Sprint 9 finalizado (2026-03-22)

---

## Índice

1. [Fase 1 — Arquitetura e Estrutura](#fase-1--arquitetura-e-estrutura)
2. [Fase 2 — Qualidade do Código e Bugs](#fase-2--qualidade-do-código-e-bugs)
3. [Fase 3 — Cobertura de Testes](#fase-3--cobertura-de-testes)
4. [Fase 4 — Performance e Atomicidade](#fase-4--performance-e-atomicidade)
5. [Fase 5 — Segurança e Robustez](#fase-5--segurança-e-robustez)
6. [Fase 6 — Dívida Técnica Documentada (GAPs/UPs)](#fase-6--dívida-técnica-documentada-gapsups)
7. [Fase 7 — Plano de Execução](#fase-7--plano-de-execução)
8. [Apêndice — Inventário Completo](#apêndice--inventário-completo)

---

## Fase 1 — Arquitetura e Estrutura

### 1.1 Visão Geral da Topologia

O hook system está organizado em 3 camadas:

```
hooks.json             ← configuração master (9 hooks de evento)
    │
scripts/*.sh           ← thin wrappers (entry points)
    │
lib/*.sh               ← lógica de domínio por evento
    │
lib/api/*.sh           ← API estruturada (16 módulos)
    │
lib/common.sh          ← base compartilhada (880 linhas)
```

**Grafo de dependências de source:**
```
session-start-lib.sh   → common.sh → api/01-vars.sh ... api/16-lifecycle.sh
session-close-lib.sh   → common.sh
stop-lib.sh            → common.sh → (api/ via hook-payload-api.sh)
pre-tool-use-lib.sh    → common.sh
post-tool-use-lib.sh   → common.sh
user-prompt-submit-lib.sh → common.sh
subagent-lib.sh        → common.sh
pre-compact-lib.sh     → common.sh
hook-payload-api.sh    → api/01-vars.sh...api/16-lifecycle.sh (source cada um)
```

### 1.2 Problemas Arquiteturais Identificados

#### 1.2.1 Duplicação de Camadas de Carregamento — CRÍTICO

**Problema**: O carregamento dos módulos `lib/api/` acontece em dois caminhos diferentes e incongruentes:

- **Caminho A**: `hook-payload-api.sh` faz `source` de cada `api/XX-*.sh` sequencialmente (linhas 63–92)
- **Caminho B**: Cada `lib/*-lib.sh` faz `source common.sh`, mas `common.sh` **não** carrega os módulos `api/` — delega a função `log_audit` para `_audit_write_event` (de `15-audit.sh`) via `declare -f` guard

**Consequência**: Dois fluxos de boot distintos, com comportamentos diferentes dependendo de qual foi chamado primeiro. Funções como `hook_log_audit` só estão disponíveis se `hook-payload-api.sh` foi carregado.

**Evidência**:
```bash
# common.sh:355-369 — fallback quando 15-audit.sh não foi carregado
log_audit() {
    if declare -f _audit_write_event > /dev/null 2>&1; then
        _audit_write_event "$event" "$@"
        return $?
    fi
    # Implementação legada (fallback)...
}
```

**Refatoração proposta**: Criar `lib/loader.sh` centralizado que todos os scripts sourcem, garantindo ordem de carregamento canônica e única.

---

#### 1.2.2 Inconsistência nos Entry Point Scripts

**Problema**: Os thin wrappers em `scripts/` não seguem o mesmo padrão de carregamento:

| Script             | Carrega common.sh?  | Carrega hook-payload-api.sh? | Padrão     |
| ------------------ | ------------------- | ---------------------------- | ---------- |
| `pre-tool-use.sh`  | Não (via lib)       | Não explicitamente           | Diferente  |
| `post-tool-use.sh` | **Sim diretamente** | Não                          | OK         |
| `stop.sh`          | **Sim diretamente** | Não                          | OK         |
| `session-start.sh` | Não (via lib)       | Não explicitamente           | Diferente  |
| `session-end.sh`   | **Sim diretamente** | **Sim diretamente**          | Completo   |
| `session-close.sh` | **Sim diretamente** | Não                          | Incompleto |

**Refatoração proposta**: Padronizar todos os entry points para sempre carregar `common.sh` explicitamente antes da lib específica.

---

#### 1.2.3 Arquivo Stale: `hook-payload-api.sh.bak`

**Status**: Arquivo de 208 linhas presente em `lib/hook-payload-api.sh.bak` (51.279 bytes).
**Risco**: Confusão sobre qual é a versão canônica; possível carregamento acidental.
**Ação**: **Deletar imediatamente** — não há referência válida a este arquivo no codebase.

---

#### 1.2.4 `common.sh` — Arquivo Monolítico de 880 Linhas

**Problema**: `common.sh` acumula responsabilidades heterogêneas:
- Configuração de paths
- CRUD do `session.json` (state management)
- Funções de auditoria (legadas + fallback)
- Funções de output JSON (depreciadas)
- Funções auxiliares (now_iso, make_close_key, uuidgen_safe)
- Lifecycle de TURN e SUBTURN
- Geração do briefing
- Funções de detecção de close_key (depreciadas)
- Funções de debug capture

**Categorias por linha**:
```
Linhas   1-50:   Setup de paths e variáveis globais
Linhas  51-240:  CRUD de state (read_field, update_state*, init_state, recover_or_init)
Linhas 241-400:  Auditoria (log_audit legado, _audit_event_is_suppressed, _audit_cap_check)
Linhas 401-480:  Funções auxiliares (now_iso, make_close_key, jq_field)
Linhas 481-530:  uuidgen_safe, generate_section_id
Linhas 531-560:  load_payload, maybe_capture_debug
Linhas 561-620:  Aritmética atômica (increment_field, decrement_field_floor0)
Linhas 621-680:  Depreciadas (detect_close_key_in_text, turn_is_orphaned, heal_orphaned_turn)
Linhas 681-750:  Lifecycle de TURN (open_new_turn)
Linhas 751-810:  Lifecycle de SUBTURN (open_new_subturn, increment_tools_by_type, etc.)
Linhas 811-880:  Briefing (generate_session_briefing, context_block, export_lang_utf8)
```

**Refatoração proposta**: Dividir `common.sh` em:
- `lib/state-crud.sh` — leitura/escrita atômica de session.json
- `lib/turn-lifecycle.sh` — open_new_turn, open_new_subturn, lifecycle events
- `lib/briefing.sh` — generate_session_briefing, context_block
- `lib/utils.sh` — now_iso, make_close_key, uuidgen_safe, jq_field
- Manter `lib/common.sh` apenas como agregador (source dos acima)

---

#### 1.2.5 `session-start.sh` Não Usa Pattern de outros hooks

**Problema**: `session-start.sh` não faz `source common.sh` diretamente; delega tudo para `session-start-lib.sh` que por sua vez source `common.sh`. Isso não é um bug, mas cria inconsistência no onboarding.

---

### 1.3 Fluxo de Dados: Problemas com `AUDIT_FILE`

**Problema**: Existem **dois destinos possíveis** para eventos de auditoria:
1. `state/audit.jsonl` — durante a sessão ativa
2. `logs/audit-TIMESTAMP.jsonl` — após rotação por cap ou sessão encerrada

**Consequência**: Tests que buscam eventos em `state/audit.jsonl` falham quando a rotação ocorre no meio (exatamente o bug T71, corrigido em `a53925b3`).

**Deficiência de design**: Não há um indireção canônica para "encontrar o arquivo de auditoria atual". Cada ponto de leitura precisa saber dos dois locais.

**Refatoração proposta**: Criar função `find_audit_file()` em `common.sh` que retorna o path correto (state/ ou logs/) — ou uma symlink `logs/audit-current.jsonl → ../state/audit.jsonl` que é atualizado na rotação.

---

## Fase 2 — Qualidade do Código e Bugs

### 2.1 Bug Confirmado: `printf '- ...'` com `LANG=C.UTF-8` — RESOLVIDO

**Estado**: ✅ Corrigido no commit `a53925b3`
**Arquivo**: `lib/session-close-lib.sh:42-47`
**Root cause**: `LANG=C.UTF-8` definido na linha 11 faz `printf` tratar format strings iniciando com `-` como flags
**Fix**: Adicionado `--` em todas as 5 ocorrências de `printf '- ...'` na função `_generate_final_report()`

---

### 2.2 Bug Potencial: `printf '- ...'` em `session-start-lib.sh` — ✅ RESOLVIDO

**Status**: ✅ **Resolvido** (verificado Sprint 10)
**Arquivo**: `lib/session-start-lib.sh:141` e `:148`
**Evidência atual**:
```bash
printf -- '- %s\n' "$issue"   # linha 141 — flag -- adicionado
printf -- '- %s\n' "$warn"    # linha 148 — flag -- adicionado
```

**Análise**: Ambas as chamadas já usam `printf --` corretamente. Resolvido em Sprint anterior.
**Cobertura de teste**: T78 verifica o comportamento.

---

### 2.3 Problema Documentado: `read_field()` e Boolean False — ✅ RESOLVIDO

**Status**: ✅ **Resolvido** (verificado Sprint 10)
**Arquivo**: `lib/state-crud.sh:32-36`
**Implementação atual**:
```bash
# read_field_bool — avoids bug where read_field returns "" for boolean false
read_field_bool() {
    local path="$1"
    jq -r "if ${path} then \"true\" else \"false\" end" "$STATE_FILE" 2>/dev/null || echo "false"
}
```

**Resolução**: `read_field_bool()` implementada em `state-crud.sh` e exposta via `common.sh`. Retorna literalmente `"true"` ou `"false"` para qualquer booleano JSON.
**Cobertura de teste**: T84 verifica o comportamento diretamente.

---

### 2.4 Função `log_audit()` Depreciada — ✅ RESOLVIDO (verificado Sprint 12)

**Status**: ✅ **Resolvido** (verificado Sprint 12)
**Arquivo**: `lib/audit-lib.sh`
**Situação atual**: A função `log_audit()` permanece em `audit-lib.sh` como fallback de compatibilidade (marcada como `[LEGADO — DEPRECADO]`), mas **não é chamada ativamente** em nenhum arquivo. Todas as chamadas ativas usam `hook_log_audit()` de `api/15-audit.sh`:
- `lib/subagent-lib.sh` — 6 chamadas ✅
- `lib/stop-lib.sh` — 7+ chamadas ✅
- `lib/turn-lifecycle.sh` — 1 chamada ✅
- `lib/state-crud.sh` — 2 chamadas ✅
- `lib/post-tool-use-lib.sh` — 2 chamadas ✅

O caso citado anteriormente (`lib/common.sh:605 heal_orphaned_turn`) foi migrado em Sprint 7/8 (R-08 ✅).

---

### 2.5 Funções Depreciadas sem Remoção: Stub Wrapper em `16-lifecycle.sh`

### 2.5 Funções Depreciadas sem Remoção: Stub Wrapper em `16-lifecycle.sh` — ✅ RESOLVIDO

**Status**: ✅ **Resolvido** (R-07/R-09, verificado Sprint 12)
**Arquivo**: `lib/api/16-lifecycle.sh`
**Situação atual**: `hook_turn_is_orphaned()` e `hook_heal_orphaned_turn()` possuem **implementação direta** (não delegam para legadas):

```bash
hook_turn_is_orphaned() {
    # R-07: implementação direta, sem dependência de turn_is_orphaned() legado
    ...
}
hook_heal_orphaned_turn() {
    # R-07: implementação direta, sem dependência de heal_orphaned_turn() legado
    ...
}
```

A migração para implementação nativa foi feita via R-07 e R-09 em sprints anteriores.

---

### 2.6 Funções Depreciadas com Implementação Stub em `hook-payload-api.sh` — ✅ RESOLVIDO

**Status**: ✅ **Resolvido** (verificado Sprint 11)
**Arquivo**: `lib/hook-payload-api.sh`

O stub `detect_close_key_in_text() { return 1; }` foi removido em sprint anterior. O arquivo agora carrega `common.sh` via guard antes de continuar (`if ! declare -f jq_field > /dev/null`), tornando o stub desnecessário. Apenas nota de comentário histórica permanece na linha 37.

---

### 2.7 `LANG=C.UTF-8` com Estratégias Inconsistentes entre Arquivos — ✅ RESOLVIDO

**Status**: ✅ **Resolvido** (verificado Sprint 10)
**Situação atual**:

| Arquivo                       | Abordagem                                      | Status                                 |
| ----------------------------- | ---------------------------------------------- | -------------------------------------- |
| `session-close-lib.sh:11`     | Chama `export_lang_utf8` (condicional)         | ✅ Correto                              |
| `common.sh:878`               | `export LANG="${LANG:-C.UTF-8}"` (condicional) | ✅ Correto                              |
| `hook-payload-api.sh:55`      | `export_lang_utf8()` — stub seguro com guard   | ✅ Correto (usa `${LANG:-C.UTF-8}`)     |
| `smoke-test-payload-api.sh:6` | `export LANG="C.UTF-8"`                        | Aceitável em contexto de teste isolado |

**Resolução**: `session-close-lib.sh` migrou para `export_lang_utf8`; `hook-payload-api.sh` stub já usa `${LANG:-C.UTF-8}`. Padrão consistente aplicado.

---

### 2.8 `increment_field()` e `decrement_field_floor0()` — ✅ RESOLVIDO

**Status**: ✅ **Resolvido** (Sprint 11)
**Arquivo**: `lib/state-crud.sh`
**Implementação atual**: Ambas as funções agora usam `flock -x 9` sobre `$STATE_DIR/.state.lock`:

```bash
increment_field() {
    local lock_file="$STATE_DIR/.state.lock"
    {
        flock -x 9
        current=$(read_field "$path")
        new_val=$((${current:-0} + 1))
        # ... jq write + mv ...
    } 9>> "$lock_file"
}
```

**Resultado**: Operações de leitura-modifica-escrita são agora serializadas via lock exclusivo. Subagentes em paralelo não podem causar lost-update em `subagents_active`.
**Gate**: 86/86 testes smoke passando.
```

---

### 2.9 `open_new_turn()` — 13 Chamadas Sequenciais — ✅ RESOLVIDO

**Status**: ✅ **Resolvido** (R-07, verificado Sprint 12)
**Arquivo**: `lib/turn-lifecycle.sh`
**Solução**: `open_new_turn_batch()` implementada via R-07 com operação `jq` em batch — 1 leitura + 1 escrita ao disco. `open_new_turn()` agora delega para `open_new_turn_batch()`.
**Cobertura de teste**: T80 (open_new_turn) e T86 (open_new_turn_batch) validam o comportamento.

---

### 2.10 `generate_session_briefing()` — pending_tasks_content — ✅ ADEQUADO

**Status**: ✅ **Adequado** (verificado Sprint 12)
**Arquivo**: `lib/briefing.sh:66`
**Situação atual**:
```bash
pending_tasks_content="$(printf '```\n%s\n```' "$(cat "$PENDING_TASKS_FILE")")"
```

O conteúdo é envolvido em bloco de código Markdown (``` )```` ``` ````). Isso garante que qualquer conteúdo dentro do arquivo é renderizado como literal — impede injeção de cabeçalhos, negrito, ou outros elementos Markdown arbitrários. Risco residual é mínimo e aceitável para um sistema interno.
pending_tasks_content="$(cat "$PENDING_TASKS_FILE")"  # sem sanitize_md!
...
## Tarefas Pendentes
${pending_tasks_content}                               # expansão direta
```

**Risco de Segurança**: Injeção de Markdown/conteúdo arbitrário a partir de `pending-tasks.md` se o arquivo for modificado por agente malicioso.
### 2.11 Uso de `[[ ]]` vs `[ ]` — ✅ RESOLVIDO (R-16)

**Status**: ✅ **Resolvido** (R-16, Sprint 9)
**Resultado**: 19 substituições de `[ ]` → `[[ ]]` em 12 arquivos. Padrão `[[ ]]` agora é consistente em todo o código novo.

---

## Fase 3 — Cobertura de Testes

### 3.1 Inventário de Cobertura

| Arquivo de Teste            | Linhas    | Casos    | Foco                                               |
| --------------------------- | --------- | -------- | -------------------------------------------------- |
| `smoke-test.sh`             | 1.411     | 75       | Stop hook, estado core, session-close, pre-compact |
| `smoke-test-payload-api.sh` | 1.846     | ~60+     | Módulos api/ (parse, validate, output, etc.)       |
| `integration-test-hooks.sh` | 1.066     | ~30+     | Integração entre hooks                             |
| `stress-test-hooks.sh`      | 165       | ~10      | Concorrência e stress                              |
| **Total**                   | **4.488** | **~175** | —                                                  |

### 3.2 Gaps de Cobertura por Módulo

#### Módulos Sem Cobertura Direta em Smoke Tests (status atualizado Sprint 12):

| Módulo                              | Gap Identificado                              | Resolvido                |
| ----------------------------------- | --------------------------------------------- | ------------------------ |
| `api/09-metrics.sh`                 | Sem testes de cálculo de métricas de duração  | ⚙️ Pendente (baixa prio.) |
| `api/11-compact-context.sh`         | Pouco coverage de serialização de contexto    | ⚙️ Pendente (baixa prio.) |
| `api/12-subagent.sh`                | Budget/depth limits só testados indiretamente | ⚙️ Pendente (baixa prio.) |
| `api/13-state-version.sh`           | Migration de versão de schema não testada     | ⚙️ Pendente (baixa prio.) |
| `lib/common.sh` `generate_briefing` | Sem teste direto do output do briefing        | ✅ T79 (Sprint 8)         |
| `lib/common.sh` `uuidgen_safe()`    | Sem teste de fallback                         | ✅ T85 (Sprint 10)        |
| `lib/common.sh` `read_field_bool()` | Sem teste direto                              | ✅ T84 (Sprint 10)        |
| `lib/turn-lifecycle.sh` `open_new_turn_batch()` | Sem teste direto               | ✅ T86 (Sprint 10)        |
| `lib/state-crud.sh` `increment_field()` (flock) | Sem teste de incremento direto | ✅ T88 (Sprint 12)        |
| `lib/state-crud.sh` `decrement_field_floor0()`  | Sem teste de floor behavior    | ✅ T87 (Sprint 12)        |
| `scripts/watchdog.sh`               | Zero testes automatizados do watchdog         | ⚙️ Pendente (baixa prio.) |

### 3.3 Cenários Críticos Sem Testes de Regressão

#### 3.3.1 Race Condition em Subagentes Paralelos

Nenhum teste verifica comportamento quando dois subagentes terminam simultaneamente e incrementam `subagents_active`.

#### 3.3.2 Auditoria com Cap e Rotação durante Operação

O T71 testa a rotação no encerramento, mas não há teste para rotação **durante** uma sessão ativa (cap atingido via `_audit_cap_check()`).

#### 3.3.3 Recuperação de Checkpoint Corrompido

`recover_or_init_state()` tem lógica de recuperação de checkpoints — sem teste para o caso em que `checkpoints/` existe mas todos os arquivos são JSON inválido.

#### 3.3.4 `session-end.sh` com Turn Ativo

O `GAP-ABRUPT-TURN-END` é implementado em `session-end.sh` mas sem teste automatizado que verifique que `turnEnd_abrupt` é emitido corretamente.

#### 3.3.5 Watchdog: Nenhum Teste

O `scripts/watchdog.sh` (262 linhas) não tem nenhum teste de regressão. Ele é invocado externamente via cron/scheduler para detectar sessões travadas.

### 3.4 Testes Implementados (Sprints 10-12) ✅

| ID  | Descrição                                                                  | Status         |
| --- | -------------------------------------------------------------------------- | -------------- |
| T76 | `session-end.sh` com turn ativo → verifica `turnEnd_abrupt` em audit       | ✅ Sprint 8     |
| T77 | `_audit_cap_check()` com HOOKS_AUDIT_MAX_LINES=5 → verifica rotação        | ✅ Sprint 8     |
| T78 | `printf -- '- %s\n'` em `session-start-lib.sh` com valor iniciando com `-` | ✅ Sprint 8     |
| T79 | `generate_session_briefing()` output contém session_id e close_key         | ✅ Sprint 8     |
| T80 | `open_new_turn()` avança número do turn e zera ask_questions_called        | ✅ Sprint 8     |
| T81 | `make_close_key()` retorna formato ENCERRAR-XXXXXXXX                       | ✅ Sprint 8     |
| T82 | `find_audit_file()` retorna AUDIT_FILE padrão quando sem symlink           | ✅ Sprint 8     |
| T84 | `read_field_bool()` retorna `"true"`/`"false"` para booleanos JSON         | ✅ Sprint 10    |
| T85 | `uuidgen_safe()` retorna formato UUID 8-4-4-4-12 válido                    | ✅ Sprint 10    |
| T86 | `open_new_turn_batch()` avança turn number e zera ask_questions_called     | ✅ Sprint 10    |
| T87 | `decrement_field_floor0()` não desce abaixo de 0 (floor behavior)         | ✅ Sprint 12    |
| T88 | `increment_field()` incrementa campo numérico corretamente (flock)         | ✅ Sprint 12    |

### 3.5 Gaps Remanescentes (Baixa Prioridade)

| Módulo                      | Gap Identificado                              | Prioridade |
| --------------------------- | --------------------------------------------- | ---------- |
| `api/09-metrics.sh`         | Sem testes de cálculo de métricas de duração  | Baixa      |
| `api/11-compact-context.sh` | Pouco coverage de serialização de contexto    | Baixa      |
| `api/12-subagent.sh`        | Budget/depth limits só testados indiretamente | Baixa      |
| `api/13-state-version.sh`   | Migration de versão de schema não testada     | Baixa      |
| `scripts/watchdog.sh`       | Zero testes automatizados do watchdog         | Baixa      |

---

## Fase 4 — Performance e Atomicidade

### 4.1 Análise de Invocações de `jq`

**Total**: 254 invocações de `jq` distribuídas em 54 arquivos.

**Top 5 por arquivo**:
```
lib/api/02-parse.sh  — 53 chamadas jq  (parsing de payload)
lib/common.sh        — 37 chamadas jq  (CRUD de estado)
lib/api/15-audit.sh  — 11 chamadas jq  (composição de eventos)
lib/api/05-output.sh — 11 chamadas jq  (formatação de output)
lib/session-close-lib.sh — 9 chamadas jq (relatório final)
```

### 4.2 Hot Path: `PreToolUse` e `PostToolUse`

Esses hooks são chamados **a cada ferramenta invocada** pelo agente — potencialmente dezenas de vezes por turno.

**Cadeia de execução no `PreToolUse`**:
1. `pre-tool-use.sh` carrega `common.sh` (source) → ~5ms I/O
2. `main()` → `hook_api_parse()` → ~2 forks de jq (parse do payload)
3. Verifica `stop_hook_active` → 1 jq
4. Verifica `state_exists` → 1 jq
5. `count_tool_use()` → `increment_field` → 1 jq + 1 mktemp + 1 mv
6. Verifica predicados de risco → 2-4 jq
7. Decisão de block/allow → 1 jq output

**Estimativa total**: ~10-15 forks de processo por chamada a PreToolUse.

**Refatoração de alto impacto**: Ler o estado uma única vez (`jq -c '.'` para string), fazer todas as operações sobre a string em memória e escrever uma vez. Redução esperada: de ~15 forks para 2-3.

### 4.3 `update_nested_state()` — Análise de Atomicidade — ✅ RESOLVIDO (Sprint 13)

**Mecanismo atual** (correto para single-writer):
```bash
tmp=$(mktemp "$STATE_DIR/.state.XXXXXX")
jq ... "$STATE_FILE" > "$tmp"
mv -f "$tmp" "$STATE_FILE" || { rm -f "$tmp"; return 1; }
```

**Sprint 13**: `write_state()` em `state-crud.sh:145` e `complete-task.sh:37` corrigidos para incluir `|| { rm -f "$tmp"; return 1; }` após `mv -f`. Todos os 7 `mv -f` em `state-crud.sh` e 3 em `turn-lifecycle.sh` agora têm guard de erro.

### 4.4 `_audit_cap_check()` — Chamada após Cada Evento — ✅ RESOLVIDO (Sprint 14)

**Arquivo**: `lib/audit-lib.sh:56-91`
**Problema original**: `_audit_cap_check()` usava `wc -l` para contar linhas após cada evento gravado. Em sessões longas (> 5000 linhas), isso é potencialmente lento pois lê o arquivo inteiro.

**Solução implementada (R-13)**: Contador em memória `_AUDIT_LINE_COUNT` (global, init=0) é
incrementado em `hook_log_audit` após cada escrita (linha 159). `_audit_cap_check()` só chama
`wc -l` quando o contador é 0 (primeira chamada, pós-rotação ou subshell sem herança). Após
rotação, o contador é resetado para 1.

```bash
# audit-lib.sh:61 — fast path: contador em memória
if [[ "${_AUDIT_LINE_COUNT:-0}" -gt 0 ]] && [[ "${_AUDIT_LINE_COUNT:-0}" -lt "$max" ]]; then
    return 0
fi
# cai aqui apenas no init (contador=0) ou quando próximo ao cap (≥ max)
count=$(wc -l < "$AUDIT_FILE" 2>/dev/null | tr -d ' ') || return 0
# ...
# audit-lib.sh:159 — incremento por evento
_AUDIT_LINE_COUNT=$((_AUDIT_LINE_COUNT + 1))
```

**Status**: ✅ Resolvido — R-13 implementado em `audit-lib.sh`.

---

## Fase 5 — Segurança e Robustez

### 5.1 Injeção em `increment_tools_by_type()`

**Arquivo**: `lib/common.sh:645-667`
**Situação**: A função sanitiza `tool_name` antes de usar como chave jq:
```bash
safe_name=$(printf '%s' "$tool_name" | tr -cd 'a-zA-Z0-9_-' | cut -c1-64)
```
**Status**: ✅ Adequadamente mitigado via sanitização explícita.

### 5.2 Injeção de Markdown em `generate_session_briefing()` — ✅ ADEQUADO

**Arquivo**: `lib/briefing.sh:66`
**Situação**: `sanitize_md()` é aplicada para campos de estado. `pending_tasks_content` é envolvido em bloco de código fenced (` ``` `) que **neutraliza** formatação arbitrária de Markdown.

```bash
# shellcheck disable=SC2016
pending_tasks_content="$(printf '```\n%s\n```' "$(cat "$PENDING_TASKS_FILE")")"
```

**Status**: ✅ Adequadamente mitigado — conteúdo dentro de bloco de código é renderizado como literal.

### 5.3 `log_audit()` — Injeção JSON via `jq --arg`

**Arquivo**: `lib/common.sh:372-400`
**Status**: ✅ Protegido — usa `jq --arg` para todos os campos, que escapa automaticamente caracteres especiais JSON.

### 5.4 `session-close.sh` — Proteção contra Invocação Direta

**Arquivo**: `scripts/session-close.sh` + proteção em `pre-tool-use-lib.sh`
**Status**: ✅ Adequado — `pre-tool-use.sh` bloqueia `run_in_terminal` que tenta chamar `session-close.sh`.

```bash
# pre-tool-use-lib.sh via api/08-risk.sh
hook_is_bypass_attempt()  # detecta tentativa de chamar session-close.sh diretamente
```

### 5.5 `make_close_key()` — Entropia da Chave de Encerramento — ✅ RESOLVIDO (R-17)

**Status**: ✅ **Resolvido** (R-17, verificado Sprint 12)
**Arquivo**: `lib/utils.sh:19`
**Situação atual**: A cadeia de fallbacks é segura:
1. `/proc/sys/kernel/random/uuid` → 8 hex (uuid v4) — ✅ Boa entropia
2. `od + /dev/urandom` → 8 hex — ✅ Boa entropia
3. `dd + od + /dev/urandom` → 8 hex — ✅ Adequado
4. **R-17**: `$RANDOM × 4` (64-bit de entropia bash) — ✅ Melhor que timestamp
5. `date +%s%N` → último recurso — aceitável como fallback final

O fallback `awk rand()` com seed previsível **foi removido** e substituído por `printf '%04X%04X' "$RANDOM" "$RANDOM"` (R-17).

### 5.6 Arquivo de Estado Sem Permissão Restrita — ✅ RESOLVIDO (R-09)

**Status**: ✅ **Resolvido** (R-09, verificado Sprint 12)
**Arquivo**: `lib/state-crud.sh:226` (`init_state()`)
**Situação atual**: `chmod 600 "$STATE_FILE"` é chamado imediatamente após a criação do arquivo:
```bash
jq -n ... > "$STATE_FILE"
chmod 600 "$STATE_FILE" 2> /dev/null || true # R-09: close_key não deve ser world-readable
```

O `close_key` não é mais legível por outros usuários do sistema.

---

## Fase 6 — Dívida Técnica Documentada (GAPs/UPs)

### 6.1 Inventário Completo de GAPs

O código registra 297 anotações de `GAP-` e `UP-` distribuídas pelos arquivos. Seguem os GAPs atualmente documentados:

**GAPs PRESENTES no código** (38 únicos):
```
GAP-03, GAP-04, GAP-07, GAP-09, GAP-10, GAP-11, GAP-12, GAP-13, GAP-14,
GAP-17, GAP-18, GAP-20, GAP-21, GAP-23, GAP-24, GAP-25, GAP-26, GAP-27,
GAP-29, GAP-31, GAP-32, GAP-34, GAP-35, GAP-36, GAP-46, GAP-47, GAP-48,
GAP-49, GAP-50, GAP-51, GAP-52, GAP-53, GAP-54, GAP-55, GAP-57, GAP-58,
GAP-60, GAP-61
```

**GAPs AUSENTES** (nunca referenciados no código — 25 IDs):
```
GAP-01, GAP-02, GAP-05, GAP-06, GAP-07*, GAP-08, GAP-15, GAP-16, GAP-19,
GAP-22, GAP-28, GAP-30, GAP-33, GAP-37, GAP-38, GAP-39, GAP-40, GAP-41,
GAP-42, GAP-43, GAP-44, GAP-45, GAP-56, GAP-62, GAP-63, GAP-64, GAP-65
```
(*GAP-07 aparece em comentário mas não como anotação de dívida ativa)

**Implicação**: Os GAPs ausentes foram: (a) resolvidos sem remoção da numeração, (b) nunca implementados, ou (c) residem em documentos MD não-shell.

### 6.2 GAPs Críticos com Análise

| GAP    | Localização                    | Descrição                                                         | Status         |
| ------ | ------------------------------ | ----------------------------------------------------------------- | -------------- |
| GAP-03 | `stop-lib.sh`, `smoke-test.sh` | `ask_questions_called=false + strict_turn_close=true → block`     | Implementado ✅ |
| GAP-04 | `common.sh:601`                | `started_at=null` para evitar re-heal na próxima UserPromptSubmit | Implementado ✅ |
| GAP-09 | `common.sh:432`                | Fallback com `dd` quando `od` não disponível                      | Implementado ✅ |
| GAP-10 | `common.sh:603`                | Registra `ended_at` temporalmente ao encerrar turno órfão         | Implementado ✅ |
| GAP-11 | `common.sh:470`                | Usa `od` em vez de `xxd` (POSIX portável)                         | Implementado ✅ |
| GAP-14 | `common.sh:755`                | `ended_at=null` no open para evitar subturn residual              | Implementado ✅ |
| GAP-21 | `common.sh:724`                | Guard: sem turno ativo, não abre subturn                          | Implementado ✅ |
| GAP-35 | `common.sh:746`                | Sanitiza campos para evitar injeção de Markdown                   | Implementado ✅ |
| GAP-60 | `session-end.sh`               | Handler para SessionEnd (GAP-ABRUPT-TURN-END)                     | Implementado ✅ |

### 6.3 UPs (User-Prompted improvements) Presentes

**Total**: ~50 anotações UP-XX listadas. Exemplos críticos:

| UP       | Arquivo         | Descrição                                               |
| -------- | --------------- | ------------------------------------------------------- |
| UP-AUDIT | `common.sh`     | Sistema de filtragem de eventos por `HOOK_AUDIT_LEVEL`  |
| UP-01    | `common.sh`     | Rastreamento por tipo de ferramenta                     |
| UP-02    | `common.sh`     | Contador de template usage (A-G)                        |
| UP-H1b   | `common.sh`     | Reset de `tools_after_ask_questions` no início do turno |
| UP-H4    | `smoke-test.sh` | consecutive-unauthorized enforcement                    |
| UP-15    | `smoke-test.sh` | preCompact_ask_questions_missing                        |
| UP-16    | `common.sh`     | Remoção de funções depreciadas de output (emit_*)       |

---

## Fase 7 — Plano de Execução

### 7.1 Prioridades por Impacto e Risco

#### Nível 1 — Correção Imediata (Bugs / Segurança)

| #    | Ação                                                                                              | Arquivo                       | Risco se não feito       |
| ---- | ------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------ |
| R-01 | Deletar `hook-payload-api.sh.bak`                                                                 | `lib/hook-payload-api.sh.bak` | Confusão e ~51KB stale   |
| R-02 | Corrigir `printf '- %s\n'` em `session-start-lib.sh:141,148`                                      | `lib/session-start-lib.sh`    | Bug printf LANG          |
| R-03 | Sanitizar `pending_tasks_content` em `generate_session_briefing()`                                | `lib/common.sh:793`           | Markdown injection       |
| R-04 | Padronizar LANG para `export_lang_utf8()` em `session-close-lib.sh:11` e `hook-payload-api.sh:55` | Dois arquivos                 | Inconsistência LANG      |
| R-05 | Criar `read_field_bool()` para leitura de campos booleanos                                        | `lib/common.sh`               | Bug bool false pervasivo |

#### Nível 2 — Refatoração Estrutural (Médio Prazo)

| #    | Ação                                                                                                                                                                                                           | Impacto Esperado                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| R-06 | ✅ Dividir `common.sh` em módulos menores — `state-crud.sh`, `audit-lib.sh`, `utils.sh`, `turn-lifecycle.sh`, `briefing.sh`; `common.sh` → 48-line aggregator                                                   | Manutenibilidade ↑                   |
| R-07 | ✅ Criar `open_new_turn_batch()` com jq único — implementado em `lib/turn-lifecycle.sh` (Sprint 8)                                                                                                              | Performance: -80% I/O no turn open   |
| R-08 | ✅ Migrar `log_audit()` em `common.sh:605` para `hook_log_audit()` — implementado em `lib/turn-lifecycle.sh` (`heal_orphaned_turn()` usa `hook_log_audit()`; confirmado via `# R-08:` em `api/16-lifecycle.sh`) | Consistência API                     |
| R-09 | ✅ Implementar `hook_turn_is_orphaned` nativamente em `16-lifecycle.sh` — implementado sem delegar ao legado `turn_is_orphaned()` (comentário `# R-07:` confirma implementação direta)                          | Eliminar indireção dupla             |
| R-10 | ✅ Criar `find_audit_file()` canônico — implementado em `lib/audit-lib.sh` (Sprint 8)                                                                                                                           | Fix estrutural da questão de rotação |
| R-11 | ✅ Criar `lib/loader.sh` centralizado — já existe em `lib/loader.sh`                                                                                                                                            | Ordem de carregamento garantida      |

#### Nível 3 — Melhorias de Robustez (Longo Prazo)

| #    | Ação                                                                                                                                                                                                                                                                                                                                                                         | Benefício                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| R-12 | ✅ Adicionar testes T76-T83 — implementados, 83/83 passando (Sprint 7)                                                                                                                                                                                                                                                                                                        | Cobertura de edge cases                     |
| R-13 | ✅ Contador em memória para `_audit_cap_check` — implementado via `_AUDIT_LINE_COUNT` global em `lib/audit-lib.sh`; reset após rotação, sincronizado com `wc -l` quando zerado                                                                                                                                                                                                | ~50% menos I/O em sessões longas            |
| R-14 | ✅ Adicionar index `logs/audit-current.jsonl` symlink — `_audit_update_symlink()` em `lib/audit-lib.sh` (Sprint 8)                                                                                                                                                                                                                                                            | Acesso canônico ao audit ativo              |
| R-15 | ✅ Restringir permissão de `state/session.json` para 0600 — implementado em `lib/state-crud.sh:227` via `chmod 600 "$STATE_FILE"` após criação                                                                                                                                                                                                                                | Segurança: close_key não legível por outros |
| R-16 | ✅ Padronizar `[[ ]]` para toda a base (lint pass) — 19 substituições em `lib/` e `scripts/`: `turn-lifecycle.sh`, `stop-lib.sh`, `subagent-lib.sh`, `api/04-predicates.sh`, `api/08-risk.sh`, `api/09-metrics.sh`, `api/11-compact-context.sh`, `api/12-subagent.sh`, `api/15-audit.sh`, `api/16-lifecycle.sh`, `session-summary.sh`, `smoke-test-payload-api.sh` (Sprint 9) | Consistência POSIX/bash                     |
| R-17 | ✅ Substituir awk fallback em `make_close_key()` por `$RANDOM` — implementado em `lib/utils.sh` (Sprint 8)                                                                                                                                                                                                                                                                    | Entropia levemente melhor                   |

### 7.2 Sequência de Execução Recomendada

```
Sprint 1 (imediato — 1-2h):
  R-01 → R-02 → R-03 → R-04 → R-05
  Validar: bash scripts/smoke-test.sh → 75/75 PASS

Sprint 2 (refatoração — 4-8h):
  R-11 (loader.sh) → R-06 (dividir common.sh) → R-07 (batch turn) → R-08 (log_audit)
  Validar: 75/75 PASS + benchmarks de latência PreToolUse

Sprint 3 (testes e robustez — 4-6h):
  R-12 (novos testes) → R-09 → R-10 → R-13 → R-14 → R-15 → R-16 → R-17
  Validar: suite completa + shellcheck sem erros
```

### 7.3 Riscos e Mitigações

| Risco                                      | Probabilidade | Impacto | Mitigação                                            |
| ------------------------------------------ | ------------- | ------- | ---------------------------------------------------- |
| Dividir common.sh quebra source-ordering   | Alto          | Alto    | Criar branch separada, correr 75/75 antes de merge   |
| R-07 (batch turn) introduz bug de tipos jq | Médio         | Alto    | Adicionar T81 como guard de regressão antes          |
| Deletar .bak quebraria algo não catalogado | Baixo         | Médio   | `grep -r 'hook-payload-api.sh.bak'` antes de deletar |
| padronizar LANG quebra testes set-up       | Baixo         | Baixo   | LANG=C.UTF-8 é o mesmo valor, só a forma muda        |

---

## Apêndice — Inventário Completo

### A.1 Tabela de Arquivos

| Arquivo                             | Linhas | Responsabilidade                         | Issues Identificadas                          |
| ----------------------------------- | ------ | ---------------------------------------- | --------------------------------------------- |
| `hooks.json`                        | 41     | Configuração master (9 hooks)            | Nenhuma                                       |
| `scripts/pre-tool-use.sh`           | ~10    | Entry point PreToolUse                   | Não carrega common.sh diretamente             |
| `scripts/post-tool-use.sh`          | ~12    | Entry point PostToolUse                  | OK                                            |
| `scripts/stop.sh`                   | ~12    | Entry point Stop                         | OK                                            |
| `scripts/session-start.sh`          | ~8     | Entry point SessionStart                 | Não carrega common.sh diretamente             |
| `scripts/session-end.sh`            | ~60    | Entry point SessionEnd + ABRUPT-TURN-END | OK — mais completo que os outros              |
| `scripts/session-close.sh`          | ~12    | Encerramento autorizado de sessão        | Não carrega hook-payload-api.sh               |
| `scripts/subagent-start.sh`         | ~10    | Entry point SubagentStart                | —                                             |
| `scripts/subagent-stop.sh`          | ~10    | Entry point SubagentStop                 | —                                             |
| `scripts/user-prompt-submit.sh`     | ~10    | Entry point UserPromptSubmit             | —                                             |
| `scripts/pre-compact.sh`            | ~10    | Entry point PreCompact                   | —                                             |
| `scripts/watchdog.sh`               | 262    | Watchdog externo                         | Zero testes                                   |
| `scripts/hooks-report.sh`           | ~80    | Relatório de estado                      | Zero testes                                   |
| `scripts/smoke-test.sh`             | 1.411  | 75 testes unitários                      | Cobertura parcial                             |
| `scripts/smoke-test-payload-api.sh` | 1.846  | Testes da API layer                      | —                                             |
| `scripts/integration-test-hooks.sh` | 1.066  | Testes de integração                     | —                                             |
| `scripts/stress-test-hooks.sh`      | 165    | Stress tests                             | Pouco coverage                                |
| `lib/common.sh`                     | 880    | Base compartilhada                       | Monolito, depreciados, perf                   |
| `lib/hook-payload-api.sh`           | 208    | Bootstrap módulos api/                   | Stub inseguro, LANG hardcoded                 |
| `lib/hook-payload-api.sh.bak`       | 208    | **ARQUIVO STALE**                        | **Deletar**                                   |
| `lib/post-tool-use-lib.sh`          | 133    | Lógica PostToolUse                       | OK                                            |
| `lib/pre-compact-lib.sh`            | 98     | Lógica PreCompact                        | Corrigido (bool fix)                          |
| `lib/pre-tool-use-lib.sh`           | 303    | Lógica PreToolUse                        | OK                                            |
| `lib/session-close-lib.sh`          | 191    | Lógica de encerramento                   | Corrigido (printf fix), LANG hardcoded        |
| `lib/session-start-lib.sh`          | 209    | Lógica de início de sessão               | printf `- %s` sem `--` (R-02)                 |
| `lib/stop-lib.sh`                   | 177    | Lógica Stop hook                         | OK                                            |
| `lib/subagent-lib.sh`               | 313    | Lógica Subagent Start/Stop               | OK                                            |
| `lib/user-prompt-submit-lib.sh`     | 169    | Lógica UserPromptSubmit                  | OK                                            |
| `lib/api/01-vars.sh`                | 251    | Variáveis globais da API                 | OK                                            |
| `lib/api/02-parse.sh`               | 259    | Parsing de payload                       | 53 invocações jq — candidato a otimização     |
| `lib/api/03-validate.sh`            | 92     | Validação semântica                      | OK                                            |
| `lib/api/04-predicates.sh`          | 416    | Predicados de decisão                    | OK — arquivo central                          |
| `lib/api/05-output.sh`              | 320    | Formatação de output JSON                | OK                                            |
| `lib/api/06-query.sh`               | 157    | Queries de estado                        | OK                                            |
| `lib/api/07-state.sh`               | 68     | Manipulação de estado                    | Usa `detect_close_key_in_text` depreciada     |
| `lib/api/08-risk.sh`                | 216    | Avaliação de risco e bypass              | OK — crítico de segurança                     |
| `lib/api/09-metrics.sh`             | 250    | Métricas de sessão                       | Sem testes diretos                            |
| `lib/api/10-close-key.sh`           | 120    | Gestão da close_key                      | OK                                            |
| `lib/api/11-compact-context.sh`     | 182    | Contexto para PreCompact                 | OK                                            |
| `lib/api/12-subagent.sh`            | 156    | Gestão de subagentes                     | OK                                            |
| `lib/api/13-state-version.sh`       | 234    | Versionamento de schema                  | Sem testes de migração                        |
| `lib/api/14-validate-events.sh`     | 236    | Validação de payloads                    | Cobertura parcial e usa `[[ ]]` + `[ ]` misto |
| `lib/api/15-audit.sh`               | 183    | Implementação canônica de audit          | OK                                            |
| `lib/api/16-lifecycle.sh`           | 67     | Lifecycle de turn/subturn                | Stubs delegam para legados                    |

### A.2 Matriz de Dependências de Source

```
common.sh
  ├── carregado por: todos os *-lib.sh
  └── providencia: state CRUD, turn lifecycle, briefing, utils (depreciados)

hook-payload-api.sh
  ├── carregado por: session-end.sh diretamente, outros via *-lib.sh
  └── sources: api/01 → 16 (sequencialmente)

api/01-vars.sh → define HOOK_DIR, STATE_DIR, AUDIT_FILE, etc.
api/02-parse.sh → hook_api_parse() — entrada de todos os hooks
api/04-predicates.sh → predicados principais de decisão
api/08-risk.sh → hook_is_bypass_attempt()
api/15-audit.sh → _audit_write_event() — implementação canônica
api/16-lifecycle.sh → stubs para turn_is_orphaned, heal_orphaned_turn
```

### A.3 Eventos de Auditoria Monitorados

| Evento                            | Origem                    | Nível mínimo |
| --------------------------------- | ------------------------- | ------------ |
| `sessionStart_new`                | session-start-lib.sh      | minimal      |
| `sessionStart_reconnect`          | session-start-lib.sh      | minimal      |
| `sessionEnd`                      | session-close-lib.sh      | minimal      |
| `sessionEnd_received`             | session-end.sh            | minimal      |
| `sessionClose`                    | session-close-lib.sh      | minimal      |
| `turnStart`                       | user-prompt-submit-lib.sh | minimal      |
| `turnEnd_authorized`              | stop-lib.sh               | minimal      |
| `turnEnd_unauthorized`            | stop-lib.sh               | minimal      |
| `turnEnd_abrupt`                  | session-end.sh            | minimal      |
| `turnEnd_orphan_healed`           | common.sh                 | normal       |
| `subturnStart`                    | post-tool-use-lib.sh      | verbose      |
| `subturnEnd`                      | post-tool-use-lib.sh      | verbose      |
| `subturnEnd_abrupt`               | stop-lib.sh               | normal       |
| `subagentStart`                   | subagent-lib.sh           | normal       |
| `subagentStop`                    | subagent-lib.sh           | normal       |
| `compliance_block`                | stop-lib.sh               | minimal      |
| `task_complete_blocked`           | pre-tool-use-lib.sh       | minimal      |
| `state_initialized_clean`         | common.sh                 | minimal      |
| `state_recovered_from_checkpoint` | common.sh                 | minimal      |
| `briefing_generated`              | session-start-lib.sh      | minimal      |
| `audit_log_rotated`               | session-close-lib.sh      | minimal      |
| `audit_log_capped`                | common.sh                 | minimal      |
| `close_key_rotated`               | api/10-close-key.sh       | normal       |

### A.4 Referência Rápida: Funções Depreciadas vs Canônicas

| Depreciada                   | Canônica                                    | Localização canônica  |
| ---------------------------- | ------------------------------------------- | --------------------- |
| `log_audit()`                | `hook_log_audit()` / `_audit_write_event()` | `api/15-audit.sh`     |
| `detect_close_key_in_text()` | `hook_close_key_detect_in_text()`           | `api/10-close-key.sh` |
| `turn_is_orphaned()`         | `hook_turn_is_orphaned()`                   | `api/16-lifecycle.sh` |
| `heal_orphaned_turn()`       | `hook_heal_orphaned_turn()`                 | `api/16-lifecycle.sh` |
| `emit_stop_block()`          | `hook_out_stop_block()`                     | `api/05-output.sh`    |
| `emit_additional_context()`  | `hook_out_additional_context()`             | `api/05-output.sh`    |
| `emit_permission_deny()`     | `hook_out_pre_deny()`                       | `api/05-output.sh`    |
| `emit_post_tool_block()`     | `hook_out_post_block()`                     | `api/05-output.sh`    |

---

*Auditoria realizada em 2026-03-20. Próxima revisão recomendada após Sprint 2.*
