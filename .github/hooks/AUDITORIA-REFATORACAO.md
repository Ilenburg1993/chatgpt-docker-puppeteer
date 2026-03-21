# Auditoria de Refatoração — Hook System
**Versão**: 1.0 | **Data**: 2026-03-20 | **Commit base**: `a53925b3`
**Escopo**: 54 arquivos, 11.393 linhas (`.github/hooks/`)
**Status**: Documento canônico de débitos técnicos e plano de refatoração

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

### 2.2 Bug Potencial: `printf '- ...'` em `session-start-lib.sh` — PENDENTE

**Status**: ⚠️ **Não corrigido**
**Arquivo**: `lib/session-start-lib.sh:141` e `:148`
**Evidência**:
```bash
printf '- %s\n' "$issue"   # linha 141
printf '- %s\n' "$warn"    # linha 148
```

**Análise**: O contexto aqui é diferente de `session-close-lib.sh` — o `LANG` não é hardcoded antes dessas chamadas nesse arquivo. Contudo, como `export_lang_utf8()` é chamada globalmente e `LANG=C.UTF-8` pode propagar, existe risco real.
**Risco**: Baixo em produção (valores de `$issue` e `$warn` não começam com `-`), mas a forma incorreta permanece.
**Ação recomendada**: Alterar para `printf -- '- %s\n'` por consistência e segurança defensiva.

---

### 2.3 Problema Documentado: `read_field()` e Boolean False

**Status**: ⚠️ Documentado, workaround ativo, mas pervasivo
**Arquivo**: `lib/common.sh:53` (read_field usa `// empty`)
**Comportamento**: `jq -r '.campo // empty'` retorna string vazia `""` quando o valor JSON é `false` (booleano)

```bash
read_field() { jq -r "${1} // empty" "$STATE_FILE" 2>/dev/null || true; }
# Exemplo: JSON tem "strict_turn_close": false
# read_field ".strict_turn_close" → retorna ""  (não "false")
```

**Workaround aplicado**: Código compara `!= "true"` em vez de `= "false"` (`pre-compact-lib.sh` corrigido)
**Locais com risco de comparação incorreta**:
- Qualquer lugar que compare `read_field ".campo_booleano"` com string `"false"`
- Especialmente: `strict_turn_close`, `pending_session_close`, `ask_questions_called`

**Refatoração proposta**: Criar `read_field_bool()` que retorna literalmente `true` ou `false`:
```bash
read_field_bool() { jq -r "if ${1} then \"true\" else \"false\" end" "$STATE_FILE" 2>/dev/null || echo "false"; }
```

---

### 2.4 Função `log_audit()` Depreciada mas Ainda Presente em `common.sh`

**Status**: ⚠️ Depreciada, mas mantida como fallback
**Arquivo**: `lib/common.sh:355-400` (46 linhas)
**Problema**: A função `log_audit()` é depreciada em favor de `hook_log_audit()` de `api/15-audit.sh`, mas permanece em `common.sh` como fallback para o caso em que `15-audit.sh` não foi carregado.

**Usos ativos de `log_audit` legado**:
- `lib/common.sh:605` — `heal_orphaned_turn()` usa `log_audit` diretamente (deveria usar `hook_log_audit`)

**Usos de `hook_log_audit` (correto)**:
- `lib/subagent-lib.sh` — 6 chamadas ✅
- `lib/stop-lib.sh` — 6 chamadas ✅
- `lib/common.sh:267,277` — 2 chamadas corretas ✅

**Ação**: Migrar `lib/common.sh:605` para usar `hook_log_audit` e remover o fallback legado após confirmar que `15-audit.sh` é sempre carregado.

---

### 2.5 Funções Depreciadas sem Remoção: Stub Wrapper em `16-lifecycle.sh`

**Arquivo**: `lib/api/16-lifecycle.sh`
**Problema**: `hook_turn_is_orphaned()` e `hook_heal_orphaned_turn()` apenas delegam para as versões legadas:

```bash
hook_turn_is_orphaned() {
    turn_is_orphaned "$@"   # chama a legada de common.sh
}
hook_heal_orphaned_turn() {
    heal_orphaned_turn "$@"  # chama a legada de common.sh
}
```

**Consequência**: Dois níveis de indireção desnecessários — `user-prompt-submit-lib.sh → hook_turn_is_orphaned → turn_is_orphaned`.
**Ação**: Mover implementação para `16-lifecycle.sh` e remover a versão legada de `common.sh`.

