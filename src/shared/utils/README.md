# src/shared/utils

**Propósito**: Utilitários de execução compartilhados — preenchimento de contexto de execução.  
**Status**: Canônico de apoio.  
**Público**: Módulos que precisam de utilitários genéricos de execução.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `execution_context_filler.js`: preenche o contexto de execução com dados necessários para a tarefa em andamento.

## O que não deve ficar aqui

- Utilitários de sistema de arquivos → `src/infra/fs/`
- Utilitários de IPC → `src/shared/ipc/`
- Constantes → `src/core/constants/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `execution_context_filler.js` | Preenche contexto de execução com dados da tarefa |

## Regras de manutenção

- Utilitários aqui devem ser genuinamente reutilizáveis em múltiplos domínios.

## Links relacionados

- Módulo pai: `src/shared/`
