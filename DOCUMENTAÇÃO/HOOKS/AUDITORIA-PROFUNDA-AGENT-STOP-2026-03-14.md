# Auditoria Profunda — `agent-stop.sh`

**Data**: 2026-03-14 **Escopo principal**: `.github/hooks/scripts/agent-stop.sh` **Arquivos
correlatos analisados**:

- `.github/hooks/scripts/pre-tool-use.sh`
- `.github/hooks/scripts/post-tool-use.sh`
- `.github/hooks/scripts/log-prompt.sh`
- `.github/hooks/scripts/session-start.sh`
- `.github/hooks/scripts/session-end.sh`
- `.github/hooks/hooks-lib/common.sh`
- `.github/hooks/contracts/events-contract.md`
- `.github/hooks/scripts/smoke-test.sh`

---

## 1) Resumo executivo

O `agent-stop.sh` está funcional e robusto em vários pontos críticos (bloqueio estrutural, guards de
mismatch, rastreabilidade), mas apresenta **acoplamento alto**, **drift documental** e **algumas
inconsistências de protocolo/mensagem** que podem gerar confusão operacional e manutenção cara.

### Estado atual (alto nível)

- ✅ Hardening forte em autorização de TURN (`decision:block`) e anti-loop (`stop_hook_active`).
- ✅ Estratégias múltiplas para autorização (askQuestions + subagente + contexto).
- ✅ Guard de mismatch com HEAL v2 e bloqueio quando mismatch não saneado.
- ⚠️ Script monolítico (1094 linhas) com múltiplas responsabilidades.
- ⚠️ Contrato documental de eventos está parcialmente defasado em relação ao código.
- ⚠️ Existem pontos de UX/protocolo que podem parecer “encerramento incorreto” para usuário.

---

## 2) Metodologia

Foram usadas três frentes:

1. **Leitura integral dos scripts** de ciclo de vida (`session-start`, `log-prompt`,
   `pre/post-tool-use`, `agent-stop`, `session-end`).
2. **Correlacionamento de estado real** (`session-context*.json`, `audit*.jsonl`,
   `current-session-id.txt`, flags).
3. **Evidências por linhas** (grep/rg + inspeção dos eventos de auditoria).

---

## 3) Achados técnicos (bugs, falhas, gaps)

## 3.1 Crítico — Mensagem com instrução de chave duplicada (erro de protocolo)

**Evidência**: `agent-stop.sh:121` Trecho atual compõe a instrução como:

- `Digite ENCERRAR-` + `$key`

Como `$key` já está no formato `ENCERRAR-XXXXXXXX`, a instrução final pode virar
`ENCERRAR-ENCERRAR-XXXXXXXX`.

**Impacto**:

- Risco de usuário inserir chave inválida por instrução errada.
- Aumenta chance de rejeição de `session-close.sh` e fricção no encerramento legítimo.

**Correção proposta**:

- Exibir diretamente `$key`, sem prefixar `ENCERRAR-` novamente.

---

## 3.2 Alto — Formato inconsistente de `UNAUTHORIZED_CLOSE.flag`

**Evidência**: `agent-stop.sh:678` No caminho de bloqueio, o arquivo é gravado como texto simples:

- `TURN_BLOCKED|<timestamp>|consecutive=<n>`

Em outros fluxos, o ecossistema espera JSON (lido com `jq` em `session-start.sh`).

**Impacto**:

- Parsing inconsistente em recuperação/briefing.
- Metadados podem ficar vazios ou parcialmente perdidos.

**Correção proposta**:

- Padronizar **sempre JSON** para `UNAUTHORIZED_CLOSE.flag`.
- Manter backward compatibility por 1 ciclo (reader tolerante a texto legado).

---

## 3.3 Alto — Split-brain potencial entre `current-session-id` e roteamento por payload

**Evidências**:

- `session-start.sh` atualiza `current-session-id.txt` (`session-start.sh:201`, `:331`)
- `log-prompt.sh` usa `apply_per_session_paths` (`log-prompt.sh:46`)
- `common.sh` define `apply_per_session_paths` sem atualizar ponteiro global (`common.sh:561+`)

**Comportamento observado**:

- É possível ter `current-session-id.txt` apontando para sessão A e atividade real
  (`pre/postToolUse`) caindo em sessão B.

**Impacto**:

- `watchdog.sh` pode analisar o contexto “ativo” errado.
- Relatórios e diagnósticos ficam ambíguos.

**Correção proposta**:

- Definir regra canônica de ownership do ponteiro ativo:
  - Opção A (recomendada): `log-prompt.sh` sincroniza `current-session-id` com `SESSION_ID`
    reconciliado no início de cada TURN.
  - Opção B: sincronização central via helper comum, com trava e critérios anti-thrashing.

---

## 3.4 Alto — Drift do contrato de eventos (`events-contract.md`)

**Evidências documentais** (`events-contract.md`):

- `:176` ainda menciona fallback de “últimas 150 linhas” (Estratégia 2) como parte do contrato.
- `:96` diz que preToolUse “nunca emite permissionDecision:deny”.
- `:104` afirma “session_id guard: ignora payload...”, mas o comportamento real é mais complexo
  (heal, sync, bloqueio por caminho etc.).

**Evidências de implementação**:

- `pre-tool-use.sh:619` emite `permissionDecision: "deny"` no guard do `session-close.sh`.
- `agent-stop.sh` comentário explicita Estratégia 2 removida (`agent-stop.sh:12`, `:461`).

**Impacto**:

- Onboarding e manutenção ficam perigosos (documento diz uma coisa, runtime faz outra).
- Revisões futuras podem introduzir regressões por confiar no contrato defasado.

**Correção proposta**:

- Atualizar contrato para refletir estado real (v1.2+):
  - remover referência da Estratégia 2,
  - documentar explicitamente guard de deny em preToolUse,
  - ajustar sessão/mismatch semantics atuais.

---

## 3.5 Médio — Custo de processamento por turno em arquivo de audit

**Evidências**: `agent-stop.sh:446-455`, `:515-520` Há múltiplos scans com `awk + wc + tail + jq`
por fechamento de turno.

**Impacto**:

- Com logs maiores e sessões longas, custo cresce por turno.
- Ainda aceitável hoje por rotação, mas tende a escalar mal.

**Correção proposta**:

- Introduzir índice leve de turno no contexto
  (`turn.last_prompt_offset`/`turn.last_posttool_offsets`) para evitar re-scan repetitivo.

---

## 3.6 Médio — Monoliticidade extrema / alta carga cognitiva

**Métrica objetiva**:

- `agent-stop.sh`: **1094 linhas**
- Core relacionado (`pre/post/log/session-start/session-end`): 4725 linhas somadas

**Impacto**:

- Mais risco de regressão a cada ajuste.
- Revisão e debugging custosos.
- Testes tendem a ficar superficiais (grep estático em vez de cenário comportamental).

**Correção proposta**:

- Extrair `agent-stop.sh` em módulos por responsabilidade:
  1. `auth-evaluator.sh`
  2. `mismatch-guard.sh`
  3. `block-output-builder.sh`
  4. `turn-reset-writer.sh`
  5. `nudge-system-message.sh`

---