---

### 2.6 Funções Depreciadas com Implementação Stub em `hook-payload-api.sh`

**Arquivo**: `lib/hook-payload-api.sh:48-55`
**Código**:
```bash
if ! declare -f detect_close_key_in_text > /dev/null 2>&1; then
    detect_close_key_in_text() { return 1; }
fi
```

**Problema**: Cria stub que retorna sempre `1` (false) — se `common.sh` não foi carregado antes, a detecção de close_key silenciosamente falha.
**Ação**: Garantir que `common.sh` seja carregado antes de `hook-payload-api.sh`, tornando o stub desnecessário.

---

### 2.7 `LANG=C.UTF-8` com Estratégias Inconsistentes entre Arquivos

**Problema**: Três abordagens diferentes para garantir LANG:

| Arquivo                       | Abordagem                                        | Risco                                                   |
| ----------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| `session-close-lib.sh:11`     | `export LANG=C.UTF-8` (hardcoded, incondicional) | **Alto** — sobrescreve qualquer configuração do usuário |
| `common.sh:878`               | `export LANG="${LANG:-C.UTF-8}"` (condicional)   | Baixo — respeita variável já definida                   |
| `hook-payload-api.sh:55`      | `export LANG="C.UTF-8"` (hardcoded)              | **Alto** — stub sem guard                               |
| `smoke-test-payload-api.sh:6` | `export LANG="C.UTF-8"`                          | Aceitável em contexto de teste                          |

**Refatoração proposta**: Padronizar todos para usar `export_lang_utf8()` de `common.sh` (que usa `${LANG:-C.UTF-8}`).

---

### 2.8 `increment_field()` e `decrement_field_floor0()` — Sem Lock File

**Status**: ⚠️ Race condition teórica
**Arquivo**: `lib/common.sh:521-555`
**Problema**: A operação de incremento é:
1. `read_field` (jq read) →
2. calcula `new_val` →
3. `mktemp` →
4. `jq write` →
5. `mv -f`

Entre os passos 1 e 5, outro processo pode modificar o mesmo campo, causando race condition (lost update).

**Contexto de risco**: Como hooks do VS Code são seriais por evento, o risco real é baixo. Contudo, durante subagentes paralelos existe risco real de collisão em `session_stats.subagents_active`.

**Refatoração proposta**: Para campos críticos com escrita concorrente (subagents), usar lock file via `flock`:
```bash
(flock -x 9; increment_field ".session_stats.subagents_active"; ) 9>"$STATE_DIR/.lock"
```

---

### 2.9 `open_new_turn()` — 13 Chamadas Sequenciais de `update_nested_state`

**Arquivo**: `lib/common.sh:681-720`
**Problema**: "Open turn" faz 13 invocações separadas de `update_nested_state`, cada uma lendo o JSON, modificando um campo e escrevendo de volta atomicamente. São 13 leituras + 13 escritas ao disco.

```bash
update_nested_state "current_turn.number" "$turn_num"
update_nested_state "current_turn.turn_id" "$turn_id"
# ... 11 chamadas a mais
```

**Impacto**: ~100-200ms de latência por apertura de turno (13x jq fork + 13x mktemp + 13x mv).
**Refatoração proposta**: Criar `open_new_turn_batch()` que executa uma única operação jq em batch:
```bash
jq --arg id "$turn_id" --argjson num "$turn_num" '
  .current_turn = (.current_turn + {
    number: $num, turn_id: $id, started_at: $now, ...
  })
' "$STATE_FILE" > "$tmp" && mv -f "$tmp" "$STATE_FILE"
```

---

### 2.10 `generate_session_briefing()` — Uso Inseguro de Heredoc com `cat >`

**Arquivo**: `lib/common.sh:755-810`
**Problema**: A função usa `cat > "$BRIEFING_FILE" << EOF` com expansão de variáveis. Embora `sanitize_md()` seja chamada antes, o conteúdo de `pending_tasks_content` (oriundo de `pending-tasks.md`) **não é sanitizado** antes de ser inserido no heredoc.

```bash
pending_tasks_content="$(cat "$PENDING_TASKS_FILE")"  # sem sanitize_md!
...
## Tarefas Pendentes
${pending_tasks_content}                               # expansão direta
```

