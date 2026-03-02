# src/server/watchers

**Propósito**: Watchers de sistema de arquivos e logs — monitoram mudanças em tempo real para atualização do servidor.  
**Status**: Canônico.  
**Público**: Mantenedores do servidor e do dashboard.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `fs_watcher.js`: watcher de mudanças em arquivos do sistema (ex.: fila, controle).
- `log_watcher.js`: watcher de novos logs para streaming ao dashboard.

## O que não deve ficar aqui

- Streaming de logs ao cliente → `src/server/realtime/streams/`
- Watcher de controle de tarefas → `src/agent/task_control_watcher.js`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `fs_watcher.js` | Monitora mudanças em arquivos do sistema |
| `log_watcher.js` | Observa novos logs para streaming |

## Regras de manutenção

- Watchers devem debounce mudanças rápidas para evitar eventos duplicados.

## Links relacionados

- Módulo pai: `src/server/`
- Streams: `src/server/realtime/streams/`
