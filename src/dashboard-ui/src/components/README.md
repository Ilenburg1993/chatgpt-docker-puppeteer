# src/dashboard-ui/src/components

**Propósito**: Componentes Vue reutilizáveis do dashboard, organizados por categoria funcional.  
**Status**: Canônico.  
**Público**: Desenvolvedores frontend.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `auth/`: componentes de autenticação (login modal).
- `charts/`: gráficos e visualizações (bar, gauge, line).
- `graphs/`: grafos de dependência/correlação.
- `layout/`: estrutura da aplicação (header, sidebar, footer).
- `tasks/`: componentes de gestão de tarefas.
- `ui/`: componentes de UI genéricos (button, card, modal, badge).
- `HelloWorld.vue`: componente de exemplo (pode ser removido).

## O que não deve ficar aqui

- Views de página completas → `src/dashboard-ui/src/views/`
- Lógica de estado global → `src/dashboard-ui/src/stores/`

## Entradas principais

| Pasta | Descrição |
|---|---|
| `layout/` | Componentes estruturais da aplicação |
| `tasks/` | Componentes de gestão de tarefas |
| `charts/` | Componentes de gráficos e métricas |
| `ui/` | Componentes de UI genéricos reutilizáveis |
| `auth/` | Componentes de autenticação |
| `graphs/` | Visualizações de grafo |

## Regras de manutenção

- Componentes devem usar `<script setup>` com Composition API.
- Estilos devem ser escopados com `<style scoped>`.

## Links relacionados

- Módulo pai: `src/dashboard-ui/src/`
- Views: `src/dashboard-ui/src/views/`
