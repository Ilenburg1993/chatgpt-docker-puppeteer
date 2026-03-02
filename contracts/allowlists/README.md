# contracts/allowlists

**Propósito**: Allowlists de exceções para regras de contratos arquiteturais — casos explicitamente permitidos fora do padrão.  
**Status**: Canônico.  
**Público**: Mantenedores e Audit Agent.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `static_allowlist.json` | Exceções permitidas para análise estática (magic strings, imports, etc.) |

## Regras de manutenção

- Cada entrada deve ter um campo `reason` explicando o motivo da exceção.
- Revisar allowlists a cada release — remover exceções resolvidas.
- Nunca usar allowlist para encobrir bugs — apenas para falsos positivos confirmados.

## Links relacionados

- Contratos pai: `contracts/README.md`
- Avaliadores: `scripts/audit/contracts/`
