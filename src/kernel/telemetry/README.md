# src/kernel/telemetry

**Propósito**: Telemetria do kernel — coleta e expõe métricas de desempenho e saúde do loop de
controle.  
**Status**: Canônico.  
**Público**: Mantenedores de observabilidade e SRE.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `kernel_telemetry.js`: coleta métricas do kernel (latência do loop, taxa de execução, erros).

## O que não deve ficar aqui

- Telemetria NERV → `src/nerv/telemetry/`
- Telemetria IPC compartilhada → `src/shared/telemetry/`

## Entradas principais

| Arquivo               | Descrição                                           |
| --------------------- | --------------------------------------------------- |
| `kernel_telemetry.js` | Métricas e telemetria do loop de controle do kernel |

## Regras de manutenção

- Métricas devem ser emitidas via NERV para consumidores de observabilidade.

## Links relacionados

- Módulo pai: `src/kernel/`
- Telemetria NERV: `src/nerv/telemetry/`
