# tests/integration

**Propósito**: Testes de integração que validam a comunicação entre múltiplos módulos do sistema (API, audit, driver, kernel, MCP, RAG, server).  
**Status**: Canônico.  
**Público**: Desenvolvedores de módulos com interfaces entre si.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Specs de integração organizados por domínio em subpastas.
- Testes de boot, fluxo de contexto e missões que cruzam fronteiras de módulos.

## O que não deve ficar aqui

- Testes unitários isolados → `tests/unit/`.
- Testes E2E completos → `tests/e2e/`.

## Entradas principais

| Arquivo/Pasta | Descrição |
|---|---|
| `api/` | Integração da API REST (health endpoint) |
| `audit/` | Pipeline de auditoria end-to-end |
| `driver/` | Integração driver ↔ NERV |
| `kernel/` | Ciclo de vida de identidade no kernel |
| `mcp/` | Integração upstream MCP (HTTP e stdio) |
| `rag/` | Pipeline RAG completo e tratamento de erros |
| `server/` | Dashboard realtime, socket e TLS |
| `test_boot_integration_phase2.spec.js` | Boot fase 2 |
| `test_boot_sanity.spec.js` | Sanidade do boot |
| `test_context_flow.spec.js` | Fluxo de contexto entre módulos |
| `test_feedback_flow.spec.js` | Fluxo de feedback de missão |
| `test_mission_system_integration.spec.js` | Sistema de missões integrado |

## Regras de manutenção

- Executar com `npm run test:integration`.
- Não depender de browser real — usar mocks de `tests/mocks/`.
- Cada subpasta deve ter foco claro em um par de módulos.

## Links relacionados

- Hub de testes: `tests/README.md`
- Testes unitários: `tests/unit/`
