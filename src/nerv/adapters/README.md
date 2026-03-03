# src/nerv/adapters

**Propósito**: Adaptadores de transporte de alto nível para o barramento NERV.  
**Status**: Canônico.  
**Público**: Mantenedores do NERV e de integrações de transporte.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `high_level_adapter.js`: adaptador de alto nível que abstrai detalhes de transporte para
  consumidores do NERV.

## O que não deve ficar aqui

- Implementações de transporte concretas → `src/nerv/transport/`
- Adaptadores específicos de módulo → `src/driver/nerv_adapter/`, `src/server/nerv_adapter/`

## Entradas principais

| Arquivo                 | Descrição                                |
| ----------------------- | ---------------------------------------- |
| `high_level_adapter.js` | Abstração de alto nível para uso do NERV |

## Regras de manutenção

- Mantenha a API do adaptador estável; alterações afetam todos os consumidores.

## Links relacionados

- Módulo pai: `src/nerv/`
- Transporte: `src/nerv/transport/`