## 3.7 Médio — Cobertura de testes ainda muito “estrutural”

**Evidência**:

- `smoke-test.sh` possui muitos checks por `grep`, úteis, porém não suficientes para validar
  comportamento interativo completo.

**Impacto**:

- Regressões lógicas podem passar no smoke (especialmente em fluxos com combinação de estados).

**Correção proposta**:

- Adicionar suíte de cenários comportamentais sandbox para `agent-stop`:
  - askQuestions válido + resposta + manage_todo_list final,
  - askQuestions sem resposta,
  - askQuestions com API failure,
  - subagent delegado imediato vs não imediato,
  - mismatch pendente com/sem `stop_hook_active`.

---

## 4) Achado principal do incidente (causa raiz observada)

No caso investigado, o bloqueio ocorreu por:

1. `turnAuth_invalidated` com reason `askquestions_not_last_tool`;
2. seguido de `turnEnd_no_askQuestions`;
3. seguido de `agentStop_blocked`.

Não houve evidência de `sessionEnd`/`sessionCloseAuthorized` no recorte analisado desse incidente.
Ou seja, o problema era de **autorização de TURN**, não de encerramento real de SESSION.

---

## 5) Correções/aprimoramentos já aplicados nesta rodada

### 5.1 Regra v9.1 refinada para “bookkeeping permitido”

Implementado em `agent-stop.sh`:

- Agora a sequência final **`vscode_askQuestions -> manage_todo_list`** é aceita quando
  `manage_todo_list` é apenas fechamento de checklist.
- Foi adicionado tracking de `last_non_bookkeeping_tool` para evitar falso bloqueio.

Também foi atualizado `smoke-test.sh` com check específico dessa exceção.

### 5.2 P0 implementado (correções imediatas)

- Corrigida instrução de fechamento para não duplicar prefixo (`ENCERRAR-ENCERRAR-...`).
- `UNAUTHORIZED_CLOSE.flag` padronizado para JSON no caminho de bloqueio de TURN.

### 5.3 P1 implementado (sincronização de ponteiro ativo)

- `log-prompt.sh` agora sincroniza `current-session-id.txt` com o `session_id` reconciliado no
  início de cada TURN.
- Mantido design seguro sem troca de symlink em runtime de TURN (evita perda de eventos em fluxo
  inline).

### 5.4 P2 implementado (testes comportamentais)

Foram adicionados cenários comportamentais no `smoke-test.sh`:

- **V90-29**: valida que `vscode_askQuestions -> manage_todo_list` autoriza o TURN (sem block).
- **V90-30**: valida que `vscode_askQuestions` seguido de outra ferramenta bloqueia o TURN.

### 5.5 Validação

- `bash .github/hooks/scripts/smoke-test.sh --quiet`
- Resultado final: **201/201 PASS**

### 5.6 Upgrade estrutural v10 aplicado (fase inicial)

Além dos ajustes funcionais anteriores, foi aplicada uma etapa de **refatoração estrutural** dentro
do `agent-stop.sh`:

- Extração de helpers locais para reduzir duplicação e acoplamento:
  - `emit_stop_block` (payload canônico de bloqueio para `Stop`);
  - `write_turn_block_flag_json` (writer único para `UNAUTHORIZED_CLOSE.flag`);
  - `last_non_bookkeeping_tool_since_prompt` (consulta reutilizável no audit);
  - `askquestions_has_user_answer` (validação reutilizável de resposta de usuário).
- Padronização de saída de bloqueio com `hookSpecificOutput` para `Stop`, mantendo campos legados
  top-level por compatibilidade.
- Reuso dos helpers nos blocos de:
  - mandato Nível 3 (close key);
  - mismatch não saneado (v9.2);
  - bloqueio principal de TURN sem autorização;
  - reblock quando `stop_hook_active=true` e sem compliance.
- Atualização do smoke (`V90-26`) para aceitar as duas formas válidas de composição da mensagem de
  close key (interpolação jq e interpolação shell), mantendo o guard contra `ENCERRAR-ENCERRAR-`.

### 5.7 Fase 2 concluída (modularização + contrato)

- Helpers estruturais do `agent-stop.sh` foram extraídos para `hooks-lib/agent-stop-lib.sh`:
  - `emit_stop_block`
  - `write_turn_block_flag_json`
  - `last_non_bookkeeping_tool_since_prompt`
  - `askquestions_has_user_answer`
- `agent-stop.sh` passou a carregar explicitamente o módulo (`source hooks-lib/agent-stop-lib.sh`)
  com fail-fast caso ausente/inválido.
- `events-contract.md` foi atualizado para **v1.2**, alinhando:
  - timeouts reais de `copilot-hooks.json`;
  - possibilidade de `permissionDecision: deny` em `preToolUse`;
  - estratégia atual de autorização do `agentStop` (sem fallback de 150 linhas);
  - output canônico de block no `Stop` com `hookSpecificOutput`.
- Revalidação pós-fase 2: `smoke-test.sh --quiet` → **201/201 PASS**.

### 5.8 Fase 3 concluída (auth/mismatch/block)

- Expansão de `hooks-lib/agent-stop-lib.sh` com helpers de domínio da autorização e bloqueio:
  - `sanitize_nonnegative_int`
  - `is_immediate_subagent_delegation`
  - `is_bookkeeping_after_askquestions`
  - `build_session_close_hint`
  - `build_turn_block_payload`
  - `update_mismatch_tracker`
- `agent-stop.sh` passou a consumir esses helpers na prática em três áreas centrais:
  - **mismatch/heal track** (HEAL v2): cálculo e persistência do contador consecutivo;
  - **auth v9.1**: validação de delegação imediata e exceção de bookkeeping pós-askQuestions;
  - **block path**: normalização numérica, composição de hint de session close e escolha de
    mensagens de block.
- `smoke-test.sh` foi ajustado para reconhecer a extração de strings/regras para `agent-stop-lib.sh`
  nos checks `V90-5` e `V90-25`.
- Revalidação pós-fase 3: `smoke-test.sh --quiet` → **201/201 PASS**.

### 5.9 Fase 4 concluída (reset/nudge/checkpoint)

- `hooks-lib/agent-stop-lib.sh` recebeu helpers para a etapa de desacoplamento do pós-processamento
  de turno:
  - `should_emit_context_nudge`
  - `build_turn_session_summary`
  - `select_auth_increment_field`
  - `should_sync_tasks_to_docs_every_five_turns`
  - `run_optional_hook_script`
- `agent-stop.sh` passou a reutilizar esses helpers em três regiões:
  - decisão de emissão do `systemMessage` contextual (nudge);
  - construção de `session_summary` e seleção do campo de contagem
    (`turn_authorized`/`turn_no_askQuestions`);
  - execução de `session-checkpoint.sh` e sincronização periódica `sync-tasks-to-docs.sh`.
- Resultado: redução de duplicação e maior clareza de fluxo no fechamento do TURN, preservando
  comportamento.
- Revalidação pós-fase 4: `smoke-test.sh --quiet` → **201/201 PASS**.

### 5.10 Fase 5 concluída (invariante de seção)

- A auto-criação da seção de recuperação (`retomada`) foi extraída para helper dedicado:
  - `ensure_section_invariant_retomada` em `hooks-lib/agent-stop-lib.sh`.
