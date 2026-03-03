# src/infra/locks

**Propósito**: Gerenciamento de locks de arquivo para operações críticas que exigem exclusão
mútua.  
**Status**: Canônico.  
**Público**: Módulos que fazem operações de I/O concorrentes.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `lock_manager.js`: gerenciamento centralizado de locks de arquivo.
- `process_guard.js`: proteção de processos contra execuções concorrentes.
- `resilient_lock.js`: lock com retry e timeout configurável.

## O que não deve ficar aqui

- Locks de banco de dados → `src/infra/db/`
- Escrita atômica → `src/infra/fs/atomic_write.js`

## Entradas principais

| Arquivo             | Descrição                                        |
| ------------------- | ------------------------------------------------ |
| `lock_manager.js`   | Gerencia aquisição e liberação de locks          |
| `resilient_lock.js` | Lock com retry automático e timeout              |
| `process_guard.js`  | Proteção contra execução concorrente de processo |

## Regras de manutenção

- Sempre libere locks em bloco `finally` para evitar deadlocks.
- Configure timeouts de lock via `config.json`.

## Links relacionados

- Módulo pai: `src/infra/`
- I/O de arquivo: `src/infra/fs/`
