# tests/integration/audit

**Propósito**: Testes de integração do pipeline de auditoria — contratos e preflight semântico
end-to-end.  
**Status**: Canônico.  
**Público**: Desenvolvedores do sistema de auditoria (`scripts/audit/`).  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo                               | Descrição                                                 |
| ------------------------------------- | --------------------------------------------------------- |
| `test_contract_e2e.spec.js`           | Validação end-to-end do sistema de contratos de auditoria |
| `test_semantic_preflight_e2e.spec.js` | Preflight semântico integrado com RAG e LSP               |

## Regras de manutenção

- Testes podem ser mais lentos — não incluir no baseline de CI rápido sem flags.

## Links relacionados

- Testes de integração: `tests/integration/README.md`
- Testes unitários de audit: `tests/unit/audit/`
- Pipeline de auditoria: `scripts/audit/`
