# src/driver/nerv_adapter

**Propósito**: Bridge entre o driver de browser e o barramento de eventos NERV — publica e consome
eventos de automação.  
**Status**: Canônico.  
**Público**: Mantenedores do driver e da integração com NERV.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `driver_nerv_adapter.js`: adaptador que conecta o driver ao NERV, emitindo eventos de ciclo de
  vida e recebendo comandos.

## O que não deve ficar aqui

- Lógica de automação → `src/driver/modules/`
- Adaptador NERV do servidor → `src/server/nerv_adapter/`

## Entradas principais

| Arquivo                  | Descrição                                    |
| ------------------------ | -------------------------------------------- |
| `driver_nerv_adapter.js` | Bridge driver ↔ NERV para eventos e comandos |

## Regras de manutenção

- Toda ação significativa do driver deve emitir evento NERV correspondente.
- Não inclua lógica de automação neste adaptador; delegue para `modules/`.

## Links relacionados

- Módulo pai: `src/driver/`
- Barramento NERV: `src/nerv/`
