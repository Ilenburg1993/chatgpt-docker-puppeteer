# src/dashboard-ui/src/lib

**Propósito**: Utilitários de biblioteca do dashboard — cliente HTTP, guard de comandos e funções auxiliares.  
**Status**: Canônico.  
**Público**: Desenvolvedores frontend.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `http.js`: cliente HTTP para comunicação com a API do backend.
- `command_guard.js`: guard para validação de comandos antes de envio.
- `utils.js`: funções utilitárias gerais do frontend.

## O que não deve ficar aqui

- Composables de lógica Vue → `src/dashboard-ui/src/composables/`
- Stores de estado → `src/dashboard-ui/src/stores/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `http.js` | Cliente HTTP para a API backend |
| `command_guard.js` | Validação de comandos antes de envio |
| `utils.js` | Utilitários gerais do frontend |

## Regras de manutenção

- O cliente HTTP deve centralizar configuração de base URL e headers de autenticação.

## Links relacionados

- Módulo pai: `src/dashboard-ui/src/`
- API backend: `src/server/api/`