**Risco de Segurança**: Injeção de Markdown/conteúdo arbitrário a partir de `pending-tasks.md` se o arquivo for modificado por agente malicioso.
**Ação**: Aplicar `sanitize_md "$pending_tasks_content"` antes da expansão no heredoc, ou usar `printf '%s\n' "$pending_tasks_content"` fora do heredoc.

---

### 2.11 Uso de `[[ ]]` vs `[ ]` — Inconsistência POSIX/Bash

**Problema**: Mistura de `[[ ]]` (bash) e `[ ]` (POSIX sh) nos mesmos arquivos.

**Evidência** (do `14-validate-events.sh`):
```bash
[[ -z "${_HV_ERRORS:-}" ]] && return 0   # bash
[ -z "${field}" ] && continue            # POSIX
```

**Impacto**: Baixo — scripts usam `#!/usr/bin/env bash` e `set -euo pipefail`, então `[[ ]]` é válido. Mas a inconsistência dificulta leitura e possível portabilidade futura.
**Ação**: Padronizar para `[[ ]]` em code new; revisar usos antigos em uma passagem de lint.

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

#### Módulos Sem Cobertura Direta em Smoke Tests:

| Módulo                                        | Gap Identificado                                  |
| --------------------------------------------- | ------------------------------------------------- |
| `api/09-metrics.sh`                           | Sem testes de cálculo de métricas de duração      |
| `api/11-compact-context.sh`                   | Pouco coverage de serialização de contexto        |
| `api/12-subagent.sh`                          | Budget/depth limits só testados indiretamente     |
| `api/13-state-version.sh`                     | Migration de versão de schema não testada         |
| `api/14-validate-events.sh`                   | Cobertura parcial de validação de payloads        |
| `lib/common.sh` `generate_session_briefing()` | Sem teste direto do output do briefing            |
| `lib/common.sh` `uuidgen_safe()`              | Sem teste de fallback quando `uuidgen` não existe |
| `lib/common.sh` `make_close_key()`            | Sem teste de fallback quando `/dev/urandom` falha |
| `scripts/watchdog.sh`                         | Zero testes automatizados do watchdog             |
| `scripts/hooks-report.sh`                     | Sem testes de regressão                           |

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

### 3.4 Sugestão de Novos Testes (Prioritários)

| ID Proposto | Descrição                                                                  | Prioridade |
| ----------- | -------------------------------------------------------------------------- | ---------- |
| T76         | `session-end.sh` com turn ativo → verifica `turnEnd_abrupt` em audit       | Alta       |
| T77         | `_audit_cap_check()` com HOOKS_AUDIT_MAX_LINES=5 → verifica rotação        | Alta       |
| T78         | `recover_or_init_state()` com checkpoints todos inválidos → init limpo     | Alta       |
| T79         | `printf -- '- %s\n'` em `session-start-lib.sh` com valor iniciando com `-` | Média      |
| T80         | `generate_session_briefing()` output contém session_id e close_key         | Média      |
| T81         | `open_new_turn()` zera corretamente todos os 13 campos                     | Média      |
| T82         | Watchdog detecta sessão travada > threshold e registra evento              | Baixa      |
| T83         | `make_close_key()` fallback sem /dev/urandom → retorna formato correto     | Baixa      |

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

### 4.3 `update_nested_state()` — Análise de Atomicidade

**Mecanismo atual** (correto para single-writer):
```bash
tmp=$(mktemp "$STATE_DIR/.state.XXXXXX")
jq ... "$STATE_FILE" > "$tmp"
mv -f "$tmp" "$STATE_FILE"
```

**Ponto cego**: `mv -f` é atômico apenas quando origem e destino estão no mesmo filesystem. Se `STATE_DIR` for um bind mount ou NFS (improvável mas possível em DevContainer), a atomicidade não é garantida.
**Verificação sugerida**: Adicionar `|| { rm -f "$tmp"; return 1; }` após mv — já está presente em alguns locais mas não em todos.

### 4.4 `_audit_cap_check()` — Chamada após Cada Evento

**Arquivo**: `lib/common.sh:315-340`
**Problema**: `_audit_cap_check()` usa `wc -l` para contar linhas após cada evento gravado. Em sessões longas (> 5000 linhas), isso é potencialmente lento pois lê o arquivo inteiro.

