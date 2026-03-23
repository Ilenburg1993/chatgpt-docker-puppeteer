# F17.1 — Delimitação técnica do `sessionStart` (file-by-file)

**Data**: 2026-03-15 **Fase**: F17.1 (iniciada) **Arquivos-alvo**:

- `scripts/session-start.sh`
- `hooks-lib/lifecycle/session-start-lib.sh`
- `hooks-lib/lifecycle/session-start-core.sh` (shim canônico)
- `hooks-lib/lifecycle/session-start-aux.sh` (shim canônico)
- `hooks-lib/session-start-core.sh` (implementação legado compatível)
- `hooks-lib/session-start-aux.sh` (implementação legado compatível)

## Estado atual (baseline de fronteira)

### Script principal (`session-start.sh`)

Já está no perfil wrapper:

- resolve `HOOK_DIR`,
- valida `common.sh` e entry-lib,
- faz `source` dos dois,
- valida presença de `run_session_start_hook`,
- faz dispatch único.

### Entry-lib (`session-start-lib.sh`)

Concentra fluxo de domínio completo:

- bootstrap de sessão,
- recuperação/checkpoints,
- geração de briefing,
- coleta de backlog/findings/trends/health,
- persistência de eventos/contexto.

Também faz carregamento condicional de core/aux (shims canônicos em `lifecycle/`).

### Core/Aux

- `lifecycle/session-start-core.sh` e `lifecycle/session-start-aux.sh` são wrappers canônicos.
- implementações efetivas ainda residem em `hooks-lib/session-start-core.sh` e
  `hooks-lib/session-start-aux.sh` (modelo shim de compatibilidade F7.7).

## Decisão de fronteira F17.1 (alvo)

## 1) O que permanece no script principal

Apenas:

1. bootstrap mínimo de ambiente/path,
2. validação de presença de libs,
3. `source` de libs obrigatórias,
4. validação da função pública,
5. dispatch único.

## 2) O que permanece na entry-lib

A entry-lib fica como **orquestradora única** do hook:

- ordem dos blocos de execução,
- fallback/fail-open/fail-fast por bloco,
- composição de core/aux.

## 3) O que deve ser progressivamente extraído da entry-lib

Blocos grandes que devem evoluir para módulos menores reutilizáveis:

- recuperação de sessão anterior e fechamento abrupto,
- composição de briefing (blocos markdown longos),
- regras de health/trends/backlog (reuso cross-hook),
- emissão estruturada de eventos e métricas.

## Plano de execução F17.1 (subfases A→E)

### A — Delimitação (concluída)

- mapa de responsabilidades atual publicado neste documento.

### B — Extração (próxima)

- separar `session-start-lib.sh` em blocos internos orientados a função:
  - `session-start-recovery`,
  - `session-start-briefing`,
  - `session-start-observability`.
- manter API pública única `run_session_start_hook`.

**Atualização desta rodada (F17.1B — slice 1):**

- helper dedicado criado: `hooks-lib/lifecycle/session-start-runtime.sh`.
- `session-start-lib.sh` passou a delegar para:
  - `session_start_load_domain_modules` (carregamento de core/aux),
  - `session_start_run_housekeeping_scripts` (watchdog/rotate).
- resultado: redução de acoplamento inline sem alterar contrato externo do hook.

**Atualização desta rodada (F17.1B — slice 2):**

- helper dedicado criado: `hooks-lib/lifecycle/session-start-recovery.sh`.
- varredura/seleção de checkpoint anterior e hidratação de metadados de recovery foram extraídas de
  `session-start-lib.sh` para `session_start_find_previous_checkpoint`.
- resultado: bloco de recovery ficou encapsulado para evolução posterior (`session-start-recovery`
  como módulo de domínio).

**Atualização desta rodada (F17.1B — slice 3):**

- helper dedicado criado: `hooks-lib/lifecycle/session-start-observability.sh`.
- banner de sessão, resumo de backlog e emissão de `hookSpecificOutput` foram extraídos de
  `session-start-lib.sh` para funções dedicadas:
  - `session_start_emit_runtime_banner`,
  - `session_start_emit_backlog_summary`,
  - `session_start_emit_hook_output`.
- resultado: redução adicional de lógica inline e separação explícita de concerns de output.

**Atualização desta rodada (F17.1B — slice 4, preparação):**

- mapeamento dos blocos de briefing identificado no `session-start-lib.sh`:
  - bloco base: `BRIEFING_EOF`;
  - blocos condicionais: `STALE_VIOLATION_EOF`, `VIOLATION_EOF`, `NO_KEY_EOF`, `ABRUPT_EOF`,
    `RECONNECT_EOF`, `CLOSE_KEY_EOF`, `ASK_FAIL_EOF`, `WD_EOF`;
  - blocos finais: `ACTIVE_STATE_EOF`, `BRIEFING_BODY_EOF`.
