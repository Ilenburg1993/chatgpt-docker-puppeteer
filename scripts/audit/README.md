# scripts/audit

**Propósito**: Pipeline completo de auditoria automatizada — coletores, contratos, triage LLM, reporters e publicação de artefatos.  
**Status**: Canônico.  
**Público**: Mantenedores e o Audit Agent LLM.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Runner principal e módulos do pipeline de auditoria.
- Organizados em subpastas por responsabilidade.

## Entradas principais

| Arquivo/Pasta | Descrição |
|---|---|
| `runner.mjs` | Entry point do pipeline de auditoria |
| `preflight_semantic.mjs` | Preflight semântico (RAG + LSP) |
| `make-skill.js` | Gerador de skills de auditoria |
| `collectors/` | Coletores por categoria (quality, security, runtime, etc.) |
| `contracts/` | Avaliadores de contratos arquiteturais |
| `lib/` | Utilitários internos (logger, exec, schema, git, etc.) |
| `normalize/` | Normalização de findings |
| `reporters/` | Reporters (console, JSON, contratos) |
| `triage/` | Triage e propostas de correção via LLM |
| `publish_json.mjs` / `publish_md.mjs` | Publicação de artefatos |
| `triage_llm.mjs` | Triage via LLM |

## Regras de manutenção

- Executar via `npm run audit:quick` (rápido) ou `npm run audit:nightly` (completo).
- Artefatos publicados em `artifacts/`.

## Links relacionados

- Scripts pai: `scripts/README.md`
- Testes: `tests/unit/audit/`, `tests/integration/audit/`
- Workflow: `.github/workflows/audit-nightly.yml`
