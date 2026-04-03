# api/sdk-api.js — Auditoria

**Módulo**: `src/copilot/api/` **Arquivo**: `sdk-api.js` **LOC**: 39 | **Score**: 9.5/10

## Responsabilidade

Aggregator barrel para a SDK API: monta 6 sub-routers da pasta `routes/` em `/api/sdk/*`:

- `clientRouter` — /ping, /status, /auth, /models, /tools, /client/\*
- `sessionsRouter` — /sessions/\*
- `agentRouter` — /agent/\*
- `webhooksRouter` — /webhooks/\*
- `hooksRouter` — /hooks/\*
- `observabilityRouter` — /observability/\*, /health, /metrics, /errors, /logs, /audit

## Achados

Nenhum.

## Destaques Positivos

- Barrel limpo, sem lógica de negócio
- Cada sub-router foi auditado em F14 routes/

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
