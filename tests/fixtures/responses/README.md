# tests/fixtures/responses

**Propósito**: Respostas simuladas de LLMs para testes de parsing, validação e pós-processamento.  
**Status**: Canônico.  
**Público**: Desenvolvedores de testes de driver e pós-processamento.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Arquivos TXT com respostas de IA simuladas — tanto válidas quanto de borda.

## Entradas principais

| Arquivo                       | Descrição                                     |
| ----------------------------- | --------------------------------------------- |
| `resposta-valida.fixture.txt` | Resposta bem formada de um LLM                |
| `resposta-ia.fixture.txt`     | Resposta alternativa para cenários de parsing |

## Regras de manutenção

- Respostas devem ser fictícias — não copiar outputs reais de produção.
- Cobrir casos de borda: respostas vazias, parciais, com markdown, etc.

## Links relacionados

- Fixtures pai: `tests/fixtures/README.md`
- Testes de driver: `tests/unit/driver/`
