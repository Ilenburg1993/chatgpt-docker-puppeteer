# src/dashboard-ui/src

**Propósito**: Código-fonte do frontend Vue/Vite do dashboard — componentes, views, stores, router,
composables e assets.  
**Status**: Canônico.  
**Público**: Desenvolvedores frontend e mantenedores do dashboard.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Componente raiz e entrada (`App.vue`, `main.js`).
- Assets estáticos (ícones, estilos) (`assets/`).
- Componentes Vue por categoria (`components/`).
- Composables de lógica reutilizável (`composables/`).
- Utilitários de biblioteca (`lib/`).
- Router de navegação (`router/`).
- Stores Pinia de estado (`stores/`).
- Views de página (`views/`).

## O que não deve ficar aqui

- API do backend → `src/server/`
- Dados de runtime → `src/infra/`

## Entradas principais

| Arquivo/Pasta  | Descrição                               |
| -------------- | --------------------------------------- |
| `main.js`      | Entrada da aplicação Vue                |
| `App.vue`      | Componente raiz                         |
| `components/`  | Componentes reutilizáveis por categoria |
| `views/`       | Views de página (roteadas)              |
| `stores/`      | Estado global via Pinia                 |
| `router/`      | Configuração de rotas Vue Router        |
| `composables/` | Lógica reutilizável com Composition API |
| `assets/`      | Assets estáticos e estilos              |
| `lib/`         | Utilitários e cliente HTTP              |

## Regras de manutenção

- Siga o padrão de Composition API com `<script setup>`.
- Estado global fica em `stores/`; estado local fica no componente.

## Links relacionados

- Módulo pai: `src/dashboard-ui/`
- API backend: `src/server/`
- Realtime: `src/server/realtime/`
