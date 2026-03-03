# src/server/nerv_adapter

**Propósito**: Bridge entre o servidor Express/Socket.io e o barramento de eventos NERV.  
**Status**: Canônico.  
**Público**: Mantenedores do servidor e da integração NERV.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `server_nerv_adapter.js`: conecta o servidor ao NERV, emitindo eventos de API e recebendo comandos
  do barramento.

## O que não deve ficar aqui

- Adaptador NERV do driver → `src/driver/nerv_adapter/`
- Bridge NERV do kernel → `src/kernel/nerv_bridge/`

## Entradas principais

| Arquivo                  | Descrição                           |
| ------------------------ | ----------------------------------- |
| `server_nerv_adapter.js` | Bridge bidirecional servidor ↔ NERV |

## Regras de manutenção

- Eventos de domínio do servidor devem ser emitidos via este adaptador, não diretamente.

## Links relacionados

- Módulo pai: `src/server/`
- Barramento NERV: `src/nerv/`
