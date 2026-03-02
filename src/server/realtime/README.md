# src/server/realtime

**Propósito**: Funcionalidades em tempo real do servidor — bus PM2, streams SSE/Socket.io, telemetria de hardware e feed de eventos SSOT.  
**Status**: Canônico.  
**Público**: Mantenedores do dashboard e da observabilidade em tempo real.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Feed de eventos SSOT (`ssot_event_feed.js`).
- Bus PM2 para bridge de processos (`bus/`).
- Streams de logs em tempo real (`streams/`).
- Telemetria de hardware em tempo real (`telemetry/`).

## O que não deve ficar aqui

- API REST → `src/server/api/`
- Transporte Socket.io base → `src/infra/transport/`

## Entradas principais

| Arquivo/Pasta | Descrição |
|---|---|
| `ssot_event_feed.js` | Feed de eventos SSOT para o dashboard |
| `bus/` | Bridge PM2 para comunicação inter-processos |
| `streams/` | Streams de logs em tempo real (log tail) |
| `telemetry/` | Telemetria de hardware em tempo real |

## Regras de manutenção

- Streams devem ter backpressure configurado para evitar OOM.
- Eventos SSOT devem refletir o estado canônico do sistema.

## Links relacionados

- Módulo pai: `src/server/`
- Transporte: `src/infra/transport/`
- Dashboard frontend: `src/dashboard-ui/`
