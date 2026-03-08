# scripts/ci

**Propósito**: Scripts de CI — verificação de versão Node.js, execução de suítes e validação de
workflows GitHub.  
**Status**: Canônico.  
**Público**: Engenheiros de CI/CD e mantenedores.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo                        | Descrição                                     |
| ------------------------------ | --------------------------------------------- |
| `check-node-version.mjs`       | Garante que Node.js >= 24 está em uso         |
| `run-ci-suite.mjs`             | Executa a suíte completa de CI localmente     |
| `validate-workflows.mjs`       | Valida estrutura dos workflows GitHub Actions |
| `verify-github-workflows.mjs`  | Verifica integridade e sintaxe dos workflows  |
| `verify-skills-governance.mjs` | Verifica governanca das skills e do canon     |

## Regras de manutenção

- Usar `npm run check:workflows` para validar localmente.
- `actionlint` também pode ser usado diretamente nos `.yml`.
- Para o contrato canônico do gate de tipagem/JSDoc, consultar
  `DOCUMENTAÇÃO/REFERENCIA/TYPING_JSDOC_CANON.md`.

## Links relacionados

- Scripts pai: `scripts/README.md`
- Workflows: `.github/workflows/`
- Documentação CI/CD: `DOCUMENTAÇÃO/CI_CD/`
- Indice de automacao de tipagem/JSDoc: `DOCUMENTAÇÃO/REFERENCIA/TYPING_AUTOMATION_INDEX.md`
