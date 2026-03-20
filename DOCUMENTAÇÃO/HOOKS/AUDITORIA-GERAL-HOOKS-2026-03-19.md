# Auditoria Geral do Sistema de Hooks — 2026-03-19

**Versão**: 1.1
**Data**: 2026-03-19 (v1.1 — análise arquitetural common.sh→API adicionada)
**Escopo**: Todo o sistema de hooks — fat libs, módulos API (01–14), scripts, instruções ao agente, lifecycle session→turn→subturn, cobertura de testes, infraestrutura operacional
**Status**: 62 gaps + análise arquitetural de common.sh
**Produzido por**: GitHub Copilot (Claude Sonnet 4.6), auditoria pós-push do v2.5

---

## Sumário Executivo

O sistema de hooks atingiu maturidade técnica considerável: 14 módulos API, 335 smoke tests e 111 integration tests passando, ShellCheck limpo. Porém a auditoria revelou **62 gaps** distribuídos entre bugs reais, inconsistências arquiteturais, funcionalidades implementadas mas não integradas, e brechas nas instruções ao agente. Os achados mais críticos envolvem:

1. **Bugs silenciosos**: `write_state()` não-atômico, `strict_turn_close` nunca lido, campo `session-context.json` inexistente mas referenciado.
2. **Enforcement desativado indefinidamente**: stop-lib.sh não bloqueia turnos não-autorizados.
3. **Módulos v2.x ociosos**: Módulos 09, 10, 12, 13, 14 carregados mas nenhum fat lib os usa.
4. **Instrução ao agente desatualizada**: referências a campos e arquivos que não existem.

---

## Índice por Categoria

| #   | Categoria                       | Gaps  |
| --- | ------------------------------- | ----- |
| A   | Bugs e Falhas Silenciosas       | 1–12  |
| B   | Lifecycle SESSION→TURN→SUBTURN  | 13–22 |
| C   | Módulos API v2.x não integrados | 23–29 |
| D   | Enforcement e Segurança         | 30–36 |
| E   | Instruções ao Agente (Contexto) | 37–45 |
| F   | Cobertura de Testes             | 46–51 |
| G   | Infraestrutura e Operações      | 52–57 |
| H   | Qualidade de Código e Design    | 58–62 |

---

## Critérios de Severidade

| Nível     | Significado                                                                      |
| --------- | -------------------------------------------------------------------------------- |
| 🔴 CRÍTICO | Causa comportamento incorreto, dados corrompidos ou falha silenciosa em produção |
| 🟠 ALTO    | Gap funcional significativo que prejudica operação regular                       |
| 🟡 MÉDIO   | Inconsistência ou incompletude que cria risco latente                            |
| 🟢 BAIXO   | Melhoria de qualidade, cobertura ou clareza sem impacto imediato                 |

---

## Análise Arquitetural: `common.sh` vs API

> **Contexto**: A pergunta é — qual parte do `common.sh` deveria estar dentro da API (módulos `lib/api/*.sh`) versus permanecer como infraestrutura de baixo nível?

### Princípio de dependência (imutável)

```
API modules (01-14)  →  depende de  →  common.sh  →  depende de  →  jq / bash / OS
fat libs             →  sourceia ambos
```

`common.sh` **não pode** depender de nenhum módulo API. O fluxo de dependência é unidirecional. Isso limita o que pode ser migrado com segurança.

### Mapa atual de `common.sh` (38 funções em 552 linhas)

| Função                        | Camada atual       | Proposta                  | Destino                                                                  |
| ----------------------------- | ------------------ | ------------------------- | ------------------------------------------------------------------------ |
| `state_exists()`              | Infrastructure     | **Manter**                | `common.sh` — depende de `$STATE_FILE`                                   |
| `read_field()`                | Infrastructure     | **Manter**                | `common.sh` — base usada pela API                                        |
| `write_state()`               | Infrastructure     | **Manter** (+ fix GAP-01) | `common.sh`                                                              |
| `update_state()`              | Infrastructure     | **Manter**                | `common.sh`                                                              |
| `update_state_bool()`         | Infrastructure     | **Manter**                | `common.sh`                                                              |
| `update_nested_state()`       | Infrastructure     | **Manter**                | `common.sh`                                                              |
| `increment_field()`           | Infrastructure     | **Manter**                | `common.sh`                                                              |
| `decrement_field_floor0()`    | Infrastructure     | **Manter**                | `common.sh`                                                              |
| `log_audit()`                 | Infrastructure     | **Manter**                | `common.sh` — usada pela API também                                      |
| `now_iso()`                   | Utility            | **Manter**                | `common.sh` — primitiva                                                  |
| `jq_field()`                  | Utility            | **Manter**                | `common.sh` — primitiva                                                  |
| `uuidgen_safe()`              | Utility            | **Manter**                | `common.sh` — primitiva                                                  |
| `jq_safe()`                   | Utility            | **Manter**                | `common.sh` — primitiva                                                  |
| `load_payload()`              | Hook bootstrap     | **Migrar**                | `02-parse.sh` — é parsing de payload                                     |
| `maybe_capture_debug()`       | Hook debug         | **Migrar**                | novo `15-debug.sh` ou `02-parse.sh`                                      |
| `init_state()`                | State schema       | **Migrar**                | `13-state-version.sh` — é o "version 1 schema"                           |
| `make_close_key()`            | Business logic     | **Migrar**                | `10-close-key.sh` — já tem `hook_close_key_generate()` (duplicata!)      |
| `detect_close_key_in_text()`  | Business logic     | **Migrar**                | `07-state.sh` — já tem `hook_close_key_in_response()` (duplicata!)       |
| `generate_section_id()`       | Utility            | **Migrar**                | `01-vars.sh` ou novo `15-lifecycle.sh`                                   |
| `emit_additional_context()`   | Output             | **Migrar**                | `05-output.sh` — já tem `hook_out_session_start_context()` (substituto!) |
| `emit_stop_block()`           | Output             | **Migrar**                | `05-output.sh` — já tem `hook_out_stop_block()` (substituto!)            |
| `emit_permission_deny()`      | Output             | **Migrar**                | `05-output.sh` — já tem `hook_out_pre_deny()` (substituto!)              |
| `emit_post_tool_block()`      | Output             | **Migrar**                | `05-output.sh` — já tem `hook_out_post_block()` (substituto!)            |
| `open_new_turn()`             | Lifecycle          | **Migrar**                | novo `15-lifecycle.sh`                                                   |
| `open_new_subturn()`          | Lifecycle          | **Migrar**                | novo `15-lifecycle.sh`                                                   |
| `count_tool_use()`            | Lifecycle          | **Migrar**                | novo `15-lifecycle.sh`                                                   |
| `turn_is_orphaned()`          | Lifecycle          | **Migrar**                | novo `15-lifecycle.sh`                                                   |
| `heal_orphaned_turn()`        | Lifecycle          | **Migrar**                | novo `15-lifecycle.sh`                                                   |
| `maybe_heal_orphaned_turn()`  | Lifecycle          | **Migrar**                | novo `15-lifecycle.sh`                                                   |
| `generate_session_briefing()` | Context generation | **Migrar**                | novo `16-briefing.sh` (muita lógica!)                                    |
| `context_block()`             | Context generation | **Migrar**                | novo `16-briefing.sh`                                                    |
| `read_briefing()`             | Context generation | **Migrar**                | novo `16-briefing.sh`                                                    |

