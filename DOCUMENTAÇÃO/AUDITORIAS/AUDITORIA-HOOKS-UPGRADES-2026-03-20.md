# Auditoria de Upgrades — Sistema de Hooks (2026-03-20)

**Tipo**: Análise de oportunidades de melhoria e feature enhancements
**Escopo**: `.github/hooks/` — todos os módulos (exceto Stop Hook, que permanece desativado)
**Data**: 2026-03-20
**Rodada anterior**: `AUDITORIA-HOOKS-RODADA2-2026-03-20.md` (bug fixes + GAPs)
**HEAD na abertura**: `145040f6`

---

## Sumário Executivo

Após três rodadas de correções de bugs e GAPs (commit `145040f6`, 17/17 smoke-tests PASS),
o sistema de hooks está funcional e estável. Esta auditoria foca exclusivamente em
**oportunidades de upgrade**, organizadas por:

- **Observabilidade e Métricas** — visibilidade aprimorada do comportamento do agente
- **Segurança e Proteção** — detecção mais abrangente de padrões de risco
- **Portabilidade** — compatibilidade com ambientes fora do Linux
- **Experiência do Desenvolvedor** — ferramentas e qualidade de vida
- **Features Novas** — capacidades inéditas no sistema

**18 upgrades identificados**. Os itens UP-03, UP-04, UP-07, UP-08, UP-09 e UP-11 foram
implementados nesta sessão (veja seção final).

---

## Metodologia

Todos os 20+ arquivos do sistema foram lidos e analisados:
- `.github/hooks/lib/common.sh` (730 linhas)
- `.github/hooks/lib/api/01-vars.sh` a `16-lifecycle.sh` (16 módulos)
- `.github/hooks/lib/pre-tool-use-lib.sh`, `post-tool-use-lib.sh`
- `.github/hooks/lib/user-prompt-submit-lib.sh`, `session-start-lib.sh`
- `.github/hooks/lib/session-close-lib.sh`, `subagent-lib.sh`
- `.github/hooks/lib/pre-compact-lib.sh`

---

## Categoria A — Observabilidade e Métricas

### UP-01 — Métricas de ferramentas por tipo (`tools_by_type`)
**Prioridade**: HIGH | **Status**: 🔄 Proposto

**Situação atual**: `session_stats.tools_total` conta todas as ferramentas, mas sem
breakdown por tipo. Não é possível saber quais ferramentas são mais usadas.

**Proposta**: Adicionar `session_stats.tools_by_type` (objeto JSON) no `session.json`.
Em `pre-tool-use-lib.sh → count_tool_use()`, incrementar `tools_by_type[HOOK_TOOL_NAME]`.

**Exemplo de estado após 10 ferramentas**:
```json
"tools_by_type": {
    "read_file": 4,
    "run_in_terminal": 3,
    "replace_string_in_file": 2,
    "vscode_askQuestions": 1
}
```

**Locais afetados**: `common.sh` (init_state), `api/13-state-version.sh` (migration v2),
`pre-tool-use-lib.sh`.

**Valor**: Identifica padrões de uso, detecta anomalias (agente chamando tools excessivamente).

---

### UP-02 — Rastreamento de template `vscode_askQuestions`
**Prioridade**: HIGH | **Status**: 🔄 Proposto

**Situação atual**: `ask_questions_called=true` quando o hook detecta qualquer chamada
ao `vscode_askQuestions`, mas não há registro de qual template (A/B/C/D/E/F/G) foi usado.

**Proposta**: Em `post-tool-use-lib.sh`, quando `hook_is_ask_questions`, inspecionar o
conteúdo de `HOOK_ASK_QUESTIONS_JSON` para detectar prefixo de template via regex
`Template [A-G]`. Persistir em `current_turn.last_template` e acumular contagem em
`compliance.template_usage`.

**Exemplo de state**:
```json
"compliance": {
    "template_usage": {"A": 12, "B": 1, "D": 3, "F": 0},
    "last_template": "A"
}
```

