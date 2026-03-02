# tests/fixtures/tasks

**Propósito**: Fixtures de tarefas (missões) válidas e inválidas para testes de validação de schema e processamento da fila.  
**Status**: Canônico.  
**Público**: Desenvolvedores de testes de kernel, agent e infra.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Arquivos JSON com tarefas para diferentes targets (ChatGPT, Gemini) e cenários de erro.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `tarefa-valida-chatgpt.fixture.json` | Tarefa válida para o driver ChatGPT |
| `tarefa-valida-gemini.fixture.json` | Tarefa válida para o driver Gemini |
| `tarefa-invalida.fixture.json` | Tarefa com campos ausentes para testes de validação |

## Regras de manutenção

- Não usar prompts reais de produção.
- Manter sincronizado com o schema de tarefa em `src/core/`.

## Links relacionados

- Fixtures pai: `tests/fixtures/README.md`
- Testes de kernel: `tests/unit/kernel/`
- Testes de agent: `tests/unit/agent/`