### Duplicatas confirmadas entre `common.sh` e API

| Função em `common.sh`        | Equivalente na API                                   | Ação                                      |
| ---------------------------- | ---------------------------------------------------- | ----------------------------------------- |
| `make_close_key()`           | `hook_close_key_generate()` em `10-close-key.sh`     | Remover de common.sh, fat libs usam a API |
| `detect_close_key_in_text()` | `hook_close_key_in_response()` em `07-state.sh`      | Remover de common.sh, fat libs usam a API |
| `emit_stop_block()`          | `hook_out_stop_block()` em `05-output.sh`            | Remover de common.sh, fat libs usam a API |
| `emit_permission_deny()`     | `hook_out_pre_deny()` em `05-output.sh`              | Remover de common.sh, fat libs usam a API |
| `emit_post_tool_block()`     | `hook_out_post_block()` em `05-output.sh`            | Remover de common.sh, fat libs usam a API |
| `emit_additional_context()`  | `hook_out_session_start_context()` em `05-output.sh` | Remover de common.sh (fix GAP-02 incluso) |

### Novos módulos propostos

| Módulo            | Conteúdo                                                                                                                                           | Justificativa                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `15-lifecycle.sh` | `open_new_turn`, `open_new_subturn`, `count_tool_use`, `turn_is_orphaned`, `heal_orphaned_turn`, `maybe_heal_orphaned_turn`, `generate_section_id` | Lifecycle de turn/subturn é domínio da API, não de infraestrutura       |
| `16-briefing.sh`  | `generate_session_briefing`, `context_block`, `read_briefing`                                                                                      | Geração de briefing é lógica de negócio complexa, merece módulo próprio |

> `init_state()` deve migrar para `13-state-version.sh` — é literalmente o "schema versão 1".
> `load_payload()` e `maybe_capture_debug()` devem migrar para `02-parse.sh` — são parsing/debug de payload.

### Resultado esperado após refactor

`common.sh` final teria apenas **infrastructure pura** (~200 linhas):
`state_exists`, `read_field`, `write_state`, `update_*`, `increment_field`, `decrement_field_floor0`, `log_audit`, `now_iso`, `jq_field`, `jq_safe`, `uuidgen_safe` — todas as funções que o próprio API precisa para operar.

### Decisão sobre STOP enforcement

> **⛔ STOP enforcement permanece DESATIVADO intencionalmente.**
>
> `emit_stop_block()` NÃO será reativado neste ciclo. O hook Stop classifica turnos
> (autorizado/não-autorizado) e registra no audit, mas não emite `decision:block`.
> Essa decisão é deliberada para evitar regressões até que o sistema de lifecycle
> esteja estabilizado com os novos módulos `15-lifecycle.sh` e `16-briefing.sh`.
>
> **Revisão de reativação**: após módulos 15-16 estabilizados e integração de
> `strict_turn_close` no stop-lib.sh devidamente testada.

---

---

## Categoria A — Bugs e Falhas Silenciosas

---

### GAP-01 — `write_state()` não é atômico

**Severidade**: 🔴 CRÍTICO
**Status**: ✅ RESOLVIDO — commit `d88159da`
**Localização**: `lib/common.sh:96-100`

**Descrição**: A função `write_state()` escreve o JSON diretamente em `$STATE_FILE` com `printf '%s\n' "$json" > "$STATE_FILE"`, sem arquivo temporário intermediário. Se o processo for interrompido durante a escrita (preempção de OS, kill, timeout do hook), o `session.json` ficará truncado ou corrompido.

**Contraste**: Todas as outras funções de escrita (`update_state`, `update_state_bool`, `update_nested_state`, `increment_field`) usam o padrão seguro com `mktemp` + `mv -f`.

**Proposta de correção**:
```bash
write_state() {
    local json="$1"
    local tmp
    mkdir -p "$STATE_DIR"
    tmp="$(mktemp "$STATE_DIR/.state.XXXXXX")"
    printf '%s\n' "$json" > "$tmp"
    mv -f "$tmp" "$STATE_FILE"
}
```

---

### GAP-02 — `emit_additional_context()` usa `hookEventName: SessionStart` hardcoded

**Severidade**: 🔴 CRÍTICO
**Status**: ✅ RESOLVIDO — commit `d88159da`
**Localização**: `lib/common.sh:202-207`, `lib/pre-compact-lib.sh:79`

**Descrição**: A função `emit_additional_context()` produz sempre `"hookEventName":"SessionStart"` no output JSON, independente do evento real. O `pre-compact-lib.sh` chama esta função, resultando em payload PreCompact com event name "SessionStart". Isso pode confundir o parser do VS Code e causar injeção de contexto incorreto.

```bash
# Atual — errado para PreCompact:
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' "$escaped"
```

**Proposta de correção**: Adicionar parâmetro `event_name` ou usar `hook_out_session_start_context()` e criar equivalente `hook_out_pre_compact_context()` em `05-output.sh`, que já tem a estrutura correta.

---

### GAP-03 — `strict_turn_close` nunca é lido pelo stop-lib.sh

**Severidade**: 🔴 CRÍTICO
**Status**: ✅ RESOLVIDO — commit `9e0a7a70`
**Localização**: `lib/stop-lib.sh`, `lib/common.sh:128`, `.github/instructions/hooks-protocol.instructions.md:160`

**Descrição**: O campo `strict_turn_close: true` é gravado no `init_state()` e documentado no protocolo como mecanismo que exige `vscode_askQuestions` para encerrar turno. Porém nenhuma linha em `stop-lib.sh` lê este campo. O enforcement de closure do turno é ignorado completamente.

**Estado atual**: `stop-lib.sh` classifica turnos como autorizados/não-autorizados mas **não bloqueia** (enforcement desativado por comentário). O `strict_turn_close` deveria ser a chave para ativar/desativar este enforcement.

**Proposta de correção**: Em `stop_main()`, após verificar `ask_q`, ler `strict_turn_close` do state. Se `true` e `ask_q != "true"`, emitir `emit_stop_block()` respeitando a regra anti-loop de `stop_hook_active`.

---

### GAP-04 — `heal_orphaned_turn()` não reseta `current_turn.started_at`

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `bfdc07a3`
**Localização**: `lib/common.sh:395-401`

**Descrição**: A função `heal_orphaned_turn()` atualiza `current_turn.ask_questions_called = false` e faz log de auditoria, mas não reseta `current_turn.started_at = null`. Na próxima execução de `UserPromptSubmit`, `maybe_heal_orphaned_turn()` pode identificar novamente o mesmo "turno anterior" como órfão e tentar healar duas vezes.

**Proposta de correção**:
```bash
heal_orphaned_turn() {
    ...
    update_nested_state "current_turn.ask_questions_called" "false"
    update_nested_state "current_turn.started_at" "null"   # ← adicionar
    log_audit "turnEnd_orphan_healed" ...
}
```

---

### GAP-05 — `open_new_turn()` não limpa `current_turn.intent`

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `d88159da`
**Localização**: `lib/common.sh:411-422`

**Descrição**: A função `open_new_turn()` reseta `ask_questions_called`, `subturn_count`, `tools_count`, mas não limpa `current_turn.intent`. A intenção declarada no turno anterior (via `start-turn.sh`) persiste para o turno seguinte, podendo causar associação errada de intenção no audit log.

