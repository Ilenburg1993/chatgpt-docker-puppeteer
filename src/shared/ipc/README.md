# src/shared/ipc

**Propósito**: Contratos compartilhados de IPC — envelopes, schemas, constantes e utilitários usados
por múltiplos módulos.  
**Status**: Canônico de apoio.  
**Público**: Módulos que se comunicam via IPC (infra, server, shared).  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `constants.js`: constantes compartilhadas de IPC.
- `envelope.js`: formato canônico de envelope de mensagem IPC.
- `envelope_reader.js`: leitor e validador de envelopes IPC.
- `schemas.js`: schemas Zod para mensagens IPC.
- `utils.js`: utilitários de serialização e parsing IPC.

## O que não deve ficar aqui

- Buffer IPC de infra → `src/infra/ipc/buffer.js`
- Bridge PM2 → `src/server/realtime/bus/pm2_bridge.js`

## Entradas principais

| Arquivo              | Descrição                                    |
| -------------------- | -------------------------------------------- |
| `envelope.js`        | Formato canônico de envelope de mensagem IPC |
| `schemas.js`         | Schemas Zod para validação de mensagens IPC  |
| `constants.js`       | Constantes compartilhadas de IPC             |
| `envelope_reader.js` | Leitor e validador de envelopes IPC          |
| `utils.js`           | Utilitários de serialização IPC              |

## Regras de manutenção

- Toda mensagem IPC deve seguir o formato de `envelope.js`.
- Mudanças no envelope requerem atualização de todos os consumidores.

## Links relacionados

- Módulo pai: `src/shared/`
- Buffer IPC: `src/infra/ipc/`
