# CI/CD

**Propósito**: Documentação dos pipelines de integração e entrega contínua do projeto — workflows do
GitHub Actions, configuração do Copilot e guias operacionais de CI/CD.  
**Status**: Canônico.  
**Público**: Desenvolvedores, mantenedores e agentes de IA que trabalham com automação de CI/CD.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Documentação de workflows do GitHub Actions
- Configuração e instruções do Copilot (setup steps)
- Guias de operação e troubleshooting de pipelines

## O que não deve ficar aqui

- Arquivos de configuração de workflow (ficam em `.github/workflows/`)
- Logs de execução de CI (ficam em `logs/` ou artefatos do GitHub Actions)
- Credenciais ou segredos

## Entradas principais

| Arquivo                  | Descrição                                           |
| ------------------------ | --------------------------------------------------- |
| `COPILOT_SETUP_STEPS.md` | Passos de configuração do GitHub Copilot no projeto |

## Regras de manutenção

- Mantenha a documentação sincronizada com os workflows em `.github/workflows/`
- Documente mudanças significativas de pipeline nesta pasta
- Use linguagem clara sobre pré-requisitos e dependências de CI/CD

## Links relacionados

- Workflows: [`.github/workflows/`](../../.github/workflows/)
- Hub de documentação: [`DOCUMENTAÇÃO/`](../)
- Relatório de status: [`DOCUMENTAÇÃO/RELATORIOS/`](../RELATORIOS/)
