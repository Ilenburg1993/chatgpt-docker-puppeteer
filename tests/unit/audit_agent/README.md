# tests/unit/audit_agent

**Propósito**: Testes unitários do Audit Agent — runtime, contratos, jobs, contexto e triage LLM.  
**Status**: Canônico.  
**Público**: Desenvolvedores do módulo `src/audit_agent/`.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo                                    | Descrição                         |
| ------------------------------------------ | --------------------------------- |
| `test_audit_agent_contracts.spec.js`       | Contratos do audit agent          |
| `test_audit_agent_runtime.spec.js`         | Runtime do audit agent            |
| `test_audit_agent_server.spec.js`          | Servidor do audit agent           |
| `test_audit_job_repo_and_db_store.spec.js` | Repositório de jobs e store de DB |
| `test_context_builder.spec.js`             | Construtor de contexto para LLM   |
| `test_patch_author_llm.spec.js`            | Autoria de patches via LLM        |
| `test_triage_llm.spec.js`                  | Triage de findings via LLM        |

## Links relacionados

- Hub unitário: `tests/unit/README.md`
- Módulo: `src/audit_agent/`