**Locais afetados**: `post-tool-use-lib.sh`, `common.sh` (init_state), `api/13-state-version.sh`.

**Valor**: Analytics de protocolo, verificar que agente usa os templates corretos.

---

### UP-03 — SystemMessage de alerta proativo de compliance ✅ IMPLEMENTADO
**Prioridade**: HIGH | **Status**: ✅ Implementado nesta rodada

**Situação anterior**: Ao fechar um turno sem `ask_questions_called=true`, o state era
atualizado mas o agente não recebia feedback imediato — só no próximo turno (via briefing).

**Implementação**: Em `user-prompt-submit-lib.sh`, ao iniciar um novo turno, verifica
`compliance.consecutive_unauthorized`. Se ≥ 2, emite `hook_out_system_message()` visível
no chat com aviso de compliance antes de `open_new_turn()`. Se consecutive < 2 mas session
foi auto-inicializada, emite o aviso de auto-init (comportamento anterior).

**Arquivo modificado**: `user-prompt-submit-lib.sh`

---

### UP-04 — Duração média de subturns em `session_stats` ✅ IMPLEMENTADO
**Prioridade**: MEDIUM | **Status**: ✅ Implementado nesta rodada

**Situação anterior**: `current_subturn` tem `started_at`/`ended_at` por subturn, mas
nenhuma agregação acumulada de performance.

**Implementação**: Em `post-tool-use-lib.sh`, ao fechar subturn (via `response_at`),
calcular duração em milissegundos com `date +%s%3N` e acumular em dois novos campos:
`session_stats.subturn_duration_total_ms` e `session_stats.subturn_count_timed` para
calcular média ao vivo.

**Arquivo modificado**: `post-tool-use-lib.sh`

---

### UP-05 — `hooks-report.sh` — relatório rico de sessão
**Prioridade**: MEDIUM | **Status**: 🔄 Proposto

**Situação atual**: Para analisar uma sessão, é necessário ler `audit.jsonl` manualmente
ou construir queries jq ad-hoc. Não há script standalone de relatório.

**Proposta**: Criar `scripts/hooks-report.sh` que:
1. Lê `audit.jsonl` com jq
2. Calcula distribuição de eventos por tipo
3. Gera timeline de turnos (authorized vs unauthorized)
4. Produz histograma de ferramentas usadas
5. Exibe taxa de compliance (turnos autorizados / total)

**Exemplo de saída**:
```
=== Session Report ===
Iniciada: 2026-03-20T10:00:00Z | Duração: 2h 15m
Turnos: 18 total | 15 auth (83%) | 3 unauth (17%)
Top tools: read_file 42, run_in_terminal 18, replace_string_in_file 12
Compliance: ████████████████░░░░ 83%
```

**Locais afetados**: novo arquivo `scripts/hooks-report.sh`.

---

---

## Categoria B — Segurança e Proteção

### UP-06 — Rate limiting básico contra loops de tool calls
**Prioridade**: MEDIUM | **Status**: 🔄 Proposto

**Situação atual**: Não há mecanismo de throttle. Um agente em loop pode chamar centenas
de ferramentas em sequência sem qualquer resistência do sistema de hooks.

**Proposta**: Em `pre-tool-use-lib.sh`, antes de `open_new_subturn()`, verificar se
`current_turn.tools_count` ultrapassou um limite configurável (ex: `HOOKS_TOOLS_LIMIT=150`).
Se ultrapassado, emitir `hook_out_pre_deny` com aviso de auto-proteção.

**Configuração**: via variável de ambiente ou campo em `session.json`.

**Locais afetados**: `api/01-vars.sh` (nova var `HOOK_TOOLS_LIMIT`), `pre-tool-use-lib.sh`.

---

### UP-07 — Portabilidade `date -d` em `09-metrics.sh` ✅ IMPLEMENTADO
**Prioridade**: MEDIUM | **Status**: ✅ Implementado nesta rodada

**Situação anterior**: `hook_is_orphan_turn()` em `api/09-metrics.sh` usa `date -d "@epoch"`
que é específico do GNU coreutils (Linux). Em macOS/BSD, `date -r epoch` seria necessário,
mas o código não tinha fallback.

