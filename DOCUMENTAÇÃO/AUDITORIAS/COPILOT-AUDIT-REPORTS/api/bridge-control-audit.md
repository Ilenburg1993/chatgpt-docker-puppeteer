# api/bridge-control.js — Auditoria

**Módulo**: `src/copilot/api/` **Arquivo**: `bridge-control.js` **LOC**: 243 | **Score**: 8.5/10

## Responsabilidade

Rotas de controle do `AlwaysAliveAgent`:

| Rota                | Tipo                     | Auth                 |
| ------------------- | ------------------------ | -------------------- |
| `GET /status`       | Status snapshot          | —                    |
| `GET /health`       | Health check (200/503)   | —                    |
| `GET /session`      | Dados da sessão ativa    | —                    |
| `POST /start`       | Inicia o agente          | —                    |
| `POST /stop`        | Para o agente            | —                    |
| `GET /permissions`  | Modo de permissão atual  | —                    |
| `POST /permissions` | Altera modo de permissão | `BRIDGE_ADMIN_TOKEN` |

## Achados

### P4 — `_handleHealth`: false positive para `hubStore.ok` quando `conversationStore.db` é null **[FIXED]**

**Localização**: `bridge-control.js:115` — `conversationStore.db?.prepare('SELECT 1').get()`

**Descrição**: A sintaxe `conversationStore.db?.prepare('SELECT 1').get()` é interpretada como
`(conversationStore.db)?.(__chain__)`. Se `conversationStore.db` for `null` ou `undefined`, o
operador `?.` **short-circuits a chain inteira**, retornando `undefined` sem executar `.get()`.
Nenhuma exceção é lançada → o `try/catch` retorna `{ ok: true }` **mesmo com o banco não
inicializado**.

```js
// ATUAL — false positive quando db é null
const hubStore = (() => {
  try {
    conversationStore.db?.prepare('SELECT 1').get(); // ← retorna undefined sem throw
    return { ok: true }; // ← reportado como ok mesmo sem DB!
  } catch (e) {
    return { ok: false, error: e.message ?? 'unknown' };
  }
})();

// FIX sugerido
const hubStore = (() => {
  if (!conversationStore.db) return { ok: false, error: 'db não inicializado' };
  try {
    conversationStore.db.prepare('SELECT 1').get();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? 'unknown') };
  }
})();
```

**Impacto**: Health check reporta `hubStore.ok = true` quando o SQLite não está disponível,
enganando orquestradores que utilizam `/health` para roteamento de tráfego.

---

### P5 — `POST /stop` e `POST /start` sem proteção por `requireAdmin`

**Localização**: `bridge-control.js:65-68`

**Descrição**: `POST /start` e `POST /stop` são rotas capazes de interromper o agente mas não exigem
`BRIDGE_ADMIN_TOKEN`. Apenas `POST /permissions` tem a proteção. Se o http-bridge for exposto sem
autenticação no router pai, qualquer cliente interno pode parar o agente.

**Mitigação atual**: O http-bridge tipicamente é acessado através do SDK_API_TOKEN do router pai.
Mas a defesa em profundidade sugere que start/stop também devessem ter `requireAdmin`.

---

### P5 — `status === 'starting'` não consta nos estados "healthy"

**Localização**: `bridge-control.js:110` — linha `healthy = snap.status === 'idle' || ...`

**Descrição**: `status === 'starting'` não está na lista de estados saudáveis. Durante o boot do
agente, `/health` retorna 503 por breves instantes, podendo causar falsa indisponibilidade em load
balancers ou probes de readiness.

**Sugestão**: Adicionar `'starting'` à lista de estados healthy, ou usar endpoint separado
`/readiness` (503 durante boot) vs `/liveness` (200 sempre que o processo está vivo).

---

## Destaques Positivos

- `_makeAdminAuthMiddleware()`: produção sem token → 503 (fail-safe); dev → bypass com WARN log
- `_handleHealth` inclui `sdkVersion`, `nodeVersion`, `channelVersion` (UPG-PROP-07)
- `listenerDiagnostics` exposto apenas com duas guards: `NODE_ENV=development` +
  `BRIDGE_EXPOSE_DIAGNOSTICS=true`
- `ARCH-04`: verificação de conectividade SQLite via `SELECT 1` no health check
- `POST /permissions` com validação de `mode` contra `['approve_all', 'audit_only', 'selective']`

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._

---

## Status de Correção (2026-04-03)

### [FIXED] SEC-API-001 (P5→P3 por defesa em profundidade) — POST /start e /stop agora exigem requireAdmin

bridge-control.js L65-66: adicionado requireAdmin middleware nas rotas POST /start e POST /stop.
Mesma proteção já existente em POST /permissions. Defesa em profundidade — sistema single-user mas
previne acesso acidental de automações internas ou services sem token admin.

**Pontuação atualizada: 8.8/10**

---

## Status de Correção (2026-04-03)

### [FIXED] SEC-API-001 (P5→P3 por defesa em profundidade) — POST /start e /stop agora exigem requireAdmin

bridge-control.js L65-66: adicionado requireAdmin middleware nas rotas POST /start e POST /stop.
Mesma proteção já existente em POST /permissions. Defesa em profundidade — sistema single-user mas
previne acesso acidental de automações internas ou services sem token admin.

**Pontuação atualizada: 8.8/10**
