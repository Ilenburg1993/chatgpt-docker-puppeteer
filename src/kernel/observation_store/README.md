# src/kernel/observation_store

**Propósito**: Store de observações e fatos do sistema — registra eventos e estados observados para suportar decisões do policy engine.  
**Status**: Canônico.  
**Público**: Mantenedores do kernel e do motor de políticas.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `observation_store.js`: registro e consulta de observações/fatos do sistema em memória.

## O que não deve ficar aqui

- Persistência de longo prazo → `src/infra/db/`
- Motor de políticas → `src/kernel/policy_engine/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `observation_store.js` | Registro de fatos e observações para o policy engine |

## Regras de manutenção

- O store é em memória; não persista dados críticos apenas aqui.
- Observações devem ser tipadas e documentadas com JSDoc.

## Links relacionados

- Módulo pai: `src/kernel/`
- Motor de políticas: `src/kernel/policy_engine/`