- estratégia definida para próximo corte: extrair renderer de briefing em módulo dedicado com API:
  - `session_start_write_briefing_base`,
  - `session_start_append_recovery_alerts`,
  - `session_start_append_operational_sections`.

**Atualização desta rodada (F17.1B — slice 4, execução parcial):**

- helper dedicado criado: `hooks-lib/lifecycle/session-start-briefing.sh`.
- bloco base de briefing (`BRIEFING_EOF`) foi extraído de `session-start-lib.sh` para
  `session_start_write_briefing_base`.
- integração aplicada no fluxo principal via chamada:
  - `session_start_write_briefing_base "$BRIEFING_FILE" "$SESSION_DATE" "$CLOSE_KEY"`.

**Atualização desta rodada (F17.1B — slice 4, corte condicional #1):**

- helper adicional em `session-start-briefing.sh`:
  - `session_start_append_unauthorized_close_section`.
- bloco inline de `PREV_UNAUTH_CLOSE` foi removido de `session-start-lib.sh` e substituído por
  chamada única ao helper.

**Atualização desta rodada (F17.1B — slice 5, cortes condicionais adicionais):**

- novos helpers adicionados em `session-start-briefing.sh`:
  - `session_start_append_no_key_section`,
  - `session_start_append_abrupt_close_section`,
  - `session_start_append_reconnect_section`,
  - `session_start_append_close_key_quickref`.
- blocos inline removidos de `session-start-lib.sh` e substituídos por dispatch para helper:
  - `PREV_NO_KEY_CLOSE`,
  - `PREV_ABRUPT_CLOSE`,
  - `PREV_CLOSE_MODE=abrupt_reconnect`,
  - bloco fixo `CLOSE_KEY_EOF`.

**Atualização desta rodada (F17.1B — slice 6):**

- novos helpers adicionados em `session-start-briefing.sh`:
  - `session_start_append_ask_fail_section`,
  - `session_start_append_watchdog_section`.
- blocos inline removidos de `session-start-lib.sh` e delegados ao helper:
  - `ASK_FAIL_EOF`,
  - `WD_EOF`.

**Atualização desta rodada (F17.1B — slice 7):**

- novos helpers adicionados em `session-start-briefing.sh`:
  - `session_start_resolve_origin_labels`,
  - `session_start_append_active_state_section`,
  - `session_start_append_briefing_body_section`.
- blocos inline removidos de `session-start-lib.sh` e delegados ao helper:
  - `case "$SOURCE"` (labels de origem),
  - `ACTIVE_STATE_EOF`,
  - `BRIEFING_BODY_EOF`.
- contrato explícito de variáveis de snapshot exportado no `session-start-lib.sh` para consumo do
  renderer.

**Atualização desta rodada (F17.1B — slice 8):**

- bootstrap normalizado com loader único de suporte em
  `hooks-lib/lifecycle/session-start-runtime.sh`:
  - `session_start_load_support_modules`.
- `session-start-lib.sh` deixou de carregar recovery/observability/briefing diretamente, passando a
  delegar ao loader único.

**Atualização desta rodada (F17.1B — slice 9, fechamento):**

- checklist final executado:
  - `session-start-lib.sh` sem marcadores de heredoc de briefing remanescentes;
  - bootstrap consolidado via loaders de runtime/suporte;
  - diagnósticos de editor sem erros nos arquivos da trilha F17.1.
- resultado: **F17.1 concluída** (A→E) para `sessionStart`.

**Atualização desta rodada (F17.1B — slice 10, extra):**

- helper dedicado criado: `hooks-lib/lifecycle/session-start-events.sh`.
- emissão dos eventos de bootstrap foi extraída do entry-lib para helper:
  - `sessionStart`,
  - `sectionStart`.
- `session-start-runtime.sh` passou a carregar o módulo de eventos via
  `session_start_load_support_modules`.

**Atualização desta rodada (F17.1B — slice 11, extra):**

- helper dedicado criado: `hooks-lib/lifecycle/session-start-violations.sh`.
- extração do bloco de detecção/consumo de flags e severidade:
  - `UNAUTHORIZED_CLOSE.flag`,
  - `SESSION_CLOSE_NO_KEY.flag`,
  - cálculo de `VIOLATION_EMOJIS`/`VIOLATION_LEVEL`.
- `session-start-lib.sh` agora delega esse fluxo para `session_start_prepare_violation_state`.
- `session-start-runtime.sh` atualizado para carregar o módulo de violações.

**Atualização desta rodada (F17.1B — slice 12, extra):**

- helper expandido: `hooks-lib/lifecycle/session-start-recovery.sh`.
- extração do bloco residual de classificação de encerramento anterior:
  - detecção de `sessionEnd/sessionCloseAuthorized` em audit atual/arquivado,
  - fallback por `SESSION_CLOSE_AUTHORIZED.flag`,
  - classificação de `PREV_CLOSE_MODE` (`key_validated`, `abrupt_no_key`, `clean`,
    `abrupt_reconnect`),
  - contagem de reconexões e limpeza de flag autorizada stale.
- `session-start-lib.sh` passou a delegar esse fluxo para
  `session_start_prepare_abrupt_close_state`.

**Atualização desta rodada (F17.1B — slice 13, extra):**

- helper expandido: `hooks-lib/lifecycle/session-start-briefing.sh`.
- extração do bloco residual de alertas runtime no briefing:
  - histórico de falhas de `vscode_askQuestions` API,
  - leitura do `watchdog-report.json` e render de alertas.
- `session-start-lib.sh` passou a delegar esse fluxo para
  `session_start_append_runtime_alert_sections`.

**Atualização desta rodada (F17.1B — slice 14, extra):**

- helper expandido: `hooks-lib/lifecycle/session-start-recovery.sh`.
- extração do bloco residual de recovery pós-classificação:
  - montagem de `RECOVERY_ALERTS` por `PREV_CLOSE_MODE`,
  - cálculo de `alerts_require_kickoff`,
  - persistência de `.recovery` no `session-context-*.json`.
- `session-start-lib.sh` passou a delegar esse fluxo para `session_start_prepare_recovery_alerts`.

**Atualização desta rodada (F17.1B — slice 15, extra):**

- helper dedicado criado: `hooks-lib/lifecycle/session-start-input.sh`.
- extração do parsing de payload de entrada:
  - leitura de `timestamp/cwd/source`,
  - resolução de `SESSIONSTART_TRIGGER_KIND`,
  - resolução de `SESSION_ID` (payload ou fallback temporal).
- `session-start-lib.sh` agora delega para `session_start_parse_hook_input`.
- `session-start-runtime.sh` atualizado para carregar o módulo de input.

**Atualização desta rodada (F17.1B — slice 16, extra):**

- helper expandido: `hooks-lib/lifecycle/session-start-violations.sh`.
- extração da leitura de snapshot de contexto anterior (`session-context.json`):
  - `PREV_CONSEC_UNAUTH`,
  - `PREV_SESSION_ID_FROM_CTX`,
  - `PREV_LAST_TURN_TS_FROM_CTX`,
  - `PREV_TURN_NUMBER_FROM_CTX`.
- `session-start-lib.sh` agora delega para `session_start_load_previous_context_snapshot`.

**Atualização desta rodada (F17.1B — slice 17, extra):**

- helper dedicado criado: `hooks-lib/lifecycle/session-start-bootstrap.sh`.
- extração do bootstrap de metadados da sessão:
  - `SESSION_DATE`/`SESSION_DATE_SHORT`,
  - `SID_SHORT` + paths de contexto/audit por sessão,
  - geração de `CLOSE_KEY`,
  - geração de `INITIAL_SECTION_ID` e `INITIAL_TURN_ID`.
- `session-start-lib.sh` passou a delegar para `session_start_prepare_session_metadata`.
- `session-start-runtime.sh` atualizado para carregar o módulo de bootstrap.

**Atualização desta rodada (F17.1B — slice 18, extra):**

- helper expandido: `hooks-lib/lifecycle/session-start-briefing.sh`.
- criação de agregador de montagem do briefing:
  - `session_start_render_full_briefing` encapsula base + seções condicionais + alertas + corpo.
- `session-start-lib.sh` passou a delegar a renderização completa para esse helper, removendo
  sequência longa de condicionais inline.

### C — Normalização

- padronizar contrato de erro e logs por bloco extraído,
- garantir que o script principal permaneça sem regras de domínio.

### D — Validação

- rodar diagnósticos de editor nos arquivos alterados,
- validar ausência de regressão estrutural (`script -> run_*_hook`).

### E — Sincronização

- atualizar ROADMAP/PLANO + status machine-readable da F17.1.

## Gates de aceite da F17.1

1. Script `session-start.sh` permanece wrapper estrito.
2. `run_session_start_hook` continua sendo ponto de entrada único.
3. Blocos de domínio extraídos sem duplicação crítica com `session-start-core/aux`.
4. Nenhum erro de diagnóstico nos arquivos alterados.
5. Documentação e estado de fase sincronizados.