- `agent-stop.sh` passou a chamar o helper em vez de manter o bloco inline de criação de seção,
  preservando:
  - atualização de `current_section`, `session_stats.section_count`, `section_history`;
  - reset de `current_turn.section_turn` e `agentStop_invocations`;
  - emissão de evento `sectionStart` com `auto_open: true`;
  - aviso operacional no stderr.
- `smoke-test.sh` foi ajustado para reconhecer a string canônica `"retomada"` no arquivo
  modularizado.
- Revalidação pós-fase 5: `smoke-test.sh --quiet` → **201/201 PASS**.

### 5.11 Fase 6 concluída (telemetria/event logging)

- Foram adicionados helpers de auditoria em `hooks-lib/agent-stop-lib.sh`:
  - `log_agent_stop_event`
  - `log_turn_auth_invalidated_event`
  - `log_turn_end_authorized_event`
- `agent-stop.sh` passou a consumir os helpers para reduzir blocos `jq -cn` inline em pontos de alta
  repetição.
- `smoke-test.sh` foi ajustado para aceitar a presença de `reason: $reason` no módulo extraído
  (check `AS-5`).
- Revalidação pós-fase 6: `smoke-test.sh --quiet` → **201/201 PASS**.

### 5.12 Fase 7 concluída (autorização restante)

- Modularização adicional da autorização do TURN em `hooks-lib/agent-stop-lib.sh`:
  - `audit_has_turn_auth_signal`
  - `context_turn_auth_requested`
  - `determine_turn_auth_invalid_reason`
- `agent-stop.sh` passou a consumir esses helpers para:
  - estratégia 1 (sinal pós `userPromptSubmitted` no audit);
  - fallback de contexto (`current_turn.auth_requested`);
  - decisão de invalidação v9.1 (`askquestions_not_last_tool`, `askquestions_api_error`,
    `askquestions_skipped_or_empty`).
- `smoke-test.sh` recebeu ajustes de compatibilidade para checks estruturais após extrações para
  `agent-stop-lib.sh` (Hardening v6, V90-19, V90-22, V90-24).
- Revalidação pós-fase 7: `smoke-test.sh --quiet` → **201/201 PASS**.

### 5.13 Fase 8 concluída (guard de fechamento de sessão)

- O bloco inline do **BUG-79 guard** foi extraído para helper dedicado:
  - `enforce_session_closure_authorization_guard` em `hooks-lib/agent-stop-lib.sh`.
- `agent-stop.sh` agora chama o helper para validar `session.ended_at` sem
  `session.closure_authorized_at`, mantendo o comportamento de bloqueio (`exit 1`) quando houver
  violação.
- O helper preserva:
  - logs de erro no stderr;
  - evento `sessionClose_VIOLATION_unauthorized` em `audit.jsonl`;
  - criação de `SESSION_CLOSE_VIOLATION.flag`.
- Revalidação pós-fase 8: `smoke-test.sh --quiet` → **201/201 PASS**.

### 5.14 Continuação contínua (extrações adicionais)

- Extraído mandate de close key (Nível 3) para helper:
  - `enforce_level3_close_key_mandate` em `hooks-lib/agent-stop-lib.sh`.
- `agent-stop.sh` agora delega a decisão de block Nível 3 ao helper, preservando saída
  `decision:block`.
- Extraído helper de block para mismatch pendente:
  - `emit_unresolved_session_mismatch_block`.
- `smoke-test.sh` atualizado para aceitar checks estruturais movidos para `hooks-lib` (V90-23 e
  V90-26).
- Revalidação pós-extrações contínuas: `smoke-test.sh --quiet` → **201/201 PASS**.

### 5.15 Continuação contínua (reblock path)

- Extraídos helpers para o fluxo de `stop_hook_active=true` sem compliance:
  - `log_reblocked_no_comply_event`
  - `emit_reblock_stop_block`
- `agent-stop.sh` passou a delegar a telemetria e a emissão de block desse caminho ao módulo
  `hooks-lib/agent-stop-lib.sh`, reduzindo outro bloco `jq` inline.
- Revalidação pós-lote de reblock: `smoke-test.sh --quiet` → **201/201 PASS**.

### 5.16 Continuação contínua (unblocked-complied)

- Extraído helper `log_unblocked_complied_event` para centralizar o evento
  `agentStop_unblocked_complied` no fluxo `stop_hook_active=true` com compliance.
- `agent-stop.sh` deixou de carregar mais um bloco `jq` inline nesse caminho.
- Revalidação pós-lote incremental: `smoke-test.sh --quiet` → **201/201 PASS**.

### 5.17 Continuação contínua (formatação de nudge)

- Extraída a composição textual do `systemMessage` contextual para helper:
  - `build_context_system_message` em `hooks-lib/agent-stop-lib.sh`.
- `agent-stop.sh` mantém a coleta dos dados (`_CTX_*`) e passa a delegar apenas a montagem da
  mensagem para o helper.
- Revalidação pós-extração de nudge: `smoke-test.sh --quiet` → **201/201 PASS**.

### 5.18 Retomada da modularização (logs e flags)

- Nova rodada de desacoplamento no eixo `agent-stop.sh` → `hooks-lib/agent-stop-lib.sh`, com
  extração de blocos de serialização/logging ainda remanescentes no script principal:
  - `log_auth_via_subagent_delegation_event`
  - `log_turn_end_no_askquestions_event`
  - `log_agent_stop_blocked_event`
  - `log_agent_stop_blocked_no_todo_event`
  - `log_turn_start_enriched_auto_event`
  - `write_authorized_close_flag`
  - `write_unauthorized_close_flag`
- `agent-stop.sh` foi reduzido em pontos de repetição de `jq -cn`, mantendo a semântica de runtime e
  preservando os motivos de block/telemetria existentes.
- `smoke-test.sh` foi ajustado para reconhecer extrações de eventos agora concentradas no
  `agent-stop-lib.sh` (checks de `auth_via_subagent_delegation`, `agentStop_blocked` e
  `agentStop_blocked_no_todo`).
- Revalidação pós-retomada: `smoke-test.sh --quiet`.

### 5.19 Continuação da modularização (mutações de contexto)

- Extraídas mutações de contexto ainda inline no `agent-stop.sh` para helpers dedicados em
  `hooks-lib/agent-stop-lib.sh`:
  - `update_blocked_turn_context`
  - `mark_turn_authorized_in_context`
  - `mark_turn_unauthorized_in_context`
- `agent-stop.sh` passa a atuar mais como orquestrador de fluxo, enquanto a camada de helper
  concentra escrita de estado (`compliance.*`, `last_turn_ts`, `current_turn.block_count`).
- Objetivo desta fase: reduzir repetição de `jq` mutável e preparar base para eventual quebra por
  submódulos funcionais (`auth`, `state-write`, `session-guard`).

### 5.20 Foco no `session_id guard` (mismatch/heal)

- O bloco de guard de sessão no `agent-stop.sh` passou por modularização adicional com helpers
  específicos em `agent-stop-lib.sh`:
  - `write_session_identity_in_context`
  - `log_session_id_healed_event`
  - `log_session_id_sync_inline_restart_event`
  - `log_session_id_mismatch_event`
