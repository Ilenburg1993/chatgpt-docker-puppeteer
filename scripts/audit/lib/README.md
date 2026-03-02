# scripts/audit/lib

**Propósito**: Utilitários internos do pipeline de auditoria — logger, exec, schema, git, progress, fingerprint e mais.  
**Status**: Canônico.  
**Público**: Desenvolvedores do sistema de auditoria.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `logger.mjs` | Logger interno do pipeline |
| `exec.mjs` | Utilitário de execução de comandos com captura |
| `schema.mjs` | Schemas de dados do pipeline |
| `git.mjs` | Utilitários Git (diff, blame, log) |
| `fingerprint.mjs` | Fingerprinting de artefatos |
| `phase_plan.mjs` | Planejamento de fases de auditoria |
| `progress_tracker.mjs` | Rastreamento de progresso |
| `impact_classifier.mjs` | Classificador de impacto de findings |
| `run_state_store.mjs` | Store de estado de run de auditoria |
| `retention.mjs` | Política de retenção de artefatos |
| `eta_estimator.mjs` | Estimativa de tempo de conclusão |
| `event_types.mjs` | Tipos de eventos do pipeline |
| `quality_targets.mjs` | Metas de qualidade configuráveis |

## Links relacionados

- Pipeline pai: `scripts/audit/README.md`
