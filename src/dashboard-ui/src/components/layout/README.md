# src/dashboard-ui/src/components/layout

**Propósito**: Componentes estruturais do layout da aplicação — header, sidebar, footer e estrutura principal.  
**Status**: Canônico.  
**Público**: Desenvolvedores frontend.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `AppLayout.vue`: layout principal da aplicação (wrapper de views).
- `Header.vue`: cabeçalho do dashboard com navegação e ações globais.
- `Sidebar.vue`: barra lateral de navegação.
- `Footer.vue`: rodapé da aplicação.

## O que não deve ficar aqui

- Views de conteúdo → `src/dashboard-ui/src/views/`
- Componentes de UI genéricos → `src/dashboard-ui/src/components/ui/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `AppLayout.vue` | Layout principal (wrapper de todas as views) |
| `Header.vue` | Cabeçalho com navegação global |
| `Sidebar.vue` | Barra lateral de navegação |
| `Footer.vue` | Rodapé da aplicação |

## Links relacionados

- Módulo pai: `src/dashboard-ui/src/components/`
- Router: `src/dashboard-ui/src/router/`
