# data/

**Propósito**: Banco de dados e dados persistentes do runtime — armazena o estado do orquestrador de missões (Maestro) em SQLite.  
**Status**: Artefato de runtime.  
**Público**: Sistema de runtime (uso interno). Desenvolvedores que inspecionam estado do sistema.  
**Última atualização**: 2 de março de 2026.

## ⚠️ Não comitar o conteúdo desta pasta

O banco de dados SQLite contém estado de runtime e **não deve ser commitado** ao repositório.

## O que esta pasta contém

| Arquivo | Descrição |
|---|---|
| `maestro.sqlite` | Banco de dados SQLite do orquestrador Maestro |

## Regras de manutenção

- Backups do banco devem ser feitos externamente quando necessário
- Use `sqlite3 data/maestro.sqlite` para inspeção direta
- Não versionem arquivos `.sqlite` — adicione ao `.gitignore`

## Links relacionados

- Orquestrador: [`src/orchestrator/`](../src/orchestrator/)
- Infra de storage: [`src/infra/storage/`](../src/infra/storage/)
