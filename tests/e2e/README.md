# tests/e2e

**Propósito**: Testes de ponta a ponta (E2E) que validam fluxos completos do sistema — boot, sequência de inicialização e integração total do agente.  
**Status**: Canônico.  
**Público**: QA, mantenedores do runtime e desenvolvedores de novas funcionalidades.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Specs E2E que exercitam o sistema do `main.js` até o browser automation.
- Validação da sequência de boot completa (6 fases).
- Testes de integração fim-a-fim cobrindo kernel, driver, NERV e server.

## O que não deve ficar aqui

- Testes unitários isolados → `tests/unit/`.
- Testes de integração parciais → `tests/integration/`.
- Scripts de diagnóstico manual → `tests/manual/`.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `test_ariadne_thread.spec.js` | Valida rastreabilidade de contexto ponta a ponta |
| `test_boot_sequence.spec.js` | Verifica as 6 fases do boot do sistema |
| `test_integration_complete.spec.js` | Cobertura completa de integração E2E |

## Regras de manutenção

- Executar com `npm run test:unit` (runner nativo Node.js `--test`).
- Testes E2E não devem lançar instâncias reais de browser — use mocks do `tests/mocks/`.
- Cada spec deve ser independente e não compartilhar estado com outros specs.

## Links relacionados

- Hub de testes: `tests/README.md`
- Mocks compartilhados: `tests/mocks/`
- Integração parcial: `tests/integration/`
