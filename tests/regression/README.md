# tests/regression

**Propósito**: Testes de regressão organizados por wave — garantem que correções de bugs não regridam após refatorações.  
**Status**: Canônico.  
**Público**: Todos os desenvolvedores — executado em cada PR.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Specs de regressão agrupados por wave (p1–p5, wave1–wave20b).
- Cada wave corresponde a um conjunto de correções e contratos arquiteturais validados.

## O que não deve ficar aqui

- Novos testes de funcionalidade → `tests/unit/` ou `tests/integration/`.
- Testes E2E completos → `tests/e2e/`.

## Entradas principais (amostra)

| Arquivo | Descrição |
|---|---|
| `test_p1_fixes.spec.js` – `test_p4_p5_fixes.spec.js` | Correções das fases P1–P5 |
| `test_wave1_runtime_fixes.spec.js` | Correções de runtime da wave 1 |
| `test_wave20b_*.spec.js` | Contratos de wave 20b (import, signal, server) |

## Regras de manutenção

- Executar com `npm run test:regression`.
- Nunca remover um spec de regressão sem confirmação de que o bug não pode regridir.
- Novos bugs corrigidos devem gerar um novo spec aqui.

## Links relacionados

- Hub de testes: `tests/README.md`
- Testes unitários: `tests/unit/`