**Proposta de correção**: Adicionar `update_nested_state "current_turn.intent" ""` dentro de `open_new_turn()`.

---

### GAP-06 — `hook_state_migrate()` usa path com duplo ponto (jq inválido)

**Severidade**: 🔴 CRÍTICO
**Status**: ✅ RESOLVIDO — commit `bfdc07a3`
**Localização**: `lib/api/13-state-version.sh:110`

**Descrição**: A chamada `update_nested_state '.strict_turn_close' 'false'` passa o path com ponto inicial. A função `update_nested_state` constrói `jq_path=".${key_path}"`, resultando em `..strict_turn_close` — path jq inválido. O erro é silenciado por `2>/dev/null || true`, então a migração de `strict_turn_close` **silenciosamente não se aplica**.

**Evidência**:
```bash
# Em 13-state-version.sh:
update_nested_state '.strict_turn_close' 'false' 2>/dev/null || true
# → jq_path = ".." + ".strict_turn_close" = "..strict_turn_close" → jq erro
```

**Proposta de correção**: Remover o ponto inicial: `update_nested_state 'strict_turn_close' 'false'`.

---

### GAP-07 — `post-tool-use-lib.sh` não fecha subturn para ferramentas não-askQuestions

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `bfdc07a3`
**Localização**: `lib/post-tool-use-lib.sh`

**Descrição**: `post_tool_use_main()` só atualiza `current_subturn.response_at` quando `hook_is_ask_questions()` é verdadeiro. Para todas as demais ferramentas (read_file, run_in_terminal, etc.), o subturn aberto em `PreToolUse` nunca recebe `response_at`. A estrutura `current_subturn` fica em estado inconsistente até o próximo `PreToolUse` sobrescrever.

**Proposta de correção**: Sempre atualizar `current_subturn.response_at` no PostToolUse, independente do tipo de ferramenta.

---

### GAP-08 — `subagents_active` e `subagents_total` ausentes do `init_state()`

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `d88159da`
**Localização**: `lib/common.sh:110-155` (init_state), `lib/subagent-lib.sh`

**Descrição**: Os campos `session_stats.subagents_active` e `session_stats.subagents_total` são usados por `subagent_start_counters()` e `subagent_stop_counters()`, mas não são declarados em `init_state()`. Dependem de fallback `${current:-0}` que funciona, mas significa que um `jq .session_stats` do estado inicial não listará esses campos, e ferramentas que esperam schema completo falharão silenciosamente.

**Proposta de correção**: Adicionar em `init_state()` dentro de `session_stats`:
```json
"subagents_active": 0,
"subagents_total": 0
```

---

### GAP-09 — `make_close_key()` fallback de timestamp é previsível

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `666329eb`
**Localização**: `lib/common.sh:238-248`

**Descrição**: O último recurso para gerar a close_key usa `date +%s%N` (epoch em nanossegundos). Se o sistema não tiver `/proc/sys/kernel/random/uuid` nem `od`, a chave gerada é derivada de timestamp — potencialmente previsível se o atacante souber o momento de criação da sessão. Em ambientes DevContainer padrão (Linux) isso não é problema, mas é uma fragilidade latente.

**Proposta de correção**: Adicionar fallback intermediário com `/dev/urandom` via `dd bs=4 count=1 if=/dev/urandom 2>/dev/null | od -An -tx1 | tr -d ' \n' | head -c8`.

---

### GAP-10 — `log_audit()` com `log_audit "turnEnd_orphan_healed"` não registra `ended_at`

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `bfdc07a3`
**Localização**: `lib/common.sh:395-401` (heal_orphaned_turn)

**Descrição**: O healing de turno órfão registra o evento no audit log, mas não registra nenhum `ended_at` no `current_turn`. Um turno órfão "curado" não deixa rastro temporal concreto de quando foi encerrado no state — apenas no audit log.

**Proposta de correção**: Adicionar `update_nested_state "current_turn.ended_at" "$(now_iso)"` em `heal_orphaned_turn()`.

---

### GAP-11 — `generate_section_id()` usa `xxd` que pode não estar instalado

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `9e0a7a70`
**Localização**: `lib/common.sh:271-276`

**Descrição**: `head -c4 /dev/urandom | xxd -p | head -c8` requer `xxd`. Em imagens Alpine mínimas ou Debian slim, `xxd` pode não estar disponível (`xxd` é parte do pacote `vim-common` no Debian). Sem `xxd`, o sufixo aleatório da seção ID pode ser vazio ou causar erro silencioso.

**Proposta de correção**: Usar `od -An -tx1` como fallback, similar ao `make_close_key()`.

---

### GAP-12 — `extract_subagent_meta()` trunca prompt com `head -c80` — risco UTF-8

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `666329eb`
**Localização**: `lib/subagent-lib.sh`

**Descrição**: `printf '%s' "$input" | jq -r '...' | head -c80` trunca no 80º byte, podendo cortar no meio de um caractere UTF-8 multibyte. Se `SUBAGENT_PROMPT` for usado em JSON posterior, pode produzir sequência UTF-8 inválida.

**Proposta de correção**: Usar `cut -c1-80` (opera em chars, não bytes) ou `jq '.[0:80]'` antes do `head`.

---

## Categoria B — Lifecycle SESSION→TURN→SUBTURN

---

### GAP-13 — `current_turn.ended_at` não existe na schema

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `bfdc07a3`
**Localização**: `lib/common.sh` (open_new_turn, stop-lib.sh), `DOCUMENTAÇÃO/HOOKS/ARQUITETURA-CANONICA-SESSION-SECTION-TURN-SUBTURN.md`

**Descrição**: O `current_turn` tiene `started_at` mas nenhum `ended_at`. O Stop hook classifica e fecha o turno (autorizado/não-autorizado) mas não registra quando o turno terminou no state. Para reconstrução forense do timeline, isso é uma lacuna.

**Proposta de correção**: Adicionar `ended_at: null` em `init_state()` e popular em `stop_main()`.

---

### GAP-14 — Não há `current_subturn.ended_at` na schema

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `9e0a7a70`
**Localização**: `lib/common.sh:130-135` (schema de current_subturn)

**Descrição**: `current_subturn` tem `started_at` e `response_at` mas não `ended_at`. O PostToolUse atualiza `response_at` para asks, mas para as demais ferramentas nem isso acontece (GAP-07). Não há campo explícito de encerramento do subturn.

**Proposta de correção**: Adicionar `ended_at: null` ao schema e popular no PostToolUse.

---

### GAP-15 — `UserPromptSubmit` não injeta additionalContext ao agente

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `bfdc07a3`
**Localização**: `lib/user-prompt-submit-lib.sh`

**Descrição**: No cenário de auto-init (sessão criada ao primeiro prompt sem SessionStart), o estado é inicializado mas zero contexto é enviado ao agente. O agente começa o turno sem saber que existe um sistema de hooks ativo, sem a close_key, sem o briefing. Apenas o SessionStart injeta contexto.

**Proposta de correção**: Quando `ensure_state_initialized` cria um estado novo (auto-init), emitir ao menos `systemMessage` com instrução mínima de protocolo, ou injetar o briefing via `additionalContext` no formato `UserPromptSubmit` (se suportado) ou `systemMessage`.

---

### GAP-16 — `is_ask_questions_response()` em user-prompt-submit-lib.sh é dead code

