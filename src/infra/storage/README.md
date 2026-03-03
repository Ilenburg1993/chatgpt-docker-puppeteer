# src/infra/storage

**Propósito**: Armazenamento persistente de artefatos, respostas, DNA e identidade do robô em
sistema de arquivos.  
**Status**: Canônico.  
**Público**: Módulos que produzem ou consomem artefatos de execução.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `artifact_store.js`: armazenamento e recuperação de artefatos de missão.
- `response_store.js` / `response_store_v2.js`: stores de respostas obtidas do LLM.
- `response_adapter.js`: adaptação de respostas para formato canônico.
- `dna_store.js` / `dna_evolution.js`: persistência e evolução do DNA do agente.
- `task_store.js`: store de estado de tarefas em arquivo.
- `robot_identity.json`: identidade persistida do robô.

## O que não deve ficar aqui

- Banco de dados relacional → `src/infra/db/`
- Escrita atômica de arquivos genéricos → `src/infra/fs/`

## Entradas principais

| Arquivo                | Descrição                                      |
| ---------------------- | ---------------------------------------------- |
| `artifact_store.js`    | Armazena artefatos de execução de missões      |
| `response_store_v2.js` | Store canônico de respostas LLM (versão atual) |
| `dna_store.js`         | Persiste o DNA evolutivo do agente             |
| `task_store.js`        | Store de estado de tarefas em arquivo          |
| `robot_identity.json`  | Identidade persistida do robô                  |

## Regras de manutenção

- Use `response_store_v2.js` para novas implementações; `response_store.js` é legado.
- Escritas críticas devem usar `src/infra/fs/atomic_write.js`.

## Links relacionados

- Módulo pai: `src/infra/`
- Banco de dados: `src/infra/db/`
- I/O de arquivo: `src/infra/fs/`
