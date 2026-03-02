# src/server/realtime/bus

**Propósito**: Bridge PM2 para comunicação inter-processos em tempo real via barramento de mensagens.  
**Status**: Canônico.  
**Público**: Mantenedores do servidor e operadores PM2.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `pm2_bridge.js`: bridge de comunicação com processos PM2 via bus de mensagens.

## O que não deve ficar aqui

- IPC genérico → `src/infra/ipc/`
- Streams de log → `src/server/realtime/streams/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `pm2_bridge.js` | Bridge de mensagens PM2 para comunicação inter-processos |

## Regras de manutenção

- Mensagens PM2 devem seguir o schema de envelope de `src/shared/ipc/`.

## Links relacionados

- Módulo pai: `src/server/realtime/`
- IPC compartilhado: `src/shared/ipc/`
