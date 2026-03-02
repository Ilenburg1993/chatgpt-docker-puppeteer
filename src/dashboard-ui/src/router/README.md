# src/dashboard-ui/src/router

**Propósito**: Configuração de rotas Vue Router do dashboard — mapeamento de URLs para views.  
**Status**: Canônico.  
**Público**: Desenvolvedores frontend.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `index.js`: configuração e instância do Vue Router com todas as rotas do dashboard.

## O que não deve ficar aqui

- Views de página → `src/dashboard-ui/src/views/`
- Guards de autenticação HTTP → `src/dashboard-ui/src/lib/command_guard.js`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `index.js` | Configuração do Vue Router com rotas e guards |

## Regras de manutenção

- Rotas protegidas devem usar navigation guards com verificação de autenticação.
- Use lazy loading (`() => import(...)`) para views não críticas.

## Links relacionados

- Módulo pai: `src/dashboard-ui/src/`
- Views: `src/dashboard-ui/src/views/`
