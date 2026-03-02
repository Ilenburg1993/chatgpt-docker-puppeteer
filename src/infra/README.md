# src/infra

**Propósito**: Camada de infraestrutura — gerencia recursos compartilhados como pool de browsers, banco de dados, fila, locks, storage, proxy e transporte.  
**Status**: Canônico.  
**Público**: Módulos do runtime que precisam de recursos de infraestrutura; mantenedores de operações.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Pool de instâncias de Chrome (`browser_pool/`).
- Banco de dados SQLite e repositórios (`db/`).
- Utilitários de sistema de arquivos (`fs/`).
- Cliente e buffer IPC (`ipc/`).
- Gerenciamento de locks de arquivo (`locks/`).
- Serviço de proxy Chrome (`proxy/`).
- Fila de tarefas com scheduler (`queue/`).
- Armazenamento de artefatos e respostas (`storage/`).
- Adaptador de transporte Socket.io (`transport/`).
- Utilitários HTTP, init assíncrono e controle de abort (`*.js` na raiz).

## O que não deve ficar aqui

- Lógica de domínio de tarefas → `src/kernel/`
- Automação de browser → `src/driver/`
- Comunicação com NERV → `src/nerv/`

## Entradas principais

| Arquivo/Pasta | Descrição |
|---|---|
| `browser_pool/` | Pool e monitoramento de instâncias Chrome |
| `db/` | SQLite e repositórios de dados |
| `queue/` | Fila de tarefas, scheduler e cache |
| `storage/` | Artefatos, DNA, respostas e identidade |
| `locks/` | Locks de arquivo para operações críticas |
| `fs/` | Leitura/escrita atômica no sistema de arquivos |
| `proxy/` | Serviço de proxy do Chrome |
| `ipc/` | Buffer e cliente IPC |
| `transport/` | Adaptador Socket.io |
| `ConnectionOrchestrator.js` | Orquestrador de conexões de browser |
| `http_client_utils.js` | Utilitários de cliente HTTP |

## Regras de manutenção

- Recursos de infra devem ser inicializados de forma lazy quando possível.
- Toda operação de I/O crítica deve usar locks de `locks/`.
- Use `fs/atomic_write.js` para escritas que não podem ser corrompidas.

## Links relacionados

- Pool de browsers: `src/infra/browser_pool/`
- Banco de dados: `src/infra/db/`
- Fila: `src/infra/queue/`
- Tipos: `src/types/infra/`
