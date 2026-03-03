# src/kernel/nerv_bridge

**Propósito**: Bridge entre o kernel e o barramento de eventos NERV — traduz eventos NERV em ações
do kernel e vice-versa.  
**Status**: Canônico.  
**Público**: Mantenedores do kernel e da integração com NERV.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `kernel_nerv_bridge.js`: conecta o kernel ao barramento NERV para comunicação desacoplada.

## O que não deve ficar aqui

- Adaptador NERV do driver → `src/driver/nerv_adapter/`
- Adaptador NERV do servidor → `src/server/nerv_adapter/`

## Entradas principais

| Arquivo                 | Descrição                         |
| ----------------------- | --------------------------------- |
| `kernel_nerv_bridge.js` | Bridge bidirecional kernel ↔ NERV |

## Regras de manutenção

- A bridge deve ser o único ponto de entrada/saída do kernel no barramento NERV.

## Links relacionados

- Módulo pai: `src/kernel/`
- Barramento NERV: `src/nerv/`