**Severidade**: 🟢 BAIXO
**Status**: ✅ RESOLVIDO — commit `666329eb`
**Localização**: `lib/user-prompt-submit-lib.sh:66-75`

**Descrição**: A função `is_ask_questions_response()` é definida mas nunca chamada em `user_prompt_submit_main()`. Constitui dead code que adiciona confusão sem funcionalidade.

**Proposta de correção**: Remover a função ou documentar que é reservada para uso futuro.

---

### GAP-17 — Stop hook classifica turn sem verificar se `UserPromptSubmit` ocorreu

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `666329eb`
**Localização**: `lib/stop-lib.sh:33-43`

**Descrição**: O Stop só pula a classificação se `turn_count = 0`. Se um turno sintético foi criado por `ensure_state_for_tool` (auto-init no PreToolUse), esse turno não foi gerado por `UserPromptSubmit` real — mas o Stop o classificará normalmente como autorizado ou não. A origem do turno (real vs sintético) não é rastreada.

**Proposta de correção**: Adicionar campo `current_turn.source: "userPromptSubmit" | "synthetic" | "reconnect"` para diferenciar turnos reais de sintéticos na classificação.

---

### GAP-18 — Sem limite configurável de `ORPHAN_THRESHOLD_SECONDS`

**Severidade**: 🟢 BAIXO
**Status**: ✅ RESOLVIDO — commit `9e0a7a70`
**Localização**: `lib/user-prompt-submit-lib.sh:41`

**Descrição**: `ORPHAN_THRESHOLD_SECONDS=600` é hardcoded. Não há como configurar via arquivo de configuração ou variável de ambiente. Em sessões com respostas rápidas, 10 minutos pode ser longo demais ou curto demais dependendo do contexto.

**Proposta de correção**: Tornar configurável via variável de ambiente: `ORPHAN_THRESHOLD_SECONDS="${HOOKS_ORPHAN_THRESHOLD:-600}"`.

---

### GAP-19 — Reconexão em `session-start-lib.sh` não verifica migração de schema

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `bfdc07a3`
**Localização**: `lib/session-start-lib.sh:127-133` (session_start_main)

**Descrição**: Ao reconectar (`is_reconnect=true`), o state existente é mantido sem verificar se precisa de migração. Se o state foi criado com versão anterior (schema 0), os novos campos adicionados na migração 0→1 (`strict_turn_close`, `compliance`, etc.) podem estar ausentes.

**Proposta de correção**: Após confirmar reconexão, chamar `hook_state_needs_migration && hook_state_migrate` antes de gerar o briefing.

---

### GAP-20 — Bypass-bloqueado não incrementa `tools_count` nem `subturn_count`

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `666329eb`
**Localização**: `lib/pre-tool-use-lib.sh:50-59`

**Descrição**: Quando `hook_is_bypass_attempt()` detecta tentativa de bypass, o `emit_permission_deny` é emitido e o script sai com `exit 0`. O subturn nunca é aberto e `tools_count` não é incrementado. A tentativa de bypass fica registrada apenas no audit log, mas os contadores de ferramentas subestimam o número real de invocações.

**Proposta de correção**: Incrementar `tools_count` mesmo para ferramentas bloqueadas, adicionando um campo `tools_blocked` nos stats.

---

### GAP-21 — `open_new_subturn()` não verifica se há turn ativo

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `9e0a7a70`
**Localização**: `lib/common.sh:430-450`

**Descrição**: `open_new_subturn()` incrementa contadores sem verificar `current_turn.number > 0`. Se um `PreToolUse` ocorrer sem `UserPromptSubmit` anterior (além do auto-init), pode criar subturns associados ao turn 0, quebrando a hierarquia.

**Proposta de correção**: Adicionar guard: se `current_turn.number = 0`, abrir turn sintético antes de criar o subturn.

---

### GAP-22 — `session-close-lib.sh` não usa `hook-payload-api.sh`

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `666329eb`
**Localização**: `lib/session-close-lib.sh:7-8`

**Descrição**: É o único fat lib que não faz `source hook-payload-api.sh` e não chama `hook_api_parse()`. Enquanto o session-close é chamado internamente (não diretamente pelo VS Code), a inconsistência do padrão cria confusão para mantenedores e impossibilita uso das funções da API.

**Proposta de correção**: Adicionar `source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-payload-api.sh"` por consistência arquitetural.

---

## Categoria C — Módulos API v2.x não integrados

---

### GAP-23 — Módulo `09-metrics.sh` carregado mas nunca chamado em produção

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `666329eb`
**Localização**: `lib/api/09-metrics.sh`, todos os fat libs

**Descrição**: O módulo implementa 15 funções de métricas (`hook_stat_*`, `hook_turn_*`, `hook_compliance_*`) e `hook_metrics_load()`. Porém nenhum fat lib chama `hook_metrics_load()`. As variáveis `HOOK_STAT_*` permanecem com valores padrão zero. O módulo está funcional nos testes mas inoperante em produção.

**Proposta de correção**: Chamar `hook_metrics_load` na função `hook_api_parse` do loader, ou ao menos em `session-start-lib.sh` e `stop-lib.sh` onde as métricas são mais relevantes.

---

### GAP-24 — Módulo `12-subagent.sh` não integrado em `subagent-lib.sh`

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `bfdc07a3`
**Localização**: `lib/api/12-subagent.sh`, `lib/subagent-lib.sh`

**Descrição**: O módulo implementa `hook_subagent_depth()`, `hook_subagent_is_nested()`, `hook_subagent_budget_ok()` etc. Mas `subagent-lib.sh` usa seus próprios contadores manuais (`subagent_start_counters()`) sem aproveitar a API do módulo 12. Há duplicação de lógica e a validação de budget nunca é verificada.

**Proposta de correção**: Refatorar `subagent-lib.sh` para usar as funções de `12-subagent.sh`, especialmente `hook_subagent_budget_ok()` para enforcement de limite.

---

### GAP-25 — Módulo `13-state-version.sh`: migração nunca é executada automaticamente

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `bfdc07a3`
**Localização**: `lib/api/13-state-version.sh`, todos os fat libs

**Descrição**: O sistema de versionamento e migração existe e está testado, mas nenhum fat lib chama `hook_state_needs_migration()` ou `hook_state_migrate()`. Estados legados nunca são migrados automaticamente, mesmo que a migração fosse necessária.

**Proposta de correção**: Chamar no início de `session_start_main()` após verificar `state_exists`:
```bash
hook_state_version_load
hook_state_needs_migration && hook_state_migrate
```

---

### GAP-26 — Módulo `14-validate-events.sh`: validação de payload nunca ocorre em produção

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `bfdc07a3`
**Localização**: `lib/api/14-validate-events.sh`, todos os fat libs

**Descrição**: O módulo de validação de schema está implementado com 8 funções e 335 smoke tests passando, mas nenhum hook real chama `hook_validate_payload()`. Payloads malformados chegam ao sistema sem qualquer validação de schema.

**Proposta de correção**: Chamar `hook_validate_payload` como parte de `hook_api_parse`, com logging de warnings no audit.jsonl quando houver erros de validação.

---

### GAP-27 — Módulo `10-close-key.sh`: `hook_close_key_rotate()` sem mecanismo de notificação

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `894d0b05`
**Localização**: `lib/api/10-close-key.sh`

**Descrição**: `hook_close_key_rotate()` persiste nova chave no session.json mas o agente só saberá da nova chave se ler o briefing. Não há mecanismo para reemitir `additionalContext` com a nova chave. A rotação de chave cria estado invisível para o agente.