**Implementação**: Adicionado helper `_iso_to_epoch()` em `09-metrics.sh` que tenta
GNU `date -d`, depois BSD `date -j -f`, e por fim `awk` como último recurso (POSIX).
Retorna epoch em segundos. `hook_is_orphan_turn()` usa exclusivamente `_iso_to_epoch()`,
eliminando a dependência de `date -d` hardcoded.

**Arquivo modificado**: `api/09-metrics.sh`

---

### UP-08 — Detectar `git push --force-with-lease` em predicados ✅ IMPLEMENTADO
**Prioridade**: MEDIUM | **Status**: ✅ Implementado nesta rodada

**Situação anterior**: `hook_is_destructive_cmd()` em `api/04-predicates.sh` detectava
`--force` e `-f` como git push destrutivo, mas não `--force-with-lease`, que tem efeito
equivalente (reescrita de histórico remoto) embora seja considerado "seguro" no uso normal.

**Implementação**: Adicionado padrão `--force-with-lease` (e `--force-if-includes`) ao
regex de `hook_is_destructive_cmd`.

**Arquivo modificado**: `api/04-predicates.sh`

---

---

## Categoria C — Portabilidade

### UP-09 — Limpeza de arquivos `.state.XXXXXX` temporários ✅ IMPLEMENTADO
**Prioridade**: MEDIUM | **Status**: ✅ Implementado nesta rodada

**Situação anterior**: `mktemp "$STATE_DIR/.state.XXXXXX"` é usado em cada `update_state`,
`update_nested_state`, etc. Se um hook abortar antes do `mv`, o arquivo temporário fica
indefinidamente em `STATE_DIR`.

**Implementação**: Em `session-start-lib.sh → session_start_main()`, bloco `find` com
`-maxdepth 1 -name '.state.*'` remove todos os temporários no início de cada nova sessão.
Usa `hook_log_audit` para registrar cada remoção. Abordagem intencional no SessionStart:
garante limpeza sem overhead em cada hook individual.

**Arquivo modificado**: `session-start-lib.sh`

---

---

## Categoria D — Experiência do Desenvolvedor

### UP-10 — PreCompact enriquecido com histograma de ferramentas
**Prioridade**: MEDIUM | **Status**: 🔄 Proposto

**Situação atual**: `pre-compact-lib.sh` delega toda a geração de contexto para
`hook_compact_ctx_briefing_full()` em `11-compact-context.sh`. O contexto inclui stats gerais
mas não um breakdown visual de quais ferramentas foram mais usadas no turno/sessão.

**Proposta**: Em `hook_compact_ctx_briefing_full()`, adicionar seção
`## Atividade desta Sessão` com os top-5 tipos de ferramenta (se UP-01 for implementado)
e a taxa de compliance como barra ASCII.

**Locais afetados**: `api/11-compact-context.sh`.

---

### UP-11 — Rastrear posição do `vscode_askQuestions` no turno ✅ IMPLEMENTADO
**Prioridade**: MEDIUM | **Status**: ✅ Implementado nesta rodada

**Situação anterior**: Sabe-se se `ask_questions_called=true`, mas não em qual posição foi
chamado no turno (1ª ferramenta, 5ª, 15ª). O protocolo exige que seja o **último ato**,
então posição próxima do total de ferramentas = boa aderência.

**Implementação**: Em `post-tool-use-lib.sh`, quando `hook_is_ask_questions`, persiste
`current_turn.tools_count` no momento da chamada como `current_turn.ask_questions_turn_pos`.
O campo é resetado para `0` em `open_new_turn()`. Também registrado no `audit.jsonl` com
key `turn_pos` no evento `askQuestions_responded`.

**Arquivo modificado**: `post-tool-use-lib.sh`, `common.sh` (schema + open_new_turn)

---

### UP-12 — Predicados de grupo semântico (`hook_is_search_tool`, etc.)
**Prioridade**: LOW | **Status**: 🔄 Proposto

