# src/server/api/controllers

**Propósito**: Controllers da API REST — implementam handlers de rotas por domínio funcional.  
**Status**: Canônico.  
**Público**: Mantenedores da API.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

Controllers organizados por domínio:

- `tasks.js` / `results.js` / `control.js` — tarefas e controle.
- `missions.js` / `dna.js` — missões e DNA do agente.
- `health.js` / `metrics.js` / `system.js` — saúde e métricas.
- `artifacts.js` / `rag.js` — artefatos e RAG.
- `dashboard.js` / `dashboard_*.js` — endpoints do dashboard (audit, events, inference, missions, tasks).

## O que não deve ficar aqui

- Lógica de domínio → `src/server/domain/`
- Utilitários de resposta → `src/server/api/utils/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `tasks.js` | Controller de tarefas |
| `missions.js` | Controller de missões |
| `health.js` | Controller de health check |
| `dashboard.js` | Controller principal do dashboard |
| `dashboard_audit.js` | Controller de auditoria do dashboard |

## Regras de manutenção

- Controllers devem ser finos: recebem request, delegam para `domain/`, retornam resposta.
- Use `api_envelope.js` de `utils/` para padronizar respostas.

## Links relacionados

- Módulo pai: `src/server/api/`
- Domínio: `src/server/domain/`
