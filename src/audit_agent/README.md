# src/audit_agent

**Propósito**: Agente de auditoria autônomo — inspeciona o sistema, classifica achados, aplica patches via LLM e mantém histórico em banco de dados.  
**Status**: Especializado.  
**Público**: Equipe de qualidade e mantenedores de confiabilidade do sistema.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Pipeline completo de auditoria autônoma do codebase.
- Integração com LLMs para triagem e geração de patches.
- Servidor e banco de dados próprios para persistência de achados.

## O que não deve ficar aqui

- Lógica de execução de missões de usuário → `src/agent/`
- Gateway de inferência genérico → `src/inference_gateway/`
- Scripts de auditoria offline → `scripts/audit/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `main.js` | Bootstrap do agente de auditoria |
| `runtime.js` | Loop de execução do agente de auditoria |
| `server.js` | Servidor HTTP do agente de auditoria |
| `context_builder.js` | Constrói contexto para análise de LLM |
| `triage_llm.js` | Triagem de achados via LLM |
| `patch_author_llm.js` | Geração de patches via LLM |
| `db_store.js` | Persistência de achados e jobs de auditoria |
| `contracts.js` | Contratos e schemas do módulo |

## Regras de manutenção

- Módulo autônomo; comunica-se com o runtime principal via eventos NERV ou HTTP.
- Alterações no schema de banco de dados devem incluir migração em `src/infra/db/`.
- LLMs acessados apenas via `src/inference_gateway/`.

## Links relacionados

- Gateway de inferência: `src/inference_gateway/`
- Repositórios de auditoria: `src/infra/db/`
- Scripts de auditoria: `scripts/audit/`
- Documentação: `DOCUMENTAÇÃO/BUGS/`
