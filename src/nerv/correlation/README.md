# src/nerv/correlation

**Propósito**: Correlação e rastreamento de eventos do NERV — permite rastrear fluxos de eventos
relacionados através de IDs de correlação.  
**Status**: Canônico.  
**Público**: Mantenedores de observabilidade e do NERV.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `correlation_context.js`: contexto de correlação para propagação de IDs em fluxos de eventos.
- `correlation_store.js`: store em memória de correlações ativas.

## O que não deve ficar aqui

- Telemetria de métricas → `src/nerv/telemetry/`
- Rastreamento de sessões de browser → `src/driver/trackers/`

## Entradas principais

| Arquivo                  | Descrição                                          |
| ------------------------ | -------------------------------------------------- |
| `correlation_context.js` | Contexto de correlação para rastreamento de fluxos |
| `correlation_store.js`   | Store de correlações ativas                        |

## Regras de manutenção

- IDs de correlação devem ser propagados em todos os eventos de um fluxo relacionado.

## Links relacionados

- Módulo pai: `src/nerv/`
- Telemetria: `src/nerv/telemetry/`
