# src/nerv/telemetry

**Propósito**: Telemetria IPC e métricas de desempenho do barramento NERV.  
**Status**: Canônico.  
**Público**: Mantenedores de observabilidade e do NERV.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `ipc_telemetry.js`: coleta de métricas de comunicação IPC.
- `metrics.js`: agregação e exposição de métricas do barramento.

## O que não deve ficar aqui

- Telemetria do kernel → `src/kernel/telemetry/`
- Telemetria compartilhada → `src/shared/telemetry/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `ipc_telemetry.js` | Métricas de comunicação IPC do NERV |
| `metrics.js` | Agregação de métricas do barramento |

## Regras de manutenção

- Métricas devem ser expostas em formato compatível com o dashboard.

## Links relacionados

- Módulo pai: `src/nerv/`
- Telemetria compartilhada: `src/shared/telemetry/`
