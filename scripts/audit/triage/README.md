# scripts/audit/triage

**Propósito**: Triage e propostas de correção via LLM — análise de causa raiz, sugestão de patches e planejamento de testes.  
**Status**: Canônico.  
**Público**: Desenvolvedores do Audit Agent e mantenedores.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `proposal_engine_v3.mjs` | Motor de propostas de correção v3 |
| `root_cause_ranker.mjs` | Ranqueamento de causas raiz |
| `patch_suggester.mjs` | Sugestor de patches cirúrgicos |
| `diff_builder.mjs` | Construtor de diffs para propostas |
| `context_pack.mjs` | Empacotador de contexto para LLM |
| `confidence_model.mjs` | Modelo de confiança de proposals |
| `test_planner.mjs` | Planejador de testes para correções propostas |

## Links relacionados

- Pipeline pai: `scripts/audit/README.md`
- Testes unitários: `tests/unit/audit/test_proposal_engine_contract_diff.spec.js`
