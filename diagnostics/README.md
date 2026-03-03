# diagnostics/

**Propósito**: Relatórios e artefatos de diagnóstico do sistema — análise de bindings, reports de
saúde e outputs de ferramentas de diagnóstico do runtime.  
**Status**: Artefato de runtime.  
**Público**: Desenvolvedores e agentes de IA que investigam problemas operacionais.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

| Arquivo                    | Descrição                                             |
| -------------------------- | ----------------------------------------------------- |
| `bindings_report.txt`      | Relatório de análise de bindings do sistema           |
| `fix-bindings-report.json` | Report estruturado de correções de bindings aplicadas |

## O que não deve ficar aqui

- Código-fonte (vai em `src/`)
- Documentação canônica (vai em `DOCUMENTAÇÃO/`)
- Logs de runtime (vão em `logs/`)

## Regras de manutenção

- Artefatos gerados automaticamente podem ser sobrescritos a qualquer momento
- Use `npm run diagnose` para regenerar os relatórios de diagnóstico

## Links relacionados

- Script de diagnóstico: [`diagnostic-full.mjs`](../diagnostic-full.mjs)
- Logs: [`logs/`](../logs/)
- Análises: [`analysis/`](../analysis/)
