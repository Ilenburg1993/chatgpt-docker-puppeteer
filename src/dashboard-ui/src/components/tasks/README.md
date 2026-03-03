# src/dashboard-ui/src/components/tasks

**Propósito**: Componentes de gestão de tarefas do dashboard — listagem, detalhes, formulário e
filtros.  
**Status**: Canônico.  
**Público**: Desenvolvedores frontend.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `TaskList.vue`: lista de tarefas com paginação.
- `TaskCard.vue`: card resumido de tarefa.
- `TaskDetail.vue`: detalhes completos de uma tarefa.
- `TaskForm.vue`: formulário de criação/edição de tarefa.
- `TaskFilters.vue`: filtros de busca e ordenação de tarefas.

## O que não deve ficar aqui

- Views de página completas → `src/dashboard-ui/src/views/`
- Lógica de API → `src/dashboard-ui/src/lib/http.js`

## Entradas principais

| Arquivo           | Descrição                    |
| ----------------- | ---------------------------- |
| `TaskList.vue`    | Lista de tarefas             |
| `TaskCard.vue`    | Card de tarefa individual    |
| `TaskDetail.vue`  | Detalhes completos de tarefa |
| `TaskForm.vue`    | Formulário de criação/edição |
| `TaskFilters.vue` | Filtros e busca de tarefas   |

## Links relacionados

- Módulo pai: `src/dashboard-ui/src/components/`
- Store de tarefas: `src/dashboard-ui/src/stores/tasks.js`
