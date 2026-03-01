# Upgrade Baseline — 2026-02-07

## Ambiente

- Node: `v24.13.0`
- npm: `11.6.2`

## Checks (antes do upgrade)

### `npm test`

- **Status**: ❌ falhou (1 teste)
- Falha em: `tests/integration/driver/test_driver_nerv.spec.js`

### `npm run lint`

- **Status**: ✅ passou

### `npm run format:check`

- **Status**: ❌ falhou
- Motivo: Prettier reporta “Code style issues” em **651 arquivos** (principalmente documentação).

## Nota

Este baseline é registrado para rastreabilidade. O upgrade do dashboard (UI + server) não tem como
objetivo corrigir, nesta etapa, o backlog de formatação global nem falhas de testes não
relacionadas.
