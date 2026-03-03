# fila/

**Propósito**: Fila de tarefas do sistema de agentes — arquivos JSON representando tarefas pendentes, em execução e concluídas que o kernel consome e processa em loop contínuo.  
**Status**: Artefato de runtime.  
**Público**: Sistema de runtime (uso interno). Desenvolvedores que gerenciam o pipeline de tarefas.  
**Última atualização**: 2 de março de 2026.

## ⚠️ Não comitar o conteúdo desta pasta (exceto exemplos)

Os arquivos de tarefa são artefatos de runtime e **não devem ser commitados**. Use `fila.example.json` como referência de formato.

## O que esta pasta contém

- Arquivos `.json` de tarefas aguardando processamento
- Subpasta `corrupted/` para tarefas com problemas de parsing

## Regras de manutenção

- Use `npm run queue:add` para adicionar tarefas
- Use `npm run queue:status` para monitorar o estado
- Use `npm run queue:clear` para limpar a fila
- Tarefas corrompidas são movidas automaticamente para `corrupted/`

## Entradas principais

| Arquivo/Pasta | Descrição |
|---|---|
| `corrupted/` | Tarefas com problemas de parsing isoladas para inspeção |

## Links relacionados

- Exemplo de formato: [`fila.example.json`](../fila.example.json)
- Infra de fila: [`src/infra/queue/`](../src/infra/queue/)
- Kernel: [`src/kernel/`](../src/kernel/)