**Alternativa**: Manter contador em memória (variável global `_AUDIT_LINE_COUNT`) e incrementar na função `log_audit`; só chamar `wc -l` na inicialização para sincronizar.

---

## Fase 5 — Segurança e Robustez

### 5.1 Injeção em `increment_tools_by_type()`

**Arquivo**: `lib/common.sh:645-667`
**Situação**: A função sanitiza `tool_name` antes de usar como chave jq:
```bash
safe_name=$(printf '%s' "$tool_name" | tr -cd 'a-zA-Z0-9_-' | cut -c1-64)
```
**Status**: ✅ Adequadamente mitigado via sanitização explícita.

### 5.2 Injeção de Markdown em `generate_session_briefing()`

**Arquivo**: `lib/common.sh:755-810`
**Problema**: `sanitize_md()` é aplicada para campos de estado, mas `pending_tasks_content` (conteúdo completo de `pending-tasks.md`) é inserido verbatim no heredoc.

**Mitigação atual**: Nenhuma.
**Risco prático**: Se o conteúdo de `pending-tasks.md` contiver sequências especiais de Markdown que o agente interprete como instruções, pode haver prompt injection indireta.
**Ação**: Sanitizar ou envolver em bloco de código fenced ```` ``` ```` para neutralizar formatação arbitrária.

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

### 5.5 `make_close_key()` — Entropia da Chave de Encerramento

**Arquivo**: `lib/common.sh:410-448`
**Análise**: A função tem uma cadeia de fallbacks:
1. `/proc/sys/kernel/random/uuid` → primeiros 8 hex (uuid v4) — ✅ Boa entropia
2. `od + /dev/urandom` → 8 hex — ✅ Boa entropia
3. `dd + od` → 8 hex — ✅ Adequado
4. `awk rand()` → timestamp seed — ⚠️ **Previsível** (pseudo-random com seed de /dev/null)
5. `date +%s%N` → timestamp — ⚠️ **Muito previsível**

**Risco**: Em ambientes sem `/dev/urandom` (improvável em Linux moderno), a close_key seria previsível.
**Ação**: Adicionar `RANDOM` seed de bash como fallback adicional entre o awk e o timestamp:
```bash
hex=$(printf '%X%X' "${RANDOM}" "${RANDOM}" | cut -c1-8)
```

### 5.6 Arquivo de Estado Sem Permissão Restrita

**Arquivo**: `state/session.json` criado em `init_state()`
**Problema**: O arquivo é criado com permissões padrão (umask do processo). Pode conter `close_key` legível por outros usuários do sistema.
**Ação**: Adicionar `umask 077` antes de criar o state file, ou usar `install -m 600`.

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

| #    | Ação                                                                 | Impacto Esperado                     |
| ---- | -------------------------------------------------------------------- | ------------------------------------ |
| R-06 | Dividir `common.sh` em módulos menores                               | Manutenibilidade ↑                   |
| R-07 | Criar `open_new_turn_batch()` com jq único                           | Performance: -80% I/O no turn open   |
| R-08 | Migrar `log_audit()` em `common.sh:605` para `hook_log_audit()`      | Consistência API                     |
| R-09 | Implementar `hook_turn_is_orphaned` nativamente em `16-lifecycle.sh` | Eliminar indireção dupla             |
| R-10 | Criar `find_audit_file()` canônico                                   | Fix estrutural da questão de rotação |
| R-11 | Criar `lib/loader.sh` centralizado                                   | Ordem de carregamento garantida      |

#### Nível 3 — Melhorias de Robustez (Longo Prazo)

| #    | Ação                                                        | Benefício                                   |
| ---- | ----------------------------------------------------------- | ------------------------------------------- |
| R-12 | Adicionar testes T76-T83 (ver Fase 3.4)                     | Cobertura de edge cases                     |
| R-13 | Contador em memória para `_audit_cap_check`                 | ~50% menos I/O em sessões longas            |
| R-14 | Adicionar index `logs/audit-current.jsonl` symlink          | Acesso canônico ao audit ativo              |
| R-15 | Restringir permissão de `state/session.json` para 0600      | Segurança: close_key não legível por outros |
| R-16 | Padronizar `[[ ]]` para toda a base (lint pass)             | Consistência POSIX/bash                     |
| R-17 | Substituir awk fallback em `make_close_key()` por `$RANDOM` | Entropia levemente melhor                   |

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