- Efeito prático: o fluxo de decisão permanece no `agent-stop.sh`, mas serialização de eventos e
  escrita de identidade de sessão foram desacopladas para helpers reutilizáveis.
- Resultado esperado desta fase: reduzir risco de regressão em ajustes futuros de
  HEAL/manual_recovery e facilitar a futura extração integral do guard para submódulo dedicado.

### 5.21 Upgrades de utilitários e hardening numérico

- Introduzidos utilitários transversais em `agent-stop-lib.sh` para reduzir duplicação e melhorar
  robustez de parsing/tempo:
  - `safe_jq_read`
  - `safe_jq_read_int`
  - `iso_to_epoch_utc`
  - `compute_turn_duration_seconds`
  - `compute_consecutive_for_unauthorized_flag`
  - `build_auto_intent_from_turn_tools`
- `agent-stop.sh` passou a consumir esses helpers em pontos críticos:
  - cálculo de `turn_duration_s` com fallback GNU/BSD centralizado;
  - leitura de metadados de turno com sanitização numérica consistente;
  - cálculo de `consecutive_unauthorized` para flag sem lógica duplicada;
  - montagem de auto-intent via helper dedicado.
- Benefício imediato: menor superfície de erro por parsing manual e mais previsibilidade para novas
  extrações de blocos restantes.

### 5.22 Modularização do nudge contextual (mensagens e backlog)

- Extraída a lógica de composição do nudge para helpers de domínio no `agent-stop-lib.sh`:
  - `extract_pending_tasks_summary`
  - `build_push_pending_message`
  - `build_violation_message`
  - `build_session_close_nudge_message`
- `agent-stop.sh` deixou de manter blocos longos de `if/grep` para mensagens contextuais, passando a
  somente orquestrar os dados e montar a mensagem final via helpers.
- Ganho direto desta fase: menor acoplamento entre coleta de estado e copy operacional do protocolo,
  facilitando manutenção e ajustes sem tocar no fluxo principal do Stop.

---

## 6) Proposta de upgrades (completo e profundo)

## 6.1 Upgrade imediato (1-2 dias)

1. Corrigir instrução de chave duplicada (`ENCERRAR-ENCERRAR-...`).
2. Padronizar `UNAUTHORIZED_CLOSE.flag` em JSON.
3. Atualizar `events-contract.md` para refletir runtime atual.
4. Adicionar 3-5 testes comportamentais sandbox de autorização.

## 6.2 Upgrade de robustez (3-5 dias)

1. Sincronização canônica do `current-session-id` no `log-prompt` (após reconciliação).
2. Telemetria explícita de “active_session_pointer_changed”.
3. Writer único para flags (helper comum com schema + versão).
4. Guardrails de parsing tolerante para flags legadas.

## 6.3 Upgrade estrutural (1-2 semanas)

1. Quebrar `agent-stop.sh` em módulos por responsabilidade.
2. Migrar composições JSON repetitivas para helpers comuns (com schema checks).
3. Introduzir “mini state machine” formal de autorização:
   - `PENDING`, `ASK_SENT`, `ASK_CONFIRMED`, `BLOCKED`, `AUTHORIZED`.
4. Test harness dedicado para fluxo TURN/SECTION/SESSION.

## 6.4 Upgrade avançado (roadmap)

1. Contratos versionados por evento (`contracts/v2/*.jsonschema`).
2. Replay offline de `audit.jsonl` para reproduzir bugs de ciclo de vida.
3. Dashboard de compliance (taxa de bloqueio, causa por reason, MTTR por sessão).
4. Política de “drift gate”: PR falha se `events-contract.md` divergir do runtime.

---

## 7) Priorização recomendada

1. **P0**: bug de mensagem da chave + padronização de flag JSON.
2. **P1**: sincronização de ponteiro de sessão + atualização do contrato.
3. **P2**: testes comportamentais e modularização progressiva.
4. **P3**: replay engine e governança de contrato com gate automatizado.

---

## 8) Conclusão

O sistema já está com hardening relevante, porém a combinação de:

- script monolítico,
- contrato parcialmente desatualizado,
- e inconsistências de estado/ponteiro

cria terreno para incidentes de percepção ("encerrou errado") e manutenção frágil.

A boa notícia: com correções pequenas e cirúrgicas + uma etapa curta de refatoração por módulos, dá
para elevar bastante previsibilidade, auditabilidade e confiança operacional do protocolo.

---

## 9) Auditoria geral aprofundada (estado atual pós-fases 5.18→5.22)

### 9.1 Inventário de complexidade (scripts críticos)

- `agent-stop.sh`: **623 linhas** (queda relevante vs baseline histórico de >1k linhas).
- `hooks-lib/agent-stop-lib.sh`: **1255 linhas** (crescimento esperado por extração de
  responsabilidades).
- `pre-tool-use.sh`: **728 linhas**.
- `post-tool-use.sh`: **453 linhas**.
- `log-prompt.sh`: **730 linhas**.
- `session-start.sh`: **1460 linhas**.
- `events-contract.md`: **376 linhas**.

### 9.2 Diagnóstico de maturidade por eixo

1. **Modularização do Stop**

- Estado: **avançado** no `agent-stop` (orquestração), porém ainda **intermediário** no ecossistema,
  pois `pre-tool-use`, `post-tool-use` e `log-prompt` mantêm blocos grandes de guard/recovery.

2. **Governança de estado (`session-context`/`audit`)**

- Estado: **bom**, mas com fragilidade operacional local por symlink quebrável
  (`session-context.json` apontando para alvo ausente no ambiente de teste).

3. **Contratos e observabilidade**

- Estado: **bom** com contrato v1.3 alinhado; falta evolução para contrato versionado por schema
  executável (lint de contrato + testes de conformidade automáticos).

4. **Qualidade de teste**

- Estado: **forte** no smoke (207/207), ainda com dependência parcial de checks estruturais por
  string (`grep`) que exigem manutenção sempre que há extrações para libs.

### 9.3 Principais gaps remanescentes (priorizados)

- **GAP-G1 (Alto)**: lógica de HEAL/mismatch ainda distribuída em `pre-tool-use`, `post-tool-use` e
  `log-prompt`, com duplicação de intenção de correção.
- **GAP-G2 (Alto)**: ausência de camada canônica única para escrita/leitura de `session-context` em
  todos os scripts (há helpers, mas não cobertura total).
- **GAP-G3 (Médio)**: smoke depende de estado local (`session-context` symlink) para alguns checks
  de schema.
- **GAP-G4 (Médio)**: contrato formal ainda textual (Markdown), sem JSON Schema por evento com
  validação CI.
- **GAP-G5 (Médio)**: surface de mensagens de protocolo ainda espalhada (templates/nudges
  distribuídos).

---

## 10) Roadmap profundo e longo (próximos passos gerais com critérios claros)

> Objetivo macro: transformar o sistema de hooks em arquitetura **modular, auditável e validável por
> contrato executável**, com redução de regressão operacional e menor custo de manutenção.

### 10.1 Trilha A — Consolidação de Session Guard (curto prazo)

**Escopo**

- Unificar semântica de mismatch/heal em todos os scripts que escrevem contexto.

