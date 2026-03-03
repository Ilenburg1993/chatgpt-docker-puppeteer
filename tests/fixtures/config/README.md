# tests/fixtures/config

**Propósito**: Fixtures de configuração (`config.json`) para testes de validação de schema e
comportamento de carregamento.  
**Status**: Canônico.  
**Público**: Desenvolvedores de testes do módulo `src/core/`.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Arquivos JSON representando configurações válidas e inválidas do sistema.

## Entradas principais

| Arquivo                        | Descrição                                                       |
| ------------------------------ | --------------------------------------------------------------- |
| `config-valido.fixture.json`   | Configuração completa e válida para testes positivos            |
| `config-invalido.fixture.json` | Configuração com campos ausentes/incorretos para testes de erro |

## Regras de manutenção

- Manter sincronizado com o schema oficial em `src/core/`.
- Não usar valores reais de produção (portas, hosts, credenciais).

## Links relacionados

- Fixtures pai: `tests/fixtures/README.md`
- Testes de config: `tests/unit/core/`
