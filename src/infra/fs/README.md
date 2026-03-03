# src/infra/fs

**Propósito**: Utilitários de sistema de arquivos — leitura segura, escrita atômica, caminhos
canônicos e store de controle.  
**Status**: Canônico.  
**Público**: Módulos que precisam de I/O de arquivo resiliente.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `atomic_write.js`: escrita atômica para evitar corrupção de arquivos.
- `control_store.js`: leitura e escrita do arquivo de controle da aplicação.
- `fs_core.js`: operações centrais de sistema de arquivos.
- `fs_utils.js`: utilitários auxiliares de I/O.
- `paths.js`: caminhos canônicos do sistema.
- `safe_read.js`: leitura com tratamento de erros e fallback.

## O que não deve ficar aqui

- Banco de dados relacional → `src/infra/db/`
- Storage de artefatos → `src/infra/storage/`

## Entradas principais

| Arquivo            | Descrição                                  |
| ------------------ | ------------------------------------------ |
| `atomic_write.js`  | Escrita atômica de arquivos                |
| `control_store.js` | Acesso ao `controle.json` da aplicação     |
| `paths.js`         | Caminhos canônicos centralizados           |
| `safe_read.js`     | Leitura resiliente com tratamento de erros |

## Regras de manutenção

- Use `atomic_write.js` para toda escrita crítica que não pode ser corrompida.
- Não hardcode caminhos; use `paths.js`.

## Links relacionados

- Módulo pai: `src/infra/`
- Locks: `src/infra/locks/`
