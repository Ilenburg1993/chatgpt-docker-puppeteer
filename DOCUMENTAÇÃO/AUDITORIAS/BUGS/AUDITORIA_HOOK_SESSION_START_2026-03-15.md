# Relatório de Auditoria de Código — Hook `sessionStart`

## Sumário executivo

A implementação do hook `sessionStart` está bem modularizada no nível de entrypoint (F14/F17), mas ainda apresenta riscos semânticos importantes em **consistência de contrato**, **atomicidade de estado**, **detecção de encerramento abrupto** e **custos operacionais no boot da sessão**. O desenho atual funciona no caminho feliz, porém há múltiplos pontos de drift entre contratos (`events-contract.md` / `session-context.schema.json`) e valores efetivamente persistidos.

Resultado geral: **estado funcional bom**, **robustez média**, **governança contratual parcial**.

---

## Contexto da auditoria

- Escopo auditado:
  - `.github/hooks/scripts/session-start.sh`
  - `.github/hooks/hooks-lib/lifecycle/session-start-*.sh`
  - `.github/hooks/hooks-lib/session-start-{core,aux}.sh` (shim)
  - dependências contratuais correlatas: `common.sh`, `events-contract.md`, `session-context.schema.json`, `smoke-test.sh`
- Runtime considerado: Bash + jq + arquivos de estado/log do sistema de hooks.
- Método: auditoria manual semântica (skill `code-audit`) com foco em invariantes de lifecycle e consistência de estado.

---

## Tabela-resumo

### Issues (Parte I)

| ID         | Arquivo/Função                                                        | Categoria             | Severidade | Título                                                                                      |
| ---------- | --------------------------------------------------------------------- | --------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| BUG-SS-001 | `session-start-input.sh::session_start_parse_hook_input`              | Contrato              | Alta       | Fallback de `session_id` fora do padrão UUID do schema                                      |
| BUG-SS-002 | `session-start-core.sh::session_start_persist_initial_context`        | Contrato              | Alta       | Campo legado `turn_unauthorized` diverge de `turn_no_askQuestions`                          |
| BUG-SS-003 | `session-start-core.sh::session_start_persist_initial_context`        | Consistência          | Média      | Reuso de contexto em `inline_restart` sem reset completo de estruturas sensíveis            |
| BUG-SS-004 | `session-start-core.sh` + `session-start-lib.sh`                      | Estado                | Alta       | Fallback de corrupção (`SOURCE="new"`) não recalcula sessão lógica                          |
| BUG-SS-005 | `session-start-recovery.sh::session_start_prepare_abrupt_close_state` | Lógica                | Alta       | Detecção de reconexão via `grep` suscetível a falso positivo                                |
| BUG-SS-006 | `session-start-recovery.sh::session_start_prepare_recovery_alerts`    | Atomicidade           | Média      | Escrita de contexto sem lock explícito                                                      |
| BUG-SS-007 | `session-start-aux.sh::session_start_compute_trends`                  | Robustez              | Média      | Mutação global de `AUDIT_FILE` durante agregação histórica                                  |
| BUG-SS-008 | `session-start-runtime.sh::session_start_run_housekeeping_scripts`    | Resiliência           | Média      | `watchdog`/`rotate` sem timeout defensivo                                                   |
| BUG-SS-009 | `session-start-events.sh::session_start_emit_bootstrap_events`        | Segurança/Privacidade | Média      | `close_key` é logada em texto puro no audit                                                 |
| BUG-SS-010 | `session-start-observability.sh::session_start_emit_hook_output`      | Observabilidade       | Média      | `additionalContext` sem limite explícito de tamanho                                         |
| BUG-SS-011 | `session-start-input.sh`                                              | Compatibilidade       | Baixa      | `source=auto_recovery` não mapeado explicitamente em `trigger_kind`                         |
| BUG-SS-012 | `smoke-test.sh` (checks session-start)                                | Testabilidade         | Média      | Cobertura estrutural forte, mas baixa cobertura comportamental de cenários adversos do hook |

---

## Parte I — Issues detalhados

### BUG-SS-001 — Fallback de `session_id` fora do contrato UUID
- **Arquivo:** `hooks-lib/lifecycle/session-start-input.sh`
- **Severidade:** Alta
- **Descrição:** quando `session_id` não vem no payload, o fallback gera `sess_<timestamp>`, mas o schema (`contracts/session-context.schema.json`) define padrão UUID para `session.id`.
- **Impacto:** risco de drift contratual e falhas em consumidores que assumem UUID.
- **Correção proposta:** fallback por UUID válido (`uuidgen`/`openssl`) e flag separada para indicar origem sintética.

