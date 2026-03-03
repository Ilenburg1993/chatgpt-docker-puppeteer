# scripts/analysis

**Propósito**: Scripts de análise estática do código — grafo de dependências, variáveis, strings
mágicas e cobertura JSDoc.  
**Status**: Canônico de apoio.  
**Público**: Mantenedores e ferramentas de CI de qualidade.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Ferramentas de análise de código sem modificação do source.

## Entradas principais

| Arquivo                                      | Descrição                                 |
| -------------------------------------------- | ----------------------------------------- |
| `analyze-code-graph.js`                      | Gera grafo de dependências do código      |
| `analyze-variables.mjs`                      | Analisa uso de variáveis no projeto       |
| `audit-dependencies.js`                      | Audita dependências npm                   |
| `audit-tmp-scripts.js`                       | Identifica scripts temporários esquecidos |
| `jsdoc_coverage_cli.mjs`                     | CLI de cobertura JSDoc                    |
| `jsdoc_coverage_engine.mjs`                  | Engine de análise de cobertura JSDoc      |
| `jsdoc_backfill_missing_exports.mjs`         | Identifica exports sem JSDoc              |
| `typing/typing_hardening_audit.mjs`          | Auditoria agregada de tipagem e contratos |
| `typing/strict_lane_audit.mjs`               | Auditoria de cobertura das lanes strict   |
| `typing/tsserver_contract_audit.mjs`         | Verifica drift do wrapper local LSP       |
| `scan_magic_strings.js`                      | Detecta strings mágicas no código         |
| `scan_literals.js` / `scan_literals_deep.js` | Scanner de literais                       |

## Regras de manutenção

- Scripts devem ser somente leitura — não modificar source.
- Usar `npm run jsdoc:coverage` para executar análise de JSDoc.
- Para a superficie canônica de automação de tipagem/JSDoc, consultar
  `DOCUMENTAÇÃO/REFERENCIA/TYPING_AUTOMATION_INDEX.md`.

## Links relacionados

- Scripts pai: `scripts/README.md`
- Análise circular: `npm run analyze:deps`
- Canon de tipagem/JSDoc: `DOCUMENTAÇÃO/REFERENCIA/TYPING_JSDOC_CANON.md`
