# src/kernel/kernel_loop

**Propósito**: Loop de controle do kernel — executa a 20Hz (50ms), coordena o ciclo de observação, decisão e ação.  
**Status**: Canônico.  
**Público**: Mantenedores do kernel; componente crítico de performance.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `kernel_loop.js`: implementação do loop de controle a 20Hz.

## O que não deve ficar aqui

- Lógica de execução de tarefa individual → `src/kernel/execution_engine/`
- Políticas de decisão → `src/kernel/policy_engine/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `kernel_loop.js` | Loop de controle a 20Hz do kernel |

## Regras de manutenção

- Nenhum I/O bloqueante no loop; use operações assíncronas com timeout.
- O intervalo (50ms) deve ser configurável via `config.json`.

## Links relacionados

- Módulo pai: `src/kernel/`
- Motor de execução: `src/kernel/execution_engine/`
