# tests/unit

**Propósito**: Testes unitários organizados por módulo do runtime — cobertura isolada de cada
componente sem dependências externas reais.  
**Status**: Canônico.  
**Público**: Todos os desenvolvedores.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Specs unitários por domínio, espelhando a estrutura de `src/`.
- Meta: 80%+ de cobertura de linhas.

## Entradas principais

| Pasta           | Módulo correspondente                             |
| --------------- | ------------------------------------------------- |
| `agent/`        | `src/agent/` — workers de fila e orquestração     |
| `audit/`        | `scripts/audit/` — pipeline de auditoria          |
| `audit_agent/`  | `src/audit_agent/` — agente de auditoria LLM      |
| `audit_skills/` | Skills de auditoria                               |
| `core/`         | `src/core/` — config, logger, schemas             |
| `devcontainer/` | `.devcontainer/scripts/` — scripts de lifecycle   |
| `driver/`       | `src/driver/` — adapters de browser               |
| `inference/`    | `src/inference_gateway/` — gateway de inferência  |
| `infra/`        | `src/infra/` — I/O, locks, pool                   |
| `integration/`  | Utilitários de integração compartilhados          |
| `kernel/`       | `src/kernel/` — engine de execução                |
| `lsp/`          | LSP / tsserver daemon                             |
| `mcp/`          | Protocolo MCP                                     |
| `missions/`     | `src/missions/` — processamento de missões        |
| `nerv/`         | `src/nerv/` — barramento de eventos               |
| `orchestrator/` | `src/orchestrator/` — estratégias de orquestração |
| `rag/`          | `tools/rag/` — sistema RAG                        |
| `server/`       | `src/server/` — API e realtime                    |
| `shared/`       | `src/shared/` — utilitários compartilhados        |

## Regras de manutenção

- Executar com `npm run test:unit`.
- Cada spec deve ser isolado — usar mocks de `tests/mocks/`.
- Nomear specs como `test_<módulo>.spec.js`.

## Links relacionados

- Hub de testes: `tests/README.md`
- Mocks: `tests/mocks/`
- Testes de integração: `tests/integration/`