### BUG-SS-002 — Divergência de métrica de sessão (`turn_unauthorized` vs `turn_no_askQuestions`)
- **Arquivo:** `hooks-lib/session-start-core.sh`
- **Severidade:** Alta
- **Descrição:** contexto inicial usa `turn_unauthorized`, enquanto o schema e partes do fluxo adotam `turn_no_askQuestions`.
- **Impacto:** métricas inconsistentes e risco de dashboards/alertas incorretos.
- **Correção proposta:** convergir para um único campo canônico e manter migração backward-compatible explícita.

### BUG-SS-003 — Inline restart reusa estado sem reset completo
- **Arquivo:** `hooks-lib/session-start-core.sh`
- **Severidade:** Média
- **Descrição:** no caminho `inline_restart` há atualização parcial do contexto prévio; partes de estado podem permanecer “sujas”.
- **Impacto:** efeitos colaterais de sessão anterior influenciando sessão atual.
- **Correção proposta:** reset explícito de subconjuntos críticos (`current_turn`, recovery transient, flags de pending).

### BUG-SS-004 — Fallback de corrupção não recalcula sessão lógica
- **Arquivos:** `hooks-lib/session-start-core.sh`, `hooks-lib/lifecycle/session-start-lib.sh`
- **Severidade:** Alta
- **Descrição:** quando inline corrompe, `SOURCE` é alterado para `new`, mas `LOGICAL_SESSION_NUMBER` pode já ter sido calculado para inline.
- **Impacto:** numeração lógica potencialmente incorreta.
- **Correção proposta:** recalcular `LOGICAL_SESSION_NUMBER` ao trocar `SOURCE` em fallback.

### BUG-SS-005 — Detecção de reconnect baseada em `grep`
- **Arquivo:** `hooks-lib/lifecycle/session-start-recovery.sh`
- **Severidade:** Alta
- **Descrição:** detecção usa `grep` por string em JSONL; suscetível a match acidental e ruído.
- **Impacto:** classificação errada de `PREV_CLOSE_MODE`.
- **Correção proposta:** substituir por consulta estruturada com `jq` por `event` + `session_id`.

### BUG-SS-006 — Escrita de recovery sem lock
- **Arquivo:** `hooks-lib/lifecycle/session-start-recovery.sh`
- **Severidade:** Média
- **Descrição:** atualização de `per_ctx_file` com `mv/cp` sem lock central.
- **Impacto:** risco de race em cenários de concorrência/hook overlap.
- **Correção proposta:** unificar escrita via helper transacional com lock.

### BUG-SS-007 — Mutação global de `AUDIT_FILE` em trends
- **Arquivo:** `hooks-lib/session-start-aux.sh`
- **Severidade:** Média
- **Descrição:** função de tendências troca `AUDIT_FILE` global temporariamente.
- **Impacto:** side effect oculto em caso de erro/early-exit.
- **Correção proposta:** usar variável local isolada + `trap` de cleanup/restauração.

### BUG-SS-008 — Housekeeping sem timeout
- **Arquivo:** `hooks-lib/lifecycle/session-start-runtime.sh`
- **Severidade:** Média
- **Descrição:** execução de `watchdog.sh` e `rotate-audit.sh` sem timeout de proteção.
- **Impacto:** hook pode estourar `timeoutSec` do `sessionStart`.
- **Correção proposta:** envolver em executor com timeout (`run_aux_block`) e telemetria de duração.

### BUG-SS-009 — Exposição de `close_key` em audit
- **Arquivo:** `hooks-lib/lifecycle/session-start-events.sh`
- **Severidade:** Média
- **Descrição:** evento `sessionStart` persiste `close_key` em texto puro.
- **Impacto:** ampliação de superfície de segredo operacional.
- **Correção proposta:** logar apenas hash/prefixo e manter valor completo somente no contexto necessário.

### BUG-SS-010 — `additionalContext` sem limite explícito
- **Arquivo:** `hooks-lib/lifecycle/session-start-observability.sh`
- **Severidade:** Média
- **Descrição:** payload textual pode crescer dependendo do briefing.
- **Impacto:** risco de truncamento imprevisível, falha de entrega ou custo elevado de tokens.
- **Correção proposta:** impor limite de bytes e sumarização por blocos prioritários.

