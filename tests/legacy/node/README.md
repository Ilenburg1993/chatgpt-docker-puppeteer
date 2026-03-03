# tests/legacy/node

**Propósito**: Testes JavaScript de fases anteriores do projeto, não compatíveis com o runner nativo
Node.js atual.  
**Status**: Histórico.  
**Público**: Mantenedores para referência e migração.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Testes de integração e sistema de fases anteriores (DNA, schema v5, proxy, task e2e, etc.).

## Entradas principais

| Arquivo                            | Descrição                           |
| ---------------------------------- | ----------------------------------- |
| `test_dna_system.js`               | Testes do sistema de identidade DNA |
| `test_schema_v5.js`                | Testes do schema versão 5           |
| `test_task_end_to_end.js`          | Testes E2E de tarefas (legado)      |
| `test_chrome_proxy_integration.js` | Integração de proxy Chrome (legado) |

## Regras de manutenção

- Não executar em CI principal.
- Migrar cenários relevantes para `tests/integration/` ou `tests/unit/`.

## Links relacionados

- Pasta pai: `tests/legacy/README.md`
