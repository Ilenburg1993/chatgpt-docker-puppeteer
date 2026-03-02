# scripts/env

**Propósito**: Scripts de auditoria, validação e verificação de variáveis de ambiente e bindings do sistema.  
**Status**: Canônico.  
**Público**: Desenvolvedores e DevOps.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `audit-env-surface.mjs` | Audita todas as variáveis de ambiente usadas no projeto |
| `check-env.mjs` | Verifica presença e validade de variáveis obrigatórias |
| `check-env-local.mjs` | Verifica env local (`.env`) |
| `check-bindings.sh` / `check-all-bindings.sh` | Verifica bindings de rede e portas |
| `pre-flight-check.mjs` | Checklist pré-voo antes de iniciar o sistema |
| `validate-env.js` | Valida valores de variáveis de ambiente |
| `verify-chrome-config-consistency.js` | Verifica consistência da config do Chrome |

## Regras de manutenção

- Referenciar `.env.example` ao adicionar novas variáveis obrigatórias.

## Links relacionados

- Scripts pai: `scripts/README.md`
- Skill de env: `.github/skills/env-governance/`
