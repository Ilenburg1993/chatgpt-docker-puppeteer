# agent.js — Auditoria (routes/)

**Módulo**: `src/copilot/routes/` **Arquivo**: `agent.js` **LOC**: 222 | **Score**: 8.0/10

## Responsabilidade

Inspeção e controle do agente Always-Alive: info, tools (paginada), telemetria, estado, SSE de
lifecycle events.

## ACHADO C14-02 — P4 **[FIXED]** (mesmo padrão de hooks.js)

**SSE counter double-decrement em `/agent/stream`**

Mesmo bug de `hooks.js`: `req.on('close')` + `res.on('error')` + `res.on('finish')` todos
decrementam `_agentSseClients`, causando underflow e tornando `MAX_SSE_CLIENTS` ineficaz.

O comentário `// G2-API-12: decrementar também em 'error' e 'finish'` indica que o fix adicionou os
handlers extras para evitar leak, mas não usou flag idempotente.

**Correção**: idêntica a hooks.js — usar flag boolean `decremented`.

## Destaques Positivos

- `GET /agent/tools` com paginação: `?category=&page=&limit=` (G2-API-11) — correto
- `limit = Math.min(200, ...)` cap máximo protege contra resposta gigante
- Alias `/telemetry` retrocompatível via `handleGetTelemetry` shared entre dois routes
- `try { agentSnapshot = alwaysAliveAgent.getStatusSnapshot() } catch {}` gracioso para agente não
  inicializado

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