**Proposta de correção**: Após rotação, regenerar `session-briefing.md` e, se possível, emitir `systemMessage` com a nova chave.

---

### GAP-28 — Funções `*_load()` dos módulos 09-14 são lazy sem documentação clara

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `894d0b05`
**Localização**: `lib/api/09-metrics.sh`, `10-close-key.sh`, `12-subagent.sh`, `13-state-version.sh`, `14-validate-events.sh`

**Descrição**: Os módulos usam padrão lazy: as variáveis `HOOK_STAT_*` só são populadas quando `hook_metrics_load()` é chamado explicitamente. Esse padrão não está documentado nos comentários do loader (`hook-payload-api.sh`), criando expectativa de que as variáveis já estariam disponíveis após `source hook-payload-api.sh`.

**Proposta de correção**: Documentar explicitamente no cabeçalho de cada módulo que `*_load()` deve ser chamado, e atualizar o README da pasta `lib/api/`.

---

### GAP-29 — `SubagentStart` não injeta `additionalContext` no subagente

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `bfdc07a3`
**Localização**: `lib/subagent-lib.sh:subagent_start_main()`

**Descrição**: A API (`05-output.sh`) tem `hook_out_subagent_start_context()` que permite injetar contexto no subagente. Mas `subagent_start_main()` não o chama — subagentes iniciam sem receber o briefing da sessão pai, a close_key, nem o protocolo de operação. Isso é especialmente crítico pois subagentes podem executar turnos completos sem saber das regras de sessão.

**Proposta de correção**: Adicionar ao `subagent_start_main()`:
```bash
local ctx
ctx=$(build_compact_context)
hook_out_subagent_start_context "$ctx"
```

---

## Categoria D — Enforcement e Segurança

---

### GAP-30 — Enforcement de `vscode_askQuestions` permanentemente desativado

**Severidade**: 🔴 CRÍTICO
**Status**: ✅ RESOLVIDO — commit `9e0a7a70`
**Localização**: `lib/stop-lib.sh:44-47`

**Descrição**: O comentário `[ENFORCEMENT DESATIVADO — emit_stop_block não é chamado aqui]` indica decisão de desativar o bloqueio de turno indefinidamente. Porém o `hooks-protocol.instructions.md` especifica claramente que turnos devem ser bloqueados quando `vscode_askQuestions` não foi chamado. Há contradição fundamental entre protocolo declarado e implementação real.

**Consequência**: O sistema rastreia violações mas não as impede. Turnos não-autorizados são permitidos, o `compliance.consecutive_unauthorized` cresce, mas nada acontece.

**Proposta de correção**: Reativar `emit_stop_block()` com guardas: (a) verificar `stop_hook_active`, (b) verificar `strict_turn_close`, (c) adicionar flag configurável `HOOKS_ENFORCEMENT_ENABLED` para gradual rollout.

---

### GAP-31 — `_HOOK_BYPASS_PATTERNS` tem apenas 2 padrões insuficientes

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `9e0a7a70`
**Localização**: `lib/api/08-risk.sh`

**Descrição**: Os padrões de bypass cobrem apenas `"session-close.sh"` e `"close_key_validated=true"`. Não cobrem: paths absolutos (`/workspaces/.github/hooks/scripts/session-close.sh`), variações de chamada (`bash session-close.sh`, `sh ./session-close.sh`), nem outros scripts sensíveis como `session-start.sh`.

**Proposta de correção**: Expandir padrões:
```bash
_HOOK_BYPASS_PATTERNS=(
    "session-close.sh"
    "close_key_validated=true"
    "session-close"          # sem extensão
    "pending_session_close"  # manipulação direta de flag
    ".github/hooks/scripts/session-close"
)
```

---

### GAP-32 — `session_close_main()` não revalida a `close_key` no momento do fechamento

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `9e0a7a70`
**Localização**: `lib/session-close-lib.sh`

**Descrição**: O `session-close.sh` executa quando `pending_session_close=true`, mas não verifica novamente a `close_key`. Qualquer processo que consiga setar `pending_session_close=true` no state (inclusive bugs em outros hooks) pode acionar o encerramento sem a chave correta. O `stop-lib.sh` é quem chama `session-close.sh` quando detecta `pending=true`, mas sem segunda validação.

**Proposta de correção**: `session_close_main()` deveria verificar que há registro de `sessionCloseAuthorized` no audit.jsonl recente antes de executar.

---

### GAP-33 — `v8.0` referenciado no protocolo mas não implementado

**Severidade**: 🔴 CRÍTICO (instrução)
**Status**: ✅ RESOLVIDO — commit `d88159da`
**Localização**: `.github/instructions/hooks-protocol.instructions.md:76-77`

**Descrição**: O protocolo afirma: `"O pre-tool-use.sh (v8.0) NEGA essa chamada quando close_key_validated=false"`. O campo `close_key_validated` **não existe** em nenhum módulo, script ou state schema. O `pre-tool-use.sh` bloqueia via pattern matching (`session-close.sh`), não via `close_key_validated`. A instrução descreve um mecanismo fantasma.

**Proposta de correção**: Corrigir a instrução para descrever o mecanismo real: `hook_is_bypass_attempt()` em `08-risk.sh` que verifica padrões de bypass, não um campo `close_key_validated`.

---

### GAP-34 — `update_nested_state()` com paths negativos (floats, booleans inválidos)

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `666329eb`
**Localização**: `lib/common.sh:69-95`

**Descrição**: A detecção de tipo em `update_nested_state` usa `case "$val" in` com padrão `'' | *[!0-9]*)` de string e `*)` como número. Isso trata `"-1"` como string (contém não-dígito), `"3.14"` como string, e `"007"` como número (apenas dígitos). Não há suporte para floats ou inteiros negativos como JSON numbers.

**Proposta de correção**: Usar `argjson` com validação explícita ou `jq --argjson v "$(echo "$val")"` com fallback.

---

### GAP-35 — Sem escape de valores no `generate_session_briefing()` heredoc

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `894d0b05`
**Localização**: `lib/common.sh:460-510` (generate_session_briefing)

**Descrição**: Valores como `session_id`, `close_key`, `source` são interpolados diretamente no heredoc. Um `session_id` com caracteres especiais de Markdown (`|`, `#`, backticks) poderia quebrar a formatação do `session-briefing.md` ou, em casos extremos, injetar conteúdo Markdown inesperado com instruções falsas para o agente.

**Proposta de correção**: Sanitizar ou escapar esses valores antes da interpolação, ou usar `printf '%s' "$val"` com delimitadores explícitos.

---

### GAP-36 — Sem limpeza de arquivos temporários `.state.XXXXXX` em caso de falha de jq

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `666329eb`
**Localização**: `lib/common.sh:52, 62, 75, 338, 351`

**Descrição**: O padrão `tmp=$(mktemp); jq ... > "$tmp" && mv -f "$tmp" "$STATE_FILE"` não usa `trap` para limpar `$tmp` se `jq` falhar. Em caso de falha de jq, o arquivo temporário `.state.XXXXXX` fica no `STATE_DIR`. Em hooks com alta frequência (PreToolUse), isso pode acumular muitos arquivos temporários orphaned.

**Proposta de correção**: Adicionar `trap "rm -f '$tmp'" EXIT` ou usar `|| { rm -f "$tmp"; return 1; }` após o jq.

