# src/server/realtime/telemetry

**Propósito**: Telemetria de hardware em tempo real para o dashboard — CPU, memória e métricas do
sistema.  
**Status**: Canônico.  
**Público**: Mantenedores do dashboard e operadores de SRE.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `hardware.js`: coleta e streaming de métricas de hardware (CPU, memória, disco) em tempo real.

## O que não deve ficar aqui

- Telemetria do kernel → `src/kernel/telemetry/`
- Telemetria NERV → `src/nerv/telemetry/`

## Entradas principais

| Arquivo       | Descrição                                          |
| ------------- | -------------------------------------------------- |
| `hardware.js` | Streaming de métricas de hardware para o dashboard |

## Regras de manutenção

- Envie métricas em intervalos configuráveis; não por evento para evitar flooding.

## Links relacionados

- Módulo pai: `src/server/realtime/`
- Hardware do sistema: `src/core/hardware.js`
