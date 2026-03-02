# analysis/actions-check/

**Propósito**: Resultados de verificação de workflows do GitHub Actions — summaries, SHAs, remote refs e relatórios pós-push gerados durante operações de auditoria de CI/CD.  
**Status**: Histórico.  
**Público**: Mantenedores que auditam o estado dos workflows e Actions.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

Outputs de comandos `gh` e `git ls-remote` coletados durante verificações de integridade dos workflows.

## O que não deve ficar aqui

- Segredos ou tokens de acesso
- Configurações de workflow (ficam em `.github/workflows/`)

## Links relacionados

- Pasta pai: [`analysis/`](../README.md)
- Workflows: [`.github/workflows/`](../../.github/workflows/)
