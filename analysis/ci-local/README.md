# analysis/ci-local/

**Propósito**: Resultados de execução local de ferramentas de CI — baselines de detecção de secrets e contagens de arquivos/commits para auditoria de segurança.  
**Status**: Histórico.  
**Público**: Mantenedores que auditam a segurança do repositório localmente.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

| Arquivo | Descrição |
|---|---|
| `detect-secrets.baseline` | Baseline do detect-secrets (pré-operação) |
| `final-detect-secrets.baseline` | Baseline final após purga |
| `fs_count.txt` | Contagem de arquivos no sistema de arquivos |
| `git_count.txt` | Contagem de objetos no histórico git |

## Links relacionados

- Pasta pai: [`analysis/`](../README.md)
