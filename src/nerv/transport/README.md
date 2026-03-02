# src/nerv/transport

**Propósito**: Transporte de baixo nível do NERV — conexão, framing, transporte híbrido e reconexão automática.  
**Status**: Canônico.  
**Público**: Mantenedores do NERV.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `transport.js`: implementação base do transporte.
- `hybrid_transport.js`: transporte híbrido (local + Socket.io).
- `connection.js`: gerenciamento de conexões.
- `framing.js`: framing de mensagens para o protocolo de transporte.
- `reconnect.js`: lógica de reconexão automática com backoff.

## O que não deve ficar aqui

- Adaptador Socket.io de infra → `src/infra/transport/socket_io_adapter.js`
- Buffers de evento → `src/nerv/buffers/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `hybrid_transport.js` | Transporte híbrido local + Socket.io |
| `connection.js` | Gerenciamento de conexões de transporte |
| `reconnect.js` | Reconexão automática com backoff |
| `framing.js` | Framing de mensagens |

## Regras de manutenção

- Configure intervalos de reconexão via `config.json`.

## Links relacionados

- Módulo pai: `src/nerv/`
- Adaptador Socket.io: `src/infra/transport/`