**Situação atual**: Predicados individuais existem (`hook_is_file_read`, `hook_is_file_write`,
`hook_is_run_in_terminal`), mas não há agrupamentos semânticos.

**Proposta**: Adicionar em `api/04-predicates.sh`:
- `hook_is_search_tool()` — `grep_search`, `semantic_search`, `file_search`, `tool_search_tool_regex`
- `hook_is_code_edit_tool()` — `create_file`, `replace_string_in_file`, `multi_replace_string_in_file`
- `hook_is_browser_tool()` — `fetch_webpage`, `open_browser_page`, `navigate_page`
- `hook_is_ai_delegation_tool()` — `runSubagent`, `switch_agent`

**Locais afetados**: `api/04-predicates.sh`.

---

### UP-13 — `session-summary.sh` — resumo inline para o agente
**Prioridade**: LOW | **Status**: 🔄 Proposto

**Situação atual**: O agente deve ler `session-briefing.md` para ver o estado. Não há
comando rápido que retorne um resumo de 5 linhas para inclusão em logs de depuração.

**Proposta**: Criar `scripts/session-summary.sh` que emite uma linha condensada:
```
SESSION abc123 | T:18 A:15(83%) | COMP:OK | KEY:ENCERRAR-AB12CD34
```
Útil para incluir em output de `hooks-status.sh` e outros scripts de diagnóstico.

---

---

## Categoria E — Features Novas

### UP-14 — Schema versão 2 com migração automática
**Prioridade**: HIGH | **Status**: 🔄 Proposto (depende de UP-01, UP-02)

**Situação atual**: Schema versão "1" (definido em `api/13-state-version.sh`). Não contempla
os novos campos propostos em UP-01 (`tools_by_type`) e UP-02 (`compliance.template_usage`).

**Proposta**: Bumpar `HOOK_STATE_SCHEMA_CURRENT` para "2" e adicionar path de migração em
`hook_state_migrate()` que adiciona os campos ausentes sem sobrescrever estado existente.

**Exemplo de migration v1→v2**:
```bash
# Adiciona tools_by_type se ausente
jq 'if .session_stats.tools_by_type == null then
    .session_stats.tools_by_type = {}
  else . end' "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
```

**Locais afetados**: `api/13-state-version.sh`, `common.sh` (init_state).

---

### UP-15 — Notificação no PreCompact quando ask_questions não foi chamado
**Prioridade**: MEDIUM | **Status**: 🔄 Proposto

**Situação atual**: Quando a compactação é acionada, o contexto emitido pelo `pre-compact-lib.sh`
não inclui aviso explícito se o turno atual não chamou `vscode_askQuestions`.

**Proposta**: Em `build_compact_context()`, verificar `current_turn.ask_questions_called`.
Se `false` e turno ativo, adicionar aviso `⚠️ Protocolo: o turno atual não chamou
vscode_askQuestions antes da compactação.` no topo do additionalContext.

**Locais afetados**: `pre-compact-lib.sh` ou `api/11-compact-context.sh`.

---

### UP-16 — Remoção planejada de funções `emit_*` legadas
**Prioridade**: LOW | **Status**: 🔄 Proposto

**Situação atual**: `common.sh` contém quatro funções marcadas `@deprecated`:
`emit_stop_block`, `emit_additional_context`, `emit_permission_deny`, `emit_post_tool_block`.
Estão mantidas `for backward-compatibility` mas não são mais chamadas.

**Proposta**: Verificar via `grep -r` que nenhum arquivo fora de `common.sh` as chama.
Se nenhuma referência externa existir, remover as funções. Reduz ~40 linhas de código morto.

**CI gate sugerido**: adicionar `shellcheck` ou `grep` ao smoke-test para garantir ausência.

---

### UP-17 — Watchdog: verificação de divergência state vs audit
**Prioridade**: MEDIUM | **Status**: 🔄 Proposto

**Situação atual**: `scripts/watchdog.sh` verifica integridade básica (arquivos existem,
JSON válido, etc). Não verifica consistência semântica entre `session.json` e `audit.jsonl`.