**Entregáveis**

- Helper canônico único para guard de sessão (biblioteca compartilhada).
- Chamadas padronizadas em `agent-stop`, `pre-tool-use`, `post-tool-use`, `log-prompt`.

**Critérios de aceite**

- 0 duplicações de blocos de HEAL/mismatch fora da biblioteca canônica.
- smoke 100% verde + testes comportamentais de mismatch em sandbox.

**Risco principal**

- Regressão em fluxos `inline_restart`/`manual_recovery`.

**Mitigação**

- Testes de snapshot de `session-context` por cenário + replay de audit.

### 10.2 Trilha B — Writer canônico de estado (curto/médio prazo)

**Escopo**

- Centralizar escrita de campos críticos (`compliance`, `current_turn`, `session_stats`, flags).

**Entregáveis**

- API shell única de state-write (helpers versionados).
- Eliminação de writes ad-hoc com `jq` espalhados.

**Critérios de aceite**

- ≥80% das mutações críticas usando helpers padronizados.
- Queda mensurável de `jq` inline nos scripts críticos.

### 10.3 Trilha C — Contratos executáveis (médio prazo)

**Escopo**

- Evoluir de contrato textual para contrato validável por schema.

**Entregáveis**

- `contracts/v2/*.jsonschema` por evento crítico.
- Validador de conformidade em pipeline local/CI.

**Critérios de aceite**

- Build falha quando evento emitido viola schema.
- `events-contract.md` passa a ser visão humana de schemas versionados.

### 10.4 Trilha D — Test harness comportamental (médio prazo)

**Escopo**

- Expandir cobertura de comportamento fim-a-fim com fixtures de sessão.

**Entregáveis**

- Suite de cenários para TURN/SECTION/SESSION (incluindo stop_hook_active, reblock, mismatch).
- Runner de replay offline de `audit.jsonl`.

**Critérios de aceite**

- Cobertura de cenários críticos publicada no relatório de auditoria.
- Redução de checks puramente estruturais no smoke.

### 10.5 Trilha E — Governança operacional de symlink/state (médio prazo)

**Escopo**

- Tornar robusto o ciclo de `current-session-id` + symlinks compat (`session-context.json`,
  `audit.jsonl`).

**Entregáveis**

- Política explícita de ownership do ponteiro ativo.
- Auto-heal de symlink quebrado com evento observável.

**Critérios de aceite**

- 0 falsos negativos de schema por alvo ausente em ambiente local.
- Eventos de auto-heal rastreáveis no audit.

### 10.6 Trilha F — UX de protocolo e mensagens (médio/longo prazo)

**Escopo**

- Consolidar copy de mensagens de block/nudge/session close em helpers de domínio.

**Entregáveis**

- Catálogo de mensagens por contexto (turn block, session close mandate, mismatch block).
- Matriz de mensagens com invariantes (último ato, askQuestions válido, etc.).

**Critérios de aceite**

- Sem inconsistência textual entre scripts para o mesmo tipo de violação.
- Mudança de copy em 1 lugar refletindo no fluxo inteiro.

---

## 11) Plano de execução incremental (ordem recomendada)

1. **R1 — Session Guard Unificado**

- Meta: consolidar mismatch/heal cross-scripts.
- Gate: smoke 100% + cenários de guard pass.

2. **R2 — State Writer Unificado**

- Meta: reduzir mutação inline e side-effects divergentes.
- Gate: diff de `jq` inline reduzido e sem regressão funcional.

3. **R3 — Contrato v2 executável**

- Meta: schema por evento + validador automático.
- Gate: falha automática em evento fora do contrato.

4. **R4 — Test harness comportamental**

- Meta: replay e cenários ponta-a-ponta.
- Gate: cobertura mínima de cenários críticos acordada.

5. **R5 — Hardening operacional final**

- Meta: symlink/state resiliente + UX de protocolo consolidada.
- Gate: 0 incidentes de split-brain/symlink quebrado nos ciclos de validação.

---

## 12) Critérios globais de sucesso do roadmap

- **Confiabilidade**: nenhuma regressão em smoke; sem incidentes de autorização silenciosa.
- **Manutenibilidade**: redução contínua de lógica inline repetida nos scripts críticos.
- **Auditabilidade**: eventos críticos rastreáveis e alinhados com contrato executável.
- **Operação**: comportamento previsível em reconexão, mismatch e encerramento autorizado.

---

## 13) Progresso incremental R1 (execução em código)

### R1.2 — helper comum para `inline_restart`

- Criado helper canônico em `hooks-lib/common.sh`: `handle_inline_restart_stale_payload_sid`.
- Aplicado em:
  - `.github/hooks/scripts/pre-tool-use.sh`
  - `.github/hooks/scripts/post-tool-use.sh`
- Benefícios:
  - elimina duplicação de lógica de cap de logs (`session_id_sync_inline_restart[_cap]`);
  - padroniza incremento de `session_stats.session_id_syncs_inline`;
  - corrige rastreabilidade do `stale_payload_sid` (não sobrescrever antes de log).

### R1.3 — helper comum para `manual_recovery`

- Criado helper canônico em `hooks-lib/common.sh`: `handle_manual_recovery_session_id`.
- Aplicado em:
  - `.github/hooks/scripts/pre-tool-use.sh`
  - `.github/hooks/scripts/post-tool-use.sh`
- Benefícios:
  - reduz duplicação de heal para `source=manual_recovery`;
  - padroniza evento `session_id_healed` com `source_script` e `tool`.

### R1.4/R1.5 — reconciliador unificado de guard (pre/post)

- Criados helpers adicionais em `hooks-lib/common.sh`:
  - `record_unrecoverable_session_id_mismatch`
  - `reconcile_session_id_guard_prepost`
- `pre-tool-use.sh` e `post-tool-use.sh` agora chamam o reconciliador único para os caminhos:
  - sem mismatch;
  - `manual_recovery`;
  - `inline_restart`;
  - mismatch não recuperável (retorno `10`, bloqueio de state write).

### Validação

- Smoke test oficial executado após cada tranche.
- Estado atual: **207/207 PASS**.

---

## 14) Progresso inicial R2 (State Writer Unificado)

### R2.1 — Writer comum para estado de askQuestions

- Novo helper em `hooks-lib/common.sh`:
  - `write_askquestions_turn_state`
- Migração inicial aplicada em:
  - `.github/hooks/scripts/post-tool-use.sh`
- Objetivo:
  - remover duplicação de escrita `jq` para os campos de autorização do turno;
  - centralizar atualização de:
    - `last_tool.result`
    - `current_turn.last_askquestions_response`
    - `current_turn.auth_requested`
    - `current_turn.auth_requested_at`
    - metadados de Template F (`last_askquestions_*`).

### Validação

- Smoke final pós-R2.1: **207/207 PASS**.

### R2.2 — Writers compartilhados para `result`/falha/TODO

- Novos helpers adicionados em `hooks-lib/common.sh`:
  - `write_last_tool_result`
  - `increment_turn_failure_counters`
  - `mark_turn_todo_created_true`
- Migração aplicada em `post-tool-use.sh` para os branches:
  - `RESULT_TYPE=failure`
  - `TOOL_NAME=manage_todo_list`
  - `TOOL_NAME=runSubagent|search_subagent`
  - branch `else` (fallback de `last_tool.result`)
