# src/nerv/buffers

**Propósito**: Buffers, backpressure e filas de eventos do barramento NERV — gerencia o fluxo de eventos em condições de alta carga.  
**Status**: Canônico.  
**Público**: Mantenedores do NERV.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `buffers.js`: implementação de ring buffers para eventos.
- `backpressure.js`: controle de backpressure para fluxo de eventos.
- `inbound_queue.js`: fila de entrada de eventos recebidos.
- `outbound_queue.js`: fila de saída de eventos a emitir.

## O que não deve ficar aqui

- Transporte de rede → `src/nerv/transport/`
- Emissão de eventos → `src/nerv/emission/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `buffers.js` | Ring buffers para eventos do NERV |
| `backpressure.js` | Controle de backpressure |
| `inbound_queue.js` | Fila de entrada de eventos |
| `outbound_queue.js` | Fila de saída de eventos |

## Regras de manutenção

- Configure limites de fila via `config.json` para evitar OOM em alta carga.

## Links relacionados

- Módulo pai: `src/nerv/`
