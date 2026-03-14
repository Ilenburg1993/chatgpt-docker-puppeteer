# Auditoria Profunda — `agent-stop.sh`

**Data**: 2026-03-14
**Escopo principal**: `.github/hooks/scripts/agent-stop.sh`
**Arquivos correlatos analisados**:
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

O `agent-stop.sh` está funcional e robusto em vários pontos críticos (bloqueio estrutural, guards de mismatch, rastreabilidade), mas apresenta **acoplamento alto**, **drift documental** e **algumas inconsistências de protocolo/mensagem** que podem gerar confusão operacional e manutenção cara.

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

1. **Leitura integral dos scripts** de ciclo de vida (`session-start`, `log-prompt`, `pre/post-tool-use`, `agent-stop`, `session-end`).
2. **Correlacionamento de estado real** (`session-context*.json`, `audit*.jsonl`, `current-session-id.txt`, flags).
3. **Evidências por linhas** (grep/rg + inspeção dos eventos de auditoria).

---

## 3) Achados técnicos (bugs, falhas, gaps)

## 3.1 Crítico — Mensagem com instrução de chave duplicada (erro de protocolo)

**Evidência**: `agent-stop.sh:121`
Trecho atual compõe a instrução como:

- `Digite ENCERRAR-` + `$key`

Como `$key` já está no formato `ENCERRAR-XXXXXXXX`, a instrução final pode virar `ENCERRAR-ENCERRAR-XXXXXXXX`.

**Impacto**:
- Risco de usuário inserir chave inválida por instrução errada.
- Aumenta chance de rejeição de `session-close.sh` e fricção no encerramento legítimo.

**Correção proposta**:
- Exibir diretamente `$key`, sem prefixar `ENCERRAR-` novamente.

---

## 3.2 Alto — Formato inconsistente de `UNAUTHORIZED_CLOSE.flag`

**Evidência**: `agent-stop.sh:678`
No caminho de bloqueio, o arquivo é gravado como texto simples:

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
- É possível ter `current-session-id.txt` apontando para sessão A e atividade real (`pre/postToolUse`) caindo em sessão B.

**Impacto**:
- `watchdog.sh` pode analisar o contexto “ativo” errado.
- Relatórios e diagnósticos ficam ambíguos.

**Correção proposta**:
- Definir regra canônica de ownership do ponteiro ativo:
  - Opção A (recomendada): `log-prompt.sh` sincroniza `current-session-id` com `SESSION_ID` reconciliado no início de cada TURN.
  - Opção B: sincronização central via helper comum, com trava e critérios anti-thrashing.

---

## 3.4 Alto — Drift do contrato de eventos (`events-contract.md`)

**Evidências documentais** (`events-contract.md`):
- `:176` ainda menciona fallback de “últimas 150 linhas” (Estratégia 2) como parte do contrato.
- `:96` diz que preToolUse “nunca emite permissionDecision:deny”.
- `:104` afirma “session_id guard: ignora payload...”, mas o comportamento real é mais complexo (heal, sync, bloqueio por caminho etc.).

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

**Evidências**: `agent-stop.sh:446-455`, `:515-520`
Há múltiplos scans com `awk + wc + tail + jq` por fechamento de turno.

**Impacto**:
- Com logs maiores e sessões longas, custo cresce por turno.
- Ainda aceitável hoje por rotação, mas tende a escalar mal.

**Correção proposta**:
- Introduzir índice leve de turno no contexto (`turn.last_prompt_offset`/`turn.last_posttool_offsets`) para evitar re-scan repetitivo.

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
- `smoke-test.sh` possui muitos checks por `grep`, úteis, porém não suficientes para validar comportamento interativo completo.

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

Não houve evidência de `sessionEnd`/`sessionCloseAuthorized` no recorte analisado desse incidente. Ou seja, o problema era de **autorização de TURN**, não de encerramento real de SESSION.

---

## 5) Correções/aprimoramentos já aplicados nesta rodada

