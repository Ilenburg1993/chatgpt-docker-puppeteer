# tests/legacy

**Propósito**: Testes antigos não migrados para o runner nativo do Node.js — mantidos para referência histórica e regressão pontual.  
**Status**: Histórico.  
**Público**: Mantenedores com acesso a contexto histórico do projeto.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Testes Node.js legados (pré-refatoração) em `node/`.
- Testes Python legados em `python/`.
- Anotações de testes manuais em `manual-notes/`.

## O que não deve ficar aqui

- Novos testes — usar `tests/unit/`, `tests/integration/` ou `tests/e2e/`.

## Entradas principais

| Pasta | Descrição |
|---|---|
| `node/` | Testes JS legados (14 arquivos de fases anteriores) |
| `python/` | Testes Python dos agentes auxiliares |
| `manual-notes/` | Anotações TXT de testes manuais históricos |

## Regras de manutenção

- Não executar em CI principal — apenas referência ou migração pontual.
- Não criar novos arquivos aqui.
- Ao migrar um teste legado, remover o arquivo original desta pasta.

## Links relacionados

- Hub de testes: `tests/README.md`
- Testes ativos: `tests/unit/`, `tests/integration/`
