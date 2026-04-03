# sessions.js — Auditoria (routes/)

**Módulo**: `src/copilot/routes/` **Arquivo**: `sessions.js` **LOC**: 661 | **Score**: 8.0/10

## Responsabilidade

15+ endpoints CRUD de sessões SDK, rate limiting por IP, auth opcional via `SDK_API_TOKEN`, SSE por
sessão, paginação de histórico, controle de foreground.

## ACHADO C14-03 — P4 **[FIXED]**

**`GET /sessions/:id/stream` não tem MAX_SSE_CLIENTS cap**

Enquanto `/hooks/events` e `/agent/stream` verificam `_hooksSseClients >= MAX_SSE_CLIENTS`, o
endpoint de stream de sessão não tem nenhum contador ou cap:

```js
router.get('/sessions/:id/stream', (req, res) => {
  // Nenhuma verificação de limite de clientes
  const entry = getSdkSession(id);
  // ...abre SSE sem limite...
});
```

Com N sessões × M clientes por sessão = N×M SSE streams simultâneos sem controle.

## ACHADO C14-04 — P4 **[FIXED]**

**Sem validação de tamanho máximo de `prompt`**

```js
const { prompt, waitForResponse = true, attachments } = req.body ?? {};
if (!prompt || typeof prompt !== 'string') { ... }
// Sem limite de tamanho!
await entry.session.sendAndWait({ prompt, ... }, timeoutMs);
```

Um prompt de vários MB passa sem rejeição, podendo causar uso excessivo de tokens ou pressão de
memória no SDK. `timeoutMs` limita o tempo mas não o tamanho.

**Correção**:

```js
const MAX_PROMPT_BYTES = 512_000;
if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) {
  res.status(400).json({ ok: false, error: 'Prompt excede o limite máximo' });
  return;
}
```

## Achados P5

### C14-SE01 — P5

**Rate limit `_rlWindowMap` O(n) scan a cada requisição**

```js
for (const [k, e] of _rlWindowMap) {
  if (now - e.bucketStart > WINDOW_MS) _rlWindowMap.delete(k);
}
```

GC de entradas expiradas roda a cada chamada. Com muitos IPs únicos simultâneos, este scan pode ser
lento. Alternativa: LRU cache ou purge periódico via `setInterval`.

### C14-SE02 — P5

**`POST /sessions/:id/send` double-timeout redundante mas seguro**

`sendAndWait(opts, timeoutMs)` + `Promise.race([..., setTimeout(timeoutMs + 5000)])` — o JS timeout
é 5s mais lento que o SDK timeout, funcionando como backstop. Redundante.

## Destaques Positivos

- `SDK_API_TOKEN` Bearer auth opcional (SEC-N06 fix) — `req.headers['authorization']`
- `SEC-N10` fix: `DELETE /sessions/:id` requer header `X-Confirm-Delete: true` — proteção explícita
  para operação irreversível
- `validateModel(model)` com regex `MODEL_SAFE_RE` — previne injeção no campo model
- `NEW-03` fix: validação robusta de `timeoutMs` (isFinite, > 0, tipo number)
- `BUG-RF015` fix: purga entradas expiradas do `_rlWindowMap` para evitar memory leak
- Rota `GET /sessions/active|last|foreground` declarada ANTES de `GET /sessions/:id` para evitar
  captura pelo parâmetro dinâmico — ordem correta

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._

---

## Status de Correção (2026-04-03)

### [FIXED] SEC-ROUTE-001 (P2) — DELETE /sessions/:id agora exige BRIDGE_ADMIN_TOKEN

Adicionado middleware \_requireAdminForDestructive antes do handler de DELETE. Verifica
BRIDGE_ADMIN_TOKEN via X-Admin-Token header (ou Authorization Bearer). Em dev sem token configurado,
comportamento legado é mantido (sem auth). Em produção, DELETE de sessão requer token admin —
mitigando IDOR para sistemas multi-client.

**Pontuação atualizada: 8.8/10**

---

## Status de Correção (2026-04-03)

### [FIXED] SEC-ROUTE-001 (P2) — DELETE /sessions/:id agora exige BRIDGE_ADMIN_TOKEN

Adicionado middleware \_requireAdminForDestructive antes do handler de DELETE. Verifica
BRIDGE_ADMIN_TOKEN via X-Admin-Token header (ou Authorization Bearer). Em dev sem token configurado,
comportamento legado é mantido (sem auth). Em produção, DELETE de sessão requer token admin —
mitigando IDOR para sistemas multi-client.

**Pontuação atualizada: 8.8/10**
