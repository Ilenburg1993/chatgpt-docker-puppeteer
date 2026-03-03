# src/server/dashboard-api

**Propósito**: API específica do dashboard — sincronização de tarefas e agregação de telemetria para
o frontend.  
**Status**: Canônico.  
**Público**: Mantenedores do dashboard e do frontend Vue.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `task_sync_bridge.js`: bridge de sincronização de estado de tarefas para o dashboard.
- `telemetry_aggregator.js`: agrega dados de telemetria para visualização no dashboard.

## O que não deve ficar aqui

- API REST genérica → `src/server/api/`
- Componentes Vue → `src/dashboard-ui/`

## Entradas principais

| Arquivo                   | Descrição                                    |
| ------------------------- | -------------------------------------------- |
| `task_sync_bridge.js`     | Sincroniza estado de tarefas com o dashboard |
| `telemetry_aggregator.js` | Agrega telemetria para o frontend            |

## Regras de manutenção

- Dados expostos aqui devem ser consistentes com o SSOT do sistema.

## Links relacionados

- Módulo pai: `src/server/`
- Frontend: `src/dashboard-ui/`
- Realtime: `src/server/realtime/`
