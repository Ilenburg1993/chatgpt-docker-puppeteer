# src/infra/ipc

**Propósito**: Buffer e cliente de comunicação inter-processos (IPC) — troca de mensagens com
processos PM2 e subprocessos.  
**Status**: Canônico.  
**Público**: Módulos que precisam comunicar-se via IPC com outros processos.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `buffer.js`: buffer de mensagens IPC para serialização e desserialização.

## O que não deve ficar aqui

- Envelopes e schemas IPC compartilhados → `src/shared/ipc/`
- Transporte Socket.io → `src/infra/transport/`
- Bridge PM2 do servidor → `src/server/realtime/bus/`

## Entradas principais

| Arquivo     | Descrição                               |
| ----------- | --------------------------------------- |
| `buffer.js` | Buffer de mensagens IPC entre processos |

## Regras de manutenção

- Mensagens IPC devem seguir o schema de envelope em `src/shared/ipc/envelope.js`.

## Links relacionados

- Módulo pai: `src/infra/`
- Compartilhado IPC: `src/shared/ipc/`
