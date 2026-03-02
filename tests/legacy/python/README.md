# tests/legacy/python

**Propósito**: Testes Python dos agentes auxiliares (code_explainer, cooking_ai, server) de versões anteriores.  
**Status**: Histórico.  
**Público**: Referência para mantenedores Python.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `test_agents_server.py` | Testes do servidor de agentes Python |
| `test_code_explainer.py` | Testes do agente code_explainer |
| `test_cooking_agent.py` | Testes do agente cooking_ai |

## Regras de manutenção

- Não executar em CI principal do Node.js.
- Manter apenas como referência — novos testes Python vão em `tests/python/`.

## Links relacionados

- Pasta pai: `tests/legacy/README.md`
- Agentes Python: `agents/`
- Testes Python ativos: `tests/python/`
