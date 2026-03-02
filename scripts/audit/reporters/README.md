# scripts/audit/reporters

**Propósito**: Reporters de resultados de auditoria — saída para console, JSONL e relatório de cobertura de contratos.  
**Status**: Canônico.  
**Público**: Desenvolvedores do pipeline de auditoria.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `console_reporter.mjs` | Formata e exibe resultados no terminal |
| `jsonl_reporter.mjs` | Gera saída JSONL para consumo por ferramentas |
| `contract_coverage_reporter.mjs` | Relatório de cobertura de contratos arquiteturais |

## Links relacionados

- Pipeline pai: `scripts/audit/README.md`
- Publicação: `scripts/audit/publish_json.mjs`, `publish_md.mjs`
