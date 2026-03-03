# agents

**Propósito**: Agentes auxiliares Python — implementações de agentes especializados (code_explainer,
cooking_ai) com servidor FastAPI.  
**Status**: Canônico de apoio.  
**Público**: Desenvolvedores Python e mantenedores de agentes auxiliares.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Agentes Python independentes do runtime Node.js principal.
- Servidor FastAPI que expõe os agentes via HTTP.

> **Atenção**: `agents/` (raiz) ≠ `src/agent/` (workers internos do runtime Node.js).

## Entradas principais

| Arquivo/Pasta     | Descrição                               |
| ----------------- | --------------------------------------- |
| `server.py`       | Servidor FastAPI principal dos agentes  |
| `__init__.py`     | Módulo Python do pacote agents          |
| `code_explainer/` | Agente explicador de código             |
| `cooking_ai/`     | Agente de culinária (demonstração)      |
| `teste.js`        | Script de teste de integração JS↔Python |

## Regras de manutenção

- Manter compatível com Python 3.10+.
- Testes em `tests/legacy/python/` (legados) e `tests/python/` (novos).
- Não importar módulos Node.js aqui.

## Links relacionados

- Testes Python legados: `tests/legacy/python/`
- Testes Python ativos: `tests/python/`
- Runtime Node.js: `src/agent/`
