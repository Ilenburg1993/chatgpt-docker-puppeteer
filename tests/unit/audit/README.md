# tests/unit/audit

**Propósito**: Testes unitários do pipeline de auditoria — coletores, contratos, parsers, classificadores e retenção.  
**Status**: Canônico.  
**Público**: Desenvolvedores do sistema de auditoria (`scripts/audit/`).  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `test_contract_engine.spec.js` | Motor de contratos de auditoria |
| `test_contract_registry.spec.js` | Registro de contratos |
| `test_impact_classifier_scope_matrix.spec.js` | Classificador de impacto por escopo |
| `test_jsdoc_coverage_engine_*.spec.js` | Engine de cobertura JSDoc |
| `test_proposal_engine_contract_diff.spec.js` | Motor de propostas com diff de contratos |
| `test_quality_collector_*.spec.js` | Coletores de qualidade |
| `test_runtime_collector_semantic.spec.js` | Coletor semântico de runtime |
| `security_collector.spec.js` | Coletor de segurança |
| `test_retention.spec.js` | Política de retenção de artefatos |

## Links relacionados

- Hub unitário: `tests/unit/README.md`
- Pipeline: `scripts/audit/`
- Integração: `tests/integration/audit/`
