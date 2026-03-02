# analysis/

**Propósito**: Artefatos de análise, investigação de segurança, auditoria de dependências e relatórios de qualidade do projeto — gerados durante operações de triagem, purga de histórico e diagnóstico.  
**Status**: Artefato de runtime / Histórico.  
**Público**: Mantenedores e agentes de IA que realizam auditorias e diagnósticos.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Relatórios de análise exploratória de bugs
- Gráficos de dependências (`dependency-graph.dot`, `graph.svg`)
- Resultados de verificação de workflows e secrets
- Scripts e backups de operações de manutenção

## O que não deve ficar aqui

- Código-fonte do runtime (vai em `src/`)
- Documentação canônica (vai em `DOCUMENTAÇÃO/`)
- Segredos ou chaves de acesso reais

## Entradas principais

| Arquivo/Pasta | Descrição |
|---|---|
| `actions-check/` | Resultados de verificação de GitHub Actions |
| `backups/` | Backups do repositório (bundles git) |
| `ci-local/` | Resultados de execução local de CI/detecção de secrets |
| `legacy/` | Scripts e artefatos legados de manutenção |
| `notifications/` | Scripts de criação de notificações/issues |
| `rotation-scripts/` | Scripts de rotação de credenciais e secrets |
| `verification_commands/` | Outputs de comandos de verificação pós-operação |
| `exploratory-bug-hunt-*.md` | Relatórios de caça proativa de bugs |

## Regras de manutenção

- Não comitar artefatos sensíveis (tokens, chaves, dados pessoais)
- Artefatos históricos podem ser removidos após revisão e documentação
- Relatórios de bugs devem ser migrados para `DOCUMENTAÇÃO/BUGS/` quando canônicos

## Links relacionados

- Documentação canônica de bugs: [`DOCUMENTAÇÃO/BUGS/`](../DOCUMENTAÇÃO/BUGS/)
- Diagnósticos: [`diagnostics/`](../diagnostics/)