### 5.1 Regra v9.1 refinada para “bookkeeping permitido”

Implementado em `agent-stop.sh`:
- Agora a sequência final **`vscode_askQuestions -> manage_todo_list`** é aceita quando `manage_todo_list` é apenas fechamento de checklist.
- Foi adicionado tracking de `last_non_bookkeeping_tool` para evitar falso bloqueio.

Também foi atualizado `smoke-test.sh` com check específico dessa exceção.

### 5.2 P0 implementado (correções imediatas)

- Corrigida instrução de fechamento para não duplicar prefixo (`ENCERRAR-ENCERRAR-...`).
- `UNAUTHORIZED_CLOSE.flag` padronizado para JSON no caminho de bloqueio de TURN.

### 5.3 P1 implementado (sincronização de ponteiro ativo)

- `log-prompt.sh` agora sincroniza `current-session-id.txt` com o `session_id` reconciliado no início de cada TURN.
- Mantido design seguro sem troca de symlink em runtime de TURN (evita perda de eventos em fluxo inline).

### 5.4 P2 implementado (testes comportamentais)

Foram adicionados cenários comportamentais no `smoke-test.sh`:

- **V90-29**: valida que `vscode_askQuestions -> manage_todo_list` autoriza o TURN (sem block).
- **V90-30**: valida que `vscode_askQuestions` seguido de outra ferramenta bloqueia o TURN.

### 5.5 Validação

- `bash .github/hooks/scripts/smoke-test.sh --quiet`
- Resultado final: **201/201 PASS**

### 5.6 Upgrade estrutural v10 aplicado (fase inicial)

Além dos ajustes funcionais anteriores, foi aplicada uma etapa de **refatoração estrutural** dentro do `agent-stop.sh`:

- Extração de helpers locais para reduzir duplicação e acoplamento:
  - `emit_stop_block` (payload canônico de bloqueio para `Stop`);
  - `write_turn_block_flag_json` (writer único para `UNAUTHORIZED_CLOSE.flag`);
  - `last_non_bookkeeping_tool_since_prompt` (consulta reutilizável no audit);
  - `askquestions_has_user_answer` (validação reutilizável de resposta de usuário).
- Padronização de saída de bloqueio com `hookSpecificOutput` para `Stop`, mantendo campos legados top-level por compatibilidade.
- Reuso dos helpers nos blocos de:
  - mandato Nível 3 (close key);
  - mismatch não saneado (v9.2);
  - bloqueio principal de TURN sem autorização;
  - reblock quando `stop_hook_active=true` e sem compliance.
- Atualização do smoke (`V90-26`) para aceitar as duas formas válidas de composição da mensagem de close key (interpolação jq e interpolação shell), mantendo o guard contra `ENCERRAR-ENCERRAR-`.

### 5.7 Fase 2 concluída (modularização + contrato)

- Helpers estruturais do `agent-stop.sh` foram extraídos para `hooks-lib/agent-stop-lib.sh`:
  - `emit_stop_block`
  - `write_turn_block_flag_json`
  - `last_non_bookkeeping_tool_since_prompt`
  - `askquestions_has_user_answer`
- `agent-stop.sh` passou a carregar explicitamente o módulo (`source hooks-lib/agent-stop-lib.sh`) com fail-fast caso ausente/inválido.
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
  - **block path**: normalização numérica, composição de hint de session close e escolha de mensagens de block.
- `smoke-test.sh` foi ajustado para reconhecer a extração de strings/regras para `agent-stop-lib.sh` nos checks `V90-5` e `V90-25`.
- Revalidação pós-fase 3: `smoke-test.sh --quiet` → **201/201 PASS**.

### 5.9 Fase 4 concluída (reset/nudge/checkpoint)

- `hooks-lib/agent-stop-lib.sh` recebeu helpers para a etapa de desacoplamento do pós-processamento de turno:
  - `should_emit_context_nudge`
  - `build_turn_session_summary`
  - `select_auth_increment_field`
  - `should_sync_tasks_to_docs_every_five_turns`
  - `run_optional_hook_script`
