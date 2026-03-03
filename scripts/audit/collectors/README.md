# scripts/audit/collectors

**Propósito**: Coletores de evidências por categoria para o pipeline de auditoria.  
**Status**: Canônico.  
**Público**: Mantenedores do sistema de auditoria.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo            | Descrição                                                |
| ------------------ | -------------------------------------------------------- |
| `architecture.mjs` | Coleta evidências de conformidade arquitetural           |
| `performance.mjs`  | Coleta métricas de performance                           |
| `quality.mjs`      | Coleta dados de qualidade (lint, format, JSDoc)          |
| `runtime.mjs`      | Coleta evidências de comportamento de runtime            |
| `security.mjs`     | Coleta evidências de segurança                           |
| `static.mjs`       | Análise estática (dependências, circular, magic strings) |
| `tests.mjs`        | Coleta resultados de testes                              |

## Links relacionados

- Pipeline pai: `scripts/audit/README.md`
- Testes: `tests/unit/audit/`