---

## Categoria E — Instruções ao Agente (Contexto)

---

### GAP-37 — `session-context.json` referenciado mas não existe

**Severidade**: 🔴 CRÍTICO (instrução)
**Status**: ✅ RESOLVIDO — commit `d88159da`
**Localização**: `.github/copilot-instructions.md:37`

**Descrição**: O checklist de início/retomada instrui o agente a ler `.github/hooks/state/session-context.json` como terceiro item obrigatório. O arquivo **não existe** — `ls state/` mostra apenas `audit.jsonl`, `checkpoints/`, `session-briefing.md`, `session.json`. Nenhum hook gera `session-context.json`. O agente segue instrução impossível.

**Proposta de correção**: Opção A: criar um hook que gera `session-context.json` com campos extras (subagent status, última intenção, etc.). Opção B: remover a referência das instruções e redirecionar para `session.json` diretamente.

---

### GAP-38 — Instruções de checklist não dizem o que fazer com as informações lidas

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `9e0a7a70`
**Localização**: `.github/copilot-instructions.md:34-38`

**Descrição**: O checklist de início/retomada lista 3 arquivos para ler, mas não especifica o que o agente deve fazer com cada um. Sem instrução de ação, diferentes agentes/modelos interpretarão de forma diferente. A instrução é declarativa ("ler X") sem ser prescritiva ("após ler X, fazer Y").

**Proposta de correção**: Adicionar micro-instruções por arquivo:
- `session-briefing.md`: extrair close_key, turno atual, tarefas pendentes
- `pending-tasks.md`: retomar a primeira tarefa `in-progress` ou verificar `not-started`
- `session.json`: verificar `pending_session_close`, `compliance.consecutive_unauthorized`

---

### GAP-39 — `hooks-protocol.instructions.md` mixtura nomenclatura `SESSION_ID` e `session_id`

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `894d0b05`
**Localização**: `.github/instructions/hooks-protocol.instructions.md`

**Descrição**: O documento usa ora `session_id`, ora `SESSION_ID` (variável de ambiente), ora `vs_code_session_id` (campo do JSON). A inconsistência de nomenclatura pode confundir o agente sobre qual campo verificar ou usar em operações de state.

**Proposta de correção**: Adicionar seção de glossário explicitando: `SESSION_ID` (env var para compatibilidade), `session_id` (campo JSON), `vs_code_session_id` (campo JSON original da plataforma, igual a `session_id`).

---

### GAP-40 — `pending-tasks.md` pode não existir sem alertar o agente

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `9e0a7a70`
**Localização**: `.github/copilot-instructions.md:36`, `lib/common.sh` (generate_session_briefing)

**Descrição**: A instrução manda o agente ler `state/pending-tasks.md`, mas o arquivo pode não existir em sessões sem tarefas. O briefing trata a ausência graciosamente (`*(nenhuma tarefa registrada)*`), mas a instrução direta de leitura não tem fallback explícito. O agente pode interpretar a ausência do arquivo como erro.

**Proposta de correção**: Atualizar instrução para: "se `pending-tasks.md` existir, ler; se não existir, não há tarefas pendentes registradas".

---

### GAP-41 — Protocolo declara `strict_turn_close_requires_key` mas JSON tem `strict_turn_close`

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `9e0a7a70`
**Localização**: `.github/instructions/hooks-protocol.instructions.md:160`, `lib/common.sh:128`

**Descrição**: O protocolo usa `session.strict_turn_close_requires_key=true` como nome de campo. O `session.json` real tem o campo como `strict_turn_close: true`. Além de ser campo diferente, a semântica "requires_key" implica que o encerramento de turn exige KEY, mas o campo real apenas sinaliza modo strict.

**Proposta de correção**: Unificar nomenclatura: renomear campo no JSON para `strict_turn_close_requires_key` OU corrigir o protocolo para usar `strict_turn_close`.

---

### GAP-42 — Agente não sabe que pode chamar `watchdog.sh` para diagnóstico

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `894d0b05`
**Localização**: `.github/AGENTS.md`, `.github/copilot-instructions.md`

**Descrição**: `watchdog.sh` existe como ferramenta de diagnóstico com output JSON estruturado (`--json`), mas não é mencionado em nenhum arquivo de instrução. O agente não sabe que pode chamá-lo para verificar saúde do sistema sem inspecionar arquivos manualmente.

**Proposta de correção**: Adicionar na seção de "Lembretes Operacionais" do briefing:
```
Para diagnóstico rápido: bash .github/hooks/scripts/watchdog.sh --json
```

---

### GAP-43 — Debug capture não é documentado para o agente

**Severidade**: 🟢 BAIXO
**Status**: ✅ RESOLVIDO — commit `894d0b05`
**Localização**: `.github/AGENTS.md`, `scripts/debug-capture.sh`

**Descrição**: `debug-capture.sh` permite ativar captura de payloads brutos para debugging. Útil quando há comportamento inesperado nos hooks. Não está documentado no AGENTS.md nem nas instruções, então o agente não sabe como ativar o modo debug.

**Proposta de correção**: Adicionar seção "Debugging" ao AGENTS.md com os comandos:
```bash
bash .github/hooks/scripts/debug-capture.sh start   # ativa
bash .github/hooks/scripts/debug-capture.sh stop    # desativa
ls .github/hooks/state/debug/payloads/              # ver capturas
```

---

### GAP-44 — Nenhuma instrução sobre o que fazer com `compliance.consecutive_unauthorized > 3`

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `9e0a7a70`
**Localização**: `.github/instructions/hooks-protocol.instructions.md`, `.github/AGENTS.md`

**Descrição**: O sistema rastreia `consecutive_unauthorized` no state e o watchdog avisa quando ≥5. Mas nenhuma instrução explica ao agente o que fazer quando ele próprio detectar o valor alto (ex: via `hook_compliance_consecutive()`). O agente deveria saber que alto `consecutive_unauthorized` indica violação de protocolo que requer ação corretiva imediata.

**Proposta de correção**: Adicionar ao protocolo: "Se `compliance.consecutive_unauthorized ≥ 3`, o agente deve interromper o trabalho atual e chamar `vscode_askQuestions Template D` imediatamente para regularizar compliance."

---

### GAP-45 — `session-briefing.md` não inclui número do subturn atual nem status de subagentes

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `666329eb`
**Localização**: `lib/common.sh:460-510` (generate_session_briefing)

**Descrição**: O briefing mostra `turn_count`, `turn_authorized`, `turn_unauthorized`, `consecutive_unauthorized`, mas não mostra: (a) `current_turn.number` (turno corrente), (b) `current_turn.tools_count`, (c) `session_stats.subagents_total`, (d) a intenção atual do turno (`current_turn.intent`). O agente não tem visibilidade do estado granular atual do turno em curso.

**Proposta de correção**: Ampliar a tabela de estatísticas do briefing com linha "Turno atual" e incluir informações mais completas do `current_turn`.

---

## Categoria F — Cobertura de Testes

---

### GAP-46 — Integration tests não cobrem módulos v2.x (09-14)

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `4a364019`
**Localização**: `scripts/integration-test-hooks.sh`

**Descrição**: Os 111 integration tests cobrem eventos básicos, lifecycle, predicados e outputs. Não há um único test de integração para: `hook_metrics_load()`, `hook_close_key_rotate()`, `hook_compact_ctx_*()`, `hook_subagent_*()`, `hook_state_migrate()`, ou `hook_validate_payload()`. Os módulos 09-14 são testados apenas nos smoke tests unitários.

