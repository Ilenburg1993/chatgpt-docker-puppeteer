# analysis/backups/

**Propósito**: Backups do repositório em formato bundle git — criados antes de operações críticas de purga de histórico ou modificações irreversíveis.  
**Status**: Histórico.  
**Público**: Mantenedores que precisam restaurar estado anterior do repositório.  
**Última atualização**: 2 de março de 2026.

## ⚠️ Arquivos grandes — não comitar sem necessidade

Os bundles git podem ser muito grandes. Verifique o `.gitignore` antes de comitar.

## O que esta pasta contém

| Arquivo | Descrição |
|---|---|
| `repo-backup-*.bundle` | Backup completo do repositório em formato git bundle |
| `repo-before-final-purge.bundle` | Backup pré-purga de histórico |
| `repo-refs.txt` | Lista de refs do repositório no momento do backup |

## Links relacionados

- Pasta pai: [`analysis/`](../README.md)
