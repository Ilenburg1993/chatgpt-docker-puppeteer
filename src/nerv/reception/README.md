# src/nerv/reception

**Propósito**: Recepção e subscrição de eventos do barramento NERV — handlers de entrada de eventos.  
**Status**: Canônico.  
**Público**: Mantenedores do NERV.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `reception.js`: lógica central de recepção e roteamento de eventos.
- `receive.js`: recepção individual de eventos e despacho para handlers.

## O que não deve ficar aqui

- Emissão de eventos → `src/nerv/emission/`
- Adaptadores de módulo específico → bridges em `src/*/nerv_adapter/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `reception.js` | Lógica central de recepção e roteamento |
| `receive.js` | Recepção e despacho de eventos individuais |

## Regras de manutenção

- Handlers de recepção devem ser assíncronos e não bloquear o barramento.

## Links relacionados

- Módulo pai: `src/nerv/`
- Emissão: `src/nerv/emission/`
