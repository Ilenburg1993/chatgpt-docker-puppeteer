# .github/agents

**Propósito**: Definições de agentes de IA especializados para uso com GitHub Copilot e ferramentas
compatíveis.  
**Status**: Canônico.  
**Público**: Desenvolvedores usando agentes de IA assistidos.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo            | Descrição                                                                        |
| ------------------ | -------------------------------------------------------------------------------- |
| `audit-agent.json` | Definição do Audit Agent — configuração de ferramentas, contexto e comportamento |

## Regras de manutenção

- Agentes devem referenciar skills de `.github/skills/` quando aplicável.
- Atualizar `audit-agent.json` quando o pipeline de auditoria mudar de interface.

## Links relacionados

- Hub GitHub: `.github/README.md`
- Skills: `.github/skills/`
- Instructions: `.github/instructions/`
