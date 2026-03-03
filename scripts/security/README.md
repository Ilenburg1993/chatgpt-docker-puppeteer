# scripts/security

**Propósito**: Scripts de segurança — gate de auditoria npm para bloquear dependências vulneráveis
em CI.  
**Status**: Canônico.  
**Público**: Engenheiros de CI/CD e segurança.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo              | Descrição                                                                 |
| -------------------- | ------------------------------------------------------------------------- |
| `npm-audit-gate.mjs` | Executa `npm audit` e falha se houver vulnerabilidades acima do threshold |

## Regras de manutenção

- Executado no workflow `.github/workflows/security.yml`.
- Threshold configurável para severidade mínima de bloqueio.

## Links relacionados

- Scripts pai: `scripts/README.md`
- Workflow de segurança: `.github/workflows/security.yml`
- Skill de segurança: `.github/skills/security-checklist/`
