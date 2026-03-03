# src/nerv/emission

**Propósito**: Publicação de eventos no barramento NERV — emit genérico, com ack, e comandos.  
**Status**: Canônico.  
**Público**: Mantenedores do NERV.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `emission.js`: lógica central de emissão de eventos.
- `emit_ack.js`: emissão com confirmação (ack).
- `emit_command.js`: emissão de comandos direcionados.
- `emit_event.js`: emissão de eventos de domínio.

## O que não deve ficar aqui

- Recepção/subscrição → `src/nerv/reception/`
- Buffers → `src/nerv/buffers/`

## Entradas principais

| Arquivo           | Descrição                              |
| ----------------- | -------------------------------------- |
| `emission.js`     | Lógica central de emissão de eventos   |
| `emit_event.js`   | Emissão de eventos de domínio          |
| `emit_command.js` | Emissão de comandos direcionados       |
| `emit_ack.js`     | Emissão com confirmação de recebimento |

## Regras de manutenção

- Toda emissão deve incluir timestamp e correlationId quando disponível.

## Links relacionados

- Módulo pai: `src/nerv/`
- Recepção: `src/nerv/reception/`