**Proposta de correção**: Adicionar seção T-I-25+ em `integration-test-hooks.sh` cobrindo pelo menos: métricas após lifecycle completo, `hook_state_migrate` com state legado, `hook_validate_payload` com payloads reais.

---

### GAP-47 — Sem teste de lifecycle completo com `SubagentStart → SubagentStop`

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `4a364019`
**Localização**: `scripts/integration-test-hooks.sh:T-I-22`

**Descrição**: O lifecycle test (T-I-22) cobre `SessionStart → UserPromptSubmit → PreToolUse → PostToolUse → Stop`. Não inclui `SubagentStart → SubagentStop` no meio do ciclo. O counter `subagents_active` nunca é testado em contexto de lifecycle real.

**Proposta de correção**: Adicionar T-I-22bis ou T-I-23 com ciclo completo incluindo subagentes.

---

### GAP-48 — Sem teste de `write_state()` com simulação de interrupção

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `4a364019`
**Localização**: `scripts/smoke-test-payload-api.sh`, `scripts/integration-test-hooks.sh`

**Descrição**: Dado que `write_state()` não é atômico (GAP-01), não há teste que verifique o comportamento do sistema após uma escrita parcial do `session.json`. Deveria haver um teste que corrompe o state e verifica a recuperação.

**Proposta de correção**: Adicionar teste que: (a) cria state válido, (b) trunca o arquivo simulando interrupção, (c) verifica que o próximo hook faz auto-init corretamente.

---

### GAP-49 — Sem teste de sessão de longa duração (100+ turnos)

**Severidade**: 🟢 BAIXO
**Status**: ✅ RESOLVIDO — commit `4a364019`
**Localização**: Suíte de testes geral

**Descrição**: Os testes cobrem lifecycle de 1 turno com poucos subturns. Não há teste de stress com 100+ turnos verificando: (a) não-acumulação de arquivos temporários, (b) audit.jsonl crescimento controlado, (c) performance de `read_field()` com arquivo de state grande.

**Proposta de correção**: Adicionar script `scripts/stress-test-hooks.sh` com simulação de 100 ciclos completos.

---

### GAP-50 — `smoke-test-payload-api.sh` não testa `hook_validate_payload` com payload real do VS Code

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `4a364019`
**Localização**: `scripts/smoke-test-payload-api.sh:T-166-T-185`

**Descrição**: Os testes T-166-T-185 do módulo 14 usam payloads artificiais construídos diretamente com variáveis HOOK_*. Não há teste comparando com payloads reais capturados da plataforma VS Code (que estariam em `state/debug/payloads/`) para garantir que a validação não rejeita payloads legítimos.

**Proposta de correção**: Adicionar testes T-186+ que carregam payloads reais dos arquivos de debug capture e executam `hook_validate_payload`, esperando `no errors`.

---

### GAP-51 — Sem teste E2E do fluxo completo de encerramento de sessão

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `4a364019`
**Localização**: `scripts/integration-test-hooks.sh`

**Descrição**: O lifecycle test (T-I-22) não cobre: `PostToolUse com close_key na resposta → pending_session_close=true → Stop → session-close.sh`. O caminho crítico de encerramento autorizado não é testado de ponta a ponta em nenhum arquivo de teste.

**Proposta de correção**: Adicionar T-I-24: ciclo SessionStart → Prompt → Tool → PostToolUse-com-closekey → Stop → verificar `ended_at` preenchido e `session-final-report.md` gerado.

---

## Categoria G — Infraestrutura e Operações

---

### GAP-52 — `audit.jsonl` sem mecanismo de rotação ou limite de tamanho

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `894d0b05`
**Localização**: `lib/common.sh:log_audit()`, `lib/session-close-lib.sh:_generate_final_report()`

**Descrição**: O `audit.jsonl` cresce indefinidamente. Em sessões com milhares de tool calls (evidência: "1892x preToolUse" em 24h no PLANO-REIMPLEMENTACAO), o arquivo pode atingir dezenas de MB. O `session-final-report.md` só lê os últimos 10 eventos, mas o arquivo completo permanece sem limpeza.

**Proposta de correção**: Implementar rotação em `session-close.sh`: renomear para `audit-YYYYMMDD.jsonl` e criar novo `audit.jsonl`. Manter máximo de N arquivos históricos.

---

### GAP-53 — `watchdog.sh` não valida que scripts referenciados em `hooks.json` existem

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `894d0b05`
**Localização**: `scripts/watchdog.sh`

**Descrição**: O watchdog verifica se `hooks.json` existe e é JSON válido, mas não verifica se os scripts referenciados (`command`) existem e têm permissão de execução. Um hooks.json com caminho errado passaria no watchdog e só falharia silenciosamente em produção.

**Proposta de correção**: Adicionar `check_hook_scripts()` que para cada comando em hooks.json verifica existência e executabilidade.

---

### GAP-54 — `watchdog.sh` sem agendamento automático

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `894d0b05`
**Localização**: `scripts/watchdog.sh`

**Descrição**: O watchdog é ferramenta puramente manual. Não há invocação automática em nenhum hook, nem cron, nem trigger. O sistema pode estar doente por sessões inteiras sem o agente/usuário saber.

**Proposta de correção**: Chamar `watchdog.sh --json` de dentro de `session-start-lib.sh` e incluir resultado no `additionalContext` do briefing se houver issues.

---

### GAP-55 — `save_checkpoint()` usa `find -printf` incompatível com BSD/macOS

**Severidade**: 🟡 MÉDIO (portabilidade)
**Status**: ✅ RESOLVIDO — commit `9e0a7a70`
**Localização**: `lib/pre-compact-lib.sh:31-38`

**Descrição**: `find "$CHECKPOINT_DIR" -maxdepth 1 -name 'session-*.json' -printf '%T@ %p\n'` usa a flag `-printf` disponível apenas no GNU find (Linux). Em macOS/BSD, `-printf` não existe e o comando falha silenciosamente (por causa do `|| true`), tornando a poda de checkpoints inoperante no macOS.

**Proposta de correção**: Usar `stat` com alternativa cross-platform: `ls -t "$CHECKPOINT_DIR"/session-*.json 2>/dev/null | tail -n "+$((MAX_CHECKPOINTS + 1))"`.

---

### GAP-56 — `add-task.sh`/`complete-task.sh` em desalinhamento com `manage_todo_list`

**Severidade**: 🟢 BAIXO
**Status**: ✅ RESOLVIDO — commit `894d0b05`
**Localização**: `scripts/add-task.sh`, `scripts/complete-task.sh`

**Descrição**: O agente usa `manage_todo_list` (ferramenta nativa do VS Code) para gerenciar TODOs. Os scripts shell operam em `pending-tasks.md` de forma independente. Não há sincronização: alterações via `manage_todo_list` não aparecem em `pending-tasks.md` e vice-versa. Os dois sistemas de tarefas coexistem sem integração.

**Proposta de correção**: Documentar claramente que são sistemas separados com propósitos distintos, ou criar um hook `PostToolUse` para `manage_todo_list` que sincroniza com `pending-tasks.md`.

---

### GAP-57 — Sem estratégia de recuperação para `session.json` corrompido

