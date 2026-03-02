# tools/bin

**Propósito**: Binários auxiliares de terceiros usados em scripts de segurança e CI.  
**Status**: Canônico de apoio.  
**Público**: Engenheiros de CI/CD e segurança.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `gitleaks` | Binário gitleaks para detecção de secrets em repositórios |

## Regras de manutenção

- Binários devem ser versionados e verificados por hash.
- Não incluir binários de runtime do produto aqui — apenas ferramentas de desenvolvimento.
- Atualizar junto com o workflow de `docker-security-scan.yml`.

## Links relacionados

- Ferramentas pai: `tools/README.md`
- Workflow de segurança: `.github/workflows/docker-security-scan.yml`
