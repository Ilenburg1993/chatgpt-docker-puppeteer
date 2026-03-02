# src/driver/trackers

**Propósito**: Rastreamento de sessões de página de browser para correlação de eventos e diagnóstico.  
**Status**: Canônico.  
**Público**: Mantenedores do driver e da camada de observabilidade.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `PageSessionTracker.js`: rastreia o estado e o ciclo de vida de sessões de página de browser.

## O que não deve ficar aqui

- Monitoramento de saúde do pool → `src/infra/browser_pool/`
- Telemetria do kernel → `src/kernel/telemetry/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `PageSessionTracker.js` | Rastreia sessões de página para correlação e diagnóstico |

## Regras de manutenção

- Dados de rastreamento devem ser emitidos via NERV para consumidores de telemetria.

## Links relacionados

- Módulo pai: `src/driver/`
- Monitoramento: `src/infra/browser_pool/`
