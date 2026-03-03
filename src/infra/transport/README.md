# src/infra/transport

**Propósito**: Adaptador de transporte Socket.io para comunicação em tempo real entre o servidor e
clientes.  
**Status**: Canônico.  
**Público**: Módulos de servidor e NERV que precisam de transporte em tempo real.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `socket_io_adapter.js`: adaptador Socket.io para emissão e recepção de eventos em tempo real.

## O que não deve ficar aqui

- Transporte híbrido NERV → `src/nerv/transport/`
- Bridge PM2 → `src/server/realtime/bus/`
- IPC inter-processos → `src/infra/ipc/`

## Entradas principais

| Arquivo                | Descrição                                         |
| ---------------------- | ------------------------------------------------- |
| `socket_io_adapter.js` | Adaptador Socket.io para transporte em tempo real |

## Regras de manutenção

- O adaptador deve suportar reconexão automática e backpressure.

## Links relacionados

- Módulo pai: `src/infra/`
- Transporte NERV: `src/nerv/transport/`
- Realtime do servidor: `src/server/realtime/`