**Severidade**: 🟠 ALTO
**Status**: ✅ RESOLVIDO — commit `894d0b05`
**Localização**: Suíte de hooks geral

**Descrição**: Se `session.json` ficar corrompido (ex: por GAP-01), `state_exists()` retorna falso, e todos os hooks fazem auto-init criando nova sessão. Isso é silencioso — o usuário/agente não sabe que o estado foi perdido. O `audit.jsonl` e `session-briefing.md` do estado anterior ficam órfãos.

**Proposta de correção**: Adicionar função `recover_or_init_state()`: (1) tenta ler o último checkpoint válido de `state/checkpoints/`, (2) se tiver, restaura com log de auditoria "state_recovered_from_checkpoint", (3) se não tiver, faz `init_state` normal com log "state_initialized_clean".

---

## Categoria H — Qualidade de Código e Design

---

### GAP-58 — `stop-lib.sh` duplica lógica de incremento em vez de usar `increment_field()`

**Severidade**: 🟢 BAIXO
**Status**: ✅ RESOLVIDO — commit `9e0a7a70`
**Localização**: `lib/stop-lib.sh:61-70`

**Descrição**: `stop-lib.sh` incrementa `consecutive_unauthorized`, `turn_authorized` e `turn_unauthorized` com padrão manual (`read → calc → update_nested_state`) em vez de usar `increment_field()` já disponível em `common.sh`. Duplicação desnecessária e mais frágil.

**Proposta de correção**: Substituir pelo padrão `increment_field ".compliance.consecutive_unauthorized"` etc.

---

### GAP-59 — `generate_session_briefing()` duplica `read_field()` com `jq` inline

**Severidade**: 🟢 BAIXO
**Status**: ✅ RESOLVIDO — commit `666329eb`
**Localização**: `lib/common.sh:460-510`

**Descrição**: A função lê `state=$(cat "$STATE_FILE")` e então usa `printf '%s' "$state" | jq -r '...'` repetidamente, em vez de usar `read_field()` já disponível. Duplicação de código e parsing redundante do arquivo.

**Proposta de correção**: Refatorar para usar `read_field ".session_id"`, `read_field ".close_key"`, etc.

---

### GAP-60 — Ausência de `SessionEnd` em `hooks.json`

**Severidade**: 🟢 BAIXO
**Status**: ✅ RESOLVIDO — commit `666329eb`
**Localização**: `.github/hooks/hooks.json`

**Descrição**: O evento `SessionEnd` existe no formato Copilot CLI mas não está registrado. Mesmo reconhecendo que é instável (LIM-01), registrá-lo com um handler simples de logging permitiria capturar os casos em que o evento funciona corretamente — fornecendo dados empíricos sobre sua confiabilidade.

**Proposta de correção**: Adicionar entrada de `SessionEnd` em hooks.json com handler mínimo que apenas loga no `audit.jsonl`.

---

### GAP-61 — `session-start-lib.sh` não usa módulo 05-output.sh para emitir additionalContext

**Severidade**: 🟢 BAIXO
**Status**: ✅ RESOLVIDO — commit `666329eb`
**Localização**: `lib/session-start-lib.sh:133-137`

**Descrição**: `session_start_main()` chama `emit_additional_context()` de `common.sh` em vez de `hook_out_session_start_context()` de `05-output.sh`. As duas funções produzem output idêntico, mas o código novo deveria usar a API unificada do módulo 05 para consistência.

**Proposta de correção**: Substituir chamada para `hook_out_session_start_context "$additional_ctx"`.

---

### GAP-62 — Sem validação de que `hooks.json` timeout é adequado para cada operação

**Severidade**: 🟡 MÉDIO
**Status**: ✅ RESOLVIDO — commit `666329eb`
**Localização**: `.github/hooks/hooks.json`

**Descrição**: Todos os hooks têm timeout de 30s, exceto `SessionStart` (60s) e `Stop` (45s). Porém `SessionStart` executa `init_state()` + `generate_session_briefing()` + `build_additional_context()` + múltiplos `jq` + I/O de arquivo. Em sistemas lentos (DevContainer cold start), pode exceder 60s. `PreCompact` pode processar estado grande e também tem apenas 30s.

**Proposta de correção**: Aumentar `SessionStart` para 90s, `PreCompact` para 60s, e documentar raciocínio por timeout no próprio `hooks.json` via campo `// comment`.

---

## Mapa de Prioridades (Correções Recomendadas)

### Correções urgentes (podem causar bugs em produção):

| GAP    | Título resumido                                  | Esforço estimado |
| ------ | ------------------------------------------------ | ---------------- |
| GAP-01 | write_state() não atômico                        | 5 min            |
| GAP-02 | emit_additional_context: hookEventName hardcoded | 15 min           |
| GAP-03 | strict_turn_close nunca lido pelo stop           | 30 min           |
| GAP-06 | hook_state_migrate: duplo ponto em jq path       | 2 min            |
| GAP-33 | v8.0 / close_key_validated não implementado      | 10 min (doc)     |
| GAP-37 | session-context.json não existe                  | 20 min           |

### Próximo sprint (gaps arquiteturais significativos):

| GAP       | Título resumido                                  | Esforço estimado |
| --------- | ------------------------------------------------ | ---------------- |
| GAP-23–26 | Módulos v2.x ociosos: integração nas fat libs    | 2-4h             |
| GAP-29    | SubagentStart não injeta contexto                | 30 min           |
| GAP-30    | Enforcement desativado indefinidamente           | 1h               |
| GAP-37    | Criar session-context.json ou corrigir instrução | 1h               |
| GAP-51    | Teste E2E do fluxo de session close              | 1h               |
| GAP-57    | Recuperação de state corrompido                  | 2h               |

---

## Estatísticas da Auditoria

| Categoria                 | Total  | 🔴 CRÍTICO | 🟠 ALTO | 🟡 MÉDIO | 🟢 BAIXO |
| ------------------------- | ------ | --------- | ------ | ------- | ------- |
| A — Bugs silenciosos      | 12     | 4         | 4      | 4       | 0       |
| B — Lifecycle             | 10     | 1         | 4      | 4       | 1       |
| C — Módulos v2.x          | 7      | 0         | 5      | 2       | 0       |
| D — Enforcement/Segurança | 7      | 2         | 2      | 3       | 0       |
| E — Instruções ao agente  | 9      | 2         | 3      | 3       | 1       |
| F — Cobertura de testes   | 6      | 0         | 3      | 2       | 1       |
| G — Infraestrutura        | 6      | 0         | 2      | 3       | 1       |
| H — Qualidade/Design      | 5      | 0         | 0      | 1       | 4       |
| **TOTAL**                 | **62** | **9**     | **23** | **22**  | **8**   |

---

## Relacionados

- [API-HOOKS-ROADMAP.md](API-HOOKS-ROADMAP.md) — Roadmap de implementação dos módulos API
- [PLANO-REIMPLEMENTACAO-HOOKS-2026-03-17.md](PLANO-REIMPLEMENTACAO-HOOKS-2026-03-17.md) — Plano de reimplementação do sistema
- [ARQUITETURA-CANONICA-SESSION-SECTION-TURN-SUBTURN.md](ARQUITETURA-CANONICA-SESSION-SECTION-TURN-SUBTURN.md) — Arquitetura canônica do lifecycle

---

*Auditoria gerada em 2026-03-19. Próxima revisão recomendada após implementação das correções urgentes.*
