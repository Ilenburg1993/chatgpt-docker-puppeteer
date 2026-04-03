# hooks.js — Auditoria (routes/)

**Módulo**: `src/copilot/routes/` **Arquivo**: `hooks.js` **LOC**: 134 | **Score**: 8.0/10

## Responsabilidade

Introspecção e SSE de eventos do sistema de hooks. GET `/hooks/registry` + GET `/hooks/events`.

## ACHADO C14-01 — P4 **[FIXED]**

**SSE counter triple-decrement: `req.close` + `res.error` + `res.finish`**

```js
req.on('close', () => {
  _hooksSseClients--; // ← decrement 1
  clearInterval(heartbeatInterval);
  defaultBus.off('*', onAnyHook);
});
res.on('error', () => _hooksSseClients--); // ← decrement 2 (pode ocorrer com close)
res.on('finish', () => _hooksSseClients--); // ← decrement 3 (pode ocorrer com close)
```

Quando um cliente SSE desconecta abruptamente:

1. `req.on('close')` dispara → decrement
2. `res.on('error')` pode disparar (socket destruído com dados pendentes) → decrement
3. `res.on('finish')` pode disparar → decrement

`_hooksSseClients` pode ir para valores negativos, tornando o cap `>= MAX_SSE_CLIENTS` ineficaz
(e.g., `-5 >= 10` é sempre false → novas conexões sempre aceitas).

**Correção**:

```js
let decremented = false;
const decrement = () => {
  if (!decremented) {
    decremented = true;
    _hooksSseClients--;
  }
};
req.on('close', () => {
  decrement();
  clearInterval(heartbeatInterval);
  defaultBus.off('*', onAnyHook);
});
res.on('error', decrement);
res.on('finish', decrement);
```

## Destaques Positivos

- `MAX_SSE_CLIENTS` cap protege contra abertura excessiva de streams
- Limpeza completa: `clearInterval`, `defaultBus.off` no close
- `res.writableEnded` guard antes de cada write

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
