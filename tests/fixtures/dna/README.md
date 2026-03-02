# tests/fixtures/dna

**Propósito**: Fixtures de identidade do agente (DNA/identidade), usados em testes de inicialização e ciclo de vida.  
**Status**: Canônico.  
**Público**: Desenvolvedores de testes de identidade e kernel.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Arquivos JSON com identidades de agente válidas para testes de bootstrapping.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `identidade-valida.fixture.json` | Identidade completa e válida para testes positivos |

## Regras de manutenção

- Nunca usar `robot_id` ou identificadores reais de produção.
- Manter compatível com o schema de identidade em `src/core/`.

## Links relacionados

- Fixtures pai: `tests/fixtures/README.md`
- Testes de kernel: `tests/unit/kernel/`
