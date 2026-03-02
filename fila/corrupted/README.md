# fila/corrupted/

**Propósito**: Quarentena de tarefas corrompidas — arquivos de tarefa que falharam no parsing e foram isolados automaticamente pelo sistema para evitar bloqueio da fila principal.  
**Status**: Artefato de runtime.  
**Público**: Desenvolvedores que investigam falhas de parsing de tarefas.  
**Última atualização**: 2 de março de 2026.

## ⚠️ Não comitar o conteúdo desta pasta

Os arquivos aqui são artefatos de runtime e **não devem ser commitados**.

## O que fazer com arquivos aqui

1. Inspecionar o arquivo JSON para identificar o problema de sintaxe
2. Corrigir e mover de volta para `fila/` se viável
3. Ou descartar se a tarefa não for mais necessária

## Links relacionados

- Fila principal: [`fila/`](../README.md)
- Infra de fila: [`src/infra/queue/`](../../src/infra/queue/)
