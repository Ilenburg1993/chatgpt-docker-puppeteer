# api/http-bridge.js — Auditoria

**Módulo**: `src/copilot/api/` **Arquivo**: `http-bridge.js` **LOC**: 40 | **Score**: 9.5/10

## Responsabilidade

Aggregator barrel: cria o Express `Router` e delega para 4 módulos de rota:

- `registerControlRoutes` — GET /status, /health, /session · POST /start, /stop, /permissions
- `registerTaskRoutes` — POST /send, /answer
- `registerStreamRoutes` — GET /stream (SSE)
- `registerDialogRoutes` — POST /dialog/start, /dialog/turn, /dialog/stop

Exporta o `bridge` como default para ser montado em `/api/copilot/*`.

## Achados

Nenhum.

## Destaques Positivos

- Estrutura Fase R: cada domínio em sub-módulo independente
- Acoplamento mínimo: apenas agrega via `register*Routes(bridge, alwaysAliveAgent)`

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
