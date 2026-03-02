# src/dashboard-ui/src/stores

**Propósito**: Stores Pinia de estado global do dashboard — tarefas, missões, eventos, sistema e telemetria.  
**Status**: Canônico.  
**Público**: Desenvolvedores frontend.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `tasks.js`: store de tarefas (legado).
- `tasks_vnext.js`: store de tarefas (versão nova).
- `missions_vnext.js`: store de missões.
- `events_vnext.js`: store de eventos do sistema.
- `system.js`: store de estado do sistema.
- `telemetry.js`: store de telemetria e métricas.

## O que não deve ficar aqui

- Lógica de componente local → dentro do próprio `.vue`
- Chamadas HTTP diretas → `src/dashboard-ui/src/lib/http.js`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `tasks_vnext.js` | Store canônico de tarefas (versão atual) |
| `missions_vnext.js` | Store de missões |
| `events_vnext.js` | Store de eventos do sistema |
| `system.js` | Store de estado geral do sistema |
| `telemetry.js` | Store de telemetria e métricas |

## Regras de manutenção

- Use `tasks_vnext.js` para novas implementações; `tasks.js` é legado.
- Stores devem usar `defineStore` do Pinia com Composition API.

## Links relacionados

- Módulo pai: `src/dashboard-ui/src/`
- Composables: `src/dashboard-ui/src/composables/`