- Compatibilidade estrutural preservada para smoke (`V90-1`):
  - mantida referência textual explícita de `todo_created = true` no branch de `manage_todo_list`.

### Validação

- `get_errors` nos arquivos alterados (`common.sh`, `post-tool-use.sh`): **sem erros**.
- Smoke final pós-R2.2: **207/207 PASS**.

### R2.3 — Investigação forense: por que o TURN fechou sem KEY válida

#### Evidência objetiva (audit)

- Janela forense do TURN `turn_1773500083_29925` mostrou:
  - `askQuestions_response` com `template_f=false`, `close_action="not_applicable"`,
    `close_key_found=false`
  - seguida de `agentStop` + `turnEnd_authorized`.
- Ou seja: o turno foi autorizado sem KEY no ato final.

#### Causa-raiz confirmada

- A regra de invalidação em `determine_turn_auth_invalid_reason` só exigia validação de KEY quando o
  último ask era `Template F`.
- Para `Template A/D/E`, o TURN permanecia autorizável com resposta válida de askQuestions (sem
  KEY).
- Resultado: o enforcement de KEY estava efetivamente em modo **condicional por template**, não
  estrito por TURN.

### R2.4 — Hardening estrito de fechamento de TURN (aplicado)

#### Mudanças no core de autorização

- `hooks-lib/agent-stop-lib.sh`
  - `determine_turn_auth_invalid_reason` passou a suportar modo estrito
    (`strict_turn_close_requires_key`, default=true).
  - Em modo estrito, o TURN só é autorizado quando o último askQuestions é:
    - `Template F`,
    - `close_action="close_with_key"`,
    - `close_key_found=true`,
    - `session.close_key_validated=true`.
  - Novos motivos de invalidação:
    - `turn_close_requires_template_f`
    - `turn_close_key_missing_or_invalid`
  - Mensagens de block foram atualizadas para os novos motivos.

- `scripts/agent-stop.sh`
  - Passa `session.strict_turn_close_requires_key` para a função de invalidação.
  - Fallback seguro: `// true` (modo estrito ativo por padrão).

#### Propagação no lifecycle (context boot/recovery)

- `scripts/session-start.sh`, `scripts/log-prompt.sh`, `scripts/pre-tool-use.sh`
  - Contextos novos/recuperados agora incluem:
    - `session.strict_turn_close_requires_key = true`

#### Testes comportamentais reforçados

- `scripts/smoke-test.sh`
  - `V90-29` atualizado para cenário válido estrito: `Template F + KEY` seguido de bookkeeping.
  - `V90-30` mantido (ask seguido de outra tool deve bloquear).
  - Novo `V90-37`: ask final sem `Template F + KEY` deve bloquear TURN.

### Validação

- `get_errors` (scripts alterados): **sem erros**.
- Smoke final pós-hardening estrito: **208/208 PASS**.

### R2.5 — Ajuste fino pós-incidente (strict sem falso-positivo de governança)

#### Problema observado

- Em alguns cenários, o bloqueio ocorria por regras de governança de Template F (ex.: opção de
  escalonamento/sinalização prévia), mesmo quando o objetivo funcional era apenas impedir fechamento
  de TURN sem **Template F + KEY válida**.

#### Correção aplicada

- `hooks-lib/agent-stop-lib.sh`
  - `determine_turn_auth_invalid_reason` foi ajustada para, em modo estrito, bloquear fechamento
    apenas por critérios de autorização efetiva:
    - último ask não é Template F;
    - close_action/close_key inválidos;
    - validação final da KEY ausente (`close_key_validated != true`).
  - Regras de governança (opção de escalonamento/solicitação prévia) permanecem auditáveis, mas não
    invalidam o TURN por si só.

- `scripts/agent-stop.sh`
  - leitura de `session.strict_turn_close_requires_key` corrigida para preservar `false` explícito
    (evitando armadilha de `jq // true` com booleano).

- `scripts/smoke-test.sh`
  - Cenários `V90-41` e `V90-42` alinhados ao comportamento estrito funcional.

### R2.6 — P6.3 executado (deduplicação de bindings `parent_turn_id`)

#### Mudanças

- `hooks-lib/common.sh`
  - novo helper: `bind_current_subturn_parent_turn_id` para rebind canônico do vínculo
    `current_turn.subturn.parent_turn_id` → `current_turn.turn_id`.

- `scripts/agent-stop.sh`
  - trecho de rebind de SubTurn passou a usar o helper, reduzindo `jq` inline duplicado.

### M1 (modularização) — concluído

#### Entregável

- `hooks-lib/common.sh`
  - novo helper de bootstrap de hooks: `resolve_hook_runtime_input` (stdin + `timestamp` +
    `session_id` + `NOW_ISO` + paths per-session).

#### Adoção

- aplicado em:
  - `scripts/agent-stop.sh`
  - `scripts/pre-tool-use.sh`
  - `scripts/post-tool-use.sh`
  - `scripts/log-prompt.sh`

#### Resultado

- redução de duplicação no início dos scripts (leitura/extração/resolução de paths);
- sem regressão comportamental.

### Validação consolidada (estado atual)

- `get_errors` nos arquivos alterados: **sem erros**.
- Smoke final após R2.5 + R2.6 + M1: **225/225 PASS**.

### M2 (parcial) — unificação de guard de `session_id` no `log-prompt`

#### Entregável parcial aplicado

- `scripts/log-prompt.sh`
  - caminho `manual_recovery` do guard de `session_id` passou a usar o helper canônico
    `handle_manual_recovery_session_id` (em `hooks-lib/common.sh`).

#### Efeito

- redução de duplicação de `jq` inline para HEAL v1 no `userPromptSubmitted`;
- alinhamento semântico com `pre-tool-use.sh` / `post-tool-use.sh`.

#### Validação

- `get_errors` no `log-prompt.sh`: **sem erros**.
- Smoke pós-M2 parcial: **225/225 PASS**.

### M2 (continuação) — unificação de guard de `session_id` no `agent-stop`

#### Entregáveis

- `hooks-lib/agent-stop-lib.sh`
  - novo helper: `reconcile_session_id_guard_stop`.
  - concentra lógica de:
    - mismatch vs `session.id` ativa,
    - `manual_recovery` (HEAL v1),
    - `inline_restart` (sync para CTX SID),
    - HEAL v2 por mismatch consecutivo,
    - bloqueio seguro (`emit_unresolved_session_mismatch_block`) quando não saneado.

- `scripts/agent-stop.sh`
  - bloco inline de guard/reconcile foi substituído por chamada única ao helper.

- `scripts/smoke-test.sh`
  - checks estruturais de guard/HEAL v2 atualizados para aceitar implementação modularizada (inline
    **ou** helper), evitando falso negativo de arquitetura.

#### Validação

- `get_errors` nos arquivos alterados: **sem erros**.
- Smoke pós-M2 (agent-stop): **225/225 PASS**.

### M3 — engine de decisão de autorização extraída

#### Entregáveis

