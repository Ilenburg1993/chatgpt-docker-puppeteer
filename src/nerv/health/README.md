# src/nerv/health

**Propósito**: Verificação de saúde do barramento NERV — monitora disponibilidade e integridade do
sistema de eventos.  
**Status**: Canônico.  
**Público**: Mantenedores do NERV e operadores de SRE.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `health.js`: lógica de health check do barramento NERV.

## O que não deve ficar aqui

- Telemetria de métricas → `src/nerv/telemetry/`
- Saúde do pool de browsers → `src/infra/browser_pool/`

## Entradas principais

| Arquivo     | Descrição                               |
| ----------- | --------------------------------------- |
| `health.js` | Verificação de saúde do barramento NERV |

## Regras de manutenção

- Health check deve ser leve e não bloquear o barramento.

## Links relacionados

- Módulo pai: `src/nerv/`
- Telemetria: `src/nerv/telemetry/`
