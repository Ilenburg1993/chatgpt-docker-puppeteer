# src/shared/telemetry

**Propósito**: Telemetria compartilhada entre módulos — snapshot de estado e coleta de métricas transversais.  
**Status**: Canônico de apoio.  
**Público**: Módulos que produzem ou consomem dados de telemetria.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `snapshot.js`: captura snapshots de estado do sistema para telemetria e diagnóstico.

## O que não deve ficar aqui

- Telemetria específica do kernel → `src/kernel/telemetry/`
- Telemetria do NERV → `src/nerv/telemetry/`
- Telemetria de hardware do servidor → `src/server/realtime/telemetry/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `snapshot.js` | Captura snapshots de estado para telemetria |

## Regras de manutenção

- Snapshots devem ser leves e não bloquear o fluxo principal.

## Links relacionados

- Módulo pai: `src/shared/`
- Telemetria NERV: `src/nerv/telemetry/`
