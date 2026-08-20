# .github/workflows

**Propósito**: Workflows GitHub Actions — CI, qualidade de código, segurança, cobertura, auditoria
noturna e publicação de releases.  
**Status**: Canônico.  
**Público**: Engenheiros de CI/CD e mantenedores.  
**Última atualização**: 14 de junho de 2026.

## Entradas principais

| Arquivo                    | Descrição                                              |
| -------------------------- | ------------------------------------------------------ |
| `ci.yml`                   | Validação de runtime/workflows e canário Copilot IO L2 |
| `code-quality.yml`         | Análise de qualidade de código                         |
| `coverage.yml`             | Relatório de cobertura de testes                       |
| `audit-nightly.yml`        | Auditoria profunda noturna                             |
| `security.yml`             | Gate de segurança (npm audit, secrets scan)            |
| `docker-security-scan.yml` | Scan de segurança da imagem Docker                     |
| `dependency-review.yml`    | Revisão de dependências em PRs                         |
| `dependency-hygiene.yml`   | Higiene de dependências (desatualizadas, vulneráveis)  |
| `dashboard-build.yml`      | Build do dashboard frontend                            |
| `release.yml`              | Pipeline de publicação de releases                     |
| `scorecard.yml`            | OpenSSF Scorecard                                      |
| `semantic-analysis.yml`    | Análise semântica do código                            |
| `jsdoc-typing.yml`         | Validação de cobertura JSDoc                           |
| `stale.yml`                | Fechamento automático de issues/PRs stale              |
| `copilot-setup-steps.yml`  | Setup do ambiente Copilot                              |

## Regras de manutenção

- Validar com `actionlint` antes de commitar: `actionlint .github/workflows/*.yml`.
- Ou usar `npm run check:workflows`.

## Links relacionados

- Hub GitHub: `.github/README.md`
- Scripts CI: `scripts/ci/`
- Documentação CI/CD: `DOCUMENTAÇÃO/CI_CD/`
