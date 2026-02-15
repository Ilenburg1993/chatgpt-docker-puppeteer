# Plano Mestre de Contratos Sistêmicos v3.1

## Resumo
Este plano consolida o contrato técnico do projeto em uma base única versionada (`contracts/`), com execução automatizada no pipeline de auditoria (`audit:quick`, `audit:deep`, `audit:nightly`), priorização bug-first e propostas profundas de correção.
No estado v3.1 foram adicionados preflight semântico unificado, shadow gate explícito e telemetria de ruído.

## Objetivos
- Padronizar contratos em DSL canônica (`ContractDefinitionV1`).
- Garantir rastreabilidade: `contract_id`, domínio, owner e enforcement por achado.
- Elevar qualidade da triagem: causa-raiz rankeada, diff sugerido, plano de teste e rollback.
- Publicar cobertura e drift de contrato por execução.
- Introduzir camada de chaos no nightly sem quebrar operação não-bloqueante inicial.

## Componentes Principais
- `contracts/registry.json`: índice canônico de domínios e allowlists.
- `contracts/domains/*.json`: contratos por domínio (`runtime`, `network`, `config`, `schemas`, `api`, `logic`).
- `scripts/audit/contracts/load_registry.mjs`: carregamento + validação do registry.
- `scripts/audit/contracts/legacy_adapter.mjs`: compatibilidade com regras legadas.
- `scripts/audit/contracts/evaluate_static.mjs`: avaliação estática regex-based via DSL.
- `scripts/audit/contracts/evaluate_runtime.mjs`: mapeamento sinal->contrato para runtime.
- `scripts/audit/contracts/evaluate_chaos.mjs`: execução de cenários chaos no nightly.
- `scripts/audit/contracts/evidence_graph.mjs`: correlação e agrupamento de evidências.

## Contratos de Dados
- `AuditFindingV3`: adiciona `contract_id`, `domain`, `evidence_graph_id`, `root_cause_candidates`, `proposal.depth`, `proposal.validation_commands`, `enforcement_state`.
- `AuditRunV3` (v3.1): adiciona `semantic_preflight`, `shadow_gate`, `telemetry_noise`, `contract_parity` e artefatos v3.1.

## Operação
- `contracts-mode`:
  - `legacy`: usa apenas regras legadas.
  - `hybrid`: usa DSL + compatibilidade + paridade.
  - `strict`: usa apenas DSL e valida registry como requisito.
- `enforce-level`: `off|warn|p1|p0` (rollout progressivo).
- `proposal-depth`: `basic|standard|deep`.
- `chaos-profile`: `off|light|full`.
- `cloud-fallback`: `off|on` (local-first com fallback explícito).
- `shadow-gate`: `true|false` (fase atual: habilitado e não bloqueante).

## Comandos Canônicos v3.1
- `npm run audit:preflight`
- `npm run audit:quick:shadow`
- `npm run lsp:health -- --json`
- `make semantic-preflight`
- `make audit-ready`

## Artefatos v3.1 por Run
`artifacts/audit/runs/<run_id>/`
- `contract_registry_snapshot.json`
- `semantic_preflight.json`
- `contract_coverage.json`
- `contract_drift.json`
- `contract_parity.json`
- `evidence_graph.json`
- `gate_decisions.json`
- `chaos_events.jsonl`
- `audit_report_v3_1.json`
- `events.jsonl`, `progress.json`, `phase_timeline.json`, `findings_*.json`, `proposals.json`, `summary.md`

## Critérios de Aceite
- `audit:quick`, `audit:deep`, `audit:nightly` executam com `schema_version: 3.1`.
- Finding de contrato contém `contract_id` e domínio.
- Relatório inclui `semantic_preflight`, `shadow_gate`, cobertura, drift, paridade, decisão de gate e chaos summary.
- Master/snapshot documentam seção de automação v3.1.

## Rollout
1. `hybrid + warn` (fase inicial).
2. `hybrid + p1` (após estabilização de ruído).
3. `strict + p1` no nightly.
4. `strict + p1` em PR após janela de validação.
