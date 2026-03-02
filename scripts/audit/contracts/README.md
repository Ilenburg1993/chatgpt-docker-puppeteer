# scripts/audit/contracts

**Propósito**: Avaliadores de contratos arquiteturais — validam conformidade do código com os contratos definidos em `contracts/`.  
**Status**: Canônico.  
**Público**: Mantenedores do sistema de contratos.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `evaluate_chaos.mjs` | Avalia contratos sob condições de chaos |
| `evaluate_runtime.mjs` | Avalia contratos de comportamento de runtime |
| `evaluate_static.mjs` | Avalia contratos de análise estática |
| `evidence_graph.mjs` | Gera grafo de evidências de conformidade |
| `legacy_adapter.mjs` | Adapter para contratos legados |
| `load_registry.mjs` | Carrega o registro de contratos |

## Links relacionados

- Pipeline pai: `scripts/audit/README.md`
- Registro de contratos: `contracts/registry.json`
- Domínios: `contracts/domains/`