- `hooks-lib/agent-stop-lib.sh`
  - novo helper: `evaluate_turn_authorization`.
  - encapsula:
    - estratégia 1 (`audit_has_turn_auth_signal`),
    - estratégia 3 (`context_turn_auth_requested`),
    - estratégia 4 (delegação imediata de subagente),
    - invalidação v9.1 via `determine_turn_auth_invalid_reason`,
    - fallback estrito de contexto ausente (`strict_context_missing`).

- `scripts/agent-stop.sh`
  - bloco inline de decisão/auth foi substituído por chamada única ao helper.

- `scripts/smoke-test.sh`
  - checks estruturais (V90-19/V90-24) atualizados para aceitar implementação inline **ou** helper,
    preservando contrato comportamental.

#### Validação

- `get_errors` em `agent-stop.sh`, `agent-stop-lib.sh`, `smoke-test.sh`: **sem erros**.
- Smoke pós-M3: **225/225 PASS**.

### Propostas adicionais (base: docs oficiais VS Code Hooks/Security)

> Referências lidas: Hooks (`Stop`, `PreToolUse`, `PostToolUse`), Tools/Approvals, Subagents,
> Security e AI enterprise settings da documentação oficial VS Code (mar/2026).

#### P7.1 — Duplo lock de encerramento (Stop + PreToolUse)

**Objetivo**: tornar ainda mais difícil qualquer fechamento sem fluxo legítimo.

- Manter o lock atual no `Stop` (`decision:block` quando não houver autorização válida).
- Reforçar no `PreToolUse` um deny explícito para qualquer tentativa de execução de fechamento fora
  do caminho canônico (já existente para `session-close.sh`, ampliar validações de contexto para
  chamadas equivalentes indiretas).
- Em caso de violação, registrar evento único canônico `turnClose_prevented_dual_lock`.

**Critério de aceite**:

- Tentativas de fechamento indevido falham tanto antes da execução da tool quanto no `Stop` final.

#### P7.2 — Budget anti-loop com teto de blocks por TURN

**Objetivo**: aderir ao guidance oficial de `stop_hook_active` e evitar iteração infinita.

- Introduzir `current_turn.stop_block_budget` (ex.: máximo 2 blocks por TURN).
- Ao exceder budget, emitir block com razão operacional explícita e obrigar fluxo de recuperação via
  `vscode_askQuestions` (Template F) sem seguir em loop.

**Critério de aceite**:

- Nenhum cenário de reblock infinito em smoke; contador e motivo auditáveis.

#### P7.3 — Contrato executável do payload de autorização

**Objetivo**: sair de checagens frágeis por grep e validar forma + semântica.

- Criar schema JSON para `turn_authorization_context` derivado de:
  - último tool,
  - presença de resposta válida de `vscode_askQuestions`,
  - `template_f`, `close_action`, `close_key_found`, `session.close_key_validated`.
- Validar schema no smoke e em testes de replay de `audit.jsonl`.

**Critério de aceite**:

- Falha determinística quando qualquer campo crítico vier ausente/inválido.

#### P7.4 — Hardening específico para subagentes

**Objetivo**: impedir “atalhos” de autorização via delegação indevida.

- Endurecer regra de delegação imediata com janela temporal curta e parent_turn obrigatório.
- Exigir marca de proveniência (`auth_source=subagent_immediate`) e negar autorização caso a cadeia
  `SubagentStart -> SubagentStop -> agentStop` não esteja íntegra.

**Critério de aceite**:

- Subagente só autoriza quando trilha auditável está completa e correlacionada.

#### P7.5 — Telemetria de decisão (explainability de block)

**Objetivo**: melhorar depuração e governança de incidentes.

- Emitir sempre um objeto de decisão canônico no block:
  - `rule_id`, `auth_strategy`, `invalid_reason`, `strict_mode`, `stop_hook_active`, `block_count`.
- Incluir resumo compacto no `systemMessage` para reduzir ambiguidades de operação.

**Critério de aceite**:

- Todo block possui explicação mínima reproduzível sem inspeção manual extensa de logs.

#### P7.6 — Gate de configuração segura no ambiente

**Objetivo**: reduzir risco fora do código (settings permissivas).

- Documentar baseline recomendado (workspace/enterprise):
  - sem `global auto-approve`,
  - `runInTerminal` e `fetch` fora de auto-approval quando aplicável,
  - sandbox de terminal habilitado em Linux/macOS para cenários de maior risco.
- Adicionar health-check que alerta quando settings estão incompatíveis com o protocolo estrito.

**Critério de aceite**:

- Diagnóstico mostra `PASS/FAIL` de baseline de segurança operacional dos hooks.

#### P7.7 — Testes comportamentais de encerramento (matriz completa)

**Objetivo**: cobrir cenários reais de fechamento autorizado e não autorizado.

- Casos mínimos:
  1. `Template F + key correta + session.close_key_validated=true` -> autoriza.
  2. `Template F + key ausente/inválida` -> block.
  3. `Template A/D/E como último ato` -> block (modo estrito).
  4. `askQuestions` seguido de ferramenta de trabalho -> block.
  5. `askQuestions` seguido de `manage_todo_list` (bookkeeping only) + requisitos estritos -> regra
     definida explicitamente.

**Critério de aceite**:

- Matriz verde no smoke + suíte comportamental dedicada.

### Execução prática (lote inicial P7) — P7.1 + P7.2 + P7.5

#### P7.1 — Duplo lock ativo

- `pre-tool-use.sh`
  - lock primário reforçado para detectar também invocação via `source`/`.` de `session-close.sh`.
  - novo evento: `turnClose_prevented_dual_lock` com `lock_stage="preToolUse"`.

- `agent-stop.sh` + `agent-stop-lib.sh`
  - lock secundário já no `Stop` agora registra `turnClose_prevented_dual_lock`
    (`lock_stage="stopHook"` e `lock_stage="stopHook_reblock"`).

#### P7.2 — Budget anti-loop (reblock)

- `agent-stop.sh`
  - novo budget configurável por sessão: `session.stop_block_budget_max` (default `2`).
  - quando excedido, registra `stop_block_budget_exceeded` e mantém bloqueio estrito com reason code
    dedicado (`stop_block_budget_exceeded`).

#### P7.5 — Telemetria de decisão explicável

- `agent-stop-lib.sh`
  - `emit_stop_block` agora aceita `decisionTrace` opcional.
  - novo helper:
    `build_decision_trace_json(rule_id, auth_strategy, invalid_reason, strict_mode, stop_hook_active, block_count)`.
  - `agent-stop.sh` passa `decisionTrace` nos blocks principais/reblocks.

#### Smoke / validação

- `smoke-test.sh`
  - novos checks: `V90-44`, `V90-45`, `V90-46`.
- Resultado final do smoke após ajustes: **228/228 PASS**.

### Execução prática (P7.3) — contrato executável de autorização

#### Entregáveis

- Novo schema contratual:
  - `.github/hooks/contracts/turn-authorization-context.schema.json`
- `hooks-lib/agent-stop-lib.sh`:
  - `build_turn_authorization_context_json`
  - `validate_turn_authorization_context_json`
  - `log_turn_auth_context_invalid_event`
  - motivo de bloqueio adicional: `turn_auth_context_invalid`
