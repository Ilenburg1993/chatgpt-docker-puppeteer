# src/kernel/execution_engine

**Propósito**: Motor de execução de tarefas do kernel — processa e executa tarefas
individualmente.  
**Status**: Canônico.  
**Público**: Mantenedores do kernel.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `execution_engine.js`: lógica central de execução de uma tarefa pelo kernel.

## O que não deve ficar aqui

- Loop de controle → `src/kernel/kernel_loop/`
- Runtime de tarefa completo → `src/kernel/task_runtime/`

## Entradas principais

| Arquivo               | Descrição                                  |
| --------------------- | ------------------------------------------ |
| `execution_engine.js` | Processa e executa tarefas individualmente |

## Regras de manutenção

- Não inclua lógica de polling ou loop aqui; delegue para `kernel_loop/`.

## Links relacionados

- Módulo pai: `src/kernel/`