**Proposta**: Adicionar check `audit_state_coherence` ao watchdog que compara:
- `session_stats.turn_count` vs número de `turnStart` events no `audit.jsonl`
- `session_stats.tools_total` vs número de `subturnStart` events
- Se divergência > 2, emite WARNING

**Locais afetados**: `scripts/watchdog.sh`.

---

### UP-18 — `hook_stat_session_duration_seconds()` lazy getter
**Prioridade**: LOW | **Status**: 🔄 Proposto

**Situação atual**: `api/09-metrics.sh` tem lazy getters para turn_count, subturn_total,
tools_total, etc., mas não para a duração total da sessão.

**Proposta**: Adicionar `hook_stat_session_duration_seconds()` que calcula
`(now - started_at)` em segundos (usando o novo `_iso_to_epoch` de UP-07). Útil para
alertas de sessão longa e o `hooks-report.sh` proposto em UP-05.

**Locais afetados**: `api/09-metrics.sh`.

---

### UP-19 — `current_turn.subagents_started` nunca incrementado ✅ IMPLEMENTADO
**Prioridade**: MEDIUM | **Status**: ✅ Implementado nesta rodada

**Situação anterior**: `api/12-subagent.sh → hook_subagent_count_turn()` lê o campo
`.current_turn.subagents_started`, mas `subagent-lib.sh → subagent_start_counters()` nunca
incrementava esse campo — apenas `session_stats.subagents_active` e `subagents_total`.
Isso tornava `hook_subagent_count_turn()` sempre 0.

**Implementação**: Em `subagent-lib.sh → subagent_start_counters()`, adicionado
`increment_field '.current_turn.subagents_started'`. O campo é inicializado em `init_state`
e resetado para `0` em `open_new_turn()`.

**Arquivo modificado**: `subagent-lib.sh`, `common.sh` (schema + open_new_turn)

---

---

## Plano de Implementação por Fase

| Fase       | Itens                      | Descrição                    | Status         |
| ---------- | -------------------------- | ---------------------------- | -------------- |
| **FASE 1** | UP-07, UP-08, UP-09        | Correções defensivas seguras | ✅ Implementado |
| **FASE 2** | UP-03, UP-04, UP-11, UP-19 | Observabilidade de runtime   | ✅ Implementado |
| **FASE 3** | UP-14, UP-01, UP-02        | Schema v2 + novas métricas   | 🔄 Proposto     |
| **FASE 4** | UP-05, UP-13, UP-17        | Novos scripts de suporte     | 🔄 Proposto     |
| **FASE 5** | UP-10, UP-15, UP-16        | Refinamentos e limpeza       | 🔄 Proposto     |
| **Futuro** | UP-06, UP-12, UP-18        | Nice-to-have                 | 🔄 Proposto     |

---

## Resumo de Implementações desta Rodada

| ID    | Arquivo                             | Mudança                                                           |
| ----- | ----------------------------------- | ----------------------------------------------------------------- |
| UP-03 | `user-prompt-submit-lib.sh`         | `hook_out_system_message` ao iniciar turno quando consecutive ≥ 2 |
| UP-04 | `post-tool-use-lib.sh`, `common.sh` | `subturn_duration_total_ms` acumulado; `duration_ms` no subturn   |
| UP-07 | `api/09-metrics.sh`                 | `_iso_to_epoch()` com fallback GNU→BSD→awk (portável)             |
| UP-08 | `api/04-predicates.sh`              | `--force-with-lease` e `--force-if-includes` no regex destrutivo  |
| UP-09 | `session-start-lib.sh`              | `find .state.*` remove temps órfãos a cada SessionStart           |
| UP-11 | `post-tool-use-lib.sh`, `common.sh` | `ask_questions_turn_pos` salvo; resetado em `open_new_turn`       |
| UP-19 | `subagent-lib.sh`, `common.sh`      | `current_turn.subagents_started` incrementado em SubagentStart    |

---

*Auditoria realizada em 2026-03-20. Próxima revisão sugerida ao implementar FASE 3.*