- `agent-stop.sh` passou a reutilizar esses helpers em três regiões:
  - decisão de emissão do `systemMessage` contextual (nudge);
  - construção de `session_summary` e seleção do campo de contagem (`turn_authorized`/`turn_no_askQuestions`);
  - execução de `session-checkpoint.sh` e sincronização periódica `sync-tasks-to-docs.sh`.
- Resultado: redução de duplicação e maior clareza de fluxo no fechamento do TURN, preservando comportamento.
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
- `smoke-test.sh` foi ajustado para reconhecer a string canônica `"retomada"` no arquivo modularizado.
- Revalidação pós-fase 5: `smoke-test.sh --quiet` → **201/201 PASS**.

### 5.11 Fase 6 concluída (telemetria/event logging)

- Foram adicionados helpers de auditoria em `hooks-lib/agent-stop-lib.sh`:
  - `log_agent_stop_event`
  - `log_turn_auth_invalidated_event`
  - `log_turn_end_authorized_event`
- `agent-stop.sh` passou a consumir os helpers para reduzir blocos `jq -cn` inline em pontos de alta repetição.
- `smoke-test.sh` foi ajustado para aceitar a presença de `reason: $reason` no módulo extraído (check `AS-5`).
- Revalidação pós-fase 6: `smoke-test.sh --quiet` → **201/201 PASS**.

### 5.12 Fase 7 concluída (autorização restante)

- Modularização adicional da autorização do TURN em `hooks-lib/agent-stop-lib.sh`:
  - `audit_has_turn_auth_signal`
  - `context_turn_auth_requested`
  - `determine_turn_auth_invalid_reason`
- `agent-stop.sh` passou a consumir esses helpers para:
  - estratégia 1 (sinal pós `userPromptSubmitted` no audit);
  - fallback de contexto (`current_turn.auth_requested`);
  - decisão de invalidação v9.1 (`askquestions_not_last_tool`, `askquestions_api_error`, `askquestions_skipped_or_empty`).
- `smoke-test.sh` recebeu ajustes de compatibilidade para checks estruturais após extrações para `agent-stop-lib.sh` (Hardening v6, V90-19, V90-22, V90-24).
- Revalidação pós-fase 7: `smoke-test.sh --quiet` → **201/201 PASS**.

### 5.13 Fase 8 concluída (guard de fechamento de sessão)

- O bloco inline do **BUG-79 guard** foi extraído para helper dedicado:
  - `enforce_session_closure_authorization_guard` em `hooks-lib/agent-stop-lib.sh`.
- `agent-stop.sh` agora chama o helper para validar `session.ended_at` sem
  `session.closure_authorized_at`, mantendo o comportamento de bloqueio (`exit 1`) quando houver violação.
- O helper preserva:
  - logs de erro no stderr;
  - evento `sessionClose_VIOLATION_unauthorized` em `audit.jsonl`;
  - criação de `SESSION_CLOSE_VIOLATION.flag`.
- Revalidação pós-fase 8: `smoke-test.sh --quiet` → **201/201 PASS**.

### 5.14 Continuação contínua (extrações adicionais)

- Extraído mandate de close key (Nível 3) para helper:
  - `enforce_level3_close_key_mandate` em `hooks-lib/agent-stop-lib.sh`.
- `agent-stop.sh` agora delega a decisão de block Nível 3 ao helper, preservando saída `decision:block`.
- Extraído helper de block para mismatch pendente:
  - `emit_unresolved_session_mismatch_block`.
- `smoke-test.sh` atualizado para aceitar checks estruturais movidos para `hooks-lib` (V90-23 e V90-26).
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

A boa notícia: com correções pequenas e cirúrgicas + uma etapa curta de refatoração por módulos, dá para elevar bastante previsibilidade, auditabilidade e confiança operacional do protocolo.
