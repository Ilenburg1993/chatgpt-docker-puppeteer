# src/server/realtime/streams

**Propósito**: Streams de logs em tempo real para o dashboard — log tail via SSE ou Socket.io.  
**Status**: Canônico.  
**Público**: Mantenedores do dashboard e operadores de monitoramento.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `log_tail.js`: streaming de logs em tempo real para clientes conectados.

## O que não deve ficar aqui

- Watcher de arquivos de log → `src/server/watchers/log_watcher.js`
- Bus PM2 → `src/server/realtime/bus/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `log_tail.js` | Stream de tail de logs em tempo real |

## Regras de manutenção

- Limite o buffer de linhas enviadas para evitar sobrecarga em clientes lentos.

## Links relacionados

- Módulo pai: `src/server/realtime/`
- Watcher de logs: `src/server/watchers/`
