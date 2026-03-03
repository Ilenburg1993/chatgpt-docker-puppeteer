# .github/instructions

**Propósito**: Instruções permanentes para assistentes de IA — baseline canônico e convenções do
repositório aplicadas a todos os arquivos.  
**Status**: Canônico.  
**Público**: Assistentes de IA (Copilot, Claude, etc.) e mantenedores.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo                         | Descrição                                                             |
| ------------------------------- | --------------------------------------------------------------------- |
| `project-canon.instructions.md` | Baseline canônico curto e estável do projeto (aplicado a `**/*`)      |
| `sample.instructions.md`        | Convenções JS/TS (`// @ts-check`, `const`/`let`, validação de params) |

## Regras de manutenção

- Instructions com `applyTo: "**/*"` são aplicadas a todas as sessões de IA.
- Manter concisos — detalhes extensos vão em `DOCUMENTAÇÃO/` ou skills.
- Atualizar `project-canon.instructions.md` quando a arquitetura mudar.

## Links relacionados

- Hub GitHub: `.github/README.md`
- Skills: `.github/skills/`
- Documentação canônica: `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md`
