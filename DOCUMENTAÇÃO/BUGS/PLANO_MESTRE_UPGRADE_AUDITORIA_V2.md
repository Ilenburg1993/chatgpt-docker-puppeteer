# Plano Mestre Consolidado - Upgrade Audit v2

## Resumo

Este documento consolida a implementação do Upgrade Audit v2 para tornar a auditoria automatizada:

- bug-first e orientada a risco real de runtime/contrato;
- observável com logs exaustivos por fase/step;
- rastreável com progresso, ETA e backlog restante;
- capaz de propor solução estruturada por achado (sem auto-aplicar patch).

## Objetivos

1. Priorizar bugs/gaps/falhas de contrato críticos (`P0/P1`) no relatório principal.
2. Separar ruído técnico (`incompletude`/`upgrade`) em backlog explícito.
3. Produzir trilha operacional completa por execução (`run_id`).
4. Preservar fase não-bloqueante da esteira nesta etapa.

## Escopo técnico

### Arquitetura de fases

1. `preflight`
2. `context-refresh`
3. `collect-static`
4. `collect-runtime`
5. `collect-tests`
6. `normalize-correlate`
7. `triage-intelligence`
8. `publish`

### Artefatos por execução

Diretório: `artifacts/audit/runs/<run_id>/`

- `run_manifest.json`
- `events.jsonl`
- `progress.json`
- `phase_timeline.json`
- `findings_raw.json`
- `findings_normalized.json`
- `proposals.json`
- `audit_report_v2.json`
- `summary.md`
- `steps/<step_id>/command.json`
- `steps/<step_id>/stdout.log`
- `steps/<step_id>/stderr.log`

## Contratos implementados

### CLI v2

- `--focus bug-first|all`
- `--progress true|false`
- `--eta true|false`
- `--heartbeat-ms <int>`
- `--refresh-context smart|force|skip`
- `--propose-diffs true|false`
- `--max-findings <int>`
- `--resume-run <run_id>`
- `--log-level info|debug`
- `--log-format console|jsonl`

### Schema

- `AuditRunV2` (`schema_version: "2.0"`)
- `AuditFindingV2` com:
  - `confidence_score`
  - `blast_radius`
  - `proposal.summary`
  - `proposal.suggested_diff`
  - `proposal.files_touched[]`
  - `proposal.test_plan[]`
  - `proposal.rollback_hint`
  - `finding_channel: primary|backlog`

### Evento JSONL

Campos padrão por evento:

- `ts`, `run_id`, `phase`, `step_id`, `event_type`, `status`, `message`
- `progress_pct`, `eta_ms`, `elapsed_ms`
- `command`, `exit_code`, `duration_ms`, `stdout_path`, `stderr_path`
- `error_code`, `error_message`

## Inteligência de triagem

1. Context pack por achado (finding + RAG + LSP).
2. Ranking de causa-raiz (Top 3 com score).
3. Proposta de solução estruturada.
4. Diff sugerido opcional (não aplicado).
5. Fallback determinístico quando MCP/RAG/LSP indisponíveis.

## Política bug-first

Canal `primary`:

- severidade `P0|P1`
- tipo `bug|gap|falha de contrato`

Canal `backlog`:

- demais achados (`P2/P3` e/ou tipos de higiene técnica)

## Publicação

1. `BUG_AUDIT_MASTER.md`

- seção fixa v2 de telemetria, progresso, degradação e risco.
- seção explícita `P0/P1 Ativos`.
- seção explícita `Backlog técnico P2/P3`.

2. snapshots

- preserva formato atual.
- adiciona metadados do snapshot (`schema_version`, `focus_mode`, `partial`, `eta_final_ms`).

## CI/Nightly

- `audit-lite` e `audit-nightly` executam com `focus=bug-first`.
- artefatos incluem trilha v2 completa da execução.
- pipeline permanece não-bloqueante nesta fase.

## Waves de implementação

### Wave 12A

Observabilidade base (event bus, logs por step, progresso, ETA).

### Wave 12B

State machine de fases no runner + `resume-run`.

### Wave 12C

Bug-first e separação primário/backlog.

### Wave 12D

Proposal engine (causa-raiz + diff sugerido + test plan).

### Wave 12E

Publishers v2 e documentação canônica.

### Wave 12F

Aprimoramentos de CI/Nightly e resumo operacional.

## Testes obrigatórios

1. Runner gera `AuditRunV2` válido com falha parcial.
2. `events.jsonl` mantém sequência consistente.
3. `progress_pct` monotônico e ETA presente durante execução.
4. P0/P1 aparecem no canal `primary`.
5. Proposal engine funciona com e sem MCP.
6. Master/snapshot refletem metadados v2.

## Assunções e defaults

- idioma: Português.
- modo inicial: não-bloqueante.
- sem auto-fix/autocommit.
- foco padrão: `bug-first`.
- heartbeat padrão: `5000ms`.
- refresh-context nightly: `smart`.
- retenção inicial de runs: 30 (rotação futura planejada).
