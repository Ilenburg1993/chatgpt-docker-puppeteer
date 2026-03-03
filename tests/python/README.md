# tests/python

**Propósito**: Testes Python para os agentes auxiliares do sistema — destinado a novos testes Python
ativos.  
**Status**: Canônico de apoio.  
**Público**: Desenvolvedores dos agentes Python (`agents/`).  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Testes Python para agentes auxiliares (atualmente vazia — testes legados em
  `tests/legacy/python/`).

## O que não deve ficar aqui

- Testes Python legados → `tests/legacy/python/`.
- Testes do runtime Node.js → `tests/unit/` ou `tests/integration/`.

## Regras de manutenção

- Usar pytest como runner Python.
- Nomear arquivos como `test_<módulo>.py`.

## Links relacionados

- Hub de testes: `tests/README.md`
- Testes Python legados: `tests/legacy/python/`
- Agentes Python: `agents/`