- `scripts/agent-stop.sh`:
  - passa a gerar snapshot em `state/turn-authorization-context.json`;
  - valida contrato antes da decisão final;
  - em contrato inválido, força `AUTH_REQUESTED=false` +
    `AUTH_INVALID_REASON=turn_auth_context_invalid`.

#### Smoke / validação

- `smoke-test.sh` ganhou checks: `V90-47`, `V90-48`.
- Resultado final do smoke pós-P7.3: **230/230 PASS**.

### Execução prática (P7.4 + P7.6 + P7.7)

#### P7.4 — Hardening de subagente

- `hooks-lib/agent-stop-lib.sh`
  - novo helper: `audit_has_subagent_start_since_prompt`.
  - `evaluate_turn_authorization` agora exige cadeia mínima auditável para delegação:
    - `last_tool in {runSubagent, search_subagent}`,
    - `current_turn.subturn.parent_turn_id == current_turn.turn_id`,
    - presença de `subagentStart` após o último `userPromptSubmitted`.
  - quando a trilha falha, usa `auth_invalid_reason=subagent_chain_invalid`.

#### P7.6 — Gate de configuração segura (baseline local)

- `smoke-test.sh`
  - novo check `V90-49` para baseline de segurança em `.vscode/settings.json` quando aplicável.
  - fallback não-bloqueante para workspaces com JSONC (não parseável via `jq`), evitando falso
    negativo.

#### P7.7 — Expansão da matriz comportamental

- `smoke-test.sh`
  - novo cenário comportamental `V90-50`:
    - contrato de autorização inválido (`turnAuth_context_invalid`) deve forçar `decision:block`.

#### Smoke / validação

- Resultado final do smoke pós-P7.4/P7.6/P7.7: **232/232 PASS**.

### Nota crítica de semântica (Stop block) — clarificação aplicada

Com base na documentação oficial do VS Code Hooks (`Stop`):

- `decision: "block"` no hook `Stop` **não significa “bloquear continuação”**;
- significa **bloquear o fechamento/parada do TURN naquele ponto**;
- efeito prático: o agente **continua** executando para corrigir/completar o protocolo.

Para remover ambiguidade operacional, foi aplicado:

- `hooks-lib/agent-stop-lib.sh`
  - payload de block agora inclui `blockClarification`;
  - `systemMessage` de block recebeu prefixo explícito:
    `FECHAMENTO DO TURN BLOQUEADO (agente continua)`.
- `agent-stop.sh`
  - comentários de protocolo atualizados para reforçar a semântica oficial.
- `smoke-test.sh`
  - novo check estrutural `V90-51` garantindo presença dessa semântica explícita.

### M4 (início) — modularização do guard contratual de autorização

#### Entregáveis

- `hooks-lib/agent-stop-lib.sh`
  - novo helper: `apply_turn_authorization_contract_guard`.
  - centraliza:
    - build do `turn-authorization-context.json`,
    - validação do contrato,
    - fallback para `turn_auth_context_invalid` + evento de auditoria.

- `scripts/agent-stop.sh`
  - removeu bloco inline do guard contratual;
  - agora delega ao helper único de M4.

- `smoke-test.sh`
  - novo check `V90-52` para garantir integração
    `agent-stop -> apply_turn_authorization_contract_guard`.

#### Lote seguinte da M4

- `hooks-lib/agent-stop-lib.sh`
  - novo helper: `record_blocked_subturn_and_schedule_resume`.
- `scripts/agent-stop.sh`
  - removeu bloco inline grande de atualização `subturn_history/current_turn.subturn` no caminho de
    block.
- `smoke-test.sh`
  - novo check `V90-53` para garantir uso do helper.

## 15) Incidente recorrente — rastreio completo da repetição (2026-03-14)

### 15.1 Sintoma observado em produção

- O `audit.jsonl` mostrava `turnAuth_invalidated` + `agentStop_blocked` repetidamente, porém o
  usuário seguia percebendo “turno encerrado indevidamente”.

### 15.2 Evidência forense objetiva

No recorte recente de `audit-8c19c988.jsonl`:

- razões recorrentes de invalidação:
  - `turn_close_requires_template_f`
  - `turn_close_key_missing_or_invalid`
- sequência padrão:
  1. `turnAuth_invalidated`
  2. `turnEnd_invalid_authorization`
  3. `agentStop_blocked`

Além disso, inspeção direta da função `emit_stop_block` confirmou que o payload emitido estava com
apenas duas chaves top-level:

- `hookSpecificOutput`
- `systemMessage`

Sem `decision`/`decisionReason` top-level.

### 15.3 Causa-raiz da repetição

**Compatibilidade parcial do payload de block no evento `Stop`.**

Embora `hookSpecificOutput.decision="block"` estivesse presente, a ausência dos campos top-level
(`decision`, `decisionReason`) reduzia compatibilidade entre runtimes/versões, permitindo cenário
de:

- block registrado no audit,
- mas não necessariamente honrado como bloqueio efetivo de fechamento no cliente.

### 15.4 Correção aplicada (estrutural)

Arquivo: `.github/hooks/hooks-lib/agent-stop-lib.sh`

- `emit_stop_block` voltou a emitir **payload híbrido canônico**:
  - top-level: `decision`, `decisionReason`, `reason`
  - `hookSpecificOutput` do evento `Stop`
  - `systemMessage`

Arquivo: `.github/hooks/contracts/events-contract.md`

- contrato atualizado para exigir explicitamente a forma híbrida por compatibilidade.

Arquivo: `.github/hooks/scripts/smoke-test.sh`

- novos checks:
  - `V90-58`: garante campos top-level de decisão
  - `V90-59`: garante `hookSpecificOutput` de `Stop`

### 15.5 Resultado esperado pós-fix

- manter logs de bloqueio no audit;
- aumentar chance de enforcement efetivo do block em todas as variantes de runtime;
- eliminar recorrência de “encerramento indevido” por payload parcialmente compatível.

### 15.6 Hardening adicional — verificador de recebimento/processamento de comandos

Novo script operacional:

- `.github/hooks/scripts/verify-hook-delivery.sh`

O que ele verifica (via `audit.jsonl`):

1. `preToolUse` recebido (comandos chegando ao pipeline)
2. `postToolUse` recebido (comandos processados)
3. Pareamento por `tool_use_id` (detecção de pre sem post e post órfão)
4. Presença de `askQuestions_response`
5. Sinais de ciclo de `Stop` (`agentStop`, `agentStop_blocked`, fechamentos de turno)

Uso recomendado:

- `bash .github/hooks/scripts/verify-hook-delivery.sh`
- `bash .github/hooks/scripts/verify-hook-delivery.sh --session-id <SID> --strict`

Integração de qualidade:

- adicionado no `smoke-test.sh` como script obrigatório (presença + executabilidade).

Referência oficial usada para o hardening:

- VS Code Hooks (Stop + hook I/O + decisão/block):
  - `https://code.visualstudio.com/docs/copilot/customization/hooks#_stop`
- Diagnóstico de execução real (Agent Debug + Chat Debug):
  - `https://code.visualstudio.com/docs/copilot/chat/chat-debug-view`
  - `https://code.visualstudio.com/docs/copilot/troubleshooting#_chat-customization-diagnostics`