### BUG-SS-011 — `auto_recovery` não mapeado explicitamente
- **Arquivo:** `hooks-lib/lifecycle/session-start-input.sh`
- **Severidade:** Baixa
- **Descrição:** fonte existe no contrato/documentação, mas não no mapeamento dedicado de `trigger_kind`.
- **Impacto:** perda de granularidade semântica em auditoria.
- **Correção proposta:** adicionar branch explícito para `auto_recovery`.

### BUG-SS-012 — Smoke com baixa cobertura comportamental do `session-start`
- **Arquivo:** `scripts/smoke-test.sh`
- **Severidade:** Média
- **Descrição:** checks majoritariamente estruturais; faltam cenários adversos específicos do `session-start` modular.
- **Impacto:** regressões lógicas podem passar despercebidas.
- **Correção proposta:** adicionar suíte de cenários comportamentais dedicados ao hook.

---

## Parte II — Propostas de alterações (52 itens)

> Lista objetiva, priorizada e acionável para implementação incremental.

| ID   | Prioridade | Categoria       | Proposta                                                                                                                 |
| ---- | ---------- | --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| P-01 | Alta       | Contrato        | Gerar fallback de `session_id` em UUID válido (não `sess_<ts>`).                                                         |
| P-02 | Alta       | Contrato        | Validar `session_id` de entrada contra regex UUID e marcar `session_id_invalid=true` em caso de desvio.                  |
| P-03 | Média      | Contrato        | Capturar `hook_event_name` no parser e validar `SessionStart`.                                                           |
| P-04 | Média      | Contrato        | Expandir `source` com enum validado (`new`, `inline_restart`, `reconnect_rollover`, `manual_recovery`, `auto_recovery`). |
| P-05 | Média      | Contrato        | Mapear `source=auto_recovery` para `SESSIONSTART_TRIGGER_KIND` explícito.                                                |
| P-06 | Alta       | Contrato        | Harmonizar `session_stats.turn_unauthorized` → `turn_no_askQuestions` no contexto inicial.                               |
| P-07 | Alta       | Contrato        | Incluir rotina de migração de chave legada no `session-start` para contextos antigos.                                    |
| P-08 | Média      | Contrato        | Incluir `schema_version` explícito no JSON inicial de sessão.                                                            |
| P-09 | Média      | Contrato        | Garantir presença inicial de `current_turn.section_id` alinhado ao `INITIAL_SECTION_ID`.                                 |
| P-10 | Média      | Contrato        | Inicializar `current_turn.subturn` no bootstrap do `session-start` para invariância estrutural.                          |
| P-11 | Média      | Contrato        | Definir `required_docs_set_at` no contexto inicial.                                                                      |
| P-12 | Baixa      | Contrato        | Adicionar `session_start_version`/`template_version` para rastrear versão do briefing.                                   |
| P-13 | Alta       | Estado          | Recalcular `LOGICAL_SESSION_NUMBER` quando inline fallback muda `SOURCE` para `new`.                                     |
| P-14 | Alta       | Estado          | Encapsular escritas de contexto (`persist_initial_context`, `prepare_recovery_alerts`) com lock unificado.               |
| P-15 | Alta       | Estado          | Reutilizar helper transacional (`ctx_update`/equivalente) em vez de `mv/cp` direto.                                      |
| P-16 | Média      | Estado          | Definir `umask 077` antes de criar arquivos de estado sensíveis.                                                         |
| P-17 | Média      | Estado          | Ajustar permissões de `session-context-*.json` e `audit-*.jsonl` para 600.                                               |
| P-18 | Média      | Estado          | Garantir criação (`touch`) de `PER_AUDIT_FILE` antes da troca de ponteiros e emissão de eventos.                         |
| P-19 | Média      | Estado          | Validar e normalizar `TIMESTAMP` vazio para `SESSION_DATE` já no parser de input.                                        |
| P-20 | Média      | Estado          | Persistir `cwd` normalizado (trim/sanitização) para evitar ruído no contexto.                                            |
| P-21 | Média      | Estado          | Evitar mutação global de `AUDIT_FILE` em `session_start_compute_trends` (usar var local).                                |
| P-22 | Média      | Estado          | Adicionar `trap` de cleanup para arquivos temporários (`mktemp`) nas funções de trends/recovery.                         |
| P-23 | Baixa      | Estado          | Incluir contador de retries/erros de escrita no contexto para troubleshooting.                                           |
| P-24 | Baixa      | Estado          | Marcar contexto com `bootstrap_completed=true` ao final do hook (commit lógico).                                         |
| P-25 | Alta       | Recovery        | Trocar detecção de reconnect por `jq` estruturado (evento + `session_id`) em vez de `grep`.                              |
| P-26 | Alta       | Recovery        | Calcular `PREV_RECONNECT_COUNT` com `jq` (contagem exata), removendo `grep                                               | wc`. |
| P-27 | Média      | Recovery        | Adicionar prioridade explícita de decisão para `PREV_CLOSE_MODE` (authorized > clean > reconnect > abrupt).              |
| P-28 | Média      | Recovery        | Limitar varredura de checkpoints (ex.: top 100) para evitar custo em diretórios grandes.                                 |
| P-29 | Média      | Recovery        | Validar `checkpoint_ts` com parser robusto e registrar motivo de parse inválido.                                         |
| P-30 | Média      | Recovery        | Ignorar checkpoints mais antigos que janela configurável (ex.: 30/90 dias).                                              |
| P-31 | Baixa      | Recovery        | Registrar evento quando nenhum checkpoint elegível é encontrado.                                                         |
| P-32 | Média      | Recovery        | Persistir `recovery_reason_code` canônico no contexto para facilitar dashboards.                                         |
| P-33 | Baixa      | Recovery        | Incluir `prev_session_end_detected_source` (audit/archive/flag) para auditoria de decisão.                               |
| P-34 | Média      | Recovery        | Adicionar proteção contra substrings acidentais de `session_id` na classificação de reconnect.                           |
| P-35 | Alta       | Segurança       | Não logar `close_key` em texto puro no `sessionStart`; logar hash curto/censorado.                                       |
| P-36 | Média      | Segurança       | Redigir `close_key` também no `additionalContext` quando não estritamente necessária.                                    |
| P-37 | Média      | Segurança       | Adicionar teste de regressão para garantir ausência de `close_key` plaintext em `audit-*`.                               |
| P-38 | Média      | Observabilidade | Incluir `correlation_id` comum para `sessionStart` e `sectionStart`.                                                     |
| P-39 | Média      | Observabilidade | Emitir evento `sessionStart_stage_failed` com `stage` e `reason` em falhas de bootstrap.                                 |
| P-40 | Baixa      | Observabilidade | Adicionar medição de latência por estágio (`parse`, `bootstrap`, `recovery`, `briefing`, `emit`).                        |
| P-41 | Média      | Observabilidade | Limitar `hookSpecificOutput.additionalContext` por bytes (ex.: 16KB) com truncamento explícito.                          |
| P-42 | Baixa      | Observabilidade | Inserir checksum do briefing no contexto para detectar drift de template.                                                |
| P-43 | Baixa      | Observabilidade | Reduzir banner em stderr em modo quiet para minimizar ruído em logs de automação.                                        |
| P-44 | Alta       | Resiliência     | Envolver `watchdog.sh` e `rotate-audit.sh` com timeout (`run_aux_block`).                                                |
| P-45 | Média      | Resiliência     | Tornar cálculo de trends/health opcional por feature flag (`HOOKS_SESSIONSTART_ENRICHMENT`).                             |
| P-46 | Média      | Resiliência     | Executar enriquecimentos pesados em fail-open com tempo máximo acumulado.                                                |
| P-47 | Baixa      | Operação        | Tornar ping de rede opcional (`HOOKS_HEALTH_NET_CHECK_ENABLED`) para ambientes isolados.                                 |
| P-48 | Baixa      | Operação        | Permitir host de health check configurável por lista, não valor fixo único.                                              |
| P-49 | Alta       | Testabilidade   | Criar suíte dedicada `smoke-session-start.sh` com cenários adversos do hook modular.                                     |
| P-50 | Alta       | Testabilidade   | Adicionar teste de integração para `inline_restart` com contexto corrompido + recomputação de sessão lógica.             |
| P-51 | Média      | Testabilidade   | Adicionar teste de contrato para alinhar `session-context.schema.json` e payload real do `session-start`.                |
| P-52 | Média      | Governança      | Extrair texto estático do briefing para template versionado central, reduzindo drift com protocolo canônico.             |

---

## Conclusão e próximos passos

Prioridade recomendada de execução:

1. **P0 imediato**: `P-01`, `P-06`, `P-13`, `P-14`, `P-25`, `P-35`, `P-44`, `P-49`.
2. **P1 curto prazo**: `P-02`, `P-08`, `P-15`, `P-21`, `P-26`, `P-41`, `P-50`, `P-51`.
3. **P2 melhoria contínua**: demais itens de governança, performance e padronização de template.

Este relatório entrega **52 propostas** (acima do mínimo de 30 e dentro da faixa ideal ~50 solicitada).
